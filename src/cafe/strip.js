// The recipe strip: nine cards in one row, one per Recipe Slot, read from DYE2's
// records (docs/cafe/DESIGN.md, "Recipes and the strip").
//
// The skin draws the cards and handles the tap and the long-press. Loading the
// recipe is Streamline's: `applyRecipe` writes the Workflow and tells DYE2 which
// recipe is loaded, and which recipe is loaded is then read back from DYE2, as
// Streamline's strip reads it. recipe-loader.js keeps the two in order. A
// long-press never loads: it opens DYE2's editor (editor.js).
import { getDye2KvArray, callPluginEndpoint } from '../modules/api.js';
import { applyRecipe } from '../modules/dyeStrip.js';
import { isSubPage } from '../modules/router.js';
import { showToast, setupPressAndHold } from '../modules/ui.js';
import { logger } from '../modules/logger.js';
import { DYE2_PLUGIN_ID } from './dye2-gate.js';
import { stripCards, recipeName } from './strip-model.js';
import { createRecipeLoader } from './recipe-loader.js';
import { editRecipe, createRecipeIn, placeHeldRecipe, onEditorReturn } from './editor.js';
import { cafeText } from './text.js';

const RECIPES_KEY = 'recipes';
const REFRESH_GAP_MS = 300; // focus, visibilitychange and pageshow arrive together
const SETTLE_MAX_MS = 5000; // the longest a tap waits on earlier edits before its load is called off

let cards = stripCards([], null); // as last drawn
let loader = null;
let refreshTimer = null;
let settleEdits = async () => {};

// What DYE2 says is loaded, or undefined when it could not be asked.
async function readSelection() {
    try {
        return await callPluginEndpoint(DYE2_PLUGIN_ID, 'selection', null, 'GET');
    } catch (error) {
        return undefined;
    }
}

// The promise, or a rejection once `ms` have passed, whichever is first.
function within(ms, promise) {
    let timer;
    const late = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('An earlier change has not reached the machine yet.')), ms);
    });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

async function readDye2() {
    const [rows, selection] = await Promise.all([getDye2KvArray(RECIPES_KEY), readSelection()]);
    return { rows, selection };
}

// A long-press opens DYE2's editor, which leaves this page. A dial-in change
// still on its way is given the chance to be written first, and the editor
// opens whether or not it was: nothing is loaded here, so nothing can land on
// the wrong recipe. Ignored while a recipe loads, and while an earlier
// long-press is still on its way out.
let leaving = false;
async function openEditor(open) {
    if (leaving || loader.busy()) return;
    leaving = true;
    try {
        await settleEdits().catch(() => {});
        await open();
    } finally {
        leaving = false;
    }
}

const line = (className, text) => {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
};

function render() {
    const strip = document.getElementById('cafe-strip');
    if (!strip) return;
    strip.replaceChildren(...cards.map(card => {
        // has-context-menu is Streamline's ring around a control while it is held.
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.slot = card.slot;
        if (!card.recipe) {
            // An empty slot: a tap does nothing, and holding it makes a recipe there.
            button.className = 'cafe-card cafe-card-empty no-select has-context-menu';
            button.append(
                line('cafe-card-name', cafeText('Slot {n}', { n: card.slot })),
                line('cafe-card-bean', cafeText('Hold to add')),
            );
            setupPressAndHold(button, () => {}, () => openEditor(() => createRecipeIn(card.slot)));
            return button;
        }
        button.className = 'cafe-card no-select has-context-menu';
        button.setAttribute('aria-pressed', String(card.loaded));
        button.append(line('cafe-card-name', card.name), line('cafe-card-bean', card.bean));
        setupPressAndHold(button, () => loader.load(card.recipe), () => openEditor(() => editRecipe(card.recipe)));
        return button;
    }));
}

// Back from DYE2's editor: place the recipe made from a held empty slot, and
// draw the strip again when that changed DYE2's records.
function afterEditor() {
    placeHeldRecipe()
        .then(placed => (placed ? loader.refresh() : null))
        .catch(error => logger.warn('Cafe: could not place the new recipe', error));
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
 * strip is drawn; `onBeforeLoad` resolves once edits made before a tap have been
 * written; `onLoading` is told when a load begins and ends; `onApply` runs once
 * a tap's load has been written, whether or not it landed.
 */
export function initStrip({ onChange = () => {}, onBeforeLoad = async () => {}, onLoading = () => {}, onApply = () => {} }) {
    // Before another recipe is loaded, or the page is left for DYE2's editor: let
    // an edit still on its way reach the Workflow. A request that stalls is not
    // waited for past a few seconds.
    settleEdits = () => within(SETTLE_MAX_MS, onBeforeLoad());
    loader = createRecipeLoader({
        apply: applyRecipe,
        read: readDye2,
        // A stalled edit calls the load off instead of holding the page: whatever
        // is still on the wire then lands on the recipe that stays loaded.
        settle: settleEdits,
        show(recipes, loaded) {
            cards = stripCards(recipes, loaded);
            render();
            onChange(loaded);
        },
        onLoading,
        onApplied: onApply,
        onError(error, recipe) {
            logger.error('Cafe: could not load the recipe', error);
            if (recipe) showToast(cafeText('Could not load {name}', { name: recipeName(recipe) }), 2400, 'error');
        },
    });
    render();
    // DYE2's records have no push channel. Look again when the page comes back
    // into view, and when a plugin says the Workflow changed.
    window.addEventListener('focus', refreshStripSoon);
    window.addEventListener('pageshow', event => {
        // Back from the editor by the browser's own Back, with this page kept as
        // it was left: no load follows, so the held slot is settled here.
        if (event.persisted) afterEditor();
        refreshStripSoon();
    });
    document.addEventListener('visibilitychange', refreshStripSoon);
    document.addEventListener('streamline:mainpagevisible', refreshStripSoon);
    document.addEventListener('streamline:workflow-refresh', refreshStripSoon);
    document.addEventListener('streamline:languagechange', render);
    onEditorReturn(afterEditor);
    // This load may be the return from the editor.
    afterEditor();
    return loader.refresh();
}
