// A recipe made from a held empty slot (docs/cafe/DESIGN.md, "Recipes and the
// strip"). All sample data is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { holdOf, heldPlacement } from '../src/cafe/slot-hold.js';

const row = (id, stripSlot, over = {}) => ({ id, stripSlot, name: `Recipe ${id}`, showOnStreamlineDashboard: true, ...over });
const before = [row('a', 1), row('b', 7), row('c', null)];

test('the hold remembers the slot and every recipe that existed', () => {
    assert.deepEqual(holdOf('8', [...before, null]), { slot: 8, known: ['a', 'b', 'c'] });
    assert.deepEqual(holdOf(3, null), { slot: 3, known: [] });
});

test('the one new recipe goes in the held slot, from 1 to 5 and from 6 to 9', () => {
    const fresh = row('new', null);
    for (const slot of [2, 5, 6, 9]) {
        const plan = heldPlacement(holdOf(slot, before), [...before, fresh]);
        assert.equal(plan.recipe, fresh);
        assert.equal(plan.slot, slot);
    }
});

test('the editor left without saving: nothing is placed', () => {
    assert.deepEqual(heldPlacement(holdOf(8, before), before), { recipe: null, reason: 'none-new' });
});

test('more than one new recipe: nothing is placed', () => {
    const rows = [...before, row('new', null), row('other', null)];
    assert.deepEqual(heldPlacement(holdOf(8, before), rows), { recipe: null, reason: 'several-new' });
});

test('the held slot was filled meanwhile: nothing is placed', () => {
    // Another tablet's recipe arrived in the slot. It existed before, so it is
    // not new, and the new recipe does not take the slot from it.
    const rows = [row('a', 1), row('b', 7), row('c', 8), row('new', null)];
    assert.deepEqual(heldPlacement(holdOf(8, before), rows), { recipe: null, reason: 'taken' });
});

test('a recipe deleted meanwhile does not make another one new', () => {
    assert.deepEqual(heldPlacement(holdOf(8, before), [row('a', 1)]), { recipe: null, reason: 'none-new' });
});

test('a new recipe DYE2 placed itself, or the barista placed in the editor, is left where it is', () => {
    assert.equal(heldPlacement(holdOf(4, before), [...before, row('new', 4)]).reason, 'placed');
    assert.equal(heldPlacement(holdOf(8, before), [...before, row('new', 2)]).reason, 'placed');
});

test('a new recipe switched off the strip in the editor is not put on it', () => {
    const rows = [...before, row('new', null, { showOnStreamlineDashboard: false })];
    assert.equal(heldPlacement(holdOf(8, before), rows).reason, 'hidden');
});

test('a hidden recipe naming the held slot does not fill it', () => {
    const rows = [...before, row('old', 8, { showOnStreamlineDashboard: false }), row('new', null)];
    const known = holdOf(8, [...before, rows[3]]);
    assert.equal(heldPlacement(known, rows).recipe.id, 'new');
});

test('ids are compared as text, so a numeric id that existed is not new', () => {
    const rows = [row(1, 1), row('new', null)];
    assert.equal(heldPlacement({ slot: 6, known: ['1'] }, rows).recipe.id, 'new');
});

test('nothing usable remembered: nothing is placed', () => {
    const rows = [...before, row('new', null)];
    for (const hold of [null, undefined, 'x', {}, { slot: 0, known: [] }, { slot: 10, known: [] }, { slot: '7', known: [] }, { slot: 7 }, { slot: 7.5, known: [] }]) {
        assert.deepEqual(heldPlacement(hold, rows), { recipe: null, reason: 'no-hold' });
    }
});

test('records that are not a list place nothing', () => {
    assert.deepEqual(heldPlacement(holdOf(8, before), null), { recipe: null, reason: 'none-new' });
});
