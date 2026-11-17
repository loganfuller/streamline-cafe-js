// Which of the Shot seam's two sources answers (docs/cafe/DESIGN.md, "Shots and
// the reference" and "The Shots list"): Decent Sync's plugin on a Machine it
// serves, the tablet otherwise, and neither before the Status request has said
// which. No browser global is touched: shot-seam.js hands in the sources and
// what asks the status.
import { shotSource, serverOutOfReach, shotsList, shotsListRefused } from './sync-status.js';

// Which Location a list of the Location's Shots is of: its id, or its name
// where the status gives no id.
const where = listed => (listed && listed.of === 'location' ? `${listed.locationId ?? ''}|${listed.location ?? ''}` : null);

/**
 * - `tablet`, `plugin`: the two sources (tablet-shots.js, plugin-shots.js).
 * - `askStatus()`: asks Decent Sync's status again. Its answer comes to `status`.
 * - `changed(recipeId, moved)`: a recipe's reference should be read again; with
 *   null, whichever recipe is in the graph. `moved` says the source changed,
 *   or the Machine moved to another Location, so a reference read before is
 *   the other source's, or the other Location's.
 */
export function createShotSources({ tablet, plugin, askStatus, changed }) {
    let source = 'unknown';
    // The next status answer is followed by a read of the reference, whatever
    // it says: the plugin's connection to the server came or went.
    let readAfter = false;
    // The plugin said it can't ask its server. Before the source is known,
    // that is why no reference can be shown.
    let outOfReach = false;
    // What the Shots list lists, and why: the status rule's answer.
    let list = shotsList(null, {});

    // A page of the tablet's own Shots, under the header `listed` says. A page
    // read in place of the Location's, because the plugin refused the list,
    // gives a `next` that names that Location (`instead`) and the header it
    // was listed under, so the next page goes on from it though the status
    // still says the Machine is served. Which
    // Shots are references is read from the choice kept on the tablet where
    // that is the source, and is not known otherwise: on a Machine that is or
    // may be served, the choice kept on the tablet is never read. A choice
    // that can't be read leaves the list without its chips, not its rows.
    async function tabletPage(from, limit, listed, afresh, instead = null) {
        let choices = null;
        if (source === 'tablet') {
            try {
                choices = await tablet.references();
            } catch (error) { /* the rows stand without their chips */ }
            if (source !== 'tablet') choices = null;
        }
        const page = await tablet.shotsPage(from, limit, choices && typeof choices === 'object' ? choices : null);
        const next = page.next === null ? null : { of: 'tablet', at: page.next, ...(instead ? { instead, list: listed } : {}) };
        return { rows: page.rows, next, list: listed, afresh };
    }

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
         * A page of Shots for the Shots list, newest first: `rows`, each the
         * same thing whichever source listed it; `next`, what to ask the next
         * page with, or null on the last; `list`, what is listed and why
         * (`shotsList` in sync-status.js); and `afresh`, whether this is a
         * first page though a later one was asked for.
         *
         * On a served Machine the rows are the Location's, through the
         * plugin. Otherwise, and before the status has said, they are the
         * tablet's own. A refusal of the plugin's that means "the tablet's
         * own Shots" is answered from the tablet, under the line that says
         * why, and has the status asked again. `from` is a page's `next`, or
         * null for the first page. A `next` the other source gave can't be
         * followed, so the list is then read afresh, from its first page.
         */
        async shotsPage(from, limit) {
            const listed = list;
            // A page the tablet gave in place of the Location's goes on from
            // the tablet while the list would still be that Location's: the
            // plugin refuses the list while a tablet catches up after an
            // outage, though the status already says the Machine is served.
            // Opened afresh, the list is the Location's again.
            if (from && from.of === 'tablet' && from.instead && listed.of === 'location' && from.instead === where(listed)) {
                return tabletPage(from.at, limit, from.list, false, from.instead);
            }
            // A cursor belongs to the Location that gave it.
            const follows = !!from && from.of === listed.of && (listed.of !== 'location' || from.where === where(listed));
            const afresh = !!from && !follows;
            if (listed.of !== 'location') return tabletPage(follows ? from.at : null, limit, listed, afresh);
            try {
                const page = await plugin.shotsPage(follows ? from.at : null, limit, listed.machineId);
                return { rows: page.rows, next: page.next === null ? null : { of: 'location', at: page.next, where: where(listed) }, list: listed, afresh };
            } catch (error) {
                // A request that reached nothing says nothing: Decaid can't be
                // asked for its own Shots either.
                const refused = error.code !== undefined || error.status !== undefined ? shotsListRefused(error.code) : null;
                if (!refused) throw error;
                askStatus();
                return tabletPage(null, limit, refused, !!from, where(listed));
            }
        },

        /**
         * One Shot by its id: `shot`, whole, or null where it is gone, and
         * `canChange`, whether it can be changed now. On a Machine Decent
         * Sync serves, through an outage too, it may be another Machine's,
         * read through the plugin: that read rejects with `unreachable` where
         * the server can't be asked. Otherwise it is the tablet's own.
         */
        shotById: id => (source === 'plugin' ? plugin : tablet).shotById(id),

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
            // A Machine moved from one Location to another is told as a
            // change of source: the references, an opened Shot and the list
            // were the other Location's.
            const before = list;
            list = shotsList(list, answer);
            const relocated = before.of === 'location' && list.of === 'location' && where(before) !== where(list);
            source = next;
            outOfReach = reach;
            const read = moved || relocated || readAfter || said;
            readAfter = false;
            if (read) changed(null, moved || relocated);
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
