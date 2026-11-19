// The long-press menu on a recipe card, and arranging the strip from it
// (docs/cafe/DESIGN.md, "Recipes and the strip"; once steps 11 and 12 of the
// smoke run): an empty slot's two items and a filled card's three; the list a
// recipe is chosen from, empty or sorted by name; a new recipe made from what
// the machine is set to, in a slot above 5, and on the loaded card; a recipe
// chosen for a slot, replacing another, and taken out of its slot, the loaded
// one among them; and no menu while a shot runs. A tap still loads. None of it
// leaves the page or opens one of DYE2's pages, writes Streamline's strip mode,
// or keeps state of the page's own in Decaid's store.
//
// The DYE2 behaviour they rely on is recorded from the pinned stack: its
// save-recipe, the name it gives and the recipe it marks loaded
// (fake-decaid/recordings/dye2-save-recipe.json), and the selection it derives
// once the page clears it, which may be a recent favourite the Workflow matches
// rather than none (dye2-selection.json, steps 1 to 3).

import { test, expect, START } from './support/test.mjs';
import { card, holdCard, menu, menuItems, writes, paint } from './support/page-reads.mjs';
import { records, recordOf, loadedId } from './support/fake-reads.mjs';
import { recording } from './support/adapter.mjs';
import { PAGE_ORIGIN } from './support/page-files.mjs';
import { proposeRecipeName } from '../../fake-decaid/dye2.js';
import { RECIPES } from '../cafe-smoke/sample-data.mjs';

const [house, single, decaf, long] = RECIPES;
const DYE2 = 'dye2.reaplugin';
const SAVE_RECIPE = `POST /api/v1/plugins/${DYE2}/save-recipe`;
const SELECTION = `POST /api/v1/plugins/${DYE2}/selection`;
const RECORDS = `POST /api/v1/store/${DYE2}/recipes`;
// The machine's own settings, which DYE2 fills a new recipe's flush from.
const MACHINE = recording('boot').requests['GET /api/v1/machine/settings'].body;
const STRIP_MODE = ['streamlineSettings', 'streamline.dyeStripMode'];

const title = page => page.locator('#cafe-title');
const cardName = (page, slot) => card(page, slot).locator('.cafe-card-name');
const dialog = page => page.locator('#cafe-recipe-dialog');
const dialogRows = page => page.locator('#cafe-recipe-list .cafe-recipe-row').evaluateAll(rows => rows.map(row => ({
    name: row.querySelector('.cafe-recipe-row-name').textContent,
    detail: row.querySelector('.cafe-recipe-row-detail').textContent,
})));

// Streamline's strip mode as the page found it once open, and the log's length
// then: Streamline's own settings sync writes it at start, which is not the
// cafe page's doing.
const opened = new WeakMap();
async function open(cafe) {
    await cafe.open();
    opened.set(cafe, { stripMode: cafe.fake.store.get(...STRIP_MODE), mark: cafe.fake.log.length });
}

/** A tap on a recipe's card, and the load settled with the card shown pressed. */
async function load(cafe, recipe) {
    const { page } = cafe;
    await card(page, recipe.slot).click();
    await expect(title(page)).toHaveText(recipe.name);
    await expect(card(page, recipe.slot)).toHaveAttribute('aria-pressed', 'true');
    await cafe.advance(2000);
}

/**
 * A menu item picked, and the strip arranged and drawn again: the menu closed,
 * the clock moved past the page's writes and its reads after them.
 */
async function pick(cafe, label) {
    const { page } = cafe;
    expect(await menuItems(page)).toContain(label);
    await menu(page).locator('.context-menu__item').filter({ hasText: label }).click();
    await expect(menu(page)).toBeHidden();
    await cafe.advance(3000);
}

/** A row of the list tapped, and the strip arranged and drawn again. */
async function choose(cafe, name) {
    const { page } = cafe;
    await page.locator('#cafe-recipe-list .cafe-recipe-row').filter({ hasText: name }).click();
    await expect(dialog(page)).not.toHaveAttribute('open');
    await cafe.advance(3000);
}

/** What the page writes into a record it places in a slot (src/cafe/recipe-write.js): the slot, and shown on the strip. */
const PLACED = slot => ({ stripSlot: slot, showOnStreamlineDashboard: true });

/** The records with each named one changed: `{ [name]: fields }`. */
const recordsWith = (rows, changes) => rows.map(row => (row && changes[row.name] ? { ...row, ...changes[row.name] } : row));

/** The Workflow as it was, naming `recipeId` as the loaded recipe (or none). */
function workflowNaming(workflow, recipeId) {
    const out = structuredClone(workflow);
    out.context.extras.dye = { ...out.context.extras.dye, recipeId };
    return out;
}

/** Sample recipes taken out of their slots before the page opens, by name. */
function inNoSlot(fake, ...names) {
    fake.store.set(DYE2, 'recipes', records(fake).map(row => (row && names.includes(row.name) ? { ...row, stripSlot: null } : row)));
}

/**
 * The record DYE2's save-recipe makes from `workflow` (DYE2 v0.1.42,
 * `handleSaveRecipe`; fake-decaid/dye2.js; recorded in dye2-save-recipe.json),
 * field by field: the Workflow's bean, profile and dial-in, the flush filled
 * from the machine's own settings, and in its stored Workflow a note of each
 * field the recipe holds (`true`) or holds as none (`null`). The page asks for
 * no slot, so DYE2 gives it none: the page then places it (`PLACED`).
 */
function savedRecipe(workflow, { id, name, capturedAt }) {
    const { context, profile, steamSettings, hotWaterData, rinseData } = workflow;
    const { dye, ...extras } = context.extras;
    expect(steamSettings.targetTemperature, 'steam is on, so the recipe holds its steam settings').toBeGreaterThanOrEqual(135);
    const flush = { ...rinseData, targetTemperature: MACHINE.flushTemp, flow: MACHINE.flushFlow };
    return {
        id, stripSlot: null, name, title: name, beverage: '',
        beanName: context.coffeeName, beanRoaster: context.coffeeRoaster, beanBatchId: context.beanBatchId,
        profileTitle: profile.title, profileSnapshot: profile,
        dashboardVariables: {
            dose: context.targetDoseWeight, drink: context.targetYield, grind: Number(context.grinderSetting),
            basketId: extras.basketId, basketName: extras.basketName, brewC: profile.steps[0].temperature,
            steamTempC: steamSettings.targetTemperature, steamTimeS: steamSettings.duration, steamFlowMls: steamSettings.flow, steamStopAtTempC: steamSettings.stopAtTemperature,
            hotWaterTempC: hotWaterData.targetTemperature, hotWaterTimeS: hotWaterData.duration, hotWaterMl: hotWaterData.volume, hotWaterFlowMls: hotWaterData.flow,
            flushTempC: flush.targetTemperature, flushS: flush.duration, flushFlowMls: flush.flow,
            grinderId: context.grinderId, grinderModel: context.grinderModel,
        },
        workflow: {
            context: {
                ...context,
                extras: { ...extras, dye: { v: 1, beanBatchId: true, coffeeName: true, coffeeRoaster: true, grinderId: true, grinderModel: true, basketId: true, basketName: true, rpm: null } },
            },
            profile, steamSettings, hotWaterData, rinseData: flush,
        },
        capturedAt,
    };
}

/** The one record in `rows` that is not in `before`, with an id in DYE2's shape, made during the test. */
function newRecord(fake, before) {
    const ids = new Set(before.map(row => row && row.id));
    const made = records(fake).filter(row => row && !ids.has(row.id));
    expect(made, 'one new record').toHaveLength(1);
    expect(made[0].id, 'an id in DYE2\'s shape').toMatch(/^recipe-[0-9a-z]+$/);
    expect(Date.parse(made[0].capturedAt), 'made during the test').toBeGreaterThanOrEqual(START);
    expect(Date.parse(made[0].capturedAt)).toBeLessThanOrEqual(fake.now());
    return made[0];
}

/**
 * DYE2's name for a recipe made from `workflow` (`proposeRecipeName`), which is
 * the first word of the profile's title and the bean.
 */
function expectedName(workflow, rows, recipe) {
    const name = proposeRecipeName(workflow, rows.map(row => row && (row.name || row.title)));
    expect(name, 'the first word of the profile and the bean').toBe(`${recipe.profile.split(' ')[0]} ${recipe.bean}`);
    return name;
}

test.describe('the long-press menu, and arranging the strip', { tag: '@menu' }, () => {
    // What none of it may do, read after each test.
    test.afterEach(async ({ cafe, fake }) => {
        await cafe.settle();
        const url = new URL(cafe.page.url());
        expect(`${url.origin}${url.pathname}${url.search}`, 'the page was never left').toBe(`${PAGE_ORIGIN}/index.html?page=index`);
        expect(cafe.page.context().pages(), 'and opened no other').toHaveLength(1);
        expect(fake.log.filter(entry => /dye2\.reaplugin\/(recipe-edit|dashboard|select-recipe)/.test(entry.path)), 'nothing asked of DYE2\'s pages').toEqual([]);
        expect(fake.store.get(...STRIP_MODE), 'Streamline\'s strip mode as the page found it').toEqual(opened.get(cafe).stripMode);
        expect(cafe.since(opened.get(cafe).mark, entry => entry.method !== 'GET' && entry.path === `/api/v1/store/${STRIP_MODE.join('/')}`), 'and never written').toEqual([]);
        expect(fake.log.filter(entry => (entry.method === 'POST' || entry.method === 'DELETE') && entry.path.startsWith('/api/v1/store/streamlineCafe/')), 'no state of the page\'s own kept in Decaid\'s store').toEqual([]);
    });

    test('an empty slot: two items; with every recipe in a slot the list is empty, and Cancel changes nothing', async ({ cafe, fake }) => {
        await open(cafe);
        await load(cafe, single);
        const { page } = cafe;
        const recordsBefore = records(fake);
        const workflowBefore = fake.workflow();
        const selectionBefore = fake.selection();
        const mark = fake.log.length;

        await holdCard(cafe, 4);
        expect(await menuItems(page)).toEqual(['New recipe from current settings', 'Choose a recipe…']);
        await cafe.screenshot('menu-empty-slot-light');

        await pick(cafe, 'Choose a recipe…');
        await expect(dialog(page)).toHaveAttribute('open');
        await expect(page.locator('#cafe-recipe-dialog-title')).toHaveText('Choose a recipe for slot 4');
        await expect(page.locator('#cafe-recipe-dialog-empty')).toBeVisible();
        expect(await dialogRows(page), 'no row').toEqual([]);

        await page.locator('#cafe-recipe-dialog .modal-action button').click();
        await expect(dialog(page)).not.toHaveAttribute('open');
        await cafe.advance(3000);
        await expect(cardName(page, 4)).toHaveText('Slot 4');
        await expect(title(page)).toHaveText(single.name);
        expect(writes(cafe.since(mark)), 'nothing written').toEqual([]);
        expect(records(fake), 'DYE2\'s records as they were').toEqual(recordsBefore);
        expect(fake.workflow(), 'the Workflow as it was').toEqual(workflowBefore);
        expect(fake.selection(), 'the same recipe loaded').toEqual(selectionBefore);
    });

    test('"New recipe from current settings" in slot 8: DYE2 makes and names it, the page places it with one write, it is loaded, and a tap still loads', async ({ cafe, fake }) => {
        await open(cafe);
        await load(cafe, single);
        const { page } = cafe;
        const recordsBefore = records(fake);
        const workflowBefore = fake.workflow();
        const mark = fake.log.length;

        await holdCard(cafe, 8);
        await pick(cafe, 'New recipe from current settings');

        const made = newRecord(fake, recordsBefore);
        const name = expectedName(workflowBefore, recordsBefore, single);
        expect(made, 'the record, field by field, is what the Workflow held, put in slot 8').toEqual({ ...savedRecipe(workflowBefore, { id: made.id, name, capturedAt: made.capturedAt }), ...PLACED(8) });
        expect(records(fake), 'every other record as it was, the new one last').toEqual([...recordsBefore, made]);
        expect(writes(cafe.since(mark)), 'DYE2 asked to make it, then one write of the records placing it').toEqual([
            { write: SAVE_RECIPE, body: {} },
            { write: RECORDS, body: [...recordsBefore, made] },
        ]);
        expect(fake.workflow(), 'what the machine is set to did not change: only the recipe named as loaded').toEqual(workflowNaming(workflowBefore, made.id));
        // DYE2 calls it changed at once, as on the pinned stack
        // (dye2-save-recipe.json, the selection after the first save-recipe):
        // the record's flush is the machine's own, which the Workflow's is not.
        expect(fake.selection(), 'DYE2 has the new recipe loaded').toEqual({ kind: 'recipe', id: made.id, modified: true });
        await expect(cardName(page, 8)).toHaveText(name);
        await expect(card(page, 8)).toHaveAttribute('aria-pressed', 'true');
        await expect(title(page)).toHaveText(name);
        await cafe.screenshot('page-new-recipe-slot-8-light');

        await load(cafe, single);
        expect(loadedId(fake), 'a tap still loads a recipe').toBe(recordOf(fake, single.name).id);
        await expect(card(page, 8)).toHaveAttribute('aria-pressed', 'false');
    });

    test('a filled card: three items and nothing loads; "Remove from slot" empties it, keeps the record, and leaves the loaded recipe loaded', async ({ cafe, fake }) => {
        await open(cafe);
        await load(cafe, single);
        const { page } = cafe;
        const recordsBefore = records(fake);
        const workflowBefore = fake.workflow();
        const selectionBefore = fake.selection();
        const mark = fake.log.length;

        await holdCard(cafe, decaf.slot);
        expect(await menuItems(page)).toEqual(['Replace with a new recipe', 'Replace with another recipe…', 'Remove from slot']);
        await expect(title(page)).toHaveText(single.name);
        expect(fake.selection(), 'holding the card loaded nothing').toEqual(selectionBefore);
        expect(writes(cafe.since(mark)), 'and wrote nothing').toEqual([]);
        await cafe.screenshot('menu-filled-card-light');
        await paint(page, 'dark');
        await cafe.screenshot('menu-filled-card-dark');
        await paint(page, 'light');

        const removing = fake.log.length;
        await pick(cafe, 'Remove from slot');
        await expect(cardName(page, decaf.slot)).toHaveText(`Slot ${decaf.slot}`);
        const after = recordsWith(recordsBefore, { [decaf.name]: { stripSlot: null } });
        expect(records(fake), 'the recipe stays in DYE2, in no slot; the others as they were').toEqual(after);
        expect(writes(cafe.since(removing)), 'one write of the records').toEqual([{ write: RECORDS, body: after }]);
        await expect(title(page)).toHaveText(single.name);
        expect(fake.selection(), 'the loaded recipe is still loaded').toEqual(selectionBefore);
        expect(fake.workflow(), 'the Workflow as it was').toEqual(workflowBefore);
    });

    test('choosing for an empty slot: the recipes in no slot, by name, with the bean and profile; the chosen one takes the slot, and nothing loads', async ({ cafe, fake }) => {
        inNoSlot(fake, decaf.name, long.name);
        await open(cafe);
        await load(cafe, single);
        const { page } = cafe;
        const recordsBefore = records(fake);
        const workflowBefore = fake.workflow();
        const selectionBefore = fake.selection();

        await holdCard(cafe, 4);
        await pick(cafe, 'Choose a recipe…');
        await expect(dialog(page)).toHaveAttribute('open');
        await expect(page.locator('#cafe-recipe-dialog-empty')).toBeHidden();
        expect(await dialogRows(page), 'sorted by name, the bean and the profile under each').toEqual([
            { name: decaf.name, detail: `${decaf.bean} · ${decaf.profile}` },
            { name: long.name, detail: `${long.bean} · ${long.profile}` },
        ]);
        await cafe.screenshot('dialog-choose-light');
        await paint(page, 'dark');
        await cafe.screenshot('dialog-choose-dark');
        await paint(page, 'light');

        const mark = fake.log.length;
        await choose(cafe, decaf.name);
        await expect(cardName(page, 4)).toHaveText(decaf.name);
        const after = recordsWith(recordsBefore, { [decaf.name]: PLACED(4) });
        expect(records(fake), 'the chosen recipe in slot 4; the others as they were').toEqual(after);
        expect(writes(cafe.since(mark)), 'one write of the records').toEqual([{ write: RECORDS, body: after }]);
        await expect(title(page)).toHaveText(single.name);
        await expect(card(page, 4)).toHaveAttribute('aria-pressed', 'false');
        expect(fake.selection(), 'choosing loads nothing').toEqual(selectionBefore);
        expect(fake.workflow(), 'the Workflow as it was').toEqual(workflowBefore);
    });

    test('"Replace with another recipe": the chosen one takes the card, and the one replaced stays in DYE2 in no slot', async ({ cafe, fake }) => {
        inNoSlot(fake, long.name);
        await open(cafe);
        await load(cafe, single);
        const { page } = cafe;
        const recordsBefore = records(fake);
        const selectionBefore = fake.selection();

        await holdCard(cafe, house.slot);
        await pick(cafe, 'Replace with another recipe…');
        await expect(dialog(page)).toHaveAttribute('open');
        await expect(page.locator('#cafe-recipe-dialog-title')).toHaveText(`Choose a recipe for slot ${house.slot}`);
        expect((await dialogRows(page)).map(row => row.name)).toEqual([long.name]);

        const mark = fake.log.length;
        await choose(cafe, long.name);
        await expect(cardName(page, house.slot)).toHaveText(long.name);
        const after = recordsWith(recordsBefore, { [long.name]: PLACED(house.slot), [house.name]: { stripSlot: null } });
        expect(records(fake), 'the chosen one in the slot, the one replaced in none').toEqual(after);
        expect(writes(cafe.since(mark)), 'one write of the records').toEqual([{ write: RECORDS, body: after }]);
        expect(fake.selection(), 'the loaded recipe is still loaded').toEqual(selectionBefore);
    });

    // Once the page clears the selection, DYE2 derives it from the Workflow
    // again: none, or a recent favourite whose dial-in the Workflow matches,
    // which names no recipe either (dye2-selection.json, steps 1 to 3).
    const unloads = [
        { what: 'DYE2 then names nothing', given: () => {}, selection: () => null },
        {
            what: 'DYE2 then names a recent favourite the Workflow matches',
            // The second recent favourite given the loaded recipe's yield and grind.
            given: fake => fake.store.set(DYE2, 'autoFavourites', fake.store.get(DYE2, 'autoFavourites').map((fav, i) => (i !== 1 ? fav : {
                ...fav, workflow: { ...fav.workflow, context: { ...fav.workflow.context, targetYield: single.yield, grinderSetting: single.grind } },
            }))),
            selection: fake => ({ kind: 'favourite', id: fake.store.get(DYE2, 'autoFavourites')[1].id, modified: false, auto: true }),
        },
    ];
    for (const { what, given, selection } of unloads) {
        test(`removing the loaded recipe's card unloads it, and what the machine is set to does not change: ${what}`, async ({ cafe, fake }) => {
            given(fake);
            await open(cafe);
            await load(cafe, single);
            const { page } = cafe;
            const recordsBefore = records(fake);
            const workflowBefore = fake.workflow();
            const doseShown = await page.locator('#dose-in-value').textContent();
            const mark = fake.log.length;

            await holdCard(cafe, single.slot);
            await pick(cafe, 'Remove from slot');
            await expect(title(page)).toHaveText('No recipe selected');
            await expect(page.locator('#cafe-dial-label')).toHaveText('Dial-in · not saved to a recipe');
            await expect(cardName(page, single.slot)).toHaveText(`Slot ${single.slot}`);
            await expect(page.locator('#cafe-strip .cafe-card[aria-pressed="true"]'), 'no card shown loaded').toHaveCount(0);
            const after = recordsWith(recordsBefore, { [single.name]: { stripSlot: null } });
            expect(records(fake), 'the recipe stays in DYE2, in no slot').toEqual(after);
            expect(writes(cafe.since(mark)), 'the records written, then DYE2\'s selection cleared').toEqual([
                { write: RECORDS, body: after },
                { write: SELECTION, body: {} },
            ]);
            expect(fake.workflow(), 'the Workflow as it was, naming no recipe').toEqual(workflowNaming(workflowBefore, null));
            await expect(page.locator('#dose-in-value')).toHaveText(doseShown);
            expect(fake.selection(), 'the selection DYE2 derives names no recipe').toEqual(selection(fake));
        });
    }

    test('"Replace with a new recipe" on the loaded card: the new recipe takes the card and is loaded, and the one replaced keeps no slot', async ({ cafe, fake }) => {
        await open(cafe);
        await load(cafe, single);
        const { page } = cafe;
        const recordsBefore = records(fake);
        const workflowBefore = fake.workflow();
        const mark = fake.log.length;

        await holdCard(cafe, single.slot);
        await pick(cafe, 'Replace with a new recipe');

        const made = newRecord(fake, recordsBefore);
        const name = expectedName(workflowBefore, recordsBefore, single);
        expect(made, 'the record, field by field, is what the Workflow held, put in the card\'s slot').toEqual({ ...savedRecipe(workflowBefore, { id: made.id, name, capturedAt: made.capturedAt }), ...PLACED(single.slot) });
        const after = [...recordsWith(recordsBefore, { [single.name]: { stripSlot: null } }), made];
        expect(records(fake), 'the new one in the slot, the one replaced in none').toEqual(after);
        expect(writes(cafe.since(mark)), 'DYE2 asked to make it, then one write of the records placing it').toEqual([
            { write: SAVE_RECIPE, body: {} },
            { write: RECORDS, body: after },
        ]);
        expect(fake.workflow(), 'only the recipe named as loaded changed').toEqual(workflowNaming(workflowBefore, made.id));
        expect(fake.selection(), 'the new recipe is loaded').toEqual({ kind: 'recipe', id: made.id, modified: true });
        await expect(cardName(page, single.slot)).toHaveText(name);
        await expect(card(page, single.slot)).toHaveAttribute('aria-pressed', 'true');
        await expect(title(page)).toHaveText(name);
    });

    test('while a shot runs a long-press opens no menu, on an empty slot or a filled card', async ({ cafe, fake }) => {
        await open(cafe);
        const { page } = cafe;
        let at = 8000;
        await cafe.pour(at);
        await expect(page.locator('#main-page.cafe-shot-live')).toBeAttached();
        const mark = fake.log.length;
        for (const slot of [6, house.slot]) {
            const box = await card(page, slot).boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            // Held past Streamline's half second, the pour going on meanwhile.
            at += 1000;
            await cafe.pour(at);
            await page.mouse.up();
            await expect(page.locator('#main-page.cafe-shot-live')).toBeAttached();
            await expect(menu(page), `no menu on slot ${slot}`).toBeHidden();
        }
        expect(writes(cafe.since(mark)), 'nothing written').toEqual([]);

        // The same press opens the menu once the shot is over and stored.
        await cafe.pour();
        await cafe.untilStored();
        await cafe.storeShot();
        await cafe.advance(2000);
        await expect(page.locator('#main-page.cafe-shot-live')).toHaveCount(0);
        await holdCard(cafe, 6);
        expect(await menuItems(page)).toEqual(['New recipe from current settings', 'Choose a recipe…']);
    });
});
