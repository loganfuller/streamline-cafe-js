// The graph goes live at the Preheat, issue #64 (docs/cafe/DESIGN.md, "When
// the graph goes live", "The live cards"; once step 26 of the smoke run): with
// a recipe loaded whose latest Shot is drawn against its reference, the
// Preheat empties the graph of the latest's lines and stage names, on the main
// graph and the full-screen chart, in Reference leaving the reference behind
// it on the live axis and in Targets nothing, on an axis from zero to one
// second; the legend reads "Live shot" and the six live cards have no values
// but a time of zero. A shot stopped in the Preheat puts the latest back, and
// so it does with no recipe loaded, as "Last shot". A page reloaded during a
// Preheat is live. A real shot with a long Preheat draws nothing until the
// profile starts, then its first sample at time zero with the axis unmoved,
// frames appended; and a shot whose Preheat frames are left out goes live and
// draws as before.
//
// The recorded pour's Preheat is about half a second (its first five machine
// frames, to 0.47 s), too short to stop a shot in or reload a page during, so
// the page's machine snapshot socket goes through `machineFeed`, as the smoke
// run's went through its own: it can hold the pour's frames as a Preheat
// until it lets the profile start, leave out the Preheat's frames, or send
// the machine's frames at rest in a state of its own with no shot pulled.
//
// The recipe's two Shots, the reference and the latest, are seeded before the
// page opens, as reference.spec.mjs seeds them: the sample data's two Shots,
// other pours of the pinned stack's simulated machine, copied as pulled with
// the recipe loaded (the smoke run pulled two shots).

import { test, expect } from './support/test.mjs';
import { legend, row, keys, stageNames, chartLines, load, watchDraws, drawCounts, REFERENCE_LINES } from './support/page-reads.mjs';
import { recordOf, matchMachine } from './support/fake-reads.mjs';
import { RECIPES } from '../cafe-smoke/sample-data.mjs';
import { shiftTime } from '../../fake-decaid/machine.js';

// The recipe on the recorded pour's profile (Default).
const [house] = RECIPES;
const CAFE = 'streamlineCafe';
const SNAPSHOT = '/ws/v1/machine/snapshot';
const LIVE = 'time weight weightFlow flow pressure temperature';
const REST_REFERENCE = 'time firstDrip yield ratio peak';
// How long a held Preheat lasts, as the smoke run held it.
const HELD_MS = 2500;

// ── The machine's frames, as the page sees them ──────────────────────────────

/**
 * Stands between the page's machine snapshot socket and the fake's machine,
 * as the smoke run's `machineFeed()` did:
 * - `pass()`: the machine's frames as they come;
 * - `hold()`: the machine's frames, an `espresso` frame's substate given as
 *   `preparingForShot`, so the pour is a Preheat to the page until `pass()`,
 *   when the page sees the profile start;
 * - `drop()`: the machine's frames without its Preheat's, for a shot with none;
 * - `fake(state, substate)`: the machine's frames at rest (which `cafe.advance`
 *   has it send) in that state, so the page sees a Preheat, or its end, with no
 *   shot pulled.
 * A mode holds for every page the context opens, a reloaded one included.
 */
function machineFeed(cafe) {
    let mode = 'pass';
    cafe.routes.interceptSocket(SNAPSHOT, send => cafe.fake.connect(SNAPSHOT, text => {
        const frame = JSON.parse(text);
        if (typeof mode === 'object') {
            send(JSON.stringify({ ...frame, state: { ...mode }, flow: 0, pressure: 0, profileFrame: 0 }));
            return;
        }
        if (mode === 'drop' && frame.state?.substate === 'preparingForShot') return;
        if (mode === 'hold' && frame.state?.state === 'espresso') frame.state = { ...frame.state, substate: 'preparingForShot' };
        send(JSON.stringify(frame));
    }));
    return {
        pass() { mode = 'pass'; },
        hold() { mode = 'hold'; },
        drop() { mode = 'drop'; },
        fake(state, substate) { mode = { state, substate }; },
    };
}

// ── Setting up ───────────────────────────────────────────────────────────────

/** A copy of the sample Shot `sampleId` as `id`, pulled with the recipe loaded, `minutes` earlier. */
function seedRecipeShot(fake, sampleId, id, minutes) {
    const record = recordOf(fake, house.name);
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

/**
 * The recipe's two Shots: the first, made its reference, and the second, its
 * latest. The latest is the sample data's other Shot, so a page that drew the
 * reference in the latest's place would show other lines.
 */
function seedTwoShots(fake) {
    const [newest, other] = fake.shots.newest(2);
    const { id: referenceId, recipeId } = seedRecipeShot(fake, newest.id, '00000000-0000-4000-8000-0000000c0001', 30);
    const { id: latestId } = seedRecipeShot(fake, other.id, '00000000-0000-4000-8000-0000000c0003', 10);
    fake.store.set(CAFE, 'references', { [recipeId]: referenceId });
    return { referenceId, latestId };
}

/** The graph as it is now: the legend, the chart's lines, its stage names and the row under it. */
const graphNow = async page => ({ legend: await legend(page), lines: await ownLines(page), stages: await stageNames(page), row: await row(page) });

/** The two Shots seeded, the feed in place, the page open with the recipe loaded, and at rest. */
async function openAtRest(cafe) {
    seedTwoShots(cafe.fake);
    const feed = machineFeed(cafe);
    matchMachine(cafe.fake, house.name);
    const page = await cafe.open();
    await load(cafe, house);
    await expect.poll(async () => { const now = await legend(page); return [now.label, now.reference !== null, now.badge]; }, 'the latest, against the reference')
        .toEqual(['Latest', true, null]);
    const rest = await graphNow(page);
    return { page, feed, rest };
}

// ── What the chart holds ─────────────────────────────────────────────────────

/** The chart's own lines and the reference's, each as a count of points, with where its time axis ends. */
async function ownLines(page, id = 'plotly-chart') {
    const lines = await chartLines(page, id);
    const sum = test => lines.names.reduce((total, name, index) => total + (test(name) ? lines.points[index] : 0), 0);
    return {
        end: lines.end,
        own: sum(name => !REFERENCE_LINES.includes(name)),
        reference: sum(name => REFERENCE_LINES.includes(name)),
        referenceEnd: lines.referenceEnd,
        points: lines.points,
    };
}

/** The time of the first point of the chart's own line `name`, or null. */
const firstTime = (page, name) => page.evaluate(async lineName => {
    const { echarts } = await import('/src/modules/echarts-streamline.min.js');
    const chart = echarts.getInstanceByDom(document.getElementById('plotly-chart'));
    const line = chart?.getOption().series.find(series => series && String(series.id).startsWith('trace-') && series.name === lineName);
    return line && line.data.length ? line.data[0][0] : null;
}, name);

/** Where a chart's time axis starts and ends as drawn, fitted or not. */
const axisExtent = (page, id = 'plotly-chart') => page.evaluate(async chartId => {
    const { echarts } = await import('/src/modules/echarts-streamline.min.js');
    const chart = echarts.getInstanceByDom(document.getElementById(chartId));
    return chart ? chart.getModel().getComponent('xAxis', 0).axis.scale.getExtent() : null;
}, id);

// ── Doing things ─────────────────────────────────────────────────────────────

const pickView = async (cafe, view) => {
    await cafe.page.locator(`#cafe-view button[data-view="${view}"]`).click();
    await cafe.settle();
};

async function openFullScreen(cafe) {
    await cafe.page.locator('#plotly-chart').click();
    await expect(cafe.page.locator('#main-page.chart-zoomed')).toBeAttached();
    await cafe.advance(500);
    await expect(cafe.page.locator('#expanded-chart')).toBeVisible();
}

async function closeFullScreen(cafe) {
    await cafe.page.locator('#expanded-chart').click();
    await expect(cafe.page.locator('#main-page:not(.chart-zoomed)')).toBeAttached();
    await cafe.advance(500);
}

/** The machine in its Preheat, with no shot pulled, for 1.5 s of the page's clock. */
async function preheat(cafe, feed) {
    feed.fake('espresso', 'preparingForShot');
    await cafe.advance(1500);
    await expect(cafe.page.locator('#main-page.cafe-shot-live')).toBeAttached();
}

/** The shot stopped in its Preheat: the machine back at rest. */
async function stopInPreheat(cafe, feed) {
    feed.fake('idle', 'idle');
    await cafe.advance(1500);
    feed.pass();
    await cafe.advance(1500);
    await expect(cafe.page.locator('#main-page:not(.cafe-shot-live)')).toBeAttached();
}

/** The six live cards with no values but a time of zero. */
function expectEmptyLiveCards(shown, where) {
    expect(shown.mode, `${where}: the row is live`).toBe('live');
    expect(keys(shown), `${where}: the six live cards`).toBe(LIVE);
    expect(shown.cards.map(card => card.value), `${where}: no values but a time of zero`).toEqual(['0.0 s', '—', '—', '—', '—', '—']);
}

// ── The tests ────────────────────────────────────────────────────────────────

test.describe('the graph goes live at the Preheat', { tag: '@preheat' }, () => {
    test('the Preheat empties the graph: in Reference the reference stays on the live axis, on the full-screen chart too, and in Targets nothing, on an axis from zero to a second', async ({ cafe }) => {
        const { page, feed, rest } = await openAtRest(cafe);
        expect(rest.lines.own, 'at rest the latest is drawn').toBeGreaterThan(10);
        expect(rest.lines.reference, 'against the reference').toBeGreaterThan(10);
        expect(rest.stages.some(Boolean), 'with its stage names').toBe(true);
        expect(rest.row.mode).toBe('rest');
        expect(keys(rest.row), 'and the five cards').toBe(REST_REFERENCE);
        await cafe.screenshot('preheat-before-light');

        await preheat(cafe, feed);
        const now = await graphNow(page);
        expect(now.lines.own, 'in Reference: the latest\'s lines leave the graph').toBe(0);
        expect(now.lines.reference, 'and the reference stays behind it').toBeGreaterThan(10);
        expect(now.stages, 'the stage lines and their names leave with it').toEqual([]);
        expect(now.lines.end, 'the time axis is the live one, at the reference\'s length').toBeCloseTo(now.lines.referenceEnd, 1);
        expect(now.legend.label, 'the legend reads "Live shot"').toBe('Live shot');
        expect(now.legend.reference, 'with the reference\'s row').not.toBeNull();
        expect(now.legend.make, 'and nothing to choose').toBeNull();
        expectEmptyLiveCards(now.row, 'in Reference');
        expect(now.row.cards.map(card => card.diff), 'and no difference').toEqual(Array(6).fill(''));
        await cafe.screenshot('preheat-reference-light');

        await openFullScreen(cafe);
        const zoomed = await ownLines(page, 'expanded-chart');
        expect(zoomed.own, 'on the full-screen chart: nothing of the latest').toBe(0);
        expect(zoomed.reference, 'the reference behind').toBeGreaterThan(10);
        await cafe.screenshot('preheat-full-screen-light');
        await closeFullScreen(cafe);

        await pickView(cafe, 'targets');
        const targets = await graphNow(page);
        expect([targets.lines.own, targets.lines.reference, targets.stages], 'in Targets: nothing on the graph').toEqual([0, 0, []]);
        expect(await axisExtent(page), 'in Targets: the time axis starts at zero and runs a second').toEqual([0, 1]);
        expectEmptyLiveCards(targets.row, 'in Targets');
        await cafe.screenshot('preheat-targets-light');
    });

    test('a shot stopped in the Preheat puts the latest back, with its time, lines, stage names and five cards, and it stays', async ({ cafe }) => {
        const { page, feed, rest } = await openAtRest(cafe);
        await preheat(cafe, feed);
        expect((await ownLines(page)).own).toBe(0);
        await stopInPreheat(cafe, feed);

        const now = await graphNow(page);
        expect(now.legend.label, 'the latest is back').toBe('Latest');
        expect(now.legend.when, 'with its time').toBe(rest.legend.when);
        expect(now.lines.points, 'its lines and the reference\'s').toEqual(rest.lines.points);
        expect(now.lines.end, 'on its axis').toBeCloseTo(rest.lines.end, 2);
        expect(now.stages, 'its stage names').toEqual(rest.stages);
        expect(now.row, 'the five cards at rest, as before').toEqual(rest.row);

        // Still the latest after the page looks again.
        await cafe.advance(3000);
        const later = await graphNow(page);
        expect([later.legend.label, later.legend.when, later.lines.own], 'still the latest a moment later').toEqual(['Latest', rest.legend.when, rest.lines.own]);
    });

    for (const view of ['reference', 'targets']) {
        test(`with the full-screen chart open, in ${view === 'reference' ? 'Reference' : 'Targets'}, a Preheat empties it and its stop puts the latest back on it`, async ({ cafe }) => {
            const { page, feed } = await openAtRest(cafe);
            await pickView(cafe, view);
            await openFullScreen(cafe);
            const open = await ownLines(page, 'expanded-chart');
            expect(open.own, 'the latest is on it').toBeGreaterThan(10);

            await preheat(cafe, feed);
            const heating = await ownLines(page, 'expanded-chart');
            expect(heating.own, 'the latest\'s lines leave it').toBe(0);
            if (view === 'reference') expect(heating.reference, 'the reference stays').toBeGreaterThan(10);
            else expect(heating.reference, 'nothing of the reference').toBe(0);
            expect((await axisExtent(page, 'expanded-chart'))[0], 'the axis from zero').toBe(0);

            await stopInPreheat(cafe, feed);
            expect((await ownLines(page, 'expanded-chart')).points, 'its stop puts the latest back on it').toEqual(open.points);
            await closeFullScreen(cafe);
        });
    }

    test('a page reloaded during a Preheat is live, and its shot stopped there puts the latest back', async ({ cafe }) => {
        const { page, feed, rest } = await openAtRest(cafe);
        feed.fake('espresso', 'preparingForShot');
        await cafe.advance(500);
        const opened = cafe.routes.opened.length;
        await page.reload();
        await page.locator('#cafe-strip .cafe-card').first().waitFor();
        await expect.poll(() => cafe.routes.opened.slice(opened).includes(SNAPSHOT)).toBe(true);
        await cafe.settle();
        await cafe.advance(2000);
        await expect(page.locator('#cafe-title')).toHaveText(house.name);

        const now = await graphNow(page);
        expect(now.legend.label, 'live: "Live shot"').toBe('Live shot');
        expect(now.lines.own, 'nothing of the latest').toBe(0);
        expect(now.lines.reference, 'the reference behind').toBeGreaterThan(10);
        expectEmptyLiveCards(now.row, 'reloaded');
        await cafe.screenshot('preheat-reloaded-light');

        await stopInPreheat(cafe, feed);
        const back = await graphNow(page);
        expect([back.legend.label, back.legend.when, back.lines.own], 'its shot stopped in the Preheat puts the latest back').toEqual(['Latest', rest.legend.when, rest.lines.own]);
    });

    test('a shot with its Preheat held 2.5 s draws nothing until the profile starts, then its first sample at zero on the axis unmoved, appended, and is the latest once saved', async ({ cafe }) => {
        const { page, feed, rest } = await openAtRest(cafe);
        await preheat(cafe, feed);
        const preheatEnd = (await ownLines(page)).end;
        await stopInPreheat(cafe, feed);
        // Past Streamline's cooldown after a shot's end.
        await cafe.advance(5000);

        feed.hold();
        await cafe.pour(HELD_MS);
        await expect(page.locator('#main-page.cafe-shot-live')).toBeAttached();
        const held = await ownLines(page);
        expect(held.own, 'through the Preheat nothing is drawn').toBe(0);
        expect(held.end, 'the axis the live one').toBeCloseTo(preheatEnd, 1);

        await watchDraws(page);
        feed.pass();
        const ends = [];
        for (let at = HELD_MS + 250; at <= HELD_MS + 1500; at += 250) {
            await cafe.pour(at);
            ends.push((await ownLines(page)).end);
        }
        const draws = await drawCounts(page);
        expect((await ownLines(page)).own, 'the profile\'s start is drawn').toBeGreaterThan(0);
        const first = await firstTime(page, 'Pressure');
        expect(first, 'its first sample at time zero').toBeGreaterThanOrEqual(0);
        expect(first).toBeLessThan(0.5);
        ends.forEach(end => expect(end, 'the time axis stays where the Preheat had it').toBeCloseTo(preheatEnd, 1));
        expect((await legend(page)).label, 'still "Live shot"').toBe('Live shot');
        expect(draws.appended, 'the frames appended').toBeGreaterThan(0);

        await cafe.pour();
        await cafe.untilStored();
        await cafe.storeShot();
        await cafe.advance(4000);
        await expect.poll(async () => (await legend(page)).when, 'once saved it is the latest').not.toBe(rest.legend.when);
        expect((await legend(page)).label).toBe('Latest');
    });

    test('in Targets, through a held Preheat and the profile\'s start, the time axis starts at zero and its end only grows', async ({ cafe }) => {
        const { page, feed } = await openAtRest(cafe);
        await pickView(cafe, 'targets');
        feed.hold();
        await cafe.pour(HELD_MS);
        await expect(page.locator('#main-page.cafe-shot-live')).toBeAttached();
        expect((await ownLines(page)).own, 'through the Preheat nothing is drawn').toBe(0);
        const extents = [await axisExtent(page)];
        feed.pass();
        for (let at = HELD_MS + 100; at <= HELD_MS + 900; at += 100) {
            await cafe.pour(at, { step: 100 });
            extents.push(await axisExtent(page));
        }
        expect((await ownLines(page)).own, 'the profile\'s start is drawn').toBeGreaterThan(0);
        extents.forEach(extent => expect(extent[0], `the axis starts at zero: ${JSON.stringify(extents)}`).toBe(0));
        extents.forEach(extent => expect(extent[1], 'and runs at least a second').toBeGreaterThanOrEqual(1));
        extents.forEach((extent, i) => { if (i) expect(extent[1], `its end only grows: ${JSON.stringify(extents)}`).toBeGreaterThanOrEqual(extents[i - 1][1]); });
        await cafe.pour();
    });

    test('a shot whose Preheat frames are left out goes live and draws from time zero, as before', async ({ cafe }) => {
        const { page, feed } = await openAtRest(cafe);
        feed.drop();
        await cafe.pour(1800);
        expect((await legend(page)).label, 'it goes live').toBe('Live shot');
        expect((await ownLines(page)).own, 'and draws').toBeGreaterThan(0);
        const first = await firstTime(page, 'Pressure');
        expect(first, 'from time zero').toBeGreaterThanOrEqual(0);
        expect(first).toBeLessThan(0.5);
        expect((await row(page)).mode, 'the live cards').toBe('live');
        await cafe.pour();
    });
});

test.describe('the Preheat with no recipe loaded', { tag: '@preheat' }, () => {
    test('a Preheat and its stop leave "Last shot" as it was', async ({ cafe }) => {
        const feed = machineFeed(cafe);
        const page = await cafe.open();
        await expect.poll(async () => (await legend(page)).label).toBe('Last shot');
        const last = await graphNow(page);
        expect(last.lines.own, 'at rest: "Last shot" with its lines').toBeGreaterThan(10);

        await preheat(cafe, feed);
        const now = await graphNow(page);
        expect(now.legend.label, 'the Preheat: "Live shot"').toBe('Live shot');
        expect([now.lines.own, now.stages], 'nothing drawn').toEqual([0, []]);
        expectEmptyLiveCards(now.row, 'no recipe');
        await cafe.screenshot('preheat-no-recipe-light');

        await stopInPreheat(cafe, feed);
        const back = await graphNow(page);
        expect(back.legend.label, 'stopped in the Preheat: "Last shot" is back').toBe('Last shot');
        expect(back.legend.when, 'with its time').toBe(last.legend.when);
        expect(back.lines.points, 'its lines').toEqual(last.lines.points);
        expect(back.stages, 'its stage names').toEqual(last.stages);
        expect(back.row, 'and its cards').toEqual(last.row);
    });
});
