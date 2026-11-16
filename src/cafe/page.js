// The cafe page around the strip: the title, what each dial-in row names, the
// weight during a shot, the scale's battery, and where Settings and Sleep sit
// (docs/cafe/DESIGN.md, "What the screen shows").
//
// Streamline's modules still paint the steppers, the status line, the telemetry
// row and the graph. This module adds what they have no word for, and reads
// what it needs from where they already write it.
import { getWorkflow, getBeanBatch, getScaleReading } from '../modules/api.js';
import { setSteamTileModeIfSafe } from '../modules/ui.js';
import { isSubPage } from '../modules/router.js';
import { logger } from '../modules/logger.js';
import { pageHeading, dialInNames, liveWeightText } from './page-model.js';
import { createHoldRepeat } from './hold-repeat.js';
import { cafeText, setText } from './text.js';

const LIVE_WEIGHT_MS = 250;
const BATTERY_MS = 10_000;
const NAMES_GAP_MS = 300;
// Each stepper's − and + are `<name>-minus` and `<name>-plus`.
const STEPPERS = ['dose-in', 'drink-out', 'grind', 'temp', 'flush', 'steam', 'hot-water-vol'];

let recipe = null;
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
    const heading = pageHeading(recipe, profileName());
    setText(el('cafe-title'), heading.title, { translate: heading.translate });
    setText(el('cafe-subtitle'), heading.subtitle, { translate: heading.translate });
    setText(el('cafe-dial-label'), heading.dialLabel, { translate: true });
}

/** The loaded recipe changed, or was read again: null when none is loaded. */
export function showRecipe(next) {
    recipe = next;
    renderHeading();
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
        try {
            const read = await getBeanBatch(batchId);
            if (seq !== namesSeq) return;
            batch = read;
        } catch (error) {
            logger.info(`Cafe: no roast date for batch ${batchId}: ${error.message}`);
        }
    }
    names = dialInNames(workflow, batch);
    renderNames();
}

function refreshNamesSoon() {
    if (namesTimer || document.hidden || isSubPage()) return;
    namesTimer = setTimeout(() => { namesTimer = null; refreshNames(); }, NAMES_GAP_MS);
}

/** A recipe was just loaded from the strip. */
export function afterRecipeLoad() {
    pinSteamFlow();
    refreshNames();
}

// ── Steam ────────────────────────────────────────────────────────────────────

// The page has one steam row, the flow. Streamline's tile steps whichever of
// time and flow its mode names, and loading a recipe saved in time mode moves it
// there, so the mode is put back to flow at start-up and after each load.
function pinSteamFlow() {
    setSteamTileModeIfSafe('flow');
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

// ── Holding − or + ───────────────────────────────────────────────────────────

function wireHoldRepeat() {
    for (const name of STEPPERS) {
        for (const end of ['minus', 'plus']) {
            const button = el(`${name}-${end}`);
            if (!button) continue;
            const hold = createHoldRepeat({ fire: () => { if (!button.disabled) button.click(); } });
            // After a repeat, lifting the finger must not step once more.
            let swallowTap = false;
            const release = () => { if (hold.release()) swallowTap = true; };
            button.addEventListener('pointerdown', event => {
                if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return;
                swallowTap = false;
                hold.press();
            });
            for (const type of ['pointerup', 'pointercancel', 'pointerleave']) button.addEventListener(type, release);
            // A long touch must not open the WebView's own menu.
            button.addEventListener('contextmenu', event => event.preventDefault());
            // On the parent, in the capture phase, so it runs before Streamline's own
            // click handler on the button whichever was registered first. A repeat's
            // step is a click the page made itself (isTrusted false) and passes.
            button.parentElement.addEventListener('click', event => {
                if (!swallowTap || !event.isTrusted || !button.contains(event.target)) return;
                swallowTap = false;
                event.stopPropagation();
                event.preventDefault();
            }, true);
        }
    }
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
    pinSteamFlow();
    placeSystemButtons();
    paintBattery();
    refreshNames();

    const profile = el('profile-name');
    if (profile) {
        new MutationObserver(() => { renderHeading(); onProfileChange(); })
            .observe(profile, { characterData: true, childList: true, subtree: true });
    }
    const machineButtons = el('ghc-controls');
    if (machineButtons) new MutationObserver(placeSystemButtons).observe(machineButtons, { attributes: true, attributeFilter: ['style'] });

    wireHoldRepeat();
    setInterval(paintBattery, BATTERY_MS);
    document.addEventListener('streamline:espresso-start', shotStarted);
    document.addEventListener('streamline:espresso-end', shotEnded);

    // The Workflow has no push channel either: look again when the page comes
    // back into view, and when a plugin says it changed.
    window.addEventListener('focus', refreshNamesSoon);
    window.addEventListener('pageshow', refreshNamesSoon);
    document.addEventListener('visibilitychange', refreshNamesSoon);
    document.addEventListener('streamline:mainpagevisible', refreshNamesSoon);
    document.addEventListener('streamline:workflow-refresh', refreshNamesSoon);
    document.addEventListener('streamline:languagechange', () => { renderHeading(); renderNames(); });
}
