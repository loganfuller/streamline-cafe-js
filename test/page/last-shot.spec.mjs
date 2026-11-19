// "Last shot": with no recipe loaded, two shots in one session (docs/cafe/
// DESIGN.md, "The latest Shot": "With no recipe loaded, the history module
// draws" and "The 'Last shot' row names the Shot the history module handed the
// chart"; "Rating and notes": "'Last shot', with no recipe loaded, is rated and
// noted too"; "The reference on the graph": "The legend"; once step 16 of the
// smoke run, its second part). The history arrows and the shot panel out of
// reach at rest and during each shot; each Shot drawn once Decaid has stored
// it, named "Last shot" with its time and barista and "Pick a recipe to
// compare"; empty stars and a plus; a star that rates the Shot drawn and not
// the one before; the note's dialog titled "Last shot" with the legend's time,
// and its note saved; the seam asked for the newest Shot only; the rating and
// note still shown after a reload. And the legend's day and time with the
// page's clock and zone pinned: "Today" on a twelve-hour clock (the page's
// locale is en-US, whose hours are twelve: src/cafe/text.js, `cafeDateLocale`;
// src/cafe/shot-model.js, `whenText`), and a Shot pulled before midnight and
// drawn after it, which reads with its date: the day is the Shot's against the
// page's clock when the legend is painted, and the legend is painted again as
// the local day turns, so a page left at rest past midnight reads yesterday's
// Shot, and a recipe's reference, with their dates (#80).
//
// The fake replays one pour, so the two shots are the same measurements (the
// smoke run pulled 10 s then 16 s, so each drawing told the two apart by its
// length). The second Shot is told from the first by what Decaid stamps on it:
// its time, a minute or more later, and its barista, which the legend names;
// and by its id, which the star's and the note's writes name. That Decaid
// copies the Workflow, its barista included, into the Shot it stores is the
// recorded pour (fake-decaid/recordings/pour.json); the Shot list's newest
// first and a Shot's edit are Decaid's (fake-decaid/shots.js).

import { test, expect } from './support/test.mjs';
import { legend, chartLines, remarks, noteDialog, load } from './support/page-reads.mjs';
import { shotCurves, drawnShot } from '../../src/cafe/shot-model.js';
import { BARISTAS, RECIPES } from '../cafe-smoke/sample-data.mjs';
import { recordOf } from './support/fake-reads.mjs';
import { localTime } from '../../fake-decaid/index.js';

// A zone with no daylight saving, nine hours from Decaid's recorded UTC.
const ZONE = 'Asia/Tokyo';
const WORKFLOW = '/api/v1/workflow';
const NOTE = 'No recipe, and noted all the same.';
const PICK = 'Pick a recipe to compare';
const [house] = RECIPES;

/**
 * A Shot pulled with `recipeId` `minutesAgo` before the test's start: a copy of
 * the sample data's newest Shot under an id of its own.
 */
function shotWithRecipe(fake, start, recipeId, minutesAgo, id) {
    const sample = fake.shots.get(fake.shots.newest(1)[0].id);
    const at = start - minutesAgo * 60_000;
    const dye = { ...sample.workflow.context.extras.dye, recipeId };
    const shot = {
        ...sample,
        id,
        timestamp: localTime(at, fake.timeZone),
        createdAt: new Date(at).toISOString(),
        updatedAt: new Date(at).toISOString(),
        workflow: { ...sample.workflow, context: { ...sample.workflow.context, extras: { ...sample.workflow.context.extras, dye } } },
    };
    fake.shots.add(shot);
    return shot;
}

/** The history arrows and the shot panel, where a finger could reach them. */
const reachable = page => page.evaluate(() => [
    ...['history-prev-btn', 'history-next-btn', 'shot-history-info'].filter(id => document.getElementById(id)?.offsetParent != null),
    ...(document.getElementById('shot-history-panel') ? ['shot-history-panel'] : []),
]);

const star = (page, n) => page.locator('#cafe-stars .cafe-star').nth(n - 1).click();

/** The Workflow's barista set as another app sets it: through Decaid's API. */
function nameBarista(fake, name) {
    const answer = fake.request({ method: 'PUT', url: WORKFLOW, body: { context: { baristaName: name } } });
    expect(answer.status).toBe(200);
}

/**
 * The time the legend gives a Shot, worked out here from Decaid's local time
 * with no offset ("2026-11-18T14:03:07.1"): en-US on a twelve-hour clock, two
 * digits to the hour, "02:03 PM".
 */
function twelveHour(local) {
    const [hours, minutes] = local.slice(11, 16).split(':').map(Number);
    return `${String(hours % 12 || 12).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** The time of the Shot the history module hands the chart: its first sample's (shot-model.js, `drawnShot`). */
const drawnAt = shot => drawnShot(shot.measurements, shot.workflow).timestamp;

/** A whole pour, the Shot stored, and the clock moved on until the history module has drawn it. */
async function pullShot(cafe) {
    await cafe.pour();
    await cafe.untilStored();
    const id = await cafe.storeShot();
    const points = shotCurves(cafe.fake.shots.get(id).measurements).pressure.x.length;
    await cafe.advance(2000);
    await expect.poll(async () => (await chartLines(cafe.page))?.points[0], 'the graph draws the Shot once Decaid has stored it').toBe(points);
    return id;
}

test.describe('"Last shot": two shots with no recipe loaded', { tag: '@lastshot' }, () => {
    test.use({ timezoneId: ZONE, start: Date.parse('2026-11-18T05:00:00Z') }); // 14:00 in Tokyo

    test('each Shot is drawn once Decaid has stored it, named with its time and barista, rated and noted, and kept after a reload', async ({ cafe, fake }) => {
        const page = await cafe.open();
        const mark = fake.log.length;
        await expect(page.locator('#cafe-title')).toHaveText('No recipe selected');
        expect(await reachable(page), 'at rest: the history arrows and the shot panel are out of reach').toEqual([]);

        let before = fake.shots.newest(1)[0].id;
        const shown = [];
        for (const [n, barista] of [[1, BARISTAS[0]], [2, BARISTAS[1]]]) {
            nameBarista(fake, barista);
            const ratingBefore = fake.shots.get(before).annotations?.enjoyment;

            await cafe.pour(7000);
            await expect(page.locator('#main-page.cafe-shot-live')).toBeAttached();
            expect(await reachable(page), `shot ${n}, during it: the history arrows and the shot panel are out of reach`).toEqual([]);

            const id = await pullShot(cafe);
            expect(id, `shot ${n} is a Shot of its own`).not.toBe(before);
            const shot = fake.shots.get(id);
            expect(shot.workflow.context.baristaName, 'Decaid stored the barista with it').toBe(barista);
            expect(drawnAt(shot).slice(0, 14), 'pulled in the afternoon of the test\'s day, in its zone').toBe('2026-11-18T14:');
            const now = await legend(page);
            const when = `Today ${twelveHour(drawnAt(shot))} · ${barista}`;
            expect(now.label).toBe('Last shot');
            expect(now.when, `shot ${n}: its time, on the twelve-hour clock, and its barista`).toBe(when);
            expect(now.line).toBe(PICK);
            expect(await reachable(page), `shot ${n}, drawn: still out of reach`).toEqual([]);
            shown.push(when);

            // The page learns the record of the Shot drawn from the tablet's newest.
            await expect.poll(() => remarks(page), `shot ${n}: empty stars and a plus once its record is known`).toEqual({ stars: [0, 0, 0, 0, 0], note: 'add', referenceRating: null, referenceNote: false });
            const edits = fake.log.length;
            await star(page, n + 2);
            await cafe.settle();
            await expect.poll(() => fake.shots.get(id).annotations.enjoyment, `shot ${n}: a tap rates the Shot drawn`).toBe((n + 2) * 2);
            expect(fake.shots.get(before).annotations?.enjoyment, 'and not the one before it').toBe(ratingBefore);
            expect(cafe.since(edits, entry => entry.method === 'PUT' && entry.path.startsWith('/api/v1/shots/')).map(entry => entry.path), 'one edit, of the Shot drawn').toEqual([`/api/v1/shots/${id}`]);

            if (n === 2) {
                await page.locator('#cafe-shot-note').click();
                const dialog = await noteDialog(page);
                expect(dialog?.title, 'the note\'s dialog names it "Last shot"').toBe('Last shot');
                expect(dialog.when, 'with the legend\'s time and barista').toBe(now.when);
                await page.locator('#cafe-note-text').fill(NOTE);
                await page.locator('#cafe-note-save').click();
                await expect(page.locator('#cafe-note-dialog:not([open])')).toBeAttached();
                await cafe.settle();
                expect(fake.shots.get(id).annotations.espressoNotes, 'the note is saved on the Shot drawn').toBe(NOTE);
                expect(fake.shots.get(before).annotations?.espressoNotes ?? null, 'and not on the one before').toBeNull();
                await expect.poll(async () => (await remarks(page)).note).toBe('note');
            }
            before = id;
            // A minute or more on, so the second Shot reads another time.
            if (n === 1) await cafe.advance(60_000, { step: 2000 });
        }
        expect(shown[1], 'the second Shot drawn is not the first').not.toBe(shown[0]);

        // The seam lists the newest Shots by limit alone; Streamline's own reads
        // name the page they want or the Shot by id. With no recipe the seam is
        // asked for the newest Shot only, for its rating and note, never for a
        // recipe's latest among the newest 100.
        const lists = cafe.since(mark, entry => entry.method === 'GET' && entry.path === '/api/v1/shots')
            .map(entry => new URLSearchParams(entry.search))
            .filter(query => !query.has('ids') && ['1', '100'].includes(query.get('limit')));
        expect(lists.length, 'the seam was asked for the newest Shot').toBeGreaterThan(0);
        expect(lists.map(query => query.get('limit')), 'for the newest only').toEqual(lists.map(() => '1'));
        await cafe.screenshot('page-no-recipe-after-two-shots-light');

        await page.reload();
        await page.locator('#cafe-strip .cafe-card').first().waitFor();
        await cafe.settle();
        await expect(page.locator('#cafe-title')).toHaveText('No recipe selected');
        await expect.poll(async () => (await legend(page)).when, 'after a reload: the second Shot is "Last shot"').toBe(shown[1]);
        await expect.poll(() => remarks(page), 'with the rating and the note it was given').toMatchObject({ stars: [100, 100, 100, 100, 0], note: 'note' });
    });
});

test.describe('"Last shot" across midnight', { tag: '@lastshot' }, () => {
    // 23:59 in Tokyo.
    const START = Date.parse('2026-11-18T14:59:00Z');
    test.use({ timezoneId: ZONE, start: START });

    test('a Shot pulled before midnight and drawn after it reads with its date, not "Today"', async ({ cafe, fake }) => {
        const page = await cafe.open();
        // The sample data's newest Shot, an hour before the test starts.
        expect((await legend(page)).when, 'before midnight, the newest Shot reads "Today", on the twelve-hour clock').toBe('Today 10:59 PM');
        nameBarista(fake, BARISTAS[0]);
        // The pour starts at 23:59:50, ten seconds before midnight, and Decaid
        // stores its Shot some 22 s later, after it.
        await cafe.advance(START + 50_000 - await page.evaluate(() => Date.now()), { step: 2000 });
        await cafe.pour();
        await cafe.untilStored();
        const id = await cafe.storeShot();
        const shot = fake.shots.get(id);
        expect(drawnAt(shot).slice(0, 16), 'the shot started before midnight').toBe('2026-11-18T23:59');
        expect(await page.evaluate(() => new Date().getDate()), 'and is drawn after it').toBe(19);
        const points = shotCurves(shot.measurements).pressure.x.length;
        await cafe.advance(2000);
        await expect.poll(async () => (await chartLines(page))?.points[0]).toBe(points);
        const now = await legend(page);
        expect(now.label).toBe('Last shot');
        expect(now.when, 'its day as a date in en-US, on the twelve-hour clock').toBe(`Nov 18 11:59 PM · ${BARISTAS[0]}`);
    });

    test('a Shot drawn before midnight reads with its date once the day turns, the page left at rest', async ({ cafe }) => {
        const page = await cafe.open();
        expect((await legend(page)).when).toBe('Today 10:59 PM');
        await cafe.advance(90_000, { step: 2000 });
        expect(await page.evaluate(() => new Date().getDate()), 'past midnight').toBe(19);
        await expect.poll(async () => (await legend(page)).when, 'painted again as the day turns, with nothing touched').toBe('Nov 18 10:59 PM');
    });

    // Chromium's timers on Android need not count the time a tablet sleeps, so
    // one set for midnight before a sleep can fire long after it. Here the page
    // opens at 23:00, and the clock is moved on to 23:59:50 with no timer
    // counting the time, as a sleep would: the timer set at 23:00 would fire
    // near 01:00, and the one set again as the page shows fires at midnight.
    test.describe('opened at 23:00', () => {
        test.use({ start: START - 59 * 60_000 });

        test('the midnight timer is set again as the page comes back into view, so a sleep before midnight leaves it on time', async ({ cafe }) => {
            const page = await cafe.open();
            expect((await legend(page)).when).toBe('Today 10:00 PM');
            await page.clock.setSystemTime(START + 50_000);
            // Read in the turn the page shows: the clock runs on by itself, so
            // a later read could fall past midnight.
            const shown = await page.evaluate(() => {
                document.dispatchEvent(new Event('visibilitychange'));
                return document.getElementById('cafe-shot-when').textContent;
            });
            expect(shown, 'back in view before midnight: "Today"').toBe('Today 10:00 PM');
            await cafe.advance(15_000, { step: 1000 });
            expect(await page.evaluate(() => new Date().getDate()), 'past midnight').toBe(19);
            expect(await page.evaluate(() => new Date().getMinutes()), 'within the first minute').toBe(0);
            // The timer fired within the advance, and writes as it fires.
            expect((await legend(page)).when, 'written as the day turns, not an hour late').toBe('Nov 18 10:00 PM');
        });
    });

    // Woken past midnight with the timer not yet fired: the page writes the
    // date as it comes into view, before any read of the Shots, which on a
    // tablet that wakes offline may fail and, with no recipe loaded, paint
    // nothing. Anything else may paint the legend after the clock moves, as a
    // read still on its way does on a slow runner, so the row is blanked and
    // read again in the turn the page shows: only the page showing writes it.
    test('a page that comes back into view past midnight writes the date at once, before reading anything', async ({ cafe, start }) => {
        const page = await cafe.open();
        expect((await legend(page)).when).toBe('Today 10:59 PM');
        await page.clock.setSystemTime(start + 2 * 60_000);
        const written = await page.evaluate(() => {
            const when = document.getElementById('cafe-shot-when');
            when.textContent = '';
            document.dispatchEvent(new Event('visibilitychange'));
            return when.textContent;
        });
        expect(written, 'past midnight, no timer fired, written in the turn the page shows').toBe('Nov 18 10:59 PM');
    });

    test('with a recipe loaded, its latest Shot and its reference both read with their dates once the day turns, the page left at rest', async ({ cafe, fake, start }) => {
        const houseId = String(recordOf(fake, house.name).id);
        // The reference is the sample data's newest Shot, at 22:59; the
        // recipe's latest a copy of it at 23:29, so the two rows are two Shots.
        const reference = fake.shots.get(fake.shots.newest(1)[0].id);
        shotWithRecipe(fake, start, houseId, 30, '00000000-0000-4000-8000-0000000e0080');
        fake.store.set('streamlineCafe', 'references', { [houseId]: reference.id });
        const page = await cafe.open();
        await load(cafe, house);
        let now = await legend(page);
        expect([now.label, now.when, now.reference], 'before midnight, both rows read "Today"').toEqual(['Latest', 'Today 11:29 PM', 'Today 10:59 PM']);
        await cafe.screenshot('legend-before-midnight-light');
        await cafe.advance(90_000, { step: 2000 });
        expect(await page.evaluate(() => new Date().getDate()), 'past midnight').toBe(19);
        await expect.poll(async () => {
            now = await legend(page);
            return [now.when, now.reference];
        }, 'both painted again as the day turns, with nothing touched').toEqual(['Nov 18 11:29 PM', 'Nov 18 10:59 PM']);
        await cafe.screenshot('legend-past-midnight-light');
    });
});
