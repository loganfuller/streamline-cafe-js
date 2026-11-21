// The list a recipe is chosen from, for a slot (docs/cafe/DESIGN.md, "Recipes
// and the strip"). The markup is in index.html; this module fills it in, shows
// it and answers with the recipe that was tapped.
import { recipesWithoutSlot } from './slot-menu.js';
import { setText } from './text.js';

let wired = false;

function wire(dialog) {
    if (wired) return;
    wired = true;
    // A shot that starts takes the screen back: nothing is arranged during one.
    document.addEventListener('streamline:espresso-start', () => { if (dialog.open) dialog.close(); });
}

/**
 * Show the recipes in no slot. Resolves the one that was tapped, or null when
 * the dialog was closed without a choice.
 */
export function chooseRecipe(slot, rows) {
    const dialog = document.getElementById('cafe-recipe-dialog');
    const list = document.getElementById('cafe-recipe-list');
    if (!dialog || !list || typeof dialog.showModal !== 'function') return Promise.resolve(null);
    wire(dialog);
    return new Promise(resolve => {
        let chosen = null;
        const choices = recipesWithoutSlot(rows);
        setText(document.getElementById('cafe-recipe-dialog-title'), 'Choose a recipe for slot {n}', { translate: true, vars: { n: slot } });
        const empty = document.getElementById('cafe-recipe-dialog-empty');
        if (empty) empty.style.display = choices.length ? 'none' : '';
        list.replaceChildren(...choices.map(({ recipe, name, detail }) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'cafe-recipe-row';
            const title = document.createElement('span');
            title.className = 'cafe-recipe-row-name';
            title.textContent = name;
            const under = document.createElement('span');
            under.className = 'cafe-recipe-row-detail';
            under.textContent = detail;
            row.append(title, under);
            row.addEventListener('click', () => { chosen = recipe; dialog.close(); });
            return row;
        }));
        dialog.addEventListener('close', () => {
            list.replaceChildren();
            resolve(chosen);
        }, { once: true });
        dialog.showModal();
    });
}
