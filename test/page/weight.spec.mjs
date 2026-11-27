// A batch's weight entered from the bean and batch dialog (#118;
// docs/cafe/DESIGN.md, "Entering a batch's weight"): "Enter weight", to the
// left of "Use this batch" and of "In use", puts the highlighted batch's
// weight view in the lists' place. What the scale reads is typed, the Skin's
// one setting, the container's weight, is taken off it, and what is left is
// written to Decaid's record of the batch, alone. Nothing left archives the
// record and writes no zero. Nothing is asked of Decent Sync's plugin, and the
// Workflow and the recipes' records are not written. The setting is on the
// Settings page, under Cafe.
//
// The sample data (fake-decaid/recordings/sample-data.json) holds the three
// beans with their batches, none with a weight; a test gives the batch it
// needs its weights and its Batch Code, in the fake. What Decaid answers a
// write of a batch's remaining weight and of its archive is
// recordings/batch-weight.json and recordings/batch-archive.json.

import { test, expect } from './support/test.mjs';
import { pickDialog, pickClosed, pickRows, tapAt, isWrite, writes, paint, openPage, card, untilPickClosed } from './support/page-reads.mjs';
import { recordOf } from './support/fake-reads.mjs';
import { RECIPES } from './support/sample-data.mjs';
import { SUPPORTED_LANGUAGES } from '../../src/modules/i18n-parser.js';
import { CAFE_TRANSLATIONS } from '../../src/cafe/translations.js';
import { WEIGHT_PHRASES } from '../../src/cafe/weight-model.js';

const [house] = RECIPES;
const DOSE = '#dose-section .cafe-row-name';
const CLOSE = '#cafe-pick-dialog form[method="dialog"] .cafe-btn';
const CONTAINER_STORE = '/api/v1/store/streamlineCafe/batchContainerWeight';
const PLUGIN = /^\/api\/v1\/plugins\/decent-sync\.reaplugin\//;
const FINISHED_LANGUAGES = SUPPORTED_LANGUAGES.filter(code => code !== 'en' && !code.includes('unfinished'));
const EXTRAS = { decentSyncId: 'sample-server-batch-1', decentSyncBatchCode: 'SR-0412' };

// ── The sample data, as the fake holds it.
const beanNamed = (fake, name) => fake.library.state.beans.find(bean => bean.name === name);
const batchOf = (fake, name, day) => fake.library.state.batches.find(batch => batch.beanId === beanNamed(fake, name).id && batch.roastDate.startsWith(day));
const blendNew = fake => batchOf(fake, 'Sample Blend', '2026-11-02');
const blendOld = fake => batchOf(fake, 'Sample Blend', '2026-10-15');
const decafBatch = fake => batchOf(fake, 'Example Decaf', '2026-10-20');
const setContainer = (fake, grams) => fake.store.set('streamlineCafe', 'batchContainerWeight', grams);
const batchPath = batch => `/api/v1/bean-batches/${batch.id}`;
const copyOf = value => JSON.parse(JSON.stringify(value));
/** A record but for when it last changed. */
const fields = record => { const { updatedAt, ...rest } = record; return rest; };

// ── The page.
const weigh = page => page.locator('#cafe-pick-weigh');
const use = page => page.locator('#cafe-pick-confirm-use');
const view = page => page.locator('#cafe-pick-weight');
const field = page => page.locator('#cafe-weight-field');
const save = page => page.locator('#cafe-weight-save');
const back = page => page.locator('#cafe-weight-back');
const message = page => page.locator('#cafe-weight-message');
const working = page => page.locator('#cafe-weight-working');
const sideRow = (page, name) => page.locator('#cafe-pick-side .cafe-pick-row').filter({ has: page.locator('.cafe-pick-row-name', { hasText: name }) });
const batchRow = (page, n) => page.locator('#cafe-pick-list .cafe-pick-row').nth(n);
const plain = text => text.replace(/[⁦⁩]/g, '').replace(/\s+/g, ' ').trim();
const facts = page => page.locator('#cafe-weight-facts .cafe-weight-fact').evaluateAll(rows => rows.map(row => [row.querySelector('dt').textContent, row.querySelector('dd').textContent.replace(/[⁦⁩]/g, '')]));
const redSlots = page => page.locator('#cafe-strip .cafe-card-finished').evaluateAll(cards => cards.map(el => Number(el.dataset.slot)));

async function openDialog(cafe, on = DOSE) {
    await tapAt(cafe.page, on);
    await expect(pickDialog(cafe.page)).toBeVisible();
    await cafe.settle();
}

/** The dialog open on `bean`, its batch `n` highlighted. */
async function highlight(cafe, bean, n) {
    const { page } = cafe;
    await openDialog(cafe);
    await sideRow(page, bean).click();
    await batchRow(page, n).click();
    await expect(batchRow(page, n)).toHaveAttribute('aria-pressed', 'true');
}

/** The weight view of `bean`'s batch `n`, with the container's weight read. */
async function openView(cafe, bean = 'Sample Blend', n = 0) {
    const { page } = cafe;
    await highlight(cafe, bean, n);
    await weigh(page).click();
    await expect(view(page)).toBeVisible();
    await cafe.settle();
    await expect(field(page)).toBeEnabled();
    return page;
}

/** What the scale reads, entered on the numpad, as on a tablet. */
async function enter(cafe, grams) {
    const { page } = cafe;
    await field(page).click();
    await expect(page.locator('#numpad-modal-overlay')).toBeVisible();
    for (const digit of String(grams)) await page.locator(`.numpad-modal-numpad-btn[data-number="${digit}"]`).click();
    await page.locator('#numpad-confirm').click();
    await expect(page.locator('#numpad-modal-overlay')).toBeHidden();
    await cafe.settle();
}

/** The view left for the lists, read again. */
async function backOnLists(cafe) {
    await expect(view(cafe.page)).toBeHidden();
    await expect(pickDialog(cafe.page)).toBeVisible();
    await cafe.settle();
}

test.describe('Enter weight, the button', { tag: '@weight' }, () => {
    test('it is to the left of "Use this batch" and of "In use", and can be tapped only with a batch highlighted', async ({ cafe, fake }) => {
        const inUse = fake.workflow().context.beanBatchId;
        expect(inUse, 'the sample Workflow names a batch').toBeTruthy();
        const page = await openPage(cafe);
        await openDialog(cafe);
        // The dialog opens on the batch in use, highlighted.
        await expect(weigh(page)).toHaveText('Enter weight');
        await expect(weigh(page)).toBeEnabled();
        await expect(page.locator('#cafe-pick-confirm-in-use')).toBeVisible();
        await expect(use(page)).toBeHidden();
        const leftOf = (a, b) => page.evaluate(([left, right]) => document.querySelector(left).getBoundingClientRect().right <= document.querySelector(right).getBoundingClientRect().left, [a, b]);
        expect(await leftOf('#cafe-pick-weigh', '#cafe-pick-confirm-in-use'), 'to the left of "In use"').toBe(true);
        await cafe.screenshot('weight-button-in-use-light');

        // Another bean: none of its batches is highlighted, and neither button can be tapped.
        const other = (await page.locator('#cafe-pick-side .cafe-pick-row[aria-pressed="false"]').first());
        await other.click();
        await expect(weigh(page)).toBeDisabled();
        await expect(use(page)).toBeDisabled();
        await batchRow(page, 0).click();
        await expect(weigh(page)).toBeEnabled();
        await expect(use(page)).toBeEnabled();
        expect(await leftOf('#cafe-pick-weigh', '#cafe-pick-confirm-use'), 'to the left of "Use this batch"').toBe(true);
        expect(await leftOf('#cafe-pick-confirm-note', '#cafe-pick-weigh'), 'the note is to its left').toBe(true);
        await cafe.screenshot('weight-button-light');
        await paint(page, 'dark');
        await cafe.screenshot('weight-button-dark');
        await paint(page, 'light');
    });

    test('the grinder, basket, profile and barista dialogs have none', async ({ cafe }) => {
        const page = await openPage(cafe);
        for (const on of ['#grind-section .cafe-row-name', '#drink-section .cafe-row-name', '#brew-section .cafe-row-name', '#cafe-barista']) {
            if (on === '#cafe-barista') await page.locator(on).click();
            else await tapAt(page, on);
            await expect(pickDialog(page), on).toBeVisible();
            await cafe.settle();
            await expect(weigh(page), `${on} has no Enter weight`).toBeHidden();
            await expect(view(page)).toBeHidden();
            await page.locator(CLOSE).click();
            await untilPickClosed(cafe);
        }
    });

    test('with no Decent Sync plugin it shows, saves, and asks no plugin anything', async ({ cafe, fake }) => {
        Object.assign(blendNew(fake), { weightRemaining: 2412 });
        const page = await openPage(cafe);
        const mark = fake.log.length;
        await openView(cafe);
        await enter(cafe, 2000);
        await save(page).click();
        await backOnLists(cafe);
        expect(blendNew(fake).weightRemaining).toBe(2000);
        expect(cafe.since(mark, entry => PLUGIN.test(entry.path)), 'nothing asked of Decent Sync\'s plugin').toEqual([]);
    });
});

test.describe('Enter weight, with Decent Sync\'s plugin', { tag: '@weight' }, () => {
    test.use({ decentSync: true });

    test('serving the Machine: the button shows, and the save asks the plugin nothing', async ({ cafe, fake }) => {
        Object.assign(blendNew(fake), { weightRemaining: 2412, extras: copyOf(EXTRAS) });
        const page = await openPage(cafe);
        await cafe.advance(1000);
        const mark = fake.log.length;
        await openView(cafe);
        await enter(cafe, 2000);
        await save(page).click();
        await backOnLists(cafe);
        expect(blendNew(fake).weightRemaining).toBe(2000);
        expect(blendNew(fake).extras, 'the id and Batch Code Decent Sync keeps there are as they were').toEqual(EXTRAS);
        expect(cafe.since(mark, entry => PLUGIN.test(entry.path) && isWrite(entry)), 'nothing asked of the plugin').toEqual([]);
        expect(await view(page).evaluate(part => part.closest('.cafe-pick-box').textContent), 'no message names Decent Sync or a Location').not.toMatch(/Decent Sync|Location|Sample Cafe/);
    });

    test('on a Capture-only Machine the button shows and the save is made the same way', async ({ cafe, fake }) => {
        fake.decentSync.setSharing(false);
        Object.assign(blendNew(fake), { weightRemaining: 2412 });
        const page = await openPage(cafe);
        await cafe.advance(1000);
        const mark = fake.log.length;
        await openView(cafe);
        await enter(cafe, 2000);
        await save(page).click();
        await backOnLists(cafe);
        expect(blendNew(fake).weightRemaining).toBe(2000);
        expect(cafe.since(mark, entry => PLUGIN.test(entry.path) && isWrite(entry))).toEqual([]);
    });
});

test.describe('Enter weight, the view', { tag: '@weight' }, () => {
    test('it takes the lists\' place in the same dialog and says the batch, what is left, its roasted weight and the container', async ({ cafe, fake }) => {
        Object.assign(blendNew(fake), { weight: 6000, weightRemaining: 2412.4, extras: copyOf(EXTRAS) });
        setContainer(fake, 350);
        const page = await openPage(cafe);
        await highlight(cafe, 'Sample Blend', 0);
        const rowName = await batchRow(page, 0).locator('.cafe-pick-row-name').textContent();
        expect(rowName).toMatch(/^Roasted /);
        await weigh(page).click();
        await expect(view(page)).toBeVisible();
        await cafe.settle();
        expect(await page.locator('dialog[open]').count(), 'no second dialog opens').toBe(1);
        await expect(page.locator('#cafe-pick-dialog .cafe-pick-lists')).toBeHidden();
        await expect(page.locator('#cafe-pick-title')).toHaveText('Enter weight');
        await expect(page.locator('#cafe-pick-under'), 'the batch\'s Bean and roast date').toHaveText(`Sample Blend · ${rowName}`);
        await expect(page.locator('#cafe-weight-name')).toHaveText(rowName);
        await expect(page.locator('#cafe-weight-code')).toHaveText('SR-0412');
        expect(await facts(page)).toEqual([['Left now', '2412 g'], ['Roasted weight', '6000 g'], ['Container', '350 g']]);
        await expect(page.locator('#cafe-weight-label')).toHaveText('Weight with its container');
        await expect(save(page)).toHaveText('Save');
        await expect(save(page), 'an empty field can\'t be saved').toBeDisabled();
        await expect(working(page)).toBeHidden();
        await expect(message(page)).toBeHidden();
        await cafe.screenshot('weight-view-empty-light');

        await enter(cafe, 3240);
        await expect(field(page)).toHaveValue('3240');
        expect(plain(await working(page).innerText()), 'the working, before anything is saved').toBe('3240 g − 350 g container = 2890 g left');
        await expect(message(page)).toBeHidden();
        await expect(save(page)).toBeEnabled();
        await cafe.screenshot('weight-view-light');
        await paint(page, 'dark');
        await cafe.screenshot('weight-view-dark');
        await paint(page, 'light');
    });

    test('with no container set the field reads "Weight", there is no working line and nothing mentions a container', async ({ cafe, fake }) => {
        Object.assign(blendNew(fake), { weight: 6000, weightRemaining: 2412 });
        const page = await openPage(cafe);
        await openView(cafe);
        await expect(page.locator('#cafe-weight-label')).toHaveText('Weight');
        expect(await facts(page)).toEqual([['Left now', '2412 g'], ['Roasted weight', '6000 g']]);
        await enter(cafe, 2890);
        await expect(working(page)).toBeHidden();
        await expect(save(page)).toBeEnabled();
        expect(await page.locator('#cafe-pick-dialog .cafe-pick-box').evaluate(box => box.innerText), 'no container is mentioned').not.toMatch(/container/i);
        await cafe.screenshot('weight-view-no-container-light');
    });

    test('Save sends Decaid one write holding the remaining weight alone, and the lists come back read again with the row showing it', async ({ cafe, fake }) => {
        Object.assign(blendNew(fake), { weight: 6000, weightRemaining: 2412, extras: copyOf(EXTRAS), notes: 'Sample note' });
        setContainer(fake, 350);
        const before = copyOf(blendNew(fake));
        const workflow = fake.workflow();
        const recipes = copyOf(fake.store.get('dye2.reaplugin', 'recipes'));
        const page = await openPage(cafe);
        await openView(cafe);
        await enter(cafe, 3240);
        const mark = fake.log.length;
        await save(page).click();
        await backOnLists(cafe);
        expect(writes(cafe.since(mark)), 'one write, of the remaining weight alone').toEqual([{ write: `PUT ${batchPath(before)}`, body: { weightRemaining: 2890 } }]);
        expect(fields(blendNew(fake)), 'every other field of the record as it was, its extras too').toEqual({ ...fields(before), weightRemaining: 2890 });
        expect(cafe.since(mark, entry => entry.method === 'GET' && /\/beans(\/|\?|$)/.test(entry.path)).length, 'the lists are read again').toBeGreaterThan(0);
        await expect(page.locator('#cafe-pick-title')).toHaveText('Bean and batch');
        await expect(batchRow(page, 0), 'the batch is still highlighted').toHaveAttribute('aria-pressed', 'true');
        expect((await pickRows(page))[0].detail.replace(/[⁦⁩]/g, ''), 'its row shows the new weight').toContain('SR-0412 · 2.9 kg left');
        expect(fake.workflow(), 'the Workflow is not written').toEqual(workflow);
        expect(fake.store.get('dye2.reaplugin', 'recipes'), 'nor a recipe\'s record').toEqual(recipes);
        await cafe.screenshot('weight-saved-light');
    });

    test('a batch nobody has weighed says so and takes a weight, and an empty field can\'t be saved', async ({ cafe, fake }) => {
        expect('weightRemaining' in blendOld(fake), 'the sample batch has no weight').toBe(false);
        const page = await openPage(cafe);
        await openView(cafe, 'Sample Blend', 1);
        expect(await facts(page)).toEqual([['Left now', 'Not weighed yet']]);
        await expect(field(page)).toHaveValue('');
        await expect(save(page)).toBeDisabled();
        const mark = fake.log.length;
        await page.locator('#cafe-weight-form').evaluate(form => form.requestSubmit());
        await cafe.settle();
        expect(writes(cafe.since(mark)), 'the form submitted with nothing typed writes nothing').toEqual([]);
        await cafe.screenshot('weight-view-not-weighed-light');
        await enter(cafe, 1800);
        await save(page).click();
        await backOnLists(cafe);
        expect(blendOld(fake).weightRemaining).toBe(1800);
        expect((await pickRows(page))[1].detail.replace(/[⁦⁩]/g, '')).toContain('1.8 kg left');
    });

    test('nothing left: the view says so, and "Finish batch" archives the record and writes no weight', async ({ cafe, fake }) => {
        Object.assign(blendOld(fake), { weight: 6000, weightRemaining: 240, extras: copyOf(EXTRAS) });
        setContainer(fake, 350);
        const before = copyOf(blendOld(fake));
        const page = await openPage(cafe);
        await openView(cafe, 'Sample Blend', 1);
        await enter(cafe, 350);
        expect(plain(await working(page).innerText())).toBe('350 g − 350 g container = 0 g left');
        await expect(page.locator('#cafe-weight-message-title')).toHaveText('Nothing is left');
        await expect(page.locator('#cafe-weight-message-body')).toHaveText(WEIGHT_PHRASES.nothingLeftBody);
        await expect(save(page)).toHaveText('Finish batch');
        await expect(save(page)).toBeEnabled();
        await cafe.screenshot('weight-view-finish-light');
        await paint(page, 'dark');
        await cafe.screenshot('weight-view-finish-dark');
        await paint(page, 'light');
        const mark = fake.log.length;
        await save(page).click();
        await backOnLists(cafe);
        expect(writes(cafe.since(mark)), 'one write: the archive, and no zero').toEqual([{ write: `PUT ${batchPath(before)}`, body: { archived: true } }]);
        expect(fields(blendOld(fake))).toEqual({ ...fields(before), archived: true });
        await expect(page.locator('#cafe-pick-list .cafe-pick-row'), 'the row has left the list').toHaveCount(1);
        await expect(sideRow(page, 'Sample Blend').locator('.cafe-pick-row-detail')).toHaveText('Sample Roasters · 1 batch');
        await cafe.screenshot('weight-finished-light');
    });

    test('a record that already reads zero is finished the same way, and its Bean leaves the list with its last batch', async ({ cafe, fake }) => {
        Object.assign(decafBatch(fake), { weightRemaining: 0 });
        const page = await openPage(cafe);
        await openView(cafe, 'Example Decaf', 0);
        expect(await facts(page)).toEqual([['Left now', '0 g']]);
        await enter(cafe, 0);
        await expect(working(page), 'no container: no working line').toBeHidden();
        await expect(save(page)).toHaveText('Finish batch');
        const mark = fake.log.length;
        await save(page).click();
        await backOnLists(cafe);
        expect(writes(cafe.since(mark))).toEqual([{ write: `PUT ${batchPath(decafBatch(fake))}`, body: { archived: true } }]);
        expect(decafBatch(fake).archived).toBe(true);
        expect(decafBatch(fake).weightRemaining, 'the weight is as it was').toBe(0);
        await expect(sideRow(page, 'Example Decaf'), 'the Bean has left the list').toHaveCount(0);
        await expect(page.locator('#cafe-pick-side .cafe-pick-row')).toHaveCount(2);
    });

    test('after "Finish batch" on the batch a recipe and the Workflow name, the card and the name under Dose are red with nothing else tapped', async ({ cafe, fake }) => {
        const page = await openPage(cafe);
        await card(page, house.slot).click();
        await expect(page.locator('#cafe-title')).toHaveText(house.name);
        await cafe.advance(2000);
        const named = fake.library.state.batches.find(batch => batch.id === recordOf(fake, house.name).beanBatchId);
        expect(fake.workflow().context.beanBatchId, 'the Workflow names the recipe\'s batch').toBe(named.id);
        await expect.poll(() => redSlots(page)).toEqual([]);
        await openDialog(cafe);
        await expect(page.locator('#cafe-pick-confirm-in-use'), 'the batch in use is highlighted').toBeVisible();
        await weigh(page).click();
        await expect(view(page)).toBeVisible();
        await cafe.settle();
        await enter(cafe, 0);
        await save(page).click();
        await backOnLists(cafe);
        expect(named.archived).toBe(true);
        await cafe.advance(1000);
        const sharing = fake.store.get('dye2.reaplugin', 'recipes').filter(row => row && row.beanBatchId === named.id && row.stripSlot).map(row => Number(row.stripSlot)).sort();
        expect(sharing).toContain(house.slot);
        await expect.poll(() => redSlots(page).then(slots => slots.sort()), 'each card that names the batch is red, the dialog still open').toEqual(sharing);
        await expect(page.locator('#cafe-dose-desc'), 'and the name under Dose').toHaveClass(/cafe-batch-finished/);
        await expect(pickDialog(page)).toBeVisible();
        await page.locator(CLOSE).click();
        await untilPickClosed(cafe);
        await cafe.screenshot('weight-finished-page-light');
    });

    test('less than the container is refused with its message, and Save can\'t be tapped', async ({ cafe, fake }) => {
        Object.assign(blendNew(fake), { weight: 6000, weightRemaining: 2412 });
        setContainer(fake, 350);
        const page = await openPage(cafe);
        await openView(cafe);
        await enter(cafe, 300);
        expect(plain(await working(page).innerText()), 'the working has no result').toBe('300 g − 350 g container');
        await expect(page.locator('#cafe-weight-message-title')).toHaveText('Less than the container');
        expect(plain(await page.locator('#cafe-weight-message-body').textContent())).toBe('The container alone weighs 350 g. Weigh the batch in its container and enter what the scale reads.');
        await expect(save(page)).toHaveText('Save');
        await expect(save(page)).toBeDisabled();
        const mark = fake.log.length;
        await page.locator('#cafe-weight-form').evaluate(form => form.requestSubmit());
        await cafe.settle();
        expect(writes(cafe.since(mark))).toEqual([]);
        await cafe.screenshot('weight-view-under-container-light');
    });

    test('more than the roasted weight is a warning that can still be saved, and a record with no roasted weight shows none', async ({ cafe, fake }) => {
        Object.assign(blendNew(fake), { weight: 6000, weightRemaining: 2412 });
        Object.assign(blendOld(fake), { weightRemaining: 500 });
        setContainer(fake, 350);
        const page = await openPage(cafe);
        await openView(cafe);
        await enter(cafe, 32400);
        expect(plain(await working(page).innerText())).toBe('32400 g − 350 g container = 32050 g left');
        await expect(message(page)).toHaveAttribute('data-tone', 'warn');
        await expect(page.locator('#cafe-weight-message-title')).toHaveText('More than this batch was roasted at');
        expect(plain(await page.locator('#cafe-weight-message-body').textContent())).toBe('It was roasted at 6000 g. Check the number before saving.');
        await expect(save(page)).toBeEnabled();
        await cafe.screenshot('weight-view-above-roasted-light');
        await paint(page, 'dark');
        await cafe.screenshot('weight-view-above-roasted-dark');
        await paint(page, 'light');
        await save(page).click();
        await backOnLists(cafe);
        expect(blendNew(fake).weightRemaining, 'it can still be saved').toBe(32050);

        await batchRow(page, 1).click();
        await weigh(page).click();
        await expect(view(page)).toBeVisible();
        await cafe.settle();
        await enter(cafe, 32400);
        await expect(message(page), 'no roasted weight, no warning').toBeHidden();
        await expect(save(page)).toBeEnabled();
    });

    for (const [what, grams, body, title] of [
        ['a save', 3240, { weightRemaining: 2890 }, 'Could not save the weight'],
        ['a finish', 350, { archived: true }, 'Could not finish the batch'],
    ]) {
        test(`${what} Decaid refuses stays in the view with a message, and the record is unchanged`, async ({ cafe, fake }) => {
            Object.assign(blendNew(fake), { weight: 6000, weightRemaining: 2412, extras: copyOf(EXTRAS) });
            setContainer(fake, 350);
            const before = copyOf(blendNew(fake));
            const page = await openPage(cafe);
            await openView(cafe);
            await enter(cafe, grams);
            fake.refuse({ method: 'PUT', path: /\/bean-batches\//, status: 500, times: 1 });
            const mark = fake.log.length;
            await save(page).click();
            await cafe.settle();
            await expect(view(page), 'the view stays').toBeVisible();
            await expect(page.locator('#cafe-weight-message-title')).toHaveText(title);
            await expect(page.locator('#cafe-weight-message-body')).toHaveText('Nothing was changed. Try again.');
            expect(writes(cafe.since(mark))).toEqual([{ write: `PUT ${batchPath(before)}`, body }]);
            expect(blendNew(fake), 'the record is unchanged').toEqual(before);
            await expect(field(page)).toHaveValue(String(grams));
            if (what === 'a save') await cafe.screenshot('weight-view-could-not-save-light');
            // It can be tried again.
            await expect(save(page)).toBeEnabled();
            await save(page).click();
            await backOnLists(cafe);
            expect(blendNew(fake)).toMatchObject(body);
        });
    }

    test('an answer that does not hold the weight is a save that failed', async ({ cafe, fake }) => {
        Object.assign(blendNew(fake), { weightRemaining: 2412 });
        const before = copyOf(blendNew(fake));
        const page = await openPage(cafe);
        await openView(cafe);
        await enter(cafe, 2000);
        fake.refuse({ method: 'PUT', path: /\/bean-batches\//, status: 200, body: before, times: 1 });
        await save(page).click();
        await cafe.settle();
        await expect(page.locator('#cafe-weight-message-title')).toHaveText('Could not save the weight');
        await expect(view(page)).toBeVisible();
    });

    test('Back returns to the lists as they were, with nothing written', async ({ cafe, fake }) => {
        Object.assign(blendNew(fake), { weightRemaining: 2412 });
        const page = await openPage(cafe);
        await highlight(cafe, 'Sample Blend', 0);
        const line = await page.locator('#cafe-pick-under').textContent();
        const mark = fake.log.length;
        await weigh(page).click();
        await expect(view(page)).toBeVisible();
        await cafe.settle();
        await enter(cafe, 2000);
        await back(page).click();
        await backOnLists(cafe);
        await expect(page.locator('#cafe-pick-title')).toHaveText('Bean and batch');
        await expect(page.locator('#cafe-pick-under')).toHaveText(line);
        await expect(batchRow(page, 0)).toHaveAttribute('aria-pressed', 'true');
        // Streamline's numpad keeps the numbers last entered in a field, as for every field it opens on.
        expect(writes(cafe.since(mark)).filter(({ write }) => !write.startsWith('POST /api/v1/store/numpad/')), 'nothing written to a batch, the Workflow or a recipe').toEqual([]);
        // Opened again, the field is empty.
        await weigh(page).click();
        await expect(view(page)).toBeVisible();
        await expect(field(page)).toHaveValue('');
        await expect(save(page)).toBeDisabled();
    });

    const WAYS_OUT = {
        Close: async cafe => { await cafe.page.locator(CLOSE).click(); },
        'a tap outside': async cafe => { await cafe.page.mouse.click(30, 30); },
        'a shot starting': async cafe => { await cafe.pour(cafe.fake.machine.pourMoment((frame, socket) => socket === 'machine/snapshot' && frame.state?.state === 'espresso')); },
        'the machine going to sleep': async cafe => { cafe.fake.machine.setState('sleeping'); await cafe.advance(500); },
        'the main page hidden behind Settings': async cafe => {
            await cafe.page.evaluate(() => document.getElementById('settings-btn').click());
            await expect(cafe.page.locator('#subpage-host #settings-content-area')).toBeVisible();
        },
    };
    for (const [way, leave] of Object.entries(WAYS_OUT)) {
        test(`${way} closes the dialog from the view, and nothing is written to the batch`, async ({ cafe, fake }) => {
            Object.assign(blendNew(fake), { weightRemaining: 2412 });
            const before = copyOf(blendNew(fake));
            const page = await openPage(cafe);
            await openView(cafe);
            await enter(cafe, 2000);
            const mark = fake.log.length;
            await leave(cafe);
            await expect(pickClosed(page)).toBeAttached();
            await expect(view(page)).toBeHidden();
            expect(cafe.since(mark, entry => isWrite(entry) && /\/bean-batches\//.test(entry.path)), 'no write to a batch').toEqual([]);
            expect(blendNew(fake)).toEqual(before);
        });
    }

    test('a shot starting closes the numpad with the dialog', async ({ cafe, fake }) => {
        Object.assign(blendNew(fake), { weightRemaining: 2412 });
        const page = await openPage(cafe);
        await openView(cafe);
        await field(page).click();
        await expect(page.locator('#numpad-modal-overlay')).toBeVisible();
        await cafe.pour(fake.machine.pourMoment((frame, socket) => socket === 'machine/snapshot' && frame.state?.state === 'espresso'));
        await expect(pickClosed(page)).toBeAttached();
        await expect(page.locator('#numpad-modal-overlay'), 'no numpad left over the shot').toBeHidden();
    });

    test('where the numpad is not used the field is typed into, in whole grams up to 100 000', async ({ cafe, fake }) => {
        Object.assign(blendNew(fake), { weightRemaining: 2412 });
        setContainer(fake, 350);
        await cafe.open({ before: () => { window._forceNumpadMobile = false; } });
        const { page } = cafe;
        await openView(cafe);
        await expect(field(page)).not.toHaveAttribute('readonly', /.*/);
        await field(page).click();
        await expect(page.locator('#numpad-modal-overlay'), 'no numpad').toBeHidden();
        await field(page).pressSequentially('12a.3x45');
        await expect(field(page), 'digits alone').toHaveValue('12345');
        await field(page).fill('');
        await expect(save(page)).toBeDisabled();
        await field(page).pressSequentially('999999');
        await expect(field(page), 'nothing above 100 000 g can be entered').toHaveValue('100000');
        await field(page).fill('3240');
        expect(plain(await working(page).innerText())).toBe('3240 g − 350 g container = 2890 g left');
        const mark = fake.log.length;
        await field(page).press('Enter');
        await backOnLists(cafe);
        expect(writes(cafe.since(mark))).toEqual([{ write: `PUT ${batchPath(blendNew(fake))}`, body: { weightRemaining: 2890 } }]);
    });

    test('on a tablet the numpad takes no more than five digits, so nothing above 100 000 g is entered there either', async ({ cafe, fake }) => {
        Object.assign(blendNew(fake), { weightRemaining: 2412 });
        const page = await openPage(cafe);
        await openView(cafe);
        await expect(field(page)).toHaveAttribute('readonly', '');
        await expect(field(page)).toHaveAttribute('placeholder', 'Tap to enter');
        await enter(cafe, 1234567);
        expect(Number(await field(page).inputValue())).toBeLessThanOrEqual(100_000);
    });

    test('a container\'s weight that can\'t be read goes back to the lists and says so', async ({ cafe, fake }) => {
        const page = await openPage(cafe);
        await highlight(cafe, 'Sample Blend', 0);
        fake.refuse({ method: 'GET', path: /\/store\/streamlineCafe\/batchContainerWeight/, status: 500, times: 1 });
        await weigh(page).click();
        await backOnLists(cafe);
        await expect(page.locator('#cafe-pick-title')).toHaveText('Bean and batch');
        await expect(page.getByText('Could not read the container\'s weight')).toBeVisible();
    });
});

for (const size of [{ width: 1340, height: 800 }, { width: 1280, height: 800 }]) {
    test.describe(`Enter weight at ${size.width} by ${size.height}`, { tag: '@weight' }, () => {
        test.use({ viewport: size });

        test('the view and the button, translated, fit the dialog in every finished language', async ({ cafe, fake }) => {
            // Eighteen languages, each with the dialog opened and three weights entered on the numpad.
            test.slow();
            Object.assign(blendNew(fake), { weight: 6000, weightRemaining: 2412, extras: copyOf(EXTRAS) });
            setContainer(fake, 350);
            const page = await openPage(cafe);
            const said = (key, code) => (code === 'en' || !CAFE_TRANSLATIONS[key] ? key : CAFE_TRANSLATIONS[key][code]);
            const unfit = [];
            const measure = () => page.evaluate(() => {
                const rect = element => element.getBoundingClientRect();
                const box = document.querySelector('#cafe-pick-dialog .cafe-pick-box');
                const at = rect(box);
                const shown = [...box.querySelectorAll('#cafe-pick-weight *, #cafe-pick-confirm > *, .cafe-pick-head *')].filter(element => element instanceof HTMLElement && element.offsetParent !== null);
                const outside = shown.filter(element => { const r = rect(element); return r.left < at.left - 1 || r.right > at.right + 1 || r.top < at.top - 1 || r.bottom > at.bottom + 1; }).map(element => element.id || element.className);
                const clipped = [...box.querySelectorAll('button, #cafe-weight-label, .cafe-weight-fact dt, .cafe-weight-fact dd')].filter(element => element.offsetParent !== null && element.scrollWidth > element.clientWidth + 1).map(element => element.id || element.textContent);
                return { outside, clipped, inWindow: at.left >= 0 && at.top >= 0 && at.right <= innerWidth && at.bottom <= innerHeight, sideways: box.scrollWidth > box.clientWidth + 1 };
            });
            const bad = fit => fit.outside.length || fit.clipped.length || !fit.inWindow || fit.sideways;
            for (const code of ['en', ...FINISHED_LANGUAGES]) {
                if (code !== 'en') {
                    await page.evaluate(async language => {
                        const { setLanguage } = await import('/src/modules/i18n.js');
                        await setLanguage(language);
                    }, code);
                    await cafe.settle();
                }
                await highlight(cafe, 'Sample Blend', 1);
                const button = await measure();
                const label = await weigh(page).textContent();
                if (bad(button) || label !== said('Enter weight', code)) unfit.push(`${code}, the button "${label}": ${JSON.stringify(button)}`);
                if (code === 'de') await cafe.screenshot(`weight-button-${size.width}x${size.height}-de-light`);
                await batchRow(page, 0).click();
                await weigh(page).click();
                await expect(view(page)).toBeVisible();
                await cafe.settle();
                // Each state with a message, the longest last.
                for (const grams of [300, 32400, 350]) {
                    await enter(cafe, grams);
                    const fit = await measure();
                    const words = { title: await page.locator('#cafe-pick-title').textContent(), label: await page.locator('#cafe-weight-label').textContent(), save: await save(page).textContent() };
                    const translated = words.title === said('Enter weight', code) && words.label === said('Weight with its container', code)
                        && words.save === (grams === 350 ? said('Finish batch', code) : await page.evaluate(async () => (await import('/src/cafe/text.js')).cafeText('Save')));
                    if (bad(fit) || !translated) unfit.push(`${code}, ${grams} g: ${JSON.stringify({ ...fit, ...words })}`);
                }
                if (code === 'en') await cafe.screenshot(`weight-view-finish-${size.width}x${size.height}-light`);
                if (code === 'de') await cafe.screenshot(`weight-view-finish-${size.width}x${size.height}-de-light`);
                if (code === 'ar') await cafe.screenshot(`weight-view-finish-${size.width}x${size.height}-ar-light`);
                await page.locator(CLOSE).click();
                await untilPickClosed(cafe);
            }
            expect(unfit, `every one of ${1 + FINISHED_LANGUAGES.length} languages fits`).toEqual([]);
        });
    });
}

test.describe('the Cafe setting', { tag: '@weight' }, () => {
    const setting = page => page.locator('#cafe-container-weight');
    const kept = fake => { const value = fake.store.get('streamlineCafe', 'batchContainerWeight'); return value === null ? null : Number(value); };
    const containerWrites = (cafe, mark) => cafe.since(mark, entry => isWrite(entry) && entry.path === CONTAINER_STORE).map(entry => entry.body);

    async function openSettings(cafe) {
        const { page } = cafe;
        await page.evaluate(() => document.getElementById('settings-btn').click());
        await expect(page.locator('#subpage-host #settings-content-area')).toBeVisible();
        await cafe.settle();
    }

    async function openCategory(cafe) {
        const { page } = cafe;
        await page.locator('#cafe-btn').click();
        await expect(setting(page)).toBeVisible();
        await cafe.settle();
        await expect(setting(page)).toBeEnabled();
    }

    async function openCafeSettings(cafe) {
        await openSettings(cafe);
        await openCategory(cafe);
    }

    /** A weight entered on the setting's numpad, as on a tablet. */
    async function set(cafe, grams) {
        const { page } = cafe;
        await setting(page).click();
        await expect(page.locator('#numpad-modal-overlay')).toBeVisible();
        for (const digit of String(grams)) await page.locator(`.numpad-modal-numpad-btn[data-number="${digit}"]`).click();
        await page.locator('#numpad-confirm').click();
        await expect(page.locator('#numpad-modal-overlay')).toBeHidden();
        await cafe.settle();
    }

    /** The page's Save or Cancel, and the main page back. */
    async function leaveBy(cafe, button) {
        await cafe.page.locator(button).click();
        await expect(cafe.page.locator('#subpage-host #settings-content-area')).toHaveCount(0);
        await cafe.settle();
    }

    test('Settings has a Cafe category with Batch container weight: 0 by default, kept between 0 and 20 000, written by Save, and the same after a reload', async ({ cafe, fake }) => {
        const page = await openPage(cafe);
        await openCafeSettings(cafe);
        await expect(page.locator('#cafe-btn')).toHaveText('10. Cafe');
        await expect(page.locator('#sub-categories-panel .settings-subnav-btn')).toHaveText(['1. Batches']);
        await expect(page.locator('#settings-content-area label[for="cafe-container-weight"]')).toHaveText('Batch container weight');
        await expect(page.locator('#settings-content-area .cafe-setting-help')).toHaveText(WEIGHT_PHRASES.settingHelp);
        await expect(setting(page), '0 by default').toHaveValue('0');
        expect(kept(fake), 'nothing kept yet').toBeNull();
        await cafe.screenshot('cafe-setting-default-light');

        // On a tablet the field opens the numpad, as the page's other number fields do.
        const mark = fake.log.length;
        await set(cafe, 350);
        await expect(setting(page)).toHaveValue('350');
        expect(containerWrites(cafe, mark), 'nothing is written until Save').toEqual([]);
        await cafe.screenshot('cafe-setting-light');
        await paint(page, 'dark');
        await cafe.screenshot('cafe-setting-dark');
        await paint(page, 'light');

        // Above the most: kept at 20 000.
        await set(cafe, 99999);
        await expect(setting(page)).toHaveValue('20000');
        expect(containerWrites(cafe, mark)).toEqual([]);
        await leaveBy(cafe, '#save-settings-btn');
        expect(containerWrites(cafe, mark), 'Save writes it once, in the skin\'s own namespace').toEqual([20_000]);
        expect(kept(fake)).toBe(20_000);

        // The same after the page reloads.
        await page.reload();
        await page.locator('#cafe-strip .cafe-card').first().waitFor();
        await expect.poll(() => cafe.routes.sockets.has('/ws/v1/machine/snapshot')).toBe(true);
        await cafe.settle();
        await openCafeSettings(cafe);
        await expect(setting(page)).toHaveValue('20000');
    });

    test('Cancel drops a changed weight, and it is not there when Settings is opened again', async ({ cafe, fake }) => {
        setContainer(fake, 350);
        const page = await openPage(cafe);
        await openCafeSettings(cafe);
        await expect(setting(page)).toHaveValue('350');
        const mark = fake.log.length;
        await set(cafe, 425);
        await expect(setting(page)).toHaveValue('425');
        await leaveBy(cafe, '#cancel-settings-btn');
        expect(containerWrites(cafe, mark), 'nothing is written').toEqual([]);
        expect(kept(fake)).toBe(350);
        await openCafeSettings(cafe);
        await expect(setting(page), 'the weight kept, not the one cancelled').toHaveValue('350');
        await leaveBy(cafe, '#save-settings-btn');
        expect(containerWrites(cafe, mark), 'a Save with nothing changed writes nothing').toEqual([]);
    });

    test('a changed weight outlasts a look at another category, and Save writes it from there', async ({ cafe, fake }) => {
        const page = await openPage(cafe);
        await openCafeSettings(cafe);
        await set(cafe, 350);
        await page.locator('#quickadjustments-btn').click();
        await expect(setting(page)).toHaveCount(0);
        await cafe.settle();
        await openCategory(cafe);
        await expect(setting(page), 'still as changed').toHaveValue('350');
        await page.locator('#quickadjustments-btn').click();
        await expect(setting(page)).toHaveCount(0);
        await cafe.settle();
        expect(kept(fake)).toBeNull();
        await leaveBy(cafe, '#save-settings-btn');
        expect(kept(fake)).toBe(350);
    });

    test('a Save Decaid refuses stays on Settings and says so, the weight still as changed, and can be tried again', async ({ cafe, fake }) => {
        const page = await openPage(cafe);
        await openCafeSettings(cafe);
        await set(cafe, 350);
        fake.refuse({ method: 'POST', path: /\/store\/streamlineCafe\/batchContainerWeight/, status: 500, times: 1 });
        await page.locator('#save-settings-btn').click();
        await cafe.settle();
        await expect(page.getByText(/Failed to save settings/)).toBeVisible();
        await expect(setting(page), 'Settings stays, the weight as changed').toHaveValue('350');
        expect(kept(fake)).toBeNull();
        await leaveBy(cafe, '#save-settings-btn');
        expect(kept(fake)).toBe(350);
    });

    test('where the numpad is not used the setting is typed, and what is no weight is kept as 0', async ({ cafe, fake }) => {
        setContainer(fake, 350);
        await cafe.open({ before: () => { window._forceNumpadMobile = false; } });
        const { page } = cafe;
        await openCafeSettings(cafe);
        await expect(setting(page)).toHaveValue('350');
        await setting(page).fill('425');
        await setting(page).press('Tab');
        await expect(setting(page)).toHaveValue('425');
        await setting(page).fill('abc');
        await setting(page).press('Tab');
        await expect(setting(page)).toHaveValue('0');
        expect(kept(fake), 'not yet saved').toBe(350);
        await leaveBy(cafe, '#save-settings-btn');
        expect(kept(fake)).toBe(0);
    });

    test('the weight view takes the saved setting off what is typed', async ({ cafe, fake }) => {
        Object.assign(blendNew(fake), { weightRemaining: 2412 });
        const page = await openPage(cafe);
        await openCafeSettings(cafe);
        await set(cafe, 350);
        await leaveBy(cafe, '#save-settings-btn');
        await expect(page.locator('#main-page')).toBeVisible();
        await openView(cafe);
        expect(await facts(page)).toEqual([['Left now', '2412 g'], ['Container', '350 g']]);
        await enter(cafe, 3240);
        await save(page).click();
        await backOnLists(cafe);
        expect(blendNew(fake).weightRemaining).toBe(2890);
    });

    test('after one of Streamline\'s own pages, which its legacy module draws, the category still opens, and that module\'s Save and Cancel act on it', async ({ cafe, fake }) => {
        // The legacy module asks which skin is the default, which the fake does not keep.
        fake.refuse({ method: 'GET', path: /\/webui\/skins\/default/, status: 404 });
        const page = await openPage(cafe);
        await openSettings(cafe);
        await page.locator('#language-btn').click();
        await cafe.settle();
        await openCategory(cafe);
        await expect(page.locator('#sub-categories-panel .settings-subnav-btn')).toHaveText(['1. Batches']);
        await set(cafe, 275);
        expect(kept(fake)).toBeNull();
        await leaveBy(cafe, '#cancel-settings-btn');
        expect(kept(fake), 'Cancel drops it').toBeNull();

        await openSettings(cafe);
        await page.locator('#language-btn').click();
        await cafe.settle();
        await openCategory(cafe);
        await expect(setting(page)).toHaveValue('0');
        await set(cafe, 275);
        await leaveBy(cafe, '#save-settings-btn');
        expect(kept(fake), 'Save writes it').toBe(275);
    });

    test('the category and its page are named in the page\'s language', async ({ cafe, fake }) => {
        fake.store.set('streamlineSettings', 'language', 'de');
        const page = await openPage(cafe);
        await openCafeSettings(cafe);
        await expect(page.locator('#cafe-btn')).toHaveText(`10. ${CAFE_TRANSLATIONS.Cafe.de}`);
        await expect(page.locator('#sub-categories-panel .settings-subnav-btn')).toHaveText([`1. ${CAFE_TRANSLATIONS.Batches.de}`]);
        await expect(page.locator('#settings-content-area label[for="cafe-container-weight"]')).toHaveText(CAFE_TRANSLATIONS['Batch container weight'].de);
        await cafe.screenshot('cafe-setting-de-light');
    });
});
