// The basket dialog: a tap on the Yield row's name lists DYE2's baskets, and a
// choice sets the machine to that basket (docs/cafe/DESIGN.md, "The grinder,
// bean and basket dialogs"). What a row says and what a choice writes are
// basket-model.js's. This module reads what they need, shows the list
// (pick-dialog.js) and makes the one Workflow write, through the page, which
// orders it among the dial-in's other writes.
//
// The skin writes no DYE2 record for a choice. On a Machine Decent Sync serves,
// with a Recipe loaded, DYE2 saves the basket onto the Recipe when Decent
// Sync's plugin asks it to save the dial-in, as it saves the numbers.
import { getDye2KvArray, getWorkflow, updateWorkflow } from '../modules/api.js';
import { showToast } from '../modules/ui.js';
import { logger } from '../modules/logger.js';
import { BASKET_PHRASES, listedBaskets, basketRows, basketPick } from './basket-model.js';
import { choose } from './pick-dialog.js';
import { cafeText } from './text.js';

let opening = false;

// DYE2's baskets not archived. Rejects where the list can't be read.
async function readBaskets() {
    const baskets = listedBaskets(await getDye2KvArray('baskets'));
    if (!baskets) throw new Error('DYE2\'s baskets could not be read');
    return baskets;
}

/**
 * Open the basket dialog, and write the basket chosen. Takes what
 * `openGrinderDialog` takes: `mayOpen()`, `epoch()`, `subtitle()` and
 * `write(send)`.
 */
export async function openBasketDialog({ mayOpen, epoch, subtitle, write }) {
    if (opening || !mayOpen()) return;
    opening = true;
    const at = epoch();
    try {
        let baskets;
        let workflow;
        try {
            [baskets, workflow] = await Promise.all([readBaskets(), getWorkflow()]);
        } catch (error) {
            // A list that can't be read is not an empty list.
            logger.warn('Cafe: could not read the baskets', error);
            showToast(cafeText('Could not read the baskets'), 4000, 'error');
            return;
        }
        // A shot may have started, or a recipe loaded, while they were read: the
        // basket in use read then may no longer be.
        if (!mayOpen() || epoch() !== at) return;
        const context = workflow?.context || {};
        const row = await choose({
            title: BASKET_PHRASES.title,
            subtitle: subtitle(),
            label: cafeText('Baskets'),
            rows: basketRows(baskets, context, cafeText),
            empty: BASKET_PHRASES.empty,
        });
        const patch = row && basketPick(row.basket, context);
        if (!patch) return; // closed, or the basket in use tapped: nothing is written
        try {
            await write(() => updateWorkflow(patch, 'cafe.basket'));
        } catch (error) {
            logger.warn('Cafe: could not change the basket', error);
            showToast(cafeText('Could not change the basket'), 4000, 'error');
            return;
        }
        // The page reads the names again.
        document.dispatchEvent(new Event('streamline:workflow-refresh'));
    } finally {
        opening = false;
    }
}
