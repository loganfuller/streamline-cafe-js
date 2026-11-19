// The dial-in column's label with Decent Sync serving, refusing and not yet
// connected, and the remaining screenshots (docs/cafe/DESIGN.md, "Recipes and
// the strip" and "Shots and the reference"; once step 15 of the smoke run, its
// "14." in run.mjs): a recipe loaded in the dark theme, a machine with buttons
// of its own in light and dark, the column labelled "saved to the recipe" where
// the plugin serves the Machine and "not saved" where it refuses, each with the
// plugin's Status asked; the plugin not connected yet when the page opens, with
// the latest Shot alone and the line saying why, until the plugin's connection
// comes and the page asks again; and the page with no recipe loaded, dark.
//
// Decent Sync's plugin is the fake's (fake-decaid/decent-sync.js), serving the
// Machine at its Location from recordings/decent-sync.json, with its sharing
// turned off for "not saved", and never connected yet for the cold start: its
// connection comes, and it pushes on its `changes` socket, only when the test
// says (`fake.decentSync.startServer()`), not after a wait.
//
// The page asks the Status again on a timer while no answer has said either
// way (src/cafe/decent-sync.js, `statusRetryMs`): 30 s at the first pace. The
// cold start never moves the clock that far, so the one ask after the
// connection is the one the push made.
//
// The check that a machine with buttons of its own puts Settings and Sleep at
// the bottom of the dial-in column, with no column of machine buttons, is
// strip.spec.mjs's ("a machine with buttons of its own"); this spec takes its
// screenshots with a recipe loaded.

import { test, expect } from './support/test.mjs';
import { legend, row, keys, sides, paint, load } from './support/page-reads.mjs';
import { recordOf } from './support/fake-reads.mjs';
import { localTime } from '../../fake-decaid/index.js';
import { shotNumbers } from '../../src/cafe/comparison.js';
import { statusRetryMs } from '../../src/cafe/sync-status.js';
import { RECIPES } from '../cafe-smoke/sample-data.mjs';

const [house] = RECIPES;
const REST_REFERENCE = 'time firstDrip yield ratio peak';
const SAVED = 'Dial-in · saved to the recipe';
const NOT_SAVED = 'Dial-in · not saved to the recipe';
const UNREACHABLE = "Decent Sync can't be reached, so the reference can't be shown";
const REFERENCES = '/api/v1/store/streamlineCafe/references';
const STATUS = /^GET \/api\/v1\/plugins\/decent-sync\.reaplugin\/status$/;
const REFERENCE = /^GET \/api\/v1\/plugins\/decent-sync\.reaplugin\/reference\?recipe=/;

// ── Test data ────────────────────────────────────────────────────────────────

/**
 * A Shot pulled with `recipe` loaded, half an hour before the test starts: a
 * copy of the sample data's newest, with DYE2's id for the recipe in its
 * Workflow, as Decaid stores one. The legend then has a latest Shot for it.
 */
function shotOf(fake, start, recipe) {
    const [newest] = fake.shots.newest(1);
    const sample = fake.shots.get(newest.id);
    const at = start - 30 * 60_000;
    const { context } = sample.workflow;
    fake.shots.add({
        ...sample,
        id: '00000000-0000-4000-8000-0000000c0001',
        timestamp: localTime(at, fake.timeZone),
        createdAt: new Date(at).toISOString(),
        updatedAt: new Date(at).toISOString(),
        workflow: { ...sample.workflow, context: { ...context, coffeeName: recipe.bean, extras: { ...context.extras, dye: { ...context.extras.dye, recipeId: recordOf(fake, recipe.name).id } } } },
    });
}

/** The plugin's endpoints the page asked, as "GET /api/v1/…?…", matching `pattern`. */
const asked = (fake, pattern) => fake.log.map(entry => `${entry.method} ${entry.path}${entry.search}`).filter(line => pattern.test(line));

/** Reads of the choice of references kept on the tablet, in Decaid's store. */
const referencesRead = fake => fake.log.filter(entry => entry.path.startsWith(REFERENCES)).map(entry => `${entry.method} ${entry.path}`);

/** "Today 13:30" for `ms`, as the page writes a Shot's time, read in the page's own locale and zone. */
const whenOf = (page, ms) => page.evaluate(at => {
    const when = new Date(at);
    const now = new Date();
    const sameDay = when.getFullYear() === now.getFullYear() && when.getMonth() === now.getMonth() && when.getDate() === now.getDate();
    const day = sameDay ? 'Today' : when.toLocaleDateString(navigator.language, { day: 'numeric', month: 'short' });
    return `${day} ${when.toLocaleTimeString(navigator.language, { hour: '2-digit', minute: '2-digit' })}`;
}, ms);

test.describe('the dial-in label and Decent Sync', { tag: '@sync' }, () => {
    test('page-recipe-dark: a recipe loaded, with its latest Shot', async ({ cafe, fake, start }) => {
        shotOf(fake, start, house);
        const page = await cafe.open();
        await load(cafe, house);
        await paint(page, 'dark');
        const shown = await legend(page);
        expect(shown.label).toBe('Latest');
        expect(shown.when).toBe(await whenOf(page, start - 30 * 60_000));
        await cafe.screenshot('page-recipe-dark');
    });

    test('a machine with buttons of its own: page-recipe-own-buttons, light and dark', async ({ cafe, fake, start }) => {
        fake.patchBoot('GET /api/v1/machine/info', info => ({ ...info, GHC: true }));
        shotOf(fake, start, house);
        const page = await cafe.open();
        await load(cafe, house);
        expect((await legend(page)).label).toBe('Latest');
        await cafe.screenshot('page-recipe-own-buttons-light');
        await paint(page, 'dark');
        await cafe.screenshot('page-recipe-own-buttons-dark');
    });

    test.describe('with Decent Sync\'s plugin', () => {
        test.use({ decentSync: true });

        for (const [state, label] of [['served', SAVED], ['captureOnly', NOT_SAVED]]) {
            test(`Decent Sync answering "${state}": the column reads "${label}"`, async ({ cafe, fake }) => {
                // A Capture-only Machine: its sharing turned off on the server.
                if (state === 'captureOnly') fake.decentSync.setSharing(false);
                const page = await cafe.open();
                await load(cafe, house);
                await expect(page.locator('#cafe-dial-label')).toHaveText(label);
                expect(asked(fake, STATUS).length, 'its Status was asked').toBeGreaterThan(0);
                if (state === 'served') await cafe.screenshot('page-recipe-decent-sync-light');
            });
        }

        test('Decent Sync not connected yet: "not saved", the latest Shot alone and a line saying why, until its connection comes', async ({ cafe, fake, start }) => {
            fake.decentSync.firstStart();
            const page = await cafe.open();
            await load(cafe, house);

            await expect(page.locator('#cafe-dial-label')).toHaveText(NOT_SAVED);
            expect(await legend(page), 'the latest Shot alone, with no reference, no badge and no Make reference').toMatchObject({
                label: 'Latest', reference: null, badge: null, make: null, notice: UNREACHABLE,
            });
            expect(referencesRead(fake), 'the choice kept on the tablet is not read').toEqual([]);
            expect(cafe.routes.sockets.has('/ws/v1/plugins/decent-sync.reaplugin/changes'), 'the page listens on the plugin\'s socket').toBe(true);

            // Every ask so far was answered "unreachable", and the page's timer to
            // ask again has not fired: the clock has not reached its first pace.
            const asks = asked(fake, STATUS).length;
            const references = asked(fake, REFERENCE).length;
            expect(asks).toBeGreaterThan(0);
            expect(await page.evaluate(() => Date.now()) - start, 'short of the first retry').toBeLessThan(statusRetryMs(1));

            fake.decentSync.startServer();
            cafe.fake.flush();
            await cafe.settle();
            await expect(page.locator('#cafe-dial-label')).toHaveText(SAVED);
            expect(asked(fake, STATUS).length, 'one ask more, the one the connection\'s push made').toBe(asks + 1);
            expect(await page.evaluate(() => Date.now()) - start, 'and no retry fired').toBeLessThan(statusRetryMs(1));

            await expect.poll(() => legend(page), 'Make reference once the Machine is known to be served, and the line gone').toMatchObject({
                label: 'Latest', make: 'Make reference', muted: false, notice: null,
            });
            expect(asked(fake, REFERENCE).length, 'the plugin asked for the reference again').toBeGreaterThan(references);
            expect(referencesRead(fake), 'and the choice kept on the tablet never read').toEqual([]);
    });
    });

    test('page-no-recipe-dark: "No recipe selected", the last Shot, and no reference', async ({ cafe, fake }) => {
        const [newest] = fake.shots.newest(1);
        const page = await cafe.open();
        await paint(page, 'dark');
        await expect(page.locator('#cafe-title')).toHaveText('No recipe selected');

        const none = await legend(page);
        expect(none).toMatchObject({ label: 'Last shot', line: 'Pick a recipe to compare', reference: null, badge: null, make: null });
        // Its time, then its barista's name where it has one.
        const when = await whenOf(page, Date.parse(newest.createdAt));
        expect(none.when === when || none.when.startsWith(`${when} `), `the tablet's newest Shot, at ${when}: ${none.when}`).toBe(true);

        const rest = await row(page);
        expect(rest.mode).toBe('rest');
        expect(keys(rest)).toBe(REST_REFERENCE);
        expect(sides(rest), 'with no reference').toEqual(Array(5).fill('No reference'));
        const numbers = shotNumbers(fake.shots.get(newest.id));
        expect(rest.cards[0].value, 'the last Shot\'s own time').toBe(`${numbers.time.toFixed(1)} s`);
        await cafe.screenshot('page-no-recipe-dark');
    });
});
