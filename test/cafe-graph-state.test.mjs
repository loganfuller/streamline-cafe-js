// Which Shot is in the graph and when it is read again: each trigger in each
// state it can meet, and each guard against an answer that arrives late
// (docs/cafe/DESIGN.md, "The latest Shot", "The reference with Decent Sync"
// and "Rating and notes"). All sample data is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { graphStep, initialGraphState, shownRemarks, latestShotId, shotInGraphId, inGraph, REFRESH_GAP_MS, SETTLE_GAPS_MS, SETTLE_LAST_MS, lockedRetryMs } from '../src/cafe/graph-state.js';

// ── Sample data ──────────────────────────────────────────────────────────────

const RECIPE = { id: 'r-house', name: 'House' };
const OTHER = { id: 'r-guest', name: 'Guest' };

const sample = (second, substate = 'pouring') => ({ machine: { timestamp: `2026-11-12T10:00:${String(second).padStart(2, '0')}.000`, state: { substate }, pressure: 6, flow: 2 }, scale: { weight: second * 2 } });
const measurementsAt = second => [sample(second), sample(second + 1)];

// A Shot's record as the seam reads it: its first sample's second is its time.
const shot = (id, second, annotations = {}) => ({ id, timestamp: `2026-11-12T10:00:${String(second).padStart(2, '0')}.000`, workflow: {}, annotations, measurements: measurementsAt(second) });

const LATEST = shot('s-latest', 10, { enjoyment: 6, espressoNotes: 'Bright' });
const NEWER = shot('s-newer', 20);
const REF = shot('s-ref', 30, { enjoyment: 8 });
const REF2 = shot('s-ref2', 40);

const chosen = (refShot, extra = {}) => ({ shot: refShot, canChange: true, rating: refShot ? refShot.annotations.enjoyment ?? null : null, note: null, ...extra });

// ── Driving the module ───────────────────────────────────────────────────────

// Steps through events, keeping every thing to do. The last step's answer is
// `allow`.
function play(state, ...events) {
    const effects = [];
    let allow;
    for (const event of events) {
        const step = graphStep(state, event);
        state = step.state;
        effects.push(...step.effects);
        allow = step.allow;
    }
    return { state, effects, allow };
}

const did = (effects, what) => effects.filter(effect => effect.do === what);
const kinds = effects => effects.map(effect => effect.do);
const lastRead = effects => did(effects, 'readShots').at(-1);
const lastNewest = effects => did(effects, 'readNewest').at(-1);

// The answer to the last read of the recipe's Shots.
function answer(state, effects, shotFound, ref = undefined) {
    const read = lastRead(effects);
    assert.ok(read, 'a read was asked for');
    return play(state, { type: 'shotsRead', seq: read.seq, edits: read.edits, shot: shotFound, chosen: ref === undefined ? chosen(REF) : ref });
}

// With a recipe loaded and its Shots read and drawn.
function withRecipe() {
    const loaded = play(initialGraphState(), { type: 'recipe', recipe: RECIPE });
    return answer(loaded.state, loaded.effects, LATEST).state;
}

// With no recipe loaded and the history module's Shot drawn, its record read.
function withNone() {
    const unloaded = play(initialGraphState(), { type: 'recipe', recipe: null }, { type: 'chartAsks', measurements: LATEST.measurements, workflow: LATEST.workflow });
    const read = lastNewest(unloaded.effects);
    return play(unloaded.state, { type: 'newestRead', seq: read.seq, edits: read.edits, record: LATEST }).state;
}

const live = state => play(state, { type: 'shotStarted' }).state;

// A shot ended and Decaid does not have it yet.
function settling(state) {
    return play(state, { type: 'shotStarted' }, { type: 'shotEnded', poured: true });
}

// Each state a trigger can meet.
const STATES = {
    'a recipe loaded': () => withRecipe(),
    'no recipe': () => withNone(),
    'a shot running with a recipe': () => live(withRecipe()),
    'a shot running with none': () => live(withNone()),
    'a finished shot waiting with a recipe': () => settling(withRecipe()).state,
    'a finished shot waiting with none': () => settling(withNone()).state,
};

// ── The states themselves ────────────────────────────────────────────────────

test('the states the tests start from are what they say', () => {
    const recipe = withRecipe();
    assert.equal(recipe.latest, LATEST);
    assert.equal(recipe.reference.shot, REF);
    assert.ok(recipe.reference.curves, 'the reference\'s lines are worked out once');
    assert.deepEqual({ rating: shownRemarks(recipe).rating, note: shownRemarks(recipe).note }, { rating: 6, note: 'Bright' });
    const none = withNone();
    assert.equal(none.recipe, null);
    assert.equal(none.latest.timestamp, LATEST.timestamp);
    assert.equal(shownRemarks(none).id, LATEST.id, '"Last shot" has its record');
    assert.equal(live(recipe).live, true);
    assert.equal(STATES['a finished shot waiting with a recipe']().settling, true);
    assert.equal(STATES['a finished shot waiting with none']().settling, true);
});

test('the module touches no state it was given', () => {
    const before = withRecipe();
    const copy = { ...before, timers: { ...before.timers }, editedAt: new Map(before.editedAt) };
    play(before, { type: 'shotStarted' }, { type: 'editStarted', shotId: LATEST.id }, { type: 'recipe', recipe: null });
    assert.deepEqual(before, copy);
});

// ── A recipe loaded or unloaded ──────────────────────────────────────────────

test('a recipe loaded: its Shots are read, and the graph waits for them', () => {
    const { state, effects } = play(initialGraphState(), { type: 'recipe', recipe: RECIPE });
    assert.equal(state.latest, undefined);
    assert.equal(state.drawDue, true, 'the read must end in a draw');
    assert.deepEqual(kinds(effects), ['overlay', 'paint', 'readShots']);
    assert.equal(lastRead(effects).recipeId, RECIPE.id);
});

test('a recipe loaded over another drops the one before\'s Shots and reference', () => {
    const { state, effects } = play(withRecipe(), { type: 'recipe', recipe: OTHER });
    assert.equal(state.latest, undefined);
    assert.equal(state.reference, null);
    assert.equal(lastRead(effects).recipeId, OTHER.id);
    assert.ok(!did(effects, 'draw').length, 'nothing of the recipe before is drawn');
});

test('the same recipe read again only writes the legend again', () => {
    const before = withRecipe();
    const { state, effects } = play(before, { type: 'recipe', recipe: { ...RECIPE, profileTitle: 'Changed' } });
    assert.deepEqual(kinds(effects), ['paint']);
    assert.equal(state.latest, before.latest);
    assert.equal(state.seq, before.seq);
});

test('a recipe unloaded: the graph goes back to the Shot the history module last handed it', () => {
    // The history module asked while the recipe was loaded, and was turned down.
    const asked = play(withRecipe(), { type: 'chartAsks', measurements: NEWER.measurements, workflow: NEWER.workflow });
    assert.equal(asked.allow, false);
    const { state, effects } = play(asked.state, { type: 'recipe', recipe: null });
    assert.equal(state.latest.timestamp, NEWER.timestamp);
    assert.equal(state.reference, null);
    assert.deepEqual(kinds(effects), ['readNewest', 'overlay', 'draw']);
});

test('no recipe, then one loaded: its Shots are read', () => {
    const { state, effects } = play(withNone(), { type: 'recipe', recipe: RECIPE });
    assert.equal(state.latest, undefined);
    assert.equal(lastRead(effects).recipeId, RECIPE.id);
    assert.equal(shownRemarks(state), null, '"Last shot"\'s stars go with it');
});

test('a recipe loaded or unloaded while a shot runs keeps the running shot\'s lines', () => {
    const loaded = play(live(withNone()), { type: 'recipe', recipe: RECIPE });
    assert.deepEqual(did(loaded.effects, 'readShots'), [], 'its end reads the Shots');
    assert.ok(!did(loaded.effects, 'draw').length);
    const unloaded = play(live(withRecipe()), { type: 'recipe', recipe: null });
    assert.deepEqual(kinds(unloaded.effects), ['overlay', 'paint'], 'the history module has handed over no Shot yet');
    assert.equal(unloaded.state.live, true);
    assert.equal(unloaded.state.latest, undefined);
    // One it handed over before the shot is the Shot in the graph once it ends.
    const asked = play(withRecipe(), { type: 'chartAsks', measurements: NEWER.measurements, workflow: NEWER.workflow }, { type: 'shotStarted' }, { type: 'recipe', recipe: null });
    assert.deepEqual(kinds(asked.effects).slice(-3), ['readNewest', 'overlay', 'paint']);
    assert.equal(asked.state.latest.timestamp, NEWER.timestamp);
});

test('a recipe changed while a finished shot waits: the looks stop, bar one once Decaid must have it', () => {
    for (const from of ['a finished shot waiting with a recipe', 'a finished shot waiting with none']) {
        const { state, effects } = play(STATES[from](), { type: 'recipe', recipe: OTHER });
        assert.equal(state.settling, false, from);
        assert.ok(did(effects, 'stopTimer').some(effect => effect.timer === 'settle'), from);
        assert.deepEqual(did(effects, 'startTimer'), [{ do: 'startTimer', timer: 'late', ms: SETTLE_LAST_MS }], from);
        // That one look is a full read of the recipe now loaded.
        const late = play(state, { type: 'timer', timer: 'late' });
        assert.equal(lastRead(late.effects).recipeId, OTHER.id, from);
        assert.equal(late.state.drawDue, true, from);
    }
    const handed = play(withRecipe(), { type: 'chartAsks', measurements: NEWER.measurements, workflow: NEWER.workflow }).state;
    const unloaded = play(settling(handed).state, { type: 'recipe', recipe: null });
    assert.deepEqual(did(unloaded.effects, 'startTimer'), [{ do: 'startTimer', timer: 'late', ms: SETTLE_LAST_MS }]);
    assert.deepEqual(did(play(unloaded.state, { type: 'timer', timer: 'late' }).effects, 'readNewest').length, 1, 'with no recipe the look reads "Last shot"\'s record');
});

// ── A shot started ───────────────────────────────────────────────────────────

test('a shot started: the running shot owns the chart, and every timer stops', () => {
    for (const [name, make] of Object.entries(STATES)) {
        let before = make();
        before = play(before, { type: 'inView' }).state; // a read soon
        const { state, effects } = play(before, { type: 'shotStarted' });
        assert.equal(state.live, true, name);
        assert.equal(state.settling, false, name);
        assert.equal(state.heldBack, false, name);
        assert.ok(state.seq > before.seq, `${name}: a read on its way is no longer wanted`);
        assert.deepEqual(state.timers, { refresh: false, settle: null, late: false, locked: false }, name);
        assert.ok(!did(effects, 'readShots').length && !did(effects, 'draw').length, name);
        assert.deepEqual(kinds(effects).filter(kind => kind !== 'stopTimer'), ['overlay', 'paint'], name);
    }
});

test('a shot started over a finished one still waiting stops the looks for it', () => {
    const { state, effects } = play(STATES['a finished shot waiting with a recipe'](), { type: 'shotStarted' });
    assert.equal(state.settling, false);
    assert.ok(did(effects, 'stopTimer').some(effect => effect.timer === 'settle'));
});

test('a shot started within the one look left after a recipe change stops that look', () => {
    const changed = play(settling(withRecipe()).state, { type: 'recipe', recipe: OTHER });
    assert.equal(changed.state.timers.late, true);
    const { state, effects } = play(changed.state, { type: 'shotStarted' });
    assert.equal(state.timers.late, false);
    assert.ok(did(effects, 'stopTimer').some(effect => effect.timer === 'late'));
});

// ── A shot ended ─────────────────────────────────────────────────────────────

test('a shot ended with a recipe is looked for at the set gaps until Decaid has it', () => {
    const ended = settling(withRecipe());
    let { state } = ended;
    assert.equal(state.settling, true);
    assert.equal(state.settleFrom, LATEST.id, 'the Shot to tell the finished one from');
    assert.deepEqual(did(ended.effects, 'startTimer').at(-1), { do: 'startTimer', timer: 'settle', ms: SETTLE_GAPS_MS[0] });
    // The first two looks find the Shot before.
    for (const gap of SETTLE_GAPS_MS.slice(1, 3)) {
        const look = play(state, { type: 'timer', timer: 'settle' });
        const found = answer(look.state, look.effects, LATEST);
        assert.deepEqual(did(found.effects, 'startTimer'), [{ do: 'startTimer', timer: 'settle', ms: gap }]);
        assert.ok(!did(found.effects, 'draw').length, 'the graph keeps its live lines');
        state = found.state;
    }
    // The third finds it.
    const look = play(state, { type: 'timer', timer: 'settle' });
    const found = answer(look.state, look.effects, NEWER);
    assert.equal(found.state.latest, NEWER);
    assert.equal(found.state.settling, false);
    assert.deepEqual(kinds(found.effects), ['draw']);
});

test('a shot ended with a recipe that Decaid never has: after the last look the graph goes back to the Shot before', () => {
    let { state } = settling(withRecipe());
    for (let step = 0; step < SETTLE_GAPS_MS.length; step += 1) {
        const look = play(state, { type: 'timer', timer: 'settle' });
        state = answer(look.state, look.effects, LATEST).state;
    }
    assert.equal(state.settling, false);
    assert.equal(state.latest, LATEST);
    assert.equal(state.timers.settle, null);
});

test('a shot ended with a recipe nothing had been read for: the first look\'s answer is the Shot before', () => {
    const loaded = play(initialGraphState(), { type: 'recipe', recipe: RECIPE });
    let { state } = settling(loaded.state);
    assert.equal(state.settleFrom, undefined);
    let look = play(state, { type: 'timer', timer: 'settle' });
    const first = answer(look.state, look.effects, LATEST);
    assert.equal(first.state.settling, true);
    assert.equal(first.state.settleFrom, LATEST.id);
    look = play(first.state, { type: 'timer', timer: 'settle' });
    assert.equal(answer(look.state, look.effects, NEWER).state.latest, NEWER);
});

test('a look that can\'t reach Decaid is followed by the next', () => {
    const { state } = settling(withRecipe());
    const look = play(state, { type: 'timer', timer: 'settle' });
    const failed = play(look.state, { type: 'shotsUnread', seq: lastRead(look.effects).seq });
    assert.deepEqual(did(failed.effects, 'startTimer'), [{ do: 'startTimer', timer: 'settle', ms: SETTLE_GAPS_MS[1] }]);
    assert.equal(failed.state.settling, true);
});

test('a shot stopped before it poured is not looked for: the Shots are read once', () => {
    const recipe = play(live(withRecipe()), { type: 'shotEnded', poured: false });
    assert.equal(recipe.state.settling, false);
    assert.deepEqual(kinds(recipe.effects), ['overlay', 'paint', 'readShots']);
    const none = play(live(withNone()), { type: 'shotEnded', poured: false });
    assert.deepEqual(kinds(none.effects), ['overlay', 'paint', 'readNewest']);
});

test('a shot ended with no recipe waits for the history module to draw it', () => {
    const { state, effects } = settling(withNone());
    assert.equal(state.settling, true);
    assert.deepEqual(did(effects, 'startTimer'), [{ do: 'startTimer', timer: 'settle', ms: SETTLE_LAST_MS }]);
    assert.ok(!did(effects, 'readShots').length, 'the page makes none of the looks it makes for a recipe');
    // The module draws the saved Shot.
    const drawn = play(state, { type: 'chartAsks', measurements: NEWER.measurements, workflow: NEWER.workflow });
    assert.equal(drawn.allow, true);
    assert.equal(drawn.state.settling, false);
    assert.equal(drawn.state.latest.timestamp, NEWER.timestamp);
    // Its wait running out later does nothing.
    assert.deepEqual(play(drawn.state, { type: 'timer', timer: 'settle' }).effects, []);
});

test('a shot ended with no recipe that Decaid never saves: after 15 seconds the graph goes back to the Shot before', () => {
    const { state } = settling(withNone());
    const after = play(state, { type: 'timer', timer: 'settle' });
    assert.equal(after.state.settling, false);
    assert.equal(after.state.latest.timestamp, LATEST.timestamp);
    assert.deepEqual(kinds(after.effects), ['readNewest', 'draw']);
});

test('a shot ended with no recipe draws the request turned down during it', () => {
    const during = play(live(withNone()), { type: 'chartAsks', measurements: NEWER.measurements, workflow: NEWER.workflow });
    assert.equal(during.allow, false);
    assert.equal(during.state.heldBack, true);
    const { state, effects } = play(during.state, { type: 'shotEnded', poured: true });
    assert.equal(state.latest.timestamp, NEWER.timestamp);
    assert.equal(state.settling, false);
    assert.deepEqual(kinds(effects), ['readNewest', 'overlay', 'draw']);
});

test('a shot ended with no recipe, the request turned down being the Shot in the graph already, waits as any other', () => {
    const during = play(live(withNone()), { type: 'chartAsks', measurements: LATEST.measurements, workflow: LATEST.workflow });
    const { state } = play(during.state, { type: 'shotEnded', poured: true });
    assert.equal(state.settling, true);
    assert.equal(state.heldBack, false);
});

test('an end with no shot running is ignored', () => {
    for (const name of ['a recipe loaded', 'no recipe', 'a finished shot waiting with a recipe']) {
        const before = STATES[name]();
        const { state, effects } = play(before, { type: 'shotEnded', poured: true });
        assert.deepEqual(effects, [], name);
        assert.equal(state.settling, before.settling, name);
    }
});

// ── The page back in view ────────────────────────────────────────────────────

test('the page back in view reads again a moment later, once for a burst of cues', () => {
    const { state, effects } = play(withRecipe(), { type: 'inView' }, { type: 'inView' });
    assert.deepEqual(effects, [{ do: 'startTimer', timer: 'refresh', ms: REFRESH_GAP_MS }]);
    const read = play(state, { type: 'timer', timer: 'refresh' });
    assert.equal(lastRead(read.effects).recipeId, RECIPE.id);
    assert.equal(read.state.drawDue, true, 'the chart may have been cleared by another page');
    // The same Shots are drawn again.
    assert.deepEqual(kinds(answer(read.state, read.effects, LATEST).effects), ['draw']);
});

test('the page back in view with no recipe reads "Last shot"\'s record', () => {
    const { state } = play(withNone(), { type: 'inView' });
    assert.equal(did(play(state, { type: 'timer', timer: 'refresh' }).effects, 'readNewest').length, 1);
});

test('the page back in view while a shot runs reads nothing', () => {
    for (const name of ['a shot running with a recipe', 'a shot running with none']) {
        assert.deepEqual(play(STATES[name](), { type: 'inView' }).effects, [], name);
    }
});

test('the page back in view while a finished shot waits: its read is one more look', () => {
    const { state } = settling(withRecipe());
    const look = play(state, { type: 'timer', timer: 'settle' });
    const cue = play(look.state, { type: 'inView' }, { type: 'timer', timer: 'refresh' });
    // The look before it answers late, with the finished Shot: it is not taken.
    const early = lastRead(look.effects);
    assert.deepEqual(play(cue.state, { type: 'shotsRead', seq: early.seq, edits: early.edits, shot: NEWER, chosen: chosen(REF) }).effects, []);
    const found = answer(cue.state, cue.effects, NEWER);
    assert.equal(found.state.latest, NEWER);
    assert.equal(found.state.settling, false);
});

test('the page back in view with no recipe while a finished shot waits reads "Last shot"\'s record', () => {
    const { state } = play(STATES['a finished shot waiting with none'](), { type: 'inView' }, { type: 'timer', timer: 'refresh' });
    assert.equal(state.settling, true, 'only the history module ends the wait');
});

// ── The history module asking the chart to draw ──────────────────────────────

test('the history module\'s request before DYE2 has said which recipe is loaded is let through', () => {
    const { state, effects, allow } = play(initialGraphState(), { type: 'chartAsks', measurements: LATEST.measurements, workflow: LATEST.workflow });
    assert.equal(allow, true);
    assert.equal(state.latest.timestamp, LATEST.timestamp);
    assert.deepEqual(effects, [], 'no row names it until the recipe is known');
});

test('the history module\'s request with no recipe is let through, and its record read', () => {
    const { state, effects, allow } = play(withNone(), { type: 'chartAsks', measurements: NEWER.measurements, workflow: NEWER.workflow });
    assert.equal(allow, true);
    assert.equal(state.latest.timestamp, NEWER.timestamp);
    assert.equal(state.latest.id, null, 'the module hands over no id');
    assert.deepEqual(kinds(effects), ['readNewest', 'paint']);
    assert.equal(shownRemarks(state), null, 'the stars wait for its record');
});

test('the history module\'s request with a recipe is turned down, and taken as a cue to look again', () => {
    const { state, effects, allow } = play(withRecipe(), { type: 'chartAsks', measurements: NEWER.measurements, workflow: NEWER.workflow });
    assert.equal(allow, false);
    assert.equal(state.latest, LATEST);
    assert.equal(state.handed.timestamp, NEWER.timestamp, 'kept for when the recipe is unloaded');
    assert.deepEqual(effects, [{ do: 'startTimer', timer: 'refresh', ms: REFRESH_GAP_MS }]);
});

test('the history module\'s request while a shot runs is turned down, with a recipe or without', () => {
    for (const name of ['a shot running with a recipe', 'a shot running with none']) {
        const before = STATES[name]();
        const { state, effects, allow } = play(before, { type: 'chartAsks', measurements: NEWER.measurements, workflow: NEWER.workflow });
        assert.equal(allow, false, name);
        assert.equal(state.heldBack, true, name);
        assert.equal(state.latest, before.latest, name);
        assert.deepEqual(effects, [], name);
    }
});

test('the history module\'s request while a finished shot waits with a recipe is a cue to look again', () => {
    const { state, effects, allow } = play(STATES['a finished shot waiting with a recipe'](), { type: 'chartAsks', measurements: NEWER.measurements, workflow: NEWER.workflow });
    assert.equal(allow, false);
    assert.equal(state.settling, true);
    assert.deepEqual(effects, [{ do: 'startTimer', timer: 'refresh', ms: REFRESH_GAP_MS }]);
});

// ── A reference push ─────────────────────────────────────────────────────────

test('a push for the recipe in the graph reads its Shots, and draws only if one is another', () => {
    const pushed = play(withRecipe(), { type: 'referencePushed', recipeId: RECIPE.id });
    assert.equal(pushed.state.drawDue, false);
    assert.equal(lastRead(pushed.effects).recipeId, RECIPE.id);
    // A repeated push: the same two Shots.
    assert.deepEqual(answer(pushed.state, pushed.effects, LATEST).effects, []);
    // Another reference.
    const moved = answer(pushed.state, pushed.effects, LATEST, chosen(REF2));
    assert.deepEqual(kinds(moved.effects), ['draw']);
    assert.equal(moved.state.reference.shot, REF2);
    // The same reference, rated elsewhere: only the legend's rows.
    const rated = answer(pushed.state, pushed.effects, LATEST, chosen(REF, { rating: 4 }));
    assert.deepEqual(kinds(rated.effects), ['paint']);
    assert.equal(rated.state.reference.rating, 4);
    assert.equal(rated.state.reference.curves, pushed.state.reference.curves, 'its lines are kept, not worked out again');
});

test('a push for the recipe in the graph after its latest Shot was rated elsewhere writes the Shot\'s row', () => {
    const pushed = play(withRecipe(), { type: 'referencePushed', recipeId: null });
    const rated = answer(pushed.state, pushed.effects, { ...LATEST, annotations: { enjoyment: 10 } });
    assert.deepEqual(kinds(rated.effects), ['paint']);
    assert.equal(shownRemarks(rated.state).rating, 10);
});

test('a push for another recipe, or with no recipe loaded, is ignored', () => {
    assert.deepEqual(play(withRecipe(), { type: 'referencePushed', recipeId: OTHER.id }).effects, []);
    assert.deepEqual(play(withNone(), { type: 'referencePushed', recipeId: null }).effects, []);
    assert.deepEqual(play(STATES['a shot running with none'](), { type: 'referencePushed', recipeId: null }).effects, []);
});

test('a push while a shot runs reads nothing: its end reads both Shots again', () => {
    const { state, effects } = play(STATES['a shot running with a recipe'](), { type: 'referencePushed', recipeId: RECIPE.id });
    assert.deepEqual(effects, []);
    assert.equal(state.reference.shot, REF, 'the reference\'s lines stay the ones the shot started with');
});

test('a push while a finished shot waits is one more look', () => {
    const { state } = settling(withRecipe());
    const pushed = play(state, { type: 'referencePushed', recipeId: RECIPE.id });
    assert.equal(lastRead(pushed.effects).recipeId, RECIPE.id);
    const found = answer(pushed.state, pushed.effects, NEWER, chosen(REF2));
    assert.equal(found.state.latest, NEWER);
    assert.equal(found.state.reference.shot, REF2);
    assert.deepEqual(kinds(found.effects), ['stopTimer', 'draw']);
});

test('a push overtaking a read that must end in a draw still ends in a draw', () => {
    const cue = play(withRecipe(), { type: 'inView' });
    const pushed = play(cue.state, { type: 'referencePushed', recipeId: RECIPE.id });
    assert.equal(pushed.state.drawDue, true);
    assert.deepEqual(did(pushed.effects, 'stopTimer'), [{ do: 'stopTimer', timer: 'refresh' }]);
    assert.deepEqual(kinds(answer(pushed.state, pushed.effects, LATEST).effects), ['draw']);
});

// ── The source of the reference changing ─────────────────────────────────────

test('the source changing drops the reference at once, and reads both Shots to a draw', () => {
    const { state, effects } = play(withRecipe(), { type: 'sourceMoved' });
    assert.equal(state.reference.shot, null);
    assert.equal(state.reference.canChange, false);
    assert.equal(state.reference.curves, null);
    assert.equal(state.drawDue, true);
    assert.deepEqual(kinds(effects), ['overlay', 'paint', 'readShots']);
});

test('the source changing while a shot runs drops the reference too, and reads nothing', () => {
    const { state, effects } = play(STATES['a shot running with a recipe'](), { type: 'sourceMoved' });
    assert.equal(state.reference.shot, null);
    assert.deepEqual(kinds(effects), ['overlay', 'paint']);
});

test('the source changing while a finished shot waits drops the reference, and its read is a look', () => {
    const { state, effects } = play(STATES['a finished shot waiting with a recipe'](), { type: 'sourceMoved' });
    assert.equal(state.reference.shot, null);
    assert.equal(state.settling, true);
    assert.equal(did(effects, 'readShots').length, 1);
});

test('the source changing with no recipe, or before a reference was read, changes nothing on screen', () => {
    for (const name of ['no recipe', 'a shot running with none', 'a finished shot waiting with none']) {
        assert.deepEqual(play(STATES[name](), { type: 'sourceMoved' }).effects, [], name);
    }
    const loading = play(initialGraphState(), { type: 'recipe', recipe: RECIPE }).state;
    assert.deepEqual(kinds(play(loading, { type: 'sourceMoved' }).effects), ['readShots']);
});

test('a reference that can\'t be read after the source changed is none, not the other source\'s', () => {
    const moved = play(withRecipe(), { type: 'sourceMoved' });
    const read = answer(moved.state, moved.effects, LATEST, null);
    assert.equal(read.state.reference.shot, null);
    // Without a change of source, a reference that can't be read leaves the one before.
    const pushed = play(withRecipe(), { type: 'referencePushed', recipeId: null });
    assert.equal(answer(pushed.state, pushed.effects, LATEST, null).state.reference.shot, REF);
});

// ── The "Last shot" check ────────────────────────────────────────────────────

test('"Last shot" takes the newest record only if it is the Shot drawn', () => {
    const asked = play(withNone(), { type: 'chartAsks', measurements: NEWER.measurements, workflow: NEWER.workflow });
    const read = lastNewest(asked.effects);
    const other = play(asked.state, { type: 'newestRead', seq: read.seq, edits: read.edits, record: REF });
    assert.equal(shownRemarks(other.state), null, 'never the stars of a Shot that is not the one drawn');
    assert.deepEqual(other.effects, [], 'no stars before, none after: the row is the same');
    const same = play(asked.state, { type: 'newestRead', seq: read.seq, edits: read.edits, record: NEWER });
    assert.equal(shownRemarks(same.state).id, NEWER.id);
    assert.deepEqual(kinds(same.effects), ['paint']);
});

test('"Last shot" handed over again keeps what was read for it until the read answers', () => {
    const { state, effects } = play(withNone(), { type: 'chartAsks', measurements: LATEST.measurements, workflow: LATEST.workflow });
    assert.equal(shownRemarks(state).id, LATEST.id);
    const read = lastNewest(effects);
    assert.deepEqual(play(state, { type: 'newestRead', seq: read.seq, edits: read.edits, record: LATEST }).effects, []);
});

test('"Last shot" read with a shot running or a finished shot waiting is still taken', () => {
    for (const name of ['a shot running with none', 'a finished shot waiting with none']) {
        const before = STATES[name]();
        // The answer to the read asked last.
        const { state } = play(before, { type: 'newestRead', seq: before.lastSeq, edits: before.edits, record: { ...LATEST, annotations: { enjoyment: 2 } } });
        assert.equal(state.remarks.rating, 2, name);
    }
});

test('"Last shot"\'s record answered once a recipe is loaded is not taken', () => {
    const unloaded = play(withRecipe(), { type: 'chartAsks', measurements: NEWER.measurements, workflow: NEWER.workflow }, { type: 'recipe', recipe: null });
    const read = lastNewest(unloaded.effects);
    const loaded = play(unloaded.state, { type: 'recipe', recipe: RECIPE });
    assert.deepEqual(play(loaded.state, { type: 'newestRead', seq: read.seq, edits: read.edits, record: NEWER }).effects, []);
});

// ── An edit of a rating or note answered ─────────────────────────────────────

test('an edit answered changes the Shot it names, on its row and on the reference\'s', () => {
    const recipe = play(withRecipe(), { type: 'edited', shotId: LATEST.id, remarks: { rating: 10 } });
    assert.equal(shownRemarks(recipe.state).rating, 10);
    assert.equal(shownRemarks(recipe.state).note, 'Bright', 'only the one the edit was of');
    assert.deepEqual(kinds(recipe.effects), ['paint']);
    const reference = play(withRecipe(), { type: 'edited', shotId: REF.id, remarks: { note: 'Syrupy' } });
    assert.equal(reference.state.reference.note, 'Syrupy');
    assert.equal(shownRemarks(reference.state).note, 'Bright');
    const none = play(withNone(), { type: 'edited', shotId: LATEST.id, remarks: { rating: 4 } });
    assert.equal(shownRemarks(none.state).rating, 4);
});

test('an edit answered after the graph moved on changes nothing on screen', () => {
    const moved = play(withRecipe(), { type: 'recipe', recipe: OTHER });
    const { state } = play(moved.state, { type: 'edited', shotId: LATEST.id, remarks: { rating: 10 } });
    assert.equal(shownRemarks(state), null);
    assert.equal(state.reference, null);
});

test('an edit answered while a shot runs, or while a finished one waits, is still kept for its Shot', () => {
    for (const name of ['a shot running with a recipe', 'a shot running with none', 'a finished shot waiting with a recipe', 'a finished shot waiting with none']) {
        const { state } = play(STATES[name](), { type: 'edited', shotId: LATEST.id, remarks: { rating: 2 } });
        assert.equal(state.remarks.rating, 2, name);
    }
});

// ── The guards ───────────────────────────────────────────────────────────────

test('a read answered after a newer read began is not taken', () => {
    const first = play(withRecipe(), { type: 'referencePushed', recipeId: null });
    const second = play(first.state, { type: 'referencePushed', recipeId: null });
    const early = lastRead(first.effects);
    const late = play(second.state, { type: 'shotsRead', seq: early.seq, edits: early.edits, shot: NEWER, chosen: chosen(REF2) });
    assert.deepEqual(late.effects, []);
    assert.equal(late.state.latest, LATEST);
    assert.deepEqual(play(second.state, { type: 'shotsUnread', seq: early.seq }).effects, []);
    assert.equal(answer(second.state, second.effects, NEWER).state.latest, NEWER);
});

test('a read answered after the recipe changed, or after a shot started, is not taken', () => {
    const pushed = play(withRecipe(), { type: 'referencePushed', recipeId: null });
    const read = lastRead(pushed.effects);
    for (const event of [{ type: 'recipe', recipe: OTHER }, { type: 'recipe', recipe: null }, { type: 'shotStarted' }]) {
        const moved = play(pushed.state, event);
        const late = play(moved.state, { type: 'shotsRead', seq: read.seq, edits: read.edits, shot: NEWER, chosen: chosen(REF2) });
        assert.deepEqual(late.effects, [], event.type);
        assert.notEqual(late.state.latest, NEWER, event.type);
    }
});

test('a read of the Shots that fails draws again from what was last read, where a draw is due', () => {
    const cue = play(withRecipe(), { type: 'inView' }, { type: 'timer', timer: 'refresh' });
    const failed = play(cue.state, { type: 'shotsUnread', seq: lastRead(cue.effects).seq });
    assert.deepEqual(kinds(failed.effects), ['draw']);
    assert.equal(failed.state.latest, LATEST);
    const pushed = play(withRecipe(), { type: 'referencePushed', recipeId: null });
    assert.deepEqual(play(pushed.state, { type: 'shotsUnread', seq: lastRead(pushed.effects).seq }).effects, []);
});

test('a read of the Shots that fails after a newer read began changes nothing', () => {
    // A look for a finished shot is on its way when the source moves: its
    // failure does not move the looks on.
    const ended = settling(withRecipe());
    const look = play(ended.state, { type: 'timer', timer: 'settle' });
    const moved = play(look.state, { type: 'sourceMoved' });
    const lookFailed = play(moved.state, { type: 'shotsUnread', seq: lastRead(look.effects).seq });
    assert.deepEqual(lookFailed.effects, []);
    assert.equal(lookFailed.state.settleStep, moved.state.settleStep);
    // A read that must end in a draw is overtaken by a push: its failure draws nothing.
    const cue = play(withRecipe(), { type: 'inView' }, { type: 'timer', timer: 'refresh' });
    const pushed = play(cue.state, { type: 'referencePushed', recipeId: null });
    assert.equal(pushed.state.drawDue, true);
    assert.deepEqual(play(pushed.state, { type: 'shotsUnread', seq: lastRead(cue.effects).seq }).effects, []);
});

test('a read that began before an edit of the same Shot does not put the old rating back', () => {
    const pushed = play(withRecipe(), { type: 'referencePushed', recipeId: null });
    const read = lastRead(pushed.effects);
    const edited = play(pushed.state,
        { type: 'editStarted', shotId: LATEST.id },
        { type: 'edited', shotId: LATEST.id, remarks: { rating: 10 } },
        { type: 'editEnded', shotId: LATEST.id });
    // The read answers with the rating from before the edit.
    const late = play(edited.state, { type: 'shotsRead', seq: read.seq, edits: read.edits, shot: LATEST, chosen: chosen(REF) });
    assert.equal(shownRemarks(late.state).rating, 10);
    // A read begun after the edit is taken.
    const again = play(late.state, { type: 'referencePushed', recipeId: null });
    assert.equal(shownRemarks(answer(again.state, again.effects, { ...LATEST, annotations: { enjoyment: 4 } }).state).rating, 4);
});

test('a read that began during an edit of the same Shot does not put the old rating back', () => {
    const started = play(withRecipe(), { type: 'editStarted', shotId: LATEST.id }, { type: 'referencePushed', recipeId: null });
    const read = lastRead(started.effects);
    const ended = play(started.state, { type: 'edited', shotId: LATEST.id, remarks: { rating: 10 } }, { type: 'editEnded', shotId: LATEST.id });
    const late = play(ended.state, { type: 'shotsRead', seq: read.seq, edits: read.edits, shot: LATEST, chosen: chosen(REF) });
    assert.equal(shownRemarks(late.state).rating, 10);
});

test('a read that began before an edit of the reference does not put its old rating back', () => {
    const pushed = play(withRecipe(), { type: 'referencePushed', recipeId: null });
    const read = lastRead(pushed.effects);
    const edited = play(pushed.state, { type: 'editStarted', shotId: REF.id }, { type: 'edited', shotId: REF.id, remarks: { rating: 2 } }, { type: 'editEnded', shotId: REF.id });
    const late = play(edited.state, { type: 'shotsRead', seq: read.seq, edits: read.edits, shot: LATEST, chosen: chosen(REF, { canChange: true }) });
    assert.equal(late.state.reference.rating, 2);
    // A read of another Shot begun before the edit is taken as it is.
    const other = play(edited.state, { type: 'shotsRead', seq: read.seq, edits: read.edits, shot: LATEST, chosen: chosen(REF2) });
    assert.equal(other.state.reference.shot, REF2);
});

test('a read of "Last shot"\'s record that began before an edit of it does not put the old rating back', () => {
    const asked = play(withNone(), { type: 'inView' }, { type: 'timer', timer: 'refresh' });
    const read = lastNewest(asked.effects);
    const edited = play(asked.state, { type: 'editStarted', shotId: LATEST.id }, { type: 'edited', shotId: LATEST.id, remarks: { rating: 10 } }, { type: 'editEnded', shotId: LATEST.id });
    const late = play(edited.state, { type: 'newestRead', seq: read.seq, edits: read.edits, record: LATEST });
    assert.equal(shownRemarks(late.state).rating, 10);
});

test('a read of "Last shot"\'s record answered after a newer one began is not taken', () => {
    const first = play(withNone(), { type: 'inView' }, { type: 'timer', timer: 'refresh' });
    const second = play(first.state, { type: 'inView' }, { type: 'timer', timer: 'refresh' });
    const early = lastNewest(first.effects);
    assert.deepEqual(play(second.state, { type: 'newestRead', seq: early.seq, edits: early.edits, record: REF }).effects, []);
});

test('a choice still on its way when the source changes is not drawn; the read after the change is', () => {
    const moved = play(withRecipe(), { type: 'sourceMoved' });
    // The seam answers the choice with null where the source changed meanwhile.
    const choice = play(moved.state, { type: 'referenceChosen', recipeId: RECIPE.id, chosen: null });
    assert.deepEqual(choice.effects, []);
    assert.equal(choice.state.reference.shot, null);
    const read = answer(choice.state, moved.effects, LATEST, chosen(REF2));
    assert.equal(read.state.reference.shot, REF2);
    assert.deepEqual(kinds(read.effects), ['draw']);
});

test('a read from the source before the change is not taken once it changed', () => {
    const pushed = play(withRecipe(), { type: 'referencePushed', recipeId: null });
    const early = lastRead(pushed.effects);
    const moved = play(pushed.state, { type: 'sourceMoved' });
    const late = play(moved.state, { type: 'shotsRead', seq: early.seq, edits: early.edits, shot: LATEST, chosen: chosen(REF) });
    assert.deepEqual(late.effects, []);
    assert.equal(late.state.reference.shot, null);
});

test('a choice answered is followed without another read, and a read begun before it is not taken', () => {
    const pushed = play(withRecipe(), { type: 'referencePushed', recipeId: null });
    const early = lastRead(pushed.effects);
    const choice = play(pushed.state, { type: 'referenceChosen', recipeId: RECIPE.id, chosen: chosen(LATEST) });
    assert.deepEqual(kinds(choice.effects), ['draw']);
    assert.equal(choice.state.reference.shot, LATEST);
    assert.ok(choice.state.reference.curves, 'its lines are worked out');
    const late = play(choice.state, { type: 'shotsRead', seq: early.seq, edits: early.edits, shot: LATEST, chosen: chosen(REF) });
    assert.deepEqual(late.effects, []);
    assert.equal(late.state.reference.shot, LATEST);
});

test('a choice answered after the recipe changed, or a shot started or ended, is not drawn', () => {
    for (const make of [
        () => play(withRecipe(), { type: 'recipe', recipe: OTHER }).state,
        () => play(withRecipe(), { type: 'recipe', recipe: null }).state,
        STATES['a shot running with a recipe'],
        STATES['a finished shot waiting with a recipe'],
    ]) {
        const before = make();
        const { state, effects } = play(before, { type: 'referenceChosen', recipeId: RECIPE.id, chosen: chosen(LATEST) });
        assert.deepEqual(effects, []);
        assert.equal(state.reference, before.reference);
    }
});

// ── A live shot ──────────────────────────────────────────────────────────────

test('nothing draws the whole chart while a shot runs', () => {
    // The chart's live draw is the running shot's own: whatever happens, the
    // module asks for no full draw until the shot ends.
    for (const name of ['a shot running with a recipe', 'a shot running with none']) {
        let { state } = { state: STATES[name]() };
        const events = [
            { type: 'chartAsks', measurements: NEWER.measurements, workflow: NEWER.workflow },
            { type: 'inView' },
            { type: 'referencePushed', recipeId: null },
            { type: 'sourceMoved' },
            { type: 'recipe', recipe: OTHER },
            { type: 'recipe', recipe: null },
            { type: 'edited', shotId: LATEST.id, remarks: { rating: 2 } },
            { type: 'shotsRead', seq: state.seq, edits: state.edits, shot: NEWER, chosen: chosen(REF2) },
            { type: 'shotsUnread', seq: state.seq },
            { type: 'referenceChosen', recipeId: RECIPE.id, chosen: chosen(LATEST) },
            { type: 'open', shotId: EARLIER.id, recipe: RECIPE },
            { type: 'openedRead', seq: state.openSeq, edits: state.edits, shotId: EARLIER.id, shot: EARLIER, chosen: chosen(REF2) },
            { type: 'backToLatest' },
        ];
        for (const event of events) {
            const step = play(state, event);
            assert.deepEqual(did(step.effects, 'draw'), [], `${name}: ${event.type}`);
            state = step.state;
        }
        assert.equal(state.live, true, name);
    }
});

// ── A Shot opened from the Shots list ────────────────────────────────────────

// An earlier Shot of the loaded recipe, and one of another recipe with that
// recipe's own reference.
const EARLIER = shot('s-earlier', 5, { enjoyment: 4 });
const GUESTS = shot('s-guests', 15);
const GUEST_REF = shot('s-guest-ref', 25);
// An Unfinished Shot: never poured, and the scale never read 1 g.
const UNFINISHED = { ...shot('s-unfinished', 35), measurements: [{ machine: { timestamp: '2026-11-12T10:00:35.000', state: { substate: 'preinfusion' }, pressure: 1, flow: 1 }, scale: { weight: 0 } }] };

const lastOpened = effects => did(effects, 'readOpened').at(-1);

// The answer to the last read of an opened Shot.
function openedAnswer(state, effects, found, ref = null, canChange = true) {
    const read = lastOpened(effects);
    assert.ok(read, 'a read of the opened Shot was asked for');
    return play(state, { type: 'openedRead', seq: read.seq, edits: read.edits, shotId: read.shotId, shot: found, canChange, chosen: ref });
}

// A row tapped, and its Shot read with its recipe's reference.
function opened(state, target = EARLIER, recipe = RECIPE, ref = chosen(REF2)) {
    const asked = play(state, { type: 'open', shotId: target.id, recipe });
    return openedAnswer(asked.state, asked.effects, target, recipe ? ref : null);
}

test('a row tapped reads that Shot and its own recipe\'s reference, and the graph keeps what it shows until then', () => {
    const before = withRecipe();
    const { state, effects } = play(before, { type: 'open', shotId: GUESTS.id, recipe: OTHER });
    assert.deepEqual(kinds(effects), ['readOpened']);
    assert.deepEqual({ ...lastOpened(effects), seq: 0, edits: 0 }, { do: 'readOpened', shotId: GUESTS.id, recipeId: OTHER.id, seq: 0, edits: 0 });
    assert.equal(state.opened, null);
    assert.equal(inGraph(state).shot, LATEST, 'nothing is drawn until the Shot is read');
    const none = play(before, { type: 'open', shotId: GUESTS.id, recipe: null });
    assert.equal(lastOpened(none.effects).recipeId, null, 'a Shot with no recipe has no reference to read');
});

test('an opened Shot is drawn with its own recipe\'s reference, while the latest is kept to go back to', () => {
    const { state, effects } = opened(withRecipe(), GUESTS, OTHER, chosen(GUEST_REF));
    assert.deepEqual(kinds(effects).slice(-2), ['overlay', 'draw']);
    const shown = inGraph(state);
    assert.equal(shown.shot, GUESTS);
    assert.equal(shown.recipe, OTHER, 'compared as its own recipe');
    assert.equal(shown.reference.shot, GUEST_REF);
    assert.ok(shown.reference.curves, 'the reference\'s lines are worked out');
    assert.deepEqual(shown.opened, { loaded: RECIPE, unfinished: false, name: null, canChange: true });
    assert.equal(state.latest, LATEST);
    assert.equal(state.reference.shot, REF, 'the loaded recipe\'s reference is kept');
    assert.equal(shownRemarks(state).id, GUESTS.id);
    assert.equal(shotInGraphId(state), GUESTS.id);
    assert.equal(latestShotId(state), LATEST.id);
});

test('an opened Shot with no recipe has no reference, and one with no recipe loaded keeps its own', () => {
    const none = opened(withRecipe(), EARLIER, null);
    assert.equal(inGraph(none.state).recipe, null);
    assert.deepEqual(inGraph(none.state).reference.shot, null);
    const unloaded = opened(withNone(), EARLIER, RECIPE, chosen(REF));
    assert.equal(inGraph(unloaded.state).reference.shot, REF);
    assert.deepEqual(inGraph(unloaded.state).opened, { loaded: null, unfinished: false, name: null, canChange: true });
});

test('a Shot of a recipe this tablet has no record of opens under that recipe\'s name, with no reference read', () => {
    const asked = play(withRecipe(), { type: 'open', shotId: GUESTS.id, recipe: null, name: 'Elsewhere espresso' });
    assert.equal(lastOpened(asked.effects).recipeId, null, 'the plugin reads a reference by DYE2 record id only');
    const { state } = openedAnswer(asked.state, asked.effects, GUESTS);
    assert.deepEqual([inGraph(state).recipe, inGraph(state).opened.name, inGraph(state).reference.shot], [null, 'Elsewhere espresso', null]);
    // A name is only for a Shot with no record: one with a record is named by it.
    const named = play(withRecipe(), { type: 'open', shotId: GUESTS.id, recipe: OTHER, name: 'Ignored' });
    assert.equal(named.state.opening.name, null);
});

// ── Another Machine's Shot, and the server out of reach ──────────────────────

test('an opened Shot the server can\'t be asked for can\'t be changed, and only the legend is written again', () => {
    const base = opened(withRecipe(), GUESTS, OTHER, chosen(GUEST_REF)).state;
    // The connection went: the seam says to read again, and that read can't reach the server.
    const pushed = play(base, { type: 'referencePushed', recipeId: null });
    const read = lastOpened(pushed.effects);
    const out = play(pushed.state, { type: 'openedUnread', seq: read.seq, shotId: GUESTS.id, unreachable: true });
    assert.deepEqual(kinds(out.effects), ['paint', 'startTimer'], 'nothing is drawn again, and it is read again later');
    assert.equal(inGraph(out.state).opened.canChange, false);
    assert.equal(inGraph(out.state).shot, GUESTS, 'it stays in the graph, as read before');
    assert.equal(inGraph(out.state).reference.shot, GUEST_REF);
    // Told again, nothing more is written.
    const again = play(out.state, { type: 'referencePushed', recipeId: null });
    assert.deepEqual(play(again.state, { type: 'openedUnread', seq: lastOpened(again.effects).seq, shotId: GUESTS.id, unreachable: true }).effects, []);
    // The server is back: the same two Shots, and it can be changed again.
    const back = openedAnswer(again.state, again.effects, GUESTS, chosen(GUEST_REF));
    assert.deepEqual(kinds(back.effects), ['stopTimer', 'paint']);
    assert.equal(inGraph(back.state).opened.canChange, true);
});

test('a locked Shot is read again later, more slowly each time, until a read finds the server back', () => {
    const base = opened(withRecipe(), GUESTS, OTHER, chosen(GUEST_REF)).state;
    // The connection came back, but the plugin still refuses Shots while the tablet catches up.
    const pushed = play(base, { type: 'referencePushed', recipeId: null });
    let step = play(pushed.state, { type: 'openedUnread', seq: lastOpened(pushed.effects).seq, shotId: GUESTS.id, unreachable: true });
    assert.deepEqual(did(step.effects, 'startTimer'), [{ do: 'startTimer', timer: 'locked', ms: lockedRetryMs(1) }]);
    for (const tries of [2, 3]) {
        const fired = play(step.state, { type: 'timer', timer: 'locked' });
        const read = lastOpened(fired.effects);
        assert.deepEqual([read.shotId, read.recipeId], [GUESTS.id, OTHER.id], 'the opened Shot and its reference are read again');
        step = play(fired.state, { type: 'openedUnread', seq: read.seq, shotId: GUESTS.id, unreachable: true });
        assert.deepEqual(did(step.effects, 'startTimer'), [{ do: 'startTimer', timer: 'locked', ms: lockedRetryMs(tries) }]);
    }
    const fired = play(step.state, { type: 'timer', timer: 'locked' });
    const back = openedAnswer(fired.state, fired.effects, GUESTS, chosen(GUEST_REF));
    assert.equal(inGraph(back.state).opened.canChange, true);
    assert.equal(back.state.lockedTries, 0);
    assert.deepEqual([lockedRetryMs(1), lockedRetryMs(2), lockedRetryMs(20)], [10_000, 20_000, 300_000]);
});

test('a locked Shot whose read again fails for another reason is read again later all the same', () => {
    const base = opened(withRecipe(), GUESTS, OTHER, chosen(GUEST_REF)).state;
    const locked = graphStep(base, { type: 'shotUnreachable', shotId: GUESTS.id }).state;
    const fired = play(locked, { type: 'timer', timer: 'locked' });
    const failed = play(fired.state, { type: 'openedUnread', seq: lastOpened(fired.effects).seq, shotId: GUESTS.id });
    assert.deepEqual(did(failed.effects, 'startTimer'), [{ do: 'startTimer', timer: 'locked', ms: lockedRetryMs(2) }]);
    assert.equal(inGraph(failed.state).opened.canChange, false);
});

test('the read again of a locked Shot waits for a tap on its way, and stops with a shot or once the Shot is closed', () => {
    const base = opened(withRecipe(), GUESTS, OTHER, chosen(GUEST_REF)).state;
    const locked = graphStep(base, { type: 'shotUnreachable', shotId: GUESTS.id }).state;
    const tapped = play(locked, { type: 'open', shotId: EARLIER.id, recipe: RECIPE });
    assert.deepEqual(did(play(tapped.state, { type: 'timer', timer: 'locked' }).effects, 'readOpened'), [], 'the tap\'s read is not passed over');
    const started = play(locked, { type: 'shotStarted' });
    assert.ok(did(started.effects, 'stopTimer').some(effect => effect.timer === 'locked'));
    const closed = play(locked, { type: 'backToLatest' }).state;
    assert.deepEqual(did(play(closed, { type: 'timer', timer: 'locked' }).effects, 'readOpened'), [], 'nothing is opened to read');
});

test('a read that can\'t be made for any other reason leaves an opened Shot as one that can be changed', () => {
    const base = opened(withRecipe(), GUESTS, OTHER, chosen(GUEST_REF)).state;
    const pushed = play(base, { type: 'referencePushed', recipeId: OTHER.id });
    const failed = play(pushed.state, { type: 'openedUnread', seq: lastOpened(pushed.effects).seq, shotId: GUESTS.id });
    assert.deepEqual(failed.effects, []);
    assert.equal(inGraph(failed.state).opened.canChange, true);
});

test('the way back from another page during an outage draws another Machine\'s Shot as read before, locked', () => {
    const base = opened(withRecipe(), GUESTS, OTHER, chosen(GUEST_REF)).state;
    const seen = play(base, { type: 'inView' }, { type: 'timer', timer: 'refresh' });
    const out = play(seen.state, { type: 'openedUnread', seq: lastOpened(seen.effects).seq, shotId: GUESTS.id, unreachable: true });
    assert.deepEqual(kinds(out.effects), ['startTimer', 'draw'], 'the draw writes the legend too');
    assert.equal(inGraph(out.state).opened.canChange, false);
});

test('a Shot read as one that can\'t be changed is opened so, and a row tapped that the server can\'t be asked for is not opened', () => {
    const asked = play(withRecipe(), { type: 'open', shotId: GUESTS.id, recipe: OTHER });
    assert.equal(inGraph(openedAnswer(asked.state, asked.effects, GUESTS, chosen(GUEST_REF), false).state).opened.canChange, false);
    const failed = play(asked.state, { type: 'openedUnread', seq: lastOpened(asked.effects).seq, shotId: GUESTS.id, unreachable: true });
    assert.deepEqual(kinds(failed.effects), ['unopened']);
    assert.equal(failed.state.opened, null);
    assert.equal(inGraph(failed.state).shot, LATEST);
});

test('an edit that could not be confirmed either way locks the opened Shot it was of, and no other', () => {
    const base = opened(withRecipe(), GUESTS, OTHER, chosen(GUEST_REF)).state;
    const step = graphStep(base, { type: 'shotUnreachable', shotId: GUESTS.id });
    assert.equal(step.allow, true, 'the Shot is in the graph, so the line says why');
    assert.deepEqual(kinds(step.effects), ['paint', 'startTimer']);
    assert.equal(inGraph(step.state).opened.canChange, false);
    assert.deepEqual(graphStep(step.state, { type: 'shotUnreachable', shotId: GUESTS.id }).effects, [], 'told again, nothing is written');
    for (const state of [base, withRecipe()]) {
        const other = graphStep(state, { type: 'shotUnreachable', shotId: LATEST.id });
        assert.equal(other.allow, false, 'the graph shows another Shot, so a toast says the edit failed');
        assert.deepEqual(other.effects, []);
    }
});

test('a locked Shot gives way as any opened Shot does, and the next is opened as it is read', () => {
    const base = opened(withRecipe(), GUESTS, OTHER, chosen(GUEST_REF)).state;
    const locked = graphStep(base, { type: 'shotUnreachable', shotId: GUESTS.id }).state;
    assert.equal(play(locked, { type: 'backToLatest' }).state.opened, null);
    assert.equal(play(locked, { type: 'sourceMoved' }).state.opened, null, 'a Machine that turns Capture-only shows the latest');
    assert.equal(inGraph(opened(locked, EARLIER).state).opened.canChange, true, 'this tablet\'s own Shot');
});

test('an opened Unfinished Shot is drawn as it is, and is known to be Unfinished', () => {
    const { state } = opened(withRecipe(), UNFINISHED);
    assert.equal(inGraph(state).shot, UNFINISHED);
    assert.equal(inGraph(state).opened.unfinished, true);
});

test('the latest\'s own row goes back to the latest, and reads nothing', () => {
    assert.deepEqual(play(withRecipe(), { type: 'open', shotId: LATEST.id, recipe: RECIPE }).effects, []);
    const back = play(opened(withRecipe()).state, { type: 'open', shotId: LATEST.id, recipe: RECIPE });
    assert.equal(back.state.opened, null);
    assert.ok(!did(back.effects, 'readOpened').length);
    // With no recipe, "Last shot"'s row, once its record is known.
    assert.equal(latestShotId(withNone()), LATEST.id);
    assert.equal(play(opened(withNone()).state, { type: 'open', shotId: LATEST.id, recipe: RECIPE }).state.opened, null);
});

test('the opened Shot\'s own row reads nothing', () => {
    const { state } = opened(withRecipe());
    const again = play(state, { type: 'open', shotId: EARLIER.id, recipe: RECIPE });
    assert.deepEqual(again.effects, []);
    assert.equal(again.state.opened, state.opened);
});

test('a Shot that can\'t be read, or has gone, says so, and the graph stays as it was', () => {
    const asked = play(withRecipe(), { type: 'open', shotId: EARLIER.id, recipe: RECIPE });
    const read = lastOpened(asked.effects);
    const failed = play(asked.state, { type: 'openedUnread', seq: read.seq, shotId: EARLIER.id });
    assert.deepEqual(kinds(failed.effects), ['unopened']);
    assert.equal(failed.state.opened, null);
    const gone = openedAnswer(asked.state, asked.effects, null);
    assert.deepEqual(kinds(gone.effects), ['unopened']);
    assert.equal(inGraph(gone.state).shot, LATEST);
});

test('"Back to latest" draws the latest as it was kept, then reads it, drawing again only if it changed', () => {
    const { state, effects } = play(opened(withRecipe()).state, { type: 'backToLatest' });
    assert.equal(state.opened, null);
    assert.deepEqual(kinds(effects), ['overlay', 'draw', 'readShots']);
    assert.equal(inGraph(state).shot, LATEST);
    assert.equal(inGraph(state).reference.shot, REF);
    assert.deepEqual(answer(state, effects, LATEST).effects, [], 'the same two Shots');
    assert.deepEqual(kinds(answer(state, effects, NEWER).effects), ['draw']);
});

test('"Back to latest" with no recipe returns to the Shot the history module last handed the chart', () => {
    const { state, effects } = play(opened(withNone()).state, { type: 'backToLatest' });
    assert.equal(state.opened, null);
    assert.equal(state.latest.timestamp, LATEST.timestamp);
    assert.deepEqual(kinds(effects), ['readNewest', 'overlay', 'draw']);
});

test('"Back to latest" with nothing opened does nothing', () => {
    assert.deepEqual(play(withRecipe(), { type: 'backToLatest' }).effects, []);
});

// Each trigger, with a Shot opened.

test('with a Shot opened, a shot starting draws live, and the latest is in the graph when it ends', () => {
    const started = play(opened(withRecipe()).state, { type: 'shotStarted' });
    assert.equal(started.state.opened, null);
    assert.equal(started.state.live, true);
    assert.equal(inGraph(started.state).reference.shot, REF, 'the loaded recipe\'s reference is behind the running shot');
    assert.deepEqual(did(started.effects, 'draw'), []);
    const ended = play(started.state, { type: 'shotEnded', poured: true });
    assert.equal(ended.state.settleFrom, LATEST.id, 'the shot is told from the latest, not from the Shot that was opened');
    const look = play(ended.state, { type: 'timer', timer: 'settle' });
    const found = answer(look.state, look.effects, NEWER);
    assert.equal(inGraph(found.state).shot, NEWER);
    assert.deepEqual(did(found.effects, 'draw').length, 1);
});

test('with a Shot opened, a recipe loaded or unloaded sends the graph back to the latest', () => {
    const base = opened(withRecipe()).state;
    const loaded = play(base, { type: 'recipe', recipe: OTHER });
    assert.equal(loaded.state.opened, null);
    assert.equal(lastRead(loaded.effects).recipeId, OTHER.id);
    const unloaded = play(base, { type: 'recipe', recipe: null });
    assert.equal(unloaded.state.opened, null);
    assert.ok(did(unloaded.effects, 'draw').length, 'the Shot the history module handed is drawn');
    // The same recipe read again keeps the opened Shot.
    const same = play(base, { type: 'recipe', recipe: { ...RECIPE, profileTitle: 'Changed' } });
    assert.equal(same.state.opened, base.opened);
});

test('with a Shot opened, the page back in view reads that Shot again, not the latest', () => {
    const base = opened(withRecipe()).state;
    const cue = play(base, { type: 'inView' });
    const due = play(cue.state, { type: 'timer', timer: 'refresh' });
    assert.ok(!did(due.effects, 'readShots').length);
    assert.equal(lastOpened(due.effects).shotId, EARLIER.id);
    // Rated elsewhere meanwhile: the rating is taken, and the Shot drawn kept.
    const rated = openedAnswer(due.state, due.effects, { ...EARLIER, annotations: { enjoyment: 10 } }, chosen(REF2));
    assert.equal(shownRemarks(rated.state).rating, 10);
    assert.equal(rated.state.opened.id, EARLIER.id, 'the same Shot is in the graph');
    // Nothing changed: it is drawn again all the same, as the chart was cleared on the way back.
    assert.deepEqual(kinds(openedAnswer(due.state, due.effects, EARLIER, chosen(REF2)).effects), ['overlay', 'draw']);
});

test('with a Shot opened, the way back from another page draws it again though nothing changed', () => {
    // The router clears the chart, the history module's request is turned down,
    // and the read finds the same two Shots.
    const base = opened(withRecipe()).state;
    const asks = play(base, { type: 'inView' }, { type: 'chartAsks', measurements: LATEST.measurements, workflow: LATEST.workflow }, { type: 'timer', timer: 'refresh' });
    assert.equal(asks.allow, undefined);
    const same = openedAnswer(asks.state, asks.effects, EARLIER, chosen(REF2));
    assert.equal(did(same.effects, 'draw').length, 1);
    assert.equal(same.state.drawDue, false);
    assert.equal(inGraph(same.state).shot, EARLIER);
    // One that can't be read is drawn as read before.
    const read = lastOpened(asks.effects);
    const failed = play(asks.state, { type: 'openedUnread', seq: read.seq, shotId: EARLIER.id });
    assert.equal(did(failed.effects, 'draw').length, 1);
    assert.equal(inGraph(failed.state).shot, EARLIER);
    // A push's re-read that finds the same two Shots still draws nothing.
    const pushed = play(base, { type: 'referencePushed', recipeId: RECIPE.id });
    assert.deepEqual(openedAnswer(pushed.state, pushed.effects, EARLIER, chosen(REF2)).effects, []);
});

test('with a Shot opened, a re-read that finds it gone sends the graph back to the latest', () => {
    const base = opened(withRecipe()).state;
    const due = play(base, { type: 'inView' }, { type: 'timer', timer: 'refresh' });
    const gone = openedAnswer(due.state, due.effects, null);
    assert.equal(gone.state.opened, null);
    assert.ok(did(gone.effects, 'draw').length);
    assert.ok(!did(gone.effects, 'unopened').length);
    // One that can't be read stays.
    const read = lastOpened(due.effects);
    assert.equal(play(due.state, { type: 'openedUnread', seq: read.seq, shotId: EARLIER.id }).state.opened, base.opened);
});

test('with a Shot opened, the history module\'s request is turned down and taken as a cue to read the opened Shot', () => {
    const recipe = play(opened(withRecipe()).state, { type: 'chartAsks', measurements: NEWER.measurements, workflow: NEWER.workflow });
    assert.equal(recipe.allow, false);
    assert.deepEqual(recipe.effects, [{ do: 'startTimer', timer: 'refresh', ms: REFRESH_GAP_MS }]);
    // With no recipe, the Shot handed over is the one the graph goes back to.
    const none = play(opened(withNone()).state, { type: 'chartAsks', measurements: NEWER.measurements, workflow: NEWER.workflow });
    assert.equal(none.allow, false);
    assert.equal(inGraph(none.state).shot, EARLIER);
    assert.equal(none.state.latest.timestamp, NEWER.timestamp);
    assert.ok(did(none.effects, 'readNewest').length);
    const back = play(none.state, { type: 'backToLatest' });
    assert.equal(inGraph(back.state).shot.timestamp, NEWER.timestamp);
});

test('with a Shot opened, a push for its own recipe reads it again; one for another is left for the way back', () => {
    const base = opened(withRecipe(), GUESTS, OTHER, chosen(GUEST_REF)).state;
    const own = play(base, { type: 'referencePushed', recipeId: OTHER.id });
    assert.equal(lastOpened(own.effects).recipeId, OTHER.id);
    const moved = openedAnswer(own.state, own.effects, GUESTS, chosen(REF2));
    assert.deepEqual(kinds(moved.effects), ['overlay', 'draw']);
    assert.equal(inGraph(moved.state).reference.shot, REF2);
    assert.deepEqual(play(base, { type: 'referencePushed', recipeId: RECIPE.id }).effects, []);
    assert.equal(lastOpened(play(base, { type: 'referencePushed', recipeId: null }).effects).shotId, GUESTS.id);
    // A Shot with no recipe has no reference to follow. It is still read again
    // when the server may have come or gone, which changes whether it can be
    // changed.
    const none = opened(withRecipe(), EARLIER, null).state;
    assert.deepEqual(play(none, { type: 'referencePushed', recipeId: OTHER.id }).effects, []);
    assert.deepEqual(lastOpened(play(none, { type: 'referencePushed', recipeId: null }).effects).recipeId, null);
});

test('with a Shot opened, the source changing sends the graph back to the latest', () => {
    const recipe = play(opened(withRecipe()).state, { type: 'sourceMoved' });
    assert.equal(recipe.state.opened, null);
    assert.equal(recipe.state.reference.shot, null, 'the reference read before is the other source\'s');
    assert.equal(recipe.state.drawDue, true);
    assert.equal(lastRead(recipe.effects).recipeId, RECIPE.id);
    const none = play(opened(withNone()).state, { type: 'sourceMoved' });
    assert.equal(none.state.opened, null);
    assert.deepEqual(kinds(none.effects), ['draw']);
});

test('an open still on its way is not drawn once something has sent the graph back to the latest', () => {
    for (const event of [{ type: 'shotStarted' }, { type: 'recipe', recipe: OTHER }, { type: 'recipe', recipe: null }, { type: 'sourceMoved' }, { type: 'backToLatest' }]) {
        const asked = play(withRecipe(), { type: 'open', shotId: EARLIER.id, recipe: RECIPE });
        const ended = play(asked.state, event);
        const late = openedAnswer(ended.state, asked.effects, EARLIER, chosen(REF2));
        assert.equal(late.state.opened, null, event.type);
        assert.deepEqual(did(late.effects, 'draw'), [], event.type);
    }
});

test('a Shot tapped while another is opened replaces it once read, and a re-read of the first does not cancel it', () => {
    const base = opened(withRecipe()).state;
    const asked = play(base, { type: 'open', shotId: GUESTS.id, recipe: OTHER });
    // The page comes back into view while the tap's read is on its way.
    const due = play(asked.state, { type: 'inView' }, { type: 'timer', timer: 'refresh' });
    assert.equal(lastOpened(due.effects).shotId, GUESTS.id, 'the Shot tapped is read in place of the one in the graph');
    const found = openedAnswer(due.state, due.effects, GUESTS, chosen(GUEST_REF));
    assert.equal(inGraph(found.state).shot, GUESTS);
    assert.equal(inGraph(found.state).recipe, OTHER);
});

test('a read of an opened Shot answered after a newer one began is not taken', () => {
    const asked = play(withRecipe(), { type: 'open', shotId: EARLIER.id, recipe: RECIPE });
    const newer = play(asked.state, { type: 'open', shotId: GUESTS.id, recipe: OTHER });
    const late = openedAnswer(newer.state, asked.effects, EARLIER, chosen(REF2));
    assert.deepEqual(late.effects, []);
    assert.equal(late.state.opened, null);
});

test('a Shot opened while a finished shot waits stops the looks for it', () => {
    const { state } = opened(settling(withRecipe()).state);
    assert.equal(state.settling, false);
    assert.equal(state.timers.settle, null);
    assert.equal(inGraph(state).shot, EARLIER);
});

test('nothing opens while a shot runs', () => {
    assert.deepEqual(play(STATES['a shot running with a recipe'](), { type: 'open', shotId: EARLIER.id, recipe: RECIPE }).effects, []);
});

test('an opened Shot\'s rating and note follow an edit, and a read begun before it does not put the old rating back', () => {
    const base = opened(withRecipe()).state;
    const due = play(base, { type: 'inView' }, { type: 'timer', timer: 'refresh' });
    const edit = play(due.state, { type: 'editStarted', shotId: EARLIER.id }, { type: 'edited', shotId: EARLIER.id, remarks: { rating: 10 } }, { type: 'editEnded', shotId: EARLIER.id });
    assert.equal(shownRemarks(edit.state).rating, 10);
    assert.equal(shownRemarks(edit.state).note, null, 'only the one the edit was of');
    const late = openedAnswer(edit.state, due.effects, EARLIER, chosen(REF2));
    assert.equal(shownRemarks(late.state).rating, 10);
    // The opened Shot's reference's row follows an edit of it too, and the
    // loaded recipe's reference where it is the same Shot.
    const ref = play(opened(withRecipe(), EARLIER, RECIPE, chosen(REF)).state, { type: 'edited', shotId: REF.id, remarks: { note: 'Syrupy' } });
    assert.equal(ref.state.opened.reference.note, 'Syrupy');
    assert.equal(ref.state.reference.note, 'Syrupy');
});

test('Make reference on an opened Shot sets its own recipe\'s reference, and the loaded recipe\'s only when it is the same', () => {
    const other = opened(withRecipe(), GUESTS, OTHER, chosen(GUEST_REF)).state;
    const made = play(other, { type: 'referenceChosen', recipeId: OTHER.id, chosen: chosen(GUESTS) });
    assert.deepEqual(kinds(made.effects), ['readOpened', 'draw'], 'drawn at once, and read again for what a read on its way would have brought');
    assert.equal(made.state.opened.reference.shot, GUESTS);
    assert.equal(made.state.reference.shot, REF, 'the loaded recipe\'s reference is left');
    const own = opened(withRecipe()).state;
    const ownMade = play(own, { type: 'referenceChosen', recipeId: RECIPE.id, chosen: chosen(EARLIER) });
    assert.equal(ownMade.state.opened.reference.shot, EARLIER);
    assert.equal(ownMade.state.reference.shot, EARLIER, 'the graph goes back to the latest with this reference');
    // A read of the opened Shot begun before the choice does not put the old reference back.
    const due = play(own, { type: 'inView' }, { type: 'timer', timer: 'refresh' });
    const chose = play(due.state, { type: 'referenceChosen', recipeId: RECIPE.id, chosen: chosen(EARLIER) });
    assert.equal(openedAnswer(chose.state, due.effects, EARLIER, chosen(REF2)).state.opened.reference.shot, EARLIER);
    // The read asked after the choice is taken: a rating made elsewhere is not lost with the dropped one.
    const after = openedAnswer(chose.state, chose.effects, { ...EARLIER, annotations: { enjoyment: 10 } }, chosen(EARLIER));
    assert.equal(shownRemarks(after.state).rating, 10);
    assert.equal(after.state.opened.reference.shot, EARLIER);
});

test('a reference chosen while another row\'s read is on its way reads that row again, and it is opened', () => {
    // Shot A opened, Make reference tapped, then B tapped before the choice answers.
    const base = opened(withRecipe()).state;
    for (const [target, recipe] of [[GUESTS, OTHER], [shot('s-house-2', 12), RECIPE]]) {
        const asked = play(base, { type: 'open', shotId: target.id, recipe });
        const made = play(asked.state, { type: 'referenceChosen', recipeId: RECIPE.id, chosen: chosen(EARLIER) });
        const again = lastOpened(made.effects);
        assert.ok(again && again.shotId === target.id, `${target.id} is read again`);
        assert.equal(inGraph(made.state).reference.shot, EARLIER, 'the opened Shot follows the choice meanwhile');
        // The tap's first read is dropped; the second is taken.
        assert.deepEqual(openedAnswer(made.state, asked.effects, target, chosen(REF2)).effects, []);
        const found = openedAnswer(made.state, made.effects, target, recipe === RECIPE ? chosen(EARLIER) : chosen(GUEST_REF));
        assert.equal(inGraph(found.state).shot, target);
        assert.equal(found.state.opening, null);
    }
    // A row of the chosen recipe tapped from the latest is read again too: its read may hold the reference before.
    const fromLatest = play(withRecipe(), { type: 'open', shotId: EARLIER.id, recipe: RECIPE }, { type: 'referenceChosen', recipeId: RECIPE.id, chosen: chosen(LATEST) });
    assert.equal(did(fromLatest.effects, 'readOpened').length, 2);
    // One of another recipe is left to answer.
    const other = play(withRecipe(), { type: 'open', shotId: GUESTS.id, recipe: OTHER }, { type: 'referenceChosen', recipeId: RECIPE.id, chosen: chosen(LATEST) });
    assert.equal(did(other.effects, 'readOpened').length, 1);
});

test('a tap on the opened Shot\'s own row leaves its read on its way, and drops another tap\'s', () => {
    const base = opened(withRecipe()).state;
    // Back from another page: the read that redraws the cleared chart is on its way.
    const due = play(base, { type: 'inView' }, { type: 'timer', timer: 'refresh' });
    const tapped = play(due.state, { type: 'open', shotId: EARLIER.id, recipe: RECIPE });
    assert.deepEqual(tapped.effects, []);
    assert.equal(did(openedAnswer(tapped.state, due.effects, EARLIER, chosen(REF2)).effects, 'draw').length, 1, 'the read still draws');
    // A tap on another row still on its way is dropped, and the opened Shot read again in its place.
    const other = play(due.state, { type: 'open', shotId: GUESTS.id, recipe: OTHER }, { type: 'open', shotId: EARLIER.id, recipe: RECIPE });
    assert.equal(other.state.opening, null);
    const again = lastOpened(other.effects);
    assert.equal(again.shotId, EARLIER.id);
    assert.equal(did(openedAnswer(other.state, other.effects, EARLIER, chosen(REF2)).effects, 'draw').length, 1);
});

test('a push for a tapped Shot\'s recipe reads it again, and one for the opened Shot\'s is read on the tap\'s failure', () => {
    // Tapped from the latest: a push for the tapped Shot's recipe.
    const asked = play(withRecipe(), { type: 'open', shotId: GUESTS.id, recipe: OTHER });
    const pushed = play(asked.state, { type: 'referencePushed', recipeId: OTHER.id });
    assert.equal(lastOpened(pushed.effects).shotId, GUESTS.id);
    assert.deepEqual(openedAnswer(pushed.state, asked.effects, GUESTS, chosen(GUEST_REF)).effects, [], 'the read from before the push is dropped');
    assert.equal(inGraph(openedAnswer(pushed.state, pushed.effects, GUESTS, chosen(REF2)).state).reference.shot, REF2);
    // A push for the loaded recipe still reads the latest.
    assert.ok(lastRead(play(asked.state, { type: 'referencePushed', recipeId: RECIPE.id }).effects));
    // Opened: a push for its own recipe while another row's read is on its way, then that tap fails.
    const base = opened(withRecipe()).state;
    const other = play(base, { type: 'open', shotId: GUESTS.id, recipe: OTHER }, { type: 'referencePushed', recipeId: RECIPE.id });
    assert.equal(did(other.effects, 'readOpened').length, 1, 'only the tap is being read');
    const tap = lastOpened(other.effects);
    for (const failure of [{ type: 'openedUnread', seq: tap.seq, shotId: GUESTS.id }, { type: 'openedRead', seq: tap.seq, edits: tap.edits, shotId: GUESTS.id, shot: null, chosen: null }]) {
        const failed = play(other.state, failure);
        assert.ok(did(failed.effects, 'unopened').length, failure.type);
        assert.equal(lastOpened(failed.effects).shotId, EARLIER.id, `${failure.type}: the opened Shot is read again`);
        const moved = openedAnswer(failed.state, failed.effects, EARLIER, chosen(REF));
        assert.equal(inGraph(moved.state).reference.shot, REF, failure.type);
    }
});

test('a Shot reopened while an edit of it was being saved is read again once the edit has ended', () => {
    // A rated, B opened, A tapped again before A's save answers.
    const base = opened(withRecipe());
    const rating = play(base.state, { type: 'editStarted', shotId: EARLIER.id });
    const b = opened(rating.state, GUESTS, OTHER, chosen(GUEST_REF)).state;
    const asked = play(b, { type: 'open', shotId: EARLIER.id, recipe: RECIPE });
    const saved = play(asked.state, { type: 'edited', shotId: EARLIER.id, remarks: { rating: 10 } }, { type: 'editEnded', shotId: EARLIER.id });
    // A's read began before the save answered and finds the old rating.
    const stale = openedAnswer(saved.state, asked.effects, EARLIER, chosen(REF2));
    assert.ok(!did(stale.effects, 'draw').length, 'the older read is not drawn');
    assert.equal(stale.state.opening.id, EARLIER.id);
    const again = lastOpened(stale.effects);
    assert.ok(again && again.seq !== lastOpened(asked.effects).seq, 'it is read again');
    const fresh = openedAnswer(stale.state, stale.effects, { ...EARLIER, annotations: { enjoyment: 10 } }, chosen(REF2));
    assert.equal(inGraph(fresh.state).shot.id, EARLIER.id);
    assert.equal(shownRemarks(fresh.state).rating, 10);
});

test('a Shot tapped while an edit of its recipe\'s reference was being saved is read again once the edit has ended', () => {
    // REF2, House's reference, opened and rated; another House Shot tapped before the save answers.
    const base = opened(withRecipe(), REF2, RECIPE, chosen(REF2)).state;
    const rating = play(base, { type: 'editStarted', shotId: REF2.id });
    const asked = play(rating.state, { type: 'open', shotId: EARLIER.id, recipe: RECIPE });
    const saved = play(asked.state, { type: 'edited', shotId: REF2.id, remarks: { rating: 8 } }, { type: 'editEnded', shotId: REF2.id });
    const stale = openedAnswer(saved.state, asked.effects, EARLIER, chosen(REF2, { rating: 2 }));
    assert.ok(!did(stale.effects, 'draw').length, 'the older read is not drawn');
    const fresh = openedAnswer(stale.state, stale.effects, EARLIER, chosen(REF2, { rating: 8 }));
    assert.equal(inGraph(fresh.state).shot.id, EARLIER.id);
    assert.equal(inGraph(fresh.state).reference.rating, 8);
});
