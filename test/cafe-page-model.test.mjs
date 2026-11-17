// The cafe page's words (docs/cafe/DESIGN.md, "What the screen shows"). All
// sample data is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pageHeading, pickSubtitle, dialInNames, roastDay, liveWeightText, stepSteamFlow, STEAM_FLOW_MAX } from '../src/cafe/page-model.js';

test('with a recipe loaded, the title is its name, over its bean and profile', () => {
    const heading = pageHeading({ id: 'a', title: 'House espresso', beanName: 'Sample Blend' }, 'Sample Profile', true);
    assert.deepEqual(heading, {
        translate: false,
        title: 'House espresso',
        subtitle: 'Sample Blend · Sample Profile',
        dialLabel: 'Dial-in · saved to the recipe',
    });
});

test('the column says the dial-in is saved only where Decent Sync saves it', () => {
    const recipe = { id: 'a', title: 'House espresso' };
    assert.equal(pageHeading(recipe, '', true).dialLabel, 'Dial-in · saved to the recipe');
    assert.equal(pageHeading(recipe, '', false).dialLabel, 'Dial-in · not saved to the recipe');
    assert.equal(pageHeading(recipe, '').dialLabel, 'Dial-in · not saved to the recipe', 'not saved until it is known to be');
    // With no recipe there is nothing to save onto, Decent Sync or not.
    assert.equal(pageHeading(null, '', true).dialLabel, 'Dial-in · not saved to a recipe');
});

test('a recipe with no bean, or a profile not yet known, leaves no stray separator', () => {
    assert.equal(pageHeading({ title: 'A' }, 'Sample Profile').subtitle, 'Sample Profile');
    assert.equal(pageHeading({ title: 'A', beanName: 'Sample Blend' }, '').subtitle, 'Sample Blend');
    assert.equal(pageHeading({ title: 'A' }, '').subtitle, '');
});

test('with no recipe loaded, the page says so and what to do', () => {
    assert.deepEqual(pageHeading(null, 'Sample Profile'), {
        translate: true,
        title: 'No recipe selected',
        subtitle: 'Tap a recipe to load it',
        dialLabel: 'Dial-in · not saved to a recipe',
    });
});

test('Dose, Yield and Grind name the bean, the basket and the grinder from the Workflow', () => {
    const workflow = {
        context: {
            coffeeName: ' Sample Blend ', beanBatchId: 'batch-1', grinderModel: 'Sample Grinder',
            extras: { basketName: '18 g sample basket' },
        },
    };
    assert.deepEqual(dialInNames(workflow, { id: 'batch-1', roastDate: '2026-02-28T00:00:00Z' }), {
        bean: 'Sample Blend', roastDay: '2026-02-28', basket: '18 g sample basket', grinder: 'Sample Grinder',
    });
});

test('a Workflow that names nothing gives empty names, not placeholders', () => {
    const empty = { bean: '', roastDay: null, basket: '', grinder: '' };
    assert.deepEqual(dialInNames(null, null), empty);
    assert.deepEqual(dialInNames({}, null), empty);
    assert.deepEqual(dialInNames({ context: { coffeeName: null, grinderModel: 42, extras: null } }, null), empty);
});

test('the roast date is shown only for the batch the Workflow points at', () => {
    const workflow = { context: { coffeeName: 'Sample Blend', beanBatchId: 'batch-2' } };
    const other = { id: 'batch-1', roastDate: '2026-02-28T00:00:00Z' };
    assert.equal(dialInNames(workflow, other).roastDay, null);
    assert.equal(dialInNames({ context: { coffeeName: 'Sample Blend' } }, other).roastDay, null);
});

test('the roast day is the calendar day in the record, whatever the tablet\'s time zone', () => {
    assert.equal(roastDay('2026-02-28T00:00:00Z'), '2026-02-28');
    assert.equal(roastDay('2026-02-28'), '2026-02-28');
    assert.equal(roastDay(''), null);
    assert.equal(roastDay(null), null);
    assert.equal(roastDay('28/02/2026'), null);
});

test('the steam flow steps by a tenth, without drifting', () => {
    assert.equal(stepSteamFlow(1.5, 1), 1.6);
    assert.equal(stepSteamFlow(1.5, -1), 1.4);
    let flow = 0;
    for (let i = 0; i < 3; i++) flow = stepSteamFlow(flow, 1);
    assert.equal(flow, 0.3);
});

test('the steam flow stops at 0 and at its ceiling', () => {
    assert.equal(stepSteamFlow(0, -1), 0);
    assert.equal(stepSteamFlow(0.05, -1), 0);
    assert.equal(stepSteamFlow(STEAM_FLOW_MAX, 1), STEAM_FLOW_MAX);
    assert.equal(stepSteamFlow(2.45, 1), STEAM_FLOW_MAX);
    assert.equal(stepSteamFlow(NaN, 1), 0.1, 'a tile that shows no number yet starts from 0');
});

test('during a shot the weight is shown against its target', () => {
    assert.equal(liveWeightText(24.34, 36), '24.3 / 36 g');
    assert.equal(liveWeightText(0, 36.5), '0.0 / 36.5 g');
});

test('with no target the weight stands alone, and with no scale nothing is shown', () => {
    assert.equal(liveWeightText(24.34, 0), '24.3 g');
    assert.equal(liveWeightText(24.34, NaN), '24.3 g');
    assert.equal(liveWeightText(null, 36), '');
    assert.equal(liveWeightText(undefined, 36), '');
});

test('a pick dialog says a choice is saved to the recipe only where Decent Sync saves it', () => {
    const recipe = { id: 'a', title: 'House espresso', beanName: 'Sample Blend' };
    // A Machine Decent Sync serves: it records the Recipe's grinder from the Workflow.
    assert.deepEqual(pickSubtitle(recipe, true), { key: '{recipe} · saved to the recipe', vars: { recipe: 'House espresso' } });
    // No Decent Sync, or a Capture-only Machine: this machine's until another recipe loads.
    assert.deepEqual(pickSubtitle(recipe, false), { key: '{recipe} · not saved to the recipe', vars: { recipe: 'House espresso' } });
    assert.equal(pickSubtitle(recipe).key, '{recipe} · not saved to the recipe', 'not saved until it is known to be');
    // No recipe loaded: there is nothing to save onto, Decent Sync or not.
    assert.deepEqual(pickSubtitle(null, true), { key: 'No recipe loaded · changes this machine only' });
    assert.deepEqual(pickSubtitle(null, false), { key: 'No recipe loaded · changes this machine only' });
});

test('the pick dialog and the dial-in column say the same', () => {
    const recipe = { id: 'a', title: 'House espresso' };
    for (const saved of [true, false]) {
        const label = pageHeading(recipe, '', saved).dialLabel.replace('Dial-in · ', '');
        assert.equal(pickSubtitle(recipe, saved).key, `{recipe} · ${label}`);
    }
});
