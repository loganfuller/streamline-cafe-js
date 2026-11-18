// A batch of another bean becomes the recipe's bean (docs/cafe/DESIGN.md,
// "The bean and batch dialog"). All sample data is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createBeanChange, beanFields, holdsBean, heldBean, beanAfterCheck, writesRecord } from '../src/cafe/bean-change.js';
import { AFTER_CHECK_MS } from '../src/cafe/profile-change.js';
import { createRecipeWriter } from '../src/cafe/recipe-write.js';
import { recipeBeanId } from '../src/cafe/bean-model.js';

const copy = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

const HILL = { id: 'bean-hill', name: 'Hill Farm', roaster: 'Sample Roasters' };
const VALLEY = { id: 'bean-valley', name: 'Valley Decaf', roaster: 'Example Coffee Co' };
const HILL_NEW = { id: 'batch-hill-2', beanId: HILL.id, roastDate: '2026-11-02T00:00:00.000Z' };
const HILL_OLD = { id: 'batch-hill-1', beanId: HILL.id, roastDate: '2026-10-15T00:00:00.000Z' };
const VALLEY_1 = { id: 'batch-valley-1', beanId: VALLEY.id, roastDate: '2026-10-20T00:00:00.000Z' };
const BATCHES = [HILL_NEW, HILL_OLD, VALLEY_1];

// A recipe as DYE2's editor saves one: the bean at the top of the row and in its stored Workflow.
const recipe = (id, name, over = {}) => ({
    id, name, title: name, subtitle: 'Hill Farm', beverage: '', stripSlot: 1, showOnStreamlineDashboard: true,
    beanId: HILL.id, beanName: 'Hill Farm', beanRoaster: 'Sample Roasters', beanBatchId: HILL_NEW.id,
    profileId: 'profile:turbo', profileTitle: 'Turbo shot', profileSnapshot: { title: 'Turbo shot', steps: [{}] },
    dashboardVariables: { dose: 18, drink: 40, grind: 12, brewC: 93 },
    workflow: {
        context: { targetDoseWeight: 18, targetYield: 40, grinderSetting: '12', coffeeName: 'Hill Farm', coffeeRoaster: 'Sample Roasters', beanBatchId: HILL_NEW.id, extras: { basketId: 'b1', dye: { kept: true } } },
        profile: { title: 'Turbo shot', steps: [{}] },
    },
    decentSyncId: 'ds-1',
    somethingNew: { kept: true },
    ...over,
});

// A recipe DYE2's `save-recipe` made from the Workflow: no beanId, the name its rule gave.
const madeByDye2 = (id, over = {}) => {
    const row = recipe(id, 'Turbo Hill Farm', over);
    delete row.beanId;
    return row;
};

/**
 * A tablet: DYE2's records, its selection and the Workflow. A bean change never
 * unloads a recipe in DYE2, so the Workflow's mark is changed only by the test.
 */
function tablet({ rows, loaded = null, batchId = HILL_NEW.id } = {}) {
    const w = {
        rows: copy(rows),
        workflow: { context: { targetDoseWeight: 18, beanBatchId: batchId, coffeeName: 'Hill Farm', coffeeRoaster: 'Sample Roasters', extras: { dye: { recipeId: loaded } } } },
        log: [],
        workflowWrites: [],
        waits: [],
        failRecords: () => false,
        failSelection: false,
        failWorkflowWrite: false,
        onRecordWrite: () => {},
        onWait: () => {},
        checked: [],
        settled: () => true,
    };
    w.recipeId = () => w.workflow.context.extras.dye.recipeId;
    let reads = 0;
    const writer = createRecipeWriter({
        async read() { reads += 1; return w.failRecords(reads) ? null : copy(w.rows); },
        async write(next) {
            w.rows = copy(next);
            w.log.push('record');
            w.onRecordWrite(w);
        },
    });
    w.deps = {
        settled: () => w.settled(),
        queue: async task => {
            w.log.push('turn');
            if (w.refuseQueue) throw new Error('refused');
            if (w.refuseNext > 0) { w.refuseNext -= 1; throw new Error('a shot began'); }
            return task();
        },
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
            w.workflow = { ...w.workflow, context: { ...w.workflow.context, ...copy(patch.context) } };
        },
        idle: async () => { w.log.push('idle'); },
        wait: async ms => { w.waits.push(ms); await w.onWait(w); },
        onChecked: (outcome, id) => w.checked.push([outcome, id]),
    };
    w.change = createBeanChange(w.deps).change;
    w.get = id => w.rows.find(r => r && r.id === id);
    return w;
}

const VALLEY_CONTEXT = { beanBatchId: VALLEY_1.id, coffeeName: 'Valley Decaf', coffeeRoaster: 'Example Coffee Co' };

test('whether a pick writes the record: another bean, the recipe\'s own, a recipe with no bean, no recipe', () => {
    const typed = recipe('r1', 'House espresso');
    assert.equal(writesRecord(typed, recipeBeanId(typed, BATCHES), VALLEY.id), true, 'another bean');
    assert.equal(writesRecord(typed, recipeBeanId(typed, BATCHES), HILL.id), false, 'the recipe\'s own bean');
    // A recipe DYE2 made has no beanId: its own bean is its batch's.
    const made = madeByDye2('r2');
    assert.equal(recipeBeanId(made, BATCHES), HILL.id);
    assert.equal(writesRecord(made, recipeBeanId(made, BATCHES), HILL.id), false, 'no beanId, a batch of its batch\'s bean');
    assert.equal(writesRecord(made, recipeBeanId(made, BATCHES), VALLEY.id), true, 'no beanId, another bean');
    // A recipe that names no bean takes any as its first.
    const none = recipe('r3', 'Plain', { beanId: undefined, beanName: undefined, beanBatchId: undefined });
    assert.equal(writesRecord(none, recipeBeanId(none, BATCHES), HILL.id), true, 'a recipe with no bean');
    assert.equal(writesRecord(null, null, VALLEY.id), false, 'no recipe loaded');
    assert.equal(writesRecord(typed, HILL.id, null), false, 'no bean');
    assert.equal(writesRecord({ ...typed, beanId: 7 }, 7, '7'), false, 'ids compared as text');
});

test('with a recipe loaded, a batch of another bean writes the record first, then the Workflow, and the recipe stays loaded', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso'), recipe('r2', 'Other', { stripSlot: 2 })], loaded: 'r1' });
    const answer = await w.change({ bean: VALLEY, batch: VALLEY_1, recipeId: 'r1' });
    assert.equal(answer.ok, true);
    assert.equal(answer.recipeId, 'r1');
    assert.equal(answer.name, null, 'a typed name is kept');
    assert.deepEqual(w.log.filter(e => e === 'record' || e === 'workflow'), ['record', 'workflow']);
    const row = w.get('r1');
    const want = recipe('r1', 'House espresso', {
        beanId: VALLEY.id, beanName: 'Valley Decaf', beanRoaster: 'Example Coffee Co', beanBatchId: VALLEY_1.id, subtitle: 'Valley Decaf',
    });
    want.workflow.context = { ...want.workflow.context, ...VALLEY_CONTEXT };
    assert.deepEqual(row, want, 'every other field of the row and of its stored Workflow kept');
    assert.deepEqual(w.get('r2'), recipe('r2', 'Other', { stripSlot: 2 }), 'other rows untouched');
    assert.deepEqual(w.workflowWrites, [{ context: VALLEY_CONTEXT }], 'the Workflow write a batch always is');
    assert.equal(w.recipeId(), 'r1');
    assert.equal(await answer.checked, 'held');
});

test('a batch of the recipe\'s own bean, or any with no recipe loaded, writes the Workflow alone', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    const before = copy(w.rows);
    const answer = await w.change({ bean: HILL, batch: HILL_OLD, recipeId: null });
    assert.deepEqual(answer, { ok: true, recipeId: null, name: null, checked: null });
    assert.deepEqual(w.workflowWrites, [{ context: { beanBatchId: HILL_OLD.id, coffeeName: 'Hill Farm', coffeeRoaster: 'Sample Roasters' } }]);
    assert.deepEqual(w.rows, before, 'no record written');
    assert.equal(w.waits.length, 0, 'no check afterwards');
    w.workflow.context.extras.dye.recipeId = null;
    assert.equal((await w.change({ bean: VALLEY, batch: VALLEY_1 })).ok, true);
    assert.deepEqual(w.rows, before);
    assert.equal(w.workflowWrites.length, 2);
});

test('a Workflow write alone that fails, or whose turn never comes, says so', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')] });
    w.failWorkflowWrite = true;
    assert.deepEqual(await w.change({ bean: VALLEY, batch: VALLEY_1 }), { ok: false, reason: 'workflow' });
    w.failWorkflowWrite = false;
    w.refuseQueue = true;
    assert.deepEqual(await w.change({ bean: VALLEY, batch: VALLEY_1 }), { ok: false, reason: 'workflow' });
    assert.equal(w.workflowWrites.length, 0);
});

test('a recipe whose name DYE2 gave takes the name for the new bean, in the same write; its card reads the new name and bean', async () => {
    const w = tablet({ rows: [madeByDye2('r1'), recipe('r2', 'Turbo Valley Decaf', { stripSlot: 2 })], loaded: 'r1' });
    const answer = await w.change({ bean: VALLEY, batch: VALLEY_1, recipeId: 'r1' });
    assert.equal(answer.name, 'Turbo Valley Decaf 2', 'a name another record has takes the next count');
    assert.equal(w.log.filter(e => e === 'record').length, 1, 'one record write');
    const row = w.get('r1');
    assert.equal(row.name, 'Turbo Valley Decaf 2');
    assert.equal(row.title, 'Turbo Valley Decaf 2', 'the cards and title band read the title first');
    assert.equal(row.beanName, 'Valley Decaf', 'and the bean from beanName');
    assert.equal(row.beanId, VALLEY.id, 'a recipe with no beanId is given one');
});

test('a recipe named otherwise keeps its name', async () => {
    const w = tablet({ rows: [recipe('r1', 'Morning house')], loaded: 'r1' });
    const answer = await w.change({ bean: VALLEY, batch: VALLEY_1, recipeId: 'r1' });
    assert.equal(answer.name, null);
    assert.equal(w.get('r1').name, 'Morning house');
    assert.equal(w.get('r1').title, 'Morning house');
});

test('a recipe with no bean takes its first, and loses the day DYE2 put in its name', async () => {
    const plain = recipe('r1', 'Turbo 26 Oct', { beanId: undefined, beanName: undefined, beanRoaster: undefined, beanBatchId: undefined, subtitle: '' });
    plain.workflow.context = { targetDoseWeight: 18, coffeeName: null, coffeeRoaster: null, beanBatchId: null };
    const w = tablet({ rows: [plain], loaded: 'r1', batchId: null });
    const answer = await w.change({ bean: HILL, batch: HILL_NEW, recipeId: 'r1' });
    assert.equal(answer.ok, true);
    assert.equal(answer.name, 'Turbo Hill Farm');
    const row = w.get('r1');
    assert.equal(row.beanId, HILL.id);
    assert.equal(row.beanBatchId, HILL_NEW.id);
    assert.deepEqual(row.workflow.context, { targetDoseWeight: 18, coffeeName: 'Hill Farm', coffeeRoaster: 'Sample Roasters', beanBatchId: HILL_NEW.id });
    assert.equal(w.workflow.context.beanBatchId, HILL_NEW.id);
});

test('a record with no stored Workflow is given none', () => {
    const row = recipe('r1', 'House espresso');
    delete row.workflow;
    const fields = beanFields(row, [row], VALLEY, VALLEY_1);
    assert.deepEqual(fields, { beanId: VALLEY.id, beanName: 'Valley Decaf', beanRoaster: 'Example Coffee Co', beanBatchId: VALLEY_1.id, subtitle: 'Valley Decaf' });
});

test('a bean with no name or roaster is written as nulls, as Streamline\'s own pick writes it, and renames nothing', () => {
    const row = madeByDye2('r1');
    const fields = beanFields(row, [row], { id: 'bean-x' }, { id: 'batch-x', beanId: 'bean-x' });
    assert.equal(fields.beanName, null);
    assert.equal(fields.beanRoaster, null);
    assert.equal(fields.subtitle, '');
    assert.equal(fields.name, undefined);
    assert.equal(fields['workflow.context'].coffeeName, null);
    assert.equal(beanFields(row, [row], VALLEY, { id: 'batch-y', beanId: HILL.id }), null, 'a batch of another bean than the one named is no pick');
});

test('records that can\'t be read change nothing', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    w.failRecords = () => true;
    assert.deepEqual(await w.change({ bean: VALLEY, batch: VALLEY_1, recipeId: 'r1' }), { ok: false, reason: 'unreadable' });
    assert.equal(w.workflowWrites.length, 0);
});

test('a record write that can\'t be confirmed writes no Workflow, and everything stays as it was', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    const before = copy(w.rows);
    // DYE2 writes its older copy back over every write.
    w.onRecordWrite = world => { world.rows = copy(before); };
    assert.deepEqual(await w.change({ bean: VALLEY, batch: VALLEY_1, recipeId: 'r1' }), { ok: false, reason: 'unconfirmed' });
    assert.equal(w.workflowWrites.length, 0);
    assert.equal(w.workflow.context.beanBatchId, HILL_NEW.id);
    assert.deepEqual(w.rows, before);
});

test('a selection DYE2 can\'t say, or one at odds with the Workflow, changes nothing', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    w.failSelection = true;
    assert.deepEqual(await w.change({ bean: VALLEY, batch: VALLEY_1, recipeId: 'r1' }), { ok: false, reason: 'unreadable' });
    w.failSelection = false;
    const read = w.deps.readSelection;
    w.deps.readSelection = async () => ({ kind: 'recipe', id: 'r1' });
    w.workflow.context.extras.dye.recipeId = null;
    w.change = createBeanChange(w.deps).change;
    assert.deepEqual(await w.change({ bean: VALLEY, batch: VALLEY_1, recipeId: 'r1' }), { ok: false, reason: 'unreadable' });
    w.deps.readSelection = read;
    assert.equal(w.log.includes('record') || w.workflowWrites.length > 0, false);
});

test('another recipe loaded since the dialog named one, or none, writes nothing', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso'), recipe('r2', 'Other', { stripSlot: 2 })], loaded: 'r2' });
    const before = copy(w.rows);
    assert.deepEqual(await w.change({ bean: VALLEY, batch: VALLEY_1, recipeId: 'r1' }), { ok: false, reason: 'recipe' });
    w.workflow.context.extras.dye.recipeId = null;
    assert.deepEqual(await w.change({ bean: VALLEY, batch: VALLEY_1, recipeId: 'r1' }), { ok: false, reason: 'recipe' });
    assert.deepEqual(w.rows, before);
    assert.equal(w.workflowWrites.length, 0);
});

test('a recipe deleted meanwhile writes no Workflow', async () => {
    const w = tablet({ rows: [recipe('r2', 'Other')], loaded: 'r1' });
    assert.deepEqual(await w.change({ bean: VALLEY, batch: VALLEY_1, recipeId: 'r1' }), { ok: false, reason: 'gone' });
    assert.equal(w.workflowWrites.length, 0);
});

test('another recipe loaded, or a shot begun, while the record is written: the record keeps the bean, and no Workflow is written', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso'), recipe('r2', 'Other', { stripSlot: 2 })], loaded: 'r1' });
    w.onRecordWrite = world => { world.workflow.context.extras.dye.recipeId = 'r2'; };
    assert.deepEqual(await w.change({ bean: VALLEY, batch: VALLEY_1, recipeId: 'r1' }), { ok: false, reason: 'workflow' });
    assert.ok(holdsBean(w.get('r1'), VALLEY, VALLEY_1));
    assert.equal(w.workflowWrites.length, 0);

    const v = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    let shot = false;
    v.settled = () => !shot;
    v.onRecordWrite = () => { shot = true; };
    assert.deepEqual(await v.change({ bean: VALLEY, batch: VALLEY_1, recipeId: 'r1' }), { ok: false, reason: 'workflow' });
    assert.equal(v.workflowWrites.length, 0);
});

test('a shot or an arrangement begun while DYE2 is read: nothing is written', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    w.settled = () => false;
    assert.deepEqual(await w.change({ bean: VALLEY, batch: VALLEY_1, recipeId: 'r1' }), { ok: false, reason: 'busy' });
    w.refuseQueue = true;
    w.settled = () => true;
    assert.deepEqual(await w.change({ bean: VALLEY, batch: VALLEY_1, recipeId: 'r1' }), { ok: false, reason: 'busy' });
    assert.equal(w.log.includes('record'), false);
    assert.equal(w.workflowWrites.length, 0);
});

test('a Workflow write that fails says so; the record holds the bean', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    w.failWorkflowWrite = true;
    assert.deepEqual(await w.change({ bean: VALLEY, batch: VALLEY_1, recipeId: 'r1' }), { ok: false, reason: 'workflow' });
    assert.ok(holdsBean(w.get('r1'), VALLEY, VALLEY_1));
});

test('the batch in use, of another bean than the recipe\'s, is saved onto the recipe with no Workflow write', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1', batchId: VALLEY_1.id });
    const answer = await w.change({ bean: VALLEY, batch: VALLEY_1, recipeId: 'r1' });
    assert.equal(answer.ok, true);
    assert.ok(holdsBean(w.get('r1'), VALLEY, VALLEY_1));
    assert.equal(w.workflowWrites.length, 0);
});

test('the check afterwards waits out DYE2\'s window, after any shot, and finds the record held', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    const answer = await w.change({ bean: VALLEY, batch: VALLEY_1, recipeId: 'r1' });
    assert.equal(await answer.checked, 'held');
    assert.deepEqual(w.waits, [AFTER_CHECK_MS]);
    assert.ok(w.log.lastIndexOf('idle') > w.log.indexOf('workflow'));
    assert.equal(w.log.filter(e => e === 'record').length, 1, 'nothing written again');
    assert.equal(w.log.filter(e => e === 'turn').length, 1, 'a check that finds it held takes no turn');
    assert.deepEqual(w.checked, [['held', 'r1']]);
});

test('a record found back on its old bean afterwards is written again, with DYE2\'s own change kept and the name again', async () => {
    const original = madeByDye2('r1');
    const w = tablet({ rows: [original], loaded: 'r1' });
    // DYE2's save of the dial-in read the list before the change and writes it back after.
    w.onWait = world => { world.rows = [copy({ ...original, dashboardVariables: { ...original.dashboardVariables, dose: 18.5 } })]; };
    const answer = await w.change({ bean: VALLEY, batch: VALLEY_1, recipeId: 'r1' });
    assert.equal(await answer.checked, 'rewritten');
    const row = w.get('r1');
    assert.ok(holdsBean(row, VALLEY, VALLEY_1));
    assert.equal(row.name, 'Turbo Valley Decaf');
    assert.equal(row.dashboardVariables.dose, 18.5, 'DYE2\'s own change is kept');
    assert.equal(w.recipeId(), 'r1');
});

test('a record changed again elsewhere since is left alone', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    w.onWait = world => {
        const row = world.rows[0];
        Object.assign(row, { beanId: HILL.id, beanBatchId: HILL_OLD.id });
    };
    const answer = await w.change({ bean: VALLEY, batch: VALLEY_1, recipeId: 'r1' });
    assert.equal(await answer.checked, 'moved');
    assert.equal(w.get('r1').beanBatchId, HILL_OLD.id);
});

test('records that can\'t be read afterwards are not written; nor is a recipe deleted since', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    w.onWait = world => { world.failRecords = () => true; };
    assert.equal(await (await w.change({ bean: VALLEY, batch: VALLEY_1, recipeId: 'r1' })).checked, 'unreadable');
    const v = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    v.onWait = world => { world.rows = []; };
    assert.equal(await (await v.change({ bean: VALLEY, batch: VALLEY_1, recipeId: 'r1' })).checked, 'gone');
});

test('two changes to the same recipe inside DYE2\'s window: the first one\'s check gives way to the second\'s', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    w.onWait = () => gate;
    // Hill to Valley, then back to Hill's other batch: the first check would read Hill as its record set back.
    const first = await w.change({ bean: VALLEY, batch: VALLEY_1, recipeId: 'r1' });
    const second = await w.change({ bean: HILL, batch: HILL_OLD, recipeId: 'r1' });
    assert.equal(first.ok && second.ok, true);
    release();
    assert.deepEqual(await Promise.all([first.checked, second.checked]), ['superseded', 'held']);
    assert.equal(w.get('r1').beanBatchId, HILL_OLD.id, 'the later choice stays on the record');
});

test('a check whose turn finds a shot started tries once more after it', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    const original = copy(w.rows[0]);
    // DYE2 writes the old list back; the check's first turn is refused, as when a shot starts.
    w.onWait = world => { world.rows = [copy(original)]; world.refuseNext = 1; };
    const answer = await w.change({ bean: VALLEY, batch: VALLEY_1, recipeId: 'r1' });
    assert.equal(await answer.checked, 'rewritten');
    assert.equal(w.log.filter(e => e === 'turn').length, 3, 'the change, the refused turn, the turn that wrote');
    assert.ok(holdsBean(w.get('r1'), VALLEY, VALLEY_1));
});

test('a check whose every turn is refused gives up', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    const original = copy(w.rows[0]);
    w.onWait = world => { world.rows = [copy(original)]; world.refuseNext = 3; };
    const answer = await w.change({ bean: VALLEY, batch: VALLEY_1, recipeId: 'r1' });
    assert.equal(await answer.checked, 'skipped');
    assert.equal(holdsBean(w.get('r1'), VALLEY, VALLEY_1), false);
});

test('a shot begun as the check writes again gives up that turn, and the next one writes', async () => {
    const w = tablet({ rows: [recipe('r1', 'House espresso')], loaded: 'r1' });
    const original = copy(w.rows[0]);
    let calls = 0;
    w.onWait = world => { world.rows = [copy(original)]; };
    const answer = await w.change({ bean: VALLEY, batch: VALLEY_1, recipeId: 'r1' });
    // From the check's turn on, the first settled() asked inside it says a shot runs.
    w.settled = () => { calls += 1; return calls !== 3; };
    assert.equal(await answer.checked, 'rewritten');
    assert.equal(w.log.filter(e => e === 'turn').length, 3, 'the change, the turn given up, the turn that wrote');
    assert.ok(holdsBean(w.get('r1'), VALLEY, VALLEY_1));
});

test('the check\'s plan, case by case', () => {
    const row = recipe('r1', 'House espresso');
    const befores = [heldBean(row)];
    assert.deepEqual(beanAfterCheck({ rows: null, recipeId: 'r1', bean: VALLEY, batch: VALLEY_1, befores }), { outcome: 'unreadable', rewrite: false });
    assert.deepEqual(beanAfterCheck({ rows: [], recipeId: 'r1', bean: VALLEY, batch: VALLEY_1, befores }), { outcome: 'gone', rewrite: false });
    assert.deepEqual(beanAfterCheck({ rows: [row], recipeId: 'r1', bean: VALLEY, batch: VALLEY_1, befores }), { outcome: 'rewritten', rewrite: true });
    const held = { ...row, ...{ beanId: VALLEY.id, beanBatchId: VALLEY_1.id }, workflow: { context: { beanBatchId: VALLEY_1.id } } };
    assert.deepEqual(beanAfterCheck({ rows: [held], recipeId: 'r1', bean: VALLEY, batch: VALLEY_1, befores }), { outcome: 'held', rewrite: false });
    // Held at the top of the row and lost in its stored Workflow is not held.
    const half = { ...held, workflow: { context: { beanBatchId: HILL_NEW.id } } };
    assert.equal(holdsBean(half, VALLEY, VALLEY_1), false);
    const other = { ...row, beanBatchId: HILL_OLD.id };
    assert.deepEqual(beanAfterCheck({ rows: [other], recipeId: 'r1', bean: VALLEY, batch: VALLEY_1, befores }), { outcome: 'moved', rewrite: false });
    // A recipe DYE2 made, with no beanId, found back as it was.
    const made = madeByDye2('r2');
    assert.deepEqual(beanAfterCheck({ rows: [made], recipeId: 'r2', bean: VALLEY, batch: VALLEY_1, befores: [heldBean(made)] }), { outcome: 'rewritten', rewrite: true });
});
