// The soft-keyboard lift on a screen that rests short of its window (issue
// #38). A WebView whose visualViewport sits a fraction of a pixel, or a system
// bar, short of innerHeight used to count as a keyboard that was up for good,
// so a button near the bottom was lifted the moment it took focus, between
// pointer-down and pointer-up, and the tap missed.
//
// scaling.js touches the DOM at load, so its lift decision is mirrored here:
// `liftFor` is its keyboardShift line. The source test at the end fails if
// scaling.js stops deciding that way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHRINK_ADOPT_MS, trackBaseline, keyboardLift } from '../src/modules/keyboard-fit.js';

const W = 1340;
const H = 800;
const t0 = 10_000;

// The Shots button at the bottom of the dial-in column on a 1340x800 screen
// ends about 17 px above the bottom: inside KEYBOARD_GAP of any gap at all.
const SHOTS_BUTTON = { top: 744, bottom: 783 };
// The note dialog's textarea, and a field lower down the page.
const LOW_FIELD = { top: 600, bottom: 640 };

// The state scaling.js starts with: the window as it is at load, and the room
// the screen has then.
const boot = (visibleHeight = H) => ({
    baselineHeight: H, baselineWidth: W, baselineVisible: Math.min(H, visibleHeight),
    shrunkSince: 0, keyboardLike: false, shrunk: false,
});
const track = (state, over) => trackBaseline(state, {
    rawHeight: H, rawWidth: W, visibleHeight: H, editing: false, now: t0, ...over,
});
// scaling.js: keyboardShift = baseline.keyboardLike && !fitsItself ? keyboardLift(...) : 0
const liftFor = (state, rect, visibleHeight, fitsItself = false) =>
    state.keyboardLike && !fitsItself ? keyboardLift(rect, visibleHeight, 0) : 0;

for (const gap of [0.5, 30]) {
    test(`a screen ${gap} px short of its window from load lifts nothing when a button takes focus`, () => {
        const visibleHeight = H - gap;
        const focused = track(boot(visibleHeight), { visibleHeight });
        assert.equal(focused.keyboardLike, false);
        assert.equal(focused.shrunkSince, 0, 'nothing waits to be adopted, so no timer runs');
        assert.equal(liftFor(focused, SHOTS_BUTTON, visibleHeight), 0);
        // The old reading: any shrink at all lifted whatever had focus.
        assert.ok(keyboardLift(SHOTS_BUTTON, visibleHeight, 0) > 0, 'the button is inside the gap');

        // Still nothing long after, and after a dialog hands focus back.
        const later = track(focused, { visibleHeight, now: t0 + 60_000 });
        assert.equal(liftFor(later, SHOTS_BUTTON, visibleHeight), 0);
    });

    test(`a screen ${gap} px short still tells a full-screen overlay how much room it has`, () => {
        const visibleHeight = H - gap;
        const state = track(boot(visibleHeight), { visibleHeight });
        assert.equal(state.shrunk, true, 'scaling.js reports visibleHeight while shrunk');
        assert.equal(state.baselineHeight, H, 'and the canvas keeps the window\'s height');
    });

    test(`a gap of ${gap} px that appears after load lifts nothing, and is adopted as the resting room`, () => {
        const visibleHeight = H - gap;
        const pending = track(boot(), { visibleHeight });
        assert.equal(pending.keyboardLike, false);
        assert.ok(pending.shrunkSince > 0, 'waiting to be adopted');
        assert.equal(liftFor(pending, SHOTS_BUTTON, visibleHeight), 0, 'not even while it waits');

        const adopted = track(pending, { visibleHeight, now: t0 + SHRINK_ADOPT_MS });
        assert.equal(adopted.baselineHeight, H, 'the layout window is unchanged');
        assert.equal(adopted.baselineVisible, visibleHeight);
        assert.equal(adopted.shrunkSince, 0, 'nothing is left waiting, so the adopt timer stops');
        assert.equal(adopted.keyboardLike, false);

        // A field focused afterwards with no keyboard is no shrink either.
        const typing = track(adopted, { visibleHeight, editing: true, now: t0 + SHRINK_ADOPT_MS + 100 });
        assert.equal(typing.keyboardLike, false);
        assert.equal(liftFor(typing, SHOTS_BUTTON, visibleHeight), 0);
    });

    test(`a state from before the resting room was kept still adopts a ${gap} px gap`, () => {
        const visibleHeight = H - gap;
        const { baselineVisible, ...old } = boot();
        const pending = track(old, { visibleHeight });
        const adopted = track(pending, { visibleHeight, now: t0 + SHRINK_ADOPT_MS });
        assert.equal(adopted.baselineVisible, visibleHeight);
        assert.equal(liftFor(adopted, SHOTS_BUTTON, visibleHeight), 0);
    });

    test(`a real keyboard on a screen ${gap} px short still lifts, then lets go when it closes`, () => {
        const resting = H - gap;
        const KB = 440;
        const start = track(boot(resting), { visibleHeight: resting });

        // The keyboard opens under a field near the bottom.
        const up = track(start, { visibleHeight: KB, editing: true, now: t0 + 100 });
        assert.equal(up.keyboardLike, true);
        assert.equal(up.baselineHeight, H, 'the canvas never re-scales for a keyboard');
        assert.ok(liftFor(up, LOW_FIELD, KB) > 0, 'the field is lifted clear');

        // Focus moves to a button with the keyboard still up: Android often
        // keeps it there, so the button is lifted too.
        const button = track(up, { visibleHeight: KB, now: t0 + 700 });
        assert.equal(button.keyboardLike, true);
        assert.ok(liftFor(button, SHOTS_BUTTON, KB) > 0, 'a button above the keyboard is lifted');
        assert.equal(track(button, { visibleHeight: KB, now: t0 + 60_000 }).keyboardLike, true,
            'and waiting never turns a keyboard into the window size');

        // The keyboard closes. The screen gets back to its resting room, not to
        // the full window, and the mark clears all the same.
        const down = track(button, { visibleHeight: resting, now: t0 + 61_000 });
        assert.equal(down.keyboardLike, false);
        assert.equal(down.baselineHeight, H);
        assert.equal(liftFor(down, SHOTS_BUTTON, resting), 0);
    });
}

test('a keyboard on a screen with no gap still lifts as before', () => {
    const up = track(boot(), { visibleHeight: 440, editing: true });
    assert.equal(up.keyboardLike, true);
    assert.equal(up.shrunk, true);
    assert.equal(liftFor(up, LOW_FIELD, 440), 228, 'bottom 640 + 28 gap - 440 visible');
    // A full-screen overlay fits itself instead of being lifted.
    assert.equal(liftFor(up, LOW_FIELD, 440, true), 0);
    const down = track(up, { visibleHeight: H, now: t0 + 1000 });
    assert.deepEqual([down.keyboardLike, down.shrunk, down.baselineVisible], [false, false, H]);
});

test('a host resize nobody typed into lifts nothing while it waits to be adopted', () => {
    const pending = track(boot(), { rawHeight: 600, visibleHeight: 600 });
    assert.equal(pending.shrunk, true);
    assert.equal(liftFor(pending, { top: 540, bottom: 580 }, 600), 0);
    const adopted = track(pending, { rawHeight: 600, visibleHeight: 600, now: t0 + SHRINK_ADOPT_MS });
    assert.deepEqual([adopted.baselineHeight, adopted.baselineVisible, adopted.shrunk], [600, 600, false]);
});

test('scaling.js lifts only for a keyboard, and waits to adopt only while a shrink is pending', () => {
    const source = readFileSync(new URL('../src/modules/scaling.js', import.meta.url), 'utf8');
    assert.match(source, /keyboardShift = baseline\.keyboardLike && !fitsItself\s*\?\s*keyboardLift\(/);
    assert.match(source, /if \(baseline\.shrunkSince && !baseline\.keyboardLike\) adoptTimer = setTimeout\(/);
    assert.match(source, /baselineVisible: Math\.min\(window\.innerHeight, window\.visualViewport\?\.height \?\? window\.innerHeight\)/);
});
