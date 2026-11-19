// Decaid's grinders, beans and bean batches, as Decaid v0.9.2 answers them.
//
// Read from decaid v0.9.2: lib/src/services/webserver/grinders_handler.dart
// (`_getGrinders`, `_getGrinder`), lib/src/services/database/daos/grinder_dao.dart
// (`getAllGrinders`: the archived left out unless asked, the most recently
// changed first) and lib/src/services/webserver/beans_handler.dart (`_getBatch`).
// Recorded: recordings/grinders.json.
//
// - `GET /grinders`: a bare list; the archived only with `includeArchived=true`.
// - `GET /grinders/<id>`, `GET /bean-batches/<id>`: the record, or 404.
//
// Not kept: writes to grinders, beans and batches have no answer; the page
// tests start from the recorded sample data.

import { copy } from './workflow.js';

const byNewestChange = (a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0);

export function createLibrary({ grinders = [], beans = [], batches = {} } = {}) {
    const state = {
        grinders: grinders.map(copy),
        beans: beans.map(copy),
        batches: Object.values(batches).flat().map(copy),
    };
    return {
        state,
        answer(method, path, query) {
            if (method !== 'GET') return null;
            if (path === '/grinders') {
                const all = query.get('includeArchived') === 'true';
                return { status: 200, body: state.grinders.filter(g => all || !g.archived).sort(byNewestChange).map(copy) };
            }
            let match = /^\/grinders\/([^/]+)$/.exec(path);
            if (match) {
                const found = state.grinders.find(g => g.id === decodeURIComponent(match[1]));
                return found ? { status: 200, body: copy(found) } : { status: 404, body: { error: 'Grinder not found' } };
            }
            match = /^\/bean-batches\/([^/]+)$/.exec(path);
            if (match) {
                const found = state.batches.find(b => b.id === decodeURIComponent(match[1]));
                return found ? { status: 200, body: copy(found) } : { status: 404, body: { error: 'Batch not found' } };
            }
            return null;
        },
    };
}
