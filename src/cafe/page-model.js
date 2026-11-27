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
 * recipe (`decentSyncSaves` in sync-status.js). The skin saves nothing itself, so only then does
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
 * The line under a pick dialog's title (the grinder's, for now): whether a
 * choice is saved, as the dial-in column's label says. A translation key, with
 * the recipe's name in `vars` where one is loaded.
 *
 * A choice writes the Workflow only. Where Decent Sync saves (`saved`) it
 * records the loaded Recipe's grinder from that write; elsewhere a choice is
 * this machine's until another recipe loads, and with no recipe it changes this
 * machine only. Through an outage `saved` keeps its last answer, so this does too.
 */
export function pickSubtitle(recipe, saved = false) {
    if (!recipe) return { key: 'No recipe loaded · changes this machine only' };
    return {
        key: saved ? '{recipe} · saved to the recipe' : '{recipe} · not saved to the recipe',
        vars: { recipe: recipeName(recipe) },
    };
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

/** What Yield and Grind name, from the Workflow: the basket and the grinder. */
export function dialInNames(workflow) {
    const context = (workflow && workflow.context) || {};
    return {
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
