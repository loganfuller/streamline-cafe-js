// The cafe page around the strip: the title, the barista at the machine, what
// each dial-in row names and the dialogs those names open, the weight during a
// shot, the scale's battery, and where Settings and Sleep sit
// (docs/cafe/DESIGN.md, "What the screen shows" and "The barista").
//
// Streamline's modules still paint the steppers, the status line, the telemetry
// row and the graph. This module adds what they have no word for, and reads
// what it needs from where they already write it.
import { getWorkflow, getBeanBatch, getScaleReading, setTargetSteamFlow, hasWorkflowWriteInFlight, getMachineState } from '../modules/api.js';
import { updateSteamDisplay, pushSteamSetting, isAutoSteamMode, flashPlusMinusButton, msSinceTileInteraction } from '../modules/ui.js';
import { API_DEBOUNCE_MS } from '../modules/workflow-watch.js';
import { isSubPage } from '../modules/router.js';
import { logger } from '../modules/logger.js';
import { grindNumber } from './grind-text.js';
import { pageHeading, pickSubtitle, dialInNames, liveWeightText, stepSteamFlow } from './page-model.js';
import { decentSyncSaves } from './sync-status.js';
import { askStatus, onStatus } from './decent-sync.js';
import { createPendingWrite } from './pending-write.js';
import { cafeText, formatRoastDay, setText } from './text.js';
import { openGrinderDialog } from './grinder-dialog.js';
import { openBeanDialog } from './bean-dialog.js';
import { openBasketDialog } from './basket-dialog.js';
import { openBaristaDialog, clearOnSleep } from './barista-dialog.js';
import { baristaName, asleep, baristaStamps } from './barista-model.js';
import { initProfileChanger } from './profile-changer.js';

const LIVE_WEIGHT_MS = 250;
const BATTERY_MS = 10_000;
const NAMES_GAP_MS = 300;
// Before a recipe loads, Streamline's steppers must have gone quiet for this
// long. One writes 300 ms after its last tap, and the Brew stepper reads the
// Workflow first: the wait covers that read, which no counter announces.
const SETTLE_QUIET_MS = 1000;
const SETTLE_MAX_MS = 3000; // the longest a recipe load waits for an earlier edit to land

let recipe = null;
let saved = false;      // Decent Sync saves this Machine's dial-in onto its loaded recipe
let names = { bean: '', roastDay: null, basket: '', grinder: '' };
let barista = '';       // the Workflow's barista, as last read or written: '' for none
let batch = null;       // the Bean Batch last read, kept while the Workflow still points at it
let namesSeq = 0;
let namesTimer = null;
let liveTimer = null;
let loading = false;    // a recipe loads, or the strip is arranged
let picking = 0;        // choices made in a pick dialog, not yet written
let picks = Promise.resolve(); // the last of them
let loads = 0;          // recipe loads begun or ended: a dialog read before one is stale

const el = id => document.getElementById(id);

// ── Title ────────────────────────────────────────────────────────────────────

// Streamline writes the active profile's name into #profile-name, on load and on
// every profile change. Reading it there keeps one source for it.
const profileName = () => (el('profile-name')?.textContent || '').trim();

function renderHeading() {
    const heading = pageHeading(recipe, profileName(), saved);
    setText(el('cafe-title'), heading.title, { translate: heading.translate });
    setText(el('cafe-subtitle'), heading.subtitle, { translate: heading.translate });
    setText(el('cafe-dial-label'), heading.dialLabel, { translate: true });
}

/** The loaded recipe changed, or was read again: null when none is loaded. */
export function showRecipe(next) {
    recipe = next;
    renderHeading();
}

// ── The barista ──────────────────────────────────────────────────────────────

// The Workflow's name, or "Barista" in the accent colour where there is none,
// the only prompt to pick one (cafe.css). Read with the dial-in's names.
function renderBarista() {
    const button = el('cafe-barista');
    if (!button) return;
    button.classList.toggle('cafe-barista-none', !barista);
    setText(el('cafe-barista-name'), barista || 'Barista', { translate: !barista });
    button.setAttribute('aria-label', barista ? `${cafeText('Barista')}: ${barista}` : cafeText('Barista'));
}

// `seeBarista(name)`: a write named the barista, shown at once. `lookBarista()`,
// as a read of the Workflow begins: what paints the barista it finds, unless a
// write, or a read begun later, has painted one since. Such a read is stale for
// the barista, though not for the dial-in's names.
const { see: seeBarista, look: lookBarista } = baristaStamps(name => {
    barista = name;
    renderBarista();
});

function openBarista() {
    openBaristaDialog({ mayOpen: mayPick, shown: () => barista, look: lookBarista, written: seeBarista, write: writePick });
}

// The machine seen asleep: the name is cleared, so each wake starts with none.
const clearAsleep = () => clearOnSleep({ write: writePick, written: seeBarista });

// ── Whether the dial-in is saved ─────────────────────────────────────────────

// The skin saves nothing onto a recipe itself. Decent Sync's plugin does, after
// every change on a Machine it serves, so the column says "saved to the recipe"
// only there. Its Status request says which (decent-sync.js), and is asked at
// start-up, when the page comes back into view and after each recipe load.
function showStatus(answer) {
    const next = decentSyncSaves(saved, answer);
    if (next === saved) return;
    saved = next;
    renderHeading();
}

// ── What the dial-in rows name ───────────────────────────────────────────────

function renderNames() {
    const roasted = names.roastDay ? cafeText('roasted {date}', { date: formatRoastDay(names.roastDay) }) : '';
    setText(el('cafe-dose-desc'), [names.bean, roasted].filter(Boolean).join(' · '));
    setText(el('cafe-yield-desc'), names.basket);
    setText(el('cafe-grind-desc'), names.grinder);
}

/** Read the Workflow again, and with it the barista, bean, roast date, basket and grinder. */
export async function refreshNames() {
    const seq = ++namesSeq;
    const paintBarista = lookBarista();
    let workflow;
    try {
        workflow = await getWorkflow();
    } catch (error) {
        return; // Decaid can't be reached: what is shown stays
    }
    if (seq !== namesSeq) return;
    paintBarista(baristaName(workflow?.context));
    const batchId = workflow?.context?.beanBatchId || null;
    if (!batchId) batch = null;
    else if (!batch || batch.id !== batchId) {
        // The row shows the bean at once and gains the roast date when it arrives.
        batch = null;
        names = dialInNames(workflow, null);
        renderNames();
        let read = null;
        try {
            read = await getBeanBatch(batchId);
        } catch (error) {
            logger.info(`Cafe: no roast date for batch ${batchId}: ${error.message}`);
        }
        // A newer read has begun, whether this one's batch arrived or failed:
        // its names are the ones to show.
        if (seq !== namesSeq) return;
        batch = read;
    }
    names = dialInNames(workflow, batch);
    renderNames();
}

// The Workflow's names and Decent Sync's status, read again a moment later, so a
// burst of reasons to look costs one read of each.
function refreshSoon() {
    if (namesTimer || document.hidden || isSubPage()) return;
    namesTimer = setTimeout(() => {
        namesTimer = null;
        refreshNames();
        askStatus();
    }, NAMES_GAP_MS);
}

/**
 * A recipe was just loaded or unloaded from the strip. Its names are read, and
 * Decent Sync is asked again: sharing turned off since the last answer would
 * otherwise leave "saved to the recipe" standing until the page next regained
 * focus.
 */
export function afterRecipeLoad() {
    refreshNames();
    askStatus();
}

// ── Steam flow ───────────────────────────────────────────────────────────────

// The page has one steam row, the flow, and steps it itself. Streamline's own
// steam − and + step whichever of time, flow and milk stop its tile's mode
// names, and that mode moves without the page: a recipe saved in time mode, or a
// milk probe unplugged and plugged back in. So those buttons are not on the
// page, and these write the flow the way Streamline's numpad does, whatever the
// mode.
const steamFlow = createPendingWrite({
    delayMs: API_DEBOUNCE_MS,
    write(flow) {
        window.app?.saveContextToActiveProfile?.({ targetSteamFlow: flow });
        return pushSteamSetting('flow', setTargetSteamFlow(flow)); // reports its own failure
    },
});

function stepSteam(direction, button) {
    if (isAutoSteamMode()) return; // Streamline's pitcher mode owns the steam settings
    flashPlusMinusButton(button);
    // From the flow stepped to and not yet written, when there is one: a re-read
    // of the Workflow may have painted the older value back meanwhile.
    const shown = parseFloat(el('steam-flow-value')?.textContent);
    const flow = stepSteamFlow(steamFlow.pending() ?? shown, direction);
    updateSteamDisplay({ targetSteamFlow: flow });
    steamFlow.set(flow);
}

// ── Before another recipe is loaded ──────────────────────────────────────────

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// The steam flow waiting to be written, and Streamline's own steppers: wait
// out their debounce and any write on the wire.
async function settleSteps() {
    await steamFlow.flush();
    const giveUpAt = Date.now() + SETTLE_MAX_MS;
    while (msSinceTileInteraction() < SETTLE_QUIET_MS || hasWorkflowWriteInFlight()) {
        if (Date.now() >= giveUpAt) throw new Error('An earlier change has not reached the machine yet.');
        await pause(50);
    }
}

/**
 * Resolves once dial-in edits made before now have reached the Workflow,
 * choices made in a pick dialog among them. A stepper writes a moment after
 * its last tap; written after a recipe load instead of before it, that edit
 * would change the recipe just loaded. Rejects when a write is still on the
 * wire after a few seconds: the load is then not made, because nothing says
 * which recipe that write would land on.
 */
export async function settleDialIn() {
    await picks;
    await settleSteps();
}

// The dial-in rows take no taps (cafe.css) while a recipe loads or a choice is
// written: a step made then could be written before or after either.
function keepStill() {
    el('main-page')?.classList.toggle('cafe-loading', loading || picking > 0);
}

/**
 * A recipe is loading, or has finished. The dial-in rows take no taps in
 * between: a step made while a recipe loads could be written before or after
 * the load, and belongs to neither recipe for certain.
 */
export function showLoading(next) {
    loading = next;
    loads += 1;
    keepStill();
}

// ── Pick dialogs ─────────────────────────────────────────────────────────────

// Not while a shot runs, a recipe loads, the strip is arranged, another choice
// is still being written, or the main page is behind another.
const mayPick = () => !loading && picking === 0 && !shotRunning() && !isSubPage();

/**
 * Write a choice made in a pick dialog: `send()` makes its one Workflow write.
 * A dial-in change still on its way is written first, and a recipe load tapped
 * meanwhile waits for the choice (settleDialIn), so the writes land in the
 * order they were made. Rejects where the change before it never landed, or a
 * shot started while it waited, and nothing is written then.
 */
function writePick(send) {
    picking += 1;
    keepStill();
    const run = picks.then(async () => {
        await settleSteps();
        // A shot that starts takes the screen back, a choice waiting to be written too.
        if (shotRunning()) throw new Error('A shot started before the choice was written.');
        return send();
    });
    picks = run.catch(() => {});
    return run.finally(() => {
        picking -= 1;
        keepStill();
    });
}

function openGrinder() {
    openGrinderDialog({ mayOpen: mayPick, epoch: () => loads, subtitle: () => pickSubtitle(recipe, saved), write: writePick });
}

function openBean() {
    openBeanDialog({ mayOpen: mayPick, epoch: () => loads, recipe: () => recipe, saved: () => saved, write: writePick });
}

function openBasket() {
    openBasketDialog({ mayOpen: mayPick, epoch: () => loads, subtitle: () => pickSubtitle(recipe, saved), write: writePick });
}

// ── During a shot ────────────────────────────────────────────────────────────

function paintLiveWeight() {
    const target = parseFloat(el('drink-out-value')?.textContent);
    const shown = liveWeightText(getScaleReading().weight, target);
    const block = el('cafe-live');
    const value = el('cafe-live-weight');
    if (!block || !value) return;
    if (value.textContent !== shown) value.textContent = shown;
    const display = shown ? 'flex' : 'none';
    if (block.style.display !== display) block.style.display = display;
}

// The legend's own change for a running shot is graph.js's. The class marks the
// page for cafe.css and the smoke run.
function shotStarted() {
    shotEnded();
    el('main-page')?.classList.add('cafe-shot-live');
    paintLiveWeight();
    liveTimer = setInterval(paintLiveWeight, LIVE_WEIGHT_MS);
}

function shotEnded() {
    clearInterval(liveTimer);
    liveTimer = null;
    el('main-page')?.classList.remove('cafe-shot-live');
    const block = el('cafe-live');
    if (block) block.style.display = 'none';
}

/** Is a shot running? The strip is not arranged during one. */
export function shotRunning() {
    return liveTimer !== null;
}

// ── Scale battery ────────────────────────────────────────────────────────────

// app.js keeps the level the scale last reported; nothing announces a change.
function paintBattery() {
    const level = typeof window.getLatestScaleBattery === 'function' ? window.getLatestScaleBattery() : null;
    const shown = Number.isFinite(Number(level)) && level !== null ? `${Math.round(Number(level))}%` : '';
    const battery = el('cafe-scale-battery');
    if (battery && battery.textContent !== shown) battery.textContent = shown;
}

// ── Settings and Sleep ───────────────────────────────────────────────────────

// At the bottom of the dial-in column, or at the top of the machine-button
// column while ui.js shows it (a machine with no buttons of its own).
function placeSystemButtons() {
    const system = el('cafe-system');
    const machineButtons = el('ghc-controls');
    const column = el('shot-settings');
    if (!system || !machineButtons || !column) return;
    const home = machineButtons.style.display === 'flex' ? machineButtons : column;
    if (system.parentElement === home) return;
    if (home === machineButtons) home.prepend(system);
    else home.append(system);
}

// ── Start ────────────────────────────────────────────────────────────────────

/**
 * Called once, when the page starts. `onProfileChange` runs when Streamline
 * writes another profile's name: a profile changed elsewhere can unload the
 * recipe, so the caller asks DYE2 again.
 */
export function initPage({ onProfileChange = () => {} } = {}) {
    renderHeading();
    renderBarista();
    renderNames();
    placeSystemButtons();
    paintBattery();
    refreshNames();
    onStatus(showStatus);
    askStatus();
    // The change of profile waits its turn as a pick does, and keeps the
    // dial-in still while it is written; a recipe load or unload from the strip
    // moves the epoch, which the check after it reads. A load or an arrangement
    // of the strip (`loading`) or a shot begun while it reads holds its writes.
    initProfileChanger({ mayChange: mayPick, settled: () => !loading && !shotRunning(), queue: writePick, epoch: () => loads, shotRunning });

    const profile = el('profile-name');
    if (profile) {
        new MutationObserver(() => { renderHeading(); onProfileChange(); })
            .observe(profile, { characterData: true, childList: true, subtree: true });
    }
    // The Grind value fits itself to its box: a preset grinder's setting is a
    // name, which can be wider than a number, and a number in the row's tabular
    // digits can be too (111.25 at 30 px). Streamline's data-fit-text measures
    // on a canvas, which draws digits narrower than the row does, and re-fits on
    // its own observers; so this measures the value itself, in layout pixels,
    // once for each new text and each new width. Only a name is cut, with an
    // ellipsis, past the 8 px floor; cafe.css fixes the line's height, so a new
    // size never resizes the box.
    const grind = el('grind-value');
    if (grind) {
        let fittedText = null;
        const fitGrind = (force = false) => {
            const text = grind.textContent;
            if (!force && text === fittedText) return;
            fittedText = text;
            const name = grindNumber(text) === null;
            grind.classList.toggle('cafe-grind-name', name);
            grind.style.fontSize = '';
            // A name keeps Streamline's 4 px each side; a number is shrunk only
            // once it is wider than the box, so every number that fitted before
            // keeps the column's 30 px.
            const room = grind.clientWidth - (name ? 8 : 0);
            if (room <= 0 || grind.scrollWidth <= room) return;
            const size = parseFloat(getComputedStyle(grind).fontSize);
            grind.style.fontSize = `${Math.max(8, Math.floor(size * room / grind.scrollWidth))}px`;
        };
        new MutationObserver(() => fitGrind()).observe(grind, { characterData: true, childList: true, subtree: true });
        if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => fitGrind(true)).observe(grind);
        fitGrind(true);
    }
    const machineButtons = el('ghc-controls');
    if (machineButtons) new MutationObserver(placeSystemButtons).observe(machineButtons, { attributes: true, attributeFilter: ['style'] });

    for (const [id, direction] of [['cafe-steam-minus', -1], ['cafe-steam-plus', 1]]) {
        el(id)?.addEventListener('click', event => stepSteam(direction, event.currentTarget));
    }
    // The Grind row's name and the grinder's under it are one button, and so
    // are Dose's with the bean and Yield's with the basket. Streamline's own tap
    // on #grind-label, inside it, never fires: cafe.css takes pointer events off
    // the labels, so a tap lands on the button and never passes through a label.
    el('cafe-grind-pick')?.addEventListener('click', openGrinder);
    el('cafe-dose-pick')?.addEventListener('click', openBean);
    el('cafe-yield-pick')?.addEventListener('click', openBasket);
    // During a shot, or a recipe load, the button shows the name and opens
    // nothing: Decaid names the Shot from the Workflow as it stores it.
    el('cafe-barista')?.addEventListener('click', openBarista);
    // Each wake starts with no barista: the name is cleared as the machine is
    // seen asleep, going to sleep or in the first frame of a page opened on it
    // asleep (the hook in api.js). The state is read once at start too, for a
    // sleeping machine that sends no frame; a second clear finds no name and
    // writes nothing.
    document.addEventListener('streamline:machine-asleep', clearAsleep);
    getMachineState().then(snapshot => { if (asleep(snapshot)) clearAsleep(); }).catch(() => {});
    setInterval(paintBattery, BATTERY_MS);
    document.addEventListener('streamline:espresso-start', shotStarted);
    document.addEventListener('streamline:espresso-end', shotEnded);

    // The Workflow has no push channel either: look again when the page comes
    // back into view, and when a plugin says it changed.
    window.addEventListener('focus', refreshSoon);
    window.addEventListener('pageshow', refreshSoon);
    document.addEventListener('visibilitychange', refreshSoon);
    document.addEventListener('streamline:mainpagevisible', refreshSoon);
    document.addEventListener('streamline:workflow-refresh', refreshSoon);
    // Keyed text follows the language by itself (text.js). The roast date is put
    // together here, so it is drawn again.
    document.addEventListener('streamline:languagechange', renderNames);
    document.addEventListener('streamline:languagechange', renderBarista);
}
