// The line names during a shot (docs/cafe/DESIGN.md, "Line names during a
// shot", issue #66): on the main graph Pressure, Flow, °C and Weight are named
// at their lines' newest points from the profile's first sample, in Reference
// and Targets, with a recipe loaded and with none, at 1920 by 1200 and 1340 by
// 800, in English and in the language whose labels are widest; none during a
// Preheat, none on a target or the reference line; no label reaching past the
// chart; frames appended with no full draw; the labels where they were when the
// shot ends; and the four of them on the Shot Decaid stored once it is drawn in
// the shot's place.
//
// Every shot is the one recorded pour (fake-decaid/recordings/pour.json, 17.4 s
// of the Default profile after a half-second Preheat), played with the page's
// clock moving with its frames. The pour plays to its end, and the Preheat is
// held by the machine socket sending the pour's first Preheat frame, stamped
// with the page's time, for two seconds before the pour starts, so the recorded
// Preheat follows it and every frame's time still runs forward.
//
// The reference is shorter than the pour, so that in Reference the live axis
// grows past it and the labels need their room. The fake has one pour, so the
// reference is seeded before the page opens: the sample data's newest Shot, a
// pour of the same simulated machine, as Decaid would have stored it with the
// recipe loaded, cut eight seconds into its profile.
//
// The last check, the stored Shot drawn: on the real stack it is Decaid's own
// record, which can end a sample away from what the page drew live. Here the
// live frames and the stored Shot come from one recording, so it proves nothing
// about Decaid's record. What it still proves is the page's: that the live draw
// is swapped for the stored Shot's (the stars show), and that the stored Shot's
// draw names the same four lines, inside the chart. How far each label moved is
// kept as the test's annotation. Even from the same frames it is not nothing:
// the page's draw of a stored Shot ends at its last sample in the profile,
// which can be a frame before the last the live draw had, and its weight line
// earlier still, so Weight moves a few pixels to the left.

import { test, expect } from './support/test.mjs';
import { recording } from './support/adapter.mjs';
import { chartLines, load, watchDraws, drawCounts, stageNames, REFERENCE_LINES } from './support/page-reads.mjs';
import { recordOf, matchMachine } from './support/fake-reads.mjs';
import { RECIPES } from './support/sample-data.mjs';
import { localTime, shiftTime } from '../../fake-decaid/machine.js';
import { shotStages } from '../../src/cafe/stage-names.js';

const [house] = RECIPES;
const POUR = recording('pour');
const CAFE = 'streamlineCafe';
const SNAPSHOT = '/ws/v1/machine/snapshot';
// The last of the pour's frames before the machine went back to idle.
const POUR_LENGTH_MS = POUR.idleAtMs - 1;
// The pour's first frame, in its Preheat, and its first after the Preheat.
const PREHEAT_FRAME = POUR.frames.find(f => f.socket === 'machine/snapshot' && f.frame.state?.substate === 'preparingForShot').frame;
const PROFILE_START_MS = POUR.frames.find(f => f.socket === 'machine/snapshot' && f.frame.state?.state === 'espresso' && f.frame.state?.substate !== 'preparingForShot').ms;
const HELD_PREHEAT_MS = 2000;
// How long the seeded reference runs into its profile: shorter than the pour.
const REFERENCE_PROFILE_MS = 8000;
const OWN_LABELLED = 'Pressure,Flow,°C,Weight';
// How far a label may move in one frame.
const FRAME_TRAVEL_PX = 12;
// The stages the pour has reached by `ms`, as reference.spec.mjs counts them:
// the chart draws a new stage's line in full.
const stagesBy = (ms, workflow) => shotStages(POUR.frames.filter(entry => entry.ms <= ms && entry.socket === 'machine/snapshot').map(entry => ({ machine: entry.frame })), workflow);
const SIZES = [{ width: 1920, height: 1200 }, { width: 1340, height: 800 }];

test.describe.configure({ timeout: 60_000 });

// ── Setting up ───────────────────────────────────────────────────────────────

/**
 * The machine snapshot socket opened through the test, so it can send a frame
 * of its own besides the fake's. Answers the function that sends one.
 */
function machineSocket(cafe) {
    const sends = new Set();
    cafe.routes.interceptSocket(SNAPSHOT, send => {
        const handle = cafe.fake.connect(SNAPSHOT, send);
        sends.add(send);
        return { close: () => { sends.delete(send); handle?.close(); } };
    });
    return frame => { for (const send of sends) send(JSON.stringify(frame)); };
}

/**
 * The recipe's reference, chosen before the page opens: the sample data's
 * newest Shot, as Decaid would have stored it with the recipe loaded (its
 * Workflow the recipe's, naming it as Streamline's apply does) half an hour
 * earlier, cut `REFERENCE_PROFILE_MS` into its profile.
 */
function seedShortReference(fake) {
    const record = recordOf(fake, house.name);
    const sample = fake.shots.get(fake.shots.newest(1)[0].id);
    const earlier = text => shiftTime(text, -30 * 60_000, 'UTC');
    const at = Date.parse(sample.createdAt) - 30 * 60_000;
    const started = sample.measurements.find(m => m.machine.state.substate !== 'preparingForShot').machine.timestamp;
    const cut = Date.parse(started) + REFERENCE_PROFILE_MS;
    const context = record.workflow.context;
    const id = '00000000-0000-4000-8000-0000000c2801';
    fake.shots.add({
        ...sample,
        id,
        timestamp: earlier(sample.timestamp),
        createdAt: new Date(at).toISOString(),
        updatedAt: new Date(at).toISOString(),
        measurements: sample.measurements
            .filter(m => Date.parse(m.machine.timestamp) <= cut)
            .map(m => ({
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
    fake.store.set(CAFE, 'references', { [record.id]: id });
}

// ── What the chart shows ─────────────────────────────────────────────────────

/**
 * The labels the main chart's lines carry, as drawn: each label's line, text,
 * colour, where it points and its line's newest point, and how far its text
 * reaches to the right, against the chart's width.
 */
const lineLabels = page => page.evaluate(async () => {
    const { echarts } = await import('/src/modules/echarts-streamline.min.js');
    const element = document.getElementById('plotly-chart');
    const chart = echarts.getInstanceByDom(element);
    if (!chart) return null;
    // The renderer sets each live frame with ECharts' lazyUpdate: the option
    // holds the new frame at once, the axis it is drawn on only after the next
    // paint. Measure once the two agree, as the screen shows them.
    const drawnEnd = () => chart.getModel().getComponent('xAxis', 0).axis.scale.getExtent()[1];
    for (let tries = 0; tries < 20 && Math.abs(drawnEnd() - chart.getOption().xAxis[0].max) > 1e-9; tries += 1) {
        await new Promise(resolve => requestAnimationFrame(resolve));
    }
    const option = chart.getOption();
    const context = document.createElement('canvas').getContext('2d');
    const labels = option.series
        .map((series, seriesIndex) => ({ series, seriesIndex }))
        .filter(({ series }) => series && String(series.id).startsWith('trace-') && series.markPoint && series.markPoint.data?.length)
        .map(({ series, seriesIndex }) => {
            const label = series.markPoint.label;
            const coord = series.markPoint.data[0].coord;
            const at = chart.convertToPixel({ seriesIndex }, coord);
            context.font = `${label.fontSize}px ${label.fontFamily}`;
            const text = typeof label.formatter === 'function' ? label.formatter() : label.formatter;
            return {
                name: series.name, text, color: label.color, lineColor: series.lineStyle?.color, coord,
                newest: series.data.length ? series.data[series.data.length - 1] : null,
                x: at[0], y: at[1] + (label.offset?.[1] || 0),
                right: at[0] + (label.distance || 0) + context.measureText(text).width,
            };
        });
    return { labels, width: element.clientWidth, end: option.xAxis[0].max };
});

const names = sample => sample?.labels.map(l => l.name).join();

/** The four labels' text the page should show, in its language. */
const expectedTexts = page => page.evaluate(async () => {
    const { getTranslation } = await import('/src/modules/i18n.js');
    return ['Pressure', 'Flow', '°C', 'Weight'].map(key => (key === '°C' ? key : getTranslation(key)));
});

/**
 * The finished language whose labels are widest, measured as the chart draws
 * them, from Streamline's translation file and with nothing changed on the page.
 */
const widestLanguage = page => page.evaluate(async () => {
    const { SUPPORTED_LANGUAGES, parseTranslationColumn } = await import('/src/modules/i18n-parser.js');
    const csv = await (await fetch('src/ui/de1 gui translation - Sheet1.csv')).text();
    const context = document.createElement('canvas').getContext('2d');
    context.font = '16px Inter, sans-serif';
    const widthOf = texts => Math.max(...texts.map(text => context.measureText(text).width));
    let best = { code: 'en', width: widthOf(['Pressure', 'Flow', 'Weight']) };
    for (const code of SUPPORTED_LANGUAGES.filter(c => c !== 'en' && !c.includes('unfinished'))) {
        const { table, keyIndex } = parseTranslationColumn(csv, code);
        const translate = key => table[key] || table[keyIndex[key.toLowerCase()]] || key;
        const width = widthOf(['Pressure', 'Flow', 'Weight'].map(translate));
        if (width > best.width) best = { code, width };
    }
    return best;
});

// ── One shot watched ─────────────────────────────────────────────────────────

/**
 * Opens the page at `viewport` in `graphView`, with the recipe loaded against
 * its short reference or with none, in `language`; holds a Preheat, plays the
 * pour, has Decaid store it, and checks the labels at each step. `language`
 * 'widest' is the finished language whose labels are widest, found on the
 * page, and `{code}` in `screenshot` its code.
 */
async function watchShot({ cafe, fake, timezoneId }, { viewport, graphView, loaded, language = 'en', screenshot }) {
    const { page } = cafe;
    await page.setViewportSize(viewport);
    fake.store.set(CAFE, 'graphView', graphView);
    if (loaded) {
        seedShortReference(fake);
        matchMachine(fake, house.name);
    }
    const send = machineSocket(cafe);
    await cafe.open();
    if (loaded) await load(cafe, house);
    if (language === 'widest') {
        const widest = await widestLanguage(page);
        test.info().annotations.push({ type: 'widest', description: `${widest.code}, ${Math.round(widest.width)} px` });
        expect(widest.code, 'a finished language has labels wider than English').not.toBe('en');
        language = widest.code;
        screenshot = screenshot.replace('{code}', language);
    }
    if (language !== 'en') {
        await page.evaluate(async code => { const { setLanguage } = await import('/src/modules/i18n.js'); await setLanguage(code); }, language);
        await cafe.advance(1000);
    }
    const expected = await expectedTexts(page);
    if (language !== 'en') expect(expected.join(), 'the labels are translated').not.toBe('Pressure,Flow,°C,Weight');

    // The Preheat, held: the machine says espresso, preparing for the shot.
    await cafe.advance(HELD_PREHEAT_MS, { during: () => send({ ...PREHEAT_FRAME, timestamp: localTime(fake.now(), timezoneId ?? 'UTC') }) });
    await expect(page.locator('#main-page.cafe-shot-live'), 'the page took the Preheat for a shot').toBeAttached();
    const held = await chartLines(page);
    expect(held.labelled, 'none labelled during the held Preheat').toEqual([]);
    // The recorded Preheat follows it, to the profile's start.
    await cafe.pour(PROFILE_START_MS - 1);
    expect((await chartLines(page)).labelled, 'none labelled during the recorded Preheat').toEqual([]);

    // From the profile's start, a look as each quarter second is played.
    const samples = [];
    await cafe.pour(PROFILE_START_MS + 700);
    samples.push(await lineLabels(page));
    const namesBefore = await stageNames(page);
    await watchDraws(page);
    for (let i = 1; i <= 6; i += 1) {
        await cafe.pour(PROFILE_START_MS + 700 + i * 250);
        samples.push(await lineLabels(page));
    }
    const draws = await drawCounts(page);
    // A stage line's name is drawn once there is room for it, which depends on
    // the font's measure (Linux's fonts name one sooner than macOS's): that
    // changes the chart's layout, which is drawn in full too.
    const namesAfter = await stageNames(page);
    const namesShown = namesAfter.filter((name, index) => name !== null && name !== (namesBefore[index] ?? null)).length;
    const stagesReached = stagesBy(PROFILE_START_MS + 700 + 6 * 250, fake.workflow()).length - stagesBy(PROFILE_START_MS + 700, fake.workflow()).length;
    // The last frame before the stop, while the page is live.
    await cafe.pour(POUR_LENGTH_MS);
    await expect(page.locator('#main-page.cafe-shot-live'), 'the last look is taken during the shot').toBeAttached();
    const lastLive = await lineLabels(page);
    samples.push(lastLive);
    await cafe.screenshot(screenshot);
    // The lines that must go unlabelled are drawn: so "none labelled" says something.
    const drawn = await chartLines(page);
    if (graphView === 'reference') {
        expect(drawn.names.filter(n => REFERENCE_LINES.includes(n)).length, 'the reference is drawn behind the shot').toBeGreaterThan(0);
        expect(lastLive.end, 'the live axis has grown past the shorter reference').toBeGreaterThan(drawn.referenceEnd);
    } else {
        expect(drawn.names.filter(n => /^Target /.test(n)).length, 'the profile\'s targets are drawn').toBeGreaterThan(0);
    }

    samples.forEach((sample, index) => {
        expect(names(sample), `look ${index}: Pressure, Flow, °C and Weight named, and no target or reference line`).toBe(OWN_LABELLED);
        expect(sample.labels.map(l => l.text), `look ${index}: in the page's language`).toEqual(expected);
        for (const l of sample.labels) {
            expect(l.color, `look ${index}: ${l.name} in its line's colour`).toBe(l.lineColor);
            expect(l.coord, `look ${index}: ${l.name} at its line's newest point`).toEqual(l.newest.slice(0, 2));
            expect(l.right, `look ${index}: ${l.name} does not reach past the chart's right edge`).toBeLessThanOrEqual(sample.width);
        }
    });
    expect(samples.flatMap(s => s.labels.map(l => l.name)).filter(n => REFERENCE_LINES.includes(n) || /^Target /.test(n)), 'no target or reference line labelled').toEqual([]);
    const times = samples.map(sample => sample.labels[0].coord[0]);
    times.slice(1).forEach((t, i) => expect(t, `look ${i + 1} is no earlier than look ${i}`).toBeGreaterThanOrEqual(times[i]));
    expect(times.at(-1), 'they move with the shot').toBeGreaterThan(times[0]);
    expect(draws.appended, 'the frames were appended').toBeGreaterThan(0);
    expect(draws.full, 'a new stage\'s line is drawn in full').toBeGreaterThanOrEqual(stagesReached);
    expect(draws.full, 'the lines were not drawn again in full, but for a new stage\'s line or a stage name given room').toBeLessThanOrEqual(stagesReached + namesShown);

    // The shot's end, before Decaid has stored it: nothing has moved.
    await cafe.pour();
    await expect(page.locator('#main-page:not(.cafe-shot-live)'), 'the page left the shot when it stopped').toBeAttached();
    const ended = await lineLabels(page);
    expect(names(ended), 'the four labels stay when the shot ends').toBe(OWN_LABELLED);
    const moved = Math.max(...ended.labels.map((l, i) => Math.hypot(l.x - lastLive.labels[i].x, l.y - lastLive.labels[i].y)));
    expect(moved, 'when the shot ends the labels stay where they were (within a frame\'s travel)').toBeLessThanOrEqual(FRAME_TRAVEL_PX);

    // Once stored, the Shot as Decaid stored it is drawn in the shot's place.
    await cafe.untilStored();
    await cafe.storeShot();
    await cafe.advance(2000);
    await expect(page.locator('#cafe-stars'), 'the stored Shot is drawn in the shot\'s place').toBeVisible();
    const finished = await lineLabels(page);
    expect(names(finished), 'the stored Shot\'s labels name the same four lines').toBe(OWN_LABELLED);
    for (const l of finished.labels) expect(l.right, `${l.name} on the stored Shot does not reach past the chart`).toBeLessThanOrEqual(finished.width);
    const travel = finished.labels.map((l, i) => Math.round(Math.hypot(l.x - ended.labels[i].x, l.y - ended.labels[i].y)));
    test.info().annotations.push({ type: 'travel', description: `once the stored Shot is drawn each label moved ${JSON.stringify(travel)} px, the axis ${ended.end?.toFixed(2)} → ${finished.end?.toFixed(2)} s` });
}

// ── The tests ────────────────────────────────────────────────────────────────

test.describe('the line names during a shot', { tag: '@live-labels' }, () => {
    for (const viewport of SIZES) {
        const size = `${viewport.width}x${viewport.height}`;
        for (const graphView of ['reference', 'targets']) {
            test(`in ${graphView === 'reference' ? 'Reference' : 'Targets'} at ${size}, in English, with a recipe loaded`, async ({ cafe, fake, timezoneId }) => {
                await watchShot({ cafe, fake, timezoneId }, { viewport, graphView, loaded: true, screenshot: `live-labels-${graphView}-${size}-light-live` });
            });
        }
        test(`in Targets at ${size}, in the language whose labels are widest, with a recipe loaded`, async ({ cafe, fake, timezoneId }) => {
            await watchShot({ cafe, fake, timezoneId }, { viewport, graphView: 'targets', loaded: true, language: 'widest', screenshot: `live-labels-targets-${size}-{code}-light-live` });
        });
    }

    test('in Targets at 1920x1200, in English, with no recipe loaded', async ({ cafe, fake, timezoneId }) => {
        await watchShot({ cafe, fake, timezoneId }, { viewport: SIZES[0], graphView: 'targets', loaded: false, screenshot: 'live-labels-no-recipe-1920x1200-light-live' });
    });
});
