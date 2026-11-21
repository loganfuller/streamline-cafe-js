// The strip and a recipe loaded from it (docs/cafe/DESIGN.md, "Recipes and the
// strip"): the nine cards in one row, each recipe's name and bean and each
// empty slot's outline, a tap on an empty slot doing nothing, the page with no
// recipe loaded, the dial-in column's rows each one size, Settings and Sleep,
// and what is gone from Streamline's page; then two and three taps in quick
// succession, of which only the newest is the machine's, and one tap's load
// with everything it shows.
//
// The taps in quick succession are made in one turn of the page, before any
// answer to the first can arrive: the loader (src/cafe/recipe-loader.js) runs
// one load at a time, lets the one under way finish, and writes only the
// newest tap waiting after it.
//
// What the load writes is Streamline's apply (src/modules/dyeStrip.js); the
// Workflow it leaves is Decaid's merge of that write, and DYE2's selection the
// one DYE2 derives after it, both recorded scenarios
// (fake-decaid/recordings/workflow-merge.json, dye2-selection.json).

import { test, expect } from './support/test.mjs';
import { card, writes } from './support/page-reads.mjs';
import { records, recordOf, matchMachine } from './support/fake-reads.mjs';
import { RECIPES } from './support/sample-data.mjs';

const [house, single, decaf] = RECIPES;
const EMPTY_SLOTS = [4, 6, 8];
const RECORDS = '/api/v1/store/dye2.reaplugin/recipes';
const SELECTION = '/api/v1/plugins/dye2.reaplugin/selection';
const WORKFLOW = '/api/v1/workflow';
const STRIP_MODE = 'streamline.dyeStripMode';
// Streamline's own strip, its favourites, its DYE button, its shot panels, its
// temperature presets and its steam mode: none of them is on the cafe page.
const GONE = ['#dye-strip-toggle', '#profile-fav-nav', '#dye-open-btn', '#shot-history-panel', '#shot-data-panel', '#temp-presets', '#steam-mode-toggle'];

const title = page => page.locator('#cafe-title');
const pressed = page => page.locator('#cafe-strip [aria-pressed="true"]');

/** Each card's name and the line under it, in slot order. */
const cards = page => page.locator('#cafe-strip .cafe-card').evaluateAll(els => els.map(el => ({
    name: el.querySelector('.cafe-card-name')?.textContent,
    bean: el.querySelector('.cafe-card-bean')?.textContent,
    border: getComputedStyle(el).borderTopStyle,
    top: Math.round(el.getBoundingClientRect().top),
})));

/** The dial-in column's labels, values and steppers, each as its size and weight. */
const column = page => page.evaluate(() => {
    const style = (el, ...props) => props.map(p => getComputedStyle(el)[p]).join(' ');
    const all = selector => [...document.querySelectorAll(`#shot-settings ${selector}`)];
    return {
        names: all('.cafe-row-name').map(el => style(el, 'fontSize', 'fontWeight')),
        values: ['dose-in-value', 'drink-out-value', 'grind-value', 'temp-value', 'flush-value', 'steam-flow-value', 'hot-water-vol-value']
            .map(id => style(document.getElementById(id), 'fontSize', 'fontWeight')),
        buttons: all('.cafe-stepper > button').map(el => style(el, 'width', 'height')),
    };
});

/** What the page shows of a loaded recipe: its heading and each dial-in row. */
const shown = page => page.evaluate(() => {
    const text = id => document.getElementById(id)?.textContent;
    return {
        title: text('cafe-title'),
        subtitle: text('cafe-subtitle'),
        dialLabel: text('cafe-dial-label'),
        dose: text('dose-in-value'),
        yield: text('drink-out-value'),
        grind: text('grind-value'),
        brew: text('temp-value'),
        flush: text('flush-value'),
        steamFlow: text('steam-flow-value'),
        hotWater: text('hot-water-vol-value'),
        doseDesc: text('cafe-dose-desc'),
        yieldDesc: text('cafe-yield-desc'),
        grindDesc: text('cafe-grind-desc'),
        profile: text('profile-name').trim(),
    };
});

/** What the page should show of a record loaded, read off the record itself. */
const showing = (record, roasted) => {
    const dv = record.dashboardVariables;
    return {
        title: record.name,
        subtitle: `${record.beanName} · ${record.profileTitle}`,
        dialLabel: 'Dial-in · not saved to the recipe',
        dose: `${dv.dose}g`,
        yield: `${dv.drink}g`,
        grind: String(dv.grind),
        brew: `${dv.brewC}°c`,
        flush: `${dv.flushS}s`,
        steamFlow: String(dv.steamFlowMls),
        hotWater: `${dv.hotWaterMl}ml`,
        doseDesc: `${record.beanName} · roasted ${roasted}`,
        yieldDesc: dv.basketName,
        grindDesc: dv.grinderModel,
        profile: record.profileTitle,
    };
};

function workflowOf(record, machine) {
    const { extras, ...context } = record.workflow.context;
    const { dye, ...rest } = extras;
    const { profile, hotWaterData } = record.workflow;
    const dv = record.dashboardVariables;
    return {
        ...record.workflow,
        id: machine.id,
        name: machine.name,
        description: machine.description,
        context: {
            ...context,
            extras: { ...rest, dye: { selection: null, v: 1, recipeId: record.id }, rpm: null, feedRate: null },
        },
        profile: { ...profile, steps: profile.steps.map(step => ({ ...step, limiter: step.limiter && Number(step.limiter.value) !== 0 ? step.limiter : null })) },
        steamSettings: { ...machine.steamSettings, targetTemperature: dv.steamTempC, duration: dv.steamTimeS, flow: dv.steamFlowMls, stopAtTemperature: dv.steamStopAtTempC },
        hotWaterData,
        rinseData: { ...machine.rinseData, targetTemperature: dv.flushTempC, duration: dv.flushS, flow: dv.flushFlowMls },
    };
}

function ownLiveSettings(fake, name) {
    const machine = fake.workflow();
    const water = { volume: machine.hotWaterData.volume + 70, targetTemperature: machine.hotWaterData.targetTemperature + 10, duration: machine.hotWaterData.duration + 15, flow: machine.hotWaterData.flow - 2 };
    const steam = { targetTemperature: machine.steamSettings.targetTemperature + 5, duration: machine.steamSettings.duration + 10, flow: machine.steamSettings.flow + 0.3, stopAtTemperature: machine.steamSettings.stopAtTemperature + 65 };
    const rinse = { targetTemperature: machine.rinseData.targetTemperature - 20, duration: machine.rinseData.duration + 5, flow: machine.rinseData.flow - 1 };
    fake.store.set('dye2.reaplugin', 'recipes', records(fake).map(row => {
        if (!row || row.name !== name) return row;
        return {
            ...row,
            dashboardVariables: {
                ...row.dashboardVariables,
                hotWaterMl: water.volume, hotWaterTempC: water.targetTemperature, hotWaterTimeS: water.duration, hotWaterFlowMls: water.flow,
                steamTempC: steam.targetTemperature, steamTimeS: steam.duration, steamFlowMls: steam.flow, steamStopAtTempC: steam.stopAtTemperature,
                flushTempC: rinse.targetTemperature, flushS: rinse.duration, flushFlowMls: rinse.flow,
            },
            workflow: { ...row.workflow, hotWaterData: { ...row.workflow.hotWaterData, ...water }, steamSettings: { ...row.workflow.steamSettings, ...steam }, rinseData: { ...row.workflow.rinseData, ...rinse } },
        };
    }));
    const record = recordOf(fake, name);
    for (const [group, own] of Object.entries({ hotWaterData: water, steamSettings: steam, rinseData: rinse })) {
        for (const [field, value] of Object.entries(own)) {
            expect(record.workflow[group][field], `${name}'s ${group}.${field} is its own`).toBe(value);
            expect(value, `and not the machine's`).not.toBe(machine[group][field]);
        }
    }
}

/** The recipe ids each Workflow write and each DYE2 selection named, in order. */
function loadsWritten(entries) {
    const all = writes(entries);
    return {
        workflow: all.filter(w => w.write === `PUT ${WORKFLOW}`).map(w => w.body?.context?.extras?.dye?.recipeId),
        selection: all.filter(w => w.write === `POST ${SELECTION}`).map(w => w.body?.id),
        records: all.filter(w => w.write === `POST ${RECORDS}`).length,
    };
}

/** Taps on cards in one turn of the page, before any answer can reach it. */
const quickTaps = (page, slots) => page.evaluate(slots => {
    const all = document.querySelectorAll('#cafe-strip .cafe-card');
    for (const slot of slots) all[slot - 1].click();
}, slots);

/** The strip mode set in Decaid's store before the page opens, which the skin must leave alone. */
function setStripMode(fake, mode) {
    fake.store.set('streamlineSettings', STRIP_MODE, mode);
}
const stripModeLocal = page => page.evaluate(key => localStorage.getItem(key), STRIP_MODE);
const isStripModeWrite = entry => entry.method === 'POST' && entry.path === `/api/v1/store/streamlineSettings/${STRIP_MODE}`;

test.describe('the strip', { tag: '@strip' }, () => {
    test('nine cards in one row, the page with no recipe, and a tap on an empty slot doing nothing', async ({ cafe, fake }) => {
        const page = await cafe.open();

        const want = Array.from({ length: 9 }, (_, i) => {
            const recipe = RECIPES.find(r => r.slot === i + 1);
            if (!recipe) return { name: `Slot ${i + 1}`, bean: 'Hold to add', dashed: true };
            expect(recordOf(fake, recipe.name).beanName, `${recipe.name}'s record names its bean`).toBe(recipe.bean);
            return { name: recipe.name, bean: recipe.bean, dashed: false };
        });
        // Read until it holds: once in twenty repeats on a loaded Mac, the
        // first read just after the page opened found the empty slots' border
        // not yet dashed, though the screenshot a moment later showed it.
        await expect.poll(async () => (await cards(page)).map(({ name, bean, border }) => ({ name, bean, dashed: border === 'dashed' })),
            'each recipe\'s name and bean in its slot, each empty slot an outline reading "Slot n" and "Hold to add"').toEqual(want);
        const drawn = await cards(page);
        expect(drawn, 'nine cards').toHaveLength(9);
        expect(new Set(drawn.map(c => c.top)).size, 'in one row').toBe(1);

        const noRecipe = { title: 'No recipe selected', subtitle: 'Tap a recipe to load it', dialLabel: 'Dial-in · not saved to a recipe' };
        const heading = () => page.evaluate(() => ({
            title: document.getElementById('cafe-title').textContent,
            subtitle: document.getElementById('cafe-subtitle').textContent,
            dialLabel: document.getElementById('cafe-dial-label').textContent,
        }));
        expect(await heading(), 'the page with no recipe: its title, the line under it, the column\'s label').toEqual(noRecipe);
        await expect(pressed(page), 'no card is filled').toHaveCount(0);
        await cafe.screenshot('page-no-recipe-light');

        const url = page.url();
        const workflow = fake.workflow();
        const selection = fake.selection();
        const mark = fake.log.length;
        await card(page, EMPTY_SLOTS[0]).click();
        await cafe.advance(3000);
        expect(await heading(), 'a tap on an empty slot does nothing').toEqual(noRecipe);
        await expect(pressed(page)).toHaveCount(0);
        expect(page.url(), 'and the page stays where it is').toBe(url);
        expect(writes(cafe.since(mark)), 'it writes nothing').toEqual([]);
        expect(fake.workflow(), 'the Workflow is as it was').toEqual(workflow);
        expect(fake.selection(), 'and DYE2\'s selection').toEqual(selection);
    });

    test('the dial-in column: seven rows, each label, value and stepper one size, with Settings and Sleep beside it', async ({ cafe }) => {
        const page = await cafe.open();
        await expect(page.locator('#shot-settings .cafe-row-name')).toHaveText(['Dose', 'Yield', 'Grind', 'Brew', 'Flush', 'Steam flow', 'Hot water']);
        const { names, values, buttons } = await column(page);
        expect(names, 'seven labels').toHaveLength(7);
        expect(new Set(names).size, `each label the same size and weight: ${[...new Set(names)].join(' | ')}`).toBe(1);
        expect(new Set(values).size, `each value the same size and weight: ${[...new Set(values)].join(' | ')}`).toBe(1);
        expect(buttons, 'fourteen − and + buttons').toHaveLength(14);
        expect(new Set(buttons).size, `all the same size: ${[...new Set(buttons)].join(' | ')}`).toBe(1);
        // The recorded machine has no buttons of its own: the page's column of
        // machine buttons shows, with Settings and Sleep at its top.
        await expect(page.locator('#ghc-controls')).toBeVisible();
        await expect(page.locator('#ghc-controls #settings-btn')).toBeVisible();
        await expect(page.locator('#ghc-controls #sleep-button')).toBeVisible();
    });

    test('a machine with buttons of its own: Settings and Sleep at the bottom of the dial-in column', async ({ cafe, fake }) => {
        fake.patchBoot('GET /api/v1/machine/info', info => ({ ...info, GHC: true }));
        const page = await cafe.open();
        await expect(page.locator('#ghc-controls')).toBeHidden();
        await expect(page.locator('#shot-settings #settings-btn')).toBeVisible();
        await expect(page.locator('#shot-settings #sleep-button')).toBeVisible();
        const { names, buttons } = await column(page);
        expect(names, 'still seven rows').toHaveLength(7);
        expect(buttons, 'and fourteen steppers').toHaveLength(14);
    });

    test('gone from Streamline\'s page', async ({ cafe }) => {
        const page = await cafe.open();
        for (const gone of GONE) await expect(page.locator(gone), `${gone} is not on the page`).toHaveCount(0);
    });

    test('two quick taps: only the second recipe is the machine\'s, whole', async ({ cafe, fake }) => {
        matchMachine(fake, decaf.name);
        ownLiveSettings(fake, decaf.name);
        setStripMode(fake, 'R');
        const page = await cafe.open();
        const machine = fake.workflow();
        const before = records(fake);
        const first = recordOf(fake, house.name);
        const second = recordOf(fake, decaf.name);
        expect(await stripModeLocal(page)).toBe('R');
        const mark = fake.log.length;

        await quickTaps(page, [house.slot, decaf.slot]);
        await expect(title(page), 'the page names the second recipe').toHaveText(decaf.name);
        await cafe.advance(3000);

        await expect(title(page)).toHaveText(decaf.name);
        await expect(card(page, decaf.slot), 'its card is filled').toHaveAttribute('aria-pressed', 'true');
        await expect(pressed(page), 'and no other').toHaveCount(1);
        expect(fake.workflow(), 'the Workflow is the second recipe\'s, as loading it alone leaves it').toEqual(workflowOf(second, machine));
        expect(fake.selection(), 'DYE2 names the second recipe, unchanged').toEqual({ kind: 'recipe', id: second.id, modified: false });
        expect(loadsWritten(cafe.since(mark)), 'the first load, under way at the second tap, finished; the second was written after it; no record written')
            .toEqual({ workflow: [first.id, second.id], selection: [first.id, second.id], records: 0 });
        expect(records(fake), 'DYE2\'s records are as they were').toEqual(before);
        expect(await stripModeLocal(page), 'Streamline\'s strip mode is as it was').toBe('R');
        expect(fake.store.get('streamlineSettings', STRIP_MODE)).toBe('R');
        expect(cafe.since(mark, isStripModeWrite), 'and never written').toEqual([]);
    });

    test('three quick taps: the one between is never written, and the newest is the machine\'s', async ({ cafe, fake }) => {
        matchMachine(fake, decaf.name);
        ownLiveSettings(fake, decaf.name);
        const page = await cafe.open();
        const machine = fake.workflow();
        const first = recordOf(fake, house.name);
        const third = recordOf(fake, decaf.name);
        const mark = fake.log.length;

        await quickTaps(page, [house.slot, single.slot, decaf.slot]);
        await expect(title(page)).toHaveText(decaf.name);
        await cafe.advance(3000);

        await expect(card(page, decaf.slot)).toHaveAttribute('aria-pressed', 'true');
        await expect(pressed(page)).toHaveCount(1);
        expect(loadsWritten(cafe.since(mark)), 'the load under way finished, the tap that waited was replaced by the newest')
            .toEqual({ workflow: [first.id, third.id], selection: [first.id, third.id], records: 0 });
        expect(fake.workflow()).toEqual(workflowOf(third, machine));
        expect(fake.selection()).toEqual({ kind: 'recipe', id: third.id, modified: false });
    });

    test('a tap loads a recipe: the Workflow, DYE2\'s selection and every row are its record\'s', async ({ cafe, fake }) => {
        matchMachine(fake, single.name);
        ownLiveSettings(fake, single.name);
        setStripMode(fake, 'R');
        const page = await cafe.open();
        const machine = fake.workflow();
        const before = records(fake);
        const record = recordOf(fake, single.name);
        const mark = fake.log.length;

        await card(page, single.slot).click();
        await expect(title(page)).toHaveText(single.name);
        await cafe.advance(3000);

        await expect(card(page, single.slot), 'its card is filled').toHaveAttribute('aria-pressed', 'true');
        await expect(pressed(page), 'and no other').toHaveCount(1);
        // The sample data's batch of Sample Single Origin was roasted on 28 October.
        expect(await shown(page), 'the heading and each row, read off the record').toEqual(showing(record, 'Oct 28'));
        expect(fake.workflow(), 'the Workflow is the record\'s').toEqual(workflowOf(record, machine));
        const { context } = fake.workflow();
        const dv = record.dashboardVariables;
        expect({ dose: context.targetDoseWeight, yield: context.targetYield, grind: Number(context.grinderSetting), basket: context.extras.basketName, grinder: context.grinderModel, bean: context.coffeeName },
            'and agrees with the record\'s dial-in').toEqual({ dose: dv.dose, yield: dv.drink, grind: dv.grind, basket: dv.basketName, grinder: dv.grinderModel, bean: record.beanName });
        expect(fake.selection(), 'DYE2 names the recipe, unchanged').toEqual({ kind: 'recipe', id: record.id, modified: false });
        expect(loadsWritten(cafe.since(mark)), 'one load, no record written').toEqual({ workflow: [record.id], selection: [record.id], records: 0 });
        expect(records(fake), 'DYE2\'s records are as they were').toEqual(before);
        expect(await stripModeLocal(page), 'Streamline\'s strip mode is as it was').toBe('R');
        expect(cafe.since(mark, isStripModeWrite), 'and never written').toEqual([]);
        await cafe.screenshot('page-recipe-light');
    });
});
