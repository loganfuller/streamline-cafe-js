// What the Grind row shows for a setting, and what its − and + step from (#42).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { grindText, grindNumber } from '../src/cafe/grind-text.js';
import { stepValue } from '../src/modules/value-format.js';

// The row's + as ui.js wires it: the number read off the row, one step up, painted
// as a Workflow read paints it (the Grind tile's formatter in setupValueAdjuster).
const plus = (text, step) => {
    const value = grindNumber(text);
    if (value === null) return null;
    return grindText(stepValue(value, step, 1), step);
};

test('a preset grinder\'s setting shows as it is, and the row steps nothing from it', () => {
    assert.equal(grindText('Medium', 0.1), 'Medium');
    assert.equal(grindText('  Extra fine ', null), 'Extra fine');
    assert.equal(grindText('3 Fine', 1), '3 Fine', 'a name that starts with a digit is a name');
    for (const text of ['Medium', '3 Fine', '—', '', 'NaN']) {
        assert.equal(grindNumber(text), null, text);
        assert.equal(plus(text, 0.1), null, text);
    }
});

test('a 0.25-step grinder at 11.25 shows 11.25 after a Workflow read, and + steps to 11.5', () => {
    // The Workflow holds what updateGrindValue wrote: two places.
    assert.equal(grindText('11.25', 0.25), '11.25');
    assert.equal(grindText(11.25, 0.25), '11.25');
    assert.equal(plus(grindText('11.25', 0.25), 0.25), '11.50');
    // And the row the + wrote reads back as it was written.
    assert.equal(grindText('11.50', 0.25), '11.50');
    assert.equal(plus('11.50', 0.25), '11.75');
});

test('a 0.05-step grinder keeps its hundredths', () => {
    assert.equal(grindText('8.05', 0.05), '8.05');
    assert.equal(grindText('8.10', 0.05), '8.10');
    assert.equal(plus('8.05', 0.05), '8.10');
});

test('a whole-number and a 0.1-step grinder show as Streamline showed them', () => {
    const streamline = value => {
        const parsed = parseFloat(value);
        return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(1);
    };
    for (const [setting, step] of [['12', 1], ['12.00', 1], [12, 1], ['0', 1], ['15.3', 0.1], ['15.30', 0.1], ['15.0', 0.1], ['15', 0.1], [15.3, 0.1], ['15.30', null]]) {
        assert.equal(grindText(setting, step), streamline(setting), `${setting} at ${step}`);
    }
});

test('a setting finer than the step it is painted with is not rounded onto that step', () => {
    // A grinder pick paints the new grinder's setting before Streamline reads the
    // grinder's step, and the 20 s poll paints one too: 11.25 must stay 11.25.
    assert.equal(grindText('11.25', 0.1), '11.25');
    assert.equal(grindText('11.25', 1), '11.25');
    assert.equal(grindText('11.25', null), '11.25');
});

test('a number keeps no more than the two places the row writes', () => {
    assert.equal(grindText('11.2999999', 0.1), '11.3');
    assert.equal(grindText('11.256', 0.25), '11.26');
    assert.equal(grindText('-1.5', 0.5), '-1.5');
});

test('two taps before the write step from what the first tap wrote', () => {
    // 11.25 on a 0.1 grinder: the first + writes 11.35, so the row must not show
    // 11.3, or the second + would step from there and write 11.40.
    const once = plus('11.25', 0.1);
    assert.equal(once, '11.35');
    assert.equal(plus(once, 0.1), '11.45');
    // On its own grid the − and + paint as Streamline's formatter did.
    assert.equal(plus('11.3', 0.1), '11.4');
    assert.equal(plus('11', 1), '12');
    assert.equal(plus('11.75', 0.25), '12');
});

test('a number written with a bare point is still a number', () => {
    assert.equal(grindText('.5', 0.1), '0.5');
    assert.equal(grindText('11.', 0.1), '11');
    assert.equal(grindNumber('.5'), 0.5);
    assert.equal(grindNumber('11.'), 11);
    assert.equal(plus('.5', 0.1), '0.6');
    for (const text of ['.', '-', '1.2.3', '-.']) assert.equal(grindNumber(text), null, text);
});
