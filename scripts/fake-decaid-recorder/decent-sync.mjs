// The second setup of the pinned real stack: Decent Sync's server
// (fake-decaid/pins.json, its published image) with its PostgreSQL, on a
// Docker network of its own, the pinned plugin installed on the recorder's
// Decaid and connected as a Machine at a Location, and a second Decaid (a
// simulated Bengle, with the pinned DYE2) connected as a second Machine there.
// The fake plugin (fake-decaid/decent-sync.js) is recorded against it. How to
// run it is in docs/cafe/TESTING.md.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { asset, standUp, LABEL, PINS } from './stack.mjs';

export const PLUGIN = 'decent-sync.reaplugin';
export const LOCATION = 'Sample Cafe';
export const MACHINE = 'Sample Machine';
export const MACHINE_TWO = 'Sample Machine Two';
// A throwaway server's, bound to this computer's loopback only: fixed, so a
// kept stack can be signed in to again (`serverClient`).
export const EMAIL = 'admin@sample.invalid';
export const PASSWORD = 'sample-admin-password-1';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Until `check()` answers something truthy, every `every` ms, for up to `timeout` ms: its answer, or null. */
export async function until(check, { timeout = 60_000, every = 500 } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
        let got = null;
        try { got = await check(); } catch { got = null; }
        if (got) return got;
        if (Date.now() > deadline) return null;
        await sleep(every);
    }
}

/** A client for a Decaid's REST API: answers JSON, throws on an error status. */
export function decaidClient(api, token) {
    return async function decaid(method, path, body, { manage = false } = {}) {
        const res = await fetch(`${api}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json', ...(manage ? { Authorization: `Bearer ${token}` } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${text.slice(0, 200)}`);
        try { return text ? JSON.parse(text) : null; } catch { return text; }
    };
}

/**
 * Stands up the server, its database and the network the Decaids reach it on,
 * then connects `first` (the recorder's stack) as the Location's first Machine,
 * and a second Decaid as its second. Answers what the recorder needs, and
 * `stop()`, which removes everything it made; a start that fails removes it too.
 *
 * @param {{ first: { id: string, api: string, token: string }, port?: number, secondPort?: number }} options
 */
export async function standUpSync({ first, port = 18159, secondPort = 18158 }) {
    const tag = randomBytes(4).toString('hex');
    const network = `cafe-fake-decaid-net-${tag}`;
    const dbName = `cafe-fake-decaid-db-${tag}`;
    const serverName = `cafe-fake-decaid-sync-${tag}`;
    const made = { network: null, containers: [], second: null };
    const stop = () => {
        made.second?.stop();
        for (const id of made.containers.reverse()) {
            try { docker('rm', '-f', id); } catch (error) { console.error(`could not remove container ${id.slice(0, 12)}: ${error.message.split('\n')[0]}`); }
        }
        if (made.network) {
            try { docker('network', 'disconnect', '-f', made.network, first.id); } catch { /* gone with its container */ }
            try { docker('network', 'rm', made.network); } catch (error) { console.error(`could not remove network ${made.network}: ${error.message.split('\n')[0]}`); }
        }
    };
    try {
        made.network = docker('network', 'create', '--label', `${LABEL}=recorder`, network) && network;
        // The database's password is the server's only, on a network nothing else is on.
        const dbPassword = randomBytes(12).toString('hex');
        made.containers.push(docker('run', '-d', '--name', dbName, '--label', `${LABEL}=recorder`, '--network', network,
            '-e', 'POSTGRES_USER=decent_sync', '-e', `POSTGRES_PASSWORD=${dbPassword}`, '-e', 'POSTGRES_DB=decent_sync', 'postgres:17'));
        // The server exits at start if its database isn't accepting connections yet.
        if (!await until(() => { docker('exec', dbName, 'pg_isready', '-U', 'decent_sync', '-d', 'decent_sync'); return true; }, { timeout: 60_000 })) throw new Error('PostgreSQL did not start in 60 s');
        await sleep(1500);
        const url = `http://127.0.0.1:${port}`;
        made.containers.push(docker('run', '-d', '--name', serverName, '--label', `${LABEL}=recorder`, '--network', network,
            '-e', `DATABASE_URL=postgresql://decent_sync:${dbPassword}@${dbName}:5432/decent_sync`,
            '-e', `PUBLIC_URL=${url}`, '-e', 'DRAIN_GRACE_SECONDS=0', '-p', `127.0.0.1:${port}:3000`, PINS.decentSync.image));
        const server = serverClient(url);
        if (!await until(async () => (await fetch(`${url}/api/setup`)).ok, { timeout: 120_000, every: 1000 })) {
            throw new Error(`the server did not answer in 120 s:\n${docker('logs', '--tail', '40', serverName)}`);
        }
        const running = await (await fetch(`${url}/api/version`).catch(() => null))?.json().catch(() => null);
        if (running?.version && running.version !== PINS.decentSync.version) throw new Error(`Decent Sync ${running.version} is running, pinned ${PINS.decentSync.version}`);
        await server('POST', '/setup', { name: 'Sample Admin', email: EMAIL, password: PASSWORD });
        const { location } = await server('POST', '/locations', { name: LOCATION, timeZone: 'UTC' });
        const pluginFiles = await pluginSource();
        const forTablet = `http://${serverName}:3000`;

        docker('network', 'connect', network, first.id);
        const firstDecaid = decaidClient(first.api, first.token);
        const machine = await connect({ server, decaid: firstDecaid, name: MACHINE, location, pluginFiles, forTablet });

        made.second = await standUp({ port: secondPort, devices: ['bengle', 'scale'] });
        docker('network', 'connect', network, made.second.id);
        const secondDecaid = decaidClient(made.second.api, made.second.token);
        // Streamline's "DYE2 on" setting, as on a tablet the skin runs on.
        await secondDecaid('POST', '/store/streamlineSettings/streamline.dye2Enabled', 'true');
        const machineTwo = await connect({ server, decaid: secondDecaid, name: MACHINE_TWO, location, pluginFiles, forTablet });

        return {
            server, url, location, machine, machineTwo,
            first: firstDecaid,
            second: { ...made.second, decaid: secondDecaid },
            /** The server stopped and started, as an outage: its container, so the plugin loses its connection. */
            stopServer: () => docker('stop', '-t', '2', serverName),
            startServer: async () => {
                docker('start', serverName);
                if (!await until(async () => (await fetch(`${url}/api/setup`)).ok, { timeout: 120_000, every: 1000 })) throw new Error('the server did not answer again in 120 s');
                await server('POST', '/session', { email: EMAIL, password: PASSWORD });
            },
            stop,
        };
    } catch (error) {
        stop();
        throw error;
    }
}

/** The server's REST API as its signed-in Admin. A request with no Origin is a non-browser client's, which it takes from anywhere. */
export function serverClient(url) {
    let cookie = '';
    return async function server(method, path, body) {
        const res = await fetch(`${url}/api${path}`, {
            method,
            headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const set = res.headers.getSetCookie();
        if (set.length) cookie = set.map(line => line.split(';')[0]).join('; ');
        const text = await res.text();
        if (!res.ok) throw new Error(`${method} /api${path} answered ${res.status}: ${text.slice(0, 300)}`);
        try { return text ? JSON.parse(text) : null; } catch { return text; }
    };
}

/** The pinned plugin's manifest and code, from its release asset, checked against its sum. */
async function pluginSource() {
    const zip = await asset(PINS.decentSync.repo, `v${PINS.decentSync.version}`, PINS.decentSync.asset);
    const dir = await mkdtemp(join(tmpdir(), 'cafe-decent-sync-plugin-'));
    try {
        execFileSync('unzip', ['-q', '-o', zip, '-d', dir]);
        const manifest = JSON.parse(await readFile(join(dir, PLUGIN, 'manifest.json'), 'utf8'));
        if (manifest.version !== undefined && manifest.version !== PINS.decentSync.version) throw new Error(`the plugin asset says ${manifest.version}, pinned ${PINS.decentSync.version}`);
        return { manifest, plugin: await readFile(join(dir, PLUGIN, 'plugin.js'), 'utf8') };
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

/**
 * A Machine made at the Location, the plugin installed on `decaid` from the
 * pinned source and connected as it, its sharing on, and served.
 */
async function connect({ server, decaid, name, location, pluginFiles, forTablet }) {
    const { machine, token } = await server('POST', '/machines', { name, locationId: location.id });
    await decaid('PUT', `/plugins/${PLUGIN}/source`, pluginFiles, { manage: true });
    const settings = { ServerUrl: forTablet, Token: token, PollSeconds: 5 };
    // Decaid started with no account keeps a secure setting in memory, and its first save can fail.
    await decaid('POST', `/plugins/${PLUGIN}/settings`, settings, { manage: true })
        .catch(() => decaid('POST', `/plugins/${PLUGIN}/settings`, settings, { manage: true }));
    await decaid('POST', `/plugins/${PLUGIN}/enable`, undefined, { manage: true }).catch(() => {});
    await server('PUT', `/machines/${machine.id}/sharing`, { sharing: true });
    const served = await until(async () => (await decaid('GET', `/plugins/${PLUGIN}/status`)).served === true, { timeout: 90_000, every: 1000 });
    if (!served) throw new Error(`Decent Sync's plugin did not come to serve ${name} in 90 s`);
    const plugin = (await decaid('GET', '/plugins')).find(p => p.id === PLUGIN);
    if (plugin?.version !== PINS.decentSync.version) throw new Error(`the plugin loaded is ${plugin?.version}, pinned ${PINS.decentSync.version}`);
    return machine;
}

/**
 * A Shot pulled on a Decaid, with `workflow` written first where given: for
 * `seconds`, or until the simulated machine stops itself (30 s at most), then
 * idle, and answers the Shot Decaid stored. Pulled in Decaid's `tracking`
 * mode, as the recorder's own pulls are (record.mjs).
 */
export async function pull(decaid, { workflow, seconds } = {}) {
    const { gatewayMode } = await decaid('GET', '/settings');
    await decaid('POST', '/settings', { gatewayMode: 'tracking' });
    try {
        if (workflow) await decaid('PUT', '/workflow', workflow);
        const before = (await decaid('GET', '/shots?limit=1')).items?.[0]?.id ?? null;
        await decaid('PUT', '/machine/state/espresso');
        const state = async () => (await decaid('GET', '/machine/state')).state.state;
        if (seconds !== undefined) await sleep(seconds * 1000);
        else {
            await until(async () => (await state()) === 'espresso', { timeout: 10_000, every: 100 });
            await until(async () => (await state()) !== 'espresso', { timeout: 30_000, every: 200 });
        }
        await decaid('PUT', '/machine/state/idle');
        const shot = await until(async () => {
            const newest = (await decaid('GET', '/shots?limit=1')).items?.[0];
            return newest && newest.id !== before ? newest : null;
        }, { timeout: 20_000, every: 250 });
        if (!shot) throw new Error('Decaid stored no Shot within 20 s of the pull');
        // After a shot, Decaid starts no other until it is asked for idle.
        await decaid('PUT', '/machine/state/idle');
        await sleep(2000);
        return decaid('GET', `/shots/${shot.id}`);
    } finally {
        await decaid('POST', '/settings', { gatewayMode });
    }
}

/** The Workflow Streamline's apply writes for a DYE2 record (scenarios.mjs `applied`), with a barista. */
export function appliedWith(record, barista) {
    return {
        context: {
            ...record.workflow.context,
            extras: { ...record.workflow.context.extras, dye: { v: 1, recipeId: record.id }, rpm: null, feedRate: null },
            drinkerName: null,
            baristaName: barista,
        },
        profile: record.workflow.profile,
    };
}
