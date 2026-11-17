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
         * A recipe's reference: `{ shot, canChange }`, with a Shot its `rating`
         * and `note`, and from the plugin `unreachable`, `unread` and
         * `profileDiffers` too.
         *
         * Before the source is known none can be chosen, and the choice kept
         * on the tablet is never read: the Machine may turn out to be served.
         * Where the plugin itself has said it can't ask its server, as on a
         * page opened during an outage, the plugin is asked all the same: it
         * answers from the copy it keeps on the tablet, which came from the
         * server, so it is the Location's Reference Shot. Where it holds no
         * copy its answer says nothing could be read. Until then, as while
         * Decaid has not answered or the plugin is still loading, nothing is
         * asked, and there is no reference.
         */
        async referenceShot(recipeId) {
            if (source === 'plugin') return plugin.referenceShot(recipeId);
            if (source === 'tablet') return tablet.referenceShot(recipeId);
            if (!outOfReach) return { shot: null, canChange: false };
            return { ...(await plugin.referenceShot(recipeId)), canChange: false };
        },

        /** The tablet's newest Shot, whole, or null. It is the tablet's own, whatever the source. */
        newestShot: () => tablet.newestShot(),

        /**
         * A page of Shots for the Shots list, newest first: `items`, rows of
         * Decaid's list; `total`, or null; and `references`, recipe to Shot,
         * or null where it is not known which Shots are references. The rows
         * are the tablet's own, whatever the source, until the Location's list
         * comes through the plugin. Which Shots are references is read from
         * the choice kept on the tablet where that is the source, and is not
         * known otherwise: on a Machine that may be served, the choice kept on
         * the tablet is never read. A choice that can't be read leaves the
         * list without its chips, not without its rows.
         */
        async shotsPage(offset, limit) {
            const page = await tablet.shotsPage(offset, limit);
            let references = null;
            if (source === 'tablet') {
                try {
                    references = await tablet.references();
                } catch (error) { /* the rows stand without their chips */ }
                if (source !== 'tablet') references = null;
            }
            return { ...page, references: references && typeof references === 'object' ? references : null };
        },

        /** One Shot, whole, by its id, or null where it is gone. The tablet's own, until the Location's list comes through the plugin. */
        shotById: id => tablet.shotById(id),

        /**
         * Set a Shot's rating, its note or both, as `{ rating?, note? }`.
         * Resolves with the two as they now are. The plugin on a Machine
         * Decent Sync serves, which edits a Shot whichever tablet holds it;
         * Decaid's own Shot edit otherwise, and before the source is known,
         * when the Shot in the graph is the tablet's own.
         */
        editShot: (shotId, edit) => (source === 'plugin' ? plugin : tablet).editShot(shotId, edit),

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
