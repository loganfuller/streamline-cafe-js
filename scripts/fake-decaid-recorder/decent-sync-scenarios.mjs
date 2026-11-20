// The scenarios behind each rule the fake plugin follows
// (fake-decaid/decent-sync.js), recorded against the second setup
// (decent-sync.mjs): requests to the plugin's endpoints on the first Decaid,
// and events made on the server, each answer and each push on the plugin's
// `changes` socket written to fake-decaid/recordings/<scenario>.json.
// test/fake-decaid-recordings.test.mjs replays them against a fake made with
// recordings/decent-sync.json, the state the stage leaves before they run.
//
// A step's `path` and `body` may be functions of `sync`: the DYE2 record ids
// by recipe name (`records`), and the stage's Shots by label (`shots`): A, the
// first Machine's on House espresso; B, its own on Single origin, another
// Profile; C, the second Machine's on House espresso; D, the second Machine's
// cut short, Unfinished.
//
// An event is made on the server, and the replay calls the fake plugin's event
// of the same name with the arguments written in the recording:
//   { event: 'sync-sharing', on }                  the Machine's sharing off or on
//   { event: 'sync-stop-server' }, 'sync-start-server'   an outage and its end
//   { event: 'sync-choose-reference', recipe, shot } a Reference Shot chosen (shot null clears it)
//   { event: 'sync-rename', recipe, name }          a Recipe renamed
//   { event: 'sync-edit-shot', shot, rating, note } a Shot rated and noted
// What the plugin pushes on `changes` after an event is kept and compared, each
// push once: the plugin may repeat one.
//
// Each scenario starts from the stage's state (no Reference Shots, the Shots as
// pulled) and puts back what it changed of it, or leaves only what no later
// scenario reads, so they can be recorded and replayed one at a time.

const P = '/plugins/decent-sync.reaplugin';
const CHANGES = '/ws/v1/plugins/decent-sync.reaplugin/changes';
const HOUSE = 'House espresso';
const DECAF = 'Decaf';

export const DECENT_SYNC_SCENARIOS = [
    {
        name: 'decent-sync-status',
        rule: 'fake-decaid/decent-sync.js',
        about: 'The plugin\'s status: served with its Machine and Location; a method it doesn\'t take; a Capture-only Machine (its sharing off) refused 409 captureOnly with its Machine and no Location, the same refusal from every endpoint that asks the server; served again once sharing is on.',
        socket: CHANGES,
        steps: [
            { method: 'GET', path: `${P}/status` },
            { method: 'POST', path: `${P}/status`, body: {} },
            { method: 'GET', path: `${P}/reference` },
            { event: 'sync-sharing', on: false },
            { method: 'GET', path: `${P}/status` },
            { method: 'GET', path: `${P}/shots?limit=50` },
            { method: 'GET', path: ({ sync }) => `${P}/shot?id=${sync.shots.C}` },
            { method: 'GET', path: ({ sync }) => `${P}/reference?recipe=${sync.records[HOUSE]}` },
            { method: 'PUT', path: ({ sync }) => `${P}/reference?recipe=${sync.records[HOUSE]}`, body: ({ sync }) => ({ shotId: sync.shots.A }) },
            { method: 'PUT', path: ({ sync }) => `${P}/shot?id=${sync.shots.C}`, body: { rating: 4 } },
            { event: 'sync-sharing', on: true },
            { method: 'GET', path: `${P}/status` },
        ],
    },
    {
        name: 'decent-sync-shots',
        rule: 'fake-decaid/decent-sync.js',
        about: 'The Location\'s Shots, whichever Machine pulled them, newest first, a page at a time with the cursor the page before gave; limits and cursors it refuses; one Shot whole, the tablet\'s own or another Machine\'s, and one the list doesn\'t list refused noSuchShot.',
        steps: [
            { method: 'GET', path: `${P}/shots?limit=50` },
            { method: 'GET', path: `${P}/shots` },
            { method: 'GET', path: `${P}/shots?limit=2`, as: 'first' },
            { method: 'GET', path: ({ seen }) => `${P}/shots?limit=2&cursor=${encodeURIComponent(seen.first.nextCursor)}` },
            { method: 'GET', path: `${P}/shots?limit=0` },
            { method: 'GET', path: `${P}/shots?limit=51` },
            { method: 'GET', path: `${P}/shots?limit=2&cursor=not-a-cursor` },
            { method: 'POST', path: `${P}/shots`, body: {} },
            { method: 'GET', path: ({ sync }) => `${P}/shot?id=${sync.shots.A}` },
            { method: 'GET', path: ({ sync }) => `${P}/shot?id=${sync.shots.C}` },
            { method: 'GET', path: ({ sync }) => `${P}/shot?id=${sync.shots.D}` },
            { method: 'GET', path: ({ sync }) => `${P}/shot?id=${sync.sampleShot}` },
            { method: 'GET', path: `${P}/shot?id=no-such-shot` },
            { method: 'GET', path: `${P}/shot` },
        ],
    },
    {
        name: 'decent-sync-reference',
        rule: 'fake-decaid/decent-sync.js',
        about: 'A Recipe\'s Reference Shot by its DYE2 record\'s id: none, then chosen on the tablet (its own Shot, one on another Profile, another Machine\'s), refusals for a Shot it may not read, no Shot and no Recipe; chosen, renamed and cleared on the server; a push on changes each time the copy of a slotted Recipe changes.',
        socket: CHANGES,
        steps: [
            { method: 'GET', path: ({ sync }) => `${P}/reference?recipe=${sync.records[HOUSE]}` },
            { method: 'PUT', path: ({ sync }) => `${P}/reference?recipe=${sync.records[HOUSE]}`, body: ({ sync }) => ({ shotId: sync.shots.A }) },
            { method: 'GET', path: ({ sync }) => `${P}/reference?recipe=${sync.records[HOUSE]}` },
            { method: 'PUT', path: ({ sync }) => `${P}/reference?recipe=${sync.records[HOUSE]}`, body: ({ sync }) => ({ shotId: sync.shots.B }) },
            { method: 'PUT', path: ({ sync }) => `${P}/reference?recipe=${sync.records[HOUSE]}`, body: ({ sync }) => ({ shotId: sync.shots.C }) },
            { method: 'GET', path: ({ sync }) => `${P}/shot?id=${sync.shots.C}` },
            { method: 'PUT', path: ({ sync }) => `${P}/reference?recipe=${sync.records[HOUSE]}`, body: ({ sync }) => ({ shotId: sync.sampleShot }) },
            { method: 'PUT', path: ({ sync }) => `${P}/reference?recipe=${sync.records[HOUSE]}`, body: { shotId: 'no-such-shot' } },
            { method: 'PUT', path: ({ sync }) => `${P}/reference?recipe=${sync.records[HOUSE]}`, body: {} },
            { method: 'GET', path: `${P}/reference?recipe=no-such-record` },
            { method: 'DELETE', path: ({ sync }) => `${P}/reference?recipe=${sync.records[HOUSE]}` },
            { event: 'sync-choose-reference', recipe: HOUSE, shot: 'A' },
            { method: 'GET', path: ({ sync }) => `${P}/reference?recipe=${sync.records[HOUSE]}` },
            { event: 'sync-rename', recipe: HOUSE, name: 'House espresso renamed' },
            { method: 'GET', path: ({ sync }) => `${P}/reference?recipe=${sync.records[HOUSE]}` },
            { event: 'sync-rename', recipe: HOUSE, name: HOUSE },
            { event: 'sync-choose-reference', recipe: HOUSE, shot: null },
            { method: 'GET', path: ({ sync }) => `${P}/reference?recipe=${sync.records[HOUSE]}` },
            { method: 'GET', path: ({ sync }) => `${P}/reference?recipe=${sync.records[DECAF]}` },
        ],
    },
    {
        name: 'decent-sync-edits',
        rule: 'fake-decaid/decent-sync.js',
        about: 'A Shot\'s rating and note through the plugin: the tablet\'s own through Decaid, another Machine\'s through the server, each answered with the rating and note as they then are; edits it refuses; one rated and noted on the server reaching the tablet\'s own Shot, the list and the Reference Shot, with a push.',
        socket: CHANGES,
        steps: [
            { event: 'sync-choose-reference', recipe: HOUSE, shot: 'A' },
            { method: 'PUT', path: ({ sync }) => `${P}/shot?id=${sync.shots.A}`, body: { rating: 8 } },
            { method: 'PUT', path: ({ sync }) => `${P}/shot?id=${sync.shots.A}`, body: { note: 'Sample note' } },
            { method: 'GET', path: ({ sync }) => `/shots/${sync.shots.A}` },
            { method: 'PUT', path: ({ sync }) => `${P}/shot?id=${sync.shots.A}`, body: { rating: 0 } },
            { method: 'PUT', path: ({ sync }) => `${P}/shot?id=${sync.shots.A}`, body: {} },
            { method: 'PUT', path: ({ sync }) => `${P}/shot?id=${sync.shots.A}`, body: { rating: 11 } },
            { method: 'PUT', path: ({ sync }) => `${P}/shot?id=${sync.shots.A}`, body: { rating: 4, extra: 1 } },
            { method: 'PUT', path: ({ sync }) => `${P}/shot?id=${sync.shots.A}`, body: { note: null } },
            { method: 'PUT', path: `${P}/shot`, body: { rating: 4 } },
            { method: 'PUT', path: ({ sync }) => `${P}/shot?id=${sync.shots.C}`, body: { rating: 6 } },
            { method: 'PUT', path: ({ sync }) => `${P}/shot?id=${sync.shots.C}`, body: { note: 'Another Machine\'s note' } },
            { method: 'PUT', path: ({ sync }) => `${P}/shot?id=${sync.sampleShot}`, body: { rating: 2 } },
            { method: 'PUT', path: `${P}/shot?id=no-such-shot`, body: { rating: 2 } },
            { method: 'GET', path: `${P}/shots?limit=50` },
            { event: 'sync-edit-shot', shot: 'A', rating: 7, note: 'Server note' },
            { method: 'GET', path: ({ sync }) => `${P}/reference?recipe=${sync.records[HOUSE]}` },
            { method: 'GET', path: `${P}/shots?limit=50` },
            { event: 'sync-choose-reference', recipe: HOUSE, shot: null },
        ],
    },
    {
        name: 'decent-sync-outage',
        rule: 'fake-decaid/decent-sync.js',
        about: 'The server out of reach: a push as the connection goes; status refused unreachable, not connected; a slotted Recipe\'s reference answered from the tablet\'s copy; the list, a Shot, a choice and another Machine\'s edit refused; the tablet\'s own Shot still edited through Decaid; a push as it comes back, and one for the copy that changed meanwhile.',
        socket: CHANGES,
        steps: [
            { event: 'sync-choose-reference', recipe: HOUSE, shot: 'B' },
            { event: 'sync-stop-server' },
            { method: 'GET', path: `${P}/status` },
            { method: 'GET', path: ({ sync }) => `${P}/reference?recipe=${sync.records[HOUSE]}` },
            { method: 'GET', path: ({ sync }) => `${P}/reference?recipe=${sync.records[DECAF]}` },
            { method: 'GET', path: `${P}/reference?recipe=no-such-record` },
            { method: 'GET', path: `${P}/shots?limit=50` },
            { method: 'GET', path: ({ sync }) => `${P}/shot?id=${sync.shots.C}` },
            { method: 'PUT', path: ({ sync }) => `${P}/reference?recipe=${sync.records[HOUSE]}`, body: ({ sync }) => ({ shotId: sync.shots.A }) },
            { method: 'PUT', path: ({ sync }) => `${P}/shot?id=${sync.shots.B}`, body: { rating: 6 } },
            { method: 'PUT', path: ({ sync }) => `${P}/shot?id=${sync.shots.C}`, body: { rating: 5 } },
            { event: 'sync-start-server' },
            { method: 'GET', path: `${P}/status` },
            { method: 'GET', path: ({ sync }) => `${P}/reference?recipe=${sync.records[HOUSE]}` },
            { event: 'sync-choose-reference', recipe: HOUSE, shot: null },
        ],
    },
];

/**
 * Records the scenarios against the second setup. `stage` is what
 * decent-sync.mjs stood up; `sync` the ids the steps name.
 */
export async function recordDecentSyncScenarios({ raw, ws, write, sleep, opened, stage, sync, only = null }) {
    const recipeId = name => sync.recipeIds[name];
    const shotId = label => (label === null ? null : sync.shots[label]);
    const status = async () => (await raw('GET', `${P}/status`)).body;
    const waitFor = async (test, what, timeout = 120_000) => {
        for (let waited = 0; ; waited += 500) {
            if (test(await status().catch(() => ({})))) return;
            if (waited > timeout) throw new Error(`${what} within ${timeout / 1000} s`);
            await sleep(500);
        }
    };
    // Each event, made on the server, and what the replay is told of it.
    const events = {
        'sync-sharing': async ({ on }) => {
            await stage.server('PUT', `/machines/${stage.machine.id}/sharing`, { sharing: on });
            await waitFor(s => (on ? s.served === true : s.code === 'captureOnly'), `sharing ${on ? 'on' : 'off'} did not reach the plugin`);
            return { on };
        },
        'sync-stop-server': async () => {
            stage.stopServer();
            await waitFor(s => s.connected === false, 'the plugin did not lose its connection');
            return {};
        },
        'sync-start-server': async () => {
            await stage.startServer();
            await waitFor(s => s.served === true, 'the plugin did not serve again');
            return {};
        },
        'sync-choose-reference': async ({ recipe, shot }) => {
            await stage.server('PUT', `/recipes/${recipeId(recipe)}/reference-shot`, { shotId: shotId(shot) });
            return { recipe: sync.records[recipe], shot: shotId(shot) };
        },
        'sync-rename': async ({ recipe, name }) => {
            await stage.server('PATCH', `/recipes/${recipeId(recipe)}`, { content: { name } });
            return { recipe: sync.records[recipe], name };
        },
        'sync-edit-shot': async ({ shot, rating, note }) => {
            await stage.server('PATCH', `/shots/${shotId(shot)}`, { rating, note });
            return { shot: shotId(shot), rating, note };
        },
    };
    for (const scenario of DECENT_SYNC_SCENARIOS) {
        if (only && !only.includes(scenario.name)) continue;
        const pushes = [];
        let socket = null;
        if (scenario.socket) {
            socket = new WebSocket(`${ws}${scenario.socket.replace('/ws/v1', '')}`);
            socket.onmessage = event => pushes.push(JSON.parse(String(event.data)));
            await opened(socket);
        }
        const given = { workflow: (await raw('GET', '/workflow')).body };
        const steps = [];
        const seen = {};
        for (const step of scenario.steps) {
            pushes.length = 0;
            if (step.event) {
                if (!events[step.event]) throw new Error(`no such event: ${step.event}`);
                const { event, ...args } = step;
                const recorded = await events[event](args);
                // The plugin hears the server's change on its connection, and keeps a copy before it pushes.
                await sleep(6000);
                steps.push({ event, ...recorded, ...(socket ? { pushes: [...pushes] } : {}) });
                continue;
            }
            const path = typeof step.path === 'function' ? step.path({ sync, seen }) : step.path;
            const body = typeof step.body === 'function' ? step.body({ sync, seen }) : step.body;
            const answer = await raw(step.method, path, body);
            if (step.as) seen[step.as] = answer.body;
            // A choice or an edit reaches the copies a moment after it is answered.
            await sleep(step.method === 'GET' ? 100 : 2500);
            steps.push({ request: { method: step.method, path, ...(body === undefined ? {} : { body }) }, answer, ...(socket ? { pushes: [...pushes] } : {}) });
        }
        socket?.close();
        await write(scenario.name, { rule: scenario.rule, about: scenario.about, decentSync: true, ...(scenario.socket ? { socket: scenario.socket } : {}), given, steps });
        console.log(`recorded ${scenario.name}: ${steps.length} steps`);
    }
}
