// The "DYE2 is needed" screen (docs/cafe/DESIGN.md, "Recipes and the strip";
// once steps 1 and 2 of the smoke run): the card that takes the page's place
// while DYE2 is older than the page needs, not installed, installed but not
// loaded, or switched off in Streamline's settings. In each case nothing is
// drawn behind it, no recipe is read or loaded and nothing is installed;
// Settings opens the settings page and leaving it comes back to the check;
// Reload runs the check again; "Turn DYE2 on" writes the setting and the page
// starts (src/cafe/dye2-gate.js, gate-screen.js, start.js).
//
// What the gate reads is the model's state, set before the page opens:
// Decaid's plugin list (`fake.plugins`; DYE2 disabled and enabled through it,
// fake-decaid/recordings/dye2-plugin.json) and Streamline's synced setting in
// Decaid's store (`streamlineSettings`, `streamline.dye2Enabled`, held as the
// string "true" in the sample data). The older DYE2 is the plugin list's
// version; that the DYE2 Decaid installs is at least the minimum is the weekly
// run's (#62), not a page test.

import { test, expect } from './support/test.mjs';
import { paint } from './support/page-reads.mjs';
import { compareVersions } from '../../src/modules/skin-version.js';
import { DYE2_PLUGIN_ID, MIN_DYE2_VERSION } from '../../src/cafe/dye2-gate.js';

const SETTINGS = 'streamlineSettings';
const ENABLED = 'streamline.dye2Enabled';
// What a fresh Decaid v0.9.2 bundles: older than the page needs.
const BUNDLED_DYE2 = '0.1.37';

const TITLE = 'Streamline Cafe needs DYE2';
const OLDER = `DYE2 is older than v${MIN_DYE2_VERSION}`;
const NOT_INSTALLED = "DYE2 isn't installed";
const NOT_LOADED = 'DYE2 is installed but not loaded';
const SETTING_OFF = 'DYE2 is turned off in Settings';

const line = page => page.locator('#cafe-gate-line');
// A recipe read or loaded, or a plugin installed, as the smoke run looked for.
const touches = entry => /dye2\.reaplugin\/(recipes|selection)|\/plugins\/install/.test(entry.path)
    || (entry.method === 'PUT' && /\/workflow$/.test(entry.path));

const dye2 = fake => fake.plugins.find(plugin => plugin.id === DYE2_PLUGIN_ID);
const removeDye2 = fake => fake.plugins.splice(fake.plugins.indexOf(dye2(fake)), 1);
const settingOff = fake => fake.store.set(SETTINGS, ENABLED, 'false');

/** Opens on the gate in `theme`, past when the page would have read its recipes. */
async function openGate(cafe, theme = 'light') {
    await cafe.openGated();
    await paint(cafe.page, theme);
    await cafe.advance(2000);
    return cafe.page;
}

/**
 * The gate took the page's place: its line, its title, nothing behind it,
 * Reload and Settings offered, no recipe read or loaded, nothing installed,
 * and no error on the page (run.mjs `checkGate`'s six checks).
 */
async function expectGate(cafe, text) {
    const { page, fake } = cafe;
    await expect(page.locator('#main-page')).toHaveClass(/\bcafe-gated\b/);
    await expect(line(page)).toHaveText(text);
    await expect(page.locator('#cafe-gate-title')).toHaveText(TITLE);
    for (const behind of ['#cafe-header', '#shot-settings', '#chart-wrap']) await expect(page.locator(behind), `${behind} is not drawn`).toBeHidden();
    await expect(page.locator('#cafe-gate-reload')).toBeVisible();
    await expect(page.locator('#cafe-gate-settings')).toBeVisible();
    expect(fake.log.filter(touches).map(e => `${e.method} ${e.path}`), 'no recipe read or loaded, nothing installed').toEqual([]);
    expect(cafe.errors, 'no page error').toEqual([]);
}

/** The plugin hint and "Turn DYE2 on": the hint for a plugin problem, the button for the setting. */
async function expectWayOut(page, { turnOn }) {
    await expect(page.locator('#cafe-gate-turn-on')).toBeVisible({ visible: turnOn });
    await expect(page.locator('#cafe-gate-hint')).toBeVisible({ visible: !turnOn });
}

test.describe('the "DYE2 is needed" screen', { tag: '@gate' }, () => {
    test('an older DYE2: the line names the version needed, it says where to update, and offers no button for the setting', async ({ cafe, fake }) => {
        expect(compareVersions(BUNDLED_DYE2, MIN_DYE2_VERSION), 'the bundled DYE2 is older than the minimum').toBeLessThan(0);
        dye2(fake).version = BUNDLED_DYE2;
        const page = await openGate(cafe);
        await expectGate(cafe, OLDER);
        await expectWayOut(page, { turnOn: false });
        await expect(page.locator('#cafe-gate-hint')).toHaveText('Install or update DYE2 in Decaid, under Plugins.');
        await cafe.screenshot('gate-older-dye2');
    });

    for (const theme of ['light', 'dark']) {
        test(`DYE2 not installed (${theme})`, async ({ cafe, fake }) => {
            removeDye2(fake);
            const page = await openGate(cafe, theme);
            await expectGate(cafe, NOT_INSTALLED);
            await expectWayOut(page, { turnOn: false });
            await cafe.screenshot(`gate-not-installed-${theme}`);
        });
    }

    test('DYE2 not installed: Settings opens the settings page, and leaving it comes back to the check', async ({ cafe, fake }) => {
        removeDye2(fake);
        const page = await openGate(cafe);
        await page.locator('#cafe-gate-settings').click();
        await expect(page.locator('#subpage-host #settings-content-area')).toBeVisible();
        const mark = fake.log.length;
        await page.goBack();
        await expect(page.locator('#subpage-host #settings-content-area')).toBeHidden();
        await expect(page.locator('#main-page')).toHaveClass(/\bcafe-gated\b/);
        await cafe.advance(2000);
        expect(cafe.since(mark, entry => entry.method === 'GET' && entry.path === '/api/v1/plugins'), 'the check ran again: the plugin list read again').toHaveLength(1);
        await expectGate(cafe, NOT_INSTALLED);
    });

    test('installed but not loaded; enabled in Decaid with the setting off, Reload runs the check again and lands on the setting', async ({ cafe, fake }) => {
        fake.disableDye2();
        settingOff(fake);
        const page = await openGate(cafe);
        await expectGate(cafe, NOT_LOADED);
        await expectWayOut(page, { turnOn: false });
        await cafe.screenshot('gate-not-loaded');

        fake.enableDye2();
        const mark = fake.log.length;
        await page.locator('#cafe-gate-reload').click();
        await expect(line(page)).toHaveText(SETTING_OFF);
        await cafe.advance(2000);
        expect(cafe.since(mark, entry => entry.method === 'GET' && entry.path === '/api/v1/plugins'), 'the plugin list read again').toHaveLength(1);
        await expectGate(cafe, SETTING_OFF);
        await expectWayOut(page, { turnOn: true });
    });

    test('installed but not loaded; enabled in Decaid with the setting on, Reload starts the page', async ({ cafe, fake }) => {
        fake.disableDye2();
        const page = await openGate(cafe);
        await expectGate(cafe, NOT_LOADED);

        fake.enableDye2();
        await page.locator('#cafe-gate-reload').click();
        await expect(page.locator('#cafe-strip .cafe-card').first()).toBeVisible();
        await expect(page.locator('#main-page')).not.toHaveClass(/\bcafe-gated\b/);
        await expect(page.locator('#cafe-header')).toBeVisible();
        await cafe.advance(2000);
        expect(fake.log.some(entry => entry.method === 'GET' && /dye2\.reaplugin\/selection$/.test(entry.path)), 'the started page reads DYE2\'s selection').toBe(true);
    });

    for (const theme of ['dark', 'light']) {
        test(`the setting off (${theme}): "Turn DYE2 on" is offered, and no plugin hint`, async ({ cafe, fake }) => {
            settingOff(fake);
            const page = await openGate(cafe, theme);
            await expectGate(cafe, SETTING_OFF);
            await expectWayOut(page, { turnOn: true });
            await cafe.screenshot(`gate-setting-off-${theme}`);
        });
    }

    test('the setting off: "Turn DYE2 on" starts the page, and the setting is on in Decaid\'s store, where Streamline reads it too', async ({ cafe, fake }) => {
        settingOff(fake);
        const page = await openGate(cafe);
        await expectGate(cafe, SETTING_OFF);
        await page.locator('#cafe-gate-turn-on').click();
        await expect(page.locator('#cafe-strip .cafe-card').first()).toBeVisible();
        await expect(page.locator('#cafe-header')).toBeVisible();
        await expect.poll(async () => {
            await cafe.advance(500);
            return fake.store.get(SETTINGS, ENABLED);
        }).toBe('true');
    });
});
