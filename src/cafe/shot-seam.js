// The Shot seam: the one place the page asks for a recipe's latest Shot, for
// its reference, to make a Shot its reference, for the tablet's newest Shot,
// to set a Shot's rating and note, for a page of the Shots list and for one
// Shot by its id (docs/cafe/DESIGN.md, "Shots and the reference", "Rating and
// notes" and "The Shots list"). The page reads and changes Shots, and
// the choice, no other way, so which source answers changes no caller.
//
// It has two sources. The latest and the newest Shot are always the tablet's
// own (tablet-shots.js). The reference is Decent Sync's on a Machine it serves
// (plugin-shots.js) and the tablet's otherwise, and an edit goes the same way.
// So do the Shots list, which on a served Machine is every Shot at its
// Location, and a Shot read by its id, which may then be another Machine's.
// What the plugin answers to a status request decides which (shot-sources.js).
//
// The status is asked by page.js, at start-up, when the page comes back into
// view and after each recipe load, and here when the plugin's `changes` socket
// opens or says its connection to the server came or went.
import { getShots, getShot, updateShot } from '../modules/api.js';
import { createTabletShots } from './tablet-shots.js';
import { createPluginShots, changeOf } from './plugin-shots.js';
import { createShotSources } from './shot-sources.js';
import { readCafe, writeCafe, REFERENCES_KEY } from './cafe-store.js';
import { askStatus, onStatus, onPush, readReference, chooseReference, editShot as editPluginShot, listShots as listLocationShots, readShot as readLocationShot } from './decent-sync.js';

let watcher = () => {};

const sources = createShotSources({
    tablet: createTabletShots({
        listShots: (limit, offset) => getShots({ limit, offset }),
        readShot: getShot,
        readChoices: () => readCafe(REFERENCES_KEY),
        writeChoices: choices => writeCafe(REFERENCES_KEY, choices),
        updateShot,
    }),
    plugin: createPluginShots({ readReference, chooseReference, editShot: editPluginShot, readShot: getShot, listShots: listLocationShots, readWhole: readLocationShot, notServed: askStatus }),
    askStatus,
    changed: (recipeId, moved) => watcher(recipeId, moved),
});
onStatus(sources.status);
onPush(push => sources.push(changeOf(push)));

/** This machine's latest Shot pulled with a recipe, whole, or null. With no recipe (null), null. */
export const latestShot = recipeId => sources.latestShot(recipeId);

/**
 * A recipe's reference: `shot`, whole or null; `canChange`, whether another can
 * be chosen now; with a Shot, its `rating` and `note`, each null for none; and
 * from Decent Sync, `unreachable`, the server can't be reached, `unread`, so
 * nothing could be read, and `profileDiffers`.
 */
export const referenceShot = recipeId => sources.referenceShot(recipeId);

/**
 * Make a Shot a recipe's reference. Resolves with the reference as it now is,
 * or with null where the source changed meanwhile and a read is to follow.
 * Rejects with `refusal`, a message to show, where Decent Sync refused the
 * choice; or with `reference`, what a read after it found, where the choice
 * may have been made and was not.
 */
export const makeReference = (recipeId, shotId) => sources.makeReference(recipeId, shotId);

/** The tablet's newest Shot, whole, whatever it was pulled with, or null. */
export const newestShot = () => sources.newestShot();

/**
 * A page of the Shots list, newest first. `from` is the page before's `next`,
 * or null for the first page. The answer:
 *
 * - `rows`: each the same thing whichever source listed it. `id`; `when`, a
 *   Date or null; `recipeId`, the DYE2 record id of its recipe on this tablet,
 *   or null; `recipeName`, the recipe's name where the source gives one;
 *   `bean`; `dose`, `yield` and `duration`, each null where it is not known;
 *   `rating`, null for unrated; `barista`; `hasNote`; `unfinished`, or null
 *   where the source does not say; `referenceOf`, the recipes it is the
 *   reference of, by DYE2 record id, or null where it is not known which
 *   Shots are references; `machine`, the name of the Machine that pulled it,
 *   or null; and `thisMachine`.
 * - `next`: what to ask the next page with, or null on the last.
 * - `list`: what is listed and why, `{ of, why, … }` (`shotsList` in
 *   sync-status.js), which is what the list's header says.
 * - `afresh`: this is a first page though a later one was asked for, because
 *   what is listed changed meanwhile. It takes the place of the rows before.
 */
export const shotsPage = (from, limit) => sources.shotsPage(from, limit);

/**
 * One Shot by its id: `shot`, whole, or null where it is gone, and
 * `canChange`, whether it can be rated, noted and made a reference now.
 * Rejects where it can't be read, with `unreachable` where that is because
 * Decent Sync's server can't be asked for another Machine's Shot.
 */
export const shotById = shotId => sources.shotById(shotId);

/**
 * Set a Shot's rating, its note or both: `edit` is `{ rating?, note? }`, where
 * a rating of 0 clears the rating and empty text the note, and what it leaves
 * out is left alone. Resolves with `{ rating, note }` as they now are, each
 * null for none. Rejects with `refusal`, a message to show, where Decent Sync
 * refused the edit; or with `remarks`, what a read after it found, or null,
 * where the edit may have been made and was not; and with `unreachable`,
 * where that read could not ask Decent Sync's server, so nothing is known
 * either way.
 */
export const editShot = (shotId, edit) => sources.editShot(shotId, edit);

/**
 * `listener(recipeId, moved)` is called when a recipe's reference should be
 * read again: another was chosen elsewhere, or with null, where references are
 * kept changed, or the server came into reach or went out of it. `moved` says
 * where they are kept changed, or that the Machine moved to another Location:
 * a reference read before is the other source's, or the other Location's.
 */
export function watchReference(listener) {
    watcher = listener;
}
