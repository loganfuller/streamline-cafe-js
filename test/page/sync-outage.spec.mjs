// Decent Sync's server out of reach, for the graph and the reference
// (docs/cafe/DESIGN.md, "The reference with Decent Sync" and "Rating and
// notes"): the server stopped with the page open, the page told on the plugin's
// `changes` socket, the tablet's copy of the Reference Shot still drawn, Make
// reference muted and the line saying why, the column still "saved to the
// recipe"; a page opened while the server is stopped, drawing the copy with its
// rating and note, and the tablet's own Shot rated by Decaid's own edit; the
// server back, and the reference changeable again with no reload; and the pace
// the Status is asked again at meanwhile.
//
// Decent Sync's plugin is the fake's (fake-decaid/decent-sync.js), serving the
// Machine at its Location. Before the page opens, House espresso's Reference
// Shot is chosen on the server: Shot C, Sample Machine Two's, which is rated 7
// (★ 3.5) and noted there, so the tablet's copy carries both. The graph's
// latest Shot is A, this tablet's. `fake.decentSync.stopServer()` is the
// outage: the plugin then answers `reference` from its copy, and refuses
// anything that needs the server.
//
// Where a rating goes on a page opened during the outage: the Status has only
// said the server can't be asked, so the source is still `unknown`
// (`shotSource` in src/cafe/sync-status.js), and `editShot` in
// src/cafe/shot-sources.js sends an edit to the tablet's own source whenever
// the source is not `plugin`: Decaid's `PUT /api/v1/shots/<id>`
// (src/cafe/tablet-shots.js). The plugin is not asked.
//
// Staying in the real journey: the Docker container stopped and started, the
// server's own Reference Shot after the outage, and the second tablet.

import { test, expect } from './support/test.mjs';
import { recording } from './support/adapter.mjs';
import { legend, chartLines, remarks, load, REFERENCE_LINES } from './support/page-reads.mjs';
import { recordOf } from './support/fake-reads.mjs';
import { statusRetryMs } from '../../src/cafe/sync-status.js';
import { RECIPES } from './support/sample-data.mjs';

const [house] = RECIPES;
const { A, C } = recording('decent-sync').labels;
const SAVED = 'Dial-in · saved to the recipe';
const CANT_CHANGE = "Decent Sync can't be reached, so the reference can't be changed";
const NOTE = 'The one to match.';
const REFERENCES = '/api/v1/store/streamlineCafe/references';
const PLUGIN = '/api/v1/plugins/decent-sync.reaplugin/';
const STATUS = `${PLUGIN}status`;
const REFERENCE = `${PLUGIN}reference`;

// ── Test data and reads ──────────────────────────────────────────────────────

/** House espresso's Reference Shot chosen on the server, Shot C, rated 7 (★ 3.5) and noted there. */
function referenceOnServer(fake) {
    fake.decentSync.chooseReference(recordOf(fake, house.name).id, C);
    fake.decentSync.editShot(C, { rating: 7, note: NOTE });
}

/** Reads of the choice of references kept on the tablet, in Decaid's store. */
const referencesRead = fake => fake.log.filter(entry => entry.path.startsWith(REFERENCES)).map(entry => `${entry.method} ${entry.path}`);
/** Every PUT since a mark, as "PUT /path?query". */
const puts = (cafe, mark) => cafe.since(mark, entry => entry.method === 'PUT').map(entry => `PUT ${entry.path}${entry.search}`);
/** The plugin's Status asks since a mark. */
const statusAsks = (cafe, mark) => cafe.since(mark, entry => entry.method === 'GET' && entry.path === STATUS);

/** How many points each of the reference's lines has on the main chart. */
async function referencePoints(page) {
    const lines = await chartLines(page);
    return REFERENCE_LINES.map(name => lines.points[lines.names.indexOf(name)] ?? 0);
}

/** The page open with House espresso loaded, and a mark the page sets once, which a reload would lose. */
async function openLoaded(cafe) {
    const page = await cafe.open();
    await load(cafe, house);
    await page.evaluate(() => { window.__syncOutageOpened = true; });
    return page;
}

test.describe('Decent Sync out of reach: the graph and the reference', { tag: '@sync-outage' }, () => {
    test.use({ decentSync: true });

    test('the server stopped with the page open: the copy drawn, Make reference muted and the line why, until it is back, with no reload', async ({ cafe, fake }) => {
        referenceOnServer(fake);
        const page = await openLoaded(cafe);
        await expect.poll(() => legend(page), 'served: the reference, and Make reference to change it').toMatchObject({
            label: 'Latest', make: 'Make reference', muted: false, notice: null,
        });
        const served = await legend(page);
        expect(served.reference, 'Shot C drawn as the reference').toMatch(/\d{2}:\d{2}/);

        // The outage, told on the plugin's `changes` socket.
        const mark = fake.log.length;
        fake.decentSync.stopServer();
        fake.flush();
        await cafe.settle();
        await expect.poll(() => legend(page), 'the copy still drawn, Make reference muted, and the line saying why').toMatchObject({
            label: 'Latest', reference: served.reference, make: 'Make reference', muted: true, notice: CANT_CHANGE,
        });
        expect(statusAsks(cafe, mark).length, 'the push had the Status asked').toBeGreaterThan(0);
        expect(cafe.since(mark, entry => entry.method === 'GET' && entry.path === REFERENCE).map(entry => entry.status),
            'and the reference read again, answered from the tablet\'s copy').toContain(200);
        for (const points of await referencePoints(page)) expect(points, 'the reference\'s lines are drawn').toBeGreaterThan(10);
        expect(await remarks(page), 'the copy carries the Reference Shot\'s rating and note').toMatchObject({ referenceRating: '★ 3.5', referenceNote: true });
        await expect(page.locator('#cafe-dial-label'), 'the plugin goes on saving on the tablet').toHaveText(SAVED);

        const tapped = fake.log.length;
        await page.locator('#cafe-make-reference').click({ force: true });
        await cafe.advance(2000);
        expect(puts(cafe, tapped), 'a tap on the muted Make reference asks nothing').toEqual([]);
        await expect(page.locator('#cafe-reference-dialog[open]')).toHaveCount(0);
        expect(referencesRead(fake), 'nothing kept on the tablet was read for it').toEqual([]);
        await cafe.screenshot('sync-server-stopped-light');

        // The server back: the reference can be changed again.
        fake.decentSync.startServer();
        fake.flush();
        await cafe.settle();
        await expect.poll(() => legend(page), 'Make reference live again, and the line gone').toMatchObject({
            label: 'Latest', reference: served.reference, make: 'Make reference', muted: false, notice: null,
        });
        expect(await page.evaluate(() => window.__syncOutageOpened === true), 'with no reload').toBe(true);
        await page.locator('#cafe-make-reference').click();
        await expect(page.locator('#cafe-reference-dialog[open]'), 'a tap acts: it asks to replace the reference').toBeVisible();
        expect(referencesRead(fake), 'and the choice kept on the tablet never read').toEqual([]);
    });

    test('a page opened while the server is stopped: the copy with its rating and note, nothing to choose, and the tablet\'s own Shot rated by Decaid', async ({ cafe, fake }) => {
        referenceOnServer(fake);
        // Stopped before the page opens: no socket yet hears the push.
        fake.decentSync.stopServer();
        const page = await cafe.open();
        await load(cafe, house);

        await expect.poll(() => legend(page), 'the copy drawn, with Make reference muted and the line saying why').toMatchObject({
            label: 'Latest', make: 'Make reference', muted: true, notice: CANT_CHANGE,
        });
        const shown = await legend(page);
        expect(shown.reference, 'Shot C drawn as the reference').toMatch(/\d{2}:\d{2}/);
        expect(shown.when).toMatch(/\d{2}:\d{2}/);
        for (const points of await referencePoints(page)) expect(points, 'the reference\'s lines are drawn').toBeGreaterThan(10);
        expect(await remarks(page), 'the copy carries the Reference Shot\'s rating and note').toMatchObject({ referenceRating: '★ 3.5', referenceNote: true });
        expect(referencesRead(fake), 'the choice kept on the tablet was not read').toEqual([]);
        // No answer has said the Machine is served, so none says the plugin
        // saves the dial-in yet (`decentSyncSaves` in src/cafe/sync-status.js).
        await expect(page.locator('#cafe-dial-label')).toHaveText('Dial-in · not saved to the recipe');

        let mark = fake.log.length;
        await page.locator('#cafe-make-reference').click({ force: true });
        await cafe.advance(2000);
        expect(puts(cafe, mark), 'a tap on the muted Make reference asks nothing').toEqual([]);
        await expect(page.locator('#cafe-reference-dialog[open]')).toHaveCount(0);

        // The tablet's own Shot, A, rated: the source is not known yet, so the
        // edit is Decaid's own, and the plugin is not asked.
        expect((await remarks(page)).stars, 'A unrated').toEqual([0, 0, 0, 0, 0]);
        mark = fake.log.length;
        await page.locator('#cafe-stars .cafe-star').nth(2).click();
        await expect.poll(async () => (await remarks(page)).stars).toEqual([100, 100, 100, 0, 0]);
        await cafe.advance(1000);
        expect(fake.shots.get(A).annotations.enjoyment, 'Decaid holds the rating').toBe(6);
        expect(puts(cafe, mark), 'by Decaid\'s own Shot edit, and nothing else').toEqual([`PUT /api/v1/shots/${A}`]);
        expect(cafe.since(mark, entry => entry.method === 'PUT').map(entry => entry.body), 'the rating alone').toEqual([{ annotations: { enjoyment: 6 } }]);
        expect(referencesRead(fake)).toEqual([]);
        await cafe.screenshot('sync-opened-while-stopped-light');
    });

    test('while the server is out of reach the Status is asked again 30 s after the outage, then 60 s after that', async ({ cafe, fake }) => {
        const page = await cafe.open();
        await expect(page.locator('#cafe-dial-label')).toBeVisible();
        expect(cafe.routes.sockets.has('/ws/v1/plugins/decent-sync.reaplugin/changes')).toBe(true);

        // The page's own time, which runs on by itself too: each ask is
        // placed between two readings of it, as no clock in the log is the
        // page's to the millisecond.
        const pageNow = () => page.evaluate(() => Date.now());
        const before = fake.log.length;
        const stoppedFrom = await pageNow();
        fake.decentSync.stopServer();
        fake.flush();
        await cafe.settle();
        await expect.poll(() => statusAsks(cafe, before).length, 'the push had the Status asked').toBe(1);
        const stoppedBy = await pageNow();

        // Moved on two seconds at a time, past both retries: each ask is
        // between the reading before the step it came in and the one after.
        const STEP = 2000;
        const mark = fake.log.length;
        const asked = [];
        let last = stoppedBy;
        while (last - stoppedBy < statusRetryMs(1) + statusRetryMs(2) + 5000) {
            const seen = statusAsks(cafe, mark).length;
            await cafe.advance(STEP, { step: STEP });
            const now = await pageNow();
            for (let n = seen; n < statusAsks(cafe, mark).length; n += 1) asked.push([last, now]);
            last = now;
        }
        expect(statusAsks(cafe, mark).map(entry => entry.status), 'two asks, each answered "unreachable"').toEqual([503, 503]);
        // The first 30 s after the push's ask, the second 60 s after the first.
        const [[firstFrom, firstBy], [secondFrom, secondBy]] = asked;
        expect(firstBy - stoppedFrom, `the first retry 30 s on: ${asked.join(' ')}`).toBeGreaterThanOrEqual(statusRetryMs(1));
        expect(firstFrom - stoppedBy, `the first retry 30 s on: ${asked.join(' ')}`).toBeLessThan(statusRetryMs(1));
        expect(secondBy - firstFrom, `the second 60 s after it: ${asked.join(' ')}`).toBeGreaterThanOrEqual(statusRetryMs(2));
        expect(secondFrom - firstBy, `the second 60 s after it: ${asked.join(' ')}`).toBeLessThan(statusRetryMs(2));
    });
});
