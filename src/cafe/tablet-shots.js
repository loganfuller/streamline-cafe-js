// The Shot seam's one source today: the tablet itself (docs/cafe/DESIGN.md,
// "Shots and the reference"). Decaid's own Shots, with the choice of reference
// kept in the `streamlineCafe` namespace as recipe to Shot. A recipe is named
// by its DYE2 record id throughout. No browser global is touched: what reaches
// Decaid is handed in, and shot-seam.js hands it in.
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
    return {
        /**
         * This machine's latest Shot pulled with a recipe, whole, or null when
         * the tablet's newest Shots hold none. The newest match is read whole,
         * and the next one tried when it is Unfinished or has gone meanwhile.
         *
         * With no recipe (null) it is the tablet's newest Shot, whatever it was
         * pulled with and Unfinished or not, as Streamline shows it.
         */
        async latestShot(recipeId) {
            if (recipeId == null) {
                const newest = ((await listShots(1)) || {}).items;
                return Array.isArray(newest) && newest[0] ? readShot(newest[0].id) : null;
            }
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
         * Make a Shot a recipe's reference. The choices are read again first,
         * so another recipe's choice is kept. Nothing clears a reference.
         */
        async makeReference(recipeId, shotId) {
            await writeChoices(withChosenShot(await readChoices(), recipeId, shotId));
        },
    };
}
