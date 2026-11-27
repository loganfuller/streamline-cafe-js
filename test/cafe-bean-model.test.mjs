// The bean and batch dialog's lists, the line under its title, and what a
// choice writes (docs/cafe/DESIGN.md, "The grinder, bean and basket
// dialogs"). All sample data is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    BEAN_PHRASES, listOf, beanList, openingBean, recipeBeanId, sameRecipeBean, beanRows, daysOffRoast, batchCode, weightText, leftToRight, batchRows, batchUse, batchPick, beanSubtitle,
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

test('the right list: "Roasted" and the date over the days since the roast, the Workflow\'s batch in use', () => {
    const rows = batchRows(LIST[0], { beanBatchId: 'b-house-old' }, TODAY, day, t);
    assert.deepEqual(rows.map(({ id, name, detail, inUse }) => ({ id, name, detail, inUse })), [
        { id: 'b-house-new', name: 'Roasted day 2026-11-10', detail: '7 d since roast', inUse: false },
        { id: 'b-house-old', name: 'Roasted day 2026-10-28', detail: '20 d since roast', inUse: true },
        { id: 'b-house-undated', name: 'No roast date', detail: '', inUse: false },
    ]);
    assert.equal(batchRows(LIST[1], {}, TODAY, day, t)[0].detail, '1 d since roast');
    assert.deepEqual(batchRows(undefined, {}, TODAY, day, t), [], 'a bean not listed has no batches to show');
});

const ltr = words => `\u2066${words}\u2069`;

test('a batch row says its Batch Code and what is left beside its roast date, and one with neither reads as before', () => {
    const coded = batch('b-coded', 'bean-house', '2026-11-10T00:00:00.000Z', { weightRemaining: 240, extras: { decentSyncId: 'x', decentSyncBatchCode: 'SB-0211' } });
    const codeOnly = batch('b-code-only', 'bean-house', '2026-11-05T00:00:00.000Z', { extras: { decentSyncBatchCode: 'SB-0198' } });
    const weightOnly = batch('b-weight-only', 'bean-house', '2026-11-01T00:00:00.000Z', { weightRemaining: 2400 });
    const empty = batch('b-empty', 'bean-house', '2026-10-28T00:00:00.000Z', { weightRemaining: 0 });
    const plain = batch('b-plain', 'bean-house', '2026-10-20T00:00:00.000Z', { weightRemaining: null, extras: { decentSyncId: 'y' } });
    const undatedCoded = batch('b-undated-coded', 'bean-house', null, { weightRemaining: 80, extras: { decentSyncBatchCode: 'SB-0150' } });
    const [entry] = beanList([house], [coded, codeOnly, weightOnly, empty, plain, undatedCoded]);
    const rows = batchRows(entry, { beanBatchId: 'b-coded' }, TODAY, day, t);
    assert.deepEqual(rows.map(({ id, name, detail, inUse }) => ({ id, name, detail, inUse })), [
        { id: 'b-coded', name: 'Roasted day 2026-11-10', detail: `SB-0211 · ${ltr('240 g')} left · 7 d since roast`, inUse: true },
        { id: 'b-code-only', name: 'Roasted day 2026-11-05', detail: 'SB-0198 · 12 d since roast', inUse: false },
        { id: 'b-weight-only', name: 'Roasted day 2026-11-01', detail: `${ltr('2.4 kg')} left · 16 d since roast`, inUse: false },
        { id: 'b-empty', name: 'Roasted day 2026-10-28', detail: `${ltr('0 g')} left · 20 d since roast`, inUse: false },
        { id: 'b-plain', name: 'Roasted day 2026-10-20', detail: '28 d since roast', inUse: false },
        { id: 'b-undated-coded', name: 'No roast date', detail: `SB-0150 · ${ltr('80 g')} left`, inUse: false },
    ]);
    assert.deepEqual(rows.map(row => row.details), [
        ['SB-0211', `${ltr('240 g')} left`, '7 d since roast'], ['SB-0198', '12 d since roast'], [`${ltr('2.4 kg')} left`, '16 d since roast'],
        [`${ltr('0 g')} left`, '20 d since roast'], ['28 d since roast'], ['SB-0150', `${ltr('80 g')} left`],
    ], 'the parts of the second line, for the dialog to keep each to itself');
    assert.deepEqual(batchRows(beanList([house], [batch('b-bare', 'bean-house', null)])[0], {}, TODAY, day, t).map(row => [row.detail, row.details]), [['', []]],
        'no roast date, code or weight: no second line');
    assert.equal(batchUse(rows[1], null, null, t).note, 'Sample House Blend · Roasted day 2026-11-05', 'the note beside "Use this batch" keeps to the bean and the roast date');
    const translated = batchRows(entry, {}, TODAY, day, (phrase, vars) => `<${t(phrase, vars)}>`);
    assert.equal(translated[0].detail, `SB-0211 · <${ltr('240 g')} left> · <7 d since roast>`, 'the weight goes through the phrase, and the code is not translated');
});

test('a Batch Code is the text under Decent Sync\'s key in the record\'s extras, and anything else is none', () => {
    assert.equal(batchCode({ extras: { decentSyncBatchCode: 'PR-0470' } }), 'PR-0470');
    assert.equal(batchCode({ extras: { decentSyncBatchCode: '  PR-0470 ' } }), 'PR-0470', 'the spaces around it are dropped');
    for (const none of [undefined, null, {}, { extras: null }, { extras: {} }, { extras: { decentSyncBatchCode: null } }, { extras: { decentSyncBatchCode: '   ' } },
        { extras: { decentSyncBatchCode: 470 } }, { extras: { decentSyncBatchCode: ['PR-0470'] } }, { extras: 'PR-0470' }, { decentSyncBatchCode: 'PR-0470' }]) {
        assert.equal(batchCode(none), '', JSON.stringify(none));
    }
});

test('a weight reads in whole grams under a kilogram and in kilograms from there, zero is a weight, and no number is none', () => {
    assert.deepEqual([0, 0.4, 7.5, 240, 999.4].map(weightText), ['0 g', '0 g', '8 g', '240 g', '999 g']);
    assert.deepEqual([999.5, 1000, 1049, 1050, 1250, 2400, 12000].map(weightText), ['1.0 kg', '1.0 kg', '1.0 kg', '1.1 kg', '1.3 kg', '2.4 kg', '12.0 kg']);
    assert.deepEqual([1049.6, 1249.8, 1949.9].map(weightText), ['1.0 kg', '1.2 kg', '1.9 kg'], 'kilograms are rounded from the weight itself, not from its whole grams');
    for (const none of [undefined, null, '', '240', NaN, Infinity, -1, {}, true]) assert.equal(weightText(none), '', String(none));
});

test('text kept left to right sits between the isolate marks, and none stays none', () => {
    assert.equal(leftToRight('240 g'), '\u2066240 g\u2069');
    assert.equal(leftToRight(''), '');
});

test('days since the roast count calendar days, and a roast dated after today counts as none', () => {
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

test('"Use this batch" is offered for a batch highlighted, with the bean and its roast date beside it', () => {
    const context = { beanBatchId: 'b-house-new' };
    const [inUse, older, undated] = batchRows(LIST.find(entry => entry.bean.id === 'bean-house'), context, TODAY, day, t);
    const [other] = batchRows(LIST.find(entry => entry.bean.id === 'bean-single'), context, TODAY, day, t);
    const recipe = { id: 'r', title: 'Sample Espresso', beanId: 'bean-house' };
    const use = note => ({ label: 'Use this batch', note });
    assert.equal(BEAN_PHRASES.use, 'Use this batch');
    // Another batch of the recipe's own bean, and a batch of another bean.
    assert.deepEqual(batchUse(older, recipe, 'bean-house', t), use('Sample House Blend · Roasted day 2026-10-28'));
    assert.deepEqual(batchUse(undated, recipe, 'bean-house', t), use('Sample House Blend · No roast date'));
    assert.deepEqual(batchUse(other, recipe, 'bean-house', t), use('Sample Single Origin · Roasted day 2026-11-16'));
    // The batch in use of the recipe's own bean: "In use", nothing to confirm.
    assert.equal(batchUse(inUse, recipe, 'bean-house', t), null);
    // With no recipe loaded: the batch in use is "In use", any other is offered.
    assert.equal(batchUse(inUse, null, null, t), null);
    assert.deepEqual(batchUse(older, null, null, t), use('Sample House Blend · Roasted day 2026-10-28'));
    // Nothing highlighted: nothing to offer, and the dialog greys the button.
    assert.equal(batchUse(null, recipe, 'bean-house', t), null);
});

test('the batch in use of another bean than the recipe\'s own is still offered, since choosing it saves the bean onto the recipe', () => {
    const [inUse] = batchRows(LIST.find(entry => entry.bean.id === 'bean-single'), { beanBatchId: 'b-single' }, TODAY, day, t);
    assert.equal(inUse.inUse, true);
    const offer = { label: 'Use this batch', note: 'Sample Single Origin · Roasted day 2026-11-16' };
    assert.deepEqual(batchUse(inUse, { id: 'r', title: 'Sample Espresso', beanId: 'bean-house' }, 'bean-house', t), offer);
    assert.deepEqual(batchUse(inUse, { id: 'r', title: 'No bean yet' }, null, t), offer, 'a recipe that names no Bean takes it as its first');
    assert.equal(batchUse(inUse, { id: 'r', title: 'Sample Espresso', beanId: 'bean-single' }, 'bean-single', t), null, 'its own bean: "In use"');
});

test('a batch of a bean with no name is offered as "Unnamed"', () => {
    const nameless = { id: 'bean-nameless', name: '  ', roaster: 'Sample Roastery' };
    const [row] = batchRows({ bean: nameless, batches: [batch('b-nameless', 'bean-nameless', null)] }, {}, TODAY, day, t);
    assert.deepEqual(batchUse(row, null, null, t), { label: 'Use this batch', note: 'Unnamed · No roast date' });
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

test('a pick is acted on only while the recipe loaded, and its bean, are the ones the dialog opened on', () => {
    const opened = { id: 'r1', beanId: 'bean-house', beanBatchId: 'b-house-new' };
    const own = recipeBeanId(opened, BATCHES);
    assert.equal(sameRecipeBean(opened, opened, own, BATCHES), true);
    assert.equal(sameRecipeBean(opened, { ...opened, beanBatchId: 'b-house-old' }, own, BATCHES), true, 'another batch of the same bean');
    assert.equal(sameRecipeBean(opened, { ...opened, beanId: 'bean-single', beanBatchId: 'b-single' }, own, BATCHES), false, 'its bean changed elsewhere');
    assert.equal(sameRecipeBean(opened, { id: 'r2', beanId: 'bean-house' }, own, BATCHES), false, 'another recipe loaded');
    assert.equal(sameRecipeBean(opened, null, own, BATCHES), false, 'unloaded');
    assert.equal(sameRecipeBean(null, opened, null, BATCHES), false, 'loaded since');
    assert.equal(sameRecipeBean(null, null, null, BATCHES), true, 'none loaded, then or now');
    const none = { id: 'r3', name: 'No bean' };
    assert.equal(sameRecipeBean(none, { ...none }, recipeBeanId(none, BATCHES), BATCHES), true, 'a recipe with no bean, still none');
    assert.equal(sameRecipeBean(none, { ...none, beanBatchId: 'b-single' }, null, BATCHES), false, 'a recipe with no bean that took one');
    const made = { id: 'r4', beanBatchId: 'b-far' };
    const far = batch('b-far', 'bean-far', null);
    assert.equal(sameRecipeBean(made, made, recipeBeanId(made, BATCHES, far), BATCHES, far), true, 'a bean told by the batch read on its own');
});

test('the line under the title follows the bean highlighted on the left', () => {
    const recipe = { id: 'r', title: 'Sample Espresso', beanId: 'bean-house' };
    const vars = { recipe: 'Sample Espresso' };
    const changes = { key: "{recipe} · changes the recipe's bean", vars };
    assert.equal(BEAN_PHRASES.otherBean, changes.key);
    // The Recipe's own Bean highlighted: as the grinder's line, saved or not.
    assert.deepEqual(beanSubtitle(recipe, true, 'bean-house', 'bean-house'), { key: '{recipe} · saved to the recipe', vars });
    assert.deepEqual(beanSubtitle(recipe, false, 'bean-house', 'bean-house'), { key: '{recipe} · not saved to the recipe', vars });
    // Another Bean highlighted: it changes the recipe's bean, on every tablet.
    assert.deepEqual(beanSubtitle(recipe, true, 'bean-single', 'bean-house'), changes);
    assert.deepEqual(beanSubtitle(recipe, false, 'bean-single', 'bean-house'), changes);
    // A Recipe that names no Bean takes any bean as its first, saved or not.
    assert.deepEqual(beanSubtitle({ id: 'r', title: 'Sample Espresso' }, true, 'bean-single', null), changes);
    assert.deepEqual(beanSubtitle({ id: 'r', title: 'Sample Espresso' }, false, 'bean-single', null), changes);
    // Ids compared as text, as Decaid's and DYE2's may differ in type.
    assert.deepEqual(beanSubtitle({ ...recipe, beanId: 7 }, true, '7', '7'), { key: '{recipe} · saved to the recipe', vars });
    // No recipe: this machine only, whichever bean.
    assert.deepEqual(beanSubtitle(null, true, 'bean-single', null), { key: 'No recipe loaded · changes this machine only' });
    assert.deepEqual(beanSubtitle(null, false, 'bean-single', 'bean-house'), { key: 'No recipe loaded · changes this machine only' });
    // An empty list highlights nothing.
    assert.deepEqual(beanSubtitle(recipe, true, null, 'bean-house'), { key: '{recipe} · saved to the recipe', vars });
});
