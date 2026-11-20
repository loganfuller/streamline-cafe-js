// The real journeys on the pinned Decaid and DYE2, no Decent Sync
// (docs/cafe/TESTING.md, "The real journeys"): what only the real stack can
// show, each journey setting up what it needs on the seeded stack.
//
// Every journey here starts with no recipe loaded and no barista
// (`startClean`), whatever the one before left: a tap on the loaded card
// unloads it, so a journey that starts with a tap on House espresso's card
// needs it not loaded already. Their `test` is journey.mjs's, as every
// journey's is: it attaches both stacks, and starts the sync stack's server
// again after a journey that left it stopped.

import { test, expect, pull, shoot, loadByCard, recipeIdOf, card, untilStripSettled } from './support/journey.mjs';
import { startClean, selection, loadedInWorkflow, expectNoRecipeSelected, expectNoRecipePage, settingsOf, pressed, isUnload } from './support/decaid-helpers.mjs';
import { legend, row, keys, chartLines, pickDialog, pickRows } from '../page/support/page-reads.mjs';
import { RECIPES, TYPED_BARISTA } from '../cafe-smoke/sample-data.mjs';
import { shotNumbers } from '../../src/cafe/comparison.js';

const [house] = RECIPES;

test.beforeEach(async ({ stacks }) => { await startClean(stacks.decaid); });

test.describe('a live pour on the real stack', { tag: '@real-pour' }, () => {
    test('a recipe loaded by its card, a pour drawn live, and the Shot Decaid stores drawn as the latest with its own numbers', async ({ stacks, tablet }) => {
        const side = stacks.decaid;
        const page = await tablet(side);
        const houseRecord = await loadByCard(page, side, house);

        const pulled = pull(side.decaid);
        await expect(page.locator('#cafe-live'), 'the graph goes live').toBeVisible();
        await expect.poll(async () => (await chartLines(page)).points.some(points => points > 5), { message: 'the pour is drawn as it goes' }).toBe(true);
        expect((await row(page)).mode, 'the six live cards take the row\'s place').toBe('live');
        const shot = await pulled;
        expect(recipeIdOf(shot.workflow), 'the Shot Decaid stored names the recipe').toBe(houseRecord.id);

        await expect(page.locator('#machine-status')).toHaveText('Ready');
        await expect.poll(async () => (await legend(page)).when, { message: 'the stored Shot becomes the latest, with its time' }).toMatch(/^Today \d{2}:\d{2}/);
        expect((await legend(page)).label).toBe('Latest');
        const rest = await row(page);
        expect(rest.mode).toBe('rest');
        expect(keys(rest)).toBe('time firstDrip yield ratio peak');
        const numbers = shotNumbers(shot);
        expect(rest.cards[0].value, 'the stored Shot\'s own time').toBe(`${numbers.time.toFixed(1)} s`);
        expect(rest.cards[4].value, 'its peak pressure').toBe(`${numbers.peak.toFixed(1)} bar`);
        await shoot(page, 'real-pour-stored');
    });
});

test.describe('DYE2\'s selection on the real stack', { tag: '@real-selection' }, () => {
    test('a card tap is Streamline\'s apply, from which DYE2 derives the recipe as loaded; a tap on the loaded card, or an unload made elsewhere, leaves DYE2 naming no recipe and the page shows it', async ({ stacks, tablet }) => {
        const side = stacks.decaid;
        const page = await tablet(side);
        await expectNoRecipePage(page);

        // The apply: the Workflow written with the record's id, and DYE2 derives the recipe from it.
        const houseRecord = await loadByCard(page, side, house);
        await untilStripSettled(page);
        await expect.poll(() => selection(side), { message: 'DYE2 derives House espresso as the loaded recipe' }).toMatchObject({ kind: 'recipe', id: houseRecord.id });
        expect(await side.decaid('GET', `/store/dye2.reaplugin/selection`), 'and mirrors it in its store').toMatchObject({ kind: 'recipe', id: houseRecord.id });
        await expect(card(page, house.slot)).toHaveAttribute('aria-pressed', 'true');
        await expect(pressed(page)).toHaveCount(1);
        const loadedWorkflow = await side.decaid('GET', '/workflow');
        await shoot(page, 'real-selection-loaded');

        // A tap on the loaded card: the page clears DYE2's selection, which writes the Workflow's marker alone.
        await card(page, house.slot).click();
        await expectNoRecipePage(page);
        await untilStripSettled(page);
        await expect.poll(() => loadedInWorkflow(side), { message: 'the Workflow\'s marker is cleared' }).toBeNull();
        const derived = await selection(side);
        expectNoRecipeSelected(derived);
        expect(settingsOf(await side.decaid('GET', '/workflow')), 'the machine is set as it was').toEqual(settingsOf(loadedWorkflow));
        expect((await legend(page)).label, 'the graph shows the last shot').toBe('Last shot');
        test.info().annotations.push({ type: 'DYE2 after the unload', description: JSON.stringify(derived) });
        await shoot(page, 'real-selection-unloaded');

        // Loaded again, then unloaded elsewhere (DYE2's own page, another app): DYE2's push reaches the page.
        await loadByCard(page, side, house);
        await untilStripSettled(page);
        await side.decaid('POST', '/plugins/dye2.reaplugin/selection', {});
        await expectNoRecipePage(page);
        expectNoRecipeSelected(await selection(side));
    });
});

test.describe('the barista on the real stack', { tag: '@real-barista' }, () => {
    test('a barista named on the page is the Workflow\'s, Decaid copies it into the Shot it stores, and the page then lists and credits it', async ({ stacks, tablet }) => {
        const side = stacks.decaid;
        const page = await tablet(side);
        try {
            await expect(page.locator('#cafe-barista-name')).toHaveText('Barista');
            await page.locator('#cafe-barista').click();
            await expect(pickDialog(page)).toBeVisible();
            await page.locator('#cafe-pick-add').click();
            await page.locator('#cafe-pick-entry-text').fill(TYPED_BARISTA);
            await page.locator('#cafe-pick-entry-use').click();
            await expect(page.locator('#cafe-pick-dialog:not([open])')).toBeAttached();
            await expect(page.locator('#cafe-barista-name')).toHaveText(TYPED_BARISTA);
            await expect.poll(async () => (await side.decaid('GET', '/workflow')).context.baristaName ?? null, { message: 'the name reaches the Workflow' }).toBe(TYPED_BARISTA);

            const shot = await pull(side.decaid);
            expect(shot.workflow.context.baristaName, 'the Shot Decaid stored names the barista').toBe(TYPED_BARISTA);
            await expect.poll(async () => (await legend(page)).when, { message: 'the stored Shot is the last, credited to the barista' }).toMatch(new RegExp(`^Today \\d{2}:\\d{2}.*${TYPED_BARISTA}`));
            await shoot(page, 'real-barista-shot');

            // The dialog lists the name from the Shots Decaid holds, in use; "No barista" clears it.
            await page.locator('#cafe-barista').click();
            await expect(pickDialog(page)).toBeVisible();
            await expect.poll(async () => (await pickRows(page)).find(entry => entry.name === TYPED_BARISTA), { message: 'the name is listed from the stored Shot, in use' })
                .toMatchObject({ inUse: true, detail: expect.stringMatching(/^Last shot Today \d/) });
            await page.locator('#cafe-pick-list .cafe-pick-row').filter({ hasText: /^No barista/ }).click();
            await expect(page.locator('#cafe-barista-name')).toHaveText('Barista');
            await expect.poll(async () => (await side.decaid('GET', '/workflow')).context.baristaName ?? null, { message: 'the clear reaches the Workflow, after the Shot\'s store' }).toBeNull();
        } finally {
            await side.decaid('PUT', '/workflow', { context: { baristaName: null } });
        }
    });
});

test.describe('the unload after a pour on the real stack', { tag: '@real-unload-after-shot' }, () => {
    test('a tap on the loaded card as a pour ends: the Shot Decaid stores still names the recipe, and the unload reaches DYE2 after the store', async ({ stacks, tablet }) => {
        const side = stacks.decaid;
        const page = await tablet(side);
        const houseRecord = await loadByCard(page, side, house);
        await untilStripSettled(page);
        await expect.poll(() => selection(side)).toMatchObject({ kind: 'recipe', id: houseRecord.id });

        // When Decaid stores the Shot, and when the page asks for the unload, each as the test first sees it.
        const before = (await side.decaid('GET', '/shots?limit=1')).items?.[0]?.id ?? null;
        const unloads = [];
        page.on('request', request => { if (isUnload(request)) unloads.push(Date.now()); });
        let storedAt = null;
        const watching = expect.poll(async () => {
            const newest = (await side.decaid('GET', '/shots?limit=1')).items?.[0]?.id ?? null;
            if (newest !== before && storedAt === null) storedAt = Date.now();
            return storedAt !== null;
        }, { timeout: 120_000, intervals: [100] }).toBe(true);

        const pulled = pull(side.decaid);
        await expect(page.locator('#main-page.cafe-shot-live'), 'the pour is live on the page').toBeAttached();
        await expect(page.locator('#main-page:not(.cafe-shot-live)'), 'and has ended').toBeAttached({ timeout: 60_000 });
        await card(page, house.slot).click();
        const tappedAt = Date.now();
        await expect(pressed(page), 'the highlight goes at once').toHaveCount(0);

        const shot = await pulled;
        await watching;
        expect(tappedAt, 'the tap came before Decaid stored the Shot').toBeLessThan(storedAt);
        expect(recipeIdOf(shot.workflow), 'the Shot Decaid stored names the recipe').toBe(houseRecord.id);
        await expect.poll(() => unloads.length, { message: 'the page asks for the unload once' }).toBe(1);
        expect(unloads[0], 'after the Shot is stored').toBeGreaterThan(storedAt);
        await expect.poll(() => loadedInWorkflow(side)).toBeNull();
        expectNoRecipeSelected(await selection(side));
        await expectNoRecipePage(page);
        await untilStripSettled(page);
        expect(unloads, 'and asks only once').toHaveLength(1);
        test.info().annotations.push({ type: 'timing', description: `stored ${storedAt - tappedAt} ms after the tap; unload asked ${unloads[0] - storedAt} ms after the store` });
    });
});
