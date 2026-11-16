// A value written once, a moment after it last changed (src/cafe/pending-write.js).
// The clock is passed in, so no real time passes here.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPendingWrite } from '../src/cafe/pending-write.js';

function build({ write } = {}) {
    let timer = null;
    const written = [];
    const pending = createPendingWrite({
        write: write || (value => { written.push(value); }),
        delayMs: 300,
        setTimer: fn => { timer = fn; return fn; },
        clearTimer: fn => { if (timer === fn) timer = null; },
    });
    // The delay passing: the timer fires, if one is set, and its write runs.
    const elapse = async () => { const fn = timer; timer = null; if (fn) fn(); await new Promise(resolve => setImmediate(resolve)); };
    return { pending, written, elapse, armed: () => timer !== null };
}

test('nothing is written until the delay has passed', async () => {
    const { pending, written, elapse } = build();
    pending.set(1.6);
    assert.deepEqual(written, []);
    assert.equal(pending.pending(), 1.6);
    await elapse();
    assert.deepEqual(written, [1.6]);
    assert.equal(pending.pending(), undefined);
});

test('several changes are one write, of the last value', async () => {
    const { pending, written, elapse } = build();
    pending.set(1.6);
    pending.set(1.7);
    pending.set(1.8);
    await elapse();
    assert.deepEqual(written, [1.8]);
    await elapse();
    assert.deepEqual(written, [1.8], 'and it is written once');
});

test('flush writes what is waiting now, and waits for the write', async () => {
    let finish;
    const order = [];
    const { pending, armed } = build({
        write: value => new Promise(resolve => { finish = () => { order.push(`wrote ${value}`); resolve(); }; }),
    });
    pending.set(2.0);
    const flushed = pending.flush().then(() => order.push('flushed'));
    assert.equal(armed(), false, 'the timer is cancelled: the value is not written twice');
    await Promise.resolve();
    finish();
    await flushed;
    assert.deepEqual(order, ['wrote 2', 'flushed']);
});

test('flush with nothing waiting writes nothing', async () => {
    const { pending, written } = build();
    await pending.flush();
    assert.deepEqual(written, []);
});

test('a falsy value is still a value', async () => {
    const { pending, written, elapse } = build();
    pending.set(0);
    assert.equal(pending.pending(), 0);
    await elapse();
    assert.deepEqual(written, [0]);
});

test('a write that fails does not reject the flush, and its value stays waiting', async () => {
    let tries = 0;
    const { pending } = build({ write: () => { tries += 1; return Promise.reject(new Error('Decaid did not answer')); } });
    pending.set(1);
    await pending.flush();
    assert.equal(tries, 1, 'a value that fails during a flush is not tried again in it');
    assert.equal(pending.pending(), 1, 'it waits for the next try');
});

test('a value whose write failed on the timer is tried again by the next flush', async () => {
    const outcomes = [false, true];
    const tried = [];
    const { pending, elapse, armed } = build({
        write: value => { tried.push(value); return outcomes.shift() ? Promise.resolve() : Promise.reject(new Error('503')); },
    });
    pending.set('A');
    await elapse();
    assert.deepEqual(tried, ['A']);
    assert.equal(pending.pending(), 'A');
    assert.equal(armed(), false, 'no timer hammers a request that is failing');

    await pending.flush(); // as before a recipe load
    assert.deepEqual(tried, ['A', 'A']);
    assert.equal(pending.pending(), undefined, 'written at the second try');
});

test('a newer value replaces one whose write failed', async () => {
    const tried = [];
    const { pending, elapse } = build({ write: value => { tried.push(value); return value === 1 ? Promise.reject(new Error('503')) : Promise.resolve(); } });
    pending.set(1);
    await elapse();
    pending.set(2);
    assert.equal(pending.pending(), 2);
    await elapse();
    assert.deepEqual(tried, [1, 2]);
    assert.equal(pending.pending(), undefined);
});

test('a value that fails is not written after a newer one that was already taken', async () => {
    const finishers = [];
    const tried = [];
    const { pending } = build({
        write: value => new Promise((resolve, reject) => { tried.push(value); finishers.push(value === 1 ? () => reject(new Error('503')) : resolve); }),
    });
    pending.set(1);
    const first = pending.flush(); // 1 is being written
    await new Promise(resolve => setImmediate(resolve));
    pending.set(2);
    const second = pending.flush(); // 2 is taken, to follow it
    finishers[0](); // 1 fails
    await new Promise(resolve => setImmediate(resolve));
    finishers[1]();
    await Promise.all([first, second]);
    assert.equal(pending.pending(), undefined, 'the older value is not brought back');
    await pending.flush();
    assert.deepEqual(tried, [1, 2]);
});

test('a change made during a write that fails is still written', async () => {
    const finishers = [];
    const tried = [];
    const { pending } = build({
        write: value => new Promise((resolve, reject) => { tried.push(value); finishers.push(value === 1 ? () => reject(new Error('503')) : resolve); }),
    });
    pending.set(1);
    const flushed = pending.flush();
    await new Promise(resolve => setImmediate(resolve));
    pending.set(2);
    finishers[0]();
    await new Promise(resolve => setImmediate(resolve));
    finishers[1]();
    await flushed;
    assert.deepEqual(tried, [1, 2], 'the newer value is written; the failed one it replaced is not retried');
    assert.equal(pending.pending(), undefined);
});

test('flush waits for a write the timer already started', async () => {
    // The case a recipe load depends on: the save began on its own, and the load
    // must not go ahead until it has finished.
    let finish;
    const order = [];
    const { pending, elapse } = build({
        write: value => new Promise(resolve => { order.push(`began ${value}`); finish = () => { order.push(`wrote ${value}`); resolve(); }; }),
    });
    pending.set('A');
    await elapse();
    assert.deepEqual(order, ['began A']);
    assert.equal(pending.pending(), undefined, 'nothing is waiting: it is being written');

    const flushed = pending.flush().then(() => order.push('flushed'));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(order, ['began A'], 'flush has not resolved while the write is under way');
    finish();
    await flushed;
    assert.deepEqual(order, ['began A', 'wrote A', 'flushed']);
});

test('a change made during a write is written after it, and flush waits for both', async () => {
    const finishers = [];
    const order = [];
    const { pending } = build({
        write: value => new Promise(resolve => { order.push(`began ${value}`); finishers.push(() => { order.push(`wrote ${value}`); resolve(); }); }),
    });
    pending.set(1);
    const flushed = pending.flush().then(() => order.push('flushed'));
    await new Promise(resolve => setImmediate(resolve));
    pending.set(2);
    finishers[0]();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(order, ['began 1', 'wrote 1', 'began 2'], 'the second write begins only after the first');
    finishers[1]();
    await flushed;
    assert.deepEqual(order, ['began 1', 'wrote 1', 'began 2', 'wrote 2', 'flushed']);
});

test('writes never overlap', async () => {
    let under = 0;
    let most = 0;
    const finishers = [];
    const { pending, elapse } = build({
        write: () => new Promise(resolve => { under += 1; most = Math.max(most, under); finishers.push(() => { under -= 1; resolve(); }); }),
    });
    pending.set(1);
    await elapse();
    pending.set(2);
    await elapse();
    assert.equal(finishers.length, 1, 'the second waits for the first');
    finishers[0]();
    await new Promise(resolve => setImmediate(resolve));
    finishers[1]();
    await pending.flush();
    assert.equal(most, 1);
});
