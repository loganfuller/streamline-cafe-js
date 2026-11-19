// The Location's Shots with Decent Sync serving (docs/cafe/DESIGN.md, "The
// Location's Shots", "Rating and notes" and "The reference with Decent Sync";
// the page's half of the second smoke run's step "10.", run-decent-sync.mjs,
// up to the server stopping): the list on this tablet, read through the
// plugin and headed with the Location's name, with the Machine and Time
// columns, the other Machine's rows among this one's, an Unfinished Shot
// marked, the Reference chip and the Shot in the graph highlighted; the same
// list at 1340 by 800; another Machine's Shot opened, read whole through the
// plugin, with its recipe's Reference Shot behind it and a legend naming who
// and never where; rated and noted through the plugin; the kept list showing
// the edits, and the list read afresh showing them; Make reference on it, and
// a reference chosen on the server followed while it is still opened; and the
// next page of the Location's list read by the plugin's cursor, past fifty
// Shots counted at the Location with `fake.decentSync.atLocation`.
//
// Decent Sync's plugin is the fake's (fake-decaid/decent-sync.js), serving the
// Machine at "Sample Cafe" from recordings/decent-sync.json. Its four Shots at
// the Location are labelled there: A and B this tablet's, C and D "Sample
// Machine Two"'s, D Unfinished. No Recipe has a Reference Shot at the start,
// so each test chooses A as House espresso's on the server before the page
// opens: the chip has a row, and C, of House espresso too, opens with a
// reference behind it.
//
// What stays in the real journey (#62): the second Machine stood up and its
// tablet pulling C and D, the Shots reaching the server, Decaid on this tablet
// holding neither, the server holding each edit and the reference, and the
// server writing an edit into the Shot on the tablet that holds it.
//
// The legend's "Today" is the page's own (`whenText` in
// src/cafe/shot-model.js), and C's time is the pulling tablet's local time,
// UTC on the recorded stack, read as this tablet's: the zone is pinned to UTC.

import { test, expect } from './support/test.mjs';
import { legend, chartLines, row, remarks, shotsHeader, paint, load, REFERENCE_LINES } from './support/page-reads.mjs';
import { recordOf } from './support/fake-reads.mjs';
import { recording } from './support/adapter.mjs';
import { RECIPES } from '../cafe-smoke/sample-data.mjs';
import { localTime } from '../../fake-decaid/index.js';

const [house] = RECIPES;
const { A, B, C, D } = recording('decent-sync').labels;
const PLUGIN = '/api/v1/plugins/decent-sync.reaplugin';
const LOCATION = 'Sample Cafe';
const MACHINE = 'Sample Machine';
const MACHINE_2 = 'Sample Machine Two';
const LOCATION_COLUMNS = ['Pulled', 'Machine', 'Recipe', 'Dose → yield', 'Time', 'Rating', 'Barista', 'Note'];
const NOTE = 'Pulled on the other machine.\nA touch fast.';
const BADGE = 'This shot is the reference';

// ── On the page ──────────────────────────────────────────────────────────────

const dialog = page => page.locator('#cafe-shots-dialog');

/** Each row of the list, as the smoke run read them. */
const listRows = page => page.evaluate(() => [...document.querySelectorAll('#cafe-shots-list .cafe-shots-row')].map(item => {
    // A cell shows where it has a box: the Machine's name sits in a cell the tablet's own list hides.
    const visible = selector => { const cell = item.querySelector(selector); return cell && cell.offsetParent !== null ? cell.textContent.trim() : null; };
    return {
        id: item.dataset.shotId,
        current: item.getAttribute('aria-current') === 'true',
        machine: visible('.cafe-shots-machine-name'),
        mine: !!item.querySelector('.cafe-shots-this'),
        name: item.querySelector('.cafe-shots-name').textContent,
        duration: visible('.cafe-shots-duration'),
        unfinished: !!item.querySelector('.cafe-shots-unfinished'),
        chip: !!item.querySelector('.cafe-shots-chip'),
        stars: [...item.querySelectorAll('.cafe-shots-star')].filter(star => parseFloat(star.style.getPropertyValue('--cafe-star-fill')) > 0).length,
        note: !!item.querySelector('.cafe-shots-note svg'),
    };
}));

/** The Shots button tapped, and the list open with its rows drawn. */
async function openList(cafe) {
    await cafe.page.locator('#cafe-shots-btn').click();
    await expect(dialog(cafe.page)).toHaveAttribute('open', '');
    await cafe.settle();
    await expect(cafe.page.locator('#cafe-shots-list .cafe-shots-row').first()).toBeVisible();
}

/** The list closed by its Close button. */
async function closeList(cafe) {
    await cafe.page.locator('#cafe-shots-dialog .cafe-shots-head .cafe-btn-primary').click();
    await expect(dialog(cafe.page)).not.toHaveAttribute('open', '');
    await cafe.settle();
}

/** A row tapped, and the Shot it opens in the graph under `label`. */
async function openRow(cafe, id, label) {
    await cafe.page.locator(`#cafe-shots-list .cafe-shots-row[data-shot-id="${id}"]`).click();
    await expect(cafe.page.locator('#cafe-shot-label')).toHaveText(label);
    await cafe.settle();
}

/**
 * The Shots dialog as drawn while it is open, measured as the smoke run's
 * `dialogDrawn` measured it (issue #39): the page's scale off Streamline's
 * canvas, the dialog's box, each part's width and height (the first match of
 * each selector), and what shows a sideways scrollbar. Sizes are screen px.
 */
const shotsDrawn = (page, parts) => page.evaluate(selectors => {
    const shots = document.getElementById('cafe-shots-dialog');
    if (!shots?.open) return null;
    const canvas = document.getElementById('scaled-content').getBoundingClientRect();
    const size = rect => [Math.round(rect.width * 10) / 10, Math.round(rect.height * 10) / 10];
    const box = shots.querySelector('.cafe-dialog').getBoundingClientRect();
    return {
        scaleX: canvas.width / 1920,
        scaleY: canvas.height / parseFloat(document.getElementById('scaled-content').style.height),
        box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
        parts: Object.fromEntries(selectors.map(selector => [selector, shots.querySelector(selector) ? size(shots.querySelector(selector).getBoundingClientRect()) : null])),
        sideways: [shots, ...shots.querySelectorAll('*')].filter(element => {
            const overflow = getComputedStyle(element).overflowX;
            return (overflow === 'auto' || overflow === 'scroll') && element.scrollWidth > element.clientWidth + 1;
        }).map(element => element.id || element.className || element.tagName),
    };
}, parts);

// ── In the log ───────────────────────────────────────────────────────────────

/** The page's reads of the plugin's list since `mark`, by their query. */
const pluginListReads = (cafe, mark) => cafe.since(mark, entry => entry.method === 'GET' && entry.path === `${PLUGIN}/shots`).map(entry => entry.search);
/** The page's reads of Decaid's own list of 50 since `mark`. */
const decaidListReads = (cafe, mark) => cafe.since(mark, entry => entry.method === 'GET' && entry.path === '/api/v1/shots' && new URLSearchParams(entry.search).get('limit') === '50');
/** Every edit of a Shot since `mark`, through the plugin or Decaid's own: "PUT path?query" and its body. */
const shotEdits = (cafe, mark) => cafe.since(mark, entry => entry.method === 'PUT' && (entry.path === `${PLUGIN}/shot` || entry.path.startsWith('/api/v1/shots')))
    .map(({ method, path, search, body }) => ({ edit: `${method} ${path}${search}`, body }));

// ── Test data ────────────────────────────────────────────────────────────────

/** House espresso's DYE2 record id, which the plugin's `reference?recipe=` takes. */
const houseRecord = fake => recordOf(fake, house.name).id;

/** A chosen on the server as House espresso's Reference Shot, the page opened and House espresso loaded, its latest (A) in the graph. */
async function openServed(cafe, fake) {
    fake.decentSync.chooseReference(houseRecord(fake), A);
    const page = await cafe.open();
    await load(cafe, house);
    await expect(page.locator('#cafe-shot-label')).toHaveText('Latest');
    await expect(page.locator('#cafe-dial-label')).toHaveText('Dial-in · saved to the recipe');
    return page;
}

test.describe('the Location\'s Shots with Decent Sync serving', { tag: '@sync-shots' }, () => {
    test.use({ decentSync: true, timezoneId: 'UTC' });

    test('the list: the Location\'s, through the plugin, with the Machine and Time columns, the other Machine\'s rows, Unfinished, the chip and the highlight', async ({ cafe, fake }) => {
        const page = await openServed(cafe, fake);
        const mark = fake.log.length;
        await openList(cafe);

        expect(await shotsHeader(page), 'headed with the Location\'s name, no line, and the Machine and Time columns added')
            .toEqual({ title: 'Shots', under: LOCATION, line: null, columns: LOCATION_COLUMNS });
        expect(pluginListReads(cafe, mark), 'read through the plugin, 50 rows a page, once').toEqual(['?limit=50']);
        expect(decaidListReads(cafe, mark), 'and Decaid\'s own list not asked').toEqual([]);

        const shown = await listRows(page);
        const rowOf = id => shown.find(item => item.id === id);
        expect(shown.map(item => item.id).sort(), 'the four Shots at the Location, this tablet\'s and the other Machine\'s').toEqual([A, B, C, D].sort());
        expect(rowOf(C), 'another Machine\'s Shot names its Machine, is not marked this one\'s, and names its recipe').toMatchObject({ machine: MACHINE_2, mine: false, name: house.name });
        expect(rowOf(D)).toMatchObject({ machine: MACHINE_2, mine: false });
        expect(rowOf(A), 'this tablet\'s own are marked').toMatchObject({ machine: MACHINE, mine: true, name: house.name });
        expect(rowOf(B)).toMatchObject({ machine: MACHINE, mine: true });
        for (const id of [A, B, C, D]) expect(rowOf(id).duration, `a row gives how long its Shot ran (${id})`).toMatch(/^\d+\.\d s$/);
        expect(rowOf(C), 'C ran whole').toMatchObject({ unfinished: false });
        expect(rowOf(D), 'an Unfinished Shot is marked in the rating\'s place, with no stars').toMatchObject({ unfinished: true, stars: 0 });
        expect(shown.filter(item => item.chip).map(item => item.id), 'the chip is on the Recipe\'s Reference Shot on the server, and no other row').toEqual([A]);
        expect(shown.filter(item => item.current).map(item => item.id), 'the row of the Shot in the graph is highlighted').toEqual([A]);

        await cafe.screenshot('sync-shots-location-light');
        await paint(page, 'dark');
        await cafe.screenshot('sync-shots-location-dark');
        await paint(page, 'light');
    });

    test('at 1340 by 800 the Location\'s list, with its Machine and Time columns, is scaled with the page, fits the window and scrolls nothing sideways', async ({ cafe, fake }) => {
        const page = await openServed(cafe, fake);
        await openList(cafe);
        const PARTS = ['.cafe-shots-columns', '.cafe-shots-row', '.cafe-shots-machine', '.cafe-shots-duration'];
        const wide = await shotsDrawn(page, PARTS);
        expect([wide.scaleX, wide.scaleY], 'at 1920 by 1200 the page\'s scale is 1').toEqual([1, 1]);

        await page.setViewportSize({ width: 1340, height: 800 });
        // The resize is handled on the next frame, and once more 250 ms on.
        await cafe.advance(500);
        await expect.poll(async () => Number(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--streamline-scale-x'))), 'the page\'s scale follows the window').toBeCloseTo(1340 / 1920, 6);
        await expect(dialog(page), 'the list stays open').toHaveAttribute('open', '');
        const narrow = await shotsDrawn(page, PARTS);

        const off = PARTS.flatMap(part => {
            const [at1920, now] = [wide.parts[part], narrow.parts[part]];
            if (!at1920 || !now) return [`${part}: missing`];
            // A part that isn't drawn measures 0 at both sizes, and proves nothing.
            if ([...at1920, ...now].includes(0)) return [`${part}: not drawn (${now.join(' × ')}, ${at1920.join(' × ')} at 1920)`];
            return now.flatMap((value, axis) => {
                const expected = at1920[axis] * (axis === 0 ? narrow.scaleX : narrow.scaleY);
                return Math.abs(value - expected) <= 1 ? [] : [`${part} ${axis === 0 ? 'width' : 'height'} ${value}, not ${Math.round(expected * 10) / 10}`];
            });
        });
        expect(off, `each part is its size at 1920 times the page's scale (${Math.round(narrow.scaleX * 1000) / 1000})`).toEqual([]);
        const { box } = narrow;
        expect(box.left >= 0 && box.top >= 0 && box.right <= 1340 && box.bottom <= 800, `the box fits the window (${JSON.stringify(box)})`).toBe(true);
        expect(narrow.sideways, 'nothing scrolls sideways').toEqual([]);
        await cafe.screenshot('sync-shots-location-1340x800-light');
    });

    test('another Machine\'s Shot opened, rated and noted through the plugin, and the list kept, then read afresh, showing it', async ({ cafe, fake }) => {
        const page = await openServed(cafe, fake);
        await openList(cafe);

        // Opened: asked of Decaid first, which doesn't hold it, then read whole
        // through the plugin, once.
        let mark = fake.log.length;
        await openRow(cafe, C, 'Viewing');
        await expect(page.locator('#cafe-back')).toBeVisible();
        const reads = cafe.since(mark, entry => entry.method === 'GET' && (entry.path === `/api/v1/shots/${C}` || entry.path === `${PLUGIN}/shot`))
            .map(entry => `${entry.path}${entry.search} ${entry.status}`);
        expect(reads, 'Decaid asked first and answering it holds no such Shot, then the plugin once, for the Shot whole').toEqual([`/api/v1/shots/${C} 404`, `${PLUGIN}/shot?id=${C} 200`]);

        const lines = await chartLines(page);
        const pointsOf = name => lines.points[lines.names.indexOf(name)] ?? 0;
        expect(lines.points[0], 'its own lines').toBeGreaterThan(5);
        for (const name of REFERENCE_LINES) expect(pointsOf(name), `its recipe's Reference Shot behind it: ${name}`).toBeGreaterThan(10);
        const cards = await row(page);
        expect(cards.mode, 'the comparison row, at rest').toBe('rest');
        expect(cards.cards).toHaveLength(5);
        expect(cards.cards[0].value, 'its time').toMatch(/^\d+\.\d s$/);
        expect(cards.cards[0].side, 'beside the reference\'s').toMatch(/^Ref /);

        const opened = await legend(page);
        expect(opened.when, 'the legend says when it was pulled and who pulled it').toMatch(/^Today \d{2}:\d{2}.* · Second Barista$/);
        expect(JSON.stringify(opened), 'and never where').not.toMatch(/Sample (Machine|Cafe)/);
        expect(opened.reference, 'the reference\'s row names its barista').toMatch(/ · Example Barista$/);
        expect(opened, 'Make reference, not muted, and no line').toMatchObject({ label: 'Viewing', make: 'Make reference', muted: false, notice: null, badge: null });
        expect(await remarks(page), 'empty stars and a plus for its note').toMatchObject({ stars: [0, 0, 0, 0, 0], note: 'add' });
        await cafe.screenshot('sync-other-machine-shot-light');

        // Rated, then noted: each one PUT to the plugin's `shot` with only the field edited.
        mark = fake.log.length;
        await page.locator('#cafe-stars .cafe-star').nth(3).click();
        await expect.poll(() => remarks(page).then(shown => shown.stars), 'a tap on the fourth star').toEqual([100, 100, 100, 100, 0]);
        await cafe.settle();
        await page.locator('#cafe-shot-note').click();
        await expect(page.locator('#cafe-note-dialog')).toHaveAttribute('open', '');
        await page.locator('#cafe-note-text').fill(NOTE);
        await page.locator('#cafe-note-save').click();
        await expect(page.locator('#cafe-note-dialog:not([open])')).toBeAttached();
        await cafe.settle();
        expect(await remarks(page), 'the stars stay, and the note icon shows a note').toMatchObject({ stars: [100, 100, 100, 100, 0], note: 'note' });
        expect(shotEdits(cafe, mark), 'one edit each, to the plugin, with only the field edited; Decaid\'s own Shot edit sent nothing').toEqual([
            { edit: `PUT ${PLUGIN}/shot?id=${C}`, body: { rating: 8 } },
            { edit: `PUT ${PLUGIN}/shot?id=${C}`, body: { note: NOTE } },
        ]);
        expect(fake.decentSync.others().find(other => other.shot.id === C).shot.annotations, 'the plugin took both').toMatchObject({ enjoyment: 8, espressoNotes: NOTE });
        await cafe.screenshot('sync-other-machine-rated-light');

        // The kept list: not read again, with the edits in the opened Shot's row.
        mark = fake.log.length;
        await openList(cafe);
        let rowOf = (await listRows(page)).find(item => item.id === C);
        expect(rowOf, 'the kept list shows the rating and the note, the row highlighted').toMatchObject({ stars: 4, note: true, current: true });
        expect(pluginListReads(cafe, mark), 'and was not read again').toEqual([]);

        // Back to latest, and the list read afresh shows them from the plugin.
        await closeList(cafe);
        await page.locator('#cafe-back').click();
        await expect(page.locator('#cafe-shot-label')).toHaveText('Latest');
        await cafe.settle();
        mark = fake.log.length;
        await openList(cafe);
        expect(pluginListReads(cafe, mark), 'read afresh, once').toEqual(['?limit=50']);
        rowOf = (await listRows(page)).find(item => item.id === C);
        expect(rowOf, 'showing the edits').toMatchObject({ stars: 4, note: true, current: false });
    });

    test('Make reference on another Machine\'s Shot, then a reference chosen on the server followed while it is still opened', async ({ cafe, fake }) => {
        const page = await openServed(cafe, fake);
        const recordId = houseRecord(fake);
        await openList(cafe);
        await openRow(cafe, C, 'Viewing');
        expect((await legend(page)).make).toBe('Make reference');

        const mark = fake.log.length;
        await page.locator('#cafe-make-reference').click();
        await expect(page.locator('#cafe-reference-dialog'), 'House espresso has a reference, so Replace is asked').toHaveAttribute('open', '');
        await page.locator('#cafe-reference-dialog-replace').click();
        // The badge's text is always in the page, hidden: it shows once the choice is made.
        await expect(page.locator('#cafe-reference-badge')).toBeVisible();
        await expect(page.locator('#cafe-reference-badge')).toHaveText(BADGE);
        await cafe.settle();
        const choices = cafe.since(mark, entry => entry.method === 'PUT' && entry.path === `${PLUGIN}/reference`).map(({ search, body }) => ({ search, body }));
        expect(choices, 'one choice, sent to the plugin for the Shot\'s own recipe').toEqual([{ search: `?recipe=${encodeURIComponent(recordId)}`, body: { shotId: C } }]);
        expect(fake.decentSync.recipe(recordId).referenceShotId, 'the plugin took it').toBe(C);
        expect(await legend(page)).toMatchObject({ label: 'Viewing', badge: BADGE });
        await cafe.screenshot('sync-other-machine-reference-light');

        // Put back on the server: the push for the opened Shot's recipe is followed.
        fake.decentSync.chooseReference(recordId, A);
        await cafe.settle();
        await expect.poll(() => legend(page), 'the reference chosen elsewhere is followed, with the Shot still opened').toMatchObject({
            label: 'Viewing', badge: null, make: 'Make reference', muted: false,
        });
        const now = await legend(page);
        expect(now.reference, 'behind it, A again').toMatch(/ · Example Barista$/);
        expect(now.when, 'and C still in the graph').toMatch(/ · Second Barista$/);
        await expect(page.locator('#cafe-back')).toBeVisible();
    });

    test('a Shot of this tablet\'s pulled with no recipe loaded lists as "No recipe", as the plugin gives it none', async ({ cafe, fake, start }) => {
        // A copy of A with no recipe in its Workflow, as a Shot pulled after an
        // unload, counted at the Location two hours before the test starts.
        const a = fake.shots.get(A);
        const at = start - 2 * 60 * 60_000;
        const id = '00000000-0000-4000-8000-0000000e0001';
        const { dye, ...extras } = a.workflow.context.extras;
        fake.shots.add({
            ...a,
            id,
            timestamp: localTime(at, fake.timeZone),
            createdAt: new Date(at + 30_000).toISOString(),
            updatedAt: new Date(at + 30_000).toISOString(),
            workflow: { ...a.workflow, context: { ...a.workflow.context, extras } },
        });
        fake.decentSync.atLocation(id);
        const listed = fake.request({ method: 'GET', url: `${PLUGIN}/shots?limit=50` }).body.shots.find(item => item.id === id);
        expect(listed.recipe, 'the plugin names no Recipe for it').toBeNull();

        await openServed(cafe, fake);
        await openList(cafe);
        const shown = (await listRows(cafe.page)).find(item => item.id === id);
        expect(shown, 'listed').toBeTruthy();
        expect(shown.name).toBe('No recipe');
        expect(shown.mine, 'this tablet\'s').toBe(true);
    });

    test('past 50 of the Location\'s Shots, the next page is read with the plugin\'s cursor, none twice', async ({ cafe, fake, start }) => {
        // Fifty more of this tablet's Shots at the Location, copies of A a
        // minute apart from three hours before the test starts, older than A
        // to D, each counted at the Location as one pulled there.
        const a = fake.shots.get(A);
        for (let i = 0; i < 50; i += 1) {
            const at = start - 3 * 60 * 60_000 - i * 60_000;
            const id = `00000000-0000-4000-8000-0000000d${String(i).padStart(4, '0')}`;
            const moved = ms => localTime(ms, fake.timeZone);
            fake.shots.add({
                ...a,
                id,
                timestamp: moved(at),
                createdAt: new Date(at + 30_000).toISOString(),
                updatedAt: new Date(at + 30_000).toISOString(),
                measurements: a.measurements.map((m, n) => ({
                    ...m,
                    machine: m.machine && { ...m.machine, timestamp: moved(at + n * 100) },
                    scale: m.scale && { ...m.scale, timestamp: moved(at + n * 100) },
                })),
            });
            fake.decentSync.atLocation(id);
        }
        // The cursor the plugin gives with its first page, asked before the page opens.
        const first = fake.request({ method: 'GET', url: `${PLUGIN}/shots?limit=50` });
        expect(first.body.shots).toHaveLength(50);
        const cursor = first.body.nextCursor;
        expect(cursor, 'the plugin has a next page').toEqual(expect.any(String));

        const page = await openServed(cafe, fake);
        const mark = fake.log.length;
        await openList(cafe);
        await expect(page.locator('#cafe-shots-list .cafe-shots-row')).toHaveCount(50);
        expect(pluginListReads(cafe, mark), 'the first 50').toEqual(['?limit=50']);

        await page.locator('#cafe-shots-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
        await expect(page.locator('#cafe-shots-list .cafe-shots-row')).toHaveCount(54);
        await cafe.settle();
        expect(pluginListReads(cafe, mark), 'scrolled near the end, the next 50 by the plugin\'s cursor').toEqual(['?limit=50', `?limit=50&cursor=${cursor}`]);
        expect(decaidListReads(cafe, mark), 'and never Decaid\'s own list').toEqual([]);
        const ids = (await listRows(page)).map(item => item.id);
        expect(new Set(ids).size, 'no Shot listed twice').toBe(ids.length);
        expect(ids.slice(0, 4).sort(), 'A to D first, the newest').toEqual([A, B, C, D].sort());
    });
});
