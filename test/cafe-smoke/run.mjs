// Streamline Cafe's smoke run: the real page in a real Chromium against a real
// Decaid with a simulated machine. Run by hand before a release, not in CI.
// How to set Decaid up, and what this covers, is in docs/cafe/SMOKE.md.
//
//   node test/cafe-smoke/run.mjs --token=<Decaid's extensions token>
//   node test/cafe-smoke/run.mjs --token=... --base=http://127.0.0.1:13999 --decaid=http://127.0.0.1:8080
//   node test/cafe-smoke/run.mjs --token=... --headed
//   node test/cafe-smoke/run.mjs --token=... --streamline=http://127.0.0.1:13998
//   node test/cafe-smoke/run.mjs --token=... --timezone=Europe/Berlin   (the container's zone, UTC by default)
//
// It changes the Decaid it is pointed at: it removes and reinstalls DYE2,
// switches Streamline's "DYE2 on" setting, writes made-up beans, a grinder and
// recipes, makes recipes and moves them between slots from the page, changes
// the language, and pulls simulated shots. Point it at a throwaway Decaid only.

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BEANS, GRINDER, RECIPES, BARISTAS } from './sample-data.mjs';
import { MIN_DYE2_VERSION, DYE2_PLUGIN_ID } from '../../src/cafe/dye2-gate.js';
import { compareVersions } from '../../src/modules/skin-version.js';
import { isUnfinished, shotRecipeId, shotCurves } from '../../src/cafe/shot-model.js';
import { shotNumbers } from '../../src/cafe/comparison.js';
import { shotStages } from '../../src/cafe/stage-names.js';

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

async function decaid(method, path, body, { manage = false } = {}) {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(manage ? { Authorization: `Bearer ${TOKEN}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${text.slice(0, 200)}`);
    try { return JSON.parse(text); } catch { return text; }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const dye2 = async () => (await decaid('GET', '/plugins')).find(p => p.id === DYE2_PLUGIN_ID) || null;
const setSetting = on => fetch(SETTING, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(on ? 'true' : 'false') });

// Beans, a grinder and recipes, all made up. DYE2 makes each recipe itself, from
// the Workflow the run sets first, so the records have the shape DYE2 writes.
async function seed() {
    const recipesNow = (await decaid('GET', `/store/${DYE2_PLUGIN_ID}/recipes`)) || [];
    if (RECIPES.every(r => recipesNow.some(row => row && row.name === r.name))) {
        note('the sample recipes are already there');
        return;
    }
    const profiles = await decaid('GET', '/profiles');
    const batches = {};
    for (const bean of BEANS) {
        const made = await decaid('POST', '/beans', { roaster: bean.roaster, name: bean.name });
        const batch = await decaid('POST', `/beans/${made.id}/batches`, { roastDate: bean.roastDate });
        batches[bean.name] = { id: batch.id, roaster: bean.roaster };
    }
    const grinder = await decaid('POST', '/grinders', GRINDER);
    const ids = {};
    for (const recipe of RECIPES) {
        const profile = profiles.find(p => p.profile?.title === recipe.profile)?.profile;
        if (!profile) throw new Error(`Decaid has no profile titled "${recipe.profile}"`);
        await decaid('PUT', '/workflow', {
            profile,
            context: {
                targetDoseWeight: recipe.dose, targetYield: recipe.yield,
                coffeeName: recipe.bean, coffeeRoaster: batches[recipe.bean].roaster, beanBatchId: batches[recipe.bean].id,
                grinderId: grinder.id, grinderModel: grinder.model, grinderSetting: recipe.grind,
                extras: { basketName: recipe.basket || null },
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

const unloadRecipe = () => decaid('POST', `/plugins/${DYE2_PLUGIN_ID}/selection`, {});
const records = async () => (await decaid('GET', RECIPE_STORE)) || [];
const recordNamed = async name => (await records()).find(row => row && row.name === name);
const storeValue = path => decaid('GET', path).catch(() => null);

async function pullShot(seconds) {
    await decaid('PUT', '/machine/state/espresso');
    await sleep(seconds * 1000);
    await decaid('PUT', '/machine/state/idle');
}

// ── Browser ──────────────────────────────────────────────────────────────────

const browser = await chromium.launch({ headless: !HEADED });

// A page with nothing in its own storage. With `machineButtons: false` the
// machine reports buttons of its own, which the simulated machine never does, so
// that one answer is rewritten on the way in. `decentSync` stands in for Decent
// Sync's plugin, which this Decaid does not have: its entry in the plugin list
// and its Status answer, `served` or a refusal's code.
async function openPage({ theme = 'light', machineButtons = true, decentSync = null, weights = false } = {}) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1200 }, timezoneId: TIMEZONE });
    const page = await context.newPage();
    const seen = { errors: [], requests: [], theme };
    page.on('pageerror', error => seen.errors.push(error.message));
    page.on('request', request => seen.requests.push(`${request.method()} ${new URL(request.url()).pathname}`));
    if (!machineButtons) {
        await page.route('**/api/v1/machine/info', async route => {
            const response = await route.fetch();
            await route.fulfill({ response, json: { ...(await response.json()), GHC: true } });
        });
    }
    if (weights) {
        await page.route(/\/api\/v1\/shots\/[^/?]+$/, async route => {
            const response = await route.fetch();
            if (!response.ok()) return route.fulfill({ response });
            return route.fulfill({ response, json: withWeights(await response.json()) });
        });
    }
    if (decentSync) {
        await page.route('**/api/v1/plugins', async route => {
            const response = await route.fetch();
            await route.fulfill({ response, json: [...(await response.json()), { id: 'decent-sync.reaplugin', name: 'Decent Sync', version: '1.10.0', loaded: true, api: [] }] });
        });
        // 'coldStart': not connected yet at the first ask, served from the second.
        let asked = 0;
        const served = { status: 200, json: { connected: true, served: true, machine: { id: 'sample-machine', name: 'Sample Machine' }, location: { id: 'sample-location', name: 'Sample Cafe' } } };
        const refused = code => ({ status: code === 'unreachable' ? 503 : 409, json: { connected: code !== 'unreachable', served: false, machine: null, location: null, code, message: 'Sample refusal.' } });
        await page.route('**/api/v1/plugins/decent-sync.reaplugin/status', route => {
            asked += 1;
            if (decentSync === 'served') return route.fulfill(served);
            if (decentSync === 'coldStart') return route.fulfill(asked === 1 ? refused('unreachable') : served);
            return route.fulfill(refused(decentSync));
        });
    }
    await page.goto(`${BASE}/index.html`);
    return { page, seen, close: () => context.close() };
}

// A Shot as Decaid answers it, with a scale's readings and a weighed dose and
// yield added: the simulated scale reads no weight. Coffee lands from a fifth of
// the way in, at a rate that differs a little from Shot to Shot.
function withWeights(saved) {
    const poured = (saved.measurements || []).filter(m => ['preinfusion', 'pouring'].includes(m.machine?.state?.substate));
    if (poured.length === 0) return saved;
    const start = new Date(poured[0].machine.timestamp).getTime();
    const length = (new Date(poured[poured.length - 1].machine.timestamp).getTime() - start) / 1000;
    const rate = 1.8 + (poured.length % 7) / 10;
    let last = 0;
    const measurements = saved.measurements.map(m => {
        if (!poured.includes(m)) return m;
        const seconds = (new Date(m.machine.timestamp).getTime() - start) / 1000;
        const weight = Math.round(Math.max(0, seconds - length / 5) * rate * 10) / 10;
        last = weight;
        return { ...m, scale: { ...(m.scale || {}), timestamp: m.machine.timestamp, weight, weightFlow: weight > 0 ? rate : 0 } };
    });
    const dose = saved.workflow?.context?.targetDoseWeight;
    return { ...saved, measurements, annotations: { ...(saved.annotations || {}), actualYield: last + 0.8, ...(dose ? { actualDoseWeight: dose + 0.1 } : {}) } };
}

const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });
const gateLine = page => page.locator('#cafe-gate-line');
// The theme is painted, never stored: a stored one would be carried to Decaid's
// settings store, which every later page then reads back.
const paint = (page, theme) => page.evaluate(t => window.app.ui.paintTheme(t), theme);
async function waitForGate(page, theme = 'light') {
    await page.locator('#main-page.cafe-gated').waitFor({ timeout: 20_000 });
    await paint(page, theme);
}
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
// The menu a long-press opens on a card, and the list a recipe is chosen from.
const menu = page => page.locator('#app-context-menu.context-menu--open');
const menuItems = page => menu(page).locator('.context-menu__item').allTextContents();
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
const dialogRows = page => page.locator('#cafe-recipe-list .cafe-recipe-row-name').allTextContents();
const cardName = (page, slot) => page.locator('#cafe-strip .cafe-card').nth(slot - 1).locator('.cafe-card-name').textContent();
// The Settings page's language list calls this same function.
const setLanguage = (page, language) => page.evaluate(async code => {
    const { setLanguage: set } = await import('/src/modules/i18n.js');
    await set(code);
}, language);
// Text that does not fit its place: wider than its own box, cut short where a
// card clamps its lines, broken over two lines where a label has one, or
// reaching outside the page.
const overflowing = page => page.evaluate(() => [...document.querySelectorAll('#main-page [data-cafe-text], #main-page [data-i18n-key], #cafe-strip .cafe-card span, #cafe-compare .cafe-compare-title, #cafe-compare .cafe-compare-side, #cafe-compare span')]
    .filter(el => el.offsetParent !== null)
    .filter(el => {
        const box = el.getBoundingClientRect();
        const text = document.createRange();
        text.selectNodeContents(el);
        const lines = new Set([...text.getClientRects()].map(rect => Math.round(rect.top))).size;
        const clamped = el.closest('.cafe-card') && el.scrollHeight > el.clientHeight + 1;
        const wrapped = !el.closest('.cafe-card') && lines > 1;
        return el.scrollWidth > el.clientWidth + 1 || text.getBoundingClientRect().width > box.width + 1 || clamped || wrapped
            || box.right > window.innerWidth + 1 || box.left < -1;
    })
    .map(el => `${el.id || el.className}: "${el.textContent}"`));
// The smallest a fitted label has been shrunk to, so a fit that is unreadable
// shows up as a number and not only on a screenshot.
const smallestLabel = page => page.evaluate(() => Math.min(...[...document.querySelectorAll('#main-page [data-fit-text]')]
    .filter(el => el.offsetParent !== null).map(el => parseFloat(getComputedStyle(el).fontSize))));

// The legend: the text of each part that shows, and null for one that does not.
const legend = page => page.evaluate(() => {
    const shown = id => {
        const element = document.getElementById(id);
        return element && element.offsetParent !== null ? element.textContent.trim() : null;
    };
    return {
        label: shown('cafe-shot-label'), when: shown('cafe-shot-when'), make: shown('cafe-make-reference'),
        reference: shown('cafe-legend-reference') === null ? null : shown('cafe-reference-when') || '',
        flag: shown('cafe-different-profile'), badge: shown('cafe-reference-badge'), line: shown('cafe-legend-line'),
        targets: shown('cafe-legend-targets'),
        view: [...document.querySelectorAll('#cafe-view button')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.view).join(),
    };
});
// What a chart holds: each line's name, how many points it has and whether it
// carries an end label, and where the time axis ends.
const chartLines = (page, id = 'plotly-chart') => page.evaluate(async chartId => {
    const { echarts } = await import('/src/modules/echarts-streamline.min.js');
    const chart = echarts.getInstanceByDom(document.getElementById(chartId));
    if (!chart) return null;
    const option = chart.getOption();
    const lines = option.series.filter(series => series && String(series.id).startsWith('trace-'));
    return {
        end: option.xAxis[0].max,
        names: lines.map(line => line.name),
        points: lines.map(line => line.data.length),
        labelled: lines.filter(line => line.markPoint).map(line => line.name),
        referenceEnd: Math.max(0, ...lines.filter(line => /^Reference /.test(line.name)).map(line => (line.data.length ? line.data[line.data.length - 1][0] : 0))),
    };
}, id);
// The comparison row: its mode, and each card that shows. In Arabic and Hebrew a
// number with its unit is kept together by two marks that are not text.
const row = page => page.evaluate(() => {
    const text = element => element.textContent.replace(/[\u2068\u2069]/g, '');
    const element = document.getElementById('cafe-compare');
    return {
        mode: element.dataset.mode,
        height: Math.round(element.getBoundingClientRect().height),
        cards: [...element.querySelectorAll('.cafe-compare-card')].filter(card => card.offsetParent !== null).map(card => ({
            key: card.dataset.card,
            title: text(card.querySelector('.cafe-compare-title')),
            value: text(card.querySelector('.cafe-compare-value')),
            diff: text(card.querySelector('.cafe-compare-diff')),
            side: text(card.querySelector('.cafe-compare-side')),
        })),
    };
});
const keys = shown => shown.cards.map(card => card.key).join(' ');
const sides = shown => shown.cards.map(card => card.side);
const REST_REFERENCE = 'time firstDrip yield ratio peak';
const REST_TARGETS = 'time dose yield ratio peak';
const LIVE = 'time weight weightFlow flow pressure temperature';
const SIGNED = /^([+\u2212]\d|0\.0)/;
// The stage lines on a chart, each with the name written on it, or null.
const stageNames = (page, id = 'plotly-chart') => page.evaluate(async chartId => {
    const { echarts } = await import('/src/modules/echarts-streamline.min.js');
    const chart = echarts.getInstanceByDom(document.getElementById(chartId));
    const markers = chart?.getOption().series.find(series => series && series.id === 'markers-0');
    return (markers?.markLine?.data || []).map(line => (line.label && line.label.show ? line.label.formatter() : null));
}, id);
const REFERENCE_LINES = ['Reference pressure', 'Reference flow', 'Reference weight'];
// The newest of Decaid's Shots pulled with a recipe.
const newestShotWith = async recipeId => ((await decaid('GET', '/shots?limit=100')).items || []).find(row => shotRecipeId(row.workflow) === String(recipeId)) || null;
// The gate took the page's place: nothing behind it, no recipe read or loaded,
// and no install asked of Decaid.
async function checkGate(name, { page, seen }, line) {
    await waitForGate(page, seen.theme);
    await page.waitForTimeout(1500);
    check(`${name}: the line reads "${line}"`, (await gateLine(page).textContent()) === line, await gateLine(page).textContent());
    check(`${name}: the title is "Streamline Cafe needs DYE2"`, (await page.locator('#cafe-gate-title').textContent()) === 'Streamline Cafe needs DYE2');
    check(`${name}: nothing is drawn behind the card`,
        !(await page.locator('#cafe-header').isVisible()) && !(await page.locator('#shot-settings').isVisible()) && !(await page.locator('#chart-wrap').isVisible()));
    check(`${name}: Reload and Settings are offered`,
        (await page.locator('#cafe-gate-reload').isVisible()) && (await page.locator('#cafe-gate-settings').isVisible()));
    const touched = seen.requests.filter(r => /dye2\.reaplugin\/(recipes|selection)|\/plugins\/install|^PUT .*\/workflow$/.test(r));
    check(`${name}: no recipe is read or loaded, and nothing is installed`, touched.length === 0, touched.join(', '));
    check(`${name}: no page error`, seen.errors.length === 0, seen.errors.join(' | '));
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

try {
    // 1. An older DYE2. A fresh Decaid v0.9.2 bundles one; a second run finds the
    //    current one and has nothing to show here.
    await setSetting(true);
    const before = await dye2();
    if (before && compareVersions(before.version, MIN_DYE2_VERSION) < 0) {
        const view = await openPage();
        await checkGate('older DYE2', view, `DYE2 is older than v${MIN_DYE2_VERSION}`);
        check('older DYE2: it says where to update, and offers no button for the setting',
            (await view.page.locator('#cafe-gate-hint').isVisible()) && !(await view.page.locator('#cafe-gate-turn-on').isVisible()));
        await shot(view.page, 'gate-older-dye2');
        await view.close();
    } else {
        note(`skipped the "older than" screen: Decaid has DYE2 ${before ? before.version : 'not installed'}`);
    }

    // 2. DYE2 not installed, in light and dark. Settings stays reachable, and
    //    leaving it comes back to the check.
    if (before) await decaid('DELETE', `/plugins/${DYE2_PLUGIN_ID}`, undefined, { manage: true });
    for (const theme of ['light', 'dark']) {
        const view = await openPage({ theme });
        await checkGate(`not installed (${theme})`, view, "DYE2 isn't installed");
        await shot(view.page, `gate-not-installed-${theme}`);
        if (theme === 'light') {
            await view.page.locator('#cafe-gate-settings').click();
            await view.page.locator('#subpage-host #settings-content-area').waitFor({ timeout: 20_000 });
            check('not installed: Settings opens the settings page', true);
            await view.page.goBack();
            await waitForGate(view.page);
            check('not installed: leaving the settings page comes back to the check',
                (await gateLine(view.page).textContent()) === "DYE2 isn't installed");
        }
        await view.close();
    }

    // 3. Installed, then switched off in Decaid: installed but not loaded. Reload
    //    runs the check again once it is back on.
    const installed = await decaid('POST', '/plugins/install/github-release', { repo: 'decentespresso/dye2' }, { manage: true });
    note(`installed DYE2 ${installed.version}`);
    check(`DYE2 ${installed.version} is at least v${MIN_DYE2_VERSION}`, compareVersions(installed.version, MIN_DYE2_VERSION) >= 0);
    await decaid('POST', `/plugins/${DYE2_PLUGIN_ID}/disable`, undefined, { manage: true });
    await setSetting(false);
    {
        const view = await openPage();
        await checkGate('not loaded', view, 'DYE2 is installed but not loaded');
        await shot(view.page, 'gate-not-loaded');
        await decaid('POST', `/plugins/${DYE2_PLUGIN_ID}/enable`, undefined, { manage: true });
        await view.page.locator('#cafe-gate-reload').click();
        await gateLine(view.page).filter({ hasText: 'DYE2 is turned off in Settings' }).waitFor({ timeout: 20_000 });
        check('not loaded: Reload runs the check again', true);
        await view.close();
    }

    // 4. The setting off, in light and dark. The button turns it on and the page
    //    starts.
    await seed();
    await unloadRecipe();
    // No reference chosen, and the graph in its first view, whatever an earlier
    // run left in Decaid's store.
    await decaid('POST', REFERENCES, {});
    await decaid('POST', GRAPH_VIEW, 'reference');
    for (const theme of ['dark', 'light']) {
        await setSetting(false);
        const view = await openPage({ theme });
        await checkGate(`setting off (${theme})`, view, 'DYE2 is turned off in Settings');
        check(`setting off (${theme}): "Turn DYE2 on" is offered, and no plugin hint`,
            (await view.page.locator('#cafe-gate-turn-on').isVisible()) && !(await view.page.locator('#cafe-gate-hint').isVisible()));
        await shot(view.page, `gate-setting-off-${theme}`);
        if (theme === 'light') {
            await view.page.locator('#cafe-gate-turn-on').click();
            await waitForPage(view.page);
            check('setting off: "Turn DYE2 on" starts the page', await view.page.locator('#cafe-header').isVisible());
            await sleep(1500);
            check('setting off: the setting is on in Decaid\'s store, where Streamline reads it too', (await (await fetch(SETTING)).json()) === 'true');
        }
        await view.close();
    }

    // 5. The page, with no recipe loaded.
    const view = await openPage();
    const { page, seen } = view;
    await waitForPage(page);
    await page.waitForTimeout(2500);
    const cards = page.locator('#cafe-strip .cafe-card');
    check('nine cards in one row', (await cards.count()) === 9);
    const tops = await cards.evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)));
    check('the cards are in one row', new Set(tops).size === 1, tops.join(','));
    for (const recipe of RECIPES) {
        const card = cards.nth(recipe.slot - 1);
        check(`slot ${recipe.slot} shows "${recipe.name}" and its bean`,
            (await card.locator('.cafe-card-name').textContent()) === recipe.name && (await card.locator('.cafe-card-bean').textContent()) === recipe.bean);
    }
    for (const slot of [4, 6, 8]) {
        check(`slot ${slot} is an outline reading "Slot ${slot}" and "Hold to add"`,
            (await cards.nth(slot - 1).locator('.cafe-card-name').textContent()) === `Slot ${slot}`
            && (await cards.nth(slot - 1).locator('.cafe-card-bean').textContent()) === 'Hold to add'
            && (await cards.nth(slot - 1).evaluate(e => getComputedStyle(e).borderTopStyle)) === 'dashed');
    }
    await cards.nth(3).click();
    await page.waitForTimeout(1500);
    check('a tap on an empty slot does nothing', (await page.locator('#cafe-title').textContent()) === 'No recipe selected' && page.url().startsWith(BASE));
    check('no recipe: the title reads "No recipe selected"', (await page.locator('#cafe-title').textContent()) === 'No recipe selected');
    check('no recipe: the line under it says to tap a recipe', (await page.locator('#cafe-subtitle').textContent()) === 'Tap a recipe to load it');
    check('no recipe: the column is labelled "Dial-in · not saved to a recipe"', (await page.locator('#cafe-dial-label').textContent()) === 'Dial-in · not saved to a recipe');
    check('no recipe: no card is filled', (await page.locator('#cafe-strip [aria-pressed="true"]').count()) === 0);
    const column = await page.evaluate(() => {
        const style = (el, ...props) => props.map(p => getComputedStyle(el)[p]).join(' ');
        const all = selector => [...document.querySelectorAll(`#shot-settings ${selector}`)];
        return {
            names: all('.cafe-row-name').map(el => style(el, 'fontSize', 'fontWeight')),
            values: ['dose-in-value', 'drink-out-value', 'grind-value', 'temp-value', 'flush-value', 'steam-flow-value', 'hot-water-vol-value']
                .map(id => style(document.getElementById(id), 'fontSize', 'fontWeight')),
            buttons: all('.cafe-stepper > button').map(el => style(el, 'width', 'height')),
        };
    });
    check('the dial-in column: seven rows, each label the same size and weight', column.names.length === 7 && new Set(column.names).size === 1, [...new Set(column.names)].join(' | '));
    check('the dial-in column: each value the same size and weight', new Set(column.values).size === 1, [...new Set(column.values)].join(' | '));
    check('the dial-in column: fourteen − and + buttons, all the same size', column.buttons.length === 14 && new Set(column.buttons).size === 1, [...new Set(column.buttons)].join(' | '));
    check('the machine buttons show, with Settings and Sleep above them',
        (await page.locator('#ghc-controls').isVisible()) && (await page.locator('#ghc-controls #settings-btn').isVisible()) && (await page.locator('#ghc-controls #sleep-button').isVisible()));
    for (const gone of ['#dye-strip-toggle', '#profile-fav-nav', '#dye-open-btn', '#shot-history-panel', '#shot-data-panel', '#temp-presets', '#steam-mode-toggle']) {
        check(`gone from the page: ${gone}`, (await page.locator(gone).count()) === 0);
    }
    await shot(page, 'page-no-recipe-light');

    // 6. Two taps in quick succession: the machine ends on the second, which is
    //    the one the page names.
    const stripModeBefore = await page.evaluate(() => localStorage.getItem('streamline.dyeStripMode'));
    const [first, second] = [RECIPES[0], RECIPES[2]];
    await cards.nth(first.slot - 1).click();
    await cards.nth(second.slot - 1).click();
    await page.waitForTimeout(6000);
    const afterTwo = await decaid('GET', '/workflow');
    check('two quick taps: the page names the second recipe', (await page.locator('#cafe-title').textContent()) === second.name, await page.locator('#cafe-title').textContent());
    check('two quick taps: the Workflow holds the second recipe', afterTwo.context.coffeeName === second.bean && afterTwo.context.targetYield === second.yield,
        `${afterTwo.context.coffeeName}, ${afterTwo.context.targetYield} g`);
    check('two quick taps: only the second card is filled',
        (await cards.nth(second.slot - 1).getAttribute('aria-pressed')) === 'true' && (await page.locator('#cafe-strip [aria-pressed="true"]').count()) === 1);

    //    A tap loads a recipe, through Streamline's apply. Its numbers are the
    //    ones DYE2 holds, which an earlier run's steps may have changed.
    const target = RECIPES[1];
    const recordOf = async recipe => (await decaid('GET', `/store/${DYE2_PLUGIN_ID}/recipes`)).find(row => row.name === recipe.name);
    const held = (await recordOf(target)).dashboardVariables;
    await cards.nth(target.slot - 1).click();
    await page.locator('#cafe-title').filter({ hasText: target.name }).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(3000);
    check('a tap loads the recipe: its card is filled', (await cards.nth(target.slot - 1).getAttribute('aria-pressed')) === 'true');
    check('a tap loads the recipe: only one card is filled', (await page.locator('#cafe-strip [aria-pressed="true"]').count()) === 1);
    check('the title is the recipe, over its bean and profile',
        (await page.locator('#cafe-subtitle').textContent()) === `${target.bean} · ${target.profile}`, await page.locator('#cafe-subtitle').textContent());
    check('with no Decent Sync the column is labelled "Dial-in · not saved to the recipe"', (await page.locator('#cafe-dial-label').textContent()) === 'Dial-in · not saved to the recipe', await page.locator('#cafe-dial-label').textContent());
    const workflow = await decaid('GET', '/workflow');
    check('the Workflow holds the recipe', workflow.context.targetYield === held.drink && workflow.context.targetDoseWeight === held.dose && workflow.context.coffeeName === target.bean && workflow.profile.title === target.profile);
    const selection = await decaid('GET', `/plugins/${DYE2_PLUGIN_ID}/selection`);
    check('DYE2 says the recipe is loaded', selection?.kind === 'recipe');
    check('Dose names the bean and its roast date', /^Sample Single Origin · roasted .*28/.test(await page.locator('#cafe-dose-desc').textContent()), await page.locator('#cafe-dose-desc').textContent());
    check('Yield names the basket', (await page.locator('#cafe-yield-desc').textContent()) === target.basket);
    check('Grind names the grinder', (await page.locator('#cafe-grind-desc').textContent()) === GRINDER.model);
    check('Brew names the profile', (await page.locator('#profile-name').textContent()).trim() === target.profile);
    check('the steppers show the recipe\'s numbers',
        (await page.locator('#dose-in-value').textContent()) === `${held.dose}g` && (await page.locator('#drink-out-value').textContent()) === `${held.drink}g` && parseFloat(await page.locator('#grind-value').textContent()) === held.grind);
    check('the skin never wrote Streamline\'s strip mode to anything else',
        (await page.evaluate(() => localStorage.getItem('streamline.dyeStripMode'))) === stripModeBefore);
    await shot(page, 'page-recipe-light');

    // 7. Stepping a value.
    await page.locator('#dose-in-plus').click();
    const stepped = parseFloat(await page.locator('#dose-in-value').textContent());
    check('+ steps the dose once', stepped > held.dose && stepped <= held.dose + 1, `${held.dose}g to ${stepped}g`);
    await page.waitForTimeout(2500);
    check('the step reaches the Workflow', Math.abs((await decaid('GET', '/workflow')).context.targetDoseWeight - stepped) < 0.001);
    //    The skin saves nothing onto the recipe itself: that is Decent Sync's to do.
    await page.waitForTimeout(3000);
    check('the step changes this machine only: DYE2\'s record of the recipe keeps its dose', (await recordOf(target)).dashboardVariables.dose === held.dose, `record dose ${(await recordOf(target)).dashboardVariables.dose}`);
    check('the skin asks DYE2 to save nothing', !seen.requests.some(r => /^POST .*dye2\.reaplugin\/(record|save-recipe)$/.test(r)), seen.requests.filter(r => /dye2\.reaplugin\/(record|save-recipe)/.test(r)).join(', '));
    await page.locator('#hot-water-mode-toggle').click();
    check('Temp | Vol picks which of the two the buttons step',
        (await page.locator('#hot-water-temp-value').evaluate(e => getComputedStyle(e).fontSize)) === '30px'
        && (await page.locator('#hot-water-vol-value').evaluate(e => getComputedStyle(e).fontSize)) === '16px');
    await page.locator('#hot-water-mode-toggle').click();
    await page.evaluate(() => { window._forceNumpadMobile = true; });
    // Streamline's steam tile put into time mode, as loading a recipe saved in
    // that mode leaves it: the row is still the flow, and still steps it.
    await page.evaluate(() => window.app.ui.setSteamTileModeIfSafe('time'));
    const flowBefore = parseFloat(await page.locator('#steam-flow-value').textContent());
    const timeBefore = (await decaid('GET', '/workflow')).steamSettings.duration;
    await page.locator('#cafe-steam-plus').click();
    const flowAfter = parseFloat(await page.locator('#steam-flow-value').textContent());
    check('the steam row steps the flow, whatever mode Streamline\'s steam tile is in', Math.abs(flowAfter - (flowBefore + 0.1)) < 0.001, `${flowBefore} to ${flowAfter}`);
    check('the steam row still shows the flow large', (await page.locator('#steam-flow-value').evaluate(e => getComputedStyle(e).fontSize)) === '30px');
    await page.waitForTimeout(2500);
    const steamNow = (await decaid('GET', '/workflow')).steamSettings;
    check('the flow reaches the Workflow, and the steam time is untouched', Math.abs(steamNow.flow - flowAfter) < 0.001 && steamNow.duration === timeBefore, JSON.stringify(steamNow));

    // 8. A shot: the state, the time and the weight against its target, then the
    //    Shot in the graph and its time in the legend.
    const shotRun = pullShot(14);
    await page.locator('#cafe-live').waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(7000);
    check('during a shot the weight shows against its target', /^\d+\.\d \/ \d+(\.\d)? g$/.test(await page.locator('#cafe-live-weight').textContent()), await page.locator('#cafe-live-weight').textContent());
    check('during a shot the status line has the stage and its seconds', /\d+s/.test(await page.locator('#machine-status').textContent()), await page.locator('#machine-status').textContent());
    {
        const live = await row(page);
        check('when the shot starts six live cards take the row\'s place', live.mode === 'live' && keys(live) === LIVE, JSON.stringify(live));
        check('the live cards read the running shot', /^\d+\.\d s$/.test(live.cards[0].value) && /^\d+\.\d bar$/.test(live.cards[4].value) && /^\d+\.\d °C$/.test(live.cards[5].value) && /^\d+\.\d ml\/s$/.test(live.cards[3].value), JSON.stringify(live.cards.map(c => c.value)));
        check('with no reference the live cards read "No reference" and show no difference', sides(live).every(side => side === 'No reference') && live.cards.every(card => card.diff === ''), JSON.stringify(live));
        const named = await stageNames(page);
        check('during a shot each stage reached has its line, named where there is room', named.length > 0 && named.some(name => name), JSON.stringify(named));
    }
    await shot(page, 'page-shot-running-light');
    await shotRun;
    await page.locator('#cafe-shot-when').filter({ hasText: /\d{2}:\d{2}/ }).waitFor({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(4000);
    check('after the shot the status reads Ready', (await page.locator('#machine-status').textContent()).trim() === 'Ready', await page.locator('#machine-status').textContent());
    check('the weight readout goes when the shot ends', !(await page.locator('#cafe-live').isVisible()));
    check('the legend shows the latest Shot\'s label and time', (await page.locator('#cafe-shot-label').textContent()) === 'Latest' && /^Today \d{2}:\d{2}/.test(await page.locator('#cafe-shot-when').textContent()), JSON.stringify(await legend(page)));
    await shot(page, 'page-after-shot-light');

    //    The reference (docs/cafe/DESIGN.md, "Shots and the reference"). The Shot
    //    just pulled is the recipe's latest, and no reference is chosen yet.
    {
        const recipeId = (await recordOf(target)).id;
        const first = await newestShotWith(recipeId);
        let now = await legend(page);
        let lines = await chartLines(page);
        check('the graph starts in Reference, with the latest Shot and no reference', now.view === 'reference' && now.label === 'Latest' && now.reference === null && now.badge === null && now.line === null && now.targets === null, JSON.stringify(now));
        check('in Reference the reference\'s three lines follow Streamline\'s seven, empty with no reference, and no target is drawn',
            lines.names.length === 10 && JSON.stringify(lines.names.slice(7)) === JSON.stringify(REFERENCE_LINES) && lines.points.slice(7).every(n => n === 0)
            && [2, 3, 5].every(i => lines.points[i] === 0) && lines.points[0] > 10, JSON.stringify(lines));
        check('Make reference ends the latest Shot\'s row', now.make === 'Make reference');
        let cardsNow = await row(page);
        check('when the finished Shot is in the graph the five cards return', cardsNow.mode === 'rest' && keys(cardsNow) === REST_REFERENCE, JSON.stringify(cardsNow));
        check('with no reference chosen each card reads "No reference" and shows no difference', sides(cardsNow).every(side => side === 'No reference') && cardsNow.cards.every(card => card.diff === ''), JSON.stringify(cardsNow));
        check('the row has the Shot\'s time and peak pressure, and "—" for what the simulated scale never weighed',
            /^\d+\.\d s$/.test(cardsNow.cards[0].value) && /^\d+\.\d bar$/.test(cardsNow.cards[4].value) && cardsNow.cards[1].value === '—' && cardsNow.cards[2].value === '—', JSON.stringify(cardsNow.cards.map(c => c.value)));
        {
            const whole = await decaid('GET', `/shots/${first.id}`);
            const numbers = shotNumbers(whole);
            check('the row\'s time and peak are the Shot\'s own, its Preheat left out', cardsNow.cards[0].value === `${numbers.time.toFixed(1)} s` && cardsNow.cards[4].value === `${numbers.peak.toFixed(1)} bar`, `${cardsNow.cards[0].value}, ${cardsNow.cards[4].value} for ${numbers.time} s, ${numbers.peak} bar`);
            const named = await stageNames(page);
            const stages = shotStages(whole.measurements, whole.workflow);
            check('at rest each stage the Shot reached has its line, named from the Shot\'s own profile where there is room',
                named.length === stages.length && named.every((name, index) => name === null || name === stages[index].name.trim()) && named.some(name => name), `${JSON.stringify(named)} of ${JSON.stringify(stages.map(stage => stage.name))}`);
        }
        const boxes = await page.evaluate(() => {
            const box = id => document.getElementById(id).getBoundingClientRect();
            return { chartBottom: box('plotly-chart').bottom, chartHeight: box('plotly-chart').height, rowTop: box('cafe-compare').top, rowBottom: box('cafe-compare').bottom, page: window.innerHeight };
        });
        check('the graph gives up the row\'s height: the row sits under it, inside the page', cardsNow.height > 60 && boxes.rowTop >= boxes.chartBottom && boxes.rowTop - boxes.chartBottom < 24 && boxes.rowBottom <= boxes.page && boxes.chartHeight >= 450, JSON.stringify(boxes));
        await shot(page, 'graph-no-reference-light');

        //    With no reference yet, Make reference chooses at once.
        await page.locator('#cafe-make-reference').click();
        await page.locator('#cafe-reference-badge').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
        now = await legend(page);
        check('Make reference with none chosen asks nothing', (await page.locator('#cafe-reference-dialog[open]').count()) === 0);
        check('the latest Shot is now the reference: a badge, no reference row, no Make reference', now.badge === 'This shot is the reference' && now.reference === null && now.make === null, JSON.stringify(now));
        check('and the reference\'s lines are not drawn', (await chartLines(page)).points.slice(7).every(n => n === 0));
        cardsNow = await row(page);
        check('when the Shot is the reference each card reads "Ref = this shot"', sides(cardsNow).every(side => side === 'Ref = this shot') && cardsNow.cards.every(card => card.diff === ''), JSON.stringify(cardsNow));
        check('the choice is kept in Decaid\'s store, as recipe to Shot', (await storeValue(REFERENCES))?.[recipeId] === first.id, JSON.stringify(await storeValue(REFERENCES)));
        await shot(page, 'graph-shot-is-reference-light');

        //    A second shot, with the reference behind it.
        const second = pullShot(14);
        await page.locator('#main-page.cafe-shot-live').waitFor({ timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(6000);
        now = await legend(page);
        lines = await chartLines(page);
        check('during a shot the row reads "Live shot", the reference has its own row, and nothing can be chosen', now.label === 'Live shot' && now.when === null && /^Today /.test(now.reference || '') && now.make === null && now.badge === null, JSON.stringify(now));
        check('the reference is drawn behind the live shot', lines.points[7] > 10 && lines.points[0] > 5 && lines.names.length === 10, JSON.stringify(lines));
        check('the time axis shows the whole reference from the start', Math.abs(lines.end - lines.referenceEnd / 0.93) < 0.01, `${lines.end} for a reference of ${lines.referenceEnd} s`);
        check('no line is labelled during a shot', lines.labelled.length === 0);
        cardsNow = await row(page);
        check('live, in Reference: Time says how long the reference ran, and each card sits beside the reference at the same second, with the difference',
            cardsNow.mode === 'live' && keys(cardsNow) === LIVE && /^Ref ran \d+\.\d s$/.test(cardsNow.cards[0].side) && cardsNow.cards[0].diff === ''
            && /^Ref \d+\.\d bar$/.test(cardsNow.cards[4].side) && SIGNED.test(cardsNow.cards[4].diff) && /^Ref \d+\.\d ml\/s$/.test(cardsNow.cards[3].side) && SIGNED.test(cardsNow.cards[3].diff)
            && /^Ref \d+\.\d °C$/.test(cardsNow.cards[5].side), JSON.stringify(cardsNow));
        //    Frames are appended: the chart is not drawn again in full for each.
        const drawn = await page.evaluate(async () => {
            const { echarts } = await import('/src/modules/echarts-streamline.min.js');
            const chart = echarts.getInstanceByDom(document.getElementById('plotly-chart'));
            const counts = { appended: 0, full: 0 };
            const { setOption, appendData } = chart;
            chart.setOption = function (option, ...rest) { if (option.series?.some(series => series.data)) counts.full += 1; return setOption.call(this, option, ...rest); };
            chart.appendData = function (...args) { if (args[0].seriesIndex === 0) counts.appended += 1; return appendData.apply(this, args); };
            await new Promise(resolve => setTimeout(resolve, 3000));
            chart.setOption = setOption;
            chart.appendData = appendData;
            return counts;
        });
        check('a live shot still draws by appending frames, with the reference behind it', drawn.appended >= 10 && drawn.full <= 3, `${drawn.appended} frames appended, ${drawn.full} drawn in full, in 3 s`);
        await shot(page, 'graph-live-reference-light');
        //    The toggle switches the cards during a shot, and back.
        await page.locator('#cafe-view button[data-view="targets"]').click();
        await page.waitForTimeout(600);
        cardsNow = await row(page);
        check('live, in Targets: Time names the stage, Weight the weight it stops at, weight flow "No profile target", and the rest their target or "No target this step"',
            cardsNow.mode === 'live' && keys(cardsNow) === LIVE && cardsNow.cards[0].side !== '' && !/^Ref/.test(cardsNow.cards[0].side)
            && /^Stops at \d+\.\d g$/.test(cardsNow.cards[1].side) && cardsNow.cards[2].side === 'No profile target'
            && [3, 4, 5].every(i => /^Target \d+\.\d /.test(cardsNow.cards[i].side) || cardsNow.cards[i].side === 'No target this step')
            && [3, 4].some(i => /^Target /.test(cardsNow.cards[i].side)) && cardsNow.cards.every(card => card.diff === ''), JSON.stringify(cardsNow));
        check('live, in Targets: the stage lines keep their names', (await stageNames(page)).some(name => name), JSON.stringify(await stageNames(page)));
        await shot(page, 'graph-live-targets-light');
        await page.locator('#cafe-view button[data-view="reference"]').click();
        await page.waitForTimeout(600);
        check('and back in Reference the live cards sit beside the reference again', /^Ref ran /.test((await row(page)).cards[0].side));
        await page.locator('#plotly-chart').click();
        await page.locator('#main-page.chart-zoomed').waitFor({ timeout: 10_000 });
        await page.waitForTimeout(1500);
        const zoomed = await chartLines(page, 'expanded-chart');
        check('the full-screen chart stays as it is: its stage lines carry no names, and the row is not on it', (await stageNames(page, 'expanded-chart')).every(name => name === null) && !(await page.locator('#cafe-compare').isVisible()), JSON.stringify(await stageNames(page, 'expanded-chart')));
        check('the full-screen chart draws the reference too, after its own lines', JSON.stringify(zoomed.names.slice(-3)) === JSON.stringify(REFERENCE_LINES) && zoomed.points[zoomed.points.length - 3] > 10, JSON.stringify(zoomed));
        await shot(page, 'graph-live-full-screen-light');
        await page.locator('#expanded-chart').click();
        await second;
        await page.locator('#cafe-make-reference').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(1500);

        //    At rest: the new Shot against the reference, which is faded.
        const latestShot = await newestShotWith(recipeId);
        now = await legend(page);
        lines = await chartLines(page);
        check('when the shot ends it becomes the latest, once Decaid has it', latestShot.id !== first.id && now.label === 'Latest' && /^Today \d/.test(now.when || ''), JSON.stringify(now));
        check('the reference keeps its row, with when it was pulled, and Make reference is back', /^Today \d/.test(now.reference || '') && now.make === 'Make reference' && now.badge === null && now.flag === null, JSON.stringify(now));
        check('at rest the reference is drawn, and the end labels name the Shot\'s own lines only', lines.points[7] > 10 && lines.labelled.length > 0 && lines.labelled.every(name => !/^Reference /.test(name)), JSON.stringify(lines));
        check('the time axis fits the longer of the two Shots', lines.end >= lines.referenceEnd, `${lines.end} for a reference of ${lines.referenceEnd} s`);
        cardsNow = await row(page);
        check('at rest, in Reference: each card gives the Shot\'s value, the reference\'s beside it and the difference',
            cardsNow.mode === 'rest' && keys(cardsNow) === REST_REFERENCE && /^Ref \d+\.\d s$/.test(cardsNow.cards[0].side) && SIGNED.test(cardsNow.cards[0].diff)
            && /^Ref \d+\.\d bar$/.test(cardsNow.cards[4].side) && SIGNED.test(cardsNow.cards[4].diff), JSON.stringify(cardsNow));
        check('a value neither Shot recorded is "—", with no difference', cardsNow.cards[1].value === '—' && cardsNow.cards[1].side === 'Ref —' && cardsNow.cards[1].diff === '', JSON.stringify(cardsNow.cards[1]));
        await shot(page, 'graph-overlay-light');
        await paint(page, 'dark');
        await page.waitForTimeout(800);
        await shot(page, 'graph-overlay-dark');
        await paint(page, 'light');
        await page.locator('#plotly-chart').click();
        await page.locator('#main-page.chart-zoomed').waitFor({ timeout: 10_000 });
        await page.waitForTimeout(1500);
        await shot(page, 'graph-overlay-full-screen-light');
        await page.locator('#expanded-chart').click();
        await page.waitForTimeout(800);

        //    Targets: Streamline's own chart, and nothing of the reference.
        await page.locator('#cafe-view button[data-view="targets"]').click();
        await page.waitForTimeout(1200);
        now = await legend(page);
        lines = await chartLines(page);
        check('in Targets: the "Profile target" legend, no reference row, and Make reference stays', now.view === 'targets' && now.targets === 'Profile target' && now.reference === null && now.badge === null && now.line === null && now.make === 'Make reference', JSON.stringify(now));
        check('in Targets the chart is Streamline\'s seven lines, with their targets', lines.names.length === 7 && lines.points[2] > 10, JSON.stringify(lines));
        check('the view is kept in Decaid\'s store', (await storeValue(GRAPH_VIEW)) === 'targets');
        cardsNow = await row(page);
        check('at rest, in Targets: Time with first drip beside it, Dose, Yield and Ratio against what was set, and Peak pressure alone',
            keys(cardsNow) === REST_TARGETS && /^First drip /.test(cardsNow.cards[0].side) && /^Target \d+\.\d g$/.test(cardsNow.cards[1].side) && /^Target \d+\.\d g$/.test(cardsNow.cards[2].side)
            && /^Target 1:\d+\.\d\d$/.test(cardsNow.cards[3].side) && cardsNow.cards[4].side === '' && cardsNow.cards[4].diff === '' && /^\d+\.\d bar$/.test(cardsNow.cards[4].value), JSON.stringify(cardsNow));
        check('in Targets the stage lines keep their names', (await stageNames(page)).some(name => name), JSON.stringify(await stageNames(page)));
        await shot(page, 'graph-targets-light');
        await page.reload();
        await waitForPage(page);
        await page.locator('#cafe-make-reference').waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(1500);
        now = await legend(page);
        check('after a reload the graph is still in Targets, and the choice of reference is still there', now.view === 'targets' && (await storeValue(REFERENCES))?.[recipeId] === first.id, JSON.stringify(now));
        await page.locator('#cafe-view button[data-view="reference"]').click();
        await page.waitForTimeout(1200);
        check('back in Reference the reference is drawn again', (await legend(page)).reference !== null && (await chartLines(page)).points[7] > 10 && (await storeValue(GRAPH_VIEW)) === 'reference');

        //    Replacing a reference asks first.
        await page.locator('#cafe-make-reference').click();
        await page.locator('#cafe-reference-dialog[open]').waitFor({ timeout: 5000 });
        await page.waitForTimeout(400);
        const asked = {
            title: await page.locator('#cafe-reference-dialog-title').textContent(),
            recipe: await page.locator('#cafe-reference-dialog-recipe').textContent(),
            shots: await page.locator('#cafe-reference-dialog dd').allTextContents(),
        };
        check('Make reference over a reference asks "Replace the reference?", naming the recipe, the new Shot and the one it replaces',
            asked.title === 'Replace the reference?' && asked.recipe === target.name && asked.shots.length === 2 && asked.shots.every(text => /^Today \d/.test(text)), JSON.stringify(asked));
        await shot(page, 'dialog-replace-reference-light');
        await page.locator('#cafe-reference-dialog button', { hasText: 'Cancel' }).click();
        await page.waitForTimeout(800);
        check('Cancel leaves the reference as it was', (await storeValue(REFERENCES))?.[recipeId] === first.id && (await legend(page)).make === 'Make reference');
        await page.locator('#cafe-make-reference').click();
        await page.locator('#cafe-reference-dialog[open]').waitFor({ timeout: 5000 });
        await page.locator('#cafe-reference-dialog-replace').click();
        await page.locator('#cafe-reference-badge').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
        check('Replace makes the latest Shot the reference', (await storeValue(REFERENCES))?.[recipeId] === latestShot.id && (await legend(page)).badge === 'This shot is the reference', JSON.stringify(await storeValue(REFERENCES)));

        //    An Unfinished Shot never takes the latest Shot's place. The simulated
        //    machine stopped after two seconds has not poured or put 1 g in the cup.
        const before = await legend(page);
        await pullShot(2.5);
        await sleep(6000);
        const short = await newestShotWith(recipeId);
        if (short.id !== latestShot.id && isUnfinished(await decaid('GET', `/shots/${short.id}`))) {
            await page.locator('#cafe-reference-badge').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
            await page.waitForTimeout(1000);
            now = await legend(page);
            check('an Unfinished Shot does not become the latest: the graph goes back to the Shot before it', now.label === 'Latest' && now.when === before.when && now.badge === before.badge, JSON.stringify(now));
        } else {
            note('Decaid did not record the two-second shot as an Unfinished Shot, so that check was skipped');
        }

        //    A recipe with no Shot on this machine. The run gives it a reference
        //    itself, a Shot pulled on another profile: the page has no way to.
        const withShots = new Set(((await decaid('GET', '/shots?limit=100')).items || []).map(row => shotRecipeId(row.workflow)));
        const rows = await records();
        const empty = RECIPES.map(recipe => ({ recipe, row: rows.find(r => r && r.name === recipe.name) }))
            .find(({ recipe, row }) => row && !withShots.has(String(row.id)) && recipe.profile !== target.profile);
        if (empty) {
            const choices = await storeValue(REFERENCES);
            await decaid('POST', REFERENCES, { ...choices, [empty.row.id]: first.id });
            await cards.nth(empty.recipe.slot - 1).click();
            await page.locator('#cafe-title').filter({ hasText: empty.recipe.name }).waitFor({ timeout: 20_000 });
            await page.locator('#cafe-legend-line').waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
            await page.waitForTimeout(1500);
            now = await legend(page);
            lines = await chartLines(page);
            check('a recipe with no Shot yet says so, and has no Make reference', now.line === 'No shot with this recipe on this machine yet' && now.label === null && now.make === null, JSON.stringify(now));
            check('its reference is drawn alone, and flagged "Different profile"', now.reference !== null && now.flag === 'Different profile' && lines.points[0] === 0 && lines.points[7] > 10 && Math.abs(lines.end - lines.referenceEnd) < 0.01, `${JSON.stringify(now)} ${JSON.stringify(lines)}`);
            cardsNow = await row(page);
            check('with no Shot for the recipe yet the values are "—" and the cards give the reference\'s numbers', cardsNow.cards.every(card => card.value === '—' && card.diff === '') && /^Ref \d+\.\d s$/.test(cardsNow.cards[0].side) && /^Ref \d+\.\d bar$/.test(cardsNow.cards[4].side), JSON.stringify(cardsNow));
            {
                const whole = await decaid('GET', `/shots/${first.id}`);
                const named = await stageNames(page);
                check('and the stages named are the reference\'s', named.length === shotStages(whole.measurements, whole.workflow).length && named.some(name => name), JSON.stringify(named));
            }
            await shot(page, 'graph-no-shot-yet-light');
            await page.locator('#cafe-view button[data-view="targets"]').click();
            await page.waitForTimeout(800);
            cardsNow = await row(page);
            check('in Targets with no Shot yet the cards read "No shot yet"', keys(cardsNow) === REST_TARGETS && cardsNow.cards.every(card => card.value === '—' && card.side === 'No shot yet'), JSON.stringify(cardsNow));
            await shot(page, 'graph-no-shot-yet-targets-light');
            await page.locator('#cafe-view button[data-view="reference"]').click();
            await page.waitForTimeout(800);
            //    A choice that names a Shot the tablet no longer has.
            await decaid('POST', REFERENCES, { ...choices, [empty.row.id]: 'a-shot-that-is-gone' });
            await page.reload();
            await waitForPage(page);
            await page.locator('#cafe-legend-line').waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
            await page.waitForTimeout(1500);
            now = await legend(page);
            check('a choice that names a Shot the tablet no longer has reads as no reference', now.reference === null && now.badge === null && now.line === 'No shot with this recipe on this machine yet' && (await chartLines(page)).points[7] === 0, JSON.stringify(now));
            await decaid('POST', REFERENCES, choices);
            //    Loading another recipe changes the graph to that recipe's Shots.
            await cards.nth(target.slot - 1).click();
            await page.locator('#cafe-title').filter({ hasText: target.name }).waitFor({ timeout: 20_000 });
            await page.locator('#cafe-reference-badge').waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
            now = await legend(page);
            check('loading another recipe changes the graph to that recipe\'s latest Shot and reference', now.label === 'Latest' && now.badge === 'This shot is the reference' && now.line === null, JSON.stringify(now));
        } else {
            note('every sample recipe on another profile has a Shot on this Decaid, so "no Shot yet" and "Different profile" were skipped');
        }
    }

    //    The row with every number in it. The simulated scale reads no weight, so
    //    on this one page the run adds a scale's readings and a weighed dose and
    //    yield to each Shot Decaid answers with. One more shot first, so the
    //    latest Shot is not the reference.
    {
        const weighed = await openPage({ weights: true });
        const wp = weighed.page;
        await waitForPage(wp);
        await wp.locator('#cafe-reference-badge').waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
        const run = pullShot(11);
        await wp.locator('#main-page.cafe-shot-live').waitFor({ timeout: 20_000 }).catch(() => {});
        await run;
        await wp.locator('#cafe-make-reference').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
        // Streamline's "Shot Stopped" notice sits over the row for a few seconds.
        await wp.waitForTimeout(7000);
        let full = await row(wp);
        check('with a scale\'s readings: first drip, yield and ratio beside the reference\'s, each with its difference',
            keys(full) === REST_REFERENCE && full.cards.every(card => !card.value.includes('—') && /^Ref /.test(card.side) && SIGNED.test(card.diff))
            && /^\d+\.\d s$/.test(full.cards[1].value) && /^\d+\.\d g$/.test(full.cards[2].value) && /^1:\d+\.\d\d$/.test(full.cards[3].value), JSON.stringify(full));
        check('the Ratio card names the dose it was worked from', /^RATIO · \d+\.\d g DOSE$/.test(full.cards[3].title), full.cards[3].title);
        await shot(wp, 'row-reference-light');
        await paint(wp, 'dark');
        await wp.waitForTimeout(800);
        await shot(wp, 'row-reference-dark');
        await paint(wp, 'light');
        await wp.locator('#cafe-view button[data-view="targets"]').click();
        await wp.waitForTimeout(1000);
        full = await row(wp);
        check('with a scale\'s readings, in Targets: dose, yield and ratio against what was set, each with its difference',
            keys(full) === REST_TARGETS && /^First drip \d+\.\d s$/.test(full.cards[0].side) && [1, 2, 3].every(i => /^Target /.test(full.cards[i].side) && SIGNED.test(full.cards[i].diff)), JSON.stringify(full));
        await shot(wp, 'row-targets-light');
        await wp.locator('#cafe-view button[data-view="reference"]').click();
        await wp.waitForTimeout(800);
        check('no page error with the row and the stage names', weighed.seen.errors.length === 0, weighed.seen.errors.join(' | '));
        await weighed.close();
    }

    // 9. The full-screen chart, and back.
    await page.locator('#plotly-chart').click();
    await page.locator('#main-page.chart-zoomed').waitFor({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    check('a tap on the graph opens the full-screen chart', await page.locator('#expanded-chart').isVisible());
    await shot(page, 'page-chart-full-screen-light');
    await page.locator('#expanded-chart').click();
    await page.waitForTimeout(800);
    check('a tap on it comes back', (await page.locator('#shot-settings').isVisible()) && (await page.locator('#plotly-chart').isVisible()));

    //     A change made just before another recipe is tapped is written before
    //     that recipe loads, so it does not land on it. Then back: the first
    //     recipe comes back with its own numbers.
    const other = RECIPES[3];
    const flowStart = parseFloat(await page.locator('#steam-flow-value').textContent());
    await page.locator(flowStart >= 2 ? '#cafe-steam-minus' : '#cafe-steam-plus').click();
    const flowStepped = parseFloat(await page.locator('#steam-flow-value').textContent());
    await page.locator('#flush-plus').click();
    const flushStepped = parseFloat(await page.locator('#flush-value').textContent());
    await cards.nth(other.slot - 1).click();
    await page.locator('#cafe-title').filter({ hasText: other.name }).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(5000);
    check('a change made just before another recipe is tapped does not land on that recipe', (await recordOf(other)).dashboardVariables.flushS === (await decaid('GET', '/workflow')).rinseData.duration,
        `stepped to ${flushStepped}s (and steam flow ${flowStepped}) on the recipe before; record ${(await recordOf(other)).dashboardVariables.flushS}, Workflow ${(await decaid('GET', '/workflow')).rinseData.duration}`);
    await cards.nth(target.slot - 1).click();
    await page.locator('#cafe-title').filter({ hasText: target.name }).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(5000);
    check('coming back to a recipe brings back the recipe\'s own numbers',
        parseFloat(await page.locator('#dose-in-value').textContent()) === held.dose && parseFloat(await page.locator('#flush-value').textContent()) === held.flushS,
        `dose ${await page.locator('#dose-in-value').textContent()}, flush ${await page.locator('#flush-value').textContent()}`);

    // 10. Settings and back; the page is still there.
    await page.locator('#settings-btn').click();
    await page.locator('#subpage-host #settings-content-area').waitFor({ timeout: 20_000 });
    await page.goBack();
    await page.locator('#cafe-header').waitFor({ state: 'visible', timeout: 20_000 });
    check('Settings opens, and leaving it comes back to the page', (await page.locator('#cafe-title').textContent()) === target.name);
    check('no page error on the main page', seen.errors.length === 0, seen.errors.join(' | '));

    //     DYE2 switched off while the page runs, as the settings page's own toggle
    //     writes it: leaving Settings lands on the "DYE2 is needed" screen.
    await page.locator('#settings-btn').click();
    await page.locator('#subpage-host #settings-content-area').waitFor({ timeout: 20_000 });
    await page.evaluate(() => localStorage.setItem('streamline.dye2Enabled', 'false'));
    await page.goBack();
    await page.locator('#main-page.cafe-gated').waitFor({ timeout: 30_000 });
    check('DYE2 switched off in Settings: the page gives way to the "DYE2 is needed" screen',
        (await gateLine(page).textContent()) === 'DYE2 is turned off in Settings');
    await view.close();
    await setSetting(true);


    // 11. The long-press: a menu on the card. Nothing here opens DYE2's editor,
    //     and the page is never left.
    const modeBefore = await storeValue(STRIP_MODE);
    // The run makes recipes and moves them between slots. DYE2's records are put
    // back as they were afterwards, so the run can be repeated on the same Decaid.
    const recordsBefore = await records();
    const restoreRecords = () => decaid('POST', RECIPE_STORE, recordsBefore);
    {
        const trip = await openPage();
        const tp = trip.page;
        await waitForPage(tp);
        await tp.waitForTimeout(2500);
        const tcards = tp.locator('#cafe-strip .cafe-card');
        const [house, single, decaf, long] = RECIPES;
        const title = () => tp.locator('#cafe-title').textContent();
        const selectionId = async () => (await decaid('GET', `/plugins/${DYE2_PLUGIN_ID}/selection`))?.id ?? null;
        // What the machine is set to, without the marker that says which recipe is loaded.
        const settings = async () => {
            const wf = await decaid('GET', '/workflow');
            const { extras, ...context } = wf.context;
            const { dye, ...rest } = extras || {};
            return JSON.stringify({ profile: wf.profile.title, context, rest, steam: wf.steamSettings, water: wf.hotWaterData, rinse: wf.rinseData });
        };
        const skinWrites = from => trip.seen.requests.slice(from).filter(r => r === `POST /api/v1${RECIPE_STORE}`).length;
        const load = async recipe => {
            await tcards.nth(recipe.slot - 1).click();
            await tp.locator('#cafe-title').filter({ hasText: recipe.name }).waitFor({ timeout: 20_000 });
            await tp.waitForTimeout(3000);
        };
        if ((await title()) !== single.name) await load(single);

        //     Nothing to choose yet: every sample recipe is in a slot.
        await openMenu(tp, 4);
        check('holding an empty slot opens a menu on the card with two items',
            JSON.stringify(await menuItems(tp)) === JSON.stringify(['New recipe from current settings', 'Choose a recipe…']), (await menuItems(tp)).join(' | '));
        await shot(tp, 'menu-empty-slot-light');
        await pick(tp, 1);
        await dialog(tp).waitFor({ timeout: 5000 });
        check('with every recipe in a slot, the list says there is nothing to choose',
            (await tp.locator('#cafe-recipe-dialog-title').textContent()) === 'Choose a recipe for slot 4'
            && (await tp.locator('#cafe-recipe-dialog-empty').isVisible()) && (await dialogRows(tp)).length === 0);
        await tp.locator('#cafe-recipe-dialog .modal-action button').click();
        await tp.waitForTimeout(800);
        check('Cancel closes the list, and nothing changed', !(await dialog(tp).isVisible()) && (await cardName(tp, 4)) === 'Slot 4');

        //     A new recipe from what the machine is set to, in a slot above 5.
        const settingsBefore = await settings();
        let mark = trip.seen.requests.length;
        await openMenu(tp, 8);
        await pick(tp, 0);
        const made = (await records()).find(row => row && !recordsBefore.some(old => old && old.id === row.id));
        check('"New recipe from current settings" makes a recipe and puts it in held slot 8',
            !!made && made.stripSlot === 8 && (await cardName(tp, 8)) === made.name, `${made?.name}, slot ${made?.stripSlot}, card "${await cardName(tp, 8)}"`);
        check('DYE2 named it, from the profile and the bean', /Sample Single Origin/.test(made?.name || ''), made?.name);
        check('the new recipe is the loaded one', (await title()) === made?.name && (await selectionId()) === made?.id && (await tcards.nth(7).getAttribute('aria-pressed')) === 'true', await title());
        check('what the machine is set to did not change', (await settings()) === settingsBefore);
        check('the skin placed it with one write of DYE2\'s records', skinWrites(mark) === 1, `${skinWrites(mark)} writes`);
        await shot(tp, 'page-new-recipe-slot-8-light');

        //     A tap still loads.
        await load(single);
        check('a tap still loads a recipe', (await selectionId()) === (await recordNamed(single.name)).id);

        //     A filled card: three items. Taking a recipe out leaves it in DYE2.
        await openMenu(tp, decaf.slot);
        check('holding a filled card opens a menu with three items, and loads nothing',
            JSON.stringify(await menuItems(tp)) === JSON.stringify(['Replace with a new recipe', 'Replace with another recipe…', 'Remove from slot'])
            && (await title()) === single.name, (await menuItems(tp)).join(' | '));
        await shot(tp, 'menu-filled-card-light');
        await paint(tp, 'dark');
        await tp.waitForTimeout(500);
        await shot(tp, 'menu-filled-card-dark');
        await paint(tp, 'light');
        await pick(tp, 2);
        check('"Remove from slot" empties the card, and the recipe stays in DYE2 with no slot',
            (await cardName(tp, decaf.slot)) === `Slot ${decaf.slot}` && (await recordNamed(decaf.name))?.stripSlot === null, JSON.stringify((await recordNamed(decaf.name))?.stripSlot));
        check('removing a recipe that is not loaded leaves the loaded one loaded', (await title()) === single.name && (await selectionId()) === (await recordNamed(single.name)).id);
        await openMenu(tp, long.slot);
        await pick(tp, 2);

        //     Choosing: the list holds the recipes in no slot, sorted by name.
        await openMenu(tp, 4);
        await pick(tp, 1);
        await dialog(tp).waitFor({ timeout: 5000 });
        check('the list holds the recipes in no slot, sorted by name', JSON.stringify(await dialogRows(tp)) === JSON.stringify([decaf.name, long.name]), (await dialogRows(tp)).join(' | '));
        check('a row shows the bean and the profile under the name',
            (await tp.locator('#cafe-recipe-list .cafe-recipe-row-detail').first().textContent()) === `${decaf.bean} · ${decaf.profile}`,
            await tp.locator('#cafe-recipe-list .cafe-recipe-row-detail').first().textContent());
        await shot(tp, 'dialog-choose-light');
        await paint(tp, 'dark');
        await tp.waitForTimeout(500);
        await shot(tp, 'dialog-choose-dark');
        await paint(tp, 'light');
        await tp.locator('#cafe-recipe-list .cafe-recipe-row').first().click();
        await tp.waitForTimeout(3500);
        check('choosing a recipe puts it in the slot from 1 to 5 that was held',
            (await cardName(tp, 4)) === decaf.name && (await recordNamed(decaf.name))?.stripSlot === 4, await cardName(tp, 4));
        check('choosing loads nothing', (await title()) === single.name && (await selectionId()) === (await recordNamed(single.name)).id);

        //     Replacing a card's recipe with another: the one replaced keeps no slot.
        await openMenu(tp, house.slot);
        await pick(tp, 1);
        await dialog(tp).waitFor({ timeout: 5000 });
        await tp.locator('#cafe-recipe-list .cafe-recipe-row').filter({ hasText: long.name }).click();
        await tp.waitForTimeout(3500);
        check('"Replace with another recipe" puts the chosen one on the card, and the one replaced stays in DYE2 with no slot',
            (await cardName(tp, house.slot)) === long.name && (await recordNamed(long.name))?.stripSlot === house.slot && (await recordNamed(house.name))?.stripSlot === null,
            `${await cardName(tp, house.slot)}; replaced recipe's slot ${(await recordNamed(house.name))?.stripSlot}`);

        //     The loaded recipe's card removed: it is unloaded, and the machine is
        //     set as it was.
        const beforeUnload = await settings();
        const doseShown = await tp.locator('#dose-in-value').textContent();
        await openMenu(tp, single.slot);
        await pick(tp, 2);
        check('removing the loaded recipe\'s card unloads it: the page reads "No recipe selected"',
            (await title()) === 'No recipe selected' && (await selectionId()) === null && (await tp.locator('#cafe-dial-label').textContent()) === 'Dial-in · not saved to a recipe',
            `${await title()}, selection ${await selectionId()}`);
        check('and what the machine is set to did not change', (await settings()) === beforeUnload && (await tp.locator('#dose-in-value').textContent()) === doseShown);

        //     The loaded recipe's card replaced by a new recipe: the new one is loaded.
        await tcards.nth(3).click();
        await tp.locator('#cafe-title').filter({ hasText: decaf.name }).waitFor({ timeout: 20_000 });
        await tp.waitForTimeout(3000);
        const known = (await records()).map(row => row && row.id);
        await openMenu(tp, 4);
        await pick(tp, 0);
        const second = (await records()).find(row => row && !known.includes(row.id));
        check('"Replace with a new recipe" on the loaded card: the new recipe takes the card and is loaded, and the one replaced keeps no slot',
            !!second && second.stripSlot === 4 && (await title()) === second.name && (await selectionId()) === second.id && (await recordNamed(decaf.name))?.stripSlot === null,
            `${second?.name}, slot ${second?.stripSlot}, title "${await title()}"`);

        //     While a shot runs the menu does not open.
        const running = pullShot(8);
        await tp.locator('#main-page.cafe-shot-live').waitFor({ timeout: 20_000 }).catch(() => {});
        await longPress(tp, tcards.nth(5));
        await tp.waitForTimeout(600);
        check('while a shot runs a long-press opens no menu', (await tp.locator('#main-page.cafe-shot-live').count()) === 1 && !(await menu(tp).isVisible()));
        await running;
        await tp.waitForTimeout(4000);

        check('the page never left for one of DYE2\'s pages', tp.url().startsWith(BASE) && !trip.seen.requests.some(r => /dye2\.reaplugin\/(recipe-edit|dashboard|select-recipe)/.test(r)));
        check('the skin never wrote Streamline\'s strip mode', (await storeValue(STRIP_MODE)) === modeBefore, `${modeBefore} then ${await storeValue(STRIP_MODE)}`);
        check('the skin kept no state of its own in Decaid\'s store', !trip.seen.requests.some(r => /^(POST|DELETE) .*\/store\/streamlineCafe\//.test(r)));
        check('no page error while arranging the strip', trip.seen.errors.length === 0, trip.seen.errors.join(' | '));
        await trip.close();
        await unloadRecipe();
        await restoreRecords();
    }

    // 12. Languages. German has the longest text; Arabic is translated and the
    //     layout stays left to right.
    {
        const lang = await openPage();
        const lp = lang.page;
        await waitForPage(lp);
        await lp.waitForTimeout(2500);
        // Making recipes above left none loaded: load one, for the fullest page.
        await lp.locator('#cafe-strip .cafe-card').nth(RECIPES[1].slot - 1).click();
        await lp.locator('#cafe-title').filter({ hasText: RECIPES[1].name }).waitFor({ timeout: 20_000 });
        await lp.waitForTimeout(3000);
        // The row's titles are written in capitals.
        const ROW_TITLES = { de: 'DAUER | ERSTER TROPFEN | ERTRAG | VERHÄLTNIS | SPITZENDRUCK', ar: 'الوقت | أول قطرة | الناتج | نسبة | أقصى ضغط' };
        check('in English nothing overflows its place', (await overflowing(lp)).length === 0, (await overflowing(lp)).join(' | '));
        for (const [code, expected] of [
            ['de', { hint: 'Halten zum Hinzufügen', slot: 'Platz 4', dial: 'Einstellung · nicht im Rezept gespeichert', dose: 'Dosis', yield: 'Ertrag', settings: 'Einstellungen', latest: 'Letzter', view: 'Referenz | Ziele', row: ROW_TITLES.de, roasted: /geröstet am 28\. Okt/ }],
            ['ar', { hint: 'اضغط مطولا للإضافة', slot: 'الخانة 4', dial: 'الضبط · غير محفوظ في الوصفة', dose: 'الجرعة', yield: 'الناتج', settings: 'إعدادات', latest: 'الأحدث', view: 'المرجع | الأهداف', row: ROW_TITLES.ar, roasted: /حمص في/ }],
        ]) {
            await setLanguage(lp, code);
            await lp.waitForTimeout(2500);
            const empty = lp.locator('#cafe-strip .cafe-card').nth(3);
            const got = {
                hint: await empty.locator('.cafe-card-bean').textContent(),
                slot: await empty.locator('.cafe-card-name').textContent(),
                dial: await lp.locator('#cafe-dial-label').textContent(),
                dose: (await lp.locator('#dose-label .cafe-row-name').textContent()).trim(),
                yield: await lp.locator('#drink-label .cafe-row-name').textContent(),
                settings: (await lp.locator('#settings-btn').textContent()).trim(),
                latest: await lp.locator('#cafe-shot-label').textContent(),
                view: (await lp.locator('#cafe-view button').allTextContents()).join(' | '),
                row: (await row(lp)).cards.map(card => card.title.split(' · ')[0]).join(' | '),
            };
            for (const [what, text] of Object.entries(got)) {
                check(`${code}: ${what} reads "${expected[what]}"`, text === expected[what], text);
            }
            check(`${code}: the roast date is in the language too`, expected.roasted.test(await lp.locator('#cafe-dose-desc').textContent()), await lp.locator('#cafe-dose-desc').textContent());
            const over = await overflowing(lp);
            check(`${code}: no label overflows its place`, over.length === 0, over.join(' | '));
            check(`${code}: no fitted label is shrunk below 14px`, (await smallestLabel(lp)) >= 14, `${await smallestLabel(lp)}px`);
            check(`${code}: the layout stays left to right`, (await lp.evaluate(() => getComputedStyle(document.getElementById('main-page')).direction)) === 'ltr'
                && (await lp.locator('#shot-settings').evaluate(e => e.getBoundingClientRect().left)) < 10);
            for (const theme of ['light', 'dark']) {
                await paint(lp, theme);
                await lp.waitForTimeout(600);
                await shot(lp, `page-recipe-${code}-${theme}`);
            }
            await paint(lp, 'light');
        }
        //     The menu and the list, in German.
        await setLanguage(lp, 'de');
        await lp.waitForTimeout(1500);
        await openMenu(lp, 4);
        check('de: the menu is translated', JSON.stringify(await menuItems(lp)) === JSON.stringify(['Neues Rezept aus den aktuellen Einstellungen', 'Rezept auswählen…']), (await menuItems(lp)).join(' | '));
        const menuBox = await menu(lp).boundingBox();
        check('de: the menu is inside the page', menuBox.x >= 0 && menuBox.x + menuBox.width <= 1920, JSON.stringify(menuBox));
        await shot(lp, 'menu-empty-slot-de');
        await pick(lp, 1);
        await dialog(lp).waitFor({ timeout: 5000 });
        check('de: the list is translated',
            (await lp.locator('#cafe-recipe-dialog-title').textContent()) === 'Rezept für Platz 4 auswählen'
            && (await lp.locator('#cafe-recipe-dialog-empty').textContent()) === 'Keine Rezepte ohne Platz'
            && (await lp.locator('#cafe-recipe-dialog .modal-action button').textContent()).trim() === 'Abbrechen',
            await lp.locator('#cafe-recipe-dialog-title').textContent());
        await shot(lp, 'dialog-choose-de');
        await lp.locator('#cafe-recipe-dialog .modal-action button').click();
        await lp.waitForTimeout(600);

        //     No recipe loaded, and the "DYE2 is needed" screen, in German.
        await unloadRecipe();
        await lp.reload();
        await waitForPage(lp);
        await lp.waitForTimeout(3000);
        check('de: with no recipe the title and the line under it are translated',
            (await lp.locator('#cafe-title').textContent()) === 'Kein Rezept ausgewählt' && (await lp.locator('#cafe-subtitle').textContent()) === 'Tippe auf ein Rezept, um es zu laden',
            await lp.locator('#cafe-title').textContent());
        check('de: with no recipe no label overflows its place', (await overflowing(lp)).length === 0, (await overflowing(lp)).join(' | '));
        await shot(lp, 'page-no-recipe-de-light');
        await setSetting(false);
        await lp.reload();
        await waitForGate(lp);
        await lp.locator('#cafe-gate-title').filter({ hasText: 'benötigt' }).waitFor({ timeout: 20_000 }).catch(() => {});
        check('de: the "DYE2 is needed" screen is translated',
            (await lp.locator('#cafe-gate-title').textContent()) === 'Streamline Cafe benötigt DYE2'
            && (await gateLine(lp).textContent()) === 'DYE2 ist in den Einstellungen ausgeschaltet'
            && (await lp.locator('#cafe-gate-turn-on').textContent()) === 'DYE2 einschalten'
            && (await lp.locator('#cafe-gate-reload').textContent()) === 'Neu laden',
            `${await lp.locator('#cafe-gate-title').textContent()} / ${await gateLine(lp).textContent()}`);
        await shot(lp, 'gate-setting-off-de');
        //     Text drawn after the page loaded follows a change of language too.
        await setLanguage(lp, 'fr');
        await lp.waitForTimeout(1500);
        check('changing the language changes the screen\'s text where it stands',
            (await lp.locator('#cafe-gate-title').textContent()) === 'Streamline Cafe a besoin de DYE2' && (await gateLine(lp).textContent()) === 'DYE2 est désactivé dans les paramètres',
            await gateLine(lp).textContent());
        await setLanguage(lp, 'en');
        await lp.waitForTimeout(2500);
        check('back in English', (await lp.locator('#cafe-gate-title').textContent()) === 'Streamline Cafe needs DYE2');
        await lang.close();
        await setSetting(true);
    }

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

    // 14. The remaining screenshots: dark, and a machine with buttons of its own.
    {
        // The checks above left no recipe loaded: load one for the pictures.
        const loadOne = await openPage();
        await waitForPage(loadOne.page);
        await loadOne.page.waitForTimeout(2500);
        await loadOne.page.locator('#cafe-strip .cafe-card').nth(RECIPES[1].slot - 1).click();
        await loadOne.page.locator('#cafe-title').filter({ hasText: RECIPES[1].name }).waitFor({ timeout: 20_000 });
        await loadOne.page.waitForTimeout(3000);
        await loadOne.close();
    }
    for (const [name, options] of [
        ['page-recipe-dark', { theme: 'dark' }],
        ['page-recipe-own-buttons-light', { machineButtons: false }],
        ['page-recipe-own-buttons-dark', { theme: 'dark', machineButtons: false }],
    ]) {
        const extra = await openPage(options);
        await waitForPage(extra.page, extra.seen.theme);
        await extra.page.locator('#cafe-shot-when').filter({ hasText: /\d/ }).waitFor({ timeout: 20_000 }).catch(() => {});
        await extra.page.waitForTimeout(4000);
        if (options.machineButtons === false) {
            check(`${name}: no machine buttons, and Settings and Sleep at the bottom of the dial-in column`,
                !(await extra.page.locator('#ghc-controls').isVisible()) && (await extra.page.locator('#shot-settings #settings-btn').isVisible()) && (await extra.page.locator('#shot-settings #sleep-button').isVisible()));
        }
        check(`${name}: no page error`, extra.seen.errors.length === 0, extra.seen.errors.join(' | '));
        await shot(extra.page, name);
        await extra.close();
    }
    //     Decent Sync saves a Machine's dial-in onto its loaded recipe, so the
    //     column says "saved" only where its plugin says the Machine is served.
    for (const [status, label] of [['served', 'Dial-in · saved to the recipe'], ['captureOnly', 'Dial-in · not saved to the recipe']]) {
        const extra = await openPage({ decentSync: status });
        await waitForPage(extra.page);
        await extra.page.locator('#cafe-dial-label').filter({ hasText: label }).waitFor({ timeout: 20_000 }).catch(() => {});
        await extra.page.waitForTimeout(2500);
        check(`Decent Sync answering "${status}": the column is labelled "${label}"`, (await extra.page.locator('#cafe-dial-label').textContent()) === label, await extra.page.locator('#cafe-dial-label').textContent());
        check(`Decent Sync answering "${status}": its Status was asked`, extra.seen.requests.some(r => r === 'GET /api/v1/plugins/decent-sync.reaplugin/status'));
        if (status === 'served') await shot(extra.page, 'page-recipe-decent-sync-light');
        await extra.close();
    }
    //     The skin loaded before the plugin had connected: the first answer says
    //     nothing either way, and the page asks again without waiting for focus.
    {
        const extra = await openPage({ decentSync: 'coldStart' });
        await waitForPage(extra.page);
        await extra.page.waitForTimeout(3000);
        check('Decent Sync not connected yet: the column reads "not saved" until an answer comes', (await extra.page.locator('#cafe-dial-label').textContent()) === 'Dial-in · not saved to the recipe');
        await extra.page.locator('#cafe-dial-label').filter({ hasText: 'Dial-in · saved to the recipe' }).waitFor({ timeout: 45_000 }).catch(() => {});
        check('and the page asks again by itself: the column then reads "saved to the recipe"', (await extra.page.locator('#cafe-dial-label').textContent()) === 'Dial-in · saved to the recipe', await extra.page.locator('#cafe-dial-label').textContent());
        await extra.close();
    }
    await unloadRecipe();
    {
        const extra = await openPage({ theme: 'dark' });
        await waitForPage(extra.page, 'dark');
        await extra.page.waitForTimeout(4000);
        check('page-no-recipe-dark: the title reads "No recipe selected"', (await extra.page.locator('#cafe-title').textContent()) === 'No recipe selected');
        const none = await legend(extra.page);
        check('with no recipe: the tablet\'s newest Shot as "Last shot", "Pick a recipe to compare", no reference and no Make reference',
            none.label === 'Last shot' && /\d/.test(none.when || '') && none.line === 'Pick a recipe to compare' && none.reference === null && none.badge === null && none.make === null, JSON.stringify(none));
        const lastShot = await row(extra.page);
        check('with no recipe the row shows the last Shot\'s numbers with no reference', lastShot.mode === 'rest' && keys(lastShot) === REST_REFERENCE && /^\d+\.\d s$/.test(lastShot.cards[0].value) && sides(lastShot).every(side => side === 'No reference'), JSON.stringify(lastShot));
        await shot(extra.page, 'page-no-recipe-dark');
        await extra.close();
    }
    //     With no recipe loaded Streamline's history module draws the newest
    //     Shot, after each of two shots in one session without a reload, and the
    //     legend names it with its time and barista. The page reads no Shot
    //     itself then, and the history arrows and the shot panel stay out of reach.
    {
        const extra = await openPage();
        const urls = [];
        extra.page.on('request', request => urls.push(new URL(request.url())));
        await waitForPage(extra.page);
        await extra.page.waitForTimeout(4000);
        const reachable = () => extra.page.evaluate(() => [
            ...['history-prev-btn', 'history-next-btn', 'shot-history-info']
                .filter(id => document.getElementById(id)?.offsetParent != null),
            ...(document.getElementById('shot-history-panel') ? ['shot-history-panel'] : []),
        ]);
        check('no recipe, at rest: the history arrows and the shot panel are out of reach', (await reachable()).length === 0, (await reachable()).join(', '));
        // Of different lengths, so each drawing tells the two apart.
        for (const [n, seconds, barista] of [[1, 10, BARISTAS[0]], [2, 16, BARISTAS[1]]]) {
            await decaid('PUT', '/workflow', { context: { baristaName: barista } });
            const before = ((await decaid('GET', '/shots?limit=1')).items || [])[0]?.id;
            const run = pullShot(seconds);
            await extra.page.locator('#main-page.cafe-shot-live').waitFor({ timeout: 20_000 }).catch(() => {});
            await extra.page.waitForTimeout(4000);
            check(`no recipe, shot ${n}: during it the history arrows and the shot panel are out of reach`, (await reachable()).length === 0, (await reachable()).join(', '));
            await run;
            let newest = null;
            for (let i = 0; i < 30 && !(newest && newest.id !== before); i += 1) {
                await sleep(1000);
                newest = ((await decaid('GET', '/shots?limit=1')).items || [])[0];
            }
            const saved = await decaid('GET', `/shots/${newest.id}`);
            const points = shotCurves(saved.measurements).pressure.x.length;
            let lines = null;
            for (let i = 0; i < 30 && lines?.points[0] !== points; i += 1) {
                await sleep(1000);
                lines = await chartLines(extra.page);
            }
            await extra.page.waitForTimeout(1000);
            const now = await legend(extra.page);
            // The legend's time is the first sample's, within a second of the record's.
            const minutes = [saved.timestamp, saved.measurements[0]?.machine?.timestamp].map(t => String(t).slice(11, 16));
            check(`no recipe, shot ${n}: the graph draws it once Decaid has saved it`, lines?.points[0] === points, `${lines?.points[0]} points drawn, ${points} in the Shot`);
            check(`no recipe, shot ${n}: the legend names it "Last shot", with its time and barista`,
                now.label === 'Last shot' && minutes.some(m => (now.when || '').startsWith(`Today ${m}`)) && (now.when || '').endsWith(` · ${barista}`) && now.line === 'Pick a recipe to compare',
                JSON.stringify(now));
        }
        // The seam lists the newest Shots by limit alone; Streamline's own reads
        // name the page they want or the Shot by id.
        const read = urls.filter(url => url.pathname === '/api/v1/shots' && !url.searchParams.has('ids') && ['1', '100'].includes(url.searchParams.get('limit')));
        check('no recipe: the page reads no Shot through the Shot seam', read.length === 0, read.map(String).join(', '));
        check('no recipe: no page error', extra.seen.errors.length === 0, extra.seen.errors.join(' | '));
        await shot(extra.page, 'page-no-recipe-after-two-shots-light');
        await extra.close();
        await decaid('PUT', '/workflow', { context: { baristaName: null } });
    }
} catch (error) {
    check(`the run finished (${error.message.split('\n')[0]})`, false);
} finally {
    await browser.close();
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(failed.length ? 1 : 0);
