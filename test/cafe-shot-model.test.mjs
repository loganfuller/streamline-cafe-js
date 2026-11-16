// The graph's Shots: a recipe's latest, the Unfinished rule, a Shot's lines,
// the legend and the kept choice (docs/cafe/DESIGN.md, "Shots and the reference").
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    shotRecipeId, shotsWithRecipe, isUnfinished, shotCurves, shotCredit,
    differentProfile, whenText, viewFrom, graphModel, chosenShotId, withChosenShot,
} from '../src/cafe/shot-model.js';
import { createTabletShots } from '../src/cafe/tablet-shots.js';

const workflowFor = (recipeId, extra = {}) => ({ context: { extras: { dye: { v: 1, recipeId } }, ...extra } });

// One sample every half second from 10:00:00, local time as Decaid writes it.
const at = seconds => `2026-11-12T10:00:${String(Math.floor(seconds)).padStart(2, '0')}.${seconds % 1 ? '500' : '000'}`;
const sample = (seconds, substate, { pressure = 0, flow = 0, weight, weightFlow } = {}) => ({
    machine: { timestamp: at(seconds), state: { state: 'espresso', substate }, pressure, flow },
    ...(weight === undefined ? {} : { scale: { timestamp: at(seconds), weight, ...(weightFlow === undefined ? {} : { weightFlow }) } }),
});

test('a Workflow names its recipe by DYE2 record id', () => {
    assert.equal(shotRecipeId(workflowFor('r1')), 'r1');
    assert.equal(shotRecipeId(workflowFor(42)), '42');
    assert.equal(shotRecipeId(workflowFor(null)), null);
    assert.equal(shotRecipeId({ context: {} }), null);
    assert.equal(shotRecipeId(null), null);
});

test('the Shots pulled with a recipe keep the list\'s order', () => {
    const rows = [
        { id: 'c', workflow: workflowFor('r2') },
        { id: 'b', workflow: workflowFor('r1') },
        null,
        { id: 'x', workflow: null },
        { id: 'a', workflow: workflowFor('r1') },
    ];
    assert.deepEqual(shotsWithRecipe(rows, 'r1'), ['b', 'a']);
    assert.deepEqual(shotsWithRecipe(rows, 'r3'), []);
    assert.deepEqual(shotsWithRecipe(rows, null), [], 'no recipe matches no Shot, not the Shots with none');
    assert.deepEqual(shotsWithRecipe(undefined, 'r1'), []);
});

test('an Unfinished Shot never reached pouring and never read 1 g', () => {
    const preheat = [sample(0, 'preparingForShot'), sample(1, 'preparingForShot')];
    assert.equal(isUnfinished({ measurements: [...preheat, sample(2, 'preinfusion', { weight: 0.4 })] }), true, 'stopped early in preinfusion');
    assert.equal(isUnfinished({ measurements: preheat }), true, 'stopped in its Preheat');
    assert.equal(isUnfinished({ measurements: [] }), true);
    assert.equal(isUnfinished({}), true);
    assert.equal(isUnfinished({ measurements: [...preheat, sample(2, 'preinfusion'), sample(3, 'pouring')] }), false, 'it poured');
    assert.equal(isUnfinished({ measurements: [...preheat, sample(2, 'preinfusion', { weight: 1 })] }), false, 'stopped on weight inside preinfusion: it ran whole');
    assert.equal(isUnfinished({ measurements: [sample(0, 'preparingForShot', { weight: 30 }), sample(1, 'preinfusion', { weight: 0.2 })] }), true, 'a cup on the scale during Preheat is not a first drip');
    assert.equal(isUnfinished({ measurements: [...preheat, { scale: { timestamp: at(2), weight: 5 } }] }), false, 'a sample with no machine reading ends the Preheat');
    assert.equal(isUnfinished({ measurements: [...preheat, sample(2, 'preinfusion', { weight: '12' })] }), true, 'a weight that is not a number is no reading');
});

test('a Shot\'s lines start at its first preinfusion sample and cover preinfusion and pouring only', () => {
    const curves = shotCurves([
        sample(0, 'preparingForShot', { pressure: 9, flow: 9 }),
        sample(1, 'preinfusion', { pressure: 1, flow: 4, weight: 0, weightFlow: 0 }),
        sample(2, 'pouring', { pressure: 8, flow: 2, weight: 3, weightFlow: 1.5 }),
        sample(3.5, 'pouring', { pressure: 9, flow: 2.2, weight: 6, weightFlow: 2 }),
        sample(5, 'idle', { pressure: 0, flow: 0, weight: 9, weightFlow: 0.5 }),
    ]);
    assert.deepEqual(curves.pressure, { x: [0, 1, 2.5], y: [1, 8, 9] });
    assert.deepEqual(curves.flow, { x: [0, 1, 2.5], y: [4, 2, 2.2] });
    // A scale reading of 0 g carries no flow yet, as on Streamline's chart.
    assert.deepEqual(curves.weight, { x: [1, 2.5], y: [1.5, 2] });
    assert.equal(curves.seconds, 2.5);
});

test('a machine that reports its own weight flow is the source of that line', () => {
    const machineFlow = (seconds, substate, weightFlow) => {
        const made = sample(seconds, substate, { weight: 5, weightFlow: 99 });
        made.machine.weightFlow = weightFlow;
        return made;
    };
    const curves = shotCurves([machineFlow(0, 'preinfusion', 0), machineFlow(1, 'pouring', 1.2), machineFlow(2, 'pouring', 1.4)]);
    assert.deepEqual(curves.weight, { x: [0, 1, 2], y: [0, 1.2, 1.4] });
});

test('a record with no sample in the shot has no lines', () => {
    for (const measurements of [undefined, [], [null, sample(0, 'preparingForShot')], [{ scale: { timestamp: at(0), weight: 3 } }]]) {
        const curves = shotCurves(measurements);
        assert.deepEqual([curves.pressure.x, curves.flow.x, curves.weight.x, curves.seconds], [[], [], [], 0]);
    }
});

test('a Shot is credited with when it was pulled and the barista it recorded', () => {
    const shot = { id: 's', timestamp: '2026-11-12T10:00:00.000', workflow: { context: { baristaName: ' Sample Barista ' } } };
    assert.deepEqual(shotCredit(shot), { when: new Date(2026, 10, 12, 10, 0, 0), who: 'Sample Barista' });
    assert.deepEqual(shotCredit({ id: 's', timestamp: 'not a time', workflow: {} }), { when: null, who: '' });
    assert.deepEqual(shotCredit(null), { when: null, who: '' });
});

test('"Different profile" compares titles, and says nothing when either names none', () => {
    const shot = title => ({ workflow: { profile: { title, id: 'profile:abc' } } });
    assert.equal(differentProfile({ profileTitle: 'Default' }, shot('Adaptive v3')), true);
    assert.equal(differentProfile({ profileTitle: 'Default', profileId: 'profile:other' }, shot('Default')), false, 'a stepped brew temperature changes the id, not the profile');
    assert.equal(differentProfile({ profileTitle: '' }, shot('Default')), false);
    assert.equal(differentProfile({}, shot('Default')), false);
    assert.equal(differentProfile({ profileTitle: 'Default' }, { workflow: {} }), false);
});

test('a time reads "Today" for today and the day otherwise, in the page\'s language', () => {
    const now = new Date(2026, 10, 12, 18, 0);
    assert.equal(whenText(new Date(2026, 10, 12, 14, 32), now, 'en-GB', 'Today'), 'Today 14:32');
    assert.equal(whenText(new Date(2026, 10, 11, 9, 5), now, 'en-GB', 'Today'), '11 Nov 09:05');
    assert.equal(whenText(new Date(2026, 10, 12, 14, 32), now, 'de', 'Heute'), 'Heute 14:32');
    assert.match(whenText(new Date(2026, 10, 11, 9, 5), now, 'de', 'Heute'), /^11\. Nov\.? 09:05$/);
    assert.equal(whenText(new Date(2025, 10, 12, 14, 32), now, 'en-GB', 'Today'), '12 Nov 14:32', 'the same day a year before is not today');
    assert.equal(whenText(null, now, 'en-GB', 'Today'), '');
    assert.equal(whenText(new Date(2026, 10, 12, 14, 32), now, 'not a locale!', 'Today').startsWith('Today '), true);
});

test('the stored view is Reference unless it says Targets', () => {
    assert.equal(viewFrom('targets'), 'targets');
    for (const stored of ['reference', undefined, null, 'other', 3]) assert.equal(viewFrom(stored), 'reference');
});

const recipe = { id: 'r1', title: 'House espresso', profileTitle: 'Default' };
const shot = (id, title = 'Default') => ({ id, timestamp: '2026-11-12T10:00:00.000', workflow: { profile: { title }, context: {} } });
const ref = (id, title) => ({ shot: shot(id, title), canChange: true });

test('with a recipe: the latest Shot against its reference', () => {
    const shown = graphModel({ recipe, view: 'reference', shot: shot('a'), reference: ref('b') });
    assert.deepEqual(shown.row, { label: 'Latest', shot: shot('a') });
    assert.equal(shown.reference.id, 'b');
    assert.deepEqual([shown.line, shown.flag, shown.badge, shown.targets, shown.makeReference, shown.lines], [null, false, false, false, true, true]);
});

test('"Different profile" shows when the reference was pulled on another profile', () => {
    assert.equal(graphModel({ recipe, view: 'reference', shot: shot('a'), reference: ref('b', 'Adaptive v3') }).flag, true);
    assert.equal(graphModel({ recipe: { id: 'r1' }, view: 'reference', shot: shot('a'), reference: ref('b', 'Adaptive v3') }).flag, false, 'the recipe names no profile');
});

test('when the latest Shot is the reference: a badge, no dashed lines, no Make reference', () => {
    const shown = graphModel({ recipe, view: 'reference', shot: shot('a'), reference: ref('a') });
    assert.deepEqual([shown.badge, shown.reference, shown.lines, shown.makeReference], [true, null, false, false]);
    assert.equal(shown.row.label, 'Latest');
});

test('no reference yet: the Shot alone, and Make reference', () => {
    const shown = graphModel({ recipe, view: 'reference', shot: shot('a'), reference: null });
    assert.deepEqual([shown.reference, shown.badge, shown.lines, shown.makeReference, shown.line], [null, false, false, true, null]);
});

test('no Shot with the recipe yet: the reference alone and a line saying so', () => {
    const shown = graphModel({ recipe, view: 'reference', shot: null, reference: ref('b') });
    assert.deepEqual([shown.row, shown.line, shown.lines, shown.makeReference], [null, 'No shot with this recipe on this machine yet', true, false]);
    assert.equal(shown.reference.id, 'b');
    assert.equal(graphModel({ recipe, view: 'reference', shot: undefined, reference: null }).line, null, 'not before the Shots were read');
});

test('no recipe: "Last shot", no reference, no Make reference, "Pick a recipe to compare"', () => {
    const drawn = shot('n');
    const shown = graphModel({ recipe: null, view: 'reference', shot: drawn, reference: ref('b') });
    assert.deepEqual(shown.row, { label: 'Last shot', shot: drawn });
    assert.deepEqual([shown.line, shown.reference, shown.badge, shown.lines, shown.makeReference], ['Pick a recipe to compare', null, false, false, false]);
    assert.equal(graphModel({ recipe: undefined, view: 'reference', shot: drawn }).row, null, 'nothing is said before DYE2 was read');
    assert.equal(graphModel({ recipe: undefined, view: 'reference', shot: drawn }).line, null);
});

test('in Targets: no reference row, badge, lines or lines of text; the target legend; Make reference stays', () => {
    const shown = graphModel({ recipe, view: 'targets', shot: shot('a'), reference: ref('b', 'Adaptive v3') });
    assert.deepEqual([shown.reference, shown.flag, shown.badge, shown.lines, shown.line, shown.targets, shown.makeReference], [null, false, false, false, null, true, true]);
    assert.equal(graphModel({ recipe, view: 'targets', shot: shot('a'), reference: ref('a') }).badge, false);
    assert.equal(graphModel({ recipe, view: 'targets', shot: shot('a'), reference: ref('a') }).makeReference, false, 'the Shot is the reference already');
    assert.equal(graphModel({ recipe: null, view: 'targets', shot: shot('n') }).line, null);
    assert.equal(graphModel({ recipe, view: 'targets', shot: null, reference: null }).line, null);
});

test('while a shot runs: "Live shot", the reference behind it, no Make reference', () => {
    const shown = graphModel({ recipe, view: 'reference', live: true, shot: shot('a'), reference: ref('a') });
    assert.deepEqual(shown.row, { label: 'Live shot', shot: null });
    assert.deepEqual([shown.lines, shown.badge, shown.makeReference, shown.line], [true, false, false, null], 'the Shot before it was the reference: it is drawn behind the live shot');
    assert.equal(shown.reference.id, 'a');
    assert.equal(graphModel({ recipe, view: 'reference', live: true, shot: null, reference: null }).line, null);
    assert.equal(graphModel({ recipe: null, view: 'reference', live: true, shot: null }).row.label, 'Live shot');
});

test('once a shot has ended and Decaid does not have it yet: its row names no time, and nothing can be chosen', () => {
    const shown = graphModel({ recipe, view: 'reference', settling: true, shot: shot('a'), reference: ref('a') });
    assert.deepEqual(shown.row, { label: 'Latest', shot: null });
    assert.deepEqual([shown.makeReference, shown.badge, shown.lines], [false, false, true]);
    assert.deepEqual(graphModel({ recipe: null, view: 'reference', settling: true, shot: null }).row, { label: 'Last shot', shot: null });
});

test('a reference that can\'t be changed now offers no Make reference', () => {
    assert.equal(graphModel({ recipe, view: 'reference', shot: shot('a'), reference: { shot: shot('b'), canChange: false } }).makeReference, false);
});

test('the kept choice is recipe to Shot, and one recipe\'s choice leaves the others', () => {
    const stored = { r1: 'a', r2: 'b' };
    assert.equal(chosenShotId(stored, 'r1'), 'a');
    assert.equal(chosenShotId(stored, 'r3'), null);
    for (const nothing of [undefined, null, 'text', ['a'], { r1: 7 }, { r1: '' }]) assert.equal(chosenShotId(nothing, 'r1'), null);
    assert.deepEqual(withChosenShot(stored, 'r1', 'c'), { r1: 'c', r2: 'b' });
    assert.deepEqual(stored, { r1: 'a', r2: 'b' }, 'the stored value is not changed in place');
    assert.deepEqual(withChosenShot(undefined, 'r1', 'c'), { r1: 'c' });
    assert.deepEqual(withChosenShot(['junk'], 7, 'c'), { 7: 'c' });
});

// ── The tablet's own Shots ───────────────────────────────────────────────────

const whole = (id, recipeId, measurements) => ({ id, workflow: workflowFor(recipeId), measurements });
const POURED = [sample(0, 'preinfusion'), sample(1, 'pouring')];
const UNFINISHED = [sample(0, 'preparingForShot'), sample(1, 'preinfusion')];

function tablet({ shots = [], choices, gone = [] } = {}) {
    const calls = { list: [], read: [], written: [] };
    const seam = createTabletShots({
        listShots: async limit => { calls.list.push(limit); return { items: shots.slice(0, limit).map(({ measurements, ...row }) => row) }; },
        readShot: async id => { calls.read.push(id); return gone.includes(id) ? null : shots.find(s => s.id === id) || null; },
        readChoices: async () => choices,
        writeChoices: async next => { calls.written.push(next); choices = next; },
    });
    return { seam, calls };
}

test('the latest Shot is the newest with the recipe, from one read of the newest 100', async () => {
    const { seam, calls } = tablet({ shots: [whole('d', 'r2', POURED), whole('c', 'r1', POURED), whole('b', 'r1', POURED)] });
    assert.equal((await seam.latestShot('r1')).id, 'c');
    assert.deepEqual(calls.list, [100]);
    assert.deepEqual(calls.read, ['c'], 'only the newest match is read whole');
});

test('an Unfinished Shot, or one that has gone, never takes the latest Shot\'s place', async () => {
    const { seam, calls } = tablet({ shots: [whole('d', 'r1', UNFINISHED), whole('c', 'r1', POURED), whole('b', 'r1', POURED), whole('a', 'r1', POURED)], gone: ['c'] });
    assert.equal((await seam.latestShot('r1')).id, 'b');
    assert.deepEqual(calls.read, ['d', 'c', 'b']);
});

test('with no recipe the latest Shot is the tablet\'s newest, whatever it was pulled with, Unfinished or not', async () => {
    const { seam, calls } = tablet({ shots: [whole('d', 'r1', UNFINISHED), whole('c', 'r2', POURED)] });
    assert.equal((await seam.latestShot(null)).id, 'd');
    assert.deepEqual([calls.list, calls.read], [[1], ['d']]);
    assert.equal(await tablet().seam.latestShot(null), null);
    assert.equal(await tablet({ shots: [whole('d', 'r1', POURED)], gone: ['d'] }).seam.latestShot(null), null);
});

test('a recipe with no finished Shot among the newest has no latest Shot', async () => {
    assert.equal(await tablet({ shots: [whole('d', 'r1', UNFINISHED), whole('c', 'r2', POURED)] }).seam.latestShot('r1'), null);
    assert.equal(await tablet().seam.latestShot('r1'), null);
});

test('the reference is the Shot chosen for the recipe, and can be changed', async () => {
    const { seam } = tablet({ shots: [whole('a', 'r1', POURED)], choices: { r1: 'a' } });
    const reference = await seam.referenceShot('r1');
    assert.equal(reference.shot.id, 'a');
    assert.equal(reference.canChange, true);
    assert.deepEqual(await seam.referenceShot('r2'), { shot: null, canChange: true });
});

test('a choice that names a Shot the tablet no longer has reads as no reference', async () => {
    const { seam } = tablet({ shots: [], choices: { r1: 'a' } });
    assert.deepEqual(await seam.referenceShot('r1'), { shot: null, canChange: true });
});

test('a reference may be an Unfinished Shot or one pulled with another recipe: it is the Shot chosen', async () => {
    const { seam } = tablet({ shots: [whole('a', 'r2', UNFINISHED)], choices: { r1: 'a' } });
    assert.equal((await seam.referenceShot('r1')).shot.id, 'a');
});

test('making a reference keeps every other recipe\'s choice, and is read back', async () => {
    const { seam, calls } = tablet({ shots: [whole('a', 'r1', POURED), whole('b', 'r1', POURED)], choices: { r2: 'z' } });
    await seam.makeReference('r1', 'a');
    await seam.makeReference('r1', 'b');
    assert.deepEqual(calls.written, [{ r2: 'z', r1: 'a' }, { r2: 'z', r1: 'b' }]);
    assert.equal((await seam.referenceShot('r1')).shot.id, 'b');
});

test('a request Decaid does not answer rejects, so a failure is never "none"', async () => {
    const failing = createTabletShots({
        listShots: async () => { throw new Error('offline'); },
        readShot: async () => { throw new Error('offline'); },
        readChoices: async () => { throw new Error('offline'); },
        writeChoices: async () => assert.fail('nothing is written over choices that could not be read'),
    });
    await assert.rejects(failing.latestShot('r1'));
    await assert.rejects(failing.referenceShot('r1'));
    await assert.rejects(failing.makeReference('r1', 'a'));
});
