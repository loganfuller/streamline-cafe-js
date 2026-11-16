// The recipe strip: nine cards in one row, one per Recipe Slot, read from DYE2's
// records (docs/cafe/DESIGN.md, "Recipes and the strip").
//
// The skin draws the cards and handles the tap. Loading the recipe is
// Streamline's: `applyRecipe` writes the Workflow and tells DYE2 which recipe is
// loaded, and which recipe is loaded is then read back from DYE2, as
// Streamline's strip reads it. recipe-loader.js keeps the two in order.
import { getDye2KvArray, callPluginEndpoint } from '../modules/api.js';
import { applyRecipe } from '../modules/dyeStrip.js';
import { isSubPage } from '../modules/router.js';
import { showToast } from '../modules/ui.js';
import { logger } from '../modules/logger.js';
import { DYE2_PLUGIN_ID } from './dye2-gate.js';
import { stripCards, recipeName } from './strip-model.js';
import { createRecipeLoader } from './recipe-loader.js';
import { cafeText } from './text.js';

const RECIPES_KEY = 'recipes';
const REFRESH_GAP_MS = 300; // focus, visibilitychange and pageshow arrive together

let cards = stripCards([], null); // as last drawn
let loader = null;
let refreshTimer = null;

// What DYE2 says is loaded, or undefined when it could not be asked.
async function readSelection() {
    try {
        return await callPluginEndpoint(DYE2_PLUGIN_ID, 'selection', null, 'GET');
    } catch (error) {
        return undefined;
    }
}

async function readDye2() {
    const [rows, selection] = await Promise.all([getDye2KvArray(RECIPES_KEY), readSelection()]);
    return { rows, selection };
}

function render() {
    const strip = document.getElementById('cafe-strip');
    if (!strip) return;
    strip.replaceChildren(...cards.map(card => {
        if (!card.recipe) {
            // An outline, not a control: holding it to add a recipe comes with the
            // long-press gestures.
            const empty = document.createElement('div');
            empty.className = 'cafe-card cafe-card-empty';
            empty.textContent = `${cafeText('Slot')} ${card.slot}`;
            return empty;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cafe-card no-select';
        button.dataset.slot = card.slot;
        button.setAttribute('aria-pressed', String(card.loaded));
        const name = document.createElement('span');
        name.className = 'cafe-card-name';
        name.textContent = card.name;
        const bean = document.createElement('span');
        bean.className = 'cafe-card-bean';
        bean.textContent = card.bean;
        button.append(name, bean);
        return button;
    }));
}

/** Read DYE2 again, a moment later, so a burst of reasons to look costs one read. */
export function refreshStripSoon() {
    if (!loader || refreshTimer || document.hidden || isSubPage()) return;
    refreshTimer = setTimeout(() => {
        refreshTimer = null;
        loader.refresh().catch(error => logger.warn('Cafe: could not re-read the recipes', error));
    }, REFRESH_GAP_MS);
}

/**
 * Draw the strip and keep it in step with DYE2's records. Called once, when the
 * page starts. `onChange` is told the loaded recipe, or null, each time the
 * strip is drawn; `onApply` runs once a tap's load has been written, whether or
 * not it landed.
 */
export function initStrip({ onChange = () => {}, onApply = () => {} }) {
    loader = createRecipeLoader({
        apply: applyRecipe,
        read: readDye2,
        show(recipes, loaded) {
            cards = stripCards(recipes, loaded);
            render();
            onChange(loaded);
        },
        onApplied: onApply,
        onError(error, recipe) {
            logger.error('Cafe: could not load the recipe', error);
            if (recipe) showToast(`${cafeText('Could not load')} ${recipeName(recipe)}`, 2400, 'error');
        },
    });
    render();
    document.getElementById('cafe-strip')?.addEventListener('click', event => {
        const button = event.target.closest('button[data-slot]');
        if (!button) return;
        const card = cards.find(c => c.slot === button.dataset.slot);
        if (card?.recipe) loader.load(card.recipe);
    });
    // DYE2's records have no push channel. Look again when the page comes back
    // into view, and when a plugin says the Workflow changed.
    window.addEventListener('focus', refreshStripSoon);
    window.addEventListener('pageshow', refreshStripSoon);
    document.addEventListener('visibilitychange', refreshStripSoon);
    document.addEventListener('streamline:mainpagevisible', refreshStripSoon);
    document.addEventListener('streamline:workflow-refresh', refreshStripSoon);
    document.addEventListener('streamline:languagechange', render);
    return loader.refresh();
}
