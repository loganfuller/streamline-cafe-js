// Streamline Cafe's smoke run, second setup: the real page against a real
// Decaid with Decent Sync's plugin and a local Decent Sync server. Run by hand,
// after run.mjs, on the same throwaway Decaid. How to stand the server up and
// take it down, and what this covers, is in docs/cafe/SMOKE.md.
//
//   node test/cafe-smoke/run-decent-sync.mjs --token=<Decaid's extensions token>
//   node test/cafe-smoke/run-decent-sync.mjs --token=... --sync=http://127.0.0.1:3999 \
//       --sync-for-tablet=http://cafe-smoke-sync:3000 --sync-container=cafe-smoke-sync
//
// It changes the Decaid and the server it is pointed at: it makes the server's
// first Admin, a Location and a Machine, all made up, installs Decent Sync's
// plugin on the Decaid and connects it, chooses and clears Reference Shots,
// turns the Machine's sharing off and on, stops and starts the server's
// container, and pulls simulated shots. Point it at throwaway ones only.

import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { RECIPES, BARISTAS } from './sample-data.mjs';
import { sleep, decaidClient, paint, legend, chartLines, countDraws, row, sides } from './page-helpers.mjs';
import { DYE2_PLUGIN_ID } from '../../src/cafe/dye2-gate.js';
import { shotRecipeId } from '../../src/cafe/shot-model.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const hit = args.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
};
const BASE = flag('base', 'http://127.0.0.1:13999');
const DECAID = flag('decaid', 'http://127.0.0.1:8080');
const TOKEN = flag('token', process.env.DECAID_EXTENSIONS_TOKEN || '');
const OUT = flag('out', join(HERE, 'out'));
const HEADED = args.includes('--headed');
const TIMEZONE = flag('timezone', 'UTC');
// The server, as this run reaches it and as the plugin in Decaid's container does.
const SYNC = flag('sync', 'http://127.0.0.1:3999');
const SYNC_FOR_TABLET = flag('sync-for-tablet', 'http://cafe-smoke-sync:3000');
// The server's container, which the run stops and starts.
const SYNC_CONTAINER = flag('sync-container', 'cafe-smoke-sync');
// The server's first Admin, made by this run on a server that has none.
const EMAIL = flag('email', 'admin@smoke.invalid');
const PASSWORD = flag('password', 'cafe-smoke-password-1');

const PLUGIN = 'decent-sync.reaplugin';
const PLUGIN_REPO = 'loganfuller/decent-sync';
const LOCATION = 'Sample Cafe';
const MACHINE = 'Sample Machine';
const REFERENCES = '/store/streamlineCafe/references';
const CANT_CHANGE = "Decent Sync can't be reached, so the reference can't be changed";
const CANT_SHOW = "Decent Sync can't be reached, so the reference can't be shown";

const docker = (...command) => promisify(execFile)('docker', command);
const decaid = decaidClient(`${DECAID}/api/v1`, TOKEN);
const plugin = path => decaid('GET', `/plugins/${PLUGIN}/${path}`);

// ── Results ──────────────────────────────────────────────────────────────────

const results = [];
function check(name, ok, detail = '') {
    results.push({ name, ok: !!ok });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const note = text => console.log(`     ${text}`);

// Waits until `read()` answers something truthy, and answers it, or null in the end.
async function until(read, { timeout = 30_000, every = 500 } = {}) {
    const giveUp = Date.now() + timeout;
    for (;;) {
        const value = await read().catch(() => null);
        if (value) return value;
        if (Date.now() >= giveUp) return null;
        await sleep(every);
    }
}

// ── The server ───────────────────────────────────────────────────────────────

// Its REST API, as the signed-in Admin. A request with no Origin is a
// non-browser client's, which the server takes from anywhere.
let cookie = '';
async function sync(method, path, body) {
    const res = await fetch(`${SYNC}/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie();
    if (set.length) cookie = set.map(line => line.split(';')[0]).join('; ');
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${text.slice(0, 200)}`);
    try { return JSON.parse(text); } catch { return text; }
}

// The Admin, the Location, the Machine at it, and the plugin connected as that
// Machine. Each is made only where it is missing, so the run can be repeated.
async function standUp() {
    if ((await sync('GET', '/setup')).required) {
        await sync('POST', '/setup', { name: 'Smoke Admin', email: EMAIL, password: PASSWORD });
        note('made the server\'s first Admin');
    } else {
        await sync('POST', '/session', { email: EMAIL, password: PASSWORD });
    }
    const { locations } = await sync('GET', '/locations');
    const location = locations.find(l => l.name === LOCATION) || (await sync('POST', '/locations', { name: LOCATION, timeZone: 'UTC' })).location;
    const { machines } = await sync('GET', '/machines');
    let machine = machines.find(m => m.name === MACHINE);

    const status = await plugin('status').catch(() => null);
    if (!machine || status?.served !== true || status.machine?.id !== machine.id) {
        // The plugin is not connected as this Machine: give it the Machine's
        // token, a new one where the Machine was made by an earlier run.
        const issued = machine ? await sync('POST', `/machines/${machine.id}/token`) : await sync('POST', '/machines', { name: MACHINE, locationId: location.id });
        machine = issued.machine;
        if (!(await decaid('GET', '/plugins')).some(p => p.id === PLUGIN)) {
            await decaid('POST', '/plugins/install/github-release', { repo: PLUGIN_REPO }, { manage: true });
            note('installed Decent Sync\'s plugin');
        }
        const settings = { ServerUrl: SYNC_FOR_TABLET, Token: issued.token, PollSeconds: 5 };
        // Decaid started with no account keeps the token in memory, and its first save can fail.
        await decaid('POST', `/plugins/${PLUGIN}/settings`, settings, { manage: true }).catch(() => decaid('POST', `/plugins/${PLUGIN}/settings`, settings, { manage: true }));
        await decaid('POST', `/plugins/${PLUGIN}/enable`, undefined, { manage: true });
    }
    await sync('PUT', `/machines/${machine.id}/sharing`, { sharing: true });
    const served = await until(async () => ((await plugin('status')).served === true), { timeout: 60_000 });
    if (!served) throw new Error('Decent Sync\'s plugin did not come to serve the Machine: is the server reachable from Decaid\'s container?');
    return { location, machine };
}

// The Location's Recipes by name: the tablet's sample recipes, once they have
// joined the Library, each with `recordId`, its DYE2 record's id on the tablet.
async function libraryRecipes(location) {
    const records = (await decaid('GET', `/store/${DYE2_PLUGIN_ID}/recipes`)) || [];
    const { recipes } = await sync('GET', `/locations/${location.id}/recipes`);
    const byName = {};
    for (const recipe of recipes) {
        const record = records.find(row => row && row.decentSyncId === recipe.id);
        if (record) byName[recipe.name] = { ...recipe, recordId: record.id };
    }
    return RECIPES.every(r => byName[r.name]) ? byName : null;
}

const setReference = (recipe, shotId) => sync('PUT', `/recipes/${recipe.id}/reference-shot`, { shotId });
const referenceOnServer = async recipe => (await sync('GET', `/recipes/${recipe.id}`)).recipe.referenceShot?.id ?? null;
// The newest of Decaid's Shots pulled with a recipe.
const newestShotWith = async recordId => ((await decaid('GET', '/shots?limit=100')).items || []).find(item => shotRecipeId(item.workflow) === String(recordId)) || null;

async function pullShot(seconds) {
    await decaid('PUT', '/machine/state/espresso');
    await sleep(seconds * 1000);
    await decaid('PUT', '/machine/state/idle');
}

// ── Browser ──────────────────────────────────────────────────────────────────

const browser = await chromium.launch({ headless: !HEADED });

async function openPage() {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1200 }, timezoneId: TIMEZONE });
    const page = await context.newPage();
    const seen = { errors: [], requests: [], sockets: [], loads: 0 };
    page.on('pageerror', error => seen.errors.push(error.message));
    page.on('request', request => seen.requests.push(`${request.method()} ${new URL(request.url()).pathname}${new URL(request.url()).search}`));
    page.on('websocket', socket => seen.sockets.push(new URL(socket.url()).pathname));
    page.on('load', () => { seen.loads += 1; });
    await page.goto(`${BASE}/index.html`);
    await page.locator('#cafe-strip .cafe-card').first().waitFor({ timeout: 20_000 });
    return { page, seen, close: () => context.close() };
}

const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });
const label = page => page.locator('#cafe-dial-label').textContent();
const waitLegend = (page, test, timeout = 30_000) => until(async () => { const now = await legend(page); return test(now) ? now : null; }, { timeout, every: 300 });
// Tap a recipe's card, and let the load write the Workflow before anything else does.
async function load(page, recipe) {
    await page.locator('#cafe-strip .cafe-card').nth(recipe.slot - 1).click();
    await page.locator('#cafe-title').filter({ hasText: recipe.name }).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(3000);
}
// A shot from start to the finished Shot in the graph: its record on the tablet.
async function shotWith(page, recordId, seconds, barista) {
    const before = (await newestShotWith(recordId))?.id ?? null;
    await decaid('PUT', '/workflow', { context: { baristaName: barista } });
    await pullShot(seconds);
    const pulled = await until(async () => { const newest = await newestShotWith(recordId); return newest && newest.id !== before ? newest : null; }, { timeout: 30_000 });
    await page.locator('#cafe-shot-when').filter({ hasText: /\d{2}:\d{2}/ }).waitFor({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2500);
    return pulled;
}
const pluginRequests = (seen, method) => seen.requests.filter(r => r.startsWith(`${method} /api/v1/plugins/${PLUGIN}/reference`));
const storeRequests = seen => seen.requests.filter(r => r.includes(REFERENCES));

// ── The run ──────────────────────────────────────────────────────────────────

await mkdir(OUT, { recursive: true });
let stopped = false;
let sharingOff = null;

try {
    if (TOKEN.length < 32) throw new Error('Give Decaid\'s extensions token with --token=: installing the plugin needs it. See docs/cafe/SMOKE.md.');
    const records = (await decaid('GET', `/store/${DYE2_PLUGIN_ID}/recipes`)) || [];
    if (!RECIPES.every(r => records.some(row => row && row.name === r.name))) {
        throw new Error('The sample recipes are not on this Decaid: run test/cafe-smoke/run.mjs first.');
    }

    // 1. The server, its Location and Machine, and the plugin connected as it.
    const { location, machine } = await standUp();
    const status = await plugin('status');
    check('Decent Sync\'s plugin serves the Machine at its Location', status.served === true && status.machine.name === MACHINE && status.location.name === LOCATION, JSON.stringify(status));
    const library = await until(() => libraryRecipes(location), { timeout: 60_000, every: 1000 });
    if (!library) throw new Error('The tablet\'s sample recipes did not join the Location\'s Library.');
    check('the tablet\'s recipes are the Location\'s Recipes, each record carrying its Recipe\'s id', true);
    const house = { ...RECIPES[0], ...library[RECIPES[0].name] };
    const other = { ...RECIPES[1], ...library[RECIPES[1].name] };

    // What earlier runs left: no Reference Shot on the server, and on the tablet
    // a choice of its own for the same recipe, which a served Machine must drop.
    await setReference(house, null);
    await setReference(other, null);
    const { page, seen, close } = await openPage();
    await load(page, other);
    const kept = await shotWith(page, other.recordId, 8, BARISTAS[0]);
    await decaid('POST', REFERENCES, { [house.recordId]: kept.id });

    // 2. With the plugin: the latest Shot, and no reference, though the tablet
    //    keeps a choice for the recipe.
    await load(page, house);
    await page.locator('#cafe-dial-label').filter({ hasText: 'Dial-in · saved to the recipe' }).waitFor({ timeout: 20_000 }).catch(() => {});
    check('on a served Machine the column is labelled "Dial-in · saved to the recipe"', (await label(page)) === 'Dial-in · saved to the recipe', await label(page));
    const first = await shotWith(page, house.recordId, 10, BARISTAS[0]);
    let now = await legend(page);
    check('with Decent Sync and no Reference Shot: the latest Shot alone, and Make reference', now.label === 'Latest' && now.reference === null && now.badge === null && now.make === 'Make reference' && !now.muted && now.notice === null, JSON.stringify(now));
    check('the choice kept on the tablet is not drawn, and was never read', storeRequests(seen).length === 0, storeRequests(seen).join(', '));
    check('the reference is read from the plugin, by the recipe\'s DYE2 record id', pluginRequests(seen, 'GET').some(r => r.endsWith(`?recipe=${encodeURIComponent(house.recordId)}`)), pluginRequests(seen, 'GET').slice(-2).join(', '));
    await shot(page, 'sync-no-reference-light');

    // 3. Make reference sends the choice to the plugin, and the graph follows the answer.
    await page.locator('#cafe-make-reference').click();
    now = await waitLegend(page, l => l.badge !== null) || await legend(page);
    check('Make reference makes the Shot the Recipe\'s Reference Shot on the server', (await referenceOnServer(house)) === first.id, `${await referenceOnServer(house)} for ${first.id}`);
    check('the graph follows the answer: "This shot is the reference", and no Make reference', now.badge === 'This shot is the reference' && now.make === null && now.reference === null, JSON.stringify(now));
    check('the choice was one request to the plugin, and nothing was written to the tablet\'s own store',
        pluginRequests(seen, 'PUT').length === 1 && storeRequests(seen).length === 0, [...pluginRequests(seen, 'PUT'), ...storeRequests(seen)].join(', '));
    await shot(page, 'sync-shot-is-reference-light');

    // 4. A second shot: the reference behind it, with frames appended.
    await decaid('PUT', '/workflow', { context: { baristaName: BARISTAS[1] } });
    const running = pullShot(16);
    await page.locator('#main-page.cafe-shot-live').waitFor({ timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(6000);
    let lines = await chartLines(page);
    check('during a shot the Reference Shot is drawn behind it', lines.points[7] > 10 && lines.points[0] > 5 && lines.names.length === 10, JSON.stringify(lines));
    const drawn = await countDraws(page, 3000);
    check('a live shot still draws by appending frames, with Decent Sync\'s reference behind it', drawn.appended >= 10 && drawn.full <= 3, `${drawn.appended} frames appended, ${drawn.full} drawn in full, in 3 s`);
    await shot(page, 'sync-live-reference-light');
    await running;
    const second = await until(async () => { const newest = await newestShotWith(house.recordId); return newest && newest.id !== first.id ? newest : null; });
    now = await waitLegend(page, l => l.label === 'Latest' && l.reference !== null && /\d{2}:\d{2}/.test(l.when || '')) || await legend(page);
    check('at rest the legend says when each Shot was pulled and who pulled it, and never where',
        /^Today \d{2}:\d{2}.* · Example Barista$/.test(now.when || '') && /^Today \d{2}:\d{2}.* · Sample Barista$/.test(now.reference || '') && !/Sample (Machine|Cafe)/.test(JSON.stringify(now)), JSON.stringify(now));
    check('Make reference is back for the new Shot', now.make === 'Make reference' && !now.muted && now.flag === null);
    await shot(page, 'sync-reference-light');
    await paint(page, 'dark');
    await page.waitForTimeout(600);
    await shot(page, 'sync-reference-dark');
    await paint(page, 'light');

    // 5. A reference chosen on the server arrives on the open page.
    const loads = seen.loads;
    await setReference(house, second.id);
    now = await waitLegend(page, l => l.badge !== null);
    check('a Shot chosen on the server becomes the reference on the open page, with no reload', now?.badge === 'This shot is the reference' && seen.loads === loads, JSON.stringify(now || await legend(page)));
    await shot(page, 'sync-chosen-on-server-light');
    await setReference(house, kept.id);
    now = await waitLegend(page, l => l.flag !== null);
    check('a Shot pulled on another profile is flagged "Different profile", by Decent Sync\'s word', now?.flag === 'Different profile' && /Sample Barista$/.test(now.reference || ''), JSON.stringify(now || await legend(page)));
    await shot(page, 'sync-different-profile-light');
    await setReference(house, null);
    now = await waitLegend(page, l => l.reference === null && l.badge === null);
    check('a Reference Shot cleared on the server goes from the open page', !!now && now.make === 'Make reference' && sides(await row(page)).every(side => side === 'No reference'), JSON.stringify(now || await legend(page)));
    await setReference(house, first.id);
    now = await waitLegend(page, l => l.reference !== null);
    check('and one chosen again comes back', !!now && seen.loads === loads, JSON.stringify(now || await legend(page)));

    //    A push may repeat, as when the Recipe is renamed: nothing is drawn again.
    await page.waitForTimeout(1500);
    let mark = seen.requests.length;
    const counting = countDraws(page, 6000);
    await sync('PATCH', `/recipes/${house.id}`, { content: { name: `${house.name} two` } });
    await page.waitForTimeout(2500);
    await sync('PATCH', `/recipes/${house.id}`, { content: { name: house.name } });
    const redrawn = await counting;
    const reread = seen.requests.slice(mark).filter(r => r.startsWith(`GET /api/v1/plugins/${PLUGIN}/reference`)).length;
    check('a repeated push reads the reference again and redraws nothing', reread >= 1 && redrawn.full === 0, `${reread} reads, ${redrawn.full} draws`);
    await page.locator('#cafe-title').filter({ hasText: new RegExp(`^${house.name}$`) }).waitFor({ timeout: 20_000 }).catch(() => {});

    // 6. The socket: one, however often the main page mounts.
    await page.locator('#settings-btn').click();
    await page.locator('#subpage-host #settings-content-area').waitFor({ timeout: 20_000 });
    await page.goBack();
    await page.locator('#cafe-header').waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(3000);
    const sockets = seen.sockets.filter(path => path === `/ws/v1/plugins/${PLUGIN}/changes`);
    check('the changes socket opened once, though the main page mounted again', sockets.length === 1 && page.url().startsWith(BASE), `${sockets.length} sockets`);
    now = await legend(page);
    check('back on the main page the reference is still drawn', now.reference !== null && (await chartLines(page)).points[7] > 10, JSON.stringify(now));

    // 7. With the server stopped: the tablet's copy, and Make reference muted.
    await docker('stop', SYNC_CONTAINER);
    stopped = true;
    now = await waitLegend(page, l => l.notice !== null, 60_000);
    lines = await chartLines(page);
    check('with the server stopped the tablet\'s copy of the Reference Shot is drawn', !!now && now.reference !== null && lines.points[7] > 10 && seen.loads === loads, JSON.stringify(now || await legend(page)));
    check('Make reference is shown muted, and a line says why', now?.make === 'Make reference' && now.muted === true && now.notice === CANT_CHANGE, JSON.stringify(now));
    check('the column still reads "saved to the recipe": the plugin goes on saving on the tablet', (await label(page)) === 'Dial-in · saved to the recipe', await label(page));
    mark = seen.requests.length;
    await page.locator('#cafe-make-reference').click({ force: true }).catch(() => {});
    await page.waitForTimeout(1000);
    check('a tap on the muted Make reference asks nothing', seen.requests.slice(mark).filter(r => r.startsWith('PUT ')).length === 0 && (await page.locator('#cafe-reference-dialog[open]').count()) === 0);
    check('nothing kept on the tablet was read for it', storeRequests(seen).length === 0, storeRequests(seen).join(', '));
    await shot(page, 'sync-server-stopped-light');

    //    A page opened while the server is out of reach does not know yet
    //    whether the Machine is served: the latest Shot alone.
    {
        const cold = await openPage();
        await cold.page.locator('#cafe-shot-when').filter({ hasText: /\d{2}:\d{2}/ }).waitFor({ timeout: 30_000 }).catch(() => {});
        await cold.page.waitForTimeout(3000);
        const shown = await legend(cold.page);
        check('a page opened with the server out of reach: the latest Shot alone, no reference and no Make reference, and a line saying why',
            shown.label === 'Latest' && shown.reference === null && shown.make === null && shown.notice === CANT_SHOW && cold.seen.requests.every(r => !r.includes(REFERENCES)), JSON.stringify(shown));
        await shot(cold.page, 'sync-opened-while-stopped-light');
        check('no page error on it', cold.seen.errors.length === 0, cold.seen.errors.join(' | '));
        await cold.close();
    }

    //    The server comes back: the reference is the server's again, and can be changed.
    await docker('start', SYNC_CONTAINER);
    stopped = false;
    now = await waitLegend(page, l => l.notice === null && l.make !== null && !l.muted, 120_000);
    check('with the server back the reference can be changed again, with no reload', !!now && now.reference !== null && seen.loads === loads, JSON.stringify(now || await legend(page)));

    // 8. A Capture-only Machine keeps its reference on the tablet.
    await sync('PUT', `/machines/${machine.id}/sharing`, { sharing: false });
    sharingOff = machine.id;
    await until(async () => (await plugin('status').catch(error => error)).message?.includes('Capture-only'), { timeout: 30_000 });
    await load(page, other);
    await load(page, house); // a recipe load asks the status again
    now = await waitLegend(page, l => l.flag !== null, 30_000);
    check('a Machine that turns Capture-only falls back to the tablet\'s own choice at the next status, with no reload',
        !!now && now.flag === 'Different profile' && /Sample Barista$/.test(now.reference || '') && now.make === 'Make reference' && !now.muted && seen.loads === loads, JSON.stringify(now || await legend(page)));
    check('and the column reads "not saved to the recipe"', (await label(page)) === 'Dial-in · not saved to the recipe', await label(page));
    await shot(page, 'sync-capture-only-light');
    mark = seen.requests.length;
    await page.locator('#cafe-make-reference').click();
    await page.locator('#cafe-reference-dialog-replace').click({ timeout: 5000 }).catch(() => {});
    now = await waitLegend(page, l => l.badge !== null);
    const after = seen.requests.slice(mark);
    check('there Make reference keeps the choice on the tablet, and asks the plugin nothing',
        !!now && (await decaid('GET', REFERENCES))?.[house.recordId] === second.id && after.some(r => r === `POST /api/v1${REFERENCES}`) && !after.some(r => r.startsWith('PUT /api/v1/plugins/')), after.filter(r => /^(POST|PUT) /.test(r)).join(', '));
    check('and the server\'s Reference Shot is as it was', (await referenceOnServer(house)) === first.id);

    //    Served again: Decent Sync's Reference Shot, and the tablet's choice dropped.
    await sync('PUT', `/machines/${machine.id}/sharing`, { sharing: true });
    sharingOff = null;
    await until(async () => (await plugin('status')).served === true, { timeout: 30_000 });
    await load(page, other);
    await load(page, house);
    now = await waitLegend(page, l => l.badge === null && l.reference !== null && l.flag === null, 30_000);
    check('served again, the reference is Decent Sync\'s once more, with no reload', !!now && /Sample Barista$/.test(now.reference || '') && seen.loads === loads, JSON.stringify(now || await legend(page)));
    check('and the column reads "saved to the recipe" again', (await label(page)) === 'Dial-in · saved to the recipe', await label(page));

    check('no page error with Decent Sync', seen.errors.length === 0, seen.errors.join(' | '));
    await close();
} catch (error) {
    check(`the run finished (${error.message.split('\n')[0]})`, false);
} finally {
    // Leave the server running and the Machine sharing, whatever failed.
    if (stopped) await docker('start', SYNC_CONTAINER).catch(() => {});
    if (sharingOff) await sync('PUT', `/machines/${sharingOff}/sharing`, { sharing: true }).catch(() => {});
    await decaid('PUT', '/workflow', { context: { baristaName: null } }).catch(() => {});
    await browser.close();
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(failed.length ? 1 : 0);
