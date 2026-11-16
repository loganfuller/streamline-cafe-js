// Streamline Cafe's smoke run: the real page in a real Chromium against a real
// Decaid with a simulated machine. Run by hand before a release, not in CI.
// How to set Decaid up, and what this covers, is in docs/cafe/SMOKE.md.
//
//   node test/cafe-smoke/run.mjs --token=<Decaid's extensions token>
//   node test/cafe-smoke/run.mjs --token=... --base=http://127.0.0.1:13999 --decaid=http://127.0.0.1:8080
//   node test/cafe-smoke/run.mjs --token=... --headed
//
// It changes the Decaid it is pointed at: it removes and reinstalls DYE2,
// switches Streamline's "DYE2 on" setting, writes made-up beans, a grinder and
// recipes, and pulls simulated shots. Point it at a throwaway Decaid only.

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BEANS, GRINDER, RECIPES } from './sample-data.mjs';
import { MIN_DYE2_VERSION, DYE2_PLUGIN_ID } from '../../src/cafe/dye2-gate.js';
import { compareVersions } from '../../src/modules/skin-version.js';

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
const API = `${DECAID}/api/v1`;
const SETTING = `${API}/store/streamlineSettings/streamline.dye2Enabled`;

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
    // is the fixture's write, not the skin's: the skin's writer is a later ticket.
    const rows = await decaid('GET', `/store/${DYE2_PLUGIN_ID}/recipes`);
    const next = rows.map(row => (ids[row.id]
        ? { ...row, name: ids[row.id].name, title: ids[row.id].name, stripSlot: ids[row.id].slot, showOnStreamlineDashboard: true }
        : row));
    await decaid('POST', `/store/${DYE2_PLUGIN_ID}/recipes`, next);
    note(`seeded ${RECIPES.length} recipes`);
}

const unloadRecipe = () => decaid('POST', `/plugins/${DYE2_PLUGIN_ID}/selection`, {});

async function pullShot(seconds) {
    await decaid('PUT', '/machine/state/espresso');
    await sleep(seconds * 1000);
    await decaid('PUT', '/machine/state/idle');
}

// ── Browser ──────────────────────────────────────────────────────────────────

const browser = await chromium.launch({ headless: !HEADED });

// A page with nothing in its own storage. With `machineButtons: false` the
// machine reports buttons of its own, which the simulated machine never does, so
// that one answer is rewritten on the way in.
async function openPage({ theme = 'light', machineButtons = true } = {}) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1200 } });
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
    await page.goto(`${BASE}/index.html`);
    return { page, seen, close: () => context.close() };
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
        check(`slot ${slot} is an outline reading "Slot ${slot}", and not a button`,
            (await cards.nth(slot - 1).textContent()) === `Slot ${slot}` && (await cards.nth(slot - 1).evaluate(e => e.tagName)) === 'DIV');
    }
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
    check('the column is labelled "Dial-in · saved to the recipe"', (await page.locator('#cafe-dial-label').textContent()) === 'Dial-in · saved to the recipe');
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

    // 7. Stepping a value, by tap and by hold, and typing one.
    await page.locator('#dose-in-plus').click();
    const stepped = parseFloat(await page.locator('#dose-in-value').textContent());
    check('+ steps the dose once', stepped > held.dose && stepped <= held.dose + 1, `${held.dose}g to ${stepped}g`);
    await page.waitForTimeout(2500);
    check('the step reaches the Workflow', Math.abs((await decaid('GET', '/workflow')).context.targetDoseWeight - stepped) < 0.001);
    //    "Saved to the recipe": DYE2 saves a change only when asked, and the page asks.
    await page.waitForTimeout(3000);
    check('the step is saved onto the recipe in DYE2\'s records', (await recordOf(target)).dashboardVariables.dose === stepped, `record dose ${(await recordOf(target)).dashboardVariables.dose}`);
    const flushBefore = parseFloat(await page.locator('#flush-value').textContent());
    const plus = await page.locator('#flush-plus').boundingBox();
    await page.mouse.move(plus.x + plus.width / 2, plus.y + plus.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1200);
    await page.mouse.up();
    await page.waitForTimeout(300);
    const flushAfter = parseFloat(await page.locator('#flush-value').textContent());
    check('holding + repeats', flushAfter - flushBefore >= 4, `${flushBefore}s to ${flushAfter}s`);
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
    await shot(page, 'page-shot-running-light');
    await shotRun;
    await page.locator('#history-date').filter({ hasText: /\d{4}\/\d{2}\/\d{2}/ }).waitFor({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(4000);
    check('after the shot the status reads Ready', (await page.locator('#machine-status').textContent()).trim() === 'Ready', await page.locator('#machine-status').textContent());
    check('the weight readout goes when the shot ends', !(await page.locator('#cafe-live').isVisible()));
    check('the legend shows the latest Shot\'s label and time', (await page.locator('#shot-history-info .cafe-legend-name').isVisible()) && /\d{2}:\d{2}$/.test(await page.locator('#history-date').textContent()));
    await shot(page, 'page-after-shot-light');

    // 9. The full-screen chart, and back.
    await page.locator('#plotly-chart').click();
    await page.locator('#main-page.chart-zoomed').waitFor({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    check('a tap on the graph opens the full-screen chart', await page.locator('#expanded-chart').isVisible());
    await shot(page, 'page-chart-full-screen-light');
    await page.locator('#expanded-chart').click();
    await page.waitForTimeout(800);
    check('a tap on it comes back', (await page.locator('#shot-settings').isVisible()) && (await page.locator('#plotly-chart').isVisible()));

    //     A change made just before another recipe is tapped is written, and
    //     saved onto the recipe it was made on, before that recipe loads. Then
    //     back: the first recipe comes back with what was saved.
    const other = RECIPES[3];
    const flowStart = parseFloat(await page.locator('#steam-flow-value').textContent());
    await page.locator(flowStart >= 2 ? '#cafe-steam-minus' : '#cafe-steam-plus').click();
    const flowStepped = parseFloat(await page.locator('#steam-flow-value').textContent());
    await page.locator('#flush-plus').click();
    const flushStepped = parseFloat(await page.locator('#flush-value').textContent());
    await cards.nth(other.slot - 1).click();
    await page.locator('#cafe-title').filter({ hasText: other.name }).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(5000);
    const left = (await recordOf(target)).dashboardVariables;
    check('a change made just before another recipe is tapped is saved onto the recipe it was made on',
        left.steamFlowMls === flowStepped && left.flushS === flushStepped, `steam flow ${left.steamFlowMls} (stepped to ${flowStepped}), flush ${left.flushS} (stepped to ${flushStepped})`);
    check('and the recipe then loaded keeps its own flush', (await recordOf(other)).dashboardVariables.flushS === (await decaid('GET', '/workflow')).rinseData.duration,
        `record ${(await recordOf(other)).dashboardVariables.flushS}, Workflow ${(await decaid('GET', '/workflow')).rinseData.duration}`);
    await cards.nth(target.slot - 1).click();
    await page.locator('#cafe-title').filter({ hasText: target.name }).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(5000);
    check('coming back to a recipe brings back what was saved onto it',
        parseFloat(await page.locator('#dose-in-value').textContent()) === stepped && parseFloat(await page.locator('#flush-value').textContent()) === flushStepped,
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

    // 11. The remaining screenshots: dark, and a machine with buttons of its own.
    for (const [name, options] of [
        ['page-recipe-dark', { theme: 'dark' }],
        ['page-recipe-own-buttons-light', { machineButtons: false }],
        ['page-recipe-own-buttons-dark', { theme: 'dark', machineButtons: false }],
    ]) {
        const extra = await openPage(options);
        await waitForPage(extra.page, extra.seen.theme);
        await extra.page.locator('#history-date').filter({ hasText: /\d/ }).waitFor({ timeout: 20_000 }).catch(() => {});
        await extra.page.waitForTimeout(4000);
        if (options.machineButtons === false) {
            check(`${name}: no machine buttons, and Settings and Sleep at the bottom of the dial-in column`,
                !(await extra.page.locator('#ghc-controls').isVisible()) && (await extra.page.locator('#shot-settings #settings-btn').isVisible()) && (await extra.page.locator('#shot-settings #sleep-button').isVisible()));
        }
        check(`${name}: no page error`, extra.seen.errors.length === 0, extra.seen.errors.join(' | '));
        await shot(extra.page, name);
        await extra.close();
    }
    await unloadRecipe();
    {
        const extra = await openPage({ theme: 'dark' });
        await waitForPage(extra.page, 'dark');
        await extra.page.waitForTimeout(4000);
        check('page-no-recipe-dark: the title reads "No recipe selected"', (await extra.page.locator('#cafe-title').textContent()) === 'No recipe selected');
        await shot(extra.page, 'page-no-recipe-dark');
        await extra.close();
    }
} catch (error) {
    check(`the run finished (${error.message.split('\n')[0]})`, false);
} finally {
    await browser.close();
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(failed.length ? 1 : 0);
