// The bean and batch dialog: a tap on the Dose row's name lists the tablet's
// beans that have a batch on the left and the highlighted bean's batches on
// the right, and a tap on a batch sets the machine to it (docs/cafe/DESIGN.md,
// "The grinder, bean and basket dialogs"). What a row says, the line under the
// title and what a choice writes are bean-model.js's. This module reads what
// they need, shows the lists (pick-dialog.js) and makes the one Workflow write,
// through the page, which orders it among the dial-in's other writes.
//
// The skin writes no DYE2 record for a choice. On a Machine Decent Sync serves,
// with a Recipe loaded, Decent Sync records a batch of the Recipe's own Bean
// from the Workflow; a batch of another Bean stays this machine's, and the
// Recipe stays loaded. Elsewhere a choice is this machine's until another
// recipe loads.
import { getBeans, getBeanBatches, getBeanBatch, getWorkflow, updateWorkflow } from '../modules/api.js';
import { selectableBeans } from '../modules/bean-selection.js';
import { showToast } from '../modules/ui.js';
import { logger } from '../modules/logger.js';
import { BEAN_PHRASES, listOf, beanList, openingBean, recipeBeanId, beanRows, batchRows, batchPick, beanSubtitle } from './bean-model.js';
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
    // be read leaves the recipe with no Bean.
    let recipeBatch = null;
    if (recipe && recipe.beanId == null && recipe.beanBatchId != null && !batches.some(batch => sameId(batch?.id, recipe.beanBatchId))) {
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
 * - `write(send)`: makes the write `send` makes, once a dial-in change still on
 *   its way has landed, and resolves once it has (`writePick` in page.js).
 */
export async function openBeanDialog({ mayOpen, epoch, recipe, saved, write }) {
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
        const context = workflow?.context || {};
        const list = beanList(read.beans, read.batches) || [];
        const own = recipeBeanId(loaded, read.batches, read.recipeBatch);
        const isSaved = saved();
        const today = todayHere();
        const batchesOf = beanId => batchRows(list.find(entry => sameId(entry.bean.id, beanId)), context, today, formatRoastDay, cafeText);
        const first = openingBean(list, context, read.batches);
        const row = await choose({
            title: BEAN_PHRASES.title,
            subtitle: beanSubtitle(loaded, isSaved, first, own),
            label: cafeText('Batches'),
            heading: list.length ? BEAN_PHRASES.batchHeading : null,
            rows: batchesOf(first),
            empty: BEAN_PHRASES.empty,
            side: list.length ? {
                heading: BEAN_PHRASES.beanHeading,
                rows: beanRows(list, first, cafeText),
                show: shown => ({ subtitle: beanSubtitle(loaded, isSaved, shown.id, own), rows: batchesOf(shown.id) }),
            } : null,
        });
        const patch = row && batchPick(row.bean, row.batch, context);
        if (!patch) return; // closed, or the batch in use tapped: nothing is written
        try {
            await write(() => updateWorkflow(patch, 'beans.select'));
        } catch (error) {
            logger.warn('Cafe: could not change the bean', error);
            showToast(cafeText('Could not change the bean'), 4000, 'error');
            return;
        }
        // The page reads the names again, the roast date with them.
        document.dispatchEvent(new Event('streamline:workflow-refresh'));
    } finally {
        opening = false;
    }
}
