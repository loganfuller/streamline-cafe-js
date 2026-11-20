// The public preview's site for its page test (test/page/preview.spec.mjs):
// staged by preview/stage.mjs, as the Pages workflow stages it, and answered
// from disk through a route under a project path as Pages serves it. Every
// other request and socket is kept and refused, so a test can say none was
// made: the preview has no adapter and no route to a fake in Node.

import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

import { stage } from '../../../preview/stage.mjs';

/** Where the site is served: a Pages-like https address, and a local http one with Decaid's port beside it. */
export const SITES = {
    pages: 'https://preview.test/streamline-cafe-js/',
    local: 'http://127.0.0.1:24800/streamline-cafe-js/',
};

/** The one request to another origin the skin's page makes, its favicon (index.html). */
export const FAVICON_ORIGIN = 'https://fast.decentespresso.com';

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
};

/**
 * Stages the site into a new temporary folder of the worker's own, as the
 * workflow does, so two runs at once never stage over each other's. The
 * caller removes it (`removeSite`).
 */
export function stageSite() {
    return stage(mkdtempSync(join(tmpdir(), 'cafe-preview-site-')));
}

export function removeSite(root) {
    rmSync(root, { recursive: true, force: true });
}

/**
 * Serves the staged site at `site`, and keeps every other request (`escaped`,
 * as "METHOD url") and socket ("WS url"), refusing each. A Decaid request the
 * stand-in let through would be one of them.
 */
export async function serveSite(context, root, site) {
    const escaped = [];
    const files = new Map();
    await context.route(url => !url.href.startsWith(site), route => {
        escaped.push(`${route.request().method()} ${route.request().url()}`);
        return route.abort('blockedbyclient');
    });
    await context.route(`${site}**`, async route => {
        let path = normalize(decodeURIComponent(new URL(route.request().url()).pathname.slice(new URL(site).pathname.length - 1)));
        if (path.endsWith('/')) path += 'index.html';
        if (path.includes('..')) return route.fulfill({ status: 403, body: 'outside the site' });
        if (!files.has(path)) {
            let read;
            try {
                read = await readFile(join(root, path));
            } catch {
                read = null;
            }
            files.set(path, read);
        }
        const body = files.get(path);
        if (body === null) return route.fulfill({ status: 404, body: `no file ${path}` });
        return route.fulfill({ body, contentType: TYPES[extname(path)] || 'application/octet-stream' });
    });
    await context.routeWebSocket(() => true, socket => {
        escaped.push(`WS ${socket.url()}`);
        socket.close({ code: 1011, reason: 'no socket leaves the preview' });
    });
    return escaped;
}
