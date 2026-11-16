// What the nine recipe cards show (docs/cafe/DESIGN.md, "Recipes and the strip").
//
// Which slot a recipe sits in, and which recipe is loaded, are Streamline's own
// rules: the placement its strip uses and the selection DYE2 reports. This module
// only asks for nine cells where Streamline's strip asks for five.
import { recipeStripCells, armedSelectionId } from '../modules/dye-selection.js';

export const SLOT_COUNT = 9;

// A card's name, as Streamline's strip labels a recipe.
export function recipeName(recipe) {
    return recipe.title || recipe.name || 'Recipe';
}

export function recipeBean(recipe) {
    return recipe.beanName || '';
}

/**
 * The recipe DYE2 says is loaded, or null: nothing is loaded, a favourite is, or
 * the recipe has gone from DYE2's records. A loaded recipe need not be in a slot.
 */
export function loadedRecipe(selection, recipes) {
    const list = Array.isArray(recipes) ? recipes : [];
    const id = armedSelectionId(selection, { recipes: list, favs: null });
    return id == null ? null : list.find(r => r && r.id === id) || null;
}

/**
 * The loaded recipe after DYE2's records and its selection were read again.
 * `selection` is undefined when DYE2 could not be asked: the recipe shown as
 * loaded then stays, as long as it is still in the records.
 */
export function loadedAfterRead(selection, recipes, previous) {
    if (selection !== undefined) return loadedRecipe(selection, recipes);
    if (!previous) return null;
    return (Array.isArray(recipes) ? recipes : []).find(r => r && r.id === previous.id) || null;
}

/**
 * One card per Recipe Slot, 1 to 9, in order. An empty slot has no recipe, and
 * stays where it is so cards never move.
 */
export function stripCards(recipes, loaded) {
    return recipeStripCells(recipes, SLOT_COUNT).map(({ slot, recipe }) => (recipe
        ? { slot, recipe, name: recipeName(recipe), bean: recipeBean(recipe), loaded: !!loaded && recipe.id === loaded.id }
        : { slot, recipe: null }));
}
