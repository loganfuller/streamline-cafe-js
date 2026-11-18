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
import { LATEST_WINDOW, shotsWithRecipe, isUnfinished, chosenShotId, withChosenShot, shotRecipeId, shotCredit } from './shot-model.js';
import { shotRemarks, annotationsOf, editReadAgain, ratingOf, noteOf } from './remarks.js';
import { nextPage } from './shot-list.js';

const text = value => (typeof value === 'string' ? value.trim() : '');
const positive = value => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);

/**
 * A row of Decaid's list as the seam lists a Shot (`shotsPage` in
 * shot-seam.js), the same thing a row of the Location's list becomes
 * (`locationRow` in plugin-shots.js). A row of Decaid's carries the Shot's
 * Workflow and annotations and no measurements, so it has no duration and
 * does not say whether the Shot is Unfinished; it names its recipe by its
 * DYE2 record id only; and it is this machine's own.
 *
 * `choices` is the choice of reference kept on the tablet, recipe to Shot, or
 * null where it is not known which Shots are references.
 */
export function tabletRow(row, choices = null) {
    const context = row?.workflow?.context || {};
    const annotations = row?.annotations || {};
    const recipeId = shotRecipeId(row?.workflow);
    const { when, who } = shotCredit(row);
    const id = String(row.id);
    const known = !!choices && typeof choices === 'object' && !Array.isArray(choices);
    return {
        id,
        when,
        recipeId,
        recipeName: null,
        bean: text(context.coffeeName),
        // The dose the Shot weighed, or where it weighed none the one its
        // Workflow set; the yield Decaid kept, which is the scale's last
        // reading where the shot was not stopped on weight.
        dose: positive(annotations.actualDoseWeight) ?? positive(context.targetDoseWeight),
        yield: positive(annotations.actualYield),
        duration: null,
        rating: ratingOf(annotations.enjoyment),
        barista: who,
        hasNote: noteOf(annotations.espressoNotes) !== null,
        unfinished: null,
        referenceOf: known ? (recipeId !== null && choices[recipeId] === id ? [recipeId] : []) : null,
        machine: null,
        thisMachine: true,
    };
}

/**
 * - `listShots(limit, offset, filter)`: a page of Decaid's Shots, newest
 *   first, as `{ items, total }`, each with its Workflow and no measurements.
 *   With no offset, the newest; with a `filter` of `{ grinderId }`, that
 *   grinder's only.
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
         * A grinder's latest Shots on this tablet, newest first, as Decaid
         * lists them for that grinder, each with its Workflow: what the
         * setting it was last used at is read from (`lastUse` in
         * grinder-model.js). Read here on a Machine Decent Sync serves too.
         * Rejects on an answer with no list of Shots: that is a read that
         * failed, not a grinder never used.
         */
        async grinderShots(grinderId, limit) {
            const page = await listShots(limit, 0, { grinderId });
            if (!Array.isArray(page?.items)) throw new Error('Decaid did not answer a list of Shots');
            return page.items;
        },

        /**
         * A page of the tablet's Shots for the Shots list, newest first:
         * `rows`, each as `tabletRow` gives it, and `next`, where the next
         * page starts, or null on the last. `from` is the page before's
         * `next`, or null for the first page: Decaid's list is read by offset.
         * `choices` is the choice of reference kept on the tablet, or null
         * where it is not known which Shots are references.
         */
        async shotsPage(from, limit, choices = null) {
            const offset = Number.isInteger(from) && from > 0 ? from : 0;
            const page = await listShots(limit, offset);
            const items = page && Array.isArray(page.items) ? page.items : [];
            const { offset: next, done } = nextPage({ offset, read: items.length, asked: limit, total: page && typeof page.total === 'number' ? page.total : null });
            return { rows: items.filter(row => row && row.id != null).map(row => tabletRow(row, choices)), next: done ? null : next };
        },

        /**
         * One of the tablet's Shots by its id: `shot`, whole, or null when
         * Decaid no longer has it, and `canChange`, which the tablet's own
         * Shot always can be.
         */
        async shotById(id) {
            return { shot: await readShot(id), canChange: true };
        },

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
