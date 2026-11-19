// Decaid's Shots, as Decaid v0.9.2 lists, answers and edits them.
//
// Read from decaid v0.9.2: lib/src/models/data/shot_annotations.dart (`toJson`),
// lib/src/services/webserver/shots_handler.dart
// (`_getShots`, `_getLatestShot`, `_getShot`, `_updateShot`) and
// lib/src/services/storage/shot_dao.dart (newest first, then by id); guided by
// decent-sync's server/test/support/decaid-shots.ts and simulated-tablet.ts.
// Recorded: recordings/shots.json.
//
// - `GET /shots`: `{ items, total, limit, offset }`, newest first unless
//   `order=asc`, each row without its measurements. `limit` defaults to 20 and
//   is held to 1–100 (the answer repeats it as asked); `orderBy` is ignored.
//   Filters by `grinderId`, `grinderModel`, `beanBatchId`, `coffeeName`,
//   `coffeeRoaster` and `profileTitle`, each the Workflow's own field.
// - `GET /shots?ids=a,b`: a bare list of those Shots, whole, and 400 with a filter.
// - `GET /shots/latest`: the newest without its measurements, or null.
// - `GET /shots/<id>`: the whole Shot, or 404.
// - `PUT /shots/<id>`: merged in as the Workflow is, null replacing; a note set
//   to null is "", `shotNotes` and `metadata` follow the note and the extras,
//   and `updatedAt` moves only when something changed.
//
// Not kept: the `search`, `beanId` and `minEnjoyment` filters have no answer.

import { copy, deepMerge, isObject } from './workflow.js';

const FILTERS = {
    grinderId: shot => shot.workflow?.context?.grinderId,
    grinderModel: shot => shot.workflow?.context?.grinderModel,
    beanBatchId: shot => shot.workflow?.context?.beanBatchId,
    coffeeName: shot => shot.workflow?.context?.coffeeName,
    coffeeRoaster: shot => shot.workflow?.context?.coffeeRoaster,
    profileTitle: shot => shot.workflow?.profile?.title,
};
const KNOWN = new Set(['limit', 'offset', 'order', 'orderBy', 'ids', ...Object.keys(FILTERS)]);

const withoutMeasurements = ({ measurements, ...rest }) => copy(rest);
const newestFirst = (a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** `shotNotes` and `metadata` in a patch are the annotations' note and extras (`_normalizeLegacyAnnotationPatch`). */
function legacyNormalized(patch) {
    const normalized = { ...patch };
    if ('annotations' in patch) {
        if (isObject(patch.annotations)) {
            const annotations = { ...patch.annotations };
            if (!('espressoNotes' in annotations) && 'shotNotes' in patch) annotations.espressoNotes = patch.shotNotes;
            if (!('extras' in annotations) && 'metadata' in patch) annotations.extras = patch.metadata;
            normalized.annotations = annotations;
        }
    } else if ('shotNotes' in patch || 'metadata' in patch) {
        normalized.annotations = {
            ...('shotNotes' in patch ? { espressoNotes: patch.shotNotes } : {}),
            ...('metadata' in patch ? { extras: patch.metadata } : {}),
        };
    }
    delete normalized.shotNotes;
    delete normalized.metadata;
    return normalized;
}

const ANNOTATIONS = ['actualDoseWeight', 'actualYield', 'drinkTds', 'drinkEy', 'enjoyment', 'espressoNotes', 'extras'];
const annotationsOf = annotations => Object.fromEntries(ANNOTATIONS.filter(key => annotations[key] != null).map(key => [key, annotations[key]]));

/** The Shot's `shotNotes` and `metadata` follow its annotations' note and extras (`_synchronizeLegacyAnnotationAliases`). */
function synchronizeAliases(shot) {
    if (!('annotations' in shot)) return;
    const annotations = shot.annotations;
    if (isObject(annotations) && annotations.espressoNotes != null) shot.shotNotes = annotations.espressoNotes;
    else delete shot.shotNotes;
    if (isObject(annotations) && annotations.extras != null) shot.metadata = annotations.extras;
    else delete shot.metadata;
}

/** @param {object[]} initial whole Shots @param {() => string} utcNow an ISO time with its Z */
export function createShots(initial = [], utcNow) {
    const shots = initial.map(copy);

    function list(query) {
        for (const key of query.keys()) if (!KNOWN.has(key)) return null;
        const ids = query.getAll('ids').flatMap(value => value.split(',')).filter(Boolean);
        const filters = Object.keys(FILTERS).filter(key => query.has(key));
        if (ids.length && filters.length) return { status: 400, body: { error: 'ids cannot be combined with other filters' } };
        const order = query.get('order');
        if (ids.length) {
            const found = ids.map(id => shots.find(shot => shot.id === id)).filter(Boolean).sort(newestFirst);
            if (order === 'asc') found.reverse();
            return { status: 200, body: found.map(copy) };
        }
        const limit = Number.parseInt(query.get('limit') ?? '', 10);
        const offset = Number.parseInt(query.get('offset') ?? '', 10);
        const asked = Number.isNaN(limit) ? 20 : limit;
        const from = Number.isNaN(offset) ? 0 : offset;
        const matching = shots.filter(shot => filters.every(key => FILTERS[key](shot) === query.get(key))).sort(newestFirst);
        if (order === 'asc') matching.reverse();
        const page = matching.slice(Math.max(0, from), Math.max(0, from) + Math.min(100, Math.max(1, asked)));
        return { status: 200, body: { items: page.map(withoutMeasurements), total: matching.length, limit: asked, offset: from } };
    }

    function update(id, patch) {
        if (!isObject(patch)) return { status: 400, body: { error: 'body must be a JSON object' } };
        if (patch.id != null && patch.id !== id) return { status: 400, body: { error: 'ID in path does not match ID in body' } };
        if ('measurements' in patch) return { status: 400, body: { error: 'measurements is not editable via this endpoint' } };
        if ('createdAt' in patch || 'updatedAt' in patch) return { status: 400, body: { error: 'createdAt and updatedAt are system-managed and cannot be modified via this endpoint' } };
        const enjoyment = patch.annotations?.enjoyment;
        if (enjoyment != null && (typeof enjoyment !== 'number' || enjoyment < 0 || enjoyment > 10)) return { status: 400, body: { error: 'enjoyment must be between 0 and 10' } };
        const index = shots.findIndex(shot => shot.id === id);
        if (index < 0) return { status: 404, body: { error: 'Shot not found' } };
        const existing = shots[index];
        const normalized = legacyNormalized(patch);
        const merged = deepMerge(existing, copy(normalized));
        // A note cleared is "", not null (`_representClearedNoteAsEmpty`).
        if ('annotations' in normalized && (normalized.annotations === null || (isObject(normalized.annotations) && 'espressoNotes' in normalized.annotations && normalized.annotations.espressoNotes === null))) {
            merged.annotations = { ...(isObject(merged.annotations) ? merged.annotations : {}), espressoNotes: '' };
        }
        synchronizeAliases(merged);
        // Rebuilt as `ShotAnnotations.toJson` writes them: its own fields, none null.
        if (isObject(merged.annotations)) merged.annotations = annotationsOf(merged.annotations);
        merged.id = id;
        const { updatedAt: before, ...was } = existing;
        const { updatedAt: _ignored, ...now } = merged;
        merged.updatedAt = JSON.stringify(was) === JSON.stringify(now) ? before : utcNow();
        shots[index] = merged;
        return { status: 200, body: copy(merged) };
    }

    return {
        all: () => shots,
        add: shot => { shots.push(copy(shot)); },
        get: id => shots.find(shot => shot.id === id) || null,
        newest: count => [...shots].sort(newestFirst).slice(0, count).map(withoutMeasurements),
        /** Answers a request under `/shots`, or null. `rest` is the path after `/api/v1/shots`. */
        answer(method, rest, query, body) {
            if (rest === '' && method === 'GET') return list(query);
            if (rest === '/latest' && method === 'GET') {
                const [newest] = [...shots].sort(newestFirst);
                return { status: 200, body: newest ? withoutMeasurements(newest) : null };
            }
            const match = /^\/([^/]+)$/.exec(rest);
            if (!match) return null;
            const id = decodeURIComponent(match[1]);
            if (method === 'GET') {
                const shot = shots.find(row => row.id === id);
                return shot ? { status: 200, body: copy(shot) } : { status: 404, body: { error: 'Shot not found' } };
            }
            if (method === 'PUT') return update(id, body);
            return null;
        },
    };
}
