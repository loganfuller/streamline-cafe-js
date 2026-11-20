// What the Decent Sync journeys (test/real/decent-sync.spec.mjs) read of the
// sync stack and do on its tablets: the server's Recipe, Machines and Shots,
// each Decaid's DYE2 record of a Recipe and its selection, and the page's
// dialogs as a finger works them. Reads that a poll repeats answer null for a
// server that can't be reached rather than throw, so a poll keeps polling
// through an outage.

import { expect, pull, DYE2, recipeIdOf, card } from './journey.mjs';
import { RECIPES } from '../../page/support/sample-data.mjs';

export const HOUSE = RECIPES[0];
export const LOCATION = 'Sample Cafe';
export const MACHINE = 'Sample Machine';
export const MACHINE_TWO = 'Sample Machine Two';
export const SAVED_LABEL = 'Dial-in · saved to the recipe';
export const BADGE = 'This shot is the reference';
/** The plugin's poll interval: `PollSeconds` is 5 in scripts/fake-decaid-recorder/decent-sync.mjs. */
export const POLL_MS = 5_000;

/** `fn()`'s answer, or null where it throws: a server stopped, a Shot not there yet. */
export async function maybe(fn) {
    try {
        return await fn();
    } catch {
        return null;
    }
}

// ── The server ───────────────────────────────────────────────────────────────

/** The Location's Recipe in slot 1 (House espresso), whatever it is called now: its id. */
export async function houseId(sync) {
    const { recipes } = await sync.server('GET', `/locations/${sync.location.id}/recipes`);
    const found = recipes.find(recipe => recipe.slot === HOUSE.slot);
    if (!found) throw new Error('the Location has no Recipe in slot 1');
    return found.id;
}

/**
 * The content the sample data gives House espresso on the server, in the
 * Location's ids, as read off the first Decaid's Library (each item's
 * `decentSyncId`): every field a journey changes. The Bean is left out: the
 * server takes it from the batch, and its PATCH refuses `beanId`.
 */
export async function sampleContent(sync) {
    const list = answer => (Array.isArray(answer) ? answer : answer?.items || []);
    const profile = await profileOn(sync, HOUSE.profile);
    const grinder = await grinderOn(sync, 'Sample Grinder 64');
    const bean = list(await sync.decaid('GET', '/beans')).find(row => row.name === HOUSE.bean);
    const batch = list(await sync.decaid('GET', `/beans/${bean.id}/batches`)).find(row => row.roastDate.startsWith('2026-11-02'));
    const basket = (await sync.decaid('GET', `/store/${DYE2}/baskets`)).find(row => row.name === HOUSE.basket);
    return {
        name: HOUSE.name, dose: HOUSE.dose, yield: HOUSE.yield,
        profileId: profile.id, brewTemperature: ownTemperature(profile),
        grinderId: grinder.extras.decentSyncId, grindSetting: parseFloat(HOUSE.grind), rpm: null,
        beanBatchId: batch.extras.decentSyncId, basketId: basket.decentSyncId,
    };
}

/** A Recipe as the server holds it: `{ content, uses, referenceShot, name, … }`, or null. */
export const recipeOn = (sync, id) => maybe(async () => (await sync.server('GET', `/recipes/${id}`)).recipe);
/** Its Reference Shot's id, or null for none (or no answer). */
export const referenceOn = async (sync, id) => (await recipeOn(sync, id))?.referenceShot?.id ?? null;
export const setReference = (sync, id, shotId) => sync.server('PUT', `/recipes/${id}/reference-shot`, { shotId });
/** The Recipe the server shows loaded on a Machine, or null. */
export const loadedOn = async (sync, machineId) => (await maybe(() => sync.server('GET', `/machines/${machineId}`)))?.machine?.loadedRecipe?.recipe?.id ?? null;
/** A Shot as the server holds it: `{ rating, note, recipe }`, each null for none, or null where it has no such Shot. */
export async function shotOn(sync, shotId) {
    const answer = await maybe(() => sync.server('GET', `/shots/${shotId}`));
    if (!answer?.shot) return null;
    const { shot } = answer;
    return { rating: shot.enjoyment || null, note: shot.record?.annotations?.espressoNotes || null, recipe: shot.recipe ? shot.recipe.id ?? shot.recipe : null };
}

// ── A Decaid ─────────────────────────────────────────────────────────────────

/** A Decaid's DYE2 record of a Recipe, by the Recipe's id (`decentSyncId`), or null. */
export const recordFor = async (side, recipeId) => ((await maybe(() => side.decaid('GET', `/store/${DYE2}/recipes`))) || []).find(row => row && row.decentSyncId === recipeId) || null;
/** The DYE2 record id a Decaid's selection names, or null for none. */
export async function selectedOn(side) {
    const now = await maybe(() => side.decaid('GET', `/plugins/${DYE2}/selection`));
    return now?.kind === 'recipe' ? String(now.id) : null;
}
/** A Shot's rating and note as the Decaid that holds it has them. */
export async function annotationsOn(side, shotId) {
    const annotations = (await side.decaid('GET', `/shots/${shotId}`)).annotations || {};
    return { rating: annotations.enjoyment || null, note: annotations.espressoNotes || null };
}
/** The record's grinder, batch and basket, by Decaid's own ids, wherever DYE2 keeps them. */
export const recordGrinder = row => String(row?.grinderId ?? row?.workflow?.context?.grinderId ?? '');
export const recordBatch = row => String(row?.beanBatchId ?? row?.workflow?.context?.beanBatchId ?? '');
/** A Decaid's Grinder by model. */
export const grinderOn = async (side, model) => {
    const listed = await side.decaid('GET', '/grinders');
    return (Array.isArray(listed) ? listed : listed.items || []).find(grinder => grinder.model === model) || null;
};
/** A bean's batches that are not archived on a Decaid, by the bean's name. */
export async function batchesOn(side, beanName) {
    const list = answer => (Array.isArray(answer) ? answer : answer?.items || []);
    const bean = list(await side.decaid('GET', '/beans')).find(row => row && row.name === beanName);
    return bean ? list(await side.decaid('GET', `/beans/${bean.id}/batches`)).filter(batch => !batch.archived) : [];
}
/** A Decaid's profile by title: `{ id, profile }`. */
export const profileOn = async (side, title) => (await side.decaid('GET', '/profiles')).find(entry => entry.profile?.title === title) || null;
/** A profile's own brew temperature: its first step's. */
export const ownTemperature = entry => entry.profile.steps[0].temperature;

/** DYE2's selection cleared on both Decaids, as an unload leaves it: each journey loads afresh from there. */
export async function nothingLoaded(sync) {
    for (const side of [sync, sync.second]) await side.decaid('POST', `/plugins/${DYE2}/selection`, {});
}

/**
 * A Shot on the first Decaid pulled with House espresso loaded, which the
 * server holds: the newest there is, or one pulled now. Shots pulled may stay
 * (they are each journey's to read, never to change), so a journey that needs
 * one but not a fresh one takes it from here. `behindLatest` answers one that
 * is not the Recipe's latest on the Machine, which a page then draws behind
 * the latest rather than as it.
 */
export async function houseShot(sync, recordId, { behindLatest = false } = {}) {
    const houseShots = async () => ((await sync.decaid('GET', '/shots?limit=50')).items || []).filter(item => recipeIdOf(item.workflow) === recordId);
    const record = (await sync.decaid('GET', `/store/${DYE2}/recipes`)).find(row => row.id === recordId);
    const wanted = behindLatest ? 2 : 1;
    const had = (await houseShots()).length;
    for (let pulled = had; pulled < wanted; pulled += 1) {
        await pull(sync.decaid, {
            workflow: { context: { ...record.workflow.context, extras: { ...record.workflow.context.extras, dye: { v: 1, recipeId: recordId } }, baristaName: 'Sample Barista' }, profile: record.workflow.profile },
        });
    }
    // The Workflow written for the pull named the Recipe, which DYE2 then selected: nothing loaded again.
    if (had < wanted) await sync.decaid('POST', `/plugins/${DYE2}/selection`, {});
    const shot = (await houseShots())[wanted - 1];
    await expect.poll(() => shotOn(sync, shot.id), { message: 'the server holds the Shot', timeout: 60_000 }).not.toBeNull();
    return shot;
}

// ── A tablet's page ──────────────────────────────────────────────────────────

/** How many times a page loads from now on: a reload would show here. */
export function loadsOf(page) {
    let loads = 0;
    page.on('load', () => { loads += 1; });
    return () => loads;
}

/**
 * A tap on the card in `slot` (named `name` now), the load seen on the page,
 * in the Decaid's selection, and on the server as the Machine's Loaded Recipe.
 * Answers the Decaid's record of it.
 */
export async function loadHouse(page, side, sync, { machineId, recipeId, name = HOUSE.name }) {
    const record = await recordFor(side, recipeId);
    await expect(card(page, HOUSE.slot)).toContainText(name);
    await expect(card(page, HOUSE.slot), 'not loaded yet: a tap on a loaded card unloads it').not.toHaveAttribute('aria-pressed', 'true');
    await card(page, HOUSE.slot).click();
    await expect(page.locator('#cafe-title')).toHaveText(name);
    await expect.poll(() => selectedOn(side), { message: `${name} is DYE2's selection` }).toBe(String(record.id));
    await expect(page.locator('#cafe-dial-label'), 'the page has the Machine served').toHaveText(SAVED_LABEL);
    await expect.poll(() => loadedOn(sync, machineId), { message: `the server shows ${name} loaded`, timeout: 60_000 }).toBe(recipeId);
    return record;
}

/** A tap where a finger lands on a row's name, which takes no pointer events itself, and the pick dialog open. */
export async function openPick(page, section) {
    const box = await page.locator(`${section} .cafe-row-name`).boundingBox();
    await page.mouse.click(box.x + Math.min(box.width / 2, 40), box.y + box.height / 2);
    await expect(page.locator('#cafe-pick-dialog[open]')).toBeVisible();
    await expect(page.locator('#cafe-pick-list .cafe-pick-row, #cafe-pick-side .cafe-pick-row, #cafe-pick-side .cafe-pick-side-row').first()).toBeVisible();
}
/** The pick dialog closed and emptied, ready to open again. */
export async function pickClosed(page) {
    await expect(page.locator('#cafe-pick-dialog:not([open])')).toBeAttached();
    await expect(page.locator('#cafe-pick-list .cafe-pick-row')).toHaveCount(0);
}
const named = (page, rows, name) => page.locator(rows).filter({ has: page.locator('.cafe-pick-row-name', { hasText: name }) });

/** Another grinder chosen in the grinder dialog. */
export async function chooseGrinder(page, model) {
    await openPick(page, '#grind-section');
    await named(page, '#cafe-pick-list .cafe-pick-row', model).click();
    await pickClosed(page);
    await expect(page.locator('#cafe-grind-desc')).toHaveText(model);
}

/** A batch chosen in the bean dialog: its bean highlighted, the batch, then "Use this batch" (#70). */
export async function chooseBatch(page, beanName, batchName) {
    await openPick(page, '#dose-section');
    await named(page, '#cafe-pick-side .cafe-pick-row', beanName).click();
    await expect(page.locator('#cafe-pick-side .cafe-pick-row[aria-pressed="true"] .cafe-pick-row-name')).toHaveText(beanName);
    await named(page, '#cafe-pick-list .cafe-pick-row', batchName).click();
    await expect(page.locator('#cafe-pick-confirm-use')).toBeEnabled();
    await page.locator('#cafe-pick-confirm-use').click();
    await pickClosed(page);
}

/** A profile chosen in the profile dialog: highlighted by its id, then "Use". */
export async function chooseProfile(page, entry) {
    await openPick(page, '#brew-section');
    await page.locator(`#cafe-pick-side .cafe-pick-side-row[data-id="${entry.id}"]`).click();
    await expect(page.locator('#cafe-pick-pane-title')).toHaveText(entry.profile.title);
    await page.locator('#cafe-pick-pane-use').click();
    await pickClosed(page);
}

/** The Brew row: the profile's name and the temperature. */
export const brewRow = async page => ({ name: (await page.locator('#profile-name').textContent()).trim(), temp: parseFloat(await page.locator('#temp-value').textContent()) });
/** The Grind row: the grinder's name and the setting. */
export const grindRow = async page => ({ name: await page.locator('#cafe-grind-desc').textContent(), value: parseFloat(await page.locator('#grind-value').textContent()) });

/** The Shots list opened, its rows drawn. */
export async function openList(page) {
    await page.locator('#cafe-shots-btn').click();
    await expect(page.locator('#cafe-shots-dialog')).toHaveAttribute('open', '');
    await expect(page.locator('#cafe-shots-list .cafe-shots-row').first()).toBeVisible();
}
/** The Shots list closed by its Close button. */
export async function closeList(page) {
    await page.locator('#cafe-shots-dialog .cafe-shots-head .cafe-btn-primary').click();
    await expect(page.locator('#cafe-shots-dialog')).not.toHaveAttribute('open', '');
}
/** The open list's rows: each Shot's id, and the Machine it names where that cell shows. */
export const listRows = page => page.evaluate(() => [...document.querySelectorAll('#cafe-shots-list .cafe-shots-row')].map(row => {
    const cell = row.querySelector('.cafe-shots-machine-name');
    return { id: row.dataset.shotId, machine: cell && cell.offsetParent !== null ? cell.textContent.trim() : null };
}));
