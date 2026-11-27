// The bean and batch dialog and the basket dialog (docs/cafe/DESIGN.md, "The
// grinder, bean and basket dialogs" and "The bean and batch dialog"), without
// Decent Sync: a tap on Dose's name lists the beans with a batch beside the
// highlighted bean's batches, and a tap on Yield's lists DYE2's baskets. A tap
// on a batch highlights it and writes nothing; "Use this batch" under the
// batches chooses it (#70). A batch of the recipe's own bean and a basket write
// the Workflow and nothing else. With a recipe loaded, a batch of another bean
// becomes the recipe's bean (#52): its DYE2 record first, then the Workflow,
// the recipe kept loaded, a name DYE2 gave following the bean and one named by
// hand kept. With no recipe loaded each choice writes the Workflow alone.
//
// The sample data (fake-decaid/recordings/sample-data.json) holds the three
// beans with their batches (Sample Blend's two, and a third archived), DYE2's
// three baskets (one archived) and the recipes' records. What Decaid answers
// for the beans and their batches is recordings/beans.json; Decaid's merge of
// a Workflow write is recordings/workflow-merge.json; DYE2's selection, which
// keeps a recipe loaded and not changed through a bean, is
// recordings/dye2-selection.json; the recipe DYE2 makes and names with
// save-recipe is recordings/dye2-save-recipe.json.

import { test, expect } from './support/test.mjs';
import { pickDialog, pickRows, pickRow, tapAt, isWrite, writes, paint, openPage, card, load, untilPickClosed } from './support/page-reads.mjs';
import { records, recordOf, loadedId, isRecordWrite, matchMachine, PROFILES } from './support/fake-reads.mjs';
import { RECIPES } from './support/sample-data.mjs';
import { SUPPORTED_LANGUAGES } from '../../src/modules/i18n-parser.js';
import { CAFE_TRANSLATIONS } from '../../src/cafe/translations.js';
import { AFTER_CHECK_MS } from '../../src/cafe/profile-change.js';

const [house, , decafRecipe] = RECIPES;
const DYE2 = 'dye2.reaplugin';
const RECIPE_STORE = `/api/v1/store/${DYE2}/recipes`;
const DOSE = '#dose-section .cafe-row-name';
const YIELD = '#drink-section .cafe-row-name';
const CLOSE = '#cafe-pick-dialog form[method="dialog"] .cafe-btn';
const FINISHED_LANGUAGES = SUPPORTED_LANGUAGES.filter(code => code !== 'en' && !code.includes('unfinished'));

// ── The sample data, as the fake holds it.
const beanNamed = (fake, name) => fake.library.state.beans.find(bean => bean.name === name);
const batchOf = (fake, name, day) => fake.library.state.batches.find(batch => batch.beanId === beanNamed(fake, name).id && batch.roastDate.startsWith(day) && !batch.archived);
const blendNew = fake => batchOf(fake, 'Sample Blend', '2026-11-02');
const blendOld = fake => batchOf(fake, 'Sample Blend', '2026-10-15');
const decafBatch = fake => batchOf(fake, 'Example Decaf', '2026-10-20');
const singleBatch = fake => batchOf(fake, 'Sample Single Origin', '2026-10-28');
const isRecordRead = entry => entry.method === 'GET' && entry.path === RECIPE_STORE;
// The page's read of the records once DYE2's save window after a write has
// passed (bean-change.js, `checkLater`). The log's time is the fake's, which
// trails the page's by up to one 500 ms step of `cafe.advance`.
const checkRead = writtenAt => entry => isRecordRead(entry) && entry.at >= writtenAt + AFTER_CHECK_MS - 500;

// ── The page.
const sideRows = page => page.locator('#cafe-pick-side .cafe-pick-row').evaluateAll(rows => rows.map(row => ({
    name: row.querySelector('.cafe-pick-row-name').textContent,
    detail: row.querySelector('.cafe-pick-row-detail').textContent,
    highlighted: row.getAttribute('aria-pressed') === 'true',
})));
const highlightedBean = async page => (await sideRows(page)).filter(row => row.highlighted).map(row => row.name);
const sideRow = (page, name) => page.locator('#cafe-pick-side .cafe-pick-row').filter({ has: page.locator('.cafe-pick-row-name', { hasText: name }) });
const ltr = words => `\u2066${words}\u2069`;
const batchRow = (page, n) => page.locator('#cafe-pick-list .cafe-pick-row').nth(n);
const under = page => page.locator('#cafe-pick-under');
const dose = page => page.locator('#cafe-dose-desc');
const dosePick = page => page.locator('#cafe-dose-pick');
const basket = page => page.locator('#cafe-yield-desc');
// The button under the batches (#70): its words, whether it can be tapped, the
// note beside it, "In use" in its place, and the batches highlighted.
const batchConfirm = page => page.evaluate(() => {
    const visible = id => { const element = document.getElementById(id); return !!element && !element.hidden && element.offsetParent !== null; };
    const button = document.getElementById('cafe-pick-confirm-use');
    return {
        shown: visible('cafe-pick-confirm'),
        use: visible('cafe-pick-confirm-use') ? button.textContent : null,
        enabled: visible('cafe-pick-confirm-use') && !button.disabled,
        note: visible('cafe-pick-confirm-note') ? document.getElementById('cafe-pick-confirm-note').textContent : null,
        inUse: visible('cafe-pick-confirm-in-use'),
        held: [...document.querySelectorAll('#cafe-pick-list .cafe-pick-row[aria-pressed="true"]')].map(row => row.querySelector('.cafe-pick-row-name').textContent),
    };
});

/** The house recipe, its record matching the machine, loaded and not called changed. */
async function houseLoaded(cafe, fake) {
    matchMachine(fake, house.name);
    const page = await openPage(cafe);
    await load(cafe, house);
    expect(fake.selection(), 'loaded, and not called changed').toEqual({ kind: 'recipe', id: recordOf(fake, house.name).id, modified: false });
    return page;
}

async function openDialog(cafe, on) {
    await tapAt(cafe.page, on);
    await expect(pickDialog(cafe.page)).toBeVisible();
    await cafe.settle();
}

/** A batch, of another bean where one is named, highlighted and chosen with "Use this batch". */
async function useBatch(cafe, bean, n) {
    const { page } = cafe;
    if (bean) {
        await sideRow(page, bean).click();
        await expect.poll(() => highlightedBean(page)).toEqual([bean]);
    }
    await batchRow(page, n).click();
    await expect(page.locator('#cafe-pick-confirm-use')).toBeEnabled();
    await page.locator('#cafe-pick-confirm-use').click();
    await untilPickClosed(cafe);
}

test.describe('the bean and batch dialog and the basket dialog', { tag: '@bean' }, () => {
    test.use({ timezoneId: 'UTC' }); // the days since a roast are counted to the page's calendar day
    test('Dose and Yield name the bean and the basket, and their values still open the numpad', async ({ cafe }) => {
        const page = await openPage(cafe);
        await load(cafe, house);
        const mark = cafe.fake.log.length;
        await expect(dose(page)).toHaveText('SB-0211 · Sample Blend · 16 d since roast');
        await expect(basket(page)).toHaveText(house.basket);
        for (const value of ['#dose-in-value', '#drink-out-value']) {
            await page.locator(value).click();
            await expect(page.locator('#numpad-modal-overlay'), `a tap on ${value} opens the numpad`).toBeVisible();
            await cafe.settle();
            await expect(pickDialog(page), 'and no dialog').toHaveCount(0);
            await page.locator('#numpad-cancel').click();
            await expect(page.locator('#numpad-modal-overlay')).toBeHidden();
        }
        expect(cafe.since(mark, isWrite), 'nothing written').toEqual([]);
    });

    test('opens on the recipe\'s bean, lists the beans with a batch and that bean\'s batches, and a tap on a bean chooses nothing', async ({ cafe, fake }) => {
        const page = await houseLoaded(cafe, fake);
        const mark = fake.log.length;

        await openDialog(cafe, DOSE);
        await expect(page.locator('#cafe-pick-title')).toHaveText('Bean and batch');
        await expect(page.locator('#cafe-pick-side-heading')).toHaveText('Bean');
        await expect(page.locator('#cafe-pick-side-heading')).toBeVisible();
        await expect(page.locator('#cafe-pick-heading')).toHaveText('Batches');
        await expect(page.locator('#cafe-pick-heading')).toBeVisible();
        await expect(under(page), 'with a recipe loaded and no Decent Sync, not saved to the recipe').toHaveText(`${house.name} · not saved to the recipe`);
        const beans = await sideRows(page);
        expect(beans.map(b => `${b.name}: ${b.detail}`), 'the beans with a batch, by name, each over its roaster and its count of batches not archived')
            .toEqual(['Example Decaf: Example Coffee Co · 1 batch', 'Sample Blend: Sample Roasters · 2 batches', 'Sample Single Origin: Sample Roasters · 1 batch']);
        expect(beans.filter(b => b.highlighted).map(b => b.name), 'on the bean in use').toEqual(['Sample Blend']);
        expect(await pickRows(page), 'that bean\'s batches not archived, newest roast first, each with its Batch Code where it has one and its days since the roast, the one in use marked').toEqual([
            { name: 'Roasted Nov 2', detail: 'SB-0211 · 16 d since roast', inUse: true },
            { name: 'Roasted Oct 15', detail: '34 d since roast', inUse: false },
        ]);
        await expect(pickRow(page, 'Roasted Nov 2').locator('.cafe-pick-in-use')).toHaveText('In use');
        expect(await batchConfirm(page), 'the batch in use highlighted, and "In use" in the button\'s place').toEqual({
            shown: true, use: null, enabled: false, note: null, inUse: true, held: ['Roasted Nov 2'],
        });
        await cafe.screenshot('bean-dialog-light');

        // A tap on another bean shows its batches, and chooses nothing.
        await sideRow(page, 'Sample Single Origin').click();
        await expect.poll(() => highlightedBean(page)).toEqual(['Sample Single Origin']);
        expect(await pickRows(page)).toEqual([{ name: 'Roasted Oct 28', detail: '21 d since roast', inUse: false }]);
        await expect(pickDialog(page)).toBeVisible();
        expect(await batchConfirm(page), 'no batch highlighted, and "Use this batch" shown but not to be tapped').toEqual({
            shown: true, use: 'Use this batch', enabled: false, note: null, inUse: false, held: [],
        });
        await expect(under(page), 'another bean changes the recipe\'s bean, without Decent Sync too').toHaveText(`${house.name} · changes the recipe's bean`);
        await cafe.screenshot('bean-dialog-other-bean-light');
        await sideRow(page, 'Sample Blend').click();
        await expect(under(page), 'back on the recipe\'s own bean').toHaveText(`${house.name} · not saved to the recipe`);

        // Close closes it; the bean's name under Dose opens it too.
        await page.locator(CLOSE).click();
        await untilPickClosed(cafe);
        await openDialog(cafe, '#cafe-dose-desc');
        await expect(page.locator('#cafe-pick-title')).toHaveText('Bean and batch');
        await cafe.advance(1000);
        expect(cafe.since(mark, isWrite), 'nothing written').toEqual([]);
    });

    // Each batch's Batch Code and what is left of it, beside its roast date
    // (#109), read from Decaid's record of the batch as Decent Sync keeps it:
    // the code in `extras` under `decentSyncBatchCode`, the weight in
    // `weightRemaining`. The recorded sample data has neither, as Decaid leaves
    // out a field with no value, so the cases are set on the fake's records.
    test('a batch row says its Batch Code and what is left, each left out where the record has none, and zero is a weight', async ({ cafe, fake }) => {
        Object.assign(blendNew(fake), { weightRemaining: 240, extras: { decentSyncId: 'made-up-library-id', decentSyncBatchCode: 'SB-0211' } });
        Object.assign(blendOld(fake), { weightRemaining: 0 });
        Object.assign(singleBatch(fake), { extras: { decentSyncBatchCode: 'SO-0042' } });
        Object.assign(decafBatch(fake), { weightRemaining: 2400, extras: { decentSyncBatchCode: null } });
        const page = await houseLoaded(cafe, fake);
        const mark = fake.log.length;

        await openDialog(cafe, DOSE);
        expect(await pickRows(page), 'a code and a weight, both with the roast date; and a weight of zero').toEqual([
            { name: 'Roasted Nov 2', detail: `SB-0211 · ${ltr('240 g')} left · 16 d since roast`, inUse: true },
            { name: 'Roasted Oct 15', detail: `${ltr('0 g')} left · 34 d since roast`, inUse: false },
        ]);
        expect(await batchRow(page, 0).locator('.cafe-pick-row-detail bdi').allTextContents(), 'each part kept to itself, for Arabic and Hebrew')
            .toEqual(['SB-0211', `${ltr('240 g')} left`, '16 d since roast']);
        await cafe.screenshot('bean-dialog-code-weight-light');

        await batchRow(page, 1).click();
        await expect.poll(async () => (await batchConfirm(page)).note, 'the note keeps to the bean and the roast date').toBe('Sample Blend · Roasted Oct 15');

        await sideRow(page, 'Sample Single Origin').click();
        await expect.poll(() => highlightedBean(page)).toEqual(['Sample Single Origin']);
        expect(await pickRows(page), 'a code and no weight').toEqual([{ name: 'Roasted Oct 28', detail: 'SO-0042 · 21 d since roast', inUse: false }]);
        await sideRow(page, 'Example Decaf').click();
        await expect.poll(() => highlightedBean(page)).toEqual(['Example Decaf']);
        expect(await pickRows(page), 'a weight in kilograms and no code').toEqual([{ name: 'Roasted Oct 20', detail: `${ltr('2.4 kg')} left · 29 d since roast`, inUse: false }]);
        await cafe.screenshot('bean-dialog-kilograms-light');

        await page.locator(CLOSE).click();
        await untilPickClosed(cafe);
        await paint(page, 'dark');
        await openDialog(cafe, DOSE);
        await cafe.screenshot('bean-dialog-code-weight-dark');
        await page.locator(CLOSE).click();
        await untilPickClosed(cafe);
        await cafe.advance(1000);
        expect(cafe.since(mark, isWrite), 'nothing written').toEqual([]);
        expect(cafe.since(mark, entry => /decent[-_.]?sync/i.test(entry.path)), 'and nothing asked of Decent Sync\'s plugin').toEqual([]);
    });

    test('a tap on a batch highlights it and writes nothing, and Close or a tap outside then writes nothing', async ({ cafe, fake }) => {
        const page = await houseLoaded(cafe, fake);
        const mark = fake.log.length;
        await openDialog(cafe, '#cafe-dose-desc');

        await batchRow(page, 1).click();
        await expect.poll(() => batchConfirm(page), 'highlighted, with "Use this batch" and the bean and roast date beside it').toEqual({
            shown: true, use: 'Use this batch', enabled: true, note: 'Sample Blend · Roasted Oct 15', inUse: false, held: ['Roasted Oct 15'],
        });
        await expect(pickDialog(page)).toBeVisible();
        expect((await pickRows(page)).map(row => row.inUse), 'the batch in use is still the one marked').toEqual([true, false]);
        await expect(under(page), 'the line still follows the bean').toHaveText(`${house.name} · not saved to the recipe`);
        await cafe.screenshot('bean-dialog-highlighted-light');

        await batchRow(page, 0).click();
        await expect.poll(() => batchConfirm(page), 'the batch in use again: "In use" in the button\'s place').toEqual({
            shown: true, use: null, enabled: false, note: null, inUse: true, held: ['Roasted Nov 2'],
        });

        await batchRow(page, 1).click();
        await expect(page.locator('#cafe-pick-confirm-use')).toBeEnabled();
        await page.locator(CLOSE).click();
        await untilPickClosed(cafe);

        await openDialog(cafe, DOSE);
        await batchRow(page, 1).click();
        await expect(page.locator('#cafe-pick-confirm-use')).toBeEnabled();
        await page.mouse.click(30, 30);
        await untilPickClosed(cafe);

        await cafe.advance(3000);
        expect(cafe.since(mark, isWrite), 'nothing written, no record either').toEqual([]);
        await expect(dose(page)).toHaveText('SB-0211 · Sample Blend · 16 d since roast');
    });

    test('a batch of the recipe\'s own bean is one write of the Workflow, and changes no record', async ({ cafe, fake }) => {
        const page = await houseLoaded(cafe, fake);
        const record = recordOf(fake, house.name);
        const old = blendOld(fake);
        const mark = fake.log.length;

        await openDialog(cafe, DOSE);
        await useBatch(cafe, null, 1);
        await expect(dose(page), 'Dose names the bean with the new batch\'s roast date').toHaveText('Sample Blend · 34 d since roast');
        await cafe.advance(2000);
        expect(writes(cafe.since(mark)), 'one write, of the bean\'s name, its roaster and the batch\'s id').toEqual([
            { write: 'PUT /api/v1/workflow', body: { context: { beanBatchId: old.id, coffeeName: 'Sample Blend', coffeeRoaster: 'Sample Roasters' } } },
        ]);
        const workflow = fake.workflow();
        expect(workflow.context.beanBatchId).toBe(old.id);
        expect(workflow.context.extras.dye.recipeId, 'the recipe stays loaded').toBe(record.id);
        expect(recordOf(fake, house.name), 'the recipe\'s DYE2 record').toEqual(record);
    });

    test('a batch of another bean becomes the recipe\'s bean: its record first, then the Workflow, the recipe kept loaded and its name', async ({ cafe, fake }) => {
        const page = await houseLoaded(cafe, fake);
        const record = recordOf(fake, house.name);
        const others = records(fake).filter(row => row.id !== record.id);
        const decafBean = beanNamed(fake, 'Example Decaf');
        const decaf = decafBatch(fake);
        const mark = fake.log.length;

        await openDialog(cafe, DOSE);
        await useBatch(cafe, 'Example Decaf', 0);
        await expect(dose(page)).toHaveText('Example Decaf · 29 d since roast');
        await cafe.advance(1500);

        const context = { beanBatchId: decaf.id, coffeeName: 'Example Decaf', coffeeRoaster: 'Example Coffee Co' };
        const taken = recordOf(fake, house.name);
        const wantRecord = {
            ...record, beanId: decafBean.id, beanName: 'Example Decaf', beanRoaster: 'Example Coffee Co', beanBatchId: decaf.id, subtitle: 'Example Decaf',
            workflow: { ...record.workflow, context: { ...record.workflow.context, ...context } },
        };
        const made = writes(cafe.since(mark));
        expect(made.map(w => w.write), 'one record write, then one Workflow write').toEqual([`POST ${RECIPE_STORE}`, 'PUT /api/v1/workflow']);
        expect(made[0].body.find(row => row.id === record.id), 'the record takes the bean\'s id, name and roaster and the batch, in its stored Workflow too, keeping every other field and its name').toEqual(wantRecord);
        expect(made[0].body.filter(row => row.id !== record.id), 'the other records as they were').toEqual(others);
        expect(made[1].body).toEqual({ context });
        expect(taken).toEqual(wantRecord);
        expect([taken.beanName, taken.beanRoaster, taken.beanBatchId], 'the record\'s top and its stored Workflow name the same bean')
            .toEqual([taken.workflow.context.coffeeName, taken.workflow.context.coffeeRoaster, taken.workflow.context.beanBatchId]);
        expect(fake.workflow().context).toMatchObject(context);
        expect(fake.workflow().context.extras.dye.recipeId).toBe(record.id);
        expect(fake.selection(), 'the recipe stays loaded and is not called changed').toEqual({ kind: 'recipe', id: record.id, modified: false });
        await expect(card(page, house.slot).locator('.cafe-card-bean'), 'the card names the new bean').toHaveText('Example Decaf');
        await expect(card(page, house.slot).locator('.cafe-card-name'), 'and the recipe keeps its name').toHaveText(house.name);
        await expect(page.locator('#cafe-title')).toHaveText(house.name);
        await cafe.screenshot('bean-after-other-bean-light');

        // Past DYE2's save window, when the page reads the record again.
        const written = fake.log.findLastIndex(isRecordWrite);
        const writtenAt = fake.log[written].at;
        await cafe.advance(AFTER_CHECK_MS + 500);
        expect(fake.log.slice(written + 1).some(checkRead(writtenAt)), 'the check after the window read the record').toBe(true);
        expect(cafe.since(mark, isRecordWrite), 'nothing wrote the record again').toHaveLength(1);
        expect(recordOf(fake, house.name)).toEqual(wantRecord);
        expect(loadedId(fake), 'still loaded').toBe(record.id);
    });

    test('the basket dialog lists DYE2\'s baskets, and a choice is one write of its id and its name', async ({ cafe, fake }) => {
        const page = await houseLoaded(cafe, fake);
        const record = recordOf(fake, house.name);
        const mark = fake.log.length;

        await openDialog(cafe, YIELD);
        await expect(page.locator('#cafe-pick-title')).toHaveText('Basket');
        await expect(page.locator('#cafe-pick-heading'), 'no heading over its list').toBeHidden();
        await expect(page.locator('#cafe-pick-side-column')).toBeHidden();
        await expect(under(page)).toHaveText(`${house.name} · not saved to the recipe`);
        expect(await pickRows(page), 'DYE2\'s baskets not archived, each with its size and diameter, the one in use and only it marked').toEqual([
            { name: '18 g sample basket', detail: 'Double · 58 mm', inUse: true },
            { name: '20 g sample basket', detail: 'Double · 58 mm', inUse: false },
        ]);
        await cafe.screenshot('basket-dialog-light');

        // The basket's name under Yield opens it too.
        await page.locator(CLOSE).click();
        await untilPickClosed(cafe);
        await openDialog(cafe, '#cafe-yield-desc');
        await pickRow(page, '20 g sample basket').click();
        await untilPickClosed(cafe);
        await expect(basket(page)).toHaveText('20 g sample basket');
        await cafe.advance(2000);
        expect(writes(cafe.since(mark)), 'one write of its id and its name').toEqual([
            { write: 'PUT /api/v1/workflow', body: { context: { extras: { basketId: 'bskt-sample-20', basketName: '20 g sample basket' } } } },
        ]);
        expect(fake.workflow().context.extras).toMatchObject({ basketId: 'bskt-sample-20', basketName: '20 g sample basket', dye: { recipeId: record.id } });
        expect(recordOf(fake, house.name), 'the recipe\'s DYE2 record is unchanged by the basket').toEqual(record);
    });

    test('after another bean and a basket: both stay on the page and on one opened afresh, and the recipe loaded again brings back its new bean and its own basket', async ({ cafe, fake }) => {
        const page = await houseLoaded(cafe, fake);
        const decaf = decafBatch(fake);
        const mark = fake.log.length;

        await openDialog(cafe, DOSE);
        await useBatch(cafe, 'Example Decaf', 0);
        await expect(dose(page)).toHaveText('Example Decaf · 29 d since roast');
        await cafe.advance(1500);
        await openDialog(cafe, YIELD);
        await pickRow(page, '20 g sample basket').click();
        await untilPickClosed(cafe);
        await expect(basket(page)).toHaveText('20 g sample basket');
        await cafe.advance(1500);
        expect(cafe.since(mark, entry => entry.method === 'POST' && /dye2\.reaplugin\/(record|save-recipe)$/.test(entry.path)), 'DYE2 asked to save nothing').toEqual([]);
        expect(cafe.since(mark, isRecordWrite), 'the records written once, for the other bean').toHaveLength(1);

        await page.evaluate(() => document.dispatchEvent(new Event('streamline:mainpagevisible')));
        await cafe.advance(1500);
        await expect(dose(page), 'after the page looks again').toHaveText('Example Decaf · 29 d since roast');
        await expect(basket(page)).toHaveText('20 g sample basket');
        const again = await cafe.another();
        await expect(again.locator('#cafe-dose-desc'), 'on a page opened afresh').toHaveText('Example Decaf · 29 d since roast');
        await expect(again.locator('#cafe-yield-desc')).toHaveText('20 g sample basket');
        await again.close();

        await load(cafe, decafRecipe);
        await load(cafe, house);
        expect(fake.workflow().context).toMatchObject({ beanBatchId: decaf.id, coffeeName: 'Example Decaf' });
        await expect(dose(page)).toHaveText('Example Decaf · 29 d since roast');
        await expect(basket(page), 'the recipe\'s own basket').toHaveText(house.basket);
    });

    test('a recipe DYE2 named takes the name DYE2 gives with another bean, and one named by hand keeps its own', async ({ cafe, fake }) => {
        // A recipe DYE2 made by its own save-recipe from the Workflow, on
        // Adaptive v3 and Sample Single Origin, in slot 4, which DYE2 marks loaded.
        const adaptive = PROFILES.find(entry => entry.profile?.title === 'Adaptive v3');
        const single = singleBatch(fake);
        expect(fake.request({ method: 'PUT', url: '/api/v1/workflow', body: { profile: adaptive.profile, context: { coffeeName: 'Sample Single Origin', coffeeRoaster: 'Sample Roasters', beanBatchId: single.id } } }).status).toBe(200);
        const made = fake.request({ method: 'POST', url: `/api/v1/plugins/${DYE2}/save-recipe`, body: { slot: 4 } }).body;
        expect(made.name, 'DYE2 named it from the profile and the bean').toBe('Adaptive Sample Single Origin');
        matchMachine(fake, made.name);
        expect(records(fake).find(row => row.id === made.id).beanId, 'with no beanId').toBeUndefined();
        expect(fake.selection(), 'loaded, not called changed').toEqual({ kind: 'recipe', id: made.id, modified: false });
        const houseRecord = recordOf(fake, house.name);
        const decafBean = beanNamed(fake, 'Example Decaf');
        const decaf = decafBatch(fake);

        const page = await openPage(cafe);
        await expect(page.locator('#cafe-title')).toHaveText(made.name);
        await openDialog(cafe, DOSE);
        await expect(under(page), 'on its own bean, worked out from its batch: not saved').toHaveText(`${made.name} · not saved to the recipe`);
        await sideRow(page, 'Example Decaf').click();
        await expect(under(page), 'on another: it changes the recipe\'s bean').toHaveText(`${made.name} · changes the recipe's bean`);
        const mark = fake.log.length;
        await useBatch(cafe, null, 0);
        await expect(page.locator('#cafe-title')).toHaveText('Adaptive Example Decaf');
        await cafe.advance(1500);

        expect(cafe.since(mark, isRecordWrite), 'one record write').toHaveLength(1);
        const after = records(fake).find(row => row.id === made.id);
        expect({ name: after.name, title: after.title, beanId: after.beanId, beanBatchId: after.beanBatchId, stored: after.workflow.context.beanBatchId }, 'the name DYE2 gives with the new bean, in the same write')
            .toEqual({ name: 'Adaptive Example Decaf', title: 'Adaptive Example Decaf', beanId: decafBean.id, beanBatchId: decaf.id, stored: decaf.id });
        await expect(card(page, 4).locator('.cafe-card-name')).toHaveText('Adaptive Example Decaf');
        await expect(card(page, 4).locator('.cafe-card-bean')).toHaveText('Example Decaf');
        expect(fake.selection(), 'still loaded, not called changed').toEqual({ kind: 'recipe', id: made.id, modified: false });
        await cafe.screenshot('bean-renamed-light');

        const written = fake.log.findLastIndex(isRecordWrite);
        const writtenAt = fake.log[written].at;
        await cafe.advance(AFTER_CHECK_MS + 500);
        expect(fake.log.slice(written + 1).some(checkRead(writtenAt)), 'the check after the window read the record').toBe(true);
        const held = records(fake).find(row => row.id === made.id);
        expect([held.name, held.beanBatchId], 'past DYE2\'s window: the name and the bean kept').toEqual(['Adaptive Example Decaf', decaf.id]);
        expect(loadedId(fake)).toBe(made.id);
        expect(cafe.since(mark, isRecordWrite), 'nothing wrote the record again').toHaveLength(1);
        expect(recordOf(fake, house.name), 'the recipe named by hand kept its own').toEqual(houseRecord);
    });

    for (const [what, path, open] of [['beans', /^\/api\/v1\/beans(\?|$)/, DOSE], ['baskets', /^\/api\/v1\/store\/dye2\.reaplugin\/baskets$/, YIELD]]) {
        test(`${what} that can't be read are a toast, and no dialog`, async ({ cafe, fake }) => {
            const page = await houseLoaded(cafe, fake);
            const allow = fake.refuse({ method: 'GET', path, abort: true });
            await tapAt(page, open);
            await expect(page.locator('#app-toast')).toBeVisible();
            await expect(page.locator('#app-toast-message')).toHaveText(`Could not read the ${what}`);
            await cafe.advance(1000);
            await expect(pickDialog(page)).toHaveCount(0);
            allow();
        });
    }

    test('a shot that starts closes the dialog, choosing none of the batch highlighted, and neither dialog opens during one', async ({ cafe, fake }) => {
        const page = await houseLoaded(cafe, fake);
        const mark = fake.log.length;
        await openDialog(cafe, DOSE);
        // A batch of another bean highlighted, which the shot must not choose (#70).
        await sideRow(page, 'Example Decaf').click();
        await batchRow(page, 0).click();
        await expect(page.locator('#cafe-pick-confirm-use')).toBeEnabled();

        await cafe.pour(fake.machine.pourMoment((frame, socket) => socket === 'machine/snapshot' && frame.state?.state === 'espresso'));
        await untilPickClosed(cafe);
        for (const open of [DOSE, YIELD]) await tapAt(page, open);
        await cafe.pour(3000);
        await expect(pickDialog(page), 'neither opens during a shot').toHaveCount(0);
        await cafe.pour();
        await cafe.untilStored();
        await cafe.storeShot();
        await cafe.advance(2000);
        const beanWrites = cafe.since(mark, entry => isRecordWrite(entry) || (entry.method === 'PUT' && entry.path === '/api/v1/workflow' && 'beanBatchId' in (entry.body?.context || {})));
        expect(beanWrites, 'no bean written, and no record').toEqual([]);
        await expect(dose(page)).toHaveText('SB-0211 · Sample Blend · 16 d since roast');
    });

    // The sample data leaves the machine with no recipe loaded, on Sample
    // Single Origin's batch and no basket.
    test('with no recipe loaded, each choice changes this machine only and writes the Workflow alone', async ({ cafe, fake }) => {
        const page = await openPage(cafe);
        await expect(page.locator('#cafe-title')).toHaveText('No recipe selected');
        const before = records(fake);
        const blend = blendNew(fake);
        const mark = fake.log.length;

        await openDialog(cafe, DOSE);
        await expect(under(page)).toHaveText('No recipe loaded · changes this machine only');
        await useBatch(cafe, 'Sample Blend', 0);
        await expect(dose(page)).toHaveText('SB-0211 · Sample Blend · 16 d since roast');
        await openDialog(cafe, YIELD);
        await expect(under(page)).toHaveText('No recipe loaded · changes this machine only');
        await cafe.screenshot('basket-dialog-no-recipe-light');
        await pickRow(page, '20 g sample basket').click();
        await untilPickClosed(cafe);
        await expect(basket(page)).toHaveText('20 g sample basket');
        await cafe.advance(2000);
        expect(writes(cafe.since(mark)), 'the Workflow alone, once for each').toEqual([
            { write: 'PUT /api/v1/workflow', body: { context: { beanBatchId: blend.id, coffeeName: 'Sample Blend', coffeeRoaster: 'Sample Roasters' } } },
            { write: 'PUT /api/v1/workflow', body: { context: { extras: { basketId: 'bskt-sample-20', basketName: '20 g sample basket' } } } },
        ]);
        expect(fake.workflow().context).toMatchObject({ beanBatchId: blend.id, extras: { basketId: 'bskt-sample-20' } });
        expect(records(fake), 'no recipe\'s DYE2 record changed').toEqual(before);
        await cafe.screenshot('bean-basket-at-end');
    });

    test('in the dark theme', async ({ cafe }) => {
        const page = await openPage(cafe);
        await paint(page, 'dark');
        await openDialog(cafe, DOSE);
        await cafe.screenshot('bean-dialog-dark');
        await page.locator(CLOSE).click();
        await untilPickClosed(cafe);
        await openDialog(cafe, YIELD);
        await cafe.screenshot('basket-dialog-dark');
    });

    test.describe('at 1340 by 800', () => {
        test.use({ viewport: { width: 1340, height: 800 } });

        // Dose's line stays one line: a bean's name too long for the column is
        // the part shortened, with an ellipsis, and the Batch Code and the days
        // since the roast show whole.
        test('a bean\'s name too long for Dose\'s line ends in an ellipsis, and the Batch Code and the days show whole', async ({ cafe, fake }) => {
            const long = 'Sample Single Origin From A Farm With A Name Far Too Long For The Column';
            const { context } = fake.workflow();
            fake.given({ workflow: { ...fake.workflow(), context: { ...context, coffeeName: long, beanBatchId: blendNew(fake).id } } });
            const page = await openPage(cafe);
            await expect(dose(page)).toHaveText(`SB-0211 · ${long} · 16 d since roast`);
            await expect(dosePick(page)).toHaveAccessibleName(`Dose SB-0211 · ${long} · 16 d since roast`);
            const parts = await dose(page).evaluate(line => {
                const box = line.getBoundingClientRect();
                return {
                    line: { wraps: line.scrollHeight > line.clientHeight, right: Math.round(box.right) },
                    parts: [...line.children].map(part => {
                        const style = getComputedStyle(part);
                        const words = part.querySelector('bdi') ?? part;
                        return {
                            text: part.textContent,
                            cut: words.scrollWidth > words.clientWidth,
                            ellipsis: style.textOverflow,
                            right: Math.round(part.getBoundingClientRect().right),
                            top: Math.round(part.getBoundingClientRect().top - box.top),
                        };
                    }),
                };
            });
            expect(parts.line.wraps, 'one line').toBe(false);
            expect(parts.parts.map(({ text, cut }) => ({ text, cut }))).toEqual([
                { text: 'SB-0211 · ', cut: false },
                { text: long, cut: true },
                { text: ' · 16 d since roast', cut: false },
            ]);
            expect(parts.parts[1].ellipsis, 'the name ends in an ellipsis').toBe('ellipsis');
            expect(parts.parts.map(part => part.top), 'all on the line').toEqual([0, 0, 0]);
            expect(parts.parts[2].right, 'the days end inside the line').toBeLessThanOrEqual(parts.line.right);
            await cafe.screenshot('dose-long-bean-1340-light');
        });

        test('a Batch Code too long for Dose\'s line is shortened too, past a third of it, and never pushes the name out', async ({ cafe, fake }) => {
            const code = 'BR-2026-1102\nETHIOPIA-GUJI-LOT-04-ROAST-4471';
            const batch = blendNew(fake);
            batch.extras = { ...batch.extras, decentSyncBatchCode: code };
            fake.store.set('streamlineSettings', 'language', 'de');
            const { context } = fake.workflow();
            fake.given({ workflow: { ...fake.workflow(), context: { ...context, beanBatchId: batch.id } } });
            const page = await openPage(cafe);
            await expect(dose(page)).toHaveText(`${code} · Sample Single Origin · 16 Tg. seit der Röstung`);
            const parts = await dose(page).evaluate(line => {
                const box = line.getBoundingClientRect();
                const measure = element => {
                    const rect = element.getBoundingClientRect();
                    return { cut: element.scrollWidth > element.clientWidth, width: Math.round(rect.width), client: element.clientWidth, right: Math.round(rect.right), top: Math.round(rect.top - box.top), height: Math.round(rect.height) };
                };
                const [codePart, name, days] = line.children;
                return {
                    line: { width: Math.round(box.width), right: Math.round(box.right) },
                    row: line.parentElement.clientWidth,
                    code: { ...measure(codePart.querySelector('bdi')), whole: measure(codePart), ellipsis: getComputedStyle(codePart.querySelector('bdi')).textOverflow },
                    separators: [...line.querySelectorAll('.cafe-dose-separator')].map(separator => ({ text: separator.textContent, ...measure(separator) })),
                    name: measure(name),
                    days: measure(days.querySelector('bdi')),
                };
            });
            expect(parts.code.cut, 'the code is shortened').toBe(true);
            expect(parts.code.ellipsis, 'ending in an ellipsis').toBe('ellipsis');
            expect(parts.code.whole.client, 'to at most about a third of the row').toBeLessThanOrEqual(Math.ceil(parts.row * 0.35));
            expect(parts.code.height, 'its line break kept on the one line').toBeLessThanOrEqual(22);
            expect(parts.separators.map(({ text, width }) => ({ text, shown: width > 0 })), 'both " · " shown').toEqual([{ text: ' · ', shown: true }, { text: ' · ', shown: true }]);
            expect(parts.name.client, 'the bean\'s name keeps its first letters, 2em of them').toBeGreaterThanOrEqual(31);
            expect(parts.days.cut, 'the days whole').toBe(false);
            expect(parts.days.right, 'and inside the line').toBeLessThanOrEqual(parts.line.right);
            expect([parts.code.top, parts.name.top, parts.days.top], 'all on the line').toEqual([0, 0, 0]);
            await cafe.screenshot('dose-long-code-1340-de-light');
        });

        test('a Batch Code shorter than a third of the row shows whole, however short the line', async ({ cafe, fake }) => {
            const code = 'SB-0211';
            const batch = blendNew(fake);
            batch.extras = { ...batch.extras, decentSyncBatchCode: code };
            batch.roastDate = null;
            const { context } = fake.workflow();
            fake.given({ workflow: { ...fake.workflow(), context: { ...context, coffeeName: 'Decaf', beanBatchId: batch.id } } });
            const page = await openPage(cafe);
            await expect(dose(page)).toHaveText(`${code} · Decaf`);
            const cut = await dose(page).evaluate(line => [...line.querySelectorAll('bdi, .cafe-dose-shrinks')].map(part => part.scrollWidth > part.clientWidth));
            expect(cut, 'neither the code nor the name is cut').toEqual([false, false]);
        });

        // With a batch highlighted, "Use this batch" and the note beside it fit
        // the dialog in English and every language Streamline has finished (#70).
        test('"Use this batch", translated, and the note beside it fit the dialog in every finished language', async ({ cafe }) => {
            const page = await openPage(cafe);
            const unfit = [];
            for (const code of ['en', ...FINISHED_LANGUAGES]) {
                if (code !== 'en') {
                    await page.evaluate(async language => {
                        const { setLanguage } = await import('/src/modules/i18n.js');
                        await setLanguage(language);
                    }, code);
                    await cafe.settle();
                }
                await openDialog(cafe, DOSE);
                await sideRow(page, 'Sample Blend').click();
                await batchRow(page, 1).click();
                await expect(page.locator('#cafe-pick-confirm-use')).toBeEnabled();
                const fit = await page.evaluate(() => {
                    const rect = element => element.getBoundingClientRect();
                    const box = rect(document.querySelector('#cafe-pick-dialog .cafe-pick-box'));
                    const row = rect(document.getElementById('cafe-pick-confirm'));
                    const button = document.getElementById('cafe-pick-confirm-use');
                    const note = document.getElementById('cafe-pick-confirm-note');
                    const at = rect(button);
                    return {
                        label: button.textContent,
                        // The whole label shows: the button is as wide as its
                        // text today, and this catches a style that clips it.
                        whole: button.scrollWidth <= button.clientWidth + 1,
                        inside: at.left >= row.left - 1 && at.right <= row.right + 1 && at.bottom <= box.bottom && box.right <= innerWidth && box.bottom <= innerHeight,
                        // Beside the button, on one line, and not squeezed to a sliver.
                        noteBeside: !note.hidden && rect(note).right <= at.left + 1 && rect(note).height < at.height && rect(note).width >= 60,
                    };
                });
                // In this language's own words, so a label left in the last
                // language, or in English, isn't measured in its place.
                const translated = fit.label === (code === 'en' ? 'Use this batch' : CAFE_TRANSLATIONS['Use this batch'][code]);
                if (!fit.whole || !fit.inside || !fit.noteBeside || !translated) unfit.push(`${code}: ${JSON.stringify(fit)}`);
                if (code === 'en') await cafe.screenshot('bean-dialog-highlighted-1340x800-light');
                if (code === 'de') await cafe.screenshot('bean-dialog-highlighted-1340x800-de-light');
                await page.locator(CLOSE).click();
                await untilPickClosed(cafe);
            }
            expect(unfit, `every one of ${1 + FINISHED_LANGUAGES.length} languages fits`).toEqual([]);
        });

        // A row with a Batch Code and a weight says "left" in the page's
        // language, with the weight's number drawn before its unit in Arabic
        // and Hebrew too, and stays inside the list at the narrowest width
        // (#109).
        test('a batch row with a Batch Code and a weight, translated, fits the list in every finished language', async ({ cafe, fake }) => {
            Object.assign(blendNew(fake), { weightRemaining: 240, extras: { decentSyncBatchCode: 'SB-0211' } });
            Object.assign(blendOld(fake), { weightRemaining: 2400, extras: { decentSyncBatchCode: 'SB-0198' } });
            const page = await openPage(cafe);
            const unfit = [];
            for (const code of ['en', ...FINISHED_LANGUAGES]) {
                if (code !== 'en') {
                    await page.evaluate(async language => {
                        const { setLanguage } = await import('/src/modules/i18n.js');
                        await setLanguage(language);
                    }, code);
                    await cafe.settle();
                }
                await openDialog(cafe, DOSE);
                await sideRow(page, 'Sample Blend').click();
                const fit = await page.evaluate(() => {
                    const rect = element => element.getBoundingClientRect();
                    const list = rect(document.getElementById('cafe-pick-list'));
                    const box = rect(document.querySelector('#cafe-pick-dialog .cafe-pick-box'));
                    const rows = [...document.querySelectorAll('#cafe-pick-list .cafe-pick-row')];
                    const numberBeforeUnit = rows.every(row => {
                        const words = row.querySelectorAll('.cafe-pick-row-detail bdi')[1].firstChild;
                        const number = words.data.search(/\d/);
                        const unit = words.data.indexOf('g', number);
                        const at = (start, end) => {
                            const range = document.createRange();
                            range.setStart(words, start);
                            range.setEnd(words, end);
                            return range.getBoundingClientRect().left;
                        };
                        return number >= 0 && unit > number && at(number, number + 1) < at(unit, unit + 1);
                    });
                    return {
                        numberBeforeUnit,
                        details: rows.map(row => row.querySelector('.cafe-pick-row-detail').textContent),
                        inside: rows.every(row => rect(row).left >= list.left - 1 && rect(row).right <= list.right + 1 && row.scrollWidth <= row.clientWidth + 1)
                            && box.right <= innerWidth && box.bottom <= innerHeight,
                    };
                });
                const left = weight => (code === 'en' ? '{weight} left' : CAFE_TRANSLATIONS['{weight} left'][code]).replace('{weight}', weight);
                const translated = fit.details[0].startsWith(`SB-0211 · ${left(ltr('240 g'))} · `) && fit.details[1].startsWith(`SB-0198 · ${left(ltr('2.4 kg'))} · `);
                if (fit.details.length !== 2 || !fit.inside || !fit.numberBeforeUnit || !translated) unfit.push(`${code}: ${JSON.stringify(fit)}`);
                if (code === 'de') await cafe.screenshot('bean-dialog-code-weight-1340x800-de-light');
                if (code === 'ar') await cafe.screenshot('bean-dialog-code-weight-1340x800-ar-light');
                await page.locator(CLOSE).click();
                await untilPickClosed(cafe);
            }
            expect(unfit, `every one of ${1 + FINISHED_LANGUAGES.length} languages fits`).toEqual([]);
        });
    });
});
