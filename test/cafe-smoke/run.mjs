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
// It changes the Decaid it is pointed at: it removes and reinstalls DYE2,
// switches Streamline's "DYE2 on" setting, writes made-up beans, grinders and
// recipes, makes recipes and moves them between slots from the page, chooses
// grinders from the page, changes the language, sets the barista, puts the
// machine to sleep and wakes it, and pulls simulated shots. Point it at a throwaway Decaid only.

import { chromium } from 'playwright';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BEANS, GRINDER, SECOND_GRINDER, ARCHIVED_GRINDER, RECIPES, BARISTAS, MORE_BATCHES, BASKETS } from './sample-data.mjs';
import { sleep, decaidClient, paint, legend, chartLines, countDraws, row, keys, sides, stageNames, remarks, noteDialog, legendFits, REFERENCE_LINES, shotsHeader } from './page-helpers.mjs';
import { MIN_DYE2_VERSION, DYE2_PLUGIN_ID } from '../../src/cafe/dye2-gate.js';
import { compareVersions } from '../../src/modules/skin-version.js';
import { SUPPORTED_LANGUAGES } from '../../src/modules/i18n-parser.js';
import { isUnfinished, shotRecipeId, shotCurves } from '../../src/cafe/shot-model.js';
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
// One step alone, by name, on a Decaid a whole run has already set up.
const ONLY = flag('only', '');
// A shell command that starts Decaid again, for step 25's check across a restart.
const API = `${DECAID}/api/v1`;
const SETTING = `${API}/store/streamlineSettings/streamline.dye2Enabled`;
const STRIP_MODE = '/store/streamlineSettings/streamline.dyeStripMode';
// The cafe page's own state: the choice of reference, and the graph's view.
const REFERENCES = '/store/streamlineCafe/references';
const GRAPH_VIEW = '/store/streamlineCafe/graphView';
const RECIPE_STORE = `/store/${DYE2_PLUGIN_ID}/recipes`;
// How long the stand-in for Decent Sync's plugin takes to connect, in its cold start.
const COLD_START_MS = 8000;

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
        // batch and no baskets with ids, and step 20 measures those dialogs.
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
// they were added, and step 22 makes sure of them again. DYE2's basket list is the fixture's write, as DYE2's
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

// Shots added through Decaid's own data import, for the Shots list's second
// page: copies of a Shot this run pulled, with ids of their own, set back in
// time, and with the recipe, rating and note each copy is given. The archive
// is the shape Decaid's own export writes: metadata and a list of Shots.
const LIST_SHOT = n => `cafe-smoke-list-${String(n).padStart(2, '0')}`;
// A time as Decaid writes it: the container's local time with no offset.
function decaidTime(date) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
        .formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.000`;
}
async function importShots(shots) {
    const dir = await mkdtemp(join(tmpdir(), 'cafe-smoke-'));
    try {
        await writeFile(join(dir, 'metadata.json'), JSON.stringify({ formatVersion: 1 }));
        await writeFile(join(dir, 'shots.json'), JSON.stringify(shots));
        execFileSync('zip', ['-j', '-q', join(dir, 'import.zip'), join(dir, 'metadata.json'), join(dir, 'shots.json')]);
        const res = await fetch(`${API}/data/import?onConflict=overwrite`, { method: 'POST', headers: { 'Content-Type': 'application/zip', Authorization: `Bearer ${TOKEN}` }, body: await readFile(join(dir, 'import.zip')) });
        // A part of the archive refused is a 207.
        if (res.status !== 200) throw new Error(`the import answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
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
// A request the run intercepts and sends on itself is sent from Node, past the
// browser's mapping, so it is pointed at the same Decaid here.
const sendOn = route => route.fetch({ url: route.request().url().replace(`http://${PAGE_DECAID}/`, `${new URL(DECAID).origin}/`) });

// A page with nothing in its own storage. With `machineButtons: false` the
// machine reports buttons of its own, which the simulated machine never does, so
// that one answer is rewritten on the way in. `decentSync` stands in for Decent
// Sync's plugin, which this Decaid does not have: its entry in the plugin list
// and its Status answer, `served` or a refusal's code.
//
// `machine`: a `machineFeed()` the page's machine socket goes through, for a
// Preheat longer than the simulated machine's (step 26).
async function openPage({ theme = 'light', machineButtons = true, decentSync = null, weights = false, viewport = { width: 1920, height: 1200 }, machine = null } = {}) {
    const context = await browser.newContext({ viewport, timezoneId: TIMEZONE });
    const page = await context.newPage();
    const seen = { errors: [], requests: [], theme };
    page.on('pageerror', error => seen.errors.push(error.message));
    page.on('request', request => seen.requests.push(`${request.method()} ${new URL(request.url()).pathname}`));
    if (machine) await page.routeWebSocket(/\/ws\/v1\/machine\/snapshot$/, socket => machine.attach(socket));
    if (!machineButtons) {
        await page.route('**/api/v1/machine/info', async route => {
            const response = await sendOn(route);
            await route.fulfill({ response, json: { ...(await response.json()), GHC: true } });
        });
    }
    if (weights) {
        await page.route(/\/api\/v1\/shots\/[^/?]+$/, async route => {
            const response = await sendOn(route);
            if (!response.ok()) return route.fulfill({ response });
            return route.fulfill({ response, json: withWeights(await response.json()) });
        });
    }
    if (decentSync) {
        await page.route('**/api/v1/plugins', async route => {
            const response = await sendOn(route);
            // In place of the real one, where the second run left it switched off.
            const others = (await response.json()).filter(plugin => plugin.id !== 'decent-sync.reaplugin');
            await route.fulfill({ response, json: [...others, { id: 'decent-sync.reaplugin', name: 'Decent Sync', version: '1.10.0', loaded: true, autoLoad: true, api: [] }] });
        });
        // 'coldStart': not connected yet, and served once the plugin says its
        // connection came, a few seconds after the page opened its socket.
        let connected = false;
        const served = { status: 200, json: { connected: true, served: true, machine: { id: 'sample-machine', name: 'Sample Machine' }, location: { id: 'sample-location', name: 'Sample Cafe' } } };
        const refused = code => ({ status: code === 'unreachable' ? 503 : 409, json: { connected: code !== 'unreachable', served: false, machine: null, location: null, code, message: 'Sample refusal.' } });
        await page.route('**/api/v1/plugins/decent-sync.reaplugin/status', route => {
            if (decentSync === 'served') return route.fulfill(served);
            if (decentSync === 'coldStart') return route.fulfill(connected ? served : refused('unreachable'));
            return route.fulfill(refused(decentSync));
        });
        // The stand-in has no Reference Shot for any recipe, and no copy of one
        // while it is not connected. Its socket pushes nothing, but for the
        // cold start's one push.
        await page.route(/\/api\/v1\/plugins\/decent-sync\.reaplugin\/reference\?/, route => {
            if (decentSync === 'coldStart' && !connected) return route.fulfill({ status: 503, json: { code: 'unreachable', message: 'Sample refusal.' } });
            return route.fulfill({ status: 200, json: { recipe: null, reference: null, source: 'server' } });
        });
        await page.routeWebSocket(/\/ws\/v1\/plugins\/decent-sync\.reaplugin\/changes$/, socket => {
            if (decentSync !== 'coldStart') return;
            setTimeout(() => {
                connected = true;
                socket.send(JSON.stringify({ what: 'connection', connected: true }));
            }, COLD_START_MS);
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
// The page looks again, as when it comes back into view: Shots have no push.
const lookAgain = async page => {
    await page.evaluate(() => document.dispatchEvent(new Event('streamline:mainpagevisible')));
    await page.waitForTimeout(1500);
};
const star = (page, n) => page.locator('#cafe-stars .cafe-star').nth(n - 1).click();
const noteBox = page => page.locator('#cafe-note-text');
const closed = page => page.locator('#cafe-note-dialog:not([open])').waitFor({ state: 'attached', timeout: 5000 }).then(() => true, () => false);
const FINISHED_LANGUAGES = SUPPORTED_LANGUAGES.filter(code => code !== 'en' && !code.includes('unfinished'));

// Rating and notes, on a page whose graph shows `latest` against the reference
// `reference`, two of the tablet's own Shots, with no Decent Sync: the edit is
// Decaid's own.
async function ratingAndNotes(page, latest, reference, seen) {
    const errorsBefore = seen.errors.length;
    const record = id => decaid('GET', `/shots/${id}`);
    const others = annotations => JSON.stringify(Object.fromEntries(Object.entries(annotations || {}).filter(([key]) => !['enjoyment', 'espressoNotes'].includes(key)).sort()));
    const edits = [];
    const listen = request => { if (request.method() === 'PUT' && /\/api\/v1\/shots\//.test(request.url())) edits.push(request.postData()); };
    page.on('request', listen);
    const SHOT_EDIT = /\/api\/v1\/shots\/[^/?]+$/;
    const failing = route => (route.request().method() === 'PUT' ? route.abort() : route.fallback());

    //    The stars.
    let shown = await remarks(page);
    check('a saved Shot has five empty stars and a plus for its note; a reference with no rating and no note shows neither',
        JSON.stringify(shown) === JSON.stringify({ stars: [0, 0, 0, 0, 0], note: 'add', referenceRating: null, referenceNote: false }), JSON.stringify(shown));
    const before = await record(latest.id);
    await star(page, 4);
    await page.waitForTimeout(800);
    let saved = await record(latest.id);
    check('a tap on the fourth star rates the Shot four stars, at once', JSON.stringify((await remarks(page)).stars) === '[100,100,100,100,0]' && saved.annotations.enjoyment === 8, `${JSON.stringify(await remarks(page))} ${saved.annotations.enjoyment}`);
    check('the edit sent Decaid the rating alone, and the Shot\'s other annotations are untouched', edits.length === 1 && edits[0] === '{"annotations":{"enjoyment":8}}' && others(saved.annotations) === others(before.annotations) && !saved.annotations.espressoNotes, edits.join(' | '));
    await star(page, 4);
    await page.waitForTimeout(800);
    saved = await record(latest.id);
    check('a tap on the chosen star clears the rating, by sending 0', JSON.stringify((await remarks(page)).stars) === '[0,0,0,0,0]' && !(saved.annotations.enjoyment > 0) && edits[1] === '{"annotations":{"enjoyment":0}}', `${saved.annotations.enjoyment} ${edits[1]}`);
    //    A rating between two stars, as one given elsewhere.
    await decaid('PUT', `/shots/${latest.id}`, { annotations: { enjoyment: 7 } });
    await lookAgain(page);
    check('a rating given elsewhere shows at the page\'s next read, and 7 is drawn as three and a half stars', JSON.stringify((await remarks(page)).stars) === '[100,100,100,50,0]', JSON.stringify(await remarks(page)));
    await shot(page, 'rating-half-star-light');
    await star(page, 4);
    await page.waitForTimeout(800);
    check('on a Shot rated 7 a tap on the fourth star sets 8: only an exact match clears', (await record(latest.id)).annotations.enjoyment === 8 && JSON.stringify((await remarks(page)).stars) === '[100,100,100,100,0]');

    //    A rating that fails: the stars go back, and a toast says so.
    await page.route(SHOT_EDIT, failing);
    await star(page, 2);
    await page.locator('#app-toast').filter({ hasText: 'The rating could not be saved' }).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    check('a rating that could not be saved puts the stars back, and a toast says so',
        JSON.stringify((await remarks(page)).stars) === '[100,100,100,100,0]' && (await page.locator('#app-toast-message').textContent()) === 'The rating could not be saved' && (await record(latest.id)).annotations.enjoyment === 8,
        `${JSON.stringify((await remarks(page)).stars)} "${await page.locator('#app-toast-message').textContent()}"`);
    await page.unroute(SHOT_EDIT, failing);
    //    An edit Decaid made and whose answer was lost: it is read again first.
    const lost = async route => {
        if (route.request().method() !== 'PUT') return route.fallback();
        await sendOn(route);
        return route.abort();
    };
    await page.route(SHOT_EDIT, lost);
    await page.waitForTimeout(4500); // the toast above goes
    await star(page, 5);
    await page.waitForTimeout(1200);
    check('a rating Decaid made, whose answer never came, is read again and shown as made, with no toast',
        JSON.stringify((await remarks(page)).stars) === '[100,100,100,100,100]' && (await record(latest.id)).annotations.enjoyment === 10 && !(await page.locator('#app-toast').isVisible()), JSON.stringify(await remarks(page)));
    await page.unroute(SHOT_EDIT, lost);
    await star(page, 4);
    await page.waitForTimeout(800);

    //    The note.
    const NOTE = 'Sweet, a little thin.\nNext time: grind a step finer.';
    edits.length = 0;
    await page.locator('#cafe-shot-note').click();
    await page.waitForTimeout(400); // the dialog's box grows into place
    let dialog = await noteDialog(page);
    const row0 = await legend(page);
    check('the plus opens the Shot\'s note to write: it names the Shot as its row does, with a box labelled "Note", Cancel and "Save note"',
        !!dialog && dialog.title === 'Latest' && dialog.when === row0.when && dialog.label === 'Note' && dialog.text === '' && dialog.read === null
        && dialog.placeholder === 'How did it taste? What would you change next time?' && dialog.buttons.join() === 'Cancel,Save note' && dialog.error === null, JSON.stringify(dialog));
    await noteBox(page).fill(`  ${NOTE}  \n`);
    await shot(page, 'note-dialog-light');
    await paint(page, 'dark');
    await page.waitForTimeout(500);
    await shot(page, 'note-dialog-dark');
    await paint(page, 'light');
    //    The soft keyboard, which the run can't raise: Streamline's scaling says
    //    how much of the screen is left above one, and the dialog takes it.
    const scale = detail => page.evaluate(d => document.dispatchEvent(new CustomEvent('streamline:scaleupdate', { detail: d })), detail);
    await scale({ keyboardUp: true, visibleHeight: 400 });
    await page.waitForTimeout(300);
    const lifted = await noteDialog(page);
    await shot(page, 'note-dialog-above-keyboard-light');
    await scale({ keyboardUp: false, visibleHeight: 1200 });
    await page.waitForTimeout(300);
    const settled = await noteDialog(page);
    check('with a keyboard up the dialog sits in what is left above it, its text box giving up the height, with the box and both buttons in view; and it goes back after',
        lifted.box.top >= 0 && lifted.box.bottom <= 400 && lifted.boxHeight >= 72 && lifted.boxHeight < settled.boxHeight && settled.box.bottom > 400 && settled.box.bottom - settled.box.top > lifted.box.bottom - lifted.box.top,
        `${JSON.stringify(lifted.box)} box ${lifted.boxHeight}px, then ${JSON.stringify(settled.box)} box ${settled.boxHeight}px`);
    //    A save that takes a while: nothing can be typed into the box meanwhile,
    //    since only the text as it stood at the tap is saved.
    const slow = async route => {
        if (route.request().method() !== 'PUT') return route.fallback();
        await sleep(1500);
        return route.fallback();
    };
    await page.route(SHOT_EDIT, slow);
    await page.locator('#cafe-note-save').click();
    await page.waitForTimeout(400);
    const during = await page.evaluate(() => ({ open: document.getElementById('cafe-note-dialog').open, locked: document.getElementById('cafe-note-text').readOnly, save: document.getElementById('cafe-note-save').disabled, cancel: document.getElementById('cafe-note-cancel').disabled }));
    check('while a note is being saved the dialog stays, and its box and buttons take nothing', during.open && during.locked && during.save && during.cancel, JSON.stringify(during));
    check('"Save note" closes the dialog', await closed(page));
    await page.unroute(SHOT_EDIT, slow);
    check('and the box can be typed in again the next time', (await page.evaluate(() => document.getElementById('cafe-note-text').readOnly)) === false);
    saved = await record(latest.id);
    check('the note is saved trimmed, sent alone, and the rating is untouched', saved.annotations.espressoNotes === NOTE && saved.annotations.enjoyment === 8 && edits.length === 1 && edits[0] === JSON.stringify({ annotations: { espressoNotes: NOTE } }) && others(saved.annotations) === others(before.annotations), edits.join(' | '));
    check('the Shot\'s note icon is a page now, not a plus', (await remarks(page)).note === 'note', JSON.stringify(await remarks(page)));

    //    A note that fails to save is not lost.
    await page.locator('#cafe-shot-note').click();
    check('the icon opens the note that was saved, to edit', (await noteDialog(page))?.text === NOTE, JSON.stringify(await noteDialog(page)));
    await page.route(SHOT_EDIT, failing);
    await noteBox(page).fill(`${NOTE}\nAnd a line that will not save at first.`);
    await page.locator('#cafe-note-save').click();
    await page.locator('#cafe-note-error').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    dialog = await noteDialog(page);
    check('a note that could not be saved keeps the dialog open with its text, and a line says why',
        !!dialog && dialog.text === `${NOTE}\nAnd a line that will not save at first.` && dialog.error === 'The note could not be saved' && (await record(latest.id)).annotations.espressoNotes === NOTE, JSON.stringify(dialog));
    await shot(page, 'note-dialog-not-saved-light');
    await page.unroute(SHOT_EDIT, failing);
    await page.locator('#cafe-note-save').click();
    check('and saving again saves it', (await closed(page)) && (await record(latest.id)).annotations.espressoNotes === `${NOTE}\nAnd a line that will not save at first.`);
    //    Cancel changes nothing, a note saved as it was sends nothing, and an
    //    emptied note clears it.
    edits.length = 0;
    await page.locator('#cafe-shot-note').click();
    await noteBox(page).fill('Thrown away');
    await page.locator('#cafe-note-cancel').click();
    await closed(page);
    await page.locator('#cafe-shot-note').click();
    await page.locator('#cafe-note-save').click();
    check('Cancel changes nothing, and a note saved as it was sends nothing', (await closed(page)) && edits.length === 0 && (await record(latest.id)).annotations.espressoNotes.startsWith(NOTE), edits.join(' | '));
    await page.locator('#cafe-shot-note').click();
    await noteBox(page).fill('   ');
    await page.locator('#cafe-note-save').click();
    await closed(page);
    saved = await record(latest.id);
    check('an emptied note clears it, by sending empty text, and the icon is a plus again', !saved.annotations.espressoNotes && edits.join() === '{"annotations":{"espressoNotes":""}}' && (await remarks(page)).note === 'add' && saved.annotations.enjoyment === 8, `${JSON.stringify(saved.annotations.espressoNotes)} ${edits.join(' | ')}`);
    await page.locator('#cafe-shot-note').click();
    await noteBox(page).fill(NOTE);
    await page.locator('#cafe-note-save').click();
    await closed(page);

    //    The reference's row: its rating and its note, to read.
    const REFERENCE_NOTE = 'Syrupy body, stone fruit, long sweet finish.\nBeans eight days off roast.';
    await decaid('PUT', `/shots/${reference.id}`, { annotations: { enjoyment: 7, espressoNotes: REFERENCE_NOTE } });
    await lookAgain(page);
    shown = await remarks(page);
    check('the reference\'s row shows its rating as "★ 3.5", and a note icon', shown.referenceRating === '★ 3.5' && shown.referenceNote === true && JSON.stringify(shown.stars) === '[100,100,100,100,0]', JSON.stringify(shown));
    edits.length = 0;
    await page.locator('#cafe-reference-note').click();
    dialog = await noteDialog(page);
    check('the reference\'s note opens to read: when and who, its rating, the note as text, and only Close',
        !!dialog && dialog.title === 'Reference' && dialog.when === (await legend(page)).reference && dialog.rating === '★ 3.5' && dialog.read === REFERENCE_NOTE && dialog.text === null && dialog.label === null && dialog.buttons.join() === 'Close', JSON.stringify(dialog));
    await shot(page, 'note-reference-light');
    await page.locator('#cafe-note-close').click();
    check('Close closes it, and nothing was edited', (await closed(page)) && edits.length === 0);

    //    The row in English and every language Streamline has finished, at its
    //    fullest: the Shot's stars, its note and Make reference, the
    //    reference's rating and its note, the toggle, and a barista's name on
    //    both Shots; then with "Different profile" as well. The run gives both
    //    records a barista, and the reference another profile's title, itself:
    //    the two Shots were pulled on one profile with no barista set.
    const title = (await record(reference.id)).workflow?.profile?.title;
    const inEveryLanguage = async name => {
        const unfit = [];
        const cut = [];
        for (const code of ['en', ...FINISHED_LANGUAGES]) {
            await setLanguage(page, code);
            await page.waitForTimeout(700);
            const fit = await legendFits(page);
            if (fit.out.length || fit.times.length !== 2 || fit.names.length !== 2) unfit.push(`${code}: ${fit.out.join(', ') || 'a time or a name is missing'}`);
            if (fit.times.some(lack => lack >= 0.1)) cut.push(`${code} ${Math.max(...fit.times)}px`);
            if (code === 'de') await shot(page, `${name}-de-light`);
        }
        await setLanguage(page, 'en');
        await page.waitForTimeout(700);
        return { unfit, cut };
    };
    await decaid('PUT', `/shots/${latest.id}`, { workflow: { context: { baristaName: BARISTAS[1] } } });
    await decaid('PUT', `/shots/${reference.id}`, { workflow: { context: { baristaName: BARISTAS[0] } } });
    await lookAgain(page);
    let full = await legend(page);
    check('the row with everything but the flag: stars, a note, a barista and Make reference, and a reference with a rating, a barista and a note',
        full.make === 'Make reference' && full.flag === null && (full.when || '').includes(' · ') && (full.reference || '').includes(' · ') && (await remarks(page)).referenceNote, JSON.stringify(full));
    await shot(page, 'legend-full-light');
    let fits = await inEveryLanguage('legend-full');
    check(`that row fits in English and each of Streamline's ${FINISHED_LANGUAGES.length} finished languages: nothing runs past it, and only a barista's name is cut short, never a time`,
        fits.unfit.length === 0 && fits.cut.length === 0, [...fits.unfit, ...fits.cut.map(lack => `time cut: ${lack}`)].join(' | '));
    await decaid('PUT', `/shots/${reference.id}`, { workflow: { profile: { title: 'Sample other profile' } } });
    await lookAgain(page);
    full = await legend(page);
    check('the fullest row: the same with "Different profile"', full.make === 'Make reference' && full.flag === 'Different profile', JSON.stringify(full));
    await shot(page, 'legend-fullest-light');
    fits = await inEveryLanguage('legend-fullest');
    check('the fullest row still holds everything in each of those languages: nothing runs past it, and nothing but the names and the times is cut short', fits.unfit.length === 0, fits.unfit.join(' | '));
    note(fits.cut.length ? `with "Different profile" too, a time is cut short in: ${fits.cut.join(', ')}` : 'with "Different profile" too, no time is cut short');
    await decaid('PUT', `/shots/${reference.id}`, { workflow: { profile: { title }, context: { baristaName: null } } });
    await decaid('PUT', `/shots/${latest.id}`, { workflow: { context: { baristaName: null } } });
    await lookAgain(page);
    check('no page error from rating and notes', seen.errors.length === errorsBefore, seen.errors.slice(errorsBefore).join(' | '));
    page.off('request', listen);
}

const gateLine = page => page.locator('#cafe-gate-line');
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

const REST_REFERENCE = 'time firstDrip yield ratio peak';
const REST_TARGETS = 'time dose yield ratio peak';
const LIVE = 'time weight weightFlow flow pressure temperature';
const SIGNED = /^([+\u2212]\d|0\.0)/;
// The recipe a DYE2 selection names as loaded, or null for none: no marker, or
// a `recent:` favourite DYE2 matched the Workflow against.
const loadedRecipeId = selection => (selection?.kind === 'recipe' ? selection.id ?? null : null);
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

// 20. The dialogs at a tablet's size, 21. the Grind row's number, 22. the bean
//     and batch dialog and the basket dialog, 23. the barista at the machine and
//     25. the profile changed from the page are page tests now (test/page/:
//     dialog-sizes, grind-row, bean-basket-dialogs, barista and profile-change).

const grinderNamed = (grinders, model) => grinders.find(g => g && g.model === model) || null;

// 18. The grinder dialog is a page test now (test/page/grinder-dialog.spec.mjs).
//     Its grinders stay: the second run chooses the second one, and the dialogs'
//     sizes (step 20) are measured with more than one listed.
async function grinderFixtures() {
    const listed = await decaid('GET', '/grinders?includeArchived=true');
    const grinders = Array.isArray(listed) ? listed : listed.items || [];
    if (!grinderNamed(grinders, SECOND_GRINDER.model)) await decaid('POST', '/grinders', SECOND_GRINDER);
    const retired = grinderNamed(grinders, ARCHIVED_GRINDER.model) || await decaid('POST', '/grinders', ARCHIVED_GRINDER);
    if (!retired.archived) await decaid('PUT', `/grinders/${retired.id}`, { ...retired, archived: true });
}

const sorted = value => (value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value);
// ── A tap on the loaded card unloads it (#53) ────────────────────────────────

// On a page at 1920 by 1200 and on one at 1340 by 800: a tap on the loaded
// card unloads the recipe, with the machine set as it was; a step afterwards
// changes the Workflow and no DYE2 record; a tap on the card loads it as
// stored; a double tap on another card loads it; no card takes a tap during a
// shot; an unload tapped just after a pour leaves the Shot naming the recipe;
// and an unload DYE2 refuses is a toast with the card still highlighted.
async function unloadByTap() {
    const [house, single] = RECIPES;
    const selection = () => decaid('GET', `/plugins/${DYE2_PLUGIN_ID}/selection`);
    const loadedId = async () => loadedRecipeId(await selection());
    // What the machine is set to, without the marker that says which recipe is loaded.
    const settings = async () => {
        const wf = await decaid('GET', '/workflow');
        const { extras, ...context } = wf.context;
        const { dye, ...rest } = extras || {};
        return JSON.stringify({ profile: wf.profile.title, context, rest, steam: wf.steamSettings, water: wf.hotWaterData, rinse: wf.rinseData });
    };
    const waitFor = async (test, ms = 15_000) => {
        for (let waited = 0; waited < ms; waited += 250) {
            if (await test()) return true;
            await sleep(250);
        }
        return false;
    };
    for (const viewport of [{ width: 1920, height: 1200 }, { width: 1340, height: 800 }]) {
        const size = `${viewport.width}x${viewport.height}`;
        await decaid('PUT', '/machine/state/idle').catch(() => {});
        await unloadRecipe();
        const view = await openPage({ viewport });
        const { page, seen } = view;
        try {
            await waitForPage(page);
            await page.waitForTimeout(2500);
            const card = recipe => page.locator('#cafe-strip .cafe-card').nth(recipe.slot - 1);
            const title = () => page.locator('#cafe-title').textContent();
            const pressed = () => page.locator('#cafe-strip [aria-pressed="true"]').count();
            const toastShown = () => page.locator('#app-toast').isVisible();
            const loadCard = async recipe => {
                await card(recipe).click();
                await page.locator('#cafe-title').filter({ hasText: recipe.name }).waitFor({ timeout: 20_000 });
                await page.waitForTimeout(3000);
            };
            await loadCard(house);
            const record = await recordNamed(house.name);
            check(`unload ${size}: the recipe is loaded before the tap`, (await loadedId()) === record.id && (await pressed()) === 1, `${await loadedId()}`);
            await shot(page, `unload-before-${size}-light`);

            //     The tap: only the marker is cleared, and the page is the no-recipe page.
            const before = await settings();
            const doseShown = await page.locator('#dose-in-value').textContent();
            const writesFrom = seen.requests.length;
            await card(house).click();
            await page.locator('#cafe-title').filter({ hasText: 'No recipe selected' }).waitFor({ timeout: 10_000 }).catch(() => {});
            await page.waitForTimeout(2500);
            check(`unload ${size}: a tap on the loaded card unloads it: DYE2's selection names no recipe`, (await loadedId()) === null, JSON.stringify(await selection()));
            check(`unload ${size}: the page is the no-recipe page`,
                (await title()) === 'No recipe selected' && (await page.locator('#cafe-subtitle').textContent()) === 'Tap a recipe to load it'
                && (await page.locator('#cafe-dial-label').textContent()) === 'Dial-in · not saved to a recipe' && (await pressed()) === 0,
                `${await title()} | ${await page.locator('#cafe-subtitle').textContent()} | ${await page.locator('#cafe-dial-label').textContent()} | ${await pressed()} filled`);
            check(`unload ${size}: the graph shows "Last shot"`, (await legend(page)).label === 'Last shot', (await legend(page)).label);
            check(`unload ${size}: the machine is set as it was, and the steppers show it`, (await settings()) === before && (await page.locator('#dose-in-value').textContent()) === doseShown);
            const unloadWrites = seen.requests.slice(writesFrom).filter(r => /^PUT .*\/workflow$|^POST .*dye2\.reaplugin\/(record|save-recipe)$|^POST .*\/store\/dye2/.test(r));
            check(`unload ${size}: the page wrote no Workflow and no record: DYE2 cleared the marker`, unloadWrites.length === 0, unloadWrites.join(', '));
            check(`unload ${size}: it asked nothing first and showed no toast`, !(await toastShown()) && !(await page.locator('dialog[open]').count()));
            await shot(page, `unload-after-${size}-light`);

            //     A step afterwards changes this machine only.
            const recordBefore = JSON.stringify(await recordNamed(house.name));
            const dose = parseFloat(await page.locator('#dose-in-value').textContent());
            await page.locator('#dose-in-plus').click();
            const stepped = parseFloat(await page.locator('#dose-in-value').textContent());
            await page.waitForTimeout(5000);
            check(`unload ${size}: a step afterwards reaches the Workflow`, stepped > dose && Math.abs((await decaid('GET', '/workflow')).context.targetDoseWeight - stepped) < 0.001, `${dose}g to ${stepped}g`);
            check(`unload ${size}: and the recipe's DYE2 record did not change`, JSON.stringify(await recordNamed(house.name)) === recordBefore);

            //     A tap on the card loads the recipe as stored, over the step.
            const held = (await recordNamed(house.name)).dashboardVariables;
            await loadCard(house);
            const workflow = await decaid('GET', '/workflow');
            check(`unload ${size}: a tap on the unloaded card loads it as stored`,
                (await loadedId()) === record.id && workflow.context.targetDoseWeight === held.dose && workflow.context.targetYield === held.drink
                && (await page.locator('#dose-in-value').textContent()) === `${held.dose}g` && (await card(house).getAttribute('aria-pressed')) === 'true',
                `${workflow.context.targetDoseWeight}g / ${workflow.context.targetYield}g, selection ${await loadedId()}`);

            //     A double tap on another card loads it.
            await card(single).dblclick();
            await page.locator('#cafe-title').filter({ hasText: single.name }).waitFor({ timeout: 20_000 }).catch(() => {});
            await page.waitForTimeout(4000);
            const singleId = (await recordNamed(single.name)).id;
            check(`unload ${size}: a double tap on a card leaves its recipe loaded`,
                (await loadedId()) === singleId && (await title()) === single.name && (await card(single).getAttribute('aria-pressed')) === 'true',
                `${await title()}, selection ${await loadedId()}`);

            //     During a shot no card takes a tap.
            const duringBefore = { settings: await settings(), loaded: await loadedId() };
            const running = pullShot(8);
            await page.locator('#main-page.cafe-shot-live').waitFor({ timeout: 20_000 }).catch(() => {});
            await page.waitForTimeout(500);
            await card(single).click();
            await card(house).click();
            await page.waitForTimeout(1500);
            check(`unload ${size}: while a shot runs a tap on the loaded card and on another change nothing`,
                (await page.locator('#main-page.cafe-shot-live').count()) === 1 && (await loadedId()) === duringBefore.loaded
                && (await settings()) === duringBefore.settings && (await title()) === single.name && (await card(single).getAttribute('aria-pressed')) === 'true',
                `${await title()}, selection ${await loadedId()}`);
            await running;
            await page.locator('#main-page:not(.cafe-shot-live)').waitFor({ timeout: 20_000 }).catch(() => {});
            await page.waitForTimeout(6000);

            //     An unload tapped just after a pour waits for the Shot to be
            //     stored, and the Shot names the recipe.
            const newestBefore = ((await decaid('GET', '/shots?limit=1')).items || [])[0]?.id;
            await decaid('PUT', '/machine/state/espresso');
            await page.locator('#main-page.cafe-shot-live').waitFor({ timeout: 20_000 }).catch(() => {});
            await sleep(6000);
            await decaid('PUT', '/machine/state/idle');
            await page.locator('#main-page:not(.cafe-shot-live)').waitFor({ timeout: 20_000 }).catch(() => {});
            await card(single).click();
            await page.waitForTimeout(800);
            const waiting = { shown: await pressed(), loaded: await loadedId() };
            let newest = null;
            await waitFor(async () => {
                newest = ((await decaid('GET', '/shots?limit=1')).items || [])[0];
                return newest && newest.id !== newestBefore;
            }, 20_000);
            const stored = newest && newest.id !== newestBefore ? await decaid('GET', `/shots/${newest.id}`) : null;
            const unloaded = await waitFor(async () => (await loadedId()) === null, 15_000);
            check(`unload ${size}: tapped just after a pour, the highlight leaves at once and DYE2 still names the recipe while the Shot is stored`,
                waiting.shown === 0 && waiting.loaded === singleId, JSON.stringify(waiting));
            check(`unload ${size}: the Shot just pulled names the recipe`, !!stored && shotRecipeId(stored.workflow) === String(singleId), `${stored?.id}: ${shotRecipeId(stored?.workflow)}`);
            check(`unload ${size}: and the recipe is unloaded once the Shot is stored`, unloaded && (await title()) === 'No recipe selected', `${await title()}, selection ${await loadedId()}`);

            //     An unload DYE2 refuses: a toast, and the card highlighted again.
            await loadCard(house);
            await page.route(`**/api/v1/plugins/${DYE2_PLUGIN_ID}/selection`, route => (route.request().method() === 'POST'
                ? route.fulfill({ status: 500, body: 'Sample refusal.' }) : route.fallback()));
            await card(house).click();
            await page.locator('#app-toast').filter({ hasText: `Could not unload ${house.name}` }).waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
            check(`unload ${size}: an unload DYE2 refuses shows "Could not unload ${house.name}"`,
                (await page.locator('#app-toast-message').textContent()) === `Could not unload ${house.name}`, await page.locator('#app-toast-message').textContent());
            await page.waitForTimeout(1500);
            check(`unload ${size}: and the card is highlighted with the recipe still loaded`,
                (await card(house).getAttribute('aria-pressed')) === 'true' && (await title()) === house.name && (await loadedId()) === record.id,
                `${await title()}, selection ${await loadedId()}`);
            await shot(page, `unload-refused-${size}-light`);
            await page.unroute(`**/api/v1/plugins/${DYE2_PLUGIN_ID}/selection`);
            check(`unload ${size}: no page error`, seen.errors.length === 0, seen.errors.join(' | '));
        } finally {
            await view.close();
        }
    }
    // As the run leaves it: no recipe loaded.
    await unloadRecipe();
}

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

    // 8. A shot with the recipe loaded, which the reference's checks below
    //    start from. What the page shows during it and once it is stored is a
    //    page test now (test/page/live-shot.spec.mjs, once step 7 in SMOKE.md).
    await pullShot(14);
    await page.locator('#cafe-shot-when').filter({ hasText: /\d{2}:\d{2}/ }).waitFor({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(4000);

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
        let cardsNow;

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

        //    A second shot, with the reference behind it. It runs longer than the
        //    first: the simulated machine can pull two shots of one length alike
        //    to the last sample, and the renderer then takes the reference's
        //    line for the Shot's own when it places the end labels.
        const second = pullShot(16);
        await page.locator('#main-page.cafe-shot-live').waitFor({ timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(6000);
        now = await legend(page);
        lines = await chartLines(page);
        check('during a shot the row reads "Live shot", the reference has its own row, and nothing can be chosen', now.label === 'Live shot' && now.when === null && /^Today /.test(now.reference || '') && now.make === null && now.badge === null, JSON.stringify(now));
        check('a running shot has no stars and no note icon', (await remarks(page)).stars === null && (await remarks(page)).note === null, JSON.stringify(await remarks(page)));
        check('the reference is drawn behind the live shot', lines.points[7] > 10 && lines.points[0] > 5 && lines.names.length === 10, JSON.stringify(lines));
        check('the time axis shows the whole reference from the start, at its length as at rest', Math.abs(lines.end - liveEnd(lines.referenceEnd)) < 0.01, `${lines.end} for a reference of ${lines.referenceEnd} s`);
        check('during a shot its own four lines are named, and no target or reference line (issue #66)', lines.labelled.join() === OWN_LABELLED, JSON.stringify(lines.labelled));
        cardsNow = await row(page);
        check('live, in Reference: Time says how long the reference ran, and each card sits beside the reference at the same second, with the difference',
            cardsNow.mode === 'live' && keys(cardsNow) === LIVE && /^Ref ran \d+\.\d s$/.test(cardsNow.cards[0].side) && cardsNow.cards[0].diff === ''
            && /^Ref \d+\.\d bar$/.test(cardsNow.cards[4].side) && SIGNED.test(cardsNow.cards[4].diff) && /^Ref \d+\.\d ml\/s$/.test(cardsNow.cards[3].side) && SIGNED.test(cardsNow.cards[3].diff)
            && /^Ref \d+\.\d °C$/.test(cardsNow.cards[5].side), JSON.stringify(cardsNow));
        //    Frames are appended: the chart is not drawn again in full for each.
        const drawn = await countDraws(page, 3000);
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

        //    Rating and notes, for the Shot in the graph and its reference.
        await ratingAndNotes(page, latestShot, first, seen);
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
        // The recipe DYE2's selection names, or null. With no recipe loaded DYE2
        // may answer a `recent:` favourite it matched the Workflow against,
        // which names no recipe.
        const selectionId = async () => loadedRecipeId(await decaid('GET', `/plugins/${DYE2_PLUGIN_ID}/selection`));
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
    //     The skin loaded before the plugin had connected: its answers say
    //     nothing either way, until it says its connection came, and the page
    //     asks again then, without waiting for focus.
    {
        const extra = await openPage({ decentSync: 'coldStart' });
        await waitForPage(extra.page);
        await extra.page.waitForTimeout(3000);
        check('Decent Sync not connected yet: the column reads "not saved" until an answer comes', (await extra.page.locator('#cafe-dial-label').textContent()) === 'Dial-in · not saved to the recipe');
        //     Whether the Machine is served is not known yet either: the latest
        //     Shot alone, and the choice kept on the tablet is not read.
        const before = await legend(extra.page);
        check('Decent Sync not connected yet: the latest Shot alone, with no reference and no Make reference, and a line saying why',
            before.label === 'Latest' && before.reference === null && before.badge === null && before.make === null
            && before.notice === "Decent Sync can't be reached, so the reference can't be shown" && !extra.seen.requests.some(r => r.includes(REFERENCES)), JSON.stringify(before));
        await extra.page.locator('#cafe-dial-label').filter({ hasText: 'Dial-in · saved to the recipe' }).waitFor({ timeout: 45_000 }).catch(() => {});
        check('and the page asks again when the plugin says it has connected: the column then reads "saved to the recipe"', (await extra.page.locator('#cafe-dial-label').textContent()) === 'Dial-in · saved to the recipe', await extra.page.locator('#cafe-dial-label').textContent());
        await extra.page.waitForTimeout(1500);
        const after = await legend(extra.page);
        check('and Make reference is there once the Machine is known to be served, with Decent Sync asked for the reference', after.make === 'Make reference' && !after.muted && after.notice === null
            && extra.seen.requests.some(r => r === 'GET /api/v1/plugins/decent-sync.reaplugin/reference') && !extra.seen.requests.some(r => r.includes(REFERENCES)), JSON.stringify(after));
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
            // The browser's own English writes the hour on a twelve-hour clock.
            const minutes = [saved.timestamp, saved.measurements[0]?.machine?.timestamp].map(t => String(t).slice(11, 16))
                .flatMap(time => [time, `${String(Number(time.slice(0, 2)) % 12 || 12).padStart(2, '0')}${time.slice(2)}`]);
            check(`no recipe, shot ${n}: the graph draws it once Decaid has saved it`, lines?.points[0] === points, `${lines?.points[0]} points drawn, ${points} in the Shot`);
            check(`no recipe, shot ${n}: the legend names it "Last shot", with its time and barista`,
                now.label === 'Last shot' && minutes.some(m => (now.when || '').startsWith(`Today ${m}`)) && (now.when || '').endsWith(` · ${barista}`) && now.line === 'Pick a recipe to compare',
                JSON.stringify(now));
            //     "Last shot" is rated and noted too: the page learns its record
            //     from the tablet's newest Shot.
            await extra.page.locator('#cafe-stars').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
            check(`no recipe, shot ${n}: "Last shot" has empty stars and a plus once its record is known`, JSON.stringify(await remarks(extra.page)) === JSON.stringify({ stars: [0, 0, 0, 0, 0], note: 'add', referenceRating: null, referenceNote: false }), JSON.stringify(await remarks(extra.page)));
            const ratingBefore = before ? (await decaid('GET', `/shots/${before}`)).annotations?.enjoyment : undefined;
            await star(extra.page, n + 2);
            await extra.page.waitForTimeout(800);
            check(`no recipe, shot ${n}: a tap rates the Shot drawn, and not the one before it`, (await decaid('GET', `/shots/${newest.id}`)).annotations.enjoyment === (n + 2) * 2
                && (!before || (await decaid('GET', `/shots/${before}`)).annotations?.enjoyment === ratingBefore), `${(await decaid('GET', `/shots/${newest.id}`)).annotations.enjoyment}`);
            if (n === 2) {
                await extra.page.locator('#cafe-shot-note').click();
                const dialog = await noteDialog(extra.page);
                await noteBox(extra.page).fill('No recipe, and noted all the same.');
                await extra.page.locator('#cafe-note-save').click();
                check('no recipe: the note\'s dialog names it "Last shot", and the note is saved on the Shot drawn',
                    (await closed(extra.page)) && dialog?.title === 'Last shot' && dialog.when === now.when && (await decaid('GET', `/shots/${newest.id}`)).annotations.espressoNotes === 'No recipe, and noted all the same.' && (await remarks(extra.page)).note === 'note', JSON.stringify(dialog));
            }
        }
        // The seam lists the newest Shots by limit alone; Streamline's own reads
        // name the page they want or the Shot by id. With no recipe the seam is
        // asked for the newest Shot only, for its rating and note, never for a
        // recipe's latest among the newest 100.
        const read = urls.filter(url => url.pathname === '/api/v1/shots' && !url.searchParams.has('ids') && ['1', '100'].includes(url.searchParams.get('limit')));
        check('no recipe: the page asks the Shot seam for the newest Shot only, for its rating and note', read.length > 0 && read.every(url => url.searchParams.get('limit') === '1'), read.map(String).join(', '));
        check('no recipe: no page error', extra.seen.errors.length === 0, extra.seen.errors.join(' | '));
        await shot(extra.page, 'page-no-recipe-after-two-shots-light');
        await extra.page.reload();
        await waitForPage(extra.page);
        await extra.page.locator('#cafe-stars').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
        check('no recipe: after a reload "Last shot" shows the rating and the note it was given', JSON.stringify((await remarks(extra.page)).stars) === '[100,100,100,100,0]' && (await remarks(extra.page)).note === 'note', JSON.stringify(await remarks(extra.page)));
        await extra.close();
        await decaid('PUT', '/workflow', { context: { baristaName: null } });
    }

    // 17. The Shots list (docs/cafe/DESIGN.md, "The Shots list"), from the
    //     tablet's own Shots: the list, a page at a time, a Shot of the loaded
    //     recipe and one of another opened in the graph, rated and made a
    //     reference, "Back to latest", and a shot started with a Shot opened.
    {
        const target = RECIPES[1];
        const another = RECIPES[4]; // on the same profile, so no check above takes it for a recipe with no Shot
        const targetId = String((await recordNamed(target.name)).id);
        const anotherId = String((await recordNamed(another.name)).id);
        const modelId = (await newestShotWith(targetId)).id;
        const model = await decaid('GET', `/shots/${modelId}`);
        // Decaid's import takes a double only as a number written with a
        // fraction, and JSON written from here drops a whole one's ".0". So the
        // copies are made from the Shot as Decaid wrote it, each such number
        // kept as its own text.
        const asWritten = JSON.parse(await (await fetch(`${API}/shots/${modelId}`)).text(),
            (key, value, context) => (typeof value === 'number' && Number.isInteger(value) && /[.eE]/.test(context?.source ?? '') ? JSON.rawJSON(context.source) : value));
        // Sixty copies, from yesterday evening back, every 25 minutes: of the
        // loaded recipe, of another, and of none, some rated and some noted.
        const evening = new Date();
        evening.setUTCDate(evening.getUTCDate() - 1);
        const copies = Array.from({ length: 60 }, (unused, i) => {
            const recipeId = [null, targetId, anotherId][i % 3];
            const context = { ...asWritten.workflow.context, extras: { ...(asWritten.workflow.context?.extras || {}), dye: recipeId ? { ...(asWritten.workflow.context?.extras?.dye || {}), recipeId } : undefined } };
            if (!recipeId) delete context.extras.dye;
            return {
                ...asWritten,
                id: LIST_SHOT(i),
                timestamp: decaidTime(new Date(evening.getTime() - (i * 25 + (evening.getUTCHours() - 18) * 60) * 60_000)),
                workflow: { ...asWritten.workflow, context: { ...context, baristaName: BARISTAS[i % 2] } },
            };
        });
        await importShots(copies);
        // Each copy's rating and note, through Decaid's Shot edit.
        for (let i = 0; i < copies.length; i += 1) {
            await decaid('PUT', `/shots/${LIST_SHOT(i)}`, { annotations: { enjoyment: i % 4 === 0 ? 0 : (i % 5) * 2 + 2, espressoNotes: i % 6 === 0 ? 'A note from the sample data.' : '' } });
        }
        const total = (await decaid('GET', '/shots?limit=1')).total;
        check('the list\'s sample Shots are in Decaid', ((await decaid('GET', `/shots/${LIST_SHOT(59)}`)) || {}).id === LIST_SHOT(59) && total > 60, `${total} Shots`);

        const list = await openPage();
        const urls = [];
        list.page.on('request', request => urls.push(new URL(request.url())));
        await waitForPage(list.page);
        await list.page.locator('#cafe-strip .cafe-card').nth(target.slot - 1).click();
        await list.page.locator('#cafe-title').filter({ hasText: target.name }).waitFor({ timeout: 20_000 });
        await list.page.locator('#cafe-shot-when').filter({ hasText: /\d/ }).waitFor({ timeout: 20_000 }).catch(() => {});
        await list.page.waitForTimeout(2500);
        const latest = await legend(list.page);
        const latestId = (await newestShotWith(targetId)).id;

        //     The button: with Settings and Sleep, the same size.
        const sizes = await list.page.evaluate(() => ['settings-btn', 'cafe-shots-btn', 'sleep-button'].map(id => {
            const box = document.getElementById(id).getBoundingClientRect();
            return [Math.round(box.width), Math.round(box.height), document.getElementById(id).parentElement.id];
        }));
        check('the Shots button sits with Settings and Sleep, the same size', sizes.every(([w, h, parent]) => w === sizes[0][0] && h === sizes[0][1] && parent === 'cafe-system'), JSON.stringify(sizes));

        //     The list: 50 rows, the newest first under a header for each day,
        //     the Shot in the graph highlighted.
        const rows = () => list.page.evaluate(() => [...document.querySelectorAll('#cafe-shots-list .cafe-shots-row')].map(row => ({
            id: row.dataset.shotId,
            current: row.getAttribute('aria-current') === 'true',
            name: row.querySelector('.cafe-shots-name').textContent,
            chip: !!row.querySelector('.cafe-shots-chip'),
            stars: [...row.querySelectorAll('.cafe-shots-star')].map(star => parseFloat(star.style.getPropertyValue('--cafe-star-fill'))),
            unrated: !!row.querySelector('.cafe-shots-rating .cafe-shots-muted'),
            note: !!row.querySelector('.cafe-shots-note svg'),
            text: row.textContent,
        })));
        const days = () => list.page.evaluate(() => [...document.querySelectorAll('#cafe-shots-list .cafe-shots-day')].map(day => day.textContent));
        const openList = async () => {
            await list.page.locator('#cafe-shots-btn').click();
            await list.page.locator('#cafe-shots-dialog[open]').waitFor({ timeout: 10_000 });
            await list.page.waitForTimeout(500);
        };
        const firstReads = () => urls.filter(url => url.pathname === '/api/v1/shots' && url.searchParams.get('limit') === '50').map(url => Number(url.searchParams.get('offset') || 0));
        await openList();
        let shown = await rows();
        check('the list opens with 50 rows, the newest first, under "Today"', shown.length === 50 && (await days())[0] === 'Today' && JSON.stringify(firstReads()) === '[0]', `${shown.length} rows, days ${JSON.stringify(await days())}, reads ${JSON.stringify(firstReads())}`);
        check('the row of the Shot in the graph is highlighted', shown.filter(r => r.current).map(r => r.id).join() === latestId, JSON.stringify(shown.filter(r => r.current)));
        const references = (await storeValue(REFERENCES)) || {};
        check('a Shot that is its recipe\'s reference carries the chip', shown.filter(r => r.chip).every(r => Object.values(references).includes(r.id)) && (!shown.some(r => r.id === references[targetId]) || shown.find(r => r.id === references[targetId]).chip), JSON.stringify(shown.filter(r => r.chip).map(r => r.id)));
        const header = await shotsHeader(list.page);
        check('with no Decent Sync the list is headed "Shots" and no more: no line, no Machine column and no Time column',
            header.title === 'Shots' && header.under === null && header.line === null && header.columns.join('|') === 'Pulled|Recipe|Dose → yield|Rating|Barista|Note', JSON.stringify(header));
        check('and no row is marked Unfinished or names a Machine', (await list.page.locator('#cafe-shots-list .cafe-shots-unfinished').count()) === 0 && (await list.page.locator('#cafe-shots-list .cafe-shots-machine').evaluateAll(cells => cells.every(cell => getComputedStyle(cell).display === 'none'))));
        await shot(list.page, 'shots-list-light');

        //     Older rows as the list is scrolled near its end, none twice.
        for (let i = 0; i < 6 && (await rows()).length <= 50; i += 1) {
            await list.page.locator('#cafe-shots-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
            await list.page.waitForTimeout(800);
        }
        shown = await rows();
        check('scrolling near the end reads the next 50, and no Shot is listed twice', shown.length > 50 && new Set(shown.map(r => r.id)).size === shown.length && firstReads().includes(50), `${shown.length} rows, reads ${JSON.stringify(firstReads())}`);
        check('a day before is headed "Yesterday"', (await days()).includes('Yesterday'), JSON.stringify(await days()));
        const copy = n => shown.find(r => r.id === LIST_SHOT(n));
        check('a row names its recipe from DYE2\'s records, and a Shot with none as "No recipe"', copy(1)?.name === target.name && copy(2)?.name === another.name && copy(3)?.name === 'No recipe', JSON.stringify([copy(1), copy(2), copy(3)].map(r => r?.name)));
        check('a row shows its stars, "Not rated", and a note icon where it has a note', copy(0)?.unrated && copy(1)?.stars.length === 5 && copy(6)?.note && !copy(1)?.note, JSON.stringify([copy(0), copy(1), copy(6)]));
        await list.page.locator('#cafe-shots-scroll').evaluate(element => { element.scrollTop = element.scrollHeight / 3; });
        await shot(list.page, 'shots-list-older-light');

        //     A Shot of the loaded recipe: "Viewing", with "Back to latest".
        await list.page.locator(`[data-shot-id="${LIST_SHOT(4)}"]`).click();
        await list.page.locator('#cafe-back').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
        await list.page.waitForTimeout(1500);
        let now = await legend(list.page);
        check('a tap on a row of the loaded recipe closes the list and opens that Shot as "Viewing", with "Back to latest"',
            !(await list.page.locator('#cafe-shots-dialog[open]').count()) && now.label === 'Viewing' && (await list.page.locator('#cafe-back').isVisible()) && /\d{2}:\d{2}/.test(now.when || ''), JSON.stringify(now));
        check('the header and the dial-in column stay on the loaded recipe', (await list.page.locator('#cafe-title').textContent()) === target.name);
        const linesOpened = await chartLines(list.page);
        check('the opened Shot is in the graph with its own lines', linesOpened?.points[0] === shotCurves(model.measurements).pressure.x.length, `${linesOpened?.points[0]} points drawn`);
        await shot(list.page, 'shots-opened-viewing-light');
        await star(list.page, 3);
        await list.page.waitForTimeout(800);
        check('an opened Shot is rated', (await decaid('GET', `/shots/${LIST_SHOT(4)}`)).annotations.enjoyment === 6);
        //     The list keeps its place and shows the change.
        await openList();
        shown = await rows();
        check('the list opens where it was left, without reading it again, with the rating in its row and the opened Shot highlighted',
            shown.length > 50 && JSON.stringify(firstReads()) === '[0,50]' && JSON.stringify(shown.find(r => r.id === LIST_SHOT(4))?.stars) === '[100,100,100,0,0]' && shown.find(r => r.current)?.id === LIST_SHOT(4),
            `${shown.length} rows, reads ${JSON.stringify(firstReads())}`);

        //     A Shot of another recipe: labelled by its name, with that recipe's
        //     reference; Make reference sets that recipe's, not the loaded one's.
        const choicesBefore = (await storeValue(REFERENCES)) || {};
        await list.page.locator(`[data-shot-id="${LIST_SHOT(5)}"]`).click();
        await list.page.locator('#cafe-shot-label').filter({ hasText: another.name }).waitFor({ timeout: 10_000 }).catch(() => {});
        await list.page.waitForTimeout(1000);
        now = await legend(list.page);
        check('a Shot of another recipe is labelled with that recipe\'s name, while the header stays on the loaded recipe', now.label === another.name && (await list.page.locator('#cafe-title').textContent()) === target.name, JSON.stringify(now));
        await shot(list.page, 'shots-opened-other-recipe-light');
        await list.page.locator('#cafe-make-reference').click();
        if (await list.page.locator('#cafe-reference-dialog[open]').count()) {
            check('the "Replace the reference?" dialog names that recipe', (await list.page.locator('#cafe-reference-dialog-recipe').textContent()) === another.name);
            await list.page.locator('#cafe-reference-dialog-replace').click();
        }
        await list.page.locator('#cafe-reference-badge').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
        const choicesAfter = (await storeValue(REFERENCES)) || {};
        check('Make reference on it sets that recipe\'s reference and leaves the loaded recipe\'s', choicesAfter[anotherId] === LIST_SHOT(5) && choicesAfter[targetId] === choicesBefore[targetId] && (await legend(list.page)).badge === 'This shot is the reference', JSON.stringify(choicesAfter));

        //     A Shot with no recipe: no reference and no Make reference.
        await openList();
        check('the kept list moves the chip to the Shot made a reference', (await rows()).find(r => r.id === LIST_SHOT(5))?.chip === true);
        await list.page.locator(`[data-shot-id="${LIST_SHOT(3)}"]`).click();
        await list.page.locator('#cafe-shot-label').filter({ hasText: 'No recipe' }).waitFor({ timeout: 10_000 }).catch(() => {});
        await list.page.waitForTimeout(800);
        now = await legend(list.page);
        check('a Shot with no recipe reads "No recipe", with no reference and no Make reference', now.label === 'No recipe' && now.make === null && now.reference === null && now.badge === null, JSON.stringify(now));

        //     Back to latest.
        await list.page.locator('#cafe-back').click();
        await list.page.waitForTimeout(1500);
        now = await legend(list.page);
        check('"Back to latest" returns to the Shot that was there', now.label === 'Latest' && now.when === latest.when && !(await list.page.locator('#cafe-back').isVisible()), JSON.stringify(now));
        await openList();
        check('once back on the latest the list is read afresh', JSON.stringify(firstReads()) === '[0,50,0]' && (await rows()).length === 50, JSON.stringify(firstReads()));
        //     The latest's own row is "Back to latest": it opens nothing.
        await list.page.locator(`[data-shot-id="${latestId}"]`).click();
        await list.page.waitForTimeout(800);
        check('the latest\'s own row opens nothing', (await legend(list.page)).label === 'Latest' && !(await list.page.locator('#cafe-back').isVisible()));

        //     A shot started with a Shot opened draws live, and the latest is in
        //     the graph when it ends. The list does not open during it.
        await openList();
        await list.page.locator(`[data-shot-id="${LIST_SHOT(1)}"]`).click();
        await list.page.locator('#cafe-back').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
        const run = pullShot(12);
        await list.page.locator('#main-page.cafe-shot-live').waitFor({ timeout: 20_000 }).catch(() => {});
        await list.page.waitForTimeout(3000);
        now = await legend(list.page);
        check('a shot that starts with a Shot opened draws live, and "Back to latest" goes', now.label === 'Live shot' && !(await list.page.locator('#cafe-back').isVisible()), JSON.stringify(now));
        check('while a shot runs the Shots button takes no taps', await list.page.locator('#cafe-shots-btn').isDisabled());
        const drawn = await countDraws(list.page, 3000);
        check('a live shot still draws by appending frames', drawn.appended >= 10 && drawn.full <= 3, `${drawn.appended} frames appended, ${drawn.full} drawn in full, in 3 s`);
        await run;
        await list.page.locator('#cafe-shot-label').filter({ hasText: 'Latest' }).waitFor({ timeout: 30_000 }).catch(() => {});
        await list.page.locator('#cafe-shot-when').filter({ hasText: /\d{2}:\d{2}/ }).waitFor({ timeout: 30_000 }).catch(() => {});
        await list.page.waitForTimeout(2000);
        now = await legend(list.page);
        const pulled = (await newestShotWith(targetId)).id;
        check('when it ends the latest is in the graph', now.label === 'Latest' && pulled !== latestId && now.when !== latest.when, JSON.stringify(now));
        check('the Shots list: no page error', list.seen.errors.length === 0, list.seen.errors.join(' | '));
        await list.close();
        for (let i = 0; i < copies.length; i += 1) await decaid('DELETE', `/shots/${LIST_SHOT(i)}`).catch(() => {});
        await decaid('POST', REFERENCES, choicesBefore);
    }

    await grinderFixtures();

    // 19. A touchscreen whose screen rests short of its window is a page test now
    //     (test/page/touch-keyboard.spec.mjs).


    await unloadByTap();
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
