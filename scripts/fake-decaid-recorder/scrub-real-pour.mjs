// Makes the real pour's recording (fake-decaid/recordings/real/de1pro-pour.json)
// from a raw capture by capture-real-pour.mjs, holding nothing of the machine
// or cafe it was taken at (docs/cafe/TESTING.md, "The real pour"):
//
//   node scripts/fake-decaid-recorder/scrub-real-pour.mjs <raw file>
//
// What it keeps of the capture: the frames of the machine, the scale and the
// shot-state sockets and DYE2's push, with their times; the Shot's
// measurements, yield, dose and stop reason; the Workflow's profile (one of
// Decaid's own), dose and yield; and the machine's model, firmware and flow
// calibration. What it
// puts in place of the rest: the Workflow is the simulated pour's
// (recordings/pour.json, the sample data's House espresso) but for that
// profile, dose and yield; the serial is a made-up one; the Shot's id is
// made up. The extras a shot-upload plugin wrote into the Shot after Decaid
// stored it are left out: the list row read at the store has none, and the
// fake is Decaid alone. It fails if any text of the capture's own Workflow,
// machine or Shot ids is left in what it writes.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './stack.mjs';

const [rawFile] = process.argv.slice(2);
if (!rawFile) throw new Error('usage: scrub-real-pour.mjs <raw file>');
const raw = JSON.parse(await readFile(rawFile, 'utf8'));
const simulated = JSON.parse(await readFile(join(ROOT, 'fake-decaid', 'recordings', 'pour.json'), 'utf8'));
const copy = value => JSON.parse(JSON.stringify(value));

const SHOT_ID = '00000000-0000-4000-8000-0000000de1a1';
const SERIAL = '10001';

const workflow = copy(simulated.workflowBefore);
workflow.profile = copy(raw.workflowBefore.profile);
workflow.context.targetDoseWeight = raw.workflowBefore.context.targetDoseWeight;
workflow.context.targetYield = raw.workflowBefore.context.targetYield;

const { model, firmwareVersion, flowCalibration, provenanceStatus } = raw.shot.workflow.machine;
const machine = { provenanceStatus, flowCalibration, serialNumber: SERIAL, model, firmwareVersion };

/** Decaid's own annotations: the shot-upload plugin's extras left out. */
const decaidAnnotations = ({ extras, ...own }) => own;
/** A Shot of the capture with the Workflow above, the made-up id, and none of the plugin's extras. */
function scrubShot(shot, { measurements = true } = {}) {
    const { metadata, ...rest } = shot;
    const out = {
        ...rest,
        id: SHOT_ID,
        workflow: { ...copy(workflow), machine },
        annotations: decaidAnnotations(shot.annotations),
    };
    if (!measurements) delete out.measurements;
    return out;
}

const frames = raw.frames.map(({ ms, socket, frame }) => ({
    ms, socket, frame: socket === 'machine/shotState' && frame.shotId ? { ...frame, shotId: SHOT_ID } : frame,
}));
const atRest = Object.fromEntries(Object.entries(raw.atRest).map(([socket, frame]) => [socket, socket === 'machine/shotState' && frame.shotId ? { ...frame, shotId: SHOT_ID } : frame]));

const shot = scrubShot(raw.shot);

const recording = {
    capturedWith: {
        decaid: raw.capturedWith.decaid,
        dye2: raw.capturedWith.dye2,
        machine: `${model}, firmware ${firmwareVersion}`,
        scale: 'BooKoo Mini, through its Decaid plugin',
    },
    about: 'One real pour on a DE1Pro with a real scale, captured by hand (scripts/fake-decaid-recorder/capture-real-pour.mjs) and scrubbed (scrub-real-pour.mjs): each socket frame with its time from just before the first espresso frame, through the Shot\'s store, and the Shot Decaid stored. Its Workflow is the sample data\'s House espresso but for the profile, dose and yield it was pulled with (fake-decaid/machine.js; docs/cafe/TESTING.md, "The real pour").',
    capturedAt: raw.capturedAt,
    timeZone: 'local, as the tablet stamped its frames',
    atRest,
    workflowBefore: workflow,
    idleAtMs: raw.idleAtMs,
    storedAtMs: raw.storedAtMs,
    frames,
    listRow: scrubShot(raw.listRow, { measurements: false }),
    shot,
};

// Nothing of the capture's own Workflow, machine or ids is left.
const own = new Set();
const collect = value => {
    if (typeof value === 'string' && value.length >= 4) own.add(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
};
const { profile: _profile, ...rawWorkflowRest } = raw.workflowBefore;
collect(rawWorkflowRest);
collect(raw.shot.workflow.machine.serialNumber);
collect(raw.shot.id);
collect(raw.shot.annotations?.extras);
// What the made-up recording holds too is no one's: a default such as the
// beverage type "espresso".
const madeUp = JSON.stringify(simulated);
for (const value of own) if (madeUp.includes(JSON.stringify(value))) own.delete(value);
for (const keep of [model, provenanceStatus, firmwareVersion]) own.delete(keep);
const text = JSON.stringify(recording);
const left = [...own].filter(value => text.includes(value));
if (left.length) throw new Error(`${left.length} value(s) of the capture are still in the recording; nothing written`);

const out = join(ROOT, 'fake-decaid', 'recordings', 'real', 'de1pro-pour.json');
await mkdir(join(out, '..'), { recursive: true });
await writeFile(out, `${JSON.stringify(recording, null, 1)}\n`);
process.stderr.write(`written ${out}\n`);
