// The real-stack workflow's two judges of a fresh recording that differs
// (docs/cafe/TESTING.md, "The real-stack workflow"): the shape comparison
// (scripts/fake-decaid-recorder/compare.mjs) and the weekly run's report
// (scripts/fake-decaid-recorder/weekly-issue.mjs).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { report } from '../scripts/fake-decaid-recorder/weekly-issue.mjs';

const COMPARE = fileURLToPath(new URL('../scripts/fake-decaid-recorder/compare.mjs', import.meta.url));

function compare(committed, fresh) {
    const root = mkdtempSync(join(tmpdir(), 'real-stack-compare-'));
    for (const [dir, body] of [['committed', committed], ['fresh', fresh]]) {
        mkdirSync(join(root, dir));
        writeFileSync(join(root, dir, 'store.json'), JSON.stringify(body));
    }
    return spawnSync(process.execPath, [COMPARE, join(root, 'committed'), join(root, 'fresh')], { encoding: 'utf8' });
}

const recorded = shotId => ({
    workflow: { targetGroupTemperature: 93, targetHotWaterVolume: 80 },
    shots: { [shotId]: { id: shotId, time: 1 }, [`recipe-${shotId.slice(0, 12).replace(/-/g, 'x')}`]: { name: 'House' } },
});

test('ids new on every stack are the same shape', () => {
    const run = compare(recorded('0f3c9a1e-2b4d-4c6e-8a10-1b2c3d4e5f60'), recorded('9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d'));
    assert.equal(run.status, 0, run.stdout);
});

test('a long field renamed upstream is a difference, not an id', () => {
    const fresh = recorded('0f3c9a1e-2b4d-4c6e-8a10-1b2c3d4e5f60');
    fresh.workflow = { groupTemperatureTarget: 93, targetHotWaterVolume: 80 };
    const run = compare(recorded('0f3c9a1e-2b4d-4c6e-8a10-1b2c3d4e5f60'), fresh);
    assert.equal(run.status, 1);
    assert.match(run.stdout, /- \$\.workflow\.targetGroupTemperature/);
    assert.match(run.stdout, /\+ \$\.workflow\.groupTemperatureTarget/);
});

const versions = { decaid: { version: '1' }, dye2: { version: '1' }, decentSync: { version: '1' }, streamline: { version: '1' } };
const clean = { ran: versions, pinned: versions, record: 'success', recordJob: 'success', replays: [], compare: '', journeys: [], journeyOutcome: 'success' };

test('the weekly report: nothing to say when everything passed', () => {
    assert.equal(report(clean), null);
});

test('the weekly report: a recorder job that failed after recording, naming nothing, is still reported', () => {
    const text = report({ ...clean, recordJob: 'failure' });
    assert.ok(text);
    assert.match(text, /recorder's job failed after recording\*\* \(failure\)/);
});
