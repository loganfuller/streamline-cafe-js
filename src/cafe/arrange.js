// Arranging the strip from a card's long-press menu: a new recipe made from
// what the machine is set to, a recipe chosen for a slot, and a recipe taken
// out of its slot (docs/cafe/DESIGN.md, "Recipes and the strip").
//
// None of it opens DYE2's editor. A recipe is made by DYE2's own `save-recipe`
// request, which builds it from the Workflow and marks it as the loaded one.
// Slots are written by recipe-writer.js. A recipe that leaves its slot stays in
// DYE2 with none, and can be chosen again.
import { callPluginEndpoint } from '../modules/api.js';
import { showToast } from '../modules/ui.js';
import { logger } from '../modules/logger.js';
import { DYE2_PLUGIN_ID } from './dye2-gate.js';
import { placeInSlot, removeFromSlot } from './recipe-writer.js';
import { recipeName } from './strip-model.js';
import { cafeText } from './text.js';

const failed = text => showToast(text, 4000, 'error');

// A recipe that has left the strip is no longer the loaded one: a change made
// on the machine must not go on being saved onto a recipe with no card. Which
// recipe is loaded is a marker in the Workflow, and DYE2's selection request
// clears that marker alone, so what the machine is set to does not change.
async function unloadIfLoaded(recipeId) {
    try {
        const selection = await callPluginEndpoint(DYE2_PLUGIN_ID, 'selection', null, 'GET');
        if (!selection || selection.kind !== 'recipe' || String(selection.id) !== String(recipeId)) return;
        await callPluginEndpoint(DYE2_PLUGIN_ID, 'selection', {});
    } catch (error) {
        // The page goes on naming the recipe as loaded, which is then still true.
        logger.warn('Cafe: could not unload the recipe that left its slot', error);
    }
}

/**
 * Make a recipe from what the machine is set to, and put it in `slot`. DYE2
 * names it, from the profile and the bean, and it is the loaded recipe
 * afterwards. `holderId` is the recipe the card showed, or null for an empty
 * slot: a slot that holds another by now is left alone.
 */
export async function makeRecipeIn(slot, holderId) {
    let made;
    try {
        made = await callPluginEndpoint(DYE2_PLUGIN_ID, 'save-recipe', {});
        if (!made || made.id == null) throw new Error('DYE2 answered without a recipe');
    } catch (error) {
        logger.error('Cafe: could not make a recipe from the Workflow', error);
        failed(cafeText('Could not make a new recipe'));
        return;
    }
    const result = await placeInSlot(made.id, slot, { holder: holderId });
    if (result.ok) return;
    // The recipe exists and is loaded. It has no slot, and can be chosen for one.
    logger.warn(`Cafe: the new recipe was not placed in slot ${slot} (${result.reason})`);
    failed(cafeText('Could not place {name} in slot {n}', { name: made.name || String(made.id), n: slot }));
}

/**
 * Put a recipe that is in no slot into `slot`. Nothing is loaded. One that
 * another tablet has put in a slot since the list was drawn is left there.
 */
export async function chooseRecipeFor(slot, recipe, holderId) {
    const result = await placeInSlot(recipe.id, slot, { holder: holderId, unplaced: true });
    if (!result.ok) {
        logger.warn(`Cafe: the recipe was not placed in slot ${slot} (${result.reason})`);
        failed(cafeText('Could not place {name} in slot {n}', { name: recipeName(recipe), n: slot }));
        return;
    }
    if (holderId != null) await unloadIfLoaded(holderId);
}

/** Take a recipe out of its slot. It stays in DYE2, in no slot. */
export async function removeRecipe(recipe) {
    const result = await removeFromSlot(recipe.id);
    if (!result.ok) {
        logger.warn(`Cafe: the recipe was not taken out of its slot (${result.reason})`);
        failed(cafeText('Could not remove {name} from its slot', { name: recipeName(recipe) }));
        return;
    }
    await unloadIfLoaded(recipe.id);
}
