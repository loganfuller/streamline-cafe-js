// The Shot seam's second source: Decent Sync's plugin (docs/cafe/DESIGN.md,
// "Shots and the reference"). On a Machine it serves, a recipe's reference is
// the Recipe's Reference Shot, the one every tablet at the Location draws,
// read and chosen through the plugin's `reference` request. The contract is
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
 * - `readShot(id)`: one of the tablet's own Shots, whole, from Decaid, or null.
 * - `notServed()`: called when a refusal says the Machine is not served any
 *   more, so the caller can ask the status again.
 */
export function createPluginShots({ readReference, chooseReference, editShot, readShot, notServed = () => {} }) {
    const source = {
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
                if (CANT_ASK.includes(error.code) || (error.code === undefined && error.status !== undefined)) {
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
         * was asked for. That read is Decaid's: every Shot the page edits
         * today is the tablet's own. Any other refusal rejects with `refusal`,
         * its message to show, and changes nothing. One of them is read again
         * all the same: `shotUnwritten` also says Decaid did not answer its
         * own edit, which it may have made.
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
            return editReadAgain(edit, () => readShot(shotId), refused);
        },
    };
    return source;
}
