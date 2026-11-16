// Holding a stepper's − or + repeats it (docs/cafe/DESIGN.md, "What the screen
// shows"). The clock is passed in, so no real time passes here.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHoldRepeat } from '../src/cafe/hold-repeat.js';

// A clock that only moves when told to.
function fakeClock() {
    let now = 0;
    let next = 1;
    const timers = new Map();
    return {
        setTimer(fn, ms) { const id = next++; timers.set(id, { fn, at: now + ms }); return id; },
        clearTimer(id) { timers.delete(id); },
        advance(ms) {
            const end = now + ms;
            for (;;) {
                const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
                if (!due) break;
                timers.delete(due[0]);
                now = due[1].at;
                due[1].fn();
            }
            now = end;
        },
        pending: () => timers.size,
    };
}

function build() {
    const clock = fakeClock();
    let fired = 0;
    const hold = createHoldRepeat({
        fire: () => { fired += 1; },
        setTimer: clock.setTimer, clearTimer: clock.clearTimer, delayMs: 400, everyMs: 100,
    });
    return { clock, hold, fired: () => fired };
}

test('a tap is one step: nothing repeats before the delay', () => {
    const { clock, hold, fired } = build();
    hold.press();
    clock.advance(399);
    assert.equal(hold.release(), false, 'the tap\'s own step stands');
    assert.equal(fired(), 0);
    assert.equal(clock.pending(), 0);
});

test('held past the delay, the step repeats until release', () => {
    const { clock, hold, fired } = build();
    hold.press();
    clock.advance(400);
    assert.equal(fired(), 1);
    clock.advance(300);
    assert.equal(fired(), 4);
    assert.equal(hold.release(), true, 'the release\'s own tap must be swallowed');
    clock.advance(1000);
    assert.equal(fired(), 4, 'nothing fires after release');
    assert.equal(clock.pending(), 0);
});

test('each press starts afresh', () => {
    const { clock, hold, fired } = build();
    hold.press();
    clock.advance(600);
    assert.equal(hold.release(), true);
    hold.press();
    clock.advance(100);
    assert.equal(hold.release(), false);
    assert.equal(fired(), 3);
});

test('a second press without a release does not double the repeat', () => {
    const { clock, hold, fired } = build();
    hold.press();
    hold.press();
    clock.advance(600);
    assert.equal(fired(), 3);
    hold.release();
    assert.equal(clock.pending(), 0);
});

test('a release with no press is harmless', () => {
    const { hold } = build();
    assert.equal(hold.release(), false);
});
