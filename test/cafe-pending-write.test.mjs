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
    // The delay passing: the timer fires, if one is set.
    const elapse = async () => { const fn = timer; timer = null; if (fn) await fn(); };
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

test('a write that fails does not reject the flush, and leaves nothing waiting', async () => {
    const { pending } = build({ write: () => Promise.reject(new Error('Decaid did not answer')) });
    pending.set(1);
    await pending.flush();
    assert.equal(pending.pending(), undefined);
});

test('a change made during a write is written after it', async () => {
    const { pending, written, elapse } = build();
    pending.set(1);
    const first = pending.flush();
    pending.set(2);
    await first;
    assert.deepEqual(written, [1]);
    await elapse();
    assert.deepEqual(written, [1, 2]);
});
