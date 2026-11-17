// What the Shots list says, row by row, and how its pages join up
// (docs/cafe/DESIGN.md, "The Shots list"). All sample data is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PAGE_SIZE, shotRow, withPage, nextPage, dayTitle, dayOf, listItems, doseYieldText, withRemarks, withReference } from '../src/cafe/shot-list.js';

const RECIPES = [
    { id: 'r-house', title: 'House', beanName: 'Sample Blend' },
    { id: 'r-guest', title: 'Guest', beanName: 'Sample Single Origin' },
];

// A row of Decaid's list: its Workflow and annotations, and no measurements.
const row = (id, { at = '2026-11-12T10:41:00.000', recipeId = 'r-house', context = {}, annotations = {} } = {}) => ({
    id,
    timestamp: at,
    workflow: {
        context: { coffeeName: 'Sample Blend', baristaName: ' Ana ', targetDoseWeight: 18, targetYield: 36, ...context, extras: recipeId ? { dye: { recipeId } } : {} },
    },
    annotations,
});

test('a page is fifty rows', () => {
    assert.equal(PAGE_SIZE, 50);
});

test('a row says when, its recipe over its bean, dose and yield, the stars, the barista and whether it has a note', () => {
    const shown = shotRow(row('s1', { annotations: { actualDoseWeight: 18.2, actualYield: 36.4, enjoyment: 7, espressoNotes: ' Sweet ' } }), { recipes: RECIPES });
    assert.equal(shown.id, 's1');
    assert.equal(shown.when.getHours(), 10, 'Decaid\'s time is the tablet\'s local time');
    assert.equal(shown.day, '2026-11-12');
    assert.equal(shown.recipe, RECIPES[0]);
    assert.equal(shown.name, 'House');
    assert.equal(shown.bean, 'Sample Blend');
    assert.deepEqual([shown.dose, shown.yield], [18.2, 36.4]);
    assert.equal(shown.rating, 7);
    assert.equal(shown.barista, 'Ana');
    assert.equal(shown.hasNote, true);
    assert.equal(shown.isReference, false);
});

test('a row\'s dose is the one its Workflow set where it weighed none, and its yield is only the one Decaid kept', () => {
    const shown = shotRow(row('s1'), { recipes: RECIPES });
    assert.deepEqual([shown.dose, shown.yield], [18, null], 'the yield set is a target, not a yield');
    assert.equal(doseYieldText(shown), '18.0 → — g');
    assert.equal(doseYieldText({ dose: null, yield: 40 }), '— → 40.0 g');
});

test('an unrated Shot, and one with only blanks for a note, say so', () => {
    const shown = shotRow(row('s1', { annotations: { enjoyment: 0, espressoNotes: '  ' } }), { recipes: RECIPES });
    assert.deepEqual([shown.rating, shown.hasNote], [null, false]);
});

test('a recipe is named from DYE2\'s records; one the tablet no longer holds, or none, lists as no recipe', () => {
    assert.equal(shotRow(row('s1', { recipeId: 'r-guest' }), { recipes: RECIPES }).name, 'Guest');
    for (const recipeId of ['r-gone', null]) {
        const shown = shotRow(row('s1', { recipeId }), { recipes: RECIPES });
        assert.deepEqual([shown.recipe, shown.name], [null, null]);
    }
    assert.equal(shotRow(row('s1'), { recipes: null }).recipe, null, 'records that are not a list hold no recipe');
});

test('a Shot is a reference where the choice kept for its recipe names it', () => {
    const references = { 'r-house': 's1', 'r-guest': 's9' };
    assert.equal(shotRow(row('s1'), { recipes: RECIPES, references }).isReference, true);
    assert.equal(shotRow(row('s2'), { recipes: RECIPES, references }).isReference, false);
    assert.equal(shotRow(row('s9', { recipeId: 'r-house' }), { recipes: RECIPES, references }).isReference, false, 'another recipe\'s reference');
    assert.equal(shotRow(row('s1'), { recipes: RECIPES, references: null }).isReference, false, 'not known');
    assert.equal(shotRow(row('s1', { recipeId: 'r-gone' }), { recipes: RECIPES, references: { 'r-gone': 's1' } }).isReference, false, 'a Shot with no recipe has no reference');
});

test('a row with no time has no day', () => {
    const shown = shotRow({ ...row('s1'), timestamp: 'not a time' }, { recipes: RECIPES });
    assert.deepEqual([shown.when, shown.day], [null, null]);
});

test('a page that overlaps the one before lists no Shot twice', () => {
    const first = [{ id: 'c' }, { id: 'b' }];
    // A Shot pulled since moved every row down one.
    const joined = withPage(first, [{ id: 'b' }, { id: 'a' }, { id: 'a' }]);
    assert.deepEqual(joined.map(r => r.id), ['c', 'b', 'a']);
    assert.equal(withPage(first, [{ id: 'c' }]), first, 'a page that adds nothing changes nothing');
});

test('the next page starts after the rows read, and a short page or the total ends the list', () => {
    assert.deepEqual(nextPage({ offset: 0, read: 50, asked: 50, total: 120 }), { offset: 50, done: false });
    assert.deepEqual(nextPage({ offset: 100, read: 20, asked: 50, total: 120 }), { offset: 120, done: true });
    assert.deepEqual(nextPage({ offset: 50, read: 50, asked: 50, total: 100 }), { offset: 100, done: true });
    assert.deepEqual(nextPage({ offset: 0, read: 50, asked: 50, total: null }), { offset: 50, done: false }, 'no total: only a short page ends it');
    assert.deepEqual(nextPage({ offset: 0, read: 0, asked: 50, total: null }), { offset: 0, done: true });
});

test('a day is headed "Today", "Yesterday", or its date in the page\'s language', () => {
    const now = new Date(2026, 10, 12, 9, 0);
    const words = { today: 'Heute', yesterday: 'Gestern' };
    assert.equal(dayTitle('2026-11-12', now, 'de', words), 'Heute');
    assert.equal(dayTitle('2026-11-11', now, 'de', words), 'Gestern');
    assert.equal(dayTitle('2026-11-05', now, 'de', words), new Date(2026, 10, 5).toLocaleDateString('de', { weekday: 'short', day: 'numeric', month: 'short' }));
    assert.match(dayTitle('2025-12-31', now, 'en', words), /2025/, 'a date of another year names it');
    // Yesterday across a month's end.
    assert.equal(dayTitle('2026-11-30', new Date(2026, 11, 1, 8), 'en', words), 'Gestern');
    assert.doesNotThrow(() => dayTitle('2026-11-01', now, 'not a locale!', words), 'a locale the tablet does not know');
});

test('the day a time falls on is the tablet\'s own calendar day', () => {
    assert.equal(dayOf(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('the list is each day\'s header, then its rows, newest first', () => {
    const rows = [{ id: 'c', day: '2026-11-12' }, { id: 'b', day: '2026-11-12' }, { id: 'x', day: null }, { id: 'a', day: '2026-11-11' }];
    assert.deepEqual(listItems(rows).map(item => item.header || item.row.id), ['2026-11-12', 'c', 'b', 'x', '2026-11-11', 'a']);
    assert.deepEqual(listItems([]), []);
});

test('a rating or note changed on the page is written into the kept row, only the one edited', () => {
    const kept = shotRow(row('s1', { annotations: { enjoyment: 4, espressoNotes: 'Sweet' } }), { recipes: RECIPES });
    assert.deepEqual([withRemarks(kept, { rating: 8 }).rating, withRemarks(kept, { rating: 8 }).hasNote], [8, true]);
    assert.deepEqual([withRemarks(kept, { note: null }).rating, withRemarks(kept, { note: null }).hasNote], [4, false]);
    assert.equal(withRemarks(kept, { rating: 0 }).rating, null, 'a cleared rating');
    assert.equal(kept.rating, 4, 'the row is not changed in place');
});

test('a reference made on the page moves the recipe\'s chip in the kept list', () => {
    const rows = ['s1', 's2'].map(id => shotRow(row(id), { recipes: RECIPES, references: { 'r-house': 's1' } }))
        .concat(shotRow(row('s3', { recipeId: 'r-guest' }), { recipes: RECIPES, references: { 'r-guest': 's3' } }));
    const moved = withReference(rows, 'r-house', 's2');
    assert.deepEqual(moved.map(r => r.isReference), [false, true, true], 'another recipe\'s chip stays');
    assert.equal(moved[2], rows[2]);
});
