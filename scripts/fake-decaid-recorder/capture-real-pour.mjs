// Captures one pour from a real machine's Decaid, read-only: the frames of
// the sockets record.mjs listens to and the Shot Decaid stored, in the shape
// of recordings/pour.json, for a pour someone starts on the machine (a GHC
// machine starts no shot from its tablet). It writes nothing to Decaid. The
// raw capture holds the machine's names, serial and Workflow: it goes to a
// file outside the repository, and scrub-real-pour.mjs makes the recording
// to commit from it. How it was used is in docs/cafe/TESTING.md.
//
//   node scripts/fake-decaid-recorder/capture-real-pour.mjs \
//     --api=http://<tablet>:8080/api/v1 --out=<raw file> [--wait-min=20]

import { writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const flag = (name, fallback) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const API = flag('api', '');
if (!API) throw new Error('--api= is needed, as http://<tablet>:8080/api/v1');
const WS = API.replace(/^http/, 'ws').replace(/\/api\/v1$/, '/ws/v1');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const get = async path => {
    const response = await fetch(`${API}${path}`);
    if (!response.ok) throw new Error(`GET ${path}: ${response.status}`);
    return response.json();
};
const log = text => process.stderr.write(`${new Date().toISOString().slice(11, 19)} ${text}\n`);

const OUT = flag('out', '');
if (!OUT) throw new Error('--out= is needed: a file outside the repository');
const WAIT = Number(flag('wait-min', '20')) * 60_000;

const info = await get('/machine/info');
const versions = { decaid: (await get('/info')).version, dye2: (await get('/plugins')).find(p => p.id === 'dye2.reaplugin')?.version ?? null };
log(`machine ${info.model}, firmware ${info.version}; Decaid ${versions.decaid}, DYE2 ${versions.dye2}`);

const PATHS = ['machine/snapshot', 'machine/shotState', 'scale/snapshot', 'plugins/dye2.reaplugin/changed'];
const frames = [];
const sockets = PATHS.map(path => {
    const socket = new WebSocket(`${WS}/${path}`);
    socket.onmessage = event => frames.push({ at: Date.now(), socket: path, frame: JSON.parse(String(event.data)) });
    socket.onclose = () => log(`socket ${path} closed`);
    return socket;
});
await Promise.all(sockets.map(socket => new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error(`could not open ${socket.url}`));
})));
log('sockets open');
await sleep(1500);
const atRest = {};
for (const f of frames) if (f.socket !== 'scale/snapshot' || 'weight' in f.frame) atRest[f.socket] = f.frame;
if (!atRest['scale/snapshot']) throw new Error('no scale frame with a weight: is the scale connected?');
const workflowBefore = await get('/workflow');
const before = (await get('/shots?limit=1')).items?.[0]?.id ?? null;
log(`at rest (${atRest['machine/snapshot']?.state?.state}); Workflow profile "${workflowBefore.profile?.title}", dose ${workflowBefore.context?.targetDoseWeight}, yield ${workflowBefore.context?.targetYield}`);
log(`waiting up to ${WAIT / 60_000} min for a shot started on the machine`);

const isEspresso = f => f.socket === 'machine/snapshot' && f.frame.state?.state === 'espresso';
let started = null;
for (const until = Date.now() + WAIT; Date.now() < until && !started; await sleep(50)) started = frames.find(isEspresso) ?? null;
if (!started) throw new Error('no shot was started');
// The time a request would have started it, as record.mjs counts from: a
// tenth of a second before the first espresso frame.
const zero = started.at - 100;
log('espresso started');
let idleAt = null;
for (const until = Date.now() + 120_000; Date.now() < until && idleAt === null; await sleep(50)) {
    const last = frames.findLast(f => f.socket === 'machine/snapshot');
    if (last && last.at > started.at && last.frame.state?.state !== 'espresso') idleAt = last.at - zero;
}
if (idleAt === null) throw new Error('the machine did not leave espresso within 2 min');
log(`back at rest ${(idleAt / 1000).toFixed(1)} s after the start`);
let listRow = null;
let storedAt = null;
for (const until = Date.now() + 30_000; Date.now() < until && !listRow; await sleep(50)) {
    const newest = (await get('/shots?limit=1')).items?.[0];
    if (newest && newest.id !== before) { listRow = newest; storedAt = Date.now() - zero; }
}
if (!listRow) throw new Error('Decaid stored no Shot within 30 s of the pour');
await sleep(1600);
sockets.forEach(socket => socket.close());
const shot = await get(`/shots/${listRow.id}`);
log(`stored ${shot.id} ${(storedAt / 1000).toFixed(1)} s after the start: annotations ${JSON.stringify(shot.annotations)}, stopped ${shot.stopReason}`);

await writeFile(OUT, `${JSON.stringify({
    capturedWith: versions,
    machine: { model: info.model, firmware: info.version, GHC: info.GHC },
    capturedAt: new Date(zero).toISOString(),
    atRest,
    workflowBefore,
    idleAtMs: idleAt,
    storedAtMs: storedAt,
    frames: frames.filter(f => f.at >= zero && f.at - zero <= storedAt + 1500).map(({ at, socket, frame }) => ({ ms: at - zero, socket, frame })),
    listRow,
    shot,
}, null, 1)}\n`);
log(`written to ${OUT}`);
process.exit(0);
