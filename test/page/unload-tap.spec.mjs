// A tap on the loaded card unloads it (docs/cafe/DESIGN.md, "Recipes and the
// strip"; once step 24 of the smoke run, #53), on a page at 1920 by 1200 and on
// one at 1340 by 800: the tap clears DYE2's selection alone, and the page is the
// no-recipe page with the machine set as it was; a step afterwards reaches the
// Workflow and no record; a tap loads the recipe again as stored; a double tap
// on another card leaves that recipe loaded; during a shot no card takes a tap;
// tapped just after a pour, the unload waits for Decaid to store the Shot, which
// names the recipe; and an unload DYE2 refuses is a toast, the recipe still
// loaded.
//
// What DYE2 does with the page's `POST selection {}` (it writes the Workflow's
// recipeId alone, and answers the selection it derives: a recent favourite the
// Workflow matches, or null) is the recorded scenario
// fake-decaid/recordings/dye2-selection.json. That Decaid stores the Shot about
// 4 s after the pour, with the Workflow as it is then, is the recorded pour
// (fake-decaid/recordings/pour.json): `cafe.untilStored()` moves the page's
// clock on that long, and `cafe.storeShot()` is the store.

import { test, expect } from './support/test.mjs';
import { card, writes, legend } from './support/page-reads.mjs';
import { records, recordOf, loadedId } from './support/fake-reads.mjs';
import { RECIPES } from '../cafe-smoke/sample-data.mjs';
import { UNLOAD_HOLD_MS } from '../../src/cafe/recipe-loader.js';
import { SHOT_STORE_MS } from '../../src/cafe/barista-model.js';

const [house, single] = RECIPES;
const SIZES = [{ width: 1920, height: 1200 }, { width: 1340, height: 800 }];
const SELECTION = '/api/v1/plugins/dye2.reaplugin/selection';
const UNLOAD = { write: `POST ${SELECTION}`, body: {} };

// ── Reads ────────────────────────────────────────────────────────────────────

/** The Workflow without the marker that says which recipe is loaded: what the machine is set to. */
function settings(workflow) {
    const copy = structuredClone(workflow);
    if (copy.context?.extras?.dye) delete copy.context.extras.dye.recipeId;
    return copy;
}

/** The writes a load or unload is made of, or must not be: the Workflow, DYE2's routes and its store. */
const recipeWrites = entries => writes(entries).filter(({ write }) => /^PUT \/api\/v1\/workflow$|^POST \/api\/v1\/plugins\/dye2\.reaplugin\/|^POST \/api\/v1\/store\/dye2\.reaplugin\//.test(write));

const pressed = page => page.locator('#cafe-strip .cafe-card[aria-pressed="true"]');
const title = page => page.locator('#cafe-title');
const toast = page => page.locator('#app-toast');

/**
 * What DYE2 answers once no recipe is loaded: the first of its recent
 * favourites the Workflow matches, or null (dye2-selection.json, which shows
 * both). Neither sample recipe is the sample favourite's bean, profile and
 * grinder, so none matches.
 */
const NO_RECIPE = null;

/** A tap on a recipe's card, and the load settled with the card pressed. */
async function load(cafe, recipe) {
    const { page } = cafe;
    await card(page, recipe.slot).click();
    await expect(title(page)).toHaveText(recipe.name);
    await expect(card(page, recipe.slot)).toHaveAttribute('aria-pressed', 'true');
    await cafe.advance(2000);
}

/** The page open with a recipe loaded, the one card pressed. */
async function openLoaded(cafe, recipe) {
    const page = await cafe.open();
    await load(cafe, recipe);
    const record = recordOf(cafe.fake, recipe.name);
    expect(loadedId(cafe.fake), `${recipe.name} is loaded`).toBe(record.id);
    await expect(pressed(page), 'one card pressed').toHaveCount(1);
    return record;
}

/** The no-recipe page: its title band, the dial-in's label, and no card pressed. */
async function expectNoRecipePage(page) {
    await expect(title(page)).toHaveText('No recipe selected');
    await expect(page.locator('#cafe-subtitle')).toHaveText('Tap a recipe to load it');
    await expect(page.locator('#cafe-dial-label')).toHaveText('Dial-in · not saved to a recipe');
    await expect(pressed(page)).toHaveCount(0);
}

test.describe('a tap on the loaded card unloads it', { tag: '@unload' }, () => {
    for (const viewport of SIZES) {
        // The smoke run's names: unload-before-1920x1200-light and the like.
        const size = `${viewport.width}x${viewport.height}`;

        test.describe(size, () => {
            test.use({ viewport });

            test('the tap clears DYE2\'s selection alone; a step then reaches the Workflow only; a tap loads the recipe as stored', async ({ cafe, fake }) => {
                const record = await openLoaded(cafe, house);
                const page = cafe.page;
                const loadedWorkflow = fake.workflow();
                const recordsBefore = records(fake);
                await cafe.screenshot(`unload-before-${size}-light`);

                // The tap.
                const doseShown = await page.locator('#dose-in-value').textContent();
                const mark = fake.log.length;
                await card(page, house.slot).click();
                await expectNoRecipePage(page);
                await cafe.advance(2500);
                expect(fake.selection(), 'DYE2\'s selection names no recipe').toEqual(NO_RECIPE);
                expect(fake.workflow().context.extras.dye.recipeId, 'the Workflow\'s marker is cleared').toBeNull();
                await expectNoRecipePage(page);
                expect((await legend(page)).label, 'the graph shows the last shot').toBe('Last shot');
                expect(settings(fake.workflow()), 'the machine is set as it was').toEqual(settings(loadedWorkflow));
                await expect(page.locator('#dose-in-value'), 'and the stepper shows it').toHaveText(doseShown);
                expect(writes(cafe.since(mark)), 'one write, DYE2\'s selection cleared: no Workflow, no record, no save').toEqual([UNLOAD]);
                expect(records(fake), 'DYE2\'s records are as they were').toEqual(recordsBefore);
                await expect(toast(page), 'no toast').toBeHidden();
                await expect(page.locator('dialog[open]'), 'nothing asked first').toHaveCount(0);
                await cafe.screenshot(`unload-after-${size}-light`);

                // A step afterwards changes this machine only.
                const dose = parseFloat(doseShown);
                const unloaded = fake.workflow();
                const stepMark = fake.log.length;
                await page.locator('#dose-in-plus').click();
                const stepped = parseFloat(await page.locator('#dose-in-value').textContent());
                expect(stepped, 'the dose stepped up').toBeGreaterThan(dose);
                await cafe.advance(3000);
                expect(fake.workflow().context.targetDoseWeight, 'the step reaches the Workflow').toBe(stepped);
                expect(fake.workflow(), 'and nothing else of it moved').toEqual({ ...unloaded, context: { ...unloaded.context, targetDoseWeight: stepped } });
                expect(recipeWrites(cafe.since(stepMark)), 'one Workflow write: the dose, with the yield and the profile\'s stop as they were (Streamline\'s dose write)')
                    .toEqual([{ write: 'PUT /api/v1/workflow', body: { context: { targetDoseWeight: stepped, targetYield: unloaded.context.targetYield }, profile: { target_weight: unloaded.profile.target_weight } } }]);
                expect(recordOf(fake, house.name), 'the recipe\'s DYE2 record did not change').toEqual(record);
                expect(fake.selection(), 'and no recipe is loaded').toEqual(NO_RECIPE);

                // A tap loads the recipe as stored, over the step.
                await load(cafe, house);
                expect(loadedId(fake)).toBe(record.id);
                expect(settings(fake.workflow()), 'the machine is set as the first load left it').toEqual(settings(loadedWorkflow));
                expect(fake.workflow().context.targetDoseWeight, 'at the stored dose').toBe(record.dashboardVariables.dose);
                await expect(page.locator('#dose-in-value')).toHaveText(`${record.dashboardVariables.dose}g`);
                await expect(pressed(page)).toHaveCount(1);
            });

            test('a double tap on another card leaves its recipe loaded', async ({ cafe, fake }) => {
                await openLoaded(cafe, house);
                const page = cafe.page;
                const target = recordOf(fake, single.name);
                const mark = fake.log.length;
                await card(page, single.slot).dblclick();
                await expect(title(page)).toHaveText(single.name);
                await cafe.advance(3000);
                expect(loadedId(fake), 'the recipe double-tapped is loaded').toBe(target.id);
                await expect(title(page)).toHaveText(single.name);
                await expect(card(page, single.slot)).toHaveAttribute('aria-pressed', 'true');
                await expect(pressed(page)).toHaveCount(1);
                const made = recipeWrites(cafe.since(mark));
                expect(made.filter(({ body }) => body?.context?.extras?.dye?.recipeId), 'one load').toHaveLength(1);
                expect(made, 'and no unload').not.toContainEqual(UNLOAD);
            });

            test('a double tap on the loaded card unloads it, and the second tap does not load it again', async ({ cafe, fake }) => {
                await openLoaded(cafe, house);
                const page = cafe.page;
                const mark = fake.log.length;
                // Both taps inside the unload's hold (src/cafe/recipe-loader.js, UNLOAD_HOLD_MS).
                await card(page, house.slot).dblclick();
                await expectNoRecipePage(page);
                await cafe.advance(UNLOAD_HOLD_MS + 2500);
                expect(fake.selection(), 'DYE2 names no recipe').toEqual(NO_RECIPE);
                await expectNoRecipePage(page);
                expect(recipeWrites(cafe.since(mark)), 'one unload, and no load').toEqual([UNLOAD]);
            });

            test('while a shot runs, a tap on the loaded card or another changes nothing', async ({ cafe, fake }) => {
                const record = await openLoaded(cafe, single);
                const page = cafe.page;
                const before = { workflow: fake.workflow(), selection: fake.selection() };
                await cafe.pour(fake.machine.pourMoment((frame, socket) => socket === 'machine/snapshot' && frame.state?.state === 'espresso') + 1000);
                await expect(page.locator('#main-page.cafe-shot-live')).toBeAttached();
                const mark = fake.log.length;
                await card(page, single.slot).click();
                await card(page, house.slot).click();
                await cafe.pour(fake.machine.pourMoment((frame, socket) => socket === 'machine/snapshot' && frame.state?.state === 'espresso') + 4000);
                await expect(page.locator('#main-page.cafe-shot-live'), 'the shot still runs').toBeAttached();
                expect(recipeWrites(cafe.since(mark)), 'nothing written').toEqual([]);
                expect(fake.selection(), 'DYE2 names the same recipe').toEqual(before.selection);
                expect(loadedId(fake)).toBe(record.id);
                expect(fake.workflow(), 'the Workflow is as it was').toEqual(before.workflow);
                await expect(title(page)).toHaveText(single.name);
                await expect(card(page, single.slot)).toHaveAttribute('aria-pressed', 'true');
                await expect(pressed(page)).toHaveCount(1);
                await cafe.pour();
                await cafe.untilStored();
                await cafe.storeShot();
                await cafe.advance(SHOT_STORE_MS);
                expect(recipeWrites(cafe.since(mark)), 'nor after the shot').toEqual([]);
                expect(loadedId(fake)).toBe(record.id);
            });

            test('tapped just after a pour, the highlight goes at once, the Shot names the recipe, and the unload follows the store', async ({ cafe, fake }) => {
                const record = await openLoaded(cafe, single);
                const page = cafe.page;
                await cafe.pour();
                await expect(page.locator('#main-page:not(.cafe-shot-live)')).toBeAttached();
                const mark = fake.log.length;
                await card(page, single.slot).click();
                await expect(pressed(page), 'the highlight goes at once').toHaveCount(0);
                expect(loadedId(fake), 'while DYE2 still names the recipe').toBe(record.id);

                await cafe.untilStored();
                expect(recipeWrites(cafe.since(mark)), 'nothing written before the Shot is stored').toEqual([]);
                expect(loadedId(fake), 'DYE2 names the recipe up to the store').toBe(record.id);
                await expect(pressed(page)).toHaveCount(0);
                const stored = fake.log.length;
                const id = await cafe.storeShot();
                expect(fake.shots.get(id).workflow.context.extras.dye.recipeId, 'the Shot names the recipe').toBe(record.id);

                await cafe.advance(SHOT_STORE_MS);
                expect(writes(cafe.since(stored)), 'then the unload, alone').toEqual([UNLOAD]);
                expect(fake.selection(), 'and DYE2 names no recipe').toEqual(NO_RECIPE);
                await expectNoRecipePage(page);
            });

            test('an unload DYE2 refuses is the toast "Could not unload", the card still pressed and the recipe loaded', async ({ cafe, fake }) => {
                const record = await openLoaded(cafe, house);
                const page = cafe.page;
                const workflow = fake.workflow();
                fake.refuse({ method: 'POST', path: /dye2\.reaplugin\/selection/, status: 500 });
                const mark = fake.log.length;
                await card(page, house.slot).click();
                await expect(toast(page)).toBeVisible();
                await expect(page.locator('#app-toast-message')).toHaveText(`Could not unload ${house.name}`);
                await expect(card(page, house.slot), 'the card highlighted again').toHaveAttribute('aria-pressed', 'true');
                await expect(title(page)).toHaveText(house.name);
                expect(loadedId(fake), 'the recipe still loaded').toBe(record.id);
                expect(fake.workflow(), 'the Workflow as it was').toEqual(workflow);
                expect(cafe.since(mark, entry => entry.method === 'POST' && entry.path === SELECTION).map(entry => entry.status), 'the one unload asked, refused').toEqual([500]);
                await cafe.screenshot(`unload-refused-${size}-light`);
            });
        });
    }
});
