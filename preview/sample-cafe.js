// The public preview's sample cafe (docs/cafe/DESIGN.md, "The public
// preview"): the seed the preview puts on top of the tests' recorded sample
// data, worked out from the recordings before the fake Decaid is made from
// them. It touches no browser global, so `node:test` runs it
// (test/preview-sample-cafe.test.mjs), and keeps no timer. The stand-in
// (preview/stand-in.js) hands its answer to `createFakeDecaid` as it is.
//
//   const made = sampleCafe({ sampleData, boot, simulated, real, decentSync });
//   createFakeDecaid({ ...made, now, timeZone });
//
// What it makes, all of it the same on every visit:
//
// - The recipes sit on the profile, dose and yield of the recorded pour their
//   Shots come from: House espresso, Single origin and the guest roast on the
//   real DE1Pro pour's (Best practice (light roast), 20 g to 44 g), Decaf and
//   Long black on the simulated pour's (Default, 18 g to 36 g). Filter keeps
//   its own and has no Shots. Each record holds the sample machine's steam,
//   hot water and flush values, as the page tests' `matchMachine` gives one,
//   so DYE2 does not call a recipe changed the moment it is loaded.
// - House espresso is loaded: the Workflow is the one Streamline's apply
//   writes for its record.
// - About thirty Shots over four days, made from the two recorded pours, each
//   varied by a few percent in time, pressure and yield, so no two lie on
//   each other. Some are Unfinished, cut as a shot stopped two seconds into
//   its profile. The fake moves them all in time as it moves the sample
//   data's, so the newest is an hour before the page opened.
// - A Reference Shot on four of the six recipes. The guest roast's was pulled
//   on Default, before the recipe moved to Best practice, so its reference
//   reads "Different profile".
// - Served by Decent Sync (`decentSync` given): the Location's Shots, this
//   Machine's and "Sample Machine Two"'s, and the references on its server.
//   Without it: this Machine's Shots, and the references kept on the tablet.
//
// The recorded sample Shots, and the Decent Sync recording's four, are left
// out: the seed's Shots are the cafe's.

const DYE2 = 'dye2.reaplugin';
const CAFE = 'streamlineCafe';

/** The names the seed gives baristas, in the sample data's manner. */
export const BARISTAS = Object.freeze(['Sample Barista', 'Example Barista', 'Second Barista', 'Sample Trainee']);

/** The notes the seed gives Shots. */
export const NOTES = Object.freeze([
    'Sweet and balanced, the one to match.',
    'A little fast. Went one step finer.',
    'Bright, a touch sour at the end.',
    'Syrupy body, long finish.',
    'Thin. Checked the dose.',
    'Good with milk.',
    'Example note: a bit bitter.',
]);

/** Where each recipe's Shots come from: the recorded pour whose profile, dose and yield it takes. */
export const RECIPE_POURS = Object.freeze({
    'House espresso': 'real',
    'Single origin': 'real',
    'Guest roast with a long name': 'real',
    Decaf: 'simulated',
    'Long black': 'simulated',
});

/** The recipe with no Shots, whose card loads to the page's state for a recipe with no Shot yet. */
export const NO_SHOTS = 'Filter';

// The seed's Shots, newest first: hours before the newest, the recipe, the
// recorded pour (the recipe's unless named), the Machine ('two' is Sample
// Machine Two, at the Location only with Decent Sync), the barista (an index
// into BARISTAS), the rating out of 10 (0 is none), the note (an index into
// NOTES, or none), and whether it was stopped early. The House espresso the
// page opens on, and its reference, are varied apart by hand, so the two
// lines on the graph and the comparison row's differences are plain to see.
const SHOTS = [
    { hours: 0, recipe: 'House espresso', barista: 0, rating: 8, note: 3, vary: { time: 1.045, pressure: 0.97, yield: 0.96 } },
    { hours: 0.5, recipe: 'Single origin', barista: 1, rating: 6 },
    { hours: 0.8, recipe: 'House espresso', machine: 'two', barista: 2, rating: 8 },
    { hours: 1.2, recipe: 'House espresso', barista: 0, rating: 6, note: 1 },
    { hours: 2, recipe: 'House espresso', barista: 3, unfinished: true },
    { hours: 2.5, recipe: 'Decaf', machine: 'two', barista: 2, rating: 6 },
    { hours: 3, recipe: 'House espresso', barista: 1, rating: 8 },
    { hours: 4.5, recipe: 'Single origin', barista: 0, rating: 4, note: 2 },
    { hours: 24, recipe: 'House espresso', barista: 1, rating: 6 },
    { hours: 24.6, recipe: 'Long black', barista: 3, rating: 6, note: 5 },
    { hours: 25, recipe: 'House espresso', machine: 'two', barista: 2, unfinished: true },
    { hours: 25.5, recipe: 'Single origin', barista: 0, rating: 10, note: 3 },
    { hours: 26.5, recipe: 'House espresso', barista: 0, rating: 10, note: 0, vary: { time: 0.97, pressure: 1.03, yield: 1.035 } },
    { hours: 27.5, recipe: 'Single origin', machine: 'two', barista: 2, rating: 8 },
    { hours: 28, recipe: 'Long black', barista: 1 },
    { hours: 29, recipe: 'Decaf', barista: 3, rating: 6 },
    { hours: 48, recipe: 'House espresso', barista: 1, rating: 8, note: 5 },
    { hours: 49, recipe: 'Decaf', barista: 3, unfinished: true },
    { hours: 49.5, recipe: 'House espresso', machine: 'two', barista: 2, rating: 6 },
    { hours: 50.5, recipe: 'Guest roast with a long name', barista: 0, rating: 8, note: 6 },
    { hours: 51, recipe: 'Long black', machine: 'two', barista: 2, rating: 4 },
    { hours: 52, recipe: 'House espresso', barista: 3, rating: 4, note: 4 },
    { hours: 53, recipe: 'Decaf', barista: 1, rating: 8, note: 0 },
    { hours: 72, recipe: 'Guest roast with a long name', barista: 1, rating: 6 },
    { hours: 73, recipe: 'House espresso', barista: 0, rating: 8 },
    { hours: 73.5, recipe: 'Decaf', machine: 'two', barista: 2 },
    { hours: 74.5, recipe: 'Single origin', barista: 3, rating: 6, note: 1 },
    { hours: 75, recipe: 'House espresso', machine: 'two', barista: 2, rating: 8 },
    { hours: 76, recipe: 'Decaf', barista: 0, rating: 6 },
    { hours: 77, recipe: 'House espresso', barista: 1 },
    { hours: 78, recipe: 'Long black', barista: 0, rating: 8 },
    { hours: 96, recipe: 'Guest roast with a long name', pour: 'simulated', barista: 0, rating: 10, note: 0 },
];

// Each recipe's Reference Shot, by its hours in SHOTS. Long black and Filter have none.
const REFERENCES = {
    'House espresso': 26.5,
    'Single origin': 25.5,
    Decaf: 53,
    'Guest roast with a long name': 96,
};

// The newest Shot's start, as the seed writes it. Any moment would do: the
// fake moves the Shots so the newest is an hour before the page opened.
const NEWEST = Date.parse('2026-11-16T15:00:00Z');
const SECONDS_TO_STORE = 4;
// The variation: each of time, pressure and yield scaled by 1 ± a fraction
// between these two, never 1 itself.
const VARY_LEAST = 0.012;
const VARY_MOST = 0.05;
// `isUnfinished` (src/cafe/shot-model.js): the Preheat and the first two seconds of preinfusion, nothing on the scale.
const UNFINISHED_MS = 2000;

const copy = value => JSON.parse(JSON.stringify(value));
const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

/** A fixed stream of numbers in [0, 1) (mulberry32), the same for the same seed. */
function numbers(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** The variation of the Shot at `index`: a scale for its time, its pressure and its yield. */
export function variationOf(index) {
    const next = numbers(0x5eed + index * 7919);
    const factor = () => {
        const size = VARY_LEAST + next() * (VARY_MOST - VARY_LEAST);
        return round(next() < 0.5 ? 1 - size : 1 + size, 4);
    };
    return { time: factor(), pressure: factor(), yield: factor() };
}

/** A time as Decaid writes it local with no offset, here in UTC, as the recorder's zone was: the fake moves it. */
function written(ms) {
    return `${new Date(ms).toISOString().slice(0, 23)}000`;
}

/** A time written with no offset, read as UTC (as the fake reads the sample data's). */
const readUtc = text => Date.parse(/[zZ]$/.test(text) ? text : `${text.slice(0, 23)}Z`);

/**
 * A recorded Shot's measurements, varied and moved to start at `start`: time
 * from the first sample stretched by `time`, the pressure the machine read by
 * `pressure`, and the weight, its flow and the machine's flow by `yield`
 * (the flows over `time` too). Targets and temperatures are the profile's
 * and stay as they were.
 */
export function variedMeasurements(measurements, variation, start) {
    const zero = readUtc(measurements[0].machine.timestamp);
    const at = text => written(start + (readUtc(text) - zero) * variation.time);
    const rate = variation.yield / variation.time;
    return measurements.map(sample => ({
        ...sample,
        machine: sample.machine && {
            ...sample.machine,
            timestamp: at(sample.machine.timestamp),
            pressure: sample.machine.pressure * variation.pressure,
            flow: sample.machine.flow * rate,
        },
        scale: sample.scale && {
            ...sample.scale,
            timestamp: at(sample.scale.timestamp),
            weight: sample.scale.weight * variation.yield,
            weightFlow: sample.scale.weightFlow * rate,
        },
        ...(typeof sample.volume === 'number' && { volume: sample.volume * variation.yield }),
    }));
}

/** A Shot stopped two seconds into its profile: its Preheat and first two seconds, nothing on the scale (test/page/support/fake-reads.mjs, `unfinishedParts`). */
export function stoppedEarly(measurements) {
    const started = measurements.find(m => m.machine.state.substate !== 'preparingForShot');
    const cut = readUtc(started.machine.timestamp) + UNFINISHED_MS;
    return measurements
        .filter(m => m.machine.state.substate === 'preparingForShot' || (m.machine.state.substate === 'preinfusion' && readUtc(m.machine.timestamp) <= cut))
        .map(m => ({ ...m, scale: m.scale ? { ...m.scale, weight: 0, weightFlow: 0 } : m.scale }));
}

// The record's steam, hot water and flush values that DYE2 compares with the
// Workflow's, as `matchMachine` (test/page/support/fake-reads.mjs) writes them.
const MACHINE_FIELDS = {
    steamTempC: ['steamSettings', 'targetTemperature'], steamTimeS: ['steamSettings', 'duration'], steamFlowMls: ['steamSettings', 'flow'], steamStopAtTempC: ['steamSettings', 'stopAtTemperature'],
    hotWaterTempC: ['hotWaterData', 'targetTemperature'], hotWaterTimeS: ['hotWaterData', 'duration'], hotWaterMl: ['hotWaterData', 'volume'], hotWaterFlowMls: ['hotWaterData', 'flow'],
    flushTempC: ['rinseData', 'targetTemperature'], flushS: ['rinseData', 'duration'], flushFlowMls: ['rinseData', 'flow'],
};

/** A record on the sample machine, on `pour`'s profile, dose and yield where it has Shots. */
function shapedRecord(record, machine, pour) {
    const next = copy(record);
    const values = next.dashboardVariables;
    for (const [key, [group, field]] of Object.entries(MACHINE_FIELDS)) {
        if (values[key] != null && machine[group]?.[field] != null) values[key] = machine[group][field];
    }
    next.workflow.steamSettings = { ...next.workflow.steamSettings, ...machine.steamSettings };
    next.workflow.hotWaterData = { ...next.workflow.hotWaterData, ...machine.hotWaterData };
    next.workflow.rinseData = { ...next.workflow.rinseData, ...machine.rinseData };
    if (!pour) return next;
    const profile = copy(pour.shot.workflow.profile);
    const { targetDoseWeight: dose, targetYield: drink } = pour.shot.workflow.context;
    Object.assign(values, { dose, drink, brewC: profile.steps[0].temperature });
    next.profileTitle = profile.title;
    next.profileSnapshot = copy(profile);
    next.workflow.profile = copy(profile);
    next.workflow.context = { ...next.workflow.context, targetDoseWeight: dose, targetYield: drink };
    return next;
}

/** The Workflow Streamline's apply writes for `record` on the sample machine (test/page/strip.spec.mjs, `workflowOf`). */
export function appliedWorkflow(record, machine) {
    const { extras, ...context } = record.workflow.context;
    const { dye, ...rest } = extras;
    const { profile, steamSettings, hotWaterData, rinseData } = record.workflow;
    return {
        ...copy(record.workflow),
        id: machine.id,
        name: machine.name,
        description: machine.description,
        context: { ...copy(context), extras: { ...copy(rest), dye: { selection: null, v: 1, recipeId: record.id }, rpm: null, feedRate: null } },
        profile: { ...copy(profile), steps: profile.steps.map(step => ({ ...step, limiter: step.limiter && Number(step.limiter.value) !== 0 ? step.limiter : null })) },
        steamSettings: { ...machine.steamSettings, stopAtTemperature: steamSettings.stopAtTemperature },
        hotWaterData: copy(hotWaterData),
        rinseData: { ...machine.rinseData, duration: rinseData.duration },
    };
}

/** The seed's Shot ids, fixed so the tests and the screenshots hold. */
const shotId = index => `5eed0000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;

/**
 * The seed's Shots, as records whole, with where each is: `machine` ('this'
 * or 'two'), `recipe` (its name) and `unfinished`.
 */
export function seededShots({ records, pours }) {
    const byName = new Map(records.map(record => [record.name, record]));
    return SHOTS.map((plan, index) => {
        const pourName = plan.pour || RECIPE_POURS[plan.recipe];
        const pour = pours[pourName];
        const record = byName.get(plan.recipe);
        const variation = plan.vary || variationOf(index);
        const start = NEWEST - plan.hours * 3_600_000;
        let measurements = variedMeasurements(pour.shot.measurements, variation, start);
        if (plan.unfinished) measurements = stoppedEarly(measurements);
        const last = Math.max(...measurements.map(m => readUtc(m.machine.timestamp)));
        const stored = new Date(last + SECONDS_TO_STORE * 1000).toISOString();
        const recorded = pour.shot.workflow;
        const { extras, ...context } = record.workflow.context;
        const annotations = { actualDoseWeight: recorded.context.targetDoseWeight };
        if (!plan.unfinished) annotations.actualYield = round(pour.shot.annotations.actualYield * variation.yield, 1);
        if (plan.rating) annotations.enjoyment = plan.rating;
        if (plan.note !== undefined) annotations.espressoNotes = NOTES[plan.note];
        const shot = {
            id: shotId(index),
            timestamp: written(start),
            createdAt: stored,
            updatedAt: stored,
            measurements,
            workflow: {
                ...copy(recorded),
                // Pulled on the pour's profile, dose and yield: the recipe's,
                // or the guest roast's before it moved to Best practice.
                context: {
                    ...copy(context),
                    targetDoseWeight: recorded.context.targetDoseWeight,
                    targetYield: recorded.context.targetYield,
                    baristaName: BARISTAS[plan.barista],
                    extras: { ...copy(extras), dye: { selection: null, v: 1, recipeId: record.id }, rpm: null, feedRate: null },
                },
            },
            annotations,
            stopReason: plan.unfinished ? null : pour.shot.stopReason,
        };
        return { shot, machine: plan.machine || 'this', recipe: plan.recipe, unfinished: !!plan.unfinished, variation };
    });
}

/** Each recipe's Reference Shot id, by recipe name. */
export function referenceIds(seeded) {
    const out = {};
    for (const [recipe, hours] of Object.entries(REFERENCES)) {
        const at = SHOTS.findIndex(plan => plan.recipe === recipe && plan.hours === hours);
        out[recipe] = seeded[at].shot.id;
    }
    return out;
}

/**
 * The recordings the preview's fake starts from, shaped into the sample cafe.
 * `sampleData`, `boot`, `simulated` (recordings/pour.json), `real`
 * (recordings/real/de1pro-pour.json) and, for the preview served by Decent
 * Sync, `decentSync` (recordings/decent-sync.json); none is changed. Answers
 * `{ sampleData, boot, pour, decentSync }` for `createFakeDecaid`: its machine
 * plays the real pour.
 */
export function sampleCafe({ sampleData, boot, simulated, real, decentSync = null }) {
    const machine = sampleData.workflow;
    const pours = { real, simulated };
    const shape = list => list.map(record => shapedRecord(record, machine, pours[RECIPE_POURS[record.name]] || null));
    const records = shape(sampleData.store[DYE2].recipes);
    const seeded = seededShots({ records, pours });
    const references = referenceIds(seeded);
    const recordId = name => records.find(record => record.name === name).id;
    const house = records.find(record => record.name === 'House espresso');

    const own = seeded.filter(entry => entry.machine === 'this');
    const shaped = copy(sampleData);
    shaped.store[DYE2].recipes = records;
    shaped.workflow = appliedWorkflow(house, machine);
    shaped.shots = own.map(entry => entry.shot);
    // Without Decent Sync, the references are the page's own, on the tablet.
    if (!decentSync) {
        shaped.store[CAFE] = { ...(shaped.store[CAFE] || {}), references: Object.fromEntries(Object.entries(references).map(([name, id]) => [recordId(name), id])) };
    }

    // The machine's flush as the Workflow holds it, where DYE2's `record` reads it (`matchMachine`).
    const settingsKey = 'GET /api/v1/machine/settings';
    const settings = boot.requests[settingsKey];
    const shapedBoot = {
        ...boot,
        requests: {
            ...boot.requests,
            [settingsKey]: { ...settings, body: { ...settings.body, flushTemp: machine.rinseData.targetTemperature, flushFlow: machine.rinseData.flow } },
        },
    };

    let shapedSync = null;
    if (decentSync) {
        shapedSync = copy(decentSync);
        const syncRecords = shape(decentSync.store[DYE2].recipes);
        shapedSync.store[DYE2].recipes = syncRecords;
        const server = shapedSync.server;
        const profileId = title => server.profiles.find(profile => profile.title === title)?.id ?? null;
        const recipeIdOf = name => syncRecords.find(record => record.name === name).decentSyncId;
        for (const recipe of server.recipes) {
            const record = syncRecords.find(row => row.decentSyncId === recipe.id);
            recipe.profileId = profileId(record.profileTitle) ?? recipe.profileId;
            recipe.referenceShotId = references[record.name] ?? null;
        }
        // The tablet's own Shots are Decaid's (the sample data's, above); the server lists them.
        shapedSync.shots = [];
        server.own = Object.fromEntries(own.map(entry => [entry.shot.id, { unfinished: entry.unfinished }]));
        const two = decentSync.server.others[0].machine;
        server.others = seeded.filter(entry => entry.machine === 'two').map(entry => ({
            shot: entry.shot,
            machine: copy(two),
            recipeId: recipeIdOf(entry.recipe),
            unfinished: entry.unfinished,
        }));
    }

    return { sampleData: shaped, boot: shapedBoot, pour: real, decentSync: shapedSync };
}
