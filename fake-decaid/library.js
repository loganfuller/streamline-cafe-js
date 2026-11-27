// Decaid's grinders, beans and bean batches, as Decaid v0.9.2 answers them.
//
// Read from decaid v0.9.2: lib/src/services/webserver/grinders_handler.dart
// (`_getGrinders`, `_getGrinder`), lib/src/services/database/daos/grinder_dao.dart
// (`getAllGrinders`: the archived left out unless asked, the most recently
// changed first), lib/src/services/webserver/beans_handler.dart (`_getBeans`,
// `_getBatches`, `_getBatch`) and lib/src/services/database/daos/bean_dao.dart
// (`getAllBeans`, `getBatchesForBean`: the archived left out unless asked, the
// most recently changed first), and for the write of a batch `_updateBatch` in
// beans_handler.dart with lib/src/services/webserver/json_patch.dart
// (`rejectExplicitNulls`, `validatePatchFieldTypes`).
// Recorded: recordings/grinders.json, recordings/beans.json,
// recordings/batch-weight.json, recordings/batch-archive.json. The sample data
// holds no archived bean, so the beans' archive rule is read from bean_dao.dart
// and held by the unit test alone; the batches' and grinders' are recorded.
//
// - `GET /grinders`, `GET /beans`: a bare list; the archived only with
//   `includeArchived=true`, the most recently changed first.
// - `GET /beans/<id>/batches`: that bean's batches, a bare list, the archived
//   only with `includeArchived=true`, the most recently changed first; an empty
//   list for a bean Decaid doesn't have.
// - `GET /grinders/<id>`, `GET /bean-batches/<id>`: the record, or 404.
// - `PUT /bean-batches/<id>`: the record with the fields given laid over it,
//   every other field kept, and `updatedAt` set to now; 404 for a batch Decaid
//   doesn't have. `id`, `beanId` and `createdAt` are never changed. A field
//   given as null is cleared, but `frozen` and `archived`, which can't be: 400.
//   A number field (`weight`, `weightRemaining`, `qualityScore`, `price`) given
//   as anything but a number or null: 400. The answer is the record as stored,
//   with no key for a field that holds nothing.
//
// Not kept: the other writes to grinders, beans and batches have no answer;
// the page tests start from the recorded sample data. Decaid also refuses a
// batch field of the wrong type other than the four number fields (a text
// `roastDate`, say) with its own words for it, which the fake does not model:
// the page writes `weightRemaining` and `archived` alone.

import { copy } from './workflow.js';

const byNewestChange = (a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0);

const NUMBER_FIELDS = ['qualityScore', 'price', 'weight', 'weightRemaining'];
const NEVER_NULL = ['frozen', 'archived'];
const KEPT = ['id', 'beanId', 'createdAt'];

const refused = message => ({ status: 400, body: { error: `FormatException: ${message}` } });

const stamp = time => String(time || '').replace(/Z$/, '');

// Decaid's clock is past every record it holds; the fake's may not be past
// the recorded sample data's, so a write is stamped after the newest of them.
function updateBatch(existing, patch, now, newest) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { status: 400, body: { error: 'The batch\'s fields must be a JSON object' } };
    for (const field of NEVER_NULL) {
        if (field in patch && patch[field] === null) return refused(`Field "${field}" cannot be null`);
    }
    for (const field of NUMBER_FIELDS) {
        if (patch[field] != null && typeof patch[field] !== 'number') return refused(`Field "${field}" must be a number or null`);
    }
    for (const [field, value] of Object.entries(patch)) {
        if (KEPT.includes(field)) continue;
        if (value === null) delete existing[field];
        else existing[field] = copy(value);
    }
    existing.updatedAt = now > newest ? now : `${newest}1`;
    return { status: 200, body: copy(existing) };
}

export function createLibrary({ grinders = [], beans = [], batches = {} } = {}, utcNow = () => new Date().toISOString()) {
    const state = {
        grinders: grinders.map(copy),
        beans: beans.map(copy),
        batches: Object.values(batches).flat().map(copy),
    };
    return {
        state,
        answer(method, path, query, body) {
            if (method === 'PUT') {
                const written = /^\/bean-batches\/([^/]+)$/.exec(path);
                if (!written) return null;
                const existing = state.batches.find(b => b.id === decodeURIComponent(written[1]));
                if (!existing) return { status: 404, body: { error: 'Batch not found' } };
                const newest = state.batches.map(b => stamp(b.updatedAt)).sort().pop();
                return updateBatch(existing, body, stamp(utcNow()), newest);
            }
            if (method !== 'GET') return null;
            if (path === '/grinders') {
                const all = query.get('includeArchived') === 'true';
                return { status: 200, body: state.grinders.filter(g => all || !g.archived).sort(byNewestChange).map(copy) };
            }
            const archived = query.get('includeArchived') === 'true';
            if (path === '/beans') return { status: 200, body: state.beans.filter(b => archived || !b.archived).sort(byNewestChange).map(copy) };
            let match = /^\/beans\/([^/]+)\/batches$/.exec(path);
            if (match) {
                const beanId = decodeURIComponent(match[1]);
                return { status: 200, body: state.batches.filter(b => b.beanId === beanId && (archived || !b.archived)).sort(byNewestChange).map(copy) };
            }
            match = /^\/grinders\/([^/]+)$/.exec(path);
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
