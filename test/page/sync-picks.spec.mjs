// The page's picks with Decent Sync serving the Machine (docs/cafe/DESIGN.md,
// "The grinder, bean and basket dialogs", "The profile dialog", "Changing the
// profile" and "Recipes and the strip"): the grinder, bean and basket dialogs
// say a choice is saved to the recipe, and a bean other than the recipe's that
// it changes the recipe's bean; a grinder, a batch of the recipe's own bean and
// a basket are each one write of the Workflow and no DYE2 record of the page's,
// the plugin being the one that saves them (DYE2 writes the grind setting and
// the basket into the record; a batch is no field of DYE2's record); a tap on the loaded card unloads it, at 1920
// by 1200 and at 1340 by 800, the column going from "saved to the recipe" to
// "not saved to a recipe", and a step then reaches the Workflow alone; and the
// profile dialog says "saved to the recipe" and lists the profiles sorted, the
// recipe's in use.
//
// Without Decent Sync the same dialogs and the unload are
// grinder-dialog.spec.mjs, bean-basket-dialogs.spec.mjs, unload-tap.spec.mjs
// and profile-change.spec.mjs: what is checked there (the lists, the writes'
// bodies, a batch of another bean, the refusals, a shot closing a dialog) is
// not repeated here, only what differs where the plugin serves the Machine.
//
// What stays in the real journey, as only the real server, plugin and second
// tablet can show it: the Recipe on the server and the records on both tablets
// taking each choice, the second Machine following with no tap, the server
// showing this Machine with no Loaded Recipe after an unload and the step then
// saved to no Recipe, a Shot pulled with nothing loaded reaching the server
// with no Recipe, the server taking a profile change made during an outage,
// and the Reference Shot flagged "Different profile" after a profile change
// on the tablet (the plugin's Library sync carries the change to the server,
// whose answer then differs; the page drawing the flag the plugin gives is
// sync-pushes.spec.mjs's).
//
// Decent Sync's plugin is the fake's (fake-decaid/decent-sync.js), serving the
// Machine at its Location (recordings/decent-sync.json). DYE2's records and
// baskets are as its Library sync left them.

import { test, expect } from './support/test.mjs';
import { pickDialog, pickRow, tapAt, writes, openPage, card, untilPickClosed } from './support/page-reads.mjs';
import { recordOf, loadedId, matchMachine, profileOverride, PROFILES } from './support/fake-reads.mjs';
import { RECIPES, GRINDER, SECOND_GRINDER, GRINDER_USE } from './support/sample-data.mjs';

const [house] = RECIPES;
const SIZES = [{ width: 1920, height: 1200 }, { width: 1340, height: 800 }];
const SAVED_LABEL = 'Dial-in · saved to the recipe';
const SAVED = `${house.name} · saved to the recipe`;
const OTHER_BEAN = `${house.name} · changes the recipe's bean`;
const CLOSE = '#cafe-pick-dialog .cafe-pick-head .cafe-btn';
const SELECTION = '/api/v1/plugins/dye2.reaplugin/selection';
const STATUS = '/api/v1/plugins/decent-sync.reaplugin/status';

const byTitle = title => PROFILES.find(entry => entry.profile?.title === title);

// ── Reads ────────────────────────────────────────────────────────────────────

/** Any write of DYE2's: its records and baskets in the store, its save and its record. */
const isDye2Write = entry => entry.method !== 'GET' && (/^\/api\/v1\/store\/dye2\.reaplugin\//.test(entry.path) || /^\/api\/v1\/plugins\/dye2\.reaplugin\/(record|save-recipe)$/.test(entry.path));
/** `record` as DYE2 leaves it once the plugin has had it save `fields`, with its stored Workflow's `context` and `extras` following. */
const savedInto = (record, fields, context = {}, extras = {}) => ({
    ...record,
    dashboardVariables: { ...record.dashboardVariables, ...fields },
    workflow: { ...record.workflow, context: { ...record.workflow.context, ...context, extras: { ...record.workflow.context.extras, ...extras } } },
});
const workflowWrites = entries => writes(entries).filter(({ write }) => write === 'PUT /api/v1/workflow');

const under = page => page.locator('#cafe-pick-under');
const sideRow = (page, name) => page.locator('#cafe-pick-side .cafe-pick-row').filter({ has: page.locator('.cafe-pick-row-name', { hasText: name }) });
const highlightedBean = page => page.locator('#cafe-pick-side .cafe-pick-row[aria-pressed="true"] .cafe-pick-row-name').allTextContents();
const profileRows = page => page.locator('#cafe-pick-side .cafe-pick-side-row').evaluateAll(rows => rows.map(row => ({
    id: row.dataset.id,
    name: row.querySelector('.cafe-pick-row-name').textContent,
    inUse: !!row.querySelector('.cafe-pick-in-use'),
})));

// ── Setting up ───────────────────────────────────────────────────────────────

/**
 * The page open with House espresso loaded afresh, as stored and not called
 * changed, and the column saying the plugin saves the dial-in onto it: the
 * dialogs' line follows the same answer.
 */
async function houseLoaded(cafe) {
    matchMachine(cafe.fake, house.name);
    const page = await openPage(cafe);
    await card(page, house.slot).click();
    await expect(page.locator('#cafe-title')).toHaveText(house.name);
    await expect(card(page, house.slot)).toHaveAttribute('aria-pressed', 'true');
    await cafe.advance(2000);
    const record = recordOf(cafe.fake, house.name);
    expect(cafe.fake.selection(), 'loaded, and not called changed').toEqual({ kind: 'recipe', id: record.id, modified: false });
    await expect(page.locator('#cafe-dial-label'), 'the Machine is served').toHaveText(SAVED_LABEL);
    return record;
}

async function openDialog(cafe, on) {
    await tapAt(cafe.page, on);
    await expect(pickDialog(cafe.page)).toBeVisible();
    await cafe.settle();
}

test.describe('the picks with Decent Sync serving', { tag: '@sync-picks' }, () => {
    test.use({ decentSync: true });

    test('the grinder dialog says the choice is saved to the recipe, and a choice is one Workflow write, which the plugin saves into the record', async ({ cafe, fake }) => {
        const record = await houseLoaded(cafe);
        const page = cafe.page;
        const second = fake.library.state.grinders.find(g => g.model === SECOND_GRINDER.model);
        await expect(page.locator('#cafe-grind-desc')).toHaveText(GRINDER.model);
        const mark = fake.log.length;

        await openDialog(cafe, '#grind-section .cafe-row-name');
        await expect(page.locator('#cafe-pick-title')).toHaveText('Grinder');
        await expect(under(page)).toHaveText(SAVED);
        await cafe.screenshot('sync-grinder-dialog-light');

        await pickRow(page, SECOND_GRINDER.model).click();
        await untilPickClosed(cafe);
        await expect(page.locator('#cafe-grind-desc')).toHaveText(SECOND_GRINDER.model);
        await cafe.advance(3000);
        expect(writes(cafe.since(mark)), 'one write of the Workflow, and Streamline\'s own note of the setting for the profile').toEqual([
            { write: 'PUT /api/v1/workflow', body: { context: { grinderId: second.id, grinderModel: SECOND_GRINDER.model, grinderSetting: GRINDER_USE.second.setting, extras: { rpm: GRINDER_USE.second.rpm } } } },
            profileOverride(fake, GRINDER_USE.second.setting),
        ]);
        expect(cafe.since(mark, isDye2Write), 'no DYE2 record written by the page: the plugin saves the choice').toEqual([]);
        const grind = Number(GRINDER_USE.second.setting);
        expect(recordOf(fake, house.name), 'the plugin had DYE2 save the grind setting into the record (DYE2 holds no grinder and no rpm the record lacks)').toEqual(savedInto(record, { grind }, { grinderSetting: String(grind) }));
        expect(loadedId(fake), 'the recipe stays loaded').toBe(record.id);
        await expect(page.locator('#cafe-dial-label')).toHaveText(SAVED_LABEL);
    });

    test('the bean dialog says "saved" on the recipe\'s bean, "changes the recipe\'s bean" on another, and "saved" back on its own', async ({ cafe, fake }) => {
        await houseLoaded(cafe);
        const page = cafe.page;
        const mark = fake.log.length;

        await openDialog(cafe, '#dose-section .cafe-row-name');
        await expect(page.locator('#cafe-pick-title')).toHaveText('Bean and batch');
        expect(await highlightedBean(page), 'on the recipe\'s bean').toEqual(['Sample Blend']);
        await expect(under(page), 'on the recipe\'s own bean, saved').toHaveText(SAVED);

        await sideRow(page, 'Example Decaf').click();
        await expect.poll(() => highlightedBean(page)).toEqual(['Example Decaf']);
        await expect(under(page), 'on another bean, it changes the recipe\'s bean').toHaveText(OTHER_BEAN);
        await cafe.screenshot('sync-bean-dialog-other-bean-light');

        await sideRow(page, 'Sample Blend').click();
        await expect.poll(() => highlightedBean(page)).toEqual(['Sample Blend']);
        await expect(under(page), 'back on the recipe\'s own bean, saved again').toHaveText(SAVED);
        await cafe.screenshot('sync-bean-dialog-light');

        // A tap on a bean chose nothing.
        await page.locator(CLOSE).click();
        await untilPickClosed(cafe);
        await cafe.advance(1000);
        expect(workflowWrites(cafe.since(mark)), 'nothing written by the taps on beans').toEqual([]);
    });

    test('a batch of the recipe\'s own bean, chosen with "Use this batch", is one Workflow write and no record', async ({ cafe, fake }) => {
        const record = await houseLoaded(cafe);
        const page = cafe.page;
        const blend = fake.library.state.beans.find(bean => bean.name === 'Sample Blend');
        const older = fake.library.state.batches.find(batch => batch.beanId === blend.id && batch.roastDate.startsWith('2026-10-15') && !batch.archived);
        const chose = fake.log.length;
        await openDialog(cafe, '#dose-section .cafe-row-name');
        await pickRow(page, 'Roasted Oct 15').click();
        await expect(page.locator('#cafe-pick-confirm-use')).toBeEnabled();
        await expect(under(page), 'a batch highlighted leaves the line on the bean').toHaveText(SAVED);
        await page.locator('#cafe-pick-confirm-use').click();
        await untilPickClosed(cafe);
        await expect(page.locator('#cafe-dose-desc')).toHaveText('Sample Blend · roasted Oct 15');
        await cafe.advance(2000);
        expect(workflowWrites(cafe.since(chose)), 'one write of the Workflow').toEqual([
            { write: 'PUT /api/v1/workflow', body: { context: { beanBatchId: older.id, coffeeName: 'Sample Blend', coffeeRoaster: 'Sample Roasters' } } },
        ]);
        expect(cafe.since(chose, isDye2Write), 'and no DYE2 record: the plugin saves it').toEqual([]);
        expect(recordOf(fake, house.name), 'the recipe\'s DYE2 record: a batch is no field DYE2 saves').toEqual(record);
        expect(loadedId(fake), 'the recipe stays loaded').toBe(record.id);
    });

    test('the basket dialog says the choice is saved to the recipe, and a choice is one Workflow write, which the plugin saves into the record', async ({ cafe, fake }) => {
        const record = await houseLoaded(cafe);
        const page = cafe.page;
        const twenty = fake.store.get('dye2.reaplugin', 'baskets').find(b => b.name === '20 g sample basket');
        const mark = fake.log.length;

        await openDialog(cafe, '#drink-section .cafe-row-name');
        await expect(page.locator('#cafe-pick-title')).toHaveText('Basket');
        await expect(under(page)).toHaveText(SAVED);
        await cafe.screenshot('sync-basket-dialog-light');

        await pickRow(page, '20 g sample basket').click();
        await untilPickClosed(cafe);
        await expect(page.locator('#cafe-yield-desc')).toHaveText('20 g sample basket');
        await cafe.advance(2000);
        expect(workflowWrites(cafe.since(mark)), 'one write of the basket\'s id and name').toEqual([
            { write: 'PUT /api/v1/workflow', body: { context: { extras: { basketId: twenty.id, basketName: '20 g sample basket' } } } },
        ]);
        expect(cafe.since(mark, isDye2Write), 'and no DYE2 record of the page\'s').toEqual([]);
        const basket = { basketId: twenty.id, basketName: '20 g sample basket' };
        expect(recordOf(fake, house.name), 'the plugin had DYE2 save the basket, id and name together').toEqual(savedInto(record, basket, {}, basket));
        expect(loadedId(fake), 'the recipe stays loaded').toBe(record.id);
    });

    for (const viewport of SIZES) {
        const size = `${viewport.width}x${viewport.height}`;
        test.describe(size, () => {
            test.use({ viewport });

            test('a tap on the loaded card unloads it: "saved to the recipe" becomes "not saved to a recipe", and a step then reaches the Workflow alone', async ({ cafe, fake }) => {
                const record = await houseLoaded(cafe);
                const page = cafe.page;

                const mark = fake.log.length;
                await card(page, house.slot).click();
                await expect(page.locator('#cafe-title')).toHaveText('No recipe selected');
                await expect(page.locator('#cafe-dial-label')).toHaveText('Dial-in · not saved to a recipe');
                await cafe.advance(2500);
                // DYE2 derives the selection from the Workflow: here Shot A's
                // recent favourite, which the machine still matches, and no recipe.
                expect(loadedId(fake), 'DYE2 names no recipe').toBeNull();
                expect(writes(cafe.since(mark)), 'one write, DYE2\'s selection cleared').toEqual([{ write: `POST ${SELECTION}`, body: {} }]);
                expect(cafe.since(mark, entry => entry.method === 'GET' && entry.path === STATUS).length, 'the plugin asked again after the unload').toBeGreaterThan(0);
                // The plugin still serves the Machine: with no recipe, nothing is saved all the same.
                await expect(page.locator('#cafe-title')).toHaveText('No recipe selected');
                await expect(page.locator('#cafe-dial-label')).toHaveText('Dial-in · not saved to a recipe');
                await expect(page.locator('#cafe-strip .cafe-card[aria-pressed="true"]')).toHaveCount(0);
                await cafe.screenshot(`sync-unloaded-${size}-light`);

                // A step afterwards: the Workflow, and nothing of DYE2's.
                const dose = parseFloat(await page.locator('#dose-in-value').textContent());
                const stepMark = fake.log.length;
                await page.locator('#dose-in-plus').click();
                const stepped = parseFloat(await page.locator('#dose-in-value').textContent());
                expect(stepped, 'the dose stepped up').toBeGreaterThan(dose);
                await cafe.advance(3000);
                expect(fake.workflow().context.targetDoseWeight, 'the step reaches the Workflow').toBe(stepped);
                expect(workflowWrites(cafe.since(stepMark)), 'in one write').toHaveLength(1);
                expect(cafe.since(stepMark, isDye2Write), 'and no DYE2 record').toEqual([]);
                expect(cafe.since(stepMark, entry => entry.method !== 'GET' && entry.path === SELECTION), 'nor a load').toEqual([]);
                expect(recordOf(fake, house.name), 'the recipe\'s record did not change').toEqual(record);
                expect(loadedId(fake), 'no recipe is loaded').toBeNull();
            });

            test('the profile dialog says the choice is saved to the recipe, and lists the profiles by title, the recipe\'s in use', async ({ cafe }) => {
                const record = await houseLoaded(cafe);
                const page = cafe.page;
                await openDialog(cafe, '#brew-section .cafe-row-name');
                await expect(under(page)).toHaveText(SAVED);

                const rows = await profileRows(page);
                const shown = PROFILES.filter(entry => (entry.visibility == null || entry.visibility === 'visible') && Array.isArray(entry.profile?.steps) && entry.profile.steps.length > 0)
                    .map(entry => entry.profile.title)
                    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
                expect(rows.map(row => row.name), 'every profile Decaid shows, sorted by title').toEqual(shown);
                expect(rows.filter(row => row.inUse).map(row => row.id), 'the recipe\'s, and only it, in use').toEqual([String(record.profileId)]);
                expect(rows.find(row => row.inUse).name).toBe(house.profile);
                await expect(page.locator('#cafe-pick-pane-in-use')).toBeVisible();

                if (size === '1920x1200') {
                    // Another profile highlighted, its description beside the list.
                    const gentle = byTitle('Gentle and sweet');
                    await page.locator(`#cafe-pick-side .cafe-pick-side-row[data-id="${gentle.id}"]`).click();
                    await expect(page.locator('#cafe-pick-pane-title')).toHaveText(gentle.profile.title);
                    await expect(under(page), 'the line stays on the recipe').toHaveText(SAVED);
                }
                await cafe.screenshot(`sync-profile-dialog-${size}-light`);
                await page.locator(CLOSE).click();
                await untilPickClosed(cafe);
            });
        });
    }
});
