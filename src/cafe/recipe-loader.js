// Which recipe the strip shows as loaded, and the order loads are written in
// (docs/cafe/DESIGN.md, "Recipes and the strip"). No browser global is touched:
// the caller passes in Streamline's apply, the read of DYE2, and the painter.
//
// Loads run one at a time, and a tap made while one runs waits for it. Without
// that, two taps in quick succession could write the Workflow in the other
// order, leaving the machine on the first recipe under the second one's name.
//
// Before a load is written, dial-in edits still on their way are let land, and
// are saved onto the recipe being left: written after the load, they would
// change the new recipe instead. And the recipe is read again from DYE2's
// records, so what is loaded is what DYE2 holds now, not what the card showed
// when it was last drawn.
import { createLatestTaskRunner } from '../modules/latest-task-runner.js';
import { loadedAfterRead } from './strip-model.js';

/**
 * - `apply(recipe)` loads a recipe (Streamline's `applyRecipe`) and rejects when
 *   it could not.
 * - `read()` resolves `{ rows, selection }`: DYE2's records, or null when the
 *   read failed, and its selection, or undefined when it could not be asked.
 * - `show(recipes, loaded)` paints.
 * - `settle()` resolves once edits made before the tap have been written and
 *   saved.
 * - `onApplied()` runs after each load is written, landed or not.
 * - `onError(error, recipe)` is told of a load that failed.
 */
export function createRecipeLoader({ apply, read, show, settle = async () => {}, onApplied = () => {}, onError = () => {} }) {
    let recipes = [];
    let loaded = null;     // what the strip shows as loaded: a tap moves it at once
    let confirmed = null;  // what DYE2, or the last load that landed, said is loaded
    let taps = 0;
    let reads = 0;
    let loading = false;   // a tap's load has not finished
    let applying = false;  // the load itself is being written

    const paint = () => show(recipes, loaded);

    // Read DYE2's records and its selection again. Dropped while a load runs, and
    // when a tap lands during the read: the load's own read follows it. Dropped
    // too when a later read has begun, so an answer that was slow to arrive never
    // paints over a newer one.
    async function refresh() {
        if (loading) return;
        const seq = taps;
        const mine = ++reads;
        const { rows, selection } = await read();
        if (loading || seq !== taps || mine !== reads) return;
        // A failed read keeps what is on screen: an error is not an empty strip.
        if (rows) recipes = rows;
        loaded = confirmed = loadedAfterRead(selection, recipes, confirmed);
        paint();
    }

    // One load at a time. A tap made while one runs replaces any tap already
    // waiting, so only the newest is written after it.
    const run = createLatestTaskRunner(async ({ recipe, seq }) => {
        try {
            await settle();
            // What DYE2 holds now. A read that fails leaves the card's own copy.
            const { rows } = await read();
            const current = rows ? rows.find(r => r && r.id === recipe.id) : recipe;
            if (!current) throw new Error('The recipe is no longer in DYE2.');
            if (rows) recipes = rows;
            applying = true;
            try {
                await apply(current);
            } finally {
                applying = false;
            }
            confirmed = current;
        } catch (error) {
            onError(error, recipe);
        }
        onApplied();
        if (seq !== taps) return; // a newer tap is waiting, and owns the strip
        loading = false;
        loaded = confirmed; // a load that failed goes back to what was loaded
        paint();
        await refresh(); // DYE2's answer decides
    }, error => onError(error, null));

    function load(recipe) {
        // The loaded card takes no tap, as on Streamline's strip: loading it again
        // would put the stored values back over a dial-in in progress.
        if (loaded && loaded.id === recipe.id) return;
        loading = true;
        loaded = recipe;
        paint();
        run({ recipe, seq: ++taps });
    }

    /**
     * The recipe a dial-in edit made now belongs to, or null: none is loaded, or
     * the Workflow write under way is a load's own, not an edit.
     */
    const editing = () => (applying ? null : confirmed);

    return { load, refresh, editing };
}
