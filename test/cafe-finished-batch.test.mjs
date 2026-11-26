// A finished batch (docs/cafe/DESIGN.md, "A finished batch"): whether the Bean
// Batch a recipe or the Workflow names is archived on the tablet. All sample
// data is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { recipeBatchId, workflowBatchId, batchFinished, cardBatchIds, recordsAfterRead, finishedSlots, workflowFinished } from '../src/cafe/finished-batch.js';

const OPEN = { id: 'open', beanId: 'blend', archived: false };
const GONE = { id: 'gone', beanId: 'blend', archived: true };
const card = (slot, beanBatchId) => ({ slot: String(slot), recipe: { id: `r${slot}`, title: `Recipe ${slot}`, ...(beanBatchId === undefined ? {} : { beanBatchId }) } });
const EMPTY = { slot: '9', recipe: null };

test('a recipe\'s batch is the one DYE2\'s record names', () => {
    assert.equal(recipeBatchId({ beanBatchId: 'gone' }), 'gone');
    for (const recipe of [null, undefined, {}, { beanBatchId: '' }, { beanBatchId: null }, { beanBatchId: 7 }]) {
        assert.equal(recipeBatchId(recipe), null);
    }
});

test('the Workflow\'s batch is the one its context names', () => {
    assert.equal(workflowBatchId({ context: { beanBatchId: 'gone' } }), 'gone');
    for (const workflow of [null, {}, { context: {} }, { context: { beanBatchId: '' } }]) {
        assert.equal(workflowBatchId(workflow), null);
    }
});

test('a batch is finished only when Decaid\'s record of that batch says archived', () => {
    assert.equal(batchFinished('gone', GONE), true);
    assert.equal(batchFinished('open', OPEN), false);
    assert.equal(batchFinished('gone', null), false, 'no record on the tablet');
    assert.equal(batchFinished('gone', undefined), false);
    assert.equal(batchFinished(null, GONE), false, 'no batch named');
    assert.equal(batchFinished('open', GONE), false, 'another batch\'s record');
    assert.equal(batchFinished('gone', { id: 'gone', archived: 'true' }), false, 'only true is archived');
    assert.equal(batchFinished('gone', { id: 'gone' }), false);
});

test('each batch the cards name is read once', () => {
    assert.deepEqual(cardBatchIds([card(1, 'gone'), card(2, 'open'), card(3, 'gone'), card(4), card(5, ''), EMPTY]), ['gone', 'open']);
    assert.deepEqual(cardBatchIds([]), []);
    assert.deepEqual(cardBatchIds(null), []);
});

test('the slots whose recipe names a finished batch are marked, in every slot', () => {
    const records = new Map([['gone', GONE], ['open', OPEN]]);
    const cards = [card(1, 'gone'), card(2, 'open'), card(3), card(4, 'unknown'), card(6, 'gone'), card(8, 'gone'), EMPTY];
    assert.deepEqual(finishedSlots(cards, records), ['1', '6', '8']);
    assert.deepEqual(finishedSlots(cards, new Map()), []);
    assert.deepEqual(finishedSlots(cards, null), []);
});

test('a batch read again replaces its record, so the red ends when it is un-archived', () => {
    const known = new Map([['gone', GONE]]);
    const next = recordsAfterRead(known, ['gone'], [{ id: 'gone', record: { ...GONE, archived: false } }]);
    assert.deepEqual(finishedSlots([card(1, 'gone')], next), []);
    assert.deepEqual(finishedSlots([card(1, 'gone')], known), ['1'], 'the records before are left as they were');
});

test('a batch whose read failed keeps the record last read for it', () => {
    const known = new Map([['gone', GONE], ['open', OPEN]]);
    const next = recordsAfterRead(known, ['gone', 'open'], [null, { id: 'open', record: { ...OPEN, archived: true } }]);
    assert.equal(next.get('gone'), GONE);
    assert.equal(next.get('open').archived, true);
});

test('a batch never read has no record, and one no card names is forgotten', () => {
    const next = recordsAfterRead(new Map([['open', OPEN]]), ['gone'], [null]);
    assert.equal(next.size, 0);
    assert.equal(recordsAfterRead(null, ['gone'], undefined).size, 0);
});

test('the Workflow\'s batch is finished by the record of the batch it names', () => {
    const workflow = { context: { beanBatchId: 'gone', coffeeName: 'Sample Blend' } };
    assert.equal(workflowFinished(workflow, GONE), true);
    assert.equal(workflowFinished(workflow, { ...GONE, archived: false }), false);
    assert.equal(workflowFinished(workflow, null), false, 'the record has not arrived, or the tablet has none');
    assert.equal(workflowFinished(workflow, { id: 'other', archived: true }), false, 'the record of the batch named before');
    assert.equal(workflowFinished({ context: { coffeeName: 'Sample Blend' } }, GONE), false, 'no batch');
    assert.equal(workflowFinished(null, GONE), false);
});
