// The reference at its edges (docs/cafe/DESIGN.md, "Shots and the reference",
// "The comparison row"; once the end of step 8 of the smoke run): an Unfinished
// Shot that does not take the latest Shot's place; a recipe with no Shot on
// this machine, whose reference is drawn alone and flagged "Different
// profile", with "—" and the reference's numbers on the cards, its stage
// names, and "No shot yet" in Targets; a choice that names a Shot the tablet
// no longer has, read after a reload as no reference; loading another recipe,
// which changes the graph to its latest Shot and reference; and the row with
// every number in it, a weighed Shot against a weighed reference.
//
// A pour can't be stopped early in the fake, so the Unfinished Shot is added
// with `fake.shots.add`: the stored pour cut to its Preheat and its first two
// seconds of preinfusion, with nothing on the scale (`unfinishedParts`), which
// `isUnfinished` (src/cafe/shot-model.js) calls Unfinished. That Decaid lists
// Shots newest first and answers one it no longer has with a 404 is the fake's
// Shots (fake-decaid/shots.js, recordings/shots.json).
//
// The weighted row stands on the recorded pour (fake-decaid/recordings/
// pour.json), whose simulated scale weighs: its first drip, yield (34.6 g) and
// weight flow are the scale's own, and its weighed dose is the Workflow's dose,
// as the fake stores it. A real DE1Pro capture with a real scale is still owed
// (#60). Its reference is a sample-data Shot, weighed by the same simulated
// scale, so each difference has a size. Every expected number is worked out
// from the stored Shots through `shotNumbers` (src/cafe/comparison.js).

import { test, expect } from './support/test.mjs';
import { legend, row, keys, sides, stageNames, chartLines, paint, load, card, REFERENCE_LINES } from './support/page-reads.mjs';
import { recordOf, unfinishedParts } from './support/fake-reads.mjs';
import { localTime } from '../../fake-decaid/index.js';
import { RECIPES } from '../cafe-smoke/sample-data.mjs';
import { shotNumbers } from '../../src/cafe/comparison.js';
import { shotStages } from '../../src/cafe/stage-names.js';
import { isUnfinished } from '../../src/cafe/shot-model.js';

// The pour is recorded on the first recipe's profile (Default). The recipe with
// no Shot is one on another profile (Adaptive v3), as the smoke run chose.
const [house, single] = RECIPES;
const CAFE = 'streamlineCafe';
const REFERENCES = 'references';
const REST_REFERENCE = 'time firstDrip yield ratio peak';
const REST_TARGETS = 'time dose yield ratio peak';
const NO_SHOT_LINE = 'No shot with this recipe on this machine yet';
const MINUS = '−';

// ── Writing a number, as the barista reads it ────────────────────────────────

const PLACES = { seconds: [1, ' s'], grams: [1, ' g'], bar: [1, ' bar'], ratio: [2, ''] };
/** A number as a card writes it: "27.3 s", "1:1.92". */
function shown(value, kind) {
    const [places, unit] = PLACES[kind];
    return `${kind === 'ratio' ? '1:' : ''}${value.toFixed(places)}${unit}`;
}
/** The difference of two numbers as they are shown: "+0.2 g", "−1.4 g", "0.0 s". */
function signed(value, against, kind) {
    const [places, unit] = PLACES[kind];
    const gap = Number(value.toFixed(places)) - Number(against.toFixed(places));
    const size = Math.abs(gap).toFixed(places);
    return `${Number(size) === 0 ? '' : gap > 0 ? '+' : MINUS}${size}${unit}`;
}
const REST_KINDS = { time: 'seconds', firstDrip: 'seconds', yield: 'grams', ratio: 'ratio', peak: 'bar' };

// ── Test data ────────────────────────────────────────────────────────────────

const choose = (fake, choices) => fake.store.set(CAFE, REFERENCES, choices);
const choices = fake => fake.store.get(CAFE, REFERENCES);
/** A sample-data Shot: pulled on Default, weighed by the simulated scale, with no recipe. */
const sampleShot = fake => fake.shots.get(fake.shots.newest(1)[0].id);

/**
 * A Shot pulled with `recipeId` `minutesAgo` before the test's start: a copy of
 * a sample Shot under an id of its own.
 */
function shotWithRecipe(fake, start, recipeId, minutesAgo, id) {
    const sample = sampleShot(fake);
    const at = start - minutesAgo * 60_000;
    const shot = {
        ...sample,
        id,
        timestamp: localTime(at, fake.timeZone),
        createdAt: new Date(at).toISOString(),
        updatedAt: new Date(at).toISOString(),
        workflow: { ...sample.workflow, context: { ...sample.workflow.context, extras: { ...sample.workflow.context.extras, dye: { ...sample.workflow.context.extras.dye, recipeId } } } },
    };
    fake.shots.add(shot);
    return shot;
}

/**
 * What Decaid stores for a shot stopped two seconds into its profile: the
 * stored pour's Preheat and its first two seconds of preinfusion, nothing on
 * the scale, the machine never pouring. Newer than the pour, with its recipe.
 */
function unfinishedFrom(fake, stored, at) {
    const shot = {
        ...stored,
        id: '00000000-0000-4000-8000-0000000e0001',
        timestamp: localTime(at, fake.timeZone),
        createdAt: new Date(at).toISOString(),
        updatedAt: new Date(at).toISOString(),
        ...unfinishedParts(stored),
    };
    fake.shots.add(shot);
    return shot;
}

// ── On the page ──────────────────────────────────────────────────────────────

const view = async (cafe, which) => {
    await cafe.page.locator(`#cafe-view button[data-view="${which}"]`).click();
    await cafe.settle();
    await expect.poll(async () => (await legend(cafe.page)).view).toBe(which);
};

/** A pour with the recipe loaded, stored by Decaid, and the page's look for it done. */
async function pourAndStore(cafe) {
    await cafe.pour();
    await cafe.untilStored();
    const id = await cafe.storeShot();
    await cafe.advance(4000);
    await expect.poll(async () => (await legend(cafe.page)).label, 'the stored Shot is the latest').toBe('Latest');
    return cafe.fake.shots.get(id);
}

/** The page reloaded, as on the tablet, drawn with its sockets open. */
async function reload(cafe) {
    await cafe.page.reload();
    await cafe.page.locator('#cafe-strip .cafe-card').first().waitFor();
    await expect.poll(() => cafe.routes.sockets.has('/ws/v1/machine/snapshot') && cafe.routes.sockets.has('/ws/v1/machine/shotState')).toBe(true);
    await cafe.settle();
    await cafe.advance(2000);
}

test.describe('the reference at its edges', { tag: '@reference' }, () => {
    test('an Unfinished Shot does not become the latest: the graph keeps the Shot before it', async ({ cafe, fake }) => {
        const page = await cafe.open();
        await load(cafe, house);
        const latest = await pourAndStore(cafe);
        // The recipe's latest made its reference, as the smoke run had it here.
        await page.locator('#cafe-make-reference').click();
        await expect.poll(async () => (await legend(page)).badge, 'the latest is the reference').toBe('This shot is the reference');
        const before = await legend(page);

        const short = unfinishedFrom(fake, latest, fake.now() + 60_000);
        expect(isUnfinished(short), 'the Shot added is Unfinished by the page\'s own rule').toBe(true);
        expect(fake.shots.newest(1)[0].id, 'and is the newest Decaid lists').toBe(short.id);
        const mark = fake.log.length;
        // Shots have no push: the page looks again as it comes back into view.
        await page.evaluate(() => document.dispatchEvent(new Event('streamline:mainpagevisible')));
        await cafe.advance(3000);
        expect(cafe.since(mark, entry => entry.method === 'GET' && entry.path === `/api/v1/shots/${short.id}`).length, 'the page read the Unfinished Shot').toBeGreaterThan(0);
        const now = await legend(page);
        expect(now.label).toBe('Latest');
        expect(now.when, 'the legend still names the Shot before it').toBe(before.when);
        expect(now.badge).toBe(before.badge);
        expect(now.badge).toBe('This shot is the reference');
    });

    test('a recipe with no Shot yet: the reference drawn alone, "Different profile", its numbers, and "No shot yet" in Targets; a Shot gone; another recipe loaded', async ({ cafe, fake, start }) => {
        const singleId = String(recordOf(fake, single.name).id);
        const houseId = String(recordOf(fake, house.name).id);
        const reference = sampleShot(fake);
        expect(reference.workflow.profile.title, 'the reference is on another profile than the recipe').not.toBe(single.profile);
        // The recipe loaded after: its latest Shot, which is its reference.
        const houseLatest = shotWithRecipe(fake, start, houseId, 30, '00000000-0000-4000-8000-0000000e0002');
        // The page has no way to choose a reference for a recipe with no Shot:
        // the choice is written into Decaid's store, as the smoke run wrote it.
        choose(fake, { [houseId]: houseLatest.id, [singleId]: reference.id });

        const page = await cafe.open();
        await load(cafe, single);
        await expect(page.locator('#cafe-legend-line')).toHaveText(NO_SHOT_LINE);
        let now = await legend(page);
        expect(now.label, 'no Shot to name').toBeNull();
        expect(now.make, 'and no Make reference').toBeNull();
        expect(now.reference, 'the reference has its row').not.toBeNull();
        expect(now.flag).toBe('Different profile');
        const lines = await chartLines(page);
        expect(lines.names.slice(7)).toEqual(REFERENCE_LINES);
        expect(lines.points[0], 'no Shot of its own is drawn').toBe(0);
        expect(lines.points[7], 'the reference is').toBeGreaterThan(10);
        expect(Math.abs(lines.end - lines.referenceEnd), 'the time axis is the reference\'s length').toBeLessThan(0.01);

        const numbers = shotNumbers(reference);
        let cards = await row(page);
        expect(keys(cards)).toBe(REST_REFERENCE);
        expect(cards.cards.map(entry => entry.value), 'no value of its own').toEqual(Array(5).fill('—'));
        expect(cards.cards.map(entry => entry.diff), 'and no difference').toEqual(Array(5).fill(''));
        expect(sides(cards), 'the reference\'s numbers beside each').toEqual(cards.cards.map(entry => `Ref ${shown(numbers[entry.key], REST_KINDS[entry.key])}`));

        const named = await stageNames(page);
        const stages = shotStages(reference.measurements, reference.workflow);
        expect(named.length, 'a line for each of the reference\'s stages').toBe(stages.length);
        named.forEach((name, index) => { if (name !== null) expect(name).toBe(stages[index].name.trim()); });
        expect(named.some(Boolean), 'named where there is room').toBe(true);
        await cafe.screenshot('graph-no-shot-yet-light');

        await view(cafe, 'targets');
        cards = await row(page);
        expect(keys(cards)).toBe(REST_TARGETS);
        expect(cards.cards.map(entry => entry.value)).toEqual(Array(5).fill('—'));
        expect(sides(cards), 'in Targets each card reads "No shot yet"').toEqual(Array(5).fill('No shot yet'));
        await cafe.screenshot('graph-no-shot-yet-targets-light');
        await view(cafe, 'reference');

        // A choice that names a Shot the tablet no longer has, read on a reload.
        choose(fake, { ...choices(fake), [singleId]: 'a-shot-that-is-gone' });
        const mark = fake.log.length;
        await reload(cafe);
        await expect(page.locator('#cafe-title')).toHaveText(single.name);
        await expect(page.locator('#cafe-legend-line')).toHaveText(NO_SHOT_LINE);
        expect(cafe.since(mark, entry => entry.path === '/api/v1/shots/a-shot-that-is-gone').length, 'the page asked for the Shot chosen').toBeGreaterThan(0);
        now = await legend(page);
        expect(now.reference, 'it reads as no reference').toBeNull();
        expect(now.badge).toBeNull();
        expect(now.flag).toBeNull();
        expect((await chartLines(page)).points[7], 'and none is drawn').toBe(0);

        // Loading another recipe changes the graph to its latest Shot and reference.
        choose(fake, { [houseId]: houseLatest.id, [singleId]: reference.id });
        await card(page, house.slot).click();
        await expect(page.locator('#cafe-title')).toHaveText(house.name);
        await cafe.advance(2000);
        await expect.poll(async () => (await legend(page)).badge).toBe('This shot is the reference');
        now = await legend(page);
        expect(now.label).toBe('Latest');
        expect(now.line).toBeNull();
    });

    test('the row with every number in it: first drip, yield and ratio beside the reference\'s with their differences, and in Targets against what was set', async ({ cafe, fake }) => {
        const houseId = String(recordOf(fake, house.name).id);
        const reference = sampleShot(fake);
        choose(fake, { [houseId]: reference.id });
        const page = await cafe.open();
        await load(cafe, house);
        const shot = await pourAndStore(cafe);
        await expect(page.locator('#cafe-make-reference'), 'the latest is not the reference').toBeVisible();

        const mine = shotNumbers(shot);
        const theirs = shotNumbers(reference);
        for (const key of ['time', 'firstDrip', 'yield', 'ratio', 'peak', 'dose']) {
            expect(mine[key], `the poured Shot has its ${key}`).not.toBeNull();
            expect(theirs[key], `the reference has its ${key}`).not.toBeNull();
        }
        let full = await row(page);
        expect(keys(full)).toBe(REST_REFERENCE);
        expect(full.cards.map(entry => entry.value), 'the Shot\'s own numbers').toEqual(full.cards.map(entry => shown(mine[entry.key], REST_KINDS[entry.key])));
        expect(sides(full), 'the reference\'s beside them').toEqual(full.cards.map(entry => `Ref ${shown(theirs[entry.key], REST_KINDS[entry.key])}`));
        expect(full.cards.map(entry => entry.diff), 'each with its difference').toEqual(full.cards.map(entry => signed(mine[entry.key], theirs[entry.key], REST_KINDS[entry.key])));
        expect(full.cards.map(entry => entry.diff).filter(diff => /^[+−]/.test(diff)).length, 'differences with a sign').toBeGreaterThan(0);
        expect(full.cards[3].title, 'the Ratio card names the dose it was worked from').toBe(`RATIO · ${shown(mine.dose, 'grams')} DOSE`);
        await cafe.screenshot('row-reference-light');
        await paint(page, 'dark');
        await cafe.settle();
        await cafe.screenshot('row-reference-dark');
        await paint(page, 'light');

        await view(cafe, 'targets');
        full = await row(page);
        expect(keys(full)).toBe(REST_TARGETS);
        const [time, dose, yielded, ratio, peak] = full.cards;
        expect(time).toMatchObject({ value: shown(mine.time, 'seconds'), side: `First drip ${shown(mine.firstDrip, 'seconds')}`, diff: '' });
        expect(dose).toMatchObject({ value: shown(mine.weighedDose, 'grams'), side: `Target ${shown(mine.targetDose, 'grams')}`, diff: signed(mine.weighedDose, mine.targetDose, 'grams') });
        expect(yielded).toMatchObject({ value: shown(mine.yield, 'grams'), side: `Target ${shown(mine.targetYield, 'grams')}`, diff: signed(mine.yield, mine.targetYield, 'grams') });
        expect(ratio).toMatchObject({ value: shown(mine.ratio, 'ratio'), side: `Target ${shown(mine.targetRatio, 'ratio')}`, diff: signed(mine.ratio, mine.targetRatio, 'ratio') });
        expect(peak).toMatchObject({ value: shown(mine.peak, 'bar'), side: '', diff: '' });
        await cafe.screenshot('row-targets-light');
    });
});
