// The fake Decaid: a plain model of what Decaid, DYE2 and the simulated machine
// hold, which answers a request as the real ones would. It keeps no timers and
// uses no Node API, so a page can load it as well as a test (docs/cafe/TESTING.md).
//
//   const fake = createFakeDecaid({ sampleData, boot, pour, now });
//   fake.request({ method, url, body })   → { status, body } | { abort: true } | null (no answer)
//   fake.connect(path, send)              → { close } | null (no such socket)
//   fake.flush()                          sends what the sockets have waiting
//
// Each rule names the source it was read from, in the file that keeps it, and
// is backed by a recording in recordings/ that `npm test` replays against it.
//
// Kept here: Decaid's plugin list, and a plugin that is not loaded answering
// 404 on its routes (Decaid v0.9.2, `plugins_handler.dart`); DYE2 disabled and
// enabled through it. Recorded: recordings/dye2-plugin.json.
//
// Decent Sync's plugin (decent-sync.js) is there only when the fake is made
// with `decentSync` (recordings/decent-sync.json): listed and loaded, DYE2's
// records and baskets as its Library's sync left them, and the tablet's Shots
// pulled at the Location after the sample data's added to Decaid's. It hears
// every Workflow set, as DYE2 does, and a save into the Loaded Recipe it
// decides on is made at the next `flush`, before what the sockets have waiting
// is sent.

import { copy, updateWorkflow } from './workflow.js';
import { createStore } from './store.js';
import { createDye2, DYE2_ID } from './dye2.js';
import { createShots } from './shots.js';
import { createLibrary } from './library.js';
import { createMachine, calibration, localTime, shiftTime } from './machine.js';
import { createBoot } from './boot.js';
import { createDecentSync, DECENT_SYNC_ID } from './decent-sync.js';

export { localTime };

const API = '/api/v1';
const OWNED_REST = [
    /^\/api\/v1\/workflow$/,
    /^\/api\/v1\/store\//,
    /^\/api\/v1\/plugins$/,
    /^\/api\/v1\/plugins\/dye2\.reaplugin\//,
    /^\/api\/v1\/plugins\/decent-sync\.reaplugin\//,
    /^\/api\/v1\/grinders(\/|$)/,
    /^\/api\/v1\/bean-batches\//,
    /^\/api\/v1\/beans(\/|$)/,
    /^\/api\/v1\/shots(\/|$)/,
    /^\/api\/v1\/machine\/state(\/|$)/,
    /^\/api\/v1\/machine\/calibration\//,
];
const OWNED_SOCKETS = [
    '/ws/v1/machine/snapshot',
    '/ws/v1/machine/shotState',
    '/ws/v1/scale/snapshot',
    '/ws/v1/plugins/dye2.reaplugin/changed',
    '/ws/v1/plugins/decent-sync.reaplugin/changes',
    '/ws/v1/plugins/decent-sync.reaplugin/changed',
];

/** Whether the model answers this request or socket from its own state, rather than from the recorded boot. */
export function OWNED(method, path) {
    if (method === 'WS') return OWNED_SOCKETS.includes(path);
    return OWNED_REST.some(pattern => pattern.test(path));
}

/**
 * Moves a recorded Shot back in time as the sample data's are moved, keeping
 * their spacing, so the newest sample Shot was pulled an hour before `now`,
 * whenever they were recorded. Their times were written in UTC, the
 * recorder's zone; a Shot moved is written in `timeZone`.
 */
function mover(shots, now, timeZone) {
    if (!shots.length) return shot => shot;
    const ms = text => Date.parse(/[zZ]$/.test(text) ? text : `${text.slice(0, 23)}Z`);
    const shift = now - 3_600_000 - Math.max(...shots.map(shot => ms(shot.timestamp)));
    const moved = text => shiftTime(text, shift, timeZone);
    return shot => ({
        ...shot,
        timestamp: moved(shot.timestamp),
        createdAt: moved(shot.createdAt),
        updatedAt: moved(shot.updatedAt),
        measurements: (shot.measurements || []).map(m => ({
            ...m,
            machine: m.machine ? { ...m.machine, timestamp: moved(m.machine.timestamp) } : m.machine,
            scale: m.scale ? { ...m.scale, timestamp: moved(m.scale.timestamp) } : m.scale,
        })),
    });
}

/**
 * @param {{ sampleData: object, boot: object, pour: object, decentSync?: object, now?: number, timeZone?: string }} recordings
 *   `now` is the page's time when the test starts, in epoch milliseconds; `timeZone` Decaid's.
 *   `decentSync` (recordings/decent-sync.json) installs Decent Sync's plugin, serving the Machine.
 */
export function createFakeDecaid({ sampleData, boot, pour, decentSync = null, now = Date.parse('2026-11-18T14:00:00Z'), timeZone = 'UTC' }) {
    let clock = now;
    let ids = 0;
    const nextId = () => `00000000-0000-4000-8000-${(++ids).toString(16).padStart(12, '0')}`;
    const utcNow = () => new Date(clock).toISOString();

    // ── Sockets: frames wait in an outbox until `flush`, so a push reaches the
    //    page after the answer to the request that caused it, as on Decaid.
    const sockets = new Map();
    const outbox = [];
    const emit = (path, frame) => {
        for (const send of sockets.get(path) || []) outbox.push([send, JSON.stringify(frame)]);
    };

    const log = [];
    const refusals = [];
    let workflow = copy(sampleData.workflow);
    const plugins = copy(sampleData.plugins);
    const store = createStore(sampleData.store);
    const moved = mover(sampleData.shots, clock, timeZone);
    // The Location's Shots of another Machine were written in its zone, UTC on the recorded stack.
    const movedOther = mover(sampleData.shots, clock, 'UTC');
    const shots = createShots([...sampleData.shots, ...(decentSync?.shots || [])].map(moved), utcNow);
    if (decentSync) {
        plugins.push(copy(decentSync.plugin));
        for (const [key, value] of Object.entries(decentSync.store[DYE2_ID] || {})) store.set(DYE2_ID, key, value);
    }
    const library = createLibrary(sampleData);
    const cannedBoot = createBoot(boot);
    const dye2Loaded = () => plugins.some(p => p.id === DYE2_ID && p.loaded);
    const loaded = id => plugins.some(p => p.id === id && p.loaded);

    // Set below, once DYE2 is there: the plugin hears every Workflow set from then.
    let decentSyncPlugin = null;
    // Every Workflow set reaches DYE2's `workflowUpdated`, a set of its own
    // included, and Decent Sync's plugin's.
    function setWorkflow(body) {
        const { answer, workflow: next } = updateWorkflow(workflow, body);
        if (next) {
            const previous = workflow;
            workflow = next;
            if (decentSyncPlugin && loaded(DECENT_SYNC_ID)) decentSyncPlugin.workflowChanged(copy(previous), copy(workflow));
            if (dye2Loaded()) {
                const own = dye2.workflowChanged(copy(workflow));
                if (own) setWorkflow(own);
            }
        }
        return answer;
    }

    const dye2 = createDye2({
        decaid: {
            store,
            workflow: () => copy(workflow),
            putWorkflow: body => setWorkflow(body),
            newestShots: count => shots.newest(count),
            machineSettings: () => cannedBoot.body('GET', '/api/v1/machine/settings'),
            now: () => clock,
        },
        announce: payload => emit(`/ws/v1/plugins/${DYE2_ID}/changed`, payload),
    });
    // DYE2 as it loads: it reads the Workflow and mirrors the selection, pushing
    // to no one, and makes the write of its own it answers, as it does live.
    const dye2Loads = () => {
        const own = dye2.workflowChanged(copy(workflow), true);
        if (own) setWorkflow(own);
    };
    if (dye2Loaded()) dye2Loads();

    // Decaid's own Shot update, as the page and Decent Sync's plugin both make it.
    const putShot = (id, body) => {
        const answer = shots.answer('PUT', `/${encodeURIComponent(id)}`, new URLSearchParams(), body);
        if (answer?.status === 200) decentSyncPlugin?.ownShotChanged();
        return answer;
    };
    decentSyncPlugin = decentSync && createDecentSync({
        recording: decentSync,
        decaid: {
            store, shots, timeZone, putShot,
            workflow: () => copy(workflow),
            dye2Loaded,
            // DYE2's `record`, as the plugin asks it: not in the request log.
            record: () => answer('POST', `${API}/plugins/${DYE2_ID}/record`, new URLSearchParams(), {}),
        },
        announce: frame => { if (loaded(DECENT_SYNC_ID)) emit(`/ws/v1/plugins/${DECENT_SYNC_ID}/changes`, frame); },
        moved: movedOther,
    });

    const machine = createMachine({
        pour, timeZone, emit, nextId,
        now: () => clock,
        workflow: () => copy(workflow),
        store: shot => {
            shots.add(shot);
            if (dye2Loaded()) dye2.shotStored();
            decentSyncPlugin?.shotStored(shot.id);
        },
    });

    function answer(method, path, query, body) {
        if (path === `${API}/workflow`) {
            if (method === 'GET') return { status: 200, body: copy(workflow) };
            if (method === 'PUT') return setWorkflow(body);
            return null;
        }
        if (path.startsWith(`${API}/store/`)) return store.answer(method, path.slice(`${API}/store/`.length), query, body);
        if (path === `${API}/plugins` && method === 'GET') return { status: 200, body: copy(plugins) };
        if (path.startsWith(`${API}/plugins/${DYE2_ID}/`)) {
            if (!dye2Loaded()) return { status: 404, body: { error: `plugin with ${DYE2_ID} not loaded` } };
            return dye2.answer(method, path.slice(`${API}/plugins/${DYE2_ID}/`.length), body);
        }
        if (path.startsWith(`${API}/plugins/${DECENT_SYNC_ID}/`)) {
            if (!loaded(DECENT_SYNC_ID) || !decentSyncPlugin) return { status: 404, body: { error: `plugin with ${DECENT_SYNC_ID} not loaded` } };
            return decentSyncPlugin.answer(method, path.slice(`${API}/plugins/${DECENT_SYNC_ID}/`.length), query, body);
        }
        if (/^\/api\/v1\/(grinders|beans|bean-batches)(\/|$)/.test(path)) return library.answer(method, path.slice(API.length), query);
        if (/^\/api\/v1\/shots\/[^/]+$/.test(path) && method === 'PUT') return putShot(decodeURIComponent(path.slice(`${API}/shots/`.length)), body);
        if (/^\/api\/v1\/shots(\/|$)/.test(path)) return shots.answer(method, path.slice(`${API}/shots`.length), query, body);
        if (path === `${API}/machine/state` && method === 'GET') return { status: 200, body: machine.snapshot() };
        const calibrated = /^\/api\/v1\/machine\/calibration\/([^/]+)$/.exec(path);
        if (calibrated && method === 'GET') return calibration(decodeURIComponent(calibrated[1]), query.get('source') ?? 'current');
        // Only the states a recording or the page's tests ask for; any other
        // is left unanswered, so a test asking for it fails naming it.
        const state = /^\/api\/v1\/machine\/state\/(espresso|idle|sleeping)$/.exec(path);
        if (state && method === 'PUT') {
            machine.setState(state[1]);
            return { status: 200, body: {} };
        }
        if (OWNED(method, path)) return null;
        return cannedBoot.answer(method, path, query, body);
    }

    return {
        /** Answers one request. `url` is the whole URL or the path with its query; `body` is parsed JSON or undefined. */
        request({ method, url, body }) {
            const parsed = new URL(url, 'http://decaid.invalid');
            const path = parsed.pathname;
            const query = parsed.searchParams;
            const refusal = refusals.find(r => (!r.method || r.method === method) && r.path.test(`${path}${parsed.search}`));
            let result;
            if (refusal) {
                if (refusal.times !== undefined && --refusal.times <= 0) refusals.splice(refusals.indexOf(refusal), 1);
                result = refusal.abort ? { abort: true } : { status: refusal.status, body: refusal.body ?? { error: 'Refused by the test' } };
            } else {
                result = answer(method, path, query, body);
            }
            log.push({ method, path, search: parsed.search, body: body === undefined ? undefined : copy(body), status: result ? (result.abort ? 'aborted' : result.status) : null, at: clock });
            return result ? copy(result) : null;
        },
        /** Opens a socket: what it sends as it opens is waiting in the outbox. */
        connect(path, send) {
            let opening;
            if (OWNED('WS', path)) {
                if (path.startsWith(`/ws/v1/plugins/${DYE2_ID}/`)) opening = dye2Loaded() ? [] : null;
                else if (path.startsWith(`/ws/v1/plugins/${DECENT_SYNC_ID}/`)) opening = decentSyncPlugin && loaded(DECENT_SYNC_ID) ? [] : null;
                else opening = machine.opening(path);
            } else {
                opening = cannedBoot.socket(path);
            }
            if (!opening) return null;
            if (!sockets.has(path)) sockets.set(path, new Set());
            sockets.get(path).add(send);
            for (const frame of opening) outbox.push([send, JSON.stringify(frame)]);
            return { close: () => sockets.get(path).delete(send) };
        },
        /** Makes the save Decent Sync's plugin has waiting, then sends every frame waiting, in order. */
        flush() {
            decentSyncPlugin?.settle();
            for (const [send, text] of outbox.splice(0)) send(text);
        },
        /**
         * Starts from a Workflow as a whole, and store keys, as Decaid held them
         * when a scenario was recorded; DYE2 reads them as it does when it loads.
         */
        given({ workflow: next, store: keys = {}, shots: added = [] }) {
            for (const [namespace, values] of Object.entries(keys)) {
                for (const [key, value] of Object.entries(values || {})) store.set(namespace, key, value);
            }
            for (const shot of added) if (!shots.get(shot.id)) shots.add(copy(shot));
            workflow = copy(next);
            if (dye2Loaded()) dye2Loads();
            decentSyncPlugin?.decided();
            outbox.length = 0;
        },
        /** The page's time, which the test moves. */
        setNow(ms) { clock = ms; },
        now: () => clock,
        timeZone,

        // ── What the test does to the machine, DYE2 and the requests.
        machine,
        tick: () => machine.tick(),
        startPour: () => machine.startPour(),
        playPour: ms => machine.playPour(ms),
        finishPour: () => machine.finishPour(),
        storeShot: () => machine.storeShot(),
        /** A request matching `path` (tested against the path and query) is refused, or dropped with `abort`. */
        refuse({ method, path, status = 500, body, abort = false, times }) {
            refusals.push({ method, path, status, body, abort, times });
            return () => { const at = refusals.findIndex(r => r.path === path); if (at >= 0) refusals.splice(at, 1); };
        },
        /** DYE2's `record` has read its recipes list; the function it answers writes that list back, pushes and mirrors (dye2.js). */
        dye2RecordReads: () => dye2.recordReads(),
        /** DYE2 starts again, as Decaid's plugin disable and enable leave it (dye2.js). */
        restartDye2() {
            dye2.restart();
        },
        /**
         * DYE2 disabled in Decaid's plugins: listed as not loaded and not
         * loaded at start (`autoLoad`), and its routes answered 404 "plugin
         * with dye2.reaplugin not loaded" (recordings/dye2-plugin.json, which
         * replays the status). Its socket is refused too, which no recording
         * covers.
         */
        disableDye2() {
            const plugin = plugins.find(p => p.id === DYE2_ID);
            if (plugin) Object.assign(plugin, { loaded: false, autoLoad: false });
        },
        /** DYE2 enabled again: listed as loaded and loaded at start, and started afresh as `restartDye2()` leaves it. */
        enableDye2() {
            const plugin = plugins.find(p => p.id === DYE2_ID);
            if (!plugin) throw new Error('DYE2 is not installed in the fake');
            Object.assign(plugin, { loaded: true, autoLoad: true });
            dye2.restart();
        },
        /**
         * Decent Sync's plugin, where the fake was made with it: what the
         * test makes happen on its server and connection (decent-sync.js
         * `events`), and what it reads of them. Null without it.
         */
        decentSync: decentSyncPlugin && {
            ...decentSyncPlugin.events,
            recipe: decentSyncPlugin.recipe,
            state: decentSyncPlugin.state,
            others: decentSyncPlugin.others,
            own: decentSyncPlugin.own,
            machine: decentSyncPlugin.machine,
            location: decentSyncPlugin.location,
        },
        /** A recorded answer of the boot, changed: `patch(body)` answers the new body. */
        patchBoot: (key, patch) => cannedBoot.patch(key, patch),

        // ── What the test reads.
        log,
        writes: () => log.filter(entry => entry.method !== 'GET'),
        workflow: () => copy(workflow),
        store,
        shots,
        library,
        plugins,
        selection: () => copy(dye2.answer('GET', 'selection').body),
    };
}
