// The one writer of DYE2's recipe records (docs/cafe/DESIGN.md, "Writing DYE2's
// records"). Nothing else under src/cafe/ writes them, and a test fails if
// another module does. How a write is made safe is in recipe-write.js.
//
// The writes Streamline's own strip module makes are Streamline's, and are left
// as they are.
import { getDye2KvArray, setDye2KvArray } from '../modules/api.js';
import { createRecipeWriter } from './recipe-write.js';

const RECIPES_KEY = 'recipes';

const writer = createRecipeWriter({
    read: () => getDye2KvArray(RECIPES_KEY),
    write: rows => setDye2KvArray(RECIPES_KEY, rows),
});

/** Put a recipe in a Recipe Slot, 1 to 9. See recipe-write.js for the answer. */
export const placeInSlot = writer.placeInSlot;

/** Take a recipe out of the slot the caller saw it in. */
export const removeFromSlot = writer.removeFromSlot;

/**
 * Set the named fields of one recipe: the profile and what goes with it, which a
 * recipe must hold before the Workflow moves to it (profile-changer.js).
 */
export const setRecipeFields = writer.setFields;
