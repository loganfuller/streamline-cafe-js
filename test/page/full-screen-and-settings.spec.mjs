// The full-screen chart, Settings and back, and DYE2 switched off in Settings.
// With a recipe loaded, a tap on the graph puts the page in Streamline's zoomed
// layout (src/modules/chart.js, `openExpandedChart`) and a tap on the
// full-screen chart leaves it. Settings opens over the page, and leaving it
// (the browser's back) comes back to the page with the recipe still loaded and
// nothing written. DYE2 switched off while Settings is open: leaving it reloads
// the page (src/cafe/start.js, on `streamline:mainpagevisible`), which then
// lands on the "DYE2 is needed" screen, opens no machine socket, and Decaid's
// store holds the setting off (src/modules/settingsSync.js mirrors the write).
//
// Nothing here leans on a recorded scenario of its own: the recipe's load is
// DYE2's selection (fake-decaid/recordings/dye2-selection.json), and the
// setting's write is Decaid's key-value store (fake-decaid/store.js).

import { test, expect } from './support/test.mjs';
import { load, writes, legend } from './support/page-reads.mjs';
import { recordOf, matchMachine } from './support/fake-reads.mjs';
import { RECIPES } from './support/sample-data.mjs';

// The recipe loaded.
const target = RECIPES[1];
const SETTINGS = 'streamlineSettings';
const DYE2_ENABLED = 'streamline.dye2Enabled';
const MACHINE_SOCKETS = ['/ws/v1/machine/snapshot', '/ws/v1/machine/shotState'];

/** The page open with the recipe loaded afresh, as stored, and not called changed. */
async function openLoaded(cafe) {
    matchMachine(cafe.fake, target.name);
    await cafe.open();
    await load(cafe, target);
    expect(cafe.fake.selection(), 'the recipe is loaded, and not as changed').toEqual({ kind: 'recipe', id: recordOf(cafe.fake, target.name).id, modified: false });
    return cafe.page;
}

async function openSettings(cafe) {
    await cafe.page.locator('#settings-btn').click();
    await expect(cafe.page.locator('#subpage-host #settings-content-area')).toBeVisible();
    await cafe.settle();
}

/** Leaves Settings with the browser's back, onto a page that reloads itself. */
async function backToReload(cafe) {
    const { page } = cafe;
    // A mark on this document, which a reload leaves behind.
    await page.evaluate(() => { window.__cafeBeforeReload = true; });
    await page.goBack();
    await expect(page.locator('#main-page.cafe-gated')).toBeVisible();
    await cafe.settle();
    expect(await page.evaluate(() => window.__cafeBeforeReload ?? null), 'the page reloaded').toBeNull();
}

/** The "DYE2 is needed" screen for the setting off, and nothing started behind it. */
async function expectGatedOff(cafe) {
    const { page, fake } = cafe;
    await expect(page.locator('#cafe-gate-line')).toHaveText('DYE2 is turned off in Settings');
    await cafe.advance(2000);
    await expect(page.locator('#main-page.cafe-gated')).toBeVisible();
    await expect(page.locator('#cafe-strip .cafe-card'), 'no card drawn').toHaveCount(0);
    await expect.poll(() => MACHINE_SOCKETS.filter(path => cafe.routes.sockets.has(path)), 'no machine socket open').toEqual([]);
    expect(fake.store.get(SETTINGS, DYE2_ENABLED), 'still off after the reload').toBe('false');
}

test.describe('the full-screen chart, Settings and back', { tag: '@fullscreen' }, () => {
    test('a tap on the graph opens the full-screen chart, and a tap on it comes back', async ({ cafe }) => {
        const page = await openLoaded(cafe);
        // A Shot with the recipe in the graph (the sample data's Shots name no
        // recipe).
        await cafe.pour();
        await cafe.untilStored();
        await cafe.storeShot();
        await cafe.advance(4000);
        await expect.poll(async () => (await legend(page)).label, 'the Shot is the latest in the graph').toBe('Latest');
        await expect(page.locator('#plotly-chart')).toBeVisible();
        await expect(page.locator('#shot-settings')).toBeVisible();

        await page.locator('#plotly-chart').click();
        await expect(page.locator('#main-page.chart-zoomed')).toBeAttached();
        await cafe.advance(500);
        await expect(page.locator('#expanded-chart'), 'the full-screen chart').toBeVisible();
        await expect(page.locator('#expanded-chart canvas').first(), 'drawn').toBeVisible();
        await expect(page.locator('#shot-settings'), 'the dial-in column gives way to it').toBeHidden();
        await expect(page.locator('#cafe-title'), 'the header stays').toHaveText(target.name);
        await cafe.screenshot('page-chart-full-screen-light');

        await page.locator('#expanded-chart').click();
        await expect(page.locator('#main-page:not(.chart-zoomed)')).toBeAttached();
        await cafe.advance(500);
        await expect(page.locator('#shot-settings')).toBeVisible();
        await expect(page.locator('#plotly-chart')).toBeVisible();
        await expect(page.locator('#expanded-chart')).toBeHidden();
    });

    test('Settings opens, and leaving it comes back to the page, the recipe still loaded and nothing written', async ({ cafe, fake }) => {
        const page = await openLoaded(cafe);
        const selection = fake.selection();
        const workflow = fake.workflow();
        const record = recordOf(fake, target.name);
        const mark = fake.log.length;

        await openSettings(cafe);
        await cafe.advance(1000);
        await page.evaluate(() => { window.__cafeBeforeSettings = true; });
        await page.goBack();
        await expect(page.locator('#cafe-header')).toBeVisible();
        await expect(page.locator('#cafe-title')).toHaveText(target.name);
        await cafe.advance(2000);

        expect(await page.evaluate(() => window.__cafeBeforeSettings ?? null), 'the same page, not a reload of it').toBe(true);
        await expect(page.locator('#main-page.cafe-gated')).toHaveCount(0);
        expect(fake.selection(), 'DYE2 still has the recipe loaded').toEqual(selection);
        expect(fake.workflow(), 'the Workflow as it was').toEqual(workflow);
        expect(recordOf(fake, target.name), 'the record as it was').toEqual(record);
        // Settings keeps where it was left (src/settings/settings-location.js),
        // a synced setting of Streamline's own; nothing else is written.
        expect(writes(cafe.since(mark)), 'nothing written but Settings\' own place').toEqual([
            { write: `POST /api/v1/store/${SETTINGS}/streamline.settings.location`, body: JSON.stringify({ mainCategory: 'quickadjustments', category: 'flowmultiplier' }) },
        ]);
        // A page error fails the test at its end (support/test.mjs).
    });

    test('DYE2 switched off in Settings: leaving it reloads the page onto the "DYE2 is needed" screen', async ({ cafe, fake }) => {
        const page = await openLoaded(cafe);
        expect(fake.store.get(SETTINGS, DYE2_ENABLED), 'the setting is on to start with').toBe('true');

        await openSettings(cafe);
        // Switched off by the write Streamline's own toggle makes
        // (src/settings/settings.js, `setupDye2Extra`). The toggle itself is
        // the fixme test below.
        const mark = fake.log.length;
        await page.evaluate(key => localStorage.setItem(key, 'false'), DYE2_ENABLED);
        await cafe.settle();
        expect(fake.store.get(SETTINGS, DYE2_ENABLED), 'Decaid\'s store holds the setting off').toBe('false');
        expect(writes(cafe.since(mark)), 'the one write: the setting, to Decaid\'s store').toEqual([
            { write: `POST /api/v1/store/${SETTINGS}/${DYE2_ENABLED}`, body: 'false' },
        ]);

        await backToReload(cafe);
        await expectGatedOff(cafe);
    });

    // Fake gap: Settings' Extensions mounts Streamline's legacy settings page,
    // whose reads of GET /api/v1/machine/cupWarmer, /api/v1/presence/schedules,
    // /api/v1/webui/skins/default and /api/v1/account/decent the fake Decaid
    // has no answer for.
    test.fixme('DYE2 switched off with Settings\' own DYE2 toggle: leaving it reloads onto the "DYE2 is needed" screen', async ({ cafe, fake }) => {
        const page = await openLoaded(cafe);
        await openSettings(cafe);
        await page.locator('#extensions-btn').click();
        await cafe.advance(500);
        await page.locator('#sub-categories-panel .settings-subnav-btn[data-category="plugin:dye2.reaplugin"]').click();
        await cafe.advance(500);
        const toggle = page.locator('#dye2-enabled');
        await expect(toggle).toBeChecked();
        await toggle.locator('xpath=..').click();
        await expect(toggle).not.toBeChecked();
        await cafe.settle();
        expect(fake.store.get(SETTINGS, DYE2_ENABLED), 'Decaid\'s store holds the setting off').toBe('false');

        await backToReload(cafe);
        await expectGatedOff(cafe);
    });
});
