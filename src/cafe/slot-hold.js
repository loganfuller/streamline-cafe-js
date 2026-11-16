// A recipe made from a held empty slot (docs/cafe/DESIGN.md, "Recipes and the
// strip"). No browser global is touched.
//
// DYE2's editor is on another origin and places a recipe only in slots 1 to 5,
// so the skin places the new recipe itself. Before it opens the editor it
// remembers the slot that was held and the recipes that existed; back on the
// page, the one recipe that is new goes in that slot.
import { recipeStripCells } from '../modules/dye-selection.js';
import { SLOT_COUNT } from './strip-model.js';

const isRow = row => !!row && typeof row === 'object';

/** What to remember when slot `slot` is held: the slot and every recipe's id. */
export function holdOf(slot, rows) {
    return { slot: Number(slot), known: (Array.isArray(rows) ? rows : []).filter(isRow).map(row => String(row.id)) };
}

/**
 * The recipe to place for a remembered hold, given DYE2's records now:
 * `{ recipe, slot }`, or `{ recipe: null, reason }` when nothing is placed.
 *
 * - `no-hold`: nothing usable was remembered;
 * - `none-new`: the editor was left without saving;
 * - `several-new`: more than one recipe is new, so none is known to be the one made;
 * - `hidden`: the barista switched the new recipe off the strip in the editor;
 * - `placed`: it is in a slot already, the held one or one chosen in the editor;
 * - `taken`: another recipe was put in the held slot meanwhile.
 */
export function heldPlacement(hold, rows) {
    const none = reason => ({ recipe: null, reason });
    const slot = hold && typeof hold === 'object' ? hold.slot : null;
    if (!Number.isInteger(slot) || slot < 1 || slot > SLOT_COUNT || !Array.isArray(hold.known)) return none('no-hold');
    const known = new Set(hold.known.map(String));
    const list = (Array.isArray(rows) ? rows : []).filter(isRow);
    const fresh = list.filter(row => !known.has(String(row.id)));
    if (fresh.length === 0) return none('none-new');
    if (fresh.length > 1) return none('several-new');
    const [recipe] = fresh;
    if (recipe.showOnStreamlineDashboard === false) return none('hidden');
    const cells = recipeStripCells(list, SLOT_COUNT);
    if (cells.some(cell => cell.recipe === recipe)) return none('placed');
    if (cells[slot - 1].recipe) return none('taken');
    return { recipe, slot };
}
