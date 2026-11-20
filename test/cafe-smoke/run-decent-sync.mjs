// Streamline Cafe's smoke run, second setup: the real page against a real
// Decaid with Decent Sync's plugin and a local Decent Sync server. Run by hand,
// after run.mjs, on the same throwaway Decaid. How to stand the server up and
// take it down, and what this covers, is in docs/cafe/SMOKE.md.
//
// It checks only what needs the real server, plugin or second tablet. What the
// page asks of the plugin and draws from its answers is the page tests'
// (test/page/sync-*.spec.mjs and decent-sync-label.spec.mjs, on a fake plugin).
//
//   node test/cafe-smoke/run-decent-sync.mjs --token=<Decaid's extensions token>
//   node test/cafe-smoke/run-decent-sync.mjs --token=... --sync=http://127.0.0.1:3999 \
//       --sync-for-tablet=http://cafe-smoke-sync:3000 --sync-container=cafe-smoke-sync \
//       --decaid-2=http://127.0.0.1:8081
//   node test/cafe-smoke/run-decent-sync.mjs --token=... --only=profile   (step 11 alone, after a whole run)
//   node test/cafe-smoke/run-decent-sync.mjs --token=... --only=profile-dialog   (step 12 alone, after a whole run)
//
// It changes the two Decaids and the server it is pointed at: it makes the
// server's first Admin, a Location and two Machines, all made up, installs
// Decent Sync's plugin on each Decaid and connects it, installs DYE2 on the
// second, chooses and clears Reference Shots, rates Shots and writes notes on
// them, turns a Machine's sharing off and on, stops and starts the server's
// container, and pulls simulated shots. Point it at throwaway ones only.

import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { RECIPES, BARISTAS, GRINDER, SECOND_GRINDER, GRINDER_USE, BASKETS } from './sample-data.mjs';
import { sleep, decaidClient, legend, chartLines, remarks, shotsHeader } from './page-helpers.mjs';
import { DYE2_PLUGIN_ID, MIN_DYE2_VERSION } from '../../src/cafe/dye2-gate.js';
import { compareVersions } from '../../src/modules/skin-version.js';
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

// The second Machine's Decaid, as this run reaches it, and its extensions
// token, which is the first's unless `--token-2=` names another.
const DECAID_2 = flag('decaid-2', 'http://127.0.0.1:8081');
const TOKEN_2 = flag('token-2', TOKEN);
// One step alone, by name, on Decaids and a server a whole run has already set up.
const ONLY = flag('only', '');

const PLUGIN = 'decent-sync.reaplugin';
const PLUGIN_REPO = 'loganfuller/decent-sync';
const LOCATION = 'Sample Cafe';
const MACHINE = 'Sample Machine';
// The tablet's own choice of reference, which a served Machine never reads.
const REFERENCES = '/store/streamlineCafe/references';
const MACHINE_2 = 'Sample Machine Two';

const docker = (...command) => promisify(execFile)('docker', command);
const decaid = decaidClient(`${DECAID}/api/v1`, TOKEN);
const plugin = path => decaid('GET', `/plugins/${PLUGIN}/${path}`);
const decaid2 = decaidClient(`${DECAID_2}/api/v1`, TOKEN_2);

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
    return { location, machine: await connect(decaid, MACHINE, location) };
}

// A Machine at the Location, by name, with the plugin on `tablet`, a Decaid,
// connected as it. Made only where it is missing.
async function connect(tablet, name, location) {
    const { machines } = await sync('GET', '/machines');
    let machine = machines.find(m => m.name === name);
    const status = await tablet('GET', `/plugins/${PLUGIN}/status`).catch(() => null);
    if (!machine || status?.served !== true || status.machine?.id !== machine.id) {
        // The plugin is not connected as this Machine: give it the Machine's
        // token, a new one where the Machine was made by an earlier run.
        const issued = machine ? await sync('POST', `/machines/${machine.id}/token`) : await sync('POST', '/machines', { name, locationId: location.id });
        machine = issued.machine;
        if (!(await tablet('GET', '/plugins')).some(p => p.id === PLUGIN)) {
            await tablet('POST', '/plugins/install/github-release', { repo: PLUGIN_REPO }, { manage: true });
            note(`installed Decent Sync's plugin for ${name}`);
        }
        const settings = { ServerUrl: SYNC_FOR_TABLET, Token: issued.token, PollSeconds: 5 };
        // Decaid started with no account keeps the token in memory, and its first save can fail.
        await tablet('POST', `/plugins/${PLUGIN}/settings`, settings, { manage: true }).catch(() => tablet('POST', `/plugins/${PLUGIN}/settings`, settings, { manage: true }));
        await tablet('POST', `/plugins/${PLUGIN}/enable`, undefined, { manage: true });
    }
    await sync('PUT', `/machines/${machine.id}/sharing`, { sharing: true });
    const served = await until(async () => ((await tablet('GET', `/plugins/${PLUGIN}/status`)).served === true), { timeout: 60_000 });
    if (!served) throw new Error(`Decent Sync's plugin did not come to serve ${name}: is the server reachable from Decaid's container?`);
    return machine;
}

// The second Machine: another Decaid, with a DYE2 new enough for the skin and
// Decent Sync's plugin connected as a second Machine at the same Location. Its
// Shots reach the server as any tablet's do. Answers the Machine, and the id
// of its own DYE2 record of a Recipe once the Library's Recipes have reached it.
async function standUpSecond(location, recipe) {
    const dye2 = (await decaid2('GET', '/plugins')).find(p => p.id === DYE2_PLUGIN_ID);
    if (!dye2 || compareVersions(dye2.version, MIN_DYE2_VERSION) < 0) {
        const installed = await decaid2('POST', '/plugins/install/github-release', { repo: 'decentespresso/dye2' }, { manage: true });
        note(`installed DYE2 ${installed.version} on the second Decaid`);
    }
    await decaid2('POST', `/plugins/${DYE2_PLUGIN_ID}/enable`, undefined, { manage: true }).catch(() => {});
    // Streamline's "DYE2 on" setting, which the skin's page needs on.
    await decaid2('POST', '/store/streamlineSettings/streamline.dye2Enabled', 'true');
    const machine = await connect(decaid2, MACHINE_2, location);
    const record = await until(async () => ((await decaid2('GET', `/store/${DYE2_PLUGIN_ID}/recipes`)) || []).find(row => row && row.decentSyncId === recipe.id), { timeout: 90_000, every: 1000 });
    if (!record) throw new Error('The Location\'s Recipes did not reach the second Decaid\'s DYE2 records.');
    return { machine, recordId: String(record.id) };
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
// The newest of a Decaid's Shots pulled with a recipe.
const newestShotWith = async (recordId, tablet = decaid) => ((await tablet('GET', '/shots?limit=100')).items || []).find(item => shotRecipeId(item.workflow) === String(recordId)) || null;

async function pullShot(seconds, tablet = decaid) {
    await tablet('PUT', '/machine/state/espresso');
    await sleep(seconds * 1000);
    await tablet('PUT', '/machine/state/idle');
}

// ── Browser ──────────────────────────────────────────────────────────────────

// The page calls Decaid on port 8080 of the host that served it. A Decaid
// given elsewhere with --decaid= is reached by mapping that address to it in
// the browser, so runs from two checkouts can each have a Decaid of their own.
const PAGE_DECAID = `${new URL(BASE).hostname}:8080`;
const mapTo = host => (host === PAGE_DECAID ? [] : [`--host-resolver-rules=MAP ${PAGE_DECAID} ${host}`]);
const browser = await chromium.launch({ headless: !HEADED, args: mapTo(new URL(DECAID).host) });
// The second Machine's tablet: a browser of its own, in which the first
// Decaid's address is the second's. The skin calls Decaid on port 8080 of the
// host that served it, so the same page, served once, is each tablet's own.
let browser2 = null;
const secondBrowser = async () => {
    browser2 = browser2 || await chromium.launch({ headless: !HEADED, args: mapTo(new URL(DECAID_2).host) });
    return browser2;
};

async function openPage(on = browser, viewport = { width: 1920, height: 1200 }) {
    const context = await on.newContext({ viewport, timezoneId: TIMEZONE });
    const page = await context.newPage();
    const seen = { errors: [], loads: 0 };
    page.on('pageerror', error => seen.errors.push(error.message));
    page.on('load', () => { seen.loads += 1; });
    await page.goto(`${BASE}/index.html`);
    await page.locator('#cafe-strip .cafe-card').first().waitFor({ timeout: 20_000 });
    return { page, seen, close: () => context.close() };
}

const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });
const label = page => page.locator('#cafe-dial-label').textContent();
const waitLegend = (page, test, timeout = 30_000) => until(async () => { const now = await legend(page); return test(now) ? now : null; }, { timeout, every: 300 });
// Tap a recipe's card, and let the load write the Workflow before anything else does.
// A card already loaded is not tapped: a tap on it unloads it.
async function load(page, recipe) {
    const card = page.locator('#cafe-strip .cafe-card').nth(recipe.slot - 1);
    if ((await card.getAttribute('aria-pressed')) === 'true' && (await page.locator('#cafe-title').textContent()) === recipe.name) return;
    await card.click();
    await page.locator('#cafe-title').filter({ hasText: recipe.name }).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(3000);
}
// A shot from start to the finished Shot in the graph: its record on the tablet.
async function shotWith(page, recordId, seconds, barista, tablet = decaid) {
    const before = (await newestShotWith(recordId, tablet))?.id ?? null;
    await tablet('PUT', '/workflow', { context: { baristaName: barista } });
    await pullShot(seconds, tablet);
    const pulled = await until(async () => { const newest = await newestShotWith(recordId, tablet); return newest && newest.id !== before ? newest : null; }, { timeout: 30_000 });
    await page.locator('#cafe-shot-when').filter({ hasText: /\d{2}:\d{2}/ }).waitFor({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2500);
    return pulled;
}
// A Shot's rating and note as the server holds them: `{ rating, note }`, each null for none.
const onServer = async shotId => {
    const { shot } = await sync('GET', `/shots/${shotId}`);
    return { rating: shot.enjoyment || null, note: shot.record?.annotations?.espressoNotes || null };
};

// The Shots list: its rows as they read, and opening and closing it.
const listRows = page => page.evaluate(() => [...document.querySelectorAll('#cafe-shots-list .cafe-shots-row')].map(row => {
    // A cell shows where it has a box: the Machine's name sits in a cell the tablet's own list hides.
    const cell = row.querySelector('.cafe-shots-machine-name');
    return { id: row.dataset.shotId, machine: cell && cell.offsetParent !== null ? cell.textContent.trim() : null };
}));
async function openList(page) {
    await page.locator('#cafe-shots-btn').click();
    await page.locator('#cafe-shots-dialog[open]').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(500);
}
async function closeList(page) {
    await page.locator('#cafe-shots-dialog .cafe-shots-head button').click();
    await page.locator('#cafe-shots-dialog:not([open])').waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
}
// Tap a row of the open list, and wait for its Shot's row of the legend.
async function openRow(page, shotId, test) {
    await page.locator(`#cafe-shots-list .cafe-shots-row[data-shot-id="${shotId}"]`).click();
    return await waitLegend(page, test, 30_000) || legend(page);
}

// ── The grinder dialog ───────────────────────────────────────────────────────

const grindersOf = async tablet => { const listed = await tablet('GET', '/grinders'); return Array.isArray(listed) ? listed : listed.items || []; };
const pickDialog = page => page.locator('#cafe-pick-dialog[open]');
// A tap on the Grind row's name, where a finger lands: the name takes no
// pointer events itself, so the tap is made at its place.
async function openGrinders(page) {
    const box = await page.locator('#grind-section .cafe-row-name').boundingBox();
    await page.mouse.click(box.x + Math.min(box.width / 2, 40), box.y + box.height / 2);
    return pickDialog(page).waitFor({ timeout: 15_000 }).then(() => page.waitForTimeout(500)).then(() => true, () => false);
}
async function chooseGrinder(page, model) {
    await page.locator('#cafe-pick-list .cafe-pick-row').filter({ has: page.locator('.cafe-pick-row-name', { hasText: model }) }).click();
    await page.locator('#cafe-pick-dialog:not([open])').waitFor({ state: 'attached', timeout: 5000 });
}
const grindRow = async page => ({ name: await page.locator('#cafe-grind-desc').textContent(), value: parseFloat(await page.locator('#grind-value').textContent()) });

// 8. The grinder dialog with Decent Sync (docs/cafe/DESIGN.md, "What the
//     screen shows"): another of the Location's Grinders, chosen on this
//     tablet with the Recipe loaded, is recorded by Decent Sync as the
//     Recipe's: on the server, in the tablet's record, and on the second
//     Machine, which has the Recipe loaded too.
async function grinderWithDecentSync({ page, house }) {
    const mine = await grindersOf(decaid);
    const chosen = mine.find(g => g.model === SECOND_GRINDER.model);
    const usual = mine.find(g => g.model === GRINDER.model);
    const theirs = await until(async () => { const list = await grindersOf(decaid2); return list.some(g => g.model === SECOND_GRINDER.model) ? list : null; }, { timeout: 60_000, every: 1000 });
    check('grinder: both sample grinders are the Location\'s, on each tablet', !!chosen && !!usual && !!theirs, JSON.stringify((theirs || []).map(g => g.model)));
    if (!chosen || !usual || !theirs) return;
    //     A shot on that grinder on this tablet, with no recipe loaded, at the
    //     setting a choice of it then takes.
    await decaid('POST', `/plugins/${DYE2_PLUGIN_ID}/selection`, {});
    await decaid('PUT', '/workflow', { context: { grinderId: chosen.id, grinderModel: chosen.model, grinderSetting: GRINDER_USE.second.setting, extras: { rpm: GRINDER_USE.second.rpm } } });
    const before = (await decaid('GET', '/shots?limit=1')).items?.[0]?.id ?? null;
    await pullShot(4);
    const pulled = await until(async () => { const newest = (await decaid('GET', '/shots?limit=1')).items?.[0]; return newest && newest.id !== before ? newest : null; }, { timeout: 30_000 });
    check('grinder: a shot was pulled on it', !!pulled);
    // The choice takes the setting the grinder was last used at, read from that shot.
    await sleep(5000);
    //     The second tablet, with the Recipe loaded.
    const tablet2 = await openPage(await secondBrowser());
    await tablet2.page.locator('#cafe-strip .cafe-card').nth(house.slot - 1).filter({ hasText: house.name }).waitFor({ timeout: 60_000 });
    await load(tablet2.page, house);
    check('grinder: the second tablet names the Recipe\'s grinder under Grind', (await grindRow(tablet2.page)).name === GRINDER.model, JSON.stringify(await grindRow(tablet2.page)));
    const loadsThere = tablet2.seen.loads;
    //     This tablet: the Recipe loaded, and the dialog.
    await load(page, house);
    check('grinder: this tablet names the Recipe\'s grinder under Grind', (await grindRow(page)).name === GRINDER.model, JSON.stringify(await grindRow(page)));
    await openGrinders(page);
    await chooseGrinder(page, SECOND_GRINDER.model);
    await page.locator('#cafe-grind-desc').filter({ hasText: SECOND_GRINDER.model }).waitFor({ timeout: 10_000 }).catch(() => {});
    //     Decent Sync records it as the Recipe's, and writes it everywhere.
    const recordGrinder = async (tablet, grinderId) => {
        const record = ((await tablet('GET', `/store/${DYE2_PLUGIN_ID}/recipes`)) || []).find(row => row && row.decentSyncId === house.id);
        return record && String(record.grinderId ?? record.workflow?.context?.grinderId) === String(grinderId) ? record : null;
    };
    //     The Location's Grinder is the one the tablet's grinder carries the id of.
    const dial = async () => { const { content } = (await sync('GET', `/recipes/${house.id}`)).recipe; return { grinderId: content.grinderId, grindSetting: content.grindSetting, rpm: content.rpm ?? null }; };
    const onServer = await until(async () => {
        const now = await dial();
        return now.grinderId === chosen.extras?.decentSyncId && String(now.grindSetting) === GRINDER_USE.second.setting && now.rpm === GRINDER_USE.second.rpm ? now : null;
    }, { timeout: 60_000, every: 1000 });
    check('grinder: the Recipe on the server takes the Location\'s Grinder, with the setting and RPM the choice wrote', !!onServer, JSON.stringify(await dial()));
    check('grinder: the Recipe\'s record on this tablet names the grinder', !!(await until(() => recordGrinder(decaid, chosen.id), { timeout: 60_000, every: 1000 })));
    const there = theirs.find(g => g.model === SECOND_GRINDER.model);
    check('grinder: and the Recipe\'s record on the second tablet', !!(await until(() => recordGrinder(decaid2, there.id), { timeout: 60_000, every: 1000 })));
    const shown = await until(async () => { const now = await grindRow(tablet2.page); return now.name === SECOND_GRINDER.model ? now : null; }, { timeout: 90_000, every: 1000 });
    check('grinder: the second Machine shows the grinder and its setting under Grind, with no tap and no reload',
        !!shown && shown.value === parseFloat(GRINDER_USE.second.setting) && tablet2.seen.loads === loadsThere, JSON.stringify(shown || await grindRow(tablet2.page)));
    await shot(tablet2.page, 'sync-grinder-second-machine-light');
    //     The Recipe's own grinder chosen back, as the run found it.
    await openGrinders(page);
    await chooseGrinder(page, GRINDER.model);
    const back = await until(async () => ((await grindRow(tablet2.page)).name === GRINDER.model && (await dial()).grinderId === usual.extras?.decentSyncId ? true : null), { timeout: 90_000, every: 1000 });
    check('grinder: the grinder chosen back reaches the Recipe and the second Machine too', !!back, `${JSON.stringify(await grindRow(tablet2.page))} ${JSON.stringify(await dial())}`);
    check('grinder: no page error on either tablet', tablet2.seen.errors.length === 0, tablet2.seen.errors.join(' | '));
    await tablet2.close();
    await decaid('DELETE', `/shots/${pulled.id}`).catch(() => {});
}

// 10. A tap on the loaded card unloads it (#53), on this Machine only: the
//     server shows it with no Loaded Recipe; a step made there afterwards is
//     saved to no Recipe and does not reach the second Machine, which keeps the
//     Recipe loaded; a Shot pulled there reaches the server with no Recipe; and
//     a tap on the card loads the Recipe as the server has it. On a page of
//     this tablet's own at 1920 by 1200, then on one at 1340 by 800.
async function unloadWithDecentSync({ house, two, machine }) {
    const tablet2 = await openPage(await secondBrowser());
    try {
        await tablet2.page.locator('#cafe-strip .cafe-card').nth(house.slot - 1).filter({ hasText: house.name }).waitFor({ timeout: 60_000 });
        await load(tablet2.page, house);
        for (const viewport of [{ width: 1920, height: 1200 }, { width: 1340, height: 800 }]) {
            const view = await openPage(browser, viewport);
            try {
                await unloadAtSize({ ...view, size: `${viewport.width}x${viewport.height}`, house, two, machine, tablet2 });
            } finally {
                await view.close();
            }
        }
        check('unload: no page error on the second tablet', tablet2.seen.errors.length === 0, tablet2.seen.errors.join(' | '));
    } finally {
        await tablet2.close();
    }
}

async function unloadAtSize({ page, seen, size, house, two, machine, tablet2 }) {
    const loadedOn = async id => (await sync('GET', `/machines/${id}`)).machine.loadedRecipe?.recipe?.id ?? null;
    const content = async () => (await sync('GET', `/recipes/${house.id}`)).recipe.content;
    const named = async tablet => { const now = await tablet('GET', `/plugins/${DYE2_PLUGIN_ID}/selection`); return now?.kind === 'recipe' ? String(now.id) : null; };
    await page.waitForTimeout(2500);
    await load(page, house);
    const loadedFirst = await until(async () => ((await loadedOn(machine.id)) === house.id && (await loadedOn(two.machine.id)) === house.id) || null, { timeout: 60_000, every: 1000 });
    check(`unload ${size}: with the Recipe loaded on both Machines, the server shows it on each`, !!loadedFirst, `${await loadedOn(machine.id)} | ${await loadedOn(two.machine.id)}`);

    //     The tap, on this Machine.
    await page.locator('#cafe-strip .cafe-card').nth(house.slot - 1).click();
    await page.locator('#cafe-title').filter({ hasText: 'No recipe selected' }).waitFor({ timeout: 10_000 }).catch(() => {});
    const gone = await until(async () => ((await loadedOn(machine.id)) === null || null), { timeout: 60_000, every: 1000 });
    check(`unload ${size}: the server shows this Machine with no Loaded Recipe`, !!gone, await loadedOn(machine.id));

    //     A step afterwards: this Machine's alone. Once it is in the Workflow,
    //     the plugin's poll interval (PollSeconds 5, as connect() sets it) is
    //     waited three times over: a save it should not make, to the Recipe or
    //     on to the second Machine, is given the time to land.
    const stored = await content();
    const theirDose = (await decaid2('GET', '/workflow')).context.targetDoseWeight;
    const dose = parseFloat(await page.locator('#dose-in-value').textContent());
    await page.locator('#dose-in-plus').click();
    const stepped = parseFloat(await page.locator('#dose-in-value').textContent());
    //     Without the step in this Machine's Workflow, the checks after the wait would hold whatever happened.
    const reached = await until(async () => (Math.abs((await decaid('GET', '/workflow')).context.targetDoseWeight - stepped) < 0.001 || null), { timeout: 10_000 });
    check(`unload ${size}: a step afterwards reaches this Machine's Workflow`, stepped > dose && !!reached, `${dose} g to ${stepped} g, Workflow ${(await decaid('GET', '/workflow')).context.targetDoseWeight} g`);
    await sleep(15_000);
    check(`unload ${size}: and is saved to no Recipe: the server's Recipe keeps its dose`, (await content()).dose === stored.dose, `${stored.dose} then ${(await content()).dose}`);
    check(`unload ${size}: nor reaches the second Machine, which keeps the Recipe loaded`,
        (await decaid2('GET', '/workflow')).context.targetDoseWeight === theirDose && (await named(decaid2)) === two.recordId && (await loadedOn(two.machine.id)) === house.id
        && (await tablet2.page.locator('#cafe-title').textContent()) === house.name,
        `${(await decaid2('GET', '/workflow')).context.targetDoseWeight} g, selection ${await named(decaid2)}, server ${await loadedOn(two.machine.id)}`);

    //     A Shot pulled with nothing loaded belongs to no recipe.
    const before = (await decaid('GET', '/shots?limit=1')).items?.[0]?.id ?? null;
    await pullShot(5);
    const pulled = await until(async () => { const newest = (await decaid('GET', '/shots?limit=1')).items?.[0]; return newest && newest.id !== before ? newest : null; }, { timeout: 30_000 });
    const there = pulled ? await until(async () => (await sync('GET', `/shots/${pulled.id}`)).shot, { timeout: 60_000, every: 1000 }) : null;
    check(`unload ${size}: a Shot pulled there reaches the server with no Recipe`, !!there && there.recipe === null, JSON.stringify(there?.recipe));
    await page.locator('#main-page:not(.cafe-shot-live)').waitFor({ timeout: 20_000 }).catch(() => {});
    //     Decaid stores the Shot about 4 s after the pump stops, and the page
    //     takes no tap on a card until it has it: the wait the run always had here.
    await page.waitForTimeout(6000);

    //     A tap on the card loads the Recipe as the server has it.
    await load(page, house);
    const now = await content();
    const workflow = await decaid('GET', '/workflow');
    check(`unload ${size}: a tap on the card loads the Recipe as the server has it`,
        workflow.context.targetDoseWeight === now.dose && workflow.context.targetYield === now.yield && (await named(decaid)) === String(house.recordId),
        `${workflow.context.targetDoseWeight}/${workflow.context.targetYield} against ${now.dose}/${now.yield}, selection ${await named(decaid)}`);
    const back = await until(async () => ((await loadedOn(machine.id)) === house.id || null), { timeout: 60_000, every: 1000 });
    check(`unload ${size}: and the server shows it loaded again`, !!back, await loadedOn(machine.id));
    check(`unload ${size}: no page error`, seen.errors.length === 0, seen.errors.join(' | '));
    if (pulled) await decaid('DELETE', `/shots/${pulled.id}`).catch(() => {});
}

// ── The bean and batch dialog, and the basket dialog ─────────────────────────

const listOf = answer => (Array.isArray(answer) ? answer : answer?.items || []);
// A bean's batches not archived on a tablet, by the bean's name.
async function batchesThere(tablet, beanName) {
    const bean = listOf(await tablet('GET', '/beans')).find(b => b && b.name === beanName);
    return bean ? listOf(await tablet('GET', `/beans/${bean.id}/batches`)).filter(b => !b.archived) : [];
}
const onDay = (batches, day) => batches.find(b => String(b.roastDate || '').startsWith(day)) || null;
const basketsThere = async tablet => ((await tablet('GET', `/store/${DYE2_PLUGIN_ID}/baskets`)) || []).filter(b => b && !b.archived);
async function tapName(page, selector) {
    const box = await page.locator(selector).boundingBox();
    await page.mouse.click(box.x + Math.min(box.width / 2, 40), box.y + box.height / 2);
    return pickDialog(page).waitFor({ timeout: 15_000 }).then(() => page.waitForTimeout(500)).then(() => true, () => false);
}
const pickClosed = page => page.locator('#cafe-pick-dialog:not([open])').waitFor({ state: 'attached', timeout: 5000 }).then(() => page.waitForTimeout(600));
const sideRowNamed = (page, name) => page.locator('#cafe-pick-side .cafe-pick-row').filter({ has: page.locator('.cafe-pick-row-name', { hasText: name }) });
const listRowNamed = (page, name) => page.locator('#cafe-pick-list .cafe-pick-row').filter({ has: page.locator('.cafe-pick-row-name', { hasText: name }) });
const doseRow = page => page.locator('#cafe-dose-desc').textContent();
const yieldRow = page => page.locator('#cafe-yield-desc').textContent();
// Choose a batch: highlight its bean, then the batch roasted on `dayPattern`,
// as the row says it, and confirm it with "Use this batch" (#70). Answers when
// the button was tapped, which the write is timed from.
async function chooseBatch(page, beanName, dayPattern) {
    await tapName(page, '#dose-section .cafe-row-name');
    await sideRowNamed(page, beanName).click();
    // The list follows the bean highlighted: until it does, it lists the
    // dialog's first bean's batches, which the pattern could match too.
    await page.waitForTimeout(400);
    await listRowNamed(page, dayPattern).first().click();
    const tapped = Date.now();
    await page.locator('#cafe-pick-confirm-use').click();
    await pickClosed(page);
    return tapped;
}
async function chooseBasket(page, name) {
    await tapName(page, '#drink-section .cafe-row-name');
    await listRowNamed(page, name).click();
    await pickClosed(page);
}

// 9. The bean and batch dialog and the basket dialog with Decent Sync
//     (docs/cafe/DESIGN.md, "The grinder, bean and basket dialogs"), with the
//     Recipe loaded on both Machines: a batch of the Recipe's own Bean is
//     recorded as the Recipe's and reaches the second Machine; a batch of
//     another Bean becomes the Recipe's Bean (#52), and a name DYE2 gave
//     follows it, on the server and on the second Machine, with both keeping
//     the Recipe loaded; and a basket reaches the Recipe, saved by DYE2 when
//     the plugin asks it to.
async function beanAndBasketWithDecentSync({ page, house, location }) {
    //     The Location's Baskets: the tablet's DYE2 baskets joined the Library
    //     when the plugin first reported them (the first run gave them ids). On
    //     a server that holds them under no id, they are shown here by name.
    for (const basket of BASKETS.filter(b => !b.archived)) {
        await sync('POST', '/baskets', { locationId: location.id, content: { name: basket.name, size: basket.size, diameterMm: basket.diameterMm } })
            .catch(async error => {
                // 409: the Library has it already, perhaps not shown here.
                let existing = null;
                try { existing = JSON.parse(error.message.replace(/^[^{]*/, '')).existing; } catch { /* not a 409's answer */ }
                if (existing?.id) await sync('PUT', `/baskets/${existing.id}/locations/${location.id}`, { shown: true }).catch(() => {});
            });
    }
    const ready = await until(async () => {
        const mine = await basketsThere(decaid);
        const theirs = await basketsThere(decaid2);
        const blendHere = await batchesThere(decaid, 'Sample Blend');
        const blendThere = await batchesThere(decaid2, 'Sample Blend');
        const decafThere = await batchesThere(decaid2, 'Example Decaf');
        const both = list => BASKETS.filter(b => !b.archived).every(b => list.some(row => row.name === b.name && row.decentSyncId));
        return both(mine) && both(theirs) && onDay(blendHere, '2026-10-15') && onDay(blendThere, '2026-10-15') && onDay(blendThere, '2026-11-02') && decafThere.length
            ? { mine, theirs, blendHere, blendThere } : null;
    }, { timeout: 120_000, every: 2000 });
    check('bean and basket: the sample baskets and Sample Blend\'s two batches are the Location\'s, on each tablet', !!ready,
        JSON.stringify({ baskets: (await basketsThere(decaid2)).map(b => b.name), blend: (await batchesThere(decaid2, 'Sample Blend')).map(b => b.roastDate) }));
    if (!ready) return;
    const recipe = async () => (await sync('GET', `/recipes/${house.id}`)).recipe;
    const original = (await recipe()).content;
    const record = async tablet => ((await tablet('GET', `/store/${DYE2_PLUGIN_ID}/recipes`)) || []).find(row => row && row.decentSyncId === house.id) || null;
    const recordBatch = row => String(row?.beanBatchId ?? row?.workflow?.context?.beanBatchId ?? '');
    const recordBasket = row => row?.dashboardVariables?.basketName ?? row?.workflow?.context?.extras?.basketName ?? null;

    //     Both tablets with the Recipe loaded.
    const tablet2 = await openPage(await secondBrowser());
    try {
        await tablet2.page.locator('#cafe-strip .cafe-card').nth(house.slot - 1).filter({ hasText: house.name }).waitFor({ timeout: 60_000 });
        await load(tablet2.page, house);
        await load(page, house);
        const loadsThere = tablet2.seen.loads;

        //     A batch of the Recipe's own Bean: the Recipe's, everywhere.
        await chooseBatch(page, 'Sample Blend', /15/);
        const older = onDay(ready.blendHere, '2026-10-15');
        const olderThere = onDay(ready.blendThere, '2026-10-15');
        const taken = await until(async () => {
            const now = await recipe();
            return String(now.uses?.beanBatch?.roastDate || '').startsWith('2026-10-15') ? now : null;
        }, { timeout: 60_000, every: 1000 });
        check('bean: the Recipe on the server takes the batch', !!taken, JSON.stringify((await recipe()).uses?.beanBatch));
        check('bean: the Recipe\'s record on this tablet names it', !!(await until(async () => recordBatch(await record(decaid)) === String(older.id) || null, { timeout: 60_000, every: 1000 })),
            recordBatch(await record(decaid)));
        check('bean: and on the second tablet, by its own batch', !!(await until(async () => recordBatch(await record(decaid2)) === String(olderThere.id) || null, { timeout: 60_000, every: 1000 })),
            recordBatch(await record(decaid2)));
        const doseThere = await until(async () => { const now = await doseRow(tablet2.page); return /^Sample Blend · roasted .*15/.test(now) ? now : null; }, { timeout: 90_000, every: 1000 });
        check('bean: the second Machine names the batch under Dose, with no tap and no reload', !!doseThere && tablet2.seen.loads === loadsThere, await doseRow(tablet2.page));
        await shot(tablet2.page, 'sync-bean-second-machine-light');

        //     A batch of another Bean: the Recipe's Bean now, everywhere (#52).
        //     The Recipe given DYE2's name for it first ("Sample Blend", as
        //     DYE2 leaves "Default" out), through the server's API as the
        //     management interface would, so the name follows the Bean.
        const nameOf = now => now.name ?? now.content?.name;
        const named = async tablet => { const now = await tablet('GET', `/plugins/${DYE2_PLUGIN_ID}/selection`); return now?.kind === 'recipe' ? String(now.id) : null; };
        const generated = house.bean;
        const renamed = `Example Decaf`;
        await sync('PATCH', `/recipes/${house.id}`, { content: { name: generated } });
        const nameThere = await until(async () => ((await record(decaid))?.name === generated && (await record(decaid2))?.name === generated) || null, { timeout: 90_000, every: 1000 });
        await page.locator('#cafe-title').filter({ hasText: generated }).waitFor({ timeout: 30_000 }).catch(() => {});
        check('bean: the Recipe has the name DYE2 gives it, on both tablets and on the first page', !!nameThere && (await page.locator('#cafe-title').textContent()) === generated,
            `${(await record(decaid))?.name} | ${(await record(decaid2))?.name} | ${await page.locator('#cafe-title').textContent()}`);
        const decafHere = (await batchesThere(decaid, 'Example Decaf'))[0];
        const loadedThere = await named(decaid2);
        const started = await chooseBatch(page, 'Example Decaf', /Roasted/);
        let reached = false;
        let setBack = null;
        let serverAt = null;
        let secondAt = null;
        for (let waited = 0; waited < 120_000 && !(serverAt && secondAt && waited > 15_000); waited += 500) {
            const mine = await decaid('GET', '/workflow');
            const onDecaf = String(mine.context.beanBatchId) === String(decafHere.id) && mine.context.coffeeName === 'Example Decaf';
            if (onDecaf) reached = true;
            if (reached && (!onDecaf || (await named(decaid)) !== String(house.recordId))) setBack = setBack || `${mine.context.coffeeName}, ${await named(decaid)}`;
            const now = await recipe();
            if (!serverAt && now.uses?.bean?.name === 'Example Decaf' && String(now.uses?.beanBatch?.roastDate || '').startsWith('2026-10-20') && nameOf(now) === renamed) serverAt = Date.now() - started;
            if (!secondAt && /^Example Decaf · roasted/.test(await doseRow(tablet2.page)) && (await named(decaid2)) === loadedThere) secondAt = Date.now() - started;
            await sleep(500);
        }
        check('bean: the Recipe on the server takes the Bean, the batch and the name DYE2 gives with it',
            serverAt !== null, JSON.stringify({ bean: (await recipe()).uses?.bean, batch: (await recipe()).uses?.beanBatch, name: nameOf(await recipe()) }));
        note(`bean: the server took the Bean, batch and name ${serverAt === null ? 'never' : `in ${(serverAt / 1000).toFixed(1)} s`}`);
        check('bean: the first Machine was never set back, its Workflow on the batch with the Recipe loaded', reached && setBack === null, setBack || `reached: ${reached}`);
        check('bean: the second Machine names the new Bean under Dose, with the Recipe loaded, no tap and no reload',
            secondAt !== null && tablet2.seen.loads === loadsThere, await doseRow(tablet2.page));
        note(`bean: the second Machine followed ${secondAt === null ? 'never' : `in ${(secondAt / 1000).toFixed(1)} s`}`);
        const mineNow = await record(decaid);
        check('bean: the Recipe\'s record on this tablet names the Bean, the batch and the new name',
            String(mineNow?.beanId ?? '') !== '' && recordBatch(mineNow) === String(decafHere.id) && mineNow?.name === renamed, JSON.stringify({ beanId: mineNow?.beanId, batch: recordBatch(mineNow), name: mineNow?.name }));
        const decafThere = (await batchesThere(decaid2, 'Example Decaf'))[0];
        check('bean: and on the second tablet, by its own batch', !!(await until(async () => {
            const row = await record(decaid2);
            return (recordBatch(row) === String(decafThere?.id) && row?.name === renamed) || null;
        }, { timeout: 60_000, every: 1000 })), JSON.stringify({ batch: recordBatch(await record(decaid2)), name: (await record(decaid2))?.name }));
        await page.locator('#cafe-title').filter({ hasText: renamed }).waitFor({ timeout: 10_000 }).catch(() => {});
        check('bean: the first page\'s title band and card show the new name', (await page.locator('#cafe-title').textContent()) === renamed,
            await page.locator('#cafe-title').textContent());
        await shot(page, 'sync-bean-after-other-bean-light');
        await shot(tablet2.page, 'sync-bean-other-bean-second-machine-light');

        //     A basket: saved onto the Recipe by DYE2, at the plugin's ask.
        await chooseBasket(page, '20 g sample basket');
        const basketTaken = await until(async () => ((await recipe()).uses?.basket?.name === '20 g sample basket' || null), { timeout: 60_000, every: 1000 });
        check('basket: the Recipe on the server takes the basket', !!basketTaken, JSON.stringify((await recipe()).uses?.basket));
        check('basket: the Recipe\'s record on this tablet names it', !!(await until(async () => recordBasket(await record(decaid)) === '20 g sample basket' || null, { timeout: 60_000, every: 1000 })));
        check('basket: and on the second tablet', !!(await until(async () => recordBasket(await record(decaid2)) === '20 g sample basket' || null, { timeout: 60_000, every: 1000 })));
        const yieldThere = await until(async () => ((await yieldRow(tablet2.page)) === '20 g sample basket' || null), { timeout: 60_000, every: 1000 });
        check('basket: the second Machine names it under Yield, with no tap and no reload', !!yieldThere && tablet2.seen.loads === loadsThere, await yieldRow(tablet2.page));
        check('bean and basket: no page error on either tablet', tablet2.seen.errors.length === 0, tablet2.seen.errors.join(' | '));
    } finally {
        await tablet2.close();
        //     The Recipe's own batch and basket put back, as the run found them.
        // The batch carries its Bean back with it.
        await sync('PATCH', `/recipes/${house.id}`, { content: { beanBatchId: original.beanBatchId, basketId: original.basketId, name: house.name } })
            .catch(error => note(`could not put the Recipe's batch, basket and name back: ${error.message}`));
        await until(async () => ((await record(decaid))?.name === house.name && (await record(decaid2))?.name === house.name) || null, { timeout: 90_000, every: 1000 });
        await page.locator('#cafe-strip .cafe-card').nth(house.slot - 1).filter({ hasText: house.name }).waitFor({ timeout: 60_000 }).catch(() => {});
        await load(page, house).catch(() => {});
    }
}

// ── The profile changed from the page, with Decent Sync (#50) ──────────────

// The function the profile dialog (#51) calls, called from the page itself.
const changeProfile = (page, profileId) => page.evaluate(async id => {
    const { changeProfile: change } = await import('/src/cafe/profile-changer.js');
    const { checked, ...answer } = await change(id);
    window.__cafeChecked = checked;
    return answer;
}, profileId);
const checkedAfter = page => page.evaluate(() => window.__cafeChecked);

// 11. The profile changed on one Machine with a Recipe loaded on both, the
//     trial of #50 with Decent Sync (docs/cafe/DESIGN.md, "Changing the
//     profile"): the Recipe on the server takes the Profile, its brew
//     temperature and, for a name DYE2 gave it, the new name, and how long that
//     took; the first Machine is never set back; the second Machine takes the
//     profile and keeps the Recipe loaded; the Reference Shot, pulled on the old
//     profile, is flagged "Different profile"; and the same with the server
//     stopped, taken once it is back.
async function profileWithDecentSync({ page, house, two }) {
    const profiles = await decaid('GET', '/profiles');
    const byTitle = title => profiles.find(p => p.profile?.title === title);
    const [light, gentle, usual] = ['Best practice (light roast)', 'Gentle and sweet', house.profile].map(byTitle);
    const own = record => record.profile.steps[0].temperature;
    check('profile: Decaid holds the profiles the step uses', !!light && !!gentle && !!usual);
    if (!light || !gentle || !usual) return;
    const recipeNow = async () => (await sync('GET', `/recipes/${house.id}`)).recipe;
    const nameOf = recipe => recipe.name ?? recipe.content?.name;
    const recordOn = async tablet => ((await tablet('GET', `/store/${DYE2_PLUGIN_ID}/recipes`)) || []).find(row => row && row.decentSyncId === house.id);
    const named = async tablet => { const now = await tablet('GET', `/plugins/${DYE2_PLUGIN_ID}/selection`); return now?.kind === 'recipe' ? String(now.id) : null; };
    // DYE2's name for the Recipe on its own profile and bean: "Sample Blend",
    // since DYE2 leaves the word "Default" out. Given on the server, as the
    // management interface would, so the change is to a recipe DYE2 named.
    const generated = house.bean;
    await sync('PATCH', `/recipes/${house.id}`, { content: { name: generated } });
    const renamedThere = await until(async () => ((await recordOn(decaid))?.name === generated && (await recordOn(decaid2))?.name === generated) || null, { timeout: 90_000, every: 1000 });
    check('profile: the Recipe has the name DYE2 gives it, on both tablets', !!renamedThere, `${(await recordOn(decaid))?.name} | ${(await recordOn(decaid2))?.name}`);
    const tablet2 = await openPage(await secondBrowser());
    try {
        await tablet2.page.locator('#cafe-strip .cafe-card').nth(house.slot - 1).filter({ hasText: generated }).waitFor({ timeout: 60_000 }).catch(() => {});
        const loadNamed = async (view, name) => {
            const card = view.locator('#cafe-strip .cafe-card').nth(house.slot - 1);
            if ((await card.getAttribute('aria-pressed')) === 'true') return;
            await card.click();
            await view.locator('#cafe-title').filter({ hasText: name }).waitFor({ timeout: 20_000 });
            await view.waitForTimeout(3000);
        };
        await loadNamed(tablet2.page, generated);
        await page.locator('#cafe-strip .cafe-card').nth(house.slot - 1).filter({ hasText: generated }).waitFor({ timeout: 60_000 }).catch(() => {});
        await loadNamed(page, generated);
        check('profile: the Recipe is loaded on both Machines', (await named(decaid)) === String(house.recordId) && (await named(decaid2)) === two.recordId, `${await named(decaid)} | ${await named(decaid2)}`);
        //     A Reference Shot pulled on the old profile.
        const old = await shotWith(page, house.recordId, 10, BARISTAS[0]);
        // Not the reference an earlier step left: this Shot's, or the badge
        // where the graph's latest is this Shot.
        const prior = (await legend(page)).reference;
        await setReference(house, old.id);
        const drawn = await waitLegend(page, l => (l.reference !== null && l.reference !== prior) || l.badge !== null);
        check('profile: the Recipe\'s Reference Shot, pulled on its profile, is drawn with no flag', !!drawn && drawn.flag === null, JSON.stringify(drawn || await legend(page)));

        //     The change, on the first Machine.
        const started = Date.now();
        const answer = await changeProfile(page, light.id);
        const expected = `Best ${house.bean}`;
        check('profile: the change answers ok, and the recipe DYE2 named takes the new profile\'s name', answer.ok && answer.name === expected, JSON.stringify(answer));
        let setBack = null;
        let serverAt = null;
        let secondAt = null;
        for (let waited = 0; waited < 120_000 && !(serverAt && secondAt); waited += 500) {
            const mine = await decaid('GET', '/workflow');
            if (mine.profile.title !== light.profile.title || (await named(decaid)) !== String(house.recordId)) setBack = setBack || `${mine.profile.title}, ${await named(decaid)}`;
            const recipe = await recipeNow();
            if (!serverAt && recipe.content.profileId === light.id && recipe.content.brewTemperature === own(light) && nameOf(recipe) === expected) serverAt = Date.now() - started;
            const theirs = await decaid2('GET', '/workflow');
            if (!secondAt && theirs.profile.title === light.profile.title && theirs.profile.steps[0].temperature === own(light) && (await named(decaid2)) === two.recordId) secondAt = Date.now() - started;
            await sleep(500);
        }
        const recipe = await recipeNow();
        check('profile: the Recipe on the server takes the Profile, its brew temperature and its new name',
            !!serverAt, `${recipe.content.profileId} ${recipe.content.brewTemperature}°C "${nameOf(recipe)}"`);
        note(`trial: the server had the change ${serverAt === null ? 'never' : `after ${(serverAt / 1000).toFixed(1)} s`}, the second Machine ${secondAt === null ? 'never' : `after ${(secondAt / 1000).toFixed(1)} s`}`);
        check('profile: the first Machine was never set back', setBack === null, setBack || '');
        check('profile: the second Machine takes the profile at its own temperature and keeps the Recipe loaded', !!secondAt,
            `${(await decaid2('GET', '/workflow')).profile.title}, ${await named(decaid2)}`);
        const theirWorkflow = await decaid2('GET', '/workflow');
        const myWorkflow = await decaid('GET', '/workflow');
        note(`trial: the second Machine brews at ${theirWorkflow.profile.steps[0].temperature}°C, the first at ${myWorkflow.profile.steps[0].temperature}°C, the profile's own ${own(light)}°C`);
        check('profile: both Machines brew at the profile\'s own temperature',
            theirWorkflow.profile.steps[0].temperature === own(light) && myWorkflow.profile.steps[0].temperature === own(light),
            `${myWorkflow.profile.steps[0].temperature} | ${theirWorkflow.profile.steps[0].temperature}`);
        check('profile: the first page\'s check afterwards found the recipe held', ['held', 'rewritten', 'reloaded'].includes(await checkedAfter(page)) && (await named(decaid)) === String(house.recordId));
        //     A shot on the new profile, so the reference is not the Shot in the
        //     graph. Long enough to pour: an Unfinished Shot never becomes the
        //     latest, and this profile's preinfusion holds for 13 s at least.
        const freshBarista = 'Sample Profile Barista';
        const fresh = await shotWith(page, house.recordId, 30, freshBarista);
        const flagged = await waitLegend(page, l => (l.when || '').includes(freshBarista) && l.flag !== null, 30_000);
        check('profile: the Reference Shot pulled on the old profile is flagged "Different profile"', flagged?.flag === 'Different profile', JSON.stringify(flagged || await legend(page)));
        await shot(page, 'sync-profile-changed-light');
        await shot(tablet2.page, 'sync-profile-second-machine-light');

        //     The same with the server stopped: kept on the tablet, taken once it is back.
        await docker('stop', SYNC_CONTAINER);
        try {
            await until(async () => (await plugin('status').catch(() => ({ served: false }))).served !== true || null, { timeout: 30_000, every: 1000 });
            const offline = await changeProfile(page, gentle.id);
            const nextName = `Gentle ${house.bean}`;
            check('profile: with the server stopped the change is made on the tablet, the recipe kept loaded',
                offline.ok && (await named(decaid)) === String(house.recordId) && (await recordOn(decaid))?.profileId === gentle.id && (await decaid('GET', '/workflow')).profile.title === gentle.profile.title
                    && (await decaid('GET', '/workflow')).profile.steps[0].temperature === own(gentle),
                JSON.stringify(offline));
            check('profile: and the check afterwards finds it held', ['held', 'rewritten', 'reloaded'].includes(await checkedAfter(page)) && (await named(decaid)) === String(house.recordId));
            await docker('start', SYNC_CONTAINER);
            await until(async () => (await plugin('status')).served === true, { timeout: 120_000, every: 1000 });
            const back = Date.now();
            const taken = await until(async () => { const now = await recipeNow(); return now.content.profileId === gentle.id && now.content.brewTemperature === own(gentle) && nameOf(now) === nextName ? now : null; }, { timeout: 120_000, every: 1000 });
            note(`trial: ${taken ? `${((Date.now() - back) / 1000).toFixed(1)} s after the plugin said it was connected again, the server had the change` : 'the server never had the change'}`);
            check('profile: once the server is back it takes the change, at the profile\'s own temperature', !!taken, `${(await recipeNow()).content.profileId} ${(await recipeNow()).content.brewTemperature}°C`);
            const followed = await until(async () => { const theirs = await decaid2('GET', '/workflow'); return (theirs.profile.title === gentle.profile.title && theirs.profile.steps[0].temperature === own(gentle) && (await named(decaid2)) === two.recordId) || null; }, { timeout: 120_000, every: 1000 });
            check('profile: and the second Machine takes it, the Recipe still loaded', !!followed, `${(await decaid2('GET', '/workflow')).profile.title}, ${await named(decaid2)}`);
            const mineAfter = await decaid('GET', '/workflow');
            check('profile: the first Machine kept it all along, at the profile\'s own temperature', mineAfter.profile.title === gentle.profile.title && mineAfter.profile.steps[0].temperature === own(gentle) && (await named(decaid)) === String(house.recordId));
        } finally {
            await docker('start', SYNC_CONTAINER).catch(() => {});
            await until(async () => (await plugin('status')).served === true, { timeout: 120_000, every: 1000 });
        }
        check('profile: no page error on either tablet', tablet2.seen.errors.length === 0, tablet2.seen.errors.join(' | '));

        //     The Recipe as the run found it: its own profile, then its name, and no reference.
        await changeProfile(page, usual.id);
        await checkedAfter(page);
        await until(async () => ((await recipeNow()).content.profileId === usual.id) || null, { timeout: 90_000, every: 1000 });
        await decaid('DELETE', `/shots/${old.id}`).catch(() => {});
        await decaid('DELETE', `/shots/${fresh.id}`).catch(() => {});
    } finally {
        await tablet2.close();
        await sync('PATCH', `/recipes/${house.id}`, { content: { name: house.name } }).catch(() => {});
        await setReference(house, null).catch(() => {});
    }
}

// ── The profile dialog, with Decent Sync (#51) ──────────────────────────────

// A tap on the Brew row's name, where a finger lands: the name takes no
// pointer events itself, so the tap is made at its place.
async function openProfiles(page) {
    const box = await page.locator('#brew-section .cafe-row-name').boundingBox();
    await page.mouse.click(box.x + Math.min(box.width / 2, 40), box.y + box.height / 2);
    return pickDialog(page).waitFor({ timeout: 15_000 }).then(() => page.waitForTimeout(500)).then(() => true, () => false);
}
const brewOn = async page => ({ name: (await page.locator('#profile-name').textContent()).trim(), temp: parseFloat(await page.locator('#temp-value').textContent()) });

// 12. The profile dialog with Decent Sync (docs/cafe/DESIGN.md, "The profile
//     dialog"): with the Recipe loaded on both Machines, another of the
//     Location's Profiles chosen in the first tablet's dialog reaches the
//     Recipe on the server, at the profile's own brew temperature, and the
//     second Machine's Brew row with no tap, the Recipe still loaded on both.
//     Then the Recipe's own Profile chosen back the same way.
async function profileDialogWithDecentSync({ page, house, two }) {
    const shown = await decaid('GET', '/profiles');
    const byTitle = title => shown.find(p => p.profile?.title === title);
    const [gentle, usual] = ['Gentle and sweet', house.profile].map(byTitle);
    const own = record => record.profile.steps[0].temperature;
    check('profile dialog: the Location shows the profiles the step uses', !!gentle && !!usual);
    if (!gentle || !usual) return;
    const recipeNow = async () => (await sync('GET', `/recipes/${house.id}`)).recipe;
    const named = async tablet => { const now = await tablet('GET', `/plugins/${DYE2_PLUGIN_ID}/selection`); return now?.kind === 'recipe' ? String(now.id) : null; };
    const recordOn = async tablet => ((await tablet('GET', `/store/${DYE2_PLUGIN_ID}/recipes`)) || []).find(row => row && row.decentSyncId === house.id);
    const choose = async record => {
        await openProfiles(page);
        await page.locator(`#cafe-pick-side .cafe-pick-side-row[data-id="${record.id}"]`).click();
        await page.waitForTimeout(400);
        await page.locator('#cafe-pick-pane-use').click();
        await page.locator('#cafe-pick-dialog:not([open])').waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
    };
    // Step 11 names the Recipe back as it ends, and the name reaches the
    // tablets' records a moment later: a card loaded under the old name would
    // be unloaded by the tap that loads it, so the step waits for the name.
    const namedBack = await until(async () => ((await recordOn(decaid))?.name === house.name && (await recordOn(decaid2))?.name === house.name) || null, { timeout: 90_000, every: 1000 });
    check('profile dialog: the Recipe has its own name on both tablets', !!namedBack, `${(await recordOn(decaid))?.name} | ${(await recordOn(decaid2))?.name}`);
    // The Recipe's Profile and brew temperature as the step found them, put
    // back should the step be cut short.
    const contentAtStart = (await recipeNow()).content;
    const tablet2 = await openPage(await secondBrowser());
    try {
        for (const view of [tablet2.page, page]) {
            await view.locator('#cafe-strip .cafe-card').nth(house.slot - 1).filter({ hasText: house.name }).waitFor({ timeout: 60_000 }).catch(() => {});
        }
        await load(tablet2.page, house);
        await load(page, house);
        check('profile dialog: the Recipe is loaded on both Machines', (await named(decaid)) === String(house.recordId) && (await named(decaid2)) === two.recordId,
            `${await named(decaid)} | ${await named(decaid2)}`);

        //     Another of the Location's Profiles, chosen in the first tablet's dialog.
        const started = Date.now();
        await choose(gentle);
        let serverAt = null;
        let secondAt = null;
        let setBack = null;
        // The dialog closes at the tap and the change lands a moment later, so
        // the first Machine is watched for being set back only once it has it.
        let mineAt = null;
        for (let waited = 0; waited < 120_000 && !(serverAt && secondAt); waited += 500) {
            const mine = await decaid('GET', '/workflow');
            const holds = mine.profile.title === gentle.profile.title && (await named(decaid)) === String(house.recordId);
            if (holds && mineAt === null) mineAt = Date.now() - started;
            if (!holds && mineAt !== null) setBack = setBack || `${mine.profile.title}, ${await named(decaid)}`;
            const recipe = await recipeNow();
            if (!serverAt && recipe.content.profileId === gentle.id && recipe.content.brewTemperature === own(gentle)) serverAt = Date.now() - started;
            const theirs = await brewOn(tablet2.page);
            if (!secondAt && theirs.name === gentle.profile.title && theirs.temp === own(gentle) && (await named(decaid2)) === two.recordId) secondAt = Date.now() - started;
            await sleep(500);
        }
        note(`profile dialog: the first Machine had the choice ${mineAt === null ? 'never' : `after ${(mineAt / 1000).toFixed(1)} s`}, the server ${serverAt === null ? 'never' : `after ${(serverAt / 1000).toFixed(1)} s`}, the second Machine's Brew row ${secondAt === null ? 'never' : `after ${(secondAt / 1000).toFixed(1)} s`}`);
        const recipe = await recipeNow();
        check('profile dialog: the Recipe on the server takes the Profile, at its own brew temperature', !!serverAt, `${recipe.content.profileId} ${recipe.content.brewTemperature}°C`);
        check('profile dialog: the first Machine kept it, the Recipe loaded, its record holding the Profile',
            mineAt !== null && setBack === null && (await recordOn(decaid))?.profileId === gentle.id && (await brewOn(page)).name === gentle.profile.title, setBack || '');
        check('profile dialog: the second Machine\'s Brew row shows it at its own temperature with no tap, the Recipe still loaded', !!secondAt,
            `${JSON.stringify(await brewOn(tablet2.page))}, ${await named(decaid2)}`);
        check('profile dialog: the second tablet\'s record holds the Profile', (await recordOn(decaid2))?.profileId === gentle.id, (await recordOn(decaid2))?.profileId);
        check('profile dialog: the second tablet\'s page was not reloaded', tablet2.seen.loads === 1, `${tablet2.seen.loads} loads`);
        await shot(tablet2.page, 'sync-profile-dialog-second-machine-1920x1200-light');

        //     The Recipe's own Profile, chosen back the same way.
        await choose(usual);
        const back = await until(async () => {
            const now = await recipeNow();
            const theirs = await brewOn(tablet2.page);
            return (now.content.profileId === usual.id && theirs.name === usual.profile.title && (await named(decaid2)) === two.recordId) || null;
        }, { timeout: 120_000, every: 1000 });
        check('profile dialog: the Recipe\'s own Profile chosen back reaches the server and the second Machine', !!back,
            `${(await recipeNow()).content.profileId}, ${(await brewOn(tablet2.page)).name}`);
        check('profile dialog: no page error on the second tablet', tablet2.seen.errors.length === 0, tablet2.seen.errors.join(' | '));
    } finally {
        await tablet2.close();
        // A step cut short before the Profile was chosen back: the Recipe's
        // own put back on the server, outside the dialog this step tries.
        const contentNow = (await recipeNow().catch(() => null))?.content;
        if (contentNow?.profileId !== contentAtStart.profileId || contentNow?.brewTemperature !== contentAtStart.brewTemperature) {
            await sync('PATCH', `/recipes/${house.id}`, {
                content: { profileId: contentAtStart.profileId, brewTemperature: contentAtStart.brewTemperature ?? null },
            }).catch(() => {});
        }
    }
}

// ── The run ──────────────────────────────────────────────────────────────────

await mkdir(OUT, { recursive: true });
let stopped = false;
let sharingOff = null;

// --only=profile (step 11) or --only=profile-dialog (step 12) alone, on
// Decaids and a server a whole run has set up.
if (ONLY) {
    const steps = { profile: profileWithDecentSync, 'profile-dialog': profileDialogWithDecentSync };
    try {
        if (!steps[ONLY]) throw new Error(`no step named "${ONLY}": ${Object.keys(steps).join(', ')}`);
        const { location } = await standUp();
        const library = await until(() => libraryRecipes(location), { timeout: 60_000, every: 1000 });
        if (!library) throw new Error('The tablet\'s sample recipes are not the Location\'s Recipes: run the whole of this run first.');
        const house = { ...RECIPES[0], ...library[RECIPES[0].name] };
        const two = await standUpSecond(location, house);
        const { page, close } = await openPage();
        await steps[ONLY]({ page, house, two });
        await close();
    } catch (error) {
        check(`the run finished (${error.message.split('\n')[0]})`, false);
        console.log(error.stack);
    } finally {
        await docker('start', SYNC_CONTAINER).catch(() => {});
        await browser.close();
        if (browser2) await browser2.close();
    }
    const failed = results.filter(r => !r.ok);
    console.log(`\n${results.length - failed.length} of ${results.length} checks passed. Screenshots: ${OUT}`);
    process.exit(failed.length ? 1 : 0);
}

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

    // 2. Make reference on the page reaches the server. No Reference Shot on
    //    the server to begin with, so the tap asks nothing first.
    await setReference(house, null);
    const { page, seen, close } = await openPage();
    await load(page, house);
    // The page knows the Machine is served, so Make reference is the plugin's.
    await page.locator('#cafe-dial-label').filter({ hasText: 'Dial-in · saved to the recipe' }).waitFor({ timeout: 20_000 }).catch(() => {});
    const first = await shotWith(page, house.recordId, 10, BARISTAS[0]);
    await page.locator('#cafe-make-reference').click();
    await waitLegend(page, l => l.badge !== null);
    check('Make reference makes the Shot the Recipe\'s Reference Shot on the server', (await referenceOnServer(house)) === first.id, `${await referenceOnServer(house)} for ${first.id}`);

    // 3. Rating and notes: an edit on the page is the plugin's call, which
    //    writes the tablet's own Shot through Decaid, and the server has it
    //    soon after. A second shot, so the latest is not the reference.
    const second = await shotWith(page, house.recordId, 10, BARISTAS[1]);
    await waitLegend(page, l => l.label === 'Latest' && l.reference !== null);
    {
        const tablet = async () => (await decaid('GET', `/shots/${second.id}`)).annotations || {};
        await page.locator('#cafe-stars .cafe-star').nth(3).click();
        let held = await until(async () => { const now = await onServer(second.id); return now.rating === 8 ? now : null; }, { timeout: 45_000 });
        check('a rating on the page is held by the tablet\'s own record and by the server', (await tablet()).enjoyment === 8 && held?.rating === 8, `tablet ${(await tablet()).enjoyment} server ${JSON.stringify(held || await onServer(second.id))}`);
        await page.locator('#cafe-stars .cafe-star').nth(3).click();
        held = await until(async () => { const now = await onServer(second.id); return now.rating === null ? now : null; }, { timeout: 45_000 });
        check('a rating cleared on the page is cleared on the tablet and on the server', !((await tablet()).enjoyment > 0) && !!held, `tablet ${(await tablet()).enjoyment} server ${JSON.stringify(held || await onServer(second.id))}`);
        await page.locator('#cafe-stars .cafe-star').nth(4).click();
        // The rating's edit made before the note's.
        await page.waitForTimeout(800);

        const NOTE = 'Bright, with a clean finish.\nKeep the grind where it is.';
        await page.locator('#cafe-shot-note').click();
        await page.locator('#cafe-note-text').fill(`  ${NOTE}  `);
        await page.locator('#cafe-note-save').click();
        await page.locator('#cafe-note-dialog:not([open])').waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {});
        held = await until(async () => { const now = await onServer(second.id); return now.note === NOTE ? now : null; }, { timeout: 45_000 });
        check('a note on the page is held by the tablet\'s own record and by the server, with the rating untouched',
            (await tablet()).espressoNotes === NOTE && (await tablet()).enjoyment === 10 && held?.rating === 10, `tablet ${JSON.stringify(await tablet())} server ${JSON.stringify(held || await onServer(second.id))}`);

        //    A rating and a note given to the Reference Shot on the server reach
        //    the open page.
        await sync('PATCH', `/shots/${first.id}`, { rating: 7, note: 'The one to match.' });
        const pushed = await until(async () => { const now = await remarks(page); return now.referenceRating ? now : null; }, { timeout: 10_000, every: 300 });
        check('a rating and a note given to the Reference Shot on the server show on its row, on the open page', pushed?.referenceRating === '★ 3.5' && pushed.referenceNote === true, JSON.stringify(pushed || await remarks(page)));
    }

    // 4. A reference chosen on the server arrives on the open page.
    const loads = seen.loads;
    await setReference(house, second.id);
    let now = await waitLegend(page, l => l.badge !== null);
    check('a Shot chosen on the server becomes the reference on the open page, with no reload', now?.badge === 'This shot is the reference' && seen.loads === loads, JSON.stringify(now || await legend(page)));
    //    The first Shot the reference again, behind the latest, for step 5.
    await setReference(house, first.id);
    await waitLegend(page, l => l.reference !== null);

    //    A rename on the server reaches DYE2's record, by the plugin's Library
    //    sync, and so the page's title band.
    const titled = name => until(async () => ((await page.locator('#cafe-title').textContent()) === name || null), { timeout: 60_000, every: 500 });
    await sync('PATCH', `/recipes/${house.id}`, { content: { name: `${house.name} two` } });
    const renamed = await titled(`${house.name} two`);
    await sync('PATCH', `/recipes/${house.id}`, { content: { name: house.name } });
    const namedBack = await titled(house.name);
    check('a Recipe renamed on the server, then named back, shows each name in the title band, with no reload', !!renamed && !!namedBack && seen.loads === loads,
        `${renamed ? 'renamed' : 'never renamed'}, ${namedBack ? 'named back' : `still "${await page.locator('#cafe-title').textContent()}"`}`);

    // 5. With the server stopped: the tablet's copy, and the catch-up.
    await docker('stop', SYNC_CONTAINER);
    stopped = true;
    now = await waitLegend(page, l => l.notice !== null, 60_000);
    const lines = await chartLines(page);
    check('with the server stopped the tablet\'s copy of the Reference Shot is drawn', !!now && now.reference !== null && lines.points[7] > 10 && seen.loads === loads, JSON.stringify(now || await legend(page)));

    //    The server comes back: the reference is the server's again, and can be changed.
    await docker('start', SYNC_CONTAINER);
    stopped = false;
    now = await waitLegend(page, l => l.notice === null && l.make !== null && !l.muted, 120_000);
    check('with the server back the reference can be changed again, with no reload', !!now && now.reference !== null && seen.loads === loads, JSON.stringify(now || await legend(page)));

    // 6. A Capture-only Machine: the dial-in is not saved to the recipe, and
    //    its reference stays on the tablet.
    await sync('PUT', `/machines/${machine.id}/sharing`, { sharing: false });
    sharingOff = machine.id;
    await until(async () => (await plugin('status').catch(error => error)).message?.includes('Capture-only'), { timeout: 30_000 });
    await load(page, other);
    await load(page, house); // a recipe load asks the status again
    await page.locator('#cafe-dial-label').filter({ hasText: /^Dial-in · not saved to the recipe$/ }).waitFor({ timeout: 30_000 }).catch(() => {});
    check('a Machine that turns Capture-only reads "Dial-in · not saved to the recipe" at the next recipe load', (await label(page)) === 'Dial-in · not saved to the recipe', await label(page));
    await page.locator('#cafe-make-reference').click();
    await page.locator('#cafe-reference-dialog-replace').click({ timeout: 5000 }).catch(() => {});
    //    The tap made on the page (kept on the tablet, as sync-capture-only.spec
    //    checks in full), so the server's Reference Shot unchanged is the plugin's doing.
    const madeThere = await waitLegend(page, l => l.badge !== null);
    check('there Make reference keeps the choice on the tablet', !!madeThere && (await decaid('GET', REFERENCES))?.[house.recordId] === second.id, JSON.stringify(await decaid('GET', REFERENCES)));
    check('and leaves the server\'s Reference Shot as it was', (await referenceOnServer(house)) === first.id, await referenceOnServer(house));

    //    Served again.
    await sync('PUT', `/machines/${machine.id}/sharing`, { sharing: true });
    sharingOff = null;
    await until(async () => (await plugin('status')).served === true, { timeout: 30_000 });
    await load(page, other);
    await load(page, house);
    await page.locator('#cafe-dial-label').filter({ hasText: /^Dial-in · saved to the recipe$/ }).waitFor({ timeout: 30_000 }).catch(() => {});
    check('served again, the column reads "saved to the recipe"', (await label(page)) === 'Dial-in · saved to the recipe', await label(page));

    // 7. The Location's Shots (docs/cafe/DESIGN.md, "The Shots list"): a second
    //    Machine at the Location, with Shots of its own that reached the
    //    server as any tablet's do; the list, another Machine's Shot rated,
    //    noted and made a reference, and the server stopped.
    const secondUp = await decaid2('GET', '/plugins').then(() => true, () => false);
    check(`a second Decaid answers at ${DECAID_2}, for the second Machine`, secondUp, 'see "The second Machine" in docs/cafe/SMOKE.md');
    if (secondUp) {
        const two = await standUpSecond(location, house);
        check('a second Machine is at the sample Location, its tablet holding the Location\'s Recipes', (await decaid2('GET', `/plugins/${PLUGIN}/status`)).machine?.name === MACHINE_2 && two.machine.id !== machine.id);
        //     Its tablet: the same skin on the second Decaid. A recipe loaded
        //     there, a shot, and a two-second shot, which is Unfinished.
        const tablet2 = await openPage(await secondBrowser());
        await tablet2.page.locator('#cafe-strip .cafe-card').nth(house.slot - 1).filter({ hasText: house.name }).waitFor({ timeout: 60_000 });
        await load(tablet2.page, house);
        const theirs = await shotWith(tablet2.page, two.recordId, 9, 'Second Barista', decaid2);
        const before = (await decaid2('GET', '/shots?limit=1')).items?.[0]?.id;
        await pullShot(2, decaid2);
        const brief = await until(async () => { const newest = (await decaid2('GET', '/shots?limit=1')).items?.[0]; return newest && newest.id !== before ? newest : null; }, { timeout: 30_000 });
        check('the second tablet runs the skin, and pulled a Shot and an Unfinished one with the Recipe loaded', !!theirs && !!brief && theirs.id !== brief.id && tablet2.seen.errors.length === 0, tablet2.seen.errors.join(' | '));
        await tablet2.close();
        //     Both reach the server, and the first tablet's plugin lists them.
        const listedByPlugin = await until(async () => {
            const { shots } = await plugin('shots?limit=50');
            const found = [theirs.id, brief.id].map(id => shots.find(s => s.id === id));
            return found.every(Boolean) ? found : null;
        }, { timeout: 90_000, every: 1000 });
        check('the second Machine\'s Shots reached the server the way a tablet\'s do, and the plugin lists them as another Machine\'s',
            !!listedByPlugin && listedByPlugin.every(s => s.machine.name === MACHINE_2 && s.onThisTablet === false) && listedByPlugin[0].unfinished === false && listedByPlugin[1].unfinished === true, JSON.stringify(listedByPlugin));
        check('and Decaid on the first tablet holds neither', (await decaid('GET', `/shots/${theirs.id}`).catch(() => null)) === null);

        //     The list on the first tablet: the Location's, through the plugin.
        await load(page, house);
        await openList(page);
        let shown = await listRows(page);
        const rowOf = id => shown.find(r => r.id === id);
        check('the first tablet\'s list shows the other Machine\'s Shot, naming its Machine', rowOf(theirs.id)?.machine === MACHINE_2, JSON.stringify(rowOf(theirs.id)));

        //     Another Machine's Shot, opened, rated and noted on the first
        //     tablet: the server has each edit, and writes it into the Shot on
        //     the tablet that holds it.
        await openRow(page, theirs.id, l => l.label === 'Viewing' && /Second Barista$/.test(l.when || ''));
        await page.locator('#cafe-stars .cafe-star').nth(3).click();
        let held = await until(async () => { const at = await onServer(theirs.id); return at.rating === 8 ? at : null; }, { timeout: 45_000 });
        check('a rating given to another Machine\'s Shot on this tablet is held by the server', held?.rating === 8, JSON.stringify(held || await onServer(theirs.id)));
        const NOTE_2 = 'Pulled on the other machine.\nA touch fast.';
        await page.locator('#cafe-shot-note').click();
        await page.locator('#cafe-note-text').fill(NOTE_2);
        await page.locator('#cafe-note-save').click();
        await page.locator('#cafe-note-dialog:not([open])').waitFor({ state: 'attached', timeout: 15_000 }).catch(() => {});
        held = await until(async () => { const at = await onServer(theirs.id); return at.note === NOTE_2 ? at : null; }, { timeout: 45_000 });
        check('and its note too, with the rating untouched', held?.note === NOTE_2 && held.rating === 8, JSON.stringify(held || await onServer(theirs.id)));
        const theirTablet = await until(async () => { const a = (await decaid2('GET', `/shots/${theirs.id}`)).annotations || {}; return a.enjoyment === 8 && a.espressoNotes === NOTE_2 ? a : null; }, { timeout: 60_000, every: 1000 });
        check('the server writes the edit into the Shot on the tablet that holds it', !!theirTablet, JSON.stringify((await decaid2('GET', `/shots/${theirs.id}`)).annotations));

        //     Make reference on it sets its own recipe's Reference Shot.
        await page.locator('#cafe-make-reference').click();
        await page.locator('#cafe-reference-dialog-replace').click({ timeout: 5000 }).catch(() => {});
        await waitLegend(page, l => l.badge !== null);
        check('Make reference on another Machine\'s Shot makes it its recipe\'s Reference Shot on the server', (await referenceOnServer(house)) === theirs.id, `${await referenceOnServer(house)} for ${theirs.id}`);
        //     Put back, and back to the latest.
        await setReference(house, first.id);
        await page.locator('#cafe-back').click();
        await waitLegend(page, l => l.label === 'Latest');

        //     The server stopped: the list is this machine's own.
        await docker('stop', SYNC_CONTAINER);
        stopped = true;
        await waitLegend(page, l => l.notice !== null, 60_000);
        await openList(page);
        let header = await shotsHeader(page);
        shown = await listRows(page);
        check('with the server stopped the list falls back to this machine\'s Shots only', header.under === 'This machine only' && shown.length > 0 && !rowOf(theirs.id),
            `${JSON.stringify(header)} ${shown.length} rows`);
        await closeList(page);

        //     The server back: the Location's list again.
        await docker('start', SYNC_CONTAINER);
        stopped = false;
        await until(async () => (await plugin('status')).served === true, { timeout: 120_000, every: 1000 });
        header = await until(async () => {
            await openList(page);
            const at = await shotsHeader(page);
            if (at.under === LOCATION) return at;
            await closeList(page);
            await page.waitForTimeout(3000);
            return null;
        }, { timeout: 120_000, every: 500 });
        check('with the server back the list is the Location\'s again, with no reload', header?.under === LOCATION && seen.loads === loads, JSON.stringify(header));
        await closeList(page);

        await grinderWithDecentSync({ page, house });
        await beanAndBasketWithDecentSync({ page, house, location });
        await unloadWithDecentSync({ house, two, machine });
        await profileWithDecentSync({ page, house, two });
        await profileDialogWithDecentSync({ page, house, two });
    }

    check('no page error with Decent Sync', seen.errors.length === 0, seen.errors.join(' | '));
    await close();
} catch (error) {
    check(`the run finished (${error.message.split('\n')[0]})`, false);
    // Where it stopped, and what the pages showed then.
    console.log(error.stack);
    const pages = browser.contexts().flatMap(context => context.pages());
    for (const [index, open] of pages.entries()) await open.screenshot({ path: join(OUT, `sync-failed-${index}.png`) }).catch(() => {});
} finally {
    // Leave the server running and the Machine sharing, whatever failed.
    if (stopped) await docker('start', SYNC_CONTAINER).catch(() => {});
    if (sharingOff) await sync('PUT', `/machines/${sharingOff}/sharing`, { sharing: true }).catch(() => {});
    await decaid('PUT', '/workflow', { context: { baristaName: null } }).catch(() => {});
    await decaid2('PUT', '/workflow', { context: { baristaName: null } }).catch(() => {});
    await browser.close();
    if (browser2) await browser2.close();
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(failed.length ? 1 : 0);
