// What the real stack answered the page's boot, for the requests and sockets
// the model keeps no state for: Streamline's own modules reading Decaid's
// settings, its devices, sensors, profiles and plugins' sockets. Recorded:
// recordings/boot.json, against the pinned stack with the sample data in it.
//
// A request is matched by its method, path and query as the page sent them. A
// write among them (Streamline saving a setting of Decaid's own, the display's
// wake lock) is answered as recorded and changes nothing.

import { copy } from './workflow.js';

export function createBoot(recording) {
    const requests = new Map(Object.entries(recording.requests || {}).map(([key, value]) => [key, copy(value)]));
    const sockets = recording.sockets || {};
    const key = (method, path, query) => {
        const search = query && String(query) ? `?${query}` : '';
        return `${method} ${path}${search}`;
    };
    return {
        answer(method, path, query) {
            const found = requests.get(key(method, path, query));
            return found ? { status: found.status, body: copy(found.body) } : null;
        },
        body(method, pathAndQuery) {
            const found = requests.get(`${method} ${pathAndQuery}`);
            return found ? copy(found.body) : null;
        },
        socket(path) {
            return sockets[path] ? copy(sockets[path].frames) : null;
        },
        patch(name, change) {
            const found = requests.get(name);
            if (!found) throw new Error(`the boot has no answer for ${name}`);
            found.body = change(copy(found.body));
        },
    };
}
