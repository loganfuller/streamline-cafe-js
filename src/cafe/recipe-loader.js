// Which recipe the strip shows as loaded, which taps load or unload one, and
// the order those are written in (docs/cafe/DESIGN.md, "Recipes and the
// strip"). No browser global is touched: the caller passes in Streamline's
// apply, the unload, the read of DYE2, the painter, and whether a shot runs.
//
// A tap on a card loads its recipe; a tap on the loaded card unloads it. Loads
// and unloads run one at a time, and a tap made while one runs waits for it.
// Without that, two taps in quick succession could write the Workflow in the
// other order, leaving the machine on the first recipe under the second one's
// name; and an unload sent while a load's write is on its way would be undone
// when that write landed, since Streamline's apply writes the marker with it.
//
// Before either is written, dial-in edits still on their way are let land:
// written after a load, they would change the new recipe instead. In the
// seconds after a pour, both wait until Decaid has stored the Shot, which takes
// the Workflow's recipe as it is then. And the recipe is read again from DYE2's
// records, so what is loaded is what DYE2 holds now, not what the card showed
// when it was last drawn.
import { createLatestTaskRunner } from '../modules/latest-task-runner.js';
import { loadedAfterRead } from './strip-model.js';

// Does DYE2's selection name this recipe as the loaded one?
const names = (selection, recipe) => !!selection && selection.kind === 'recipe' && String(selection.id) === String(recipe.id);

/**
 * - `apply(recipe)` loads a recipe (Streamline's `applyRecipe`) and rejects when
 *   it could not.
 * - `unload()` clears DYE2's selection, which unloads whatever recipe is
 *   loaded and changes nothing else, and rejects when it could not.
 * - `read()` resolves `{ rows, selection }`: DYE2's records, or null when the
 *   read failed, and its selection, or undefined when it could not be asked.
 * - `show(recipes, loaded)` paints.
 * - `settle()` resolves once edits made before the tap have been written, and
 *   rejects when they could not be: the load or unload is then not made.
 * - `afterShot()` resolves once Decaid has stored the Shot of a pour that has
 *   just ended, at once when none has.
 * - `shotRunning()` says whether a shot runs. No card takes a tap during one,
 *   and a tap that finds one running once it is its turn, or once DYE2 has
 *   been read just before the write, does nothing.
 * - `onLoading(loading)` is told when a tap's load or unload begins and when the
 *   last one has finished, so the page can keep the dial-in still in between:
 *   an edit made then belongs to neither recipe for certain.
 * - `onApplied()` runs after each load or unload, made or not.
 * - `onError(error, recipe)` is told of a load that failed, and
 *   `onUnloadError(error, recipe)` of an unload that failed.
 *
 * Returns `tap(recipe)`, `refresh()` and `busy()`, which is true from a tap
 * until its load or unload has finished.
 */
export function createRecipeLoader({
    apply, unload = async () => {}, read, show,
    settle = async () => {}, afterShot = async () => {}, shotRunning = () => false,
    onLoading = () => {}, onApplied = () => {}, onError = () => {}, onUnloadError = () => {},
}) {
    let recipes = [];
    let loaded = null;     // what the strip shows as loaded: a tap moves it at once
    let confirmed = null;  // what DYE2, or the last load or unload made, said is loaded
    let taps = 0;
    let reads = 0;
    let loading = false;   // a tap's load or unload has not finished
    let tapped = null;     // the id of the newest tap's recipe, while loading

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

    async function loadNow(recipe) {
        // What DYE2 holds now. A read that fails leaves the card's own copy.
        const { rows } = await read();
        const current = rows ? rows.find(r => r && r.id === recipe.id) : recipe;
        if (!current) throw new Error('The recipe is no longer in DYE2.');
        if (rows) recipes = rows;
        // A shot that started during the read is left alone too.
        if (shotRunning()) return;
        await apply(current);
        confirmed = current;
    }

    async function unloadNow(recipe) {
        const { rows, selection } = await read();
        if (rows) recipes = rows;
        // A recipe DYE2 no longer names as loaded, unloaded or replaced elsewhere
        // meanwhile, is not unloaded again: that would unload whatever is loaded
        // now. Where DYE2 could not be asked, that can't be ruled out, so the
        // unload is not made, and fails.
        if (selection === undefined) throw new Error('DYE2 could not say which recipe is loaded.');
        if (!names(selection, recipe)) {
            confirmed = loadedAfterRead(selection, recipes, confirmed);
            return;
        }
        // A shot that started during the read is left alone too.
        if (shotRunning()) return;
        await unload();
        confirmed = null;
    }

    // One load or unload at a time. A tap made while one runs replaces any tap
    // already waiting, so only the newest is written after it.
    const run = createLatestTaskRunner(async ({ kind, recipe, seq }) => {
        try {
            await settle();
            await afterShot();
            // A shot that started meanwhile is left alone: a load would change
            // the running shot, and an unload would file it under no recipe.
            if (!shotRunning()) await (kind === 'unload' ? unloadNow(recipe) : loadNow(recipe));
        } catch (error) {
            (kind === 'unload' ? onUnloadError : onError)(error, recipe);
        }
        onApplied();
        if (seq !== taps) return; // a newer tap is waiting, and owns the strip
        loading = false;
        tapped = null;
        loaded = confirmed; // one that failed, or was not made, goes back to what was loaded
        paint();
        onLoading(false);
        await refresh(); // DYE2's answer decides
    }, error => onError(error, null));

    function queue(kind, recipe) {
        if (!loading) onLoading(true);
        loading = true;
        tapped = recipe.id;
        // The highlight moves at the tap, and comes back if it was not made.
        loaded = kind === 'unload' ? null : recipe;
        paint();
        run({ kind, recipe, seq: ++taps });
    }

    function tap(recipe) {
        if (shotRunning()) return;
        if (loading) {
            // The card of the newest tap, still on its way: the second tap of a
            // double tap, which must not undo the first.
            if (tapped === recipe.id) return;
            queue('load', recipe);
            return;
        }
        queue(loaded && loaded.id === recipe.id ? 'unload' : 'load', recipe);
    }

    return { tap, refresh, busy: () => loading };
}

/**
 * Clear DYE2's selection, which unloads the recipe and leaves every setting as
 * it was. Streamline's strip module is told first (`forget`, its
 * `forgetAppliedItem`): a request of its own that is still retrying would
 * otherwise name the recipe to DYE2 again after `post` cleared it.
 */
export async function unloadSelection({ forget, post }) {
    forget();
    await post();
}
