// The numbers under the graph: a finished Shot's against its reference's or
// against what was set, and a running shot's against the reference at the same
// second or against what the profile asks for (docs/cafe/DESIGN.md, "The
// comparison row"). No browser global is touched.
//
// A Shot is timed and measured as Decent Sync does it (`shotSamples`,
// `timeToFirstDrip` and `extractCurves` there), so a tablet and its server give
// one Shot the same numbers: the Preheat is its leading samples in
// `preparingForShot`, the profile starts at the first sample after them, and
// nothing in the Preheat counts.
import { hasMachineGFlow } from '../modules/historical-gflow.js';

/** The least the scale reads, in grams, once coffee has reached the cup. */
const FIRST_DRIP_GRAMS = 1;

const NONE = '—';
const MINUS = '−';

/** Every phrase a card can show, by the name this module uses for it. */
export const PHRASES = {
    time: 'Time',
    firstDrip: 'First drip',
    dose: 'Dose',
    yield: 'Yield',
    ratio: 'Ratio',
    ratioOf: 'Ratio · {dose} g dose',
    peak: 'Peak pressure',
    weight: 'Weight',
    weightFlow: 'Weight flow',
    flow: 'Water flow',
    pressure: 'Pressure',
    temperature: 'Temperature',
    ref: 'Ref {value}',
    refRan: 'Ref ran {value}',
    refEnded: 'Ref ended',
    noReference: 'No reference',
    same: 'Ref = this shot',
    noShot: 'No shot yet',
    target: 'Target {value}',
    stopsAt: 'Stops at {value}',
    firstDripAt: 'First drip {value}',
    noTarget: 'No target',
    noTargetStep: 'No target this step',
    noProfileTarget: 'No profile target',
};

const number = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const positive = value => (number(value) !== null && value > 0 ? value : null);
const millis = value => {
    const at = typeof value === 'string' || value instanceof Date ? new Date(value).getTime() : NaN;
    return Number.isNaN(at) ? null : at;
};

/**
 * A Shot's samples after its Preheat, one for each measurement its machine
 * timed: `seconds` from the start of the profile, the machine's pressure, flow
 * and group temperature, and the scale's weight and weight flow, each null
 * where it was not recorded. The weight flow is the machine's own on a record
 * from a machine that measures one, as on the graph: a DE1 writes a constant 0
 * there, which is no reading.
 */
export function shotSamples(measurements) {
    const samples = [];
    const machineFlow = hasMachineGFlow(measurements);
    let preheat = true;
    let start = null;
    for (const measurement of Array.isArray(measurements) ? measurements : []) {
        const machine = measurement?.machine;
        if (preheat && machine?.state?.substate !== 'preparingForShot') preheat = false;
        const at = millis(machine?.timestamp);
        if (preheat || at === null) continue;
        if (start === null) start = at;
        samples.push({
            seconds: (at - start) / 1000,
            pressure: number(machine.pressure),
            flow: number(machine.flow),
            temperature: number(machine.groupTemperature),
            weight: number(measurement.scale?.weight),
            weightFlow: number(machineFlow ? machine.weightFlow : measurement.scale?.weightFlow),
        });
    }
    return samples;
}

/**
 * A finished Shot's numbers, each null where the Shot did not record it.
 *
 * - `time`: how long its profile ran, in seconds: to its last sample.
 * - `firstDrip`: the seconds at which the scale first read 1 g or more.
 * - `peak`: its highest pressure, in bar.
 * - `yield`: what it weighed out, in grams, or the scale's last reading where
 *   the Shot kept none.
 * - `weighedDose`: the dose it weighed, and `dose`, that or else the dose its
 *   Workflow set, which is the recipe's as it was pulled.
 * - `ratio`: yield over `dose`.
 * - `targetDose`, `targetYield`, `targetRatio`: what its Workflow set. A yield
 *   of 0 is stop-at-weight switched off, so the Shot had no target, whatever
 *   its profile's target weight. That weight stands in only for a Workflow
 *   that holds no yield at all. This is Decent Sync's rule too.
 */
export function shotNumbers(shot) {
    if (!shot) return null;
    const samples = shotSamples(shot.measurements);
    const last = samples[samples.length - 1];
    const firstDrip = samples.find(sample => sample.weight !== null && sample.weight >= FIRST_DRIP_GRAMS);
    const pressures = samples.map(sample => sample.pressure).filter(value => value !== null);
    const weights = samples.filter(sample => sample.weight !== null);
    const weighed = weights[weights.length - 1];

    const context = shot.workflow?.context;
    const targetDose = positive(context?.targetDoseWeight);
    const held = number(context?.targetYield);
    const targetYield = positive(held !== null ? held : shot.workflow?.profile?.target_weight);
    const weighedDose = positive(shot.annotations?.actualDoseWeight);
    const dose = weighedDose ?? targetDose;
    const yielded = positive(shot.annotations?.actualYield) ?? positive(weighed?.weight);
    return {
        time: last ? last.seconds : null,
        firstDrip: firstDrip ? firstDrip.seconds : null,
        peak: pressures.length ? Math.max(...pressures) : null,
        yield: yielded,
        weighedDose,
        dose,
        ratio: yielded !== null && dose !== null ? yielded / dose : null,
        targetDose,
        targetYield,
        targetRatio: targetYield !== null && targetDose !== null ? targetYield / targetDose : null,
    };
}

/**
 * A Shot's value of `key` at `seconds` of its own run, taken between its two
 * nearest samples that recorded one. Null before its first such sample, after
 * its last, or where it recorded none.
 */
export function valueAt(samples, key, seconds) {
    let before = null;
    for (const sample of samples) {
        if (sample[key] === null) continue;
        if (sample.seconds === seconds) return sample[key];
        if (sample.seconds > seconds) {
            if (before === null) return null;
            const share = (seconds - before.seconds) / (sample.seconds - before.seconds);
            return before[key] + (sample[key] - before[key]) * share;
        }
        before = sample;
    }
    return null;
}

// ── Writing a number ─────────────────────────────────────────────────────────

const UNITS = {
    seconds: { unit: ' s', places: 1 },
    grams: { unit: ' g', places: 1 },
    bar: { unit: ' bar', places: 1 },
    flow: { unit: ' ml/s', places: 1 },
    weightFlow: { unit: ' g/s', places: 1 },
    celsius: { unit: ' °C', places: 1 },
    fahrenheit: { unit: ' °F', places: 1 },
    ratio: { unit: '', places: 2, lead: '1:' },
};

const shown = (value, kind) => (value === null || value === undefined ? NONE : `${UNITS[kind].lead || ''}${value.toFixed(UNITS[kind].places)}${UNITS[kind].unit}`);

/**
 * The difference between two numbers as they are shown, so it is the
 * difference of the two the barista reads: "+0.5 s", "−1.2 g", "0.0 bar". Empty
 * when either is missing. It has no colour and no verdict.
 */
export function difference(value, against, kind) {
    if (value === null || value === undefined || against === null || against === undefined) return '';
    const { places, unit } = UNITS[kind];
    const gap = Number(value.toFixed(places)) - Number(against.toFixed(places));
    const size = Math.abs(gap).toFixed(places);
    const sign = Number(size) === 0 ? '' : gap > 0 ? '+' : MINUS;
    return `${sign}${size}${unit}`;
}

const phrase = (text, vars) => ({ phrase: text, ...(vars ? { vars } : {}) });
const card = (key, title, value, side = null, diff = '') => ({ key, title, value, side, diff });

// ── At rest ──────────────────────────────────────────────────────────────────

const REST = {
    time: 'seconds', firstDrip: 'seconds', yield: 'grams', ratio: 'ratio', peak: 'bar', weighedDose: 'grams',
};

const ratioTitle = numbers => (numbers && numbers.dose !== null ? phrase(PHRASES.ratioOf, { dose: numbers.dose.toFixed(1) }) : phrase(PHRASES.ratio));

/**
 * The five cards at rest.
 *
 * - `view`: `reference` or `targets`.
 * - `shot`: the numbers of the Shot in the graph (`shotNumbers`), null when the
 *   recipe has no Shot yet, undefined before it was read.
 * - `reference`: the reference's numbers, or null with none.
 * - `isReference`: the Shot in the graph is the reference.
 *
 * Each card is `{ key, title, value, side, diff }`: `title` and `side` are
 * `{ phrase, vars }` for the page to translate, `side` null for nothing, and
 * `value` and `diff` are text as written.
 */
export function restCards({ view, shot, reference = null, isReference = false }) {
    const read = shot !== undefined;
    const of = key => (shot ? shot[key] : null);
    if (view === 'targets') {
        const beside = (key, target, kind) => {
            if (!read) return [null, ''];
            if (!shot) return [phrase(PHRASES.noShot), ''];
            if (target === null) return [phrase(PHRASES.noTarget), ''];
            return [phrase(PHRASES.target, { value: shown(target, kind) }), difference(of(key), target, kind)];
        };
        const alone = side => (!read ? null : shot ? side : phrase(PHRASES.noShot));
        return [
            card('time', phrase(PHRASES.time), shown(of('time'), 'seconds'), alone(phrase(PHRASES.firstDripAt, { value: shown(of('firstDrip'), 'seconds') }))),
            card('dose', phrase(PHRASES.dose), shown(of('weighedDose'), 'grams'), ...beside('weighedDose', of('targetDose'), 'grams')),
            card('yield', phrase(PHRASES.yield), shown(of('yield'), 'grams'), ...beside('yield', of('targetYield'), 'grams')),
            card('ratio', ratioTitle(shot), shown(of('ratio'), 'ratio'), ...beside('ratio', of('targetRatio'), 'ratio')),
            card('peak', phrase(PHRASES.peak), shown(of('peak'), 'bar'), alone(null)),
        ];
    }
    const beside = key => {
        if (!read) return [null, ''];
        if (isReference) return [phrase(PHRASES.same), ''];
        if (!reference) return [phrase(PHRASES.noReference), ''];
        return [phrase(PHRASES.ref, { value: shown(reference[key], REST[key]) }), difference(of(key), reference[key], REST[key])];
    };
    return [
        card('time', phrase(PHRASES.time), shown(of('time'), 'seconds'), ...beside('time')),
        card('firstDrip', phrase(PHRASES.firstDrip), shown(of('firstDrip'), 'seconds'), ...beside('firstDrip')),
        card('yield', phrase(PHRASES.yield), shown(of('yield'), 'grams'), ...beside('yield')),
        card('ratio', ratioTitle(shot), shown(of('ratio'), 'ratio'), ...beside('ratio')),
        card('peak', phrase(PHRASES.peak), shown(of('peak'), 'bar'), ...beside('peak')),
    ];
}

// ── While a shot runs ────────────────────────────────────────────────────────

const lastOf = values => (values.length ? values[values.length - 1] : null);

/**
 * What a running shot reads now, from the lines the chart is about to draw
 * (Streamline's seven, by name), so a card never says more than the graph
 * shows: the seconds, the pressure, the two flows and the temperature, and the
 * target of each where the profile sets one at this step. A target of zero is a
 * step that sets none. `stage` is the name of the step the shot is in, from the
 * chart's stage lines, and `weight` the scale's reading. Null before the first
 * frame.
 */
export function liveFrame(traces, shapes, weight) {
    const named = name => traces.find(trace => trace.name === name);
    const pressure = named('Pressure');
    if (!pressure || pressure.x.length === 0) return null;
    const seconds = lastOf(pressure.x);
    const now = name => {
        const trace = named(name);
        return trace && trace.x.length && lastOf(trace.x) === seconds ? number(lastOf(trace.y)) : null;
    };
    const tenfold = value => (value === null ? null : value * 10); // the chart draws a temperature at a tenth
    const stages = (Array.isArray(shapes) ? shapes : []).filter(shape => typeof shape.name === 'string' && shape.name.trim());
    return {
        seconds,
        weight: number(weight),
        weightFlow: now('Weight'),
        flow: now('Flow'),
        pressure: now('Pressure'),
        temperature: tenfold(now('°C')),
        targetFlow: positive(now('Target Flow')),
        targetPressure: positive(now('Target Pressure')),
        targetTemperature: positive(tenfold(now('Target °C'))),
        stage: stages.length ? stages[stages.length - 1].name.trim() : '',
    };
}

const LIVE = [
    { key: 'weight', title: PHRASES.weight, kind: 'grams' },
    { key: 'weightFlow', title: PHRASES.weightFlow, kind: 'weightFlow' },
    { key: 'flow', title: PHRASES.flow, kind: 'flow', target: 'targetFlow' },
    { key: 'pressure', title: PHRASES.pressure, kind: 'bar', target: 'targetPressure' },
    { key: 'temperature', title: PHRASES.temperature, kind: 'celsius', target: 'targetTemperature' },
];

const fahrenheit = value => (value === null || value === undefined ? value : (value * 9) / 5 + 32);

/**
 * The six cards while a shot runs.
 *
 * - `frame`: what the shot reads now (`liveFrame`), or null before its first.
 * - `reference`: `{ samples, numbers }` of the recipe's reference
 *   (`shotSamples`, `shotNumbers`), or null with none.
 * - `stopAt`: the weight the shot stops at, in grams.
 * - `fahrenheit`: temperatures are shown in °F.
 *
 * In Reference each card sits beside the reference at the same second of its
 * own run. In Targets each sits beside what the profile asks for now.
 */
export function liveCards({ view, frame, reference = null, stopAt = null, fahrenheit: inFahrenheit = false }) {
    const of = key => (frame ? frame[key] : null);
    const degrees = (value, kind) => (kind === 'celsius' && inFahrenheit ? [fahrenheit(value), 'fahrenheit'] : [value, kind]);
    const time = side => card('time', phrase(PHRASES.time), shown(of('seconds'), 'seconds'), side);

    if (view === 'targets') {
        return [
            time(frame && frame.stage ? { text: frame.stage } : null),
            ...LIVE.map(({ key, title, kind, target }) => {
                const [value, unit] = degrees(of(key), kind);
                let side;
                if (key === 'weight') side = positive(stopAt) !== null ? phrase(PHRASES.stopsAt, { value: shown(stopAt, 'grams') }) : phrase(PHRASES.noTarget);
                else if (!target) side = phrase(PHRASES.noProfileTarget);
                else if (of(target) === null) side = phrase(PHRASES.noTargetStep);
                else side = phrase(PHRASES.target, { value: shown(degrees(of(target), kind)[0], unit) });
                return card(key, phrase(title), shown(value, unit), side);
            }),
        ];
    }

    const ran = reference ? reference.numbers.time : null;
    const ended = frame !== null && ran !== null && frame.seconds > ran;
    return [
        time(reference ? phrase(PHRASES.refRan, { value: shown(ran, 'seconds') }) : phrase(PHRASES.noReference)),
        ...LIVE.map(({ key, title, kind }) => {
            const [value, unit] = degrees(of(key), kind);
            if (!reference) return card(key, phrase(title), shown(value, unit), phrase(PHRASES.noReference));
            if (ended) return card(key, phrase(title), shown(value, unit), phrase(PHRASES.refEnded));
            const [against] = degrees(frame ? valueAt(reference.samples, key, frame.seconds) : null, kind);
            return card(key, phrase(title), shown(value, unit), phrase(PHRASES.ref, { value: shown(against, unit) }), difference(value, against, unit));
        }),
    ];
}
