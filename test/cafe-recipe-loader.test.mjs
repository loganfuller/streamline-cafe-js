// The order recipe loads are written in, and which recipe the strip shows as
// loaded (docs/cafe/DESIGN.md, "Recipes and the strip"). All sample data is
// made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRecipeLoader } from '../src/cafe/recipe-loader.js';

const A = { id: 'a', stripSlot: 1, title: 'A' };
const B = { id: 'b', stripSlot: 2, title: 'B' };
const C = { id: 'c', stripSlot: 3, title: 'C' };

// A promise the test settles by hand.
function deferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

// A stand-in for Streamline's apply and for DYE2: an apply writes the Workflow
// when the test lets it finish, and DYE2 then says that recipe is loaded.
function build({ rows = [A, B, C], selection = null } = {}) {
    const world = { rows, selection, written: [], applies: [], shown: [], errors: [], applied: 0, reads: 0, readGate: null };
    const loader = createRecipeLoader({
        apply(recipe) {
            const gate = deferred();
            world.applies.push({ recipe, ...gate });
            return gate.promise.then(() => {
                world.written.push(recipe.id);
                world.selection = { kind: 'recipe', id: recipe.id };
            });
        },
        async read() {
            world.reads += 1;
            const answer = { rows: world.rows, selection: world.selection };
            if (world.readGate) await world.readGate.promise;
            return answer;
        },
        show: (recipes, loaded) => world.shown.push(loaded ? loaded.id : null),
        onApplied: () => { world.applied += 1; },
        onError: (error, recipe) => world.errors.push(recipe ? recipe.id : null),
    });
    world.last = () => world.shown[world.shown.length - 1];
    return { loader, world };
}

test('a tap shows the recipe at once and loads it through the apply', async () => {
    const { loader, world } = build();
    await loader.refresh();
    assert.equal(world.last(), null);

    loader.load(A);
    assert.equal(world.last(), 'a', 'shown before the apply finishes');
    assert.equal(world.applies.length, 1);
    world.applies[0].resolve();
    await settle();
    assert.deepEqual(world.written, ['a']);
    assert.equal(world.last(), 'a');
    assert.equal(world.applied, 1);
});

test('two taps in quick succession are written in tap order, and the last one wins', async () => {
    const { loader, world } = build();
    await loader.refresh();

    loader.load(A);
    loader.load(B);
    assert.equal(world.applies.length, 1, 'B waits for A: the two applies never overlap');
    assert.equal(world.last(), 'b');

    world.applies[0].resolve();
    await settle();
    assert.equal(world.applies.length, 2);
    assert.equal(world.last(), 'b', 'A finishing does not move the highlight back');
    world.applies[1].resolve();
    await settle();

    assert.deepEqual(world.written, ['a', 'b'], 'the machine ends on the recipe the page names');
    assert.equal(world.selection.id, 'b');
    assert.equal(world.last(), 'b');
});

test('a tap that is overtaken while waiting is never written', async () => {
    const { loader, world } = build();
    await loader.refresh();

    loader.load(A);
    loader.load(B);
    loader.load(C);
    world.applies[0].resolve();
    await settle();
    world.applies[1].resolve();
    await settle();

    assert.deepEqual(world.written, ['a', 'c']);
    assert.equal(world.last(), 'c');
});

test('the loaded card takes no tap', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();
    assert.equal(world.last(), 'a');

    loader.load(A);
    assert.equal(world.applies.length, 0);
});

test('a load that fails goes back to the recipe that was loaded, and says so', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();

    loader.load(B);
    assert.equal(world.last(), 'b');
    world.applies[0].reject(new Error('Decaid did not answer'));
    await settle();

    assert.deepEqual(world.errors, ['b']);
    assert.deepEqual(world.written, []);
    assert.equal(world.last(), 'a');
    assert.equal(world.applied, 1, 'the page is told either way');
});

test('a load that fails with DYE2 unreachable still goes back', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();
    world.selection = undefined; // DYE2 can no longer be asked
    world.rows = null;

    loader.load(B);
    world.applies[0].reject(new Error('Decaid did not answer'));
    await settle();
    assert.equal(world.last(), 'a');
});

test('a load that lands stays shown when DYE2 cannot be asked afterwards', async () => {
    const { loader, world } = build();
    await loader.refresh();

    loader.load(B);
    world.applies[0].promise.then(() => { world.selection = undefined; });
    world.applies[0].resolve();
    await settle();
    assert.equal(world.last(), 'b');
});

test('DYE2\'s answer decides after a load, even when it disagrees', async () => {
    const { loader, world } = build();
    await loader.refresh();

    loader.load(B);
    // The apply wrote the Workflow, but DYE2 did not take the recipe as loaded.
    world.applies[0].promise.then(() => { world.selection = null; });
    world.applies[0].resolve();
    await settle();
    assert.equal(world.last(), null);
});

test('a read begun before a tap cannot move the highlight off the tapped card', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();

    world.readGate = deferred();
    const stale = loader.refresh(); // answers "a is loaded"
    loader.load(B);
    world.readGate.resolve();
    world.readGate = null;
    await stale;
    assert.equal(world.last(), 'b');

    world.applies[0].resolve();
    await settle();
    assert.equal(world.last(), 'b');
});

test('no read is made while a load runs', async () => {
    const { loader, world } = build();
    await loader.refresh();
    const reads = world.reads;

    loader.load(A);
    await loader.refresh();
    assert.equal(world.reads, reads, 'the load\'s own read follows it');
    world.applies[0].resolve();
    await settle();
    assert.equal(world.reads, reads + 1);
});

test('a failed read keeps the cards and the loaded recipe', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();
    world.rows = null;
    world.selection = undefined;
    await loader.refresh();
    assert.equal(world.last(), 'a');
});

test('a recipe unloaded or removed elsewhere stops being shown as loaded', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();
    world.selection = null;
    await loader.refresh();
    assert.equal(world.last(), null);

    world.selection = { kind: 'recipe', id: 'b' };
    await loader.refresh();
    assert.equal(world.last(), 'b');
    world.rows = [A, C];
    await loader.refresh();
    assert.equal(world.last(), null);
});
