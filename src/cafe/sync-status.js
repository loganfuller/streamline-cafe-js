// What the answer to Decent Sync's Status request means for the page
// (docs/cafe/DESIGN.md, "Recipes and the strip" and "Shots and the reference").
// No browser global is touched.
//
// An answer, as decent-sync.js hands it on:
//
// - `{ served: true, … }`: the plugin serves this Machine.
// - `{ code, message }`: the plugin refused, and the code says why. So too
//   `{ code: 'unreachable' }` where Decaid answered in its place.
// - `{}`: Decaid itself did not answer; or `{ loading: true }`, Decaid lists
//   the plugin and has not loaded it yet, as for a moment after Decaid starts
//   and while the plugin is reloaded.
// - `null`: this tablet has no Decent Sync plugin, or the plugin is switched off.

/** Did the plugin say it can't ask its server? `serverTooOld` is treated as `unreachable`, as the contract asks. */
export function serverOutOfReach(answer) {
    return !!answer && (answer.code === 'unreachable' || answer.code === 'serverTooOld');
}

/**
 * Did the Status request say nothing either way? The server could not be asked,
 * or Decaid itself did not answer. The page then asks again shortly: at
 * start-up the skin can load before the plugin has connected, and neither the
 * dial-in label nor the reference may wait for the page to regain focus.
 */
export function statusUnknown(answer) {
    if (!answer || answer.served === true) return false;
    return answer.code === undefined || serverOutOfReach(answer);
}

const LOADING_TRIES = 5;

// How long to wait before asking again, having asked `tries` times with no
// answer either way: 30 s, then twice as long each time, to 5 minutes. A plugin
// that never connects, as one installed and never set up, is not asked for ever
// at the first pace.
//
// `loading` is a plugin Decaid lists and has not loaded yet. Loading takes
// seconds, and nothing tells the skin when it is done, so the first few asks
// come 3 s apart. One that never loads is then asked at the pace above, from
// its start.
export function statusRetryMs(tries, loading = false) {
    if (loading === true) {
        if (tries <= LOADING_TRIES) return 3000;
        tries -= LOADING_TRIES;
    }
    return Math.min(300_000, 30_000 * 2 ** Math.max(0, tries - 1));
}

/**
 * Does Decent Sync save this Machine's dial-in onto its loaded recipe? Its
 * plugin does so on a Machine it serves: one at a Location, sharing, connected
 * as itself.
 *
 * - `{ served: true }`: it does.
 * - `{ code }` of `unreachable` or `serverTooOld`: the server could not be
 *   asked. The plugin goes on saving on the tablet through an outage, and the
 *   last answer stands. So does it when Decaid itself did not answer (`{}`).
 * - any other refusal, as for a Capture-only Machine, or `null` for no Decent
 *   Sync plugin loaded: it does not.
 */
export function decentSyncSaves(previous, answer) {
    if (!answer) return false;
    if (answer.served === true) return true;
    return statusUnknown(answer) ? !!previous : false;
}

/** Where a recipe's reference is kept. `unknown` until the Status request has said. */
export const SOURCES = ['unknown', 'plugin', 'tablet'];

/**
 * Where a recipe's reference is kept and chosen: `plugin`, Decent Sync's
 * Reference Shot, on a Machine it serves; `tablet`, the choice kept on the
 * tablet; or `unknown`, before any answer has said which.
 *
 * - `{ served: true }`: the plugin.
 * - `null`, for no Decent Sync plugin, or one switched off; `captureOnly` and
 *   `hardwareMismatch`; and any refusal this skin does not know, which is a
 *   Machine not served for a reason that lasts: the tablet.
 * - `unreachable`, `serverTooOld`, Decaid itself not answering (`{}`), or a
 *   plugin still loading: nothing was said either way, so the last answer
 *   stands. A served Machine stays with the plugin through an outage, which
 *   then answers from the tablet's copy; and before any answer the source is
 *   not known, and no reference is drawn, so the choice kept on the tablet is
 *   never drawn on a Machine that turns out to be served.
 */
export function shotSource(previous, answer) {
    if (!answer) return 'tablet';
    if (answer.served === true) return 'plugin';
    if (!statusUnknown(answer)) return 'tablet';
    return SOURCES.includes(previous) ? previous : 'unknown';
}

/** The refusals that mean the Machine is not served, for a reason that lasts until someone changes it. */
export const NOT_SERVED_CODES = ['captureOnly', 'hardwareMismatch'];

/**
 * What the Shots list lists, and why, from the answers to the Status request:
 * `{ of, why }`, where `of` is `location`, every Shot at the machine's
 * Location, through the plugin, or `tablet`, this machine's own Shots, from
 * Decaid; and `why` is the reason, which is what the list's header says
 * (`listHeader` in shot-list.js).
 *
 * - `{ served: true }`: the Location's Shots (`served`), with `location`, the
 *   Location's name, `locationId`, its id on the server, which a page's cursor
 *   belongs to, and `machineId`, this Machine's id on the server, which marks
 *   its own rows.
 * - `null`, for no Decent Sync plugin, or one switched off: the tablet's own
 *   (`noPlugin`).
 * - `captureOnly` and `hardwareMismatch`: the tablet's own (`notServed`).
 * - `unreachable` and `serverTooOld`: the tablet's own (`unreachable`). The
 *   plugin's `shots` request has no copy on the tablet to answer from, as its
 *   `reference` has.
 * - Any refusal this skin does not know: the tablet's own (`refused`), with
 *   the refusal's `message`.
 * - Decaid itself not answering (`{}`), or a plugin still loading: nothing was
 *   said either way, so the last answer stands; before any, the tablet's own
 *   (`unknown`).
 */
export function shotsList(previous, answer) {
    if (!answer) return { of: 'tablet', why: 'noPlugin' };
    if (answer.served === true) {
        const name = answer.location && typeof answer.location.name === 'string' ? answer.location.name.trim() : '';
        const machineId = answer.machine && answer.machine.id != null ? String(answer.machine.id) : null;
        const locationId = answer.location && answer.location.id != null ? String(answer.location.id) : null;
        return { of: 'location', why: 'served', location: name || null, locationId, machineId };
    }
    if (serverOutOfReach(answer)) return { of: 'tablet', why: 'unreachable' };
    if (answer.code === undefined) return previous || { of: 'tablet', why: 'unknown' };
    if (NOT_SERVED_CODES.includes(answer.code)) return { of: 'tablet', why: 'notServed' };
    return { of: 'tablet', why: 'refused', message: typeof answer.message === 'string' ? answer.message : '' };
}

/**
 * The same for a refusal of the plugin's `shots` request itself, which the
 * status may not have said yet: `code` is the refusal's, or undefined where
 * Decaid answered in the plugin's place, which is treated as `unreachable`.
 * Null for a refusal that does not mean "the tablet's own Shots".
 */
export function shotsListRefused(code) {
    if (code === undefined || code === 'unreachable' || code === 'serverTooOld') return { of: 'tablet', why: 'unreachable' };
    if (NOT_SERVED_CODES.includes(code)) return { of: 'tablet', why: 'notServed' };
    return null;
}
