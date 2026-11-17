// The numbers under the graph (docs/cafe/DESIGN.md, "The comparison row").
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PHRASES, shotSamples, shotNumbers, valueAt, difference, restCards, liveFrame, liveCards } from '../src/cafe/comparison.js';

const at = seconds => new Date(Date.UTC(2026, 0, 1, 8, 0, 0) + seconds * 1000).toISOString();
const sample = (seconds, substate, machine = {}, scale = undefined) => ({
    machine: { timestamp: at(seconds), state: { substate }, pressure: 0, flow: 0, groupTemperature: 92, ...machine },
    ...(scale ? { scale: { timestamp: at(seconds), ...scale } } : {}),
});

// Ten seconds of Preheat, with a heater test at 11 bar and a cup on the scale,
// then a 30 s Shot: first drip at 6 s, a peak of 9.1 bar, 36.4 g out.
const measurements = () => [
    sample(0, 'preparingForShot', { pressure: 11, flow: 6 }, { weight: 40 }),
    sample(10, 'preparingForShot', { pressure: 2 }, { weight: 40 }),
    sample(10.5, 'preinfusion', { pressure: 1, flow: 4 }, { weight: 0, weightFlow: 0 }),
    sample(14, 'preinfusion', { pressure: 3, flow: 2 }, { weight: 0.6, weightFlow: 0.2 }),
    sample(16.5, 'pouring', { pressure: 8, flow: 2 }, { weight: 1.2, weightFlow: 0.8 }),
    sample(20.5, 'pouring', { pressure: 9.1, flow: 2.2 }, { weight: 9, weightFlow: 2 }),
    sample(30.5, 'pouring', { pressure: 8, flow: 2.4, groupTemperature: 93 }, { weight: 30, weightFlow: 2.2 }),
    sample(40.5, 'pouring', { pressure: 6, flow: 2.5 }, { weight: 35.8, weightFlow: 1.5 }),
];
const shot = (over = {}) => ({
    id: 'a',
    measurements: measurements(),
    annotations: { actualDoseWeight: 18.1, actualYield: 36.4 },
    workflow: { context: { targetDoseWeight: 18, targetYield: 36 }, profile: { target_weight: 40 } },
    ...over,
});
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

// ── A Shot's numbers ─────────────────────────────────────────────────────────

test('a Shot is timed from the first sample after its Preheat', () => {
    const samples = shotSamples(measurements());
    assert.equal(samples.length, 6);
    assert.deepEqual(samples.map(s => s.seconds), [0, 3.5, 6, 10, 20, 30]);
    assert.deepEqual(samples[2], { seconds: 6, pressure: 8, flow: 2, temperature: 92, weight: 1.2, weightFlow: 0.8 });
    assert.deepEqual(shotSamples(null), []);
});

test('the weight flow is the scale\'s, unless the machine measures its own', () => {
    // A DE1 writes a constant 0 for its own weight flow: no reading.
    const de1 = [sample(0, 'preinfusion', { weightFlow: 0 }, { weight: 0, weightFlow: 0.4 }), sample(2, 'pouring', { weightFlow: 0 }, { weight: 4, weightFlow: 2 })];
    assert.deepEqual(shotSamples(de1).map(s => s.weightFlow), [0.4, 2]);
    const own = [sample(0, 'preinfusion', { weightFlow: 0 }, { weight: 0, weightFlow: 0.4 }), sample(2, 'pouring', { weightFlow: 1.7 }, { weight: 4, weightFlow: 2 })];
    assert.deepEqual(shotSamples(own).map(s => s.weightFlow), [0, 1.7]);
    assert.deepEqual(shotSamples([sample(0, 'pouring')]).map(s => s.weightFlow), [null]);
});

test('a sample the machine did not time is no sample, though it ends the Preheat', () => {
    const samples = shotSamples([
        sample(0, 'preparingForShot'),
        { machine: { state: { substate: 'preinfusion' }, pressure: 5 } },
        sample(2, 'preparingForShot', { pressure: 3 }),
        sample(3, 'pouring', { pressure: 4 }),
    ]);
    assert.deepEqual(samples.map(s => [s.seconds, s.pressure]), [[0, 3], [1, 4]]);
});

test('time, first drip and peak pressure leave out the Preheat', () => {
    const numbers = shotNumbers(shot());
    assert.equal(numbers.time, 30);
    assert.equal(numbers.firstDrip, 6, 'the first reading of 1 g or more after the Preheat, not the cup weighed during it');
    assert.equal(numbers.peak, 9.1, 'not the heater test\'s 11 bar');
});

test('first drip is null for a Shot whose scale never read 1 g, as with no scale', () => {
    const none = measurements().map(({ machine }) => ({ machine }));
    assert.equal(shotNumbers(shot({ measurements: none })).firstDrip, null);
    const under = measurements().map(m => ({ ...m, scale: { weight: 0.9 } }));
    assert.equal(shotNumbers(shot({ measurements: under })).firstDrip, null);
    const exactly = [sample(0, 'preinfusion', {}, { weight: 0.99 }), sample(2, 'pouring', {}, { weight: 1 })];
    assert.equal(shotNumbers(shot({ measurements: exactly })).firstDrip, 2);
});

test('the dose is the one the Shot weighed, or its Workflow\'s where it weighed none', () => {
    const weighed = shotNumbers(shot());
    assert.equal(weighed.weighedDose, 18.1);
    assert.equal(weighed.dose, 18.1);
    close(weighed.ratio, 36.4 / 18.1);
    for (const annotations of [{ actualYield: 36.4 }, { actualYield: 36.4, actualDoseWeight: 0 }, { actualYield: 36.4, actualDoseWeight: null }]) {
        const set = shotNumbers(shot({ annotations }));
        assert.equal(set.weighedDose, null);
        assert.equal(set.dose, 18);
        close(set.ratio, 36.4 / 18);
    }
});

test('the yield is the one the Shot kept, or the scale\'s last reading', () => {
    assert.equal(shotNumbers(shot()).yield, 36.4);
    assert.equal(shotNumbers(shot({ annotations: undefined })).yield, 35.8, 'a Shot handed over without its annotations');
    assert.equal(shotNumbers(shot({ annotations: {}, measurements: measurements().map(({ machine }) => ({ machine })) })).yield, null);
});

test('what was set: the Workflow\'s dose and yield, the profile\'s target weight where it sets no yield', () => {
    const numbers = shotNumbers(shot());
    assert.deepEqual([numbers.targetDose, numbers.targetYield, numbers.targetRatio], [18, 36, 2]);
    const profiles = shotNumbers(shot({ workflow: { context: { targetDoseWeight: 18 }, profile: { target_weight: 40 } } }));
    assert.equal(profiles.targetYield, 40);
    // A yield of 0 is stop-at-weight switched off: the profile's weight does not stand in.
    const off = shotNumbers(shot({ workflow: { context: { targetDoseWeight: 18, targetYield: 0 }, profile: { target_weight: 40 } } }));
    assert.deepEqual([off.targetYield, off.targetRatio], [null, null]);
    assert.equal(restCards({ view: 'targets', shot: off })[2].side.phrase, 'No target');
    const none = shotNumbers(shot({ workflow: { context: {} } }));
    assert.deepEqual([none.targetDose, none.targetYield, none.targetRatio, none.dose], [null, null, null, 18.1]);
});

test('a Shot with nothing recorded has no numbers, and no Shot has none at all', () => {
    assert.equal(shotNumbers(null), null);
    assert.equal(shotNumbers(undefined), null);
    assert.deepEqual(shotNumbers({ id: 'b', measurements: [] }), {
        time: null, firstDrip: null, peak: null, yield: null, weighedDose: null, dose: null, ratio: null, targetDose: null, targetYield: null, targetRatio: null,
    });
});

// ── The reference at a given second ──────────────────────────────────────────

test('the reference at a second is taken between its two nearest samples', () => {
    const samples = shotSamples(measurements());
    assert.equal(valueAt(samples, 'pressure', 0), 1);
    assert.equal(valueAt(samples, 'pressure', 10), 9.1);
    close(valueAt(samples, 'pressure', 8), 8 + (9.1 - 8) / 2);
    close(valueAt(samples, 'weight', 15), 9 + (30 - 9) / 2);
    assert.equal(valueAt(samples, 'pressure', 30), 6);
    assert.equal(valueAt(samples, 'pressure', 30.1), null, 'past its last sample');
    assert.equal(valueAt(samples, 'pressure', -1), null);
    assert.equal(valueAt([], 'pressure', 3), null);
});

test('a sample that recorded no value is passed over', () => {
    const samples = [
        { seconds: 0, weight: null }, { seconds: 2, weight: 2 }, { seconds: 4, weight: null }, { seconds: 6, weight: 6 }, { seconds: 8, weight: null },
    ];
    assert.equal(valueAt(samples, 'weight', 1), null, 'before the first reading');
    assert.equal(valueAt(samples, 'weight', 4), 4);
    assert.equal(valueAt(samples, 'weight', 7), null, 'after the last reading');
});

// ── A difference ─────────────────────────────────────────────────────────────

test('a difference is of the two numbers as shown, with its sign', () => {
    assert.equal(difference(28.4, 27.9, 'seconds'), '+0.5 s');
    assert.equal(difference(27.9, 28.4, 'seconds'), '−0.5 s');
    assert.equal(difference(28.44, 27.86, 'seconds'), '+0.5 s', '28.4 beside 27.9, not 0.58 rounded up');
    assert.equal(difference(9.04, 9.01, 'bar'), '0.0 bar', 'no sign on nothing');
    assert.equal(difference(2.02, 2, 'ratio'), '+0.02');
    assert.equal(difference(null, 27.9, 'seconds'), '');
    assert.equal(difference(28.4, null, 'seconds'), '');
});

// ── At rest ──────────────────────────────────────────────────────────────────

const reference = () => shotNumbers(shot({
    id: 'r',
    annotations: { actualDoseWeight: 18, actualYield: 35.1 },
    measurements: [sample(0, 'preinfusion', { pressure: 2 }, { weight: 0 }), sample(6.5, 'pouring', { pressure: 8.8 }, { weight: 1 }), sample(27.9, 'pouring', { pressure: 7 }, { weight: 35 })],
}));
const brief = cards => cards.map(c => [c.key, c.value, c.side && c.side.phrase, c.side && c.side.vars && c.side.vars.value, c.diff]);

test('in Reference: five cards, each beside the reference\'s with the difference', () => {
    const cards = restCards({ view: 'reference', shot: shotNumbers(shot()), reference: reference() });
    assert.deepEqual(brief(cards), [
        ['time', '30.0 s', PHRASES.ref, '27.9 s', '+2.1 s'],
        ['firstDrip', '6.0 s', PHRASES.ref, '6.5 s', '−0.5 s'],
        ['yield', '36.4 g', PHRASES.ref, '35.1 g', '+1.3 g'],
        ['ratio', '1:2.01', PHRASES.ref, '1:1.95', '+0.06'],
        ['peak', '9.1 bar', PHRASES.ref, '8.8 bar', '+0.3 bar'],
    ]);
    assert.deepEqual(cards[3].title, { phrase: PHRASES.ratioOf, vars: { dose: '18.1' } }, 'the Ratio card names the dose it was worked from');
    assert.deepEqual(cards[0].title, { phrase: PHRASES.time });
});

test('with no reference each card reads "No reference" and shows no difference', () => {
    const cards = restCards({ view: 'reference', shot: shotNumbers(shot()), reference: null });
    assert.deepEqual(cards.map(c => [c.side, c.diff]), Array(5).fill([{ phrase: 'No reference' }, '']));
    assert.equal(cards[0].value, '30.0 s', 'as with no recipe loaded: the last Shot\'s numbers');
});

test('when the Shot is the reference each card reads "Ref = this shot"', () => {
    const numbers = shotNumbers(shot());
    const cards = restCards({ view: 'reference', shot: numbers, reference: numbers, isReference: true });
    assert.deepEqual(cards.map(c => [c.side, c.diff]), Array(5).fill([{ phrase: 'Ref = this shot' }, '']));
});

test('with no Shot yet the values are "—" and the cards give the reference\'s numbers', () => {
    const cards = restCards({ view: 'reference', shot: null, reference: reference() });
    assert.deepEqual(brief(cards), [
        ['time', '—', PHRASES.ref, '27.9 s', ''],
        ['firstDrip', '—', PHRASES.ref, '6.5 s', ''],
        ['yield', '—', PHRASES.ref, '35.1 g', ''],
        ['ratio', '—', PHRASES.ref, '1:1.95', ''],
        ['peak', '—', PHRASES.ref, '8.8 bar', ''],
    ]);
    assert.deepEqual(cards[3].title, { phrase: PHRASES.ratio }, 'no dose to name');
    assert.deepEqual(restCards({ view: 'reference', shot: null, reference: null }).map(c => [c.value, c.side.phrase]), Array(5).fill(['—', 'No reference']));
});

test('a value the Shot did not record is "—", with no difference', () => {
    const noScale = shotNumbers(shot({ annotations: {}, measurements: measurements().map(({ machine }) => ({ machine })) }));
    const cards = restCards({ view: 'reference', shot: noScale, reference: reference() });
    assert.deepEqual(brief(cards).slice(1, 4), [
        ['firstDrip', '—', PHRASES.ref, '6.5 s', ''],
        ['yield', '—', PHRASES.ref, '35.1 g', ''],
        ['ratio', '—', PHRASES.ref, '1:1.95', ''],
    ]);
    assert.equal(cards[0].diff, '+2.1 s', 'what it did record is still compared');
    // And one the reference did not record.
    const other = restCards({ view: 'reference', shot: shotNumbers(shot()), reference: noScale });
    assert.deepEqual(brief(other)[2], ['yield', '36.4 g', PHRASES.ref, '—', '']);
});

test('before the Shot was read the cards say nothing beside their dashes', () => {
    for (const view of ['reference', 'targets']) {
        const cards = restCards({ view, shot: undefined, reference: reference() });
        assert.deepEqual(cards.map(c => [c.value, c.side, c.diff]), Array(5).fill(['—', null, '']));
    }
});

test('in Targets: time with first drip, dose, yield and ratio against what was set, and the peak alone', () => {
    const cards = restCards({ view: 'targets', shot: shotNumbers(shot()), reference: reference() });
    assert.deepEqual(brief(cards), [
        ['time', '30.0 s', PHRASES.firstDripAt, '6.0 s', ''],
        ['dose', '18.1 g', PHRASES.target, '18.0 g', '+0.1 g'],
        ['yield', '36.4 g', PHRASES.target, '36.0 g', '+0.4 g'],
        ['ratio', '1:2.01', PHRASES.target, '1:2.00', '+0.01'],
        ['peak', '9.1 bar', null, null, ''],
    ]);
    assert.deepEqual(cards[3].title, { phrase: PHRASES.ratioOf, vars: { dose: '18.1' } });
});

test('in Targets: a Shot that weighed no dose, and one with nothing set', () => {
    const unweighed = restCards({ view: 'targets', shot: shotNumbers(shot({ annotations: { actualYield: 36.4 } })) });
    assert.deepEqual(brief(unweighed)[1], ['dose', '—', PHRASES.target, '18.0 g', '']);
    assert.deepEqual(unweighed[3].title, { phrase: PHRASES.ratioOf, vars: { dose: '18.0' } });
    const unset = restCards({ view: 'targets', shot: shotNumbers(shot({ workflow: { context: {} } })) });
    assert.deepEqual(brief(unset).slice(1, 4).map(row => row[2]), ['No target', 'No target', 'No target']);
    assert.deepEqual(unset.map(c => c.diff), ['', '', '', '', '']);
});

test('in Targets with no Shot yet each card reads "No shot yet"', () => {
    const cards = restCards({ view: 'targets', shot: null, reference: reference() });
    assert.deepEqual(cards.map(c => [c.value, c.side, c.diff]), Array(5).fill(['—', { phrase: 'No shot yet' }, '']));
});

// ── While a shot runs ────────────────────────────────────────────────────────

// Streamline's seven lines as chart.js names them, a temperature at a tenth.
const lines = ({ seconds = [0, 12], pressure = [1, 8.6], flow = [4, 2.1], weightFlow = [0, 1.4], temperature = [9.1, 9.25], targetPressure = [9, 9], targetFlow = [0, 0], targetTemperature = [9.3, 9.3] } = {}) => [
    { name: 'Pressure', x: seconds, y: pressure },
    { name: 'Flow', x: seconds, y: flow },
    { name: 'Target Pressure', x: seconds, y: targetPressure },
    { name: 'Target Flow', x: seconds, y: targetFlow },
    { name: '°C', x: seconds, y: temperature },
    { name: 'Target °C', x: seconds, y: targetTemperature },
    { name: 'Weight', x: seconds, y: weightFlow },
];
const stageLines = [{ x0: 0, name: 'Preinfusion' }, { x0: 8, name: ' Rise and hold ' }];

test('a live frame is the last point of each of the chart\'s lines', () => {
    assert.deepEqual(liveFrame(lines(), stageLines, 14.2), {
        seconds: 12, weight: 14.2, weightFlow: 1.4, flow: 2.1, pressure: 8.6, temperature: 92.5,
        targetFlow: null, targetPressure: 9, targetTemperature: 93, stage: 'Rise and hold',
    });
    assert.equal(liveFrame(lines({ seconds: [], pressure: [] }), [], null), null, 'before the first frame');
    const bare = liveFrame(lines(), [{ x0: 0 }], undefined);
    assert.deepEqual([bare.weight, bare.stage], [null, ''], 'no scale, and a profile whose steps have no names');
});

test('a target line that has no point at this second is no target', () => {
    // The chart adds a temperature target only where the machine reports one.
    const traces = lines();
    traces[5] = { name: 'Target °C', x: [0], y: [9.3] };
    assert.equal(liveFrame(traces, [], 1).targetTemperature, null);
});

const liveReference = () => ({ samples: shotSamples(measurements()), numbers: shotNumbers(shot()) });
const frame = (over = {}) => ({ ...liveFrame(lines(), stageLines, 14.2), ...over });

test('live, in Reference: each card beside the reference at the same second', () => {
    const cards = liveCards({ view: 'reference', frame: frame(), reference: liveReference() });
    assert.deepEqual(brief(cards), [
        ['time', '12.0 s', PHRASES.refRan, '30.0 s', ''],
        ['weight', '14.2 g', PHRASES.ref, '13.2 g', '+1.0 g'],
        ['weightFlow', '1.4 g/s', PHRASES.ref, '2.0 g/s', '−0.6 g/s'],
        ['flow', '2.1 ml/s', PHRASES.ref, '2.2 ml/s', '−0.1 ml/s'],
        ['pressure', '8.6 bar', PHRASES.ref, '8.9 bar', '−0.3 bar'],
        ['temperature', '92.5 °C', PHRASES.ref, '92.2 °C', '+0.3 °C'],
    ]);
    assert.deepEqual(cards.map(c => c.title.phrase), ['Time', 'Weight', 'Weight flow', 'Water flow', 'Pressure', 'Temperature']);
});

test('live, in Reference: "No reference" with none, and "Ref ended" past its last second', () => {
    const none = liveCards({ view: 'reference', frame: frame(), reference: null });
    assert.deepEqual(none.map(c => [c.side, c.diff]), Array(6).fill([{ phrase: 'No reference' }, '']));
    assert.equal(none[4].value, '8.6 bar');

    const past = liveCards({ view: 'reference', frame: frame({ seconds: 30.1 }), reference: liveReference() });
    assert.deepEqual(past[0].side, { phrase: PHRASES.refRan, vars: { value: '30.0 s' } }, 'Time still says how long the reference ran');
    assert.deepEqual(past.slice(1).map(c => [c.side, c.diff]), Array(5).fill([{ phrase: 'Ref ended' }, '']));
    const last = liveCards({ view: 'reference', frame: frame({ seconds: 30 }), reference: liveReference() });
    assert.equal(last[4].side.vars.value, '6.0 bar', 'at its last second it still has a value');
});

test('live, in Reference: a value the reference did not record is "—", with no difference', () => {
    const noScale = { samples: shotSamples(measurements().map(({ machine }) => ({ machine }))), numbers: shotNumbers(shot()) };
    const cards = liveCards({ view: 'reference', frame: frame(), reference: noScale });
    assert.deepEqual(brief(cards)[1], ['weight', '14.2 g', PHRASES.ref, '—', '']);
    assert.equal(cards[4].diff, '−0.3 bar');
});

test('live, in Targets: the stage, the weight it stops at, and each target the step sets', () => {
    const cards = liveCards({ view: 'targets', frame: frame(), reference: liveReference(), stopAt: 36 });
    assert.deepEqual(cards.map(c => [c.key, c.value, c.side, c.diff]), [
        ['time', '12.0 s', { text: 'Rise and hold' }, ''],
        ['weight', '14.2 g', { phrase: PHRASES.stopsAt, vars: { value: '36.0 g' } }, ''],
        ['weightFlow', '1.4 g/s', { phrase: 'No profile target' }, ''],
        ['flow', '2.1 ml/s', { phrase: 'No target this step' }, ''],
        ['pressure', '8.6 bar', { phrase: PHRASES.target, vars: { value: '9.0 bar' } }, ''],
        ['temperature', '92.5 °C', { phrase: PHRASES.target, vars: { value: '93.0 °C' } }, ''],
    ]);
    const flowStep = liveCards({ view: 'targets', frame: frame({ targetFlow: 2, targetPressure: null, targetTemperature: null, stage: '' }), stopAt: NaN });
    assert.deepEqual(flowStep.map(c => c.side), [
        null, { phrase: 'No target' }, { phrase: 'No profile target' },
        { phrase: PHRASES.target, vars: { value: '2.0 ml/s' } }, { phrase: 'No target this step' }, { phrase: 'No target this step' },
    ]);
});

test('live: before the first frame every value is "—"', () => {
    for (const view of ['reference', 'targets']) {
        const cards = liveCards({ view, frame: null, reference: liveReference(), stopAt: 36 });
        assert.deepEqual(cards.map(c => [c.value, c.diff]), Array(6).fill(['—', '']));
    }
    assert.deepEqual(liveCards({ view: 'reference', frame: null, reference: liveReference() })[1].side, { phrase: PHRASES.ref, vars: { value: '—' } });
});

test('live: temperatures follow the page\'s unit, the difference with them', () => {
    const reference = liveCards({ view: 'reference', frame: frame(), reference: liveReference(), fahrenheit: true })[5];
    assert.deepEqual([reference.value, reference.side.vars.value, reference.diff], ['198.5 °F', '198.0 °F', '+0.5 °F']);
    const targets = liveCards({ view: 'targets', frame: frame(), fahrenheit: true })[5];
    assert.deepEqual([targets.value, targets.side.vars.value], ['198.5 °F', '199.4 °F']);
});
