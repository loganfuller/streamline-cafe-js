// A Capture-only Machine and back, with Decent Sync's plugin (docs/cafe/
// DESIGN.md, "The reference with Decent Sync" and "The Location's Shots"; the
// page's half of the second smoke run's "9." in run-decent-sync.mjs, SMOKE.md's
// S10): a served Machine draws Decent Sync's Reference Shot and never the
// choice kept on the tablet. Its sharing turned off on the server, the page
// learns it at its next Status ask, which a recipe load makes, and falls back to
// the tablet's own choice, flagged "Different profile" where it is on another
// Profile, with Make reference live and the column reading "not saved to the
// recipe". There Make reference, and Replace, keep the choice on the tablet and
// ask the plugin nothing; the Shots list is the tablet's own, from Decaid,
// headed "This machine only" with the line saying why. Sharing on again, the
// next ask brings Decent Sync's Reference Shot back, and "saved to the recipe".
// A Machine on the wrong hardware (`hardwareMismatch`) is not served either,
// and falls back the same way.
//
// Decent Sync's plugin is the fake's (fake-decaid/decent-sync.js), from
// recordings/decent-sync.json: House espresso's Reference Shot on the server is
// chosen here as Shot C (Sample Machine Two's, "Second Barista"), so the
// server's reference and the tablet's are told apart on the page. The tablet's
// choice, in Decaid's store, is Shot B (this tablet's, Single origin, another
// Profile than House espresso's, "Sample Barista"). House espresso's latest is
// Shot A. Sharing turned off pushes nothing, so the page hears it only by
// asking; turned on again, every slotted Recipe's reference is pushed, which
// may bring the server's Reference Shot before the next ask does.
//
// What stays in the real journey: that the server takes the Machine's sharing
// off and on (`PUT /machines/<id>/sharing`) and the plugin's Status follows it,
// and that the server's Reference Shot is left as it was by the tablet's choice
// (here read off the fake's model, which does not prove the server's).

import { test, expect } from './support/test.mjs';
import { legend, shotsHeader, load } from './support/page-reads.mjs';
import { recordOf } from './support/fake-reads.mjs';
import { recording } from './support/adapter.mjs';
import { NOT_AT_A_LOCATION } from '../../src/cafe/shot-list.js';
import { RECIPES } from '../cafe-smoke/sample-data.mjs';

const [house, single] = RECIPES;
const CAFE = 'streamlineCafe';
const REFERENCES_KEY = 'references';
const REFERENCES = `/api/v1/store/${CAFE}/${REFERENCES_KEY}`;
const PLUGIN = '/api/v1/plugins/decent-sync.reaplugin';
const SAVED = 'Dial-in · saved to the recipe';
const NOT_SAVED = 'Dial-in · not saved to the recipe';
const TABLET_COLUMNS = ['Pulled', 'Recipe', 'Dose → yield', 'Rating', 'Barista', 'Note'];
const { A, B, C } = recording('decent-sync').labels;

// ── On the page ──────────────────────────────────────────────────────────────

const label = page => page.locator('#cafe-dial-label');
const dialog = page => page.locator('#cafe-shots-dialog');

/** Each row of the open list: its Shot, and the Location's cells where they show. */
const listRows = page => page.evaluate(() => [...document.querySelectorAll('#cafe-shots-list .cafe-shots-row')].map(row => {
    const visible = selector => { const cell = row.querySelector(selector); return cell && cell.offsetParent !== null ? cell.textContent.trim() : null; };
    return {
        id: row.dataset.shotId,
        machine: visible('.cafe-shots-machine-name'),
        duration: visible('.cafe-shots-duration'),
        unfinished: !!row.querySelector('.cafe-shots-unfinished'),
        chip: !!row.querySelector('.cafe-shots-chip'),
    };
}));

/** The Status asks since `mark`. */
const statusAsks = (cafe, mark) => cafe.since(mark, entry => entry.method === 'GET' && entry.path === `${PLUGIN}/status`).length;

/**
 * Another recipe loaded, then House espresso again: each load asks the status
 * again (src/cafe/page.js, `afterRecipeLoad`), as the smoke run had it.
 */
async function reloadHouse(cafe) {
    const mark = cafe.fake.log.length;
    await load(cafe, single);
    await load(cafe, house);
    expect(statusAsks(cafe, mark), 'the loads asked the status again').toBeGreaterThan(0);
}

/** The page open on House espresso, served, with C its Reference Shot on the server and B the tablet's choice. */
async function openServed(cafe, fake) {
    const houseId = String(recordOf(fake, house.name).id);
    fake.decentSync.chooseReference(houseId, C);
    fake.store.set(CAFE, REFERENCES_KEY, { [houseId]: B });
    const page = await cafe.open();
    await load(cafe, house);
    await expect(label(page)).toHaveText(SAVED);
    await expect.poll(async () => (await legend(page)).reference, 'Decent Sync\'s Reference Shot').toMatch(/Second Barista$/);
    const now = await legend(page);
    expect(now).toMatchObject({ label: 'Latest', flag: null, badge: null, make: 'Make reference', muted: false });
    expect(cafe.since(0, entry => entry.path === REFERENCES), 'the choice kept on the tablet is never read on a served Machine').toEqual([]);
    return { page, houseId };
}

/** The legend drawing the tablet's choice, B: flagged, Make reference live. */
async function expectTabletChoice(page) {
    await expect.poll(async () => (await legend(page)).flag, 'the tablet\'s own choice, on another Profile').toBe('Different profile');
    const now = await legend(page);
    expect(now.reference, 'B, the tablet\'s choice').toMatch(/Sample Barista$/);
    expect(now).toMatchObject({ label: 'Latest', badge: null, make: 'Make reference', muted: false, notice: null });
    await expect(label(page)).toHaveText(NOT_SAVED);
}

test.describe('a Capture-only Machine and back', { tag: '@sync-capture' }, () => {
    test.use({ decentSync: true });

    /** The page open served, then sharing turned off on the server and the status asked again: the tablet's choice drawn. */
    async function openCaptureOnly(cafe, fake) {
        const opened = await openServed(cafe, fake);
        // No push: the page goes on as served until it asks.
        fake.decentSync.setSharing(false);
        await reloadHouse(cafe);
        await expectTabletChoice(opened.page);
        return opened;
    }

    test('sharing off: the tablet\'s own choice at the next ask, and Make reference with Replace keeps the choice on the tablet', async ({ cafe, fake }) => {
        const { page, houseId } = await openCaptureOnly(cafe, fake);
        expect(cafe.since(0, entry => entry.method === 'GET' && entry.path === REFERENCES).length, 'the choice kept on the tablet was read').toBeGreaterThan(0);
        await cafe.screenshot('sync-capture-only-light');

        // Make reference on the latest, A, replacing B: kept on the tablet, the plugin asked nothing.
        const mark = fake.log.length;
        await page.locator('#cafe-make-reference').click();
        await expect(page.locator('#cafe-reference-dialog-replace')).toBeVisible();
        await page.locator('#cafe-reference-dialog-replace').click();
        await expect.poll(async () => (await legend(page)).badge).toBe('This shot is the reference');
        await cafe.advance(2000);
        expect(fake.store.get(CAFE, REFERENCES_KEY)?.[houseId], 'A is the tablet\'s choice now').toBe(A);
        const sent = cafe.since(mark, entry => entry.method !== 'GET');
        expect(sent.filter(entry => entry.method === 'POST' && entry.path === REFERENCES), 'the choice written into Decaid\'s store').toHaveLength(1);
        expect(sent.filter(entry => entry.path.startsWith(PLUGIN)).map(entry => `${entry.method} ${entry.path}${entry.search}`), 'and nothing sent to the plugin').toEqual([]);
        expect(fake.decentSync.recipe(houseId).referenceShotId, 'the server\'s Reference Shot as it was').toBe(C);
    });

    test('sharing off: the Shots list is the tablet\'s own, from Decaid, headed "This machine only" with the line saying why', async ({ cafe, fake }) => {
        const { page, houseId } = await openCaptureOnly(cafe, fake);
        // The tablet's list chips a Shot as its own recipe's reference only
        // (DESIGN.md, "A row"): B, pulled with Single origin, chosen for it too.
        fake.store.set(CAFE, REFERENCES_KEY, { [houseId]: B, [String(recordOf(fake, single.name).id)]: B });
        const mark = fake.log.length;
        await page.locator('#cafe-shots-btn').click();
        await expect(dialog(page)).toHaveAttribute('open', '');
        await cafe.settle();
        await expect(page.locator('#cafe-shots-list .cafe-shots-row').first()).toBeVisible();
        await expect(page.locator('#cafe-shots-under')).toHaveText('This machine only');
        expect(await shotsHeader(page)).toEqual({ title: 'Shots', under: 'This machine only', line: NOT_AT_A_LOCATION, columns: TABLET_COLUMNS });
        const rows = await listRows(page);
        expect(rows.map(row => row.id), 'Decaid\'s own Shots, newest first, with no other Machine\'s').toEqual(fake.shots.newest(50).map(shot => shot.id));
        expect(rows.map(row => row.id), 'no Shot of Sample Machine Two').not.toContain(C);
        expect(rows.every(row => row.machine === null && row.duration === null && !row.unfinished), 'no Machine or Time cell, no Unfinished mark').toBe(true);
        expect(rows.filter(row => row.chip).map(row => row.id), 'the chip on the tablet\'s choice, read from Decaid\'s store').toEqual([B]);
        const reads = cafe.since(mark, entry => entry.method === 'GET');
        expect(reads.filter(entry => entry.path === '/api/v1/shots' && new URLSearchParams(entry.search).get('limit') === '50'), 'one read of Decaid\'s list').toHaveLength(1);
        expect(reads.filter(entry => entry.path === `${PLUGIN}/shots`), 'and none of the plugin\'s').toEqual([]);
        await cafe.screenshot('sync-shots-capture-only-light');
    });

    test('sharing on again: Decent Sync\'s Reference Shot at the next ask, "saved to the recipe", with no reload', async ({ cafe, fake }) => {
        const { page } = await openCaptureOnly(cafe, fake);
        await page.evaluate(() => { window.__sameDocument = true; });
        fake.decentSync.setSharing(true);
        await reloadHouse(cafe);
        await expect(label(page)).toHaveText(SAVED);
        await expect.poll(async () => (await legend(page)).reference, 'Decent Sync\'s Reference Shot again').toMatch(/Second Barista$/);
        expect(await legend(page)).toMatchObject({ label: 'Latest', flag: null, badge: null, make: 'Make reference', muted: false });
        expect(await page.evaluate(() => window.__sameDocument === true), 'with no reload').toBe(true);
    });

    test('the wrong hardware is not served either: the tablet\'s own choice, "not saved to the recipe"', async ({ cafe, fake }) => {
        const { page } = await openServed(cafe, fake);
        fake.decentSync.setState('hardwareMismatch');
        await reloadHouse(cafe);
        await expectTabletChoice(page);
    });
});
