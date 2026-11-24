// The page reported to Decent Sync's plugin, and the reload it asks for
// (docs/cafe/DESIGN.md, "Builds and installs"): the Skin id and version this
// build names, and when the page loaded, PUT to the plugin's `page` on load
// and each time the `changes` socket opens; a `{"what":"reload"}` push on
// `changes` loads the page again, the main page from Settings too, which
// reports again, and any other push leaves it; a plugin without the report
// (v1.11.1, the pinned one, answers 404 "Not found"), or none, answered once
// on load and once a socket open, with no retry and nothing else on the page
// changed.
//
// Playwright's clock gives every page load the same `performance.timeOrigin`,
// so a test can't show a later `loadedAt` after a reload. Each report is
// checked against its own page's `timeOrigin` instead, which a tablet moves on
// at each load.

import { test, expect } from './support/test.mjs';
import { load } from './support/page-reads.mjs';
import { RECIPES } from './support/sample-data.mjs';
import { APP_VERSION, SKIN_ID } from '../../src/version.js';

const [house] = RECIPES;

const PAGE = '/api/v1/plugins/decent-sync.reaplugin/page';
const CHANGES = '/ws/v1/plugins/decent-sync.reaplugin/changes';

const reports = (cafe, mark = 0) => cafe.since(mark, entry => entry.path === PAGE);
const changesOpened = cafe => cafe.routes.opened.filter(path => path === CHANGES).length;
const loadedAtOf = page => page.evaluate(() => new Date(performance.timeOrigin).toISOString());
const markDocument = page => page.evaluate(() => { window.__cafePageReport = true; });
const sameDocument = page => page.evaluate(() => window.__cafePageReport ?? null);
const build = loadedAt => ({ skinId: SKIN_ID, version: APP_VERSION, loadedAt });

async function openWithSocket(cafe) {
    const page = await cafe.open();
    await expect.poll(() => changesOpened(cafe), 'the changes socket open').toBe(1);
    await cafe.settle();
    return page;
}

async function reopen(cafe, times) {
    expect(await cafe.routes.drop(CHANGES), 'the open socket closed from Decaid\'s side').toBe(1);
    await cafe.settle();
    for (let waited = 0; waited < 10_000 && changesOpened(cafe) < times; waited += 500) await cafe.advance(500);
    expect(changesOpened(cafe), 'and opened again').toBe(times);
    await cafe.settle();
}

test.describe('the page reported to Decent Sync\'s plugin', { tag: '@page-report' }, () => {
    test.describe('with Decent Sync serving', () => {
        test.use({ decentSync: true });

        test('on load and each time the changes socket opens, the same build and load time each time', async ({ cafe, fake }) => {
            const page = await openWithSocket(cafe);
            const loadedAt = await loadedAtOf(page);
            const sent = reports(cafe);
            expect(sent.map(entry => [entry.method, entry.status]), 'one on load, one as the socket opened').toEqual([['PUT', 204], ['PUT', 204]]);
            for (const entry of sent) expect(entry.body).toEqual(build(loadedAt));
            expect(fake.decentSync.page(), 'and the plugin keeps it').toMatchObject(build(loadedAt));

            for (let drop = 1; drop <= 2; drop += 1) {
                const mark = fake.log.length;
                await reopen(cafe, drop + 1);
                expect(reports(cafe, mark).map(entry => entry.body), `reported again as the socket reopened, drop ${drop}`).toEqual([build(loadedAt)]);
            }
        });

        test('a reload push loads the page again, which reports again; any other push leaves the page as it is', async ({ cafe, fake }) => {
            const page = await openWithSocket(cafe);
            await markDocument(page);

            let mark = fake.log.length;
            for (const frame of [{ what: 'library' }, { what: 'Reload' }, 'reload']) fake.decentSync.push(frame);
            fake.flush();
            await cafe.settle();
            await cafe.advance(2000);
            expect(await sameDocument(page), 'other pushes: the same page').toBe(true);
            expect(reports(cafe, mark), 'and nothing reported').toEqual([]);

            mark = fake.log.length;
            const asked = page.waitForRequest(request => request.isNavigationRequest());
            const loaded = page.waitForEvent('load');
            fake.decentSync.push({ what: 'reload' });
            fake.flush();
            const navigation = await asked;
            await loaded;
            await page.locator('#cafe-strip .cafe-card').first().waitFor();
            await expect.poll(() => changesOpened(cafe), 'the fresh page opens the changes socket').toBe(2);
            await cafe.settle();

            expect(await sameDocument(page), 'a fresh page').toBeNull();
            expect(new URL(navigation.url()).searchParams.get('v'), 'asked for again, past the WebView\'s cache').toMatch(/^\d+$/);
            const loadedAt = await loadedAtOf(page);
            expect(reports(cafe, mark).map(entry => [entry.status, entry.body]), 'the fresh page reports on load and as its socket opens').toEqual([[204, build(loadedAt)], [204, build(loadedAt)]]);
            expect(fake.decentSync.page()).toMatchObject(build(loadedAt));
        });

        test('a reload push on Settings loads the main page, which reports', async ({ cafe, fake }) => {
            const page = await openWithSocket(cafe);
            await page.locator('#settings-btn').click();
            await expect(page.locator('#subpage-host #settings-content-area')).toBeVisible();
            expect(new URL(page.url()).searchParams.get('page')).toBe('settings');
            await cafe.settle();

            const mark = fake.log.length;
            const asked = page.waitForRequest(request => request.isNavigationRequest());
            const loaded = page.waitForEvent('load');
            fake.decentSync.push({ what: 'reload' });
            fake.flush();
            const navigation = await asked;
            await loaded;
            await page.locator('#cafe-strip .cafe-card').first().waitFor();
            await expect.poll(() => changesOpened(cafe), 'the fresh page opens the changes socket').toBe(2);
            await cafe.settle();

            expect(new URL(navigation.url()).searchParams.get('page'), 'the main page asked for').toBeNull();
            await expect(page.locator('#subpage-host #settings-content-area')).toBeHidden();
            const loadedAt = await loadedAtOf(page);
            expect(reports(cafe, mark).map(entry => [entry.status, entry.body]), 'the fresh page reports on load and as its socket opens').toEqual([[204, build(loadedAt)], [204, build(loadedAt)]]);
        });

        test('a plugin without the report answers 404, which is left at that, and the page goes on as before', async ({ cafe, fake }) => {
            fake.refuse({ method: 'PUT', path: /^\/api\/v1\/plugins\/decent-sync\.reaplugin\/page$/, status: 404, body: { error: 'Not found' } });
            const page = await openWithSocket(cafe);
            expect(reports(cafe).map(entry => entry.status), 'tried on load and as the socket opened').toEqual([404, 404]);

            await cafe.advance(30_000);
            expect(reports(cafe).length, 'and not again').toBe(2);
            await reopen(cafe, 2);
            expect(reports(cafe).length, 'until the socket opens again').toBe(3);
            await load(cafe, house);
            await expect(page.locator('#cafe-dial-label'), 'the Machine still served').toHaveText('Dial-in · saved to the recipe');
        });
    });

    test('with no Decent Sync, one report on load, answered 404 by Decaid, and none after', async ({ cafe, fake }) => {
        await cafe.open();
        await cafe.advance(30_000);
        expect(reports(cafe).map(entry => [entry.method, entry.status, entry.body]), 'Decaid answers for a plugin not there').toEqual([['PUT', 404, build(await loadedAtOf(cafe.page))]]);
        expect(changesOpened(cafe), 'and no socket to the plugin').toBe(0);
        expect(fake.decentSync).toBeNull();
    });
});
