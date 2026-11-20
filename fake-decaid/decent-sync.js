// Decent Sync's plugin, as a Skin reads it: its endpoints `status`,
// `reference`, `shots` and `shot`, its `changes` socket, and the `skin`
// answer and `changed` socket Streamline reads of every plugin. Behind them,
// as much of its server as those answers show: the Machine and its Location,
// the Location's Recipes and their Reference Shots, and the Location's Shots,
// whichever Machine pulled them.
//
// Read from loganfuller/decent-sync v1.11.1: plugin/src/skin-api.ts (every
// endpoint, each refusal's status and sentence, the edit's checks),
// plugin/src/reference-copies.ts (the tablet's copies, a Recipe in a slot
// only, and the push when one changes), plugin/src/skins.ts (`skin`),
// server/src/shots/location-shots.ts (the list's rows, its order and cursor,
// a Shot whole, `referenceOf`), server/src/shots/location-references.ts (a
// Reference Shot whole, which Shots may be chosen), server/src/shots/links.ts
// (`referenceProfileDiffers`), server/src/shots/extraction.ts (a Shot's
// duration past its Preheat, its target yield), protocol/src/index.ts
// (`shotRatingAndNote`, `isShotRating`, `isShotNote`); and docs/PLUGIN.md,
// "For a Skin's author"; plugin/src/loaded-recipes.ts (`observe`, `decide`,
// `sharing`, `saveSoon`), plugin/src/loaded-recipe-rules.ts (`loadable`),
// plugin/src/dye2.ts (`recordIntoRecipe`) and protocol/src/index.ts
// (`dye2GlobalIdOf`, `dye2Fingerprint`) for the save into the Loaded Recipe.
// Recorded: recordings/decent-sync.json (the state a served Machine starts
// from) and recordings/decent-sync-*.json; the save, in
// recordings/decent-sync-saves.json.
//
// - **status:** 200 `{ connected, served: true, machine, location }` when
//   served; any other state answers its refusal's HTTP status with `code` and
//   `message` beside the same fields: `captureOnly` (409, its Machine set; its
//   Location too when it is sharing turned off, none for `setState`, a Machine
//   at no Location), `hardwareMismatch` (409, no Machine), `serverTooOld` (503,
//   still connected), and `unreachable` (503, not connected, no Machine or
//   Location), which is also what a plugin not yet connected answers.
// - **Every other endpoint** refuses with the status's refusal while the
//   Machine is not served, but for the two the plugin answers without the
//   server: `reference` from the tablet's copy, and an edit of the tablet's
//   own Shot through Decaid.
// - **reference?recipe=<DYE2 record id>:** the record's `decentSyncId` is the
//   Recipe; a record with none, or no record, is `noSuchRecipe` (404).
//   `{ recipe, reference: { shot, recipe, referenceOf, rating, note,
//   profileDiffers } | null, source: 'server' }`. Unreachable or too old to
//   ask, a Recipe in a slot is answered from the copy with `source: 'tablet'`;
//   any other is refused so. A PUT `{ shotId }` chooses: a Shot the Location's
//   list lists, or one already a Reference Shot of its Recipes, else
//   `noSuchShot`; an Archived Recipe is `archived` (409). A tablet can't clear one.
// - **shots?limit=1..50&cursor=:** `{ shots, nextCursor }`, newest first by
//   pull time, then id; the cursor is the page's last Shot's pull time and id.
// - **shot?id=:** `{ shot, recipe, referenceOf }`, a Shot the list lists only,
//   else `noSuchShot`. A PUT `{ rating?, note? }` writes the tablet's own Shot
//   through Decaid's `PUT /shots/<id>` whatever the status, and any other
//   through the server, refused while it can't be asked. Answers
//   `{ rating, note }`.
// - **changes:** `{ what: 'connection', connected }` as the connection comes
//   and goes, and `{ what: 'reference', recipe }` whenever the tablet's copy of
//   a slotted Recipe's reference changes or comes: chosen, its Shot rated or
//   noted, its Recipe renamed, on a reconnection for a copy that changed
//   meanwhile, and for every copy when sharing is turned on again (sharing off
//   empties them with no push). The plugin may push one twice; the model
//   pushes it once.
// - **The save into the Loaded Recipe (ADR-0022):** the plugin hears every
//   Workflow change Decaid announces, the plugin's own load aside. One naming
//   another Recipe than the one loaded (by its DYE2 record's `decentSyncId`, a
//   global id) is a load, saving nothing; the plugin starts having decided on
//   the Workflow it finds. Any other change while a Recipe is loaded is saved
//   into it, but not one changing the profile (as DYE2 fingerprints one), on
//   a Capture-only Machine (sharing off, or the server's word: the plugin
//   keeps the last it heard while it can't be asked, so it saves on through
//   an outage), or while DYE2 is not loaded. One save waits for the next
//   flush, covering the changes after it of the same Recipe, load and
//   profile; then, if the Workflow still names that Recipe on that profile
//   and no load came meanwhile, the plugin asks DYE2's `record` (`POST`, `{}`),
//   which writes the record and pushes on DYE2's `changed`. Its ask is not in
//   the fake's request log, since it is no request of the page's.
//
// What the test makes happen (`events`): the connection lost and found
// (`stopServer`, `startServer`), sharing off and on (`setSharing`), any other
// state (`setState`), the plugin never connected yet (`firstStart`), a Reference
// Shot chosen or cleared on the server, a Recipe renamed there, a Shot rated
// or noted there; and, as faults rather than rules, a frame of the test's own
// on `changes` (`push`) and a Shot of the tablet's counted at the Location
// without a pour (`atLocation`).
//
// Not kept: the server's own matching of a Shot's Profile (title, steps,
// temperatures and weight; the model matches the title alone, which tells the
// sample Profiles apart); a Shot's `unfinished`, which the server works out
// from its samples, recorded for the recorded Shots and false for one stored
// during a test; a rename reaching DYE2's record (the plugin writes it a poll
// later); the Library's sync (the records it leaves are recorded); a slot
// changed; Shots of another Location chosen as a Reference Shot; what the
// server does with a Shot stored while it refuses the Machine (the model
// lists it nowhere). Of the save into the Loaded Recipe: the saved dial-in
// reaching the server and its Recipes (the page reads the dial-in from DYE2's
// records); the plugin's own writes into the Workflow, a load's included;
// the rule for steam turned back on, which writes the Recipe's steam settings
// first (the model's machine has no steam); the Workflow's changes held back
// from the server while a save is under way; DYE2 seen as away only after two
// polls not loaded (the model: at once); the seconds DYE2 may take to read the
// machine's settings before it writes (the model saves at the next flush).
// Nor, seen in the recording and not modelled yet: the server unloading the
// Machine's Loaded Recipe as its sharing is turned off, which the plugin makes
// by clearing the Workflow's recipe (a DYE2 push follows).

import { copy, isObject } from './workflow.js';
import { localTime } from './machine.js';
import { profileFingerprint, recipeIdOf } from './dye2.js';

export const DECENT_SYNC_ID = 'decent-sync.reaplugin';
const DYE2_NAMESPACE = 'dye2.reaplugin';
const MAX_SHOTS_PAGE = 50;
const MAX_SHOT_RATING = 10;
const MAX_SKIN_NOTE_LENGTH = 40_000;
const MAX_ASKED_LENGTH = 2048;

export const REFUSALS = {
    unreachable: { status: 503, message: "The Decent Sync server can't be reached from this tablet right now." },
    serverTooOld: { status: 503, message: 'The Decent Sync server this tablet is connected to is a release too old to ask. It can be asked once it is upgraded.' },
    captureOnly: { status: 409, message: 'This Machine is a Capture-only Machine: it is at no Location, or its sharing is off, so it takes no part in the Library.' },
    hardwareMismatch: { status: 409, message: 'The machine connected to this tablet is not the one this tablet\'s token was issued for, so the server serves it nothing until an Admin settles which Machine it is.' },
    noSuchShot: { status: 404, message: "No Shot at this Machine's Location has that id." },
    noSuchRecipe: { status: 404, message: 'No DYE2 recipe on this tablet with that id is a Recipe of this Machine\'s Location.' },
    notAtThisLocation: { status: 403, message: "That Recipe belongs to another Location than this Machine's, so its Reference Shot can't be chosen on this tablet." },
    archived: { status: 409, message: 'That Recipe is Archived. Its Reference Shot can be chosen once it is restored.' },
    recipesUnread: { status: 500, message: "DYE2's recipes can't be read on this tablet right now." },
    shotUnwritten: { status: 500, message: "Decaid didn't take the edit of this tablet's own Shot." },
    invalidRequest: { status: 400, message: 'The request is not one this endpoint answers.' },
};
/** The states a Machine may be in other than served, and whether the plugin is connected in each. */
const NOT_SERVED = { captureOnly: true, hardwareMismatch: true, serverTooOld: true, unreachable: false };

const refusal = (code, body = {}, message = REFUSALS[code].message) => ({ status: REFUSALS[code].status, body: { ...body, code, message } });
const invalid = message => refusal('invalidRequest', {}, message);
const json = body => ({ status: 200, body });
const methodNotAllowed = (...allowed) => ({ status: 405, body: { error: `Only ${allowed.join(' and ')} ${allowed.length === 1 ? 'is' : 'are'} answered` } });
const GLOBAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const askable = value => typeof value === 'string' && value.length <= MAX_ASKED_LENGTH;
const recordedText = value => (typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' && value.trim() !== '' ? value : null);
const numberOf = value => (typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null);
const textOf = value => (typeof value === 'string' ? value : null);

/** `shotRatingAndNote` (protocol): a Shot's rating and note as an edit answers them. */
export function ratingAndNote(record) {
    const annotations = isObject(record?.annotations) ? record.annotations : {};
    const { enjoyment, espressoNotes } = annotations;
    return {
        rating: typeof enjoyment === 'number' && Number.isFinite(enjoyment) ? enjoyment : null,
        note: typeof espressoNotes === 'string' && espressoNotes.trim() !== '' ? espressoNotes : null,
    };
}

/** `readEdit` (skin-api.ts): the fields an edit sets, or what is wrong with it. */
export function readEdit(body) {
    const NOTHING_TO_SET = "Give the Shot's rating, its note or both in a JSON body.";
    if (!isObject(body)) return NOTHING_TO_SET;
    const { rating, note, ...others } = body;
    const other = Object.keys(others)[0];
    if (other !== undefined) return `Only a Shot's rating and note can be set: ${JSON.stringify(other.slice(0, 40))} is neither.`;
    if (rating !== undefined && !(typeof rating === 'number' && rating >= 0 && rating <= MAX_SHOT_RATING)) return `Give rating as a number from 0 to ${MAX_SHOT_RATING}, where 0 is unrated.`;
    if (note !== undefined && !(typeof note === 'string' && !note.includes('\u0000') && note.isWellFormed() && note.length <= MAX_SKIN_NOTE_LENGTH)) {
        return `Give note as text of at most ${MAX_SKIN_NOTE_LENGTH} characters, where empty is none, without a NUL or an unpaired surrogate.`;
    }
    if (rating === undefined && note === undefined) return NOTHING_TO_SET;
    return { ...(rating !== undefined && { rating }), ...(note !== undefined && { note }) };
}

/** A time Decaid wrote local to `timeZone` with no offset (or UTC with a Z), as epoch milliseconds. */
export function instantOf(text, timeZone) {
    if (typeof text !== 'string') return null;
    if (/[zZ]$/.test(text)) return Date.parse(text);
    const asUtc = Date.parse(`${text.slice(0, 23)}Z`);
    if (Number.isNaN(asUtc)) return null;
    // The zone's offset at that moment, found from what it writes for a guess and corrected once.
    const offsetAt = ms => Date.parse(`${localTime(ms, timeZone).slice(0, 23)}Z`) - ms;
    const guess = asUtc - offsetAt(asUtc);
    return asUtc - offsetAt(guess);
}

/** `extractCurves` (extraction.ts): seconds from the first sample past the Preheat to the last, to the millisecond; null with no samples. */
export function shownDuration(record, timeZone) {
    const samples = Array.isArray(record?.measurements) ? record.measurements : [];
    const times = [];
    let preheatTimes = 0;
    let preheat = true;
    for (const sample of samples) {
        const machine = isObject(sample?.machine) ? sample.machine : {};
        if (preheat && machine.state?.substate !== 'preparingForShot') preheat = false;
        const at = instantOf(machine.timestamp, timeZone);
        if (at !== null && !Number.isNaN(at)) {
            times.push(at);
            if (preheat) preheatTimes += 1;
        }
    }
    if (!times.length) return null;
    const after = times.slice(preheatTimes);
    if (!after.length) return 0;
    return Math.round(Math.max(...after) - Math.min(...after)) / 1000;
}

/** `targetYield` (extraction.ts): the Workflow's yield above 0, or else the profile's target weight above 0. */
function targetYield(workflowYield, profileWeight) {
    const above = value => (value !== null && value > 0 ? value : null);
    const held = numberOf(workflowYield);
    return held !== null ? above(held) : above(numberOf(profileWeight));
}

const base64url = text => btoa(unescape(encodeURIComponent(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64url = text => decodeURIComponent(escape(atob(text.replace(/-/g, '+').replace(/_/g, '/'))));
const RECORD_ID = /^[A-Za-z0-9._:-]{1,200}$/;
/** A cursor the list gave, or null for text that is none (`readCursor`). */
function readCursor(text) {
    let value;
    try { value = JSON.parse(fromBase64url(text)); } catch { return null; }
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [pulledAt, id] = value;
    if (!Number.isInteger(pulledAt) || typeof id !== 'string' || !RECORD_ID.test(id)) return null;
    return [pulledAt, id];
}

/**
 * @param {{
 *   recording: object,
 *   decaid: { store: object, shots: object, timeZone: string, putShot: (id: string, body: object) => { status: number, body: any } },
 *   announce: (frame: object) => void,
 *   moved?: (record: object) => object,
 * }} options
 *   `recording` is recordings/decent-sync.json; `moved` moves a recorded Shot
 *   of another Machine in time as the fake moves its own.
 */
export function createDecentSync({ recording, decaid, announce, moved = record => record }) {
    const server = recording.server;
    const timeZone = decaid.timeZone;
    let state = 'served';
    let sharing = true;
    /** Whether the server last told the plugin its Machine is Capture-only: kept while it is out of reach or the Machine is mismatched (`setCaptureOnly`). */
    let captureOnly = false;
    const machine = copy(server.machine);
    const location = copy(server.location);
    const recipes = new Map(server.recipes.map(recipe => [recipe.id, copy(recipe)]));
    const profiles = copy(server.profiles);
    /** The tablet's own Shots at the Location, by id, and what the server worked out of each. */
    const own = new Map(Object.entries(server.own || {}).map(([id, values]) => [id, copy(values)]));
    /** Other Machines' Shots at the Location: the record whole as the server holds it, its Machine and Recipe. */
    const others = new Map((server.others || []).map(other => [other.shot.id, { ...copy(other), shot: moved(copy(other.shot)) }]));
    /** The tablet's copies, for each Recipe in a slot: the reference as last pushed, by Recipe id. */
    const copies = new Map();
    /** The tablet's Shots stored while the server was out of reach, which the plugin reports once it is back. */
    const unreported = new Set();

    const records = () => {
        const list = decaid.store.get(DYE2_NAMESPACE, 'recipes');
        return Array.isArray(list) ? list : null;
    };
    const recordIdOf = recipeId => (records() || []).find(row => row?.decentSyncId === recipeId)?.id ?? null;
    const skinRecipe = recipe => ({ id: recipe.id, name: recipe.name, recordId: recordIdOf(recipe.id) });

    // ── The save into the Loaded Recipe (`LoadedRecipes`).
    /** The Recipe the Workflow names, by the global id its DYE2 record carries (`loadable`, `dye2GlobalIdOf`), or null. */
    const loadedIn = workflow => {
        const recordId = recipeIdOf(workflow);
        const globalId = recordId && (records() || []).find(row => row && row.id === recordId)?.decentSyncId;
        return typeof globalId === 'string' && GLOBAL_ID.test(globalId) ? globalId.toLowerCase() : null;
    };
    /** `sharing()`: the plugin writes into the Workflow and saves into its recipes. */
    const saving = () => !captureOnly && decaid.dye2Loaded();
    let loadedRecipe = null;
    let loads = 0;
    let queuedSave = null;
    /** The plugin has decided on the Workflow as it stands: its Recipe loaded, nothing waiting. */
    const decided = () => {
        loadedRecipe = loadedIn(decaid.workflow());
        queuedSave = null;
    };
    decided();
    const servedNow = () => state === 'served' && sharing;
    const connected = () => state !== 'unreachable';
    const notServed = () => (state === 'served' ? (sharing ? null : 'captureOnly') : state);

    const ownRecord = id => (own.has(id) ? decaid.shots.get(id) : null);
    const wholeOf = id => ownRecord(id) || others.get(id)?.shot || null;
    const listed = id => own.has(id) && !!decaid.shots.get(id) || others.has(id);

    // A Shot's Recipe: the one its Workflow named, through the record that names it on its tablet.
    const recipeOfShot = id => {
        if (others.has(id)) return others.get(id).recipeId ? recipes.get(others.get(id).recipeId) || null : null;
        const recordId = ownRecord(id)?.workflow?.context?.extras?.dye?.recipeId;
        const recipeId = (records() || []).find(row => row?.id === recordId)?.decentSyncId;
        return recipeId ? recipes.get(recipeId) || null : null;
    };
    const shotProfileId = record => profiles.find(profile => profile.title === record?.workflow?.profile?.title)?.id ?? null;
    // The Recipes each Shot is the Reference Shot of: not Archived, by name ignoring case, then id.
    const referenceOf = id => [...recipes.values()]
        .filter(recipe => recipe.referenceShotId === id && !recipe.archived)
        .sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : a.id < b.id ? -1 : 1))
        .map(skinRecipe);

    function row(id) {
        const record = wholeOf(id);
        const context = record.workflow?.context || {};
        const annotations = isObject(record.annotations) ? record.annotations : {};
        const recipe = recipeOfShot(id);
        const other = others.get(id);
        return {
            id,
            pulledAt: new Date(instantOf(record.timestamp, other ? 'UTC' : timeZone)).toISOString(),
            machine: other ? copy(other.machine) : { id: machine.id, name: machine.name },
            onThisTablet: !other,
            recipe: recipe ? skinRecipe(recipe) : null,
            bean: { roaster: textOf(context.coffeeRoaster), name: textOf(context.coffeeName) },
            dose: numberOf(annotations.actualDoseWeight),
            targetDose: numberOf(context.targetDoseWeight),
            yield: numberOf(annotations.actualYield),
            targetYield: targetYield(context.targetYield, record.workflow?.profile?.target_weight),
            duration: shownDuration(record, other ? 'UTC' : timeZone),
            rating: numberOf(annotations.enjoyment),
            barista: textOf(context.baristaName),
            hasNote: recordedText(annotations.espressoNotes) !== null,
            unfinished: (other || own.get(id))?.unfinished === true,
            referenceOf: referenceOf(id),
        };
    }

    function referenceAnswer(recipe) {
        const id = recipe.referenceShotId;
        const record = id ? wholeOf(id) : null;
        if (!record) return { recipe: skinRecipe(recipe), reference: null };
        const pulledWith = recipeOfShot(id);
        const { note } = ratingAndNote(record);
        const named = recipe.profileId;
        return {
            recipe: skinRecipe(recipe),
            reference: {
                shot: copy(record),
                recipe: pulledWith ? skinRecipe(pulledWith) : null,
                referenceOf: referenceOf(id),
                rating: numberOf(record.annotations?.enjoyment),
                note,
                profileDiffers: typeof named === 'string' && shotProfileId(record) !== named,
            },
        };
    }

    // The copies follow the server while it serves the Machine: one that
    // changed or came new is kept, and its Recipe pushed (`keep` in
    // reference-copies.ts). A Machine not served has no slots, so it gets
    // none; what changed meanwhile comes once it is served again. The fake
    // starts with them held, as a plugin connected before.
    function refreshCopies({ quiet = false } = {}) {
        if (!servedNow()) return;
        for (const recipe of recipes.values()) {
            if (!recipe.slot) { copies.delete(recipe.id); continue; }
            const now = JSON.stringify(referenceAnswer(recipe));
            if (copies.get(recipe.id) === now) continue;
            copies.set(recipe.id, now);
            if (!quiet) announce({ what: 'reference', recipe: skinRecipe(recipe) });
        }
    }
    refreshCopies({ quiet: true });

    const statusBody = () => ({
        connected: connected(),
        served: servedNow(),
        machine: state === 'unreachable' || state === 'hardwareMismatch' || state === 'serverTooOld' ? null : { id: machine.id, name: machine.name },
        // Sharing off, the Machine is still at its Location, and the server names it.
        location: state === 'served' ? { id: location.id, name: location.name } : null,
    });
    const refused = () => {
        const code = notServed();
        return code ? refusal(code) : null;
    };

    function status(method) {
        if (method !== 'GET') return methodNotAllowed('GET');
        const code = notServed();
        return code ? refusal(code, statusBody()) : json(statusBody());
    }

    function shots(method, query) {
        if (method !== 'GET') return methodNotAllowed('GET');
        const limit = query.get('limit');
        const cursor = query.get('cursor');
        if (limit !== null && !(/^\d{1,3}$/.test(limit) && Number(limit) >= 1 && Number(limit) <= MAX_SHOTS_PAGE)) return invalid(`Give limit as a whole number from 1 to ${MAX_SHOTS_PAGE}.`);
        const badCursor = invalid('Give cursor as the nextCursor of the page before, or leave it out for the first page.');
        if (cursor !== null && !askable(cursor)) return badCursor;
        const not = refused();
        if (not) return not;
        const after = cursor === null ? undefined : readCursor(cursor);
        if (after === null) return badCursor;
        const size = limit === null ? MAX_SHOTS_PAGE : Number(limit);
        const rows = [...own.keys(), ...others.keys()].filter(listed).map(row)
            .sort((a, b) => (a.pulledAt < b.pulledAt ? 1 : a.pulledAt > b.pulledAt ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
            .filter(r => !after || Date.parse(r.pulledAt) < after[0] || (Date.parse(r.pulledAt) === after[0] && r.id > after[1]));
        const page = rows.slice(0, size);
        const last = page.at(-1);
        return json({ shots: page, nextCursor: rows.length > size && last ? base64url(JSON.stringify([Date.parse(last.pulledAt), last.id])) : null });
    }

    function shot(method, query, body) {
        if (method === 'PUT') return editShot(query, body);
        if (method !== 'GET') return methodNotAllowed('GET', 'PUT');
        const id = query.get('id');
        if (!askable(id) || id === '') return invalid("Give the Shot's id as id.");
        const not = refused();
        if (not) return not;
        if (!listed(id)) return refusal('noSuchShot');
        const recipe = recipeOfShot(id);
        return json({ shot: copy(wholeOf(id)), recipe: recipe ? skinRecipe(recipe) : null, referenceOf: referenceOf(id) });
    }

    function editShot(query, body) {
        const id = query.get('id');
        if (!askable(id) || id === '') return invalid("Give the Shot's id as id.");
        const fields = readEdit(body);
        if (typeof fields === 'string') return invalid(fields);
        const annotations = { ...(fields.rating !== undefined && { enjoyment: fields.rating }), ...(fields.note !== undefined && { espressoNotes: fields.note }) };
        // The tablet's own Shot: through Decaid, whatever the server.
        const held = decaid.putShot(id, { annotations });
        if (held.status !== 404) {
            if (held.status >= 400) return refusal('shotUnwritten', {}, `Decaid refused the edit of this tablet's own Shot (${held.status}).`);
            if (servedNow()) refreshCopies();
            return json(ratingAndNote(held.body));
        }
        const not = refused();
        if (not) return not;
        const other = others.get(id);
        if (!other) return refusal('noSuchShot');
        other.shot.annotations = { ...(other.shot.annotations || {}), ...annotations };
        refreshCopies();
        return json(ratingAndNote(other.shot));
    }

    function reference(method, query, body) {
        if (method !== 'GET' && method !== 'PUT') return methodNotAllowed('GET', 'PUT');
        const recordId = query.get('recipe');
        if (!askable(recordId) || recordId === '') return invalid("Give the id of the Recipe's DYE2 record on this tablet as recipe.");
        let shotId;
        if (method === 'PUT') {
            shotId = isObject(body) ? body.shotId : undefined;
            if (!askable(shotId) || shotId === '') return invalid("Give the Shot's id as shotId in a JSON body. A tablet can't clear a Reference Shot.");
        }
        const list = records();
        if (list === null) return refusal('recipesUnread');
        const recipeId = list.find(row => row?.id === recordId)?.decentSyncId;
        if (typeof recipeId !== 'string' || recipeId === '') return refusal('noSuchRecipe');
        const recipe = recipes.get(recipeId);
        if (method === 'GET') {
            const not = refused();
            if (!not) return recipe ? json({ ...referenceAnswer(recipe), source: 'server' }) : refusal('noSuchRecipe');
            // Only while the server can't be asked (out of reach, or too old to ask) does the copy answer.
            if (notServed() !== 'unreachable' && notServed() !== 'serverTooOld') return not;
            const held = copies.get(recipeId);
            return held ? json({ ...JSON.parse(held), source: 'tablet' }) : not;
        }
        const not = refused();
        if (not) return not;
        if (!recipe) return refusal('noSuchRecipe');
        if (recipe.archived) return refusal('archived');
        const readable = listed(shotId) || [...recipes.values()].some(r => r.referenceShotId === shotId && wholeOf(shotId));
        if (!readable) return refusal('noSuchShot', {}, 'No Shot this tablet may read whole has that id.');
        recipe.referenceShotId = shotId;
        refreshCopies();
        return json({ ...referenceAnswer(recipe), source: 'server' });
    }

    const recipeOfRecord = recordId => {
        const recipeId = (records() || []).find(row => row?.id === recordId)?.decentSyncId;
        const recipe = recipeId && recipes.get(recipeId);
        if (!recipe) throw new Error(`no Recipe of the Location has DYE2 record ${recordId}`);
        return recipe;
    };

    return {
        /** Decaid announced a Workflow change, from `previous` to `workflow` (`observe`, `decide`). */
        workflowChanged(previous, workflow) {
            const globalId = loadedIn(workflow);
            if (globalId !== loadedRecipe) {
                loadedRecipe = globalId;
                loads++;
                return;
            }
            if (globalId === null || !saving()) return;
            const fingerprint = profileFingerprint(workflow.profile);
            if (profileFingerprint(previous && previous.profile) !== fingerprint) return;
            const save = { globalId, load: loads, fingerprint };
            if (queuedSave && queuedSave.globalId === save.globalId && queuedSave.load === save.load && queuedSave.fingerprint === save.fingerprint) return;
            queuedSave = save;
        },
        /** The save waiting, made at the flush (`saveSoon`): DYE2's `record`, where the Workflow still names its Recipe on its profile. */
        settle() {
            const save = queuedSave;
            queuedSave = null;
            if (!save || loadedRecipe !== save.globalId || loads !== save.load || !saving()) return;
            const workflow = decaid.workflow();
            if (loadedIn(workflow) !== save.globalId || profileFingerprint(workflow.profile) !== save.fingerprint) return;
            // `recordIntoRecipe`: what DYE2 answers is reported to the server, which the model leaves out.
            decaid.record();
        },
        decided,
        /** Answers a request to one of the plugin's endpoints, or null for none it has. */
        answer(method, endpoint, query, body) {
            switch (endpoint) {
                case 'status': return status(method);
                case 'shots': return shots(method, query);
                case 'shot': return shot(method, query, body);
                case 'reference': return reference(method, query, body);
                case 'skin': return method === 'GET' ? json(copy(recording.skin)) : null;
                default: return null;
            }
        },
        /**
         * A Shot the tablet stored: it joins the Location's Shots while the
         * Machine is served at it; stored while the server is out of reach,
         * once the plugin reports it, as the connection comes back. In any
         * other state (a Machine at no Location, or one the server refuses)
         * it joins no Location's.
         */
        shotStored(id) {
            if (own.has(id)) return;
            if (state === 'unreachable') unreported.add(id);
            else if (servedNow()) own.set(id, { unfinished: false });
        },
        /** A Shot of the tablet's own changed in Decaid: the copies follow. */
        ownShotChanged() {
            if (servedNow()) refreshCopies();
        },
        events: {
            /** The server stopped: the connection goes. */
            stopServer() {
                if (state === 'unreachable') return;
                state = 'unreachable';
                announce({ what: 'connection', connected: false });
            },
            /** The server back: the connection comes, and the copies that changed meanwhile are sent. */
            startServer() {
                if (state !== 'unreachable') return;
                state = 'served';
                captureOnly = !sharing;
                // Reported now, to a server that lists them only if the Machine shares.
                if (sharing) for (const id of unreported) if (!own.has(id)) own.set(id, { unfinished: false });
                unreported.clear();
                announce({ what: 'connection', connected: true });
                refreshCopies();
            },
            /**
             * The Machine's sharing turned off or on, on the server. Off, the
             * server sends each slot empty, which the plugin keeps with no push;
             * on again, every copy comes, and is pushed.
             */
            setSharing(on) {
                sharing = !!on;
                // The server tells every connection but a mismatched one (a server too old
                // to answer the plugin's asks included); one out of reach hears it once
                // connected.
                if (state !== 'unreachable' && state !== 'hardwareMismatch') captureOnly = state === 'captureOnly' || !sharing;
                if (!sharing) copies.clear();
                if (servedNow()) refreshCopies();
            },
            /**
             * Any state: 'served', or a refusal code (`captureOnly`,
             * `hardwareMismatch`, `serverTooOld`, `unreachable`), with no
             * push: for a state the page finds as it opens. 'unreachable' keeps
             * the copies, as a plugin connected before does.
             */
            setState(next) {
                if (next !== 'served' && !Object.hasOwn(NOT_SERVED, next)) throw new Error(`no such state: ${next}`);
                state = next;
                if (state === 'captureOnly') captureOnly = true;
                else if (state === 'served') captureOnly = !sharing;
                // A Capture-only Machine has no slots, so no copies, as sharing off leaves it.
                if (state === 'captureOnly') copies.clear();
                if (servedNow()) refreshCopies();
            },
            /**
             * The plugin installed and never connected, as on a tablet whose
             * Decaid has just started it for the first time: not connected,
             * holding no copy. `startServer()` connects it, and each copy then
             * comes and is pushed.
             */
            firstStart() {
                state = 'unreachable';
                captureOnly = false;
                copies.clear();
            },
            /** A Recipe's Reference Shot chosen on the server, or cleared with null, by its DYE2 record's id. */
            chooseReference(recordId, shotId) {
                const recipe = recipeOfRecord(recordId);
                if (shotId !== null && !wholeOf(shotId)) throw new Error(`the server holds no Shot ${shotId}`);
                recipe.referenceShotId = shotId;
                refreshCopies();
            },
            /**
             * A frame on `changes` that no event of the model sends: a push the
             * plugin repeats, or a `what` a later release may add. A fault the
             * test makes, as `fake.refuse` is, not a rule.
             */
            push(frame) {
                announce(frame);
            },
            /**
             * The tablet's own Shot, already in Decaid, counted at the
             * Location, as one pulled while the Machine was there: for a test
             * that needs more of the Location's Shots than a pour each makes cheap.
             */
            atLocation(shotId) {
                if (!decaid.shots.get(shotId)) throw new Error(`Decaid holds no Shot ${shotId}`);
                if (!own.has(shotId)) own.set(shotId, { unfinished: false });
            },
            /** A Recipe renamed on the server, by its DYE2 record's id. */
            renameRecipe(recordId, name) {
                recipeOfRecord(recordId).name = name;
                refreshCopies();
            },
            /**
             * A Shot's rating or note edited on the server: the tablet's own
             * is written into Decaid as the plugin writes it, only the fields given.
             */
            editShot(shotId, { rating, note }) {
                const annotations = { ...(rating !== undefined && { enjoyment: rating }), ...(note !== undefined && { espressoNotes: note }) };
                if (own.has(shotId)) decaid.putShot(shotId, { annotations });
                else if (others.has(shotId)) others.get(shotId).shot.annotations = { ...(others.get(shotId).shot.annotations || {}), ...annotations };
                else throw new Error(`the server holds no Shot ${shotId}`);
                refreshCopies();
            },
        },
        /** What the test reads: the Location's Recipes, by their DYE2 record's id, with their Reference Shot. */
        recipe: recordId => copy(recipeOfRecord(recordId)),
        state: () => ({ state, sharing }),
        others: () => [...others.values()].map(other => copy(other)),
        own: () => [...own.keys()],
        machine: () => copy(machine),
        location: () => copy(location),
    };
}
