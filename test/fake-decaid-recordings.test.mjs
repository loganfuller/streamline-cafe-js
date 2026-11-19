// The fake Decaid against the pinned real stack: each scenario recorded in
// fake-decaid/recordings/ is sent to the model, which must answer as the real
// stack did, and push on DYE2's socket what DYE2 pushed. The recorded pour is
// replayed and its Shot compared with the one Decaid stored. How to record them
// again is in docs/cafe/TESTING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { createFakeDecaid } from '../fake-decaid/index.js';

const DIR = new URL('../fake-decaid/recordings/', import.meta.url);
const load = name => JSON.parse(readFileSync(new URL(`${name}.json`, DIR), 'utf8'));
const sampleData = load('sample-data');
const boot = load('boot');
const pour = load('pour');
const recordedMs = text => Date.parse(`${text.slice(0, 23)}Z`);

// The sample data's Shots keep the times they were recorded at when the page's
// clock is an hour past the newest (fake-decaid/index.js moves them otherwise).
const newest = Math.max(...sampleData.shots.map(shot => recordedMs(shot.timestamp)));
const fresh = () => createFakeDecaid({ sampleData, boot, pour, now: newest + 3_600_000 });

// When Decaid last changed a Shot is its own clock's; the rest is compared whole.
const IGNORED = new Set(['updatedAt']);
const normal = value => {
    if (Array.isArray(value)) return value.map(normal);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !IGNORED.has(key)).map(([key, inner]) => [key, normal(inner)]));
    return value;
};

const scenarios = readdirSync(DIR).filter(file => file.endsWith('.json')).map(file => file.slice(0, -5))
    .map(name => ({ name, recording: load(name) })).filter(({ recording }) => Array.isArray(recording.steps));

test('every rule file has a recorded scenario', () => {
    const rules = new Set(scenarios.map(({ recording }) => recording.rule));
    for (const rule of ['fake-decaid/workflow.js', 'fake-decaid/store.js', 'fake-decaid/dye2.js', 'fake-decaid/shots.js', 'fake-decaid/library.js']) {
        assert.ok(rules.has(rule), `no recorded scenario for ${rule}`);
    }
});

for (const { name, recording } of scenarios) {
    test(`${name}: the fake answers as Decaid ${recording.recordedWith.decaid} and DYE2 ${recording.recordedWith.dye2} did (${recording.rule})`, () => {
        const fake = fresh();
        if (recording.given) fake.given(recording.given);
        const pushes = [];
        if (recording.socket) fake.connect(recording.socket, text => pushes.push(JSON.parse(text)));
        fake.flush();
        recording.steps.forEach((step, index) => {
            pushes.length = 0;
            const { method, path, body } = step.request;
            const where = `step ${index + 1}, ${method} ${path}`;
            const got = fake.request({ method, url: `/api/v1${path}`, body });
            fake.flush();
            assert.ok(got, `${where}: the fake has no answer`);
            assert.equal(got.status, step.answer.status, `${where}: status`);
            // A refusal is compared by its status: the page reads no error's text.
            if (step.answer.status < 400) assert.deepEqual(normal(got.body), normal(step.answer.body), `${where}: answer`);
            if (recording.socket) assert.deepEqual(pushes, step.pushes, `${where}: what DYE2 pushed`);
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
    fake.flush();
    frames.length = 0;
    const id = fake.startPour();
    fake.finishPour();
    fake.flush();
    const restAt = pour.idleAtMs + 500;
    assert.equal(frames.length, pour.frames.filter(f => f.ms <= restAt).length, 'every frame of the pour is sent');
    const states = frames.filter(f => f.path === '/ws/v1/machine/snapshot').map(f => f.frame.state.state);
    assert.ok(states.includes('espresso') && states.at(-1) !== 'espresso', 'into espresso and out of it');
    frames.length = 0;
    fake.storeShot();
    fake.flush();
    assert.deepEqual(frames.map(f => f.frame.event + ':' + f.frame.state), pour.frames.filter(f => f.ms > restAt && f.socket === 'machine/shotState').map(f => f.frame.event + ':' + f.frame.state), 'the store sends what the shot-state socket said then');
    const stored = fake.shots.get(id);
    const recorded = pour.shot;
    assert.equal(stored.timestamp, recorded.timestamp, 'its time is the shot\'s start');
    assert.deepEqual(normal(stored.workflow), normal(recorded.workflow), 'the Workflow as it was at the end of the pour');
    assert.deepEqual(stored.annotations, recorded.annotations, 'the dose is the Workflow\'s, the yield the scale\'s');
    assert.equal(stored.stopReason, recorded.stopReason);
    assert.deepEqual(stored.measurements, recorded.measurements);
    const row = fake.request({ method: 'GET', url: '/api/v1/shots?limit=1' }).body.items[0];
    assert.deepEqual(normal({ ...row, id: recorded.id, createdAt: recorded.createdAt }), normal(pour.listRow), 'its row in Decaid\'s list');
});
