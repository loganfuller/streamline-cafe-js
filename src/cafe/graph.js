// The graph's Shots and its legend: the loaded recipe's latest Shot, its
// reference behind it, the Reference | Targets toggle and Make reference
// (docs/cafe/DESIGN.md, "Shots and the reference").
//
// Streamline's chart still draws everything. This module decides which finished
// Shot it draws, through the two hooks the fork adds to chart.js. With a recipe
// loaded it asks the Shot seam for the recipe's latest Shot and its reference.
// With none, Streamline's history module draws the tablet's newest Shot, as on
// Streamline's own page, and the legend names the Shot it handed the chart.
import { setChartOverlay, setShotChooser, plotHistoricalShot, clearChart } from '../modules/chart.js';
import { getTotalTime } from '../modules/shotData.js';
import { showToast } from '../modules/ui.js';
import { isSubPage } from '../modules/router.js';
import { logger } from '../modules/logger.js';
import { latestShot, referenceShot, makeReference } from './shot-seam.js';
import { readCafe, writeCafe, VIEW_KEY } from './cafe-store.js';
import { graphModel, shotCurves, shotCredit, whenText, viewFrom, drawnShot } from './shot-model.js';
import { referenceOverlay, referenceColor } from './reference-overlay.js';
import { recipeName } from './strip-model.js';
import { cafeText, cafeDateLocale, setText } from './text.js';

const REFRESH_GAP_MS = 300;
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
let reference = null;   // the seam's answer for the recipe's reference: { shot, canChange }, with the Shot's curves
let drawing = null;     // the measurements this module is handing the chart itself
let overlayKey;         // what the overlay was last set for
let seq = 0;
let refreshTimer = null;
let settleTimer = null;
let lateTimer = null;     // the one look left after a recipe change stopped the others
let busy = false;       // a reference is being chosen

const el = id => document.getElementById(id);
const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';

// ── What the chart draws ─────────────────────────────────────────────────────

function model() {
    return graphModel({ recipe, view, live, settling, shot: latest, reference });
}

// In Targets the chart is Streamline's own. In Reference the targets are hidden
// and the reference's three lines follow the Shot's, empty when none is drawn.
function applyOverlay() {
    const curves = view === 'reference' && model().lines ? reference.curves : null;
    const key = view === 'reference' ? curves || 'none' : null;
    if (key === overlayKey) return;
    overlayKey = key;
    setChartOverlay(view === 'reference'
        ? (traces, layout, mode) => referenceOverlay(traces, layout, mode, { curves, dark: isDark() })
        : null);
}

// Streamline's history module asks to draw a finished Shot: the tablet's
// newest, at start-up, on the way back from another page and once a shot has
// been saved. With a recipe loaded the graph shows the recipe's latest instead,
// so the request is turned down and taken as a cue to look again. With none it
// is let through, and the legend names the Shot drawn. Until DYE2 has said which
// recipe is loaded it is let through too, so the graph is not empty meanwhile.
// Each request is kept, so the graph can go back to it when a recipe is unloaded.
function chooseShot(measurements, workflow) {
    if (measurements === drawing) return true;
    handed = drawnShot(measurements, workflow);
    if (recipe === undefined) return true;
    if (recipe === null) {
        latest = handed;
        settling = false;
        paint();
        return true;
    }
    refreshSoon();
    return false;
}

function draw() {
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

async function refresh() {
    clearTimeout(refreshTimer);
    refreshTimer = null;
    // A running shot owns the chart's lines: its end asks again. With no recipe
    // loaded there is nothing to read: the history module draws.
    if (live || !recipe) return;
    const mine = ++seq;
    let shot;
    let chosen;
    try {
        [shot, chosen] = await Promise.all([latestShot(recipe.id), referenceShot(recipe.id)]);
    } catch (error) {
        logger.warn('Cafe: could not read the Shots for the graph', error);
        if (mine !== seq || live) return;
        if (settling) settleNext();
        // Decaid can't be asked. The graph is drawn again from what was last
        // read: the page may have come back from another page with its chart
        // cleared, and the legend must name the Shot that is drawn. With nothing
        // read yet for this recipe that is an empty graph, never another recipe's Shot.
        else draw();
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
    latest = shot;
    // Kept with no Shot too: the seam's answer still says whether one can be chosen.
    reference = { ...chosen, curves: chosen.shot ? shotCurves(chosen.shot.measurements) : null };
    settling = false;
    clearTimeout(settleTimer);
    draw();
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
    // A shot stopped before it poured drew nothing and is not saved: the graph
    // still holds the Shot before it. Any other is looked for until Decaid has it.
    if (getTotalTime() > 0) {
        settling = true;
        // With no recipe the history module draws the shot once Decaid has saved
        // it, and the legend then names it. Until then the row names no time.
        if (!recipe) {
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

// "Today 14:32 · Ana", for a Shot's row.
function credit(shot) {
    if (!shot) return '';
    const { when, who } = shotCredit(shot);
    return [whenText(when, new Date(), cafeDateLocale(), cafeText('Today')), who].filter(Boolean).join(' · ');
}

function paint() {
    const shown = model();
    show(el('cafe-legend-shot'), !!shown.row);
    if (shown.row) {
        setText(el('cafe-shot-label'), shown.row.label, { translate: true });
        setText(el('cafe-shot-when'), credit(shown.row.shot));
    }
    show(el('cafe-make-reference'), shown.makeReference);
    show(el('cafe-legend-reference'), !!shown.reference);
    if (shown.reference) setText(el('cafe-reference-when'), credit(shown.reference));
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
    if (busy || !model().makeReference) return;
    busy = true;
    try {
        const forRecipe = recipe;
        const shot = latest;
        if (reference && reference.shot && !(await confirmReplace(forRecipe, shot, reference.shot))) return;
        // The dialog was open a while: the page may show something else by now.
        if (!recipe || recipe.id !== forRecipe.id || !latest || latest.id !== shot.id || live) return;
        try {
            await makeReference(forRecipe.id, shot.id);
        } catch (error) {
            logger.warn('Cafe: could not keep the reference', error);
            showToast(cafeText('The reference could not be saved'), 4000, 'error');
            return;
        }
        await refresh();
    } finally {
        busy = false;
    }
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

    document.addEventListener('streamline:espresso-start', shotStarted);
    document.addEventListener('streamline:espresso-end', shotEnded);
    // Shots have no push channel: look again when the page comes back into view.
    // Streamline's history module asks to draw then too, which is the same cue.
    document.addEventListener('streamline:mainpagevisible', refreshSoon);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshSoon(); });
    // A time is written in the page's language, and the reference's swatch in
    // the theme's colour.
    document.addEventListener('streamline:languagechange', paint);
    new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
