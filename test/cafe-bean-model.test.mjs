// The bean and batch dialog's lists, the line under its title, and what a
// choice writes (docs/cafe/DESIGN.md, "The grinder, bean and basket
// dialogs"). All sample data is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    BEAN_PHRASES, listOf, beanList, openingBean, recipeBeanId, beanRows, daysOffRoast, batchRows, batchPick, beanSubtitle,
} from '../src/cafe/bean-model.js';
import { assertDeclaredFields } from '../src/modules/workflow-fields.js';

// The phrase with its places filled in, as cafeText answers in English.
const t = (phrase, vars = {}) => phrase.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole));
const day = d => `day ${d}`; // what formatRoastDay would write, kept visible
const TODAY = '2026-11-17';

const house = { id: 'bean-house', name: 'Sample House Blend', roaster: 'Sample Roastery' };
const single = { id: 'bean-single', name: 'Sample Single Origin', roaster: 'Other Sample Roaster' };
const empty = { id: 'bean-empty', name: 'Sample Bean With None', roaster: 'Sample Roastery' };
const retired = { id: 'bean-retired', name: 'Sample Retired Bean', roaster: 'Sample Roastery', archived: true };

const batch = (id, beanId, roastDate, extra = {}) => ({ id, beanId, roastDate, ...extra });
const houseNew = batch('b-house-new', 'bean-house', '2026-11-10T00:00:00.000Z');
const houseOld = batch('b-house-old', 'bean-house', '2026-10-28T00:00:00.000Z');
const houseUndated = batch('b-house-undated', 'bean-house', null);
const houseFinished = batch('b-house-finished', 'bean-house', '2026-10-01T00:00:00.000Z', { archived: true });
const singleOnly = batch('b-single', 'bean-single', '2026-11-16T00:00:00.000Z');
const emptyFinished = batch('b-empty-finished', 'bean-empty', '2026-09-01T00:00:00.000Z', { archived: true });
const retiredBatch = batch('b-retired', 'bean-retired', '2026-11-01T00:00:00.000Z');

// Decaid lists batches by last update, not by roast date.
const BEANS = [single, empty, house, retired];
const BATCHES = [houseOld, houseUndated, singleOnly, houseFinished, houseNew, emptyFinished, retiredBatch];
const LIST = beanList(BEANS, BATCHES);

test('a list is an array, or Decaid\'s { items }; anything else can\'t be read', () => {
    assert.deepEqual(listOf([1]), [1]);
    assert.deepEqual(listOf({ items: [2] }), [2]);
    assert.equal(listOf(null), null);
    assert.equal(listOf({ error: 'x' }), null);
    assert.equal(beanList(null, BATCHES), null, 'beans that can\'t be read are not an empty list');
    assert.equal(beanList(BEANS, 'x'), null, 'nor are batches');
});

test('the bean list holds beans not archived with a batch not archived, sorted by name', () => {
    assert.deepEqual(LIST.map(entry => entry.bean.id), ['bean-house', 'bean-single'],
        'a bean with no batch, or with only archived ones, is not listed; nor is an archived bean');
    assert.deepEqual(beanList([], []), [], 'no beans is an empty list');
});

test('a bean\'s batches are those not archived, newest roast first, an undated one last', () => {
    const [houseEntry, singleEntry] = LIST;
    assert.deepEqual(houseEntry.batches.map(b => b.id), ['b-house-new', 'b-house-old', 'b-house-undated']);
    assert.deepEqual(singleEntry.batches.map(b => b.id), ['b-single']);
});

test('the left list: each bean\'s name over its roaster and how many batches it has', () => {
    const rows = beanRows(LIST, 'bean-single', t);
    assert.deepEqual(rows.map(({ id, name, detail, highlighted }) => ({ id, name, detail, highlighted })), [
        { id: 'bean-house', name: 'Sample House Blend', detail: 'Sample Roastery · 3 batches', highlighted: false },
        { id: 'bean-single', name: 'Sample Single Origin', detail: 'Other Sample Roaster · 1 batch', highlighted: true },
    ]);
    const unnamed = beanRows(beanList([{ id: 'x' }], [batch('bx', 'x', null)]), 'x', t)[0];
    assert.deepEqual([unnamed.name, unnamed.detail], ['Unnamed', '1 batch'], 'no name and no roaster');
});

test('the right list: "Roasted" and the date over the days off roast, the Workflow\'s batch in use', () => {
    const rows = batchRows(LIST[0], { beanBatchId: 'b-house-old' }, TODAY, day, t);
    assert.deepEqual(rows.map(({ id, name, detail, inUse }) => ({ id, name, detail, inUse })), [
        { id: 'b-house-new', name: 'Roasted day 2026-11-10', detail: '7 days off roast', inUse: false },
        { id: 'b-house-old', name: 'Roasted day 2026-10-28', detail: '20 days off roast', inUse: true },
        { id: 'b-house-undated', name: 'No roast date', detail: '', inUse: false },
    ]);
    assert.equal(batchRows(LIST[1], {}, TODAY, day, t)[0].detail, '1 day off roast');
    assert.deepEqual(batchRows(undefined, {}, TODAY, day, t), [], 'a bean not listed has no batches to show');
});

test('days off roast count calendar days, and a roast dated after today counts as none', () => {
    assert.equal(daysOffRoast('2026-11-17', TODAY), 0);
    assert.equal(daysOffRoast('2026-10-31', TODAY), 17);
    assert.equal(daysOffRoast('2026-03-01', '2026-03-31'), 30, 'across a change of clocks, whole days');
    assert.equal(daysOffRoast('2026-11-20', TODAY), 0);
    assert.equal(daysOffRoast(null, TODAY), null);
    assert.equal(daysOffRoast('2026-11-01', ''), null);
});

test('the dialog opens on the bean in use', () => {
    assert.equal(openingBean(LIST, { beanBatchId: 'b-single' }, BATCHES), 'bean-single');
    assert.equal(openingBean(LIST, { beanBatchId: 'b-house-finished' }, BATCHES), 'bean-house',
        'an archived batch in use still says which bean is');
    assert.equal(openingBean(LIST, { beanBatchId: 'gone', coffeeName: 'Sample Single Origin', coffeeRoaster: 'Other Sample Roaster' }, BATCHES), 'bean-single',
        'a batch not read at all: the bean with the Workflow\'s name and roaster');
    assert.equal(openingBean(LIST, { beanBatchId: 'b-retired' }, BATCHES), 'bean-house', 'a bean not listed: the first');
    assert.equal(openingBean(LIST, {}, BATCHES), 'bean-house');
    assert.equal(openingBean([], {}, BATCHES), null);
});

test('an archived batch in use is not listed, and no row is marked "In use"', () => {
    const context = { beanBatchId: 'b-house-finished' };
    const rows = batchRows(LIST.find(entry => entry.bean.id === openingBean(LIST, context, BATCHES)), context, TODAY, day, t);
    assert.equal(rows.some(row => row.id === 'b-house-finished'), false);
    assert.equal(rows.some(row => row.inUse), false);
});

test('a batch writes the bean\'s name, its roaster and the batch\'s id, in one write under beans.select', () => {
    const patch = batchPick(house, houseNew, { beanBatchId: 'b-single' });
    assert.deepEqual(patch, { context: { beanBatchId: 'b-house-new', coffeeName: 'Sample House Blend', coffeeRoaster: 'Sample Roastery' } });
    assert.equal(assertDeclaredFields('beans.select', patch), true);
    assert.deepEqual(batchPick({ id: 'x', name: 'Sample' }, batch('bx', 'x', null), {}).context.coffeeRoaster, null,
        'no roaster is written as none, as Streamline\'s picker writes it');
});

test('a tap on the batch in use writes nothing', () => {
    assert.equal(batchPick(house, houseNew, { beanBatchId: 'b-house-new' }), null);
    assert.equal(batchPick(house, null, {}), null);
    assert.equal(batchPick(single, houseNew, {}), null, 'a batch of another bean than its row\'s is not written');
});

test('the Recipe\'s own Bean is the one its record names, else its batch\'s', () => {
    assert.equal(recipeBeanId({ beanId: 'bean-house', beanBatchId: 'b-single' }, BATCHES), 'bean-house');
    assert.equal(recipeBeanId({ beanBatchId: 'b-single' }, BATCHES), 'bean-single', 'a recipe DYE2 made from the Workflow has no beanId');
    assert.equal(recipeBeanId({ beanId: '  ', beanBatchId: 'b-single' }, BATCHES), 'bean-single', 'a blank beanId is none');
    assert.equal(recipeBeanId({ beanBatchId: 'b-house-finished' }, BATCHES), 'bean-house', 'an archived batch still tells its bean');
    assert.equal(recipeBeanId({ beanBatchId: 'b-far' }, BATCHES, batch('b-far', 'bean-far', null)), 'bean-far', 'or the batch read on its own');
    assert.equal(recipeBeanId({ beanBatchId: 'b-far' }, BATCHES), null, 'a batch nowhere to be read gives no Bean');
    assert.equal(recipeBeanId({ name: 'No bean' }, BATCHES), null, 'a record that names neither has no Bean');
    assert.equal(recipeBeanId(null, BATCHES), null);
});

test('the line under the title follows the bean highlighted on the left', () => {
    const recipe = { id: 'r', title: 'Sample Espresso', beanId: 'bean-house' };
    const vars = { recipe: 'Sample Espresso' };
    // Served, the Recipe's own Bean highlighted: saved.
    assert.deepEqual(beanSubtitle(recipe, true, 'bean-house', 'bean-house'), { key: '{recipe} · saved to the recipe', vars });
    // Served, another Bean highlighted: this machine only, the Recipe kept loaded.
    assert.deepEqual(beanSubtitle(recipe, true, 'bean-single', 'bean-house'), { key: BEAN_PHRASES.otherBean, vars });
    // Served, a Recipe that names no Bean takes any batch with its Bean.
    assert.deepEqual(beanSubtitle({ id: 'r', title: 'Sample Espresso' }, true, 'bean-single', null), { key: '{recipe} · saved to the recipe', vars });
    // Not served: nothing is saved, whichever bean.
    assert.deepEqual(beanSubtitle(recipe, false, 'bean-single', 'bean-house'), { key: '{recipe} · not saved to the recipe', vars });
    assert.deepEqual(beanSubtitle(recipe, false, 'bean-house', 'bean-house'), { key: '{recipe} · not saved to the recipe', vars });
    // No recipe.
    assert.deepEqual(beanSubtitle(null, true, 'bean-single', null), { key: 'No recipe loaded · changes this machine only' });
    // An empty list highlights nothing.
    assert.deepEqual(beanSubtitle(recipe, true, null, 'bean-house'), { key: '{recipe} · saved to the recipe', vars });
});
