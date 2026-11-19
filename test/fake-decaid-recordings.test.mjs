// The fake Decaid against the pinned real stack: each scenario recorded in
// fake-decaid/recordings/ is sent to the model, which must answer as the real
// stack did, and push on DYE2's socket what DYE2 pushed. The recorded pour is
// replayed and its Shot compared with the one Decaid stored. Decent Sync's
// scenarios start from a fake made with recordings/decent-sync.json, and their
// events on the server are the fake plugin's. How to record them again is in
// docs/cafe/TESTING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { createFakeDecaid } from '../fake-decaid/index.js';

const DIR = new URL('../fake-decaid/recordings/', import.meta.url);
const load = name => JSON.parse(readFileSync(new URL(`${name}.json`, DIR), 'utf8'));
const sampleData = load('sample-data');
const boot = load('boot');
const pour = load('pour');
const decentSync = load('decent-sync');
const recordedMs = text => Date.parse(`${text.slice(0, 23)}Z`);

// The sample data's Shots keep the times they were recorded at when the page's
// clock is an hour past the newest (fake-decaid/index.js moves them otherwise).
const newest = Math.max(...sampleData.shots.map(shot => recordedMs(shot.timestamp)));
const fresh = (served = false) => createFakeDecaid({ sampleData, boot, pour, ...(served ? { decentSync } : {}), now: newest + 3_600_000 });
// A push the plugin may repeat is compared once.
const once = pushes => pushes.filter((push, index) => index === 0 || JSON.stringify(push) !== JSON.stringify(pushes[index - 1]));

// When Decaid last changed a Shot, and when DYE2 made a recipe, are their own
// clocks'; the rest is compared whole.
const IGNORED = new Set(['updatedAt', 'capturedAt']);
const normal = (value, ids = new Map()) => {
    if (Array.isArray(value)) return value.map(inner => normal(inner, ids));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !IGNORED.has(key)).map(([key, inner]) => [key, normal(inner, ids)]));
    return typeof value === 'string' && ids.has(value) ? ids.get(value) : value;
};

const scenarios = readdirSync(DIR).filter(file => file.endsWith('.json')).map(file => file.slice(0, -5))
    .map(name => ({ name, recording: load(name) })).filter(({ recording }) => Array.isArray(recording.steps));

test('every recording was made with the pinned versions', () => {
    const pins = JSON.parse(readFileSync(new URL('../fake-decaid/pins.json', import.meta.url), 'utf8'));
    for (const file of readdirSync(DIR).filter(name => name.endsWith('.json'))) {
        const { recordedWith } = load(file.slice(0, -5));
        assert.equal(recordedWith?.decaid, pins.decaid.version, `${file}: recorded with Decaid ${recordedWith?.decaid}, pinned ${pins.decaid.version}; record again`);
        assert.equal(recordedWith?.dye2, pins.dye2.version, `${file}: recorded with DYE2 ${recordedWith?.dye2}, pinned ${pins.dye2.version}; record again`);
        if (file.startsWith('decent-sync')) assert.equal(recordedWith?.decentSync, pins.decentSync.version, `${file}: recorded with Decent Sync ${recordedWith?.decentSync}, pinned ${pins.decentSync.version}; record again`);
    }
    // Only the boot holds what Streamline's own modules ask for.
    assert.equal(boot.recordedWith.streamline, pins.streamline.version, `boot.json: recorded with Streamline ${boot.recordedWith.streamline}, pinned ${pins.streamline.version}; record the boot again`);
});

test('every rule file has a recorded scenario', () => {
    const rules = new Set(scenarios.map(({ recording }) => recording.rule));
    for (const rule of ['fake-decaid/index.js', 'fake-decaid/workflow.js', 'fake-decaid/store.js', 'fake-decaid/dye2.js', 'fake-decaid/shots.js', 'fake-decaid/library.js', 'fake-decaid/decent-sync.js']) {
        assert.ok(rules.has(rule), `no recorded scenario for ${rule}`);
    }
});

for (const { name, recording } of scenarios) {
    const versions = `Decaid ${recording.recordedWith.decaid}, DYE2 ${recording.recordedWith.dye2}${recording.decentSync ? ` and Decent Sync ${recording.recordedWith.decentSync}` : ''}`;
    test(`${name}: the fake answers as ${versions} did (${recording.rule})`, () => {
        const fake = fresh(!!recording.decentSync);
        // DYE2's pushes are compared as pushed; Decent Sync's plugin may repeat one.
        const pushed = recording.decentSync ? once : list => list;
        if (recording.given) fake.given(recording.given);
        const pushes = [];
        if (recording.socket) fake.connect(recording.socket, text => pushes.push(JSON.parse(text)));
        fake.flush();
        // DYE2 makes a recipe's id at random: the recorded one stands for the model's.
        const made = new Map();
        recording.steps.forEach((step, index) => {
            pushes.length = 0;
            if (step.event) {
                const sync = fake.decentSync;
                const events = {
                    'restart-dye2': () => fake.restartDye2(),
                    'disable-dye2': () => fake.disableDye2(),
                    'enable-dye2': () => fake.enableDye2(),
                    'sync-sharing': () => sync.setSharing(step.on),
                    'sync-stop-server': () => sync.stopServer(),
                    'sync-start-server': () => sync.startServer(),
                    'sync-choose-reference': () => sync.chooseReference(step.recipe, step.shot),
                    'sync-rename': () => sync.renameRecipe(step.recipe, step.name),
                    'sync-edit-shot': () => sync.editShot(step.shot, { rating: step.rating, note: step.note }),
                };
                assert.ok(events[step.event], `step ${index + 1}: no such event in the model: ${step.event}`);
                events[step.event]();
                fake.flush();
                // What DYE2 pushes as it loads is not kept; what Decent Sync's plugin pushes after an event is.
                if (step.pushes) assert.deepEqual(pushed(pushes), pushed(step.pushes), `step ${index + 1}, ${step.event}: what the plugin pushed`);
                return;
            }
            const { method, path, body } = step.request;
            const where = `step ${index + 1}, ${method} ${path}`;
            const got = fake.request({ method, url: `/api/v1${path}`, body });
            fake.flush();
            assert.ok(got, `${where}: the fake has no answer`);
            assert.equal(got.status, step.answer.status, `${where}: status`);
            // A refusal is compared by its status: the page reads no error's text.
            if (path.endsWith('/save-recipe') && step.answer.status === 200) made.set(step.answer.body.id, got.body.id);
            if (step.answer.status < 400) assert.deepEqual(normal(got.body), normal(step.answer.body, made), `${where}: answer`);
            if (recording.socket) assert.deepEqual(pushed(pushes), pushed(step.pushes), `${where}: what was pushed`);
        });
    });
}

test(`pour: the replayed pour stores the Shot Decaid ${pour.recordedWith.decaid} stored, with the Workflow at its end`, () => {
    const fake = fresh();
    const put = fake.request({ method: 'PUT', url: '/api/v1/workflow', body: pour.workflowBefore });
    assert.equal(put.status, 200);
    // The pour asked for at the moment it was recorded, so its times read back as recorded.
    const first = pour.frames.find(f => f.socket === 'machine/snapshot');
    fake.setNow(recordedMs(first.frame.timestamp) - first.ms);
    const frames = [];
    for (const path of ['/ws/v1/machine/snapshot', '/ws/v1/machine/shotState', '/ws/v1/scale/snapshot']) {
        fake.connect(path, text => frames.push({ path, frame: JSON.parse(text) }));
    }
    const dye2Pushes = [];
    fake.connect('/ws/v1/plugins/dye2.reaplugin/changed', text => {
        dye2Pushes.push(JSON.parse(text));
        frames.push({ path: '/ws/v1/plugins/dye2.reaplugin/changed', frame: JSON.parse(text) });
    });
    const recordedDye2 = at => pour.frames.filter(f => f.socket === 'plugins/dye2.reaplugin/changed' && at(f.ms)).map(f => f.frame);
    fake.flush();
    frames.length = 0;
    const id = fake.startPour();
    fake.finishPour();
    fake.flush();
    const restAt = pour.idleAtMs + 500;
    assert.equal(frames.length, pour.frames.filter(f => f.ms <= restAt).length, 'every frame of the pour is sent, DYE2\'s pushes among them');
    assert.deepEqual(dye2Pushes, recordedDye2(ms => ms <= restAt), 'DYE2 pushed as it did during the pour');
    dye2Pushes.length = 0;
    const states = frames.filter(f => f.path === '/ws/v1/machine/snapshot').map(f => f.frame.state.state);
    assert.ok(states.includes('espresso') && states.at(-1) !== 'espresso', 'into espresso and out of it');
    frames.length = 0;
    fake.storeShot();
    fake.flush();
    // What the shot-state socket said then and DYE2's push, in the recording's order.
    const said = f => (f.socket || f.path.replace('/ws/v1/', '')) === 'machine/shotState' ? `shotState ${f.frame.event}:${f.frame.state}` : `dye2 ${JSON.stringify(f.frame)}`;
    assert.deepEqual(frames.map(said), pour.frames.filter(f => f.ms > restAt && (f.socket === 'machine/shotState' || f.socket.startsWith('plugins/'))).map(said), 'the store sends what the sockets said then, in order');
    // DYE2 works out its recents once the Shot is stored and pushes, within
    // about 0.1 s of it on the pinned stack: the model pushes at the store.
    const afterStore = recordedDye2(ms => ms > restAt);
    assert.ok(afterStore.length > 0, 'the recording has DYE2\'s push after the store');
    assert.deepEqual(dye2Pushes, afterStore, 'DYE2 pushes once the Shot is stored, as recorded');
    const stored = fake.shots.get(id);
    const recorded = pour.shot;
    assert.equal(stored.timestamp, recorded.timestamp, 'its time is the shot\'s start');
    assert.deepEqual(normal(stored.workflow), normal(recorded.workflow), 'the Workflow as it was at the end of the pour');
    // The yield, the stop reason and the measurements are replayed from the
    // recorded Shot, so only the dose (the Workflow's) is the model's own here.
    assert.deepEqual(stored.annotations, recorded.annotations, 'the dose is the Workflow\'s; the yield is the recording\'s');
    assert.equal(stored.stopReason, recorded.stopReason);
    assert.deepEqual(stored.measurements, recorded.measurements);
    const row = fake.request({ method: 'GET', url: '/api/v1/shots?limit=1' }).body.items[0];
    assert.deepEqual(normal({ ...row, id: recorded.id, createdAt: recorded.createdAt }), normal(pour.listRow), 'its row in Decaid\'s list');
});
