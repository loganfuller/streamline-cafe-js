// A finished batch (#111; docs/cafe/DESIGN.md, "A finished batch"): a recipe's
// card is red while its DYE2 record names a Bean Batch that Decaid's record
// says is archived, loaded or not and in every Recipe Slot, and the batch's
// text under Dose is red while the Workflow names one, with a recipe loaded or
// with none. Nothing else changes: a red card loads on a tap, the dial-in rows
// and the dialogs work as they do, and a shot runs. The red ends when another
// batch is named or the batch is brought back, and the page looks when it
// starts, when it comes back into view, after a recipe loads or unloads and
// after a choice in the bean and batch dialog (src/cafe/finished-batch.js,
// `readBatches` in src/cafe/strip.js, `refreshNames` in src/cafe/page.js).
//
// The sample data (fake-decaid/recordings/sample-data.json) holds no recipe
// whose batch is archived; a test archives the batch it needs, in the fake.
// That `GET /bean-batches/<id>` answers the batch whole, `archived` with it,
// or a 404 for one Decaid doesn't have, is recordings/beans.json.

import { test, expect } from './support/test.mjs';
import { pickDialog, pickRows, tapAt, isWrite, paint, openPage, card, load, untilPickClosed } from './support/page-reads.mjs';
import { records, recordOf, loadedId } from './support/fake-reads.mjs';
import { hold } from './support/faults.mjs';
import { RECIPES } from './support/sample-data.mjs';
import { SUPPORTED_LANGUAGES } from '../../src/modules/i18n-parser.js';
import { CAFE_TRANSLATIONS } from '../../src/cafe/translations.js';
import { API_DEBOUNCE_MS } from '../../src/modules/workflow-watch.js';

const [house, single, decaf, longBlack, guest, filter] = RECIPES;
const DYE2 = 'dye2.reaplugin';
const DOSE = '#dose-section .cafe-row-name';
const FINISHED_LANGUAGES = SUPPORTED_LANGUAGES.filter(code => code !== 'en' && !code.includes('unfinished'));

// ── The sample data, as the fake holds it.
const batchNamed = (fake, name) => fake.library.state.batches.find(batch => batch.id === recordOf(fake, name).beanBatchId);
const archive = (fake, name, archived = true) => { batchNamed(fake, name).archived = archived; };
const changeRecord = (fake, name, change) => fake.store.set(DYE2, 'recipes', records(fake).map(row => (row && row.name === name ? change({ ...row }) : row)));

// ── The page.
const dose = page => page.locator('#cafe-dose-desc');
const dosePick = page => page.locator('#cafe-dose-pick');
/** The slots whose card is red. */
const redSlots = page => page.locator('#cafe-strip .cafe-card-finished').evaluateAll(cards => cards.map(el => Number(el.dataset.slot)));
const colours = locator => locator.evaluate(el => {
    const style = getComputedStyle(el);
    return { text: style.color, border: style.borderTopColor, fill: style.backgroundColor };
});
const red = page => page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--cafe-finished)';
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
});
/** The page looks again, as when it comes back into view. */
async function lookAgain(cafe, event = 'streamline:mainpagevisible') {
    await cafe.page.evaluate(name => document.dispatchEvent(new Event(name)), event);
    await cafe.advance(1000);
}

test.describe('a finished batch', { tag: '@finished' }, () => {
    test('a card whose recipe names an archived batch is red, loaded and not, and the others are as they were', async ({ cafe, fake }) => {
        const page = await openPage(cafe);
        const plain = { card: await colours(card(page, house.slot)), bean: await card(page, house.slot).locator('.cafe-card-bean').evaluate(el => getComputedStyle(el).opacity) };
        await expect.poll(() => redSlots(page), 'no batch is archived').toEqual([]);
        await expect(card(page, house.slot)).toHaveAccessibleName('House espresso Sample Blend');

        archive(fake, house.name);
        await lookAgain(cafe);
        await expect.poll(() => redSlots(page), 'the two recipes of that batch, in slots 1 and 5').toEqual([house.slot, longBlack.slot]);
        const finished = await red(page);
        expect(finished).not.toBe(plain.card.text);
        for (const recipe of [house, longBlack]) {
            expect(await colours(card(page, recipe.slot)), `${recipe.name}, not loaded`).toEqual({ text: finished, border: finished, fill: plain.card.fill });
            await expect(card(page, recipe.slot)).toHaveAccessibleName(`${recipe.name} ${recipe.bean} Batch finished`);
            await expect(card(page, recipe.slot).locator('.cafe-hidden-text'), 'no new text is shown').toHaveCSS('width', '1px');
        }
        expect(await colours(card(page, single.slot)), 'a card whose batch is not archived').toEqual(plain.card);
        expect(await card(page, single.slot).locator('.cafe-card-bean').evaluate(el => getComputedStyle(el).opacity)).toBe(plain.bean);
        await expect(card(page, single.slot)).toHaveAccessibleName('Single origin Sample Single Origin');

        await load(cafe, house);
        await expect.poll(() => redSlots(page)).toEqual([house.slot, longBlack.slot]);
        await expect(card(page, house.slot)).toHaveAttribute('aria-pressed', 'true');
        expect(await colours(card(page, house.slot)), 'loaded: filled red, its words the card\'s own background').toEqual({ text: plain.card.fill, border: finished, fill: finished });
        await expect(card(page, house.slot)).toHaveAccessibleName('House espresso Sample Blend Batch finished');
        expect(await colours(card(page, longBlack.slot)), 'the other stays as it was').toEqual({ text: finished, border: finished, fill: plain.card.fill });
    });

    test('the batch under Dose is red while the Workflow names an archived batch, with no recipe loaded and with one', async ({ cafe, fake }) => {
        const page = await openPage(cafe);
        const plain = (await colours(dose(page))).text;
        await expect(dose(page)).toHaveText('Sample Single Origin · roasted Oct 28');
        await expect(dose(page)).not.toHaveClass(/cafe-batch-finished/);
        await expect(dosePick(page)).toHaveAccessibleName('Dose Sample Single Origin · roasted Oct 28');

        // The Workflow the page starts on names the single origin's batch.
        archive(fake, single.name);
        await lookAgain(cafe);
        expect(loadedId(fake), 'no recipe is loaded').toBe(null);
        await expect(dose(page)).toHaveClass(/cafe-batch-finished/);
        await expect(dose(page), 'still named').toHaveText('Sample Single Origin · roasted Oct 28');
        expect((await colours(dose(page))).text).toBe(await red(page));
        await expect(dosePick(page)).toHaveAccessibleName('Dose Sample Single Origin · roasted Oct 28 Batch finished');
        await expect(page.locator('#cafe-dose-finished'), 'no new text is shown').toHaveCSS('width', '1px');
        await expect.poll(() => redSlots(page), 'and the cards of its recipes, in slots 2, 7 and 9').toEqual([single.slot, guest.slot, filter.slot]);

        await load(cafe, single);
        await expect(dose(page), 'with its recipe loaded').toHaveClass(/cafe-batch-finished/);
        await expect(dosePick(page)).toHaveAccessibleName('Dose Sample Single Origin · roasted Oct 28 Batch finished');

        await load(cafe, decaf);
        await expect(dose(page)).toHaveText('Example Decaf · roasted Oct 20');
        await expect(dose(page), 'a batch that is not archived').not.toHaveClass(/cafe-batch-finished/);
        expect((await colours(dose(page))).text).toBe(plain);
        await expect(dosePick(page)).toHaveAccessibleName('Dose Example Decaf · roasted Oct 20');
    });

    test('no batch, and a batch the tablet has no record of, are not red', async ({ cafe, fake }) => {
        archive(fake, house.name);
        changeRecord(fake, house.name, row => { delete row.beanBatchId; return row; });
        changeRecord(fake, decaf.name, row => ({ ...row, beanBatchId: 'no-such-batch', workflow: { ...row.workflow, context: { ...row.workflow.context, beanBatchId: 'no-such-batch' } } }));
        const page = await openPage(cafe);
        await expect.poll(() => redSlots(page), 'only the other recipe of the archived batch').toEqual([longBlack.slot]);

        await load(cafe, decaf);
        expect(fake.workflow().context.beanBatchId, 'the Workflow names the batch Decaid doesn\'t have').toBe('no-such-batch');
        await expect(dose(page)).toHaveText('Example Decaf');
        await expect(dose(page)).not.toHaveClass(/cafe-batch-finished/);
        await expect(card(page, decaf.slot)).toHaveAccessibleName('Decaf Example Decaf');

        fake.request({ method: 'PUT', url: '/api/v1/workflow', body: { context: { beanBatchId: null } } });
        await lookAgain(cafe, 'streamline:workflow-refresh');
        await expect(dose(page), 'the Workflow names no batch').not.toHaveClass(/cafe-batch-finished/);
        await expect.poll(() => redSlots(page)).toEqual([longBlack.slot]);
    });

    test('a batch archived while the page is behind another is red when it comes back, and one brought back is not', async ({ cafe, fake }) => {
        const page = await openPage(cafe);
        await load(cafe, house);

        archive(fake, house.name);
        await cafe.advance(3000);
        await expect.poll(() => redSlots(page), 'the page at rest is told nothing').toEqual([]);
        await expect(dose(page)).not.toHaveClass(/cafe-batch-finished/);

        await lookAgain(cafe);
        await expect.poll(() => redSlots(page), 'back from a subpage').toEqual([house.slot, longBlack.slot]);
        await expect(dose(page)).toHaveClass(/cafe-batch-finished/);
        await expect(dose(page), 'the roast date stays').toHaveText('Sample Blend · roasted Nov 2');

        archive(fake, house.name, false);
        await lookAgain(cafe, 'visibilitychange');
        await expect.poll(() => redSlots(page), 'back into view, the batch brought back').toEqual([]);
        await expect(dose(page)).not.toHaveClass(/cafe-batch-finished/);
        await expect(dosePick(page)).toHaveAccessibleName('Dose Sample Blend · roasted Nov 2');
    });

    test('a read of the batch that fails keeps the red', async ({ cafe, fake }) => {
        archive(fake, house.name);
        const page = await openPage(cafe);
        await load(cafe, house);
        await expect.poll(() => redSlots(page)).toEqual([house.slot, longBlack.slot]);

        const restore = fake.refuse({ method: 'GET', path: /\/bean-batches\//, status: 500 });
        await lookAgain(cafe);
        await expect.poll(() => redSlots(page)).toEqual([house.slot, longBlack.slot]);
        await expect(dose(page)).toHaveClass(/cafe-batch-finished/);
        await expect(dose(page)).toHaveText('Sample Blend · roasted Nov 2');
        restore();
    });

    test('an answer from an earlier look, arriving late, does not undo a later look', async ({ cafe, fake }) => {
        archive(fake, house.name);
        const page = await openPage(cafe);
        await expect.poll(() => redSlots(page)).toEqual([house.slot, longBlack.slot]);

        // The first read of the batch is answered as it was, archived, but held.
        const path = `/api/v1/bean-batches/${batchNamed(fake, house.name).id}`;
        let taken = false;
        let arrived;
        let release;
        const reached = new Promise(resolve => { arrived = resolve; });
        const released = new Promise(resolve => { release = resolve; });
        const stop = cafe.routes.intercept(request => !taken && request.method === 'GET' && request.path === path, async ({ forward }) => {
            taken = true;
            const answer = forward();
            arrived();
            await released;
            return answer;
        });
        await page.evaluate(() => document.dispatchEvent(new Event('streamline:mainpagevisible')));
        await page.clock.runFor(1000);
        await reached;
        stop();

        archive(fake, house.name, false);
        await page.evaluate(() => document.dispatchEvent(new Event('streamline:mainpagevisible')));
        await page.clock.runFor(1000);
        await expect.poll(() => redSlots(page), 'the later look, the batch brought back').toEqual([]);
        release();
        await cafe.advance(1000);
        expect(await redSlots(page), 'the earlier look\'s answer, archived, arrived after').toEqual([]);
    });

    test('a slow read of one batch holds up the red of no other card', async ({ cafe, fake }) => {
        const page = await openPage(cafe);
        await load(cafe, house);
        await expect.poll(() => redSlots(page)).toEqual([]);

        archive(fake, house.name);
        // Every read of the single origin's batch is held, not only the first.
        const other = `/api/v1/bean-batches/${batchNamed(fake, single.name).id}`;
        let arrived;
        let release;
        const reached = new Promise(resolve => { arrived = resolve; });
        const released = new Promise(resolve => { release = resolve; });
        const stop = cafe.routes.intercept(request => request.method === 'GET' && request.path === other, async ({ forward }) => {
            arrived();
            await released;
            return forward();
        });
        await page.evaluate(() => document.dispatchEvent(new Event('streamline:mainpagevisible')));
        await page.clock.runFor(1000);
        await reached;
        await expect.poll(() => redSlots(page), 'the archived batch\'s cards while the other batch is still read').toEqual([house.slot, longBlack.slot]);
        stop();
        release();
        await cafe.advance(1000);
        await expect.poll(() => redSlots(page)).toEqual([house.slot, longBlack.slot]);
    });

    test('a slow read of the batch holds up no other name under the rows', async ({ cafe, fake }) => {
        archive(fake, house.name);
        const page = await openPage(cafe);
        await load(cafe, house);
        await expect(dose(page)).toHaveClass(/cafe-batch-finished/);
        const grinder = page.locator('#cafe-grind-desc');
        await expect(grinder).not.toHaveText('Sample Burr Two');

        const slow = hold(cafe, { method: 'GET', path: /^\/api\/v1\/bean-batches\// });
        fake.request({ method: 'PUT', url: '/api/v1/workflow', body: { context: { grinderModel: 'Sample Burr Two' } } });
        await page.evaluate(() => document.dispatchEvent(new Event('streamline:workflow-refresh')));
        await page.clock.runFor(1000);
        await slow.reached;
        await expect(grinder, 'the grinder named while the batch is still read').toHaveText('Sample Burr Two');
        await expect(dose(page), 'the red stays meanwhile').toHaveClass(/cafe-batch-finished/);
        await expect(dose(page)).toHaveText('Sample Blend · roasted Nov 2');
        slow.release();
        await cafe.advance(1000);
        await expect(dose(page)).toHaveClass(/cafe-batch-finished/);
    });

    test('a batch that is not archived, chosen in the dialog, ends the red under Dose, and on the card where the recipe takes it', async ({ cafe, fake }) => {
        archive(fake, house.name);
        const page = await openPage(cafe);
        await load(cafe, house);
        await expect(dose(page)).toHaveClass(/cafe-batch-finished/);

        // A batch of the recipe's own bean writes the Workflow alone: the
        // recipe still names the archived one.
        await tapAt(page, DOSE);
        await expect(pickDialog(page)).toBeVisible();
        await cafe.settle();
        expect((await pickRows(page)).map(row => row.name), 'the archived batch is not listed').toEqual(['Roasted Oct 15']);
        await page.locator('#cafe-pick-list .cafe-pick-row').first().click();
        await page.locator('#cafe-pick-confirm-use').click();
        await untilPickClosed(cafe);
        await expect(dose(page), 'at once').not.toHaveClass(/cafe-batch-finished/);
        await expect(dose(page)).toHaveText('Sample Blend · roasted Oct 15');
        await cafe.advance(1500);
        await expect.poll(() => redSlots(page), 'the recipe\'s record still names the archived batch').toEqual([house.slot, longBlack.slot]);

        // A batch of another bean is written into the recipe's record (#52).
        await tapAt(page, DOSE);
        await expect(pickDialog(page)).toBeVisible();
        await cafe.settle();
        await page.locator('#cafe-pick-side .cafe-pick-row').filter({ hasText: 'Example Decaf' }).click();
        await page.locator('#cafe-pick-list .cafe-pick-row').first().click();
        await expect(page.locator('#cafe-pick-confirm-use')).toBeEnabled();
        await page.locator('#cafe-pick-confirm-use').click();
        await untilPickClosed(cafe);
        await cafe.advance(1500);
        await expect(dose(page)).toHaveText('Example Decaf · roasted Oct 20');
        await expect(dose(page)).not.toHaveClass(/cafe-batch-finished/);
        await expect.poll(() => redSlots(page), 'the loaded recipe\'s card is no longer red; the other recipe\'s is').toEqual([longBlack.slot]);
        await expect(card(page, house.slot)).toHaveAttribute('aria-pressed', 'true');
    });

    test('a red card loads and unloads on a tap, Dose steps, and a shot runs', async ({ cafe, fake }) => {
        archive(fake, house.name);
        const page = await openPage(cafe);
        await expect.poll(() => redSlots(page)).toEqual([house.slot, longBlack.slot]);

        await load(cafe, house);
        expect(loadedId(fake), 'the red card loaded').toBe(recordOf(fake, house.name).id);
        expect(fake.workflow().context.beanBatchId, 'with its batch, archived as it is').toBe(recordOf(fake, house.name).beanBatchId);

        const mark = fake.log.length;
        const before = Number(fake.workflow().context.targetDoseWeight);
        await page.locator('#dose-in-plus').click();
        await cafe.advance(API_DEBOUNCE_MS + 500);
        expect(Number(fake.workflow().context.targetDoseWeight), '+ steps the dose').toBe(before + 1);
        expect(cafe.since(mark, isWrite).length, 'and writes it').toBeGreaterThan(0);
        await expect(dose(page), 'the row is still red').toHaveClass(/cafe-batch-finished/);

        await cafe.pour(3000);
        await expect(page.locator('#main-page')).toHaveClass(/cafe-shot-live/);
        await cafe.pour();
        await expect(page.locator('#main-page')).not.toHaveClass(/cafe-shot-live/);
        await cafe.untilStored();
        await cafe.storeShot();
        await cafe.advance(6000);
        await expect.poll(() => redSlots(page), 'after the shot').toEqual([house.slot, longBlack.slot]);

        await card(page, house.slot).click();
        await expect(page.locator('#cafe-title')).toHaveText('No recipe selected');
        await cafe.advance(2000);
        expect(loadedId(fake), 'a tap on the loaded red card unloads it').toBe(null);
        await expect(card(page, house.slot)).toHaveClass(/cafe-card-finished/);
        await expect(dose(page), 'the Workflow still names the batch').toHaveClass(/cafe-batch-finished/);
    });

    test('the card and the Dose row say the batch is finished in every finished language', async ({ cafe, fake }) => {
        archive(fake, house.name);
        const page = await openPage(cafe);
        await load(cafe, house);
        for (const code of FINISHED_LANGUAGES) {
            await page.evaluate(async language => {
                const { setLanguage } = await import('/src/modules/i18n.js');
                await setLanguage(language);
            }, code);
            await cafe.settle();
            const said = CAFE_TRANSLATIONS['Batch finished'][code];
            expect(said, code).toBeTruthy();
            await expect(card(page, house.slot).locator('.cafe-hidden-text'), code).toHaveText(said);
            await expect(card(page, longBlack.slot).locator('.cafe-hidden-text'), code).toHaveText(said);
            await expect(page.locator('#cafe-dose-finished'), code).toHaveText(said);
            await expect(page.locator('#cafe-dose-finished'), code).not.toHaveAttribute('hidden');
            expect(await dosePick(page).evaluate(el => el.contains(document.getElementById('cafe-dose-finished'))), 'inside the row\'s button').toBe(true);
        }
    });

    for (const theme of ['light', 'dark']) {
        test(`in the ${theme} theme`, async ({ cafe, fake }) => {
            archive(fake, house.name);
            archive(fake, single.name);
            const page = await openPage(cafe);
            await paint(page, theme);
            await expect.poll(() => redSlots(page)).toEqual([house.slot, single.slot, longBlack.slot, guest.slot, filter.slot]);
            await expect(dose(page)).toHaveClass(/cafe-batch-finished/);
            const finished = await red(page);
            const background = await card(page, decaf.slot).evaluate(el => getComputedStyle(el).backgroundColor);
            expect(await colours(card(page, house.slot)), 'a red card, not loaded').toEqual({ text: finished, border: finished, fill: background });
            expect((await colours(dose(page))).text, 'the batch under Dose').toBe(finished);
            await cafe.screenshot(`finished-batch-no-recipe-${theme}`);

            archive(fake, single.name, false);
            await load(cafe, house);
            await paint(page, theme);
            await expect.poll(() => redSlots(page)).toEqual([house.slot, longBlack.slot]);
            await expect(dose(page)).toHaveClass(/cafe-batch-finished/);
            expect(await colours(card(page, house.slot)), 'a red card, loaded').toEqual({ text: background, border: finished, fill: finished });
            expect(await colours(card(page, longBlack.slot)), 'a red card, not loaded').toEqual({ text: finished, border: finished, fill: background });
            expect((await colours(dose(page))).text).toBe(finished);
            await cafe.screenshot(`finished-batch-recipe-${theme}`);
        });
    }
});
