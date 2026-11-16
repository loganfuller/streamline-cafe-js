// What a long-press on a card offers, and which recipes can be chosen for a
// slot (docs/cafe/DESIGN.md, "Recipes and the strip"). All sample data is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { slotMenu, recipesWithoutSlot } from '../src/cafe/slot-menu.js';

const row = (id, stripSlot, over = {}) => ({ id, stripSlot, name: `Recipe ${id}`, title: `Recipe ${id}`, ...over });

test('an empty slot offers a new recipe and a choice', () => {
    assert.deepEqual(slotMenu({ slot: '6', recipe: null }).map(item => item.action), ['new', 'choose']);
});

test('a filled card offers the same two as replacements, and taking the recipe out', () => {
    const items = slotMenu({ slot: '2', recipe: row('a', 2) });
    assert.deepEqual(items.map(item => item.action), ['new', 'choose', 'remove']);
    assert.deepEqual(items.map(item => item.label), ['Replace with a new recipe', 'Replace with another recipe…', 'Remove from slot']);
});

test('no item opens anything of DYE2\'s', () => {
    for (const card of [{ slot: '1', recipe: null }, { slot: '1', recipe: row('a', 1) }]) {
        assert.ok(slotMenu(card).every(item => ['new', 'choose', 'remove'].includes(item.action)));
    }
});

test('only recipes in no slot can be chosen', () => {
    const rows = [row('a', 1), row('b', null), row('c', 9), row('d', null)];
    assert.deepEqual(recipesWithoutSlot(rows).map(choice => choice.recipe.id), ['b', 'd']);
});

test('a recipe hidden from the strip, or naming a slot that does not exist, is in no slot', () => {
    const rows = [row('a', 3, { showOnStreamlineDashboard: false }), row('b', 12), row('c', 3)];
    assert.deepEqual(recipesWithoutSlot(rows).map(choice => choice.recipe.id), ['a', 'b']);
});

test('of two recipes naming one slot, the one the strip does not show can be chosen', () => {
    const rows = [row('a', 5), row('b', 5)];
    assert.deepEqual(recipesWithoutSlot(rows).map(choice => choice.recipe.id), ['b']);
});

test('the list is sorted by name, whatever the case, with numbers in order', () => {
    const rows = [row('1', null, { title: 'filter 10' }), row('2', null, { title: 'Decaf' }), row('3', null, { title: 'Filter 2' }), row('4', null, { title: 'americano' })];
    assert.deepEqual(recipesWithoutSlot(rows).map(choice => choice.name), ['americano', 'Decaf', 'Filter 2', 'filter 10']);
});

test('a row shows the recipe\'s name over its bean and profile', () => {
    const [choice] = recipesWithoutSlot([row('a', null, { title: 'House espresso', beanName: 'Sample Blend', profileTitle: 'Default' })]);
    assert.equal(choice.name, 'House espresso');
    assert.equal(choice.detail, 'Sample Blend · Default');
    const [bare] = recipesWithoutSlot([row('b', null, { beanName: '', profileTitle: undefined })]);
    assert.equal(bare.detail, '');
});

test('records that are not a list, or hold what is not a recipe, give an empty list', () => {
    assert.deepEqual(recipesWithoutSlot(null), []);
    assert.deepEqual(recipesWithoutSlot([null, 'stray', 3]), []);
});
