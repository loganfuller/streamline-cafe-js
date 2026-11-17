// The Shot seam: the one place the page asks for a recipe's latest Shot, for
// its reference, and to make a Shot its reference (docs/cafe/DESIGN.md, "Shots
// and the reference"). The page reads Shots and the choice no other way, so
// which source answers changes no caller.
//
// It has two sources. The latest Shot is always the tablet's own
// (tablet-shots.js). The reference is Decent Sync's on a Machine it serves
// (plugin-shots.js) and the tablet's otherwise, and what the plugin answers to
// a status request decides which (shot-sources.js).
//
// The status is asked by page.js, at start-up, when the page comes back into
// view and after each recipe load, and here when the plugin's `changes` socket
// opens or says its connection to the server came or went.
import { getShots, getShot } from '../modules/api.js';
import { createTabletShots } from './tablet-shots.js';
import { createPluginShots, changeOf } from './plugin-shots.js';
import { createShotSources } from './shot-sources.js';
import { readCafe, writeCafe, REFERENCES_KEY } from './cafe-store.js';
import { askStatus, onStatus, onPush, readReference, chooseReference } from './decent-sync.js';

let watcher = () => {};

const sources = createShotSources({
    tablet: createTabletShots({
        listShots: limit => getShots({ limit }),
        readShot: getShot,
        readChoices: () => readCafe(REFERENCES_KEY),
        writeChoices: choices => writeCafe(REFERENCES_KEY, choices),
    }),
    plugin: createPluginShots({ readReference, chooseReference, notServed: askStatus }),
    askStatus,
    changed: recipeId => watcher(recipeId),
});
onStatus(sources.status);
onPush(push => sources.push(changeOf(push)));

/** This machine's latest Shot pulled with a recipe, whole, or null. With no recipe (null), null. */
export const latestShot = recipeId => sources.latestShot(recipeId);

/**
 * A recipe's reference: `shot`, whole or null; `canChange`, whether another can
 * be chosen now; and on a Machine Decent Sync serves, `unreachable`, the server
 * can't be reached, `unread`, so nothing could be read, and `profileDiffers`.
 */
export const referenceShot = recipeId => sources.referenceShot(recipeId);

/**
 * Make a Shot a recipe's reference. Resolves with the reference as it now is.
 * Rejects with `refusal`, a message to show, where Decent Sync refused the
 * choice; or with `reference`, what a read after it found, where the choice
 * may have been made and was not.
 */
export const makeReference = (recipeId, shotId) => sources.makeReference(recipeId, shotId);

/**
 * `listener(recipeId)` is called when a recipe's reference should be read
 * again: another was chosen elsewhere, or with null, where references are kept
 * changed, or the server came into reach or went out of it.
 */
export function watchReference(listener) {
    watcher = listener;
}
