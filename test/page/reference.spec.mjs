// The reference on the graph (docs/cafe/DESIGN.md, "Shots and the reference",
// "The reference on the graph", "The comparison row"): the Reference view with
// no reference yet; Make reference choosing at once, the badge, and the choice
// in Decaid's store; a second shot with the reference faded behind it on the
// main graph and the full-screen one, the time axis at the reference's length,
// frames appended and not drawn again, and the live cards in Reference and
// Targets; the new Shot as the latest against the reference at rest; Targets at
// rest, the view kept in Decaid's store and after a reload; and "Replace the
// reference?", cancelled, then confirmed.
//
// Every shot is the one recorded pour (fake-decaid/recordings/pour.json),
// replayed with the page's clock moving with its frames, with House espresso
// loaded: the pour was recorded on its profile (Default), so the live frames'
// steps and targets are the loaded profile's. A second pour would be the first
// one again, every card beside it "0.0", so the tests past the first start from
// a reference chosen before the page opens: the sample data's newest Shot,
// another pour of the pinned stack's simulated machine, as Decaid would have
// stored it with the recipe loaded (`seedReference`). It ran longer than the
// recorded pour: see the time axis checks. With no Decent Sync, the choice of
// reference is the tablet's own, in Decaid's key-value store
// (fake-decaid/store.js); the recipe's load is DYE2's selection
// (fake-decaid/recordings/dye2-selection.json).
//
// The live cards are checked exactly, against the frames the page had when it
// last drew: what the chart is handed for each machine frame (src/modules/
// app.js, `updateChart` in src/modules/chart.js) worked through the page's own
// `liveCards` (src/cafe/comparison.js). The cards at rest are the stored
// Shots' own numbers through `restCards`.

import { test, expect } from './support/test.mjs';
import { recording } from './support/adapter.mjs';
import { legend, row, keys, sides, stageNames, chartLines, remarks, paint, load, writes, watchDraws, drawCounts, REFERENCE_LINES } from './support/page-reads.mjs';
import { recordOf, matchMachine } from './support/fake-reads.mjs';
import { RECIPES } from './support/sample-data.mjs';
import { shotNumbers, shotSamples, restCards, liveCards } from '../../src/cafe/comparison.js';
import { shotCurves } from '../../src/cafe/shot-model.js';
import { shotStages } from '../../src/cafe/stage-names.js';
import { shiftTime } from '../../fake-decaid/machine.js';

// The recipe on the recorded pour's profile (Default).
const target = RECIPES[0];
const POUR = recording('pour');
const CAFE = 'streamlineCafe';
const REST_REFERENCE = 'time firstDrip yield ratio peak';
const REST_TARGETS = 'time dose yield ratio peak';
const LIVE = 'time weight weightFlow flow pressure temperature';
// The shot's own four lines, which carry the live labels during a shot
// (src/modules/chart.js, `setLiveLineLabels`; test/cafe-live-labels.test.mjs).
const OWN_LABELLED = ['Pressure', 'Flow', '°C', 'Weight'];
// Two moments of the pour, each well before the reference's end (the profile
// starts 0.5 s in and runs 17.6 s): one in its fourth step, one in its fifth.
const MID_MS = 9000;
const LATER_MS = 12000;

// ── Setting up ───────────────────────────────────────────────────────────────

/** The page open with the recipe loaded afresh, as stored, and not called changed. */
async function openLoaded(cafe) {
    matchMachine(cafe.fake, target.name);
    await cafe.open();
    await load(cafe, target);
    return cafe.page;
}

/** The recorded pour, stored by Decaid, and the page's reads of it answered. */
async function pullShot(cafe) {
    await cafe.pour();
    await cafe.untilStored();
    const id = await cafe.storeShot();
    await cafe.advance(4000);
    await expect.poll(async () => (await legend(cafe.page)).label).toBe('Latest');
    return id;
}

/**
 * The recipe's first Shot, made its reference before the page opens: the
 * sample data's newest Shot, another pour of the same simulated machine on the
 * pinned Decaid, as Decaid would have stored it with the recipe loaded (its
 * Workflow the recipe's, naming it as Streamline's apply does), half an hour
 * earlier. It ran 18.4 s to the recorded pour's 17.6 s, with its own first
 * drip and yield, so the cards beside it differ from the pour's.
 */
function seedReference(fake) {
    const [newest] = fake.shots.newest(1);
    const { id, recipeId } = seedRecipeShot(fake, newest.id, '00000000-0000-4000-8000-0000000c0001', 30);
    fake.store.set(CAFE, 'references', { [recipeId]: id });
    return { id, recipeId };
}

/**
 * The sample data's other Shot (18.1 s, 182 frames, to the reference's 18.4 s
 * and 185), as the recipe's latest, pulled after the reference and not it: so
 * a page that drew or compared against the latest Shot in the reference's
 * place would show other numbers.
 */
function seedLatest(fake) {
    const [, other] = fake.shots.newest(2);
    return seedRecipeShot(fake, other.id, '00000000-0000-4000-8000-0000000c0003', 10).id;
}

/** A copy of the sample Shot `sampleId` as `id`, pulled with the recipe loaded, `minutes` earlier. */
function seedRecipeShot(fake, sampleId, id, minutes) {
    const record = recordOf(fake, target.name);
    const sample = fake.shots.get(sampleId);
    // Each time as it was written, wall clock in the fake's zone, moved back:
    // shifted as UTC text, so the zone is not applied twice.
    const earlier = text => shiftTime(text, -minutes * 60_000, 'UTC');
    const at = Date.parse(sample.createdAt) - minutes * 60_000;
    const context = record.workflow.context;
    fake.shots.add({
        ...sample,
        id,
        timestamp: earlier(sample.timestamp),
        createdAt: new Date(at).toISOString(),
        updatedAt: new Date(at).toISOString(),
        measurements: sample.measurements.map(m => ({
            ...m,
            machine: m.machine ? { ...m.machine, timestamp: earlier(m.machine.timestamp) } : m.machine,
            scale: m.scale ? { ...m.scale, timestamp: earlier(m.scale.timestamp) } : m.scale,
        })),
        workflow: {
            ...sample.workflow,
            ...record.workflow,
            context: { ...context, extras: { ...context.extras, dye: { selection: null, v: 1, recipeId: record.id } } },
            machine: sample.workflow.machine,
        },
    });
    return { id, recipeId: record.id };
}

/** The reference seeded, the page open with the recipe loaded, and the recorded pour stored. */
async function pouredAgainstReference(cafe) {
    const { id: first, recipeId } = seedReference(cafe.fake);
    const page = await openLoaded(cafe);
    await expect.poll(async () => (await legend(page)).badge, 'the seeded Shot is the latest, and the reference').toBe('This shot is the reference');
    const second = await pullShot(cafe);
    await expect(page.locator('#cafe-make-reference')).toBeVisible();
    return { page, first, second, recipeId };
}

const references = fake => fake.store.get(CAFE, 'references');
const storedView = fake => fake.store.get(CAFE, 'graphView');

// ── What the page should show ───────────────────────────────────────────────

// A card as the row draws it, in English (src/cafe/compare-row.js): a title in
// capitals but for what fills its places, and a side as its phrase reads.
const filled = (phrase, vars) => phrase.replace(/\{(\w+)\}/g, (_, name) => vars[name]);
const titled = ({ phrase, vars }) => filled(phrase.split(/(\{\w+\})/).map((piece, index) => (index % 2 ? piece : piece.toUpperCase())).join(''), vars || {});
const worded = side => (!side ? '' : side.phrase ? filled(side.phrase, side.vars || {}) : side.text);
const drawn = cards => cards.map(card => ({ key: card.key, title: titled(card.title), value: card.value, diff: card.diff, side: worded(card.side) }));
const shownCards = shown => shown.cards.map(({ key, title, value, diff, side }) => ({ key, title, value, diff, side }));

/** The reference as the live cards are handed it. */
const asReference = shot => ({ samples: shotSamples(shot.measurements), numbers: shotNumbers(shot) });

/** The stages the pour has reached by `ms`, named from the Workflow's profile, as the chart marks them. */
const stagesBy = (ms, workflow) => shotStages(POUR.frames.filter(entry => entry.ms <= ms && entry.socket === 'machine/snapshot').map(entry => ({ machine: entry.frame })), workflow);

const inShot = entry => entry.socket === 'machine/snapshot' && ['preinfusion', 'pouring'].includes(entry.frame.state.substate);

/**
 * What the running shot reads once the pour has played to `ms` and the chart
 * has drawn it (`liveFrame` in src/cafe/comparison.js): the last machine frame
 * in preinfusion or pouring, timed from the first, as app.js hands it to the
 * chart; the weight flow the scale had sent before it, which is the chart's
 * weight line; the scale's latest weight; and the step the shot is in, named
 * from the Workflow's profile.
 */
function frameAt(ms, workflow) {
    const played = POUR.frames.filter(entry => entry.ms <= ms && !entry.socket.startsWith('plugins/'));
    const first = played.find(inShot);
    const at = played.findLastIndex(inShot);
    const last = played[at].frame;
    const scaleFrames = list => list.filter(entry => entry.socket === 'scale/snapshot');
    const flowBefore = scaleFrames(played.slice(0, at)).at(-1)?.frame.weightFlow ?? null;
    const weight = scaleFrames(played).filter(entry => Number.isFinite(entry.frame.weight)).at(-1).frame.weight;
    const stages = stagesBy(ms, workflow);
    const positive = value => (Number.isFinite(value) && value > 0 ? value : null);
    return {
        seconds: (Date.parse(last.timestamp) - Date.parse(first.frame.timestamp)) / 1000,
        weight,
        weightFlow: flowBefore,
        flow: last.flow,
        pressure: last.pressure,
        // The chart draws a temperature at a tenth, and the cards take it back.
        temperature: ((last.groupTemperature / 100) * 10) * 10,
        targetFlow: positive(last.targetFlow),
        targetPressure: positive(last.targetPressure),
        targetTemperature: positive(last.targetGroupTemperature) === null ? null : (last.targetGroupTemperature / 10) * 10,
        stage: (stages.at(-1)?.name ?? '').trim(),
    };
}

/** The six live cards once the pour has played to `ms`. */
function liveExpected(fake, ms, view, reference) {
    return drawn(liveCards({ view, frame: frameAt(ms, fake.workflow()), reference: asReference(reference), stopAt: target.yield }));
}

/** When a Shot was pulled, as the page writes it (src/cafe/shot-model.js, `whenText`, in the page's zone). */
const creditOf = (page, shot) => page.evaluate(async timestamp => {
    const { whenText } = await import('/src/cafe/shot-model.js');
    return whenText(new Date(timestamp), new Date(), navigator.language, 'Today');
}, shot.timestamp);

/** Plays the pour on to `ms`, and lets the chart draw its last frame: nothing more is sent meanwhile. */
async function pourTo(cafe, ms) {
    await cafe.pour(ms);
    await cafe.advance(500);
}

test.describe('the reference on the graph', { tag: '@reference' }, () => {
    test('with no reference yet, the latest Shot is drawn alone, and Make reference chooses it at once', async ({ cafe, fake }) => {
        const page = await openLoaded(cafe);
        const first = await pullShot(cafe);
        const recipeId = recordOf(fake, target.name).id;
        const firstShot = fake.shots.get(first);

        let now = await legend(page);
        expect(now, 'the graph starts in Reference, with the latest Shot and no reference').toEqual({
            label: 'Latest', when: await creditOf(page, firstShot), make: 'Make reference', muted: false, reference: null,
            flag: null, badge: null, line: null, notice: null, targets: null, view: 'reference',
        });
        const lines = await chartLines(page);
        expect(lines.names, 'in Reference the reference\'s three lines follow Streamline\'s seven').toEqual(['Pressure', 'Flow', 'Target Pressure', 'Target Flow', '°C', 'Target °C', 'Weight', ...REFERENCE_LINES]);
        expect(lines.points.slice(7), 'empty with no reference').toEqual([0, 0, 0]);
        expect([2, 3, 5].map(index => lines.points[index]), 'and no target is drawn').toEqual([0, 0, 0]);
        expect(lines.points[0], 'the Shot is drawn').toBe(shotCurves(firstShot.measurements).pressure.x.length);

        const mark = fake.log.length;
        await page.locator('#cafe-make-reference').click();
        await expect(page.locator('#cafe-reference-badge')).toBeVisible();
        await cafe.settle();
        await expect(page.locator('#cafe-reference-dialog[open]'), 'Make reference with none chosen asks nothing').toHaveCount(0);
        now = await legend(page);
        expect(now.badge, 'the latest Shot is now the reference').toBe('This shot is the reference');
        expect(now.reference, 'no reference row').toBeNull();
        expect(now.make, 'no Make reference').toBeNull();
        expect((await chartLines(page)).points.slice(7), 'and the reference\'s lines are not drawn').toEqual([0, 0, 0]);
        const cards = await row(page);
        expect(cards.mode).toBe('rest');
        expect(shownCards(cards), 'each card reads "Ref = this shot", with no difference')
            .toEqual(drawn(restCards({ view: 'reference', shot: shotNumbers(firstShot), reference: shotNumbers(firstShot), isReference: true })));
        expect(sides(cards)).toEqual(Array(5).fill('Ref = this shot'));
        expect(references(fake), 'the choice is kept in Decaid\'s store, as recipe to Shot').toEqual({ [recipeId]: first });
        expect(writes(cafe.since(mark)), 'the one write: the choice').toEqual([
            { write: `POST /api/v1/store/${CAFE}/references`, body: { [recipeId]: first } },
        ]);
        await cafe.screenshot('graph-shot-is-reference-light');
    });

    test('a second shot is drawn with the reference faded behind it, its axis the reference\'s, its frames appended, and its live cards beside the reference or the targets', async ({ cafe, fake }) => {
        const { id: first } = seedReference(fake);
        const latestId = seedLatest(fake);
        const page = await openLoaded(cafe);
        const reference = fake.shots.get(first);
        const curves = shotCurves(reference.measurements);
        await expect.poll(async () => { const now = await legend(page); return [now.when, now.reference, now.badge]; }, 'a newer Shot is the latest, against the reference')
            .toEqual([await creditOf(page, fake.shots.get(latestId)), await creditOf(page, reference), null]);
        const latestCurves = shotCurves(fake.shots.get(latestId).measurements);
        expect([latestCurves.seconds, latestCurves.pressure.x.length], 'which differs from the reference').not.toEqual([curves.seconds, curves.pressure.x.length]);

        await pourTo(cafe, MID_MS);
        await expect(page.locator('#main-page.cafe-shot-live')).toBeAttached();
        const now = await legend(page);
        expect(now.label, 'the row reads "Live shot"').toBe('Live shot');
        expect(now.when).toBeNull();
        expect(now.reference, 'the reference has its own row').toBe(await creditOf(page, reference));
        expect(now.make, 'nothing can be chosen').toBeNull();
        expect(now.badge).toBeNull();
        const marks = await remarks(page);
        expect({ stars: marks.stars, note: marks.note }, 'a running shot has no stars and no note icon').toEqual({ stars: null, note: null });

        let lines = await chartLines(page);
        expect(lines.names.length).toBe(10);
        expect(lines.names.slice(7)).toEqual(REFERENCE_LINES);
        expect(lines.points.slice(7), 'the whole reference is drawn behind the live shot').toEqual([curves.pressure.x.length, curves.flow.x.length, curves.weight.x.length]);
        const sofar = frameAt(MID_MS, fake.workflow());
        expect(lines.points[0], 'the live shot\'s own frames so far').toBe(POUR.frames.filter(entry => entry.ms <= MID_MS && inShot(entry)).length);
        // Every pour is the recorded one, so the second shot can't run longer
        // than a first one poured here. The reference is the sample Shot
        // instead, which ran longer, and the axis is checked while the shot is
        // well short of its end: there it is the reference's length (on the
        // main graph, the length it has at rest), not the shot's own.
        expect(lines.referenceEnd, 'the reference\'s lines run to its end').toBe(curves.seconds);
        expect(sofar.seconds, 'the shot has not reached the reference\'s end').toBeLessThan(curves.seconds - 5);
        expect(lines.end, 'the time axis shows the whole reference from the start, at its length as at rest').toBe(curves.seconds);
        expect(lines.labelled, 'during a shot its own four lines are named, and no target or reference line (issue #66)').toEqual(OWN_LABELLED);

        let cards = await row(page);
        expect(cards.mode).toBe('live');
        expect(keys(cards)).toBe(LIVE);
        expect(shownCards(cards), 'live, in Reference: Time says how long the reference ran, and each card sits beside the reference at the same second, with the difference')
            .toEqual(liveExpected(fake, MID_MS, 'reference', reference));
        expect(cards.cards[0].side).toBe(`Ref ran ${shotNumbers(reference).time.toFixed(1)} s`);

        // Frames are appended: the chart is not drawn again in full for each,
        // but at a new stage, whose line the chart draws in full.
        await watchDraws(page);
        await pourTo(cafe, LATER_MS);
        const draws = await drawCounts(page);
        const framesPlayed = POUR.frames.filter(entry => entry.ms > MID_MS && entry.ms <= LATER_MS && inShot(entry)).length;
        const stagesReached = stagesBy(LATER_MS, fake.workflow()).length - stagesBy(MID_MS, fake.workflow()).length;
        expect(stagesReached, 'the pour reaches a new stage in between').toBe(1);
        expect(draws.appended, 'a live shot still draws by appending frames, with the reference behind it').toBeGreaterThanOrEqual(10);
        expect(draws.appended + draws.full, 'at most one draw a frame').toBeLessThanOrEqual(framesPlayed);
        expect(draws.full, 'drawn in full only for the new stage\'s line').toBe(stagesReached);
        await cafe.screenshot('graph-live-reference-light');

        await page.locator('#cafe-view button[data-view="targets"]').click();
        await cafe.settle();
        cards = await row(page);
        expect(cards.mode).toBe('live');
        expect(shownCards(cards), 'live, in Targets: Time names the stage, Weight the weight it stops at, weight flow "No profile target", and the rest their target or "No target this step"')
            .toEqual(liveExpected(fake, LATER_MS, 'targets', reference));
        expect(cards.cards[1].side).toBe(`Stops at ${target.yield.toFixed(1)} g`);
        expect(cards.cards[2].side).toBe('No profile target');
        const named = await stageNames(page);
        expect(named.some(Boolean), 'live, in Targets: the stage lines keep their names').toBe(true);
        await cafe.screenshot('graph-live-targets-light');

        await page.locator('#cafe-view button[data-view="reference"]').click();
        await cafe.settle();
        expect(shownCards(await row(page)), 'and back in Reference the live cards sit beside the reference again')
            .toEqual(liveExpected(fake, LATER_MS, 'reference', reference));

        await page.locator('#plotly-chart').click();
        await expect(page.locator('#main-page.chart-zoomed')).toBeAttached();
        await cafe.advance(500);
        await expect(page.locator('#expanded-chart')).toBeVisible();
        expect((await stageNames(page, 'expanded-chart')).every(name => name === null), 'the full-screen chart stays as it is: its stage lines carry no names').toBe(true);
        await expect(page.locator('#cafe-compare'), 'and the row is not on it').toBeHidden();
        const zoomed = await chartLines(page, 'expanded-chart');
        expect(zoomed.names.slice(-3), 'the full-screen chart draws the reference too, after its own lines').toEqual(REFERENCE_LINES);
        expect(zoomed.points.slice(-3)).toEqual([curves.pressure.x.length, curves.flow.x.length, curves.weight.x.length]);
        await cafe.screenshot('graph-live-full-screen-light');
        await page.locator('#expanded-chart').click();
        await expect(page.locator('#main-page:not(.chart-zoomed)')).toBeAttached();
        await cafe.pour();
    });

    test('at rest the new Shot is the latest, against the reference, which keeps its row and is drawn faded', async ({ cafe, fake }) => {
        const { page, first, second } = await pouredAgainstReference(cafe);
        const reference = fake.shots.get(first);
        const latest = fake.shots.get(second);
        expect(second).not.toBe(first);

        const now = await legend(page);
        expect(now.label, 'when the shot ends it becomes the latest, once Decaid has it').toBe('Latest');
        expect(now.when).toBe(await creditOf(page, latest));
        expect(now.reference, 'the reference keeps its row, with when it was pulled').toBe(await creditOf(page, reference));
        expect(now.make, 'and Make reference is back').toBe('Make reference');
        expect(now.badge).toBeNull();
        expect(now.flag).toBeNull();

        const lines = await chartLines(page);
        const curves = shotCurves(reference.measurements);
        expect(lines.points.slice(7), 'at rest the reference is drawn').toEqual([curves.pressure.x.length, curves.flow.x.length, curves.weight.x.length]);
        expect(lines.labelled, 'and the end labels name the Shot\'s own lines only').toEqual(OWN_LABELLED);
        expect(lines.referenceEnd).toBe(curves.seconds);
        expect(lines.end, 'the time axis fits the longer of the two Shots').toBeGreaterThanOrEqual(Math.max(lines.referenceEnd, shotCurves(latest.measurements).seconds));

        const cards = await row(page);
        expect(cards.mode).toBe('rest');
        expect(keys(cards)).toBe(REST_REFERENCE);
        // Both pours weigh, so the first drip is each Shot's own.
        expect(shownCards(cards), 'at rest, in Reference: each card gives the Shot\'s value, the reference\'s beside it and the difference')
            .toEqual(drawn(restCards({ view: 'reference', shot: shotNumbers(latest), reference: shotNumbers(reference) })));
        expect(cards.cards[1], 'the first drip of each, and the difference').toEqual({
            key: 'firstDrip', title: 'FIRST DRIP', value: '6.9 s', side: 'Ref 6.5 s', diff: '+0.4 s',
        });

        await cafe.screenshot('graph-overlay-light');
        await paint(page, 'dark');
        await cafe.advance(500);
        await cafe.screenshot('graph-overlay-dark');
        await paint(page, 'light');
        await cafe.advance(500);
        await page.locator('#plotly-chart').click();
        await expect(page.locator('#main-page.chart-zoomed')).toBeAttached();
        await cafe.advance(500);
        await expect(page.locator('#expanded-chart')).toBeVisible();
        await cafe.screenshot('graph-overlay-full-screen-light');
        await page.locator('#expanded-chart').click();
        await expect(page.locator('#main-page:not(.chart-zoomed)')).toBeAttached();
    });

    test('Targets is Streamline\'s own chart at rest, and the view is kept in Decaid\'s store and after a reload', async ({ cafe, fake }) => {
        const { page, first, second, recipeId } = await pouredAgainstReference(cafe);
        const latest = fake.shots.get(second);

        await page.locator('#cafe-view button[data-view="targets"]').click();
        await cafe.settle();
        let now = await legend(page);
        expect(now.view).toBe('targets');
        expect(now.targets, 'in Targets: the "Profile target" legend').toBe('Profile target');
        expect(now.reference, 'no reference row').toBeNull();
        expect(now.badge).toBeNull();
        expect(now.line).toBeNull();
        expect(now.make, 'and Make reference stays').toBe('Make reference');
        const lines = await chartLines(page);
        expect(lines.names, 'in Targets the chart is Streamline\'s seven lines').toEqual(['Pressure', 'Flow', 'Target Pressure', 'Target Flow', '°C', 'Target °C', 'Weight']);
        expect(lines.points[2], 'with their targets').toBeGreaterThan(10);
        expect(storedView(fake), 'the view is kept in Decaid\'s store').toBe('targets');
        const cards = await row(page);
        expect(keys(cards)).toBe(REST_TARGETS);
        expect(shownCards(cards), 'at rest, in Targets: Time with first drip beside it, Dose, Yield and Ratio against what was set, and Peak pressure alone')
            .toEqual(drawn(restCards({ view: 'targets', shot: shotNumbers(latest) })));
        expect((await stageNames(page)).some(Boolean), 'in Targets the stage lines keep their names').toBe(true);
        await cafe.screenshot('graph-targets-light');

        await page.reload();
        await page.locator('#cafe-strip .cafe-card').first().waitFor();
        await cafe.settle();
        await cafe.advance(2000);
        await expect(page.locator('#cafe-make-reference')).toBeVisible();
        now = await legend(page);
        expect(now.view, 'after a reload the graph is still in Targets').toBe('targets');
        expect(references(fake), 'and the choice of reference is still there').toEqual({ [recipeId]: first });

        await page.locator('#cafe-view button[data-view="reference"]').click();
        await cafe.settle();
        now = await legend(page);
        expect(now.reference, 'back in Reference the reference is drawn again').toBe(await creditOf(page, fake.shots.get(first)));
        expect((await chartLines(page)).points[7]).toBe(shotCurves(fake.shots.get(first).measurements).pressure.x.length);
        expect(storedView(fake)).toBe('reference');
    });

    test('Make reference over a reference asks "Replace the reference?": Cancel keeps it, Replace takes the latest Shot', async ({ cafe, fake }) => {
        const { page, first, second, recipeId } = await pouredAgainstReference(cafe);

        await page.locator('#cafe-make-reference').click();
        await expect(page.locator('#cafe-reference-dialog[open]')).toBeVisible();
        await expect(page.locator('#cafe-reference-dialog-title')).toHaveText('Replace the reference?');
        await expect(page.locator('#cafe-reference-dialog-recipe'), 'naming the recipe').toHaveText(target.name);
        await expect(page.locator('#cafe-reference-dialog dd'), 'the new Shot and the one it replaces').toHaveText([
            await creditOf(page, fake.shots.get(second)), await creditOf(page, fake.shots.get(first)),
        ]);
        await cafe.screenshot('dialog-replace-reference-light');

        const mark = fake.log.length;
        await page.locator('#cafe-reference-dialog button', { hasText: 'Cancel' }).click();
        await expect(page.locator('#cafe-reference-dialog[open]')).toHaveCount(0);
        await cafe.advance(2000);
        expect(references(fake), 'Cancel leaves the reference as it was').toEqual({ [recipeId]: first });
        expect(writes(cafe.since(mark)), 'and writes nothing').toEqual([]);
        expect((await legend(page)).make).toBe('Make reference');

        await page.locator('#cafe-make-reference').click();
        await expect(page.locator('#cafe-reference-dialog[open]')).toBeVisible();
        await page.locator('#cafe-reference-dialog-replace').click();
        await expect(page.locator('#cafe-reference-badge')).toBeVisible();
        await cafe.settle();
        expect(references(fake), 'Replace makes the latest Shot the reference').toEqual({ [recipeId]: second });
        expect((await legend(page)).badge).toBe('This shot is the reference');
        expect(writes(cafe.since(mark)), 'in one write').toEqual([
            { write: `POST /api/v1/store/${CAFE}/references`, body: { [recipeId]: second } },
        ]);
    });
});
