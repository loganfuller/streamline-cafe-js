// The Shot seam: the one place the page asks for a recipe's latest Shot, for
// its reference, and to make a Shot its reference (docs/cafe/DESIGN.md, "Shots
// and the reference"). The page reads Shots and the choice no other way, so a
// second source behind this module changes no caller.
//
// It has one source today, the tablet's own Shots (tablet-shots.js).
import { getShots, getShot } from '../modules/api.js';
import { createTabletShots } from './tablet-shots.js';
import { readCafe, writeCafe, REFERENCES_KEY } from './cafe-store.js';

const tablet = createTabletShots({
    listShots: limit => getShots({ limit }),
    readShot: getShot,
    readChoices: () => readCafe(REFERENCES_KEY),
    writeChoices: choices => writeCafe(REFERENCES_KEY, choices),
});

/** This machine's latest Shot pulled with a recipe, whole, or null. With no recipe (null), the tablet's newest Shot. */
export const latestShot = recipeId => tablet.latestShot(recipeId);

/** A recipe's reference: `{ shot, canChange }`. */
export const referenceShot = recipeId => tablet.referenceShot(recipeId);

/** Make a Shot a recipe's reference. */
export const makeReference = (recipeId, shotId) => tablet.makeReference(recipeId, shotId);
