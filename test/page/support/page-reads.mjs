// What the page tests read off the page and do on it, beyond the smoke run's
// own readers in test/cafe-smoke/page-helpers.mjs, which they share.

export { legend, chartLines, row, keys, sides, stageNames, paint, REFERENCE_LINES } from '../../cafe-smoke/page-helpers.mjs';

export const pickDialog = page => page.locator('#cafe-pick-dialog[open]');
export const pickClosed = page => page.locator('#cafe-pick-dialog:not([open])');
export const pickRows = page => page.locator('#cafe-pick-list .cafe-pick-row').evaluateAll(rows => rows.map(row => ({
    name: row.querySelector('.cafe-pick-row-name').textContent,
    detail: row.querySelector('.cafe-pick-row-detail').textContent,
    inUse: !!row.querySelector('.cafe-pick-in-use') && (row.parentElement.classList.contains('cafe-pick-confirming') || row.getAttribute('aria-pressed') === 'true'),
})));
export const pickRow = (page, name) => page.locator('#cafe-pick-list .cafe-pick-row').filter({ has: page.locator('.cafe-pick-row-name', { hasText: name }) });

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
