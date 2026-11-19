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
 * Routes `context` to `fake`. Answers `{ unanswered, inflight, sockets }`:
 * what had no answer, how many requests are being answered now, and the paths
 * of the sockets open.
 */
export async function attach(context, fake) {
    const unanswered = [];
    const inflight = { count: 0 };
    const sockets = new Set();

    // Anything else the page asks for, a file elsewhere included, has no answer.
    await context.route(url => !url.href.startsWith(PAGE_ORIGIN) && !url.href.startsWith(DECAID_ORIGIN), route => {
        unanswered.push(`${route.request().method()} ${route.request().url()}`);
        return route.abort('blockedbyclient');
    });

    await context.route(`${DECAID_ORIGIN}/**`, async route => {
        inflight.count += 1;
        try {
            const request = route.request();
            const text = request.postData();
            let body;
            if (text) {
                try { body = JSON.parse(text); } catch { body = text; }
            }
            const answer = fake.request({ method: request.method(), url: request.url(), body });
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
            inflight.count -= 1;
            fake.flush();
        }
    });

    await context.routeWebSocket(() => true, socket => {
        const url = new URL(socket.url());
        const path = url.pathname;
        const handle = url.href.startsWith(DECAID_SOCKETS) ? fake.connect(path, text => socket.send(text)) : null;
        if (!handle) {
            unanswered.push(`WS ${socket.url()}`);
            socket.close({ code: 1011, reason: 'the fake Decaid has no such socket' });
            return;
        }
        sockets.add(path);
        socket.onMessage(() => {});
        socket.onClose(() => {
            handle.close();
            sockets.delete(path);
        });
        fake.flush();
    });

    return { unanswered, inflight, sockets };
}
