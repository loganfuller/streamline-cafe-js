// The long-press on a recipe card: the trip to DYE2's editor and back
// (docs/cafe/DESIGN.md, "Recipes and the strip").
//
// DYE2's pages are on another origin, so opening the editor leaves this page,
// and coming back loads it again. A filled card opens its recipe. An empty slot
// opens a new one, and the skin remembers which slot was held so that, back
// here, it can put the new recipe in it: DYE2 places a recipe only in slots 1
// to 5. slot-hold.js decides, and recipe-writer.js writes.
import { getDye2KvArray, getKVValue, setKVValue, deleteKVValue } from '../modules/api.js';
import { openPluginOverlay } from '../modules/dyeStrip.js';
import { showToast } from '../modules/ui.js';
import { logger } from '../modules/logger.js';
import { placeInSlot } from './recipe-writer.js';
import { holdOf, heldPlacement } from './slot-hold.js';
import { recipeName } from './strip-model.js';
import { cafeText } from './text.js';

// Cafe-only state lives in its own namespace of Decaid's store, never in
// Streamline's (docs/cafe/DESIGN.md, "Settings").
const CAFE_NAMESPACE = 'streamlineCafe';
const HOLD_KEY = 'slotHold';
const RECIPES_KEY = 'recipes';
const EDITOR_PAGE = 'recipe-edit';

let onReturn = () => {};

// Where the editor's page is ever shown inside this one instead of in its
// place, closing it is the return: there is no page load to notice it by.
const closed = () => onReturn();

/** `callback` runs when the editor closes without this page loading again. */
export function onEditorReturn(callback) {
    onReturn = callback;
}

/** Open a recipe in DYE2's editor. */
export function editRecipe(recipe) {
    openPluginOverlay(EDITOR_PAGE, { id: recipe.id }, closed);
}

/**
 * Open DYE2's editor on a new recipe, for the empty slot that was held. The
 * editor is not opened when the hold could not be remembered: the recipe made
 * there would have no way into a slot above 5.
 */
export async function createRecipeIn(slot) {
    try {
        const rows = await getDye2KvArray(RECIPES_KEY);
        if (!rows) throw new Error('DYE2\'s recipes could not be read');
        await setKVValue(CAFE_NAMESPACE, HOLD_KEY, holdOf(slot, rows));
    } catch (error) {
        logger.error('Cafe: could not remember the held slot', error);
        showToast(cafeText('Could not open DYE2'), 2400, 'error');
        return;
    }
    openPluginOverlay(EDITOR_PAGE, { new: 1 }, closed);
}

// The remembered hold, taken out of the store: this showing of the page uses it
// or drops it, so a recipe that appears later is never placed by an old hold.
async function takeHold() {
    const hold = await getKVValue(CAFE_NAMESPACE, HOLD_KEY);
    if (!hold) return null;
    await deleteKVValue(CAFE_NAMESPACE, HOLD_KEY);
    return hold;
}

/**
 * Back from the editor: put the recipe made from a held empty slot in that
 * slot. Resolves true when DYE2's records were changed. Nothing is placed when
 * the editor was left without saving, when more than one recipe is new, or when
 * the slot was filled meanwhile.
 */
export async function placeHeldRecipe() {
    let hold;
    try {
        hold = await takeHold();
    } catch (error) {
        logger.warn('Cafe: could not read the held slot', error);
        return false;
    }
    if (!hold) return false;
    const plan = heldPlacement(hold, await getDye2KvArray(RECIPES_KEY));
    if (!plan.recipe) {
        logger.info(`Cafe: nothing placed in the held slot (${plan.reason})`);
        return false;
    }
    const result = await placeInSlot(plan.recipe.id, plan.slot, { onlyIfEmpty: true });
    if (result.ok) return true;
    logger.warn(`Cafe: the new recipe was not placed in slot ${plan.slot} (${result.reason})`);
    // A slot someone else filled in the moment between is theirs, and no fault.
    if (result.reason !== 'taken') {
        showToast(cafeText('Could not place {name} in slot {n}', { name: recipeName(plan.recipe), n: plan.slot }), 4000, 'error');
    }
    return false;
}
