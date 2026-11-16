// How DYE2's recipe records are written (docs/cafe/DESIGN.md, "Writing DYE2's
// records"). All sample data is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRecipeWriter } from '../src/cafe/recipe-write.js';

const row = (id, stripSlot, over = {}) => ({ id, stripSlot, name: `Recipe ${id}`, showOnStreamlineDashboard: true, ...over });
const copy = value => JSON.parse(JSON.stringify(value));

// A stand-in for Decaid's store: the whole list is read and written, as JSON.
// `onRead(n)` and `onWrite(n)` let a test play DYE2, changing the list around
// the writer's nth read or write.
function store(rows, { onRead = () => {}, onWrite = () => {}, failRead = () => false, failWrite = () => false } = {}) {
    const world = { rows: copy(rows), reads: 0, writes: [] };
    world.writer = createRecipeWriter({
        async read() {
            world.reads += 1;
            onRead(world.reads, world);
            return failRead(world.reads) ? null : copy(world.rows);
        },
        async write(next) {
            const n = world.writes.length + 1;
            if (failWrite(n)) { world.writes.push(null); throw new Error('the store refused the write'); }
            world.writes.push(copy(next));
            world.rows = copy(next);
            onWrite(n, world);
        },
    });
    world.get = id => world.rows.find(r => r.id === id);
    return world;
}

test('a recipe is placed in a slot above 5, and nothing else changes', async () => {
    const world = store([row('a', 1), row('b', null), row('c', 3)]);
    const result = await world.writer.placeInSlot('b', 7);
    assert.equal(result.ok, true);
    assert.equal(world.get('b').stripSlot, 7);
    assert.deepEqual(world.get('a'), row('a', 1));
    assert.deepEqual(world.get('c'), row('c', 3));
    assert.equal(world.writes.length, 1);
    assert.deepEqual(result.rows, world.rows);
});

test('fields the skin does not know are kept, on the row written and on the others', async () => {
    const rows = [
        row('a', 1, { decentSyncId: 'ds-1', somethingNew: { nested: [1, 2] } }),
        row('b', null, { decentSyncId: 'ds-2', dashboardVariables: { dose: 18 }, laterField: 'kept' }),
    ];
    const world = store(rows);
    await world.writer.placeInSlot('b', 9);
    assert.deepEqual(world.get('a'), rows[0]);
    assert.deepEqual(world.get('b'), { ...rows[1], stripSlot: 9 });
});

test('only the named fields of the one row change', async () => {
    const world = store([row('a', 2, { grinderId: 'g1', beanId: 'bean-1' }), row('b', 4, { grinderId: 'g1' })]);
    const result = await world.writer.setFields('a', { grinderId: 'g2' });
    assert.equal(result.ok, true);
    assert.deepEqual(world.get('a'), row('a', 2, { grinderId: 'g2', beanId: 'bean-1' }));
    assert.deepEqual(world.get('b'), row('b', 4, { grinderId: 'g1' }));
});

test('a row that is not a recipe, and a list entry that is null, are written back as they were', async () => {
    const world = store([null, row('a', null), 'stray']);
    await world.writer.placeInSlot('a', 6);
    assert.deepEqual(world.rows, [null, row('a', 6), 'stray']);
});

test('the slot\'s previous holder loses it, hidden or not', async () => {
    const world = store([row('a', 7), row('b', null), row('c', 7, { showOnStreamlineDashboard: false })]);
    const result = await world.writer.placeInSlot('b', 7);
    assert.equal(result.ok, true);
    assert.equal(world.get('a').stripSlot, null);
    assert.equal(world.get('c').stripSlot, null);
    assert.equal(world.get('b').stripSlot, 7);
    // The holder is otherwise untouched: it stays in DYE2's library.
    assert.equal(world.get('a').name, 'Recipe a');
    assert.equal(world.get('c').showOnStreamlineDashboard, false);
});

test('a recipe placed in a slot is shown on the strip', async () => {
    const world = store([row('a', 3, { showOnStreamlineDashboard: false })]);
    await world.writer.placeInSlot('a', 8);
    assert.equal(world.get('a').showOnStreamlineDashboard, true);
});

test('the write is made on what DYE2 holds at the time, not on what the page drew', async () => {
    // DYE2 saves a dial-in onto another recipe before the writer's read.
    const world = store([row('a', 1, { dose: 18 }), row('b', null)], {
        onRead(n, w) { if (n === 1) w.rows[0].dose = 19; },
    });
    await world.writer.placeInSlot('b', 6);
    assert.equal(world.get('a').dose, 19);
    assert.equal(world.get('b').stripSlot, 6);
});

test('DYE2 writes its older copy over the change: it is made again, on DYE2\'s list', async () => {
    // DYE2 read the list before the skin's write, and writes it back after,
    // with a change of its own. The skin's change is gone, and is made again.
    const world = store([row('a', 1, { dose: 18 }), row('b', null)], {
        onWrite(n, w) { if (n === 1) w.rows = [row('a', 1, { dose: 20 }), row('b', null)]; },
    });
    const result = await world.writer.placeInSlot('b', 6);
    assert.equal(result.ok, true);
    assert.equal(world.writes.length, 2);
    assert.equal(world.get('b').stripSlot, 6);
    assert.equal(world.get('a').dose, 20, 'DYE2\'s own change is kept');
});

test('the change is lost twice: it is not made a third time, and the answer says so', async () => {
    const world = store([row('a', null)], {
        onWrite(n, w) { w.rows = [row('a', null)]; },
    });
    const result = await world.writer.placeInSlot('a', 6);
    assert.deepEqual(result, { ok: false, reason: 'unconfirmed' });
    assert.equal(world.writes.length, 2);
});

test('a write the store refuses is tried once more', async () => {
    const world = store([row('a', null)], { failWrite: n => n === 1 });
    const result = await world.writer.placeInSlot('a', 6);
    assert.equal(result.ok, true);
    assert.equal(world.get('a').stripSlot, 6);
});

test('a write the store refuses twice is not confirmed', async () => {
    const world = store([row('a', null)], { failWrite: () => true });
    assert.deepEqual(await world.writer.placeInSlot('a', 6), { ok: false, reason: 'unconfirmed' });
    assert.equal(world.get('a').stripSlot, null);
});

test('records that cannot be read are never written over', async () => {
    const world = store([row('a', null)], { failRead: () => true });
    assert.deepEqual(await world.writer.placeInSlot('a', 6), { ok: false, reason: 'unreadable' });
    assert.equal(world.writes.length, 0);
});

test('a confirming read that fails is followed by another look, not by a second write', async () => {
    const world = store([row('a', null)], { failRead: n => n === 2 });
    const result = await world.writer.placeInSlot('a', 6);
    assert.equal(result.ok, true);
    assert.equal(world.writes.length, 1);
});

test('a recipe deleted in DYE2 meanwhile is not written back', async () => {
    const world = store([row('a', 1)]);
    assert.deepEqual(await world.writer.placeInSlot('gone', 6), { ok: false, reason: 'gone' });
    assert.equal(world.writes.length, 0);
});

test('a recipe deleted between the write and the retry is not put back', async () => {
    const world = store([row('a', 1), row('b', null)], {
        onWrite(n, w) { if (n === 1) w.rows = [row('a', 1)]; },
    });
    assert.deepEqual(await world.writer.placeInSlot('b', 6), { ok: false, reason: 'gone' });
    assert.deepEqual(world.rows, [row('a', 1)]);
});

test('an empty slot filled meanwhile is left to its holder', async () => {
    const world = store([row('a', 7), row('b', null)]);
    assert.deepEqual(await world.writer.placeInSlot('b', 7, { holder: null }), { ok: false, reason: 'taken' });
    assert.equal(world.writes.length, 0);
    assert.equal(world.get('a').stripSlot, 7);
});

test('a slot taken between the write and the retry is left to its holder', async () => {
    const world = store([row('a', null), row('b', null)], {
        onWrite(n, w) { if (n === 1) w.rows = [row('a', 7), row('b', null)]; },
    });
    assert.deepEqual(await world.writer.placeInSlot('b', 7, { holder: null }), { ok: false, reason: 'taken' });
    assert.equal(world.writes.length, 1);
    assert.equal(world.get('a').stripSlot, 7);
});

test('the recipe the card showed is replaced, and stays in DYE2 with no slot', async () => {
    const world = store([row('a', 7, { decentSyncId: 'ds-a' }), row('b', null)]);
    const result = await world.writer.placeInSlot('b', 7, { holder: 'a' });
    assert.equal(result.ok, true);
    assert.equal(world.get('b').stripSlot, 7);
    assert.deepEqual(world.get('a'), row('a', null, { decentSyncId: 'ds-a' }));
});

test('a slot that holds another recipe than the card showed is left alone', async () => {
    const world = store([row('a', null), row('b', null), row('c', 7)]);
    assert.deepEqual(await world.writer.placeInSlot('b', 7, { holder: 'a' }), { ok: false, reason: 'taken' });
    assert.equal(world.writes.length, 0);
    assert.equal(world.get('c').stripSlot, 7);
});

test('a slot the card\'s recipe has left meanwhile takes the new one', async () => {
    const world = store([row('a', null), row('b', null)]);
    const result = await world.writer.placeInSlot('b', 7, { holder: 'a' });
    assert.equal(result.ok, true);
    assert.equal(world.get('b').stripSlot, 7);
});

test('a hidden recipe naming the slot does not hold it', async () => {
    const world = store([row('a', 7, { showOnStreamlineDashboard: false }), row('b', null)]);
    const result = await world.writer.placeInSlot('b', 7, { holder: null });
    assert.equal(result.ok, true);
    assert.equal(world.get('b').stripSlot, 7);
    assert.equal(world.get('a').stripSlot, null);
});

test('a recipe chosen from the list, and put in a slot by someone else meanwhile, is not moved', async () => {
    const world = store([row('a', null), row('b', 9)]);
    assert.deepEqual(await world.writer.placeInSlot('b', 1, { holder: null, unplaced: true }), { ok: false, reason: 'placed' });
    assert.equal(world.writes.length, 0);
    assert.equal(world.get('b').stripSlot, 9);
});

test('a recipe hidden from the strip, or naming no slot, counts as in no slot', async () => {
    const world = store([row('a', 9, { showOnStreamlineDashboard: false }), row('b', null)]);
    assert.equal((await world.writer.placeInSlot('a', 1, { holder: null, unplaced: true })).ok, true);
    assert.equal((await world.writer.placeInSlot('b', 2, { holder: null, unplaced: true })).ok, true);
    assert.equal(world.get('a').stripSlot, 1);
    assert.equal(world.get('b').stripSlot, 2);
});

test('a chosen recipe whose first write landed is confirmed on the retry, not refused as placed', async () => {
    // The confirming read fails, so the writer looks again and finds its own write.
    const world = store([row('a', null)], { failRead: n => n === 2 });
    const result = await world.writer.placeInSlot('a', 6, { holder: null, unplaced: true });
    assert.equal(result.ok, true);
    assert.equal(world.writes.length, 1);
});

test('a recipe is taken out of its slot, and nothing else about it changes', async () => {
    const world = store([row('a', 7, { decentSyncId: 'ds-a', dashboardVariables: { dose: 18 } }), row('b', 2)]);
    const result = await world.writer.removeFromSlot('a');
    assert.equal(result.ok, true);
    assert.deepEqual(world.get('a'), row('a', null, { decentSyncId: 'ds-a', dashboardVariables: { dose: 18 } }));
    assert.deepEqual(world.get('b'), row('b', 2));
    assert.equal(world.writes.length, 1);
});

test('taking out a recipe that is in no slot writes nothing', async () => {
    const world = store([row('a', null)]);
    assert.equal((await world.writer.removeFromSlot('a')).ok, true);
    assert.equal(world.writes.length, 0);
});

test('taking out a recipe DYE2 has deleted answers that it is gone', async () => {
    const world = store([row('a', 1)]);
    assert.deepEqual(await world.writer.removeFromSlot('b'), { ok: false, reason: 'gone' });
});

test('a change that is already there is not written', async () => {
    const world = store([row('a', 7)]);
    const result = await world.writer.placeInSlot('a', 7, { holder: null });
    assert.equal(result.ok, true);
    assert.equal(world.writes.length, 0);
});

test('a field holding an object is confirmed by its value', async () => {
    const world = store([row('a', 1, { workflow: { profile: { title: 'Old' } } })]);
    const result = await world.writer.setFields('a', { workflow: { profile: { title: 'New' } } });
    assert.equal(result.ok, true);
    assert.equal(world.writes.length, 1);
    assert.equal(world.get('a').workflow.profile.title, 'New');
});

test('an id is matched as DYE2 matches it, number or text', async () => {
    const world = store([row(3, null)]);
    const result = await world.writer.placeInSlot('3', 6);
    assert.equal(result.ok, true);
    assert.equal(world.rows[0].stripSlot, 6);
    assert.equal(world.rows[0].id, 3);
});
