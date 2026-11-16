// The cafe page's words (docs/cafe/DESIGN.md, "What the screen shows"). All
// sample data is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pageHeading, dialInNames, roastDay, liveWeightText } from '../src/cafe/page-model.js';

test('with a recipe loaded, the title is its name, over its bean and profile', () => {
    const heading = pageHeading({ id: 'a', title: 'House espresso', beanName: 'Sample Blend' }, 'Sample Profile');
    assert.deepEqual(heading, {
        translate: false,
        title: 'House espresso',
        subtitle: 'Sample Blend · Sample Profile',
        dialLabel: 'Dial-in · saved to the recipe',
    });
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
