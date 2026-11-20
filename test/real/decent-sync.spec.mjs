// The real journeys with Decent Sync (docs/cafe/TESTING.md, "The real
// journeys"; what is left of test/cafe-smoke/run-decent-sync.mjs): the skin's
// own writes on one tablet carried by the real plugin to the real server and on
// to the second tablet, and what the server changes pushed back to the page.
// The page's half of each (what it asks of the plugin, what it draws from the
// answers) is the page tests' on a fake plugin, test/page/sync-*.spec.mjs;
// these hold only what the real server, plugin and second tablet can show.
//
// The sync stack (stacks.sync): the first Decaid, "Sample Machine" at "Sample
// Cafe", the second (stacks.sync.second), a simulated Bengle, "Sample Machine
// Two" there, and the server. Each journey starts with nothing loaded and the
// Recipe in slot 1 (House espresso) as the sample data has it, with no
// Reference Shot, and puts back what it changed: the Recipe's content, its
// name, its Reference Shot, the server running.

import { test, expect, pull, quiet, shoot, card } from './support/journey.mjs';
import { legend, remarks, chartLines, shotsHeader, REFERENCE_LINES } from '../page/support/page-reads.mjs';
import {
    HOUSE, LOCATION, MACHINE, MACHINE_TWO, SAVED_LABEL, BADGE, POLL_MS,
    houseId, recipeOn, referenceOn, setReference, loadedOn, shotOn, recordFor, selectedOn, annotationsOn,
    recordGrinder, recordBatch, grinderOn, batchesOn, profileOn, ownTemperature, nothingLoaded, houseShot, loadsOf, loadHouse, sampleContent,
    chooseGrinder, chooseBatch, chooseProfile, brewRow, grindRow, openList, closeList, listRows, maybe,
} from './support/sync-helpers.mjs';
import { RECIPES, GRINDER, SECOND_GRINDER, GRINDER_USE } from '../cafe-smoke/sample-data.mjs';

const PLUGIN_STATUS = '/plugins/decent-sync.reaplugin/status';
/** Whether the plugin on `side` serves its Machine: false while it answers 503 or 409. */
const served = async side => (await maybe(() => side.decaid('GET', PLUGIN_STATUS)))?.served === true;

/** The fields of a Recipe's content that differ from `wanted`. */
const differing = (content, wanted) => Object.keys(wanted).filter(field => JSON.stringify(content?.[field] ?? null) !== JSON.stringify(wanted[field] ?? null));

/**
 * The Recipe's content made `wanted` on the server where it differs, and both
 * tablets' records holding it, by the plugins' Library sync.
 */
async function putBack(sync, id, wanted) {
    const off = differing((await recipeOn(sync, id))?.content, wanted);
    if (!off.length) return;
    await sync.server('PATCH', `/recipes/${id}`, { content: Object.fromEntries(off.map(field => [field, wanted[field] ?? null])) });
    const held = async side => {
        const row = await recordFor(side, id);
        return { name: row?.name, profileId: row?.profileId };
    };
    await expect.poll(async () => [await held(sync), await held(sync.second)], { message: 'both tablets\' records hold the Recipe as put back', timeout: 90_000 })
        .toEqual([{ name: wanted.name, profileId: wanted.profileId }, { name: wanted.name, profileId: wanted.profileId }]);
}

/**
 * The journey's start: the server answering, both plugins serving, the Recipe
 * in slot 1 (House espresso) as the sample data has it with no Reference Shot,
 * and nothing loaded on either Decaid. Answers its id and that content, which
 * the journey puts back as it ends.
 */
async function start(sync) {
    if (!await maybe(() => sync.server('GET', '/setup'))) await sync.startServer();
    await expect.poll(() => served(sync), { message: 'the plugin serves the first Machine', timeout: 120_000 }).toBe(true);
    await expect.poll(() => served(sync.second), { message: 'and the second', timeout: 120_000 }).toBe(true);
    const id = await houseId(sync);
    const content = await sampleContent(sync);
    await putBack(sync, id, content);
    if (await referenceOn(sync, id)) await setReference(sync, id, null);
    await nothingLoaded(sync);
    return { id, content };
}

/** Both tablets open, each counting its loads from now. */
async function bothTablets(tablet, sync) {
    const first = await tablet(sync);
    const second = await tablet(sync.second);
    return { first, second, firstLoads: loadsOf(first), secondLoads: loadsOf(second) };
}

test.describe('the reference and the rating with Decent Sync', { tag: '@real-sync-reference' }, () => {
    test('a Reference Shot chosen on the server reaches the page; Make reference, a rating and a note on this tablet\'s Shot reach the server and the second tablet; the server\'s edit and rename come back', async ({ stacks, tablet }) => {
        const sync = stacks.sync;
        const { id, content } = await start(sync);
        const status = await sync.decaid('GET', PLUGIN_STATUS);
        expect(status, 'the plugin serves the Machine at its Location').toMatchObject({ served: true, machine: { name: MACHINE }, location: { name: LOCATION } });
        const { recipes } = await sync.server('GET', `/locations/${sync.location.id}/recipes`);
        for (const side of [sync, sync.second]) {
            const records = await side.decaid('GET', '/store/dye2.reaplugin/recipes');
            const carried = RECIPES.map(sample => records.find(row => row.name === sample.name)?.decentSyncId ?? null);
            expect(carried, `each sample recipe's record on ${side === sync ? 'this' : 'the second'} tablet carries the id of the Location's Recipe of its name`)
                .toEqual(RECIPES.map(sample => recipes.find(recipe => recipe.name === sample.name)?.id));
        }

        const { first, second, firstLoads, secondLoads } = await bothTablets(tablet, sync);
        try {
            await loadHouse(first, sync, sync, { machineId: sync.machine.id, recipeId: id });
            await loadHouse(second, sync.second, sync, { machineId: sync.machineTwo.id, recipeId: id });

            // A Shot pulled on this Machine with the page open: the latest, on the server too.
            const barista = 'Sample Reference Barista';
            const shot = await pull(sync.decaid, { workflow: { context: { baristaName: barista } } });
            await expect.poll(async () => (await legend(first)).when, { message: 'the Shot is the latest on the page' }).toMatch(new RegExp(`^Today \\d{2}:\\d{2}.* · ${barista}$`));
            await expect.poll(() => shotOn(sync, shot.id), { message: 'the server holds it, with its Recipe', timeout: 60_000 }).toMatchObject({ recipe: id });

            // Chosen on the server, then cleared there: each reaches the open page, with no reload.
            await setReference(sync, id, shot.id);
            await expect(first.locator('#cafe-reference-badge'), 'a Shot chosen on the server is the reference on the open page').toHaveText(BADGE);
            await expect(first.locator('#cafe-reference-badge')).toBeVisible();
            await setReference(sync, id, null);
            await expect(first.locator('#cafe-reference-badge'), 'cleared there, the page has none').toBeHidden();
            await expect(first.locator('#cafe-make-reference')).toBeEnabled();

            // Make reference on this tablet: the server's, and the second tablet draws it behind its own.
            await first.locator('#cafe-make-reference').click();
            await expect(first.locator('#cafe-reference-badge')).toBeVisible();
            await expect.poll(() => referenceOn(sync, id), { message: 'Make reference makes the Shot the Recipe\'s Reference Shot on the server', timeout: 30_000 }).toBe(shot.id);
            await expect.poll(async () => (await legend(second)).reference, { message: 'the second tablet draws it, naming its barista', timeout: 60_000 }).toMatch(new RegExp(` · ${barista}$`));
            const lines = await chartLines(second);
            for (const name of REFERENCE_LINES) expect(lines.points[lines.names.indexOf(name)] ?? 0, `the second tablet's ${name}`).toBeGreaterThan(10);

            // A rating, cleared, given again, and a note: each held by the tablet's own Shot and the server, and drawn on the second tablet's reference row.
            await first.locator('#cafe-stars .cafe-star').nth(3).click();
            await expect.poll(() => shotOn(sync, shot.id), { message: 'a rating on the page is held by the server', timeout: 45_000 }).toMatchObject({ rating: 8 });
            expect(await annotationsOn(sync, shot.id), 'and by the tablet\'s own Shot').toMatchObject({ rating: 8 });
            await expect.poll(async () => (await remarks(second)).referenceRating, { message: 'and drawn on the second tablet\'s reference row', timeout: 60_000 }).toBe('★ 4');

            await first.locator('#cafe-stars .cafe-star').nth(3).click();
            await expect.poll(() => shotOn(sync, shot.id), { message: 'a rating cleared on the page is cleared on the server', timeout: 45_000 }).toMatchObject({ rating: null });
            expect(await annotationsOn(sync, shot.id), 'and on the tablet').toMatchObject({ rating: null });
            await expect.poll(async () => (await remarks(second)).referenceRating, { message: 'and on the second tablet', timeout: 60_000 }).toBeNull();

            await first.locator('#cafe-stars .cafe-star').nth(4).click();
            await expect.poll(() => shotOn(sync, shot.id), { message: 'rated again', timeout: 45_000 }).toMatchObject({ rating: 10 });
            const NOTE = 'Bright, with a clean finish.\nKeep the grind where it is.';
            await first.locator('#cafe-shot-note').click();
            await expect(first.locator('#cafe-note-dialog')).toHaveAttribute('open', '');
            await first.locator('#cafe-note-text').fill(`  ${NOTE}  `);
            await first.locator('#cafe-note-save').click();
            await expect(first.locator('#cafe-note-dialog:not([open])')).toBeAttached();
            await expect.poll(() => shotOn(sync, shot.id), { message: 'a note on the page is held by the server, trimmed, the rating untouched', timeout: 45_000 }).toEqual({ rating: 10, note: NOTE, recipe: id });
            expect(await annotationsOn(sync, shot.id), 'and by the tablet\'s own Shot').toEqual({ rating: 10, note: NOTE });
            await expect.poll(async () => remarks(second), { message: 'the second tablet\'s reference row has both', timeout: 60_000 }).toMatchObject({ referenceRating: '★ 5', referenceNote: true });
            await shoot(second, 'real-sync-reference-second-tablet');

            // A rating and a note given to the Reference Shot on the server: on the tablet's own Shot, and on the second tablet's row.
            const SERVER_NOTE = 'The one to match.';
            await sync.server('PATCH', `/shots/${shot.id}`, { rating: 7, note: SERVER_NOTE });
            await expect.poll(() => annotationsOn(sync, shot.id), { message: 'the server writes its edit into the tablet\'s own Shot', timeout: 60_000 }).toEqual({ rating: 7, note: SERVER_NOTE });
            await expect.poll(async () => (await remarks(second)).referenceRating, { message: 'and the open page draws it on the reference row', timeout: 60_000 }).toBe('★ 3.5');

            // Renamed on the server, then named back: each name in both title bands.
            const renamed = `${HOUSE.name} two`;
            await sync.server('PATCH', `/recipes/${id}`, { content: { name: renamed } });
            await expect(first.locator('#cafe-title'), 'the rename reaches the page by DYE2\'s record').toHaveText(renamed, { timeout: 60_000 });
            await expect(second.locator('#cafe-title')).toHaveText(renamed, { timeout: 60_000 });
            await sync.server('PATCH', `/recipes/${id}`, { content: { name: HOUSE.name } });
            await expect(first.locator('#cafe-title')).toHaveText(HOUSE.name, { timeout: 60_000 });
            await expect(second.locator('#cafe-title')).toHaveText(HOUSE.name, { timeout: 60_000 });
            await shoot(first, 'real-sync-reference-first-tablet');
            expect([firstLoads(), secondLoads()], 'neither page was reloaded').toEqual([0, 0]);
        } finally {
            await putBack(sync, id, content);
            await setReference(sync, id, null);
        }
    });

    test('another Machine\'s Shot on the Location\'s list: rated and noted on this tablet, written into the Shot on the second tablet; Make reference on it is the second tablet\'s reference', async ({ stacks, tablet }) => {
        const sync = stacks.sync;
        const { id } = await start(sync);
        const { first, second, firstLoads, secondLoads } = await bothTablets(tablet, sync);
        try {
            await loadHouse(second, sync.second, sync, { machineId: sync.machineTwo.id, recipeId: id });
            const barista = 'Second Barista';
            const theirs = await pull(sync.second.decaid, { workflow: { context: { baristaName: barista } } });
            await expect.poll(async () => (await legend(second)).when, { message: 'the second tablet runs the skin, its Shot the latest' }).toMatch(new RegExp(` · ${barista}$`));
            await expect.poll(async () => {
                const { shots } = await sync.decaid('GET', '/plugins/decent-sync.reaplugin/shots?limit=50');
                return shots.find(listed => listed.id === theirs.id) || null;
            }, { message: 'it reaches the server, and the first tablet\'s plugin lists it as another Machine\'s', timeout: 90_000 }).toMatchObject({ machine: { name: MACHINE_TWO }, onThisTablet: false });
            expect(await maybe(() => sync.decaid('GET', `/shots/${theirs.id}`)), 'the first Decaid holds no copy').toBeNull();

            await loadHouse(first, sync, sync, { machineId: sync.machine.id, recipeId: id });
            await openList(first);
            expect((await listRows(first)).find(row => row.id === theirs.id), 'the first tablet\'s list names its Machine').toMatchObject({ machine: MACHINE_TWO });
            await first.locator(`#cafe-shots-list .cafe-shots-row[data-shot-id="${theirs.id}"]`).click();
            await expect(first.locator('#cafe-shot-label')).toHaveText('Viewing');
            await expect.poll(async () => (await legend(first)).when).toMatch(new RegExp(` · ${barista}$`));

            await first.locator('#cafe-stars .cafe-star').nth(3).click();
            await expect.poll(() => shotOn(sync, theirs.id), { message: 'its rating is held by the server', timeout: 45_000 }).toMatchObject({ rating: 8 });
            const NOTE = 'Pulled on the other machine.\nA touch fast.';
            await first.locator('#cafe-shot-note').click();
            await expect(first.locator('#cafe-note-dialog')).toHaveAttribute('open', '');
            await first.locator('#cafe-note-text').fill(NOTE);
            await first.locator('#cafe-note-save').click();
            await expect(first.locator('#cafe-note-dialog:not([open])')).toBeAttached();
            await expect.poll(() => shotOn(sync, theirs.id), { message: 'and its note, the rating untouched', timeout: 45_000 }).toMatchObject({ rating: 8, note: NOTE });
            await expect.poll(() => annotationsOn(sync.second, theirs.id), { message: 'the server writes both into the Shot on the second tablet', timeout: 60_000 }).toEqual({ rating: 8, note: NOTE });

            await first.locator('#cafe-make-reference').click();
            await expect(first.locator('#cafe-reference-badge')).toBeVisible();
            await expect.poll(() => referenceOn(sync, id), { message: 'Make reference on it makes it its Recipe\'s Reference Shot on the server', timeout: 30_000 }).toBe(theirs.id);
            await expect(second.locator('#cafe-reference-badge'), 'and the second tablet, whose latest it is, says so with no tap').toBeVisible({ timeout: 60_000 });
            await expect(second.locator('#cafe-reference-badge')).toHaveText(BADGE);
            await shoot(first, 'real-sync-other-machine-shot');
            await shoot(second, 'real-sync-other-machine-reference-second-tablet');
            expect([firstLoads(), secondLoads()], 'neither page was reloaded').toEqual([0, 0]);
        } finally {
            await setReference(sync, id, null);
        }
    });
});

test.describe('the picks with Decent Sync', { tag: '@real-sync-picks' }, () => {
    test('a grinder chosen on this tablet, a Workflow write alone, is the Recipe\'s on the server, in both records and on the second tablet\'s Grind row', async ({ stacks, tablet }) => {
        const sync = stacks.sync;
        const { id, content } = await start(sync);
        const [usual, chosen, usualThere, chosenThere] = [
            await grinderOn(sync, GRINDER.model), await grinderOn(sync, SECOND_GRINDER.model),
            await grinderOn(sync.second, GRINDER.model), await grinderOn(sync.second, SECOND_GRINDER.model),
        ];
        expect([usual, chosen, usualThere, chosenThere].every(Boolean), 'both sample grinders are the Location\'s, on each tablet').toBe(true);
        expect((await recipeOn(sync, id)).content.grinderId, 'the Recipe on the server is on the Location\'s usual Grinder').toBe(usual.extras.decentSyncId);
        const { first, second, firstLoads, secondLoads } = await bothTablets(tablet, sync);
        try {
            const mine = await loadHouse(first, sync, sync, { machineId: sync.machine.id, recipeId: id });
            const there = await loadHouse(second, sync.second, sync, { machineId: sync.machineTwo.id, recipeId: id });
            await expect(first.locator('#cafe-grind-desc'), 'this tablet names the Recipe\'s grinder under Grind').toHaveText(GRINDER.model);
            await expect(second.locator('#cafe-grind-desc'), 'and the second').toHaveText(GRINDER.model);

            await chooseGrinder(first, SECOND_GRINDER.model);
            await expect.poll(async () => {
                const now = (await recipeOn(sync, id))?.content;
                return now && { grinderId: now.grinderId, grindSetting: String(now.grindSetting), rpm: now.rpm ?? null };
            }, { message: 'the Recipe on the server takes the Location\'s Grinder, with the setting and RPM the choice wrote', timeout: 60_000 })
                .toEqual({ grinderId: chosen.extras.decentSyncId, grindSetting: GRINDER_USE.second.setting, rpm: GRINDER_USE.second.rpm });
            await expect.poll(async () => recordGrinder(await recordFor(sync, id)), { message: 'this tablet\'s record names it', timeout: 60_000 }).toBe(String(chosen.id));
            await expect.poll(async () => recordGrinder(await recordFor(sync.second, id)), { message: 'and the second tablet\'s, by its own Grinder', timeout: 60_000 }).toBe(String(chosenThere.id));
            await expect.poll(() => grindRow(second), { message: 'the second tablet shows the grinder and its setting under Grind, with no tap', timeout: 90_000 })
                .toEqual({ name: SECOND_GRINDER.model, value: parseFloat(GRINDER_USE.second.setting) });
            expect([await selectedOn(sync), await selectedOn(sync.second)], 'the Recipe still loaded on both').toEqual([String(mine.id), String(there.id)]);
            await shoot(second, 'real-sync-grinder-second-tablet');

            await chooseGrinder(first, GRINDER.model);
            await expect.poll(async () => (await recipeOn(sync, id))?.content.grinderId, { message: 'the grinder chosen back reaches the Recipe', timeout: 60_000 }).toBe(usual.extras.decentSyncId);
            await expect(second.locator('#cafe-grind-desc'), 'and the second tablet').toHaveText(GRINDER.model, { timeout: 90_000 });
            expect([firstLoads(), secondLoads()], 'neither page was reloaded').toEqual([0, 0]);
        } finally {
            await putBack(sync, id, content);
        }
    });

    test('a batch of another Bean chosen on this tablet: the Recipe\'s Bean and batch on the server, with the name DYE2 gives, in both records and on the second tablet, the Recipe kept loaded on both (#52)', async ({ stacks, tablet }) => {
        const sync = stacks.sync;
        const { id, content } = await start(sync);
        const decafHere = (await batchesOn(sync, 'Example Decaf'))[0];
        const decafThere = (await batchesOn(sync.second, 'Example Decaf'))[0];
        expect(decafHere && decafThere, 'Example Decaf\'s batch is the Location\'s, on each tablet').toBeTruthy();
        // DYE2's own name for the Recipe ("Sample Blend": it leaves "Default"
        // out), given on the server as the management interface would, so the
        // name follows the Bean.
        const generated = HOUSE.bean;
        const renamed = 'Example Decaf';
        try {
            await sync.server('PATCH', `/recipes/${id}`, { content: { name: generated } });
            await expect.poll(async () => [(await recordFor(sync, id))?.name, (await recordFor(sync.second, id))?.name], { message: 'the Recipe has the name DYE2 gives it on both tablets', timeout: 90_000 }).toEqual([generated, generated]);
            const { first, second, firstLoads, secondLoads } = await bothTablets(tablet, sync);
            const mine = await loadHouse(first, sync, sync, { machineId: sync.machine.id, recipeId: id, name: generated });
            const there = await loadHouse(second, sync.second, sync, { machineId: sync.machineTwo.id, recipeId: id, name: generated });

            await chooseBatch(first, 'Example Decaf', 'Roasted Oct 20');
            // Sampled at each poll until the server has it all: this tablet is never set back.
            let reached = false;
            let setBack = null;
            await expect.poll(async () => {
                const workflow = await sync.decaid('GET', '/workflow');
                const onDecaf = String(workflow.context.beanBatchId) === String(decafHere.id) && workflow.context.coffeeName === 'Example Decaf';
                const loaded = await selectedOn(sync);
                if (onDecaf) reached = true;
                if (reached && (!onDecaf || loaded !== String(mine.id))) setBack ||= `${workflow.context.coffeeName}, selection ${loaded}`;
                const now = await recipeOn(sync, id);
                return now && { bean: now.uses?.bean?.name, roasted: String(now.uses?.beanBatch?.roastDate || '').slice(0, 10), name: now.name ?? now.content?.name };
            }, { message: 'the Recipe on the server takes the Bean, the batch and the name DYE2 gives with it', timeout: 90_000 }).toEqual({ bean: 'Example Decaf', roasted: '2026-10-20', name: renamed });
            expect(reached && setBack === null, `this tablet was never set back, its Workflow on the batch with the Recipe loaded (${setBack})`).toBe(true);
            await expect(first.locator('#cafe-title'), 'its title band shows the new name').toHaveText(renamed, { timeout: 30_000 });
            await expect(card(first, HOUSE.slot)).toContainText(renamed);
            await expect.poll(async () => {
                const row = await recordFor(sync, id);
                return { bean: String(row?.beanId ?? '') !== '', batch: recordBatch(row), name: row?.name };
            }, { message: 'this tablet\'s record names the Bean, the batch and the new name', timeout: 60_000 }).toEqual({ bean: true, batch: String(decafHere.id), name: renamed });
            await expect.poll(async () => {
                const row = await recordFor(sync.second, id);
                return { batch: recordBatch(row), name: row?.name };
            }, { message: 'and the second tablet\'s, by its own batch', timeout: 60_000 }).toEqual({ batch: String(decafThere.id), name: renamed });
            await expect(second.locator('#cafe-dose-desc'), 'the second tablet names the new Bean under Dose, with no tap').toHaveText(/^Example Decaf · roasted/, { timeout: 90_000 });
            expect(await selectedOn(sync.second), 'the Recipe still loaded there').toBe(String(there.id));
            await shoot(first, 'real-sync-other-bean-first-tablet');
            await shoot(second, 'real-sync-other-bean-second-tablet');
            expect([firstLoads(), secondLoads()], 'neither page was reloaded').toEqual([0, 0]);
        } finally {
            // The batch carries its Bean back with it.
            await putBack(sync, id, content);
        }
    });

    test('another profile chosen in this tablet\'s profile dialog: the Recipe\'s on the server at its own temperature, with the name DYE2 gives, in both records, on the second tablet\'s Brew row, its Reference Shot then flagged "Different profile" (#50, #51)', async ({ stacks, tablet }) => {
        const sync = stacks.sync;
        const { id, content } = await start(sync);
        const [usual, gentle] = [await profileOn(sync, HOUSE.profile), await profileOn(sync, 'Gentle and sweet')];
        const generated = HOUSE.bean;
        const changedName = `Gentle ${HOUSE.bean}`;
        try {
            // A Reference Shot pulled on the Recipe's own profile, drawn behind the second tablet's latest.
            const reference = await houseShot(sync, (await recordFor(sync, id)).id);
            await setReference(sync, id, reference.id);
            await sync.server('PATCH', `/recipes/${id}`, { content: { name: generated } });
            await expect.poll(async () => [(await recordFor(sync, id))?.name, (await recordFor(sync.second, id))?.name], { message: 'the Recipe has the name DYE2 gives it on both tablets', timeout: 90_000 }).toEqual([generated, generated]);
            const { first, second, firstLoads, secondLoads } = await bothTablets(tablet, sync);
            const mine = await loadHouse(first, sync, sync, { machineId: sync.machine.id, recipeId: id, name: generated });
            const there = await loadHouse(second, sync.second, sync, { machineId: sync.machineTwo.id, recipeId: id, name: generated });
            await expect.poll(() => legend(second), { message: 'the second tablet draws the Reference Shot, with no flag', timeout: 60_000 }).toMatchObject({ reference: expect.stringMatching(/ · /), flag: null });

            await chooseProfile(first, gentle);
            let mineHeld = false;
            let setBack = null;
            await expect.poll(async () => {
                const workflow = await sync.decaid('GET', '/workflow');
                const loaded = await selectedOn(sync);
                const holds = workflow.profile.title === gentle.profile.title && loaded === String(mine.id);
                if (holds) mineHeld = true;
                if (mineHeld && !holds) setBack ||= `${workflow.profile.title}, selection ${loaded}`;
                const now = await recipeOn(sync, id);
                return now && { profileId: now.content.profileId, brewTemperature: now.content.brewTemperature, name: now.name ?? now.content.name };
            }, { message: 'the Recipe on the server takes the Profile at its own brew temperature, and the name DYE2 gives with it', timeout: 120_000 })
                .toEqual({ profileId: gentle.id, brewTemperature: ownTemperature(gentle), name: changedName });
            expect(mineHeld && setBack === null, `this tablet kept it, the Recipe loaded (${setBack})`).toBe(true);
            expect((await recordFor(sync, id))?.profileId, 'its record holds the Profile').toBe(gentle.id);
            expect(await brewRow(first)).toEqual({ name: gentle.profile.title, temp: ownTemperature(gentle) });
            await expect.poll(() => brewRow(second), { message: 'the second tablet\'s Brew row shows it at its own temperature, with no tap', timeout: 120_000 })
                .toEqual({ name: gentle.profile.title, temp: ownTemperature(gentle) });
            expect(await selectedOn(sync.second), 'the Recipe still loaded there').toBe(String(there.id));
            await expect.poll(async () => (await recordFor(sync.second, id))?.profileId, { message: 'the second tablet\'s record holds the Profile', timeout: 60_000 }).toBe(gentle.id);
            await expect(second.locator('#cafe-title')).toHaveText(changedName, { timeout: 60_000 });
            await expect.poll(async () => (await legend(second)).flag, { message: 'the Reference Shot, pulled on the old profile, is flagged', timeout: 60_000 }).toBe('Different profile');
            await shoot(first, 'real-sync-profile-dialog-first-tablet');
            await shoot(second, 'real-sync-profile-dialog-second-tablet');

            await chooseProfile(first, usual);
            await expect.poll(async () => (await recipeOn(sync, id))?.content.profileId, { message: 'the Recipe\'s own Profile chosen back reaches the server', timeout: 120_000 }).toBe(usual.id);
            await expect.poll(async () => (await brewRow(second)).name, { message: 'and the second tablet', timeout: 120_000 }).toBe(usual.profile.title);
            expect(await selectedOn(sync.second)).toBe(String(there.id));
            expect([firstLoads(), secondLoads()], 'neither page was reloaded').toEqual([0, 0]);
        } finally {
            await putBack(sync, id, content);
            await setReference(sync, id, null);
        }
    });

    test('a tap on the loaded card unloads it on this Machine only: the server shows no Loaded Recipe, a step is saved to no Recipe nor reaches the second tablet, a Shot then has no Recipe, and a tap loads the Recipe as the server has it', async ({ stacks, tablet }) => {
        const sync = stacks.sync;
        const { id, content } = await start(sync);
        const { first, second, firstLoads, secondLoads } = await bothTablets(tablet, sync);
        const mine = await loadHouse(first, sync, sync, { machineId: sync.machine.id, recipeId: id });
        const there = await loadHouse(second, sync.second, sync, { machineId: sync.machineTwo.id, recipeId: id });

        await card(first, HOUSE.slot).click();
        await expect(first.locator('#cafe-title')).toHaveText('No recipe selected');
        await expect.poll(() => loadedOn(sync, sync.machine.id), { message: 'the server shows this Machine with no Loaded Recipe', timeout: 60_000 }).toBeNull();

        const theirDose = (await sync.second.decaid('GET', '/workflow')).context.targetDoseWeight;
        const dose = parseFloat(await first.locator('#dose-in-value').textContent());
        await first.locator('#dose-in-plus').click();
        const stepped = parseFloat(await first.locator('#dose-in-value').textContent());
        expect(stepped, 'the dose stepped up').toBeGreaterThan(dose);
        await expect.poll(async () => (await sync.decaid('GET', '/workflow')).context.targetDoseWeight, { message: 'a step afterwards reaches this Machine\'s Workflow' }).toBe(stepped);
        await quiet(3 * POLL_MS, 'three of the plugin\'s polls: a save to the Recipe, or on to the second Machine, it should not make');
        expect((await recipeOn(sync, id)).content.dose, 'the step is saved to no Recipe: the server\'s keeps its dose').toBe(content.dose);
        expect((await sync.second.decaid('GET', '/workflow')).context.targetDoseWeight, 'nor reaches the second Machine').toBe(theirDose);
        expect(await selectedOn(sync.second), 'which keeps the Recipe loaded').toBe(String(there.id));
        expect(await loadedOn(sync, sync.machineTwo.id), 'as the server shows').toBe(id);
        await expect(second.locator('#cafe-title')).toHaveText(HOUSE.name);
        await shoot(first, 'real-sync-unloaded');

        const barista = 'Sample Unload Barista';
        const shot = await pull(sync.decaid, { workflow: { context: { baristaName: barista } } });
        await expect.poll(() => shotOn(sync, shot.id), { message: 'a Shot pulled with nothing loaded reaches the server with no Recipe', timeout: 60_000 }).toMatchObject({ recipe: null });
        await expect.poll(async () => (await legend(first)).when, { message: 'the page has the stored Shot' }).toMatch(new RegExp(` · ${barista}$`));

        await card(first, HOUSE.slot).click();
        await expect(first.locator('#cafe-title')).toHaveText(HOUSE.name);
        await expect.poll(() => selectedOn(sync), { message: 'a tap on the card loads the Recipe' }).toBe(String(mine.id));
        await expect.poll(async () => {
            const { context } = await sync.decaid('GET', '/workflow');
            return { dose: context.targetDoseWeight, yield: context.targetYield };
        }, { message: 'as the server has it' }).toEqual({ dose: content.dose, yield: content.yield });
        await expect.poll(() => loadedOn(sync, sync.machine.id), { message: 'and the server shows it loaded again', timeout: 60_000 }).toBe(id);
        expect([firstLoads(), secondLoads()], 'neither page was reloaded').toEqual([0, 0]);
    });
});

test.describe('Decent Sync\'s server out of reach', { tag: '@real-sync-outage' }, () => {
    // The server stopped and started, the plugins reconnecting.
    test.describe.configure({ timeout: 480_000 });

    test('the server stopped: the copy drawn and the list this machine\'s own; a profile chosen meanwhile is kept on the tablet, then taken by the server and the second tablet once it is back, the reference changeable again', async ({ stacks, tablet }) => {
        const sync = stacks.sync;
        const { id, content } = await start(sync);
        const [usual, gentle] = [await profileOn(sync, HOUSE.profile), await profileOn(sync, 'Gentle and sweet')];
        let stopped = false;
        try {
            // A Reference Shot behind this tablet's latest, so the page draws it as a reference, with Make reference beside the latest.
            const reference = await houseShot(sync, (await recordFor(sync, id)).id, { behindLatest: true });
            await setReference(sync, id, reference.id);
            const { first, second, firstLoads, secondLoads } = await bothTablets(tablet, sync);
            const mine = await loadHouse(first, sync, sync, { machineId: sync.machine.id, recipeId: id });
            const there = await loadHouse(second, sync.second, sync, { machineId: sync.machineTwo.id, recipeId: id });
            await expect.poll(() => legend(first), { message: 'the page draws the Reference Shot behind the latest, which can be made the reference' })
                .toMatchObject({ label: 'Latest', reference: expect.stringMatching(/ · /), make: 'Make reference', muted: false, notice: null });

            sync.stopServer();
            stopped = true;
            await expect.poll(async () => (await legend(first)).notice, { message: 'the page says the server can\'t be reached', timeout: 90_000 }).not.toBeNull();
            const drawn = await legend(first);
            expect(drawn.reference, 'and draws the tablet\'s copy of the Reference Shot').not.toBeNull();
            expect(drawn.muted, 'Make reference muted').toBe(true);
            const lines = await chartLines(first);
            for (const name of REFERENCE_LINES) expect(lines.points[lines.names.indexOf(name)] ?? 0, `the copy's ${name}`).toBeGreaterThan(10);
            await shoot(first, 'real-sync-outage-copy');
            await openList(first);
            expect((await shotsHeader(first)).under, 'the list falls back to this machine\'s Shots').toBe('This machine only');
            await shoot(first, 'real-sync-outage-list');
            await closeList(first);

            // A profile chosen with the server stopped: kept on the tablet, the Recipe loaded.
            await chooseProfile(first, gentle);
            await expect.poll(async () => (await recordFor(sync, id))?.profileId, { message: 'the change is made in the tablet\'s record' }).toBe(gentle.id);
            await expect.poll(async () => {
                const { profile } = await sync.decaid('GET', '/workflow');
                return { title: profile.title, temp: ownTemperature({ profile }), loaded: await selectedOn(sync) };
            }, { message: 'and its Workflow, at the profile\'s own temperature, the Recipe kept loaded' }).toEqual({ title: gentle.profile.title, temp: ownTemperature(gentle), loaded: String(mine.id) });

            await sync.startServer();
            stopped = false;
            await expect.poll(() => served(sync), { message: 'the plugin serves the Machine again', timeout: 120_000 }).toBe(true);
            await expect.poll(async () => {
                const now = await recipeOn(sync, id);
                return now && { profileId: now.content.profileId, brewTemperature: now.content.brewTemperature };
            }, { message: 'once the server is back it takes the change, at the profile\'s own temperature', timeout: 120_000 }).toEqual({ profileId: gentle.id, brewTemperature: ownTemperature(gentle) });
            await expect.poll(() => brewRow(second), { message: 'and the second tablet takes it, with no tap', timeout: 120_000 }).toEqual({ name: gentle.profile.title, temp: ownTemperature(gentle) });
            expect(await selectedOn(sync.second), 'the Recipe still loaded there').toBe(String(there.id));
            const after = await sync.decaid('GET', '/workflow');
            expect({ title: after.profile.title, loaded: await selectedOn(sync) }, 'this tablet kept it all along').toEqual({ title: gentle.profile.title, loaded: String(mine.id) });
            await expect.poll(() => legend(first), { message: 'with the server back the reference can be changed again', timeout: 120_000 })
                .toMatchObject({ notice: null, make: 'Make reference', muted: false, reference: expect.stringMatching(/ · /) });
            await expect(async () => {
                await openList(first);
                const under = (await shotsHeader(first)).under;
                await closeList(first);
                expect(under, 'the list is the Location\'s again').toBe(LOCATION);
            }).toPass({ timeout: 120_000 });
            expect([firstLoads(), secondLoads()], 'neither page was reloaded').toEqual([0, 0]);

            await chooseProfile(first, usual);
            await expect.poll(async () => (await recipeOn(sync, id))?.content.profileId, { message: 'the Recipe\'s own Profile back on the server', timeout: 120_000 }).toBe(usual.id);
        } finally {
            if (stopped) {
                await sync.startServer();
                await expect.poll(() => served(sync), { message: 'the plugin serves the Machine again', timeout: 120_000 }).toBe(true);
            }
            await putBack(sync, id, content);
            await setReference(sync, id, null);
        }
    });
});
