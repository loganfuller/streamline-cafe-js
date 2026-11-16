// Where Streamline Cafe starts: the check that DYE2 is there, then the page
// (docs/cafe/DESIGN.md, "Recipes and the strip").
//
// app.js asks `cafeMayStart()` before it starts the main page, each time the
// main page is about to start: at boot, and on every return from a subpage until
// the page has started. So leaving the settings page comes back to the check.
import { getPlugins } from '../modules/api.js';
import { settingsReady, SETTINGS_RESTORED_EVENT } from '../modules/settingsSync.js';
import { DYE2_ENABLED_KEY, isDye2Enabled } from '../modules/dye2-enabled.js';
import { initDyeStrip } from '../modules/dyeStrip.js';
import { isSubPage } from '../modules/router.js';
import { logger } from '../modules/logger.js';
import { dye2Gate } from './dye2-gate.js';
import { showGate, hideGate, checkAgain } from './gate-screen.js';
import { initStrip, refreshStripSoon } from './strip.js';
import { initPage, showRecipe, afterRecipeLoad, settleDialIn, showLoading, shotRunning } from './page.js';

// A Decaid that does not answer must not hold a blank page for as long as the
// request takes to fail.
const PLUGIN_READ_MS = 5000;

let started = false;
let watching = false;

// Decaid's plugin list, or null when it could not be read in time.
function readPlugins() {
    return Promise.race([
        getPlugins().catch(() => null),
        new Promise(resolve => setTimeout(() => resolve(null), PLUGIN_READ_MS)),
    ]);
}

function watch() {
    if (watching) return;
    watching = true;
    // settingsReady resolves even when Decaid did not answer, and the setting then
    // arrives later through this event: look again, in case the screen is showing
    // for a setting that was on all along.
    window.addEventListener(SETTINGS_RESTORED_EVENT, event => {
        if (started || !(DYE2_ENABLED_KEY in (event.detail || {}))) return;
        checkAgain();
    });
    // DYE2 switched off in Settings while the page was running: the page does not
    // run without it, so start over, which lands on the "DYE2 is needed" screen.
    document.addEventListener('streamline:mainpagevisible', () => {
        if (started && !isDye2Enabled()) window.location.reload();
    });
    // Streamline's "?" button explains Streamline's page, part by part. cafe.css
    // keeps it off this page, and off the "DYE2 is needed" screen, and leaves it
    // on the settings and profile pages.
    const root = document.documentElement;
    root.classList.toggle('cafe-main-shown', !isSubPage());
    document.addEventListener('streamline:mainpagevisible', () => root.classList.add('cafe-main-shown'));
    document.addEventListener('streamline:mainpagehidden', () => root.classList.remove('cafe-main-shown'));
}

function startPage() {
    // Streamline's strip module, with nothing to draw into: it still tells DYE2
    // which recipe is loaded, restores the selection after a trip to DYE2's
    // editor, and re-reads DYE2's records when the page regains focus.
    initDyeStrip().catch(error => logger.warn('Cafe: Streamline\'s strip module failed to start', error));
    initPage({ onProfileChange: refreshStripSoon });
    initStrip({ onChange: showRecipe, onBeforeLoad: settleDialIn, onLoading: showLoading, onApply: afterRecipeLoad, isShotRunning: shotRunning })
        .catch(error => logger.warn('Cafe: could not read the recipes', error));
    // The graph was laid out while the page was hidden.
    window.dispatchEvent(new Event('resize'));
}

/**
 * May the main page start? Shows the "DYE2 is needed" screen and answers false
 * while a check fails; starts the cafe page and answers true once none does.
 */
export async function cafeMayStart() {
    if (started) return true;
    watch();
    await settingsReady;
    const reason = dye2Gate({ plugins: await readPlugins(), enabled: isDye2Enabled() });
    if (reason) {
        showGate(reason);
        return false;
    }
    started = true;
    hideGate();
    startPage();
    return true;
}
