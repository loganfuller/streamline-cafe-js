// A batch's weight entered in the bean and batch dialog: what is left, the
// view's state and words, and what is written (docs/cafe/DESIGN.md, "Entering
// a batch's weight"), with the container's weight at 0 and above it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WEIGHT_PHRASES, MAX_TYPED, MAX_CONTAINER, containerWeight, typedGrams, recordGrams, weighing, weightFacts, weightCode, fieldLabel, workingLine, weightMessage, saveLabel, weightWrite, finishWrite, stored } from '../src/cafe/weight-model.js';
import { fillIn } from '../src/cafe/translations.js';

const t = (key, vars) => fillIn(key, vars);
const plain = text => text.replace(/[⁦⁩]/g, '');
const BATCH = { id: 'b1', beanId: 'n1', roastDate: '2026-11-18T00:00:00Z', weight: 6000, weightRemaining: 2412.4, archived: false, extras: { decentSyncId: 'srv-1', decentSyncBatchCode: 'SR-0412' } };

test('the container\'s weight is whole grams from 0 to 20 000, and 0 for a tablet that has kept none', () => {
    assert.equal(MAX_CONTAINER, 20_000);
    assert.equal(containerWeight(null), 0, 'a key Decaid\'s store does not hold');
    assert.equal(containerWeight(undefined), 0);
    assert.equal(containerWeight(350), 350);
    assert.equal(containerWeight('350'), 350, 'as typed into the setting');
    assert.equal(containerWeight('350.'), 350, 'confirmed on the numpad after its decimal key');
    assert.equal(containerWeight(349.6), 350, 'whole grams');
    assert.equal(containerWeight(25_000), 20_000, 'kept at the most');
    assert.equal(containerWeight(-5), 0);
    assert.equal(containerWeight('heavy'), 0);
    assert.equal(containerWeight({}), 0);
    assert.equal(containerWeight(Number.NaN), 0);
});

test('what is typed is whole grams up to 100 000, and nothing typed is no weight', () => {
    assert.equal(MAX_TYPED, 100_000);
    assert.equal(typedGrams(''), null);
    assert.equal(typedGrams('   '), null);
    assert.equal(typedGrams(null), null);
    assert.equal(typedGrams('3240'), 3240);
    assert.equal(typedGrams('0'), 0, 'zero is typed, not empty');
    assert.equal(typedGrams('3240.6'), 3241, 'the numpad\'s decimal key: whole grams');
    assert.equal(typedGrams('3240.'), 3240, 'the decimal key with nothing after it');
    assert.equal(typedGrams('.'), null);
    assert.equal(typedGrams('100000'), 100_000);
    assert.equal(typedGrams('100001'), 100_000, 'nothing above the most');
    assert.equal(typedGrams('999999'), 100_000);
    assert.equal(typedGrams('-5'), null);
    assert.equal(typedGrams('12g'), null);
});

test('with a container set: what is left is what the scale reads less the container', () => {
    assert.deepEqual(weighing(3240, 350, BATCH), { state: 'ready', left: 2890, saves: true, finishes: false });
    assert.deepEqual(weighing(null, 350, BATCH), { state: 'empty', left: null, saves: false, finishes: false }, 'nothing typed');
    assert.deepEqual(weighing(300, 350, BATCH), { state: 'underContainer', left: null, saves: false, finishes: false }, 'refused');
    assert.deepEqual(weighing(0, 350, BATCH), { state: 'underContainer', left: null, saves: false, finishes: false });
    assert.deepEqual(weighing(350, 350, BATCH), { state: 'nothingLeft', left: 0, saves: false, finishes: true }, 'exactly the container');
    assert.deepEqual(weighing(6350, 350, BATCH), { state: 'ready', left: 6000, saves: true, finishes: false }, 'the roasted weight itself is no warning');
    assert.deepEqual(weighing(6351, 350, BATCH), { state: 'aboveRoasted', left: 6001, saves: true, finishes: false }, 'a warning that can still be saved');
});

test('with no container: what is typed is what is left', () => {
    assert.deepEqual(weighing(2890, 0, BATCH), { state: 'ready', left: 2890, saves: true, finishes: false });
    assert.deepEqual(weighing(0, 0, BATCH), { state: 'nothingLeft', left: 0, saves: false, finishes: true });
    assert.deepEqual(weighing(null, 0, BATCH), { state: 'empty', left: null, saves: false, finishes: false });
    assert.deepEqual(weighing(6001, 0, BATCH), { state: 'aboveRoasted', left: 6001, saves: true, finishes: false });
    assert.equal(weighing(1, 0, BATCH).state, 'ready', 'never less than no container');
});

test('a record with no roasted weight warns of none, and a batch nobody weighed takes a weight', () => {
    for (const weight of [undefined, null, 0, 'heavy', Number.NaN]) {
        assert.equal(weighing(99_000, 350, { ...BATCH, weight }).state, 'ready', `roasted weight ${weight}`);
    }
    const unweighed = { id: 'b2', beanId: 'n1' };
    assert.deepEqual(weighing(3240, 350, unweighed), { state: 'ready', left: 2890, saves: true, finishes: false });
    assert.deepEqual(weighing(350, 350, { ...BATCH, weightRemaining: 0 }), { state: 'nothingLeft', left: 0, saves: false, finishes: true }, 'a record that already reads zero is finished too');
});

test('the view says what is left now in whole grams, the roasted weight where there is one, and the container only where one is set', () => {
    assert.deepEqual(weightFacts(BATCH, 350, t).map(fact => [fact.label, plain(fact.value)]), [['Left now', '2412 g'], ['Roasted weight', '6000 g'], ['Container', '350 g']]);
    assert.deepEqual(weightFacts(BATCH, 0, t).map(fact => fact.label), ['Left now', 'Roasted weight'], 'no container is mentioned');
    assert.deepEqual(weightFacts({ id: 'b2' }, 0, t).map(fact => [fact.label, fact.value]), [['Left now', 'Not weighed yet']]);
    assert.deepEqual(weightFacts({ ...BATCH, weightRemaining: 0, weight: null }, 0, t).map(fact => [fact.label, plain(fact.value)]), [['Left now', '0 g']], 'zero is a weight');
    assert.equal(plain(weightFacts({ ...BATCH, weightRemaining: 12_345 }, 0, t)[0].value), '12345 g', 'grams, not kilograms');
    assert.equal(weightFacts({ ...BATCH, weightRemaining: -1 }, 0, t)[0].value, 'Not weighed yet');
    assert.equal(weightCode(BATCH), 'SR-0412');
    assert.equal(weightCode({ id: 'b2' }), '');
    assert.equal(recordGrams('2412'), null, 'a record\'s weight is a number');
});

test('the field is labelled for a weight with its container only where one is set', () => {
    assert.equal(fieldLabel(350), 'Weight with its container');
    assert.equal(fieldLabel(0), 'Weight');
});

test('the working is shown before anything is saved, and not at all with no container', () => {
    const working = workingLine(3240, 350, t);
    assert.equal(plain(working.sum), '3240 g − 350 g container');
    assert.equal(plain(working.left), '2890 g left');
    assert.equal(plain(workingLine(350, 350, t).left), '0 g left');
    assert.deepEqual({ sum: plain(workingLine(300, 350, t).sum), left: workingLine(300, 350, t).left }, { sum: '300 g − 350 g container', left: '' }, 'less than the container has no result');
    assert.equal(workingLine(null, 350, t), null, 'nothing typed');
    assert.equal(workingLine(2890, 0, t), null, 'no container');
    assert.match(working.sum, /⁦3240 g⁩/, 'each weight kept left to right');
});

test('each state\'s message, and a write that failed said in its place', () => {
    const said = (state, extra = {}) => weightMessage(state, { container: 350, batch: BATCH, ...extra });
    assert.equal(said('ready'), null);
    assert.equal(said('empty'), null);
    assert.deepEqual(said('nothingLeft'), { tone: 'stop', title: 'Nothing is left', body: { key: WEIGHT_PHRASES.nothingLeftBody } });
    const under = said('underContainer');
    assert.deepEqual([under.tone, under.title, plain(t(under.body.key, under.body.vars))], ['stop', 'Less than the container', 'The container alone weighs 350 g. Weigh the batch in its container and enter what the scale reads.']);
    const above = said('aboveRoasted');
    assert.deepEqual([above.tone, above.title, plain(t(above.body.key, above.body.vars))], ['warn', 'More than this batch was roasted at', 'It was roasted at 6000 g. Check the number before saving.']);
    assert.deepEqual(said('ready', { failed: 'save' }), { tone: 'stop', title: 'Could not save the weight', body: { key: 'Nothing was changed. Try again.' } });
    assert.deepEqual(said('nothingLeft', { failed: 'finish' }), { tone: 'stop', title: 'Could not finish the batch', body: { key: 'Nothing was changed. Try again.' } });
    assert.equal(saveLabel('ready'), 'Save');
    assert.equal(saveLabel('aboveRoasted'), 'Save');
    assert.equal(saveLabel('empty'), 'Save');
    assert.equal(saveLabel('nothingLeft'), 'Finish batch');
});

test('a save writes the remaining weight alone, and a finish the archive alone, never a zero', () => {
    assert.deepEqual(weightWrite(2890), { weightRemaining: 2890 });
    assert.deepEqual(weightWrite(100_000), { weightRemaining: 100_000 });
    assert.equal(weightWrite(0), null, 'nothing left is a finish');
    assert.equal(weightWrite(-1), null);
    assert.equal(weightWrite(100_001), null);
    assert.equal(weightWrite(12.5), null);
    assert.equal(weightWrite(null), null);
    assert.deepEqual(finishWrite(), { archived: true });
});

test('a write is done once Decaid\'s answer holds it', () => {
    assert.equal(stored({ ...BATCH, weightRemaining: 2890 }, { weightRemaining: 2890 }), true);
    assert.equal(stored(BATCH, { weightRemaining: 2890 }), false, 'the record as it was');
    assert.equal(stored({ ...BATCH, archived: true }, { archived: true }), true);
    assert.equal(stored(BATCH, { archived: true }), false);
    assert.equal(stored(null, { archived: true }), false);
    assert.equal(stored({}, null), false);
});

test('no phrase names Decent Sync or a Location, or says that anything waits to be sent', () => {
    for (const phrase of Object.values(WEIGHT_PHRASES)) {
        assert.doesNotMatch(phrase, /decent sync|location|sync|sent|server/i, phrase);
    }
});
