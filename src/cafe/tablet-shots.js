// The Shot seam's first source: the tablet itself (docs/cafe/DESIGN.md,
// "Shots and the reference"). Decaid's own Shots, with the choice of reference
// kept in the `streamlineCafe` namespace as recipe to Shot. The latest Shot is
// always read here. The reference is read and chosen here only where Decent
// Sync does not serve the Machine (shot-sources.js). A recipe is named by its
// DYE2 record id throughout. No browser global is touched: what reaches Decaid
// is handed in, and shot-seam.js hands it in.
//
// Each request rejects when Decaid can't be asked, so the page keeps what it
// shows instead of reading a failure as "none".
import { LATEST_WINDOW, shotsWithRecipe, isUnfinished, chosenShotId, withChosenShot } from './shot-model.js';
import { shotRemarks, annotationsOf, editReadAgain } from './remarks.js';

/**
 * - `listShots(limit, offset)`: a page of Decaid's Shots, newest first, as
 *   `{ items, total }`, each with its Workflow and no measurements. With no
 *   offset, the newest.
 * - `readShot(id)`: one Shot whole, or null when Decaid no longer has it.
 * - `readChoices()`: the stored choices, or null when none were kept.
 * - `writeChoices(choices)`.
 * - `updateShot(id, body)`: Decaid's own Shot edit, which merges `body` into
 *   the Shot and answers with the Shot.
 */
export function createTabletShots({ listShots, readShot, readChoices, writeChoices, updateShot }) {
    const source = {
        /**
         * This machine's latest Shot pulled with a recipe, whole, or null when
         * the tablet's newest Shots hold none. The newest match is read whole,
         * and the next one tried when it is Unfinished or has gone meanwhile.
         *
         * With no recipe (null) it is null, read from nothing: Streamline's
         * history module draws the tablet's newest Shot then.
         */
        async latestShot(recipeId) {
            if (recipeId == null) return null;
            const page = await listShots(LATEST_WINDOW);
            for (const id of shotsWithRecipe(page && page.items, recipeId)) {
                const shot = await readShot(id);
                if (shot && !isUnfinished(shot)) return shot;
            }
            return null;
        },

        /**
         * A recipe's reference: `shot`, whole, or null when none is chosen or
         * the tablet no longer has the Shot chosen; `canChange`, whether
         * another can be chosen now, which on the tablet's own Shots it can;
         * and with a Shot, its `rating` and `note`, from its own record.
         */
        async referenceShot(recipeId) {
            const id = chosenShotId(await readChoices(), recipeId);
            const shot = id ? await readShot(id) : null;
            return { shot, canChange: true, ...(shot ? shotRemarks(shot) : {}) };
        },

        /**
         * The tablet's newest Shot, whole, whatever it was pulled with, or
         * null when it has none. With no recipe loaded the page asks for it to
         * learn the id, rating and note of the Shot Streamline's history
         * module drew, which comes with no record.
         */
        async newestShot() {
            const page = await listShots(1);
            const row = page && Array.isArray(page.items) ? page.items[0] : null;
            return row && row.id != null ? readShot(row.id) : null;
        },

        /**
         * A page of the tablet's Shots for the Shots list, newest first:
         * `items`, rows of Decaid's list, and `total`, how many Decaid says it
         * has, or null where it does not say.
         */
        async shotsPage(offset, limit) {
            const page = await listShots(limit, offset);
            return {
                items: page && Array.isArray(page.items) ? page.items.filter(row => row && row.id != null) : [],
                total: page && typeof page.total === 'number' ? page.total : null,
            };
        },

        /** One of the tablet's Shots, whole, by its id, or null when Decaid no longer has it. */
        shotById: id => readShot(id),

        /** The choices of reference kept on the tablet, recipe to Shot, or null where none were kept. */
        references: () => readChoices(),

        /**
         * Set a Shot's rating, its note or both, with Decaid's own Shot edit:
         * `edit` is `{ rating?, note? }`, and only what it names is sent.
         * Resolves with the Shot's rating and note as they now are.
         *
         * An edit Decaid did not answer may have been made, so the Shot is
         * read again before the edit is called failed (`editReadAgain`).
         */
        async editShot(shotId, edit) {
            let failed;
            try {
                return shotRemarks(await updateShot(shotId, annotationsOf(edit)));
            } catch (error) {
                failed = error;
            }
            return editReadAgain(edit, () => readShot(shotId), failed);
        },

        /**
         * Make a Shot a recipe's reference, and answer with the reference as
         * it now is, read back. The choices are read again first, so another
         * recipe's choice is kept. Nothing clears a reference.
         */
        async makeReference(recipeId, shotId) {
            await writeChoices(withChosenShot(await readChoices(), recipeId, shotId));
            return source.referenceShot(recipeId);
        },
    };
    return source;
}
