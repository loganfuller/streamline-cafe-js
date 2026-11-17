// What the Shots list says, row by row, and how its pages join up
// (docs/cafe/DESIGN.md, "The Shots list"). All sample data is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PAGE_SIZE, shotRow, withPage, nextPage, dayTitle, dayOf, listItems, doseYieldText, durationText, withRemarks, withReference, listHeader } from '../src/cafe/shot-list.js';
import { tabletRow } from '../src/cafe/tablet-shots.js';
import { locationRow } from '../src/cafe/plugin-shots.js';

const RECIPES = [
    { id: 'r-house', title: 'House', beanName: 'Sample Blend' },
    { id: 'r-guest', title: 'Guest', beanName: 'Sample Single Origin' },
];

// A row of Decaid's list: its Workflow and annotations, and no measurements.
const decaidRow = (id, { at = '2026-11-12T10:41:00.000', recipeId = 'r-house', context = {}, annotations = {} } = {}) => ({
    id,
    timestamp: at,
    workflow: {
        context: { coffeeName: 'Sample Blend', baristaName: ' Ana ', targetDoseWeight: 18, targetYield: 36, ...context, extras: recipeId ? { dye: { recipeId } } : {} },
    },
    annotations,
});
// The same as the Shot seam lists it, from the tablet. `references` is the
// choice of reference kept on the tablet, where it is known.
const row = (id, { references = null, ...options } = {}) => tabletRow(decaidRow(id, options), references);

// A row of the plugin's `shots` answer, in the shape "The Location's Shots" in
// Decent Sync's docs/PLUGIN.md gives.
const HOUSE = { id: 'recipe-house', name: 'House', recordId: 'r-house' };
const pluginRow = (id, fields = {}) => ({
    id,
    pulledAt: '2026-11-12T10:41:00.000Z',
    machine: { id: 'machine-right', name: 'Sample Right' },
    onThisTablet: false,
    recipe: HOUSE,
    bean: { roaster: 'Sample Roaster', name: 'Sample Blend' },
    dose: 18.2,
    targetDose: 18,
    yield: 36.4,
    targetYield: 36,
    duration: 27.31,
    rating: 8,
    barista: 'Sam',
    hasNote: true,
    unfinished: false,
    referenceOf: [],
    ...fields,
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
    assert.equal(shotRow(row('s1', { references }), { recipes: RECIPES }).isReference, true);
    assert.equal(shotRow(row('s2', { references }), { recipes: RECIPES }).isReference, false);
    assert.equal(shotRow(row('s9', { recipeId: 'r-house', references }), { recipes: RECIPES }).isReference, false, 'another recipe\'s reference');
    assert.equal(shotRow(row('s1'), { recipes: RECIPES }).isReference, false, 'not known');
    assert.equal(shotRow(row('s1', { recipeId: 'r-gone', references: { 'r-gone': 's1' } }), { recipes: RECIPES }).isReference, false, 'a Shot with no recipe has no reference');
});

test('a row with no time has no day', () => {
    const shown = shotRow(row('s1', { at: 'not a time' }), { recipes: RECIPES });
    assert.deepEqual([shown.when, shown.day], [null, null]);
});

// ── A row of either source ───────────────────────────────────────────────────

test('a row of the Location\'s list and a row of the tablet\'s become the same thing, so nothing above the seam asks which listed it', () => {
    const own = tabletRow(decaidRow('s1'), {});
    const theirs = locationRow(pluginRow('s2'), 'machine-left');
    assert.deepEqual(Object.keys(theirs).sort(), Object.keys(own).sort());
    for (const key of Object.keys(own)) {
        if (own[key] !== null && theirs[key] !== null) assert.equal(typeof theirs[key], typeof own[key], key);
    }
    // And the list's row is worked out from either by one function.
    assert.deepEqual(Object.keys(shotRow(theirs, { recipes: RECIPES })), Object.keys(shotRow(own, { recipes: RECIPES })));
});

test('a row of the Location\'s list names the Machine and marks this one, and gives the duration and the Unfinished mark', () => {
    const theirs = shotRow(locationRow(pluginRow('s2'), 'machine-left'), { recipes: RECIPES });
    assert.deepEqual([theirs.machine, theirs.thisMachine, theirs.duration, theirs.unfinished], ['Sample Right', false, 27.31, false]);
    assert.equal(theirs.when.toISOString(), '2026-11-12T10:41:00.000Z', 'its time is the server\'s, in UTC');
    assert.deepEqual([theirs.name, theirs.bean, theirs.dose, theirs.yield, theirs.rating, theirs.barista, theirs.hasNote], ['House', 'Sample Blend', 18.2, 36.4, 8, 'Sam', true]);
    assert.equal(theirs.recipe, RECIPES[0], 'its recipe is this tablet\'s DYE2 record of it');
    const ours = shotRow(locationRow(pluginRow('s3', { machine: { id: 'machine-left', name: 'Sample Left' }, unfinished: true, rating: 0, duration: 3.1, yield: null, hasNote: false }), 'machine-left'), { recipes: RECIPES });
    assert.deepEqual([ours.machine, ours.thisMachine, ours.unfinished, ours.rating, ours.yield], ['Sample Left', true, true, null, null]);
    assert.equal(durationText(ours), '3.1 s');
    assert.equal(durationText(shotRow(row('s1'), { recipes: RECIPES })), '—', 'Decaid\'s row has no duration');
    // Where the status named no Machine, the row's own word on whether this tablet reported it.
    assert.equal(locationRow(pluginRow('s4', { onThisTablet: true })).thisMachine, true);
    assert.equal(locationRow(pluginRow('s4')).thisMachine, false);
});

test('a value the Shot did not record is none, and a dose it did not weigh is the one it aimed for', () => {
    const bare = shotRow(locationRow(pluginRow('s2', { dose: null, yield: null, duration: null, rating: null, barista: null, bean: null, pulledAt: null, machine: null })), { recipes: RECIPES });
    assert.deepEqual([bare.dose, bare.yield, bare.duration, bare.rating, bare.barista, bare.bean, bare.when, bare.machine], [18, null, null, null, '', '', null, null]);
});

test('a recipe this tablet has no DYE2 record of is named as the server names it, and a Shot tied to no Recipe has none', () => {
    const elsewhere = shotRow(locationRow(pluginRow('s2', { recipe: { id: 'recipe-x', name: 'Elsewhere espresso', recordId: null } })), { recipes: RECIPES });
    assert.deepEqual([elsewhere.recipe, elsewhere.name], [null, 'Elsewhere espresso']);
    const none = shotRow(locationRow(pluginRow('s2', { recipe: null })), { recipes: RECIPES });
    assert.deepEqual([none.recipe, none.name], [null, null]);
    // A record id DYE2's records do not hold, as one read a moment before the record arrived.
    const unread = shotRow(locationRow(pluginRow('s2', { recipe: { id: 'recipe-y', name: 'Late', recordId: 'r-late' } })), { recipes: RECIPES });
    assert.deepEqual([unread.recipe, unread.name], [null, 'Late']);
});

test('the Location\'s "Reference" chip is the row\'s own word, whichever Recipe it is the reference of', () => {
    const chip = fields => shotRow(locationRow(pluginRow('s2', fields)), { recipes: RECIPES }).isReference;
    assert.equal(chip({ referenceOf: [] }), false);
    assert.equal(chip({ referenceOf: [HOUSE] }), true);
    assert.equal(chip({ recipe: null, referenceOf: [{ id: 'recipe-guest', name: 'Guest', recordId: 'r-guest' }] }), true, 'another Recipe\'s than the one it was pulled with');
    assert.equal(chip({ referenceOf: [{ id: 'recipe-x', name: 'Elsewhere espresso', recordId: null }] }), true, 'a Recipe this tablet has no record of');
    assert.equal(chip({ referenceOf: null }), false);
});

// ── The header ───────────────────────────────────────────────────────────────

test('what the list says about its source is a function of what is listed and why', () => {
    const only = { text: 'This machine only', translate: true };
    assert.deepEqual(listHeader({ of: 'location', why: 'served', location: 'Sample Cafe' }), { under: { text: 'Sample Cafe', translate: false }, line: null, location: true });
    assert.deepEqual(listHeader({ of: 'location', why: 'served', location: null }), { under: null, line: null, location: true });
    assert.deepEqual(listHeader({ of: 'tablet', why: 'notServed' }), { under: only, line: { text: 'This machine isn\'t at a Decent Sync Location, so only its own shots are listed.', translate: true }, location: false });
    assert.deepEqual(listHeader({ of: 'tablet', why: 'unreachable' }), { under: only, line: { text: 'Decent Sync can\'t be reached, so only this machine\'s shots are listed.', translate: true }, location: false });
    assert.deepEqual(listHeader({ of: 'tablet', why: 'refused', message: 'Sample refusal.' }), { under: only, line: { text: 'Sample refusal.', translate: false }, location: false });
    assert.deepEqual(listHeader({ of: 'tablet', why: 'refused', message: '' }).line, null);
    // No plugin at all, and before the plugin has said: "Shots" and no more.
    for (const why of ['noPlugin', 'unknown']) assert.deepEqual(listHeader({ of: 'tablet', why }), { under: null, line: null, location: false }, why);
    assert.deepEqual(listHeader(null), { under: null, line: null, location: false });
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
    const references = { 'r-house': 's1', 'r-guest': 's3' };
    const rows = ['s1', 's2'].map(id => shotRow(row(id, { references }), { recipes: RECIPES }))
        .concat(shotRow(row('s3', { recipeId: 'r-guest', references }), { recipes: RECIPES }));
    const moved = withReference(rows, 'r-house', 's2');
    assert.deepEqual(moved.map(r => r.isReference), [false, true, true], 'another recipe\'s chip stays');
    assert.equal(moved[2], rows[2]);
});

test('a Shot that is two Recipes\' reference keeps its chip when one of them moves, and a list that knows no references is left alone', () => {
    const GUEST = { id: 'recipe-guest', name: 'Guest', recordId: 'r-guest' };
    const both = shotRow(locationRow(pluginRow('s1', { referenceOf: [HOUSE, GUEST] })), { recipes: RECIPES });
    const other = shotRow(locationRow(pluginRow('s2', { recipe: GUEST })), { recipes: RECIPES });
    const moved = withReference([both, other], 'r-house', 's2');
    assert.deepEqual(moved.map(r => r.isReference), [true, true], 'still the Guest\'s reference; and a Shot of another recipe may be made the House\'s');
    assert.deepEqual(moved[0].referenceOf, ['r-guest']);
    assert.deepEqual(withReference(moved, 'r-guest', 's9').map(r => r.isReference), [false, true]);
    const unknown = [shotRow(row('s1'), { recipes: RECIPES })];
    assert.equal(withReference(unknown, 'r-house', 's1')[0], unknown[0]);
});
