// The cafe page's own state in Decaid's store: the `streamlineCafe` namespace
// (docs/cafe/DESIGN.md, "Settings"). This is the one module under src/cafe/
// that writes Decaid's store by key, and a test fails if another does.
//
// Decaid's store is the tablet's, not the skin's: the skin reads the same
// values under either of its ids.
import { getKVValue, setKVValue } from '../modules/api.js';

const NAMESPACE = 'streamlineCafe';

/** The choice of reference, as recipe (its DYE2 record id) to Shot id. */
export const REFERENCES_KEY = 'references';
/** The graph's view, `reference` or `targets`. */
export const VIEW_KEY = 'graphView';

/**
 * A value the page kept, or null when it has kept none under that key, which is
 * how Decaid answers for a key it does not hold. Rejects when Decaid can't be
 * asked, so "nothing kept" is never a guess.
 */
export function readCafe(key) {
    return getKVValue(NAMESPACE, key);
}

export function writeCafe(key, value) {
    return setKVValue(NAMESPACE, key, value);
}
