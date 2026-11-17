// The Shot seam's second source: Decent Sync's plugin (docs/cafe/DESIGN.md,
// "Shots and the reference" and "The Shots list"). On a Machine it serves, a
// recipe's reference is the Recipe's Reference Shot, the one every tablet at
// the Location draws, read and chosen through the plugin's `reference`
// request; the Shots list is every Shot at the Location, whichever Machine
// pulled it; and another Machine's Shot is read whole, and edited, through
// the plugin. The contract is
// "For a Skin's author" in Decent Sync's docs/PLUGIN.md. A recipe is named by
// its DYE2 record id throughout. No browser global is touched: what reaches the
// plugin is handed in, and shot-seam.js hands it in.
//
// The skin keeps no copy of a reference: the one drawn while the server can't
// be reached is the plugin's own.
import { ratingOf, noteOf, editReadAgain } from './remarks.js';

// The server could not be asked. `serverTooOld` is treated as `unreachable`,
// as the contract asks.
const CANT_ASK = ['unreachable', 'serverTooOld'];
// The Machine is not served any more: the status says so the next time it is asked.
const NOT_SERVED = ['captureOnly', 'hardwareMismatch'];

// Could the server not be asked? So too where Decaid answered in the plugin's
// place, with a status and no `code`.
const cantAsk = error => CANT_ASK.includes(error.code) || (error.code === undefined && error.status !== undefined);

const text = value => (typeof value === 'string' ? value.trim() : '');
const positive = value => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);
// A Recipe's DYE2 record id on this tablet, or null where the tablet holds no record of it.
const recordId = recipe => (recipe && recipe.recordId != null && recipe.recordId !== '' ? String(recipe.recordId) : null);

/**
 * A row of the plugin's `shots` answer as the seam lists a Shot (`shotsPage`
 * in shot-seam.js), the same thing a row of Decaid's list becomes
 * (`tabletRow` in tablet-shots.js):
 *
 * - `id`; `when`, a Date, from `pulledAt`, or null.
 * - `recipeId`, the id of this tablet's DYE2 record of the Shot's recipe, or
 *   null for a Shot with no Recipe, or one this tablet has no record of;
 *   `recipeName`, the Recipe's name on the server, or null for no Recipe.
 * - `bean`; `dose`, the one weighed, or where none was the one aimed for;
 *   `yield`; `duration`, in seconds, its Preheat left out; each null where
 *   the Shot recorded none.
 * - `rating`, null for unrated; `barista`; `hasNote`; `unfinished`.
 * - `referenceOf`: the Recipes of this Location it is the Reference Shot of,
 *   each by its DYE2 record id, or null where this tablet has no record.
 * - `machine`, the name of the Machine that pulled it, and `thisMachine`,
 *   whether that is this one: `machineId` is this Machine's id on the server,
 *   from the status, and where it is not known, the row's own word on whether
 *   this tablet reported the Shot.
 */
export function locationRow(row, machineId = null) {
    const recipe = row.recipe && typeof row.recipe === 'object' ? row.recipe : null;
    const when = typeof row.pulledAt === 'string' ? new Date(row.pulledAt) : null;
    const machine = row.machine && typeof row.machine === 'object' ? row.machine : null;
    return {
        id: String(row.id),
        when: when && !Number.isNaN(when.getTime()) ? when : null,
        recipeId: recordId(recipe),
        recipeName: recipe ? text(recipe.name) || null : null,
        bean: text(row.bean?.name),
        dose: positive(row.dose) ?? positive(row.targetDose),
        yield: positive(row.yield),
        duration: positive(row.duration),
        rating: ratingOf(row.rating),
        barista: text(row.barista),
        hasNote: row.hasNote === true,
        unfinished: row.unfinished === true,
        referenceOf: (Array.isArray(row.referenceOf) ? row.referenceOf : []).filter(of => of && typeof of === 'object').map(recordId),
        machine: machine ? text(machine.name) || null : null,
        thisMachine: machineId != null && machine && machine.id != null ? String(machine.id) === String(machineId) : row.onThisTablet === true,
    };
}

/**
 * The seam's answer for a reference, from the plugin's answer to `reference`:
 * `shot`, whole, or null where the Recipe has none; `canChange`; `unreachable`,
 * whether the server can't be reached, so this is the tablet's copy; and, with
 * a Shot, `profileDiffers`, Decent Sync's word on whether it was pulled on
 * another Profile than the Recipe's, and its `rating` and `note`, which are
 * the answer's own. `referenceShot` below adds `unread`, where the server
 * can't be reached and there was no copy to read either.
 */
export function referenceFrom(answer) {
    const reference = answer && typeof answer === 'object' ? answer.reference : null;
    const shot = reference && reference.shot && reference.shot.id != null ? reference.shot : null;
    const copy = !!answer && answer.source === 'tablet';
    return {
        shot,
        canChange: !copy,
        unreachable: copy,
        ...(shot ? { profileDiffers: reference.profileDiffers === true, rating: ratingOf(reference.rating), note: noteOf(reference.note) } : {}),
    };
}

/**
 * What a push on the plugin's `changes` socket says, or null for one to
 * ignore: a `what` this skin does not know, which later releases may add, or
 * anything that is not a push at all.
 *
 * - `{ what: 'connection' }`: the plugin's connection to the server came or went.
 * - `{ what: 'reference', recipeId }`: the tablet's copy of that recipe's
 *   Reference Shot changed. `recipeId` is its DYE2 record id on this tablet.
 */
export function changeOf(data) {
    let push = data;
    if (typeof data === 'string') {
        try { push = JSON.parse(data); } catch (error) { return null; }
    }
    if (!push || typeof push !== 'object') return null;
    if (push.what === 'connection') return { what: 'connection' };
    if (push.what === 'reference') {
        const id = push.recipe && push.recipe.recordId;
        return id == null || id === '' ? null : { what: 'reference', recipeId: String(id) };
    }
    return null;
}

/**
 * - `readReference(recipeId)`: the plugin's answer to `GET reference`.
 * - `chooseReference(recipeId, shotId)`: its answer to `PUT reference`.
 * - `editShot(shotId, edit)`: its answer to `PUT shot`, for `{ rating?, note? }`.
 *
 *   Each rejects with the refusal: an Error with the refusal's `code` and
 *   `message`, and the HTTP `status`. One Decaid answered itself has a `status`
 *   and no `code`; a request that reached nothing has neither.
 * - `listShots(cursor, limit)`: its answer to `GET shots`, a page of the
 *   Location's Shots. `readWhole(id)`: its answer to `GET shot`, one of them
 *   whole. Both reject as the three above do.
 * - `readShot(id)`: one of the tablet's own Shots, whole, from Decaid, or null.
 * - `notServed()`: called when a refusal says the Machine is not served any
 *   more, so the caller can ask the status again.
 */
export function createPluginShots({ readReference, chooseReference, editShot, readShot, listShots, readWhole, notServed = () => {} }) {
    // A Shot whole, from Decaid where this tablet holds it and through the
    // plugin otherwise; null for one that is in neither. `met.unreachable` is
    // set where the server could not be asked for it.
    async function wholeShot(shotId, met = {}) {
        const own = await readShot(shotId);
        if (own) return own;
        try {
            const answer = await readWhole(shotId);
            if (!answer || typeof answer !== 'object') throw new Error('The plugin\'s answer holds no Shot.');
            return answer.shot && answer.shot.id != null ? answer.shot : null;
        } catch (error) {
            if (error.code === 'noSuchShot') return null;
            if (NOT_SERVED.includes(error.code)) notServed();
            if (cantAsk(error)) met.unreachable = true;
            throw error;
        }
    }

    const source = {
        /**
         * A page of the Shots at the Machine's Location, newest first:
         * `rows`, each as `locationRow` gives it, and `next`, the cursor of
         * the next page, or null on the last. `cursor` is the page before's
         * `next`, or null for the first page. Rejects with the plugin's
         * refusal, which the caller reads: the list has no copy on the tablet.
         */
        async shotsPage(cursor, limit, machineId = null) {
            const answer = await listShots(cursor, limit);
            if (!answer || typeof answer !== 'object' || !Array.isArray(answer.shots)) throw new Error('The plugin\'s answer holds no list of Shots.');
            return {
                rows: answer.shots.filter(row => row && typeof row === 'object' && row.id != null).map(row => locationRow(row, machineId)),
                next: typeof answer.nextCursor === 'string' && answer.nextCursor ? answer.nextCursor : null,
            };
        },

        /**
         * One Shot by its id: `shot`, whole, or null where it is gone, and
         * `canChange`, whether it can be rated, noted and made a reference
         * now. This tablet's own Shot is read from Decaid, with the server or
         * without it. Any other is read whole through the plugin, one at a
         * time, and is gone where the plugin refuses it as `noSuchShot`.
         *
         * Where the server can't be asked for another Machine's Shot the read
         * rejects, with `unreachable`: a Shot of that kind already in the
         * graph can't be changed until the server is back.
         */
        async shotById(shotId) {
            const met = {};
            try {
                return { shot: await wholeShot(shotId, met), canChange: true };
            } catch (error) {
                if (met.unreachable) error.unreachable = true;
                throw error;
            }
        },

        /**
         * A recipe's reference, as `referenceFrom` gives it.
         *
         * - Where the server can't be reached and the tablet holds no copy, as
         *   for a recipe in no slot, there is no Shot, and `unreachable` and
         *   `unread` say why. So too when Decaid answered in the plugin's place.
         * - A recipe the Library does not have yet, as one made on the page a
         *   moment ago, has no reference, and one can be chosen: the choice is
         *   then refused with a message to show.
         * - Any other refusal rejects, so the page keeps what it shows.
         */
        async referenceShot(recipeId) {
            try {
                return referenceFrom(await readReference(recipeId));
            } catch (error) {
                if (cantAsk(error)) {
                    return { shot: null, canChange: false, unreachable: true, unread: true };
                }
                if (error.code === 'noSuchRecipe') return { shot: null, canChange: true, unreachable: false };
                if (NOT_SERVED.includes(error.code)) notServed();
                throw error;
            }
        },

        /**
         * Make a Shot a recipe's reference. Resolves with the reference as it
         * now is, which is the plugin's answer.
         *
         * A choice answered `unreachable`, or by Decaid with no `code`, or not
         * answered at all, may have been made all the same. So the reference is
         * read again, and the choice has failed only if it is not the Shot
         * chosen. The error then carries what was read, as `reference`, for the
         * page to follow. Any other refusal rejects with `refusal`, its message
         * to show, and changes nothing.
         */
        async makeReference(recipeId, shotId) {
            let refused;
            try {
                return referenceFrom(await chooseReference(recipeId, shotId));
            } catch (error) {
                refused = error;
            }
            if (refused.code !== undefined && !CANT_ASK.includes(refused.code)) {
                if (NOT_SERVED.includes(refused.code)) notServed();
                throw Object.assign(new Error(refused.message), { code: refused.code, refusal: refused.message });
            }
            let now = null;
            try { now = await source.referenceShot(recipeId); } catch (error) { /* not known: the choice is shown as failed */ }
            if (now && now.shot && String(now.shot.id) === String(shotId)) return now;
            throw Object.assign(new Error(refused.message), { code: refused.code, reference: now });
        },

        /**
         * Set a Shot's rating, its note or both: `edit` is `{ rating?, note? }`,
         * and only what it names is sent. Resolves with the Shot's rating and
         * note as they now are, which is the plugin's answer. The plugin
         * writes the tablet's own Shot through Decaid, with the server or
         * without it, and asks the server for any other.
         *
         * An edit answered `unreachable`, or by Decaid with no `code`, or not
         * answered at all, may have been made all the same. So the Shot is
         * read again, and the edit has failed only if it does not hold what
         * was asked for. That read is Decaid's for a Shot this tablet holds,
         * and the plugin's for any other. Where the server could not be asked
         * for that read either, nothing is known either way, and the error
         * carries `unreachable`. Any other refusal rejects with `refusal`,
         * its message to show, and changes nothing. One of them is read again
         * all the same: `shotUnwritten` also says Decaid did not answer its
         * own edit, which it may have made, and that Shot is the tablet's own.
         */
        async editShot(shotId, edit) {
            let refused;
            try {
                const answer = await editShot(shotId, edit);
                return { rating: ratingOf(answer?.rating), note: noteOf(answer?.note) };
            } catch (error) {
                refused = error;
            }
            if (refused.code !== undefined && !CANT_ASK.includes(refused.code)) {
                if (NOT_SERVED.includes(refused.code)) notServed();
                const shown = Object.assign(new Error(refused.message), { code: refused.code, refusal: refused.message });
                if (refused.code !== 'shotUnwritten') throw shown;
                return editReadAgain(edit, () => readShot(shotId), refused).catch(read => { throw Object.assign(shown, { remarks: read.remarks }); });
            }
            const met = {};
            return editReadAgain(edit, () => wholeShot(shotId, met), refused).catch(read => {
                throw met.unreachable ? Object.assign(read, { unreachable: true }) : read;
            });
        },
    };
    return source;
}
