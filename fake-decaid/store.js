// Decaid's key-value store, as Decaid v0.9.2 answers it.
//
// Read from decaid v0.9.2: lib/src/services/webserver/kv_store_handler.dart.
// Recorded: recordings/store.json.
//
// - The namespace and key are taken as they stand in the URL, not decoded:
//   `profile%3Aab12` is a key of its own, and is listed so.
// - `GET /store/<ns>/<key>`: 200 with the value, and 200 `null` for a key never written.
// - `GET /store/<ns>`: 200 with the namespace's keys, sorted; with `?full=1`, its keys and values.
// - `POST /store/<ns>/<key>`: stores the body as JSON (a body that is JSON `null` stores
//   the text "null"), and answers 200 `{}`.
// - `DELETE /store/<ns>/<key>`: removes it, and answers 200 `{}`.

import { copy } from './workflow.js';

export function createStore(initial = {}) {
    /** namespace → Map of key → value */
    const spaces = new Map();
    const space = name => {
        if (!spaces.has(name)) spaces.set(name, new Map());
        return spaces.get(name);
    };
    for (const [name, values] of Object.entries(initial)) {
        for (const [key, value] of Object.entries(values || {})) space(name).set(key, copy(value));
    }

    return {
        get: (namespace, key) => (space(namespace).has(key) ? copy(space(namespace).get(key)) : null),
        set: (namespace, key, value) => { space(namespace).set(key, copy(value)); },
        has: (namespace, key) => space(namespace).has(key),
        delete: (namespace, key) => { space(namespace).delete(key); },
        /** Answers a store request, or null when it is not one. `path` is after `/api/v1/store/`. */
        answer(method, path, query, body) {
            const [namespace, rawKey, ...rest] = path.split('/');
            if (!namespace || rest.length) return null;
            const ns = namespace;
            if (rawKey === undefined) {
                if (method !== 'GET') return null;
                const entries = [...space(ns).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
                if (query.get('full') === '1') return { status: 200, body: Object.fromEntries(entries.filter(([, v]) => v !== null).map(([k, v]) => [k, copy(v)])) };
                return { status: 200, body: entries.map(([k]) => k) };
            }
            const key = rawKey;
            if (method === 'GET') return { status: 200, body: space(ns).has(key) ? copy(space(ns).get(key)) : null };
            if (method === 'POST') {
                space(ns).set(key, body === null || body === undefined ? 'null' : copy(body));
                return { status: 200, body: {} };
            }
            if (method === 'DELETE') {
                space(ns).delete(key);
                return { status: 200, body: {} };
            }
            return null;
        },
    };
}
