// The public preview's sample cafe (preview/sample-cafe.js; #88): what the
// seed makes, worked out with no browser, and the fake Decaid made from it.
// What the page shows of it is test/page/preview-cafe.spec.mjs's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import { BARISTAS, NOTES, NO_SHOTS, RECIPE_POURS, referenceIds, sampleCafe, seededShots, variationOf } from '../preview/sample-cafe.js';
import { createFakeDecaid } from '../fake-decaid/index.js';
import { isUnfinished } from '../src/cafe/shot-model.js';
import { shotNumbers, shotSamples } from '../src/cafe/comparison.js';

const ROOT = new URL('../', import.meta.url);
const load = name => JSON.parse(readFileSync(new URL(`fake-decaid/recordings/${name}.json`, ROOT), 'utf8'));
const RECORDED = { sampleData: load('sample-data'), boot: load('boot'), simulated: load('pour'), real: load('real/de1pro-pour') };
const DECENT_SYNC = load('decent-sync');
const served = () => sampleCafe({ ...RECORDED, decentSync: DECENT_SYNC });
const tablet = () => sampleCafe(RECORDED);
const NOW = Date.parse('2026-11-18T19:00:00Z');
const DYE2 = 'dye2.reaplugin';
const records = made => made.sampleData.store[DYE2].recipes;
const POURS = { real: RECORDED.real, simulated: RECORDED.simulated };
const seeded = made => seededShots({ records: records(made), pours: POURS });
const readUtc = text => Date.parse(/[zZ]$/.test(text) ? text : `${text.slice(0, 23)}Z`);
const recipeOf = shot => shot.workflow.context.extras.dye.recipeId;

test('the same on every run, and nothing it was given is changed', () => {
    const given = JSON.stringify({ ...RECORDED, DECENT_SYNC });
    assert.deepEqual(served(), served());
    assert.deepEqual(tablet(), tablet());
    assert.equal(JSON.stringify({ ...RECORDED, DECENT_SYNC }), given, 'the recordings as they were');
    assert.deepEqual(variationOf(3), variationOf(3));
});

test('about thirty Shots over four days, from both recorded pours, some Unfinished, this Machine\'s and the second\'s', () => {
    const all = seeded(served());
    assert.ok(all.length >= 28 && all.length <= 34, `about thirty (${all.length})`);
    const times = all.map(entry => readUtc(entry.shot.timestamp));
    assert.ok((Math.max(...times) - Math.min(...times)) / 86_400_000 >= 3, 'over several days');
    assert.equal(new Set(all.map(entry => entry.shot.id)).size, all.length, 'each its own id');
    assert.equal(new Set(times).size, all.length, 'each at its own time');
    assert.deepEqual([...new Set(all.map(entry => entry.machine))].sort(), ['this', 'two']);
    const unfinished = all.filter(entry => entry.unfinished);
    assert.equal(unfinished.length, 3);
    for (const entry of all) assert.equal(isUnfinished(entry.shot), entry.unfinished, `${entry.shot.id}: the page calls it Unfinished only where the seed stopped it early`);
    for (const pour of ['Best practice (light roast)', 'Default']) assert.ok(all.some(entry => entry.shot.workflow.profile.title === pour), `Shots from the pour on ${pour}`);
    const newest = all.find(entry => readUtc(entry.shot.timestamp) === Math.max(...times));
    assert.equal(newest.machine, 'this', 'the newest is this Machine\'s, so the fake dates it an hour before the page opened');
    assert.equal(newest.recipe, 'House espresso');
    assert.equal(newest.unfinished, false);
});

test('every Shot\'s curve differs from its recipe\'s reference, and the variation is a few percent', () => {
    const made = served();
    const all = seeded(made);
    const references = referenceIds(all);
    for (const entry of all) {
        for (const factor of Object.values(entry.variation)) {
            assert.ok(factor !== 1 && Math.abs(factor - 1) <= 0.05, `${entry.shot.id}: a factor of ${factor}`);
        }
        const referenceId = references[entry.recipe];
        if (!referenceId || referenceId === entry.shot.id || entry.unfinished) continue;
        const reference = all.find(other => other.shot.id === referenceId);
        const [a, b] = [shotNumbers(entry.shot), shotNumbers(reference.shot)];
        assert.notDeepEqual(a, b, `${entry.shot.id}: its numbers differ from its reference's`);
        assert.notDeepEqual(shotSamples(entry.shot.measurements).map(s => s.pressure), shotSamples(reference.shot.measurements).map(s => s.pressure), `${entry.shot.id}: its pressure curve too`);
    }
    // The pair the page opens on, apart by hand.
    const house = all.find(entry => entry.recipe === 'House espresso' && entry.machine === 'this');
    const houseReference = all.find(entry => entry.shot.id === references['House espresso']);
    const [latest, reference] = [shotNumbers(house.shot), shotNumbers(houseReference.shot)];
    assert.ok(Math.abs(latest.time - reference.time) >= 2, 'the latest and the reference run seconds apart');
    assert.ok(Math.abs(latest.yield - reference.yield) >= 2, 'and grams');
});

test('no value leaves what the page\'s comparison takes as believable: no negative weight or pressure, no time running backwards', () => {
    for (const entry of seeded(served())) {
        const { shot } = entry;
        for (const series of ['machine', 'scale']) {
            const times = shot.measurements.map(m => m[series]?.timestamp).filter(Boolean).map(readUtc);
            assert.ok(times.every((t, i) => i === 0 || t >= times[i - 1]), `${shot.id}: the ${series}'s times run forward`);
            assert.ok(times.every(Number.isFinite), `${shot.id}: the ${series}'s times are times`);
        }
        for (const m of shot.measurements) {
            assert.ok(m.scale.weight >= 0 && m.machine.pressure >= 0 && m.machine.flow >= 0, `${shot.id}: no negative reading`);
            for (const value of [m.scale.weight, m.scale.weightFlow, m.machine.pressure, m.machine.flow]) assert.ok(Number.isFinite(value));
        }
        const numbers = shotNumbers(shot);
        assert.ok(numbers.time > 0, `${shot.id}: a time`);
        assert.ok(numbers.dose > 0, `${shot.id}: a dose`);
        if (!entry.unfinished) {
            assert.ok(numbers.firstDrip > 0 && numbers.firstDrip < numbers.time, `${shot.id}: a first drip inside the shot`);
            assert.ok(numbers.yield > numbers.dose && numbers.ratio > 1 && numbers.ratio < 3, `${shot.id}: an espresso's ratio`);
            assert.ok(numbers.peak > 5 && numbers.peak < 12, `${shot.id}: a peak pressure a machine makes`);
        }
        assert.ok(readUtc(shot.createdAt) > readUtc(shot.measurements.at(-1).machine.timestamp), `${shot.id}: stored after its last sample`);
    }
});

test('no name in it is outside the invented set', () => {
    const recipes = new Set(records(served()).map(record => record.name));
    const allowed = /\b(Sample|Example|Second|sample)\b/;
    for (const entry of seeded(served())) {
        const context = entry.shot.workflow.context;
        assert.ok(BARISTAS.includes(context.baristaName), `${context.baristaName} is the seed's`);
        if (entry.shot.annotations.espressoNotes !== undefined) assert.ok(NOTES.includes(entry.shot.annotations.espressoNotes));
        assert.ok(recipes.has(entry.recipe));
        for (const value of [context.coffeeName, context.coffeeRoaster, context.grinderModel, context.extras.basketName].filter(Boolean)) {
            assert.match(value, allowed, `"${value}" is the sample data's manner`);
        }
    }
    for (const name of BARISTAS) assert.match(name, allowed);
    const two = served().decentSync.server.others.map(other => other.machine.name);
    assert.deepEqual([...new Set(two)], ['Sample Machine Two']);
});

test('the recipes sit on the profile, dose and yield of the pour their Shots come from; Filter has none', () => {
    const made = served();
    const byPour = { real: RECORDED.real.shot.workflow, simulated: RECORDED.simulated.shot.workflow };
    for (const record of records(made)) {
        const pour = byPour[RECIPE_POURS[record.name]];
        const shots = seeded(made).filter(entry => entry.recipe === record.name);
        if (record.name === NO_SHOTS) {
            assert.equal(shots.length, 0, 'Filter has no Shots');
            assert.equal(pour, undefined);
            continue;
        }
        assert.ok(shots.length > 0, `${record.name} has Shots`);
        assert.equal(record.profileTitle, pour.profile.title);
        assert.equal(record.workflow.profile.title, pour.profile.title);
        assert.equal(record.dashboardVariables.dose, pour.context.targetDoseWeight);
        assert.equal(record.dashboardVariables.drink, pour.context.targetYield);
        assert.equal(record.dashboardVariables.brewC, pour.profile.steps[0].temperature);
        // Every Shot but the guest roast's oldest, pulled before it moved, on the recipe's own profile.
        const others = shots.filter(entry => entry.shot.workflow.profile.title !== pour.profile.title);
        assert.deepEqual(others.map(entry => entry.recipe), record.name === 'Guest roast with a long name' ? [record.name] : []);
        for (const entry of shots) assert.equal(recipeOf(entry.shot), record.id);
    }
    // Each record holds the sample machine's steam, hot water and flush.
    const machine = RECORDED.sampleData.workflow;
    for (const record of records(made)) {
        assert.equal(record.dashboardVariables.flushTempC, machine.rinseData.targetTemperature);
        assert.equal(record.dashboardVariables.steamTempC, machine.steamSettings.targetTemperature);
    }
});

test('a reference on four of the six recipes, never the latest, and the guest roast\'s pulled on another profile', () => {
    const all = seeded(served());
    const references = referenceIds(all);
    assert.deepEqual(Object.keys(references).sort(), ['Decaf', 'Guest roast with a long name', 'House espresso', 'Single origin']);
    for (const [name, id] of Object.entries(references)) {
        const own = all.filter(entry => entry.recipe === name && entry.machine === 'this' && !entry.unfinished);
        assert.notEqual(own[0].shot.id, id, `${name}: the reference is not the latest`);
        assert.equal(all.find(entry => entry.shot.id === id).machine, 'this', `${name}: this Machine's, so the tablet may keep it`);
    }
    const guest = all.find(entry => entry.shot.id === references['Guest roast with a long name']);
    assert.equal(guest.shot.workflow.profile.title, 'Default');
});

for (const [mode, make] of [['served by Decent Sync', served], ['without Decent Sync', tablet]]) {
    test(`the fake made from it, ${mode}: House espresso loaded and not called changed, the Shots dated from the page's clock`, () => {
        const made = make();
        const fake = createFakeDecaid({ ...made, now: NOW, timeZone: 'America/Toronto' });
        const house = fake.store.get(DYE2, 'recipes').find(row => row.name === 'House espresso');
        assert.deepEqual(fake.selection(), { kind: 'recipe', id: house.id, modified: false });
        const [newest] = fake.shots.newest(1);
        assert.equal(newest.timestamp.slice(0, 16), '2026-11-18T13:00', 'an hour before the page opened, in the visitor\'s zone');
        assert.equal(fake.shots.all().length, made.sampleData.shots.length);
        // Every recipe loaded in turn is not called changed.
        for (const record of fake.store.get(DYE2, 'recipes')) {
            const { context, profile } = record.workflow;
            fake.request({ method: 'PUT', url: '/api/v1/workflow', body: { context: { ...context, extras: { ...context.extras, dye: { v: 1, recipeId: record.id }, rpm: null, feedRate: null } }, profile } });
            assert.deepEqual(fake.selection(), { kind: 'recipe', id: record.id, modified: false }, `${record.name} loaded, not changed`);
        }
    });
}

test('served by Decent Sync: the Location\'s Shots name both Machines and the references are the server\'s; without, they are the tablet\'s', () => {
    const fake = createFakeDecaid({ ...served(), now: NOW, timeZone: 'America/Toronto' });
    const list = fake.request({ method: 'GET', url: '/api/v1/plugins/decent-sync.reaplugin/shots?limit=50' });
    assert.equal(list.status, 200);
    assert.equal(list.body.shots.length, seeded(served()).length);
    assert.deepEqual([...new Set(list.body.shots.map(row => row.machine.name))].sort(), ['Sample Machine', 'Sample Machine Two']);
    assert.equal(list.body.shots.filter(row => row.unfinished).length, 3);
    const guest = fake.store.get(DYE2, 'recipes').find(row => row.name === 'Guest roast with a long name');
    const reference = fake.request({ method: 'GET', url: `/api/v1/plugins/decent-sync.reaplugin/reference?recipe=${guest.id}` });
    assert.equal(reference.body.reference.profileDiffers, true, 'the guest roast\'s reads "Different profile"');
    assert.equal(fake.store.get('streamlineCafe', 'references') ?? null, null, 'nothing kept on the tablet');

    const alone = createFakeDecaid({ ...tablet(), now: NOW, timeZone: 'America/Toronto' });
    assert.equal(alone.request({ method: 'GET', url: '/api/v1/plugins/decent-sync.reaplugin/status' }).status, 404);
    assert.equal(Object.keys(alone.store.get('streamlineCafe', 'references')).length, 4);
});

test('fake-decaid/ holds nothing that is the preview\'s alone', () => {
    for (const file of readdirSync(new URL('fake-decaid/', ROOT)).filter(name => name.endsWith('.js'))) {
        const source = readFileSync(new URL(`fake-decaid/${file}`, ROOT), 'utf8');
        assert.doesNotMatch(source, /preview|sample-cafe/i, `${file} names the preview`);
    }
});
