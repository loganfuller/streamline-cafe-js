// Decent Sync's pushes reaching an open page (docs/cafe/DESIGN.md, "The
// reference with Decent Sync", its "A reference chosen elsewhere" and "The
// socket"): a Reference Shot chosen on the server becomes the page's reference
// with no reload, a Shot on another Profile flagged "Different profile" and
// named by its barista, one cleared there goes, and one chosen again comes
// back; a Recipe renamed on the server is read again and draws nothing; one
// `changes` socket however often the main page mounts; the socket dropped and
// reopened, which counts as a push; a push repeated, which draws nothing; and a
// push with a `what` the page doesn't know, which it ignores.
//
// Decent Sync's plugin is the fake's (fake-decaid/decent-sync.js), serving
// the Machine at "Sample Cafe" from recordings/decent-sync.json, where no
// Recipe has a Reference Shot at the start. Shot A is this tablet's latest
// with House espresso, so it is the graph's "Latest" once that is loaded; Shot B is this
// tablet's too, on another Profile, by "Sample Barista". What the server does
// (`fake.decentSync.chooseReference`, `renameRecipe`) pushes on the plugin's
// `changes` socket, delivered at the next flush.
//
// The model pushes a change once. The real plugin may push one twice, and
// later releases may push a `what` this page doesn't know; the test sends
// those itself with `fake.decentSync.push(frame)` (see "a push repeated" below).

import { test, expect } from './support/test.mjs';
import { recording } from './support/adapter.mjs';
import { load, legend, row, sides, chartLines, watchDraws, drawCounts } from './support/page-reads.mjs';
import { recordOf } from './support/fake-reads.mjs';
import { RECIPES } from './support/sample-data.mjs';

const [house] = RECIPES;
const { A, B } = recording('decent-sync').labels;
const CHANGES = '/ws/v1/plugins/decent-sync.reaplugin/changes';
const STATUS = /^GET \/api\/v1\/plugins\/decent-sync\.reaplugin\/status$/;
const REFERENCE = /^GET \/api\/v1\/plugins\/decent-sync\.reaplugin\/reference\?recipe=/;
const BADGE = 'This shot is the reference';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** The plugin's requests since `mark` matching `pattern`, as "GET /path?query". */
const askedSince = (cafe, mark, pattern) => cafe.since(mark).map(entry => `${entry.method} ${entry.path}${entry.search}`).filter(line => pattern.test(line));

/** How many times the page opened the plugin's `changes` socket. */
const changesOpened = cafe => cafe.routes.opened.filter(path => path === CHANGES).length;

/** The chart's reference lines, each with how many points it has. */
async function referenceLines(page) {
    const lines = await chartLines(page);
    return lines.names.map((name, at) => ({ name, points: lines.points[at] })).filter(line => /^Reference /.test(line.name));
}

/** A mark on this document, which a reload would leave behind. */
const markDocument = page => page.evaluate(() => { window.__cafeSyncPushes = true; });
const sameDocument = page => page.evaluate(() => window.__cafeSyncPushes ?? null);

/** Something the server did, delivered to the page and read. */
async function delivered(cafe) {
    cafe.fake.flush();
    await cafe.settle();
    await cafe.advance(500);
}

/** The page with House espresso loaded, its latest Shot (A) in the graph and no reference yet. */
async function openHouse(cafe) {
    const page = await cafe.open();
    await load(cafe, house);
    await expect.poll(() => legend(page), 'Shot A in the graph, with no reference and Make reference offered').toMatchObject({
        label: 'Latest', reference: null, badge: null, make: 'Make reference',
    });
    return page;
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Decent Sync\'s pushes on an open page', { tag: '@sync-pushes' }, () => {
    test.use({ decentSync: true });

    test('a Reference Shot chosen, changed and cleared on the server reaches the open page with no reload', async ({ cafe, fake }) => {
        const page = await openHouse(cafe);
        const recordId = recordOf(fake, house.name).id;
        await markDocument(page);

        // Shot A, the one in the graph: the badge.
        fake.decentSync.chooseReference(recordId, A);
        await delivered(cafe);
        await expect.poll(() => legend(page), 'the Shot in the graph is the reference').toMatchObject({ badge: BADGE, flag: null });
        await cafe.screenshot('sync-chosen-on-server-light');

        // Shot B, on another Profile: flagged by Decent Sync's word, named by its barista, never where.
        fake.decentSync.chooseReference(recordId, B);
        await delivered(cafe);
        await expect.poll(() => legend(page), 'Shot B the reference, flagged').toMatchObject({ badge: null, flag: 'Different profile' });
        const different = await legend(page);
        expect(different.reference, 'named by its barista').toMatch(/Sample Barista$/);
        expect(different.reference, 'and not by where it was pulled').not.toMatch(/Sample Machine|Sample Cafe/);
        await cafe.screenshot('sync-different-profile-light');

        // Cleared on the server: Make reference, and nothing to compare with.
        fake.decentSync.chooseReference(recordId, null);
        await delivered(cafe);
        await expect.poll(() => legend(page), 'the reference gone').toMatchObject({ reference: null, badge: null, flag: null, make: 'Make reference' });
        expect(sides(await row(page)).every(side => side === 'No reference'), 'every comparison side says so').toBe(true);

        // Chosen again: back.
        fake.decentSync.chooseReference(recordId, A);
        await delivered(cafe);
        await expect.poll(() => legend(page), 'the reference back').toMatchObject({ badge: BADGE });

        expect(fake.decentSync.recipe(recordId).referenceShotId, 'the server\'s choice, which the page never wrote').toBe(A);
        expect(cafe.since(0).filter(entry => entry.method === 'PUT' && entry.path.endsWith('/reference')), 'no choice sent by the page').toEqual([]);
        expect(await sameDocument(page), 'the same page throughout, not a reload').toBe(true);
    });

    test('a Recipe renamed twice on the server: the reference read again, the graph not drawn again', async ({ cafe, fake }) => {
        const page = await openHouse(cafe);
        const recordId = recordOf(fake, house.name).id;
        fake.decentSync.chooseReference(recordId, B);
        await delivered(cafe);
        await expect.poll(() => legend(page)).toMatchObject({ flag: 'Different profile' });

        await watchDraws(page);
        const mark = fake.log.length;
        fake.decentSync.renameRecipe(recordId, `${house.name} two`);
        await delivered(cafe);
        await expect.poll(() => askedSince(cafe, mark, REFERENCE).length, 'the first rename\'s push read the reference').toBeGreaterThanOrEqual(1);
        const between = fake.log.length;
        fake.decentSync.renameRecipe(recordId, house.name);
        await delivered(cafe);
        await expect.poll(() => askedSince(cafe, between, REFERENCE).length, 'and so did the second\'s').toBeGreaterThanOrEqual(1);
        await cafe.advance(1000);

        expect((await drawCounts(page)).full, 'the graph given no lines in full').toBe(0);
        expect(await legend(page), 'the same reference').toMatchObject({ flag: 'Different profile', label: 'Latest' });
    });

    test('one changes socket however often the main page mounts, and the reference still drawn', async ({ cafe, fake }) => {
        const page = await openHouse(cafe);
        fake.decentSync.chooseReference(recordOf(fake, house.name).id, B);
        await delivered(cafe);
        await expect.poll(() => legend(page)).toMatchObject({ flag: 'Different profile' });
        expect(changesOpened(cafe), 'opened once as the page started').toBe(1);
        const drawn = await referenceLines(page);
        expect(drawn.find(line => line.name === 'Reference pressure')?.points, 'the reference drawn before Settings').toBeGreaterThan(10);

        for (let round = 0; round < 2; round += 1) {
            await page.locator('#settings-btn').click();
            await expect(page.locator('#subpage-host #settings-content-area')).toBeVisible();
            await cafe.settle();
            await page.goBack();
            await expect(page.locator('#cafe-header')).toBeVisible();
            // Past the socket helper's first retry, were a second socket opened and refused.
            await cafe.advance(2000);
        }

        expect(changesOpened(cafe), 'still the one socket, after two mounts more').toBe(1);
        expect(cafe.routes.sockets.has(CHANGES), 'and it is open').toBe(true);
        const shown = await legend(page);
        expect(shown.reference, 'the reference still in the legend').toMatch(/Sample Barista$/);
        // Shot B, cut at 6 s, has nothing on the scale: its weight line is empty either way.
        expect(await referenceLines(page), 'and its lines on the chart as they were').toEqual(drawn);
    });

    test('the changes socket dropped and reopened counts as a push: the status asked and the reference read again, nothing drawn', async ({ cafe, fake }) => {
        const page = await openHouse(cafe);
        fake.decentSync.chooseReference(recordOf(fake, house.name).id, B);
        await delivered(cafe);
        await expect.poll(() => legend(page)).toMatchObject({ flag: 'Different profile' });
        await watchDraws(page);

        for (let drop = 1; drop <= 2; drop += 1) {
            const mark = fake.log.length;
            expect(await cafe.routes.drop(CHANGES), 'the open socket closed from Decaid\'s side').toBe(1);
            await cafe.settle();
            // The page's ReconnectingWebSocket retries within 5 s, on the page's clock.
            for (let waited = 0; waited < 10_000 && changesOpened(cafe) < drop + 1; waited += 500) await cafe.advance(500);
            expect(changesOpened(cafe), `reopened after drop ${drop}`).toBe(drop + 1);
            await cafe.advance(500);
            expect(askedSince(cafe, mark, STATUS).length, 'the status asked again').toBeGreaterThanOrEqual(1);
            expect(askedSince(cafe, mark, REFERENCE).length, 'and the reference read again').toBeGreaterThanOrEqual(1);
        }

        expect((await drawCounts(page)).full, 'the same reference, so nothing drawn').toBe(0);
        expect(await legend(page)).toMatchObject({ flag: 'Different profile', label: 'Latest' });
    });

    test('a push repeated reads the reference again and draws nothing; a push with an unknown `what` is ignored', async ({ cafe, fake }) => {
        const push = frame => fake.decentSync.push(frame);
        const page = await openHouse(cafe);
        const recordId = recordOf(fake, house.name).id;
        fake.decentSync.chooseReference(recordId, B);
        await delivered(cafe);
        await expect.poll(() => legend(page)).toMatchObject({ flag: 'Different profile' });
        await watchDraws(page);

        // The push the server's choice made, as the plugin may send it again.
        const again = { what: 'reference', recipe: { id: fake.decentSync.recipe(recordId).id, name: house.name, recordId } };
        for (let time = 1; time <= 2; time += 1) {
            const mark = fake.log.length;
            push(again);
            await cafe.settle();
            await cafe.advance(500);
            expect(askedSince(cafe, mark, REFERENCE).length, `push ${time} read the reference again`).toBeGreaterThanOrEqual(1);
        }
        expect((await drawCounts(page)).full, 'and the graph was given no lines in full').toBe(0);

        // A `what` a later release might add: nothing asked, nothing drawn.
        const mark = fake.log.length;
        push({ what: 'library', recipe: { recordId } });
        push('not a push');
        await cafe.settle();
        await cafe.advance(2000);
        expect(askedSince(cafe, mark, REFERENCE), 'no reference read').toEqual([]);
        expect(askedSince(cafe, mark, STATUS), 'no status asked').toEqual([]);
        expect((await drawCounts(page)).full, 'nothing drawn').toBe(0);
        expect(await legend(page)).toMatchObject({ flag: 'Different profile', label: 'Latest' });
    });
});
