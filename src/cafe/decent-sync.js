// The page's one line to Decent Sync's plugin on this tablet: its Status
// request, its `reference` request, its list of the Location's Shots, one of
// them whole, its edit of a Shot, its `changes` socket with the batches it says
// it archived or brought back, and the report of the page with the reload it
// asks for (docs/cafe/DESIGN.md, "Recipes and the
// strip", "Shots and the reference", "A finished batch" and "Builds and
// installs").
// The contract is "For a Skin's author" in Decent Sync's docs/PLUGIN.md. No
// other module under src/cafe/ names the plugin, and a test fails if one does.
//
// The status has two readers: the dial-in column's label (page.js) and the
// Shot seam's choice of source (shot-seam.js). Both hear every answer.
import { getPlugins, callPluginEndpoint, connectPluginMessages, putPluginEndpointHere, firmwareFlashInProgress } from '../modules/api.js';
import { sleepExitPending } from '../modules/ui.js';
import { logger } from '../modules/logger.js';
import { SKIN_ID, APP_VERSION } from '../version.js';
import { statusUnknown, statusRetryMs } from './sync-status.js';
import { pageReport, asksReload, reloadDeclined, reloadUrl } from './page-report.js';
import { pushedBatchId } from './finished-batch.js';

const PLUGIN_ID = 'decent-sync.reaplugin';

const statusListeners = [];
const pushListeners = [];
const batchListeners = [];
let seq = 0;
let retry = null;       // the timer to ask again, while no answer has come either way
let tries = 0;
let listening = false;  // the `changes` socket has been opened

function tell(listeners, value) {
    for (const listener of listeners) {
        try { listener(value); } catch (error) { logger.warn('Cafe: a Decent Sync listener failed', error); }
    }
}

// The Status request, in the shape sync-status.js reads.
async function readStatus() {
    const plugins = await getPlugins();
    if (!Array.isArray(plugins)) return {}; // Decaid did not answer
    const plugin = plugins.find(listed => listed && listed.id === PLUGIN_ID);
    if (!plugin) return null;
    // Listed and not loaded: switched off in Decaid, which is no plugin; or not
    // loaded yet, as for a moment after Decaid starts and while the plugin is
    // reloaded, which says nothing either way. Taken as no plugin, that moment
    // would put a served Machine's reference on the tablet.
    if (!plugin.loaded) return plugin.autoLoad === false ? null : { loading: true };
    try {
        return await callPluginEndpoint(PLUGIN_ID, 'status', null, 'GET');
    } catch (error) {
        // A refusal, which says why, with its message to show.
        if (error.code) return { code: error.code, message: error.message };
        // Decaid answers 404 itself for a plugin too old to have a Status
        // request. Any other answer of its own, with a status and no `code`,
        // is treated as `unreachable`, as docs/PLUGIN.md asks. A request that
        // reached nothing says nothing.
        if (error.status === 404) return null;
        return error.status !== undefined ? { code: 'unreachable' } : {};
    }
}

// The plugin's `changes` socket, opened once the plugin itself has answered:
// a tablet with no Decent Sync has nothing to listen to. It is never closed,
// and comes back by itself after it drops. Decaid keeps no push for a socket
// opened later, so each time it opens the listeners are told as they are when
// the plugin's connection comes or goes, and ask the status again.
function listen() {
    if (listening) return;
    listening = true;
    connectPluginMessages(PLUGIN_ID, 'changes', data => {
        const batchId = pushedBatchId(data);
        if (asksReload(data)) reload();
        else if (batchId) tell(batchListeners, batchId);
        else tell(pushListeners, data);
    }, () => {
        reportPage();
        tell(pushListeners, { what: 'connection' });
    });
}

async function ask() {
    clearTimeout(retry);
    retry = null;
    const mine = ++seq;
    const answer = await readStatus();
    if (mine !== seq) return; // a newer ask has begun
    // No answer either way, as when the skin loads before the plugin has
    // connected: ask again shortly, and more slowly each time, until one comes.
    // A tablet that stays on this page fires no event that would ask.
    if (statusUnknown(answer)) {
        tries += 1;
        retry = setTimeout(askStatus, statusRetryMs(tries, answer.loading === true));
    } else {
        tries = 0;
    }
    if (answer && (answer.served === true || answer.code !== undefined)) listen();
    tell(statusListeners, answer);
}

function reload() {
    const declined = reloadDeclined({ flashing: firmwareFlashInProgress(), sleepExitPending: sleepExitPending() });
    if (declined) logger.audit(`Cafe: Decent Sync's reload declined: ${declined}`);
    else window.location.replace(reloadUrl(window.location.href, Date.now()));
}

export function reportPage() {
    putPluginEndpointHere(PLUGIN_ID, 'page', pageReport({ skinId: SKIN_ID, version: APP_VERSION, timeOrigin: performance.timeOrigin }));
}

/** Ask Decent Sync's status again. Every `onStatus` listener hears the answer, unless a newer ask has begun. */
export function askStatus() {
    ask().catch(error => logger.warn('Cafe: could not ask Decent Sync for its status', error));
}

/** `listener(answer)` hears each answer to the Status request, in the shape sync-status.js reads. */
export function onStatus(listener) {
    statusListeners.push(listener);
}

/**
 * `listener(push)` hears each message on the plugin's `changes` socket, as it
 * was sent, but `reload` and `batch`, and `{ what: 'connection' }` each time the
 * socket opens.
 */
export function onPush(listener) {
    pushListeners.push(listener);
}

/**
 * `listener(batchId)` hears the batch each `batch` push names: the plugin
 * archived Decaid's record of it on the tablet, or brought it back.
 */
export function onBatchPush(listener) {
    batchListeners.push(listener);
}

const reference = recipeId => `reference?recipe=${encodeURIComponent(recipeId)}`;

/** The plugin's answer for a recipe's Reference Shot. Rejects with the refusal. */
export function readReference(recipeId) {
    return callPluginEndpoint(PLUGIN_ID, reference(recipeId), null, 'GET');
}

/** Asks the plugin to make a Shot a recipe's Reference Shot. Rejects with the refusal. */
export function chooseReference(recipeId, shotId) {
    return callPluginEndpoint(PLUGIN_ID, reference(recipeId), { shotId }, 'PUT');
}

/**
 * A page of the Shots at the Machine's Location, newest first: the plugin's
 * answer, `{ shots, nextCursor }`. `cursor` is the page before's `nextCursor`,
 * or null for the first page. Rejects with the refusal.
 */
export function listShots(cursor, limit) {
    const query = `limit=${encodeURIComponent(limit)}${cursor == null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`;
    return callPluginEndpoint(PLUGIN_ID, `shots?${query}`, null, 'GET');
}

/** One of the Location's Shots, whole: the plugin's answer, `{ shot, recipe, referenceOf }`. Rejects with the refusal. */
export function readShot(shotId) {
    return callPluginEndpoint(PLUGIN_ID, `shot?id=${encodeURIComponent(shotId)}`, null, 'GET');
}

/** Asks the plugin to set a Shot's rating, its note or both, as `{ rating?, note? }`. Answers the two as they now are. Rejects with the refusal. */
export function editShot(shotId, edit) {
    return callPluginEndpoint(PLUGIN_ID, `shot?id=${encodeURIComponent(shotId)}`, edit, 'PUT');
}
