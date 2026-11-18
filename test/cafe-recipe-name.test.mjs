// DYE2's name for a recipe, and whether a recipe still has it
// (docs/cafe/DESIGN.md, "Changing the profile"). All sample data is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { profileWord, baseName, generatedFrom, renamedFor, recordName } from '../src/cafe/recipe-name.js';

// A record as DYE2's `save-recipe` writes it: the name twice, the profile's
// title, the bean's name and the beverage typed.
const record = (name, { title = 'Turbo', bean = 'Hill Farm', beverage = '', id = 'r1', ...over } = {}) => ({
    id, name, title: name, beverage,
    beanName: bean || undefined,
    profileTitle: title,
    profileSnapshot: { title },
    workflow: { context: { coffeeName: bean || undefined }, profile: { title } },
    ...over,
});

test('the first word of the title, unless it says nothing', () => {
    assert.equal(profileWord('Turbo Shot 2'), 'Turbo');
    assert.equal(profileWord('  Adaptive v3 '), 'Adaptive');
    for (const word of ['Default', 'advanced', 'CUSTOM', 'Profile', 'new', 'Untitled']) {
        assert.equal(profileWord(`${word} espresso`), '', word);
    }
    assert.equal(profileWord(''), '');
    assert.equal(profileWord(undefined), '');
});

test('the base name follows DYE2\'s own cases', () => {
    // Its own test's cases (workflow-record.test.mjs, v0.1.42).
    assert.equal(baseName({ title: 'Turbo', bean: 'Ethiopia Guji Natural' }), 'Turbo Ethiopia Guji Natural');
    assert.equal(baseName({ title: 'Default', bean: 'Ethiopia' }), 'Ethiopia');
    assert.equal(baseName({ title: 'Turbo', bean: 'Ethiopia Guji', beverage: 'Cappuccino' }), 'Turbo Ethiopia Guji Cappuccino');
    assert.equal(baseName({ title: 'Turbo', bean: '', day: '26 Oct' }), 'Turbo 26 Oct');
    assert.equal(baseName({ title: 'Turbo', bean: '   ', day: '26 Oct' }), 'Turbo 26 Oct');
    assert.equal(baseName({ title: 'Turbo', bean: '', beverage: 'Cappuccino', day: '26 Oct' }), 'Turbo Cappuccino 26 Oct');
    assert.equal(baseName({ title: 'Default', bean: '', day: '26 Oct' }), 'Recipe 26 Oct');
});

test('a name DYE2 gave is recognised, and a name someone gave is not', () => {
    assert.ok(generatedFrom(record('Turbo Hill Farm')));
    assert.ok(generatedFrom(record('turbo hill FARM')), 'without regard to case');
    assert.equal(generatedFrom(record('House espresso')), null);
    assert.equal(generatedFrom(record('Turbo Hill Farm extra')), null);
    assert.equal(generatedFrom(record('')), null);
});

test('a profile whose first word DYE2 leaves out', () => {
    const row = record('Hill Farm', { title: 'Default' });
    assert.ok(generatedFrom(row));
    assert.equal(renamedFor(row, 'Turbo Bloom'), 'Turbo Hill Farm');
    // And back: the new profile's word is left out.
    assert.equal(renamedFor(record('Turbo Hill Farm'), 'Custom flat 9 bar'), 'Hill Farm');
});

test('a name with DYE2\'s count is recognised, and the new name takes no count it does not need', () => {
    const row = record('Turbo Hill Farm 2');
    assert.deepEqual(generatedFrom(row), { title: 'Turbo', bean: 'Hill Farm', beverage: '', day: null });
    assert.equal(renamedFor(row, 'Adaptive v3'), 'Adaptive Hill Farm');
    assert.equal(generatedFrom(record('Turbo Hill Farm 1')), null, '1 is not a count DYE2 writes');
    assert.ok(generatedFrom(record('Turbo Hill Farm 12')));
});

test('a recipe with a beverage', () => {
    const row = record('Turbo Hill Farm Flat white', { beverage: 'Flat white' });
    assert.ok(generatedFrom(row));
    assert.equal(renamedFor(row, 'Adaptive v3'), 'Adaptive Hill Farm Flat white');
    // The same name on a record with no beverage was typed by someone.
    assert.equal(generatedFrom(record('Turbo Hill Farm Flat white')), null);
});

test('a recipe with no bean: any day counts, and the new name keeps it', () => {
    const row = record('Turbo 3 Jan', { bean: '' });
    assert.deepEqual(generatedFrom(row), { title: 'Turbo', bean: '', beverage: '', day: '3 Jan' });
    assert.equal(renamedFor(row, 'Adaptive v3'), 'Adaptive 3 Jan');
    assert.equal(renamedFor(record('Recipe 26 Oct', { bean: '', title: 'Default' }), 'Turbo'), 'Turbo 26 Oct');
    assert.equal(renamedFor(record('Turbo 26 Oct', { bean: '' }), 'Default'), 'Recipe 26 Oct');
    assert.equal(renamedFor(record('Turbo 26 Oct 3', { bean: '' }), 'Adaptive'), 'Adaptive 26 Oct');
    assert.equal(generatedFrom(record('Turbo 32 Oct', { bean: '' })), null, 'no such day');
    assert.equal(generatedFrom(record('Turbo 03 Oct', { bean: '' })), null, 'DYE2 pads no day');
    assert.equal(generatedFrom(record('Turbo Sept 3', { bean: '' })), null);
    // A record with a bean was never named with a day.
    assert.equal(generatedFrom(record('Turbo 26 Oct')), null);
});

test('a new name another record already has takes the next free count', () => {
    const row = record('Turbo Hill Farm', { id: 'a' });
    const others = [row, record('Adaptive Hill Farm', { id: 'b' }), record('adaptive hill farm 2', { id: 'c' }), null, 'stray'];
    assert.equal(renamedFor(row, 'Adaptive v3', others), 'Adaptive Hill Farm 3');
    // A record known by its title alone counts by its title.
    assert.equal(renamedFor(row, 'Adaptive v3', [{ id: 'd', title: 'Adaptive Hill Farm' }]), 'Adaptive Hill Farm 2');
});

test('the record itself never counts against its new name', () => {
    // Its name differs only in case from what the rule gives on the new profile.
    const row = record('Turbo Hill Farm', { id: 'a' });
    assert.equal(renamedFor(row, 'Turbo Bloom', [row]), null, 'the same word: nothing to rename');
    const copy = { ...row, name: 'Adaptive Hill Farm' };
    assert.equal(renamedFor(row, 'Adaptive', [copy]), 'Adaptive Hill Farm', 'the same row by id');
});

test('a name that differs only in case is DYE2\'s, and the new name is written in the rule\'s own case', () => {
    assert.equal(renamedFor(record('TURBO HILL FARM'), 'Adaptive v3'), 'Adaptive Hill Farm');
});

test('a name someone typed keeps its name', () => {
    assert.equal(renamedFor(record('House espresso'), 'Adaptive v3'), null);
    // One that matches by chance is renamed: DYE2 keeps no mark of its own names.
    assert.equal(renamedFor(record('Turbo Hill Farm'), 'Adaptive v3'), 'Adaptive Hill Farm');
});

test('the rule giving the same name on both profiles renames nothing', () => {
    assert.equal(renamedFor(record('Turbo Hill Farm'), 'Turbo v2'), null);
    assert.equal(renamedFor(record('Hill Farm', { title: 'Default' }), 'Custom'), null);
    assert.equal(renamedFor(record('Turbo Hill Farm 2'), 'Turbo v2', [record('Turbo Hill Farm', { id: 'x' })]), null, 'its count stays');
});

test('a name matched on any title or bean the record holds', () => {
    // Decent Sync rewrote the noted title; the stored Workflow still has the one DYE2 named it from.
    const row = { ...record('Turbo Hill Farm'), profileTitle: 'Something else' };
    assert.ok(generatedFrom(row));
    const noBeanName = { ...record('Turbo Hill Farm'), beanName: undefined };
    assert.ok(generatedFrom(noBeanName), 'the bean from the stored Workflow');
});

test('a record\'s name is its name, else its title', () => {
    assert.equal(recordName({ name: 'A', title: 'B' }), 'A');
    assert.equal(recordName({ name: ' ', title: 'B' }), 'B');
    assert.equal(recordName(null), '');
});
