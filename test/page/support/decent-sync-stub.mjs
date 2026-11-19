// A stand-in for Decent Sync's plugin on the tablet, as the smoke run had: its
// Status request, its `reference` request and its `changes` socket, answered
// as "For a Skin's author" in Decent Sync's docs/PLUGIN.md (v1.11.1) says. It
// is not part of the fake Decaid: no recording backs it, and it keeps no
// Reference Shot. The fake plugin that does, with its scenarios, is #61's.
//
//   const plugin = await decentSync(cafe, 'served');      // before cafe.open()
//   plugin.connect();                                     // the plugin's connection came
//   plugin.asked(/\/status$/)                             // the requests it had
//
// `state` is 'served' (a Machine it serves), a refusal's code ('captureOnly',
// 'notPaired', …, answered 409), 'unreachable' (503), or 'coldStart':
// unreachable until the test calls `connect()`, served after.

export const PLUGIN_ID = 'decent-sync.reaplugin';
const PREFIX = `/api/v1/plugins/${PLUGIN_ID}/`;

const SERVED = { connected: true, served: true, machine: { id: 'sample-machine', name: 'Sample Machine' }, location: { id: 'sample-location', name: 'Sample Cafe' } };
// A refusal names the Machine wherever the server answered for it (a
// Capture-only Machine is at no Location), and nothing while it wasn't asked.
const refused = code => ({ status: code === 'unreachable' ? 503 : 409, body: { connected: code !== 'unreachable', served: false, machine: code === 'captureOnly' ? SERVED.machine : null, location: null, code, message: 'Sample refusal.' } });

/**
 * Lists the plugin in Decaid's plugin list as loaded, and answers its routes
 * and socket. Call before the page opens.
 */
export function decentSync(cafe, state) {
    let connected = state !== 'coldStart';
    const log = [];
    const sends = new Set();
    cafe.fake.plugins.push({ id: PLUGIN_ID, name: 'Decent Sync', version: '1.11.1', loaded: true, autoLoad: true, api: [] });

    const served = () => state === 'served' || (state === 'coldStart' && connected);
    cafe.routes.intercept(request => request.path.startsWith(PREFIX), ({ method, url }) => {
        const parsed = new URL(url);
        const route = parsed.pathname.slice(PREFIX.length);
        log.push(`${method} ${parsed.pathname}${parsed.search}`);
        if (route === 'status' && method === 'GET') return served() ? { status: 200, body: SERVED } : refused(state === 'coldStart' ? 'unreachable' : state);
        // No Reference Shot for any recipe, and no copy of one while it can't
        // reach its server. The Recipe asked about is named by DYE2's record.
        if (route === 'reference' && method === 'GET') {
            if (!served()) return { status: 503, body: { code: 'unreachable', message: 'Sample refusal.' } };
            const recordId = parsed.searchParams.get('recipe');
            const record = (cafe.fake.store.get('dye2.reaplugin', 'recipes') || []).find(row => row && String(row.id) === recordId);
            if (!record) return { status: 409, body: { code: 'noSuchRecipe', message: 'Sample refusal.' } };
            return { status: 200, body: { recipe: { id: `sample-recipe-${recordId}`, name: record.name, recordId }, reference: null, source: 'server' } };
        }
        return null; // anything else is unanswered, and fails the test naming it
    });
    cafe.routes.interceptSocket(`/ws/v1/plugins/${PLUGIN_ID}/changes`, send => {
        sends.add(send);
        return { close: () => sends.delete(send) };
    });

    return {
        /** The plugin's connection to its server came: served from now on, and pushed on `changes`. */
        connect() {
            connected = true;
            for (const send of sends) send(JSON.stringify({ what: 'connection', connected: true }));
        },
        /** Whether the page has its `changes` socket open. */
        listening: () => sends.size > 0,
        /** The requests it had matching `test` (over "METHOD /path?query"). */
        asked: (test = /./) => log.filter(line => test.test(line)),
        log,
    };
}
