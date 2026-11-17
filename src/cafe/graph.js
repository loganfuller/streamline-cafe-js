// The graph's Shots, its legend and the row of numbers under it: the loaded
// recipe's latest Shot, its reference behind it, the Reference | Targets toggle,
// Make reference, the Shot's stars and note, the comparison row and the stage
// names (docs/cafe/DESIGN.md, "Shots and the reference" and "Rating and notes").
//
// Streamline's chart still draws everything. This module decides which finished
// Shot it draws, through the two hooks the fork adds to chart.js. With a recipe
// loaded it asks the Shot seam for the recipe's latest Shot and its reference,
// and reads them again when the seam says the reference may have changed: on a
// Machine Decent Sync serves, another was chosen elsewhere, or the server came
// into reach or went out of it. With none, Streamline's history module draws
// the tablet's newest Shot, as on Streamline's own page, and the legend names
// the Shot it handed the chart.
import { setChartOverlay, setShotChooser, plotHistoricalShot, clearChart } from '../modules/chart.js';
import { getTotalTime, getCurrentShot } from '../modules/shotData.js';
import { getScaleReading } from '../modules/api.js';
import { getTempUnit } from '../modules/units.js';
import { showToast } from '../modules/ui.js';
import { isSubPage } from '../modules/router.js';
import { logger } from '../modules/logger.js';
import { latestShot, referenceShot, makeReference, watchReference, newestShot, editShot } from './shot-seam.js';
import { readCafe, writeCafe, VIEW_KEY } from './cafe-store.js';
import { graphModel, shotCurves, shotCredit, whenText, viewFrom, drawnShot, sameReference, isDrawnShot } from './shot-model.js';
import { shotRemarks, sameRemarks, editedRemarks, starFills, ratingForTap, ratingOf, ratingText, noteToSave } from './remarks.js';
import { editNote, readNote } from './note-dialog.js';
import { referenceOverlay, referenceColor } from './reference-overlay.js';
import { recipeName } from './strip-model.js';
import { cafeText, cafeDateLocale, setText } from './text.js';
import { shotSamples, shotNumbers, restCards, liveCards, liveFrame } from './comparison.js';
import { shotStages, stageShapes, withStageNames, STAGE_NAME_FONT } from './stage-names.js';
import { paintRow } from './compare-row.js';

const REFRESH_GAP_MS = 300;
// The seam's answer for a recipe with no reference that none can be chosen for:
// what stands in where the reference could not be read, or is not this source's.
const NO_REFERENCE = { shot: null, canChange: false };
// Once a shot ends, how long between looks for it among Decaid's Shots: at half
// a second, then 2, 4, 7, 11 and 15 seconds after the end. Decaid saves a shot
// once its last drops have been weighed, a few seconds after the pump stops.
const SETTLE_GAPS_MS = [500, 1500, 2000, 3000, 4000, 4000];
const SETTLE_LAST_MS = 15_000;

let recipe;             // the loaded recipe; null for none; undefined until DYE2 was read
let view = 'reference';
let live = false;
let settling = false;   // a shot has ended and Decaid does not have it yet
let settleStep = 0;     // how many looks for that shot have been scheduled
let settleFrom = null;  // the id of the Shot in the graph before that shot; undefined when none had been read
let latest;             // the Shot in the graph, whole; null for none; undefined until read
let handed;             // the Shot the history module last asked the chart to draw; undefined until it asks
let heldBack = false;   // a request of the history module's was turned down during the running shot
let reference = null;   // the seam's answer for the recipe's reference: { shot, canChange, … }, with the Shot's curves, samples, numbers and stages
let drawDue = false;    // a read was asked for that must end in a draw, whatever it finds
let drawing = null;     // the measurements this module is handing the chart itself
let overlayFor = null;  // what the chart was last drawn with: the view, the reference's lines and its stages
let frame = null;       // what the running shot last read, for the live cards; kept until the finished Shot is in the graph
let numbers;            // the numbers of the Shot in the graph, worked out once for each Shot
let numbersOf;          // the Shot they were worked out for
let chartWidth = 0;     // the main chart's width in pixels, kept so a live frame measures nothing
let liveFailed = false; // the live cards threw once: said once, not on every frame
let seq = 0;
let refreshTimer = null;
let settleTimer = null;
let lateTimer = null;     // the one look left after a recipe change stopped the others
let busy = false;       // a reference is being chosen
// The rating and note of the Shot in the graph: `{ id, rating, note, of }`,
// where `of` is that Shot as `latest` holds it. Null until its record is
// known: with no recipe the Shot comes from Streamline's history module with
// no record, so the page reads the tablet's newest and takes it only if it is
// the Shot drawn.
let remarks = null;
let edits = 0;          // counts each edit of a Shot as it starts and as it ends: a read begun before either is older than the edit
let rating = false;     // a rating is on its way
let lastSeq = 0;        // the reads of the tablet's newest record, for "Last shot"

const el = id => document.getElementById(id);
const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';

// ── What the chart draws ─────────────────────────────────────────────────────

// The rating and note of the Shot in the graph, or null where they are not
// known, or are another Shot's.
const shownRemarks = () => (remarks && remarks.of === latest ? remarks : null);

function model() {
    return graphModel({ recipe, view, live, settling, shot: latest, reference, remarks: shownRemarks() });
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
    let drawn = view === 'reference' ? referenceOverlay(traces, layout, mode, { curves, dark: isDark() }) : { traces, layout };
    if (chart !== 'main') return drawn;
    let shown = drawn.layout;
    if (stages && !(shown.shapes && shown.shapes.length)) shown = { ...shown, shapes: stageShapes(stages, isDark()) };
    const margin = shown.margin || {};
    drawn = { traces: drawn.traces, layout: withStageNames(shown, { plotWidth: chartWidth - (margin.l ?? 50) - (margin.r ?? 50), measure: nameWidth }) };
    // While a finished shot waits for Decaid to save it the chart still holds
    // its lines: a draw then, as on the way back from the full-screen chart,
    // brings the cards up to the shot's last frame.
    if ((mode === 'live' && live) || settling) readLiveFrame(traces, layout);
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
        const weights = live ? null : getCurrentShot().weights;
        const ended = (weights && weights.length ? weights[weights.length - 1] : null) ?? (frame ? frame.weight : null);
        const weight = live ? getScaleReading().weight : ended;
        frame = liveFrame(traces, layout.shapes, weight);
        paintCards();
    } catch (error) {
        if (!liveFailed) logger.warn('Cafe: could not write the live cards', error);
        liveFailed = true;
    }
}

function applyOverlay() {
    const shown = model();
    const curves = view === 'reference' && shown.lines ? reference.curves : null;
    // With no Shot for the recipe yet the reference is drawn alone, and the
    // stages named are its own.
    const stages = curves && shown.line && latest === null ? reference.stages : null;
    if (overlayFor && overlayFor.view === view && overlayFor.curves === curves && overlayFor.stages === stages) return;
    overlayFor = { view, curves, stages };
    setChartOverlay(overlay);
}

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
function chooseShot(measurements, workflow) {
    if (measurements === drawing) return true;
    handed = drawnShot(measurements, workflow);
    if (live) {
        heldBack = true;
        return false;
    }
    if (recipe === undefined) {
        latest = handed; // no row names it until the recipe is known
        return true;
    }
    if (recipe === null) {
        latest = handed;
        settling = false;
        readLast();
        paint();
        return true;
    }
    refreshSoon();
    return false;
}

function draw() {
    drawDue = false;
    applyOverlay();
    // The chart draws into whichever page is showing: never over another page's.
    if (!isSubPage()) {
        if (latest) {
            drawing = latest.measurements;
            try { plotHistoricalShot(latest.measurements, latest.workflow); } finally { drawing = null; }
        } else {
            clearChart();
        }
    }
    paint();
}

// ── Reading the Shots ────────────────────────────────────────────────────────

// Reads the recipe's latest Shot and its reference, and draws them. With
// `onlyIfChanged` the graph is drawn again only if either is another than the
// one drawn: the seam said the reference may have changed, and a push may
// repeat. A read that must end in a draw still does, when one like this
// overtakes it.
async function refresh({ onlyIfChanged = false } = {}) {
    if (refreshTimer || !onlyIfChanged) drawDue = true;
    clearTimeout(refreshTimer);
    refreshTimer = null;
    // A running shot owns the chart's lines: its end asks again. With no recipe
    // loaded the history module draws, and there is nothing to read but the
    // rating and note of the Shot it drew. While the page looks for a shot that
    // has just ended, this read is one more look: it takes the place of a look
    // still on its way, which may have read the reference before the change
    // that asked for this one.
    if (live || !recipe) {
        if (!live && recipe === null) readLast();
        return;
    }
    const mine = ++seq;
    const editsThen = edits;
    let shot;
    let chosen;
    try {
        // The reference may come from Decent Sync, which can fail while Decaid
        // answers: that must not cost the graph its latest Shot.
        [shot, chosen] = await Promise.all([latestShot(recipe.id), referenceShot(recipe.id).catch(error => {
            logger.warn('Cafe: could not read the reference', error);
            return null;
        })]);
    } catch (error) {
        logger.warn('Cafe: could not read the Shots for the graph', error);
        if (mine !== seq || live) return;
        if (settling) settleNext();
        // Decaid can't be asked. The graph is drawn again from what was last
        // read: the page may have come back from another page with its chart
        // cleared, and the legend must name the Shot that is drawn. With nothing
        // read yet for this recipe that is an empty graph, never another recipe's Shot.
        else if (drawDue) draw();
        return;
    }
    if (mine !== seq || live) return;
    // A shot has just ended and Decaid does not have it yet: the graph keeps
    // its live lines, and the next look is a little later.
    if (settling && settleStep < SETTLE_GAPS_MS.length) {
        const id = shot ? shot.id : null;
        // Nothing had been read for this recipe when the shot started, so this
        // look's answer is the Shot to tell the finished one from.
        if (settleFrom === undefined) settleFrom = id;
        if (id === settleFrom) {
            settleNext();
            return;
        }
    }
    // A reference that could not be read leaves the one read for this recipe
    // before, which is this source's: a change of source dropped any other.
    // With none read, there is none, and none can be chosen.
    let answer = chosen || reference || NO_REFERENCE;
    // The reference's rating and note, where the page edited that Shot after
    // this read began: the read is older than the edit, as for the latest Shot.
    if (answer !== reference && edits !== editsThen && answer.shot && reference && reference.shot && reference.shot.id === answer.shot.id) {
        answer = { ...answer, rating: reference.rating, note: reference.note };
    }
    const sameShot = latest !== undefined && (shot ? shot.id : null) === (latest ? latest.id : null);
    if (!drawDue && !settling && sameShot && sameReference(reference, answer)) {
        // The same two Shots: nothing is drawn again. A rating or a note may
        // be another all the same, as the reference's is when it was changed
        // elsewhere, and then only the legend's rows are written again.
        const before = shownRemarks();
        takeRemarks(shot, editsThen);
        const rows = !sameRemarks(before, shownRemarks()) || !sameRemarks(reference, answer);
        if (!sameRemarks(reference, answer)) reference = { ...reference, rating: answer.rating, note: answer.note };
        if (rows) paint();
        return;
    }
    latest = shot;
    takeRemarks(shot, editsThen);
    // Kept with no Shot too: the seam's answer still says whether one can be chosen.
    if (answer !== reference) reference = { ...answer, ...referenceParts(answer.shot) };
    settling = false;
    clearTimeout(settleTimer);
    draw();
}

// The rating and note a read found for the Shot in the graph, which `latest`
// holds by now. Where the page edited that Shot after the read began, the read
// is older than the edit, and what the edit answered stays.
function takeRemarks(record, editsThen) {
    if (!record || !latest) {
        remarks = null;
        return;
    }
    const edited = edits !== editsThen && remarks && remarks.id === record.id;
    remarks = { ...(edited ? { rating: remarks.rating, note: remarks.note } : shotRemarks(record)), id: record.id, of: latest };
}

// With no recipe loaded the graph's Shot is the one Streamline's history
// module handed the chart: its measurements and its Workflow, and no record.
// So the page asks the seam for the tablet's newest Shot, and takes its id,
// rating and note only if it is the Shot drawn. Until then, and where it is
// another, the row has no stars: they never act on a Shot that is not the one
// in the graph. The module hands the same Shot over again on the way back from
// another page, and what was read for it stands until this read answers.
async function readLast() {
    if (recipe !== null || !latest) return;
    if (remarks && remarks.of !== latest && remarks.of.id == null && remarks.of.timestamp === latest.timestamp) remarks = { ...remarks, of: latest };
    const mine = ++lastSeq;
    const editsThen = edits;
    let record;
    try {
        record = await newestShot();
    } catch (error) {
        logger.warn('Cafe: could not read the last Shot\'s rating and note', error);
        return;
    }
    if (mine !== lastSeq || recipe !== null) return;
    const before = shownRemarks();
    takeRemarks(isDrawnShot(record, latest) ? record : null, editsThen);
    const now = shownRemarks();
    if (!!before !== !!now || !sameRemarks(before, now)) paint();
}

// The seam says a recipe's reference should be read again: with null, whichever
// recipe is in the graph.
//
// `sourceMoved` says where references are kept changed. The reference in the
// graph is then the other source's, and is dropped at once, whatever the page
// is doing: the choice kept on the tablet is never left on a Machine Decent
// Sync has come to serve, whichever read fails or is overtaken next. The read
// that follows is a full one. It ends in a draw, and it takes the place of a
// read still on its way from the source before, as a look for a shot that has
// just ended may be.
function referenceChanged(recipeId, sourceMoved = false) {
    if (!recipe) return;
    if (sourceMoved) {
        if (reference) {
            reference = { ...NO_REFERENCE, ...referenceParts(null) };
            applyOverlay();
            paint();
        }
        refresh();
        return;
    }
    if (recipeId != null && String(recipeId) !== String(recipe.id)) return;
    refresh({ onlyIfChanged: true });
}

// What is worked out once for a reference: its lines, its samples and numbers
// for the cards, and its stages.
function referenceParts(shot) {
    if (!shot) return { curves: null, samples: null, numbers: null, stages: null };
    return {
        curves: shotCurves(shot.measurements),
        samples: shotSamples(shot.measurements),
        numbers: shotNumbers(shot),
        stages: shotStages(shot.measurements, shot.workflow),
    };
}

function refreshSoon() {
    if (refreshTimer || live) return;
    refreshTimer = setTimeout(() => refresh(), REFRESH_GAP_MS);
}

// The next look for a shot that has ended. After the last, what Decaid holds is
// taken as it is: the shot was Unfinished, pulled with another recipe, or never
// saved, and the graph goes back to the Shot before it.
function settleNext() {
    clearTimeout(settleTimer);
    if (settleStep >= SETTLE_GAPS_MS.length) {
        // The last look failed too. The graph goes back to the Shot the legend
        // names, so Make reference never acts on a Shot that is not the one drawn.
        settling = false;
        draw();
        return;
    }
    settleTimer = setTimeout(() => refresh(), SETTLE_GAPS_MS[settleStep]);
    settleStep += 1;
}

/** The loaded recipe changed, or was read again: null when none is loaded. */
export function showGraphRecipe(next) {
    const before = recipe;
    recipe = next || null;
    if (before !== undefined && (before ? before.id : null) === (recipe ? recipe.id : null)) {
        paint(); // the same recipe, read again: its profile may have changed
        return;
    }
    seq += 1; // a read for the recipe before is no longer wanted
    reference = null;
    clearTimeout(settleTimer);
    // A shot had just ended and Decaid may not have it yet. The graph is this
    // recipe's now, so the looks for that shot stop, bar one once Decaid must
    // have it: the recipe it was pulled with may be loaded again by then.
    if (settling) {
        clearTimeout(lateTimer);
        lateTimer = setTimeout(() => refresh(), SETTLE_LAST_MS);
    }
    if (!recipe) {
        // No recipe: the graph goes back to the Shot the history module last
        // asked to draw, the tablet's newest, and shows each it asks for after.
        // A running shot keeps its lines until it ends.
        latest = handed;
        settling = false;
        readLast();
        applyOverlay();
        if (live) paint();
        else draw();
        return;
    }
    latest = undefined;
    settling = false;
    applyOverlay();
    paint();
    refresh();
}

// ── During a shot ────────────────────────────────────────────────────────────

function shotStarted() {
    live = true;
    frame = null;
    heldBack = false;
    settling = false;
    seq += 1;
    clearTimeout(settleTimer);
    clearTimeout(lateTimer);
    clearTimeout(refreshTimer);
    refreshTimer = null;
    el('cafe-reference-dialog')?.close();
    applyOverlay();
    paint();
}

function shotEnded() {
    if (!live) return;
    live = false;
    // With no recipe, a request turned down during the shot is drawn now, if it
    // is not the Shot in the graph already: the module counts it as drawn and
    // will not ask again. It is the shot just saved, when the end reached the
    // page late, or the newest saved before it, which the module would show
    // too; a shot saved later is still drawn then.
    if (!recipe && heldBack && handed?.timestamp !== latest?.timestamp) {
        heldBack = false;
        latest = handed;
        settling = false;
        readLast();
        applyOverlay();
        draw();
        return;
    }
    // A shot stopped before it poured drew nothing and is not saved: the graph
    // still holds the Shot before it. Any other is looked for until Decaid has it.
    if (getTotalTime() > 0) {
        settling = true;
        // With no recipe the history module draws the shot once Decaid has saved
        // it, and the legend then names it. Until then the row names no time.
        // A run Decaid never saves is never drawn, so if nothing has been drawn
        // by the last look a recipe's shot would get, the graph goes back to
        // the Shot before, as it does with a recipe.
        if (!recipe) {
            heldBack = false;
            clearTimeout(settleTimer);
            settleTimer = setTimeout(() => {
                if (!settling || live || recipe) return;
                settling = false;
                latest = handed;
                readLast();
                draw();
            }, SETTLE_LAST_MS);
            applyOverlay();
            paint();
            return;
        }
        settleStep = 0;
        settleFrom = latest === undefined ? undefined : latest ? latest.id : null;
        applyOverlay();
        paint();
        settleNext();
        return;
    }
    applyOverlay();
    paint();
    refresh();
}

// ── The legend ───────────────────────────────────────────────────────────────

const show = (element, shown) => { if (element) element.style.display = shown ? '' : 'none'; };

// When a Shot was pulled and by whom: "Today 14:32" and "Ana".
function creditParts(shot) {
    if (!shot) return { time: '', who: '' };
    const { when, who } = shotCredit(shot);
    return { time: whenText(when, new Date(), cafeDateLocale(), cafeText('Today')), who };
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
    setText(el(`cafe-${row}-who`), who && time ? `· ${who}` : who);
}

// The row under the graph: six live cards while a shot runs and until the
// finished Shot is in the graph, five at rest.
function paintCards() {
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
        setText(el('cafe-shot-label'), shown.row.label, { translate: true });
        paintCredit('shot', shown.row.shot);
    }
    // The Shot's stars and its note icon, which is a plus where it has no note.
    show(el('cafe-stars'), !!shown.rate);
    const noteButton = el('cafe-shot-note');
    show(noteButton, !!shown.rate);
    if (shown.rate) {
        const fills = starFills(shown.rate.rating);
        document.querySelectorAll('#cafe-stars .cafe-star').forEach((star, index) => {
            star.style.setProperty('--cafe-star-fill', `${fills[index] * 100}%`);
            star.setAttribute('aria-pressed', String(fills[index] > 0));
        });
        noteButton?.classList.toggle('cafe-has-note', !!shown.rate.note);
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

async function onMakeReference() {
    const offered = model();
    if (busy || !offered.makeReference || offered.muted) return;
    busy = true;
    try {
        const forRecipe = recipe;
        const shot = latest;
        const replaced = reference && reference.shot ? reference.shot.id : null;
        if (replaced !== null && !(await confirmReplace(forRecipe, shot, reference.shot))) return;
        // The dialog was open a while: the page may show something else by now,
        // Decent Sync may have gone out of reach, or another reference may have
        // been chosen elsewhere, which the dialog did not name.
        const still = model();
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
        if (chosen) followChoice(forRecipe, chosen);
    } finally {
        busy = false;
    }
}

// The reference as a choice left it: the seam's answer to the choice is the
// reference as it now is, and the graph follows it without another read.
function followChoice(forRecipe, chosen) {
    // The page may show another recipe by now. A shot that has started keeps
    // the lines it started with, and its end reads the reference again.
    if (!recipe || recipe.id !== forRecipe.id || live || settling) return;
    seq += 1; // a read begun before the choice would put the reference before it back
    reference = { ...chosen, ...referenceParts(chosen.shot) };
    draw();
}

// ── Rating and notes ─────────────────────────────────────────────────────────

// What an edit, or a read after one, left of a Shot's rating or its note: only
// the one the edit was of, since an answer also carries the other as it stood
// when the edit was made, which a later edit of that one may have changed
// since. The Shot is named by its id: the graph may show another by now, and
// then nothing on screen changes. When it is the reference too, that row
// follows.
function followEdit(shotId, now) {
    if (remarks && remarks.id === shotId) remarks = { ...remarks, ...now };
    if (reference && reference.shot && reference.shot.id === shotId) reference = { ...reference, ...now };
    paint();
}

// A tap on a star: that many stars, or none for a tap on the star chosen. It
// is saved at once, and the stars change as they are tapped. If the edit fails
// they go back, to what a read after it found where there was one.
async function onStar(star) {
    const target = shownRemarks();
    if (rating || !target || !model().rate) return;
    const before = target.rating;
    const next = ratingForTap(before, star);
    rating = true;
    edits += 1;
    followEdit(target.id, { rating: ratingOf(next) });
    try {
        followEdit(target.id, editedRemarks({ rating: next }, await editShot(target.id, { rating: next })));
    } catch (error) {
        logger.warn('Cafe: could not save the rating', error);
        followEdit(target.id, editedRemarks({ rating: next }, error.remarks || { rating: before }));
        // Decent Sync's refusal says why, in its own words.
        showToast(error.refusal || cafeText('The rating could not be saved'), 4000, 'error');
    } finally {
        rating = false;
        edits += 1;
    }
}

// The note icon on the Shot's row opens its note to write. The edit names the
// Shot by its id, so a note saved after the graph has moved on is still that
// Shot's.
function onNote() {
    const shown = model();
    const target = shownRemarks();
    if (!target || !shown.rate) return;
    editNote({
        title: shown.row.label,
        credit: credit(shown.row.shot),
        note: target.note,
        async save(text) {
            const note = noteToSave(text);
            if (note === (target.note || '')) return;
            edits += 1;
            try {
                followEdit(target.id, editedRemarks({ note }, await editShot(target.id, { note })));
            } catch (error) {
                logger.warn('Cafe: could not save the note', error);
                followEdit(target.id, editedRemarks({ note }, error.remarks));
                throw new Error(error.refusal || cafeText('The note could not be saved'));
            } finally {
                edits += 1;
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

// ── Start ────────────────────────────────────────────────────────────────────

/** Called once, when the page starts. */
export function initGraph() {
    live = !!window.app?.isShotActive?.();
    setShotChooser(chooseShot);
    applyOverlay();
    paint();

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
    watchReference(referenceChanged);

    document.addEventListener('streamline:espresso-start', shotStarted);
    document.addEventListener('streamline:espresso-end', shotEnded);
    // Shots have no push channel: look again when the page comes back into view.
    // Streamline's history module asks to draw then too, which is the same cue.
    document.addEventListener('streamline:mainpagevisible', refreshSoon);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshSoon(); });
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
