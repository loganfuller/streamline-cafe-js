// Which of the Shot seam's two sources answers (docs/cafe/DESIGN.md, "Shots and
// the reference"): Decent Sync's plugin on a Machine it serves, the tablet
// otherwise, and neither before the Status request has said which. No browser
// global is touched: shot-seam.js hands in the sources and what asks the status.
import { shotSource, serverOutOfReach } from './sync-status.js';

/**
 * - `tablet`, `plugin`: the two sources (tablet-shots.js, plugin-shots.js).
 * - `askStatus()`: asks Decent Sync's status again. Its answer comes to `status`.
 * - `changed(recipeId, moved)`: a recipe's reference should be read again; with
 *   null, whichever recipe is in the graph. `moved` says the source changed, so
 *   a reference read before is the other source's.
 */
export function createShotSources({ tablet, plugin, askStatus, changed }) {
    let source = 'unknown';
    // The next status answer is followed by a read of the reference, whatever
    // it says: the plugin's connection to the server came or went.
    let readAfter = false;
    // The plugin said it can't ask its server. Before the source is known,
    // that is why no reference can be shown.
    let outOfReach = false;

    return {
        /** Where references are kept now: `plugin`, `tablet` or `unknown`. */
        source: () => source,

        /** This machine's latest Shot with a recipe. It is the tablet's own, whatever the source. */
        latestShot: recipeId => tablet.latestShot(recipeId),

        /**
         * A recipe's reference: `{ shot, canChange }`, and from the plugin
         * `unreachable`, `unread` and `profileDiffers` too. Before the source is
         * known there is none, and none can be chosen: the choice kept on the
         * tablet is never read on a Machine that may turn out to be served.
         * Where the plugin has said it can't ask its server, the answer says so,
         * as the plugin's does for a reference it can't read.
         */
        async referenceShot(recipeId) {
            if (source === 'plugin') return plugin.referenceShot(recipeId);
            if (source === 'tablet') return tablet.referenceShot(recipeId);
            return outOfReach ? { shot: null, canChange: false, unreachable: true, unread: true } : { shot: null, canChange: false };
        },

        /**
         * Make a Shot a recipe's reference. Resolves with the reference as it
         * now is; or with null where the source changed while the choice was
         * on its way, so its answer is the other source's, and the read that
         * follows the change is the one to draw.
         */
        async makeReference(recipeId, shotId) {
            const asked = source;
            if (asked === 'unknown') throw new Error('Where the reference is kept is not known yet.');
            try {
                const made = await (asked === 'plugin' ? plugin : tablet).makeReference(recipeId, shotId);
                return source === asked ? made : null;
            } catch (error) {
                if (source !== asked) delete error.reference;
                throw error;
            }
        },

        /** What Decent Sync's Status request answered (sync-status.js). */
        status(answer) {
            const next = shotSource(source, answer);
            const moved = next !== source;
            // With the source still not known, what `referenceShot` answers
            // follows whether the plugin can ask its server.
            const reach = serverOutOfReach(answer);
            const said = next === 'unknown' && reach !== outOfReach;
            source = next;
            outOfReach = reach;
            const read = moved || readAfter || said;
            readAfter = false;
            if (read) changed(null, moved);
        },

        /**
         * A push on the plugin's `changes` socket, as `changeOf` reads it, or
         * the socket opening, which is told as a `connection`. When the
         * connection comes or goes the status is asked again, and the
         * reference read after it: the Machine may have moved, or its sharing
         * changed, and the tablet's copy may now stand in for the server.
         */
        push(change) {
            if (!change) return;
            if (change.what === 'connection') {
                readAfter = true;
                askStatus();
            } else if (change.what === 'reference' && source === 'plugin') {
                changed(change.recipeId, false);
            }
        },
    };
}
