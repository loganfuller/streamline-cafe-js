// Records the fake Decaid's evidence from the pinned real stack
// (fake-decaid/pins.json): the sample data's state, the page's boot, each
// scenario in scenarios.mjs beside this file, and one simulated pour. Writes them to
// fake-decaid/recordings/. How and when to run it is in docs/cafe/TESTING.md.
//
//   node scripts/fake-decaid-recorder/record.mjs                 everything
//   node scripts/fake-decaid-recorder/record.mjs --only=scenarios --keep
//
// It needs Docker and network access to GitHub. It starts a throwaway container
// and removes it at the end, unless --keep.

import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { standUp, opened, CACHE, PINS, ROOT } from './stack.mjs';
import { seed } from './seed.mjs';
import { RECIPES } from '../../test/cafe-smoke/sample-data.mjs';
import { servePage, PAGE_ORIGIN } from '../../test/page/support/page-files.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
// --scenario=a,b records only those scenarios, and nothing else unless --only
// names it: on a kept stack, the sample data written again would be a second copy.
const SCENARIO = flag('scenario', '') ? flag('scenario', '').split(',') : null;
const ONLY = flag('only', SCENARIO ? 'scenarios' : 'sample-data,scenarios,boot,pour').split(',');
const KEEP = args.includes('--keep');
const PORT = Number(flag('port', '18157'));
const OUT = join(ROOT, 'fake-decaid', 'recordings');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const recordedWith = { decaid: PINS.decaid.version, dye2: PINS.dye2.version, streamline: PINS.streamline.version };
const write = (name, data) => writeFile(join(OUT, `${name}.json`), `${JSON.stringify({ recordedWith, ...data }, null, 1)}\n`);

// --api= and --token-file= (the file --keep names) point it at a Decaid already
// running, the token read from the file so it is on no command line, for working on a
// scenario; a recording to commit comes from a fresh stack.
const stack = flag('api', '')
    ? { api: flag('api', ''), token: flag('token-file', '') ? (await readFile(flag('token-file', ''), 'utf8')).trim() : '', stop: () => {} }
    : await standUp({ port: PORT });
// Ctrl-C or a kill skips the `finally` below: the container goes with it.
if (!KEEP) {
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stack.stop(); process.exit(signal === 'SIGINT' ? 130 : 143); });
}
const PORT_USED = new URL(stack.api).port;

// The versions written on each recording are the pins: the stack and the page
// recorded must be them, a stack reached with --api= included. A check that
// fails, or can't be made, removes the stack it stood up.
try {
    const { version: decaidVersion } = await (await fetch(`${stack.api}/info`)).json();
    const dye2 = (await (await fetch(`${stack.api}/plugins`)).json()).find(plugin => plugin.id === 'dye2.reaplugin');
    const skin = JSON.parse(await readFile(join(ROOT, 'skin-manifest.json'), 'utf8')).version;
    const problems = [
        decaidVersion !== PINS.decaid.version && `Decaid ${decaidVersion} is running, pinned ${PINS.decaid.version}`,
        dye2?.version !== PINS.dye2.version && `DYE2 ${dye2?.version ?? 'is not'} loaded, pinned ${PINS.dye2.version}`,
        !String(skin).startsWith(`${PINS.streamline.version}-`) && String(skin) !== PINS.streamline.version && `the page is Streamline ${skin}, pinned ${PINS.streamline.version}`,
    ].filter(Boolean);
    if (problems.length) throw new Error(`not recording: ${problems.join('; ')}`);
} catch (error) {
    stack.stop();
    throw error;
}
const ws = `ws://127.0.0.1:${PORT_USED}/ws/v1`;

/** Decaid's REST API: answers JSON, throws on an error status. */
async function decaid(method, path, body, { manage = false } = {}) {
    const res = await fetch(`${stack.api}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(manage ? { Authorization: `Bearer ${stack.token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
}

/** A request as the page makes it: its status and body, whatever the status. */
async function raw(method, path, body) {
    const res = await fetch(`${stack.api}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, body: parsed };
}

/** Frames from a few of Decaid's sockets, each with its time from `start()`. */
function listen(paths) {
    const frames = [];
    let zero = Date.now();
    const sockets = paths.map(path => {
        const socket = new WebSocket(`${ws}/${path}`);
        socket.onmessage = event => frames.push({ ms: Date.now() - zero, socket: path, frame: JSON.parse(String(event.data)) });
        return socket;
    });
    return {
        frames,
        opened: () => Promise.all(sockets.map(opened)).catch(error => { sockets.forEach(s => s.close()); throw error; }),
        start: () => { zero = Date.now(); frames.length = 0; },
        elapsed: () => Date.now() - zero,
        close: () => sockets.forEach(s => s.close()),
    };
}

// A shot on the simulated machine, after a Workflow write: espresso, until the
// machine stops itself or 30 s pass, then idle, and the Shot Decaid stores.
// Headless Decaid opens its live-shot screen for the first shot in its default
// gateway mode, and with no one there to close it, starts no shot again
// (`_handleDisabledModeForEspresso` in de1_state_manager.dart). In "tracking"
// mode the same shot sequencer runs with no screen, so each pull is made in it
// and the mode put back afterwards.
async function pullShot(workflow, sockets) {
    const { gatewayMode } = await decaid('GET', '/settings');
    await decaid('POST', '/settings', { gatewayMode: 'tracking' });
    try {
        return await pullOne(workflow, sockets);
    } finally {
        await decaid('POST', '/settings', { gatewayMode });
    }
}

async function pullOne(workflow, sockets) {
    if (workflow) await decaid('PUT', '/workflow', workflow);
    const before = (await decaid('GET', '/shots?limit=1')).items?.[0]?.id ?? null;
    const watch = sockets || listen(['machine/snapshot']);
    if (!sockets) await watch.opened();
    watch.start();
    await decaid('PUT', '/machine/state/espresso');
    const states = () => watch.frames.filter(f => f.socket === 'machine/snapshot').map(f => f.frame.state.state);
    let idleAt = null;
    for (let waited = 0; waited < 30_000; waited += 50) {
        await sleep(50);
        const seen = states();
        if (seen.includes('espresso') && seen.at(-1) !== 'espresso') { idleAt = watch.frames.findLast(f => f.socket === 'machine/snapshot' && f.frame.state.state !== 'espresso').ms; break; }
    }
    if (idleAt === null) await decaid('PUT', '/machine/state/idle');
    let shot = null;
    let storedAt = null;
    for (let waited = 0; waited < 20_000 && !shot; waited += 50) {
        const newest = (await decaid('GET', '/shots?limit=1')).items?.[0];
        if (newest && newest.id !== before) { shot = newest; storedAt = watch.elapsed(); }
        else await sleep(50);
    }
    if (!shot) throw new Error('Decaid stored no Shot within 20 s of the pour');
    if (!sockets) watch.close();
    // After a shot the machine stopped itself, Decaid starts no other until it
    // is asked for idle: the simulated machine goes into espresso and nothing is
    // stored. Asked once the Shot is stored, so the store is not cut short.
    await decaid('PUT', '/machine/state/idle');
    await sleep(3000);
    return { shot, idleAt, storedAt };
}

// The state the sample data leaves, as Decaid and DYE2 answer it: the page
// tests' starting point.
async function sampleData() {
    const made = await seed(decaid, { pullShot: workflow => pullShot(workflow) });
    const shots = (await decaid('GET', '/shots?limit=100')).items;
    // DYE2 works out its recents a moment after a Shot is stored.
    await sleep(2000);
    await write('sample-data', {
        about: 'The made-up sample data (scripts/fake-decaid-recorder/seed.mjs) as the real stack holds it: the fake\'s starting state in the page tests.',
        workflow: await decaid('GET', '/workflow'),
        store: {
            'dye2.reaplugin': await decaid('GET', '/store/dye2.reaplugin?full=1'),
            streamlineSettings: await decaid('GET', '/store/streamlineSettings?full=1'),
        },
        plugins: await decaid('GET', '/plugins'),
        beans: await decaid('GET', '/beans?includeArchived=true'),
        batches: Object.fromEntries(await Promise.all(Object.values(made.batches).map(async b => [b.beanId, await decaid('GET', `/beans/${b.beanId}/batches?includeArchived=true`)]))),
        grinders: await decaid('GET', '/grinders?includeArchived=true'),
        shots: await Promise.all(shots.map(row => decaid('GET', `/shots/${row.id}`))),
        selection: await decaid('GET', '/plugins/dye2.reaplugin/selection'),
    });
}

// Every request and socket the page opens over 65 s of its clock, answered by
// the real stack. The fake answers what it keeps from its own state; the boot
// keeps the rest, the answers to Streamline's own modules.
async function boot() {
    const { OWNED } = await import('../../fake-decaid/index.js');
    const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP 127.0.0.1:8080 127.0.0.1:${PORT_USED}`, '--disable-features=LocalNetworkAccessChecks'] });
    const context = await browser.newContext({ viewport: { width: 1920, height: 1200 }, timezoneId: 'UTC', locale: 'en-US' });
    await servePage(context, ROOT);
    const page = await context.newPage();
    const requests = {};
    const sockets = {};
    page.on('response', async response => {
        const url = new URL(response.url());
        if (url.port !== '8080') return;
        const request = response.request();
        const key = `${request.method()} ${url.pathname}${url.search}`;
        if (OWNED(request.method(), url.pathname)) return;
        let body = null;
        try { body = JSON.parse(await response.text()); } catch { body = null; }
        requests[key] ||= { status: response.status(), body, requestBody: request.postData() };
    });
    page.on('websocket', socket => {
        const path = new URL(socket.url()).pathname;
        if (OWNED('WS', path)) return;
        const entry = sockets[path] ||= { frames: [] };
        socket.on('framereceived', ({ payload }) => { if (entry.frames.length < 1) entry.frames.push(JSON.parse(String(payload))); });
    });
    await page.clock.install();
    await page.goto(`${PAGE_ORIGIN}/index.html`);
    await page.locator('#cafe-strip .cafe-card').first().waitFor({ timeout: 30_000 });
    // Past the first look of every module and one of every poll: 65 s of the
    // page's time, the skin's update check at 30 s and the plugins' at 60 s
    // among them, a second at a time so each answer comes before the next.
    for (let second = 0; second < 65; second += 1) {
        await page.clock.runFor(1000);
        await page.waitForTimeout(100);
    }
    await browser.close();
    await write('boot', {
        about: 'What the real stack answered the page\'s boot, for the requests and sockets the fake keeps no state for (fake-decaid/boot.js).',
        requests: Object.fromEntries(Object.entries(requests).sort()),
        sockets: Object.fromEntries(Object.entries(sockets).sort()),
    });
}

// One simulated pour with the frames the page's sockets carry, and the Shot
// Decaid stored, taken together. It is pulled with the first sample recipe's
// Workflow, as step 7's page test loads it: the Default profile, with stages of
// its own, which the simulated machine stops on weight.
async function pour() {
    const watch = listen(['machine/snapshot', 'machine/shotState', 'scale/snapshot', 'plugins/dye2.reaplugin/changed']);
    await watch.opened();
    await sleep(1500);
    const atRest = {};
    for (const f of watch.frames) if (f.socket !== 'scale/snapshot' || 'weight' in f.frame) atRest[f.socket] = f.frame;
    // Loaded as Streamline's apply loads it: the record's Workflow, and its id.
    const recipe = (await decaid('GET', '/store/dye2.reaplugin/recipes')).find(row => row.name === RECIPES[0].name);
    await decaid('PUT', '/workflow', { profile: recipe.workflow.profile, context: { ...recipe.workflow.context, extras: { ...recipe.workflow.context.extras, dye: { v: 1, recipeId: recipe.id } } } });
    await sleep(1000);
    const before = await decaid('GET', '/workflow');
    const { shot, idleAt, storedAt } = await pullShot(null, watch);
    watch.close();
    // A pour asked to stop has no moment the machine stopped itself: the fake
    // and the page tests replay to that moment, so it is no recording.
    if (idleAt === null) throw new Error('the simulated pour did not stop by itself within 30 s; nothing written');
    const stored = await decaid('GET', `/shots/${shot.id}`);
    await write('pour', {
        about: 'One simulated pour on the pinned Decaid: each socket frame with its time from the request that started it, through the Shot\'s store, and the Shot Decaid stored (fake-decaid/machine.js).',
        timeZone: 'UTC',
        atRest,
        workflowBefore: before,
        idleAtMs: idleAt,
        storedAtMs: storedAt,
        // Through the store: Decaid's shot-state socket says the shot finished
        // as it stores the Shot, after the machine is back at rest.
        frames: watch.frames.filter(f => f.ms <= storedAt + 1500),
        listRow: shot,
        shot: stored,
    });
}

// The order matters: the scenarios start from the sample data's state, and the
// boot and the pour come after them, so no Shot but the sample data's is there.
try {
    if (ONLY.includes('sample-data')) await sampleData();
    if (ONLY.includes('scenarios')) {
        const sample = JSON.parse(await readFile(join(OUT, 'sample-data.json'), 'utf8'));
        await (await import('./scenarios.mjs')).recordScenarios({ decaid, raw, ws, write, sleep, opened, sample, only: SCENARIO });
    }
    if (ONLY.includes('boot')) await boot();
    if (ONLY.includes('pour')) await pour();
} finally {
    if (KEEP && stack.id) {
        // The token is a credential: kept in a file only its owner reads, never printed.
        const tokenFile = join(CACHE, `kept-${stack.id.slice(0, 12)}.token`);
        await writeFile(tokenFile, stack.token, { mode: 0o600 });
        console.log(`kept: ${stack.api}, container ${stack.id.slice(0, 12)}; its token is in ${tokenFile}`);
    } else if (!KEEP) stack.stop();
}
