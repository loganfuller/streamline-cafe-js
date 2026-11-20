// The two stacks the real journeys run on, stood up from the pins
// (fake-decaid/pins.json) by the recorder's own scripts
// (scripts/fake-decaid-recorder/): `decaid`, a headless Decaid with a simulated
// machine and the pinned DYE2, seeded with the sample data; and `sync`, another
// such Decaid with Decent Sync's second setup on it (the server's pinned image,
// its PostgreSQL, the pinned plugin, and a second Decaid, a simulated Bengle, as
// the Location's second Machine). How to run them is in docs/cafe/TESTING.md.
//
// The two are stood up at once and written to a state file, which the journeys'
// fixtures (journey.mjs) read: a worker started again after a failure finds the
// same stacks. REAL_STACK=<file> runs against stacks kept from an earlier run.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { standUp, CACHE, PINS, PINS_FILE } from '../../../scripts/fake-decaid-recorder/stack.mjs';
import { standUpSync, decaidClient, serverClient, pull, until, EMAIL, PASSWORD } from '../../../scripts/fake-decaid-recorder/decent-sync.mjs';
import { seed } from '../../../scripts/fake-decaid-recorder/seed.mjs';

export { PINS, PINS_FILE };

/** Where the stacks' addresses, tokens and containers are written. Never printed: it holds the extensions tokens. */
export const STATE = process.env.REAL_STACK || join(CACHE, 'journeys-stack.json');

// Ports of their own, so the journeys and the recorder (18157–18159) can run at
// once; REAL_STACK_PORT moves all four, for a second set kept beside the first.
const BASE = Number(process.env.REAL_STACK_PORT || 18257);
const PORTS = { decaid: BASE, sync: BASE + 1, server: BASE + 2, second: BASE + 3 };

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A seeded Decaid: the sample data the page tests start from, written as the recorder writes it. */
async function seeded(port) {
    const stack = await standUp({ port });
    try {
        const decaid = decaidClient(stack.api, stack.token);
        await seed(decaid, { pullShot: workflow => pull(decaid, { workflow }) });
        return stack;
    } catch (error) {
        stack.stop();
        throw error;
    }
}

/**
 * Stands both stacks up, writes the state file, and answers `stop()`, which
 * removes everything they made. Either failing removes both.
 */
export async function standUpStacks() {
    const made = [];
    const stop = () => { for (const stack of made.reverse()) stack.stop(); };
    try {
        // Both at once; each that stood up is kept to remove, whichever failed.
        const started = await Promise.allSettled([seeded(PORTS.decaid), seeded(PORTS.sync)]);
        for (const result of started) if (result.status === 'fulfilled') made.push(result.value);
        const failed = started.find(result => result.status === 'rejected');
        if (failed) throw failed.reason;
        const [decaid, syncFirst] = started.map(result => result.value);
        const stage = await standUpSync({ first: { id: syncFirst.id, api: syncFirst.api, token: syncFirst.token }, port: PORTS.server, secondPort: PORTS.second });
        // The second setup is removed before the Decaid it is connected to.
        made.push({ stop: stage.stop });
        const state = {
            pins: PINS_FILE,
            decaid: { api: decaid.api, token: decaid.token, id: decaid.id },
            sync: {
                api: syncFirst.api, token: syncFirst.token, id: syncFirst.id,
                server: { url: stage.url, name: stage.serverName, forTablet: stage.forTablet, email: EMAIL, password: PASSWORD },
                location: { id: stage.location.id, name: stage.location.name },
                machine: { id: stage.machine.id, name: stage.machine.name },
                machineTwo: { id: stage.machineTwo.id, name: stage.machineTwo.name },
                second: { api: stage.second.api, token: stage.second.token, id: stage.second.id },
            },
        };
        await mkdir(CACHE, { recursive: true });
        await writeFile(STATE, JSON.stringify(state, null, 1), { mode: 0o600 });
        return { state, stop: async () => { stop(); await rm(STATE, { force: true }); } };
    } catch (error) {
        stop();
        throw error;
    }
}

/**
 * The stacks in the state file, as clients: each Decaid's REST client (its
 * `decaid(method, path, body, { manage })`), and for the sync stack the
 * server's, signed in as its Admin, with its outage (`stopServer`, `startServer`).
 */
export async function attachStacks() {
    if (!existsSync(STATE)) throw new Error(`no real stack at ${STATE}: run the journeys with npm run test:real, which stands one up`);
    const state = JSON.parse(await readFile(STATE, 'utf8'));
    const server = serverClient(state.sync.server.url);
    await server('POST', '/session', { email: state.sync.server.email, password: state.sync.server.password });
    const at = side => ({ ...side, port: Number(new URL(side.api).port), decaid: decaidClient(side.api, side.token) });
    return {
        decaid: at(state.decaid),
        sync: {
            ...at(state.sync),
            second: at(state.sync.second),
            server,
            serverUrl: state.sync.server.url,
            location: state.sync.location,
            machine: state.sync.machine,
            machineTwo: state.sync.machineTwo,
            /** The server's container stopped, as an outage: the plugins lose their connection. */
            stopServer: () => docker('stop', '-t', '2', state.sync.server.name),
            /** Started again, answering, and signed in to again. */
            startServer: async () => {
                docker('start', state.sync.server.name);
                const url = state.sync.server.url;
                if (!await until(async () => (await fetch(`${url}/api/setup`)).ok, { timeout: 120_000, every: 1000 })) throw new Error('the server did not answer again in 120 s');
                await server('POST', '/session', { email: state.sync.server.email, password: state.sync.server.password });
            },
        },
    };
}

/**
 * Official Streamline at its pinned commit, downloaded once into the cache and
 * unpacked: the directory its files are served from (smoke step 14).
 */
export async function officialStreamline() {
    const { repo, commit } = PINS.streamline;
    const dir = join(CACHE, `streamline-${commit}`);
    if (existsSync(join(dir, 'index.html'))) return dir;
    const url = `https://codeload.github.com/${repo}/tar.gz/${commit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    await mkdir(dir, { recursive: true });
    const archive = join(CACHE, `streamline-${commit}.tar.gz`);
    await writeFile(archive, Buffer.from(await res.arrayBuffer()));
    execFileSync('tar', ['-xzf', archive, '-C', dir, '--strip-components=1']);
    await rm(archive, { force: true });
    const { version } = JSON.parse(await readFile(join(dir, 'skin-manifest.json'), 'utf8'));
    if (version !== PINS.streamline.version) throw new Error(`Streamline at ${commit} says ${version}, pinned ${PINS.streamline.version}`);
    return dir;
}

