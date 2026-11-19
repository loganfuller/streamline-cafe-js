// The fake Decaid's rules, one at a time (fake-decaid/; docs/cafe/TESTING.md).
// test/fake-decaid-recordings.test.mjs holds each rule against the pinned
// real stack; these say what each rule is and catch a change to one quickly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { createFakeDecaid, OWNED } from '../fake-decaid/index.js';
import { updateWorkflow, deepMerge } from '../fake-decaid/workflow.js';
import { createStore } from '../fake-decaid/store.js';
import { deriveSelection, recipeModified, profileFingerprint, proposeRecipeName } from '../fake-decaid/dye2.js';
import { createShots } from '../fake-decaid/shots.js';
import { createLibrary } from '../fake-decaid/library.js';
import { createBoot } from '../fake-decaid/boot.js';
import { localTime, shiftTime } from '../fake-decaid/machine.js';

const DIR = new URL('../fake-decaid/', import.meta.url);
const load = name => JSON.parse(readFileSync(new URL(`recordings/${name}.json`, DIR), 'utf8'));
const recordings = { sampleData: load('sample-data'), boot: load('boot'), pour: load('pour') };
const START = Date.parse('2026-11-18T14:00:00Z');
const fresh = () => createFakeDecaid({ ...recordings, now: START });
const get = (fake, url) => fake.request({ method: 'GET', url });
const send = (fake, method, url, body) => fake.request({ method, url, body });
const houseRecord = fake => fake.store.get('dye2.reaplugin', 'recipes').find(row => row.name === 'House espresso');
// The Workflow Streamline's apply writes for a record (recordings/dye2-selection.json, step 5).
const applied = record => ({
    context: { ...record.workflow.context, extras: { ...record.workflow.context.extras, dye: { v: 1, recipeId: record.id }, rpm: null, feedRate: null }, drinkerName: null },
    profile: record.workflow.profile,
});

test('the model keeps no timers and uses no Node API, so a page can load it', () => {
    for (const file of readdirSync(DIR).filter(name => name.endsWith('.js'))) {
        const source = readFileSync(new URL(file, DIR), 'utf8').replace(/\/\/.*$/gm, '');
        assert.doesNotMatch(source, /\b(setTimeout|setInterval|setImmediate|requestAnimationFrame|queueMicrotask|process\.|require\(|Buffer\b)/, `${file} uses a timer or Node`);
        for (const [, from] of source.matchAll(/from\s+'([^']+)'/g)) assert.ok(from.startsWith('./'), `${file} imports ${from}`);
    }
});

test('Workflow: a write is merged key by key, a context field written as null dropped, nulls inside extras kept', () => {
    const current = { id: 'w', name: 'Workflow', description: '', profile: { title: 'P', steps: [{ name: 'a', pump: 'pressure', pressure: 9 }, { name: 'b', pump: 'flow', flow: 2 }] }, context: { targetDoseWeight: 18, targetYield: 36, coffeeName: 'Bean', extras: { basketId: 'x', dye: { recipeId: 'r' } } }, steamSettings: { targetTemperature: 150, duration: 50, flow: 0.8, stopAtTemperature: 0 } };
    const { answer, workflow } = updateWorkflow(current, { context: { coffeeName: null, grinderSetting: 3, unknown: 1, extras: { basketId: null, dye: { v: 1 } } }, profile: { steps: [{ name: 'only', pump: 'flow', flow: 4 }] }, other: true });
    assert.equal(answer.status, 200);
    assert.equal('coffeeName' in workflow.context, false, 'a context field written as null is dropped');
    assert.equal(workflow.context.grinderSetting, '3', 'a setting is a string');
    assert.equal('unknown' in workflow.context, false);
    assert.equal('other' in workflow, false);
    assert.deepEqual(workflow.context.extras, { basketId: null, dye: { recipeId: 'r', v: 1 } }, 'extras merged, its nulls kept');
    assert.equal(workflow.profile.steps.length, 1, 'a profile\'s steps are replaced whole');
    assert.deepEqual(workflow.hotWaterData, { targetTemperature: 75, duration: 30, volume: 50, flow: 10 }, 'a part missing is Decaid\'s defaults');
    assert.equal(workflow.profile.title, 'P');
});

test('Workflow: nulls and wrong types are refused, and the Workflow is left as it was', () => {
    const current = { context: { targetYield: 36 }, steamSettings: { targetTemperature: 150, duration: 50, flow: 0.8, stopAtTemperature: 0 } };
    for (const body of [{ context: null }, { steamSettings: null }, { context: { targetYield: null } }, { context: { targetYield: '36' } }, { steamSettings: { flow: null } }, [], { context: { grinderRpm: 1.5 } }]) {
        const { answer, workflow } = updateWorkflow(current, body);
        assert.equal(answer.status, 400, JSON.stringify(body));
        assert.equal(workflow, undefined);
    }
    assert.deepEqual(deepMerge({ a: { b: 1, c: [1] } }, { a: { c: [2] } }), { a: { b: 1, c: [2] } });
});

test('store: a key never written is null; writes read back; keys stay as they stand in the URL, sorted', () => {
    const store = createStore();
    const q = (search = '') => new URLSearchParams(search);
    assert.deepEqual(store.answer('GET', 'ns/never', q()), { status: 200, body: null });
    assert.deepEqual(store.answer('POST', 'ns/b', q(), { a: 1 }), { status: 200, body: {} });
    store.answer('POST', 'ns/profile%3Aab', q(), 'x');
    store.answer('POST', 'ns/a', q(), null);
    assert.deepEqual(store.answer('GET', 'ns/b', q()).body, { a: 1 });
    assert.equal(store.answer('GET', 'ns/a', q()).body, 'null', 'a body of null is stored as the text');
    assert.deepEqual(store.answer('GET', 'ns', q()).body, ['a', 'b', 'profile%3Aab']);
    assert.deepEqual(store.answer('GET', 'ns', q('full=1')).body, { a: 'null', b: { a: 1 }, 'profile%3Aab': 'x' });
    assert.deepEqual(store.answer('DELETE', 'ns/b', q()), { status: 200, body: {} });
    assert.equal(store.answer('GET', 'ns/b', q()).body, null);
});

test('DYE2: a recipe by the Workflow\'s recipeId, modified once the Workflow moves off a field the record holds', () => {
    const record = { id: 'r1', dashboardVariables: { dose: 18, drink: 36, grind: 2.4 }, workflow: { profile: { title: 'P' } } };
    const wf = grind => ({ context: { targetDoseWeight: 18, targetYield: 36, grinderSetting: grind, extras: { dye: { recipeId: 'r1' } } } });
    assert.deepEqual(deriveSelection(wf('2.40'), { recipes: [record] }), { kind: 'recipe', id: 'r1', modified: false }, '2.40 is 2.4');
    assert.deepEqual(deriveSelection(wf('2.6'), { recipes: [record] }), { kind: 'recipe', id: 'r1', modified: true });
    assert.equal(recipeModified({ dashboardVariables: { dose: 18 } }, wf('9')), false, 'a field the record does not hold is no change');
    const recent = { id: 'recent:s1', auto: true, workflow: { context: { targetDoseWeight: 18, targetYield: 36, grinderSetting: '2.6' } } };
    const loose = { context: { targetDoseWeight: 18, targetYield: 36, grinderSetting: '2.6' } };
    assert.deepEqual(deriveSelection(loose, { recipes: [record], favourites: [recent] }), { kind: 'favourite', id: 'recent:s1', modified: false, auto: true });
    assert.equal(deriveSelection({ context: { targetDoseWeight: 9 } }, { recipes: [record], favourites: [recent] }), null);
    assert.equal(profileFingerprint({ title: 'P', steps: [{ temperature: 90, limiter: { value: 0 } }] }), profileFingerprint({ title: 'P', steps: [{ temperature: 88, limiter: null }] }), 'a temperature or a zero limiter is not another profile');
});

test('DYE2: a recipe loaded, then a Workflow write, pushes on changed only when the selection moves', () => {
    const fake = fresh();
    const pushes = [];
    fake.connect('/ws/v1/plugins/dye2.reaplugin/changed', text => pushes.push(JSON.parse(text)));
    const record = houseRecord(fake);
    send(fake, 'PUT', '/api/v1/workflow', applied(record));
    fake.flush();
    assert.deepEqual(pushes, [{ what: 'workflow' }], 'the load moves the selection');
    assert.deepEqual(fake.selection(), { kind: 'recipe', id: record.id, modified: true }, 'the sample records hold a flush at 25 °C, the machine reports 90');
    assert.deepEqual(fake.store.get('dye2.reaplugin', 'selection'), fake.selection(), 'mirrored to its store key');
    pushes.length = 0;
    const before = JSON.stringify(fake.store.get('dye2.reaplugin', 'recipes'));
    send(fake, 'PUT', '/api/v1/workflow', { context: { grinderSetting: '9' } });
    fake.flush();
    assert.deepEqual(pushes, [], 'still the recipe, still modified: no push');
    assert.equal(JSON.stringify(fake.store.get('dye2.reaplugin', 'recipes')), before, 'a Workflow write changes no record');
});

test('DYE2: a profile changed under a recipe clears its id; POST selection writes the id, or clears it', () => {
    const fake = fresh();
    const record = houseRecord(fake);
    send(fake, 'PUT', '/api/v1/workflow', applied(record));
    const other = fake.store.get('dye2.reaplugin', 'recipes').find(row => row.workflow.profile.title !== record.workflow.profile.title);
    send(fake, 'PUT', '/api/v1/workflow', { profile: other.workflow.profile });
    assert.equal(fake.workflow().context.extras.dye.recipeId, null);
    const answer = send(fake, 'POST', '/api/v1/plugins/dye2.reaplugin/selection', { kind: 'recipe', id: record.id });
    assert.equal(answer.body.id, record.id);
    assert.equal(fake.workflow().context.extras.dye.recipeId, record.id);
    send(fake, 'POST', '/api/v1/plugins/dye2.reaplugin/selection', {});
    assert.equal(fake.workflow().context.extras.dye.recipeId, null);
    assert.deepEqual(get(fake, '/api/v1/plugins/dye2.reaplugin/skin').body, { version: 1, surfaces: [], live: { endpoint: 'changed' } });

    // As DYE2 loads, too: a Workflow it finds with the recipe's id on another profile loses the id.
    const cold = fresh();
    const whole = cold.workflow();
    const extras = { ...whole.context.extras, dye: { v: 1, recipeId: record.id } };
    cold.given({ workflow: { ...whole, context: { ...whole.context, extras }, profile: other.workflow.profile } });
    assert.equal(cold.workflow().context.extras.dye.recipeId, null, 'the write DYE2 makes as it loads');
});

test('plugins: DYE2 disabled is listed not loaded, its routes 404, its socket refused, and it hears no Workflow write; enabled, it answers again', () => {
    const fake = fresh();
    const dye2 = () => get(fake, '/api/v1/plugins').body.find(plugin => plugin.id === 'dye2.reaplugin');
    assert.deepEqual([dye2().loaded, dye2().autoLoad], [true, true]);
    fake.disableDye2();
    assert.deepEqual([dye2().loaded, dye2().autoLoad], [false, false]);
    assert.equal(get(fake, '/api/v1/plugins/dye2.reaplugin/selection').status, 404);
    assert.equal(fake.connect('/ws/v1/plugins/dye2.reaplugin/changed', () => {}), null);
    const record = houseRecord(fake);
    send(fake, 'PUT', '/api/v1/workflow', applied(record));
    fake.enableDye2();
    assert.deepEqual([dye2().loaded, dye2().autoLoad], [true, true]);
    const selection = get(fake, '/api/v1/plugins/dye2.reaplugin/selection');
    assert.equal(selection.status, 200);
    assert.equal(selection.body.id, record.id, 'enabled again, DYE2 reads the Workflow written while it was off');
});

test('Shots: newest first without measurements, paged, filtered; by ids, whole; the latest; one, or 404', () => {
    const shot = (id, timestamp, grinderId) => ({ id, timestamp, createdAt: 'c', updatedAt: 'u', measurements: [{ m: 1 }], workflow: { context: { grinderId }, profile: { title: 'P' } }, annotations: {} });
    const shots = createShots([shot('a', '2026-11-18T10:00:00.000', 'g1'), shot('c', '2026-11-18T12:00:00.000', 'g2'), shot('b', '2026-11-18T11:00:00.000', 'g1')], () => 'now');
    const list = search => shots.answer('GET', '', new URLSearchParams(search)).body;
    assert.deepEqual(list('').items.map(s => s.id), ['c', 'b', 'a']);
    assert.equal('measurements' in list('').items[0], false);
    assert.deepEqual(list('limit=1&offset=1'), { items: [list('').items[1]], total: 3, limit: 1, offset: 1 });
    assert.equal(list('limit=0').items.length, 1, 'a limit of 0 is held to 1');
    assert.deepEqual(list('order=asc').items.map(s => s.id), ['a', 'b', 'c']);
    assert.deepEqual(list('grinderId=g1&orderBy=timestamp').items.map(s => s.id), ['b', 'a'], 'orderBy is ignored');
    assert.deepEqual(list('ids=a,c').map(s => s.id), ['c', 'a']);
    assert.ok(list('ids=a')[0].measurements);
    assert.equal(shots.answer('GET', '', new URLSearchParams('ids=a&grinderId=g1')).status, 400);
    assert.equal(shots.answer('GET', '', new URLSearchParams('search=x')), null, 'a filter the model does not keep has no answer');
    assert.equal(shots.answer('GET', '/latest', new URLSearchParams()).body.id, 'c');
    assert.equal(shots.answer('GET', '/nope', new URLSearchParams()).status, 404);
});

test('Shots: an edit is merged, a note cleared is "", shotNotes follows the note, and updatedAt moves only on a change', () => {
    const shots = createShots([{ id: 'a', timestamp: 't', createdAt: 'c', updatedAt: 'before', measurements: [], workflow: {}, annotations: { actualYield: 30 } }], () => 'after');
    const put = body => shots.answer('PUT', '/a', new URLSearchParams(), body);
    const rated = put({ annotations: { enjoyment: 8, espressoNotes: 'Good' } }).body;
    assert.deepEqual(rated.annotations, { actualYield: 30, enjoyment: 8, espressoNotes: 'Good' });
    assert.equal(rated.shotNotes, 'Good');
    assert.equal(rated.updatedAt, 'after');
    const cleared = put({ annotations: { espressoNotes: null, enjoyment: null } }).body;
    assert.deepEqual(cleared.annotations, { actualYield: 30, espressoNotes: '' });
    assert.equal(put({ annotations: { enjoyment: 11 } }).status, 400);
    assert.equal(put({ measurements: [] }).status, 400);
    assert.equal(shots.answer('PUT', '/none', new URLSearchParams(), {}).status, 404);
});

test('grinders: the archived only when asked for, the most recently changed first; one by id, or 404', () => {
    const library = createLibrary({
        grinders: [{ id: 'g1', model: 'Old', updatedAt: '2026-01-01' }, { id: 'g2', model: 'New', updatedAt: '2026-02-01' }, { id: 'g3', model: 'Gone', archived: true, updatedAt: '2026-03-01' }],
        batches: { bean: [{ id: 'b1', roastDate: 'r' }] },
    });
    const ask = search => library.answer('GET', '/grinders', new URLSearchParams(search)).body.map(g => g.id);
    assert.deepEqual(ask(''), ['g2', 'g1']);
    assert.deepEqual(ask('includeArchived=false'), ['g2', 'g1']);
    assert.deepEqual(ask('includeArchived=true'), ['g3', 'g2', 'g1']);
    assert.equal(library.answer('GET', '/grinders/g1', new URLSearchParams()).body.model, 'Old');
    assert.equal(library.answer('GET', '/grinders/none', new URLSearchParams()).status, 404);
    assert.equal(library.answer('GET', '/bean-batches/b1', new URLSearchParams()).body.roastDate, 'r');
});

test('beans: the archived only when asked for, the most recently changed first; a bean\'s batches the same, none for a bean not there', () => {
    const library = createLibrary({
        beans: [{ id: 'n1', name: 'Old', updatedAt: '2026-01-01' }, { id: 'n2', name: 'New', updatedAt: '2026-02-01' }, { id: 'n3', name: 'Gone', archived: true, updatedAt: '2026-03-01' }],
        batches: { n1: [{ id: 'b1', beanId: 'n1', updatedAt: '2026-01-01' }, { id: 'b2', beanId: 'n1', updatedAt: '2026-02-01' }, { id: 'b3', beanId: 'n1', archived: true, updatedAt: '2026-03-01' }], n2: [{ id: 'b4', beanId: 'n2', updatedAt: '2026-01-01' }] },
    });
    const ask = (path, search = '') => library.answer('GET', path, new URLSearchParams(search)).body.map(row => row.id);
    assert.deepEqual(ask('/beans'), ['n2', 'n1']);
    assert.deepEqual(ask('/beans', 'includeArchived=true'), ['n3', 'n2', 'n1']);
    assert.deepEqual(ask('/beans/n1/batches'), ['b2', 'b1']);
    assert.deepEqual(ask('/beans/n1/batches', 'includeArchived=true'), ['b3', 'b2', 'b1']);
    assert.deepEqual(ask('/beans/none/batches', 'includeArchived=true'), []);
    assert.equal(library.answer('POST', '/beans', new URLSearchParams()), null, 'a write has no answer');
});

test('DYE2: save-recipe names a recipe from its profile\'s first word and its bean, puts it in the slot asked for, and loads it', () => {
    assert.equal(proposeRecipeName({ profile: { title: 'Adaptive v3' }, context: { coffeeName: 'Sample Blend' } }), 'Adaptive Sample Blend');
    assert.equal(proposeRecipeName({ profile: { title: 'Default' }, context: { coffeeName: 'Bean' } }, ['bean']), 'Bean 2', 'a word that says nothing is left out, a name taken counts');
    assert.equal(proposeRecipeName({ profile: { title: 'Custom' }, context: {} }, [], '', START), 'Recipe 18 Nov', 'no bean: the day');
    const fake = fresh();
    const pushes = [];
    fake.connect('/ws/v1/plugins/dye2.reaplugin/changed', text => pushes.push(JSON.parse(text)));
    fake.flush();
    const adaptive = fake.store.get('dye2.reaplugin', 'recipes').find(row => row.name === 'Single origin').workflow.profile;
    send(fake, 'PUT', '/api/v1/workflow', { profile: adaptive, context: { coffeeName: 'Sample Blend' } });
    const holder = fake.store.get('dye2.reaplugin', 'recipes').find(row => row.stripSlot === 3);
    fake.flush();
    pushes.length = 0;
    const made = send(fake, 'POST', '/api/v1/plugins/dye2.reaplugin/save-recipe', { slot: 3 });
    fake.flush();
    assert.equal(made.status, 200);
    assert.equal(made.body.name, 'Adaptive Sample Blend');
    assert.match(made.body.id, /^recipe-[0-9a-z]+$/);
    const rows = fake.store.get('dye2.reaplugin', 'recipes');
    const row = rows.find(r => r.id === made.body.id);
    assert.equal(row.stripSlot, 3);
    assert.equal(row.title, 'Adaptive Sample Blend');
    assert.equal(row.profileTitle, adaptive.title);
    assert.equal(rows.find(r => r.id === holder.id).stripSlot, null, 'the slot\'s holder keeps its row and loses the slot');
    assert.equal(fake.selection().id, made.body.id, 'loaded');
    assert.equal(fake.workflow().context.extras.dye.recipeId, made.body.id);
    assert.ok(pushes.length > 0, 'a push');
    const named = send(fake, 'POST', '/api/v1/plugins/dye2.reaplugin/save-recipe', { name: ' Typed ', slot: 9 });
    assert.equal(named.body.name, 'Typed');
    assert.equal(fake.store.get('dye2.reaplugin', 'recipes').find(r => r.id === named.body.id).stripSlot, null, 'no slot past 5');
});

test('DYE2: a list its record read, written back, loses a record written since; started again, it keeps the recipe loaded', () => {
    const fake = fresh();
    const house = houseRecord(fake);
    send(fake, 'PUT', '/api/v1/workflow', applied(house));
    send(fake, 'POST', '/api/v1/plugins/dye2.reaplugin/selection', { kind: 'recipe', id: house.id });
    const adaptive = fake.store.get('dye2.reaplugin', 'recipes').find(row => row.name === 'Single origin').workflow.profile;
    const writeBack = fake.dye2RecordReads();
    const moved = fake.store.get('dye2.reaplugin', 'recipes').map(row => (row.id === house.id ? { ...row, profileTitle: adaptive.title, profileSnapshot: adaptive, workflow: { ...row.workflow, profile: adaptive } } : row));
    send(fake, 'POST', '/api/v1/store/dye2.reaplugin/recipes', moved);
    send(fake, 'PUT', '/api/v1/workflow', { profile: adaptive });
    assert.equal(fake.selection().id, house.id, 'the record first, then the Workflow: still loaded');
    fake.restartDye2();
    assert.equal(fake.selection().id, house.id, 'started again, still loaded');
    writeBack();
    assert.equal(houseRecord(fake).profileTitle, house.profileTitle, 'the list as it was read');
    fake.restartDye2();
    assert.equal(fake.selection().id, house.id, 'started again with the record on another profile: still loaded, as on the pinned stack');
    // Started again, DYE2 noted no profile: the next change of profile is the one it notes, and keeps the recipe.
    // The model's reading, not recorded (dye2.js, `restart()`).
    send(fake, 'PUT', '/api/v1/workflow', { profile: { ...adaptive, title: 'A third profile' } });
    assert.equal(fake.selection().id, house.id, 'a first change of profile after a restart keeps the recipe loaded');
});

test('machine: its calibration as the simulated machine reports it; an unknown target or source refused', () => {
    const fake = fresh();
    assert.deepEqual(get(fake, '/api/v1/machine/calibration/temperature?source=current').body, { target: 'temperature', source: 'current', de1ReportedValue: 0, measuredValue: 93 });
    assert.deepEqual(get(fake, '/api/v1/machine/calibration/pressure').body, { target: 'pressure', source: 'current', de1ReportedValue: 1, measuredValue: 9 });
    assert.equal(get(fake, '/api/v1/machine/calibration/flow?source=factory').body.measuredValue, 1);
    assert.equal(get(fake, '/api/v1/machine/calibration/weight').status, 400);
    assert.equal(get(fake, '/api/v1/machine/calibration/constructor').status, 400, 'an object\'s own keys only');
    assert.equal(get(fake, '/api/v1/machine/calibration/flow?source=other').status, 400);
    assert.equal(fake.request({ method: 'PUT', url: '/api/v1/machine/calibration/flow', body: {} }), null, 'a write has no answer');
});

test('machine: the recorded pour is replayed at the page\'s time, and Decaid stores its Shot with the Workflow as it is then', () => {
    const fake = fresh();
    const frames = [];
    fake.connect('/ws/v1/machine/snapshot', text => frames.push(JSON.parse(text)));
    fake.flush();
    assert.equal(frames[0].state.state, 'idle', 'a socket opens on the machine at rest');
    frames.length = 0;
    fake.setNow(START + 60_000);
    const id = fake.startPour();
    fake.playPour(1000);
    fake.flush();
    assert.ok(frames.length > 0 && frames.every(f => f.timestamp.startsWith('2026-11-18T14:01:0')), 'each frame at the page\'s time');
    assert.throws(() => fake.storeShot(), /not finished/);
    fake.finishPour();
    send(fake, 'PUT', '/api/v1/workflow', { context: { targetDoseWeight: 19 } });
    fake.storeShot();
    const shot = get(fake, `/api/v1/shots/${id}`).body;
    assert.equal(shot.workflow.context.targetDoseWeight, 19, 'the Workflow at the end of the pour');
    assert.equal(shot.annotations.actualDoseWeight, 19, 'the dose is the Workflow\'s target');
    assert.ok(shot.timestamp.startsWith('2026-11-18T14:01:00'), 'its time is the pour\'s start');
    assert.equal(get(fake, '/api/v1/shots/latest').body.id, id);
});

test('times: Decaid\'s local time with no offset, moved keeping what Decaid wrote', () => {
    assert.equal(localTime(Date.parse('2026-11-18T14:00:00.123Z'), 'UTC'), '2026-11-18T14:00:00.123000');
    assert.equal(localTime(Date.parse('2026-11-18T14:00:00Z'), 'Europe/Berlin'), '2026-11-18T15:00:00.000000');
    assert.equal(shiftTime('2026-11-18T14:00:00.123456', 1000, 'UTC'), '2026-11-18T14:00:01.123456');
    assert.equal(shiftTime('2026-11-18T14:00:00.123', 1000, 'UTC'), '2026-11-18T14:00:01.123');
    assert.equal(shiftTime('2026-11-18T14:00:00.123456Z', -1000, 'UTC'), '2026-11-18T13:59:59.123456Z');
});

test('the sample data\'s Shots are moved so the newest was pulled an hour before the test starts', () => {
    const fake = fresh();
    const newest = get(fake, '/api/v1/shots/latest').body;
    assert.equal(newest.timestamp.slice(0, 16), '2026-11-18T13:00');
});

test('boot: the recorded answers, matched by method, path and query, and a write by its body too; anything else has none', () => {
    const boot = createBoot({ requests: { 'GET /api/v1/profiles?includeHidden=true': { status: 200, body: [1] } }, sockets: { '/ws/v1/devices': { frames: [{ a: 1 }] } } });
    assert.deepEqual(boot.answer('GET', '/api/v1/profiles', new URLSearchParams('includeHidden=true')), { status: 200, body: [1] });
    assert.equal(boot.answer('GET', '/api/v1/profiles', new URLSearchParams()), null);
    assert.deepEqual(boot.socket('/ws/v1/devices'), [{ a: 1 }]);
    assert.equal(boot.socket('/ws/v1/other'), null);
    const writes = createBoot({ requests: {
        'POST /api/v1/settings': { status: 200, body: null, requestBody: '{"gatewayMode":"tracking"}' },
        'POST /api/v1/display/wakelock': { status: 200, body: { on: true }, requestBody: null },
    } });
    assert.deepEqual(writes.answer('POST', '/api/v1/settings', new URLSearchParams(), { gatewayMode: 'tracking' }), { status: 200, body: null });
    assert.equal(writes.answer('POST', '/api/v1/settings', new URLSearchParams(), { gatewayMode: 'full' }), null, 'a write of another body has none');
    assert.deepEqual(writes.answer('POST', '/api/v1/display/wakelock', new URLSearchParams(), undefined), { status: 200, body: { on: true } });
    assert.equal(writes.answer('POST', '/api/v1/display/wakelock', new URLSearchParams(), { on: false }), null);
});

test('a request or socket the model keeps no answer for has none (a machine state no recording asks for among them), and a refusal is answered as the test asked', () => {
    const fake = fresh();
    assert.equal(get(fake, '/api/v1/never/heard/of'), null);
    assert.equal(fake.connect('/ws/v1/never', () => {}), null);
    assert.equal(fake.request({ method: 'PUT', url: '/api/v1/machine/state/expresso' }), null, 'a machine state nothing recorded');
    assert.equal(fake.request({ method: 'PUT', url: '/api/v1/machine/state/sleeping' }).status, 200);
    assert.equal(OWNED('GET', '/api/v1/workflow'), true);
    assert.equal(OWNED('GET', '/api/v1/settings'), false);
    const allow = fake.refuse({ method: 'GET', path: /^\/api\/v1\/grinders/, abort: true });
    assert.deepEqual(get(fake, '/api/v1/grinders'), { abort: true });
    allow();
    assert.equal(get(fake, '/api/v1/grinders').status, 200);
    assert.equal(fake.log.at(-1).path, '/api/v1/grinders');
});
