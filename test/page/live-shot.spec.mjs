// A live shot and the graph at rest (docs/cafe/DESIGN.md, "When the graph goes
// live", "The live cards", "The latest Shot", "The comparison row"): during a
// shot the weight against its target, the status, the six live cards and the
// stage names; once Decaid has stored it, the Shot in the graph, its time in
// the legend, and the five cards under the graph with the Shot's own numbers.
//
// The pour is the one recorded from the pinned Decaid with the first sample
// recipe loaded (fake-decaid/recordings/pour.json), replayed with the page's
// clock moving with its frames. Its simulated scale weighs, so the row's first
// drip and yield are the Shot's own.

import { test, expect } from './support/test.mjs';
import { recording } from './support/adapter.mjs';
import { legend, row, keys, sides, stageNames, chartLines, load } from './support/page-reads.mjs';
import { RECIPES } from './support/sample-data.mjs';
import { shotNumbers } from '../../src/cafe/comparison.js';
import { shotStages } from '../../src/cafe/stage-names.js';

const [house] = RECIPES;
const LIVE = 'time weight weightFlow flow pressure temperature';
const REST_REFERENCE = 'time firstDrip yield ratio peak';
const POUR = recording('pour');
// The last of the pour's frames before the machine went back to idle.
const POUR_LENGTH_MS = POUR.idleAtMs - 1;

test.describe('a live shot and the graph at rest', { tag: '@shot' }, () => {
    test('during a shot: the weight against its target, the status, the six live cards and the stage names', async ({ cafe }) => {
        const page = await cafe.open();
        await load(cafe, house);
        await cafe.pour(7000);

        await expect(page.locator('#cafe-live')).toBeVisible();
        await expect(page.locator('#cafe-live-weight')).toHaveText(/^\d+\.\d \/ \d+(\.\d)? g$/);
        await expect(page.locator('#machine-status')).toHaveText(/\d+s/);
        const live = await row(page);
        expect(live.mode).toBe('live');
        expect(keys(live), 'six live cards take the row\'s place').toBe(LIVE);
        const values = live.cards.map(card => card.value);
        expect(values[0]).toMatch(/^\d+\.\d s$/);
        expect(values[3]).toMatch(/^\d+\.\d ml\/s$/);
        expect(values[4]).toMatch(/^\d+\.\d bar$/);
        expect(values[5]).toMatch(/^\d+\.\d °C$/);
        expect(sides(live), 'with no reference').toEqual(Array(6).fill('No reference'));
        expect(live.cards.map(card => card.diff), 'and no difference').toEqual(Array(6).fill(''));
        const named = await stageNames(page);
        expect(named.length, 'each stage reached has its line').toBeGreaterThan(0);
        expect(named.some(Boolean), 'named where there is room').toBe(true);
        await cafe.screenshot('page-shot-running-light');
    });

    test('once Decaid has stored it: the Shot in the graph, its time, and the five cards with its own numbers', async ({ cafe, fake }) => {
        const page = await cafe.open();
        await load(cafe, house);
        await cafe.pour(POUR_LENGTH_MS);
        const poured = await chartLines(page);
        const measured = poured.names.map((name, index) => [name, poured.points[index]]).filter(([name]) => !/^(Target|Reference) /.test(name));
        expect(measured.map(([name]) => name), 'the shot\'s measured lines').toEqual(['Pressure', 'Flow', '°C', 'Weight']);
        measured.forEach(([name, points]) => expect(points, `${name} is drawn`).toBeGreaterThan(0));
        await cafe.pour();
        await expect(page.locator('#machine-status')).toHaveText('Ready');
        await expect(page.locator('#cafe-live')).toBeHidden();

        // Until Decaid has stored it the graph keeps the shot's live lines, the
        // six cards stay, and the row names no time.
        // The pour's last frame may be drawn after the read above, so a line may
        // have a point more; none has fewer.
        const pointsOf = lines => Object.fromEntries(lines.names.map((name, index) => [name, lines.points[index]]));
        const ended = pointsOf(await chartLines(page));
        measured.forEach(([name, points]) => expect(ended[name], `${name} is kept when the pump stops`).toBeGreaterThanOrEqual(points));
        await cafe.untilStored();
        expect((await legend(page)).when, 'no time yet').toBeNull();
        expect(keys(await row(page)), 'the six live cards stay').toBe(LIVE);
        const waited = pointsOf(await chartLines(page));
        measured.forEach(([name]) => expect(waited[name], `${name} stays until the Shot is stored`).toBe(ended[name]));
        const id = await cafe.storeShot();
        await cafe.advance(4000);

        const now = await legend(page);
        expect(now.label).toBe('Latest');
        expect(now.when).toMatch(/^Today \d{2}:\d{2}/);
        const rest = await row(page);
        expect(rest.mode).toBe('rest');
        expect(keys(rest), 'the five cards return').toBe(REST_REFERENCE);
        expect(sides(rest), 'with no reference chosen').toEqual(Array(5).fill('No reference'));
        expect(rest.cards.map(card => card.diff), 'and no difference').toEqual(Array(5).fill(''));

        const shot = fake.shots.get(id);
        const numbers = shotNumbers(shot);
        const values = rest.cards.map(card => card.value);
        expect(values[0], 'the Shot\'s own time, its Preheat left out').toBe(`${numbers.time.toFixed(1)} s`);
        expect(values[1], 'its first drip').toBe(`${numbers.firstDrip.toFixed(1)} s`);
        expect(values[2], 'its yield').toBe(`${numbers.yield.toFixed(1)} g`);
        expect(values[4], 'its peak pressure').toBe(`${numbers.peak.toFixed(1)} bar`);

        const named = await stageNames(page);
        const stages = shotStages(shot.measurements, shot.workflow);
        expect(named.length, 'a line for each stage the Shot reached').toBe(stages.length);
        named.forEach((name, index) => { if (name !== null) expect(name).toBe(stages[index].name.trim()); });
        expect(named.some(Boolean), 'named from the Shot\'s own profile where there is room').toBe(true);

        const boxes = await page.evaluate(() => {
            const box = id => document.getElementById(id).getBoundingClientRect();
            return { chartBottom: box('plotly-chart').bottom, chartHeight: box('plotly-chart').height, rowTop: box('cafe-compare').top, rowBottom: box('cafe-compare').bottom, page: window.innerHeight };
        });
        expect(rest.height, 'the row has its height').toBeGreaterThan(60);
        expect(boxes.rowTop - boxes.chartBottom, 'the row sits under the graph').toBeGreaterThanOrEqual(0);
        expect(boxes.rowTop - boxes.chartBottom).toBeLessThan(24);
        expect(boxes.rowBottom, 'inside the page').toBeLessThanOrEqual(boxes.page);
        expect(boxes.chartHeight, 'the graph keeps its height').toBeGreaterThanOrEqual(450);
        await cafe.screenshot('page-after-shot-light');
        await cafe.screenshot('graph-no-reference-light');
    });
});

// Decaid naming another shot id while a shot is open, with no end between
// (Streamline's `endLiveShot`, from v0.2.32): Streamline's chart ends the shot
// and starts another at the next frame of the profile, and the cafe graph,
// which follows only the machine's `espresso` state, stays live through it and
// shows the stored Shot at rest. The pour's shot-state frames from 12.8 s on
// name another id.
const SHOT_STATE = '/ws/v1/machine/shotState';
const SPLIT_MS = 12000;

test.describe('a new shot id while a shot is open', { tag: '@shot' }, () => {
    test('the chart starts again, the graph stays live, and the stored Shot is drawn at rest', async ({ cafe, fake }) => {
        let split = false;
        cafe.routes.interceptSocket(SHOT_STATE, send => cafe.fake.connect(SHOT_STATE, text => {
            const frame = JSON.parse(text);
            send(JSON.stringify(split && frame.shotId ? { ...frame, shotId: 'another-shot' } : frame));
        }));
        const page = await cafe.open();
        const pressurePoints = async () => {
            const lines = await chartLines(page);
            return lines.points[lines.names.indexOf('Pressure')];
        };
        const liveTime = async () => Number.parseFloat((await row(page)).cards[0].value);
        await load(cafe, house);
        await cafe.pour(SPLIT_MS);
        await expect.poll(pressurePoints).toBeGreaterThan(50);
        const before = await pressurePoints();
        await expect.poll(liveTime).toBeGreaterThan(10);

        split = true;
        await cafe.pour(16000);
        await expect.poll(liveTime, 'the Time card starts again with the new shot').toBeLessThan(5);
        const after = await pressurePoints();
        expect(after, 'the chart starts again').toBeLessThan(before);
        expect(after, 'and draws the new shot').toBeGreaterThan(0);
        await expect(page.locator('#cafe-live')).toBeVisible();
        expect((await legend(page)).label).toBe('Live shot');
        const live = await row(page);
        expect(live.mode).toBe('live');
        expect(keys(live)).toBe(LIVE);

        await cafe.pour();
        await cafe.untilStored();
        const id = await cafe.storeShot();
        await cafe.advance(4000);
        expect((await legend(page)).label, 'the stored Shot, found as a shot that poured').toBe('Latest');
        const rest = await row(page);
        expect(rest.mode).toBe('rest');
        expect(rest.cards[0].value, 'with its own time').toBe(`${shotNumbers(fake.shots.get(id)).time.toFixed(1)} s`);
    });
});
