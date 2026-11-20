// The Location's Shots while Decent Sync's server can't be reached, and as it
// comes back (docs/cafe/DESIGN.md, "The Location's Shots", "While the server
// can't be reached"): another Machine's Shot opened from the Location's list,
// then the server stopped: the line "Decent Sync can't be reached, so this shot
// can't be changed", its stars and Make reference muted and taking no tap, its
// note open to read only. Back to the latest, the list is this machine's own,
// from Decaid, under "This machine only" and the line saying why, with no chip
// and the choice kept on the tablet not read; the tablet's own Shot opened
// there is rated, through the plugin's edit, which is Decaid's own. The server
// back: the opened Shot can be changed again, and the list is the Location's.
//
// And the catch-up race: the plugin refuses `shots` and `shot` as
// `unreachable` for a while after its connection comes back, though its status
// already says the Machine is served. The list refused is answered from the
// tablet under the unreachable line, with the status asked again, and the
// list opened afresh is the plugin's again. The muted Shot is read again on
// its own timer (`lockedRetryMs` in src/cafe/graph-state.js: 10 s, then twice
// as long, to 5 minutes) until a read finds the server, and only then can it
// be changed.
//
// Decent Sync's plugin is the fake's (fake-decaid/decent-sync.js), serving
// the Machine at "Sample Cafe" with the four recorded Shots: A and B this
// tablet's, C and D "Sample Machine Two"'s. C, House espresso's, is the Shot
// opened. It is rated and noted on the server before the page opens.
//
// What stays in the real journey: the server's container stopped and started,
// the plugin's own catch-up after a reconnection, and that the second tablet
// is left untouched.

import { test, expect } from './support/test.mjs';
import { legend, remarks, noteDialog, shotsHeader, load, writes } from './support/page-reads.mjs';
import { recording } from './support/adapter.mjs';
import { lockedRetryMs } from '../../src/cafe/graph-state.js';
import { LIST_UNREACHABLE } from '../../src/cafe/shot-list.js';
import { RECIPES } from './support/sample-data.mjs';

const [house, single] = RECIPES;
const { A, B, C, D } = recording('decent-sync').labels;
const LOCATION = 'Sample Cafe';
const OTHER_MACHINE = 'Sample Machine Two';
const NOTE = 'Pulled on the other machine.\nA touch fast.';
const SHOT_CANT_CHANGE = "Decent Sync can't be reached, so this shot can't be changed";
const TABLET_COLUMNS = 'Pulled|Recipe|Dose → yield|Rating|Barista|Note';
const LOCATION_COLUMNS = 'Pulled|Machine|Recipe|Dose → yield|Time|Rating|Barista|Note';
const PLUGIN = '/api/v1/plugins/decent-sync.reaplugin';
const REFERENCES = '/api/v1/store/streamlineCafe/references';
const UNREACHABLE = { code: 'unreachable', message: "The Decent Sync server can't be reached from this tablet right now." };

// ── What was asked ───────────────────────────────────────────────────────────

const isStatus = entry => entry.method === 'GET' && entry.path === `${PLUGIN}/status`;
const isPluginList = entry => entry.method === 'GET' && entry.path === `${PLUGIN}/shots`;
const isTabletList = entry => entry.method === 'GET' && entry.path === '/api/v1/shots' && new URLSearchParams(entry.search).get('limit') === '50' && !new URLSearchParams(entry.search).has('ids');
const isWholeRead = id => entry => entry.method === 'GET' && entry.path === `${PLUGIN}/shot` && new URLSearchParams(entry.search).get('id') === id;
const isReferencesRead = entry => entry.path.startsWith(REFERENCES);

// ── On the page ──────────────────────────────────────────────────────────────

/** The list's rows. A cell shows where it has a box. */
const listRows = page => page.evaluate(() => [...document.querySelectorAll('#cafe-shots-list .cafe-shots-row')].map(row => {
    const visible = selector => { const cell = row.querySelector(selector); return cell && cell.offsetParent !== null ? cell.textContent.trim() : null; };
    return {
        id: row.dataset.shotId,
        machine: visible('.cafe-shots-machine-name'),
        mine: !!row.querySelector('.cafe-shots-this'),
        name: row.querySelector('.cafe-shots-name').textContent,
        chip: !!row.querySelector('.cafe-shots-chip'),
        stars: [...row.querySelectorAll('.cafe-shots-star')].filter(star => parseFloat(star.style.getPropertyValue('--cafe-star-fill')) > 0).length,
        note: !!row.querySelector('.cafe-shots-note svg'),
    };
}));

/** The Shots button tapped, and the list open with its rows drawn. */
async function openList(cafe) {
    await cafe.page.locator('#cafe-shots-btn').click();
    await expect(cafe.page.locator('#cafe-shots-dialog')).toHaveAttribute('open', '');
    await cafe.settle();
    await expect(cafe.page.locator('#cafe-shots-list .cafe-shots-row').first()).toBeVisible();
}

/** The list closed by its own button. */
async function closeList(cafe) {
    await cafe.page.locator('#cafe-shots-dialog .cafe-shots-head button').click();
    await expect(cafe.page.locator('#cafe-shots-dialog')).not.toHaveAttribute('open', '');
    await cafe.settle();
}

/** A row tapped, and its Shot in the graph under `label`. */
async function openRow(cafe, id, label) {
    await cafe.page.locator(`#cafe-shots-list [data-shot-id="${id}"]`).click();
    await expect(cafe.page.locator('#cafe-shot-label')).toHaveText(label);
    await cafe.settle();
}

/** "Back to latest", and the loaded recipe's latest Shot in the graph. */
async function backToLatest(cafe) {
    await cafe.page.locator('#cafe-back').click();
    await expect(cafe.page.locator('#cafe-shot-label')).toHaveText('Latest');
    await cafe.settle();
}

const starsOff = page => page.locator('#cafe-stars .cafe-star').evaluateAll(stars => stars.every(star => star.disabled));
const stars = async page => (await remarks(page)).stars;
const RATED_8 = [100, 100, 100, 100, 0];

/**
 * The page with House espresso loaded, the Location's list opened and C, the
 * other Machine's House espresso Shot, opened from it, rated 8 and noted.
 */
async function otherMachineShotOpened(cafe, fake) {
    fake.decentSync.editShot(C, { rating: 8, note: NOTE });
    const page = await cafe.open();
    await load(cafe, house);
    await openList(cafe);
    expect((await shotsHeader(page)).under, 'the Location\'s list').toBe(LOCATION);
    await openRow(cafe, C, 'Viewing');
    await expect.poll(() => legend(page)).toMatchObject({ label: 'Viewing', make: 'Make reference', muted: false, notice: null });
    expect(await stars(page)).toEqual(RATED_8);
    return page;
}

/** The server stopped, and the opened Shot muted with the line that says why. */
async function serverStopped(cafe, fake) {
    fake.decentSync.stopServer();
    fake.flush();
    await cafe.settle();
    await expect(cafe.page.locator('#cafe-legend-notice')).toHaveText(SHOT_CANT_CHANGE);
    await expect(cafe.page.locator('#cafe-legend-notice')).toBeVisible();
}

/**
 * The status the plugin answers now, asked of the fake and not by the page: in
 * the catch-up race it already says served while `shots` and `shot` refuse.
 * (A page open through the outage keeps "saved to the recipe" all along, so
 * its label can't show it.)
 */
const pluginStatus = fake => fake.request({ method: 'GET', url: `${PLUGIN}/status` }).status;

/** The server back: its connection pushed, and the page's asks after it answered. */
async function serverBack(cafe, fake) {
    fake.decentSync.startServer();
    fake.flush();
    await cafe.settle();
}

const wholeReads = (cafe, id) => cafe.fake.log.filter(isWholeRead(id)).length;

const now = page => page.evaluate(() => Date.now());

/**
 * The opened Shot read again on its own timer, `gap` after `from` (the page's
 * time the timer was set, read a moment after). The clock is moved in long
 * steps to 10 s short of it, then half a second at a time until the read, so
 * the page's time is read within a step of it. The page's clock also runs on
 * by itself while the test works, slower or faster as the machine is loaded,
 * so where it is is read again at each step, and the read is placed by the
 * page's time, not by how far the test moved it. Answers that time.
 */
async function readAgainAfter(cafe, id, from, gap) {
    const before = wholeReads(cafe, id);
    for (let left = from + gap - 10_000 - await now(cafe.page); left > 0; left = from + gap - 10_000 - await now(cafe.page)) {
        await cafe.advance(Math.min(left, 5000), { step: 5000 });
    }
    expect(wholeReads(cafe, id), `not read again long before ${gap / 1000} s`).toBe(before);
    for (let moved = 0; moved < 20_000 && wholeReads(cafe, id) === before; moved += 500) await cafe.advance(500);
    const at = await now(cafe.page);
    expect(wholeReads(cafe, id), `read again once, ${gap / 1000} s on`).toBe(before + 1);
    expect(at - from, `read again ${gap / 1000} s on, not before`).toBeGreaterThan(gap - 1500);
    expect(at - from, `read again ${gap / 1000} s on, not after`).toBeLessThan(gap + 3000);
    return at;
}

test.describe('the Location\'s Shots while Decent Sync can\'t be reached', { tag: '@sync-shots-outage' }, () => {
    test.use({ decentSync: true });

    test('another Machine\'s Shot in the graph when the server stops: the line, muted stars and Make reference, taps that ask nothing, its note read only', async ({ cafe, fake }) => {
        const page = await otherMachineShotOpened(cafe, fake);
        await page.evaluate(() => { window.__cafeSamePage = true; });
        await serverStopped(cafe, fake);

        expect(await legend(page), 'the Shot stays in the graph, Make reference muted').toMatchObject({ label: 'Viewing', make: 'Make reference', muted: true, notice: SHOT_CANT_CHANGE });
        expect(await stars(page), 'the stars at the rating it holds').toEqual(RATED_8);
        expect(await starsOff(page), 'and muted').toBe(true);

        const mark = fake.log.length;
        await page.locator('#cafe-stars .cafe-star').nth(0).click({ force: true });
        await page.locator('#cafe-make-reference').click({ force: true });
        await cafe.advance(1000);
        expect(writes(cafe.since(mark)), 'a tap on a star or on Make reference asks nothing').toEqual([]);
        expect(await stars(page)).toEqual(RATED_8);
        await expect(page.locator('#cafe-reference-dialog')).not.toHaveAttribute('open', '');

        await page.locator('#cafe-shot-note').click();
        await expect(page.locator('#cafe-note-dialog')).toHaveAttribute('open', '');
        expect(await noteDialog(page), 'its note opens to read only').toMatchObject({ read: NOTE, text: null, buttons: ['Close'] });
        await cafe.screenshot('sync-other-machine-locked-note-light');
        await page.locator('#cafe-note-close').click();
        await expect(page.locator('#cafe-note-dialog')).not.toHaveAttribute('open', '');
        await cafe.settle();
        expect(writes(cafe.since(mark)), 'and nothing was written by the note either').toEqual([]);
        expect(await page.evaluate(() => window.__cafeSamePage), 'with no reload').toBe(true);
        await cafe.screenshot('sync-other-machine-locked-light');
    });

    // Fifteen minutes of the page's clock, moved in steps: longer than a test's usual 30 s on a loaded machine.
    test.describe('the muted Shot read again', () => {
    test.describe.configure({ timeout: 180_000 });
    test('with the server stopped the muted Shot is read again 10 s later, then twice as long each time, to 5 minutes', async ({ cafe, fake }) => {
        const page = await otherMachineShotOpened(cafe, fake);
        const mark = fake.log.length;
        await serverStopped(cafe, fake);
        let at = await page.evaluate(() => Date.now());
        // 10, 20, 40, 80, 160, then 300 s, the cap, where twice 160 would be 320.
        for (let tries = 1; tries <= 6; tries += 1) at = await readAgainAfter(cafe, C, at, lockedRetryMs(tries));
        expect(lockedRetryMs(6)).toBe(300_000);
        expect(await legend(page), 'still muted, and still in the graph').toMatchObject({ label: 'Viewing', muted: true, notice: SHOT_CANT_CHANGE });
        expect(cafe.since(mark, isWholeRead(C)).map(entry => entry.status), 'the read as the server stopped, and the six after it, each refused').toEqual(Array(7).fill(503));
    });

    });

    test('back to the latest with the server stopped, the list is this machine\'s own, and its own Shot is rated through Decaid', async ({ cafe, fake }) => {
        const page = await otherMachineShotOpened(cafe, fake);
        await serverStopped(cafe, fake);
        await backToLatest(cafe);

        let mark = fake.log.length;
        await openList(cafe);
        expect(await shotsHeader(page), 'headed "This machine only", with the line that says Decent Sync can\'t be reached').toEqual({
            title: 'Shots', under: 'This machine only', line: LIST_UNREACHABLE, columns: TABLET_COLUMNS.split('|'),
        });
        const shown = await listRows(page);
        const ids = shown.map(row => row.id);
        expect(ids, 'this machine\'s own Shots').toEqual(expect.arrayContaining([A, B]));
        expect(ids, 'and no other Machine\'s').not.toContain(C);
        expect(ids).not.toContain(D);
        expect(shown.filter(row => row.machine !== null), 'with no Machine column').toEqual([]);
        expect(shown.filter(row => row.chip), 'no row carries a chip').toEqual([]);
        expect(cafe.since(mark, isTabletList).length, 'read from Decaid').toBe(1);
        expect(cafe.since(mark, isPluginList).length, 'and not asked of the plugin').toBe(0);
        expect(cafe.since(mark, isReferencesRead), 'the choice kept on the tablet is not read').toEqual([]);
        await cafe.screenshot('sync-shots-server-stopped-light');

        await openRow(cafe, B, single.name);
        expect(await starsOff(page), 'the tablet\'s own Shot can be rated').toBe(false);
        mark = fake.log.length;
        await page.locator('#cafe-stars .cafe-star').nth(1).click();
        await cafe.settle();
        await expect.poll(() => fake.shots.get(B).annotations?.enjoyment, 'Decaid holds the rating').toBe(4);
        expect(await stars(page)).toEqual([100, 100, 0, 0, 0]);
        expect(writes(cafe.since(mark)), 'one edit, the plugin\'s, which writes the tablet\'s own Shot through Decaid').toEqual([
            { write: `PUT ${PLUGIN}/shot`, body: { rating: 4 } },
        ]);
        expect(await legend(page), 'and no line that says this shot can\'t be changed').toMatchObject({ label: single.name });
        expect((await legend(page)).notice).not.toBe(SHOT_CANT_CHANGE);
    });

    test('the server back: the opened Shot can be changed again, and the list is the Location\'s once more', async ({ cafe, fake }) => {
        const page = await otherMachineShotOpened(cafe, fake);
        await page.evaluate(() => { window.__cafeSamePage = true; });
        await serverStopped(cafe, fake);

        const mark = fake.log.length;
        await serverBack(cafe, fake);
        await expect.poll(() => legend(page), 'read again as the connection came back, with no reload').toMatchObject({ label: 'Viewing', make: 'Make reference', muted: false, notice: null });
        expect(await starsOff(page)).toBe(false);
        expect(cafe.since(mark, isWholeRead(C)).length, 'the Shot read again through the plugin').toBeGreaterThan(0);

        await backToLatest(cafe);
        const listed = fake.log.length;
        await openList(cafe);
        expect(await shotsHeader(page), 'the Location\'s list again').toEqual({ title: 'Shots', under: LOCATION, line: null, columns: LOCATION_COLUMNS.split('|') });
        expect(cafe.since(listed, isPluginList).length, 'through the plugin').toBe(1);
        expect(cafe.since(listed, isTabletList).length, 'and not from Decaid').toBe(0);
        const theirs = (await listRows(page)).find(row => row.id === C);
        expect(theirs, 'the other Machine\'s Shot listed, with its rating and note').toMatchObject({ machine: OTHER_MACHINE, mine: false, stars: 4, note: true });

        await openRow(cafe, C, 'Viewing');
        const edit = fake.log.length;
        await page.locator('#cafe-stars .cafe-star').nth(4).click();
        await cafe.settle();
        await expect.poll(() => fake.decentSync.others().find(other => other.shot.id === C).shot.annotations.enjoyment, 'the server has the edit').toBe(10);
        expect(writes(cafe.since(edit))).toEqual([{ write: `PUT ${PLUGIN}/shot`, body: { rating: 10 } }]);
        expect(await page.evaluate(() => window.__cafeSamePage), 'with no reload').toBe(true);
    });

    test('catching up: status served while the plugin still refuses the list, which is the tablet\'s with the line, then the Location\'s once it answers', async ({ cafe, fake }) => {
        const page = await cafe.open();
        await load(cafe, house);
        fake.decentSync.stopServer();
        fake.flush();
        await cafe.settle();
        fake.refuse({ method: 'GET', path: /\/plugins\/decent-sync\.reaplugin\/shots/, status: 503, body: UNREACHABLE, times: 1 });
        await serverBack(cafe, fake);
        expect(pluginStatus(fake), 'the plugin\'s status says served').toBe(200);

        let mark = fake.log.length;
        await openList(cafe);
        expect(await shotsHeader(page), 'the list refused is the tablet\'s own, under the line for the refusal').toEqual({
            title: 'Shots', under: 'This machine only', line: LIST_UNREACHABLE, columns: TABLET_COLUMNS.split('|'),
        });
        expect(cafe.since(mark, isPluginList).map(entry => entry.status), 'asked of the plugin, which refused').toEqual([503]);
        expect(cafe.since(mark, isTabletList).length, 'then read from Decaid').toBe(1);
        expect(cafe.since(mark, isStatus).length, 'and the status asked again').toBeGreaterThan(0);
        const ids = (await listRows(page)).map(row => row.id);
        expect(ids).toEqual(expect.arrayContaining([A, B]));
        expect(ids).not.toContain(C);
        expect(cafe.since(mark, isReferencesRead), 'the choice kept on the tablet is not read').toEqual([]);
        await closeList(cafe);

        mark = fake.log.length;
        await openList(cafe);
        expect(await shotsHeader(page), 'opened afresh, the list is asked of the plugin again, and is the Location\'s').toEqual({
            title: 'Shots', under: LOCATION, line: null, columns: LOCATION_COLUMNS.split('|'),
        });
        expect(cafe.since(mark, isPluginList).map(entry => entry.status)).toEqual([200]);
        expect(cafe.since(mark, isTabletList).length).toBe(0);
        expect((await listRows(page)).find(row => row.id === C)).toMatchObject({ machine: OTHER_MACHINE });
    });

    test('catching up: status served while the plugin still refuses the opened Shot, which stays muted until a read on its own timer finds the server', async ({ cafe, fake }) => {
        const page = await otherMachineShotOpened(cafe, fake);
        await serverStopped(cafe, fake);
        // Muted now; the first read again is due 10 s on.
        const mutedAt = await page.evaluate(() => Date.now());

        // The read after the connection came back, and the first on the timer, are refused.
        fake.refuse({ method: 'GET', path: /\/plugins\/decent-sync\.reaplugin\/shot\?/, status: 503, body: UNREACHABLE, times: 2 });
        const mark = fake.log.length;
        await serverBack(cafe, fake);
        expect(pluginStatus(fake), 'the plugin\'s status says served').toBe(200);
        await expect.poll(() => cafe.since(mark, isWholeRead(C)).map(entry => entry.status), 'read again as the connection came back, and refused').toEqual([503]);
        await cafe.settle();
        expect(await legend(page), 'so still muted, with the line').toMatchObject({ label: 'Viewing', muted: true, notice: SHOT_CANT_CHANGE });
        expect(await starsOff(page)).toBe(true);

        // The timer set when the Shot was muted: refused once more.
        const first = await readAgainAfter(cafe, C, mutedAt, lockedRetryMs(1));
        expect(cafe.since(mark, isWholeRead(C)).map(entry => entry.status)).toEqual([503, 503]);
        expect(await legend(page), 'still muted').toMatchObject({ muted: true, notice: SHOT_CANT_CHANGE });

        // Then 20 s later, which the plugin answers.
        await readAgainAfter(cafe, C, first, lockedRetryMs(2));
        expect(cafe.since(mark, isWholeRead(C)).map(entry => entry.status)).toEqual([503, 503, 200]);
        await expect.poll(() => legend(page), 'and can be changed again').toMatchObject({ label: 'Viewing', make: 'Make reference', muted: false, notice: null });
        expect(await starsOff(page)).toBe(false);
        expect(await stars(page)).toEqual(RATED_8);

        // Found, it is not read again on a timer.
        const after = cafe.since(0, isWholeRead(C)).length;
        await cafe.advance(lockedRetryMs(3) + 1000, { step: 1000 });
        expect(cafe.since(0, isWholeRead(C)).length, 'no timer reads a Shot that can be changed').toBe(after);
    });
});
