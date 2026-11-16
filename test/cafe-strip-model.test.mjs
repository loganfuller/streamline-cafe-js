// The nine recipe cards and the loaded recipe (docs/cafe/DESIGN.md, "Recipes
// and the strip"). All sample data is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SLOT_COUNT, stripCards, loadedRecipe, loadedAfterRead, recipeName, recipeBean } from '../src/cafe/strip-model.js';

const recipe = (id, stripSlot, over = {}) => ({
    id, stripSlot, name: `Recipe ${id}`, title: `Recipe ${id}`, beanName: `Bean ${id}`, ...over,
});

test('there are nine cards, one per Recipe Slot, in order', () => {
    const cards = stripCards([], null);
    assert.equal(SLOT_COUNT, 9);
    assert.deepEqual(cards.map(c => c.slot), ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    assert.ok(cards.every(c => c.recipe === null));
});

test('a recipe sits at its slot, 6 to 9 included, and empty slots stay in place', () => {
    const cards = stripCards([recipe('a', 2), recipe('b', 7), recipe('c', 9)], null);
    assert.deepEqual(cards.map(c => (c.recipe ? c.recipe.id : null)),
        [null, 'a', null, null, null, null, 'b', null, 'c']);
});

test('a filled card shows the name and the bean', () => {
    const [card] = stripCards([recipe('a', 1, { title: 'House espresso', beanName: 'Sample Blend' })], null);
    assert.equal(card.name, 'House espresso');
    assert.equal(card.bean, 'Sample Blend');
    assert.equal(card.loaded, false);
});

test('a recipe with no slot, or taken off the strip, has no card', () => {
    const rows = [recipe('a', null), recipe('b', 3, { showOnStreamlineDashboard: false }), recipe('c', 10), recipe('d', 4)];
    assert.deepEqual(stripCards(rows, null).filter(c => c.recipe).map(c => c.recipe.id), ['d']);
});

test('one recipe per slot: the first row holding it wins', () => {
    const cards = stripCards([recipe('a', 5), recipe('b', 5)], null);
    assert.equal(cards[4].recipe.id, 'a');
    assert.equal(cards.filter(c => c.recipe).length, 1);
});

test('records that are not a list give nine empty cards', () => {
    for (const rows of [null, undefined, 'nope', {}]) {
        assert.ok(stripCards(rows, null).every(c => c.recipe === null));
    }
});

test('only the loaded recipe\'s card is marked', () => {
    const rows = [recipe('a', 1), recipe('b', 6)];
    const cards = stripCards(rows, rows[1]);
    assert.deepEqual(cards.filter(c => c.recipe).map(c => [c.recipe.id, c.loaded]), [['a', false], ['b', true]]);
});

test('the loaded recipe is the one DYE2\'s selection names', () => {
    const rows = [recipe('a', 1), recipe('b', 6), recipe('c', null)];
    assert.equal(loadedRecipe({ kind: 'recipe', id: 'b' }, rows), rows[1]);
    // The id may come back as a number or a string.
    assert.equal(loadedRecipe({ kind: 'recipe', id: 7 }, [recipe('7', 2)]).id, '7');
    // A loaded recipe need not be in a slot.
    assert.equal(loadedRecipe({ kind: 'recipe', id: 'c' }, rows), rows[2]);
});

test('nothing is loaded for an empty selection, a favourite, or a recipe that has gone', () => {
    const rows = [recipe('a', 1)];
    assert.equal(loadedRecipe(null, rows), null);
    assert.equal(loadedRecipe({}, rows), null);
    assert.equal(loadedRecipe({ kind: 'favourite', id: 'a' }, rows), null);
    assert.equal(loadedRecipe({ kind: 'recipe', id: 'gone' }, rows), null);
    assert.equal(loadedRecipe({ kind: 'recipe', id: 'a' }, null), null);
});

test('after a read, DYE2\'s answer decides which recipe is loaded', () => {
    const rows = [recipe('a', 1), recipe('b', 2)];
    assert.equal(loadedAfterRead({ kind: 'recipe', id: 'b' }, rows, rows[0]), rows[1]);
    assert.equal(loadedAfterRead(null, rows, rows[0]), null, 'DYE2 says nothing is loaded');
});

test('when DYE2 could not be asked, the loaded recipe stays while it is still in the records', () => {
    const rows = [recipe('a', 1), recipe('b', 2)];
    assert.equal(loadedAfterRead(undefined, rows, { id: 'b' }), rows[1], 'the fresh record, not the old one');
    assert.equal(loadedAfterRead(undefined, rows, { id: 'gone' }), null);
    assert.equal(loadedAfterRead(undefined, rows, null), null);
    assert.equal(loadedAfterRead(undefined, null, { id: 'a' }), null);
});

test('a card is named as Streamline\'s strip names a recipe', () => {
    assert.equal(recipeName({ title: 'Title', name: 'Name' }), 'Title');
    assert.equal(recipeName({ name: 'Name' }), 'Name');
    assert.equal(recipeName({}), 'Recipe');
    assert.equal(recipeBean({}), '');
});
