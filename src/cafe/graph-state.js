// Which Shot is in the graph, which reference is behind it, and when both are
// read again (docs/cafe/DESIGN.md, "The latest Shot", "The reference with
// Decent Sync", "Rating and notes" and "The Shots list"). No browser global is
// touched.
//
// The page (`graph.js`) tells this module what happened, as an event, and
// `graphStep` answers with the next state and a list of things for the page to
// do: read the Shots, draw, start or stop a timer. The page does the reads, the
// timers and the drawing, and tells the module what each read found, with the
// `seq` and `edits` the read was asked with, so an answer that arrives late is
// known for what it is.
//
// The Shot in the graph is one of five:
// - with a recipe loaded, the recipe's latest Shot on this machine, read
//   through the Shot seam;
// - with none, "Last shot", the one Streamline's history module handed the
//   chart;
// - while a shot runs, the running shot, whose lines are the chart's own: from
//   the start of its Preheat, when the chart is emptied, though nothing is
//   drawn until the profile starts;
// - once it has ended and until Decaid has saved it, that shot still
//   (`settling`), its lines kept until the saved Shot is in the graph;
// - a Shot opened from the Shots list (`opened`), with its own recipe's
//   reference, until something sends the graph back to the latest. The
//   latest is kept meanwhile, so going back returns to the Shot that was there.
import { drawnShot, shotCurves, sameReference, isDrawnShot, isUnfinished } from './shot-model.js';
import { shotRemarks, sameRemarks } from './remarks.js';
import { shotSamples, shotNumbers } from './comparison.js';
import { shotStages } from './stage-names.js';

/** After a cue to look again, how long until the Shots are read: cues come in bursts. */
export const REFRESH_GAP_MS = 300;
/**
 * Once a shot ends, how long between looks for it among Decaid's Shots: at half
 * a second, then 2, 4, 7, 11 and 15 seconds after the end. Decaid saves a shot
 * once its last drops have been weighed, a few seconds after the pump stops.
 */
export const SETTLE_GAPS_MS = [500, 1500, 2000, 3000, 4000, 4000];
/** When Decaid must have saved a shot, if it ever will. */
export const SETTLE_LAST_MS = 15_000;
/**
 * How long until another Machine's Shot that can't be changed, because Decent
 * Sync's server could not be asked for it, is read again: 10 seconds, then
 * twice as long each time, to 5 minutes. The connection's coming back is told
 * to the page, but the plugin refuses Shots while its tablet catches up after
 * an outage, though the status already says the Machine is served, and then
 * nothing else would read it again.
 */
export function lockedRetryMs(tries) {
    return Math.min(300_000, 10_000 * 2 ** Math.max(0, tries - 1));
}

// The seam's answer for a recipe with no reference that none can be chosen for:
// what stands in where the reference could not be read, or is not this source's.
const NO_REFERENCE = { shot: null, canChange: false };

/**
 * The state before anything has happened. `live` is whether a shot is running
 * as the page starts.
 *
 * - `recipe`: the loaded recipe; null for none; undefined until DYE2 was read.
 * - `live`: a shot is running. `settling`: one has ended and Decaid does not
 *   have it yet. `settleStep`: how many looks for it have been asked for.
 *   `settleFrom`: the id of the Shot in the graph before it, undefined when none
 *   had been read.
 * - `latest`: the Shot in the graph, whole; null for none; undefined until read.
 * - `handed`: the Shot the history module last asked the chart to draw;
 *   undefined until it asks. `heldBack`: one of its requests was turned down
 *   during the running shot.
 * - `reference`: the seam's answer for the recipe's reference, `{ shot,
 *   canChange, … }`, with the Shot's curves, samples, numbers and stages; null
 *   before it was read.
 * - `drawDue`: a read was asked for that must end in a draw, whatever it finds.
 * - `remarks`: the rating and note of the Shot in the graph, `{ id, rating,
 *   note, of }`, where `of` is that Shot as `latest` holds it; null until its
 *   record is known.
 * - `opened`: the Shot opened from the Shots list, or null: `{ id, recipe,
 *   name, shot, unfinished, canChange, reference, remarks }`, where `recipe`
 *   is its own recipe's DYE2 record, or null for a Shot pulled with none or
 *   with a recipe this tablet holds no record of, which `name` then names;
 *   `shot` is the Shot whole; `canChange` is whether it can be rated, noted
 *   and made a reference now, which another Machine's Shot can't be while
 *   Decent Sync's server is out of reach; `reference` is that recipe's, as
 *   `reference` above; and `remarks` its rating and note, as `remarks` below.
 *   `opening`: a Shot asked to be opened whose read has not answered, `{ id,
 *   recipe, name }`, or null. `openSeq`: the reads of an opened Shot; only
 *   the newest's answer is taken.
 * - `edits`: counts each edit of a Shot as it starts and as it ends.
 *   `editedAt`: a Shot's id to that count at its last edit, so a read begun
 *   before it is known to be older than the edit.
 * - `seq`: the reads of the recipe's Shots; `lastSeq`: the reads of the tablet's
 *   newest record, for "Last shot". Only the newest read's answer is taken.
 * - `timers`: which of the page's timers are running: `refresh`, a read soon;
 *   `settle`, the next look for a shot that has ended (`'look'`) or, with no
 *   recipe, the end of the wait for the history module to draw it
 *   (`'noRecipe'`); `late`, the one look left after a recipe change stopped the
 *   others; `locked`, the next read of an opened Shot that can't be changed
 *   because Decent Sync's server could not be asked for it, `lockedTries`
 *   being how many there have been. `lockedAt`: the `openSeq` when it was
 *   last shown so; a read begun by then can't show it can be changed.
 */
export function initialGraphState({ live = false } = {}) {
    return {
        recipe: undefined,
        live: !!live,
        settling: false,
        settleStep: 0,
        settleFrom: null,
        latest: undefined,
        handed: undefined,
        heldBack: false,
        reference: null,
        drawDue: false,
        remarks: null,
        opened: null,
        opening: null,
        openSeq: 0,
        edits: 0,
        editedAt: new Map(),
        seq: 0,
        lastSeq: 0,
        timers: { refresh: false, settle: null, late: false, locked: false },
        lockedTries: 0,
        lockedAt: 0,
    };
}

/**
 * The rating and note of the Shot in the graph, or null where they are not
 * known, or are another Shot's.
 */
export function shownRemarks(state) {
    if (state.opened) return state.opened.remarks;
    return state.remarks && state.remarks.of === state.latest ? state.remarks : null;
}

/**
 * The id of the Shot the graph goes back to: the recipe's latest, or with no
 * recipe "Last shot" once its record is known; null where there is none or it
 * is not known.
 */
export function latestShotId(state) {
    if (state.recipe) return state.latest ? String(state.latest.id) : null;
    const remarks = state.remarks && state.remarks.of === state.latest ? state.remarks : null;
    return remarks && remarks.id != null ? String(remarks.id) : null;
}

/** The id of the Shot in the graph, or null: none while a shot runs or waits to be saved. */
export function shotInGraphId(state) {
    if (state.opened) return state.opened.id;
    if (state.live || state.settling) return null;
    return latestShotId(state);
}

/**
 * What the graph shows: `recipe`, the recipe the Shot in the graph is
 * compared as (its own recipe for an opened Shot, null for none; the loaded
 * recipe otherwise, undefined before DYE2 was read); `shot`; `reference`;
 * `remarks`; `live` and `settling`; and `opened`, null, or for an opened Shot
 * `{ loaded, unfinished, name, canChange }`: the loaded recipe, whether the
 * Shot is Unfinished, the name of a recipe this tablet has no record of, and
 * whether the Shot can be changed now.
 */
export function inGraph(state) {
    const { opened } = state;
    if (opened) {
        return {
            recipe: opened.recipe,
            shot: opened.shot,
            reference: opened.reference,
            remarks: opened.remarks,
            live: false,
            settling: false,
            opened: { loaded: state.recipe ?? null, unfinished: opened.unfinished, name: opened.name, canChange: opened.canChange },
        };
    }
    return { recipe: state.recipe, shot: state.latest, reference: state.reference, remarks: shownRemarks(state), live: state.live, settling: state.settling, opened: null };
}

/**
 * What is worked out once for a reference: its lines, its samples and numbers
 * for the cards, and its stages.
 */
export function referenceParts(shot) {
    if (!shot) return { curves: null, samples: null, numbers: null, stages: null };
    return {
        curves: shotCurves(shot.measurements),
        samples: shotSamples(shot.measurements),
        numbers: shotNumbers(shot),
        stages: shotStages(shot.measurements, shot.workflow),
    };
}

/**
 * The next state, and what the page is to do, for one event. The state passed
 * in is left as it is.
 *
 * Events:
 * - `{ type: 'recipe', recipe }`: the loaded recipe changed, or was read again;
 *   null when none is loaded.
 * - `{ type: 'shotStarted', profileStarted }`: the machine went into its
 *   `espresso` state, which a shot's Preheat is the start of, or was in it as
 *   the page started. `profileStarted` is whether the profile has started
 *   already, so the chart holds the running shot's lines.
 * - `{ type: 'shotEnded', poured }`: `poured` is whether the profile started,
 *   so the chart drew the shot.
 * - `{ type: 'inView' }`: the page came back into view.
 * - `{ type: 'chartAsks', measurements, workflow }`: Streamline's history
 *   module asks the chart to draw a finished Shot. The answer's `allow` says
 *   whether the chart may.
 * - `{ type: 'referencePushed', recipeId }`: the seam says a recipe's reference
 *   should be read again; null for whichever recipe is in the graph.
 * - `{ type: 'sourceMoved' }`: where references are kept changed.
 * - `{ type: 'timer', timer }`: one of the timers the module started ran out.
 * - `{ type: 'shotsRead', seq, edits, shot, chosen }`: a read of the recipe's
 *   latest Shot and its reference answered; `chosen` is null where the
 *   reference could not be read. `{ type: 'shotsUnread', seq }`: the latest
 *   Shot could not be read.
 * - `{ type: 'newestRead', seq, edits, record }`: a read of the tablet's newest
 *   Shot answered, for "Last shot".
 * - `{ type: 'referenceChosen', recipeId, chosen }`: Make reference answered
 *   with the reference as it now is.
 * - `{ type: 'editStarted', shotId }`, `{ type: 'editEnded', shotId }`: an edit
 *   of a Shot's rating or note started, or ended.
 * - `{ type: 'edited', shotId, remarks }`: what an edit, or a read after one,
 *   left of a Shot's rating or note: only the one the edit was of.
 * - `{ type: 'open', shotId, recipe, name }`: a row of the Shots list was
 *   tapped; `recipe` is the Shot's own recipe's DYE2 record, or null, and
 *   `name` the name of a recipe this tablet has no record of, or null.
 * - `{ type: 'backToLatest' }`: "Back to latest" was tapped.
 * - `{ type: 'openedRead', seq, edits, shotId, shot, canChange, chosen }`: a
 *   read of an opened Shot and its recipe's reference answered; `shot` is null
 *   where the Shot is gone, and `canChange` is the seam's word on whether it
 *   can be changed now. `{ type: 'openedUnread', seq, shotId, unreachable }`:
 *   it could not be read; `unreachable`, because Decent Sync's server can't
 *   be asked for it.
 * - `{ type: 'shotUnreachable', shotId }`: an edit of a Shot could not be
 *   confirmed either way, because Decent Sync's server can't be asked. The
 *   answer's `allow` says whether that Shot is in the graph, and so now shown
 *   as one that can't be changed.
 *
 * Things to do, each `{ do }`:
 * - `readShots` (`recipeId`, `seq`, `edits`): read the recipe's latest Shot and
 *   its reference, and answer with `shotsRead` or `shotsUnread`.
 * - `readNewest` (`seq`, `edits`): read the tablet's newest Shot, and answer
 *   with `newestRead`; a failure needs no answer.
 * - `readOpened` (`shotId`, `recipeId`, `seq`, `edits`): read a Shot whole by
 *   its id, and its recipe's reference where `recipeId` is not null, and
 *   answer with `openedRead` or `openedUnread`.
 * - `unopened`: say that the Shot tapped could not be read.
 * - `draw`: draw the chart from the state, and the legend.
 * - `clear`: empty the chart for a shot whose profile has not started yet.
 * - `overlay`: give the chart what it draws in place of its own lines.
 * - `paint`: write the legend and the row under the graph.
 * - `startTimer` (`timer`, `ms`), `stopTimer` (`timer`).
 */
export function graphStep(state, event) {
    const s = { ...state, timers: { ...state.timers } };
    const todo = [];
    const answer = handle(s, todo, event);
    return { state: s, effects: todo, allow: answer };
}

function handle(s, todo, event) {
    switch (event.type) {
        case 'recipe': return recipeChanged(s, todo, event.recipe);
        case 'shotStarted': return shotStarted(s, todo, event.profileStarted);
        case 'shotEnded': return shotEnded(s, todo, event.poured);
        case 'inView': return refreshSoon(s, todo);
        case 'chartAsks': return chartAsks(s, todo, event);
        case 'referencePushed': return referencePushed(s, todo, event.recipeId);
        case 'sourceMoved': return sourceMoved(s, todo);
        case 'timer': return timerRanOut(s, todo, event.timer);
        case 'shotsRead': return shotsRead(s, todo, event);
        case 'shotsUnread': return shotsUnread(s, todo, event);
        case 'newestRead': return newestRead(s, todo, event);
        case 'referenceChosen': return referenceChosen(s, todo, event);
        case 'editStarted':
        case 'editEnded': return markEdit(s, event.shotId);
        case 'edited': return edited(s, todo, event.shotId, event.remarks);
        case 'open': return open(s, todo, event.shotId, event.recipe, event.name);
        case 'shotUnreachable': return shotUnreachable(s, todo, event.shotId);
        case 'backToLatest': return backToLatest(s, todo);
        case 'openedRead': return openedRead(s, todo, event);
        case 'openedUnread': return openedUnread(s, todo, event);
        default: return undefined;
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function startTimer(s, todo, timer, ms, kind = true) {
    s.timers[timer] = kind;
    todo.push({ do: 'startTimer', timer, ms });
}

function stopTimer(s, todo, timer) {
    if (!s.timers[timer]) return;
    s.timers[timer] = timer === 'settle' ? null : false;
    todo.push({ do: 'stopTimer', timer });
}

function draw(s, todo) {
    s.drawDue = false;
    todo.push({ do: 'draw' });
}

const paint = todo => todo.push({ do: 'paint' });
const overlay = todo => todo.push({ do: 'overlay' });

// An edit of a Shot starts, or ends.
function markEdit(s, shotId) {
    s.edits += 1;
    s.editedAt = new Map(s.editedAt).set(shotId, s.edits);
}

// Did the page edit a Shot after a read that began at `then`?
const editedSince = (s, shotId, then) => (s.editedAt.get(shotId) ?? 0) > then;

// The rating and note a read found for the Shot in the graph, which `latest`
// holds by now. Where the page edited that Shot after the read began, the read
// is older than the edit, and what the edit answered stays.
function takeRemarks(s, record, editsThen) {
    if (!record || !s.latest) {
        s.remarks = null;
        return;
    }
    const edited = s.remarks && s.remarks.id === record.id && editedSince(s, record.id, editsThen);
    s.remarks = { ...(edited ? { rating: s.remarks.rating, note: s.remarks.note } : shotRemarks(record)), id: record.id, of: s.latest };
}

// ── Reading the Shots ────────────────────────────────────────────────────────

// Reads the recipe's latest Shot and its reference, and draws them. With
// `onlyIfChanged` the graph is drawn again only if either is another than the
// one drawn: the seam said the reference may have changed, and a push may
// repeat. A read that must end in a draw still does, when one like this
// overtakes it.
function refresh(s, todo, { onlyIfChanged = false } = {}) {
    if (s.timers.refresh || !onlyIfChanged) s.drawDue = true;
    stopTimer(s, todo, 'refresh');
    // A running shot owns the chart's lines: its end asks again. With no recipe
    // loaded the history module draws, and there is nothing to read but the
    // rating and note of the Shot it drew. While the page looks for a shot that
    // has just ended, this read is one more look: it takes the place of a look
    // still on its way, which may have read the reference before the change
    // that asked for this one.
    if (s.live || !s.recipe) {
        if (!s.live && s.recipe === null) readLast(s, todo);
        return;
    }
    readShots(s, todo);
}

function readShots(s, todo) {
    s.seq += 1;
    todo.push({ do: 'readShots', recipeId: s.recipe.id, seq: s.seq, edits: s.edits });
}

// A shot that started before anything was read for the loaded recipe reads the
// recipe's Shots, for the reference behind it: at its start, when a read on its
// way is dropped, and at DYE2's first answer, on a page opened during a shot or
// its Preheat. Its lines stay the chart's. A recipe loaded once the shot has
// started is another than the shot's, and is read at its end.
function readUnread(s, todo) {
    if (s.recipe && s.latest === undefined) readShots(s, todo);
}

function refreshSoon(s, todo) {
    if (s.timers.refresh || s.live) return;
    startTimer(s, todo, 'refresh', REFRESH_GAP_MS);
}

// Reads the Shots the graph shows again: an opened Shot and its recipe's
// reference, or the recipe's latest Shot and its reference. Either read ends in
// a draw, whatever it finds: the cue may be the page back from another, whose
// chart was cleared on the way.
function refreshShown(s, todo, options) {
    if (!s.opened) return refresh(s, todo, options);
    s.drawDue = true;
    stopTimer(s, todo, 'refresh');
    return readOpened(s, todo, s.opening || s.opened);
}

// Decaid can't be asked for the recipe's latest Shot.
function shotsUnread(s, todo, { seq }) {
    if (seq !== s.seq || s.live) return;
    if (s.settling) settleNext(s, todo);
    // The graph is drawn again from what was last read: the page may have come
    // back from another page with its chart cleared, and the legend must name
    // the Shot that is drawn. With nothing read yet for this recipe that is an
    // empty graph, never another recipe's Shot.
    else if (s.drawDue) draw(s, todo);
}

function shotsRead(s, todo, { seq, edits: editsThen, shot, chosen }) {
    if (seq !== s.seq) return;
    // Read while a shot runs (`readUnread`): the reference goes behind the
    // running shot's lines, and the latest is what its end draws or tells the
    // saved shot from. Nothing is drawn over the chart's own lines.
    if (s.live) {
        s.latest = shot;
        takeRemarks(s, shot, editsThen);
        const found = chosen || s.reference || NO_REFERENCE;
        s.reference = { ...found, ...referenceParts(found.shot) };
        overlay(todo);
        paint(todo);
        return;
    }
    // A shot has just ended and Decaid does not have it yet: the graph keeps
    // its live lines, and the next look is a little later.
    if (s.settling && s.settleStep < SETTLE_GAPS_MS.length) {
        const id = shot ? shot.id : null;
        // Nothing had been read for this recipe when the shot started, so this
        // look's answer is the Shot to tell the finished one from.
        if (s.settleFrom === undefined) s.settleFrom = id;
        if (id === s.settleFrom) {
            settleNext(s, todo);
            return;
        }
    }
    const { reference } = s;
    // A reference that could not be read leaves the one read for this recipe
    // before, which is this source's: a change of source dropped any other.
    // With none read, there is none, and none can be chosen.
    let found = chosen || reference || NO_REFERENCE;
    // The reference's rating and note, where the page edited that Shot after
    // this read began: the read is older than the edit, as for the latest Shot.
    if (found !== reference && found.shot && reference && reference.shot && reference.shot.id === found.shot.id && editedSince(s, found.shot.id, editsThen)) {
        found = { ...found, rating: reference.rating, note: reference.note };
    }
    const sameShot = s.latest !== undefined && (shot ? shot.id : null) === (s.latest ? s.latest.id : null);
    if (!s.drawDue && !s.settling && sameShot && sameReference(reference, found)) {
        // The same two Shots: nothing is drawn again. A rating or a note may
        // be another all the same, as the reference's is when it was changed
        // elsewhere, and then only the legend's rows are written again.
        const before = shownRemarks(s);
        takeRemarks(s, shot, editsThen);
        const rows = !sameRemarks(before, shownRemarks(s)) || !sameRemarks(reference, found);
        if (!sameRemarks(reference, found)) s.reference = { ...reference, rating: found.rating, note: found.note };
        if (rows) paint(todo);
        return;
    }
    s.latest = shot;
    takeRemarks(s, shot, editsThen);
    // Kept with no Shot too: the seam's answer still says whether one can be chosen.
    if (found !== reference) s.reference = { ...found, ...referenceParts(found.shot) };
    s.settling = false;
    stopTimer(s, todo, 'settle');
    draw(s, todo);
}

// With no recipe loaded the graph's Shot is the one Streamline's history
// module handed the chart: its measurements and its Workflow, and no record.
// So the page asks the seam for the tablet's newest Shot, and takes its id,
// rating and note only if it is the Shot drawn. Until then, and where it is
// another, the row has no stars: they never act on a Shot that is not the one
// in the graph. The module hands the same Shot over again on the way back from
// another page, and what was read for it stands until this read answers.
function readLast(s, todo) {
    if (s.recipe !== null || !s.latest) return;
    const { remarks, latest } = s;
    if (remarks && remarks.of !== latest && remarks.of.id == null && remarks.of.timestamp === latest.timestamp) s.remarks = { ...remarks, of: latest };
    s.lastSeq += 1;
    todo.push({ do: 'readNewest', seq: s.lastSeq, edits: s.edits });
}

function newestRead(s, todo, { seq, edits: editsThen, record }) {
    if (seq !== s.lastSeq || s.recipe !== null) return;
    const before = shownRemarks(s);
    takeRemarks(s, isDrawnShot(record, s.latest) ? record : null, editsThen);
    const now = shownRemarks(s);
    if (!!before !== !!now || !sameRemarks(before, now)) paint(todo);
}

// The seam says a recipe's reference should be read again: with null, whichever
// recipe is in the graph.
function referencePushed(s, todo, recipeId) {
    // With null the server may have come into reach or gone out of it, which
    // changes whether an opened Shot can be changed, with a recipe or without.
    const follows = target => !!target && (recipeId == null || (!!target.recipe && String(recipeId) === String(target.recipe.id)));
    // A Shot tapped and still being read follows its own recipe's reference: its
    // read may have read the reference before the push. An opened Shot follows
    // its own too; while a tap is on its way, a push for it is read on the tap's
    // failure, as the opened Shot is read again then.
    if (follows(s.opening)) readOpened(s, todo, s.opening);
    else if (!s.opening && follows(s.opened)) readOpened(s, todo, s.opened);
    // The loaded recipe's is read again on the way back to the latest.
    if (s.opened) return;
    if (!s.recipe) return;
    if (recipeId != null && String(recipeId) !== String(s.recipe.id)) return;
    refresh(s, todo, { onlyIfChanged: true });
}

// Where references are kept changed. The reference in the graph is then the
// other source's, and is dropped at once, whatever the page is doing: the
// choice kept on the tablet is never left on a Machine Decent Sync has come to
// serve, whichever read fails or is overtaken next. The read that follows is a
// full one. It ends in a draw, and it takes the place of a read still on its
// way from the source before, as a look for a shot that has just ended may be.
// While a shot runs it reads the other source's reference for behind the
// running shot, and draws nothing over the chart's own lines, as `readUnread`.
function sourceMoved(s, todo) {
    // An opened Shot gives way to the latest: its reference was the source
    // before's too.
    if (closeOpened(s, todo)) {
        if (s.recipe === null) s.latest = s.handed;
        draw(s, todo);
    }
    if (!s.recipe) return;
    if (s.reference) {
        s.reference = { ...NO_REFERENCE, ...referenceParts(null) };
        overlay(todo);
        paint(todo);
    }
    if (s.live) readShots(s, todo);
    else refresh(s, todo);
}

// The next look for a shot that has ended. After the last, what Decaid holds is
// taken as it is: the shot was Unfinished, pulled with another recipe, or never
// saved, and the graph goes back to the Shot before it.
function settleNext(s, todo) {
    stopTimer(s, todo, 'settle');
    if (s.settleStep >= SETTLE_GAPS_MS.length) {
        // The last look failed too. The graph goes back to the Shot the legend
        // names, so Make reference never acts on a Shot that is not the one drawn.
        s.settling = false;
        draw(s, todo);
        return;
    }
    startTimer(s, todo, 'settle', SETTLE_GAPS_MS[s.settleStep], 'look');
    s.settleStep += 1;
}

function timerRanOut(s, todo, timer) {
    if (timer === 'settle') {
        const kind = s.timers.settle;
        s.timers.settle = null;
        if (kind === 'noRecipe') return settledWithoutRecipe(s, todo);
        return refresh(s, todo);
    }
    s.timers[timer] = false;
    if (timer === 'refresh') refreshShown(s, todo);
    // A tap on its way is left to answer: where it fails, the Shot opened is
    // read again then.
    if (timer === 'locked' && s.opened && !s.opened.canChange && !s.opening && !s.live) readOpened(s, todo, s.opened);
    // The one look left for a shot pulled before a recipe change: it is a look
    // for the latest, whatever the graph shows meanwhile.
    if (timer === 'late') refresh(s, todo);
    return undefined;
}

// ── The recipe ───────────────────────────────────────────────────────────────

function recipeChanged(s, todo, next) {
    const before = s.recipe;
    s.recipe = next || null;
    if (before !== undefined && (before ? before.id : null) === (s.recipe ? s.recipe.id : null)) {
        paint(todo); // the same recipe, read again: its profile may have changed
        return;
    }
    s.seq += 1; // a read for the recipe before is no longer wanted
    s.reference = null;
    closeOpened(s, todo);
    stopTimer(s, todo, 'settle');
    // A shot had just ended and Decaid may not have it yet. The graph is this
    // recipe's now, so the looks for that shot stop, bar one once Decaid must
    // have it: the recipe it was pulled with may be loaded again by then.
    if (s.settling) {
        stopTimer(s, todo, 'late');
        startTimer(s, todo, 'late', SETTLE_LAST_MS);
    }
    if (!s.recipe) {
        // No recipe: the graph goes back to the Shot the history module last
        // asked to draw, the tablet's newest, and shows each it asks for after.
        // A running shot keeps its lines until it ends.
        s.latest = s.handed;
        s.settling = false;
        readLast(s, todo);
        overlay(todo);
        if (s.live) paint(todo);
        else draw(s, todo);
        return;
    }
    s.latest = undefined;
    s.settling = false;
    overlay(todo);
    paint(todo);
    refresh(s, todo);
    if (s.live && before === undefined) readUnread(s, todo);
}

// ── The history module's requests ────────────────────────────────────────────

// Streamline's history module asks to draw a finished Shot: the tablet's
// newest, at start-up, on the way back from another page and once a shot has
// been saved. With a recipe loaded the graph shows the recipe's latest instead,
// so the request is turned down and taken as a cue to look again. With none it
// is let through, and the legend names the Shot drawn. Until DYE2 has said which
// recipe is loaded it is let through too, so the graph is not empty meanwhile.
// Each request is kept, so the graph can go back to it when a recipe is unloaded.
// While a shot runs every request is turned down: the module may still be
// waiting for the shot before to be saved, and drawing it would reset the
// running shot's lines. It asks again once the running shot has been saved.
function chartAsks(s, todo, { measurements, workflow }) {
    s.handed = drawnShot(measurements, workflow);
    if (s.live) {
        s.heldBack = true;
        return false;
    }
    // An opened Shot keeps the graph. With no recipe the Shot handed over is
    // still the one the graph goes back to. The request is a cue to read the
    // opened Shot again, as the page coming back into view is.
    if (s.opened) {
        if (s.recipe === null) {
            s.latest = s.handed;
            s.settling = false;
            readLast(s, todo);
        }
        refreshSoon(s, todo);
        return false;
    }
    if (s.recipe === undefined) {
        s.latest = s.handed; // no row names it until the recipe is known
        return true;
    }
    if (s.recipe === null) {
        s.latest = s.handed;
        s.settling = false;
        readLast(s, todo);
        paint(todo);
        return true;
    }
    refreshSoon(s, todo);
    return false;
}

// ── During a shot ────────────────────────────────────────────────────────────

// The graph goes live as the machine goes into its `espresso` state, at the
// start of the shot's Preheat: the Shot in the graph, its stage lines and their
// names leave it, and the empty chart waits for the profile to start, behind it
// the reference in Reference. Nothing of the Preheat is drawn: the chart's own
// lines start at the profile, at time zero. A chart that holds the running
// shot's lines already, as on a page opened while the profile runs, is not
// emptied.
function shotStarted(s, todo, profileStarted = false) {
    closeOpened(s, todo);
    s.live = true;
    s.heldBack = false;
    s.settling = false;
    s.seq += 1;
    stopTimer(s, todo, 'settle');
    stopTimer(s, todo, 'late');
    stopTimer(s, todo, 'refresh');
    overlay(todo);
    if (!profileStarted) todo.push({ do: 'clear' });
    paint(todo);
    readUnread(s, todo);
}

function shotEnded(s, todo, poured) {
    if (!s.live) return;
    s.live = false;
    // With no recipe, a request turned down during the shot is drawn now, if it
    // is not the Shot in the graph already: the module counts it as drawn and
    // will not ask again. It is the shot just saved, when the end reached the
    // page late, or the newest saved before it, which the module would show
    // too; a shot saved later is still drawn then.
    if (!s.recipe && s.heldBack && s.handed?.timestamp !== s.latest?.timestamp) {
        s.heldBack = false;
        s.latest = s.handed;
        s.settling = false;
        readLast(s, todo);
        overlay(todo);
        draw(s, todo);
        return;
    }
    // A shot stopped before its profile started drew nothing, and if Decaid
    // saves it at all it is Unfinished: the graph puts back the Shot it held
    // before, which the shot's start cleared from the chart, and reads again
    // only in case that Shot is another by now. Any other is looked for until
    // Decaid has it.
    if (poured) {
        s.settling = true;
        // With no recipe the history module draws the shot once Decaid has saved
        // it, and the legend then names it. Until then the row names no time.
        // A run Decaid never saves is never drawn, so if nothing has been drawn
        // by the last look a recipe's shot would get, the graph goes back to
        // the Shot before, as it does with a recipe.
        if (!s.recipe) {
            s.heldBack = false;
            stopTimer(s, todo, 'settle');
            startTimer(s, todo, 'settle', SETTLE_LAST_MS, 'noRecipe');
            overlay(todo);
            paint(todo);
            return;
        }
        s.settleStep = 0;
        s.settleFrom = s.latest === undefined ? undefined : s.latest ? s.latest.id : null;
        overlay(todo);
        paint(todo);
        settleNext(s, todo);
        return;
    }
    overlay(todo);
    draw(s, todo);
    refresh(s, todo, { onlyIfChanged: true });
}

// With no recipe, 15 seconds after a shot ended: the history module has drawn
// nothing, so Decaid never saved it, and the graph goes back to the Shot before.
function settledWithoutRecipe(s, todo) {
    if (!s.settling || s.live || s.recipe) return;
    s.settling = false;
    s.latest = s.handed;
    readLast(s, todo);
    draw(s, todo);
}

// ── Make reference ───────────────────────────────────────────────────────────

// The reference as a choice left it: the seam's answer to the choice is the
// reference as it now is, and the graph follows it without another read. The
// page may show another recipe by now. A shot that has started keeps the lines
// it started with, and its end reads the reference again.
function referenceChosen(s, todo, { recipeId, chosen }) {
    if (!chosen || s.live) return;
    const reference = { ...chosen, ...referenceParts(chosen.shot) };
    const { opened } = s;
    const forOpened = !!opened && !!opened.recipe && String(opened.recipe.id) === String(recipeId);
    // The loaded recipe's too, where the opened Shot is one of its own: the
    // graph goes back to it with this reference.
    const forLoaded = !!s.recipe && String(s.recipe.id) === String(recipeId) && !s.settling;
    if (forOpened) s.opened = { ...opened, reference };
    // A read begun before the choice would put the reference before it back, so
    // the Shot it was of is read again: the opened Shot, whose re-read may be on
    // its way, or a Shot tapped meanwhile, which is read in its place.
    const { opening } = s;
    const tappedOfIt = !!opening && !!opening.recipe && String(opening.recipe.id) === String(recipeId);
    if (forOpened || tappedOfIt) readOpened(s, todo, opening || s.opened);
    if (forLoaded) {
        s.seq += 1;
        s.reference = reference;
    }
    if (forOpened || (forLoaded && !opened)) draw(s, todo);
}

// ── Rating and notes ─────────────────────────────────────────────────────────

// What an edit, or a read after one, left of a Shot's rating or its note: only
// the one the edit was of, since an answer also carries the other as it stood
// when the edit was made, which a later edit of that one may have changed
// since. The Shot is named by its id: the graph may show another by now, and
// then nothing on screen changes. When it is the reference too, that row
// follows.
function edited(s, todo, shotId, now) {
    if (s.remarks && s.remarks.id === shotId) s.remarks = { ...s.remarks, ...now };
    if (s.reference && s.reference.shot && s.reference.shot.id === shotId) s.reference = { ...s.reference, ...now };
    const { opened } = s;
    if (opened) {
        const remarks = opened.remarks.id === shotId ? { ...opened.remarks, ...now } : opened.remarks;
        const { reference } = opened;
        const ofReference = reference.shot && reference.shot.id === shotId;
        if (remarks !== opened.remarks || ofReference) s.opened = { ...opened, remarks, reference: ofReference ? { ...reference, ...now } : reference };
    }
    paint(todo);
}

// ── A Shot opened from the list ──────────────────────────────────────────────

// Ends an opened Shot, and any open still on its way. Answers whether a Shot
// was in the graph.
function closeOpened(s, todo) {
    const was = !!s.opened;
    s.lockedTries = 0;
    stopTimer(s, todo, 'locked');
    s.opened = null;
    s.opening = null;
    s.openSeq += 1;
    return was;
}

function readOpened(s, todo, { id, recipe }) {
    s.openSeq += 1;
    todo.push({ do: 'readOpened', shotId: id, recipeId: recipe ? String(recipe.id) : null, seq: s.openSeq, edits: s.edits });
}

// A row of the list was tapped. The graph keeps what it shows until the Shot
// has been read. The latest's own row goes back to the latest. While a shot
// runs nothing opens: the list does not either.
function open(s, todo, shotId, recipe, name = null) {
    if (s.live || shotId == null) return;
    const id = String(shotId);
    if (id === latestShotId(s)) {
        backToLatest(s, todo);
        return;
    }
    if (s.opened && s.opened.id === id) {
        // A tap on another row still on its way is dropped. A read of this Shot
        // on its way is left to answer: it may be the one that draws it again.
        if (!s.opening) return;
        s.opening = null;
        readOpened(s, todo, s.opened);
        return;
    }
    s.opening = { id, recipe: recipe || null, name: recipe ? null : name || null };
    readOpened(s, todo, s.opening);
}

// An edit of a Shot could not be confirmed either way: Decent Sync's server
// can't be asked. Where that Shot is the one opened, it is shown as one that
// can't be changed, with the line that says why, until a read finds the
// server back. Answers whether it is.
function shotUnreachable(s, todo, shotId) {
    if (!s.opened || s.opened.id !== String(shotId)) return false;
    if (s.opened.canChange) {
        s.opened = { ...s.opened, canChange: false };
        paint(todo);
    }
    readLockedLater(s, todo);
    return true;
}

// The opened Shot can't be changed because the server could not be asked for
// it: it is read again later, until a read finds the server back.
function readLockedLater(s, todo) {
    s.lockedAt = s.openSeq;
    if (s.timers.locked) return;
    s.lockedTries += 1;
    startTimer(s, todo, 'locked', lockedRetryMs(s.lockedTries));
}

// "Back to latest": the latest is drawn as it was kept, then read again, and
// drawn again only if it or its reference is another by now. With no recipe it
// is the Shot the history module last handed the chart.
function backToLatest(s, todo) {
    if (!closeOpened(s, todo)) return;
    if (s.recipe === null) {
        s.latest = s.handed;
        readLast(s, todo);
    }
    overlay(todo);
    draw(s, todo);
    if (s.recipe) refresh(s, todo, { onlyIfChanged: true });
}

// The rating and note a read found for an opened Shot. Where the page edited
// that Shot after the read began, the read is older than the edit, and what
// the edit answered stays.
function openedRemarks(s, before, shot, editsThen) {
    const keep = before && before.remarks.id === String(shot.id) && editedSince(s, before.remarks.id, editsThen);
    return { ...(keep ? { rating: before.remarks.rating, note: before.remarks.note } : shotRemarks(shot)), id: String(shot.id), of: shot };
}

function openedRead(s, todo, { seq, edits: editsThen, shotId, shot, canChange: can, chosen }) {
    if (seq !== s.openSeq || s.live) return;
    const target = s.opening || s.opened;
    if (!target || target.id !== String(shotId)) return;
    const before = s.opened && s.opened.id === target.id ? s.opened : null;
    s.opening = null;
    if (!shot) {
        // Gone from the tablet. One tapped says so; one in the graph gives way
        // to the latest.
        if (!before) {
            todo.push({ do: 'unopened' });
            readOpenedAgain(s, todo);
            return;
        }
        backToLatest(s, todo);
        return;
    }
    const { recipe } = target;
    // A read begun before the Shot was last shown as one that can't be
    // changed, as before an edit found the server out of reach, does not
    // undo that: only a read begun after it does.
    const canChange = can !== false && !(before && !before.canChange && seq <= s.lockedAt);
    if (canChange) {
        s.lockedTries = 0;
        stopTimer(s, todo, 'locked');
    }
    // A reference that could not be read leaves the one read before for this
    // Shot. A Shot with no recipe has none, and none can be chosen.
    const kept = before ? before.reference : null;
    let found = recipe ? chosen || kept || NO_REFERENCE : NO_REFERENCE;
    // A Shot not in the graph when an edit of it, or of its reference, ended was
    // not told the edit's answer, so a read begun before that is older than
    // what was saved: it is read again.
    if (!before && (editedSince(s, target.id, editsThen) || (found.shot && editedSince(s, found.shot.id, editsThen)))) {
        s.opening = target;
        readOpened(s, todo, target);
        return;
    }
    if (found !== kept && found.shot && kept && kept.shot && kept.shot.id === found.shot.id && editedSince(s, found.shot.id, editsThen)) {
        found = { ...found, rating: kept.rating, note: kept.note };
    }
    const remarks = openedRemarks(s, before, shot, editsThen);
    if (before && !s.drawDue && sameReference(kept, found)) {
        // The same two Shots: only a rating or a note can have changed, or
        // whether the Shot can be changed, as when the server is back.
        const rows = !sameRemarks(before.remarks, remarks) || !sameRemarks(kept, found) || before.canChange !== canChange;
        s.opened = { ...before, canChange, remarks: { ...remarks, of: before.shot }, reference: sameRemarks(kept, found) ? kept : { ...kept, rating: found.rating, note: found.note } };
        if (rows) paint(todo);
        return;
    }
    s.opened = {
        id: target.id,
        recipe,
        name: target.name || null,
        shot,
        unfinished: isUnfinished(shot),
        canChange,
        reference: found === kept ? kept : { ...found, ...referenceParts(found.shot) },
        remarks,
    };
    // A finished shot still waiting to be saved loses its live lines to this
    // Shot: the looks for it stop, and the history module's request once it
    // is saved, or the way back to the latest, reads it.
    if (s.settling) {
        s.settling = false;
        stopTimer(s, todo, 'settle');
    }
    overlay(todo);
    draw(s, todo);
}

function openedUnread(s, todo, { seq, shotId, unreachable = false }) {
    if (seq !== s.openSeq || s.live) return;
    // A Shot tapped that could not be read leaves the graph as it was, and
    // says so. One already in the graph stays, as read before.
    if (s.opening && s.opening.id === String(shotId)) {
        s.opening = null;
        todo.push({ do: 'unopened' });
        readOpenedAgain(s, todo);
        return;
    }
    // The Shot in the graph could not be read again. Where that is because
    // Decent Sync's server can't be asked for it, it is another Machine's, and
    // can't be changed until the server is back. Where that read was to end
    // in a draw, it is drawn as read before, since the chart may have been
    // cleared meanwhile.
    // One already shown so is read again later whatever failed this time, so
    // a passing failure of Decaid's does not leave it so.
    if (s.opened && s.opened.id === String(shotId) && (unreachable || !s.opened.canChange)) {
        if (s.opened.canChange) {
            s.opened = { ...s.opened, canChange: false };
            if (!s.drawDue) paint(todo);
        }
        readLockedLater(s, todo);
    }
    if (s.drawDue && s.opened) draw(s, todo);
}

// A Shot tapped while another was opened could not be read, or has gone. The
// one opened is read again: a read of it, or a push for its recipe, may have
// been passed over for the tap's, and the chart may have been cleared since.
function readOpenedAgain(s, todo) {
    if (s.opened) readOpened(s, todo, s.opened);
}
