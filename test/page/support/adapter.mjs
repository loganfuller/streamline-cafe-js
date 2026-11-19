// The Playwright adapter: every request and socket the page opens goes to the
// fake Decaid (fake-decaid/). A request or socket the model has no answer for
// is answered with a 599 and kept, and the test fails naming it at its end.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DECAID_ORIGIN, DECAID_SOCKETS, PAGE_ORIGIN } from './page-files.mjs';

const RECORDINGS = join(import.meta.dirname, '..', '..', '..', 'fake-decaid', 'recordings');
const cache = new Map();
/** A recording, read once per worker. Each fake gets its own copy through the model. */
export function recording(name) {
    if (!cache.has(name)) cache.set(name, JSON.parse(readFileSync(join(RECORDINGS, `${name}.json`), 'utf8')));
    return cache.get(name);
}

/**
 * Routes `context` to `fake`. Answers `{ unanswered, inflight, sockets,
 * opened, drop, intercept, interceptSocket }`: what had no answer, the
 * requests being answered now ("METHOD url"), the paths of the sockets open,
 * the path of every socket opened in order (a reopened one again), a way to
 * close the sockets open to a path from Decaid's side, and two ways for a test
 * to stand between the page and the fake (support/faults.mjs uses them).
 */
export async function attach(context, fake) {
    const unanswered = [];
    const inflight = new Set();
    const sockets = new Set();
    const opened = [];
    const live = new Map();
    const interceptors = [];
    const socketInterceptors = [];

    /**
     * The first request `match({ method, path, search })` is true of goes to
     * `handler({ method, url, body, forward })` instead, which answers
     * `{ status, body }`, `{ abort: true }` or null (unanswered), at once or
     * later; `forward()` is the fake's own answer. The request counts as being
     * answered until the handler answers. Answers a function that removes it.
     */
    const intercept = (match, handler) => {
        const entry = { match, handler };
        interceptors.push(entry);
        return () => { const at = interceptors.indexOf(entry); if (at >= 0) interceptors.splice(at, 1); };
    };
    /** A socket to `path` is opened by `open(send)`, which answers `{ close }`, instead of the fake. */
    const interceptSocket = (path, open) => {
        const entry = { path, open };
        socketInterceptors.push(entry);
        return () => { const at = socketInterceptors.indexOf(entry); if (at >= 0) socketInterceptors.splice(at, 1); };
    };

    // Anything else the page asks for, a file elsewhere included, has no answer.
    await context.route(url => url.origin !== PAGE_ORIGIN && url.origin !== DECAID_ORIGIN, route => {
        unanswered.push(`${route.request().method()} ${route.request().url()}`);
        return route.abort('blockedbyclient');
    });

    await context.route(`${DECAID_ORIGIN}/**`, async route => {
        const request = route.request();
        const asking = { toString: () => `${request.method()} ${request.url()}` };
        inflight.add(asking);
        try {
            const text = request.postData();
            let body;
            if (text) {
                try { body = JSON.parse(text); } catch { body = text; }
            }
            const method = request.method();
            const url = request.url();
            const parsed = new URL(url);
            const forward = () => fake.request({ method, url, body });
            const hit = interceptors.find(i => i.match({ method, path: parsed.pathname, search: parsed.search }));
            const answer = hit ? await hit.handler({ method, url, body, forward }) : forward();
            if (!answer) {
                const url = new URL(request.url());
                unanswered.push(`${request.method()} ${url.pathname}${url.search}`);
                await route.fulfill({ status: 599, contentType: 'application/json', body: JSON.stringify({ error: 'the fake Decaid has no answer for this' }) });
            } else if (answer.abort) {
                await route.abort('failed');
            } else {
                await route.fulfill({ status: answer.status, contentType: 'application/json', body: JSON.stringify(answer.body) });
            }
        } catch (error) {
            // A page closing while it is answered.
            if (!/closed|disposed/i.test(String(error))) throw error;
        } finally {
            inflight.delete(asking);
            fake.flush();
        }
    });

    await context.routeWebSocket(() => true, socket => {
        const url = new URL(socket.url());
        const path = url.pathname;
        const own = url.origin === DECAID_SOCKETS ? socketInterceptors.find(i => i.path === path) : null;
        const send = text => socket.send(text);
        const handle = own ? own.open(send) : url.origin === DECAID_SOCKETS ? fake.connect(path, send) : null;
        if (!handle) {
            unanswered.push(`WS ${socket.url()}`);
            socket.close({ code: 1011, reason: 'the fake Decaid has no such socket' });
            return;
        }
        sockets.add(path);
        opened.push(path);
        if (!live.has(path)) live.set(path, new Set());
        live.get(path).add(socket);
        socket.onMessage(() => {});
        socket.onClose(() => {
            handle.close();
            live.get(path)?.delete(socket);
            if (!live.get(path)?.size) sockets.delete(path);
        });
        fake.flush();
    });

    /**
     * Closes every socket open to `path` from Decaid's side, as a Decaid
     * restarting or a network drop leaves the page: the fake stops sending to
     * them, and the page sees them close. Answers how many it closed.
     */
    const drop = async path => {
        const open = [...(live.get(path) || [])];
        for (const socket of open) await socket.close({ code: 1001, reason: 'dropped by the test' });
        return open.length;
    };

    return { unanswered, inflight, sockets, opened, drop, intercept, interceptSocket };
}
