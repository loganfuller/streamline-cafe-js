// What a long-press on a recipe card offers, and which recipes can be chosen
// for a slot (docs/cafe/DESIGN.md, "Recipes and the strip"). No browser global
// is touched.
import { recipeStripCells } from '../modules/dye-selection.js';
import { SLOT_COUNT, recipeName, recipeBean } from './strip-model.js';

/**
 * The menu for a card: each item's action and its label, which is a
 * translation key. An empty slot can be given a recipe; a filled one can have
 * its recipe replaced or taken out. The menu opens on the card, so the labels
 * do not repeat the recipe's name.
 */
export function slotMenu(card) {
    if (!card.recipe) {
        return [
            { action: 'new', label: 'New recipe from current settings' },
            { action: 'choose', label: 'Choose a recipe…' },
        ];
    }
    return [
        { action: 'new', label: 'Replace with a new recipe' },
        { action: 'choose', label: 'Replace with another recipe…' },
        { action: 'remove', label: 'Remove from slot' },
    ];
}

/**
 * The recipes that can be chosen for a slot: those in none, by the strip's own
 * reading of DYE2's records, so one hidden from the strip counts. Each comes
 * with the name and the line under it that the list shows, sorted by name.
 */
export function recipesWithoutSlot(rows) {
    const list = (Array.isArray(rows) ? rows : []).filter(row => row && typeof row === 'object');
    const placed = new Set(recipeStripCells(list, SLOT_COUNT).map(cell => cell.recipe).filter(Boolean));
    return list
        .filter(recipe => !placed.has(recipe))
        .map(recipe => ({
            recipe,
            name: recipeName(recipe),
            detail: [recipeBean(recipe), typeof recipe.profileTitle === 'string' ? recipe.profileTitle : ''].filter(Boolean).join(' · '),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
}
