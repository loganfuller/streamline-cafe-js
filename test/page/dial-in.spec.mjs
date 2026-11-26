// Stepping the dial-in: with a recipe loaded, a step reaches the Workflow and
// changes this machine only, never DYE2's record of the recipe; Temp | Vol
// picks which of hot water's two numbers the buttons step; the steam row steps
// the flow whatever mode Streamline's steam tile is in; and a change made just
// before another recipe is tapped is written before that recipe loads, so it
// does not land on it, and the first recipe comes back with its own numbers.
//
// The page's steppers write a moment after their last tap (Streamline's
// `API_DEBOUNCE_MS`, src/modules/workflow-watch.js), on the page's clock, which
// the tests move. The page's clock also runs on by itself, so by the time the
// tapped recipe's load writes, those writes have usually been made already:
// the test checks the order the writes reach the machine in, not that a load
// waits for a write still on the wire (`settleDialIn`, src/cafe/page.js),
// which no page test holds a request open to check.

import { test, expect } from './support/test.mjs';
import { card, load, isWrite, writes } from './support/page-reads.mjs';
import { records, recordOf, loadedId, matchMachine } from './support/fake-reads.mjs';
import { RECIPES } from './support/sample-data.mjs';
import { API_DEBOUNCE_MS } from '../../src/modules/workflow-watch.js';
import { AFTER_CHECK_MS } from '../../src/cafe/profile-change.js';

// The recipe loaded for the steps, and the one tapped next.
const [, single, , longBlack] = RECIPES;

const isWorkflowWrite = entry => entry.method === 'PUT' && entry.path === '/api/v1/workflow';
const isDye2Write = entry => isWrite(entry) && /^\/api\/v1\/(plugins|store)\/dye2\.reaplugin\//.test(entry.path);
const number = async (page, id) => parseFloat(await page.locator(`#${id}`).textContent());
const fontSize = (page, id) => page.locator(`#${id}`).evaluate(e => getComputedStyle(e).fontSize);

/** Past the steppers' debounce, and past DYE2's window, in which a save of the record would land. */
const PAST_DYE2_MS = AFTER_CHECK_MS + 500;

/** The page open with the single origin loaded afresh, as stored, and not called changed. */
async function openLoaded(cafe, options) {
    matchMachine(cafe.fake, single.name);
    await cafe.open(options);
    await load(cafe, single);
    await expect(card(cafe.page, single.slot)).toHaveAttribute('aria-pressed', 'true');
    const record = recordOf(cafe.fake, single.name);
    expect(cafe.fake.selection(), 'the recipe is loaded, and not as changed').toEqual({ kind: 'recipe', id: record.id, modified: false });
    return record;
}

test.describe('stepping the dial-in', { tag: '@dialin' }, () => {
    test('+ steps the dose once, the step reaches the Workflow, and DYE2\'s record is not written', async ({ cafe, fake }) => {
        const before = await openLoaded(cafe);
        const page = cafe.page;
        const recordsBefore = records(fake);
        const workflowBefore = fake.workflow();
        const mark = fake.log.length;

        await page.locator('#dose-in-plus').click();
        const stepped = await number(page, 'dose-in-value');
        expect(stepped, '+ steps the dose once, by Streamline\'s step of a gram').toBe(before.dashboardVariables.dose + 1);

        await cafe.advance(API_DEBOUNCE_MS + 500);
        // The record's profile stops at 36 g under a 40 g yield, as DYE2 saved
        // it; Streamline's write of a dose sends the yield as the stop as well
        // (src/modules/ui.js, the stop-at-weight kept in step with the yield).
        expect(workflowBefore.profile.target_weight, 'loaded, the profile stops where the record\'s does').toBe(before.workflow.profile.target_weight);
        const yieldG = workflowBefore.context.targetYield;
        expect(fake.workflow(), 'the Workflow has the step and the yield as its stop, and nothing else changed').toEqual({
            ...workflowBefore,
            context: { ...workflowBefore.context, targetDoseWeight: stepped },
            profile: { ...workflowBefore.profile, target_weight: yieldG },
        });

        await cafe.advance(PAST_DYE2_MS);
        expect(recordOf(fake, single.name), 'DYE2\'s record of the recipe keeps its dose, and every other field').toEqual(before);
        expect(records(fake), 'no record changed').toEqual(recordsBefore);
        const since = cafe.since(mark);
        expect(since.filter(isDye2Write), 'nothing written to DYE2: no record, no save-recipe, no selection').toEqual([]);
        expect(writes(since), 'one Workflow write, of the dose with the yield, and Streamline\'s own note of the dose for the profile').toEqual([
            { write: 'PUT /api/v1/workflow', body: { context: { targetDoseWeight: stepped, targetYield: yieldG }, profile: { target_weight: yieldG } } },
            { write: expect.stringMatching(/^POST \/api\/v1\/store\/streamlineProfileOverrides\//), body: { targetDoseWeight: stepped } },
        ]);
        expect(fake.selection(), 'the recipe stays loaded, which DYE2 now calls changed').toEqual({ kind: 'recipe', id: before.id, modified: true });
        expect(await number(page, 'dose-in-value'), 'the page still shows the step').toBe(stepped);
        await cafe.screenshot('page-dial-in-stepped-light');
    });

    test('Temp | Vol picks which of hot water\'s two numbers the buttons step', async ({ cafe, fake }) => {
        const before = await openLoaded(cafe);
        const page = cafe.page;
        const { hotWaterTempC, hotWaterMl } = before.dashboardVariables;
        expect([await fontSize(page, 'hot-water-temp-value'), await fontSize(page, 'hot-water-vol-value')], 'Vol first: the volume large').toEqual(['16px', '30px']);

        await page.locator('#hot-water-mode-toggle').click();
        expect([await fontSize(page, 'hot-water-temp-value'), await fontSize(page, 'hot-water-vol-value')], 'Temp: the temperature large').toEqual(['30px', '16px']);
        const workflowBefore = fake.workflow();
        await page.locator('#hot-water-vol-plus').click();
        await cafe.advance(API_DEBOUNCE_MS + 500);
        const temp = await number(page, 'hot-water-temp-value');
        expect(temp, '+ steps the temperature, a degree').toBe(hotWaterTempC + 1);
        expect(await number(page, 'hot-water-vol-value'), 'and not the volume').toBe(hotWaterMl);
        expect(fake.workflow(), 'the Workflow has the temperature, and nothing else changed').toEqual({ ...workflowBefore, hotWaterData: { ...workflowBefore.hotWaterData, targetTemperature: temp } });

        await page.locator('#hot-water-mode-toggle').click();
        expect([await fontSize(page, 'hot-water-temp-value'), await fontSize(page, 'hot-water-vol-value')], 'Vol again').toEqual(['16px', '30px']);
    });

    test('the steam row steps the flow, with Streamline\'s steam tile in time mode', async ({ cafe, fake }) => {
        const before = await openLoaded(cafe);
        const page = cafe.page;
        await page.evaluate(() => { window._forceNumpadMobile = true; });
        // Streamline's steam tile put into time mode, as loading a recipe saved
        // in that mode leaves it: the row is still the flow, and still steps it.
        await page.evaluate(() => window.app.ui.setSteamTileModeIfSafe('time'));
        const flowBefore = await number(page, 'steam-flow-value');
        expect(flowBefore, 'the row shows the recipe\'s flow').toBe(before.dashboardVariables.steamFlowMls);
        const recordsBefore = records(fake);
        const workflowBefore = fake.workflow();
        const mark = fake.log.length;

        await page.locator('#cafe-steam-plus').click();
        const flowAfter = await number(page, 'steam-flow-value');
        expect(flowAfter, '+ adds a tenth to the flow').toBeCloseTo(flowBefore + 0.1, 6);
        expect(await fontSize(page, 'steam-flow-value'), 'the flow still shown large').toBe('30px');

        await cafe.advance(API_DEBOUNCE_MS + 500);
        expect(fake.workflow(), 'the Workflow has the new flow, the steam time untouched, and nothing else changed').toEqual({ ...workflowBefore, steamSettings: { ...workflowBefore.steamSettings, flow: flowAfter } });

        await cafe.advance(PAST_DYE2_MS);
        expect(records(fake), 'no record changed').toEqual(recordsBefore);
        expect(cafe.since(mark).filter(isDye2Write), 'nothing written to DYE2').toEqual([]);
        expect(loadedId(fake), 'the recipe stays loaded').toBe(before.id);
    });

    test('a tap on the steam flow opens its numpad, with Streamline\'s steam tile in time mode', async ({ cafe }) => {
        await openLoaded(cafe, { before: () => { window._forceNumpadMobile = true; } });
        const page = cafe.page;
        // From Streamline v0.2.33 the tile takes taps off the value its mode
        // shows small, which in time mode is the flow, the row's only number.
        await page.evaluate(() => window.app.ui.setSteamTileModeIfSafe('time'));
        expect(await page.locator('#steam-flow-value').evaluate(e => e.style.pointerEvents), 'the tile took the flow\'s taps').toBe('none');
        await page.locator('#steam-flow-value').click();
        await expect(page.locator('#numpad-modal-overlay'), 'a tap on the flow opens the numpad').toBeVisible();
        await page.locator('#numpad-cancel').click();
        await expect(page.locator('#numpad-modal-overlay')).toBeHidden();
    });

    for (const mode of ['flow', 'time']) {
        test(`during a shot, a tap on the steam flow opens nothing, with Streamline's steam tile in ${mode} mode`, async ({ cafe, fake }) => {
            await openLoaded(cafe, { before: () => { window._forceNumpadMobile = true; } });
            const page = cafe.page;
            await page.evaluate(m => window.app.ui.setSteamTileModeIfSafe(m), mode);
            const mark = fake.log.length;
            await cafe.pour(fake.machine.pourMoment((frame, socket) => socket === 'machine/snapshot' && frame.state?.state === 'espresso') + 1000);
            await expect(page.locator('#steam-section'), 'Streamline dims the steam row').toHaveCSS('pointer-events', 'none');
            const box = await page.locator('#steam-flow-value').boundingBox();
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            await cafe.pour(3000);
            await expect(page.locator('#numpad-modal-overlay'), 'no numpad over the shot').toBeHidden();
            expect(cafe.since(mark).filter(isWorkflowWrite), 'no Workflow write during the shot').toEqual([]);
            await cafe.pour();
            await cafe.untilStored();
            await cafe.storeShot();
        });
    }

    test('a change made just before another recipe is tapped does not land on it, and the first comes back with its own numbers', async ({ cafe, fake }) => {
        const first = await openLoaded(cafe);
        const page = cafe.page;
        const other = recordOf(fake, longBlack.name);
        const recordsBefore = records(fake);
        const mark = fake.log.length;

        await page.locator('#cafe-steam-plus').click();
        const flowStepped = await number(page, 'steam-flow-value');
        await page.locator('#flush-plus').click();
        const flushStepped = await number(page, 'flush-value');
        expect(flushStepped, 'the flush stepped off the record\'s').not.toBe(first.dashboardVariables.flushS);
        expect(flowStepped, 'and the steam flow').not.toBe(first.dashboardVariables.steamFlowMls);
        // The tap at once, inside the steppers' debounce.
        await card(page, longBlack.slot).click();
        await expect(page.locator('#cafe-title')).toHaveText(longBlack.name);
        await cafe.advance(PAST_DYE2_MS);

        const workflow = fake.workflow();
        expect(loadedId(fake), 'the other recipe is loaded').toBe(other.id);
        expect(workflow.rinseData.duration, 'the flush is the other recipe\'s, not the step').toBe(other.dashboardVariables.flushS);
        expect(other.dashboardVariables.steamMode, 'the other recipe names no steam mode').toBeUndefined();
        expect(workflow.steamSettings.flow, 'the steam flow is the other recipe\'s too, not the step').toBe(other.dashboardVariables.steamFlowMls);
        expect(await number(page, 'flush-value'), 'the page shows the other recipe\'s flush').toBe(other.dashboardVariables.flushS);
        expect(await number(page, 'steam-flow-value'), 'and its steam flow').toBe(other.dashboardVariables.steamFlowMls);
        expect(records(fake), 'neither record took the steps, nor any other').toEqual(recordsBefore);

        // The two steps were written before the load's own Workflow write.
        const workflowWrites = cafe.since(mark, isWorkflowWrite).map(entry => entry.body);
        const loadAt = workflowWrites.findIndex(body => body.context?.extras?.dye?.recipeId === other.id || body.context?.coffeeName === longBlack.bean);
        expect(loadAt, 'the load wrote the Workflow').toBeGreaterThan(-1);
        const beforeLoad = workflowWrites.slice(0, loadAt);
        expect(beforeLoad.some(body => body.steamSettings?.flow === flowStepped), 'the steam step written before the load').toBe(true);
        expect(beforeLoad.some(body => body.rinseData?.duration === flushStepped), 'the flush step written before the load').toBe(true);
        expect(workflowWrites.slice(loadAt + 1).filter(body => body.steamSettings || body.rinseData), 'no step written after the load').toEqual([]);

        const markBack = fake.log.length;
        await card(page, single.slot).click();
        await expect(page.locator('#cafe-title')).toHaveText(single.name);
        await cafe.advance(PAST_DYE2_MS);
        expect(loadedId(fake), 'the first recipe is loaded again').toBe(first.id);
        expect(await number(page, 'dose-in-value'), 'with its own dose').toBe(first.dashboardVariables.dose);
        expect(await number(page, 'flush-value'), 'and its own flush').toBe(first.dashboardVariables.flushS);
        expect(await number(page, 'steam-flow-value'), 'and its own steam flow').toBe(first.dashboardVariables.steamFlowMls);
        const back = fake.workflow();
        expect([back.context.targetDoseWeight, back.rinseData.duration, back.steamSettings.flow], 'the Workflow holds the record\'s dose, flush and steam flow')
            .toEqual([first.dashboardVariables.dose, first.dashboardVariables.flushS, first.dashboardVariables.steamFlowMls]);
        expect(records(fake), 'and still no record changed').toEqual(recordsBefore);
        expect(writes(cafe.since(markBack).filter(isDye2Write)), 'nothing written to DYE2 but the selection the load makes').toEqual([{ write: 'POST /api/v1/plugins/dye2.reaplugin/selection', body: { kind: 'recipe', id: first.id } }]);
    });
});
