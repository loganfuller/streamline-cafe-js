// The page's one way to change the profile, bound to Decaid, DYE2 and
// Streamline (docs/cafe/DESIGN.md, "Changing the profile"). What it decides is
// worked out in profile-change.js, which touches no browser global.
//
// The profile dialog (profile-dialog.js) calls it, and nothing else on the page
// does. The page tests (test/page/profile-change.spec.mjs) call `changeProfile`
// from the page itself too.
import { getProfiles, getWorkflow, getDye2KvArray, callPluginEndpoint, updateWorkflow, getEspressoEndedAt } from '../modules/api.js';
import { setActiveProfile, availableProfiles, loadAvailableProfiles } from '../modules/profileManager.js';
import { logger } from '../modules/logger.js';
import { DYE2_PLUGIN_ID } from './dye2-gate.js';
import { setRecipeFields } from './recipe-writer.js';
import { markLoaded } from './arrange.js';
import { waitOutStore } from './barista-model.js';
import { createProfileChange } from './profile-change.js';

const SHOT_POLL_MS = 250;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Decaid's own record of the profile, as it holds it. api.js reads the list
// whole, as Streamline's strip finds a recipe's profile by its id.
async function readProfile(id) {
    const records = await getProfiles();
    return Array.isArray(records) ? records.find(record => record && record.id === id) || null : null;
}

// What DYE2 says is loaded, or undefined when it could not be asked.
async function readSelection() {
    try {
        return await callPluginEndpoint(DYE2_PLUGIN_ID, 'selection', null, 'GET');
    } catch (error) {
        return undefined;
    }
}

// Streamline follows at once, before the dial-in rows take taps again: its
// active profile, which its per-profile saves go to and the Brew stepper takes
// the profile's shape from; and, as after a recipe load, the name under Brew,
// the temperature and the chart's profile (app.js `loadInitialData`, which
// also binds the active profile by title and keeps the one set here). Its
// Workflow watch would get there by itself only after a moment, and a step made
// meanwhile would be saved onto the old profile.
//
// Streamline's list of profiles is read at start. A profile that reached
// Decaid since, or was shown or changed since (from Decent Sync's Library,
// say), is read into it first, else the binding by title, which passes over a
// hidden record, would take another of the same title, and the Brew stepper
// that one's curve.
const sameRecord = (a, b) => !!a && (a.visibility ?? null) === (b.visibility ?? null)
    && JSON.stringify(a.profile ?? null) === JSON.stringify(b.profile ?? null);

async function follow(record) {
    if (!sameRecord(availableProfiles[record.id], record)) {
        try {
            await loadAvailableProfiles();
        } catch (error) {
            logger.warn('Cafe: Streamline could not read the profiles again after the profile changed', error);
        }
    }
    setActiveProfile(record.id);
    try {
        if (typeof window.loadInitialData === 'function') await window.loadInitialData();
    } catch (error) {
        logger.warn('Cafe: Streamline could not read the Workflow after the profile changed', error);
    }
    document.dispatchEvent(new CustomEvent('streamline:workflow-refresh'));
}

let change = null;

/**
 * Called once, as the page starts, with the page's own: `mayChange()`, as a
 * pick may open; `settled()`, no shot running and no recipe load or
 * arrangement of the strip under way; `queue(task)`, the page's write of a
 * choice in its turn; `epoch()`, which a recipe load or unload from the strip
 * moves; and `shotRunning()`.
 */
export function initProfileChanger({ mayChange, settled, queue, epoch, shotRunning }) {
    change = createProfileChange({
        mayChange,
        settled,
        queue,
        readProfile,
        readSelection,
        readWorkflow: getWorkflow,
        readRecords: () => getDye2KvArray('recipes'),
        saveRecord: setRecipeFields,
        writeWorkflow: patch => updateWorkflow(patch, 'cafe.profile'),
        follow,
        async markLoaded(id) {
            await markLoaded(id);
            document.dispatchEvent(new CustomEvent('streamline:workflow-refresh'));
        },
        epoch,
        async idle() {
            while (shotRunning()) await sleep(SHOT_POLL_MS);
            await waitOutStore(getEspressoEndedAt, Date.now, sleep);
        },
        wait: sleep,
        onChecked(outcome, recipeId) {
            const line = `Cafe: the check after a profile change on recipe ${recipeId}: ${outcome}`;
            if (['held', 'rewritten', 'followed', 'reloaded', 'tapped', 'superseded'].includes(outcome)) logger.info(line);
            else logger.warn(line);
            // The cards and the names follow the record written again.
            if (outcome === 'rewritten') document.dispatchEvent(new CustomEvent('streamline:workflow-refresh'));
        },
    }).change;
}

/**
 * Change the profile to Decaid's profile `profileId`, keeping a loaded recipe
 * loaded with the profile saved onto it. `options.recipeId`, where given, is
 * the recipe the caller expects loaded (null for none), and the change is
 * refused where another is. See `createProfileChange` in profile-change.js for
 * the answer.
 */
export function changeProfile(profileId, options) {
    if (!change) return Promise.resolve({ ok: false, reason: 'busy' });
    return change(profileId, options);
}
