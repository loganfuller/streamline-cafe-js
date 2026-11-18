// Changing the profile while the recipe stays loaded (docs/cafe/DESIGN.md,
// "Changing the profile"). All sample data is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createProfileChange, recordFields, workflowPatch, afterCheck, ownBrewC, withStopWeight, holdsProfile, AFTER_CHECK_MS } from '../src/cafe/profile-change.js';
import { createRecipeWriter } from '../src/cafe/recipe-write.js';
import { profileFingerprint } from '../src/modules/dye-selection.js';

const copy = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

// Profiles as Decaid holds them: two steps, the first at the profile's own temperature.
const profile = (title, temps = [93, 91], over = {}) => ({
    title, author: 'Sample', notes: '', beverage_type: 'espresso', tank_temperature: 0, target_weight: 36, target_volume: 0,
    steps: temps.map((temperature, i) => ({ name: `step ${i + 1}`, pump: 'pressure', pressure: 9 - i, temperature, seconds: 20, limiter: null, exit: null })),
    ...over,
});
const TURBO = { id: 'profile:turbo', profile: profile('Turbo shot', [93, 91]) };
const BLOOM = { id: 'profile:bloom', profile: profile('Bloom slow', [88, 86], { steps: undefined }) };
BLOOM.profile.steps = [
    { name: 'bloom', pump: 'flow', flow: 2, temperature: 88, seconds: 10, limiter: { value: 0, range: 0.6 }, exit: null },
    { name: 'pour', pump: 'flow', flow: 2.2, temperature: 86, seconds: 25, limiter: null, exit: null },
];
const OTHER = { id: 'profile:other', profile: profile('Other lever', [90, 85]) };
const PROFILES = { [TURBO.id]: TURBO, [BLOOM.id]: BLOOM, [OTHER.id]: OTHER };

// A recipe as DYE2's save-recipe writes it, on the Turbo profile, with the yield folded in.
const recipe = (id, name, over = {}) => ({
    id, name, title: name, beverage: '', stripSlot: 1, showOnStreamlineDashboard: true,
    beanName: 'Hill Farm', beanBatchId: 'batch-1', profileId: TURBO.id, profileTitle: TURBO.profile.title,
    profileSnapshot: { ...TURBO.profile, target_weight: 40 },
    dashboardVariables: { dose: 18, drink: 40, grind: 12, brewC: 93, steamTempC: 150 },
    workflow: {
        context: { targetDoseWeight: 18, targetYield: 40, grinderSetting: '12', coffeeName: 'Hill Farm', extras: { basketId: 'b1' } },
        profile: { ...TURBO.profile, target_weight: 40 },
        steamSettings: { targetTemperature: 150 },
    },
    decentSyncId: 'ds-1',
    somethingNew: { kept: true },
    ...over,
});

/**
 * A tablet: DYE2's records, its selection and the Workflow, with DYE2's own
 * rule run on every Workflow write (plugin.ts `workflowChanged`, v0.1.42): the
 * recipe id is cleared when the live profile differs from the one noted when
 * the id appeared and from the recipe's own.
 */
function tablet({ rows, loaded = null, live = { ...TURBO.profile, target_weight: 40 }, yieldGrams = 40 } = {}) {
    const w = {
        rows: copy(rows),
        workflow: { context: { targetDoseWeight: 18, targetYield: yieldGrams, grinderSetting: '12', extras: { dye: { recipeId: loaded } } }, profile: copy(live) },
        baseline: null,
        epoch: 0,
        log: [],
        workflowWrites: [],
        waits: [],
        busy: false,
        failRecords: () => false,
        failSelection: false,
        failWorkflowWrite: false,
        onRecordWrite: () => {},
        onWait: () => {},
        queued: 0,
        checked: [],
    };
    w.recipeId = () => w.workflow.context.extras.dye.recipeId;
    w.baseline = loaded ? profileFingerprint(w.workflow.profile) : null;
    const ownProfile = row => row?.workflow?.profile || row?.profileSnapshot || null;
    w.dye2 = () => {
        const rid = w.recipeId();
        if (!rid) { w.baseline = null; return; }
        const row = w.rows.find(r => r && r.id === rid);
        const live = profileFingerprint(w.workflow.profile);
        if (w.baseline && live !== w.baseline && (!row || profileFingerprint(ownProfile(row)) !== live)) {
            w.workflow.context.extras.dye.recipeId = null;
            w.baseline = null;
            w.log.push('dye2 unloaded');
            return;
        }
        w.baseline = live;
    };
    let reads = 0;
    const writer = createRecipeWriter({
        async read() { reads += 1; return w.failRecords(reads) ? null : copy(w.rows); },
        async write(next) {
            w.rows = copy(next);
            w.log.push('record');
            w.onRecordWrite(w);
        },
    });
    w.settled = () => true;
    w.deps = {
        mayChange: () => !w.busy,
        settled: () => w.settled(),
        queue: async task => { w.queued += 1; if (w.refuseQueue) throw new Error('refused'); return task(); },
        readProfile: async id => { if (!PROFILES[id]) throw new Error('404'); return copy(PROFILES[id]); },
        readSelection: async () => {
            if (w.failSelection) return undefined;
            const rid = w.recipeId();
            return rid ? { kind: 'recipe', id: rid, modified: false } : null;
        },
        readWorkflow: async () => copy(w.workflow),
        readRecords: async () => (w.failRecords(Infinity) ? null : copy(w.rows)),
        saveRecord: (id, fields, options) => writer.setFields(id, fields, options),
        async writeWorkflow(patch) {
            if (w.failWorkflowWrite) throw new Error('500');
            w.workflowWrites.push(copy(patch));
            w.log.push('workflow');
            // Decaid merges objects key by key and replaces arrays.
            w.workflow = { ...w.workflow, profile: { ...w.workflow.profile, ...copy(patch.profile) } };
            w.dye2();
        },
        follow: async record => { w.log.push(`follow ${record.id}`); },
        async markLoaded(id) {
            w.log.push(`mark ${id}`);
            w.workflow.context.extras.dye.recipeId = id;
            w.baseline = null; // a new id's first event: DYE2 notes the profile
            w.dye2();
            if (w.dropMark) { w.workflow.context.extras.dye.recipeId = null; }
        },
        epoch: () => w.epoch,
        idle: async () => { w.log.push('idle'); },
        wait: async ms => { w.waits.push(ms); await w.onWait(w); },
        onChecked: (outcome, id) => w.checked.push([outcome, id]),
    };
    w.change = createProfileChange(w.deps).change;
    w.get = id => w.rows.find(r => r && r.id === id);
    return w;
}

test('with a recipe loaded the record takes the profile first, then the Workflow, and the recipe stays loaded', async () => {
    const other = recipe('r2', 'Decaf', { stripSlot: 2 });
    const w = tablet({ rows: [recipe('r1', 'House espresso'), other], loaded: 'r1' });
    const answer = await w.change(BLOOM.id);
    assert.equal(answer.ok, true);
    assert.equal(answer.recipeId, 'r1');
    assert.deepEqual(w.log.slice(0, 3), ['record', 'workflow', `follow ${BLOOM.id}`], 'the record is confirmed before the Workflow is written');
    assert.equal(w.recipeId(), 'r1', 'DYE2 keeps the recipe loaded');

    const row = w.get('r1');
    const stored = { ...BLOOM.profile, target_weight: 40 };
    assert.equal(row.profileId, BLOOM.id);
    assert.equal(row.profileTitle, 'Bloom slow');
    assert.deepEqual(row.profileSnapshot, stored);
    assert.deepEqual(row.workflow.profile, stored, 'the record\'s stored Workflow stops at the recipe\'s yield');
    assert.equal(row.dashboardVariables.brewC, 88, 'the profile\'s own temperature');
    // Everything else on the row and its stored Workflow is as it was.
    const before = recipe('r1', 'House espresso');
    assert.deepEqual(row.workflow.context, before.workflow.context);
    assert.deepEqual(row.workflow.steamSettings, before.workflow.steamSettings);
    assert.deepEqual({ ...row.dashboardVariables, brewC: 93 }, before.dashboardVariables);
    for (const key of ['name', 'title', 'beanName', 'beanBatchId', 'stripSlot', 'decentSyncId', 'somethingNew']) assert.deepEqual(row[key], before[key], key);
    assert.deepEqual(w.get('r2'), other, 'the other records are untouched');

    // One Workflow write: the profile alone, the yield as its stop weight, no recipe id.
    assert.equal(w.workflowWrites.length, 1);
    assert.deepEqual(Object.keys(w.workflowWrites[0]), ['profile']);
    assert.deepEqual(w.workflowWrites[0].profile, { ...BLOOM.profile, target_weight: 40 });
    assert.deepEqual(w.workflow.context, { targetDoseWeight: 18, targetYield: 40, grinderSetting: '12', extras: { dye: { recipeId: 'r1' } } }, 'dose, yield and grind stay');
});

test('a profile whose own temperature differs from the recipe\'s: Brew takes the profile\'s', async () => {
    // The recipe brews Turbo at 95, stepped up from Turbo's own 93.
    const hot = recipe('r1', 'House espresso', { dashboardVariables: { dose: 18, drink: 40, brewC: 95 } });
    const w = tablet({ rows: [hot], loaded: 'r1', live: { ...TURBO.profile, target_weight: 40, steps: TURBO.profile.steps.map(s => ({ ...s, temperature: s.temperature + 2 })) } });
    await w.change(OTHER.id);
    assert.equal(w.get('r1').dashboardVariables.brewC, 90);
    assert.deepEqual(w.workflow.profile.steps.map(s => s.temperature), [90, 85], 'not shifted to the recipe\'s old temperature');
    assert.deepEqual(w.get('r1').workflow.profile.steps.map(s => s.temperature), [90, 85]);
    assert.equal(w.recipeId(), 'r1');
});

test('with no recipe loaded the same Workflow write is made and no record is written', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: null, yieldGrams: 36 });
    const answer = await w.change(BLOOM.id);
    assert.deepEqual({ ...answer, checked: undefined }, { ok: true, recipeId: null, name: null, checked: undefined });
    assert.equal(answer.checked, null, 'nothing to check afterwards');
    assert.deepEqual(w.get('r1'), recipe('r1', 'House espresso'));
    assert.deepEqual(w.workflowWrites, [{ profile: { ...BLOOM.profile, target_weight: 36 } }]);
    assert.deepEqual(w.waits, []);
});

test('records that can\'t be read change nothing', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    w.failRecords = () => true;
    assert.deepEqual(await w.change(BLOOM.id), { ok: false, reason: 'unreadable' });
    assert.deepEqual(w.workflowWrites, []);
    assert.equal(w.recipeId(), 'r1');
});

test('a selection DYE2 can\'t say changes nothing: written alone, the profile might unload a recipe', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    w.failSelection = true;
    assert.deepEqual(await w.change(BLOOM.id), { ok: false, reason: 'unreadable' });
    assert.deepEqual(w.workflowWrites, []);
    assert.equal(w.log.length, 0);
});

test('a record write that can\'t be confirmed writes no Workflow, and everything stays as it was', async () => {
    const original = recipe('r1', 'House espresso');
    const w = tablet({ rows: [original], loaded: 'r1' });
    // DYE2 writes its older copy back over every write.
    w.onRecordWrite = world => { world.rows = [copy(original)]; };
    assert.deepEqual(await w.change(BLOOM.id), { ok: false, reason: 'unconfirmed' });
    assert.deepEqual(w.workflowWrites, []);
    assert.deepEqual(w.get('r1'), original);
    assert.equal(w.recipeId(), 'r1');
    assert.equal(profileFingerprint(w.workflow.profile), profileFingerprint(TURBO.profile));
});

test('a recipe deleted meanwhile writes no Workflow', async () => {
    const w = tablet({ rows: [recipe('r2', 'Decaf')], loaded: 'r1' });
    assert.deepEqual(await w.change(BLOOM.id), { ok: false, reason: 'gone' });
    assert.deepEqual(w.workflowWrites, []);
});

test('a Workflow write that fails says so; the record holds the profile', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    w.failWorkflowWrite = true;
    assert.deepEqual(await w.change(BLOOM.id), { ok: false, reason: 'workflow' });
    assert.equal(w.get('r1').profileId, BLOOM.id);
    assert.equal(w.recipeId(), 'r1', 'the machine stays on the old profile with the recipe loaded');
});

test('only a profile Decaid holds, with steps, is changed to', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    assert.deepEqual(await w.change('profile:missing'), { ok: false, reason: 'profile' });
    PROFILES['profile:empty'] = { id: 'profile:empty', profile: { title: 'Empty', steps: [] } };
    assert.deepEqual(await w.change('profile:empty'), { ok: false, reason: 'profile' });
    delete PROFILES['profile:empty'];
    assert.deepEqual(w.log, []);
});

test('not while a shot runs, a recipe loads or a choice is written; and not when its turn never comes', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    w.busy = true;
    assert.deepEqual(await w.change(BLOOM.id), { ok: false, reason: 'busy' });
    assert.equal(w.queued, 0);
    w.busy = false;
    w.refuseQueue = true;
    assert.deepEqual(await w.change(BLOOM.id), { ok: false, reason: 'busy' });
    assert.deepEqual(w.log, []);
});

test('the check afterwards waits out DYE2\'s window, after any shot, and finds the record held', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    const answer = await w.change(BLOOM.id);
    assert.equal(await answer.checked, 'held');
    assert.deepEqual(w.waits, [AFTER_CHECK_MS]);
    assert.ok(w.log.indexOf('idle') > w.log.indexOf(`follow ${BLOOM.id}`));
    assert.equal(w.log.filter(entry => entry === 'record').length, 1, 'nothing written again');
    assert.deepEqual(w.checked, [['held', 'r1']]);
});

test('a record found reverted afterwards is written again, and the recipe stays loaded', async () => {
    const original = recipe('r1', 'House espresso');
    const w = tablet({ rows: [original], loaded: 'r1' });
    // DYE2's save of the dial-in read the list before the change and writes it back after.
    w.onWait = world => { world.rows = [copy({ ...original, dashboardVariables: { ...original.dashboardVariables, dose: 18.5 } })]; };
    const answer = await w.change(BLOOM.id);
    assert.equal(await answer.checked, 'rewritten');
    const row = w.get('r1');
    assert.ok(holdsProfile(row, BLOOM));
    assert.equal(row.dashboardVariables.dose, 18.5, 'DYE2\'s own change is kept');
    assert.equal(row.dashboardVariables.brewC, 88);
    assert.equal(w.recipeId(), 'r1');
});

test('a write lost before the Workflow moves: DYE2 unloads, and the check writes the record again and loads the recipe once', async () => {
    const original = recipe('r1', 'House espresso');
    const w = tablet({ rows: [original], loaded: 'r1' });
    // The write is confirmed, then DYE2 writes its older copy back before it hears the Workflow.
    let wrote = 0;
    w.onRecordWrite = () => { wrote += 1; };
    const write = w.deps.writeWorkflow;
    w.deps.writeWorkflow = async patch => { if (wrote === 1) w.rows = [copy(original)]; return write(patch); };
    w.change = createProfileChange(w.deps).change;
    const answer = await w.change(BLOOM.id);
    assert.equal(answer.ok, true);
    assert.ok(w.log.includes('dye2 unloaded'));
    assert.equal(w.recipeId(), null);
    assert.equal(await answer.checked, 'reloaded');
    assert.equal(w.recipeId(), 'r1');
    assert.ok(holdsProfile(w.get('r1'), BLOOM));
    assert.equal(w.log.filter(entry => entry.startsWith('mark')).length, 1, 'loaded again once');
});

test('a recipe found unloaded afterwards, its record held, is loaded again once', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    w.onWait = world => { world.workflow.context.extras.dye.recipeId = null; };
    const answer = await w.change(BLOOM.id);
    assert.equal(await answer.checked, 'reloaded');
    assert.equal(w.recipeId(), 'r1');
    assert.equal(w.log.filter(entry => entry === 'record').length, 1, 'the record is not written again');
});

test('a recipe unloaded again after it is loaded again: the check says so, and the profile stays the machine\'s', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    w.onWait = world => { world.workflow.context.extras.dye.recipeId = null; };
    w.dropMark = true;
    const answer = await w.change(BLOOM.id);
    assert.equal(await answer.checked, 'unloaded');
    assert.equal(w.recipeId(), null);
    assert.equal(w.log.filter(entry => entry.startsWith('mark')).length, 1, 'only once');
    assert.equal(profileFingerprint(w.workflow.profile), profileFingerprint(BLOOM.profile));
});

test('a recipe the barista unloaded since the change is not loaded again, though a lost record is written again', async () => {
    const original = recipe('r1', 'House espresso');
    const w = tablet({ rows: [original], loaded: 'r1' });
    w.onWait = world => {
        world.epoch += 1; // a tap on the loaded card
        world.workflow.context.extras.dye.recipeId = null;
        world.rows = [copy(original)];
    };
    const answer = await w.change(BLOOM.id);
    assert.equal(await answer.checked, 'tapped');
    assert.equal(w.recipeId(), null);
    assert.equal(w.log.filter(entry => entry.startsWith('mark')).length, 0);
    assert.ok(holdsProfile(w.get('r1'), BLOOM), 'the change belongs to the recipe');
});

test('a tap that lands while the check runs is the barista\'s', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    w.onWait = world => { world.workflow.context.extras.dye.recipeId = null; };
    const read = w.deps.readRecords;
    w.deps.readRecords = async () => { const rows = await read(); w.epoch += 1; return rows; };
    w.change = createProfileChange(w.deps).change;
    const answer = await w.change(BLOOM.id);
    assert.equal(await answer.checked, 'tapped');
    assert.equal(w.log.filter(entry => entry.startsWith('mark')).length, 0);
});

test('a machine moved to another profile since is not given the recipe back', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    w.onWait = world => {
        world.workflow.profile = copy(OTHER.profile); // Streamline's wake profile, say
        world.workflow.context.extras.dye.recipeId = null;
    };
    const answer = await w.change(BLOOM.id);
    assert.equal(await answer.checked, 'unloaded');
    assert.equal(w.recipeId(), null);
});

test('a record changed again elsewhere since is left alone', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    w.onWait = world => {
        const row = world.rows[0];
        world.rows = [{ ...row, profileId: OTHER.id, profileSnapshot: OTHER.profile, workflow: { ...row.workflow, profile: OTHER.profile } }];
    };
    const answer = await w.change(BLOOM.id);
    assert.equal(await answer.checked, 'moved');
    assert.equal(w.get('r1').profileId, OTHER.id);
});

test('records that can\'t be read afterwards are not written; the check says so', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    w.onWait = world => { world.failRecords = () => true; };
    const answer = await w.change(BLOOM.id);
    assert.equal(await answer.checked, 'unreadable');
});

test('a check whose turn finds a shot started tries once more after it', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    let turns = 0;
    const queue = w.deps.queue;
    w.deps.queue = async task => { turns += 1; if (turns === 2) throw new Error('a shot started'); return queue(task); };
    w.change = createProfileChange(w.deps).change;
    const answer = await w.change(BLOOM.id);
    assert.equal(await answer.checked, 'held');
    assert.equal(w.log.filter(entry => entry === 'idle').length, 2);
});

test('a temperature step after the change keeps the recipe loaded', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    await w.change(BLOOM.id);
    // Streamline's Brew stepper writes the steps alone (tiles.brewTemp).
    await w.deps.writeWorkflow({ profile: { steps: w.workflow.profile.steps.map(s => ({ ...s, temperature: s.temperature + 1 })) } });
    assert.equal(w.recipeId(), 'r1');
});

test('a name DYE2 gave the recipe follows the profile, in the same record write', async () => {
    const generated = recipe('r1', 'Turbo Hill Farm');
    const w = tablet({ rows: [generated, recipe('r2', 'Bloom Hill Farm', { stripSlot: 2 })], loaded: 'r1' });
    const answer = await w.change(BLOOM.id);
    assert.equal(answer.name, 'Bloom Hill Farm 2');
    assert.equal(w.get('r1').name, 'Bloom Hill Farm 2');
    assert.equal(w.get('r1').title, 'Bloom Hill Farm 2');
    assert.equal(w.log.filter(entry => entry === 'record').length, 1);
});

test('a recipe named otherwise keeps its name', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    const answer = await w.change(BLOOM.id);
    assert.equal(answer.name, null);
    assert.equal(w.get('r1').name, 'House espresso');
});

test('the fields worked out from a row with no stored Workflow, numbers or yield', () => {
    const row = { id: 'x', name: 'House espresso', profileSnapshot: TURBO.profile };
    const fields = recordFields(row, [row], BLOOM);
    assert.deepEqual(Object.keys(fields).sort(), ['dashboardVariables.brewC', 'profileId', 'profileSnapshot', 'profileTitle']);
    assert.deepEqual(fields.profileSnapshot, BLOOM.profile, 'no yield: the profile\'s own stop weight');
    // A yield of the recipe's numbers is the stop weight when its stored Workflow has none.
    assert.equal(recordFields({ ...row, dashboardVariables: { drink: 38 } }, [], BLOOM).profileSnapshot.target_weight, 38);
});

test('an older record with a ratio and no drink stops at its dose times its ratio, as Streamline\'s apply of it yields', () => {
    const row = { id: 'r1', name: 'X', profileId: TURBO.id, dashboardVariables: { dose: 18, ratio: 2.5 } };
    assert.equal(recordFields(row, [], BLOOM).profileSnapshot.target_weight, 45);
    assert.equal(recordFields({ ...row, dashboardVariables: { dose: 18.3, ratio: 2.25 } }, [], BLOOM).profileSnapshot.target_weight, 41.2);
    assert.equal(recordFields({ ...row, dashboardVariables: { dose: 18, ratio: 2.5, drink: 40 } }, [], BLOOM).profileSnapshot.target_weight, 40, 'a drink wins');
});

test('the Workflow write without a yield keeps the profile\'s own stop weight', () => {
    assert.deepEqual(workflowPatch(TURBO, { context: { targetYield: 0 } }), { profile: TURBO.profile });
    assert.deepEqual(workflowPatch(TURBO, null), { profile: TURBO.profile });
    assert.equal(workflowPatch(TURBO, { context: { targetYield: 42 } }).profile.target_weight, 42);
    assert.equal(withStopWeight(TURBO.profile, '38').target_weight, 38);
});

test('a profile\'s own temperature is its first step\'s', () => {
    assert.equal(ownBrewC(TURBO.profile), 93);
    assert.equal(ownBrewC({ steps: [] }), null);
    assert.equal(ownBrewC({ steps: [{ temperature: null }] }), null);
    assert.equal(ownBrewC(null), null);
});

test('the check\'s plan, case by case', () => {
    const held = recipe('r1', 'X', { profileId: BLOOM.id, profileSnapshot: BLOOM.profile, workflow: { profile: BLOOM.profile } });
    const reverted = recipe('r1', 'X');
    const before = profileFingerprint(TURBO.profile);
    const base = { recipeId: 'r1', record: BLOOM, before, live: BLOOM.profile, tapped: false };
    const loaded = { kind: 'recipe', id: 'r1' };
    assert.deepEqual(afterCheck({ ...base, rows: [held], selection: loaded }), { outcome: 'held', rewrite: false, reload: false });
    assert.deepEqual(afterCheck({ ...base, rows: [reverted], selection: loaded }), { outcome: 'rewritten', rewrite: true, reload: false });
    assert.deepEqual(afterCheck({ ...base, rows: [reverted], selection: null }), { outcome: 'reloaded', rewrite: true, reload: true });
    assert.deepEqual(afterCheck({ ...base, rows: [held], selection: { kind: 'favourite', id: 'recent:1' } }), { outcome: 'reloaded', rewrite: false, reload: true });
    assert.deepEqual(afterCheck({ ...base, rows: [held], selection: null, tapped: true }), { outcome: 'tapped', rewrite: false, reload: false });
    assert.deepEqual(afterCheck({ ...base, rows: [held], selection: undefined }), { outcome: 'unknown', rewrite: false, reload: false });
    assert.deepEqual(afterCheck({ ...base, rows: [held], selection: null, live: null }), { outcome: 'unloaded', rewrite: false, reload: false });
    assert.deepEqual(afterCheck({ ...base, rows: [held], selection: { kind: 'recipe', id: 'r2' } }), { outcome: 'replaced', rewrite: false, reload: false }, 'another recipe loaded since keeps its marker');
    assert.deepEqual(afterCheck({ ...base, rows: [reverted], selection: { kind: 'recipe', id: 'r2' } }), { outcome: 'replaced', rewrite: true, reload: false }, 'a lost record is still written again');
    assert.deepEqual(afterCheck({ ...base, rows: null }), { outcome: 'unreadable', rewrite: false, reload: false });
    assert.deepEqual(afterCheck({ ...base, rows: [recipe('r2', 'Y')] }), { outcome: 'gone', rewrite: false, reload: false });
    // The id alone is not the profile: DYE2 compares the stored profile.
    assert.equal(afterCheck({ ...base, rows: [{ ...held, workflow: { profile: OTHER.profile } }], selection: loaded }).outcome, 'moved');
});

test('a tap on the strip while the change waits its turn counts as the barista\'s', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    const queue = w.deps.queue;
    w.deps.queue = async task => { if (w.queued === 0) w.epoch += 1; return queue(task); };
    w.onWait = world => { world.workflow.context.extras.dye.recipeId = null; };
    w.change = createProfileChange(w.deps).change;
    const answer = await w.change(BLOOM.id);
    assert.equal(await answer.checked, 'tapped');
    assert.equal(w.log.filter(entry => entry.startsWith('mark')).length, 0);
});

test('two changes to the same recipe inside DYE2\'s window: the first one\'s check gives way to the second\'s', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    w.onWait = () => gate;
    // Turbo to Bloom, then back to Turbo: the first check would read Turbo as its record set back.
    const first = await w.change(BLOOM.id);
    const second = await w.change(TURBO.id);
    assert.equal(first.ok && second.ok, true);
    release();
    assert.deepEqual(await Promise.all([first.checked, second.checked]), ['superseded', 'held']);
    assert.equal(w.get('r1').profileId, TURBO.id, 'the later choice stays on the record');
    assert.equal(w.recipeId(), 'r1');
    assert.equal(w.log.filter(entry => entry === 'record').length, 2, 'no record write from the superseded check');
});

test('another recipe loaded since the change keeps its marker: the check loads nothing', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso'), recipe('r2', 'Decaf', { stripSlot: 2, profileId: BLOOM.id, profileSnapshot: BLOOM.profile, workflow: { profile: BLOOM.profile } })], loaded: 'r1' });
    w.onWait = world => { world.workflow.context.extras.dye.recipeId = 'r2'; };
    const answer = await w.change(BLOOM.id);
    assert.equal(await answer.checked, 'replaced');
    assert.equal(w.recipeId(), 'r2');
    assert.equal(w.log.filter(entry => entry.startsWith('mark')).length, 0);
});

test('a shot or an arrangement begun while DYE2 is read: nothing is written', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    let calm = true;
    w.settled = () => calm;
    const read = w.deps.readWorkflow;
    w.deps.readWorkflow = async () => { calm = false; return read(); };
    w.change = createProfileChange(w.deps).change;
    assert.deepEqual(await w.change(BLOOM.id), { ok: false, reason: 'busy' });
    assert.deepEqual(w.log, []);
    assert.deepEqual(w.get('r1'), recipe('r1', 'House espresso'));
});

test('a shot or an arrangement begun once the record holds the profile: no Workflow write, as one that failed', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    let calm = true;
    w.settled = () => calm;
    w.onRecordWrite = () => { calm = false; };
    assert.deepEqual(await w.change(BLOOM.id), { ok: false, reason: 'workflow' });
    assert.equal(w.get('r1').profileId, BLOOM.id);
    assert.deepEqual(w.workflowWrites, []);
    assert.equal(w.recipeId(), 'r1', 'the machine stays on the old profile, the recipe loaded');
});

test('the check waits for a load or an arrangement to end, and gives up its turn when one begins as it writes', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    // The change asks twice; then the check: unsettled for two looks, settled,
    // and unsettled again at its rewrite, so its turn is given up and taken again.
    const answers = [true, true, false, false, true, false];
    w.settled = () => (answers.length ? answers.shift() : true);
    let turns = 0;
    const queue = w.deps.queue;
    w.deps.queue = async task => { turns += 1; return queue(task); };
    w.change = createProfileChange(w.deps).change;
    const original = recipe('r1', 'House espresso');
    w.onWait = world => { if (world.waits.length === 1) world.rows = [copy(original)]; };
    const answer = await w.change(BLOOM.id);
    assert.equal(await answer.checked, 'rewritten');
    assert.equal(w.get('r1').profileId, BLOOM.id);
    assert.equal(turns, 3, 'the change, the turn given up, and the one that wrote');
    assert.deepEqual(w.waits.filter(ms => ms !== AFTER_CHECK_MS).length, 2, 'two looks while a load or an arrangement was under way');
});
