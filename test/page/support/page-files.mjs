// The page's own files, answered from disk through a route, for the recorder and
// the page tests alike: a run needs no static server and no port. The page is
// at PAGE_ORIGIN and calls Decaid at DECAID_ORIGIN, two origins as on a tablet.

import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

export const PAGE_ORIGIN = 'http://127.0.0.1:24800';
export const DECAID_ORIGIN = 'http://127.0.0.1:8080';
export const DECAID_SOCKETS = 'ws://127.0.0.1:8080';

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
};

// Read once per process: every test opens the same files.
const cache = new Map();

/** Answers every request to the page's origin from the repository at `root`. */
export async function servePage(context, root) {
    await context.route(`${PAGE_ORIGIN}/**`, async route => {
        const path = normalize(decodeURIComponent(new URL(route.request().url()).pathname));
        if (path.includes('..')) return route.fulfill({ status: 403, body: 'outside the repository' });
        let body = cache.get(path);
        if (body === undefined) {
            try {
                body = await readFile(join(root, path));
            } catch {
                body = null;
            }
            cache.set(path, body);
        }
        if (body === null) return route.fulfill({ status: 404, body: `no file ${path}` });
        return route.fulfill({ body, contentType: TYPES[extname(path)] || 'application/octet-stream' });
    });
}
