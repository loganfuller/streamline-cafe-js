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

test('a gap that appears just before a field takes focus is not a keyboard', () => {
    const visibleHeight = H - 30;
    const pending = track(boot(), { visibleHeight });
    assert.ok(pending.shrunkSince > 0 && !pending.keyboardLike, 'waiting to be adopted');

    // The field takes focus before the gap is adopted, and nothing shrinks more.
    const focused = track(pending, { visibleHeight, editing: true, now: t0 + 500 });
    assert.equal(focused.keyboardLike, false);
    assert.equal(liftFor(focused, LOW_FIELD, visibleHeight), 0);
    // So it is adopted on time, typing or not, and a button tapped later stays put.
    const adopted = track(focused, { visibleHeight, editing: true, now: t0 + SHRINK_ADOPT_MS });
    assert.deepEqual([adopted.baselineHeight, adopted.baselineVisible, adopted.keyboardLike], [H, visibleHeight, false]);
    assert.equal(liftFor(track(adopted, { visibleHeight, now: t0 + 5000 }), SHOTS_BUTTON, visibleHeight), 0);
});

test('a keyboard that opens while a gap waits to be adopted is still a keyboard', () => {
    const pending = track(boot(), { visibleHeight: H - 30 });
    const up = track(pending, { visibleHeight: 440, editing: true, now: t0 + 500 });
    assert.equal(up.keyboardLike, true);
    assert.ok(liftFor(up, LOW_FIELD, 440) > 0);
    assert.equal(track(up, { visibleHeight: 440, now: t0 + 60_000 }).baselineHeight, H, 'never adopted');
    // A further shrink seen while nothing is typed into only lowers the mark.
    const lower = track(pending, { visibleHeight: H - 40, now: t0 + 200 });
    assert.deepEqual([lower.keyboardLike, lower.pendingVisible], [false, H - 40]);
    assert.equal(track(lower, { visibleHeight: H - 40, editing: true, now: t0 + 300 }).keyboardLike, false);
});

test('a host resize that leaves a gapped screen its room is adopted as a smaller window', () => {
    // At rest 800 tall with 770 of room; the host makes the window 780 with no gap.
    const start = track(boot(H - 30), { visibleHeight: H - 30 });
    const pending = track(start, { rawHeight: 780, visibleHeight: 780 });
    assert.ok(pending.shrunkSince > 0, 'not taken as a grow back to the resting room');
    assert.equal(liftFor(pending, SHOTS_BUTTON, 780), 0);
    const adopted = track(pending, { rawHeight: 780, visibleHeight: 780, now: t0 + SHRINK_ADOPT_MS });
    assert.deepEqual([adopted.baselineHeight, adopted.baselineVisible, adopted.shrunk], [780, 780, false]);
});

// A keyboard that closes into less room than the screen had before it: a gap
// that came just before it, a fraction of a pixel lost to rounding, a
// navigation bar that stays up, or a shorter window with the room back. Each
// used to leave the keyboard mark, and the lift, on for good.
for (const [name, rest, close] of [
    ['over a gap that was still waiting to be adopted', { pending: H - 30 }, { visibleHeight: H - 30 }],
    ['into a fraction of a pixel less room', { resting: H - 0.5 }, { visibleHeight: H - 0.75 }],
    ['into a window a navigation bar shortened', { resting: H }, { rawHeight: H - 48, visibleHeight: H - 48 }],
    ['into a shorter window with the room back', { resting: H - 30 }, { rawHeight: 780, visibleHeight: H - 30 }],
]) {
    test(`a keyboard that closes ${name} lets go of the lift, and the room left is adopted`, () => {
        const start = rest.pending
            ? track(boot(), { visibleHeight: rest.pending })
            : track(boot(rest.resting), { visibleHeight: rest.resting });
        const up = track(start, { rawHeight: 440, visibleHeight: 440, editing: true, now: t0 + 300 });
        assert.equal(up.keyboardLike, true);
        const button = track(up, { rawHeight: 440, visibleHeight: 440, now: t0 + 600 });
        assert.ok(liftFor(button, SHOTS_BUTTON, 440) > 0, 'a button is lifted while the keyboard is up');

        const after = { rawHeight: H, ...close };
        const down = track(button, { ...after, now: t0 + 5000 });
        assert.equal(down.keyboardLike, false);
        assert.equal(liftFor(down, SHOTS_BUTTON, after.visibleHeight), 0, 'Shots stays put');
        assert.ok(down.shrunkSince > 0, 'what is left waits to be adopted');
        const adopted = track(down, { ...after, now: t0 + 5000 + SHRINK_ADOPT_MS });
        assert.deepEqual([adopted.baselineHeight, adopted.baselineVisible, adopted.keyboardLike],
            [after.rawHeight, after.visibleHeight, false]);
    });
}

test('a keyboard that gets smaller while a field is typed into is still a keyboard', () => {
    const up = track(boot(), { visibleHeight: 440, editing: true });
    const smaller = track(up, { visibleHeight: 700, editing: true, now: t0 + 500 });
    assert.equal(smaller.keyboardLike, true);
    assert.equal(track(smaller, { visibleHeight: 700, editing: true, now: t0 + 60_000 }).baselineHeight, H, 'never adopted');
    // Closed with the back key into a little less room, the field still focused:
    // the mark holds until focus moves, and the pass focus runs lifts nothing.
    const back = track(smaller, { visibleHeight: H - 48, editing: true, now: t0 + 61_000 });
    assert.equal(back.keyboardLike, true);
    const tapped = track(back, { visibleHeight: H - 48, now: t0 + 62_000 });
    assert.equal(liftFor(tapped, SHOTS_BUTTON, H - 48), 0);
});

test('a keyboard is measured from the room at the last pass, not the least ever seen', () => {
    const shrinking = track(boot(), { visibleHeight: 700 });
    const partly = track(shrinking, { visibleHeight: 760, now: t0 + 300 });
    const up = track(partly, { visibleHeight: 720, editing: true, now: t0 + 600 });
    assert.equal(up.keyboardLike, true, 'less room than a moment ago, while typing');
    assert.equal(track(up, { visibleHeight: 720, editing: true, now: t0 + 60_000 }).baselineHeight, H, 'never adopted');
});

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
