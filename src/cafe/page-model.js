// The words on the cafe page that follow the loaded recipe and the Workflow
// (docs/cafe/DESIGN.md, "What the screen shows"). No browser global is touched.
import { recipeName, recipeBean } from './strip-model.js';

/**
 * The title, the line under it and the dial-in column's label.
 *
 * With a recipe loaded the title and subtitle are the recipe's own words. With
 * none they are translation keys, as `dialLabel` always is, and `translate`
 * says which.
 *
 * `saved` is whether Decent Sync saves this Machine's dial-in onto its loaded
 * recipe (`decentSyncSaves`). The skin saves nothing itself, so only then does
 * the column say the dial-in is saved.
 */
export function pageHeading(recipe, profileName, saved = false) {
    if (!recipe) {
        return {
            translate: true,
            title: 'No recipe selected',
            subtitle: 'Tap a recipe to load it',
            dialLabel: 'Dial-in · not saved to a recipe',
        };
    }
    return {
        translate: false,
        title: recipeName(recipe),
        subtitle: [recipeBean(recipe), profileName].filter(Boolean).join(' · '),
        dialLabel: saved ? 'Dial-in · saved to the recipe' : 'Dial-in · not saved to the recipe',
    };
}

/**
 * Does Decent Sync save this Machine's dial-in onto its loaded recipe? Its
 * plugin does so on a Machine it serves: one at a Location, sharing, connected
 * as itself. `answer` is what its Status request said:
 *
 * - `{ served: true }`: it does.
 * - `{ code }` of `unreachable` or `serverTooOld`: the server could not be
 *   asked. The plugin goes on saving on the tablet through an outage, and the
 *   last answer stands. So does it when Decaid itself did not answer (`{}`).
 * - any other refusal, as for a Capture-only Machine, or `null` for no Decent
 *   Sync plugin loaded: it does not.
 */
export function decentSyncSaves(previous, answer) {
    if (!answer) return false;
    if (answer.served === true) return true;
    return statusUnknown(answer) ? !!previous : false;
}

/**
 * Did the Status request say nothing either way? The server could not be asked,
 * or Decaid itself did not answer. The page then asks again shortly: at
 * start-up the skin can load before the plugin has connected, and the label
 * must not wait for the page to regain focus to be right.
 */
export function statusUnknown(answer) {
    if (!answer || answer.served === true) return false;
    return answer.code === undefined || answer.code === 'unreachable' || answer.code === 'serverTooOld';
}

// How long to wait before asking again, having asked `tries` times with no
// answer either way: 30 s, then twice as long each time, to 5 minutes. A plugin
// that never connects, as one installed and never set up, is not asked for ever
// at the first pace.
export function statusRetryMs(tries) {
    return Math.min(300_000, 30_000 * 2 ** Math.max(0, tries - 1));
}

const text = value => (typeof value === 'string' ? value.trim() : '');

/**
 * The day a batch was roasted, as YYYY-MM-DD, or null. Decaid stores a roast
 * date as an instant at midnight UTC, so the day is read from the text: a local
 * Date would show the day before, west of Greenwich.
 */
export function roastDay(roastDate) {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(text(roastDate));
    return match ? match[1] : null;
}

/**
 * What Dose, Yield and Grind name, from the Workflow: the bean and its roast
 * day, the basket and the grinder. `batch` is the Bean Batch the Workflow
 * points at, and is ignored when it is another batch's record.
 */
export function dialInNames(workflow, batch) {
    const context = (workflow && workflow.context) || {};
    const sameBatch = batch && context.beanBatchId && batch.id === context.beanBatchId;
    return {
        bean: text(context.coffeeName),
        roastDay: sameBatch ? roastDay(batch.roastDate) : null,
        basket: text(context.extras && context.extras.basketName),
        grinder: text(context.grinderModel),
    };
}

// Steam flow, in ml/s, steps by a tenth between these, as Streamline's steam
// tile steps it.
export const STEAM_FLOW_MAX = 2.5;

/**
 * The steam flow one step up (+1) or down (-1) from `flow`. Rounded each step,
 * so repeated tenths do not drift into 0.30000000000000004.
 */
export function stepSteamFlow(flow, direction) {
    const from = Number.isFinite(flow) ? flow : 0;
    const next = Math.round((from + direction * 0.1) * 10) / 10;
    return Math.min(STEAM_FLOW_MAX, Math.max(0, next));
}

/**
 * The weight in the cup against its target while a shot runs: "24.3 / 36 g",
 * "24.3 g" with no target, and nothing with no scale reading.
 */
export function liveWeightText(weight, target) {
    if (!Number.isFinite(weight)) return '';
    const grams = weight.toFixed(1);
    if (!Number.isFinite(target) || target <= 0) return `${grams} g`;
    return `${grams} / ${Number.isInteger(target) ? target : target.toFixed(1)} g`;
}
