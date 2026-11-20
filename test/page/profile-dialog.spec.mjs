// The profile dialog (docs/cafe/DESIGN.md, "The profile dialog"; once step 27
// of the smoke run, #51): a tap on the Brew row's name, or on the profile's
// under it, lists the profiles Decaid shows, sorted by title, and opens on the
// profile in use with its description; a tap on another row highlights it and
// writes nothing, nor does Close or a tap outside; "Use this profile" makes
// #50's change (src/cafe/profile-changer.js), with a recipe loaded, which stays
// loaded, and with none, which changes this machine only. A change refused, a
// list that can't be read, a recipe load and a shot each keep it from opening
// or close it. A hidden profile is not listed, and one in use still opens with
// its description. It is checked at 1340 by 800 too.
//
// What is already page-tested elsewhere is not tested again here: the change
// itself, field by field, in profile-change.spec.mjs (called as the dialog
// calls it); each of the dialog's parts measured at the three tablet sizes in
// dialog-sizes.spec.mjs ("the profile dialog"); and the list and its line on a
// Machine Decent Sync serves in sync-picks.spec.mjs.
//
// Decaid's profiles are the recorded boot's answer to
// `GET /api/v1/profiles?includeHidden=true` (fake-decaid/boot.js): the fake
// keeps no profile state, and has no answer for Decaid's
// `PUT /profiles/{id}/visibility`. A profile hidden through that call is
// Decaid's list with that profile's `visibility` set to "hidden", which
// `fake.patchBoot` gives the next read, as the smoke run's page read it after
// the call.

import { test, expect } from './support/test.mjs';
import { pickDialog, pickClosed, tapAt, card, openPage, untilPickClosed, isWrite } from './support/page-reads.mjs';
import { records, recordOf, loadedId, isRecordWrite, matchMachine, PROFILES } from './support/fake-reads.mjs';
import { hold } from './support/faults.mjs';
import { RECIPES } from '../cafe-smoke/sample-data.mjs';
import { AFTER_CHECK_MS } from '../../src/cafe/profile-change.js';

const [house, , decaf] = RECIPES;
const PROFILES_READ = 'GET /api/v1/profiles?includeHidden=true';
const BREW_NAME = '#brew-section .cafe-row-name';
const CLOSE = '#cafe-pick-dialog .cafe-pick-head .cafe-btn';

const byTitle = title => PROFILES.find(entry => entry.profile?.title === title);
const light = byTitle('Best practice (light roast)');
const gentle = byTitle('Gentle and sweet');
const using = byTitle(house.profile);
const own = entry => entry.profile.steps[0].temperature;
const temp = entry => `${own(entry).toFixed(0)}°c`;
// What the dialog should list: every profile Decaid shows, with steps, sorted by title.
const LISTED = PROFILES.filter(entry => (entry.visibility == null || entry.visibility === 'visible') && Array.isArray(entry.profile?.steps) && entry.profile.steps.length > 0)
    .map(entry => ({ id: String(entry.id), name: entry.profile.title }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
// The profile whose notes are longest, which scroll inside the dialog.
const longest = [...PROFILES].sort((a, b) => String(b.profile?.notes || '').length - String(a.profile?.notes || '').length)[0];
const notesOf = entry => String(entry.profile.notes || '').replace(/\r\n?/g, '\n').trim() || 'This profile has no description.';

const isProfilesRead = entry => entry.method === 'GET' && entry.path === '/api/v1/profiles';
const isWorkflowWrite = entry => entry.method === 'PUT' && entry.path === '/api/v1/workflow';
// A write of the Workflow, of DYE2's records or selection, or of a profile.
const isChange = entry => isWrite(entry) && (entry.path === '/api/v1/workflow' || entry.path.startsWith('/api/v1/plugins/dye2.reaplugin/')
    || entry.path.startsWith('/api/v1/store/dye2.reaplugin/') || entry.path.startsWith('/api/v1/profiles'));

// What the dialog shows: its title and line, the list on the left, and the
// description on the right (as the smoke run's `profileDialogShown`).
const shown = page => page.evaluate(() => {
    const text = id => document.getElementById(id)?.textContent ?? null;
    const visible = id => { const element = document.getElementById(id); return !!element && !element.hidden && element.offsetParent !== null; };
    const notes = document.getElementById('cafe-pick-pane-text');
    const box = document.querySelector('#cafe-pick-dialog .cafe-pick-box').getBoundingClientRect();
    return {
        title: text('cafe-pick-title'),
        under: text('cafe-pick-under'),
        heading: text('cafe-pick-side-heading'),
        rows: [...document.querySelectorAll('#cafe-pick-side .cafe-pick-side-row')].map(row => ({
            id: row.dataset.id,
            name: row.querySelector('.cafe-pick-row-name').textContent,
            detail: row.querySelector('.cafe-pick-row-detail').textContent,
            highlighted: row.getAttribute('aria-pressed') === 'true',
            inUse: !!row.querySelector('.cafe-pick-in-use'),
        })),
        listShown: visible('cafe-pick-list'),
        paneHeading: text('cafe-pick-pane-heading'),
        paneTitle: text('cafe-pick-pane-title'),
        byline: visible('cafe-pick-pane-byline') ? text('cafe-pick-pane-byline') : null,
        notes: notes?.textContent ?? null,
        notesHtml: notes?.innerHTML ?? null,
        notesScroll: notes ? { scroll: notes.scrollHeight, client: notes.clientHeight, overflow: getComputedStyle(notes).overflowY, whiteSpace: getComputedStyle(notes).whiteSpace } : null,
        inUse: visible('cafe-pick-pane-in-use'),
        use: visible('cafe-pick-pane-use') ? text('cafe-pick-pane-use') : null,
        useNote: visible('cafe-pick-pane-note') ? text('cafe-pick-pane-note') : null,
        box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
        window: [window.innerWidth, window.innerHeight],
    };
});

const profileRow = (page, entry) => page.locator(`#cafe-pick-side .cafe-pick-side-row[data-id="${entry.id}"]`);
const fits = ({ box, window: [width, height] }) => box.left >= 0 && box.top >= 0 && box.right <= width && box.bottom <= height;
const brewRow = async page => ({ name: (await page.locator('#profile-name').textContent()).trim(), temp: parseFloat(await page.locator('#temp-value').textContent()) });
const chartProfile = page => page.evaluate(async () => (await import('/src/modules/chart.js')).getCurrentProfile()?.title ?? null);

/** A tap on the Brew row's name (or `on`), and the dialog open with its list drawn. */
async function openDialog(cafe, on = BREW_NAME) {
    await tapAt(cafe.page, on);
    await expect(pickDialog(cafe.page)).toBeVisible();
    await expect(cafe.page.locator('#cafe-pick-side .cafe-pick-side-row').first()).toBeVisible();
    await cafe.settle();
}

/** A tap on a row, and its description shown. */
async function highlight(cafe, entry) {
    await profileRow(cafe.page, entry).click();
    await expect(cafe.page.locator('#cafe-pick-pane-title')).toHaveText(entry.profile.title);
    await cafe.settle();
}

/** A tap on a recipe's card, and the load settled with the card shown pressed. */
async function load(cafe, recipe) {
    const { page } = cafe;
    await card(page, recipe.slot).click();
    await expect(page.locator('#cafe-title')).toHaveText(recipe.name);
    await expect(card(page, recipe.slot)).toHaveAttribute('aria-pressed', 'true');
    await cafe.advance(2000);
}

/**
 * The page open, a tablet's numbers opening the numpad, with the first recipe
 * loaded afresh, as stored, on its own profile, and not called changed.
 */
async function openLoaded(cafe) {
    matchMachine(cafe.fake, house.name);
    const page = await openPage(cafe);
    await load(cafe, house);
    const record = recordOf(cafe.fake, house.name);
    expect(cafe.fake.selection(), 'the recipe is loaded, and not as changed').toEqual({ kind: 'recipe', id: record.id, modified: false });
    expect(record.profileTitle, 'on its own profile').toBe(using.profile.title);
    return { page, record };
}

test.describe('the profile dialog', { tag: '@profile-dialog' }, () => {
    test('Decaid holds the profiles the tests use, each at a temperature of its own', () => {
        expect([light, gentle, using, longest].every(Boolean)).toBe(true);
        expect(new Set([own(using), own(light), own(gentle)]).size).toBe(3);
        expect(longest.profile.notes, 'the longest notes have line breaks').toContain('\n');
    });

    test('a tap on the Brew value opens the numpad; one on the row\'s name or the profile\'s opens the dialog, and nothing of Streamline\'s or DYE2\'s', async ({ cafe, fake }) => {
        const { page } = await openLoaded(cafe);
        const url = page.url();
        const mark = fake.log.length;

        await page.locator('#temp-value').click();
        await expect(page.locator('#numpad-modal-overlay'), 'the value opens the numpad').toBeVisible();
        await expect(pickDialog(page), 'and no dialog').toHaveCount(0);
        await page.locator('#numpad-cancel').click();
        await expect(page.locator('#numpad-modal-overlay')).toBeHidden();
        await cafe.settle();

        for (const on of [BREW_NAME, '#profile-name']) {
            await openDialog(cafe, on);
            await expect(page.locator('#cafe-pick-title'), `a tap on ${on} opens the profile dialog`).toHaveText('Profile');
            await page.locator(CLOSE).click();
            await untilPickClosed(cafe);
        }
        expect(page.url(), 'the page did not move').toBe(url);
        await expect(page.locator('#main-page')).toBeVisible();
        // Streamline prefetches its profile list's page at start: what is asked
        // is whether it was put on screen.
        await expect(page.locator('#profile-list'), 'Streamline\'s profile list never mounted').toHaveCount(0);
        expect(cafe.since(mark, entry => /^\/api\/v1\/plugins\/dye2\.reaplugin\/(grinder|ui)/.test(entry.path)), 'none of DYE2\'s pages asked for').toEqual([]);
        expect(cafe.since(mark, isChange), 'nothing written').toEqual([]);
    });

    test('it lists every profile Decaid shows, sorted by title, opening on the one in use with its description', async ({ cafe }) => {
        const { page } = await openLoaded(cafe);
        await openDialog(cafe);
        const now = await shown(page);
        expect(now.under, 'the line says the choice is saved to the recipe').toBe(`${house.name} · saved to the recipe`);
        expect(now.heading).toBe('Profiles');
        expect(now.rows.map(({ id, name }) => ({ id, name })), 'every profile Decaid shows, sorted by title').toEqual(LISTED);
        expect(now.rows.filter(row => row.inUse).map(row => row.id), 'the profile in use marked "In use", and no other').toEqual([String(using.id)]);
        expect(now.rows.filter(row => row.highlighted).map(row => row.id), 'and highlighted, and no other').toEqual([String(using.id)]);
        expect(now.rows.find(row => row.id === String(light.id)).detail, 'a row is the title over "By" and its author, then its own temperature').toBe(`By ${light.profile.author} · ${temp(light)}`);
        expect(now.listShown, 'the list beside is not shown').toBe(false);
        expect(now.paneHeading).toBe('Description');
        expect(now.paneTitle).toBe(using.profile.title);
        expect(now.byline, '"By" and its author, with "brews at"').toBe(`By ${using.profile.author} · brews at ${temp(using)}`);
        expect(now.notes, 'its notes').toBe(notesOf(using));
        expect({ inUse: now.inUse, use: now.use, useNote: now.useNote }, 'on the profile in use the button\'s place reads "In use"').toEqual({ inUse: true, use: null, useNote: null });
        expect(now.notesScroll.whiteSpace, 'the notes keep their line breaks').toBe('pre-line');
        await cafe.screenshot('profile-dialog-1920x1200-light');
    });

    test('a tap on another profile highlights it and describes it; long notes scroll, as plain text; nothing is written, nor by Close or a tap outside', async ({ cafe, fake }) => {
        const { page } = await openLoaded(cafe);
        const mark = fake.log.length;
        await openDialog(cafe);
        await highlight(cafe, light);
        let now = await shown(page);
        expect(now.rows.filter(row => row.highlighted).map(row => row.id), 'the row tapped highlighted, and no other').toEqual([String(light.id)]);
        expect(now.byline).toBe(`By ${light.profile.author} · brews at ${temp(light)}`);
        expect(now.notes).toBe(notesOf(light));
        expect({ inUse: now.inUse, use: now.use, useNote: now.useNote }, '"Use this profile", with "Sets Brew to" its temperature').toEqual({ inUse: false, use: 'Use this profile', useNote: `Sets Brew to ${temp(light)}` });
        expect(now.rows.filter(row => row.inUse).map(row => row.id), 'the profile in use still marked').toEqual([String(using.id)]);
        await cafe.screenshot('profile-dialog-highlighted-1920x1200-light');

        await highlight(cafe, longest);
        now = await shown(page);
        expect(now.notes, 'the longest notes, line breaks kept').toBe(notesOf(longest));
        expect(now.notes).toContain('\n');
        const escaped = now.notes.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        expect(now.notesHtml, 'as plain text, no markup').toBe(escaped);
        expect(now.notesScroll.scroll, 'long notes scroll').toBeGreaterThan(now.notesScroll.client);
        expect(now.notesScroll.overflow, 'inside the dialog').toBe('auto');
        expect(fits(now), `the dialog fits the window (${JSON.stringify(now.box)})`).toBe(true);

        await cafe.advance(3000);
        expect(cafe.since(mark, isChange), 'highlighting wrote nothing').toEqual([]);
        expect(fake.workflow().profile.title, 'the Workflow is as it was').toBe(using.profile.title);

        await page.locator(CLOSE).click();
        await untilPickClosed(cafe);
        await cafe.advance(3000);
        expect(cafe.since(mark, isChange), 'Close wrote nothing').toEqual([]);

        await openDialog(cafe);
        await highlight(cafe, light);
        await page.mouse.click(30, 30);
        await untilPickClosed(cafe);
        await cafe.advance(3000);
        expect(cafe.since(mark, isChange), 'a tap outside wrote nothing').toEqual([]);
        expect(fake.workflow().profile.title).toBe(using.profile.title);
    });

    // The change's own writes, field by field, are profile-change.spec.mjs's:
    // here the button is shown to make it, and the page to follow it.
    test('"Use this profile" closes the dialog, makes #50\'s change and the recipe stays loaded; it opens again on the profile, in use', async ({ cafe, fake }) => {
        const { page, record } = await openLoaded(cafe);
        await openDialog(cafe);
        await highlight(cafe, light);
        const mark = fake.log.length;
        await page.locator('#cafe-pick-pane-use').click();
        await untilPickClosed(cafe);
        await expect(page.locator('#profile-name')).toHaveText(light.profile.title);
        await cafe.advance(1500);

        const order = cafe.since(mark, entry => isRecordWrite(entry) || isWorkflowWrite(entry)).map(entry => `${entry.method} ${entry.path}`);
        expect(order, 'one record write, then one Workflow write').toEqual(['POST /api/v1/store/dye2.reaplugin/recipes', 'PUT /api/v1/workflow']);
        expect(cafe.since(mark, entry => isWrite(entry) && /^\/api\/v1\/plugins\/dye2\.reaplugin\/(record|save-recipe|selection)$/.test(entry.path)), 'nothing asked of DYE2\'s save or selection').toEqual([]);
        expect(fake.selection(), 'the recipe still loaded, and not as changed').toEqual({ kind: 'recipe', id: record.id, modified: false });
        expect(recordOf(fake, house.name).profileId, 'its record holds the profile').toBe(light.id);
        expect(fake.workflow().profile.title, 'and the Workflow').toBe(light.profile.title);

        expect(await brewRow(page), 'the Brew row names the profile at its own temperature').toEqual({ name: light.profile.title, temp: own(light) });
        await expect(page.locator('#dose-in-value'), 'the dial-in rows as they were').toHaveText(`${house.dose}g`);
        await expect(page.locator('#drink-out-value')).toHaveText(`${house.yield}g`);
        await expect(page.locator('#cafe-title'), 'the title band').toHaveText(house.name);
        await expect(card(page, house.slot).locator('.cafe-card-name'), 'and the card').toHaveText(house.name);
        await expect(card(page, house.slot)).toHaveAttribute('aria-pressed', 'true');
        expect(await chartProfile(page), 'the graph\'s profile is the new one').toBe(light.profile.title);
        await cafe.screenshot('profile-dialog-after-1920x1200-light');

        await cafe.advance(AFTER_CHECK_MS + 500);
        expect(loadedId(fake), 'after DYE2\'s window the recipe is still loaded').toBe(record.id);
        expect(recordOf(fake, house.name).profileId, 'and its record holds the profile').toBe(light.id);

        await openDialog(cafe);
        const again = await shown(page);
        expect(again.rows.filter(row => row.inUse).map(row => row.id), 'it opens again on the profile just chosen, in use').toEqual([String(light.id)]);
        expect([again.paneTitle, again.inUse, again.use]).toEqual([light.profile.title, true, null]);
        await page.locator(CLOSE).click();
        await untilPickClosed(cafe);
    });

    test('a change whose record write is refused is a toast, and the row and the Workflow as they were', async ({ cafe, fake }) => {
        const { page, record } = await openLoaded(cafe);
        const recordsBefore = records(fake);
        await openDialog(cafe);
        await highlight(cafe, gentle);
        const allow = fake.refuse({ method: 'POST', path: /^\/api\/v1\/store\/dye2\.reaplugin\/recipes$/, abort: true });
        await page.locator('#cafe-pick-pane-use').click();
        await expect(page.locator('#app-toast')).toBeVisible();
        await expect(page.locator('#app-toast-message')).toHaveText('Could not change the profile');
        await cafe.advance(1500);
        expect(await brewRow(page), 'the Brew row as it was').toEqual({ name: using.profile.title, temp: own(using) });
        expect(fake.workflow().profile.title, 'the Workflow as it was').toBe(using.profile.title);
        expect(records(fake), 'the records as they were').toEqual(recordsBefore);
        expect(loadedId(fake), 'the recipe still loaded').toBe(record.id);
        allow();
    });

    test('profiles that can\'t be read are a toast, and no dialog', async ({ cafe, fake }) => {
        const { page } = await openLoaded(cafe);
        const allow = fake.refuse({ method: 'GET', path: /^\/api\/v1\/profiles(\?|$)/, abort: true });
        await tapAt(page, BREW_NAME);
        await expect(page.locator('#app-toast')).toBeVisible();
        await expect(page.locator('#app-toast-message')).toHaveText('Could not read the profiles');
        await cafe.advance(1000);
        await expect(pickDialog(page)).toHaveCount(0);
        allow();
    });

    test('a tap while a recipe loads opens nothing', async ({ cafe, fake }) => {
        const { page } = await openLoaded(cafe);
        // The load held at its Workflow write, so the tap lands during it.
        const slow = hold(cafe, { method: 'PUT', path: /^\/api\/v1\/workflow$/ });
        await card(page, decaf.slot).click();
        await slow.reached;
        await expect(page.locator('#main-page.cafe-loading'), 'a recipe is loading').toBeAttached();
        const mark = fake.log.length;
        await tapAt(page, BREW_NAME);
        await page.evaluate(() => 0);
        expect(cafe.since(mark, isProfilesRead), 'the tap read no profiles').toEqual([]);
        await expect(pickDialog(page)).toHaveCount(0);
        slow.release();
        await expect(page.locator('#cafe-title')).toHaveText(decaf.name);
        await cafe.advance(2000);
        await expect(pickDialog(page), 'nor after the load').toHaveCount(0);
    });

    test('a shot that starts closes the dialog, and a tap during the shot opens nothing', async ({ cafe, fake }) => {
        const { page } = await openLoaded(cafe);
        await openDialog(cafe);
        const mark = fake.log.length;
        // To the machine's first frame in espresso.
        await cafe.pour(fake.machine.pourMoment((frame, socket) => socket === 'machine/snapshot' && frame.state?.state === 'espresso'));
        await expect(page.locator('#main-page.cafe-shot-live')).toBeAttached();
        await untilPickClosed(cafe);
        await tapAt(page, BREW_NAME);
        await cafe.pour(3000);
        await expect(pickDialog(page), 'a tap during the shot opens nothing').toHaveCount(0);
        expect(cafe.since(mark, isProfilesRead), 'nor reads the profiles').toEqual([]);
        expect(cafe.since(mark, isChange), 'nothing written').toEqual([]);
    });

    // Hidden as Decaid's `PUT /profiles/{id}/visibility` leaves it (above), and
    // put in the Workflow, with no recipe loaded.
    test('with no recipe loaded and a hidden profile in use: "changes this machine only", the profile not listed and described in use; a choice changes the Workflow and no record', async ({ cafe, fake }) => {
        fake.patchBoot(PROFILES_READ, list => list.map(entry => (entry.id === gentle.id ? { ...entry, visibility: 'hidden' } : entry)));
        fake.request({ method: 'PUT', url: '/api/v1/workflow', body: { profile: gentle.profile } });
        const page = await openPage(cafe);
        await expect(page.locator('#cafe-title')).toHaveText('No recipe selected');
        expect(loadedId(fake)).toBeNull();
        await expect(page.locator('#profile-name')).toHaveText(gentle.profile.title);

        await openDialog(cafe);
        const now = await shown(page);
        expect(now.under).toBe('No recipe loaded · changes this machine only');
        expect(now.rows.map(row => row.id), 'the hidden profile is not listed').not.toContain(String(gentle.id));
        expect(now.rows.map(({ id, name }) => ({ id, name })), 'every other is').toEqual(LISTED.filter(row => row.id !== String(gentle.id)));
        expect([now.paneTitle, now.inUse, now.use], 'its description, "In use"').toEqual([gentle.profile.title, true, null]);
        expect(now.byline).toBe(`By ${gentle.profile.author} · brews at ${temp(gentle)}`);
        expect(now.rows.filter(row => row.highlighted || row.inUse), 'and no row highlighted or in use').toEqual([]);
        await cafe.screenshot('profile-dialog-hidden-in-use-1920x1200-light');

        const recordsBefore = records(fake);
        await highlight(cafe, light);
        const mark = fake.log.length;
        await page.locator('#cafe-pick-pane-use').click();
        await untilPickClosed(cafe);
        await expect(page.locator('#profile-name')).toHaveText(light.profile.title);
        await cafe.advance(1500);
        expect(fake.workflow().profile.title, 'the Workflow has the profile').toBe(light.profile.title);
        expect(cafe.since(mark, isWorkflowWrite), 'in one write').toHaveLength(1);
        expect(cafe.since(mark, entry => isWrite(entry) && entry.path.startsWith('/api/v1/store/dye2.reaplugin/')), 'nothing written to DYE2\'s store').toEqual([]);
        expect(records(fake), 'no record changes').toEqual(recordsBefore);
        expect(loadedId(fake), 'no recipe is loaded').toBeNull();
        expect(await brewRow(page), 'the Brew row follows, at the profile\'s own temperature').toEqual({ name: light.profile.title, temp: own(light) });
    });
});

test.describe('the profile dialog at 1340 by 800', { tag: '@profile-dialog' }, () => {
    test.use({ viewport: { width: 1340, height: 800 } });

    test('it opens from the Brew row on the profile in use, fits inside the window, and long notes scroll inside it', async ({ cafe }) => {
        const { page } = await openLoaded(cafe);
        await openDialog(cafe);
        let now = await shown(page);
        expect(now.rows.filter(row => row.inUse && row.highlighted).map(row => row.id), 'on the profile in use').toEqual([String(using.id)]);
        expect([now.paneTitle, now.inUse]).toEqual([using.profile.title, true]);
        expect(now.window).toEqual([1340, 800]);
        expect(fits(now), `it fits inside the window (${JSON.stringify(now.box)})`).toBe(true);
        await cafe.screenshot('profile-dialog-1340x800-light');

        await highlight(cafe, longest);
        now = await shown(page);
        expect(fits(now), `with the longest notes it fits inside the window (${JSON.stringify(now.box)})`).toBe(true);
        expect(now.notesScroll.scroll, 'and they scroll inside it').toBeGreaterThan(now.notesScroll.client);
        await cafe.screenshot('profile-dialog-highlighted-1340x800-light');
        await page.locator(CLOSE).click();
        await untilPickClosed(cafe);
    });
});
