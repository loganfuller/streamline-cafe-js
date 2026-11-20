// The fake Decaid's rules, one at a time (fake-decaid/; docs/cafe/TESTING.md).
// test/fake-decaid-recordings.test.mjs holds each rule against the pinned
// real stack; these say what each rule is and catch a change to one quickly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { createFakeDecaid, OWNED } from '../fake-decaid/index.js';
import { updateWorkflow, deepMerge } from '../fake-decaid/workflow.js';
import { createStore } from '../fake-decaid/store.js';
import { deriveSelection, recipeModified, profileFingerprint, proposeRecipeName, itemPatch, profileAtBrewC } from '../fake-decaid/dye2.js';
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
    assert.equal(selection.body.id, record.id, 'enabled again, DYE2 reads the Workflow afresh, as restartDye2() does (recordings/dye2-restart.json; no recording writes one while DYE2 is off)');
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

// ── DYE2's record ────────────────────────────────────────────────────────────

const RECORD = '/api/v1/plugins/dye2.reaplugin/record';
const recordsOf = fake => fake.store.get('dye2.reaplugin', 'recipes');
/** A fake with House espresso loaded as the page loads it, and DYE2's pushes from then. */
function houseLoaded(make = fresh) {
    const fake = make();
    const house = houseRecord(fake);
    send(fake, 'PUT', '/api/v1/workflow', applied(house));
    send(fake, 'POST', '/api/v1/plugins/dye2.reaplugin/selection', { kind: 'recipe', id: house.id });
    const pushes = [];
    fake.connect('/ws/v1/plugins/dye2.reaplugin/changed', text => pushes.push(JSON.parse(text)));
    fake.flush();
    return { fake, house, pushes };
}
/** Every row but `id`'s as it was, and `id`'s fields outside `dashboardVariables` and `workflow` too. */
function onlyRowChanged(before, after, id) {
    assert.equal(after.length, before.length);
    for (const [index, row] of before.entries()) {
        if (row.id !== id) { assert.deepEqual(after[index], row, `${row.name} as it was`); continue; }
        const { dashboardVariables: _d, workflow: _w, ...rest } = after[index];
        const { dashboardVariables: _bd, workflow: _bw, ...was } = row;
        assert.deepEqual(rest, was, `${row.name}'s other fields as they were`);
    }
}

test('DYE2 record: with no recipe loaded it saves nothing and says so', () => {
    const fake = fresh();
    const pushes = [];
    fake.connect('/ws/v1/plugins/dye2.reaplugin/changed', text => pushes.push(JSON.parse(text)));
    fake.flush();
    const before = recordsOf(fake);
    assert.deepEqual(send(fake, 'POST', RECORD, {}), { status: 200, body: { saved: false, reason: 'no recipe is selected' } });
    fake.flush();
    assert.deepEqual(pushes, []);
    assert.deepEqual(recordsOf(fake), before);
});

test('DYE2 record: nothing moved saves nothing; the machine\'s flush is read over the Workflow\'s', () => {
    const { fake, house, pushes } = houseLoaded();
    assert.equal(fake.workflow().rinseData.targetTemperature, 90, 'the Workflow\'s flush');
    assert.equal(house.dashboardVariables.flushTempC, 25, 'the record\'s, which the machine\'s settings hold too');
    assert.deepEqual(send(fake, 'POST', RECORD, {}).body, { saved: false, kind: 'recipe', id: house.id });
    fake.flush();
    assert.deepEqual(pushes, [], 'no push where it wrote nothing');
});

test('DYE2 record: a dose, a yield and a grind setting moved are written into the row and its stored Workflow alone, and pushed', () => {
    const { fake, house, pushes } = houseLoaded();
    const before = recordsOf(fake);
    send(fake, 'PUT', '/api/v1/workflow', { context: { targetDoseWeight: 18.5, targetYield: 38, grinderSetting: '2.6' } });
    fake.flush();
    pushes.length = 0;
    assert.deepEqual(send(fake, 'POST', RECORD, {}).body, { saved: true, kind: 'recipe', id: house.id });
    fake.flush();
    assert.deepEqual(pushes, [{ what: 'workflow' }], 'pushed once: still the recipe, still called changed for its flush');
    const row = houseRecord(fake);
    assert.deepEqual(row.dashboardVariables, { ...house.dashboardVariables, dose: 18.5, drink: 38, grind: 2.6 });
    assert.deepEqual(row.workflow.context, { ...house.workflow.context, targetDoseWeight: 18.5, targetYield: 38, grinderSetting: '2.6' });
    assert.deepEqual({ ...row.workflow, context: null }, { ...house.workflow, context: null }, 'the rest of its stored Workflow as it was');
    onlyRowChanged(before, recordsOf(fake), house.id);
    assert.deepEqual(send(fake, 'POST', RECORD, {}).body.saved, false, 'saved, nothing differs');
});

test('DYE2 record: the brew temperature moved moves every step of the stored profile, not its snapshot, and is armed afresh', () => {
    const { fake, house } = houseLoaded();
    const profile = house.workflow.profile;
    const warmer = { ...profile, steps: profile.steps.map(step => ({ ...step, temperature: step.temperature + 2 })) };
    send(fake, 'PUT', '/api/v1/workflow', { profile: warmer });
    assert.equal(fake.selection().id, house.id, 'a temperature is not another profile');
    assert.equal(send(fake, 'POST', RECORD, {}).body.saved, true);
    const row = houseRecord(fake);
    assert.equal(row.dashboardVariables.brewC, profile.steps[0].temperature + 2);
    assert.deepEqual(row.workflow.profile.steps.map(step => step.temperature), profile.steps.map(step => step.temperature + 2));
    assert.deepEqual(row.profileSnapshot, house.profileSnapshot);
    assert.equal(send(fake, 'POST', RECORD, {}).body.saved, false, 'the armed temperature is the saved one now');
    assert.deepEqual(profileAtBrewC({ steps: [{ temperature: 94 }, { temperature: 90 }, { temperature: 'x' }] }, 92).steps.map(s => s.temperature), [92, 88, 92]);
    assert.equal(profileAtBrewC({ steps: [] }, null), null);
});

test('DYE2 record: a basket\'s id and name are written together; a held hot water value is written into the stored Workflow', () => {
    const { fake, house } = houseLoaded();
    send(fake, 'PUT', '/api/v1/workflow', { context: { extras: { basketId: 'bskt-sample-20', basketName: '20 g sample basket' } }, hotWaterData: { volume: 60 } });
    assert.equal(send(fake, 'POST', RECORD, {}).body.saved, true);
    const row = houseRecord(fake);
    assert.equal(row.dashboardVariables.basketId, 'bskt-sample-20');
    assert.equal(row.dashboardVariables.basketName, '20 g sample basket');
    assert.equal(row.workflow.context.extras.basketId, 'bskt-sample-20');
    assert.equal(row.workflow.context.extras.basketName, '20 g sample basket');
    assert.equal(row.dashboardVariables.hotWaterMl, 60);
    assert.equal(row.workflow.hotWaterData.volume, 60);
    // Only the id moved: the name is written with it all the same.
    const stored = { dashboardVariables: { basketId: 'a', basketName: 'Same' } };
    assert.deepEqual(itemPatch(stored, { context: { extras: { basketId: 'b', basketName: 'Same' } } }), { basketId: 'b', basketName: 'Same' });
});

test('DYE2 record: with steam off its temperature and time are held back, the rest written', () => {
    const { fake, house } = houseLoaded();
    send(fake, 'PUT', '/api/v1/workflow', { steamSettings: { targetTemperature: 0, duration: 0, flow: 1.2 }, context: { targetDoseWeight: 19 } });
    assert.equal(send(fake, 'POST', RECORD, {}).body.saved, true);
    const row = houseRecord(fake).dashboardVariables;
    assert.equal(row.steamTempC, house.dashboardVariables.steamTempC);
    assert.equal(row.steamTimeS, house.dashboardVariables.steamTimeS);
    assert.equal(row.steamFlowMls, 1.2, 'the flow is no part of the off state');
    assert.equal(row.dose, 19);
});

test('DYE2 record: a value the record does not hold is written once moved since the apply, and not otherwise; numbers compare as numbers', () => {
    const fake = fresh();
    const rows = recordsOf(fake).map(row => (row.name === 'Decaf'
        ? { ...row, dashboardVariables: Object.fromEntries(Object.entries(row.dashboardVariables).filter(([key]) => !['hotWaterTimeS', 'steamFlowMls'].includes(key))) }
        : row));
    send(fake, 'POST', '/api/v1/store/dye2.reaplugin/recipes', rows);
    const decaf = rows.find(row => row.name === 'Decaf');
    send(fake, 'PUT', '/api/v1/workflow', applied(decaf));
    send(fake, 'POST', '/api/v1/plugins/dye2.reaplugin/selection', { kind: 'recipe', id: decaf.id });
    assert.equal(send(fake, 'POST', RECORD, {}).body.saved, false, 'neither moved: neither adopted');
    send(fake, 'PUT', '/api/v1/workflow', { hotWaterData: { duration: 35 } });
    assert.equal(send(fake, 'POST', RECORD, {}).body.saved, true);
    const row = recordsOf(fake).find(r => r.name === 'Decaf').dashboardVariables;
    assert.equal(row.hotWaterTimeS, 35, 'moved since the apply: adopted');
    assert.equal(row.steamFlowMls, undefined, 'not moved: not adopted');
    assert.deepEqual(itemPatch({ dashboardVariables: { dose: '18.0', basketName: '0' } }, { context: { targetDoseWeight: 18, extras: { basketName: '' } } }), { basketName: '' }, 'a number as text is the same number; two strings compare exactly');
    assert.deepEqual(itemPatch({ dashboardVariables: { rpm: 700 } }, { context: { extras: { rpm: null } } }), {}, 'nothing to write for a value the Workflow lacks');
});

test('DYE2 record: a recipe whose record is gone saves nothing', () => {
    const { fake, house } = houseLoaded();
    send(fake, 'POST', '/api/v1/store/dye2.reaplugin/recipes', recordsOf(fake).filter(row => row.id !== house.id));
    assert.deepEqual(send(fake, 'POST', RECORD, {}).body, { saved: false, reason: 'no recipe is selected' }, 'no Shot names it: no recipe at all');
    // Where a Shot names it, DYE2 still knows the recipe, and has no row to write.
    const sync = served();
    const shotRecipe = sync.shots.get(A).workflow.context.extras.dye.recipeId;
    send(sync, 'PUT', '/api/v1/workflow', { context: { extras: { dye: { recipeId: shotRecipe } } } });
    send(sync, 'POST', '/api/v1/store/dye2.reaplugin/recipes', recordsOf(sync).filter(row => row.id !== shotRecipe));
    assert.deepEqual(send(sync, 'POST', RECORD, {}).body, { saved: false, kind: 'recipe', id: shotRecipe });
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

// ── Decent Sync's plugin (fake-decaid/decent-sync.js) ─────────────────────────

const decentSync = load('decent-sync');
const served = () => createFakeDecaid({ ...recordings, decentSync, now: START });
const PLUGIN = '/api/v1/plugins/decent-sync.reaplugin';
const { A, B, C, D } = decentSync.labels;
const pushesOf = fake => {
    const pushes = [];
    fake.connect('/ws/v1/plugins/decent-sync.reaplugin/changes', text => pushes.push(JSON.parse(text)));
    fake.flush();
    return pushes;
};

test('Decent Sync: absent unless the fake is made with it, and listed and loaded when it is', () => {
    const plain = fresh();
    assert.equal(plain.decentSync, null);
    assert.equal(get(plain, '/api/v1/plugins').body.some(p => p.id === 'decent-sync.reaplugin'), false);
    assert.equal(get(plain, `${PLUGIN}/status`).status, 404, 'a plugin not installed answers 404, as Decaid does');
    const fake = served();
    assert.equal(get(fake, '/api/v1/plugins').body.find(p => p.id === 'decent-sync.reaplugin')?.loaded, true);
    assert.deepEqual(get(fake, `${PLUGIN}/skin`).body, decentSync.skin);
    assert.ok(OWNED('GET', `${PLUGIN}/status`) && OWNED('WS', '/ws/v1/plugins/decent-sync.reaplugin/changes'));
});

test('Decent Sync: status served, then each state it may be in, with its refusal\'s status and fields', () => {
    const fake = served();
    assert.deepEqual(get(fake, `${PLUGIN}/status`), { status: 200, body: decentSync.status });
    const states = {
        captureOnly: [409, true, true, false],
        hardwareMismatch: [409, true, false, false],
        serverTooOld: [503, true, false, false],
        unreachable: [503, false, false, false],
    };
    for (const [state, [status, connected, hasMachine, hasLocation]] of Object.entries(states)) {
        fake.decentSync.setState(state);
        const answer = get(fake, `${PLUGIN}/status`);
        assert.equal(answer.status, status, state);
        assert.equal(answer.body.code, state);
        assert.equal(answer.body.connected, connected, `${state}: connected`);
        assert.equal(answer.body.served, false);
        assert.equal(answer.body.machine !== null, hasMachine, `${state}: its Machine`);
        assert.equal(answer.body.location !== null, hasLocation, `${state}: its Location`);
    }
    fake.decentSync.setState('served');
    fake.decentSync.setSharing(false);
    assert.equal(get(fake, `${PLUGIN}/status`).body.code, 'captureOnly', 'sharing off is a Capture-only Machine');
    assert.deepEqual(get(fake, `${PLUGIN}/status`).body.location, decentSync.status.location, 'still at its Location');
    assert.equal(get(fake, `${PLUGIN}/shots`).status, 409, 'and every endpoint that asks the server is refused so');
});

test('Decent Sync: the Location\'s Shots, newest first, paged by a cursor; the tablet\'s and another Machine\'s', () => {
    const fake = served();
    const all = get(fake, `${PLUGIN}/shots?limit=50`).body;
    assert.deepEqual(all.shots.map(row => row.id).sort(), [A, B, C, D].sort(), 'the sample data\'s Shots, pulled before the Machine joined, are not listed');
    assert.equal(all.nextCursor, null);
    const times = all.shots.map(row => row.pulledAt);
    assert.deepEqual(times, [...times].sort().reverse(), 'newest first');
    assert.deepEqual(all.shots.map(row => row.onThisTablet), all.shots.map(row => row.id === A || row.id === B));
    assert.equal(all.shots.find(row => row.id === D).unfinished, true);
    const first = get(fake, `${PLUGIN}/shots?limit=3`).body;
    const next = get(fake, `${PLUGIN}/shots?limit=3&cursor=${encodeURIComponent(first.nextCursor)}`).body;
    assert.deepEqual([...first.shots, ...next.shots].map(row => row.id), all.shots.map(row => row.id));
    assert.equal(next.nextCursor, null);
    for (const query of ['limit=0', 'limit=51', 'limit=x', 'cursor=nope']) assert.equal(get(fake, `${PLUGIN}/shots?${query}`).status, 400, query);
    assert.equal(get(fake, `${PLUGIN}/shot?id=${C}`).body.shot.id, C, 'another Machine\'s Shot whole');
    assert.equal(get(fake, `${PLUGIN}/shot?id=${recordings.sampleData.shots[0].id}`).status, 404, 'one the list doesn\'t list is noSuchShot');
});

test('Decent Sync: a Reference Shot chosen by DYE2 record id, pushed for a slotted Recipe, and answered from the copy while out of reach', () => {
    const fake = served();
    const pushes = pushesOf(fake);
    const house = houseRecord(fake).id;
    assert.equal(get(fake, `${PLUGIN}/reference?recipe=${house}`).body.reference, null);
    const chosen = send(fake, 'PUT', `${PLUGIN}/reference?recipe=${house}`, { shotId: A });
    assert.equal(chosen.status, 200);
    assert.equal(chosen.body.reference.shot.id, A);
    assert.equal(chosen.body.source, 'server');
    assert.equal(chosen.body.reference.profileDiffers, false);
    fake.flush();
    assert.deepEqual(pushes.map(p => p.what), ['reference']);
    assert.equal(send(fake, 'PUT', `${PLUGIN}/reference?recipe=${house}`, { shotId: B }).body.reference.profileDiffers, true, 'B was pulled on another Profile');
    assert.equal(send(fake, 'PUT', `${PLUGIN}/reference?recipe=${house}`, { shotId: recordings.sampleData.shots[0].id }).status, 404);
    assert.equal(send(fake, 'PUT', `${PLUGIN}/reference?recipe=${house}`, {}).status, 400, 'a tablet can\'t clear one');
    assert.equal(get(fake, `${PLUGIN}/reference?recipe=no-such-record`).status, 404);
    fake.decentSync.stopServer();
    const copy = get(fake, `${PLUGIN}/reference?recipe=${house}`);
    assert.equal(copy.body.source, 'tablet');
    assert.equal(copy.body.reference.shot.id, B);
    assert.equal(send(fake, 'PUT', `${PLUGIN}/reference?recipe=${house}`, { shotId: A }).status, 503, 'no choice is kept for later');
    fake.flush();
    assert.deepEqual(pushes.at(-1), { what: 'connection', connected: false });
    fake.decentSync.setState('serverTooOld');
    assert.equal(get(fake, `${PLUGIN}/reference?recipe=${house}`).body.source, 'tablet', 'a server too old to ask is answered from the copy too');
    fake.decentSync.setState('hardwareMismatch');
    assert.equal(get(fake, `${PLUGIN}/reference?recipe=${house}`).status, 409, 'a Machine the server refuses gets no copy');
});

test('Decent Sync: an edit of the tablet\'s own Shot goes through Decaid whatever the server; another Machine\'s through the server, now or not at all', () => {
    const fake = served();
    fake.decentSync.stopServer();
    const own = send(fake, 'PUT', `${PLUGIN}/shot?id=${A}`, { rating: 8, note: 'Sample note' });
    assert.deepEqual(own, { status: 200, body: { rating: 8, note: 'Sample note' } });
    assert.equal(fake.shots.get(A).annotations.enjoyment, 8, 'written into Decaid\'s Shot');
    assert.equal(send(fake, 'PUT', `${PLUGIN}/shot?id=${C}`, { rating: 6 }).status, 503);
    fake.decentSync.startServer();
    assert.deepEqual(send(fake, 'PUT', `${PLUGIN}/shot?id=${C}`, { rating: 6 }).body, { rating: 6, note: null });
    for (const body of [{}, { rating: 11 }, { rating: 4, extra: 1 }, { note: null }, { note: '\ud800' }, { note: 'a\udc00b' }]) assert.equal(send(fake, 'PUT', `${PLUGIN}/shot?id=${A}`, body).status, 400, JSON.stringify(body));
    assert.equal(send(fake, 'PUT', `${PLUGIN}/shot?id=no-such-shot`, { rating: 2 }).status, 404);
});

test('Decent Sync: what the server does reaches the page as pushes; a plugin never connected holds no copy', () => {
    const fake = served();
    const pushes = pushesOf(fake);
    const house = houseRecord(fake).id;
    fake.decentSync.chooseReference(house, A);
    fake.decentSync.renameRecipe(house, 'House espresso renamed');
    fake.decentSync.editShot(A, { rating: 7, note: 'Server note' });
    fake.flush();
    assert.deepEqual(pushes.map(p => p.recipe.name), ['House espresso', 'House espresso renamed', 'House espresso renamed']);
    assert.equal(fake.shots.get(A).annotations.espressoNotes, 'Server note', 'the tablet\'s own Shot is written as the plugin writes it');

    const cold = served();
    const coldPushes = pushesOf(cold);
    cold.decentSync.firstStart();
    assert.equal(get(cold, `${PLUGIN}/reference?recipe=${houseRecord(cold).id}`).status, 503, 'no copy to answer from');
    cold.decentSync.startServer();
    cold.flush();
    assert.deepEqual(coldPushes[0], { what: 'connection', connected: true });
    assert.equal(coldPushes.filter(p => p.what === 'reference').length, decentSync.server.recipes.filter(r => r.slot).length, 'each copy comes, and is pushed');
});

test('Decent Sync: a Machine not served holds no copy and hears no push of what the server does', () => {
    const fake = served();
    const pushes = pushesOf(fake);
    const house = houseRecord(fake).id;
    fake.decentSync.setSharing(false);
    fake.decentSync.chooseReference(house, C);
    fake.decentSync.renameRecipe(house, 'House espresso renamed');
    fake.flush();
    assert.deepEqual(pushes, [], 'sharing off, nothing is pushed');
    fake.decentSync.stopServer();
    assert.equal(get(fake, `${PLUGIN}/reference?recipe=${house}`).status, 503, 'and out of reach there is no copy to answer from');
    fake.decentSync.startServer();
    fake.decentSync.setSharing(true);
    fake.flush();
    assert.equal(pushes.filter(p => p.what === 'reference').length, decentSync.server.recipes.filter(r => r.slot).length, 'sharing on again, every copy comes');
    assert.equal(get(fake, `${PLUGIN}/reference?recipe=${house}`).body.reference.shot.id, C, 'with what was chosen meanwhile');
});

test('Decent Sync: a Shot stored while the server is out of reach joins the Location\'s Shots once it is back', () => {
    const fake = served();
    fake.decentSync.stopServer();
    fake.startPour();
    fake.finishPour();
    const id = fake.storeShot();
    fake.decentSync.startServer();
    assert.equal(get(fake, `${PLUGIN}/shots?limit=1`).body.shots[0].id, id);

    // Sharing turned off meanwhile: reported, but listed nowhere.
    const off = served();
    off.decentSync.stopServer();
    off.startPour();
    off.finishPour();
    const unshared = off.storeShot();
    off.decentSync.setSharing(false);
    off.decentSync.startServer();
    off.decentSync.setSharing(true);
    assert.equal(get(off, `${PLUGIN}/shots?limit=50`).body.shots.some(row => row.id === unshared), false);
});

test('Decent Sync: a Shot stored on the tablet joins the Location\'s Shots, with its duration past the Preheat', () => {
    const fake = served();
    fake.startPour();
    fake.finishPour();
    const id = fake.storeShot();
    const row = get(fake, `${PLUGIN}/shots?limit=1`).body.shots[0];
    assert.equal(row.id, id);
    assert.equal(row.onThisTablet, true);
    assert.ok(row.duration > 10 && row.duration < 40, `a duration in seconds: ${row.duration}`);
});

// ── Decent Sync's plugin: the save into the Loaded Recipe ────────────────────

/** A served fake with House espresso loaded as the page loads it; DYE2's pushes from then. */
const servedHouse = () => houseLoaded(served);
const stepDose = (fake, dose) => send(fake, 'PUT', '/api/v1/workflow', { context: { targetDoseWeight: dose } });

test('Decent Sync save: a Workflow change with a Recipe loaded is saved into it at the next flush, and DYE2 pushes', () => {
    const { fake, house, pushes } = servedHouse();
    const mark = fake.log.length;
    stepDose(fake, 18.5);
    assert.equal(houseRecord(fake).dashboardVariables.dose, house.dashboardVariables.dose, 'nothing before the flush');
    fake.flush();
    assert.equal(houseRecord(fake).dashboardVariables.dose, 18.5, 'saved into the record');
    assert.equal(houseRecord(fake).workflow.context.targetDoseWeight, 18.5);
    assert.deepEqual(pushes, [{ what: 'workflow' }], 'DYE2 pushed on changed');
    assert.deepEqual(fake.log.slice(mark).map(entry => `${entry.method} ${entry.path}`), ['PUT /api/v1/workflow'], 'the plugin\'s ask is not in the log');
    // Two changes before a flush: one save covers both.
    pushes.length = 0;
    stepDose(fake, 19);
    send(fake, 'PUT', '/api/v1/workflow', { context: { targetYield: 40 } });
    fake.flush();
    assert.equal(houseRecord(fake).dashboardVariables.dose, 19);
    assert.equal(houseRecord(fake).dashboardVariables.drink, 40);
    assert.deepEqual(pushes, [{ what: 'workflow' }], 'one save');
});

test('Decent Sync save: none for the change that loads a recipe, none after a change of profile, none with no recipe loaded', () => {
    const fake = served();
    const before = JSON.stringify(recordsOf(fake));
    const house = houseRecord(fake);
    // The apply moves the dose off the record's, and loads it: a load saves nothing.
    send(fake, 'PUT', '/api/v1/workflow', { ...applied(house), context: { ...applied(house).context, targetDoseWeight: 21 } });
    fake.flush();
    assert.equal(JSON.stringify(recordsOf(fake)), before, 'a load');
    // A change of profile, with the dose moved in the same write: DYE2 clears the recipe, the plugin saves nothing.
    const other = recordsOf(fake).find(row => row.name === 'Single origin').workflow.profile;
    send(fake, 'PUT', '/api/v1/workflow', { profile: other, context: { targetDoseWeight: 22 } });
    fake.flush();
    assert.equal(JSON.stringify(recordsOf(fake)), before, 'a change of profile');
    assert.equal(fake.selection()?.kind === 'recipe' ? fake.selection().id : null, null, 'DYE2 cleared the recipe');
    stepDose(fake, 23);
    fake.flush();
    assert.equal(JSON.stringify(recordsOf(fake)), before, 'no recipe loaded');
});

test('Decent Sync save: none for a recipe whose record carries no Recipe of the Location', () => {
    const fake = served();
    const house = houseRecord(fake);
    const { decentSyncId: _dropped, ...local } = house;
    send(fake, 'POST', '/api/v1/store/dye2.reaplugin/recipes', recordsOf(fake).map(row => (row.id === house.id ? local : row)));
    send(fake, 'PUT', '/api/v1/workflow', applied(local));
    fake.flush();
    const before = JSON.stringify(recordsOf(fake));
    stepDose(fake, 18.5);
    fake.flush();
    assert.equal(JSON.stringify(recordsOf(fake)), before);
});

test('Decent Sync save: none on a Capture-only Machine or with DYE2 disabled; saved on through an outage', () => {
    for (const [what, make] of [
        ['sharing off', fake => fake.decentSync.setSharing(false)],
        ['Capture-only', fake => fake.decentSync.setState('captureOnly')],
        ['DYE2 disabled', fake => fake.disableDye2()],
    ]) {
        const { fake, house } = servedHouse();
        make(fake);
        stepDose(fake, 18.5);
        fake.flush();
        assert.equal(houseRecord(fake).dashboardVariables.dose, house.dashboardVariables.dose, what);
    }
    const { fake } = servedHouse();
    fake.decentSync.stopServer();
    stepDose(fake, 18.5);
    fake.flush();
    assert.equal(houseRecord(fake).dashboardVariables.dose, 18.5, 'the server out of reach: the plugin keeps saving on the tablet');
    // Sharing turned off while out of reach reaches the plugin only once it is connected.
    fake.decentSync.setSharing(false);
    stepDose(fake, 19);
    fake.flush();
    assert.equal(houseRecord(fake).dashboardVariables.dose, 19, 'it has not heard yet');
    fake.decentSync.startServer();
    stepDose(fake, 20);
    fake.flush();
    assert.equal(houseRecord(fake).dashboardVariables.dose, 19, 'heard on connecting: Capture-only');
});

test('Decent Sync save: a fake made without the plugin saves nothing on a Workflow change', () => {
    const { fake, house } = houseLoaded();
    stepDose(fake, 18.5);
    fake.flush();
    assert.equal(houseRecord(fake).dashboardVariables.dose, house.dashboardVariables.dose);
});
