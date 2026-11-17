// The grinder dialog: a tap on the Grind row's name lists the tablet's
// grinders, and a choice sets the machine to that grinder, at the setting it
// was last used at (docs/cafe/DESIGN.md, "What the screen shows"). What a row
// says and what a choice writes are grinder-model.js's. This module reads what
// they need, shows the list (pick-dialog.js) and makes the one Workflow write,
// through the page, which orders it among the dial-in's other writes.
//
// The skin writes no DYE2 record for a choice. On a Machine Decent Sync serves,
// with a Recipe loaded, Decent Sync records the Recipe's grinder from the
// Workflow; elsewhere the choice is this machine's until another recipe loads.
import { getGrinders, getWorkflow, updateWorkflow } from '../modules/api.js';
import { showToast } from '../modules/ui.js';
import { logger } from '../modules/logger.js';
import { grinderShots } from './shot-seam.js';
import { GRINDER_WINDOW, listedGrinders, lastUse, grinderRows, grinderPick } from './grinder-model.js';
import { choose } from './pick-dialog.js';
import { cafeText } from './text.js';

let opening = false;

// The grinders not archived, and for each the setting it was last used at, in
// this tablet's own Shots. Rejects where any of it can't be read: a list read
// in part would offer a grinder at the wrong setting.
async function readGrinders() {
    const grinders = listedGrinders(await getGrinders(false));
    if (!grinders) throw new Error('Decaid did not answer a list of grinders');
    const uses = await Promise.all(grinders.map(async grinder =>
        [String(grinder.id), lastUse(await grinderShots(grinder.id, GRINDER_WINDOW), grinder.id)]));
    return { grinders, uses: new Map(uses) };
}

/**
 * Open the grinder dialog, and write the grinder chosen.
 *
 * - `mayOpen()`: may it open now? Not while a shot runs, a recipe loads, the
 *   strip is arranged, or another choice is still being written.
 * - `subtitle()`: the line under the title (`pickSubtitle` in page-model.js).
 * - `write(send)`: makes the write `send` makes, once a dial-in change still on
 *   its way has landed, and resolves once it has (`writePick` in page.js).
 */
export async function openGrinderDialog({ mayOpen, subtitle, write }) {
    if (opening || !mayOpen()) return;
    opening = true;
    try {
        let read;
        let workflow;
        try {
            [read, workflow] = await Promise.all([readGrinders(), getWorkflow()]);
        } catch (error) {
            // A list that can't be read is not an empty list.
            logger.warn('Cafe: could not read the grinders', error);
            showToast(cafeText('Could not read the grinders'), 4000, 'error');
            return;
        }
        // A shot may have started, or a recipe begun to load, while they were read.
        if (!mayOpen()) return;
        const context = workflow?.context || {};
        const row = await choose({
            title: 'Grinder',
            subtitle: subtitle(),
            label: cafeText('Grinders'),
            rows: grinderRows(read.grinders, context, read.uses, cafeText),
        });
        const patch = row && grinderPick(row.grinder, row.use, context);
        if (!patch) return; // closed, or the grinder in use tapped: nothing is written
        try {
            await write(() => updateWorkflow(patch, 'cafe.grinder'));
        } catch (error) {
            logger.warn('Cafe: could not change the grinder', error);
            showToast(cafeText('Could not change the grinder'), 4000, 'error');
            return;
        }
        // A grind set on the row is also kept as the profile's own, which a
        // profile sent again, as on waking, puts back. The grinder's setting is
        // kept the same way, so the old grinder's number does not come back.
        const setting = patch.context.grinderSetting;
        if (setting !== undefined) window.app?.saveContextToActiveProfile?.({ grinderSetting: setting });
        // Streamline repaints the number, and steps by the new grinder's step,
        // once it reads the Workflow again; the page reads the names again.
        document.dispatchEvent(new Event('streamline:workflow-refresh'));
    } finally {
        opening = false;
    }
}
