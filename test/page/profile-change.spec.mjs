// The profile changed with the recipe kept loaded (docs/cafe/DESIGN.md,
// "Changing the profile"; once step 25 of the smoke run, #50): a loaded
// recipe's DYE2 record takes the profile first, then the Workflow, and the
// recipe stays loaded, at once, after DYE2's window, through a temperature
// step, a load of another recipe and back, a shot and DYE2 starting again;
// straight after a dial-in step and with DYE2 saving around the change; with
// the record written back over the change in DYE2's window, before or after
// the Workflow write; a recipe DYE2 named takes the new profile's name and one
// named by hand keeps its own; and with no recipe loaded no record changes.
// The tests call `changeProfile` from the page, as the profile dialog does
// (src/cafe/profile-changer.js).
//
// The DYE2 behaviour they rely on is recorded from the pinned stack: DYE2
// clearing a recipe whose Workflow moves off both the profile it noted at the
// load and the record's (fake-decaid/recordings/dye2-selection.json), its
// save-recipe and the name it gives (dye2-save-recipe.json), and DYE2 started
// again keeping the recipe loaded (dye2-restart.json). DYE2's `record`, which
// reads the recipes list, waits and writes it back whole, is an event the test
// makes happen: `fake.dye2RecordReads()` reads, the function it answers writes
// back (fake-decaid/dye2.js).

import { test, expect } from './support/test.mjs';
import { recording } from './support/adapter.mjs';
import { pickDialog, pickClosed, tapAt } from './support/page-reads.mjs';
import { RECIPES } from '../cafe-smoke/sample-data.mjs';
import { AFTER_CHECK_MS } from '../../src/cafe/profile-change.js';

const [house, single] = RECIPES;
const DYE2 = '/api/v1/plugins/dye2.reaplugin';
const RECORDS = '/api/v1/store/dye2.reaplugin/recipes';
const WORKFLOW_URL = 'http://127.0.0.1:8080/api/v1/workflow';

// Decaid's profiles, as the page reads them.
const PROFILES = recording('boot').requests['GET /api/v1/profiles?includeHidden=true'].body;
const byTitle = title => PROFILES.find(entry => entry.profile?.title === title);
// Three of Decaid's profiles, each with a temperature of its own and none the Default's 90 °C.
const light = byTitle('Best practice (light roast)');
const gentle = byTitle('Gentle and sweet');
const bloom = byTitle('Easy blooming - active pressure decline');
const adaptive = byTitle('Adaptive v3');
const own = record => record.profile.steps[0].temperature;

const records = fake => fake.store.get('dye2.reaplugin', 'recipes') || [];
const recordNamed = (fake, name) => records(fake).find(row => row && row.name === name);
const loadedId = fake => { const selection = fake.selection(); return selection?.kind === 'recipe' ? selection.id : null; };
const card = (page, slot) => page.locator('#cafe-strip .cafe-card').nth(slot - 1);
const isRecordWrite = entry => entry.method === 'POST' && entry.path === RECORDS;
const isWorkflowWrite = entry => entry.method === 'PUT' && entry.path === '/api/v1/workflow';

// The simulated machine's Workflow reports a flush at 90 °C, and the sample
// recipes hold 25 °C, so DYE2 calls a recipe changed the moment it loads. The
// recipe's record is given the steam, hot water and flush the Workflow holds
// (the smoke run's `matchMachine`), so that "not called changed" after a
// profile change says something.
const MACHINE_FIELDS = { steamTempC: ['steamSettings', 'targetTemperature'], steamTimeS: ['steamSettings', 'duration'], steamFlowMls: ['steamSettings', 'flow'], steamStopAtTempC: ['steamSettings', 'stopAtTemperature'], hotWaterTempC: ['hotWaterData', 'targetTemperature'], hotWaterTimeS: ['hotWaterData', 'duration'], hotWaterMl: ['hotWaterData', 'volume'], hotWaterFlowMls: ['hotWaterData', 'flow'], flushTempC: ['rinseData', 'targetTemperature'], flushS: ['rinseData', 'duration'], flushFlowMls: ['rinseData', 'flow'] };
function matchMachine(fake, name) {
    const machine = fake.workflow();
    fake.store.set('dye2.reaplugin', 'recipes', records(fake).map(row => {
        if (!row || row.name !== name) return row;
        const dashboardVariables = { ...row.dashboardVariables };
        for (const [key, [group, field]] of Object.entries(MACHINE_FIELDS)) {
            if (dashboardVariables[key] != null && machine[group]?.[field] != null) dashboardVariables[key] = machine[group][field];
        }
        return { ...row, dashboardVariables };
    }));
}

/**
 * The function the profile dialog calls, called from the page itself: its
 * answer, with the check afterwards kept in the page, its outcome noted on
 * `window.__cafeOutcome` once it has one.
 */
const changeProfile = (page, profileId) => page.evaluate(async id => {
    const { changeProfile: change } = await import('/src/cafe/profile-changer.js');
    const { checked, ...answer } = await change(id);
    window.__cafeOutcome = undefined;
    if (checked) checked.then(outcome => { window.__cafeOutcome = outcome; });
    return { ...answer, checked: checked ? 'pending' : null };
}, profileId);

/** Past DYE2's window, and the check's outcome. */
async function checkedAfter(cafe) {
    await cafe.advance(AFTER_CHECK_MS + 500);
    await expect.poll(() => cafe.page.evaluate(() => window.__cafeOutcome ?? null)).not.toBeNull();
    return cafe.page.evaluate(() => window.__cafeOutcome);
}

async function load(cafe, recipe) {
    const { page } = cafe;
    await card(page, recipe.slot).click();
    await expect(page.locator('#cafe-title')).toHaveText(recipe.name);
    await expect(card(page, recipe.slot)).toHaveAttribute('aria-pressed', 'true');
    await cafe.advance(2000);
}

/** The page open with the first recipe loaded afresh, as stored, and not called changed. */
async function openLoaded(cafe) {
    matchMachine(cafe.fake, house.name);
    await cafe.open();
    await load(cafe, house);
    const before = recordNamed(cafe.fake, house.name);
    expect(cafe.fake.selection(), 'the recipe is loaded before the change, and not as changed').toEqual({ kind: 'recipe', id: before.id, modified: false });
    return before;
}

const brewRow = async page => ({ name: (await page.locator('#profile-name').textContent()).trim(), temp: parseFloat(await page.locator('#temp-value').textContent()) });
const dialIn = wf => ({ dose: wf.context.targetDoseWeight, yield: wf.context.targetYield, grind: wf.context.grinderSetting });

// The page looks again, as when it comes back into view.
async function lookAgain(cafe) {
    await cafe.page.evaluate(() => document.dispatchEvent(new Event('streamline:mainpagevisible')));
    await cafe.advance(1500);
}

/** A press held on a card until the page opens its menu. */
async function openMenu(cafe, slot) {
    const box = await card(cafe.page, slot).boundingBox();
    await cafe.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await cafe.page.mouse.down();
    await cafe.advance(1000);
    await cafe.page.mouse.up();
    await expect(cafe.page.locator('#app-context-menu.context-menu--open')).toBeVisible();
}

test.describe('the profile changed with the recipe kept loaded', { tag: '@profile' }, () => {
    test('Decaid holds the three profiles the tests use, each at a temperature of its own', () => {
        expect([light, gentle, bloom].every(Boolean)).toBe(true);
        expect(new Set([90, own(light), own(gentle)]).size).toBe(3);
        expect(own(bloom)).not.toBe(90);
    });

    test('the record takes the profile first, then the Workflow, and the recipe stays loaded', async ({ cafe, fake }) => {
        const before = await openLoaded(cafe);
        const page = cafe.page;
        const othersBefore = records(fake).filter(row => row && row.id !== before.id);
        const workflowBefore = fake.workflow();
        await cafe.screenshot('profile-before-1920x1200-light');
        const mark = fake.log.length;

        const answer = await changeProfile(page, light.id);
        expect(answer, 'ok, on the loaded recipe, and keeping its name').toEqual({ ok: true, recipeId: String(before.id), name: null, checked: 'pending' });
        expect(fake.selection(), 'at once DYE2 still names the recipe, and not as changed').toEqual({ kind: 'recipe', id: before.id, modified: false });

        const after = recordNamed(fake, house.name);
        const stored = { ...light.profile, target_weight: house.yield };
        expect(after.profileId, 'the record names the profile by its id').toBe(light.id);
        expect(after.profileTitle, 'and its title').toBe(light.profile.title);
        expect(after.profileSnapshot, 'with its snapshot, stopping at the recipe\'s yield').toEqual(stored);
        expect(after.workflow.profile, 'and in its stored Workflow').toEqual(stored);
        expect(after.dashboardVariables.brewC, 'the recipe\'s brew temperature is the profile\'s own').toBe(own(light));
        const unchanged = row => { const { profileId, profileTitle, profileSnapshot, workflow, dashboardVariables, ...rest } = row; return { rest, context: workflow?.context, dv: { ...dashboardVariables, brewC: null } }; };
        expect(unchanged(after), 'every other field of the record, its stored Workflow\'s context among them, is as it was').toEqual(unchanged(before));
        expect(records(fake).filter(row => row && row.id !== before.id), 'the other records are untouched').toEqual(othersBefore);

        const workflow = fake.workflow();
        expect(workflow.profile.title, 'the Workflow has the profile').toBe(light.profile.title);
        expect(workflow.profile.target_weight, 'stopping at the yield').toBe(house.yield);
        expect(workflow.profile.steps[0].temperature, 'at its own temperature').toBe(own(light));
        expect(dialIn(workflow), 'dose, yield and grind are as they were').toEqual(dialIn(workflowBefore));

        const since = cafe.since(mark);
        const order = since.filter(entry => isRecordWrite(entry) || isWorkflowWrite(entry)).map(entry => `${entry.method} ${entry.path}`);
        expect(order, 'one record write, then one Workflow write').toEqual([`POST ${RECORDS}`, 'PUT /api/v1/workflow']);
        const sent = since.filter(isWorkflowWrite)[0].body;
        expect(Object.keys(sent), 'the Workflow write sends the profile alone, no recipe id').toEqual(['profile']);
        expect([sent.profile.title, sent.profile.target_weight]).toEqual([light.profile.title, house.yield]);
        expect(since.filter(entry => entry.method !== 'GET' && /^\/api\/v1\/plugins\/dye2\.reaplugin\/(record|save-recipe|selection)$/.test(entry.path)), 'nothing asked of DYE2\'s save or selection').toEqual([]);

        await cafe.advance(1000);
        expect(await brewRow(page), 'the Brew row names the profile, at its own temperature').toEqual({ name: light.profile.title, temp: own(light) });
        await expect(page.locator('#dose-in-value'), 'the dose as it was').toHaveText(`${house.dose}g`);
        await expect(page.locator('#drink-out-value'), 'the yield as it was').toHaveText(`${house.yield}g`);
        await expect(page.locator('#cafe-title'), 'the title band still names the recipe').toHaveText(house.name);
        await cafe.screenshot('profile-after-1920x1200-light');

        expect(await checkedAfter(cafe), 'after DYE2\'s window the check finds the record holding the profile').toBe('held');
        expect(loadedId(fake), 'and the recipe still loaded').toBe(before.id);
        expect(recordNamed(fake, house.name).profileId).toBe(light.id);
    });
    test('a tap on the Brew row\'s name opens the profile dialog on the profile just chosen, in use', async ({ cafe }) => {
        await openLoaded(cafe);
        const page = cafe.page;
        await changeProfile(page, light.id);
        await cafe.advance(1000);
        const url = page.url();
        await tapAt(page, '#profile-name');
        await expect(pickDialog(page)).toBeVisible();
        await expect(page.locator('#cafe-pick-pane-title')).toHaveText(light.profile.title);
        await expect(page.locator('#cafe-pick-pane-in-use'), 'in use').toBeVisible();
        expect(page.url(), 'nothing of Streamline\'s').toBe(url);
        await page.locator('#cafe-pick-dialog .cafe-pick-head .cafe-btn').click();
        await expect(pickClosed(page)).toBeAttached();
    });

    test('a temperature step afterwards keeps the recipe loaded', async ({ cafe, fake }) => {
        const before = await openLoaded(cafe);
        const page = cafe.page;
        await changeProfile(page, light.id);
        await cafe.advance(1000);
        const mark = fake.log.length;
        await page.locator('#temp-plus').click();
        await cafe.advance(3000);
        expect(cafe.since(mark, isWorkflowWrite), 'one Workflow write').toHaveLength(1);
        expect(loadedId(fake), 'the recipe still loaded').toBe(before.id);
    });

    test('another recipe loaded, then this one, brings the profile back at the temperature the change wrote', async ({ cafe, fake }) => {
        const before = await openLoaded(cafe);
        await changeProfile(cafe.page, light.id);
        await cafe.advance(1000);
        await load(cafe, single);
        await load(cafe, house);
        const again = fake.workflow();
        expect(loadedId(fake)).toBe(before.id);
        expect(again.profile.title).toBe(light.profile.title);
        expect(again.profile.steps[0].temperature).toBe(own(light));
        expect(await brewRow(cafe.page)).toEqual({ name: light.profile.title, temp: own(light) });
    });

    test('a shot pulled afterwards names the recipe and the profile', async ({ cafe, fake }) => {
        const before = await openLoaded(cafe);
        await changeProfile(cafe.page, light.id);
        await cafe.advance(1000);
        await cafe.pour();
        await cafe.untilStored();
        const id = await cafe.storeShot();
        const shot = fake.shots.get(id);
        expect(shot.workflow.context.extras.dye.recipeId, 'the recipe').toBe(before.id);
        expect(shot.workflow.profile.title, 'and the profile').toBe(light.profile.title);
    });

    test('DYE2 started again keeps the recipe loaded, and a page opened afresh shows it on the profile', async ({ cafe, fake }) => {
        const before = await openLoaded(cafe);
        await changeProfile(cafe.page, light.id);
        await cafe.advance(1000);
        fake.restartDye2();
        fake.flush();
        await cafe.settle();
        expect(loadedId(fake), 'DYE2 started again keeps the recipe loaded').toBe(before.id);
        const fresh = await cafe.another();
        await expect(card(fresh, house.slot)).toHaveAttribute('aria-pressed', 'true');
        await expect(fresh.locator('#profile-name')).toHaveText(light.profile.title);
        await fresh.close();
    });

    test('straight after a dial-in step the change waits for the step\'s write, and the recipe stays loaded', async ({ cafe, fake }) => {
        const before = await openLoaded(cafe);
        const page = cafe.page;
        const dose = parseFloat(await page.locator('#dose-in-value').textContent());
        await page.locator('#dose-in-plus').click();
        const stepped = await changeProfile(page, gentle.id);
        expect(stepped.ok).toBe(true);
        const workflow = fake.workflow();
        expect(loadedId(fake), 'the recipe still loaded').toBe(before.id);
        expect(workflow.profile.title).toBe(gentle.profile.title);
        expect(workflow.context.targetDoseWeight, 'with the step on the machine').toBeGreaterThan(dose);
        // With no DYE2 save in the window, no write is lost.
        expect(await checkedAfter(cafe)).toBe('held');
        expect(recordNamed(fake, house.name).profileId, 'the record holds the profile').toBe(gentle.id);
        expect(loadedId(fake), 'and the recipe is loaded').toBe(before.id);
    });

    // The smoke run raced two `POST record`s, Decent Sync's plugin's ask of
    // DYE2, with the change. The page never sends one, and the fake has no
    // answer for it; what the check was for is the change surviving DYE2 saves
    // around it. One read the list before the change and writes it back as the
    // page's record write is on its way, which that write then replaces. The
    // other reads the list while the change runs, after the record write, and
    // writes it back after the change, which loses nothing. A save written
    // back after the record write and before the Workflow's is the drop below;
    // one written back after the change, the rewrite.
    test('with DYE2 saving around it, the change keeps the recipe loaded', async ({ cafe, fake }) => {
        const before = await openLoaded(cafe);
        const page = cafe.page;
        const early = fake.dye2RecordReads();
        let late = null;
        let earlyArmed = true;
        let lateArmed = true;
        await page.context().route(`http://127.0.0.1:8080${RECORDS}`, async route => {
            if (route.request().method() === 'POST' && earlyArmed) { earlyArmed = false; early(); }
            await route.fallback();
        });
        await page.context().route(WORKFLOW_URL, async route => {
            if (route.request().method() === 'PUT' && lateArmed) { lateArmed = false; late = fake.dye2RecordReads(); }
            await route.fallback();
        });
        const raced = await changeProfile(page, bloom.id);
        expect(raced).toMatchObject({ ok: true });
        expect(earlyArmed, 'the first save wrote back as the record write was on its way').toBe(false);
        expect(late, 'the second save read the list while the change ran').not.toBeNull();
        late();
        fake.flush();
        await cafe.settle();
        expect(loadedId(fake), 'the recipe still loaded').toBe(before.id);
        expect(await checkedAfter(cafe)).toBe('held');
        expect(recordNamed(fake, house.name).profileId, 'the record holds the profile').toBe(bloom.id);
        expect(loadedId(fake), 'and the recipe is loaded').toBe(before.id);
    });

    // A save written back between the page's record write and its confirming
    // read: the writer finds its write lost and makes it again
    // (src/cafe/recipe-write.js). The second POST fails in Chromium ("Failed
    // to fetch"): setKVValue sends with `keepalive`, whose bodies in flight
    // may not pass 64 KiB, and the sample list is 33 KB, so the change answers
    // `unconfirmed`.
    test.fixme('a save written back before the record write is confirmed: the writer writes it again', async ({ cafe, fake }) => {
        const before = await openLoaded(cafe);
        const page = cafe.page;
        const writeBack = fake.dye2RecordReads();
        let recordWritten = false;
        let armed = true;
        await page.context().route(`http://127.0.0.1:8080${RECORDS}`, async route => {
            const method = route.request().method();
            if (method === 'POST') recordWritten = true;
            else if (method === 'GET' && recordWritten && armed) { armed = false; writeBack(); }
            await route.fallback();
        });
        const mark = fake.log.length;
        const answer = await changeProfile(page, bloom.id);
        expect(armed, 'written back before the confirming read').toBe(false);
        expect(answer).toMatchObject({ ok: true });
        expect(cafe.since(mark, isRecordWrite), 'the record write made again').toHaveLength(2);
        expect(loadedId(fake)).toBe(before.id);
        expect(await checkedAfter(cafe)).toBe('held');
        expect(recordNamed(fake, house.name).profileId).toBe(bloom.id);
    });

    test('a record written back over the change in DYE2\'s window is written again by the check', async ({ cafe, fake }) => {
        const before = await openLoaded(cafe);
        const writeBack = fake.dye2RecordReads();
        await changeProfile(cafe.page, light.id);
        writeBack();
        expect(recordNamed(fake, house.name).profileId, 'the change lost').not.toBe(light.id);
        expect(await checkedAfter(cafe)).toBe('rewritten');
        expect(recordNamed(fake, house.name).profileId).toBe(light.id);
        expect(loadedId(fake)).toBe(before.id);
    });

    // The smoke run wrote the record back after the change and then unloaded
    // the recipe itself (`POST selection {}`), as DYE2 does when it hears the
    // Workflow before the record. Here the write-back lands between the
    // page's record write and its Workflow write, and DYE2's own rule drops
    // the recipe when the Workflow moves off both profiles.
    test('written back before the Workflow write, DYE2 drops the recipe: the check writes the record again and loads the recipe once', async ({ cafe, fake }) => {
        const before = await openLoaded(cafe);
        const page = cafe.page;
        const writeBack = fake.dye2RecordReads();
        let armed = true;
        await page.context().route(WORKFLOW_URL, async route => {
            if (route.request().method() === 'PUT' && armed) { armed = false; writeBack(); }
            await route.fallback();
        });
        const answer = await changeProfile(page, gentle.id);
        expect(armed, 'the record was written back before the Workflow write').toBe(false);
        expect(answer.ok, 'the change does not see the drop').toBe(true);
        expect(loadedId(fake), 'DYE2 dropped the recipe').toBeNull();
        await expect(page.locator('#cafe-title')).toHaveText('No recipe selected');
        const mark = fake.log.length;
        expect(await checkedAfter(cafe)).toBe('reloaded');
        expect(recordNamed(fake, house.name).profileId).toBe(gentle.id);
        expect(loadedId(fake)).toBe(before.id);
        expect(fake.workflow().profile.title).toBe(gentle.profile.title);
        expect(cafe.since(mark, entry => entry.method === 'POST' && entry.path === `${DYE2}/selection`), 'loaded once').toHaveLength(1);
        await cafe.advance(1500);
        await expect(card(page, house.slot), 'the page shows the recipe loaded again').toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#cafe-title')).toHaveText(house.name);
    });

    test('a recipe unloaded by a tap since the change is not loaded again, though the record is written again', async ({ cafe, fake }) => {
        await openLoaded(cafe);
        const page = cafe.page;
        const writeBack = fake.dye2RecordReads();
        await changeProfile(page, bloom.id);
        writeBack();
        await card(page, house.slot).click();
        await expect(page.locator('#cafe-title')).toHaveText('No recipe selected');
        expect(await checkedAfter(cafe)).toBe('tapped');
        expect(loadedId(fake)).toBeNull();
        expect(recordNamed(fake, house.name).profileId).toBe(bloom.id);
    });

    /** A recipe DYE2 made from a Workflow on Adaptive v3, in slot 4, which DYE2 marks as loaded. */
    async function dye2Named(cafe) {
        const { fake } = cafe;
        fake.request({ method: 'PUT', url: '/api/v1/workflow', body: { profile: adaptive.profile, context: { coffeeName: house.bean } } });
        const made = fake.request({ method: 'POST', url: `${DYE2}/save-recipe`, body: { slot: 4 } }).body;
        fake.flush();
        await cafe.settle();
        await lookAgain(cafe);
        expect(made.name, 'DYE2 named the recipe it made from the profile and the bean').toBe(`Adaptive ${house.bean}`);
        expect(loadedId(fake)).toBe(made.id);
        await expect(cafe.page.locator('#cafe-title')).toHaveText(made.name);
        return made;
    }

    test('a recipe DYE2 named takes the name DYE2 gives on the new profile, and one named by hand keeps its own', async ({ cafe, fake }) => {
        const page = await cafe.open();
        const made = await dye2Named(cafe);
        const renamed = await changeProfile(page, light.id);
        const name = `Best ${house.bean}`;
        expect(renamed).toMatchObject({ ok: true, name });
        const madeAfter = records(fake).find(row => row && row.id === made.id);
        expect(madeAfter, 'the new name and the profile, in the same write').toMatchObject({ name, title: name, profileId: light.id });
        await lookAgain(cafe);
        await expect(card(page, 4).locator('.cafe-card-name'), 'its card shows the new name').toHaveText(name);
        await expect(page.locator('#cafe-title'), 'and the title band').toHaveText(name);
        await cafe.screenshot('profile-renamed-1920x1200-light');
        expect(await checkedAfter(cafe), 'the renamed recipe stays loaded through DYE2\'s window').toBe('held');
        expect(loadedId(fake)).toBe(made.id);
        expect(recordNamed(fake, house.name)?.name, 'the recipe named by hand kept its own').toBe(house.name);
    });

    test('the list of recipes to choose from names the recipe\'s new profile', async ({ cafe }) => {
        const page = await cafe.open();
        await dye2Named(cafe);
        await changeProfile(page, light.id);
        await lookAgain(cafe);
        const menu = page.locator('#app-context-menu.context-menu--open .context-menu__item');
        await openMenu(cafe, 4);
        await menu.filter({ hasText: 'Remove from slot' }).click();
        await cafe.advance(1500);
        await expect(card(page, 4).locator('.cafe-card-name')).toHaveText('Slot 4');
        await openMenu(cafe, 4);
        await menu.filter({ hasText: 'Choose a recipe…' }).click();
        await expect(page.locator('#cafe-recipe-dialog[open]')).toBeVisible();
        const listed = await page.locator('#cafe-recipe-list .cafe-recipe-row').evaluateAll(rows => rows.map(row => `${row.querySelector('.cafe-recipe-row-name').textContent} | ${row.querySelector('.cafe-recipe-row-detail').textContent}`));
        expect(listed).toContain(`Best ${house.bean} | ${house.bean} · ${light.profile.title}`);
        await page.keyboard.press('Escape');
        await cafe.advance(1000);
    });

    test('with no recipe loaded the profile changes, and no record changes', async ({ cafe, fake }) => {
        const page = await cafe.open();
        await expect(page.locator('#cafe-title')).toHaveText('No recipe selected');
        const recordsBefore = records(fake);
        const mark = fake.log.length;
        const loose = await changeProfile(page, gentle.id);
        expect(loose, 'no recipe, and no check').toEqual({ ok: true, recipeId: null, name: null, checked: null });
        await cafe.advance(1500);
        expect(fake.workflow().profile.title).toBe(gentle.profile.title);
        expect(records(fake), 'no record changes').toEqual(recordsBefore);
        expect(cafe.since(mark, entry => entry.method === 'POST' && entry.path.startsWith('/api/v1/store/dye2.reaplugin/')), 'nothing written to DYE2\'s store').toEqual([]);
        expect(await brewRow(page), 'the Brew row follows').toMatchObject({ name: gentle.profile.title });
    });
});
