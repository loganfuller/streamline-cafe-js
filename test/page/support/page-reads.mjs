// What the page tests read off the page and do on it, beyond the smoke run's
// own readers in test/cafe-smoke/page-helpers.mjs, which they share.

import { expect } from './test.mjs';

export { legend, chartLines, row, keys, sides, stageNames, paint, noteDialog, REFERENCE_LINES } from '../../cafe-smoke/page-helpers.mjs';

/** The page, with a tablet's numbers opening the numpad, as Streamline decides at start. */
export async function openPage(cafe) {
    await cafe.open({ before: () => { window._forceNumpadMobile = true; } });
    return cafe.page;
}

/** A recipe's card on the strip, by its slot. */
export const card = (page, slot) => page.locator('#cafe-strip .cafe-card').nth(slot - 1);

/** A tap on a recipe's card, and the load through Streamline's apply settled. */
export async function load(cafe, recipe) {
    await card(cafe.page, recipe.slot).click();
    await expect(cafe.page.locator('#cafe-title')).toHaveText(recipe.name);
    await cafe.advance(2000);
}

export const pickDialog = page => page.locator('#cafe-pick-dialog[open]');
export const pickClosed = page => page.locator('#cafe-pick-dialog:not([open])');
export const pickRows = page => page.locator('#cafe-pick-list .cafe-pick-row').evaluateAll(rows => rows.map(row => ({
    name: row.querySelector('.cafe-pick-row-name').textContent,
    detail: row.querySelector('.cafe-pick-row-detail').textContent,
    inUse: !!row.querySelector('.cafe-pick-in-use') && (row.parentElement.classList.contains('cafe-pick-confirming') || row.getAttribute('aria-pressed') === 'true'),
})));
export const pickRow = (page, name) => page.locator('#cafe-pick-list .cafe-pick-row').filter({ has: page.locator('.cafe-pick-row-name', { hasText: name }) });

/**
 * The pick dialog closed, and its close event handled, which empties its list
 * and lets it open again: a tap before that opens nothing
 * (src/cafe/pick-dialog.js, `active`).
 */
export async function untilPickClosed(cafe) {
    await expect(pickClosed(cafe.page)).toBeAttached();
    await expect(cafe.page.locator('#cafe-pick-list .cafe-pick-row')).toHaveCount(0);
    await cafe.settle();
}

/**
 * A tap where a finger lands: on a row's name, or the name under it. The two
 * sit inside one button and take no pointer events of their own.
 */
export async function tapAt(page, selector) {
    const box = await page.locator(selector).boundingBox();
    await page.mouse.click(box.x + Math.min(box.width / 2, 40), box.y + box.height / 2);
}

/** Every write to Decaid, the store and DYE2 included: anything asked but a read. */
export const isWrite = entry => entry.method !== 'GET' && entry.method !== 'HEAD' && entry.method !== 'OPTIONS';
/** The writes since a mark, as "METHOD path" with the body, for a test to compare whole. */
export const writes = entries => entries.filter(isWrite).map(({ method, path, body }) => ({ write: `${method} ${path}`, body }));

/** The menu a press held on a card opens (Streamline's context menu). */
export const menu = page => page.locator('#app-context-menu.context-menu--open');
/** Its items' text, in order. */
export const menuItems = page => menu(page).locator('.context-menu__item').allTextContents();

/** A finger held on a card past Streamline's half second, let go, and the menu it opened. */
export async function holdCard(cafe, slot) {
    const { page } = cafe;
    const box = await card(page, slot).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await cafe.advance(600);
    await page.mouse.up();
    await expect(menu(page)).toBeVisible();
}
