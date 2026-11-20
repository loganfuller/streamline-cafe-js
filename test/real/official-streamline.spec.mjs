// Official Streamline on the same Decaid as the cafe page, and back: the
// settings the two skins share in Decaid's store are kept, and Streamline's
// strip mode is as Streamline left it, though the cafe page arranged DYE2's
// strip in between. Streamline is the pinned commit (fake-decaid/pins.json),
// served at another origin and calling the same Decaid, as a skin switched to
// on the tablet would.
//
// The journey puts back what it changes: Streamline's strip mode, and DYE2's
// records should the strip not be arranged back as it was.

import { test, expect, shoot, loadByCard, record, card, untilStripSettled } from './support/journey.mjs';
import { startClean, holdAndPick } from './support/decaid-helpers.mjs';
import { RECIPES } from '../page/support/sample-data.mjs';

const [house, , decaf] = RECIPES;
const DYE2_ON = '/store/streamlineSettings/streamline.dye2Enabled';
const STRIP_MODE = '/store/streamlineSettings/streamline.dyeStripMode';
const RECORDS = '/store/dye2.reaplugin/recipes';

const cardName = (page, slot) => card(page, slot).locator('.cafe-card-name');

test.describe('official Streamline on the same Decaid, and back', { tag: '@real-streamline' }, () => {
    test('Streamline finds DYE2 on and keeps its strip mode R in Decaid\'s store; the cafe page arranges the strip and leaves both; Streamline then shows the strip in R with slots 1 to 5', async ({ stacks, tablet }) => {
        const side = stacks.decaid;
        await startClean(side);
        const modeBefore = await side.decaid('GET', STRIP_MODE);
        const recordsBefore = await side.decaid('GET', RECORDS);
        try {
            // Streamline, on the same Decaid: DYE2 on is the setting the two skins share.
            const streamline = await tablet(side, { streamline: true });
            await expect(streamline.locator('#dye-toggle-R'), 'Streamline finds DYE2 on').toBeVisible({ timeout: 30_000 });
            expect(await side.decaid('GET', DYE2_ON), 'the shared setting').toBe('true');
            await streamline.locator('#dye-toggle-R').click();
            await expect.poll(() => side.decaid('GET', STRIP_MODE), { message: 'Streamline\'s strip mode, set to R there, is in Decaid\'s store' }).toBe('R');
            await streamline.context().close();

            // The cafe page after it: a recipe loaded, and the strip arranged, a
            // recipe taken out of its slot and chosen back into it.
            const page = await tablet(side);
            await loadByCard(page, side, house);
            await untilStripSettled(page);
            await holdAndPick(page, decaf.slot, 'Remove from slot');
            await expect(card(page, decaf.slot), 'the slot is empty').not.toContainText(decaf.name);
            await expect.poll(async () => (await record(side, decaf.name)).stripSlot ?? null, { message: 'DYE2\'s record leaves the slot' }).not.toBe(decaf.slot);
            await holdAndPick(page, decaf.slot, 'Choose a recipe…');
            await expect(page.locator('#cafe-recipe-dialog')).toHaveAttribute('open');
            await page.locator('#cafe-recipe-list .cafe-recipe-row').filter({ hasText: decaf.name }).click();
            await expect(page.locator('#cafe-recipe-dialog')).not.toHaveAttribute('open');
            await expect(cardName(page, decaf.slot), 'the cafe page arranged its strip').toHaveText(decaf.name);
            await expect.poll(async () => (await record(side, decaf.name)).stripSlot, { message: 'DYE2\'s record is back in its slot' }).toBe(decaf.slot);
            expect(await side.decaid('GET', RECORDS), 'and DYE2\'s records are as they were').toEqual(recordsBefore);
            expect(await side.decaid('GET', STRIP_MODE), 'the cafe page, used after it, leaves the strip mode at R').toBe('R');
            expect(await side.decaid('GET', DYE2_ON), 'the cafe page still finds DYE2 on').toBe('true');
            await page.context().close();

            // Back on Streamline: its strip in R, as it was left, with the recipes in slots 1 to 5.
            const again = await tablet(side, { streamline: true });
            await expect(again.locator('#dye-toggle-R')).toBeVisible({ timeout: 30_000 });
            // A fresh browser: the mode comes from Decaid's store, not the page's own storage.
            await expect(again.locator('#dye-toggle-R'), 'the strip in R mode, as it was left').toHaveClass(/bg-\[var\(--button-primary-bg\)\]/);
            await expect(again.locator('#dye-strip')).toBeVisible();
            await expect(again.locator('#machine-status'), 'Streamline has the machine').not.toHaveText(/Connecting/);
            const names = RECIPES.filter(recipe => recipe.slot <= 5).map(recipe => recipe.name);
            await expect.poll(async () => {
                const shown = await again.locator('#dye-strip button').allTextContents();
                return names.every(name => shown.some(text => text.includes(name)));
            }, { message: `Streamline's strip shows ${names.join(', ')}` }).toBe(true);
            await shoot(again, 'real-streamline-after-cafe');
        } finally {
            if (modeBefore === null) await side.decaid('DELETE', STRIP_MODE);
            else await side.decaid('POST', STRIP_MODE, modeBefore);
            // The fixture's write, should the strip not have been arranged back.
            const slotsNow = (await side.decaid('GET', RECORDS)).map(row => [row.id, row.stripSlot]);
            if (JSON.stringify(slotsNow) !== JSON.stringify(recordsBefore.map(row => [row.id, row.stripSlot]))) await side.decaid('POST', RECORDS, recordsBefore);
            await side.decaid('POST', '/plugins/dye2.reaplugin/selection', {});
        }
    });
});
