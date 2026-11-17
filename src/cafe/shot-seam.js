// The Shot seam: the one place the page asks for a recipe's latest Shot, for
// its reference, to make a Shot its reference, for the tablet's newest Shot,
// to set a Shot's rating and note, for a page of the Shots list and for one
// Shot by its id (docs/cafe/DESIGN.md, "Shots and the reference", "Rating and
// notes" and "The Shots list"). The page reads and changes Shots, and
// the choice, no other way, so which source answers changes no caller.
//
// It has two sources. The latest and the newest Shot are always the tablet's
// own (tablet-shots.js), and so, for now, are the Shots list and a Shot read
// by its id. The reference is Decent Sync's on a Machine it serves
// (plugin-shots.js) and the tablet's otherwise, and an edit goes the same way;
// what the plugin answers to a status request decides which (shot-sources.js).
//
// The status is asked by page.js, at start-up, when the page comes back into
// view and after each recipe load, and here when the plugin's `changes` socket
// opens or says its connection to the server came or went.
import { getShots, getShot, updateShot } from '../modules/api.js';
import { createTabletShots } from './tablet-shots.js';
import { createPluginShots, changeOf } from './plugin-shots.js';
import { createShotSources } from './shot-sources.js';
import { readCafe, writeCafe, REFERENCES_KEY } from './cafe-store.js';
import { askStatus, onStatus, onPush, readReference, chooseReference, editShot as editPluginShot } from './decent-sync.js';

let watcher = () => {};

const sources = createShotSources({
    tablet: createTabletShots({
        listShots: (limit, offset) => getShots({ limit, offset }),
        readShot: getShot,
        readChoices: () => readCafe(REFERENCES_KEY),
        writeChoices: choices => writeCafe(REFERENCES_KEY, choices),
        updateShot,
    }),
    plugin: createPluginShots({ readReference, chooseReference, editShot: editPluginShot, readShot: getShot, notServed: askStatus }),
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
 * A page of the Shots list, newest first, from `offset`: `items`, rows of
 * Decaid's list, each with its Workflow and annotations and no measurements;
 * `total`, or null; and `references`, recipe to Shot, or null where it is not
 * known which Shots are references.
 */
export const shotsPage = (offset, limit) => sources.shotsPage(offset, limit);

/** One Shot, whole, by its id, or null where it is gone. */
export const shotById = shotId => sources.shotById(shotId);

/**
 * Set a Shot's rating, its note or both: `edit` is `{ rating?, note? }`, where
 * a rating of 0 clears the rating and empty text the note, and what it leaves
 * out is left alone. Resolves with `{ rating, note }` as they now are, each
 * null for none. Rejects with `refusal`, a message to show, where Decent Sync
 * refused the edit; or with `remarks`, what a read after it found, or null,
 * where the edit may have been made and was not.
 */
export const editShot = (shotId, edit) => sources.editShot(shotId, edit);

/**
 * `listener(recipeId, moved)` is called when a recipe's reference should be
 * read again: another was chosen elsewhere, or with null, where references are
 * kept changed, or the server came into reach or went out of it. `moved` says
 * where they are kept changed: a reference read before is the other source's.
 */
export function watchReference(listener) {
    watcher = listener;
}
