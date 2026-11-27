// The bean and batch dialog: a tap on the Dose row's name lists the tablet's
// beans that have a batch on the left and the highlighted bean's batches on
// the right; a tap on a batch highlights it, and "Use this batch" under them
// sets the machine to the one highlighted (docs/cafe/DESIGN.md,
// "The grinder, bean and basket dialogs" and "The bean and batch dialog").
// What a row says, the line under the title and whether a choice writes the
// recipe are bean-model.js's and bean-change.js's. This module reads what they
// need and shows the lists (pick-dialog.js); the write itself is
// `changeBean`'s (bean-changer.js), which takes its turn among the dial-in's
// other writes. It writes nothing itself.
//
// On a Machine Decent Sync serves, whose plugin can match scanned text, the
// dialog has a button that scans a batch's QR code (scan-view.js, "Scanning a
// batch's QR code"): the plugin brings the batch to the Machine's Location,
// and the lists are read again from Decaid with that batch highlighted, as if
// tapped. The scan writes nothing to the Workflow: "Use this batch" does.
//
// With a recipe loaded, a batch of another bean than the recipe's own becomes
// the recipe's bean, on every tablet: its DYE2 record first, then the Workflow.
// A batch of the recipe's own bean, and any batch with no recipe loaded, is
// the Workflow write alone, which Decent Sync saves where it serves the
// Machine.
import { getBeans, getBeanBatches, getBeanBatch, getWorkflow } from '../modules/api.js';
import { selectableBeans } from '../modules/bean-selection.js';
import { showToast } from '../modules/ui.js';
import { logger } from '../modules/logger.js';
import { BEAN_PHRASES, listOf, beanList, openingBean, recipeBeanId, sameRecipeBean, beanRows, batchRows, batchUse, batchPick, beanSubtitle, batchCode } from './bean-model.js';
import { SCAN_PHRASES } from './scan-model.js';
import { startScan } from './scan-view.js';
import { writesRecord } from './bean-change.js';
import { changeBean } from './bean-changer.js';
import { choose } from './pick-dialog.js';
import { cafeText, formatRoastDay, todayHere } from './text.js';

let opening = false;

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

// The beans not archived and every batch of each, archived ones too: an
// archived batch the Workflow or the recipe names still says which bean is in
// use, or is the Recipe's own. Rejects where any of it can't be read: a list
// read in part would leave out a batch, or a bean, that is there.
async function readBeans(recipe) {
    const beans = listOf(await getBeans(false));
    if (!beans) throw new Error('Decaid did not answer a list of beans');
    const batches = (await Promise.all(selectableBeans(beans).map(async bean => {
        const rows = listOf(await getBeanBatches(bean.id, true));
        if (!rows) throw new Error(`Decaid did not answer a list of batches for bean ${bean.id}`);
        return rows;
    }))).flat();
    // A recipe DYE2 made from the Workflow names its batch and no bean. A batch
    // of a bean not listed is read on its own, to tell its bean; one that can't
    // be read leaves the recipe with no Bean. recipeBeanId() decides whether the
    // bean is told already, so the two never disagree on a blank beanId.
    let recipeBatch = null;
    if (recipe?.beanBatchId != null && recipeBeanId(recipe, batches) == null) {
        try {
            recipeBatch = await getBeanBatch(recipe.beanBatchId);
        } catch (error) {
            logger.info(`Cafe: the recipe's batch ${recipe.beanBatchId} could not be read: ${error.message}`);
        }
    }
    return { beans, batches, recipeBatch };
}

/**
 * Open the bean and batch dialog, and write the batch chosen.
 *
 * - `mayOpen()`: may it open now? Not while a shot runs, a recipe loads, the
 *   strip is arranged, or another choice is still being written.
 * - `epoch()`: changes whenever a recipe load begins or ends. What was read
 *   before a change describes the recipe before, so the dialog is not opened.
 * - `recipe()`: the loaded recipe's DYE2 record, or null.
 * - `saved()`: does Decent Sync save this Machine's dial-in onto it?
 * - `scan()`: the function that asks Decent Sync's plugin which batch a
 *   scanned QR code is, where the plugin can be asked, or null: the dialog
 *   then has no scan button.
 */
export async function openBeanDialog({ mayOpen, epoch, recipe, saved, scan = () => null }) {
    if (opening || !mayOpen()) return;
    opening = true;
    const at = epoch();
    try {
        const loaded = recipe();
        let read;
        let workflow;
        try {
            [read, workflow] = await Promise.all([readBeans(loaded), getWorkflow()]);
        } catch (error) {
            // A list that can't be read is not an empty list.
            logger.warn('Cafe: could not read the beans', error);
            showToast(cafeText('Could not read the beans'), 4000, 'error');
            return;
        }
        // A shot may have started, or a recipe loaded, while they were read: the
        // batch in use read then may no longer be.
        if (!mayOpen() || epoch() !== at) return;
        // What the lists are made from, read again after a scan.
        let context;
        let list;
        let own;
        const take = (beans, held) => {
            read = beans;
            context = held?.context || {};
            list = beanList(read.beans, read.batches) || [];
            own = recipeBeanId(loaded, read.batches, read.recipeBatch);
        };
        take(read, workflow);
        const isSaved = saved();
        const today = todayHere();
        const batchesOf = beanId => batchRows(list.find(entry => sameId(entry.bean.id, beanId)), context, today, formatRoastDay, cafeText);
        // The two lists and the line under the title, with `beanId`'s batches on the right.
        const lists = beanId => ({
            subtitle: beanSubtitle(loaded, isSaved, beanId, own),
            heading: list.length ? BEAN_PHRASES.batchHeading : null,
            rows: batchesOf(beanId),
            side: list.length ? {
                heading: BEAN_PHRASES.beanHeading,
                rows: beanRows(list, beanId, cafeText),
                show: shown => ({ subtitle: beanSubtitle(loaded, isSaved, shown.id, own), rows: batchesOf(shown.id) }),
            } : null,
        });
        // The lists read again from Decaid, with the scanned batch's bean shown
        // and the batch highlighted where one matched. Null where they can't
        // be read, or do not hold that batch.
        const reread = async match => {
            try {
                take(...await Promise.all([readBeans(loaded), getWorkflow()]));
            } catch (error) {
                logger.warn('Cafe: could not read the beans again after a scan', error);
                return null;
            }
            if (!match) return lists(openingBean(list, context, read.batches));
            const next = lists(match.beanId);
            return next.rows.some(shown => shown.id === String(match.batchId)) ? { ...next, held: match.batchId } : null;
        };
        const ask = scan();
        const row = await choose({
            title: BEAN_PHRASES.title,
            label: cafeText('Batches'),
            empty: BEAN_PHRASES.empty,
            ...lists(openingBean(list, context, read.batches)),
            // A tap on a batch highlights it; the button chooses it.
            confirm: { idle: cafeText('Use this batch'), use: batch => batchUse(batch, loaded, own, cafeText) },
            // A batch's QR code scanned, the plugin asked, and the lists read again.
            scan: ask ? {
                name: SCAN_PHRASES.open,
                open: stage => startScan(stage, { ask, reread, inUseCode: () => batchCode(read.batches.find(batch => sameId(batch?.id, context.beanBatchId))) }),
            } : null,
        });
        if (!row) return; // closed
        // A recipe loaded, or its bean changed elsewhere, while the dialog was
        // open, or while the pick waits its turn: the line under the title no
        // longer says what it would do, and nothing is written.
        const still = () => epoch() === at && sameRecipeBean(loaded, recipe(), own, read.batches, read.recipeBatch);
        // Another bean than the recipe's own is saved onto the recipe, the batch
        // in use too where it stayed this machine's own before; any other batch
        // in use writes nothing.
        const named = writesRecord(loaded, own, row.bean?.id) ? String(loaded.id) : null;
        if (!named && !batchPick(row.bean, row.batch, context)) return;
        // The write waits its turn behind a dial-in change still on its way, and
        // is not made where a shot has begun since, or where DYE2 has another
        // recipe loaded than the line under the title named.
        const result = await changeBean({ bean: row.bean, batch: row.batch, recipeId: named, still });
        if (!result.ok) {
            logger.warn(`Cafe: could not change the bean: ${result.reason}`);
            showToast(cafeText('Could not change the bean'), 4000, 'error');
            // A record that took the bean all the same: the card and names follow it.
            if (result.checked) document.dispatchEvent(new Event('streamline:workflow-refresh'));
            return;
        }
        // The page reads the names again, the roast date with them.
        document.dispatchEvent(new Event('streamline:workflow-refresh'));
    } finally {
        opening = false;
    }
}
