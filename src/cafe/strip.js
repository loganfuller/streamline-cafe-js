// The recipe strip: nine cards in one row, one per Recipe Slot, read from DYE2's
// records (docs/cafe/DESIGN.md, "Recipes and the strip").
//
// The skin draws the cards and handles the tap and the long-press. Loading the
// recipe is Streamline's: `applyRecipe` writes the Workflow and tells DYE2 which
// recipe is loaded, and which recipe is loaded is then read back from DYE2, as
// Streamline's strip reads it. A tap on the loaded card unloads it, by
// clearing DYE2's selection alone (arrange.js). recipe-loader.js decides which
// taps count and keeps loads and unloads in order. A long-press never loads,
// and never leaves the page: it opens a menu on the card (slot-menu.js), whose
// actions are in arrange.js.
import { getDye2KvArray, callPluginEndpoint, getEspressoEndedAt, getBeanBatch } from '../modules/api.js';
import { applyRecipe } from '../modules/dyeStrip.js';
import { isSubPage } from '../modules/router.js';
import { showToast, setupPressAndHold } from '../modules/ui.js';
import { openContextMenu } from '../modules/context-menu.js';
import { logger } from '../modules/logger.js';
import { DYE2_PLUGIN_ID } from './dye2-gate.js';
import { stripCards, recipeName } from './strip-model.js';
import { cardBatchIds, recordsAfterRead, finishedSlots } from './finished-batch.js';
import { createRecipeLoader } from './recipe-loader.js';
import { slotMenu } from './slot-menu.js';
import { makeRecipeIn, chooseRecipeFor, removeRecipe, clearSelection } from './arrange.js';
import { waitOutStore } from './barista-model.js';
import { chooseRecipe } from './recipe-dialog.js';
import { cafeText } from './text.js';

const RECIPES_KEY = 'recipes';
const REFRESH_GAP_MS = 300; // focus, visibilitychange and pageshow arrive together
const SETTLE_MAX_MS = 5000; // the longest a tap waits on earlier edits before its load is called off

let cards = stripCards([], null); // as last drawn
let batchRecords = new Map();     // Decaid's record of each batch a card names, as last read
let finished = [];                // the slots drawn red, as last drawn
let batchSeq = 0;
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

// Decaid stores a Shot, with the Workflow's recipe as it is then, up to its 4 s
// backstop after the pour ends. A load or an unload tapped in those seconds
// waits them out, so the Shot just pulled keeps the recipe it was pulled with.
// A shot that ends during the wait gets its own. The wait goes once Decaid
// stores the Shot before taking another change.
const afterShot = () => waitOutStore(getEspressoEndedAt, Date.now, ms => new Promise(resolve => setTimeout(resolve, ms)));

async function readDye2() {
    const [rows, selection] = await Promise.all([getDye2KvArray(RECIPES_KEY), readSelection()]);
    return { rows, selection };
}

// The strip is arranged one action at a time, and not while a recipe loads or a
// shot runs: making a recipe writes the Workflow, and the Workflow is left
// alone during a shot. While an action runs no card loads and the dial-in rows
// take no taps, as while a recipe loads: a load or a step made then could land
// before or after what DYE2 reads to make a recipe, or to say which is loaded.
let arranging = false;
let shotRunning = () => false;
let afterArranging = () => {};
let keepStill = () => {};
const clear = () => !loader.busy() && !shotRunning();
const mayArrange = () => !arranging && clear();

function openMenu(button, card) {
    if (!mayArrange()) return;
    openContextMenu(button, slotMenu(card).map(item => ({
        label: cafeText(item.label),
        onSelect: () => arrange(item.action, card),
    })));
}

async function arrange(action, card) {
    if (!mayArrange()) return;
    arranging = true;
    keepStill(true);
    const slot = Number(card.slot);
    const holderId = card.recipe ? card.recipe.id : null;
    try {
        if (action === 'new') {
            // A dial-in change still on its way belongs in the new recipe. A shot
            // may have started while it was written: nothing is made then.
            const settled = await settleEdits().then(() => true, () => false);
            if (!settled) showToast(cafeText('Could not make a new recipe'), 4000, 'error');
            else if (clear()) await makeRecipeIn(slot, holderId);
        } else if (action === 'choose') {
            // A shot may start while the records are read, or while the list is
            // open: the list is not put over a running shot, and nothing is placed.
            const { rows } = await readDye2();
            // Records that could not be read are not an empty list.
            if (!rows) showToast(cafeText('Could not read the recipes'), 4000, 'error');
            const recipe = rows && clear() ? await chooseRecipe(slot, rows) : null;
            if (recipe && clear()) await chooseRecipeFor(slot, recipe, holderId);
        } else if (action === 'remove') {
            await removeRecipe(card.recipe, slot);
        }
    } catch (error) {
        logger.error('Cafe: could not arrange the strip', error);
    } finally {
        arranging = false;
        keepStill(false);
    }
    // DYE2's records, and which recipe it says is loaded, decide what is drawn.
    afterArranging();
    await loader.refresh().catch(error => logger.warn('Cafe: could not re-read the recipes', error));
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
            // An empty slot: a tap does nothing, and holding it opens the menu.
            button.className = 'cafe-card cafe-card-empty no-select has-context-menu';
            button.append(
                line('cafe-card-name', cafeText('Slot {n}', { n: card.slot })),
                line('cafe-card-bean', cafeText('Hold to add')),
            );
            setupPressAndHold(button, () => {}, () => openMenu(button, card));
            return button;
        }
        button.className = 'cafe-card no-select has-context-menu';
        button.setAttribute('aria-pressed', String(card.loaded));
        button.append(line('cafe-card-name', card.name), line('cafe-card-bean', card.bean));
        if (finished.includes(String(card.slot))) {
            button.classList.add('cafe-card-finished');
            button.append(line('cafe-hidden-text', cafeText('Batch finished')));
        }
        setupPressAndHold(button, () => { if (!arranging) loader.tap(card.recipe); }, () => openMenu(button, card));
        return button;
    }));
}

// The cards whose recipe names a batch archived on the tablet are red
// (finished-batch.js). Each batch a card names is read from Decaid with the
// records, so a batch archived or brought back since shows whenever the strip
// is read. The cards are drawn again only when a mark changed.
function markFinished() {
    const next = finishedSlots(cards, batchRecords);
    if (next.join() === finished.join()) return false;
    finished = next;
    return true;
}

async function readBatches() {
    const seq = ++batchSeq;
    const ids = cardBatchIds(cards);
    const reads = await Promise.all(ids.map(id => getBeanBatch(id).then(record => ({ id, record }), () => null)));
    if (seq !== batchSeq) return;
    batchRecords = recordsAfterRead(batchRecords, ids, reads);
    if (markFinished()) render();
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
 * written; `onLoading` is told when a load or unload begins and ends; `onApply`
 * runs once a tap's load or unload has been written, whether or not it landed,
 * and after the strip was arranged; `isShotRunning` says whether a shot is
 * running, during which no card takes a tap.
 */
export function initStrip({ onChange = () => {}, onBeforeLoad = async () => {}, onLoading = () => {}, onApply = () => {}, isShotRunning = () => false }) {
    // Before a recipe is loaded or unloaded, or one is made from the Workflow: let
    // an edit still on its way reach the Workflow. A request that stalls is not
    // waited for past a few seconds.
    settleEdits = () => within(SETTLE_MAX_MS, onBeforeLoad());
    shotRunning = isShotRunning;
    afterArranging = onApply;
    keepStill = onLoading;
    loader = createRecipeLoader({
        apply: applyRecipe,
        unload: clearSelection,
        read: readDye2,
        // A stalled edit calls the load off instead of holding the page: whatever
        // is still on the wire then lands on the recipe that stays loaded.
        settle: settleEdits,
        afterShot,
        shotRunning: () => shotRunning(),
        show(recipes, loaded) {
            cards = stripCards(recipes, loaded);
            markFinished();
            render();
            onChange(loaded);
            readBatches();
        },
        onLoading,
        onApplied: onApply,
        onError(error, recipe) {
            logger.error('Cafe: could not load the recipe', error);
            if (recipe) showToast(cafeText('Could not load {name}', { name: recipeName(recipe) }), 2400, 'error');
        },
        // The card is highlighted again, and the recipe is still loaded.
        onUnloadError(error, recipe) {
            logger.error('Cafe: could not unload the recipe', error);
            showToast(cafeText('Could not unload {name}', { name: recipeName(recipe) }), 4000, 'error');
        },
    });
    render();
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
