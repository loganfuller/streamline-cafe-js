// The recipe strip: nine cards in one row, one per Recipe Slot, read from DYE2's
// records (docs/cafe/DESIGN.md, "Recipes and the strip").
//
// The skin draws the cards and handles the tap. Loading the recipe is
// Streamline's: `applyRecipe` writes the Workflow and tells DYE2 which recipe is
// loaded, and which recipe is loaded is then read back from DYE2, as
// Streamline's strip reads it.
import { getDye2KvArray, callPluginEndpoint } from '../modules/api.js';
import { applyRecipe } from '../modules/dyeStrip.js';
import { isSubPage } from '../modules/router.js';
import { showToast } from '../modules/ui.js';
import { logger } from '../modules/logger.js';
import { DYE2_PLUGIN_ID } from './dye2-gate.js';
import { stripCards, loadedAfterRead, recipeName } from './strip-model.js';
import { cafeText } from './text.js';

const RECIPES_KEY = 'recipes';
const REFRESH_GAP_MS = 300; // focus, visibilitychange and pageshow arrive together

let recipes = [];
let loaded = null;
let onLoaded = () => {};
let onApplied = () => {};
// Counts taps. A read that began before a tap is dropped, so it cannot move the
// highlight off the card just tapped.
let loadSeq = 0;
let refreshTimer = null;

// What DYE2 says is loaded, or undefined when it could not be asked.
async function readSelection() {
    try {
        return await callPluginEndpoint(DYE2_PLUGIN_ID, 'selection', null, 'GET');
    } catch (error) {
        return undefined;
    }
}

function render() {
    const strip = document.getElementById('cafe-strip');
    if (!strip) return;
    const cards = stripCards(recipes, loaded).map(card => {
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
    });
    strip.replaceChildren(...cards);
}

function show(recipe) {
    loaded = recipe;
    render();
    onLoaded(loaded);
}

/** Read DYE2's records and its selection again, and redraw. */
export async function refreshStrip() {
    const seq = loadSeq;
    const [rows, selection] = await Promise.all([getDye2KvArray(RECIPES_KEY), readSelection()]);
    if (seq !== loadSeq) return; // a tap landed meanwhile; its own read follows
    // A failed read keeps what is on screen: an error is not an empty strip.
    if (rows) recipes = rows;
    show(loadedAfterRead(selection, recipes, loaded));
}

/** The same, a moment later, so a burst of reasons to look again costs one read. */
export function refreshStripSoon() {
    if (refreshTimer || document.hidden || isSubPage()) return;
    refreshTimer = setTimeout(() => {
        refreshTimer = null;
        refreshStrip().catch(error => logger.warn('Cafe: could not re-read the recipes', error));
    }, REFRESH_GAP_MS);
}

async function load(recipe) {
    // The loaded card takes no tap, as on Streamline's strip: loading it again
    // would put the stored values back over a dial-in in progress.
    if (loaded && loaded.id === recipe.id) return;
    const seq = ++loadSeq;
    const before = loaded;
    show(recipe); // at once; DYE2's answer below confirms it
    try {
        await applyRecipe(recipe);
    } catch (error) {
        logger.error('Cafe: could not load the recipe', error);
        showToast(`${cafeText('Could not load')} ${recipeName(recipe)}`, 2400, 'error');
        if (seq === loadSeq) show(before);
    }
    onApplied();
    if (seq !== loadSeq) return; // a newer tap owns the strip
    // DYE2's answer decides the highlight, whether the load landed or not.
    await refreshStrip();
}

/**
 * Draw the strip and keep it in step with DYE2's records. Called once, when the
 * page starts. `onChange` is told
 * the loaded recipe, or null, each time it is read; `onApply` runs once a tap's
 * load has been written, whether or not it landed.
 */
export function initStrip({ onChange, onApply }) {
    onLoaded = onChange || onLoaded;
    onApplied = onApply || onApplied;
    render();
    document.getElementById('cafe-strip')?.addEventListener('click', event => {
        const button = event.target.closest('button[data-slot]');
        if (!button) return;
        const card = stripCards(recipes, loaded).find(c => c.slot === button.dataset.slot);
        if (card?.recipe) load(card.recipe);
    });
    // DYE2's records have no push channel. Look again when the page comes back
    // into view, and when a plugin says the Workflow changed.
    window.addEventListener('focus', refreshStripSoon);
    window.addEventListener('pageshow', refreshStripSoon);
    document.addEventListener('visibilitychange', refreshStripSoon);
    document.addEventListener('streamline:mainpagevisible', refreshStripSoon);
    document.addEventListener('streamline:workflow-refresh', refreshStripSoon);
    document.addEventListener('streamline:languagechange', render);
    return refreshStrip();
}
