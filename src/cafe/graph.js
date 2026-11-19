// The graph's Shots, its legend and the row of numbers under it: the loaded
// recipe's latest Shot, its reference behind it, the Reference | Targets toggle,
// Make reference, the Shot's stars and note, the comparison row and the stage
// names, and a Shot opened from the Shots list in the latest's place
// (docs/cafe/DESIGN.md, "Shots and the reference", "Rating and notes" and "The
// Shots list").
//
// Streamline's chart still draws everything. Which finished Shot it draws, and
// when the Shots are read again, is decided in `graph-state.js`, which touches
// no browser global: this module tells it what happened, does what it answers
// (the reads through the Shot seam, the timers, the drawing) and draws through
// the hooks the fork adds to chart.js.
import { setChartOverlay, setShotChooser, setLiveLineLabels, plotHistoricalShot, clearChart } from '../modules/chart.js';
import { getCurrentShot } from '../modules/shotData.js';
import { getScaleReading, currentMachineState } from '../modules/api.js';
import { getTempUnit } from '../modules/units.js';
import { showToast } from '../modules/ui.js';
import { isSubPage } from '../modules/router.js';
import { logger } from '../modules/logger.js';
import { latestShot, referenceShot, makeReference, watchReference, newestShot, editShot, shotById } from './shot-seam.js';
import { readCafe, writeCafe, VIEW_KEY } from './cafe-store.js';
import { graphModel, shotCredit, whenText, untilNextDay, viewFrom } from './shot-model.js';
import { graphStep, initialGraphState, shownRemarks, inGraph, shotInGraphId } from './graph-state.js';
import { starFills, ratingForTap, ratingOf, ratingText, noteToSave, editedRemarks } from './remarks.js';
import { editNote, readNote } from './note-dialog.js';
import { referenceOverlay, referenceColor, liveAxis, overlayAxis } from './reference-overlay.js';
import { recipeName } from './strip-model.js';
import { cafeText, cafeDateLocale, setText } from './text.js';
import { shotNumbers, restCards, liveCards, liveFrame } from './comparison.js';
import { stageShapes, withStageNames, STAGE_NAME_FONT } from './stage-names.js';
import { paintRow } from './compare-row.js';

// Which Shot is in the graph, its reference, its rating and note, and whether a
// shot is running: see `initialGraphState`. Changed only by `dispatch`.
let state = initialGraphState();
let view = 'reference';
let drawing = null;     // the measurements this module is handing the chart itself
let overlayFor = null;  // what the chart was last drawn with: the view, the reference's lines and its stages
let frame = null;       // what the running shot last read, for the live cards; kept until the finished Shot is in the graph
let numbers;            // the numbers of the Shot in the graph, worked out once for each Shot
let numbersOf;          // the Shot they were worked out for
let chartWidth = 0;     // the main chart's width in pixels, kept so a live frame measures nothing
let liveFailed = false; // the live cards threw once: said once, not on every frame
let busy = false;       // a reference is being chosen
let rating = false;     // a rating is on its way
const timers = {};      // the timers `graph-state.js` asked for, by name
let dayTimer = null;    // the next local midnight, when the legend's "Today" may be yesterday
let listener = {};      // what the Shots list is told: `edited(shotId, remarks)`, `chosen(recipeId, shotId)`, `sourceMoved()`

const el = id => document.getElementById(id);
const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';

// ── Telling the state what happened ─────────────────────────────────────────

// Hands an event to `graph-state.js`, keeps the state it answers, and does
// what it says. Answers whether the chart may draw, for the history module's
// requests.
function dispatch(event) {
    const step = graphStep(state, event);
    state = step.state;
    for (const effect of step.effects) perform(effect);
    return step.allow;
}

function perform(effect) {
    switch (effect.do) {
        case 'readShots': readShots(effect); break;
        case 'readNewest': readNewest(effect); break;
        case 'readOpened': readOpened(effect); break;
        case 'unopened': showToast(cafeText('The shot could not be read'), 4000, 'error'); break;
        case 'draw': draw(); break;
        case 'clear': if (!isSubPage()) clearChart(); break;
        case 'overlay': applyOverlay(); break;
        case 'paint': paint(); break;
        case 'startTimer':
            clearTimeout(timers[effect.timer]);
            timers[effect.timer] = setTimeout(() => {
                timers[effect.timer] = null;
                dispatch({ type: 'timer', timer: effect.timer });
            }, effect.ms);
            break;
        case 'stopTimer':
            clearTimeout(timers[effect.timer]);
            timers[effect.timer] = null;
            break;
        default: break;
    }
}

// Reads the recipe's latest Shot and its reference. The reference may come
// from Decent Sync, which can fail while Decaid answers: that must not cost the
// graph its latest Shot.
async function readShots({ recipeId, seq, edits }) {
    let shot;
    let chosen;
    try {
        [shot, chosen] = await Promise.all([latestShot(recipeId), referenceShot(recipeId).catch(error => {
            logger.warn('Cafe: could not read the reference', error);
            return null;
        })]);
    } catch (error) {
        logger.warn('Cafe: could not read the Shots for the graph', error);
        dispatch({ type: 'shotsUnread', seq });
        return;
    }
    dispatch({ type: 'shotsRead', seq, edits, shot, chosen });
}

// Reads the tablet's newest Shot, for the rating and note of "Last shot".
async function readNewest({ seq, edits }) {
    let record;
    try {
        record = await newestShot();
    } catch (error) {
        logger.warn('Cafe: could not read the last Shot\'s rating and note', error);
        return;
    }
    dispatch({ type: 'newestRead', seq, edits, record });
}

// Reads a Shot opened from the list, whole, and its recipe's reference. As for
// the latest, a reference that can't be read must not cost the graph the Shot.
// The seam says whether the Shot can be changed now, and where it can't be
// read, whether that is because Decent Sync's server can't be asked for it.
async function readOpened({ shotId, recipeId, seq, edits }) {
    let found;
    let chosen = null;
    try {
        [found, chosen] = await Promise.all([shotById(shotId), recipeId === null ? null : referenceShot(recipeId).catch(error => {
            logger.warn('Cafe: could not read the opened Shot\'s reference', error);
            return null;
        })]);
    } catch (error) {
        logger.warn('Cafe: could not read the opened Shot', error);
        dispatch({ type: 'openedUnread', seq, shotId, unreachable: error.unreachable === true });
        return;
    }
    dispatch({ type: 'openedRead', seq, edits, shotId, shot: found ? found.shot : null, canChange: !found || found.canChange !== false, chosen });
}

// ── What the chart draws ─────────────────────────────────────────────────────

function model() {
    const { recipe, live, settling, shot, reference, remarks, opened } = inGraph(state);
    return graphModel({ recipe, view, live, settling, shot, reference, remarks, opened });
}

// A stage name's width in pixels. A profile has a handful of steps, and each
// name is measured once.
const nameWidths = new Map();
let nameMeter = null;
function nameWidth(name) {
    if (!nameWidths.has(name)) {
        if (!nameMeter) nameMeter = document.createElement('canvas').getContext('2d');
        if (!nameMeter) return Infinity;
        nameMeter.font = STAGE_NAME_FONT;
        nameWidths.set(name, Math.ceil(nameMeter.measureText(name).width));
    }
    return nameWidths.get(name);
}

// What the chart draws in place of its own lines and layout, on each draw. In
// Targets the lines are Streamline's own. In Reference the targets are hidden
// and the reference's three lines follow the Shot's, empty when none is drawn.
// On the main chart, in both views, each stage line carries its step's name
// where there is room; with no Shot for the recipe yet the stages are the
// reference's. A live draw of the main chart is also when the live cards are
// written, so they are repainted exactly as often as the chart is.
function overlay(traces, layout, mode, chart) {
    const { curves, stages } = overlayFor;
    // Through a shot's Preheat the chart is drawn as at rest, empty, and the
    // time axis is the live one already, starting at zero in both views, so the
    // profile's start moves nothing. On the main graph that live axis is the
    // one the shot will have once it is over (`overlayAxis`).
    const axis = overlayAxis(state.live, mode, chart);
    let drawn = view === 'reference' ? referenceOverlay(traces, layout, axis, { curves, dark: isDark() }) : { traces, layout };
    if (state.live) drawn = { traces: drawn.traces, layout: liveAxis(traces, drawn.layout) };
    if (chart !== 'main') return drawn;
    let shown = drawn.layout;
    if (stages && !(shown.shapes && shown.shapes.length)) shown = { ...shown, shapes: stageShapes(stages, isDark()) };
    const margin = shown.margin || {};
    drawn = { traces: drawn.traces, layout: withStageNames(shown, { plotWidth: chartWidth - (margin.l ?? 50) - (margin.r ?? 50), measure: nameWidth }) };
    // While a finished shot waits for Decaid to save it the chart still holds
    // its lines: a draw then, as on the way back from the full-screen chart,
    // brings the cards up to the shot's last frame.
    if ((mode === 'live' && state.live) || inGraph(state).settling) readLiveFrame(traces, layout);
    return drawn;
}

// The running shot's numbers, from the lines the chart is about to draw. A
// failure here must never cost the chart its draw.
function readLiveFrame(traces, layout) {
    try {
        // The scale's weight is no line of the chart's. During the shot it is
        // read as the weight in the title band is. Once the shot has ended the
        // scale may read a lifted cup, so the weight is the shot's own last; and
        // once Streamline's history module has cleared that, as it does when
        // Decaid has saved the shot, the weight the card already shows.
        const weights = state.live ? null : getCurrentShot().weights;
        const ended = (weights && weights.length ? weights[weights.length - 1] : null) ?? (frame ? frame.weight : null);
        const weight = state.live ? getScaleReading().weight : ended;
        frame = liveFrame(traces, layout.shapes, weight);
        paintCards();
    } catch (error) {
        if (!liveFailed) logger.warn('Cafe: could not write the live cards', error);
        liveFailed = true;
    }
}

function applyOverlay() {
    const shown = model();
    const { reference, shot: latest } = inGraph(state);
    const curves = view === 'reference' && shown.lines ? reference.curves : null;
    // With no Shot for the recipe yet the reference is drawn alone, and the
    // stages named are its own.
    const stages = curves && shown.line && latest === null ? reference.stages : null;
    if (overlayFor && overlayFor.view === view && overlayFor.curves === curves && overlayFor.stages === stages) return;
    overlayFor = { view, curves, stages };
    setChartOverlay(overlay);
}

// Streamline's history module asks to draw a finished Shot. Whether the chart
// may is `graph-state.js`'s answer; a draw this module makes itself is always
// let through.
function chooseShot(measurements, workflow) {
    if (measurements === drawing) return true;
    return dispatch({ type: 'chartAsks', measurements, workflow });
}

function draw() {
    applyOverlay();
    // The chart draws into whichever page is showing: never over another page's.
    if (!isSubPage()) {
        const { shot: latest } = inGraph(state);
        if (latest) {
            drawing = latest.measurements;
            try { plotHistoricalShot(latest.measurements, latest.workflow); } finally { drawing = null; }
        } else {
            clearChart();
        }
    }
    paint();
}

/** The loaded recipe changed, or was read again: null when none is loaded. */
export function showGraphRecipe(next) {
    dispatch({ type: 'recipe', recipe: next });
}

// ── During a shot ────────────────────────────────────────────────────────────

// Is the profile running, so the chart holds the shot's lines? Streamline
// starts its shot clock, and the chart, at the profile's first frame, and stops
// it at the frame after the shot's end: the end is told before that frame is.
const profileRunning = () => !!window.app?.isShotActive?.();

// The machine went into its `espresso` state: the start of a shot's Preheat.
function shotStarted() {
    frame = null;
    dispatch({ type: 'shotStarted', profileStarted: profileRunning() });
    el('cafe-reference-dialog')?.close();
}

// A shot stopped in its Preheat drew nothing. Streamline's own shot table still
// holds the Shot before it until the profile starts, so its time says nothing
// of this shot.
function shotEnded() {
    dispatch({ type: 'shotEnded', poured: profileRunning() });
}

// ── The legend ───────────────────────────────────────────────────────────────

const show = (element, shown) => { if (element) element.style.display = shown ? '' : 'none'; };

// When a Shot was pulled and by whom: "Today 14:32" and "Ana".
function creditParts(shot) {
    if (!shot) return { time: '', who: '' };
    const { when, who } = shotCredit(shot);
    return { time: whenText(when, new Date(), cafeDateLocale(), cafeText('Today')), who };
}

// The legend's day is the Shot's against the clock when it is painted, so its
// two times are written again as the local day turns: a page left at rest
// overnight would read "Today" for yesterday's Shot. Only the times: the rest
// of `paint()` writes the live cards, which a timer never does. Chromium's
// timers on Android need not count the time a tablet sleeps, so a page coming
// back into view writes the times at once and sets the timer again: the
// `inView` cue's read of the Shots may fail, as on a tablet that wakes
// offline, and with no recipe loaded paints nothing then.
function watchDay() {
    clearTimeout(dayTimer);
    dayTimer = setTimeout(() => {
        dayTimer = null;
        paintDays();
        watchDay();
    }, untilNextDay(new Date()));
}

// The legend's two times, on the rows `paint()` last showed.
function paintDays() {
    const shown = model();
    if (shown.row) paintCredit('shot', shown.row.shot);
    if (shown.reference) paintCredit('reference', shown.reference);
}

// "Today 14:32 · Ana", for a dialog that names a Shot.
function credit(shot) {
    const { time, who } = creditParts(shot);
    return [time, who].filter(Boolean).join(' · ');
}

// The same on a Shot's row of the legend, as two pieces: in a narrow row the
// barista's name gives way before the time does.
function paintCredit(row, shot) {
    const { time, who } = creditParts(shot);
    setText(el(`cafe-${row}-when`), time);
    // The space before the name is the name's own: see `.cafe-legend-who`.
    setText(el(`cafe-${row}-who`), who && time ? ` · ${who}` : who);
}

// The row under the graph: six live cards while a shot runs and until the
// finished Shot is in the graph, five at rest.
function paintCards() {
    const { recipe, live, settling, shot: latest, reference } = inGraph(state);
    if (live || settling) {
        const beside = recipe && reference && reference.shot ? reference : null;
        const stopAt = parseFloat(el('drink-out-value')?.textContent);
        paintRow(liveCards({ view, frame, reference: beside, stopAt, fahrenheit: getTempUnit() === 'F' }), 'live');
        return;
    }
    // Before DYE2 has said which recipe is loaded, no row names the Shot drawn.
    const shot = recipe === undefined ? undefined : latest;
    if (shot !== numbersOf) {
        numbersOf = shot;
        numbers = shot ? shotNumbers(shot) : shot;
    }
    const chosen = recipe && reference ? reference.shot : null;
    paintRow(restCards({ view, shot: numbers, reference: chosen ? reference.numbers : null, isReference: !!shot && !!chosen && shot.id === chosen.id }), 'rest');
}

function paint() {
    const shown = model();
    paintCards();
    show(el('cafe-legend-shot'), !!shown.row);
    if (shown.row) {
        // A recipe's own name, for an opened Shot of another recipe, is not a phrase.
        const label = el('cafe-shot-label');
        if (shown.row.name) setText(label, shown.row.name);
        else setText(label, shown.row.label, { translate: true });
        label?.classList.toggle('cafe-legend-recipe', !!shown.row.name);
        paintCredit('shot', shown.row.shot);
    }
    show(el('cafe-back'), shown.back);
    // The Shot's stars and its note icon, which is a plus where it has no note.
    // Another Machine's Shot while Decent Sync can't be reached: the stars
    // are shown muted and take no tap, and the note opens to read only, so
    // its icon takes no tap where there is no note to read.
    show(el('cafe-stars'), !!shown.rate);
    el('cafe-stars')?.classList.toggle('cafe-locked', shown.locked);
    const noteButton = el('cafe-shot-note');
    show(noteButton, !!shown.rate);
    if (shown.rate) {
        const fills = starFills(shown.rate.rating);
        document.querySelectorAll('#cafe-stars .cafe-star').forEach((star, index) => {
            star.style.setProperty('--cafe-star-fill', `${fills[index] * 100}%`);
            star.setAttribute('aria-pressed', String(fills[index] > 0));
            star.disabled = shown.locked;
        });
        noteButton?.classList.toggle('cafe-has-note', !!shown.rate.note);
        if (noteButton) noteButton.disabled = shown.locked && !shown.rate.note;
    }
    const make = el('cafe-make-reference');
    show(make, shown.makeReference);
    if (make) make.disabled = shown.muted;
    show(el('cafe-legend-notice'), !!shown.notice);
    if (shown.notice) setText(el('cafe-legend-notice'), shown.notice, { translate: true });
    show(el('cafe-legend-reference'), !!shown.reference);
    if (shown.reference) paintCredit('reference', shown.reference);
    // The reference's rating and its note to read, each hidden when there is none.
    show(el('cafe-reference-rating'), shown.referenceRating !== null);
    setText(el('cafe-reference-rating'), ratingText(shown.referenceRating));
    show(el('cafe-reference-note'), shown.referenceNote !== null);
    show(el('cafe-different-profile'), shown.flag);
    show(el('cafe-reference-badge'), shown.badge);
    show(el('cafe-legend-line'), !!shown.line);
    if (shown.line) setText(el('cafe-legend-line'), shown.line, { translate: true });
    show(el('cafe-legend-targets'), shown.targets);
    for (const button of document.querySelectorAll('#cafe-view button')) {
        button.setAttribute('aria-pressed', String(button.dataset.view === view));
    }
    const swatch = el('cafe-reference-swatch');
    if (swatch) swatch.style.color = referenceColor('pressure', isDark());
}

// ── The toggle ───────────────────────────────────────────────────────────────

function setView(next, { keep = true } = {}) {
    if (next === view) return;
    view = next;
    applyOverlay();
    paint();
    if (keep) writeCafe(VIEW_KEY, view).catch(error => logger.warn('Cafe: could not keep the graph\'s view', error));
}

// ── Make reference ───────────────────────────────────────────────────────────

// Asks before a reference is replaced. Resolves true when the barista agrees.
function confirmReplace(forRecipe, shot, replaced) {
    const dialog = el('cafe-reference-dialog');
    if (!dialog || typeof dialog.showModal !== 'function') return Promise.resolve(false);
    setText(el('cafe-reference-dialog-recipe'), recipeName(forRecipe));
    setText(el('cafe-reference-dialog-new'), credit(shot));
    setText(el('cafe-reference-dialog-old'), credit(replaced));
    return new Promise(resolve => {
        dialog.returnValue = '';
        dialog.addEventListener('close', () => resolve(dialog.returnValue === 'replace'), { once: true });
        dialog.showModal();
    });
}

// Make reference acts on the Shot in the graph, for the recipe it is compared
// as: an opened Shot's own recipe, which the dialog names.
async function onMakeReference() {
    const offered = model();
    if (busy || !offered.makeReference || offered.muted) return;
    busy = true;
    try {
        const shown = inGraph(state);
        const forRecipe = shown.recipe;
        const shot = shown.shot;
        const replaced = shown.reference && shown.reference.shot ? shown.reference.shot.id : null;
        if (replaced !== null && !(await confirmReplace(forRecipe, shot, shown.reference.shot))) return;
        // The dialog was open a while: the page may show something else by now,
        // Decent Sync may have gone out of reach, or another reference may have
        // been chosen elsewhere, which the dialog did not name.
        const still = model();
        const { recipe, shot: latest, reference } = inGraph(state);
        if (!recipe || recipe.id !== forRecipe.id || !latest || latest.id !== shot.id || !still.makeReference || still.muted) return;
        if ((reference && reference.shot ? reference.shot.id : null) !== replaced) return;
        let chosen;
        try {
            chosen = await makeReference(forRecipe.id, shot.id);
        } catch (error) {
            logger.warn('Cafe: could not keep the reference', error);
            // A choice that may have been made was read again before it was
            // called failed: the page follows what that read found.
            chosen = error.reference;
            // Decent Sync's refusal says why, in its own words. Where that read
            // found the server out of reach it could not tell either way, and
            // the server may yet make the choice: the line under the legend
            // says the reference can't be changed, and nothing says it failed.
            if (!(chosen && chosen.unreachable)) showToast(error.refusal || cafeText('The reference could not be saved'), 4000, 'error');
        }
        // The seam's answer is the reference as it now is, and the graph
        // follows it without another read. So does the kept list's chip.
        dispatch({ type: 'referenceChosen', recipeId: forRecipe.id, chosen });
        if (chosen) listener.chosen?.(forRecipe.id, chosen.shot ? chosen.shot.id : null);
    } finally {
        busy = false;
    }
}

// ── Rating and notes ─────────────────────────────────────────────────────────

// What an edit, or a read after one, left of a Shot's rating or its note,
// named by the Shot's id (`edited` in graph-state.js).
// The kept list's row follows too.
const followEdit = (shotId, remarks) => {
    dispatch({ type: 'edited', shotId, remarks });
    listener.edited?.(shotId, remarks);
};
const markEdit = (shotId, type) => dispatch({ type, shotId });

// Was an edit not confirmed either way, because Decent Sync's server can't be
// asked? The server may yet make it, so it is not shown as failed, wherever
// the graph has gone meanwhile. Where the Shot is the one in the graph it is
// now shown as one that can't be changed, and the line under the legend says
// why.
function cantTell(shotId, error) {
    if (error.unreachable !== true) return false;
    dispatch({ type: 'shotUnreachable', shotId });
    return true;
}

// A tap on a star: that many stars, or none for a tap on the star chosen. It
// is saved at once, and the stars change as they are tapped. If the edit fails
// they go back, to what a read after it found where there was one.
async function onStar(star) {
    const target = shownRemarks(state);
    const shown = model();
    if (rating || !target || !shown.rate || shown.locked) return;
    const before = target.rating;
    const next = ratingForTap(before, star);
    rating = true;
    markEdit(target.id, 'editStarted');
    followEdit(target.id, { rating: ratingOf(next) });
    try {
        followEdit(target.id, editedRemarks({ rating: next }, await editShot(target.id, { rating: next })));
    } catch (error) {
        logger.warn('Cafe: could not save the rating', error);
        followEdit(target.id, editedRemarks({ rating: next }, error.remarks || { rating: before }));
        // Decent Sync's refusal says why, in its own words. Where nothing is
        // known either way there is no toast: the line under the legend says
        // the Shot can't be changed.
        if (!cantTell(target.id, error)) showToast(error.refusal || cafeText('The rating could not be saved'), 4000, 'error');
    } finally {
        rating = false;
        markEdit(target.id, 'editEnded');
    }
}

// The note icon on the Shot's row opens its note to write. The edit names the
// Shot by its id, so a note saved after the graph has moved on is still that
// Shot's.
function onNote() {
    const shown = model();
    const target = shownRemarks(state);
    if (!target || !shown.rate) return;
    // A Shot that can't be changed now has its note opened to read.
    if (shown.locked) {
        if (target.note) readNote({ title: shown.row.label, name: shown.row.name, credit: credit(shown.row.shot), rating: target.rating, note: target.note });
        return;
    }
    editNote({
        title: shown.row.label,
        name: shown.row.name,
        credit: credit(shown.row.shot),
        note: target.note,
        async save(text) {
            const note = noteToSave(text);
            if (note === (target.note || '')) return;
            markEdit(target.id, 'editStarted');
            try {
                followEdit(target.id, editedRemarks({ note }, await editShot(target.id, { note })));
            } catch (error) {
                logger.warn('Cafe: could not save the note', error);
                followEdit(target.id, editedRemarks({ note }, error.remarks));
                if (cantTell(target.id, error)) throw new Error(cafeText('Decent Sync can\'t be reached, so this shot can\'t be changed'));
                throw new Error(error.refusal || cafeText('The note could not be saved'));
            } finally {
                markEdit(target.id, 'editEnded');
            }
        },
    });
}

// The note icon on the reference's row opens its note to read.
function onReferenceNote() {
    const shown = model();
    if (shown.referenceNote === null) return;
    readNote({ title: 'Reference', credit: credit(shown.reference), rating: shown.referenceRating, note: shown.referenceNote });
}

// ── A Shot opened from the list ──────────────────────────────────────────────

/**
 * Open a Shot from the Shots list in the latest's place. `recipe` is its own
 * recipe's DYE2 record, or null; `name` is the name of a recipe this tablet
 * has no record of, or null. The latest's own row goes back to the latest.
 */
export function openShot(shotId, recipe, name = null) {
    dispatch({ type: 'open', shotId, recipe, name });
}

/** The id of the Shot in the graph, for the list's highlight, or null. */
export function shotInGraph() {
    return shotInGraphId(state);
}

/** Is a Shot opened from the list in the graph? The list keeps its place while one is. */
export function isShotOpened() {
    return !!state.opened;
}

/**
 * The Shots list hears what the page changes of a Shot it lists:
 * `edited(shotId, remarks)`, a rating or note, and `chosen(recipeId, shotId)`,
 * a recipe's reference; and `sourceMoved()`, that where references are kept
 * changed, so which Shots are references is another source's answer now.
 */
export function onShotChanges(listen) {
    listener = listen || {};
}

// ── Start ────────────────────────────────────────────────────────────────────

/** Called once, when the page starts. */
export function initGraph() {
    state = initialGraphState();
    setShotChooser(chooseShot);
    // The main graph's lines carry their names through a shot, as after it.
    setLiveLineLabels(true);
    applyOverlay();
    paint();
    // A page opened during a shot, in its Preheat as much as later, is live: the
    // machine went into its `espresso` state before the page was listening.
    if (currentMachineState === 'espresso' || profileRunning()) shotStarted();

    // The view this tablet was left in. Reference until it is known.
    readCafe(VIEW_KEY)
        .then(stored => setView(viewFrom(stored), { keep: false }))
        .catch(error => logger.warn('Cafe: could not read the graph\'s view', error));

    for (const button of document.querySelectorAll('#cafe-view button')) {
        button.addEventListener('click', () => setView(viewFrom(button.dataset.view)));
    }
    el('cafe-make-reference')?.addEventListener('click', onMakeReference);
    for (const star of document.querySelectorAll('#cafe-stars .cafe-star')) {
        star.addEventListener('click', () => onStar(Number(star.dataset.star)));
    }
    el('cafe-shot-note')?.addEventListener('click', onNote);
    el('cafe-reference-note')?.addEventListener('click', onReferenceNote);
    el('cafe-back')?.addEventListener('click', () => dispatch({ type: 'backToLatest' }));
    // The seam says a recipe's reference should be read again (null for
    // whichever is in the graph), or that where references are kept changed.
    watchReference((recipeId, sourceMoved = false) => {
        if (!sourceMoved) {
            dispatch({ type: 'referencePushed', recipeId });
            return;
        }
        dispatch({ type: 'sourceMoved' });
        listener.sourceMoved?.();
    });

    document.addEventListener('streamline:espresso-start', shotStarted);
    document.addEventListener('streamline:espresso-end', shotEnded);
    // Shots have no push channel: look again when the page comes back into view.
    // Streamline's history module asks to draw then too, which is the same cue.
    const inView = () => dispatch({ type: 'inView' });
    document.addEventListener('streamline:mainpagevisible', inView);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        inView();
        paintDays();
        watchDay();
    });
    watchDay();
    // A time is written in the page's language, and the reference's swatch in
    // the theme's colour.
    document.addEventListener('streamline:languagechange', paint);
    document.addEventListener('streamline:unitchange', paintCards);
    // A name measured before its font had loaded was measured in another.
    document.fonts?.addEventListener?.('loadingdone', () => nameWidths.clear());
    // The chart's width, for the stage names: read here and on a resize, never
    // on a live frame.
    const chart = el('plotly-chart');
    if (chart) {
        chartWidth = chart.clientWidth;
        new ResizeObserver(entries => {
            const width = entries[0].contentRect.width;
            // No width is the page hidden behind another: nothing to draw into.
            if (!width || width === chartWidth) return;
            chartWidth = width;
            // A name that fitted may not now, and one that did not may.
            if (overlayFor) setChartOverlay(overlay);
        }).observe(chart);
    }
    new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
