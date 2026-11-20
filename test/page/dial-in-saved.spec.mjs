// What the dial-in column's label promises (docs/cafe/DESIGN.md, "Recipes and
// the strip"): with Decent Sync serving the Machine, "saved to the recipe" is
// true. A dose stepped on a loaded recipe is still that recipe's after another
// recipe is loaded and the first loaded again. Without Decent Sync the column
// says "not saved to the recipe", and the recipe's own dose comes back.
//
// The page saves nothing itself in either case. With Decent Sync the fake's
// plugin has DYE2 record the change at the next flush, as the real plugin does
// after each Workflow change (fake-decaid/decent-sync.js; recorded in
// recordings/decent-sync-saves.json). DYE2 writes it into the record and
// pushes on `changed` (fake-decaid/dye2.js; recordings/dye2-record.json).
//
// What stays out of the page tests is under "What no test covers" in
// docs/cafe/TESTING.md: the save reaching the server and the second tablet.

import { test, expect } from './support/test.mjs';
import { load, isWrite } from './support/page-reads.mjs';
import { recordOf, loadedId } from './support/fake-reads.mjs';
import { RECIPES } from './support/sample-data.mjs';
import { API_DEBOUNCE_MS } from '../../src/modules/workflow-watch.js';

const [house, single] = RECIPES;
const SAVED = 'Dial-in · saved to the recipe';
const NOT_SAVED = 'Dial-in · not saved to the recipe';

const isDye2Write = entry => isWrite(entry) && /^\/api\/v1\/(plugins|store)\/dye2\.reaplugin\//.test(entry.path);
const dose = async page => parseFloat(await page.locator('#dose-in-value').textContent());

/**
 * House espresso loaded, its dose stepped up once, then Single origin loaded
 * and House espresso loaded again. Answers the dose the record held, the dose
 * stepped and the log's length before the step.
 */
async function stepThenReload(cafe, label) {
    await cafe.open();
    await load(cafe, house);
    await expect(cafe.page.locator('#cafe-dial-label')).toHaveText(label);
    const held = recordOf(cafe.fake, house.name).dashboardVariables.dose;
    expect(await dose(cafe.page), 'the record\'s dose').toBe(held);
    const mark = cafe.fake.log.length;
    await cafe.page.locator('#dose-in-plus').click();
    const stepped = await dose(cafe.page);
    expect(stepped, 'stepped up').toBeGreaterThan(held);
    await cafe.advance(API_DEBOUNCE_MS + 500);
    await load(cafe, single);
    await load(cafe, house);
    expect(loadedId(cafe.fake), 'House espresso loaded again').toBe(recordOf(cafe.fake, house.name).id);
    return { held, stepped, mark };
}

test.describe('the dial-in column\'s promise', { tag: '@dialin-saved' }, () => {
    test.describe('with Decent Sync serving', () => {
        test.use({ decentSync: true });

        test('a dose stepped on a loaded recipe is the recipe\'s when it is loaded again', async ({ cafe, fake }) => {
            const { held, stepped, mark } = await stepThenReload(cafe, SAVED);
            expect(recordOf(fake, house.name).dashboardVariables.dose, 'the plugin had DYE2 save the step into the record').toBe(stepped);
            expect(await dose(cafe.page), 'loaded again, with the dose stepped').toBe(stepped);
            expect(fake.workflow().context.targetDoseWeight).toBe(stepped);
            await expect(cafe.page.locator('#cafe-dial-label')).toHaveText(SAVED);
            expect(cafe.since(mark, isDye2Write).filter(entry => !entry.path.endsWith('/selection')), 'the page wrote no record: the plugin did').toEqual([]);
            expect(held).not.toBe(stepped);
            await cafe.screenshot('dial-in-saved-light');
        });
    });

    test.describe('without Decent Sync', () => {
        test('the recipe\'s own dose comes back, as the column says', async ({ cafe, fake }) => {
            const { held, mark } = await stepThenReload(cafe, NOT_SAVED);
            expect(recordOf(fake, house.name).dashboardVariables.dose, 'the record as it was').toBe(held);
            expect(await dose(cafe.page), 'loaded again, with its own dose').toBe(held);
            expect(fake.workflow().context.targetDoseWeight).toBe(held);
            await expect(cafe.page.locator('#cafe-dial-label')).toHaveText(NOT_SAVED);
            expect(cafe.since(mark, isDye2Write).filter(entry => !entry.path.endsWith('/selection')), 'nothing written to DYE2 but the loads\' selections').toEqual([]);
        });
    });
});
