// The barista dialog: a tap on the title band's barista lists the names on
// recent Shots, "No barista" and "New barista", and a choice names the barista
// at the machine (docs/cafe/DESIGN.md, "The barista"). What a row says, what a
// typed name becomes and what a choice writes are barista-model.js's. This
// module reads what they need, shows the list (pick-dialog.js) and makes the
// one Workflow write, through the page, which orders it among the dial-in's
// other writes. The machine seen asleep clears the name the same way.
//
// The name is the Workflow's alone: nothing here keeps a copy of it. A recipe
// load leaves it as it was (the hook in dyeStrip.js's applyRecipe).
import { getWorkflow, updateWorkflow } from '../modules/api.js';
import { showToast } from '../modules/ui.js';
import { logger } from '../modules/logger.js';
import { shotsPage } from './shot-seam.js';
import { PAGE_SIZE } from './shot-list.js';
import { whenText } from './shot-model.js';
import { BARISTA_PHRASES, baristaName, baristaRows, typedBarista, baristaPick, sleepClear } from './barista-model.js';
import { choose } from './pick-dialog.js';
import { cafeText, cafeDateLocale } from './text.js';

let opening = false;

// The rows of the seam's first page, newest first: on a Machine Decent Sync
// serves the Location's Shots, otherwise and while the server can't be reached
// the tablet's own. A list that can't be read is no names, not a dialog that
// does not open: the name in use, "No barista" and "New barista" still are.
async function recentShots() {
    try {
        return (await shotsPage(null, PAGE_SIZE)).rows || [];
    } catch (error) {
        logger.info(`Cafe: no recent Shots for the barista dialog: ${error.message}`);
        return [];
    }
}

/**
 * Open the barista dialog, and write the barista chosen or typed.
 *
 * - `mayOpen()`: may it open now? Not while a shot runs, a recipe loads, the
 *   strip is arranged, or another choice is still being written.
 * - `shown()`: the name the button shows, which stands in for the Workflow's
 *   where the Workflow can't be read.
 * - `seen(name)`: the Workflow's name, as the dialog read it; `written(name)`,
 *   the name a write made, '' for none.
 * - `write(send)`: makes the write `send` makes, once a dial-in change still on
 *   its way has landed, and resolves once it has (`writePick` in page.js).
 */
export async function openBaristaDialog({ mayOpen, shown, seen, written, write }) {
    if (opening || !mayOpen()) return;
    opening = true;
    try {
        const [shots, workflow] = await Promise.all([recentShots(), getWorkflow().catch(() => null)]);
        // A shot may have started, or a recipe load begun, while they were read.
        if (!mayOpen()) return;
        const context = workflow ? workflow.context || {} : { baristaName: shown() };
        if (workflow) seen(baristaName(context));
        const now = new Date();
        const when = date => whenText(date, now, cafeDateLocale(), cafeText('Today'));
        const rows = baristaRows(shots, baristaName(context), cafeText, when);
        const answer = await choose({
            title: BARISTA_PHRASES.title,
            subtitle: { key: BARISTA_PHRASES.subtitle },
            label: cafeText('Baristas'),
            rows,
            entry: {
                action: BARISTA_PHRASES.add,
                title: BARISTA_PHRASES.add,
                label: BARISTA_PHRASES.field,
                back: BARISTA_PHRASES.back,
                use: BARISTA_PHRASES.use,
            },
        });
        if (!answer) return; // closed
        const typed = Object.prototype.hasOwnProperty.call(answer, 'entered');
        const name = typed ? typedBarista(answer.entered, rows) : answer.barista;
        if (typed && name === null) return; // nothing but spaces
        const patch = baristaPick(name, context);
        if (!patch) return; // the barista in use: nothing is written
        try {
            await write(() => updateWorkflow(patch, 'cafe.barista'));
        } catch (error) {
            // The button keeps the name the Workflow holds.
            logger.warn('Cafe: could not change the barista', error);
            showToast(cafeText('Could not change the barista'), 4000, 'error');
            return;
        }
        written(patch.context.baristaName || '');
        // The page reads the Workflow again, as after the other dialogs.
        document.dispatchEvent(new Event('streamline:workflow-refresh'));
    } finally {
        opening = false;
    }
}

/**
 * The machine was seen asleep: clear the barista, where one is named, so the
 * wake starts with none however the machine is woken. The Workflow is read
 * once any write still on its way has landed, and written only where it names
 * a barista. A clear that fails says so in the log alone: the screensaver
 * covers the page, and the next sleep clears it.
 */
export async function clearOnSleep({ write, written }) {
    try {
        const cleared = await write(async () => {
            const patch = sleepClear((await getWorkflow())?.context);
            if (!patch) return false;
            await updateWorkflow(patch, 'cafe.barista');
            return true;
        });
        if (cleared) written('');
    } catch (error) {
        logger.warn('Cafe: could not clear the barista as the machine slept', error);
    }
}
