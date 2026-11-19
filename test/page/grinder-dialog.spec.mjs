// The grinder dialog (docs/cafe/DESIGN.md, "The grinder dialog"; once step 18
// of the smoke run): a tap on the Grind row's name lists the tablet's grinders,
// and a choice sets the machine to that grinder at the setting it was last used
// at, in one write of the Workflow and nothing else.
//
// The sample data (fake-decaid/recordings/sample-data.json) holds the three
// grinders and a Shot on each of the two not archived at a setting of its own.
// That Decaid's merge of the write leaves the rest of the Workflow alone, and
// that DYE2's record is unchanged by a Workflow write, are recorded scenarios
// (fake-decaid/recordings/workflow-merge.json, dye2-selection.json).

import { test, expect } from './support/test.mjs';
import { PAGE_ORIGIN } from './support/page-files.mjs';
import { recording } from './support/adapter.mjs';
import { pickDialog, pickClosed, pickRows, pickRow, tapAt, isWrite, writes, paint } from './support/page-reads.mjs';
import { GRINDER, SECOND_GRINDER, ARCHIVED_GRINDER, GRINDER_USE, RECIPES } from '../cafe-smoke/sample-data.mjs';

const [house, , decaf] = RECIPES;
const NAME = '#grind-section .cafe-row-name';
const grinderNamed = (fake, model) => fake.library.state.grinders.find(g => g.model === model);
const recordOf = (fake, name) => (fake.store.get('dye2.reaplugin', 'recipes') || []).find(row => row.name === name);

/** The page, with a tablet's numbers opening the numpad, as Streamline decides at start. */
async function openPage(cafe) {
    await cafe.open({ before: () => { window._forceNumpadMobile = true; } });
    return cafe.page;
}

/** A tap on a recipe's card, and the load through Streamline's apply settled. */
async function load(cafe, recipe) {
    const { page } = cafe;
    await page.locator('#cafe-strip .cafe-card').nth(recipe.slot - 1).click();
    await expect(page.locator('#cafe-title')).toHaveText(recipe.name);
    await cafe.advance(2000);
}

/**
 * Closed, and its close event handled, which empties its list and lets it open
 * again: a tap before that opens nothing (src/cafe/pick-dialog.js, `active`).
 */
async function closed(cafe) {
    await expect(pickClosed(cafe.page)).toBeAttached();
    await expect(cafe.page.locator('#cafe-pick-list .cafe-pick-row')).toHaveCount(0);
    await cafe.settle();
}

async function openGrinders(cafe, on = NAME) {
    await tapAt(cafe.page, on);
    await expect(pickDialog(cafe.page)).toBeVisible();
}

// Streamline's own profile overrides (src/modules/profile-overrides.js) keep the
// grind setting a Workflow write leaves, under the id Decaid's profile library
// gives the Workflow's profile.
const PROFILES = recording('boot').requests['GET /api/v1/profiles?includeHidden=true'].body;
function profileOverride(fake, grinderSetting) {
    const matches = PROFILES.filter(entry => entry.profile.title === fake.workflow().profile.title);
    expect(matches, 'one profile in Decaid\'s library has the Workflow\'s title').toHaveLength(1);
    return { write: `POST /api/v1/store/streamlineProfileOverrides/${encodeURIComponent(matches[0].id)}`, body: { grinderSetting } };
}

test.describe('the grinder dialog', { tag: '@grinder' }, () => {
    test('opens from the row\'s name, lists the tablet\'s grinders and closes writing nothing', async ({ cafe }) => {
        const page = await openPage(cafe);
        await load(cafe, house);
        const mark = cafe.fake.log.length;
        await expect(page.locator('#cafe-grind-desc')).toHaveText(GRINDER.model);

        // The value still opens the numpad.
        await page.locator('#grind-value').click();
        await expect(page.locator('#numpad-modal-overlay')).toBeVisible();
        // Past the grinders' read a dialog would wait for.
        await cafe.settle();
        await expect(pickDialog(page)).toHaveCount(0);
        await page.locator('#numpad-cancel').click();
        await expect(page.locator('#numpad-modal-overlay')).toBeHidden();

        // The row's name opens the dialog.
        await openGrinders(cafe);
        await expect(page.locator('#cafe-pick-title')).toHaveText('Grinder');
        await expect(page.locator('#cafe-pick-under')).toHaveText(`${house.name} · not saved to the recipe`);
        const rows = await pickRows(page);
        expect(rows.map(row => row.name).sort(), 'the grinders not archived, and not the archived one').toEqual([GRINDER.model, SECOND_GRINDER.model].sort());
        expect(rows.map(row => row.name)).not.toContain(ARCHIVED_GRINDER.model);
        const detail = Object.fromEntries(rows.map(row => [row.name, row.detail]));
        expect(detail[GRINDER.model]).toBe(`last used at ${GRINDER_USE.first.setting}`);
        expect(detail[SECOND_GRINDER.model]).toBe(`Conical burrs · last used at ${GRINDER_USE.second.setting}`);
        expect(rows.filter(row => row.inUse).map(row => row.name), 'only the grinder in use is marked').toEqual([GRINDER.model]);
        await expect(pickRow(page, GRINDER.model).locator('.cafe-pick-in-use')).toHaveText('In use');
        await cafe.screenshot('grinder-dialog-light');
        expect(new URL(page.url()).origin, 'the page never left for one of DYE2\'s').toBe(PAGE_ORIGIN);
        expect(cafe.since(mark, entry => /dye2\.reaplugin\/(grinder|ui)/.test(entry.path)), 'none of DYE2\'s pages').toEqual([]);

        // A tap outside closes it; the grinder's name under Grind opens it too; Close closes it.
        await page.mouse.click(40, 40);
        await closed(cafe);
        await openGrinders(cafe, '#cafe-grind-desc');
        await page.locator('#cafe-pick-dialog form[method="dialog"] .cafe-btn').click();
        await closed(cafe);

        // The grinder in use: a tap closes the dialog and writes nothing.
        await openGrinders(cafe);
        await pickRow(page, GRINDER.model).click();
        await closed(cafe);
        await cafe.advance(3000);
        expect(cafe.since(mark, isWrite), 'nothing written').toEqual([]);
    });

    test('a choice is one write of the grinder, its last setting and its RPM, and changes no recipe', async ({ cafe, fake }) => {
        const page = await openPage(cafe);
        await load(cafe, house);
        const second = grinderNamed(fake, SECOND_GRINDER.model);
        const record = recordOf(fake, house.name);
        const mark = fake.log.length;

        await openGrinders(cafe);
        await pickRow(page, SECOND_GRINDER.model).click();
        await closed(cafe);
        await expect(page.locator('#cafe-grind-desc')).toHaveText(SECOND_GRINDER.model);
        await cafe.advance(3000);
        expect(writes(cafe.since(mark)), 'one write of the Workflow, and Streamline\'s own note of the setting for the profile').toEqual([
            { write: 'PUT /api/v1/workflow', body: { context: { grinderId: second.id, grinderModel: SECOND_GRINDER.model, grinderSetting: GRINDER_USE.second.setting, extras: { rpm: GRINDER_USE.second.rpm } } } },
            profileOverride(fake, GRINDER_USE.second.setting),
        ]);
        const workflow = fake.workflow();
        expect(workflow.context).toMatchObject({ grinderId: second.id, grinderModel: SECOND_GRINDER.model, grinderSetting: GRINDER_USE.second.setting });
        expect(workflow.context.extras.rpm).toBe(GRINDER_USE.second.rpm);
        expect(workflow.context.extras.dye.recipeId, 'the recipe stays loaded').toBe(record.id);
        expect(parseFloat(await page.locator('#grind-value').textContent())).toBe(parseFloat(GRINDER_USE.second.setting));

        // + steps by the new grinder's own step.
        await page.locator('#grind-plus').click();
        expect(parseFloat(await page.locator('#grind-value').textContent())).toBe(parseFloat(GRINDER_USE.second.setting) + SECOND_GRINDER.settingSmallStep);
        await page.locator('#grind-minus').click();
        await cafe.advance(3000);

        expect(recordOf(fake, house.name), 'the recipe\'s DYE2 record').toEqual(record);
        expect(cafe.since(mark, entry => entry.method !== 'GET' && /dye2\.reaplugin/.test(entry.path)), 'nothing asked of DYE2 but reads').toEqual([]);

        // Still there after the page looks again, and on a page opened afresh.
        await page.evaluate(() => document.dispatchEvent(new Event('streamline:mainpagevisible')));
        await cafe.advance(1500);
        await expect(page.locator('#cafe-grind-desc')).toHaveText(SECOND_GRINDER.model);
        const again = await cafe.another();
        await expect(again.locator('#cafe-grind-desc')).toHaveText(SECOND_GRINDER.model);
        await again.close();
    });

    test('loading another recipe and this one again brings the recipe\'s own grinder back', async ({ cafe, fake }) => {
        const page = await openPage(cafe);
        await load(cafe, house);
        const record = recordOf(fake, house.name);
        await openGrinders(cafe);
        await pickRow(page, SECOND_GRINDER.model).click();
        await expect(page.locator('#cafe-grind-desc')).toHaveText(SECOND_GRINDER.model);
        await cafe.advance(3000);

        await load(cafe, decaf);
        await load(cafe, house);
        await expect(page.locator('#cafe-grind-desc')).toHaveText(GRINDER.model);
        const back = fake.workflow().context;
        expect(back.grinderId).toBe(grinderNamed(fake, GRINDER.model).id);
        expect(parseFloat(back.grinderSetting)).toBe(Number(record.dashboardVariables.grind));
    });

    test('grinders that can\'t be read are a toast, and no dialog', async ({ cafe, fake }) => {
        const page = await openPage(cafe);
        await load(cafe, house);
        const allow = fake.refuse({ method: 'GET', path: /^\/api\/v1\/grinders(\?|$)/, abort: true });
        await tapAt(page, NAME);
        await expect(page.locator('#app-toast')).toBeVisible();
        await expect(page.locator('#app-toast-message')).toHaveText('Could not read the grinders');
        await cafe.advance(1000);
        await expect(pickDialog(page)).toHaveCount(0);
        allow();
    });

    test('a shot that starts closes the dialog, and it does not open during one', async ({ cafe, fake }) => {
        const page = await openPage(cafe);
        await load(cafe, house);
        const mark = fake.log.length;
        await openGrinders(cafe);
        // To the machine's first frame in espresso.
        await cafe.pour(fake.machine.pourMoment((frame, socket) => socket === 'machine/snapshot' && frame.state?.state === 'espresso'));
        await closed(cafe);
        await tapAt(page, NAME);
        await cafe.pour(3000);
        await expect(pickDialog(page)).toHaveCount(0);
        expect(cafe.since(mark, isWrite), 'nothing written').toEqual([]);
    });

    // The sample data leaves the machine on the second grinder, its last shot's.
    test('with no recipe loaded, the line says the choice changes this machine only, and a choice writes the Workflow', async ({ cafe, fake }) => {
        const page = await openPage(cafe);
        await expect(page.locator('#cafe-title')).toHaveText('No recipe selected');
        await expect(page.locator('#cafe-grind-desc')).toHaveText(SECOND_GRINDER.model);
        const first = grinderNamed(fake, GRINDER.model);
        const mark = fake.log.length;
        await openGrinders(cafe);
        await expect(page.locator('#cafe-pick-under')).toHaveText('No recipe loaded · changes this machine only');
        await cafe.screenshot('grinder-dialog-no-recipe-light');
        await pickRow(page, GRINDER.model).click();
        await expect(page.locator('#cafe-grind-desc')).toHaveText(GRINDER.model);
        await cafe.advance(2000);
        expect(writes(cafe.since(mark)), 'one write of the Workflow, and Streamline\'s own note of the setting for the profile').toEqual([
            { write: 'PUT /api/v1/workflow', body: { context: { grinderId: first.id, grinderModel: GRINDER.model, grinderSetting: GRINDER_USE.first.setting, extras: { rpm: null } } } },
            profileOverride(fake, GRINDER_USE.first.setting),
        ]);
        expect(fake.workflow().context).toMatchObject({ grinderId: first.id, grinderSetting: GRINDER_USE.first.setting });
    });

    test('in the dark theme', async ({ cafe }) => {
        const page = await openPage(cafe);
        await paint(page, 'dark');
        await load(cafe, house);
        await openGrinders(cafe);
        await cafe.screenshot('grinder-dialog-dark');
    });
});
