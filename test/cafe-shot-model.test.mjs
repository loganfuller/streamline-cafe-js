// The graph's Shots: a recipe's latest, the Unfinished rule, a Shot's lines,
// the legend and the kept choice (docs/cafe/DESIGN.md, "Shots and the reference").
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    shotRecipeId, shotsWithRecipe, isUnfinished, shotCurves, shotCredit,
    differentProfile, whenText, viewFrom, graphModel, chosenShotId, withChosenShot, drawnShot, sameReference,
    UNCHANGEABLE_NOTICE, UNREAD_NOTICE, isDrawnShot,
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
    // As Decent Sync reads a record: a sample with no machine reading ends the
    // Preheat, and its own weight is not counted, having no time on the machine's clock.
    assert.equal(isUnfinished({ measurements: [...preheat, { scale: { timestamp: at(2), weight: 5 } }] }), true, 'a weight on a sample the machine did not time is no reading');
    assert.equal(isUnfinished({ measurements: [...preheat, { scale: { timestamp: at(2), weight: 0 } }, sample(3, 'preparingForShot', { weight: 5 })] }), false, 'a sample with no machine reading ends the Preheat');
    assert.equal(isUnfinished({ measurements: [...preheat, { machine: { state: { substate: 'preinfusion' } }, scale: { weight: 5 } }] }), true, 'nor is one whose machine reading has no time');
    assert.equal(isUnfinished({ measurements: [...preheat, { machine: { state: { substate: 'pouring' } } }] }), true, 'and a pouring sample with no time is no sample');
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

test('the Shot the history module hands the chart is credited from its first sample and its Workflow', () => {
    const workflow = { context: { baristaName: 'Sample Barista' } };
    const measurements = [sample(0, 'preparingForShot'), sample(1, 'pouring')];
    const shot = drawnShot(measurements, workflow);
    assert.deepEqual(shot, { id: null, timestamp: at(0), workflow, measurements });
    assert.deepEqual(shotCredit(shot), { when: new Date(2026, 10, 12, 10, 0, 0), who: 'Sample Barista' });
    assert.equal(drawnShot([{ scale: { timestamp: at(2), weight: 0 } }], null).timestamp, at(2), 'a sample the machine did not time gives the scale\'s');
    assert.equal(drawnShot([sample(0, 'pouring')]).workflow, null);
    for (const nothing of [undefined, null, [], [null]]) assert.equal(drawnShot(nothing, workflow), null, 'nothing to draw names no Shot');
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

// A Shot opened from the Shots list: `recipe` is its own recipe.
const guest = { id: 'r2', title: 'Guest espresso', profileTitle: 'Adaptive v3' };
const openedAs = (loaded, unfinished = false, extra = {}) => ({ loaded, unfinished, name: null, canChange: true, ...extra });

test('an opened Shot of the loaded recipe reads "Viewing", with "Back to latest", Make reference and its stars', () => {
    const shown = graphModel({ recipe, view: 'reference', shot: shot('a'), reference: ref('b'), remarks: { rating: 6, note: null }, opened: openedAs(recipe) });
    assert.deepEqual(shown.row, { label: 'Viewing', shot: shot('a') });
    assert.deepEqual([shown.back, shown.makeReference, shown.lines, shown.line], [true, true, true, null]);
    assert.deepEqual(shown.rate, { rating: 6, note: null });
    assert.equal(graphModel({ recipe, view: 'reference', shot: shot('a'), reference: ref('b') }).back, false, 'only an opened Shot has it');
});

test('an opened Shot of another recipe is labelled with that recipe\'s name, against its reference and its profile', () => {
    const shown = graphModel({ recipe: guest, view: 'reference', shot: shot('a', 'Adaptive v3'), reference: ref('b', 'Default'), opened: openedAs(recipe) });
    assert.deepEqual(shown.row, { label: null, name: 'Guest espresso', shot: shot('a', 'Adaptive v3') });
    assert.equal(shown.flag, true, '"Different profile" is judged against its own recipe\'s profile');
    assert.equal(shown.makeReference, true);
    // With no recipe loaded, every opened Shot of a recipe is labelled by its name.
    assert.equal(graphModel({ recipe: guest, view: 'reference', shot: shot('a'), reference: ref('b'), opened: openedAs(null) }).row.name, 'Guest espresso');
    assert.equal(graphModel({ recipe: guest, view: 'reference', shot: shot('a'), reference: ref('b'), opened: openedAs(null) }).line, null, 'no "Pick a recipe to compare"');
});

test('an opened Shot pulled with no recipe reads "No recipe", with no reference and no Make reference', () => {
    const shown = graphModel({ recipe: null, view: 'reference', shot: shot('a'), reference: { shot: null, canChange: false }, opened: openedAs(recipe) });
    assert.deepEqual(shown.row, { label: 'No recipe', shot: shot('a') });
    assert.deepEqual([shown.makeReference, shown.reference, shown.line, shown.back], [false, null, null, true]);
});

test('an opened Shot of a recipe this tablet has no record of reads its recipe\'s name, with no reference and no Make reference', () => {
    const shown = graphModel({ recipe: null, view: 'reference', shot: shot('a'), reference: { shot: null, canChange: false }, remarks: { rating: 4, note: null }, opened: openedAs(recipe, false, { name: 'Elsewhere espresso' }) });
    assert.deepEqual(shown.row, { label: null, name: 'Elsewhere espresso', shot: shot('a') });
    assert.deepEqual([shown.reference, shown.makeReference, shown.lines], [null, false, false]);
    assert.deepEqual(shown.rate, { rating: 4, note: null }, 'it is rated and noted as any Shot');
});

test('another Machine\'s Shot while Decent Sync can\'t be reached: its stars and Make reference muted, its note read only, and one line', () => {
    const locked = openedAs(recipe, false, { canChange: false });
    const shown = graphModel({ recipe, view: 'reference', shot: shot('a'), reference: ref('b'), remarks: { rating: 6, note: 'Sweet' }, opened: locked });
    assert.equal(shown.locked, true);
    assert.deepEqual(shown.rate, { rating: 6, note: 'Sweet' }, 'the stars and the note are still shown');
    assert.deepEqual([shown.makeReference, shown.muted], [true, true]);
    assert.equal(shown.notice, 'Decent Sync can\'t be reached, so this shot can\'t be changed');
    // One line, whatever the reference's own answer says, and whether or not it could be read.
    for (const reference of [{ ...ref('b'), canChange: false, unreachable: true }, { shot: null, canChange: false, unreachable: true, unread: true }]) {
        const during = graphModel({ recipe, view: 'reference', shot: shot('a'), reference, remarks: { rating: null, note: null }, opened: locked });
        assert.equal(during.notice, 'Decent Sync can\'t be reached, so this shot can\'t be changed');
        assert.deepEqual([during.makeReference, during.muted], [true, true]);
    }
    // Where Make reference would not be offered, it is not shown muted either.
    assert.equal(graphModel({ recipe, view: 'reference', shot: shot('a'), reference: ref('a'), opened: locked }).makeReference, false, 'the reference itself');
    assert.equal(graphModel({ recipe, view: 'reference', shot: shot('a'), reference: ref('b'), opened: openedAs(recipe, true, { canChange: false }) }).makeReference, false, 'an Unfinished Shot');
    assert.equal(graphModel({ recipe: null, view: 'reference', shot: shot('a'), reference: { shot: null, canChange: false }, opened: openedAs(recipe, false, { canChange: false }) }).makeReference, false, 'a Shot with no recipe');
});

test('this tablet\'s own Shot during an outage is rated and noted as ever, with the reference\'s own line', () => {
    const shown = graphModel({ recipe, view: 'reference', shot: shot('a'), reference: { ...ref('b'), canChange: false, unreachable: true }, remarks: { rating: 6, note: null }, opened: openedAs(recipe) });
    assert.equal(shown.locked, false);
    assert.deepEqual([shown.makeReference, shown.muted], [true, true]);
    assert.equal(shown.notice, 'Decent Sync can\'t be reached, so the reference can\'t be changed');
    assert.equal(graphModel({ recipe, view: 'reference', shot: shot('a'), reference: ref('b') }).locked, false, 'the latest is never locked');
});

test('an opened Unfinished Shot has no Make reference, and is rated as any other', () => {
    const shown = graphModel({ recipe, view: 'reference', shot: shot('a'), reference: ref('b'), remarks: { rating: null, note: null }, opened: openedAs(recipe, true) });
    assert.equal(shown.makeReference, false);
    assert.deepEqual(shown.rate, { rating: null, note: null });
});

test('an opened Shot that is its recipe\'s reference shows "This shot is the reference"', () => {
    const shown = graphModel({ recipe: guest, view: 'reference', shot: shot('a'), reference: ref('a'), opened: openedAs(recipe) });
    assert.deepEqual([shown.badge, shown.makeReference], [true, false]);
});

test('"Different profile" shows when the reference was pulled on another profile', () => {
    assert.equal(graphModel({ recipe, view: 'reference', shot: shot('a'), reference: ref('b', 'Adaptive v3') }).flag, true);
    assert.equal(graphModel({ recipe: { id: 'r1' }, view: 'reference', shot: shot('a'), reference: ref('b', 'Adaptive v3') }).flag, false, 'the recipe names no profile');
});

test('when the latest Shot is the reference: a badge, no reference lines, no Make reference', () => {
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
    assert.equal(graphModel({ recipe, view: 'targets', shot: null, reference: null }).line, 'No shot with this recipe on this machine yet', 'that line is about the Shot, so an empty graph still says why');
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
    const none = graphModel({ recipe, view: 'reference', shot: shot('a'), reference: { shot: null, canChange: false } });
    assert.deepEqual([none.makeReference, none.reference, none.badge, none.lines], [false, null, false, false], 'with no reference yet, too');
    assert.equal(graphModel({ recipe, view: 'reference', shot: shot('a'), reference: { shot: null, canChange: true } }).makeReference, true);
});

test('before Decent Sync has answered its status: the latest Shot alone, no reference and no Make reference', () => {
    const shown = graphModel({ recipe, view: 'reference', shot: shot('a'), reference: { shot: null, canChange: false } });
    assert.deepEqual([shown.row.label, shown.reference, shown.makeReference, shown.muted, shown.notice, shown.lines], ['Latest', null, false, false, null, false]);
});

test('the tablet\'s copy, drawn while Decent Sync can\'t be reached: Make reference muted, and a line saying why', () => {
    const copy = { shot: shot('b'), canChange: false, unreachable: true, profileDiffers: false };
    const shown = graphModel({ recipe, view: 'reference', shot: shot('a'), reference: copy });
    assert.deepEqual([shown.reference.id, shown.lines, shown.makeReference, shown.muted], ['b', true, true, true]);
    assert.equal(shown.notice, "Decent Sync can't be reached, so the reference can't be changed");
    assert.equal(shown.notice, UNCHANGEABLE_NOTICE);
    // In Targets Make reference stays, so the line that explains it does too.
    const targets = graphModel({ recipe, view: 'targets', shot: shot('a'), reference: copy });
    assert.deepEqual([targets.makeReference, targets.muted, targets.notice], [true, true, UNCHANGEABLE_NOTICE]);
    // The copy may say the recipe has none: none is drawn, and none can be chosen.
    const none = graphModel({ recipe, view: 'reference', shot: shot('a'), reference: { shot: null, canChange: false, unreachable: true } });
    assert.deepEqual([none.reference, none.muted, none.notice], [null, true, UNCHANGEABLE_NOTICE]);
});

test('a served Machine whose reference can\'t be read at all: none is drawn, and the line says Decent Sync can\'t be reached', () => {
    const shown = graphModel({ recipe, view: 'reference', shot: shot('a'), reference: { shot: null, canChange: false, unreachable: true, unread: true } });
    assert.deepEqual([shown.reference, shown.lines, shown.makeReference, shown.muted], [null, false, false, false], 'and with nothing read there is no Make reference to mute');
    assert.equal(shown.notice, "Decent Sync can't be reached, so the reference can't be shown");
    assert.equal(shown.notice, UNREAD_NOTICE);
    // With no Shot for the recipe both lines show.
    const empty = graphModel({ recipe, view: 'reference', shot: null, reference: { shot: null, canChange: false, unreachable: true, unread: true } });
    assert.deepEqual([empty.makeReference, empty.muted, empty.line, empty.notice], [false, false, 'No shot with this recipe on this machine yet', UNREAD_NOTICE]);
});

test('the line about Decent Sync stays through a shot, where nothing can be chosen, and is never shown with no recipe', () => {
    const copy = { shot: shot('b'), canChange: false, unreachable: true };
    for (const state of [{ live: true }, { settling: true }]) {
        const shown = graphModel({ recipe, view: 'reference', shot: shot('a'), reference: copy, ...state });
        assert.deepEqual([shown.notice, shown.makeReference, shown.muted], [UNCHANGEABLE_NOTICE, false, false]);
    }
    assert.equal(graphModel({ recipe: null, view: 'reference', shot: shot('a'), reference: copy }).notice, null);
    assert.equal(graphModel({ recipe, view: 'reference', shot: shot('a'), reference: ref('b') }).notice, null);
});

test('when the latest Shot is the tablet\'s copy of the reference: the badge, no Make reference, and the line', () => {
    const shown = graphModel({ recipe, view: 'reference', shot: shot('a'), reference: { shot: shot('a'), canChange: false, unreachable: true } });
    assert.deepEqual([shown.badge, shown.makeReference, shown.muted, shown.notice], [true, false, false, UNCHANGEABLE_NOTICE]);
});

test('"Different profile" follows Decent Sync\'s word where it gives one', () => {
    const sameTitle = { shot: shot('b', 'Default'), canChange: true, profileDiffers: true };
    assert.equal(graphModel({ recipe, view: 'reference', shot: shot('a'), reference: sameTitle }).flag, true, 'though the titles agree');
    const otherTitle = { shot: shot('b', 'Adaptive v3'), canChange: true, profileDiffers: false };
    assert.equal(graphModel({ recipe, view: 'reference', shot: shot('a'), reference: otherTitle }).flag, false, 'though the titles differ');
    assert.equal(graphModel({ recipe, view: 'targets', shot: shot('a'), reference: sameTitle }).flag, false, 'the reference has no row in Targets');
    assert.equal(graphModel({ recipe, view: 'reference', shot: shot('b'), reference: sameTitle }).flag, false, 'nor when the Shot is the reference');
});

// ── Rating and notes on the legend ───────────────────────────────────────────

test('a saved Shot has stars and a note icon, with its rating and note', () => {
    const recipe = { id: 'r1' };
    const shot = { id: 'a' };
    const rated = graphModel({ view: 'reference', recipe, shot, remarks: { rating: 8, note: 'Sweet' } });
    assert.deepEqual(rated.rate, { rating: 8, note: 'Sweet' });
    assert.deepEqual(graphModel({ view: 'targets', recipe, shot, remarks: { rating: null, note: null } }).rate, { rating: null, note: null }, 'empty stars and a plus, in Targets too');
});

test('no stars and no note icon during a live shot, while a finished shot waits to be saved, or with no Shot for the recipe', () => {
    const recipe = { id: 'r1' };
    const remarks = { rating: 8, note: 'Sweet' };
    assert.equal(graphModel({ view: 'reference', recipe, live: true, shot: { id: 'a' }, remarks }).rate, null);
    assert.equal(graphModel({ view: 'reference', recipe, settling: true, shot: { id: 'a' }, remarks }).rate, null);
    assert.equal(graphModel({ view: 'reference', recipe, shot: null, remarks }).rate, null);
    assert.equal(graphModel({ view: 'reference', recipe, shot: undefined, remarks }).rate, null, 'nor before the Shot was read');
    assert.equal(graphModel({ view: 'reference', recipe: undefined, shot: { id: null }, remarks }).rate, null, 'nor before DYE2 has said which recipe is loaded');
});

test('"Last shot", with no recipe, is rated once its record is known to be the Shot drawn', () => {
    const handed = { id: null, timestamp: '2026-11-12T10:00:00.000' };
    assert.equal(graphModel({ view: 'reference', recipe: null, shot: handed }).rate, null, 'the history module hands over no record');
    assert.deepEqual(graphModel({ view: 'reference', recipe: null, shot: handed, remarks: { rating: 6, note: null } }).rate, { rating: 6, note: null });
});

test('a record is the Shot drawn only when their first samples are the same', () => {
    const measurements = [{ machine: { timestamp: '2026-11-12T10:00:00.250' } }, { machine: { timestamp: '2026-11-12T10:00:00.750' } }];
    const handed = drawnShot(measurements, null);
    assert.ok(isDrawnShot({ id: 'a', timestamp: '2026-11-12T10:00:00.000', measurements }, handed));
    assert.ok(!isDrawnShot({ id: 'b', timestamp: '2026-11-12T10:00:00.000', measurements: [{ machine: { timestamp: '2026-11-12T10:03:10.000' } }] }, handed), 'a newer Shot the module has not drawn yet');
    assert.ok(!isDrawnShot({ id: 'c', measurements: [] }, handed));
    assert.ok(!isDrawnShot(null, handed));
    assert.ok(!isDrawnShot({ id: 'a', measurements }, null));
    assert.ok(!isDrawnShot({ measurements }, handed), 'a record with no id can\'t be edited');
});

test('the reference\'s row shows its rating and note only when it has them', () => {
    const recipe = { id: 'r1' };
    const shot = { id: 'a' };
    const both = graphModel({ view: 'reference', recipe, shot, reference: { shot: { id: 'b' }, canChange: true, rating: 7, note: 'Syrupy' } });
    assert.deepEqual([both.referenceRating, both.referenceNote], [7, 'Syrupy']);
    const neither = graphModel({ view: 'reference', recipe, shot, reference: { shot: { id: 'b' }, canChange: true, rating: null, note: null } });
    assert.deepEqual([neither.referenceRating, neither.referenceNote], [null, null]);
    const live = graphModel({ view: 'reference', recipe, live: true, shot, reference: { shot: { id: 'b' }, canChange: true, rating: 7, note: 'Syrupy' } });
    assert.deepEqual([live.referenceRating, live.referenceNote], [7, 'Syrupy'], 'the row stays through a shot');
    const self = graphModel({ view: 'reference', recipe, shot, reference: { shot, canChange: true, rating: 7, note: 'Syrupy' }, remarks: { rating: 7, note: 'Syrupy' } });
    assert.deepEqual([self.referenceRating, self.referenceNote, self.rate], [null, null, { rating: 7, note: 'Syrupy' }], 'when the latest Shot is the reference they are edited on its own row');
    const targets = graphModel({ view: 'targets', recipe, shot, reference: { shot: { id: 'b' }, canChange: true, rating: 7, note: 'Syrupy' } });
    assert.deepEqual([targets.referenceRating, targets.referenceNote], [null, null], 'no reference row in Targets');
});

test('a change of the reference\'s rating or note is no change to the graph', () => {
    const a = { shot: { id: 'a' }, canChange: true, rating: 8, note: null };
    assert.ok(sameReference(a, { ...a, rating: 6, note: 'Changed elsewhere' }), 'the row is written again, and nothing is drawn');
});

test('two answers for a reference are the same when they name the same Shot and say the same of it', () => {
    const a = { shot: shot('a'), canChange: true, unreachable: false, profileDiffers: false };
    assert.equal(sameReference(a, { ...a, shot: { id: 'a', measurements: [] }, curves: {} }), true, 'a repeated push: the Shot is compared by id');
    assert.equal(sameReference(a, { ...a, shot: shot('b') }), false);
    assert.equal(sameReference(a, { ...a, shot: null }), false);
    assert.equal(sameReference({ shot: null, canChange: true }, { shot: null, canChange: true }), true);
    assert.equal(sameReference(a, { ...a, canChange: false, unreachable: true }), false, 'the same Shot, now the tablet\'s copy');
    assert.equal(sameReference(a, { ...a, profileDiffers: true }), false);
    assert.equal(sameReference({ shot: null, canChange: false, unreachable: true }, { shot: null, canChange: false, unreachable: true, unread: true }), false);
    assert.equal(sameReference({ shot: null, canChange: false }, { shot: null, canChange: true }), false, 'the source became known');
    assert.equal(sameReference(null, a), false);
    assert.equal(sameReference(a, null), false);
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
        listShots: async (limit, offset = 0) => { calls.list.push(offset ? [limit, offset] : limit); return { items: shots.slice(offset, offset + limit).map(({ measurements, ...row }) => row), total: shots.length }; },
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

test('with no recipe there is no latest Shot, and nothing is read: Streamline\'s history module draws the newest', async () => {
    const { seam, calls } = tablet({ shots: [whole('d', 'r1', POURED), whole('c', 'r2', POURED)] });
    assert.equal(await seam.latestShot(null), null);
    assert.equal(await seam.latestShot(undefined), null);
    assert.deepEqual([calls.list, calls.read], [[], []]);
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
    const first = await seam.makeReference('r1', 'a');
    assert.deepEqual([first.shot.id, first.canChange], ['a', true], 'the answer is the reference as it now is');
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

test('a page of the Shots list is read by offset, its rows never read whole, and says where the next starts', async () => {
    const shots = ['e', 'd', 'c', 'b', 'a'].map(id => whole(id, 'r1', POURED));
    const { seam, calls } = tablet({ shots });
    const first = await seam.shotsPage(null, 2);
    assert.deepEqual([first.rows.map(row => row.id), first.next], [['e', 'd'], 2]);
    const page = await seam.shotsPage(first.next, 2);
    assert.deepEqual(page.rows.map(row => row.id), ['c', 'b']);
    assert.equal(page.next, 4);
    assert.equal((await seam.shotsPage(4, 2)).next, null, 'a short page is the last');
    assert.equal((await seam.shotsPage(3, 2)).next, null, 'and so is one that reaches Decaid\'s total');
    assert.deepEqual(calls.list, [2, [2, 2], [2, 4], [2, 3]]);
    assert.deepEqual(calls.read, [], 'a row is never read whole for the list');
});

test('a row of the tablet\'s list names its recipe by its DYE2 record id, is this machine\'s, and says nothing of what Decaid\'s row lacks', async () => {
    const { seam } = tablet({ shots: [whole('a', 'r1', POURED), whole('b', null, POURED)] });
    const [a, b] = (await seam.shotsPage(null, 50, { r1: 'a' })).rows;
    assert.deepEqual([a.recipeId, a.recipeName, a.machine, a.thisMachine, a.duration, a.unfinished], ['r1', null, null, true, null, null]);
    assert.deepEqual([a.referenceOf, b.referenceOf, b.recipeId], [['r1'], [], null]);
    assert.equal((await seam.shotsPage(null, 50)).rows[0].referenceOf, null, 'not known which Shots are references');
});

test('a page Decaid answers oddly is an empty page, and one it does not answer rejects', async () => {
    const odd = createTabletShots({ listShots: async () => ({ items: [null, { id: 'a' }, { name: 'no id' }] }) });
    assert.deepEqual((await odd.shotsPage(null, 50)).rows.map(row => row.id), ['a']);
    assert.deepEqual(await createTabletShots({ listShots: async () => null }).shotsPage(null, 50), { rows: [], next: null });
    await assert.rejects(createTabletShots({ listShots: async () => { throw new Error('offline'); } }).shotsPage(null, 50));
});

test('a Shot read by its id is whole and can be changed, or null once the tablet no longer has it', async () => {
    const { seam } = tablet({ shots: [whole('a', 'r1', POURED)], gone: ['b'] });
    const found = await seam.shotById('a');
    assert.equal(found.shot.measurements, POURED);
    assert.equal(found.canChange, true, 'the tablet\'s own Shot is rated and noted as ever');
    assert.equal((await seam.shotById('b')).shot, null);
});

test('the choices of reference are read as they are kept', async () => {
    assert.deepEqual(await tablet({ choices: { r1: 'a' } }).seam.references(), { r1: 'a' });
});
