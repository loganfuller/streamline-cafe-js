// The pinned real stack the fake Decaid is recorded against: a headless Decaid
// with a simulated machine and scale, in a throwaway Docker container, with the
// pinned DYE2 in place before Decaid's first start. Versions and checksums come
// from fake-decaid/pins.json. How to run it is in docs/cafe/TESTING.md.

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..', '..');
// FAKE_DECAID_PINS names another pins file: the weekly run's, written by
// latest-pins.mjs from the newest stable releases.
export const PINS_FILE = process.env.FAKE_DECAID_PINS || join(ROOT, 'fake-decaid', 'pins.json');
export const PINS = JSON.parse(await readFile(PINS_FILE, 'utf8'));
export const LABEL = 'streamline-cafe-js.fake-decaid';
export const CACHE = process.env.FAKE_DECAID_CACHE || join(homedir(), '.cache', 'streamline-cafe-fake-decaid');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function sha256(path) {
    return createHash('sha256').update(await readFile(path)).digest('hex');
}

// A release asset, downloaded once into the cache and checked against its pinned sum.
export async function asset(repo, tag, { name, sha256: want }) {
    await mkdir(CACHE, { recursive: true });
    const path = join(CACHE, name);
    if (!existsSync(path) || (await sha256(path)) !== want) {
        const url = `https://github.com/${repo}/releases/download/${tag}/${name}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url} answered ${res.status}`);
        await writeFile(path, Buffer.from(await res.arrayBuffer()));
    }
    const got = await sha256(path);
    if (got !== want) throw new Error(`${name}: sha256 ${got}, pinned ${want}`);
    return path;
}

// The image holds Decaid's system libraries only; Decaid and DYE2 are copied in
// at each start, so a bump needs no rebuild.
function baseImage() {
    const tag = `streamline-cafe-fake-decaid-base:${createHash('sha256').update(execFileSync('cat', [join(HERE, 'Dockerfile')])).digest('hex').slice(0, 12)}`;
    const present = docker('images', '-q', tag);
    if (!present) execFileSync('docker', ['build', '-q', '--label', `${LABEL}=base`, '-t', tag, HERE], { stdio: 'inherit' });
    return tag;
}

/**
 * Until `socket` is open. Fails if it errors or closes first, or is not open in
 * 10 s, so a refused socket ends the run (and its container) rather than hang.
 */
export function opened(socket) {
    if (socket.readyState === 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => fail(new Error(`${socket.url}: not open in 10 s`)), 10_000);
        const done = () => { clearTimeout(timer); socket.removeEventListener('open', onOpen); socket.removeEventListener('error', onError); socket.removeEventListener('close', onClose); };
        const fail = error => { done(); reject(error); };
        const onOpen = () => { done(); resolve(); };
        const onError = () => fail(new Error(`${socket.url}: the socket failed to open`));
        const onClose = event => fail(new Error(`${socket.url}: closed before it opened (${event.code})`));
        socket.addEventListener('open', onOpen);
        socket.addEventListener('error', onError);
        socket.addEventListener('close', onClose);
    });
}

/**
 * Starts the pinned Decaid. Returns its API's address, its extensions token, the
 * container's id, and `stop()`, which removes the container.
 *
 * Each run gets a container of its own, named afresh, so two recorders, or one
 * kept with --keep, never remove each other's. A start that fails removes the
 * container it made.
 *
 * `devices` is what Decaid simulates: a DE1 and a scale unless told otherwise
 * (Decent Sync's second Machine is a Bengle, since two simulated DE1s share a
 * serial, which its server refuses).
 *
 * @param {{ port?: number, timezone?: string, devices?: string[] }} [options]
 */
export async function standUp({ port = 18157, timezone = 'UTC', devices = ['machine', 'scale'] } = {}) {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const decaidTag = `v${PINS.decaid.version}`;
    const decaidArchive = await asset(PINS.decaid.repo, decaidTag, PINS.decaid.assets[arch]);
    const dye2Archive = await asset(PINS.dye2.repo, `v${PINS.dye2.version}`, PINS.dye2.asset);
    const image = baseImage();
    const name = `cafe-fake-decaid-recorder-${randomBytes(4).toString('hex')}`;
    // Created, then started, so a start that fails (its port taken, say) still
    // leaves an id to remove.
    const id = docker('create', '--name', name, '--label', `${LABEL}=recorder`, '-e', `TZ=${timezone}`,
        '-p', `127.0.0.1:${port}:8080`, image, 'sleep', 'infinity');
    const stop = () => {
        try { docker('rm', '-f', id); } catch (error) { console.error(`could not remove container ${id.slice(0, 12)}: ${error.message.split('\n')[0]}`); }
    };
    const exec = command => docker('exec', id, 'bash', '-c', command);
    const token = randomBytes(32).toString('hex');
    const api = `http://127.0.0.1:${port}/api/v1`;
    try {
        docker('start', id);
        docker('cp', decaidArchive, `${id}:/tmp/decaid.tar.gz`);
        docker('cp', dye2Archive, `${id}:/tmp/dye2.zip`);
        exec('mkdir -p /opt/decaid && tar -xzf /tmp/decaid.tar.gz -C /opt/decaid');
        // DYE2 placed before Decaid's first start stays at its version: Decaid
        // installs its bundled copy only where none is.
        exec('mkdir -p ~/.local/share/decaid/plugins && unzip -q -o /tmp/dye2.zip -d ~/.local/share/decaid/plugins');
        exec(`echo '${JSON.stringify({ simulateDevices: devices, onboardingCompleted: true, accountStepSeen: true })}' > ~/.local/share/decaid/shared_preferences.json`);
        exec('mkdir -p /run/dbus && (dbus-daemon --system --fork || true) && (avahi-daemon -D || true)');
        // The token goes through the environment, never the command line, so
        // no process list or failed command's message shows it.
        execFileSync('docker', ['exec', '-d', '-e', 'DECAID_EXTENSIONS_TOKEN', id, 'bash', '-c',
            'xvfb-run -a dbus-run-session -- /opt/decaid/bundle/decaid --serial --bypass-onboarding --no-account > /tmp/decaid.log 2>&1'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DECAID_EXTENSIONS_TOKEN: token } });
        const deadline = Date.now() + 120_000;
        for (;;) {
            try {
                const plugins = await (await fetch(`${api}/plugins`)).json();
                const dye2 = plugins.find(plugin => plugin.id === 'dye2.reaplugin');
                if (dye2?.loaded) {
                    if (dye2.version !== PINS.dye2.version) throw new Error(`DYE2 ${dye2.version} loaded, pinned ${PINS.dye2.version}`);
                    break;
                }
            } catch (error) {
                if (/pinned/.test(error.message)) throw error;
            }
            if (Date.now() > deadline) throw new Error(`Decaid did not answer with DYE2 loaded in 120 s:\n${exec('tail -n 40 /tmp/decaid.log')}`);
            await sleep(1000);
        }
    } catch (error) {
        stop();
        throw error;
    }
    return {
        api,
        token,
        id,
        exec,
        stop,
    };
}
