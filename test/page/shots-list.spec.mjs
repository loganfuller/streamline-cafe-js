// The Shots list (docs/cafe/DESIGN.md, "The Shots list"; once step 17 of the
// smoke run): the Shots button beside Settings and Sleep; the list headed
// "Shots" and no more, its columns, no Time or Machine column and no
// Unfinished mark; 50 rows under a header for each day, the Shot in the graph
// highlighted and a reference chipped; the next 50 as it is scrolled, none
// twice; a row's recipe, stars, "Not rated" and note icon; a Shot of the
// loaded recipe opened as "Viewing" and rated, and the list kept where it was
// left; a Shot of another recipe opened under its name and made that recipe's
// reference; a Shot with no recipe; "Back to latest", after which the list is
// read afresh; and a shot started with a Shot opened, drawn live by appending
// frames, with the latest in the graph once Decaid has stored it. And the
// day headers across local midnight, in a kept list and one read afresh.
//
// The list is the tablet's own (no Decent Sync plugin in Decaid's list), so
// it is Decaid's `GET /shots` read by offset (fake-decaid/shots.js,
// recordings/shots.json) and the choice of reference kept on the tablet
// (`streamlineCafe/references` in Decaid's store). The sixty Shots are the
// model's starting state, copies of a sample Shot made as the smoke run made
// its copies: recipe cycling none, the loaded recipe and another, barista
// cycling, every 25 minutes back from the evening before, rated and noted by
// index. The smoke run imported them through Decaid; here they are added to
// the fake before the page opens.
//
// "Today", "Yesterday", the date and the twelve-hour clock are the page's own
// (src/cafe/shot-list.js `dayOf`/`dayTitle`, the row's `toLocaleTimeString`
// in src/cafe/shots-dialog.js, `whenText` in src/cafe/shot-model.js), so the
// zone, the start and the locale are pinned here and the checks are exact.

import { test, expect } from './support/test.mjs';
import { legend, chartLines, shotsHeader, remarks, load, writes, watchDraws, drawCounts } from './support/page-reads.mjs';
import { recordOf } from './support/fake-reads.mjs';
import { localTime } from '../../fake-decaid/index.js';
import { shotCurves } from '../../src/cafe/shot-model.js';
import { RECIPES, BARISTAS } from '../cafe-smoke/sample-data.mjs';

// A zone behind UTC with daylight saving, out of it in November.
const ZONE = 'America/Los_Angeles';
// The smoke run's recipes: the loaded one, and another on the same profile.
const target = RECIPES[1];
const another = RECIPES[4];
const REFERENCES = ['streamlineCafe', 'references'];
const SHOTS = '/api/v1/shots';
const COLUMNS = 'Pulled|Recipe|Dose → yield|Rating|Barista|Note';
const NOTE = 'A note from the sample data.';

// ── Test data ────────────────────────────────────────────────────────────────

const LIST_SHOT = n => `00000000-0000-4000-8000-0000000c${String(n).padStart(4, '0')}`;
/** The loaded recipe's own latest Shot, pulled today: the Shot in the graph. */
const LATEST = '00000000-0000-4000-8000-0000000d0000';

/** The sample data's newest Shot, whole: the model each copy is made from. */
const model = fake => fake.shots.get(fake.shots.newest(1)[0].id);

/** A copy of the model, at `at`, with `recipeId` (or none), a barista, a rating and a note. */
function copyOf(fake, { id, at, recipeId, barista, enjoyment, note }) {
    const sample = model(fake);
    const context = { ...sample.workflow.context, extras: { ...(sample.workflow.context?.extras || {}) }, baristaName: barista };
    if (recipeId) context.extras.dye = { ...(context.extras.dye || {}), recipeId };
    else delete context.extras.dye;
    return {
        ...sample,
        id,
        timestamp: localTime(at, fake.timeZone),
        createdAt: new Date(at).toISOString(),
        updatedAt: new Date(at).toISOString(),
        workflow: { ...sample.workflow, context },
        annotations: { ...sample.annotations, enjoyment, espressoNotes: note },
        shotNotes: note,
    };
}

/**
 * Sixty Shots, from 18:00 the evening before `start` back, every 25 minutes:
 * of no recipe, of the loaded recipe and of another in turn, the two
 * baristas in turn, a rating and a note by index, as the smoke run gave them.
 */
function sixtyShots(fake, evening) {
    const targetId = String(recordOf(fake, target.name).id);
    const anotherId = String(recordOf(fake, another.name).id);
    for (let i = 0; i < 60; i += 1) {
        fake.shots.add(copyOf(fake, {
            id: LIST_SHOT(i),
            at: evening - i * 25 * 60_000,
            recipeId: [null, targetId, anotherId][i % 3],
            barista: BARISTAS[i % 2],
            enjoyment: i % 4 === 0 ? 0 : (i % 5) * 2 + 2,
            note: i % 6 === 0 ? NOTE : '',
        }));
    }
    return { targetId, anotherId };
}

// ── On the page ──────────────────────────────────────────────────────────────

/** Each row of the list, as the smoke run read them, with its time. */
const rows = page => page.evaluate(() => [...document.querySelectorAll('#cafe-shots-list .cafe-shots-row')].map(row => ({
    id: row.dataset.shotId,
    current: row.getAttribute('aria-current') === 'true',
    time: row.querySelector('.cafe-shots-time').textContent,
    name: row.querySelector('.cafe-shots-name').textContent,
    chip: !!row.querySelector('.cafe-shots-chip'),
    stars: [...row.querySelectorAll('.cafe-shots-star')].map(star => parseFloat(star.style.getPropertyValue('--cafe-star-fill'))),
    unrated: !!row.querySelector('.cafe-shots-rating .cafe-shots-muted'),
    note: !!row.querySelector('.cafe-shots-note svg'),
    barista: row.querySelector('.cafe-shots-barista').textContent,
})));
/** The day headers, in order. */
const days = page => page.locator('#cafe-shots-list .cafe-shots-day').allTextContents();
const dialog = page => page.locator('#cafe-shots-dialog');

/** The offsets of each first-page-sized read of Decaid's list since `mark`. */
const listReads = (cafe, mark = 0) => cafe.since(mark, entry => entry.method === 'GET' && entry.path === SHOTS)
    .map(entry => new URLSearchParams(entry.search))
    .filter(query => !query.has('ids') && query.get('limit') === '50')
    .map(query => Number(query.get('offset') || 0));

/** The Shots button tapped, and the list open with its rows drawn. */
async function openList(cafe) {
    await cafe.page.locator('#cafe-shots-btn').click();
    await expect(dialog(cafe.page)).toHaveAttribute('open', '');
    await cafe.settle();
    await expect(cafe.page.locator('#cafe-shots-list .cafe-shots-row').first()).toBeVisible();
}

/** A row tapped, and the Shot it opens in the graph under `label`. */
async function openRow(cafe, id, label) {
    await cafe.page.locator(`[data-shot-id="${id}"]`).click();
    await expect(cafe.page.locator('#cafe-shot-label')).toHaveText(label);
    await cafe.settle();
}

/** A star of the legend's row tapped, as the smoke run's `star`. */
const star = (page, n) => page.locator('#cafe-stars .cafe-star').nth(n - 1).click();

/** "Today 01:30 PM": a time Decaid wrote, `YYYY-MM-DDTHH:MM…`, on the twelve-hour clock en-US gives it. */
function clock12(timestamp) {
    const [hours, minutes] = timestamp.slice(11, 16).split(':').map(Number);
    return `${String(hours % 12 || 12).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

// ── The list, opened Shots, Back to latest and a shot ────────────────────────

// 2026-11-18 14:00 in Los Angeles (UTC−8): the sample data's two Shots were
// pulled at 13:00 today, the loaded recipe's latest at 13:30, and the sixty
// from 18:00 yesterday back to 17:25 the day before.
const START = Date.parse('2026-11-18T14:00:00-08:00');
const EVENING = Date.parse('2026-11-17T18:00:00-08:00');

test.describe('the Shots list', { tag: '@shots' }, () => {
    test.use({ timezoneId: ZONE, locale: 'en-US', start: START });

    /** The sixty Shots, the latest of the loaded recipe, references chosen for both recipes, and the recipe loaded. */
    async function openWithShots(cafe, fake) {
        const ids = sixtyShots(fake, EVENING);
        fake.shots.add(copyOf(fake, { id: LATEST, at: START - 30 * 60_000, recipeId: ids.targetId, barista: BARISTAS[0], enjoyment: 0, note: '' }));
        // The loaded recipe's reference and the other's, each one of their own
        // Shots on the first page, so the chip is seen and Replace asked.
        fake.store.set(...REFERENCES, { [ids.targetId]: LIST_SHOT(7), [ids.anotherId]: LIST_SHOT(8) });
        const page = await cafe.open();
        await load(cafe, target);
        await expect(page.locator('#cafe-shot-label')).toHaveText('Latest');
        await expect(page.locator('#cafe-shot-when')).toHaveText('Today 01:30 PM');
        return { page, ...ids };
    }

    test('the button, the first 50 rows by day, the highlight and the chip, the header, and the next 50 as it is scrolled', async ({ cafe, fake }) => {
        const { page, targetId } = await openWithShots(cafe, fake);

        const sizes = await page.evaluate(() => ['settings-btn', 'cafe-shots-btn', 'sleep-button'].map(id => {
            const box = document.getElementById(id).getBoundingClientRect();
            return { width: Math.round(box.width), height: Math.round(box.height), parent: document.getElementById(id).parentElement.id };
        }));
        expect(sizes.map(size => size.parent), 'the Shots button sits with Settings and Sleep').toEqual(['cafe-system', 'cafe-system', 'cafe-system']);
        expect(sizes.map(({ width, height }) => [width, height]), 'the same size').toEqual(Array(3).fill([sizes[0].width, sizes[0].height]));

        const mark = fake.log.length;
        await openList(cafe);
        let shown = await rows(page);
        expect(listReads(cafe, mark), 'the list reads 50 rows, from the newest').toEqual([0]);
        expect(shown, '50 rows').toHaveLength(50);
        const [newer, older] = fake.shots.newest(3).slice(1);
        expect(shown.slice(0, 5).map(row => row.id), 'the newest first').toEqual([LATEST, newer.id, older.id, LIST_SHOT(0), LIST_SHOT(1)]);
        expect(await days(page), 'under a header for each day').toEqual(['Today', 'Yesterday', 'Mon, Nov 16']);
        expect(shown.slice(0, 5).map(row => row.time), 'on the twelve-hour clock').toEqual(['01:30 PM', '01:00 PM', '12:59 PM', '06:00 PM', '05:35 PM']);
        // 18:00 less 25 minutes 43 times is 00:05 yesterday, and the 45th copy is the day before's 23:40.
        expect(await page.locator('#cafe-shots-list > *').evaluateAll(items => items.map(item => (item.classList.contains('cafe-shots-day') ? item.textContent : item.dataset.shotId))).then(items => items.slice(items.indexOf('Mon, Nov 16') - 1, items.indexOf('Mon, Nov 16') + 2)))
            .toEqual([LIST_SHOT(43), 'Mon, Nov 16', LIST_SHOT(44)]);
        expect(shown.filter(row => row.current).map(row => row.id), 'the Shot in the graph is highlighted').toEqual([LATEST]);
        expect(shown.filter(row => row.chip).map(row => row.id), 'each recipe\'s reference carries the chip, and no other row').toEqual([LIST_SHOT(7), LIST_SHOT(8)]);
        expect(fake.store.get(...REFERENCES)[targetId]).toBe(LIST_SHOT(7));

        expect(await shotsHeader(page), 'with no Decent Sync the list is headed "Shots" and no more: no line, no Machine column and no Time column')
            .toEqual({ title: 'Shots', under: null, line: null, columns: COLUMNS.split('|') });
        await expect(page.locator('#cafe-shots-list .cafe-shots-unfinished'), 'no row is marked Unfinished').toHaveCount(0);
        expect(await page.locator('#cafe-shots-list .cafe-shots-machine').evaluateAll(cells => cells.every(cell => getComputedStyle(cell).display === 'none')), 'or names a Machine').toBe(true);
        expect(await page.locator('#cafe-shots-list .cafe-shots-duration').evaluateAll(cells => cells.every(cell => getComputedStyle(cell).display === 'none')), 'or shows how long it ran').toBe(true);
        await cafe.screenshot('shots-list-light');

        // Scrolled near its end: the next 50, of which Decaid has 13 more.
        await page.locator('#cafe-shots-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
        await expect(page.locator('#cafe-shots-list .cafe-shots-row')).toHaveCount(63);
        await cafe.settle();
        shown = await rows(page);
        expect(listReads(cafe, mark), 'scrolling near the end reads the next 50').toEqual([0, 50]);
        expect(new Set(shown.map(row => row.id)).size, 'no Shot is listed twice').toBe(shown.length);
        expect(shown.slice(50).map(row => row.id)).toEqual(Array.from({ length: 13 }, (unused, k) => LIST_SHOT(47 + k)));
        expect(await days(page), 'no header twice: the next page carries on under the day it began in').toEqual(['Today', 'Yesterday', 'Mon, Nov 16']);
        expect(shown.at(-1).time, 'the last, the day before\'s 17:25').toBe('05:25 PM');

        const copy = n => shown.find(row => row.id === LIST_SHOT(n));
        expect([1, 2, 3].map(n => copy(n).name), 'a row names its recipe from DYE2\'s records, and a Shot with none as "No recipe"').toEqual([target.name, another.name, 'No recipe']);
        expect(copy(0), '"Not rated" and a note icon').toMatchObject({ unrated: true, stars: [], note: true, barista: BARISTAS[0] });
        expect(copy(1), 'its stars, two to a rating of 4, and no note').toMatchObject({ unrated: false, stars: [100, 100, 0, 0, 0], note: false, barista: BARISTAS[1] });
        expect(copy(2).stars, 'a rating of 6').toEqual([100, 100, 100, 0, 0]);
        expect(copy(6).note, 'a note where it has one').toBe(true);
        await page.locator('#cafe-shots-scroll').evaluate(element => { element.scrollTop = element.scrollHeight / 3; });
        await cafe.screenshot('shots-list-older-light');
    });

    test('a Shot of the loaded recipe, one of another made its reference, one with no recipe, and Back to latest', async ({ cafe, fake }) => {
        const { page, targetId, anotherId } = await openWithShots(cafe, fake);
        const latest = await legend(page);
        expect(latest.when).toBe(`Today 01:30 PM · ${BARISTAS[0]}`);
        const mark = fake.log.length;
        await openList(cafe);
        await page.locator('#cafe-shots-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
        await expect(page.locator('#cafe-shots-list .cafe-shots-row')).toHaveCount(63);
        await cafe.settle();
        // Scrolled back to the row tapped next, in the middle of the list's
        // window, so the tap itself scrolls nothing: where the list was left.
        await page.locator(`[data-shot-id="${LIST_SHOT(4)}"]`).evaluate(row => row.scrollIntoView({ block: 'center' }));
        const scrolledTo = await page.locator('#cafe-shots-scroll').evaluate(element => element.scrollTop);
        expect(scrolledTo, 'somewhere down the list').toBeGreaterThan(0);
        await expect.poll(() => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(document.getElementById('cafe-shots-scroll').scrollTop))))).toBe(scrolledTo);

        // A Shot of the loaded recipe: "Viewing", with "Back to latest".
        await openRow(cafe, LIST_SHOT(4), 'Viewing');
        await expect(dialog(page), 'the tap closes the list').not.toHaveAttribute('open', '');
        await expect(page.locator('#cafe-back')).toBeVisible();
        expect((await legend(page)).when, 'with its own time and barista').toBe(`Nov 17 04:20 PM · ${BARISTAS[0]}`);
        await expect(page.locator('#cafe-title'), 'the header stays on the loaded recipe').toHaveText(target.name);
        expect((await chartLines(page)).points[0], 'the opened Shot is in the graph with its own lines').toBe(shotCurves(fake.shots.get(LIST_SHOT(4)).measurements).pressure.x.length);
        await cafe.screenshot('shots-opened-viewing-light');
        await star(page, 3);
        await expect.poll(() => fake.shots.get(LIST_SHOT(4)).annotations.enjoyment, 'the opened Shot is rated').toBe(6);
        await cafe.settle();

        // The list keeps its place and shows the change.
        await openList(cafe);
        let shown = await rows(page);
        expect(listReads(cafe, mark), 'the list opens where it was left, without reading it again').toEqual([0, 50]);
        expect(shown).toHaveLength(63);
        expect(await page.locator('#cafe-shots-scroll').evaluate(element => element.scrollTop), 'scrolled where it was').toBe(scrolledTo);
        expect(shown.find(row => row.id === LIST_SHOT(4)).stars, 'with the rating in its row').toEqual([100, 100, 100, 0, 0]);
        expect(shown.filter(row => row.current).map(row => row.id), 'and the opened Shot highlighted').toEqual([LIST_SHOT(4)]);

        // A Shot of another recipe: labelled by its name, with that recipe's
        // reference; Make reference sets that recipe's, not the loaded one's.
        await openRow(cafe, LIST_SHOT(5), another.name);
        await expect(page.locator('#cafe-title'), 'while the header stays on the loaded recipe').toHaveText(target.name);
        expect((await legend(page)).reference, 'that recipe\'s reference behind it').toBe(`Nov 17 02:40 PM · ${BARISTAS[0]}`);
        await cafe.screenshot('shots-opened-other-recipe-light');
        await page.locator('#cafe-make-reference').click();
        await expect(page.locator('#cafe-reference-dialog'), 'that recipe has a reference, so Replace is asked').toHaveAttribute('open', '');
        await expect(page.locator('#cafe-reference-dialog-recipe'), 'naming that recipe').toHaveText(another.name);
        await page.locator('#cafe-reference-dialog-replace').click();
        // The badge's text is always in the page, hidden: it is shown once the choice is kept.
        await expect(page.locator('#cafe-reference-badge')).toBeVisible();
        await expect(page.locator('#cafe-reference-badge')).toHaveText('This shot is the reference');
        await cafe.settle();
        expect(fake.store.get(...REFERENCES), 'Make reference sets that recipe\'s reference and leaves the loaded recipe\'s').toEqual({ [targetId]: LIST_SHOT(7), [anotherId]: LIST_SHOT(5) });

        // A Shot with no recipe: no reference and no Make reference.
        await openList(cafe);
        shown = await rows(page);
        expect(shown.filter(row => row.chip).map(row => row.id), 'the kept list moves the chip to the Shot made a reference').toEqual([LIST_SHOT(5), LIST_SHOT(7)]);
        await openRow(cafe, LIST_SHOT(3), 'No recipe');
        expect(await legend(page), 'no reference and no Make reference').toMatchObject({ label: 'No recipe', make: null, reference: null, badge: null });

        // Back to latest.
        await page.locator('#cafe-back').click();
        await expect(page.locator('#cafe-shot-label')).toHaveText('Latest');
        await cafe.settle();
        expect(await legend(page), '"Back to latest" returns to the Shot that was there').toMatchObject({ label: 'Latest', when: latest.when });
        await expect(page.locator('#cafe-back')).toBeHidden();
        await openList(cafe);
        expect(listReads(cafe, mark), 'once back on the latest the list is read afresh').toEqual([0, 50, 0]);
        await expect(page.locator('#cafe-shots-list .cafe-shots-row')).toHaveCount(50);
        // The latest's own row is "Back to latest": it opens nothing.
        const reads = fake.log.length;
        await page.locator(`[data-shot-id="${LATEST}"]`).click();
        await cafe.advance(1000);
        expect(await legend(page), 'the latest\'s own row opens nothing').toMatchObject({ label: 'Latest', when: latest.when });
        await expect(page.locator('#cafe-back')).toBeHidden();
        expect(cafe.since(reads, entry => entry.path === `${SHOTS}/${LATEST}`), 'nor reads it').toEqual([]);
        expect(writes(cafe.since(mark)).filter(({ write }) => write.startsWith('PUT /api/v1/shots')), 'the one Shot edit is the rating').toEqual([{ write: `PUT ${SHOTS}/${LIST_SHOT(4)}`, body: { annotations: { enjoyment: 6 } } }]);
    });

    test('a shot started with a Shot opened draws live by appending frames, and the latest is in the graph once stored', async ({ cafe, fake }) => {
        const { page, targetId } = await openWithShots(cafe, fake);
        const latest = await legend(page);
        await openList(cafe);
        await openRow(cafe, LIST_SHOT(1), 'Viewing');
        await expect(page.locator('#cafe-back')).toBeVisible();

        await cafe.pour(3000);
        await expect(page.locator('#cafe-shot-label'), 'a shot that starts with a Shot opened draws live').toHaveText('Live shot');
        await expect(page.locator('#cafe-back'), 'and "Back to latest" goes').toBeHidden();
        await expect(page.locator('#cafe-shots-btn'), 'while a shot runs the Shots button takes no taps').toBeDisabled();
        await watchDraws(page);
        await cafe.pour(6000);
        const drawn = await drawCounts(page);
        // Over 3 s of the recorded pour (eleven appends on every run seen).
        // Streamline's renderer draws a live chart in full once when its axes
        // change (src/modules/echarts-renderer.js `renderChart`, the layout
        // signature), which falls in this window on some runs and not others,
        // as the page batches its frames on real time.
        expect(drawn.appended, 'a live shot still draws by appending frames').toBeGreaterThanOrEqual(10);
        expect(drawn.full, 'not by drawing the chart again').toBeLessThanOrEqual(1);

        await cafe.pour();
        await cafe.untilStored();
        const id = await cafe.storeShot();
        await cafe.advance(4000);
        const stored = fake.shots.get(id);
        expect(stored.workflow.context.extras.dye.recipeId, 'pulled with the loaded recipe').toBe(targetId);
        const now = await legend(page);
        expect(now.label, 'when it ends the latest is in the graph').toBe('Latest');
        expect(now.when, 'the Shot just pulled').toBe(`Today ${clock12(stored.timestamp)}`);
        expect(now.when).not.toBe(latest.when);
        await expect(page.locator('#cafe-shots-btn')).toBeEnabled();
        expect((await remarks(page)).stars, 'unrated').toEqual([0, 0, 0, 0, 0]);
    });
});

// ── Across midnight ──────────────────────────────────────────────────────────

// Ten minutes to midnight in Los Angeles: the sample data's Shots at 22:50 and a
// third at 23:45, all "Today" until the clock passes midnight.
const LATE = Date.parse('2026-11-18T23:50:00-08:00');
const LATE_SHOT = '00000000-0000-4000-8000-0000000e0000';

test.describe('the Shots list across midnight', { tag: '@shots' }, () => {
    test.use({ timezoneId: ZONE, locale: 'en-US', start: LATE });

    test('Shots from before midnight are "Today" until it passes, then "Yesterday", in the kept list and read afresh', async ({ cafe, fake }) => {
        fake.shots.add(copyOf(fake, { id: LATE_SHOT, at: LATE - 5 * 60_000, recipeId: null, barista: BARISTAS[1], enjoyment: 8, note: '' }));
        const page = await cafe.open();
        const mark = fake.log.length;
        await openList(cafe);
        expect(await days(page)).toEqual(['Today']);
        expect((await rows(page)).map(row => row.time)).toEqual(['11:45 PM', '10:50 PM', '10:49 PM']);

        // A Shot opened keeps the list; the clock passes midnight meanwhile.
        const [, sample] = fake.shots.newest(2);
        await openRow(cafe, sample.id, 'No recipe');
        await cafe.advance(15 * 60_000, { step: 30_000 });
        expect(await page.evaluate(() => new Date().toString()), 'past midnight where the tablet is').toMatch(/^Thu Nov 19 2026 00:0\d/);
        await openList(cafe);
        expect(listReads(cafe, mark), 'the kept list, not read again').toEqual([0]);
        expect(await days(page), 'heads the same Shots "Yesterday" now').toEqual(['Yesterday']);
        expect((await rows(page)).map(row => row.time), 'at the times they were').toEqual(['11:45 PM', '10:50 PM', '10:49 PM']);

        // Back to latest, and the list read afresh.
        await page.locator('#cafe-shots-dialog .cafe-btn-primary', { hasText: 'Close' }).click();
        await expect(dialog(page)).not.toHaveAttribute('open', '');
        await page.locator('#cafe-back').click();
        await expect(page.locator('#cafe-back')).toBeHidden();
        await cafe.settle();
        await openList(cafe);
        expect(listReads(cafe, mark), 'read afresh').toEqual([0, 0]);
        expect(await days(page)).toEqual(['Yesterday']);
    });
});
