// Streamline Cafe's smoke run: the real page in a real Chromium against a real
// Decaid with a simulated machine. Run by hand before a release, not in CI.
// How to set Decaid up, and what this covers, is in docs/cafe/SMOKE.md.
//
//   node test/cafe-smoke/run.mjs --token=<Decaid's extensions token>
//   node test/cafe-smoke/run.mjs --token=... --base=http://127.0.0.1:13999 --decaid=http://127.0.0.1:8080
//   node test/cafe-smoke/run.mjs --token=... --headed
//   node test/cafe-smoke/run.mjs --token=... --streamline=http://127.0.0.1:13998
//   node test/cafe-smoke/run.mjs --token=... --timezone=Europe/Berlin   (the container's zone, UTC by default)
//   node test/cafe-smoke/run.mjs --token=... --only=preheat   (step 26 alone, after a whole run)
//   node test/cafe-smoke/run.mjs --token=... --only=profile-dialog   (step 27 alone, after a whole run)
//   node test/cafe-smoke/run.mjs --token=... --only=labels   (step 28 alone, after a whole run)
//
// It changes the Decaid it is pointed at: it installs or enables DYE2 if it
// must, turns Streamline's "DYE2 on" setting on, writes made-up beans, grinders
// and recipes, moves recipes between slots from the page, changes the language,
// sets the barista, and pulls simulated shots. Point it at a throwaway Decaid only.

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BEANS, GRINDER, SECOND_GRINDER, ARCHIVED_GRINDER, RECIPES, MORE_BATCHES, BASKETS } from './sample-data.mjs';
import { sleep, decaidClient, paint, legend, chartLines, countDraws, row, keys, stageNames, REFERENCE_LINES } from './page-helpers.mjs';
import { MIN_DYE2_VERSION, DYE2_PLUGIN_ID } from '../../src/cafe/dye2-gate.js';
import { compareVersions } from '../../src/modules/skin-version.js';
import { SUPPORTED_LANGUAGES } from '../../src/modules/i18n-parser.js';

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
// Official Streamline, served beside the skin, for the switch there and back.
const STREAMLINE = flag('streamline', '');
const HEADED = args.includes('--headed');
// Decaid writes a Shot's time as its own local time, with no offset, and the
// page reads it in the browser's. On a tablet the two are one clock; here the
// browser is put in the container's zone, which is UTC unless it was given another.
const TIMEZONE = flag('timezone', 'UTC');
// One step alone, by name, on a Decaid a whole run has already set up.
const ONLY = flag('only', '');
const API = `${DECAID}/api/v1`;
const SETTING = `${API}/store/streamlineSettings/streamline.dye2Enabled`;
const STRIP_MODE = '/store/streamlineSettings/streamline.dyeStripMode';
// The cafe page's own state: the choice of reference, and the graph's view.
const REFERENCES = '/store/streamlineCafe/references';
const GRAPH_VIEW = '/store/streamlineCafe/graphView';
const RECIPE_STORE = `/store/${DYE2_PLUGIN_ID}/recipes`;


// ── Results ──────────────────────────────────────────────────────────────────

const results = [];
function check(name, ok, detail = '') {
    results.push({ name, ok: !!ok });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const note = text => console.log(`     ${text}`);

// ── Decaid ───────────────────────────────────────────────────────────────────

const decaid = decaidClient(API, TOKEN);
const dye2 = async () => (await decaid('GET', '/plugins')).find(p => p.id === DYE2_PLUGIN_ID) || null;
const setSetting = on => fetch(SETTING, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(on ? 'true' : 'false') });

// Beans, a grinder and recipes, all made up. DYE2 makes each recipe itself, from
// the Workflow the run sets first, so the records have the shape DYE2 writes.
async function seed() {
    const recipesNow = (await decaid('GET', `/store/${DYE2_PLUGIN_ID}/recipes`)) || [];
    if (RECIPES.every(r => recipesNow.some(row => row && row.name === r.name))) {
        note('the sample recipes are already there');
        // A Decaid seeded before the bean and basket dialogs has no second
        // batch and no baskets with ids, which the second run chooses.
        await beanAndBasketFixtures();
        return;
    }
    const profiles = await decaid('GET', '/profiles');
    const batches = {};
    for (const bean of BEANS) {
        const made = await decaid('POST', '/beans', { roaster: bean.roaster, name: bean.name });
        const batch = await decaid('POST', `/beans/${made.id}/batches`, { roastDate: bean.roastDate });
        batches[bean.name] = { id: batch.id, roaster: bean.roaster };
    }
    await beanAndBasketFixtures();
    const grinder = await decaid('POST', '/grinders', GRINDER);
    const ids = {};
    const basketNamed = name => BASKETS.find(basket => basket.name === name);
    for (const recipe of RECIPES) {
        const profile = profiles.find(p => p.profile?.title === recipe.profile)?.profile;
        if (!profile) throw new Error(`Decaid has no profile titled "${recipe.profile}"`);
        await decaid('PUT', '/workflow', {
            profile,
            context: {
                targetDoseWeight: recipe.dose, targetYield: recipe.yield,
                coffeeName: recipe.bean, coffeeRoaster: batches[recipe.bean].roaster, beanBatchId: batches[recipe.bean].id,
                grinderId: grinder.id, grinderModel: grinder.model, grinderSetting: recipe.grind,
                extras: { basketId: basketNamed(recipe.basket)?.id || null, basketName: recipe.basket || null },
            },
        });
        const saved = await decaid('POST', `/plugins/${DYE2_PLUGIN_ID}/save-recipe`, recipe.slot <= 5 ? { slot: recipe.slot } : {});
        ids[saved.id] = recipe;
    }
    // The names, and the slots above 5, which DYE2's own pages cannot set. This
    // is the fixture's write, not the skin's: the skin's own writer is checked
    // further down, from a held empty slot.
    const rows = await decaid('GET', `/store/${DYE2_PLUGIN_ID}/recipes`);
    const next = rows.map(row => (ids[row.id]
        ? { ...row, name: ids[row.id].name, title: ids[row.id].name, stripSlot: ids[row.id].slot, showOnStreamlineDashboard: true }
        : row));
    await decaid('POST', `/store/${DYE2_PLUGIN_ID}/recipes`, next);
    note(`seeded ${RECIPES.length} recipes`);
}

// The bean and batch dialog's batches, and DYE2's baskets with ids, where they
// are missing: the seed makes them, on a fresh Decaid and on one seeded before
// they were added. DYE2's basket list is the fixture's write, as DYE2's
// own basket page would make it; the skin writes no basket.
async function beanAndBasketFixtures() {
    const beans = await decaid('GET', '/beans?includeArchived=true');
    for (const extra of MORE_BATCHES) {
        const bean = (Array.isArray(beans) ? beans : beans.items || []).find(b => b && b.name === extra.bean);
        if (!bean) continue; // the seed makes the beans before it asks for these
        const batches = await decaid('GET', `/beans/${bean.id}/batches?includeArchived=true`);
        const list = Array.isArray(batches) ? batches : batches.items || [];
        if (list.some(batch => batch && String(batch.roastDate || '').slice(0, 10) === extra.roastDate.slice(0, 10))) continue;
        const made = await decaid('POST', `/beans/${bean.id}/batches`, { roastDate: extra.roastDate });
        if (extra.archived) await decaid('PUT', `/bean-batches/${made.id}`, { ...made, archived: true });
    }
    const baskets = (await decaid('GET', `/store/${DYE2_PLUGIN_ID}/baskets`)) || [];
    const missing = BASKETS.filter(basket => !(Array.isArray(baskets) ? baskets : []).some(row => row && row.id === basket.id));
    if (missing.length) await decaid('POST', `/store/${DYE2_PLUGIN_ID}/baskets`, [...(Array.isArray(baskets) ? baskets : []), ...missing]);
}

const unloadRecipe = () => decaid('POST', `/plugins/${DYE2_PLUGIN_ID}/selection`, {});
const records = async () => (await decaid('GET', RECIPE_STORE)) || [];
const recordNamed = async name => (await records()).find(row => row && row.name === name);
const storeValue = path => decaid('GET', path).catch(() => null);

// A time as Decaid writes it: the container's local time with no offset.
function decaidTime(date) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
        .formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.000`;
}
async function pullShot(seconds) {
    await decaid('PUT', '/machine/state/espresso');
    await sleep(seconds * 1000);
    await decaid('PUT', '/machine/state/idle');
}

// ── Browser ──────────────────────────────────────────────────────────────────

// The page calls Decaid on port 8080 of the host that served it. A Decaid
// given elsewhere with --decaid= is reached by mapping that address to it in
// the browser, so runs from two checkouts can each have a Decaid of their own.
const PAGE_DECAID = `${new URL(BASE).hostname}:8080`;
const mapTo = host => (host === PAGE_DECAID ? [] : [`--host-resolver-rules=MAP ${PAGE_DECAID} ${host}`]);
const browser = await chromium.launch({ headless: !HEADED, args: mapTo(new URL(DECAID).host) });
// A page with nothing in its own storage.
//
// `machine`: a `machineFeed()` the page's machine socket goes through, for a
// Preheat longer than the simulated machine's (step 26).
async function openPage({ theme = 'light', viewport = { width: 1920, height: 1200 }, machine = null } = {}) {
    const context = await browser.newContext({ viewport, timezoneId: TIMEZONE });
    const page = await context.newPage();
    const seen = { errors: [], requests: [], theme };
    page.on('pageerror', error => seen.errors.push(error.message));
    page.on('request', request => seen.requests.push(`${request.method()} ${new URL(request.url()).pathname}`));
    if (machine) await page.routeWebSocket(/\/ws\/v1\/machine\/snapshot$/, socket => machine.attach(socket));
    await page.goto(`${BASE}/index.html`);
    return { page, seen, close: () => context.close() };
}

const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });
const FINISHED_LANGUAGES = SUPPORTED_LANGUAGES.filter(code => code !== 'en' && !code.includes('unfinished'));

async function waitForPage(page, theme = 'light') {
    await page.locator('#cafe-strip .cafe-card').first().waitFor({ timeout: 20_000 });
    await paint(page, theme);
}

// Press a card and keep it pressed past Streamline's half second, as a finger
// does. The page may be on its way to DYE2 by the time the press is let go.
async function longPress(page, locator) {
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(900);
    await page.mouse.up().catch(() => {});
}
// The menu a long-press opens on a card, and the list a recipe is chosen from
// (step 14 arranges the strip).
const menu = page => page.locator('#app-context-menu.context-menu--open');
async function openMenu(page, slot) {
    await longPress(page, page.locator('#cafe-strip .cafe-card').nth(slot - 1));
    await menu(page).waitFor({ timeout: 5000 });
    await page.waitForTimeout(400);
}
// Pick a menu item by its place, and let the page write and read again.
async function pick(page, index) {
    await menu(page).locator('.context-menu__item').nth(index).click();
    await page.waitForTimeout(3500);
}
const dialog = page => page.locator('#cafe-recipe-dialog[open]');
const cardName = (page, slot) => page.locator('#cafe-strip .cafe-card').nth(slot - 1).locator('.cafe-card-name').textContent();
// The Settings page's language list calls this same function.
const setLanguage = (page, language) => page.evaluate(async code => {
    const { setLanguage: set } = await import('/src/modules/i18n.js');
    await set(code);
}, language);
const REST_REFERENCE = 'time firstDrip yield ratio peak';
const LIVE = 'time weight weightFlow flow pressure temperature';
// The recipe a DYE2 selection names as loaded, or null for none: no marker, or
// a `recent:` favourite DYE2 matched the Workflow against.
const loadedRecipeId = selection => (selection?.kind === 'recipe' ? selection.id ?? null : null);


// ── The grinder dialog ───────────────────────────────────────────────────────

const pickDialog = page => page.locator('#cafe-pick-dialog[open]');
// Closed, and its fade over: a tap during the fade lands on the dialog.
const pickClosed = page => page.locator('#cafe-pick-dialog:not([open])').waitFor({ state: 'attached', timeout: 5000 })
    .then(() => page.waitForTimeout(600)).then(() => true, () => false);
// A tap where a finger would land: on the row's name, or on the grinder's name
// under it. The two sit inside one button and take no pointer events
// themselves, so the tap is made at their place, not on them.
async function tapAt(page, selector) {
    const box = await page.locator(selector).boundingBox();
    await page.mouse.click(box.x + Math.min(box.width / 2, 40), box.y + box.height / 2);
}

// 19. A short touchscreen and the soft keyboard, 20. the dialogs at a tablet's
//     size, 21. the Grind row's number, 22. the bean and batch dialog and the
//     basket dialog, 23. the barista at the machine and 25. the profile changed
//     from the page are page tests now (test/page/: touch-keyboard,
//     dialog-sizes, grind-row, bean-basket-dialogs, barista and profile-change).

const grinderNamed = (grinders, model) => grinders.find(g => g && g.model === model) || null;

// 18. The grinder dialog is a page test now (test/page/grinder-dialog.spec.mjs).
//     Its grinders stay: the second run chooses the second one.
async function grinderFixtures() {
    const listed = await decaid('GET', '/grinders?includeArchived=true');
    const grinders = Array.isArray(listed) ? listed : listed.items || [];
    if (!grinderNamed(grinders, SECOND_GRINDER.model)) await decaid('POST', '/grinders', SECOND_GRINDER);
    const retired = grinderNamed(grinders, ARCHIVED_GRINDER.model) || await decaid('POST', '/grinders', ARCHIVED_GRINDER);
    if (!retired.archived) await decaid('PUT', `/grinders/${retired.id}`, { ...retired, archived: true });
}

// 24. A tap on the loaded card unloads it is a page test now
//     (test/page/unload-tap.spec.mjs).

// The simulated machine's Workflow reports a flush at 90 °C, whatever its
// settings hold, and the sample recipes hold 25 °C, so DYE2 calls every recipe
// changed the moment it loads. The loaded recipe's record is given the steam,
// hot water and flush the Workflow reports (the fixture's write), so that "not
// called changed" after a profile change says something.
const MACHINE_FIELDS = { steamTempC: ['steamSettings', 'targetTemperature'], steamTimeS: ['steamSettings', 'duration'], steamFlowMls: ['steamSettings', 'flow'], steamStopAtTempC: ['steamSettings', 'stopAtTemperature'], hotWaterTempC: ['hotWaterData', 'targetTemperature'], hotWaterTimeS: ['hotWaterData', 'duration'], hotWaterMl: ['hotWaterData', 'volume'], hotWaterFlowMls: ['hotWaterData', 'flow'], flushTempC: ['rinseData', 'targetTemperature'], flushS: ['rinseData', 'duration'], flushFlowMls: ['rinseData', 'flow'] };
async function matchMachine(name) {
    const machineNow = await decaid('GET', '/workflow');
    await decaid('POST', RECIPE_STORE, (await records()).map(row => {
        if (!row || row.name !== name) return row;
        const dashboardVariables = { ...row.dashboardVariables };
        for (const [key, [group, field]] of Object.entries(MACHINE_FIELDS)) {
            if (dashboardVariables[key] != null && machineNow[group]?.[field] != null) dashboardVariables[key] = machineNow[group][field];
        }
        return { ...row, dashboardVariables };
    }));
}
// ── The graph goes live at the Preheat (#64) ─────────────────────────────────

// The page's machine socket, through the run. The simulated machine's Preheat
// lasts about half a second, too short to stop a shot in or to reload a page
// during, so the run makes it longer as the page sees it:
// - `pass()`: Decaid's frames as they come;
// - `hold()`: Decaid's frames, with an `espresso` frame's substate given as
//   `preparingForShot`, so the pour Decaid is running is a Preheat to the page
//   until `pass()`, when the page sees the profile start;
// - `drop()`: Decaid's frames without its Preheat, for a shot with none;
// - `fake(state, substate)`: none of Decaid's frames, but its last one sent ten
//   times a second in that state, so the page sees a Preheat, or its end, with
//   no shot pulled.
function machineFeed() {
    let mode = 'pass';
    let last = null;
    let timer = null;
    const pages = new Set();
    const stamp = date => decaidTime(date).replace('.000', `.${String(date.getMilliseconds()).padStart(3, '0')}`);
    const send = frame => { for (const socket of pages) { try { socket.send(JSON.stringify(frame)); } catch { /* the page went */ } } };
    const stopFaking = () => { clearInterval(timer); timer = null; };
    return {
        attach(socket) {
            const server = socket.connectToServer();
            pages.add(socket);
            socket.onClose(() => pages.delete(socket));
            socket.onMessage(message => server.send(message));
            server.onMessage(message => {
                const frame = JSON.parse(message);
                last = frame;
                if (typeof mode === 'object') return;
                if (mode === 'drop' && frame.state?.substate === 'preparingForShot') return;
                if (mode === 'hold' && frame.state?.state === 'espresso') frame.state = { ...frame.state, substate: 'preparingForShot' };
                try { socket.send(JSON.stringify(frame)); } catch { /* the page went */ }
            });
        },
        pass() { stopFaking(); mode = 'pass'; },
        hold() { stopFaking(); mode = 'hold'; },
        drop() { stopFaking(); mode = 'drop'; },
        fake(state, substate) {
            stopFaking();
            mode = { state, substate };
            const tick = () => { if (last) send({ ...last, timestamp: stamp(new Date()), state: { state, substate }, flow: 0, pressure: 0, profileFrame: 0 }); };
            tick();
            timer = setInterval(tick, 100);
        },
    };
}

// The chart's own lines, which are not the reference's, and where its time
// axis ends; each own line's first time, for the first sample's place.
const ownLines = async (page, id = 'plotly-chart') => {
    const lines = await chartLines(page, id);
    if (!lines) return null;
    const own = lines.names.map((name, index) => ({ name, points: lines.points[index] })).filter(line => !REFERENCE_LINES.includes(line.name));
    const reference = lines.names.map((name, index) => ({ name, points: lines.points[index] })).filter(line => REFERENCE_LINES.includes(line.name));
    return { end: lines.end, own: own.reduce((sum, line) => sum + line.points, 0), reference: reference.reduce((sum, line) => sum + line.points, 0), referenceEnd: lines.referenceEnd, names: lines.names, points: lines.points };
};
const firstTime = (page, name) => page.evaluate(async lineName => {
    const { echarts } = await import('/src/modules/echarts-streamline.min.js');
    const chart = echarts.getInstanceByDom(document.getElementById('plotly-chart'));
    const line = chart?.getOption().series.find(series => series && String(series.id).startsWith('trace-') && series.name === lineName);
    return line && line.data.length ? line.data[0][0] : null;
}, name);
// Where a chart's time axis starts and ends as drawn, fitted or not.
const axisExtent = (page, id = 'plotly-chart') => page.evaluate(async chartId => {
    const { echarts } = await import('/src/modules/echarts-streamline.min.js');
    const chart = echarts.getInstanceByDom(document.getElementById(chartId));
    return chart ? chart.getModel().getComponent('xAxis', 0).axis.scale.getExtent() : null;
}, id);
// The live axis's end for a reference of `seconds`, as the overlay sets it: on
// the main graph the reference's length, as at rest (issue #66), and on the
// full-screen chart Streamline's live fraction past it.
const liveEnd = (seconds, chart = 'main') => (chart === 'main' ? seconds : seconds / 0.93);
const near = (a, b, within = 0.05) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= within;

// 26. The graph goes live at the Preheat, issue #64 (docs/cafe/DESIGN.md, "When
//     the graph goes live"): with a recipe loaded, whose latest Shot is drawn
//     against its reference, the Preheat empties the graph of the latest's
//     lines and stage names, on the main graph and the full-screen chart, in
//     Reference with the reference behind it on the live axis and in Targets
//     with nothing; the legend reads "Live shot" and the six live cards have no
//     values but a time of zero. A shot stopped in the Preheat puts back the
//     latest, its stage names and the five cards, and so it does with no recipe
//     loaded, as "Last shot". A page opened during a Preheat is live. A real
//     shot with a long Preheat draws its first sample at the profile's start,
//     at time zero, with the axis where the Preheat had it; and a shot with no
//     Preheat frame goes live and draws as before.
async function preheatLive() {
    const house = RECIPES[0];
    const pulled = [];
    const newestId = async () => (await decaid('GET', '/shots?limit=1')).items?.[0]?.id ?? null;
    // A shot pulled with the recipe, through the page's feed as it is set.
    const pull = async (seconds, during = null) => {
        const before = await newestId();
        await decaid('PUT', '/machine/state/espresso');
        if (during) await during();
        await sleep(seconds * 1000);
        await decaid('PUT', '/machine/state/idle');
        for (let waited = 0; waited < 30_000 && (await newestId()) === before; waited += 1000) await sleep(1000);
        const id = await newestId();
        if (id && id !== before) pulled.push(id);
        await sleep(5000);
        return id && id !== before ? id : null;
    };
    const choicesBefore = await storeValue(REFERENCES);
    const viewBefore = await storeValue(GRAPH_VIEW);
    await decaid('PUT', '/machine/state/idle').catch(() => {});
    await decaid('POST', GRAPH_VIEW, 'reference');
    const feed = machineFeed();
    let view = await openPage({ machine: feed });
    let { page, seen } = view;
    try {
        await waitForPage(page);
        const card = recipe => page.locator('#cafe-strip .cafe-card').nth(recipe.slot - 1);
        const record = await recordNamed(house.name);
        // Loaded, and two Shots with it: the first the reference, the second the latest.
        if (loadedRecipeId(await decaid('GET', `/plugins/${DYE2_PLUGIN_ID}/selection`)) !== record.id) {
            await card(house).click();
            await page.locator('#cafe-title').filter({ hasText: house.name }).waitFor({ timeout: 20_000 });
            await page.waitForTimeout(3000);
        }
        const first = await pull(8);
        const second = await pull(8);
        check('preheat: two shots were pulled with the recipe', !!first && !!second);
        await decaid('POST', REFERENCES, { ...(choicesBefore || {}), [record.id]: first });
        await view.close();
        view = await openPage({ machine: feed });
        ({ page, seen } = view);
        await waitForPage(page);
        await page.locator('#cafe-title').filter({ hasText: house.name }).waitFor({ timeout: 20_000 });
        await page.waitForTimeout(4000);

        // At rest: the latest against the reference.
        const rest = { legend: await legend(page), lines: await ownLines(page), stages: await stageNames(page), row: await row(page) };
        check('preheat: at rest the latest is drawn against the reference, with its stage names and the five cards',
            rest.legend.label === 'Latest' && rest.legend.reference !== null && rest.lines.own > 10 && rest.lines.reference > 10 && rest.stages.some(Boolean) && rest.row.mode === 'rest' && keys(rest.row) === REST_REFERENCE,
            JSON.stringify({ legend: rest.legend, stages: rest.stages, lines: rest.lines, row: keys(rest.row) }));
        await shot(page, 'preheat-before-light');

        // The Preheat.
        feed.fake('espresso', 'preparingForShot');
        await page.waitForTimeout(1500);
        let now = { legend: await legend(page), lines: await ownLines(page), stages: await stageNames(page), row: await row(page) };
        check('preheat, in Reference: the latest\'s lines leave the graph and the reference stays behind it', now.lines.own === 0 && now.lines.reference > 10, JSON.stringify(now.lines));
        check('preheat, in Reference: the stage lines and their names leave with it', now.stages.length === 0, JSON.stringify(now.stages));
        check('preheat, in Reference: the time axis is the live one, at the reference\'s length', near(now.lines.end, liveEnd(now.lines.referenceEnd)), `${now.lines.end} for a reference of ${now.lines.referenceEnd} s`);
        check('preheat: the legend reads "Live shot", with the reference\'s row', now.legend.label === 'Live shot' && now.legend.reference !== null && now.legend.make === null, JSON.stringify(now.legend));
        check('preheat: the six live cards, with no values and a time of zero',
            now.row.mode === 'live' && keys(now.row) === LIVE && now.row.cards[0].value === '0.0 s' && now.row.cards.slice(1).every(c => c.value === '—') && now.row.cards.every(c => c.diff === ''), JSON.stringify(now.row.cards));
        await shot(page, 'preheat-reference-light');
        const preheatEnd = now.lines.end;
        await page.locator('#plotly-chart').click();
        await page.locator('#main-page.chart-zoomed').waitFor({ timeout: 10_000 });
        await page.waitForTimeout(1500);
        const zoomed = await ownLines(page, 'expanded-chart');
        check('preheat, on the full-screen chart: nothing of the latest, the reference behind', zoomed.own === 0 && zoomed.reference > 10, JSON.stringify(zoomed));
        await shot(page, 'preheat-full-screen-light');
        await page.locator('#expanded-chart').click();
        await page.waitForTimeout(1000);
        await page.locator('#cafe-view button[data-view="targets"]').click();
        await page.waitForTimeout(800);
        now = { lines: await ownLines(page), stages: await stageNames(page), row: await row(page) };
        check('preheat, in Targets: nothing on the graph', now.lines.own === 0 && now.lines.reference === 0 && now.stages.length === 0, JSON.stringify({ lines: now.lines, stages: now.stages }));
        const targetsAxis = await axisExtent(page);
        check('preheat, in Targets: the time axis starts at zero and runs a second', JSON.stringify(targetsAxis) === '[0,1]', JSON.stringify(targetsAxis));
        check('preheat, in Targets: the six live cards, with no values and a time of zero', now.row.mode === 'live' && now.row.cards[0].value === '0.0 s' && now.row.cards.slice(1).every(c => c.value === '—'), JSON.stringify(now.row.cards));
        await shot(page, 'preheat-targets-light');
        await page.locator('#cafe-view button[data-view="reference"]').click();
        await page.waitForTimeout(800);

        // Stopped in the Preheat.
        feed.fake('idle', 'idle');
        await page.waitForTimeout(1500);
        feed.pass();
        await page.waitForTimeout(1500);
        now = { legend: await legend(page), lines: await ownLines(page), stages: await stageNames(page), row: await row(page) };
        check('stopped in the Preheat: the latest is back, with its time, its lines and the reference\'s',
            now.legend.label === 'Latest' && now.legend.when === rest.legend.when && JSON.stringify(now.lines.points) === JSON.stringify(rest.lines.points) && near(now.lines.end, rest.lines.end, 0.01),
            JSON.stringify({ legend: now.legend, lines: now.lines, was: rest.lines }));
        check('stopped in the Preheat: its stage names are back', JSON.stringify(now.stages) === JSON.stringify(rest.stages), JSON.stringify(now.stages));
        check('stopped in the Preheat: the five cards at rest, as before', now.row.mode === 'rest' && JSON.stringify(now.row.cards) === JSON.stringify(rest.row.cards), JSON.stringify(now.row.cards));
        // Still the latest after the page looks again.
        await page.waitForTimeout(3000);
        check('stopped in the Preheat: still the latest a moment later', (await legend(page)).when === rest.legend.when && (await ownLines(page)).own === rest.lines.own);

        // The full-screen chart open when the Preheat starts, and when it stops, in both views.
        for (const graphView of ['reference', 'targets']) {
            await page.locator(`#cafe-view button[data-view="${graphView}"]`).click();
            await page.waitForTimeout(800);
            await page.locator('#plotly-chart').click();
            await page.locator('#main-page.chart-zoomed').waitFor({ timeout: 10_000 });
            await page.waitForTimeout(1500);
            const open = await ownLines(page, 'expanded-chart');
            feed.fake('espresso', 'preparingForShot');
            await page.waitForTimeout(1500);
            const heating = await ownLines(page, 'expanded-chart');
            const heatingAxis = await axisExtent(page, 'expanded-chart');
            check(`full-screen open as the Preheat starts, in ${graphView}: the latest's lines leave it${graphView === 'reference' ? ', the reference stays' : ''}, the axis from zero`,
                open.own > 10 && heating.own === 0 && (graphView === 'reference' ? heating.reference > 10 : heating.reference === 0) && heatingAxis?.[0] === 0,
                JSON.stringify({ open, heating, heatingAxis }));
            feed.fake('idle', 'idle');
            await page.waitForTimeout(1500);
            feed.pass();
            await page.waitForTimeout(2000);
            const back = await ownLines(page, 'expanded-chart');
            check(`full-screen open as the Preheat stops, in ${graphView}: the latest is back on it`, JSON.stringify(back.points) === JSON.stringify(open.points), JSON.stringify({ back, open }));
            await page.locator('#expanded-chart').click();
            await page.waitForTimeout(1000);
        }
        await page.locator('#cafe-view button[data-view="reference"]').click();
        await page.waitForTimeout(800);

        // A page opened during a Preheat.
        feed.fake('espresso', 'preparingForShot');
        await view.close();
        view = await openPage({ machine: feed });
        ({ page, seen } = view);
        await waitForPage(page);
        await page.waitForTimeout(5000);
        now = { legend: await legend(page), lines: await ownLines(page), row: await row(page) };
        check('a page opened during a Preheat is live: "Live shot", nothing of the latest, the live cards with a time of zero',
            now.legend.label === 'Live shot' && now.lines.own === 0 && now.lines.reference > 10 && now.row.mode === 'live' && now.row.cards[0].value === '0.0 s',
            JSON.stringify({ legend: now.legend, lines: now.lines, row: now.row.cards.map(c => c.value) }));
        await shot(page, 'preheat-reloaded-light');
        feed.fake('idle', 'idle');
        await page.waitForTimeout(1500);
        feed.pass();
        await page.waitForTimeout(2500);
        check('and its shot stopped in the Preheat puts the latest back', (await legend(page)).label === 'Latest' && (await legend(page)).when === rest.legend.when && (await ownLines(page)).own === rest.lines.own);

        // A real shot with a long Preheat: the profile starts when the hold ends.
        let atStart = null;
        feed.hold();
        const third = await pull(4, async () => {
            await page.waitForTimeout(2500);
            const held = await ownLines(page);
            check('a shot\'s long Preheat: nothing drawn, the axis the live one', held.own === 0 && near(held.end, preheatEnd), JSON.stringify(held));
            const draws = countDraws(page, 1500);
            feed.pass();
            await page.waitForTimeout(400);
            const ends = [];
            for (let i = 0; i < 4; i += 1) { ends.push((await ownLines(page)).end); await page.waitForTimeout(150); }
            atStart = { ends, first: await firstTime(page, 'Pressure'), legend: (await legend(page)).label, draws: await draws, own: (await ownLines(page)).own };
        });
        check('the profile starting: its first sample is drawn at time zero', atStart && atStart.own > 0 && typeof atStart.first === 'number' && atStart.first >= 0 && atStart.first < 0.5, JSON.stringify(atStart));
        check('the profile starting: the time axis stays where the Preheat had it', atStart && atStart.ends.every(end => near(end, preheatEnd)), JSON.stringify(atStart?.ends));
        check('the profile starting: still "Live shot", the frames appended', atStart && atStart.legend === 'Live shot' && atStart.draws.appended > 0, JSON.stringify(atStart));
        check('the shot with a long Preheat was saved', !!third);
        for (let waited = 0; waited < 20_000 && (await legend(page)).when === rest.legend.when; waited += 1000) await sleep(1000);
        check('and once saved it is the latest', (await legend(page)).label === 'Latest' && (await legend(page)).when !== rest.legend.when, JSON.stringify(await legend(page)));

        // The same in Targets: the axis starts at zero through the Preheat and the profile's start.
        await page.locator('#cafe-view button[data-view="targets"]').click();
        await page.waitForTimeout(800);
        let targetsStart = null;
        feed.hold();
        const fifth = await pull(4, async () => {
            await page.waitForTimeout(2500);
            const extents = [await axisExtent(page)];
            feed.pass();
            await page.waitForTimeout(100);
            for (let i = 0; i < 8; i += 1) { extents.push(await axisExtent(page)); await page.waitForTimeout(100); }
            targetsStart = { extents, own: (await ownLines(page)).own };
        });
        check('in Targets, through a long Preheat and the profile\'s start: the axis starts at zero, and its end only grows',
            targetsStart && targetsStart.own > 0 && targetsStart.extents.every(extent => extent && extent[0] === 0 && extent[1] >= 1)
            && targetsStart.extents.every((extent, i) => i === 0 || extent[1] >= targetsStart.extents[i - 1][1]),
            JSON.stringify(targetsStart));
        check('the shot in Targets was saved', !!fifth);
        await page.locator('#cafe-view button[data-view="reference"]').click();
        await page.waitForTimeout(800);

        // A shot with no Preheat frame.
        let noPreheat = null;
        feed.drop();
        const fourth = await pull(4, async () => {
            await page.waitForTimeout(1800);
            noPreheat = { legend: (await legend(page)).label, own: (await ownLines(page)).own, first: await firstTime(page, 'Pressure'), row: (await row(page)).mode };
        });
        feed.pass();
        check('a shot with no Preheat frame goes live and draws from time zero, as before', noPreheat && noPreheat.legend === 'Live shot' && noPreheat.own > 0 && noPreheat.first >= 0 && noPreheat.first < 0.5 && noPreheat.row === 'live', JSON.stringify(noPreheat));
        check('the shot with no Preheat frame was saved', !!fourth);
        check('preheat: no page error', seen.errors.length === 0, seen.errors.join(' | '));
        await view.close();

        // With no recipe loaded.
        await unloadRecipe();
        view = await openPage({ machine: feed });
        ({ page, seen } = view);
        await waitForPage(page);
        await page.waitForTimeout(5000);
        const last = { legend: await legend(page), lines: await ownLines(page), stages: await stageNames(page), row: await row(page) };
        check('no recipe, at rest: "Last shot" with its lines', last.legend.label === 'Last shot' && last.lines.own > 10, JSON.stringify(last.legend));
        feed.fake('espresso', 'preparingForShot');
        await page.waitForTimeout(1500);
        now = { legend: await legend(page), lines: await ownLines(page), stages: await stageNames(page), row: await row(page) };
        check('no recipe, the Preheat: "Live shot", nothing drawn, the live cards with a time of zero',
            now.legend.label === 'Live shot' && now.lines.own === 0 && now.stages.length === 0 && now.row.mode === 'live' && now.row.cards[0].value === '0.0 s', JSON.stringify({ legend: now.legend, lines: now.lines, row: now.row.cards.map(c => c.value) }));
        await shot(page, 'preheat-no-recipe-light');
        feed.fake('idle', 'idle');
        await page.waitForTimeout(1500);
        feed.pass();
        await page.waitForTimeout(2000);
        now = { legend: await legend(page), lines: await ownLines(page), stages: await stageNames(page), row: await row(page) };
        check('no recipe, stopped in the Preheat: "Last shot" is back, with its time, lines, stage names and cards',
            now.legend.label === 'Last shot' && now.legend.when === last.legend.when && JSON.stringify(now.lines.points) === JSON.stringify(last.lines.points)
            && JSON.stringify(now.stages) === JSON.stringify(last.stages) && now.row.mode === 'rest' && JSON.stringify(now.row.cards) === JSON.stringify(last.row.cards),
            JSON.stringify({ legend: now.legend, lines: now.lines.points, was: last.lines.points }));
        check('no recipe: no page error', seen.errors.length === 0, seen.errors.join(' | '));
    } finally {
        feed.pass();
        await view.close().catch(() => {});
        await decaid('PUT', '/machine/state/idle').catch(() => {});
        await decaid('POST', REFERENCES, choicesBefore || {}).catch(() => {});
        if (viewBefore !== null) await decaid('POST', GRAPH_VIEW, viewBefore).catch(() => {});
        await unloadRecipe().catch(() => {});
        for (const id of pulled) await decaid('DELETE', `/shots/${id}`).catch(() => {});
    }
}

// ── The profile dialog (#51) ────────────────────────────────────────────────

// What the dialog shows: its title and line, the list on the left, and the
// description on the right.
const profileDialogShown = page => page.evaluate(() => {
    const text = id => document.getElementById(id)?.textContent ?? null;
    const visible = id => { const element = document.getElementById(id); return !!element && !element.hidden && element.offsetParent !== null; };
    const notes = document.getElementById('cafe-pick-pane-text');
    return {
        title: text('cafe-pick-title'),
        under: text('cafe-pick-under'),
        heading: text('cafe-pick-side-heading'),
        rows: [...document.querySelectorAll('#cafe-pick-side .cafe-pick-side-row')].map(row => ({
            id: row.dataset.id,
            name: row.querySelector('.cafe-pick-row-name').textContent,
            detail: row.querySelector('.cafe-pick-row-detail').textContent,
            highlighted: row.getAttribute('aria-pressed') === 'true',
            inUse: !!row.querySelector('.cafe-pick-in-use'),
        })),
        listShown: visible('cafe-pick-list'),
        paneHeading: text('cafe-pick-pane-heading'),
        paneTitle: text('cafe-pick-pane-title'),
        byline: visible('cafe-pick-pane-byline') ? text('cafe-pick-pane-byline') : null,
        notes: notes?.textContent ?? null,
        notesHtml: notes?.innerHTML ?? null,
        notesScroll: notes ? { scroll: notes.scrollHeight, client: notes.clientHeight, overflow: getComputedStyle(notes).overflowY, whiteSpace: getComputedStyle(notes).whiteSpace } : null,
        inUse: visible('cafe-pick-pane-in-use'),
        use: visible('cafe-pick-pane-use') ? text('cafe-pick-pane-use') : null,
        useNote: visible('cafe-pick-pane-note') ? text('cafe-pick-pane-note') : null,
        box: (() => { const r = document.querySelector('#cafe-pick-dialog .cafe-pick-box').getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })(),
        window: [window.innerWidth, window.innerHeight],
    };
});
const profileRow = (page, id) => page.locator(`#cafe-pick-side .cafe-pick-side-row[data-id="${id}"]`);
const openProfiles = async (page, on = '#brew-section .cafe-row-name') => {
    await tapAt(page, on);
    return pickDialog(page).waitFor({ timeout: 10_000 }).then(() => page.waitForTimeout(500)).then(() => true, () => false);
};

// 27. The profile dialog (docs/cafe/DESIGN.md, "The profile dialog"): a tap on
//     the Brew row's name, or on the profile's under it, lists the profiles
//     Decaid shows, sorted by title, and opens on the profile in use with its
//     description; a tap on another row highlights it and writes nothing;
//     "Use this profile" changes the profile through #50's change, with a
//     recipe loaded, which stays loaded and holds the profile, and with none,
//     which changes this machine only. A hidden profile is not listed, and one
//     in use that is not listed still opens with its description. It is
//     checked at 1340 by 800 too.
async function profileDialog() {
    const house = RECIPES[0];
    const other = RECIPES[2];
    const selection = () => decaid('GET', `/plugins/${DYE2_PLUGIN_ID}/selection`);
    const loadedId = async () => loadedRecipeId(await selection());
    const visible = await decaid('GET', '/profiles');
    const byTitle = title => visible.find(p => p.profile?.title === title);
    const [light, gentle] = ['Best practice (light roast)', 'Gentle and sweet'].map(byTitle);
    const own = record => record.profile.steps[0].temperature;
    check('profile dialog: Decaid holds the profiles the step uses', !!light && !!gentle && !!byTitle(house.profile));
    if (!light || !gentle || !byTitle(house.profile)) return;
    // What the dialog should list: every profile Decaid shows, with steps, sorted by title.
    const listed = visible.filter(p => p.visibility == null || p.visibility === 'visible')
        .filter(p => Array.isArray(p.profile?.steps) && p.profile.steps.length > 0)
        .map(p => ({ id: String(p.id), name: p.profile.title }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    const longest = [...visible].sort((a, b) => String(b.profile?.notes || '').length - String(a.profile?.notes || '').length)[0];
    const recordsAtStart = await records();
    const workflowAtStart = await decaid('GET', '/workflow');
    const pulled = [];
    const hiddenIds = [];
    // The step's pour, and the newest Shot before it, for a pour cut short.
    let pour = null;
    let newestBefore = null;
    // DYE2's records and the Workflow as the step found them, and its Shots gone.
    const restore = async () => {
        if (pour) {
            // A pour the step never saw end may still store its Shot.
            await pour.catch(() => {});
            await sleep(4000);
            const newest = (await decaid('GET', '/shots?limit=1').catch(() => null))?.items?.[0]?.id ?? null;
            if (newest != null && newest !== newestBefore && !pulled.includes(newest)) pulled.push(newest);
        }
        await decaid('POST', RECIPE_STORE, recordsAtStart).catch(() => {});
        await unloadRecipe().catch(() => {});
        await decaid('PUT', '/workflow', { profile: workflowAtStart.profile }).catch(() => {});
        for (const id of pulled) await decaid('DELETE', `/shots/${id}`).catch(() => {});
    };
    await decaid('PUT', '/machine/state/idle').catch(() => {});
    // Both passes, their pages opened and closed, inside one try: whatever throws,
    // the fixture is put back.
    try {
        let view = await openPage();
        try {
            const { page, seen } = view;
            // A tablet's numbers open the numpad, which Streamline decides at start.
            await page.addInitScript(() => { window._forceNumpadMobile = true; });
            await page.reload();
            await waitForPage(page);
            await page.waitForTimeout(2500);
            const card = recipe => page.locator('#cafe-strip .cafe-card').nth(recipe.slot - 1);
            const loadCard = async recipe => {
                if ((await card(recipe).getAttribute('aria-pressed')) === 'true') return; // a tap would unload it
                await card(recipe).click();
                await page.locator('#cafe-title').filter({ hasText: recipe.name }).waitFor({ timeout: 20_000 });
                await page.waitForTimeout(3000);
            };
            const brewRow = async () => ({ name: (await page.locator('#profile-name').textContent()).trim(), temp: parseFloat(await page.locator('#temp-value').textContent()) });
            const writesSince = (mark, test) => seen.requests.slice(mark).filter(test);
            // A write of the Workflow, of DYE2's records or selection, or of a profile.
            const anyWrite = r => /^PUT .*\/workflow$/.test(r) || /^POST .*dye2\.reaplugin\//.test(r) || /^(PUT|POST|DELETE) .*\/profiles\b/.test(r);
            const dialIn = wf => JSON.stringify({ dose: wf.context.targetDoseWeight, yield: wf.context.targetYield, grind: wf.context.grinderSetting });
            const closeDialog = async () => { await page.locator('#cafe-pick-dialog .cafe-pick-head .cafe-btn').click(); return pickClosed(page); };

            // Loaded afresh, as stored, on its own profile.
            if ((await card(house).getAttribute('aria-pressed')) === 'true') {
                await card(house).click(); // unloads it
                await page.waitForTimeout(2500);
            }
            await loadCard(house);
            await matchMachine(house.name);
            const record = await recordNamed(house.name);
            const using = byTitle(house.profile);
            const loadedFirst = await selection();
            check('profile dialog: the recipe is loaded, and not as changed', loadedRecipeId(loadedFirst) === record.id && loadedFirst.modified === false, JSON.stringify(loadedFirst));
            const urlBefore = page.url();

            //     The value still opens the numpad; the row's name and the profile's open the dialog.
            await page.locator('#temp-value').click();
            const numpad = await page.locator('#numpad-modal-overlay').waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
            check('profile dialog: a tap on the Brew value opens the numpad, and no dialog', numpad && !(await pickDialog(page).count()));
            if (numpad) await page.locator('#numpad-cancel').click();
            await page.waitForTimeout(800);
            for (const [what, on] of [['the row\'s name', '#brew-section .cafe-row-name'], ['the profile\'s name under it', '#profile-name']]) {
                const opened = await openProfiles(page, on);
                check(`profile dialog: a tap on ${what} opens the dialog`, opened && (await page.locator('#cafe-pick-title').textContent()) === 'Profile');
                if (opened) await closeDialog();
            }
            check('profile dialog: nothing on the row opened Streamline\'s profile list or one of DYE2\'s pages',
                // Streamline prefetches its profile list's page at start, so what is
                // asked is whether it was put on screen: its list never mounted.
                page.url() === urlBefore && (await page.locator('#main-page').isVisible()) && (await page.locator('#profile-list').count()) === 0
                && !seen.requests.some(r => /dye2\.reaplugin\/(grinder|ui)/.test(r)),
                seen.requests.filter(r => /dye2\.reaplugin\/(grinder|ui)/.test(r)).join(', '));

            //     The list, the row in use and its description.
            let mark = seen.requests.length;
            await openProfiles(page);
            let shown = await profileDialogShown(page);
            check('profile dialog: the line says the choice is saved to the recipe', shown.under === `${house.name} · saved to the recipe`, shown.under);
            check('profile dialog: "Profiles" over every profile Decaid shows, sorted by title',
                shown.heading === 'Profiles' && JSON.stringify(shown.rows.map(({ id, name }) => ({ id, name }))) === JSON.stringify(listed),
                `${shown.rows.length} rows, ${listed.length} listed; first ${shown.rows.slice(0, 3).map(r => r.name).join(' | ')}`);
            const inUseRows = shown.rows.filter(r => r.inUse);
            check('profile dialog: the profile in use is highlighted and marked "In use", and no other',
                inUseRows.length === 1 && inUseRows[0].id === String(using.id) && shown.rows.filter(r => r.highlighted).map(r => r.id).join() === String(using.id),
                JSON.stringify(inUseRows));
            const lightRow = shown.rows.find(r => r.id === String(light.id));
            check('profile dialog: a row is the profile\'s title over "By" and its author, then its own temperature',
                lightRow?.detail === `By ${light.profile.author} · ${own(light).toFixed(0)}°c`, lightRow?.detail);
            const notesOf = p => String(p.profile.notes || '').replace(/\r\n?/g, '\n').trim();
            check('profile dialog: "Description", the profile in use\'s title, "By" and its author with "brews at", and its notes',
                !shown.listShown && shown.paneHeading === 'Description' && shown.paneTitle === using.profile.title
                && shown.byline === `By ${using.profile.author} · brews at ${own(using).toFixed(0)}°c`
                && shown.notes === (notesOf(using) || 'This profile has no description.'),
                `${shown.paneTitle} | ${shown.byline} | ${shown.notes?.slice(0, 60)}`);
            check('profile dialog: on the profile in use the button\'s place reads "In use"', shown.inUse && shown.use === null && shown.useNote === null);
            check('profile dialog: the notes are plain text, with their line breaks', shown.notesHtml === shown.notes.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') && shown.notesScroll.whiteSpace === 'pre-line', shown.notesScroll.whiteSpace);
            await shot(page, 'profile-dialog-1920x1200-light');

            //     A tap on another row highlights it and writes nothing.
            await profileRow(page, light.id).click();
            await page.waitForTimeout(400);
            shown = await profileDialogShown(page);
            check('profile dialog: a tap on another profile highlights it and shows its description',
                shown.rows.filter(r => r.highlighted).map(r => r.id).join() === String(light.id) && shown.paneTitle === light.profile.title
                && shown.byline === `By ${light.profile.author} · brews at ${own(light).toFixed(0)}°c` && shown.notes === (notesOf(light) || 'This profile has no description.'),
                `${shown.paneTitle} | ${shown.byline}`);
            check('profile dialog: it offers "Use this profile", with "Sets Brew to" its temperature, and the profile in use stays marked',
                shown.use === 'Use this profile' && shown.useNote === `Sets Brew to ${own(light).toFixed(0)}°c` && !shown.inUse
                && shown.rows.find(r => r.inUse)?.id === String(using.id), `${shown.use} | ${shown.useNote}`);
            await shot(page, 'profile-dialog-highlighted-1920x1200-light');
            //     The notes scroll inside the box where they are long.
            await profileRow(page, longest.id).click();
            await page.waitForTimeout(400);
            shown = await profileDialogShown(page);
            check('profile dialog: long notes scroll inside the dialog, which fits the window',
                shown.notesScroll.scroll > shown.notesScroll.client && shown.notesScroll.overflow === 'auto'
                && shown.box.top >= 0 && shown.box.bottom <= shown.window[1] && shown.box.right <= shown.window[0],
                `${longest.profile.title}: ${JSON.stringify(shown.notesScroll)}`);
            check('profile dialog: highlighting wrote nothing, and the Workflow is as it was',
                writesSince(mark, anyWrite).length === 0 && (await decaid('GET', '/workflow')).profile.title === using.profile.title, writesSince(mark, anyWrite).join(', '));
            //     Close writes nothing, nor a tap outside.
            check('profile dialog: Close closes it and writes nothing', (await closeDialog()) && writesSince(mark, anyWrite).length === 0);
            await openProfiles(page);
            await page.mouse.click(30, 30);
            check('profile dialog: a tap outside closes it and writes nothing', (await pickClosed(page)) && writesSince(mark, anyWrite).length === 0);

            //     "Use this profile", with the recipe loaded.
            const workflowBefore = await decaid('GET', '/workflow');
            const othersBefore = JSON.stringify((await records()).filter(row => row && row.id !== record.id));
            await openProfiles(page);
            await profileRow(page, light.id).click();
            await page.waitForTimeout(400);
            mark = seen.requests.length;
            await page.locator('#cafe-pick-pane-use').click();
            check('profile dialog: "Use this profile" closes the dialog', await pickClosed(page));
            await page.locator('#profile-name').filter({ hasText: light.profile.title }).waitFor({ timeout: 15_000 }).catch(() => {});
            await page.waitForTimeout(1500);
            const after = await recordNamed(house.name);
            const workflowAfter = await decaid('GET', '/workflow');
            const loadedAfter = await selection();
            check('profile dialog: the recipe is still loaded, and not as changed', loadedRecipeId(loadedAfter) === record.id && loadedAfter.modified === false, JSON.stringify(loadedAfter));
            check('profile dialog: the recipe holds the new profile, at its own temperature, and keeps the name it was given by hand',
                after.profileId === light.id && after.profileTitle === light.profile.title && after.dashboardVariables.brewC === own(light) && after.name === house.name,
                `${after.profileId} | ${after.profileTitle} | ${after.dashboardVariables.brewC} | ${after.name}`);
            check('profile dialog: the other records are untouched', JSON.stringify((await records()).filter(row => row && row.id !== record.id)) === othersBefore);
            check('profile dialog: the Workflow has the profile at its own temperature, with dose, yield and grind as they were',
                workflowAfter.profile.title === light.profile.title && workflowAfter.profile.steps[0].temperature === own(light) && dialIn(workflowAfter) === dialIn(workflowBefore),
                `${workflowAfter.profile.title} ${workflowAfter.profile.steps[0].temperature}°C ${dialIn(workflowBefore)} → ${dialIn(workflowAfter)}`);
            const changeWrites = writesSince(mark, r => /^PUT .*\/workflow$/.test(r) || /^POST .*\/store\/dye2\.reaplugin\/recipes$/.test(r));
            check('profile dialog: the change was #50\'s, one record write then one Workflow write, and nothing asked of DYE2\'s save or selection',
                changeWrites.length === 2 && /\/store\/dye2\.reaplugin\/recipes$/.test(changeWrites[0]) && /\/workflow$/.test(changeWrites[1])
                && writesSince(mark, r => /^POST .*dye2\.reaplugin\/(record|save-recipe|selection)$/.test(r)).length === 0, writesSince(mark, anyWrite).join(', '));
            const brew = await brewRow();
            check('profile dialog: the Brew row names the new profile at its own temperature', brew.name === light.profile.title && brew.temp === own(light), JSON.stringify(brew));
            check('profile dialog: the dial-in rows and the title band are as they were',
                (await page.locator('#dose-in-value').textContent()) === `${house.dose}g` && (await page.locator('#drink-out-value').textContent()) === `${house.yield}g`
                && (await page.locator('#cafe-title').textContent()) === house.name && (await cardName(page, house.slot)) === house.name);
            const chartProfile = await page.evaluate(async () => (await import('/src/modules/chart.js')).getCurrentProfile()?.title ?? null);
            check('profile dialog: the graph\'s targets and stage names follow the new profile', chartProfile === light.profile.title, chartProfile);
            await shot(page, 'profile-dialog-after-1920x1200-light');
            //     After DYE2's window the recipe is still loaded, and the record holds the profile.
            await page.waitForTimeout(10_000);
            check('profile dialog: after DYE2\'s window the recipe is still loaded and its record holds the profile',
                (await loadedId()) === record.id && (await recordNamed(house.name)).profileId === light.id, `${await loadedId()}`);
            //     It opens again on the new profile, in use.
            await openProfiles(page);
            shown = await profileDialogShown(page);
            check('profile dialog: it opens again on the profile just chosen, in use',
                shown.rows.find(r => r.inUse)?.id === String(light.id) && shown.paneTitle === light.profile.title && shown.inUse && shown.use === null, shown.paneTitle);
            await closeDialog();

            //     A change that can't be made is a toast, and the row as it was.
            await page.route(/\/store\/dye2\.reaplugin\/recipes$/, route => (route.request().method() === 'POST' ? route.abort() : route.continue()));
            await openProfiles(page);
            await profileRow(page, gentle.id).click();
            await page.waitForTimeout(300);
            await page.locator('#cafe-pick-pane-use').click();
            await page.locator('#app-toast').filter({ hasText: 'Could not change the profile' }).waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
            check('profile dialog: a change that could not be made is a toast, and the row and the Workflow as they were',
                (await page.locator('#app-toast-message').textContent()) === 'Could not change the profile' && (await brewRow()).name === light.profile.title
                && (await decaid('GET', '/workflow')).profile.title === light.profile.title && (await loadedId()) === record.id,
                `${await page.locator('#app-toast-message').textContent()} | ${(await brewRow()).name}`);
            await page.unroute(/\/store\/dye2\.reaplugin\/recipes$/);
            await page.waitForTimeout(4500);

            //     Profiles that can't be read are not an empty list.
            await page.route(/\/api\/v1\/profiles(\?|$)/, route => route.abort());
            await tapAt(page, '#brew-section .cafe-row-name');
            await page.locator('#app-toast').filter({ hasText: 'Could not read the profiles' }).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
            check('profile dialog: profiles that can\'t be read are a toast, and no dialog',
                (await page.locator('#app-toast-message').textContent()) === 'Could not read the profiles' && !(await pickDialog(page).count()));
            await page.unroute(/\/api\/v1\/profiles(\?|$)/);
            await page.waitForTimeout(4500);

            //     A recipe load: the dialog does not open while one is under way.
            await card(other).click();
            await tapAt(page, '#brew-section .cafe-row-name');
            await page.waitForTimeout(1500);
            check('profile dialog: it does not open while a recipe loads', !(await pickDialog(page).count()));
            await page.locator('#cafe-title').filter({ hasText: other.name }).waitFor({ timeout: 20_000 }).catch(() => {});
            await page.waitForTimeout(3000);
            await loadCard(house);

            //     A shot that starts closes the dialog, and it does not open during one.
            newestBefore = (await decaid('GET', '/shots?limit=1')).items?.[0]?.id ?? null;
            const openBefore = await openProfiles(page);
            const run = pullShot(6);
            pour = run;
            await page.locator('#main-page.cafe-shot-live').waitFor({ timeout: 20_000 }).catch(() => {});
            check('profile dialog: a shot that starts closes the dialog', openBefore && (await pickClosed(page)), `open before the shot: ${openBefore}`);
            await tapAt(page, '#brew-section .cafe-row-name');
            await page.waitForTimeout(1500);
            check('profile dialog: the dialog does not open during a shot', !(await pickDialog(page).count()));
            await run;
            await page.locator('#main-page:not(.cafe-shot-live)').waitFor({ timeout: 20_000 }).catch(() => {});
            await page.waitForTimeout(4000);
            const during = await decaid('GET', '/shots?limit=1');
            // Only a Shot this pour stored is deleted afterwards.
            if (during.items?.[0] && during.items[0].id !== newestBefore) pulled.push(during.items[0].id);

            //     A hidden profile is not listed. In use, it still opens with its
            //     description, read from the Workflow, and no row is highlighted.
            await unloadRecipe();
            await decaid('PUT', `/profiles/${encodeURIComponent(gentle.id)}/visibility`, { visibility: 'hidden' });
            hiddenIds.push(gentle.id);
            await decaid('PUT', '/workflow', { profile: gentle.profile });
            await page.reload();
            await waitForPage(page);
            await page.waitForTimeout(3000);
            await openProfiles(page);
            shown = await profileDialogShown(page);
            check('profile dialog: with no recipe loaded, the line says the choice changes this machine only',
                shown.under === 'No recipe loaded · changes this machine only', shown.under);
            check('profile dialog: a hidden profile is not listed', !shown.rows.some(r => r.id === String(gentle.id)) && shown.rows.length === listed.length - 1, `${shown.rows.length} rows`);
            check('profile dialog: a hidden profile in use opens with its description, "In use", and no row highlighted',
                shown.paneTitle === gentle.profile.title && shown.inUse && shown.use === null && !shown.rows.some(r => r.highlighted || r.inUse),
                `${shown.paneTitle} | ${shown.rows.filter(r => r.highlighted).map(r => r.name).join()}`);
            await shot(page, 'profile-dialog-hidden-in-use-1920x1200-light');

            //     With no recipe loaded a choice changes this machine only.
            const recordsUnloaded = JSON.stringify(await records());
            await profileRow(page, light.id).click();
            await page.waitForTimeout(300);
            mark = seen.requests.length;
            await page.locator('#cafe-pick-pane-use').click();
            await pickClosed(page);
            await page.locator('#profile-name').filter({ hasText: light.profile.title }).waitFor({ timeout: 15_000 }).catch(() => {});
            await page.waitForTimeout(1500);
            check('profile dialog: with no recipe loaded the profile changes, and no record does',
                (await decaid('GET', '/workflow')).profile.title === light.profile.title && JSON.stringify(await records()) === recordsUnloaded
                && writesSince(mark, r => /^POST .*\/store\/dye2\.reaplugin\//.test(r)).length === 0 && (await loadedId()) === null,
                writesSince(mark, anyWrite).join(', '));
            check('profile dialog: and the Brew row follows, at the profile\'s own temperature', (await brewRow()).name === light.profile.title && (await brewRow()).temp === own(light), JSON.stringify(await brewRow()));
            check('profile dialog: no page error', seen.errors.length === 0, seen.errors.join(' | '));
        } finally {
            await view.close();
            for (const id of hiddenIds) await decaid('PUT', `/profiles/${encodeURIComponent(id)}/visibility`, { visibility: 'visible' }).catch(() => {});
        }

        //     At 1340 by 800, with the recipe loaded: the dialog fits, scaled, and long notes scroll inside it.
        view = await openPage({ viewport: { width: 1340, height: 800 } });
        try {
            const { page, seen } = view;
            await waitForPage(page);
            await page.waitForTimeout(2500);
            const card = page.locator('#cafe-strip .cafe-card').nth(house.slot - 1);
            if ((await card.getAttribute('aria-pressed')) !== 'true') {
                await card.click();
                await page.locator('#cafe-title').filter({ hasText: house.name }).waitFor({ timeout: 20_000 }).catch(() => {});
                await page.waitForTimeout(3000);
            }
            const opened = await openProfiles(page);
            let shown = opened ? await profileDialogShown(page) : null;
            check('profile dialog 1340x800: it opens from the Brew row, on the profile in use', opened && shown.rows.some(r => r.inUse && r.highlighted) && shown.inUse, shown?.paneTitle);
            await shot(page, 'profile-dialog-1340x800-light');
            await profileRow(page, longest.id).click();
            await page.waitForTimeout(400);
            shown = await profileDialogShown(page);
            check('profile dialog 1340x800: it fits inside the window, and long notes scroll inside it',
                shown.box.left >= 0 && shown.box.top >= 0 && shown.box.right <= shown.window[0] && shown.box.bottom <= shown.window[1] && shown.notesScroll.scroll > shown.notesScroll.client,
                `${JSON.stringify(shown.box)} in ${shown.window.join('x')}`);
            await shot(page, 'profile-dialog-highlighted-1340x800-light');
            await page.locator('#cafe-pick-dialog .cafe-pick-head .cafe-btn').click();
            check('profile dialog 1340x800: no page error', seen.errors.length === 0, seen.errors.join(' | '));
        } finally {
            await view.close();
        }
    } finally {
        await restore();
    }
}

// The labels the main chart's lines carry, as drawn: each label's line, text,
// colour, where it points and its line's newest point, and how far its text
// reaches to the right, against the chart's width and its plot's right edge.
const lineLabels = page => page.evaluate(async () => {
    const { echarts } = await import('/src/modules/echarts-streamline.min.js');
    const element = document.getElementById('plotly-chart');
    const chart = echarts.getInstanceByDom(element);
    if (!chart) return null;
    // The renderer sets each live frame with ECharts' lazyUpdate: the option
    // holds the new frame at once, the axis it is drawn on only after the next
    // paint. Measure once the two agree, as the screen shows them.
    const drawnEnd = () => chart.getModel().getComponent('xAxis', 0).axis.scale.getExtent()[1];
    for (let tries = 0; tries < 20 && Math.abs(drawnEnd() - chart.getOption().xAxis[0].max) > 1e-9; tries += 1) {
        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    }
    const option = chart.getOption();
    const context = document.createElement('canvas').getContext('2d');
    const grid = option.grid[0];
    const labels = option.series
        .map((series, seriesIndex) => ({ series, seriesIndex }))
        .filter(({ series }) => series && String(series.id).startsWith('trace-') && series.markPoint && series.markPoint.data?.length)
        .map(({ series, seriesIndex }) => {
            const label = series.markPoint.label;
            const coord = series.markPoint.data[0].coord;
            const at = chart.convertToPixel({ seriesIndex }, coord);
            context.font = `${label.fontSize}px ${label.fontFamily}`;
            const text = typeof label.formatter === 'function' ? label.formatter() : label.formatter;
            return {
                name: series.name, text, color: label.color, lineColor: series.lineStyle?.color, coord,
                newest: series.data.length ? series.data[series.data.length - 1] : null,
                x: at[0], y: at[1] + (label.offset?.[1] || 0),
                right: at[0] + (label.distance || 0) + context.measureText(text).width,
            };
        });
    return { labels, width: element.clientWidth, plotRight: element.clientWidth - grid.right, end: option.xAxis[0].max, drawnEnd: drawnEnd() };
});
const OWN_LABELLED = 'Pressure,Flow,°C,Weight';

// 28. The line names during a shot, issue #66 (docs/cafe/DESIGN.md, "Line names
//     during a shot"): on the main graph Pressure, Flow, °C and Weight are
//     named at their lines' newest points from the profile's first sample, in
//     Reference and Targets, with a recipe loaded and with none, at 1920 by
//     1200 and 1340 by 800, in English and in the language with the widest
//     labels; none during a Preheat, none on a target or the reference; no
//     label reaching past the chart; frames appended with no full draw; and
//     where each label is when the shot ends, and once the saved Shot is drawn.
async function liveLabels() {
    const house = RECIPES[0];
    const pulled = [];
    const newestId = async () => (await decaid('GET', '/shots?limit=1')).items?.[0]?.id ?? null;
    // `beforeStop` runs while the shot is still live, just before the stop.
    const pull = async (seconds, during = null, beforeStop = null) => {
        const before = await newestId();
        await decaid('PUT', '/machine/state/espresso');
        if (during) await during();
        await sleep(seconds * 1000);
        if (beforeStop) await beforeStop();
        await decaid('PUT', '/machine/state/idle');
        return before;
    };
    const saved = async before => {
        for (let waited = 0; waited < 30_000 && (await newestId()) === before; waited += 1000) await sleep(1000);
        const id = await newestId();
        if (id && id !== before) pulled.push(id);
        return id && id !== before ? id : null;
    };
    const choicesBefore = await storeValue(REFERENCES);
    const viewBefore = await storeValue(GRAPH_VIEW);
    await decaid('PUT', '/machine/state/idle').catch(() => {});
    const feed = machineFeed();
    let view = null;

    // The language whose four labels are widest, measured as the chart does.
    const widest = await (async () => {
        const probe = await openPage();
        try {
            await waitForPage(probe.page);
            let best = { code: 'en', width: 0 };
            for (const code of ['en', ...FINISHED_LANGUAGES]) {
                await setLanguage(probe.page, code);
                const width = await probe.page.evaluate(async () => {
                    const { getTranslation } = await import('/src/modules/i18n.js');
                    const context = document.createElement('canvas').getContext('2d');
                    context.font = '16px Inter, sans-serif';
                    return Math.max(...['Pressure', 'Flow', 'Weight'].map(key => context.measureText(getTranslation(key)).width));
                });
                if (width > best.width) best = { code, width };
            }
            return best;
        } finally {
            // The language is kept in Decaid: put English back, however the probe ended.
            await setLanguage(probe.page, 'en').catch(() => {});
            await probe.close();
        }
    })();
    note(`the widest labels are ${widest.code}'s, ${Math.round(widest.width)} px`);

    // One shot watched: the Preheat held, then the profile, sampled as it runs.
    const watch = async ({ language, graphView, viewport, loaded, seconds, name }) => {
        const tag = `${graphView}, ${viewport.width}x${viewport.height}, ${language}${loaded ? '' : ', no recipe'}`;
        await decaid('POST', GRAPH_VIEW, graphView);
        view = await openPage({ machine: feed, viewport });
        const { page, seen } = view;
        try {
            await waitForPage(page);
            if (loaded) await page.locator('#cafe-title').filter({ hasText: house.name }).waitFor({ timeout: 20_000 });
            if (language !== 'en') await setLanguage(page, language);
            await page.waitForTimeout(3000);
            const expected = await page.evaluate(async () => {
                const { getTranslation } = await import('/src/modules/i18n.js');
                return ['Pressure', 'Flow', '°C', 'Weight'].map(key => (key === '°C' ? key : getTranslation(key)));
            });
            const samples = [];
            let preheat = null;
            let draws = null;
            let lastLive = null;
            let liveAtLast = false;
            feed.hold();
            const before = await pull(seconds, async () => {
                await page.waitForTimeout(2000);
                preheat = await chartLines(page);
                feed.pass();
                await page.waitForTimeout(700);
                samples.push(await lineLabels(page));
                const counting = countDraws(page, 1500);
                for (let i = 0; i < 6; i += 1) { await page.waitForTimeout(250); samples.push(await lineLabels(page)); }
                draws = await counting;
            }, async () => {
                // The pull's own wait ran the shot on. The screenshot, then the
                // last frame looked at before the stop, while the page is live.
                await shot(page, `${name}-live`);
                lastLive = await lineLabels(page);
                liveAtLast = await page.locator('#main-page.cafe-shot-live').count() === 1;
            });
            samples.push(lastLive);
            check(`live labels (${tag}): the last look was taken during the shot`, liveAtLast);
            check(`live labels (${tag}): none during the Preheat`, preheat && preheat.labelled.length === 0, JSON.stringify(preheat?.labelled));
            const ok = samples.every(sample => sample && sample.labels.map(l => l.name).join() === OWN_LABELLED);
            check(`live labels (${tag}): Pressure, Flow, °C and Weight named through the shot, and no target or reference line`, ok, JSON.stringify(samples.map(sample => sample?.labels.map(l => l.name))));
            check(`live labels (${tag}): in the page's language and the lines' colours`,
                samples.every(sample => sample && JSON.stringify(sample.labels.map(l => l.text)) === JSON.stringify(expected) && sample.labels.every(l => l.color === l.lineColor)),
                JSON.stringify({ expected, got: lastLive?.labels.map(l => [l.text, l.color, l.lineColor]) }));
            check(`live labels (${tag}): each at its line's newest point, on every frame looked at`,
                samples.every(sample => sample && sample.labels.every(l => l.newest && l.coord[0] === l.newest[0] && l.coord[1] === l.newest[1])),
                JSON.stringify(lastLive?.labels.map(l => [l.coord, l.newest])));
            const times = samples.map(sample => sample?.labels[0]?.coord[0] ?? null);
            check(`live labels (${tag}): they move with the shot`, times.every((t, i) => i === 0 || (t !== null && t >= times[i - 1])) && times.at(-1) > times[0], JSON.stringify(times));
            const reach = samples.map(sample => (sample ? Math.max(...sample.labels.map(l => l.right)) - sample.width : null));
            const worst = samples[reach.indexOf(Math.max(...reach))];
            check(`live labels (${tag}): no label reaches past the chart's right edge`, reach.every(r => r !== null && r <= 0),
                JSON.stringify({ reach: reach.map(Math.round), width: lastLive?.width, plotRight: lastLive?.plotRight, worst: worst && { end: worst.end, drawnEnd: worst.drawnEnd, labels: worst.labels.map(l => [l.name, l.coord, Math.round(l.x), Math.round(l.right)]) } }));
            check(`live labels (${tag}): the frames were appended, the lines not drawn again in full`, draws && draws.appended > 0 && draws.full === 0, JSON.stringify(draws));
            // The shot's end, before Decaid has saved it: once the page has left
            // the shot, nothing has moved.
            const leftLive = await page.waitForFunction(() => !document.getElementById('main-page')?.classList.contains('cafe-shot-live'), null, { timeout: 10_000 }).then(() => true, () => false);
            check(`live labels (${tag}): the page left the shot when it stopped`, leftLive);
            await page.waitForTimeout(300);
            const ended = await lineLabels(page);
            // Compared label by label only where both frames name the same lines;
            // otherwise the check below fails and says so.
            const sameLines = (a, b) => !!a && !!b && a.labels.map(l => l.name).join() === b.labels.map(l => l.name).join();
            const moved = sameLines(lastLive, ended) && ended.labels.length ? Math.max(...ended.labels.map((l, i) => Math.hypot(l.x - lastLive.labels[i].x, l.y - lastLive.labels[i].y))) : null;
            check(`live labels (${tag}): when the shot ends the labels stay where they were (within a frame's travel)`,
                ended && ended.labels.map(l => l.name).join() === OWN_LABELLED && moved !== null && moved <= 12,
                JSON.stringify({ moved, end: [lastLive?.end, ended?.end] }));
            // Once saved, the Shot as Decaid stored it is drawn: say how far each label went.
            const id = await saved(before);
            check(`live labels (${tag}): the shot was saved`, !!id);
            // The stars show once the page has the saved Shot's record, and not
            // while it still draws the shot's own last frame.
            const drawn = await page.locator('#cafe-stars').waitFor({ state: 'visible', timeout: 20_000 }).then(() => true, () => false);
            check(`live labels (${tag}): the saved Shot is drawn in the shot's place`, drawn);
            await page.waitForTimeout(1000);
            const finished = await lineLabels(page);
            const travel = sameLines(ended, finished)
                ? finished.labels.map((l, i) => Math.round(Math.hypot(l.x - ended.labels[i].x, l.y - ended.labels[i].y))) : null;
            note(`(${tag}) once the saved Shot is drawn each label moved ${JSON.stringify(travel)} px, the axis ${ended?.end?.toFixed(2)} → ${finished?.end?.toFixed(2)} s`);
            check(`live labels (${tag}): the saved Shot's labels name the same four lines, none reaching past the chart`,
                finished && finished.labels.map(l => l.name).join() === OWN_LABELLED && Math.max(...finished.labels.map(l => l.right)) <= finished.width,
                JSON.stringify(finished?.labels.map(l => [l.name, Math.round(l.right)])));
            check(`live labels (${tag}): no page error`, seen.errors.length === 0, seen.errors.join(' | '));
            await page.waitForTimeout(3000);
        } finally {
            feed.pass();
            // The language is one of Streamline's synced settings, kept in
            // Decaid: put English back for every page after this one.
            if (language !== 'en') await setLanguage(page, 'en').catch(() => {});
            await view.close().catch(() => {});
            view = null;
        }
    };

    try {
        // Loaded, with a reference shorter than the watched shots, so in
        // Reference the axis grows past it and the labels need their room.
        await decaid('POST', GRAPH_VIEW, 'reference');
        view = await openPage({ machine: feed });
        const { page } = view;
        await waitForPage(page);
        const record = await recordNamed(house.name);
        if (loadedRecipeId(await decaid('GET', `/plugins/${DYE2_PLUGIN_ID}/selection`)) !== record.id) {
            await page.locator('#cafe-strip .cafe-card').nth(house.slot - 1).click();
            await page.locator('#cafe-title').filter({ hasText: house.name }).waitFor({ timeout: 20_000 });
            await page.waitForTimeout(3000);
        }
        const reference = await saved(await pull(6));
        check('live labels: a reference was pulled with the recipe', !!reference);
        await decaid('POST', REFERENCES, { ...(choicesBefore || {}), [record.id]: reference });
        await sleep(3000);
        await view.close();
        view = null;

        for (const viewport of [{ width: 1920, height: 1200 }, { width: 1340, height: 800 }]) {
            const size = `${viewport.width}x${viewport.height}`;
            for (const graphView of ['reference', 'targets']) {
                await watch({ language: 'en', graphView, viewport, loaded: true, seconds: 10, name: `live-labels-${graphView}-${size}-light` });
            }
            if (widest.code !== 'en') {
                await watch({ language: widest.code, graphView: 'targets', viewport, loaded: true, seconds: 10, name: `live-labels-targets-${size}-${widest.code}-light` });
            }
        }
        await unloadRecipe();
        await watch({ language: 'en', graphView: 'targets', viewport: { width: 1920, height: 1200 }, loaded: false, seconds: 8, name: 'live-labels-no-recipe-1920x1200-light' });
    } finally {
        feed.pass();
        if (view) await view.close().catch(() => {});
        await decaid('PUT', '/machine/state/idle').catch(() => {});
        await decaid('POST', REFERENCES, choicesBefore || {}).catch(() => {});
        if (viewBefore !== null) await decaid('POST', GRAPH_VIEW, viewBefore).catch(() => {});
        await unloadRecipe().catch(() => {});
        for (const id of pulled) await decaid('DELETE', `/shots/${id}`).catch(() => {});
    }
}

// ── The run ──────────────────────────────────────────────────────────────────

await mkdir(OUT, { recursive: true });
for (const [label, url] of [['the skin', `${BASE}/index.html`], ['Decaid', `${API}/machine/info`]]) {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`answered ${res.status}`);
    } catch (error) {
        console.error(`Cannot reach ${label} at ${url}: ${error.message}. See docs/cafe/SMOKE.md.`);
        process.exit(2);
    }
}
if (TOKEN.length < 32) {
    console.error('Give Decaid\'s extensions token with --token=. See docs/cafe/SMOKE.md.');
    process.exit(2);
}
// This run is the page without Decent Sync. With its plugin loaded, as the
// second run leaves it, a served Machine keeps no reference on the tablet.
if ((await decaid('GET', '/plugins')).some(plugin => plugin.id === 'decent-sync.reaplugin' && plugin.loaded)) {
    console.error('Decent Sync\'s plugin is loaded on this Decaid. Disable it first: see docs/cafe/SMOKE.md.');
    process.exit(2);
}

// --only=preheat (step 26), --only=profile-dialog (step 27) or --only=labels
// (step 28) alone, on a Decaid a whole run has already set up.
if (ONLY) {
    const steps = { preheat: preheatLive, 'profile-dialog': profileDialog, labels: liveLabels };
    try {
        if (!steps[ONLY]) throw new Error(`no step named "${ONLY}": ${Object.keys(steps).join(', ')}`);
        await setSetting(true);
        await seed();
        await steps[ONLY]();
    } catch (error) {
        check(`the run finished (${error.message.split('\n')[0]})`, false);
    } finally {
        await browser.close();
    }
    const failed = results.filter(r => !r.ok);
    console.log(`\n${results.length - failed.length} of ${results.length} checks passed. Screenshots: ${OUT}`);
    process.exit(failed.length ? 1 : 0);
}

try {
    // SMOKE.md's steps 1 to 6 are page tests now (test/page/: dye2-gate, strip,
    // dial-in), and step 3's seed is the fake Decaid's sample data. What the
    // steps left here stand on is set up instead: a current DYE2, loaded, the
    // setting on, the sample data, no recipe loaded, no reference chosen, the
    // graph in Reference, and one recipe loaded on a page.
    if (!(await dye2()) || compareVersions((await dye2()).version, MIN_DYE2_VERSION) < 0) {
        const installed = await decaid('POST', '/plugins/install/github-release', { repo: 'decentespresso/dye2' }, { manage: true });
        note(`installed DYE2 ${installed.version}`);
    }
    if (!(await dye2()).loaded) await decaid('POST', `/plugins/${DYE2_PLUGIN_ID}/enable`, undefined, { manage: true });
    for (let waited = 0; !(await dye2()).loaded; waited += 500) {
        if (waited > 60_000) throw new Error('DYE2 did not load within 60 s');
        await sleep(500);
    }
    await setSetting(true);
    await seed();
    await unloadRecipe();
    await decaid('POST', REFERENCES, {});
    await decaid('POST', GRAPH_VIEW, 'reference');
    // Step 14 puts Streamline's strip mode back as it found it.
    const modeBefore = await storeValue(STRIP_MODE);

    const view = await openPage();
    const { page, seen } = view;
    await waitForPage(page);
    await page.waitForTimeout(2500);
    const cards = page.locator('#cafe-strip .cafe-card');
    const target = RECIPES[1];
    await cards.nth(target.slot - 1).click();
    await page.locator('#cafe-title').filter({ hasText: target.name }).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(3000);

    // SMOKE.md's steps 8 and 9 (the reference, rating and notes) are page
    // tests now (test/page/: reference, reference-edges, remarks, legend-fit).

    // SMOKE.md's step 10, the rest of step 6, and steps 11 to 13 are page tests
    // now (test/page/: full-screen-and-settings, dial-in, slot-menu, languages).
    // The main page from the setup: opened, and a recipe loaded.
    check('no page error on the main page', seen.errors.length === 0, seen.errors.join(' | '));
    await view.close();
    await unloadRecipe();

    // 13. Official Streamline on the same Decaid, and back: the settings the two
    //     skins share are kept, and Streamline's strip mode is as it was left.
    if (STREAMLINE) {
        const sl = await browser.newContext({ viewport: { width: 1920, height: 1200 }, timezoneId: TIMEZONE });
        const sp = await sl.newPage();
        await sp.goto(`${STREAMLINE}/index.html`);
        await sp.locator('#dye-toggle-R').waitFor({ state: 'visible', timeout: 30_000 });
        check('Streamline, on the same Decaid, finds DYE2 on: the setting is shared', (await sp.locator('#dye-toggle-R').isVisible()) && (await (await fetch(SETTING)).json()) === 'true');
        await sp.locator('#dye-toggle-R').click();
        await sp.waitForTimeout(3000);
        check('Streamline\'s strip mode, set to R there, is in Decaid\'s store', (await storeValue(STRIP_MODE)) === 'R', String(await storeValue(STRIP_MODE)));
        await sl.close();

        const back = await openPage();
        await waitForPage(back.page);
        await back.page.waitForTimeout(3000);
        const bcards = back.page.locator('#cafe-strip .cafe-card');
        await bcards.nth(RECIPES[0].slot - 1).click();
        await back.page.locator('#cafe-title').filter({ hasText: RECIPES[0].name }).waitFor({ timeout: 20_000 });
        //     Arrange the strip too: take a recipe out of its slot and choose it back.
        await openMenu(back.page, RECIPES[2].slot);
        await pick(back.page, 2);
        await openMenu(back.page, RECIPES[2].slot);
        await pick(back.page, 1);
        await dialog(back.page).waitFor({ timeout: 5000 });
        await back.page.locator('#cafe-recipe-list .cafe-recipe-row').filter({ hasText: RECIPES[2].name }).click();
        await back.page.waitForTimeout(3500);
        check('the cafe page arranged its strip', (await cardName(back.page, RECIPES[2].slot)) === RECIPES[2].name);
        check('the cafe page, used after it, leaves the strip mode at R', (await storeValue(STRIP_MODE)) === 'R', String(await storeValue(STRIP_MODE)));
        check('the cafe page still finds DYE2 on', (await (await fetch(SETTING)).json()) === 'true');
        await back.close();

        const sl2 = await browser.newContext({ viewport: { width: 1920, height: 1200 }, timezoneId: TIMEZONE });
        const sp2 = await sl2.newPage();
        await sp2.goto(`${STREAMLINE}/index.html`);
        await sp2.locator('#dye-toggle-R').waitFor({ state: 'visible', timeout: 30_000 });
        await sp2.waitForTimeout(4000);
        const names = await sp2.locator('#dye-strip button').allTextContents();
        check('back on Streamline the strip is in R mode, as it was left, showing the recipes in slots 1 to 5',
            RECIPES.filter(r => r.slot <= 5).every(r => names.some(n => n.includes(r.name))), names.join(' | '));
        await shot(sp2, 'streamline-after-cafe');
        await sl2.close();
        await decaid('POST', STRIP_MODE, modeBefore == null ? 'P' : modeBefore);
    } else {
        note('skipped the switch to Streamline and back: give --streamline= (docs/cafe/SMOKE.md)');
    }

    // SMOKE.md's steps 15 to 17 (the dial-in label with Decent Sync, two shots
    // with no recipe, the Shots list) are page tests now (test/page/:
    // decent-sync-label, last-shot, shots-list).

    await grinderFixtures();

    await preheatLive();
    await profileDialog();
    await liveLabels();
} catch (error) {
    check(`the run finished (${error.message.split('\n')[0]})`, false);
} finally {
    await browser.close();
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(failed.length ? 1 : 0);
