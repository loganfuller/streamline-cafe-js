// The page's one way to write a batch chosen in the bean and batch dialog,
// bound to Decaid and DYE2 (docs/cafe/DESIGN.md, "The bean and batch dialog").
// What it decides is worked out in bean-change.js, which touches no browser
// global.
//
// The bean dialog (bean-dialog.js) calls it, and nothing else on the page does.
import { getWorkflow, getDye2KvArray, callPluginEndpoint, updateWorkflow, getEspressoEndedAt } from '../modules/api.js';
import { logger } from '../modules/logger.js';
import { DYE2_PLUGIN_ID } from './dye2-gate.js';
import { setRecipeFields } from './recipe-writer.js';
import { waitOutStore } from './barista-model.js';
import { createBeanChange } from './bean-change.js';

const SHOT_POLL_MS = 250;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// What DYE2 says is loaded, or undefined when it could not be asked.
async function readSelection() {
    try {
        return await callPluginEndpoint(DYE2_PLUGIN_ID, 'selection', null, 'GET');
    } catch (error) {
        return undefined;
    }
}

let change = null;

/**
 * Called once, as the page starts, with the page's own: `settled()`, no shot
 * running and no recipe load or arrangement of the strip under way;
 * `queue(task)`, the page's write of a choice in its turn; and `shotRunning()`.
 */
export function initBeanChanger({ settled, queue, shotRunning }) {
    change = createBeanChange({
        settled,
        queue,
        readSelection,
        readWorkflow: getWorkflow,
        readRecords: () => getDye2KvArray('recipes'),
        saveRecord: setRecipeFields,
        writeWorkflow: patch => updateWorkflow(patch, 'beans.select'),
        async idle() {
            while (shotRunning()) await sleep(SHOT_POLL_MS);
            await waitOutStore(getEspressoEndedAt, Date.now, sleep);
        },
        wait: sleep,
        onChecked(outcome, recipeId) {
            const line = `Cafe: the check after a bean change on recipe ${recipeId}: ${outcome}`;
            if (['held', 'rewritten', 'superseded'].includes(outcome)) logger.info(line);
            else logger.warn(line);
            // The cards and the names follow the record written again.
            if (outcome === 'rewritten' || outcome === 'workflow') document.dispatchEvent(new CustomEvent('streamline:workflow-refresh'));
        },
    }).change;
}

/**
 * Write `batch` of `bean`: with `recipeId`, the recipe whose record takes the
 * bean first (it must still be the one DYE2 has loaded); without, the Workflow
 * alone. See `createBeanChange` in bean-change.js for the answer.
 */
export function changeBean(pick) {
    if (!change) return Promise.resolve({ ok: false, reason: 'busy' });
    return change(pick);
}
