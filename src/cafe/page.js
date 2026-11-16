// The cafe page around the strip: the title, what each dial-in row names, the
// weight during a shot, the scale's battery, and where Settings and Sleep sit
// (docs/cafe/DESIGN.md, "What the screen shows").
//
// Streamline's modules still paint the steppers, the status line, the telemetry
// row and the graph. This module adds what they have no word for, and reads
// what it needs from where they already write it.
import { getWorkflow, getBeanBatch, getScaleReading, setTargetSteamFlow, hasWorkflowWriteInFlight, getPlugins, callPluginEndpoint } from '../modules/api.js';
import { updateSteamDisplay, pushSteamSetting, isAutoSteamMode, flashPlusMinusButton, msSinceTileInteraction } from '../modules/ui.js';
import { API_DEBOUNCE_MS } from '../modules/workflow-watch.js';
import { isSubPage } from '../modules/router.js';
import { logger } from '../modules/logger.js';
import { pageHeading, decentSyncSaves, statusUnknown, statusRetryMs, dialInNames, liveWeightText, stepSteamFlow } from './page-model.js';
import { createPendingWrite } from './pending-write.js';
import { cafeText, setText } from './text.js';

const LIVE_WEIGHT_MS = 250;
const BATTERY_MS = 10_000;
const NAMES_GAP_MS = 300;
// Before a recipe loads, Streamline's steppers must have gone quiet for this
// long. One writes 300 ms after its last tap, and the Brew stepper reads the
// Workflow first: the wait covers that read, which no counter announces.
const SETTLE_QUIET_MS = 1000;
const SETTLE_MAX_MS = 3000; // the longest a recipe load waits for an earlier edit to land

const DECENT_SYNC_PLUGIN_ID = 'decent-sync.reaplugin';

let recipe = null;
let saved = false;      // Decent Sync saves this Machine's dial-in onto its loaded recipe
let savedSeq = 0;
let savedRetry = null;  // the timer to ask again, while no answer has come either way
let savedTries = 0;
let names = { bean: '', roastDay: null, basket: '', grinder: '' };
let batch = null;       // the Bean Batch last read, kept while the Workflow still points at it
let namesSeq = 0;
let namesTimer = null;
let liveTimer = null;

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

// ── Whether the dial-in is saved ─────────────────────────────────────────────

// The skin saves nothing onto a recipe itself. Decent Sync's plugin does, after
// every change on a Machine it serves, so the column says "saved to the recipe"
// only there. This is its Status request, in the shape decentSyncSaves reads.
async function readDecentSync() {
    const plugins = await getPlugins();
    if (!Array.isArray(plugins)) return {}; // Decaid did not answer
    if (!plugins.some(plugin => plugin && plugin.id === DECENT_SYNC_PLUGIN_ID && plugin.loaded)) return null;
    try {
        return await callPluginEndpoint(DECENT_SYNC_PLUGIN_ID, 'status', null, 'GET');
    } catch (error) {
        if (error.code) return { code: error.code }; // a refusal, which says why
        // Decaid answers 404 itself for a plugin too old to have a Status request.
        return error.status === 404 ? null : {};
    }
}

async function readSaved() {
    clearTimeout(savedRetry);
    savedRetry = null;
    const seq = ++savedSeq;
    const answer = await readDecentSync();
    if (seq !== savedSeq) return; // a newer read has begun
    // No answer either way, as when the skin loads before the plugin has
    // connected: ask again shortly, and more slowly each time, until one comes.
    // A tablet that stays on this page fires none of the events below.
    if (statusUnknown(answer)) {
        savedTries += 1;
        savedRetry = setTimeout(refreshSaved, statusRetryMs(savedTries));
    } else {
        savedTries = 0;
    }
    const next = decentSyncSaves(saved, answer);
    if (next === saved) return;
    saved = next;
    renderHeading();
}

/** Ask Decent Sync again whether it saves this Machine's dial-in. */
export function refreshSaved() {
    readSaved().catch(error => logger.warn('Cafe: could not ask Decent Sync for its status', error));
}

// ── What the dial-in rows name ───────────────────────────────────────────────

// "28 Oct", in the tablet's own language. The day is a calendar day, so it is
// formatted in UTC, where roastDay() read it.
function formatRoastDay(day) {
    try {
        return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
    } catch (error) {
        return day;
    }
}

function renderNames() {
    const roasted = names.roastDay ? `${cafeText('roasted')} ${formatRoastDay(names.roastDay)}` : '';
    setText(el('cafe-dose-desc'), [names.bean, roasted].filter(Boolean).join(' · '));
    setText(el('cafe-yield-desc'), names.basket);
    setText(el('cafe-grind-desc'), names.grinder);
}

/** Read the Workflow again, and with it the bean, roast date, basket and grinder. */
export async function refreshNames() {
    const seq = ++namesSeq;
    let workflow;
    try {
        workflow = await getWorkflow();
    } catch (error) {
        return; // Decaid can't be reached: what is shown stays
    }
    if (seq !== namesSeq) return;
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
        refreshSaved();
    }, NAMES_GAP_MS);
}

/**
 * A recipe was just loaded from the strip. Its names are read, and Decent Sync
 * is asked again: sharing turned off since the last answer would otherwise
 * leave "saved to the recipe" standing until the page next regained focus.
 */
export function afterRecipeLoad() {
    refreshNames();
    refreshSaved();
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

/**
 * Resolves once dial-in edits made before now have reached the Workflow. A
 * stepper writes a moment after its last tap; written after a recipe load
 * instead of before it, that edit would change the recipe just loaded. Rejects
 * when a write is still on the wire after a few seconds: the load is then not
 * made, because nothing says which recipe that write would land on.
 */
export async function settleDialIn() {
    await steamFlow.flush();
    // Streamline's own steppers: wait out their debounce and any write on the wire.
    const giveUpAt = Date.now() + SETTLE_MAX_MS;
    while (msSinceTileInteraction() < SETTLE_QUIET_MS || hasWorkflowWriteInFlight()) {
        if (Date.now() >= giveUpAt) throw new Error('An earlier change has not reached the machine yet.');
        await pause(50);
    }
}

/**
 * A recipe is loading, or has finished. The dial-in rows take no taps in
 * between (cafe.css): a step made while a recipe loads could be written before
 * or after the load, and belongs to neither recipe for certain.
 */
export function showLoading(loading) {
    el('main-page')?.classList.toggle('cafe-loading', loading);
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

// While a shot runs the graph draws that shot, so the legend's "Latest" and its
// time, which are the Shot before it, are hidden (cafe.css, .cafe-shot-live).
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
    renderNames();
    placeSystemButtons();
    paintBattery();
    refreshNames();
    refreshSaved();

    const profile = el('profile-name');
    if (profile) {
        new MutationObserver(() => { renderHeading(); onProfileChange(); })
            .observe(profile, { characterData: true, childList: true, subtree: true });
    }
    const machineButtons = el('ghc-controls');
    if (machineButtons) new MutationObserver(placeSystemButtons).observe(machineButtons, { attributes: true, attributeFilter: ['style'] });

    for (const [id, direction] of [['cafe-steam-minus', -1], ['cafe-steam-plus', 1]]) {
        el(id)?.addEventListener('click', event => stepSteam(direction, event.currentTarget));
    }
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
    document.addEventListener('streamline:languagechange', () => { renderHeading(); renderNames(); });
}
