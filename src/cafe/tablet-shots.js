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

/**
 * - `listShots(limit)`: Decaid's newest Shots, newest first, as `{ items }`,
 *   each with its Workflow and no measurements.
 * - `readShot(id)`: one Shot whole, or null when Decaid no longer has it.
 * - `readChoices()`: the stored choices, or null when none were kept.
 * - `writeChoices(choices)`.
 */
export function createTabletShots({ listShots, readShot, readChoices, writeChoices }) {
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
         * the tablet no longer has the Shot chosen; and `canChange`, whether
         * another can be chosen now, which on the tablet's own Shots it can.
         */
        async referenceShot(recipeId) {
            const id = chosenShotId(await readChoices(), recipeId);
            return { shot: id ? await readShot(id) : null, canChange: true };
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
