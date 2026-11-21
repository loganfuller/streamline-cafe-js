// The barista at the machine (docs/cafe/DESIGN.md, "The barista"; #47), on a
// page at 1920 by 1200 and on one at 1340 by 800: the title band's button, its
// dialog of the names on recent Shots, "No barista" and a typed name, each one
// write of the Workflow's barista alone; a Shot that records the name; a recipe
// load that keeps it, from a record that holds another; and the machine's
// sleep, which clears it.
//
// The sample data's two Shots name no barista, so each test that lists names
// adds three older Shots that do, copies of a sample Shot (`namedShots`). That
// Decaid copies the Workflow, its barista included, into the Shot it stores is
// the recorded pour (fake-decaid/recordings/pour.json); that Decaid's merge of
// a write of one context field leaves the rest of the Workflow alone, and that
// DYE2's record is unchanged by a Workflow write, are recorded scenarios
// (fake-decaid/recordings/workflow-merge.json, dye2-selection.json). The
// machine's sleep and wake are its state on the snapshot socket
// (fake-decaid/machine.js, `setState`), as `PUT /machine/state/<state>` sets it.

import { test, expect, START } from './support/test.mjs';
import { pickDialog, pickRows, writes, paint, load, untilPickClosed } from './support/page-reads.mjs';
import { recordOf } from './support/fake-reads.mjs';
import { localTime } from '../../fake-decaid/index.js';
import { SHOT_STORE_MS } from '../../src/cafe/barista-model.js';
import { RECIPES, BARISTAS, RECIPE_BARISTA, TYPED_BARISTA, LONG_BARISTA } from './support/sample-data.mjs';

const [house, , other] = RECIPES;
const [SAMPLE, EXAMPLE] = BARISTAS;
const SIZES = [{ width: 1920, height: 1200 }, { width: 1340, height: 800 }];
const WORKFLOW = '/api/v1/workflow';

// ── Test data ────────────────────────────────────────────────────────────────

/**
 * Three Shots older than the sample data's, copies of its newest, naming
 * baristas: the newest "Example Barista", then "Sample Barista", then the same
 * barista spelled in lower case with spaces round it, which the dialog lists
 * once, under the newest spelling.
 */
function namedShots(fake) {
    const [newest] = fake.shots.newest(1);
    const sample = fake.shots.get(newest.id);
    [[EXAMPLE, 2], [SAMPLE, 3], [` ${SAMPLE.toLowerCase()} `, 4]].forEach(([name, hours], index) => {
        const at = START - hours * 3_600_000;
        fake.shots.add({
            ...sample,
            id: `00000000-0000-4000-8000-0000000b${String(index).padStart(4, '0')}`,
            timestamp: localTime(at, fake.timeZone),
            createdAt: new Date(at).toISOString(),
            updatedAt: new Date(at).toISOString(),
            workflow: { ...sample.workflow, context: { ...sample.workflow.context, baristaName: name } },
        });
    });
}
/** The names the dialog lists from `namedShots`, most recent first, then "No barista". */
const LISTED = [EXAMPLE, SAMPLE, 'No barista'];

/** The Workflow's barista set as another app or tablet sets it: through Decaid's API. */
function nameElsewhere(fake, name) {
    const answer = fake.request({ method: 'PUT', url: WORKFLOW, body: { context: { baristaName: name } } });
    expect(answer.status).toBe(200);
}

/** A recipe whose DYE2 record holds a barista, which a load must not apply. */
function recordNamesBarista(fake, recipe, name) {
    const records = fake.store.get('dye2.reaplugin', 'recipes');
    fake.store.set('dye2.reaplugin', 'recipes', records.map(row => (row.name === recipe.name
        ? { ...row, workflow: { ...row.workflow, context: { ...row.workflow.context, baristaName: name } } } : row)));
}

const named = fake => fake.workflow().context?.baristaName ?? null;

// ── On the page ──────────────────────────────────────────────────────────────

const shown = page => page.locator('#cafe-barista-name');

/** Every write of the Workflow that names or clears the barista. */
const baristaWrites = entries => writes(entries).filter(({ write, body }) => write === `PUT ${WORKFLOW}` && body?.context && 'baristaName' in body.context);

/**
 * What the button looks like: its words, whether it has the accent look, and
 * whether its name is cut short, with the accent colour to compare with.
 */
const baristaLook = page => page.evaluate(() => {
    const button = document.getElementById('cafe-barista');
    const name = document.getElementById('cafe-barista-name');
    const probe = document.createElement('span');
    probe.style.color = 'var(--mimoja-blue-v2)';
    document.body.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    const style = getComputedStyle(button);
    const box = button.getBoundingClientRect();
    const title = document.querySelector('.cafe-title-text').getBoundingClientRect();
    const status = document.getElementById('machine-status').getBoundingClientRect();
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--streamline-scale-x')) || 1;
    return {
        text: name.textContent, accent: style.borderTopColor === accent && style.color === accent, none: button.classList.contains('cafe-barista-none'),
        cut: name.scrollWidth > name.clientWidth + 1 && getComputedStyle(name).textOverflow === 'ellipsis',
        visible: box.width > 0 && style.visibility !== 'hidden' && style.display !== 'none',
        between: box.left >= title.right - 1 && box.right <= status.left + 1,
        width: box.width / scale, height: Math.round(box.height / scale), label: button.getAttribute('aria-label'),
    };
});

/** A row of the dialog by its whole name, not a part of it. */
const baristaRow = (page, name) => page.locator('#cafe-pick-list .cafe-pick-row')
    .filter({ has: page.locator('.cafe-pick-row-name', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });

async function openBaristas(cafe) {
    await cafe.page.locator('#cafe-barista').click();
    await expect(pickDialog(cafe.page)).toBeVisible();
}

/** The machine goes to sleep or wakes, as Decaid's state socket says. */
async function machineTo(cafe, state) {
    cafe.fake.machine.setState(state);
    cafe.fake.flush();
    await cafe.settle();
}

/** The soft keyboard, which no test can raise: Streamline's scaling says how much of the screen is left above one. */
const keyboard = (page, detail) => page.evaluate(d => document.dispatchEvent(new CustomEvent('streamline:scaleupdate', { detail: d })), detail);

/** The page reads the Workflow again, as after a dialog closes. */
async function refresh(cafe) {
    await cafe.page.evaluate(() => document.dispatchEvent(new Event('streamline:workflow-refresh')));
    await cafe.advance(1000);
}

test.describe('the barista at the machine', { tag: '@barista' }, () => {
    for (const viewport of SIZES) {
        const size = `${viewport.width}x${viewport.height}`;

        test.describe(size, () => {
            test.use({ viewport });

            test('with no barista and no recipe the button reads "Barista", in the accent colour, between the title and the status', async ({ cafe }) => {
                const page = await cafe.open();
                await expect(page.locator('#cafe-title')).toHaveText('No recipe selected');
                const look = await baristaLook(page);
                expect(look).toMatchObject({ visible: true, text: 'Barista', none: true, accent: true, between: true, height: 52, label: 'Barista' });
                await cafe.screenshot(`barista-none-${size}-light`);
            });

            test('the dialog lists the names on recent Shots, each once, then "No barista" in use, and the row in use writes nothing', async ({ cafe, fake }) => {
                namedShots(fake);
                const page = await cafe.open();
                await load(cafe, house);
                await openBaristas(cafe);
                await expect(page.locator('#cafe-pick-title')).toHaveText('Barista');
                await expect(page.locator('#cafe-pick-under')).toHaveText('Named on this machine\'s shots · cleared when the machine wakes');
                const rows = await pickRows(page);
                expect(rows.map(row => row.name), 'each name once, under its newest spelling, most recent first, then "No barista"').toEqual(LISTED);
                expect(rows.filter(row => row.inUse).map(row => row.name), '"No barista" alone is in use').toEqual(['No barista']);
                expect(rows.at(-1).detail).toBe('Shots record no name');
                rows.slice(0, -1).forEach(row => expect(row.detail, `${row.name}: when its last Shot was`).toMatch(/^Last shot Today \d/));
                const add = page.locator('#cafe-pick-add');
                await expect(add).toBeVisible();
                await expect(add).toHaveText('New barista', { useInnerText: true });
                await expect(page.locator('#cafe-pick-list #cafe-pick-add'), '"New barista" is set apart, under the list').toHaveCount(0);
                await cafe.screenshot(`barista-dialog-${size}-light`);

                const mark = fake.log.length;
                await baristaRow(page, 'No barista').click();
                await untilPickClosed(cafe);
                await cafe.advance(1500);
                expect(baristaWrites(cafe.since(mark)), 'a tap on the row in use writes nothing').toEqual([]);
            });

            test('a pick is one write of the name alone, and the recipe stays loaded and unchanged', async ({ cafe, fake }) => {
                namedShots(fake);
                const page = await cafe.open();
                await load(cafe, house);
                const record = recordOf(fake, house.name);
                const before = fake.selection();
                await openBaristas(cafe);
                const mark = fake.log.length;
                await baristaRow(page, SAMPLE).click();
                await untilPickClosed(cafe);
                await expect(shown(page)).toHaveText(SAMPLE);
                await expect.poll(() => named(fake)).toBe(SAMPLE);
                await cafe.advance(1500);

                expect(writes(cafe.since(mark)), 'one write of the barista\'s name, and nothing else').toEqual([{ write: `PUT ${WORKFLOW}`, body: { context: { baristaName: SAMPLE } } }]);
                const look = await baristaLook(page);
                expect(look.none, 'the button is quiet with a name').toBe(false);
                expect(look.label, 'its label names the barista for a screen reader').toBe(`Barista: ${SAMPLE}`);
                const after = fake.selection();
                expect(fake.workflow().context.extras.dye.recipeId, 'the recipe stays loaded').toBe(record.id);
                expect(after).toMatchObject({ kind: 'recipe', id: record.id });
                expect(after.modified, 'and is not marked changed').toBe(before.modified);
                await expect(page.locator('#cafe-strip .cafe-card').nth(house.slot - 1)).toHaveAttribute('aria-pressed', 'true');
                expect(recordOf(fake, house.name), 'the recipe\'s DYE2 record').toEqual(record);
                await cafe.screenshot(`barista-named-${size}-light`);
            });

            test('a Shot pulled then records the name, and with a Shot opened from the list the button stays beside "Back to latest"', async ({ cafe, fake }) => {
                nameElsewhere(fake, SAMPLE);
                // A Shot other than the latest, which the graph shows already.
                const [, older] = fake.shots.newest(2);
                const page = await cafe.open();
                await expect(shown(page)).toHaveText(SAMPLE);
                await cafe.pour();
                await cafe.untilStored();
                const id = await cafe.storeShot();
                expect(fake.shots.get(id).workflow.context.baristaName, 'the Shot names the barista').toBe(SAMPLE);
                await cafe.advance(4000);

                await page.locator('#cafe-shots-btn').click();
                await page.locator(`[data-shot-id="${older.id}"]`).click();
                await expect(page.locator('#cafe-back')).toBeVisible();
                await expect(page.locator('#cafe-barista'), 'the barista button still shown').toBeVisible();
                await expect(page.locator('#cafe-shots-dialog:not([open])')).toBeAttached();
                await cafe.settle();
                const viewing = await page.evaluate(() => {
                    const a = document.getElementById('cafe-barista').getBoundingClientRect();
                    const b = document.getElementById('cafe-back').getBoundingClientRect();
                    return { apart: a.right <= b.left + 1, bottoms: Math.abs(a.bottom - b.bottom) <= 1, heights: Math.abs(a.height - b.height) <= 1 };
                });
                expect(viewing, 'beside "Back to latest", as tall and on the same line').toEqual({ apart: true, bottoms: true, heights: true });
                await expect(shown(page)).toHaveText(SAMPLE);
                await cafe.screenshot(`barista-viewing-${size}-light`);
            });

            test('loading a recipe whose record names another barista keeps the barista', async ({ cafe, fake }) => {
                recordNamesBarista(fake, other, RECIPE_BARISTA);
                nameElsewhere(fake, SAMPLE);
                const page = await cafe.open();
                await expect(shown(page)).toHaveText(SAMPLE);
                const mark = fake.log.length;
                await load(cafe, other);
                const apply = writes(cafe.since(mark)).find(({ write, body }) => write === `PUT ${WORKFLOW}` && body?.context?.extras?.dye?.recipeId);
                expect(apply, 'the recipe\'s apply').toBeDefined();
                expect(apply.body.context, 'which leaves the barista out').not.toHaveProperty('baristaName');
                expect(named(fake)).toBe(SAMPLE);
                await expect(shown(page)).toHaveText(SAMPLE);
            });

            test('"New barista": a "Name" field with Back, and no name of nothing but spaces', async ({ cafe, fake }) => {
                namedShots(fake);
                const page = await cafe.open();
                await openBaristas(cafe);
                const mark = fake.log.length;
                await page.locator('#cafe-pick-add').click();
                await expect(page.locator('#cafe-pick-title')).toHaveText('New barista');
                await expect(page.locator('#cafe-pick-entry-text')).toBeVisible();
                await expect(page.locator('#cafe-pick-entry-text')).toBeFocused();
                await expect(page.locator('#cafe-pick-entry-label')).toHaveText('Name');
                await expect(page.locator('#cafe-pick-entry-back')).toHaveText('Back');
                await expect(page.locator('#cafe-pick-entry-use')).toHaveText('Use this name');
                await expect(page.locator('#cafe-pick-list')).toBeHidden();

                await page.locator('#cafe-pick-entry-text').fill('    ');
                await expect(page.locator('#cafe-pick-entry-use'), 'a name of nothing but spaces can\'t be used').toBeDisabled();
                await page.locator('#cafe-pick-entry-text').press('Enter');
                await cafe.advance(500);
                await expect(pickDialog(page), 'nor sent with the keyboard\'s own key').toBeVisible();
                await page.locator('#cafe-pick-entry-back').click();
                await expect(page.locator('#cafe-pick-title'), 'Back shows the list again').toHaveText('Barista');
                await expect(page.locator('#cafe-pick-list')).toBeVisible();
                expect(cafe.since(mark, entry => entry.method !== 'GET'), 'nothing written').toEqual([]);
            });

            test('a typed name is written trimmed, in one write, and the dialog fits above a keyboard', async ({ cafe, fake }) => {
                namedShots(fake);
                const page = await cafe.open();
                await openBaristas(cafe);
                await page.locator('#cafe-pick-add').click();
                await page.locator('#cafe-pick-entry-text').fill(`  ${TYPED_BARISTA}  `);
                await cafe.screenshot(`barista-name-field-${size}-light`);

                // The dialog takes what is left above the keyboard, as the note's does.
                const above = Math.round(viewport.height / 2);
                await keyboard(page, { keyboardUp: true, visibleHeight: above });
                const fitted = () => page.evaluate(() => {
                    const box = document.querySelector('#cafe-pick-dialog .cafe-pick-box').getBoundingClientRect();
                    const field = document.getElementById('cafe-pick-entry-text').getBoundingClientRect();
                    const use = document.getElementById('cafe-pick-entry-use').getBoundingClientRect();
                    // Each laid out: a box hidden measures all zeros, which would fit.
                    const shown = [box, field, use].every(r => r.width > 0 && r.height > 0);
                    return { shown, top: Math.round(box.top), bottom: Math.round(box.bottom), field: Math.round(field.bottom), use: Math.round(use.bottom) };
                });
                await expect.poll(async () => { const box = await fitted(); return box.shown && box.top >= 0 && box.bottom <= above && box.field <= above && box.use <= above; },
                    `the box, the field and "Use this name" shown inside the ${above} px above the keyboard`).toBe(true);
                await cafe.screenshot(`barista-name-field-keyboard-${size}-light`);
                await keyboard(page, { keyboardUp: false, visibleHeight: viewport.height });

                const mark = fake.log.length;
                await page.locator('#cafe-pick-entry-use').click();
                await untilPickClosed(cafe);
                await expect(shown(page)).toHaveText(TYPED_BARISTA);
                await expect.poll(() => named(fake)).toBe(TYPED_BARISTA);
                await cafe.advance(1500);
                expect(writes(cafe.since(mark)), 'one write of the name alone, trimmed').toEqual([{ write: `PUT ${WORKFLOW}`, body: { context: { baristaName: TYPED_BARISTA } } }]);
            });

            test('a name in use that no Shot carries is listed first, and a typed name that is a listed one in another case is that one', async ({ cafe, fake }) => {
                namedShots(fake);
                nameElsewhere(fake, TYPED_BARISTA);
                const page = await cafe.open();
                await expect(shown(page)).toHaveText(TYPED_BARISTA);
                await openBaristas(cafe);
                const rows = await pickRows(page);
                expect(rows[0], 'listed first, marked, with no second line').toEqual({ name: TYPED_BARISTA, detail: '', inUse: true });
                expect(rows.map(row => row.name)).toEqual([TYPED_BARISTA, ...LISTED]);

                const mark = fake.log.length;
                await page.locator('#cafe-pick-add').click();
                await page.locator('#cafe-pick-entry-text').fill(` ${SAMPLE.toUpperCase()}`);
                await page.locator('#cafe-pick-entry-text').press('Enter');
                await untilPickClosed(cafe);
                await expect.poll(() => named(fake)).toBe(SAMPLE);
                await expect(shown(page)).toHaveText(SAMPLE);
                await cafe.advance(1500);
                expect(writes(cafe.since(mark))).toEqual([{ write: `PUT ${WORKFLOW}`, body: { context: { baristaName: SAMPLE } } }]);
            });

            test('a name set elsewhere shows without a tap, a long one cut short; the dialog shows it whole; "No barista" clears it in one write', async ({ cafe, fake }) => {
                const page = await cafe.open();
                nameElsewhere(fake, LONG_BARISTA);
                await refresh(cafe);
                await expect(shown(page)).toHaveText(LONG_BARISTA);
                const look = await baristaLook(page);
                expect(look.cut, 'ended with "…"').toBe(true);
                expect(look.width, 'in no more than 320 px').toBeLessThanOrEqual(321);
                await openBaristas(cafe);
                const rows = await pickRows(page);
                expect(rows[0], 'the long name whole, in use').toMatchObject({ name: LONG_BARISTA, inUse: true });
                await page.locator('#cafe-pick-dialog .cafe-pick-head .cafe-btn').click();
                await untilPickClosed(cafe);

                const mark = fake.log.length;
                await openBaristas(cafe);
                await baristaRow(page, 'No barista').click();
                await untilPickClosed(cafe);
                await expect.poll(() => named(fake)).toBeNull();
                await expect(shown(page)).toHaveText('Barista');
                await cafe.advance(1500);
                expect(writes(cafe.since(mark)), 'one write that clears the name').toEqual([{ write: `PUT ${WORKFLOW}`, body: { context: { baristaName: null } } }]);
                expect((await baristaLook(page)).none, 'the button stands out again').toBe(true);
            });

            test('a shot that starts closes the dialog, typed text and all; during it the button opens nothing; nothing is written', async ({ cafe, fake }) => {
                nameElsewhere(fake, SAMPLE);
                const page = await cafe.open();
                const mark = fake.log.length;
                await openBaristas(cafe);
                await page.locator('#cafe-pick-add').click();
                await page.locator('#cafe-pick-entry-text').fill('Sample Half Typed');
                // To the machine's first frame in espresso.
                await cafe.pour(fake.machine.pourMoment((frame, socket) => socket === 'machine/snapshot' && frame.state?.state === 'espresso'));
                await untilPickClosed(cafe);
                await page.locator('#cafe-barista').click();
                await cafe.pour(3000);
                await expect(pickDialog(page), 'opens nothing').toHaveCount(0);
                await expect(shown(page), 'and shows the name').toHaveText(SAMPLE);
                await cafe.screenshot(`barista-live-${size}-light`);
                await cafe.pour();
                await cafe.untilStored();
                const id = await cafe.storeShot();
                await cafe.advance(SHOT_STORE_MS);
                expect(baristaWrites(cafe.since(mark)), 'nothing written for the barista').toEqual([]);
                expect(named(fake)).toBe(SAMPLE);
                expect(fake.shots.get(id).workflow.context.baristaName).toBe(SAMPLE);
            });

            test('the machine going to sleep clears a set name in one write, the wake starts with none, and a sleep with none writes nothing', async ({ cafe, fake }) => {
                nameElsewhere(fake, SAMPLE);
                const page = await cafe.open();
                await expect(shown(page)).toHaveText(SAMPLE);
                await openBaristas(cafe);
                const mark = fake.log.length;
                await machineTo(cafe, 'sleeping');
                await untilPickClosed(cafe);
                await expect.poll(() => named(fake)).toBeNull();
                await cafe.advance(1000);
                expect(baristaWrites(cafe.since(mark)), 'one write that clears it').toEqual([{ write: `PUT ${WORKFLOW}`, body: { context: { baristaName: null } } }]);

                await machineTo(cafe, 'idle');
                await cafe.advance(1000);
                await expect(shown(page)).toHaveText('Barista');
                expect(named(fake)).toBeNull();
                expect((await baristaLook(page)).none, 'after the wake the button stands out').toBe(true);

                const again = fake.log.length;
                await machineTo(cafe, 'sleeping');
                await cafe.advance(2000);
                expect(baristaWrites(cafe.since(again)), 'a sleep with no name set writes nothing').toEqual([]);
                await machineTo(cafe, 'idle');
            });

            test('put to sleep straight after a shot, the clear waits for Decaid to store the Shot, which keeps the name', async ({ cafe, fake }) => {
                nameElsewhere(fake, SAMPLE);
                await cafe.open();
                await cafe.pour();
                const mark = fake.log.length;
                await machineTo(cafe, 'sleeping');
                await cafe.untilStored();
                expect(baristaWrites(cafe.since(mark)), 'nothing cleared before the Shot is stored').toEqual([]);
                const id = await cafe.storeShot();
                expect(fake.shots.get(id).workflow.context.baristaName).toBe(SAMPLE);
                await cafe.advance(SHOT_STORE_MS);
                expect(named(fake)).toBeNull();
                expect(baristaWrites(cafe.since(mark))).toEqual([{ write: `PUT ${WORKFLOW}`, body: { context: { baristaName: null } } }]);
            });

            test('a page opened on a sleeping machine clears a name set while it slept', async ({ cafe, fake }) => {
                fake.machine.setState('sleeping');
                nameElsewhere(fake, EXAMPLE);
                const mark = fake.log.length;
                await cafe.open();
                await expect.poll(() => named(fake)).toBeNull();
                await cafe.advance(1000);
                expect(baristaWrites(cafe.since(mark)), 'cleared once, though the page sees the machine asleep twice').toEqual([{ write: `PUT ${WORKFLOW}`, body: { context: { baristaName: null } } }]);
            });

            // A hold on Sleep closed Decaid before the page could clear the
            // name, leaving Streamline's marker (`sleepExitPending`); Decaid
            // opened again wakes the machine before the page starts, so the
            // page never sees it asleep.
            test('a page opened as Decaid comes back from a hold on Sleep clears the name', async ({ cafe, fake }) => {
                nameElsewhere(fake, EXAMPLE);
                const mark = fake.log.length;
                await cafe.open({ before: () => window.localStorage.setItem('sleepExitPending', String(Date.now())) });
                await expect.poll(() => named(fake)).toBeNull();
                await cafe.advance(1000);
                expect(baristaWrites(cafe.since(mark)), 'cleared in one write').toEqual([{ write: `PUT ${WORKFLOW}`, body: { context: { baristaName: null } } }]);
                expect(writes(cafe.since(mark)).map(({ write }) => write), 'Streamline woke the machine').toContain('PUT /api/v1/machine/state/idle');
                await expect(shown(cafe.page)).toHaveText('Barista');
            });

            test('a page that outlived the hold on Sleep clears the name when Decaid shows it again', async ({ cafe, fake }) => {
                nameElsewhere(fake, EXAMPLE);
                const page = await cafe.open();
                await expect(shown(page)).toHaveText(EXAMPLE);
                const mark = fake.log.length;
                await page.evaluate(() => {
                    window.localStorage.setItem('sleepExitPending', String(Date.now()));
                    document.dispatchEvent(new Event('visibilitychange'));
                    document.dispatchEvent(new Event('visibilitychange'));
                });
                await expect.poll(() => named(fake)).toBeNull();
                await cafe.advance(1000);
                expect(baristaWrites(cafe.since(mark)), 'cleared in one write, though Decaid showed the page twice').toEqual([{ write: `PUT ${WORKFLOW}`, body: { context: { baristaName: null } } }]);
                await expect(shown(page)).toHaveText('Barista');
            });
        });
    }

    test('in the dark theme: the button with and without a name, the dialog and the name field', async ({ cafe, fake }) => {
        namedShots(fake);
        const page = await cafe.open();
        await paint(page, 'dark');
        await cafe.screenshot('barista-none-1920x1200-dark');
        await openBaristas(cafe);
        await cafe.screenshot('barista-dialog-1920x1200-dark');
        await page.locator('#cafe-pick-add').click();
        await page.locator('#cafe-pick-entry-text').fill(TYPED_BARISTA);
        await cafe.screenshot('barista-name-field-1920x1200-dark');
        await page.locator('#cafe-pick-dialog .cafe-pick-head .cafe-btn').click();
        await untilPickClosed(cafe);
        nameElsewhere(fake, SAMPLE);
        await refresh(cafe);
        await expect(shown(page)).toHaveText(SAMPLE);
        await cafe.screenshot('barista-named-1920x1200-dark');
    });
});
