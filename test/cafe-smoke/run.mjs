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
// switches Streamline's "DYE2 on" setting, writes made-up beans, grinders and
// recipes, makes recipes and moves them between slots from the page, chooses
// grinders from the page, changes the language, and pulls simulated shots. Point it at a throwaway Decaid only.

import { chromium } from 'playwright';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BEANS, GRINDER, SECOND_GRINDER, ARCHIVED_GRINDER, GRINDER_USE, PRESET_GRINDER, QUARTER_GRINDER, RECIPES, BARISTAS } from './sample-data.mjs';
import { KEYBOARD_GAP } from '../../src/modules/keyboard-fit.js';
import { sleep, decaidClient, paint, legend, chartLines, countDraws, row, keys, sides, stageNames, remarks, noteDialog, legendFits, REFERENCE_LINES, shotsHeader, dialogDrawn } from './page-helpers.mjs';
import { MIN_DYE2_VERSION, DYE2_PLUGIN_ID } from '../../src/cafe/dye2-gate.js';
import { compareVersions } from '../../src/modules/skin-version.js';
import { SUPPORTED_LANGUAGES } from '../../src/modules/i18n-parser.js';
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

const browser = await chromium.launch({ headless: !HEADED });

// A page with nothing in its own storage. With `machineButtons: false` the
// machine reports buttons of its own, which the simulated machine never does, so
// that one answer is rewritten on the way in. `decentSync` stands in for Decent
// Sync's plugin, which this Decaid does not have: its entry in the plugin list
// and its Status answer, `served` or a refusal's code.
async function openPage({ theme = 'light', machineButtons = true, decentSync = null, weights = false, viewport = { width: 1920, height: 1200 } } = {}) {
    const context = await browser.newContext({ viewport, timezoneId: TIMEZONE });
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

// A tablet's touchscreen at 1340x800 whose visualViewport rests `short` px
// shorter than the window, as a WebView's can by a fraction of a pixel or a
// system bar. `window.__cafeSmokeShort` changes it later, with a resize on
// visualViewport, to stand in for a soft keyboard. Every change of the canvas's
// transform is kept in `window.__cafeTransforms`. The machine reports buttons of
// its own, as a DE1Pro does, so Settings, Shots and Sleep sit at the bottom of
// the dial-in column, close to the screen's bottom edge.
async function openTouchPage(short) {
    const context = await browser.newContext({
        viewport: { width: 1340, height: 800 }, hasTouch: true, timezoneId: TIMEZONE,
        userAgent: 'Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Safari/537.36',
    });
    await context.addInitScript(gap => {
        window.__cafeSmokeShort = gap;
        const height = Object.getOwnPropertyDescriptor(VisualViewport.prototype, 'height');
        Object.defineProperty(VisualViewport.prototype, 'height', {
            configurable: true,
            get() { return Math.max(0, height.get.call(this) - window.__cafeSmokeShort); },
        });
        window.__cafeTransforms = [];
        document.addEventListener('DOMContentLoaded', () => {
            const content = document.getElementById('scaled-content');
            new MutationObserver(() => window.__cafeTransforms.push(content.style.transform))
                .observe(content, { attributes: true, attributeFilter: ['style'] });
        });
    }, short);
    const page = await context.newPage();
    const seen = { errors: [], requests: [] };
    page.on('pageerror', error => seen.errors.push(error.message));
    page.on('request', request => seen.requests.push(`${request.method()} ${new URL(request.url()).pathname}`));
    await page.route('**/api/v1/machine/info', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, json: { ...(await response.json()), GHC: true } });
    });
    // Sleep is answered here, so the simulated machine stays awake for the run.
    await page.route('**/api/v1/machine/state/sleeping', route => route.fulfill({ status: 200, json: {} }));
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
async function ratingAndNotes(page, latest, reference) {
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
        await route.fetch();
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
    check('no page error from rating and notes', true);
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
const pickRows = page => page.locator('#cafe-pick-list .cafe-pick-row').evaluateAll(rows => rows.map(row => ({
    name: row.querySelector('.cafe-pick-row-name').textContent,
    detail: row.querySelector('.cafe-pick-row-detail').textContent,
    inUse: row.getAttribute('aria-pressed') === 'true' && !!row.querySelector('.cafe-pick-in-use'),
})));
const pickRow = (page, name) => page.locator('#cafe-pick-list .cafe-pick-row').filter({ has: page.locator('.cafe-pick-row-name', { hasText: name }) });
// A tap where a finger would land: on the row's name, or on the grinder's name
// under it. The two sit inside one button and take no pointer events
// themselves, so the tap is made at their place, not on them.
async function tapAt(page, selector) {
    const box = await page.locator(selector).boundingBox();
    await page.mouse.click(box.x + Math.min(box.width / 2, 40), box.y + box.height / 2);
}
const openGrinders = async (page, on = '#grind-section .cafe-row-name') => {
    await tapAt(page, on);
    // Open, and its fade in over.
    return pickDialog(page).waitFor({ timeout: 10_000 }).then(() => page.waitForTimeout(500)).then(() => true, () => false);
};

// ── The dialogs at a tablet's size ───────────────────────────────────────────

// 20. The page's dialogs at a tablet's size (issue #39). A modal dialog draws
//     outside Streamline's scaled canvas, so each carries a canvas of its own.
//     Each is opened at 1920 by 1200, where the page's scale is 1 and its sizes
//     are design px, then on pages opened at 1340 by 800 and 1280 by 800: there
//     each part measures its size at 1920 times the page's scale, within a
//     pixel, the box fits inside the window, and nothing scrolls sideways. The
//     Shots box's height is the screen's, less a margin, so it is checked only
//     to fit. Every sample recipe is in a slot by now, so one more, in none,
//     is added for the step, for the recipe list to have a row to measure, and
//     DYE2's records go back as they were afterwards. The reference's dialog
//     asks before a choice of reference is replaced, which needs one already
//     chosen; it is opened here as `src/cafe/graph.js` opens it, with made-up
//     names in it.
const DIALOG_SIZES = [{ width: 1920, height: 1200 }, { width: 1340, height: 800 }, { width: 1280, height: 800 }];
const DIALOG_PARTS = {
    'cafe-recipe-dialog': ['h3', '.cafe-recipe-row', '.cafe-recipe-row-name', '.modal-action .cafe-btn'],
    'cafe-pick-dialog': ['h3', '#cafe-pick-under', '.cafe-pick-head .cafe-btn', '.cafe-pick-row'],
    'cafe-shots-dialog': ['h3', '.cafe-shots-head .cafe-btn', '.cafe-shots-columns', '.cafe-shots-row', '.cafe-shots-star'],
    'cafe-reference-dialog': ['h3', '#cafe-reference-dialog-recipe', '.cafe-reference-dialog-shots', '#cafe-reference-dialog-replace'],
    'cafe-note-dialog': ['h3', '#cafe-note-meta', '#cafe-note-text', '#cafe-note-save'],
};
// Opens each dialog on `page` as a barista would, but for the reference's, and
// hands each to `measure` while it is open and its fade in is over.
async function eachDialog(page, measure) {
    const opened = async (id, open, close) => {
        await open();
        const shown = await page.locator(`#${id}[open]`).waitFor({ timeout: 10_000 }).then(() => true, () => false);
        await page.waitForTimeout(700);
        await measure(id, shown);
        // A dialog that didn't open has no button to close it with, and the
        // rest of the step still runs.
        if (shown) await close();
        else await page.keyboard.press('Escape');
        await page.locator(`#${id}:not([open])`).waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(700);
    };
    // Slot 4 is empty again by now, so its menu's second item is the list.
    await opened('cafe-recipe-dialog', async () => {
        await openMenu(page, 4);
        const items = await menuItems(page);
        if (items[1] === 'Choose a recipe…') return pick(page, 1);
        check('slot 4 is empty, so its menu offers the list', false, items.join(' | '));
        await page.keyboard.press('Escape');
    },
        () => page.locator('#cafe-recipe-dialog .modal-action button').click());
    await opened('cafe-pick-dialog', () => tapAt(page, '#grind-section .cafe-row-name'),
        () => page.locator('#cafe-pick-dialog .cafe-pick-head .cafe-btn').click());
    await opened('cafe-shots-dialog', () => page.locator('#cafe-shots-btn').click(),
        () => page.locator('#cafe-shots-dialog .cafe-shots-head .cafe-btn').click());
    await opened('cafe-reference-dialog', () => page.evaluate(() => {
        document.getElementById('cafe-reference-dialog-recipe').textContent = 'Sample Espresso';
        document.getElementById('cafe-reference-dialog-new').textContent = 'Today 09:41 · Sample Barista';
        document.getElementById('cafe-reference-dialog-old').textContent = 'Yesterday 16:05 · Sample Barista';
        document.getElementById('cafe-reference-dialog').showModal();
    }), () => page.locator('#cafe-reference-dialog button', { hasText: 'Cancel' }).click());
    await opened('cafe-note-dialog', () => page.locator('#cafe-shot-note').click(),
        () => page.locator('#cafe-note-cancel').click());
}
async function dialogsAtTabletSize() {
    const design = {};
    const records = await decaid('GET', RECIPE_STORE);
    const like = records.find(row => row && row.name === RECIPES[0].name);
    await decaid('POST', RECIPE_STORE, [...records, {
        ...like, id: 'sample-in-no-slot', name: 'Sample recipe in no slot', title: 'Sample recipe in no slot', stripSlot: null, showOnStreamlineDashboard: false,
    }]);
    try {
        await dialogsAtEachSize(design);
    } finally {
        await decaid('POST', RECIPE_STORE, records);
    }
}
async function dialogsAtEachSize(design) {
    for (const viewport of DIALOG_SIZES) {
        const size = `${viewport.width}x${viewport.height}`;
        const view = await openPage({ viewport });
        const { page, seen } = view;
        try {
            await waitForPage(page);
            await page.waitForTimeout(2500);
            await eachDialog(page, async (id, shown) => {
                const drawn = shown ? await dialogDrawn(page, id, DIALOG_PARTS[id]) : null;
                if (!drawn) return check(`${size}: ${id} opens`, false);
                await shot(page, `dialog-${id.replace(/^cafe-|-dialog$/g, '')}-${size}-light`);
                const [width, height] = drawn.window;
                const { box } = drawn;
                check(`${size}: ${id} fits inside the window`, box.left >= 0 && box.top >= 0 && box.right <= width && box.bottom <= height, JSON.stringify(box));
                check(`${size}: ${id} shows no sideways scrollbar`, drawn.sideways.length === 0, drawn.sideways.join(', '));
                if (viewport.width === 1920) {
                    check(`${size}: the page's scale is 1, so ${id} is in design px`, drawn.scaleX === 1 && drawn.scaleY === 1, `${drawn.scaleX} × ${drawn.scaleY}`);
                    design[id] = drawn;
                    return;
                }
                const at1920 = design[id];
                if (!at1920) return check(`${size}: ${id} was measured at 1920 by 1200 first`, false);
                const parts = { ...drawn.parts, ...(id === 'cafe-shots-dialog' ? { box: [drawn.box.size[0], null] } : { box: drawn.box.size }) };
                const designParts = { ...at1920.parts, box: at1920.box.size };
                const off = Object.entries(parts).flatMap(([name, measured]) => {
                    const want = designParts[name];
                    if (!measured || !want) return [`${name}: ${measured ? 'not at 1920' : 'missing'}`];
                    // A part that isn't drawn measures 0 at every size, and proves nothing.
                    if ([...measured, ...want].includes(0)) return [`${name}: not drawn (${measured.join(' × ')}, ${want.join(' × ')} at 1920)`];
                    return measured.flatMap((value, axis) => {
                        if (value === null) return [];
                        const expected = want[axis] * (axis === 0 ? drawn.scaleX : drawn.scaleY);
                        return Math.abs(value - expected) <= 1 ? [] : [`${name} ${axis === 0 ? 'width' : 'height'} ${value}, not ${Math.round(expected * 10) / 10}`];
                    });
                });
                check(`${size}: ${id}'s heading, text, rows and buttons are their size at 1920 times the page's scale (${Math.round(drawn.scaleX * 1000) / 1000})`,
                    off.length === 0, off.join('; ') || JSON.stringify(parts));
            });
            check(`${size}: no page error with the dialogs`, seen.errors.length === 0, seen.errors.join(' | '));
        } finally {
            await view.close();
        }
    }
}
const grinderNamed = (grinders, model) => grinders.find(g => g && g.model === model) || null;
const workflowWrites = page => {
    const writes = [];
    page.on('request', request => { if (request.method() === 'PUT' && /\/api\/v1\/workflow$/.test(request.url())) writes.push(request.postDataJSON()); });
    return writes;
};

// 18. The grinder dialog (docs/cafe/DESIGN.md, "What the screen shows"): a tap
//     on the Grind row's name lists the tablet's grinders, and a choice sets the
//     machine to that grinder at the setting it was last used at, in one write
//     of the Workflow and nothing else.
async function grinderDialog() {
    const listed = await decaid('GET', '/grinders?includeArchived=true');
    const grinders = Array.isArray(listed) ? listed : listed.items || [];
    const first = grinderNamed(grinders, GRINDER.model);
    const second = grinderNamed(grinders, SECOND_GRINDER.model) || await decaid('POST', '/grinders', SECOND_GRINDER);
    const retired = grinderNamed(grinders, ARCHIVED_GRINDER.model) || await decaid('POST', '/grinders', ARCHIVED_GRINDER);
    if (!retired.archived) await decaid('PUT', `/grinders/${retired.id}`, { ...retired, archived: true });
    // A shot on each grinder, at a setting of its own. The simulated machine
    // takes a moment after a shot before it pulls another.
    await unloadRecipe();
    const pulled = [];
    const newestId = async () => (await decaid('GET', '/shots?limit=1')).items?.[0]?.id ?? null;
    for (const [grinder, use] of [[first, GRINDER_USE.first], [second, GRINDER_USE.second]]) {
        await decaid('PUT', '/workflow', { context: { grinderId: grinder.id, grinderModel: grinder.model, grinderSetting: use.setting, extras: { rpm: use.rpm } } });
        const before = await newestId();
        await pullShot(4);
        for (let waited = 0; waited < 30_000 && (await newestId()) === before; waited += 1000) await sleep(1000);
        const newest = (await decaid('GET', `/shots?grinderId=${grinder.id}&limit=1`)).items?.[0];
        if (newest && newest.id !== before) pulled.push(newest.id);
        await sleep(5000);
    }
    check('grinder: a shot was pulled on each of the two grinders', pulled.length === 2);
    const house = RECIPES[0];
    const other = RECIPES[2];
    const view = await openPage();
    const { page, seen } = view;
    try {
        // A tablet's numbers open the numpad, which Streamline decides at start.
        await page.addInitScript(() => { window._forceNumpadMobile = true; });
        await page.reload();
        await waitForPage(page);
        const card = recipe => page.locator('#cafe-strip .cafe-card').nth(recipe.slot - 1);
        const loadCard = async recipe => {
            await card(recipe).click();
            await page.locator('#cafe-title').filter({ hasText: recipe.name }).waitFor({ timeout: 20_000 });
            await page.waitForTimeout(3000);
        };
        const grindName = () => page.locator('#cafe-grind-desc').textContent();
        await loadCard(house);
        const writes = workflowWrites(page);
        const record = await recordNamed(house.name);
        check('grinder: the loaded recipe names its grinder under Grind', (await grindName()) === GRINDER.model, await grindName());

        //    The value still opens the numpad.
        await page.locator('#grind-value').click();
        const numpad = await page.locator('#numpad-modal-overlay').waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
        check('grinder: a tap on the Grind value opens the numpad, and no dialog', numpad && !(await pickDialog(page).count()));
        if (numpad) await page.locator('#numpad-cancel').click();
        await page.waitForTimeout(800);

        //    The row's name opens the dialog, and so does the grinder's under it.
        check('grinder: a tap on the Grind row\'s name opens the grinder dialog', await openGrinders(page));
        check('grinder: the dialog is titled "Grinder"', (await page.locator('#cafe-pick-title').textContent()) === 'Grinder');
        check('grinder: with a recipe loaded and no Decent Sync, the line under it says the choice is not saved to the recipe',
            (await page.locator('#cafe-pick-under').textContent()) === `${house.name} · not saved to the recipe`, await page.locator('#cafe-pick-under').textContent());
        const rows = await pickRows(page);
        const rowOf = model => rows.find(row => row.name === model);
        check('grinder: it lists the tablet\'s grinders, not the archived one',
            !!rowOf(GRINDER.model) && !!rowOf(SECOND_GRINDER.model) && !rowOf(ARCHIVED_GRINDER.model), rows.map(row => row.name).join(', '));
        check('grinder: each row says where the grinder was last used, after its burrs',
            rowOf(GRINDER.model)?.detail === `last used at ${GRINDER_USE.first.setting}` && rowOf(SECOND_GRINDER.model)?.detail === `Conical burrs · last used at ${GRINDER_USE.second.setting}`,
            rows.map(row => `${row.name}: ${row.detail}`).join(' | '));
        check('grinder: the grinder in use, and only it, is marked "In use"',
            rowOf(GRINDER.model)?.inUse && rows.filter(row => row.inUse).length === 1
            && (await pickRow(page, GRINDER.model).locator('.cafe-pick-in-use').textContent()).trim() === 'In use');
        await shot(page, 'grinder-dialog-light');
        check('grinder: the dialog opened none of DYE2\'s pages', page.url().startsWith(BASE) && !seen.requests.some(r => /dye2\.reaplugin\/(grinder|ui)/.test(r)),
            seen.requests.filter(r => /dye2\.reaplugin\/(grinder|ui)/.test(r)).join(', '));
        await page.mouse.click(40, 40);
        check('grinder: a tap outside closes it', await pickClosed(page));
        check('grinder: a tap on the grinder\'s name under Grind opens it too', await openGrinders(page, '#cafe-grind-desc'));
        await page.locator('#cafe-pick-dialog form[method="dialog"] .cafe-btn').click();
        check('grinder: Close closes it, and nothing was written', (await pickClosed(page)) && writes.length === 0, JSON.stringify(writes));

        //    The grinder in use: a tap closes the dialog and writes nothing.
        await openGrinders(page);
        await pickRow(page, GRINDER.model).click();
        await page.waitForTimeout(1500);
        check('grinder: a tap on the grinder in use closes the dialog and writes nothing', (await pickClosed(page)) && writes.length === 0, JSON.stringify(writes));

        //    A choice: one write, of the grinder, its last setting and its RPM.
        await openGrinders(page);
        await pickRow(page, SECOND_GRINDER.model).click();
        await pickClosed(page);
        await page.locator('#cafe-grind-desc').filter({ hasText: SECOND_GRINDER.model }).waitFor({ timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(2500);
        check('grinder: a choice is one write of the grinder, the setting it was last used at and its RPM',
            writes.length === 1 && JSON.stringify(writes[0]) === JSON.stringify({ context: { grinderId: second.id, grinderModel: SECOND_GRINDER.model, grinderSetting: GRINDER_USE.second.setting, extras: { rpm: GRINDER_USE.second.rpm } } }),
            JSON.stringify(writes));
        const workflow = await decaid('GET', '/workflow');
        check('grinder: the Workflow holds it, and the recipe stays loaded',
            workflow.context.grinderId === second.id && workflow.context.grinderModel === SECOND_GRINDER.model && String(workflow.context.grinderSetting) === GRINDER_USE.second.setting
            && workflow.context.extras?.rpm === GRINDER_USE.second.rpm && workflow.context.extras?.dye?.recipeId === record.id,
            JSON.stringify(workflow.context));
        check('grinder: Grind names the new grinder and shows its setting', (await grindName()) === SECOND_GRINDER.model && parseFloat(await page.locator('#grind-value').textContent()) === parseFloat(GRINDER_USE.second.setting),
            `${await grindName()}, ${await page.locator('#grind-value').textContent()}`);
        await page.locator('#grind-plus').click();
        const stepped = parseFloat(await page.locator('#grind-value').textContent());
        check('grinder: + steps by the new grinder\'s own step', stepped === parseFloat(GRINDER_USE.second.setting) + SECOND_GRINDER.settingSmallStep, String(stepped));
        await page.locator('#grind-minus').click();
        await page.waitForTimeout(3000);
        check('grinder: the recipe\'s DYE2 record is unchanged by the choice', JSON.stringify(await recordNamed(house.name)) === JSON.stringify(record));
        check('grinder: the skin asked DYE2 to save nothing, and wrote none of its records',
            !seen.requests.some(r => /^POST .*dye2\.reaplugin\/(record|save-recipe)$|^POST .*\/store\/dye2\.reaplugin\//.test(r)));
        check('grinder: Grind names the new grinder after the page goes out of view and comes back', await lookAgain(page).then(grindName) === SECOND_GRINDER.model);
        {
            const again = await openPage();
            await waitForPage(again.page);
            await again.page.waitForTimeout(3000);
            check('grinder: and on a page opened afresh', (await again.page.locator('#cafe-grind-desc').textContent()) === SECOND_GRINDER.model);
            await again.close();
        }

        //    Another recipe, then this one again: the recipe's own grinder is back.
        await loadCard(other);
        await loadCard(house);
        const back = await decaid('GET', '/workflow');
        check('grinder: loading another recipe and this one again brings the recipe\'s own grinder back',
            (await grindName()) === GRINDER.model && back.context.grinderId === first.id && parseFloat(back.context.grinderSetting) === Number(record.dashboardVariables?.grind),
            `${await grindName()}, ${back.context.grinderId}, ${back.context.grinderSetting}`);

        //    A list that can't be read is not an empty list.
        await page.route(/\/api\/v1\/grinders(\?|$)/, route => route.abort());
        await tapAt(page, '#grind-section .cafe-row-name');
        await page.locator('#app-toast').filter({ hasText: 'Could not read the grinders' }).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        check('grinder: grinders that can\'t be read are a toast, and no dialog',
            (await page.locator('#app-toast-message').textContent()) === 'Could not read the grinders' && !(await pickDialog(page).count()));
        await page.unroute(/\/api\/v1\/grinders(\?|$)/);
        await page.waitForTimeout(2500);

        //    A shot that starts closes the dialog, and it does not open during one.
        await openGrinders(page);
        const run = pullShot(6);
        await page.locator('#main-page.cafe-shot-live').waitFor({ timeout: 20_000 }).catch(() => {});
        check('grinder: a shot that starts closes the dialog', await pickClosed(page));
        await tapAt(page, '#grind-section .cafe-row-name');
        await page.waitForTimeout(1500);
        check('grinder: the dialog does not open during a shot', !(await pickDialog(page).count()));
        await run;
        await page.locator('#main-page:not(.cafe-shot-live)').waitFor({ timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(4000);
        const during = await decaid('GET', '/shots?limit=1');
        if (during.items?.[0]) pulled.push(during.items[0].id);

        //    With no recipe loaded the choice changes this machine only.
        await unloadRecipe();
        await page.reload();
        await waitForPage(page);
        await page.waitForTimeout(3000);
        await openGrinders(page);
        check('grinder: with no recipe loaded, the line says the choice changes this machine only',
            (await page.locator('#cafe-pick-under').textContent()) === 'No recipe loaded · changes this machine only', await page.locator('#cafe-pick-under').textContent());
        await shot(page, 'grinder-dialog-no-recipe-light');
        const before = writes.length;
        await pickRow(page, SECOND_GRINDER.model).click();
        await page.locator('#cafe-grind-desc').filter({ hasText: SECOND_GRINDER.model }).waitFor({ timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(2000);
        const loose = await decaid('GET', '/workflow');
        check('grinder: with no recipe loaded, a choice writes the Workflow and Grind names the grinder',
            writes.length === before + 1 && loose.context.grinderId === second.id && (await grindName()) === SECOND_GRINDER.model && String(loose.context.grinderSetting) === GRINDER_USE.second.setting,
            JSON.stringify(loose.context));
        check('grinder: no page error', seen.errors.length === 0, seen.errors.join(' | '));
    } finally {
        await shot(page, 'grinder-at-end').catch(() => {});
        await view.close();
    }
    {
        const dark = await openPage({ theme: 'dark' });
        await waitForPage(dark.page, 'dark');
        await dark.page.waitForTimeout(2500);
        await openGrinders(dark.page);
        await shot(dark.page, 'grinder-dialog-dark');
        await dark.close();
    }
    // The Shots this step pulled go, so a later run reads its own.
    for (const id of pulled) await decaid('DELETE', `/shots/${id}`).catch(() => {});
}

// 21. The Grind row's number (#42; docs/cafe/DESIGN.md, "What the screen
//     shows"): a preset grinder's setting shown by its name, with − and +
//     writing nothing, and a 0.25-step grinder's setting kept to its places
//     through a Workflow read and stepped on its own grid.
async function grindRow() {
    const listed = await decaid('GET', '/grinders?includeArchived=true');
    const grinders = Array.isArray(listed) ? listed : listed.items || [];
    const ensure = async spec => {
        const found = grinderNamed(grinders, spec.model);
        if (!found) return decaid('POST', '/grinders', spec);
        return found.archived ? decaid('PUT', `/grinders/${found.id}`, { ...found, archived: false }) : found;
    };
    const preset = await ensure(PRESET_GRINDER);
    const quarter = await ensure(QUARTER_GRINDER);
    const plain = grinderNamed(grinders, GRINDER.model);
    check('grind row: the preset grinder is a preset, the other steps by 0.25',
        preset?.settingType === 'preset' && quarter?.settingSmallStep === 0.25, JSON.stringify({ preset, quarter }));
    const setGrind = (grinder, grinderSetting) => decaid('PUT', '/workflow', { context: { grinderId: grinder.id, grinderModel: grinder.model, grinderSetting } });
    await unloadRecipe();
    await setGrind(preset, 'Medium');
    const view = await openPage({ machineButtons: false });
    const { page, seen } = view;
    try {
        await waitForPage(page);
        await page.waitForTimeout(3000);
        const writes = workflowWrites(page);
        const grind = () => page.locator('#grind-value').textContent();
        // A Workflow read, as the page makes when a plugin says the Workflow
        // changed (DYE2's `changed` socket, through Streamline's plugin surfaces).
        const readAgain = async () => {
            await page.evaluate(() => document.dispatchEvent(new Event('streamline:workflow-refresh')));
            await page.waitForTimeout(2000);
        };
        // Past the − and +'s debounce, and Streamline's own read after it.
        const settle = () => page.waitForTimeout(2500);

        check('grind row: a preset grinder\'s "Medium" shows as Medium', (await grind()) === 'Medium', await grind());
        await shot(page, 'grind-row-preset-light');
        await page.locator('#grind-plus').click();
        await settle();
        check('grind row: + on a preset writes nothing and leaves Medium', writes.length === 0 && (await grind()) === 'Medium', `${JSON.stringify(writes)} ${await grind()}`);
        await page.locator('#grind-minus').click();
        await settle();
        check('grind row: − on a preset writes nothing and leaves Medium', writes.length === 0 && (await grind()) === 'Medium', `${JSON.stringify(writes)} ${await grind()}`);
        check('grind row: the Workflow still holds Medium', (await decaid('GET', '/workflow')).context?.grinderSetting === 'Medium');
        // A name sits between − and +: its text, measured by a Range, against
        // the gap between the two buttons.
        const fit = () => page.evaluate(() => {
            const value = document.getElementById('grind-value');
            const range = document.createRange();
            range.selectNodeContents(value);
            const text = range.getBoundingClientRect();
            const minus = document.getElementById('grind-minus').getBoundingClientRect();
            const plus = document.getElementById('grind-plus').getBoundingClientRect();
            return { left: text.left - minus.right, right: plus.left - text.right, size: parseFloat(getComputedStyle(value).fontSize) };
        });
        const medium = await fit();
        check('grind row: Medium sits between − and +, shrunk no further than it must be', medium.left >= 4 && medium.right >= 4 && medium.size >= 20, JSON.stringify(medium));
        await setGrind(preset, 'Extra coarse');
        await readAgain();
        const long = await fit();
        check('grind row: a longer name is shrunk to sit between them', (await grind()) === 'Extra coarse' && long.left >= 4 && long.right >= 4 && long.size >= 14 && long.size < 30, JSON.stringify(long));
        // A name too long even at the fitting's 8 px floor is cut with an
        // ellipsis inside the value's box, never run under − or +.
        await setGrind(preset, 'Extra coarse for cold brew and large batch service only');
        await readAgain();
        const clipped = await page.evaluate(() => {
            const value = document.getElementById('grind-value');
            const box = value.getBoundingClientRect();
            const minus = document.getElementById('grind-minus').getBoundingClientRect();
            const plus = document.getElementById('grind-plus').getBoundingClientRect();
            return { left: box.left - minus.right, right: plus.left - box.right, cut: value.scrollWidth > value.clientWidth, overflow: getComputedStyle(value).textOverflow };
        });
        check('grind row: a name too long to fit ends in an ellipsis between − and +', clipped.left >= 0 && clipped.right >= 0 && clipped.cut && clipped.overflow === 'ellipsis', JSON.stringify(clipped));
        // A number is never cut: the fitting measures digits narrower than the
        // row's tabular ones, so a wide one is left to show whole.
        await setGrind(quarter, '111.25');
        await readAgain();
        const wide = await page.evaluate(() => {
            const value = document.getElementById('grind-value');
            return { text: value.textContent, overflow: getComputedStyle(value).overflowX };
        });
        const wideFit = await fit();
        check('grind row: a wide number such as 111.25 is shown whole, not cut, and clear of − and +', wide.text === '111.25' && wide.overflow === 'visible' && wideFit.left >= 0 && wideFit.right >= 0, JSON.stringify({ ...wide, ...wideFit }));
        await setGrind(preset, 'Medium');
        await readAgain();

        await setGrind(quarter, '11.25');
        await readAgain();
        check('grind row: a 0.25-step grinder at 11.25 shows 11.25 after a Workflow read', (await grind()) === '11.25', await grind());
        await page.locator('#grind-plus').click();
        check('grind row: + steps it to 11.5, written to its places', (await grind()) === '11.50', await grind());
        await settle();
        const stepped = await decaid('GET', '/workflow');
        check('grind row: and writes 11.50 into the Workflow, once', writes.length === 1 && stepped.context?.grinderSetting === '11.50' && stepped.context?.grinderId === quarter.id,
            `${JSON.stringify(writes)} ${JSON.stringify(stepped.context)}`);
        await readAgain();
        check('grind row: still 11.50 after the next Workflow read', (await grind()) === '11.50', await grind());
        await page.locator('#grind-minus').click();
        await page.locator('#grind-minus').click();
        await settle();
        check('grind row: − twice steps to 11.00 on its grid', (await grind()) === '11' || (await grind()) === '11.00', await grind());
        check('grind row: and the Workflow holds 11.00', (await decaid('GET', '/workflow')).context?.grinderSetting === '11.00');
        await setGrind(quarter, '11.75');
        await readAgain();
        await shot(page, 'grind-row-quarter-light');

        //    A whole-number and a 0.1-step grinder show as on Streamline's page.
        if (plain) {
            await setGrind(plain, '12');
            await readAgain();
            check('grind row: a whole number shows whole', (await grind()) === '12', await grind());
            await setGrind(plain, '2.60');
            await readAgain();
            check('grind row: a 0.1-step setting shows to one place', (await grind()) === '2.6', await grind());
            await page.locator('#grind-plus').click();
            check('grind row: + steps a 0.1-step grinder to 2.7', (await grind()) === '2.7', await grind());
            await settle();
        } else {
            check('grind row: the sample grinder is there', false);
        }
        check('grind row: no page error', seen.errors.length === 0, seen.errors.join(' | '));
    } finally {
        await shot(page, 'grind-row-at-end').catch(() => {});
        await view.close();
    }
    // The two grinders go, so the grinder dialog's list on a later run is its own.
    for (const grinder of [preset, quarter]) await decaid('PUT', `/grinders/${grinder.id}`, { ...grinder, archived: true }).catch(() => {});
    if (plain) await setGrind(plain, GRINDER_USE.first.setting).catch(() => {});
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
        check('the time axis shows the whole reference from the start', Math.abs(lines.end - lines.referenceEnd / 0.93) < 0.01, `${lines.end} for a reference of ${lines.referenceEnd} s`);
        check('no line is labelled during a shot', lines.labelled.length === 0);
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
        await ratingAndNotes(page, latestShot, first);
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

    await grinderDialog();

    // 19. A touchscreen whose screen rests short of its window (issue #38). A
    //     button takes focus as it is pressed, and Streamline's keyboard lift used
    //     to move the canvas then, so the button left the finger and the first
    //     tap missed. One tap on Settings, Shots or Sleep acts, and the canvas
    //     doesn't move. A keyboard over the note's text still leaves the dialog
    //     in view, through Streamline's own scaling this time, and a button
    //     focused with the keyboard up is lifted clear of it.
    for (const short of [0.5, 30]) {
        const touch = await openTouchPage(short);
        const { page } = touch;
        await waitForPage(page);
        await page.waitForTimeout(2000); // past SHRINK_ADOPT_MS, as a tablet is long after load
        const transform = () => page.evaluate(() => document.getElementById('scaled-content').style.transform);
        const moved = () => page.evaluate(start => window.__cafeTransforms.slice(start), 0);
        const mark = () => page.evaluate(() => { window.__cafeTransforms.length = 0; });
        const resting = await transform();
        const bottom = await page.locator('#cafe-system').evaluate(element => Math.round(element.getBoundingClientRect().bottom));
        check(`${short} px short: Settings, Shots and Sleep end inside the band the lift used to catch (${KEYBOARD_GAP} px above the screen's bottom)`,
            bottom + KEYBOARD_GAP > 800 - short && bottom <= 800, `the canvas rests at "${resting}", the buttons end at ${bottom} of 800`);

        await mark();
        await page.tap('#cafe-shots-btn');
        const shotsOpened = await page.locator('#cafe-shots-dialog[open]').waitFor({ timeout: 5000 }).then(() => true, () => false);
        check(`${short} px short: one tap on Shots opens the list, and the canvas doesn't move`, shotsOpened && (await moved()).length === 0, JSON.stringify(await moved()));
        await shot(page, `touch-${short}px-shots`);
        const focused = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
        await page.keyboard.press('Escape');
        const shotsClosed = await page.locator('#cafe-shots-dialog:not([open])').waitFor({ state: 'attached', timeout: 5000 }).then(() => true, () => false);
        await page.waitForTimeout(500);
        const afterList = { closed: shotsClosed, focus: await focused(), transform: await transform() };
        check(`${short} px short: with the list closed and focus back on Shots, the canvas is where it was`,
            afterList.closed && afterList.focus === 'cafe-shots-btn' && afterList.transform === resting, JSON.stringify(afterList));

        await mark();
        await page.tap('#sleep-button');
        await page.waitForTimeout(800);
        check(`${short} px short: one tap on Sleep asks for sleep, and the canvas doesn't move`,
            touch.seen.requests.includes('PUT /api/v1/machine/state/sleeping') && (await moved()).length === 0, JSON.stringify(await moved()));

        await mark();
        await page.tap('#settings-btn');
        const settingsOpened = await page.locator('#subpage-host #settings-content-area').waitFor({ timeout: 10_000 }).then(() => true, () => false);
        const settingsMoved = await moved();
        check(`${short} px short: one tap on Settings opens the settings page, and the canvas doesn't move`, settingsOpened && settingsMoved.length === 0, JSON.stringify(settingsMoved));
        await page.goBack();
        await waitForPage(page);
        await page.waitForTimeout(500);

        //     A keyboard that takes 360 px opens over the note's text.
        const open = await page.locator('#cafe-shot-note').isVisible();
        if (open) {
            await page.tap('#cafe-shot-note');
            await page.waitForTimeout(400);
            await page.tap('#cafe-note-text');
            const keyboard = async px => {
                await page.evaluate(gap => { window.__cafeSmokeShort = gap; window.visualViewport.dispatchEvent(new Event('resize')); }, px);
                await page.waitForTimeout(600);
            };
            await keyboard(short + 360);
            const visible = 800 - short - 360;
            const typing = await noteDialog(page);
            const typingFocus = await focused();
            await shot(page, `touch-${short}px-note-keyboard`);
            check(`${short} px short: with a keyboard up over the note's text the dialog sits above it`,
                !!typing && typingFocus === 'cafe-note-text' && typing.box.top >= 0 && typing.box.bottom <= visible + 1,
                `${JSON.stringify(typing?.box)} in ${visible}, focus on ${typingFocus}`);
            //     Save note takes focus with the keyboard still up: the dialog
            //     still fits, and the canvas behind it isn't lifted for it.
            await page.locator('#cafe-note-save').focus();
            await page.waitForTimeout(300);
            const save = await page.locator('#cafe-note-save').evaluate(element => Math.round(element.getBoundingClientRect().bottom));
            const saveFocus = await focused();
            check(`${short} px short: a button in the dialog focused with the keyboard up is above it`,
                saveFocus === 'cafe-note-save' && save <= visible + 1, `${save} in ${visible}, focus on ${saveFocus}`);
            //     Cancel with the keyboard still up: focus goes back to the page,
            //     whose canvas is lifted so that button clears the keyboard.
            await page.locator('#cafe-note-cancel').focus();
            await page.keyboard.press('Enter');
            const noteClosed = await closed(page);
            await page.waitForTimeout(400);
            const back = await page.evaluate(() => {
                const element = document.activeElement;
                return { id: element?.id || element?.tagName, bottom: Math.round(element?.getBoundingClientRect().bottom ?? -1) };
            });
            check(`${short} px short: back on the page with the keyboard up, the note's button has focus and clears it`,
                noteClosed && back.id === 'cafe-shot-note' && back.bottom > 0 && back.bottom <= visible, JSON.stringify(back));
            //     Shots, at the screen's bottom, focused with the keyboard still
            //     up: the canvas lifts so it clears the keyboard.
            await page.locator('#cafe-shots-btn').focus();
            await page.waitForTimeout(300);
            const low = await page.locator('#cafe-shots-btn').evaluate(element => Math.round(element.getBoundingClientRect().bottom));
            check(`${short} px short: Shots focused with the keyboard up is lifted clear of it`, low > 0 && low <= visible, `${low} in ${visible}, canvas "${await transform()}"`);
            await keyboard(short);
            check(`${short} px short: once the keyboard closes the canvas goes back to rest`, (await transform()) === resting, await transform());
        } else {
            check(`${short} px short: a Shot to write a note on is in the graph`, false);
        }
        check(`${short} px short: no page error`, touch.seen.errors.length === 0, touch.seen.errors.join(' | '));
        await touch.close();
    }

    await dialogsAtTabletSize();
    await grindRow();
} catch (error) {
    check(`the run finished (${error.message.split('\n')[0]})`, false);
} finally {
    await browser.close();
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(failed.length ? 1 : 0);
