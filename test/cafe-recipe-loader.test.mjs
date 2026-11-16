// The order recipe loads are written in, and which recipe the strip shows as
// loaded (docs/cafe/DESIGN.md, "Recipes and the strip"). All sample data is
// made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRecipeLoader } from '../src/cafe/recipe-loader.js';

const A = { id: 'a', stripSlot: 1, title: 'A', dose: 18 };
const B = { id: 'b', stripSlot: 2, title: 'B', dose: 20 };
const C = { id: 'c', stripSlot: 3, title: 'C', dose: 16 };

// A promise the test settles by hand.
function deferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}
// Let everything that can run, run.
const idle = () => new Promise(resolve => setImmediate(resolve));

// A stand-in for Streamline's apply and for DYE2: an apply writes the Workflow
// when the test lets it finish, and DYE2 then says that recipe is loaded.
function build({ rows = [A, B, C], selection = null } = {}) {
    const world = {
        rows, selection, written: [], applies: [], shown: [], errors: [], log: [],
        applied: 0, reads: 0, readGates: [], settleGate: null, loading: [],
    };
    const loader = createRecipeLoader({
        apply(recipe) {
            const gate = deferred();
            world.applies.push({ recipe, ...gate });
            world.log.push(`apply ${recipe.id}`);
            return gate.promise.then(() => {
                world.written.push(recipe.id);
                world.selection = { kind: 'recipe', id: recipe.id };
            });
        },
        async read() {
            world.reads += 1;
            const answer = { rows: world.rows, selection: world.selection };
            const gate = world.readGates.shift();
            if (gate) await gate.promise;
            return answer;
        },
        async settle() {
            world.log.push('settle');
            if (world.settleGate) await world.settleGate.promise;
        },
        show: (recipes, loaded) => world.shown.push(loaded ? loaded.id : null),
        onLoading: loading => world.loading.push(loading),
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
    await idle();
    assert.equal(world.applies.length, 1);
    world.applies[0].resolve();
    await idle();
    assert.deepEqual(world.written, ['a']);
    assert.equal(world.last(), 'a');
    assert.equal(world.applied, 1);
});

test('two taps in quick succession are written in tap order, and the last one wins', async () => {
    const { loader, world } = build();
    await loader.refresh();

    loader.load(A);
    loader.load(B);
    await idle();
    assert.equal(world.applies.length, 1, 'B waits for A: the two applies never overlap');
    assert.equal(world.last(), 'b');

    world.applies[0].resolve();
    await idle();
    assert.equal(world.applies.length, 2);
    assert.equal(world.last(), 'b', 'A finishing does not move the highlight back');
    world.applies[1].resolve();
    await idle();

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
    await idle();
    world.applies[0].resolve();
    await idle();
    world.applies[1].resolve();
    await idle();

    assert.deepEqual(world.written, ['a', 'c']);
    assert.equal(world.last(), 'c');
});

test('edits made before the tap are settled before the load is written', async () => {
    const { loader, world } = build();
    await loader.refresh();
    world.settleGate = deferred();

    loader.load(A);
    await idle();
    assert.deepEqual(world.log, ['settle'], 'nothing is applied while an earlier edit is still on its way');
    world.settleGate.resolve();
    await idle();
    assert.deepEqual(world.log, ['settle', 'apply a']);
});

test('a load that cannot settle is not made, and the recipe that was loaded still is', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();
    world.settleGate = deferred();

    loader.load(B);
    await idle();
    world.settleGate.reject(new Error('An earlier change has not reached the machine.'));
    await idle();
    assert.equal(world.applies.length, 0, 'nothing is loaded over an edit that is still in doubt');
    assert.deepEqual(world.errors, ['b']);
    assert.equal(world.last(), 'a');
});

test('the page is told while a load runs, from the tap to the last load finishing', async () => {
    const { loader, world } = build();
    await loader.refresh();
    assert.deepEqual(world.loading, []);

    loader.load(A);
    assert.deepEqual(world.loading, [true], 'from the tap itself');
    loader.load(B);
    await idle();
    world.applies[0].resolve();
    await idle();
    assert.deepEqual(world.loading, [true], 'still loading: a newer tap is waiting');
    world.applies[1].resolve();
    await idle();
    assert.deepEqual(world.loading, [true, false]);

    // A load that fails ends it too.
    loader.load(C);
    await idle();
    world.applies[2].reject(new Error('Decaid did not answer'));
    await idle();
    assert.deepEqual(world.loading, [true, false, true, false]);
});

test('what is loaded is the record DYE2 holds now, not the one the card was drawn from', async () => {
    const { loader, world } = build();
    await loader.refresh();

    // The recipe was edited elsewhere after the cards were drawn.
    const edited = { ...A, dose: 19 };
    world.rows = [edited, B, C];
    loader.load(A);
    await idle();
    assert.equal(world.applies[0].recipe, edited);
    world.applies[0].resolve();
    await idle();
    assert.equal(world.last(), 'a');
});

test('a recipe that has gone from DYE2 is not loaded', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'b' } });
    await loader.refresh();

    world.rows = [B, C];
    loader.load(A);
    await idle();
    assert.equal(world.applies.length, 0);
    assert.deepEqual(world.errors, ['a']);
    assert.equal(world.last(), 'b', 'the recipe that was loaded still is');
});

test('with DYE2\'s records unreadable, the card\'s own copy is loaded', async () => {
    const { loader, world } = build();
    await loader.refresh();
    world.rows = null;

    loader.load(A);
    await idle();
    assert.equal(world.applies[0].recipe, A);
});

test('the loaded card takes no tap', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();
    assert.equal(world.last(), 'a');

    loader.load(A);
    await idle();
    assert.equal(world.applies.length, 0);
});

test('a load that fails goes back to the recipe that was loaded, and says so', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();

    loader.load(B);
    assert.equal(world.last(), 'b');
    await idle();
    world.applies[0].reject(new Error('Decaid did not answer'));
    await idle();

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
    await idle();
    world.applies[0].reject(new Error('Decaid did not answer'));
    await idle();
    assert.equal(world.last(), 'a');
});

test('a load that lands stays shown when DYE2 cannot be asked afterwards', async () => {
    const { loader, world } = build();
    await loader.refresh();

    loader.load(B);
    await idle();
    world.applies[0].promise.then(() => { world.selection = undefined; });
    world.applies[0].resolve();
    await idle();
    assert.equal(world.last(), 'b');
});

test('DYE2\'s answer decides after a load, even when it disagrees', async () => {
    const { loader, world } = build();
    await loader.refresh();

    loader.load(B);
    await idle();
    // The apply wrote the Workflow, but DYE2 did not take the recipe as loaded.
    world.applies[0].promise.then(() => { world.selection = null; });
    world.applies[0].resolve();
    await idle();
    assert.equal(world.last(), null);
});

test('a read begun before a tap cannot move the highlight off the tapped card', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();

    const gate = deferred();
    world.readGates.push(gate);
    const stale = loader.refresh(); // answers "a is loaded"
    loader.load(B);
    gate.resolve();
    await stale;
    assert.equal(world.last(), 'b');

    await idle();
    world.applies[0].resolve();
    await idle();
    assert.equal(world.last(), 'b');
});

test('a refresh asked for while a load runs is dropped', async () => {
    const { loader, world } = build();
    await loader.refresh();

    loader.load(A);
    await idle(); // the load has settled and read; its apply is under way
    const reads = world.reads;
    await loader.refresh();
    assert.equal(world.reads, reads, 'the load\'s own read follows it');
    world.applies[0].resolve();
    await idle();
    assert.equal(world.reads, reads + 1);
    assert.equal(world.last(), 'a');
});

test('a slow answer never paints over a newer one', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();

    const slow = deferred();
    world.readGates.push(slow);
    const first = loader.refresh(); // captures "a is loaded", then stalls
    world.selection = { kind: 'recipe', id: 'b' }; // changed elsewhere
    await loader.refresh(); // a later read, which answers at once
    assert.equal(world.last(), 'b');

    slow.resolve();
    await first;
    assert.equal(world.last(), 'b', 'the stale answer is dropped');

    // The recipe that really is loaded still takes no tap, and the other one does.
    loader.load(B);
    await idle();
    assert.equal(world.applies.length, 0);
    loader.load(A);
    await idle();
    assert.equal(world.applies.length, 1);
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
