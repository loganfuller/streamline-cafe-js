// What the answer to Decent Sync's Status request means for the page
// (docs/cafe/DESIGN.md, "Recipes and the strip" and "Shots and the reference").
// No browser global is touched.
//
// An answer, as decent-sync.js hands it on:
//
// - `{ served: true, … }`: the plugin serves this Machine.
// - `{ code }`: the plugin refused, and the code says why.
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
