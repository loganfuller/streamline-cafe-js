// The order recipe loads are written in, and which recipe the strip shows as
// loaded (docs/cafe/DESIGN.md, "Recipes and the strip"). All sample data is
// made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRecipeLoader, unloadSelection, UNLOAD_HOLD_MS } from '../src/cafe/recipe-loader.js';

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
//
// An unload clears DYE2's selection when the test lets it finish; `shot` says
// whether a shot runs, and `storeGate`, when set, holds the wait after a pour.
function build({ rows = [A, B, C], selection = null } = {}) {
    const world = {
        rows, selection, written: [], applies: [], unloads: [], shown: [], errors: [], unloadErrors: [], log: [],
        applied: 0, reads: 0, readGates: [], settleGate: null, storeGate: null, holdGate: null, shot: false, loading: [],
    };
    const loader = createRecipeLoader({
        unload() {
            const gate = deferred();
            world.unloads.push(gate);
            world.log.push('unload');
            return gate.promise.then(() => { world.selection = null; });
        },
        async afterShot() {
            world.log.push('after shot');
            if (world.storeGate) await world.storeGate.promise;
        },
        shotRunning: () => world.shot,
        // The hold after an unload's tap is over at once unless a test holds it.
        hold: () => world.holdGate ? world.holdGate.promise : Promise.resolve(),
        onUnloadError: (error, recipe) => world.unloadErrors.push(recipe.id),
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

    loader.tap(A);
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

    loader.tap(A);
    loader.tap(B);
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

    loader.tap(A);
    loader.tap(B);
    loader.tap(C);
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

    loader.tap(A);
    await idle();
    assert.deepEqual(world.log, ['settle'], 'nothing is applied while an earlier edit is still on its way');
    world.settleGate.resolve();
    await idle();
    assert.deepEqual(world.log, ['settle', 'after shot', 'apply a']);
});

test('a load that cannot settle is not made, and the recipe that was loaded still is', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();
    world.settleGate = deferred();

    loader.tap(B);
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

    loader.tap(A);
    assert.deepEqual(world.loading, [true], 'from the tap itself');
    loader.tap(B);
    await idle();
    world.applies[0].resolve();
    await idle();
    assert.deepEqual(world.loading, [true], 'still loading: a newer tap is waiting');
    world.applies[1].resolve();
    await idle();
    assert.deepEqual(world.loading, [true, false]);

    // A load that fails ends it too.
    loader.tap(C);
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
    loader.tap(A);
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
    loader.tap(A);
    await idle();
    assert.equal(world.applies.length, 0);
    assert.deepEqual(world.errors, ['a']);
    assert.equal(world.last(), 'b', 'the recipe that was loaded still is');
});

test('with DYE2\'s records unreadable, the card\'s own copy is loaded', async () => {
    const { loader, world } = build();
    await loader.refresh();
    world.rows = null;

    loader.tap(A);
    await idle();
    assert.equal(world.applies[0].recipe, A);
});


test('a load that fails goes back to the recipe that was loaded, and says so', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();

    loader.tap(B);
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

    loader.tap(B);
    await idle();
    world.applies[0].reject(new Error('Decaid did not answer'));
    await idle();
    assert.equal(world.last(), 'a');
});

test('a load that lands stays shown when DYE2 cannot be asked afterwards', async () => {
    const { loader, world } = build();
    await loader.refresh();

    loader.tap(B);
    await idle();
    world.applies[0].promise.then(() => { world.selection = undefined; });
    world.applies[0].resolve();
    await idle();
    assert.equal(world.last(), 'b');
});

test('DYE2\'s answer decides after a load, even when it disagrees', async () => {
    const { loader, world } = build();
    await loader.refresh();

    loader.tap(B);
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
    loader.tap(B);
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

    loader.tap(A);
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

    // A tap on the recipe that really is loaded unloads it, and loads nothing.
    loader.tap(B);
    await idle();
    assert.equal(world.applies.length, 0);
    assert.equal(world.unloads.length, 1);
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

// ── A tap on the loaded card unloads it ──────────────────────────────────────

test('a tap on the loaded card unloads it: the highlight leaves at once, and nothing is applied', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();

    loader.tap(A);
    assert.equal(world.last(), null, 'the highlight leaves at the tap');
    assert.deepEqual(world.loading, [true]);
    assert.equal(loader.busy(), true);
    await idle();
    assert.deepEqual(world.log, ['settle', 'after shot', 'unload'], 'a change on its way is written first, and the Shot just pulled is let be stored');
    world.unloads[0].resolve();
    await idle();
    assert.equal(world.selection, null, 'DYE2 names no recipe');
    assert.equal(world.applies.length, 0, 'the Workflow is not written');
    assert.equal(world.last(), null);
    assert.deepEqual(world.loading, [true, false]);
    assert.equal(world.applied, 1, 'the page reads its names and status again');
    assert.deepEqual(world.unloadErrors, []);
});

test('a tap on the unloaded card loads it again, as DYE2 holds it now', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();
    loader.tap(A);
    await idle();
    world.unloads[0].resolve();
    await idle();

    const stored = { ...A, dose: 18.5 };
    world.rows = [stored, B, C];
    loader.tap(A);
    assert.equal(world.last(), 'a');
    await idle();
    assert.equal(world.applies[0].recipe, stored, 'the recipe as stored, over what was dialled meanwhile');
    world.applies[0].resolve();
    await idle();
    assert.equal(world.selection.id, 'a');
    assert.equal(world.last(), 'a');
});

test('a double tap on a card loads it: the second tap, during the load, is ignored', async () => {
    const { loader, world } = build();
    await loader.refresh();

    loader.tap(B);
    loader.tap(B);
    await idle();
    assert.equal(world.applies.length, 1);
    assert.equal(world.last(), 'b');
    world.applies[0].resolve();
    await idle();
    assert.equal(world.unloads.length, 0, 'the second tap did not unload what the first one loaded');
    assert.equal(world.selection.id, 'b');
    assert.equal(world.last(), 'b');

    // A tap on it once its load has finished unloads it.
    loader.tap(B);
    await idle();
    assert.equal(world.unloads.length, 1);
});

test('a tap on the card being unloaded is ignored', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();

    loader.tap(A);
    loader.tap(A);
    await idle();
    world.unloads[0].resolve();
    await idle();
    assert.equal(world.applies.length, 0, 'the second tap loaded nothing');
    assert.equal(world.unloads.length, 1);
    assert.equal(world.last(), null);
});

test('a double tap on the loaded card unloads it, even when the unload finishes between the taps', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();
    world.holdGate = deferred();

    loader.tap(A);
    await idle();
    world.unloads[0].resolve(); // the unload is done before the second tap
    await idle();
    assert.equal(world.selection, null);
    loader.tap(A); // the second tap, inside the hold
    await idle();
    assert.equal(world.applies.length, 0, 'the recipe is not loaded again');
    assert.equal(world.last(), null);
    assert.equal(loader.busy(), true, 'the strip is held');

    world.holdGate.resolve();
    await idle();
    assert.equal(loader.busy(), false);
    assert.equal(world.last(), null);
    assert.deepEqual(world.loading, [true, false]);

    // Once the hold is over, a tap loads it again.
    world.holdGate = null;
    loader.tap(A);
    await idle();
    assert.equal(world.applies.length, 1);
});

test('the hold after an unload is started at its tap, and a load gets none', async () => {
    let holds = 0;
    let selection = { kind: 'recipe', id: 'a' };
    const loader = createRecipeLoader({
        apply: async recipe => { selection = { kind: 'recipe', id: recipe.id }; },
        unload: async () => { selection = null; },
        read: async () => ({ rows: [A, B], selection }),
        show: () => {},
        hold: () => { holds += 1; return Promise.resolve(); },
    });
    await loader.refresh();
    loader.tap(B);
    await idle();
    assert.equal(holds, 0, 'a load is slow enough on its own');
    loader.tap(B);
    assert.equal(holds, 1, 'started at the tap, not when the unload runs');
    assert.ok(UNLOAD_HOLD_MS >= 300 && UNLOAD_HOLD_MS <= 600, 'longer than a double tap\'s gap, short enough to go unnoticed');
});

test('a tap on another card during an unload loads it once the unload is done', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();

    loader.tap(A);
    await idle();
    loader.tap(B);
    assert.equal(world.last(), 'b', 'the highlight moves at the tap');
    await idle();
    assert.equal(world.applies.length, 0, 'B waits for the unload');
    world.unloads[0].resolve();
    await idle();
    assert.equal(world.last(), 'b', 'the unload finishing does not move the highlight');
    assert.equal(world.applies.length, 1);
    world.applies[0].resolve();
    await idle();
    assert.deepEqual(world.log.filter(line => line === 'unload' || line.startsWith('apply')), ['unload', 'apply b']);
    assert.equal(world.selection.id, 'b');
    assert.equal(world.last(), 'b');
    assert.deepEqual(world.loading, [true, false], 'one stretch of keeping the dial-in still');
});

test('while a shot runs no card takes a tap, the loaded one or any other', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();
    const shown = world.shown.length;
    world.shot = true;

    loader.tap(A);
    loader.tap(B);
    await idle();
    assert.deepEqual(world.log, [], 'nothing is settled, applied or unloaded');
    assert.equal(world.shown.length, shown, 'nothing is drawn');
    assert.equal(loader.busy(), false);
    assert.deepEqual(world.loading, []);
    assert.equal(world.selection.id, 'a');
});

test('an unload just after a pour waits until the Shot is stored', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();
    world.storeGate = deferred();

    loader.tap(A);
    await idle();
    assert.deepEqual(world.log, ['settle', 'after shot']);
    assert.equal(world.selection.id, 'a', 'the Shot Decaid is still to store keeps its recipe');
    assert.equal(world.last(), null, 'the highlight has left');
    assert.equal(loader.busy(), true, 'the dial-in and the menu stay still meanwhile');
    world.storeGate.resolve();
    await idle();
    world.unloads[0].resolve();
    await idle();
    assert.equal(world.selection, null);
    assert.equal(world.last(), null);
});

test('a load just after a pour waits the same way', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();
    world.storeGate = deferred();

    loader.tap(B);
    await idle();
    assert.equal(world.applies.length, 0);
    world.storeGate.resolve();
    await idle();
    assert.equal(world.applies.length, 1);
});

test('a shot that starts during the wait after a pour leaves the recipe loaded, and says nothing', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();
    world.storeGate = deferred();

    loader.tap(A);
    await idle();
    world.shot = true;
    world.storeGate.resolve();
    await idle();
    assert.equal(world.unloads.length, 0, 'the running shot is not filed under no recipe');
    assert.equal(world.last(), 'a', 'the highlight comes back');
    assert.deepEqual(world.unloadErrors, []);
    assert.deepEqual(world.loading, [true, false]);

    // A load caught the same way changes nothing either.
    world.shot = false;
    world.storeGate = deferred();
    loader.tap(B);
    await idle();
    world.shot = true;
    world.storeGate.resolve();
    await idle();
    assert.equal(world.applies.length, 0);
    assert.equal(world.last(), 'a');
    assert.deepEqual(world.errors, []);
});

test('a shot that starts while DYE2 is read, just before the write, is left alone too', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();

    // The unload's read of DYE2 is slow, and a shot starts during it.
    const gate = deferred();
    world.readGates.push(gate);
    loader.tap(A);
    await idle();
    world.shot = true;
    gate.resolve();
    await idle();
    assert.equal(world.unloads.length, 0, 'the running shot is not filed under no recipe');
    assert.equal(world.last(), 'a');
    assert.deepEqual(world.unloadErrors, []);

    // And a load's.
    world.shot = false;
    const second = deferred();
    world.readGates.push(second);
    loader.tap(B);
    await idle();
    world.shot = true;
    second.resolve();
    await idle();
    assert.equal(world.applies.length, 0, 'the running shot keeps its recipe');
    assert.equal(world.last(), 'a');
    assert.deepEqual(world.errors, []);
});

test('a tap on the loading card, after a tap on another, moves the highlight back and is loaded next', async () => {
    const { loader, world } = build();
    await loader.refresh();

    loader.tap(A);
    await idle();
    loader.tap(B);
    loader.tap(A);
    assert.equal(world.last(), 'a', 'the newest tap is shown');
    world.applies[0].resolve();
    await idle();
    assert.deepEqual(world.applies.map(a => a.recipe.id), ['a', 'a'], 'B, overtaken while it waited, is never written');
    world.applies[1].resolve();
    await idle();
    assert.equal(world.last(), 'a');
});

test('an unload that DYE2 refuses says so, and the card stays highlighted', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();

    loader.tap(A);
    await idle();
    world.unloads[0].reject(new Error('DYE2 answered 500'));
    await idle();
    assert.deepEqual(world.unloadErrors, ['a']);
    assert.deepEqual(world.errors, [], 'not a failed load');
    assert.equal(world.selection.id, 'a');
    assert.equal(world.last(), 'a');
    assert.deepEqual(world.loading, [true, false]);
});

test('an unload whose earlier change never landed is not made, and says so', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();
    world.settleGate = deferred();

    loader.tap(A);
    await idle();
    world.settleGate.reject(new Error('An earlier change has not reached the machine.'));
    await idle();
    assert.equal(world.unloads.length, 0);
    assert.deepEqual(world.unloadErrors, ['a']);
    assert.equal(world.last(), 'a');
});

test('a recipe already unloaded elsewhere is not unloaded again', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();
    world.selection = null; // unloaded in DYE2 after the strip was drawn

    loader.tap(A);
    await idle();
    assert.equal(world.unloads.length, 0);
    assert.equal(world.applies.length, 0);
    assert.equal(world.last(), null, 'drawn as DYE2 says');
    assert.deepEqual(world.unloadErrors, []);

    // One replaced elsewhere is left as it is too: the other recipe stays loaded.
    world.selection = { kind: 'recipe', id: 'a' };
    await loader.refresh();
    world.selection = { kind: 'recipe', id: 'c' };
    loader.tap(A);
    await idle();
    assert.equal(world.unloads.length, 0);
    assert.equal(world.last(), 'c');
});

test('with DYE2 unable to say what is loaded, the tap unloads nothing, and says so', async () => {
    const { loader, world } = build({ selection: { kind: 'recipe', id: 'a' } });
    await loader.refresh();
    // Another recipe may have been loaded elsewhere meanwhile: clearing the
    // selection would unload that one.
    world.selection = undefined;

    loader.tap(A);
    await idle();
    assert.equal(world.unloads.length, 0);
    assert.deepEqual(world.unloadErrors, ['a']);
    assert.equal(world.last(), 'a', 'the card is highlighted again');
});

test('the unload tells Streamline\'s strip module before it clears DYE2\'s selection', async () => {
    const order = [];
    await unloadSelection({ forget: () => order.push('forget'), post: async () => order.push('post') });
    assert.deepEqual(order, ['forget', 'post']);

    // A post that reached DYE2 with the strip module still holding the recipe
    // could be undone by that module's retry.
    let forgotten = false;
    await unloadSelection({
        forget: () => { forgotten = true; },
        post: async () => assert.equal(forgotten, true, 'the selection was cleared before the strip module was told'),
    });
    // And a post that fails is the unload failing.
    await assert.rejects(unloadSelection({ forget: () => {}, post: async () => { throw new Error('DYE2 answered 500'); } }));
});
