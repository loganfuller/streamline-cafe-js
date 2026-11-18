// The page's one way to change the profile, bound to Decaid, DYE2 and
// Streamline (docs/cafe/DESIGN.md, "Changing the profile"). What it decides is
// worked out in profile-change.js, which touches no browser global.
//
// Nothing on the page calls it yet: the profile dialog (issue #51) will. The
// smoke run calls `changeProfile` from the page itself.
import { getProfiles, getWorkflow, getDye2KvArray, callPluginEndpoint, updateWorkflow, getEspressoEndedAt } from '../modules/api.js';
import { setActiveProfile } from '../modules/profileManager.js';
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
async function follow(record) {
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
 * pick may open; `queue(task)`, the page's write of a choice in its turn;
 * `epoch()`, which a recipe load or unload from the strip moves; and
 * `shotRunning()`.
 */
export function initProfileChanger({ mayChange, queue, epoch, shotRunning }) {
    change = createProfileChange({
        mayChange,
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
            if (outcome === 'held' || outcome === 'rewritten' || outcome === 'reloaded' || outcome === 'tapped') logger.info(line);
            else logger.warn(line);
        },
    }).change;
}

/**
 * Change the profile to Decaid's profile `profileId`, keeping a loaded recipe
 * loaded with the profile saved onto it. See `createProfileChange` in
 * profile-change.js for the answer.
 */
export function changeProfile(profileId) {
    if (!change) return Promise.resolve({ ok: false, reason: 'busy' });
    return change(profileId);
}
