// What the journeys on `stacks.decaid` (decaid.spec.mjs, official-streamline.spec.mjs)
// share beyond journey.mjs: a known state to start from, DYE2's selection and
// the Workflow read off the real Decaid, the cafe page's no-recipe look, and the
// long-press menu held in real time.

import { expect, DYE2, card, recipeIdOf } from './journey.mjs';

export const SELECTION = `/plugins/${DYE2}/selection`;
/** The page's unload, as it reaches Decaid: DYE2's selection cleared. */
export const isUnload = request => request.method() === 'POST' && new URL(request.url()).pathname === `/api/v1${SELECTION}`;

/** DYE2's selection as it derives it now (`GET /plugins/dye2.reaplugin/selection`). */
export const selection = side => side.decaid('GET', SELECTION);
/** The recipe id the Workflow names as loaded, or null. */
export const loadedInWorkflow = async side => recipeIdOf(await side.decaid('GET', '/workflow'));

/**
 * The state each journey starts from, whatever the one before left: no recipe
 * loaded (DYE2's selection cleared, which writes the Workflow's marker alone)
 * and no barista (a context field written as null is dropped by Decaid's merge).
 */
export async function startClean(side) {
    await side.decaid('POST', SELECTION, {});
    await side.decaid('PUT', '/workflow', { context: { baristaName: null } });
    expect(await loadedInWorkflow(side), 'no recipe loaded to start with').toBeNull();
}

/**
 * What DYE2 derives once no recipe is loaded: nothing, or one of its recent
 * favourites the Workflow matches (DYE2 v0.1.42, `utils/recent-favs.ts`), which
 * on this stack is likely after a Shot pulled on the same settings.
 */
export function expectNoRecipeSelected(derived) {
    if (derived === null) return;
    expect(derived, 'a recent favourite the Workflow matches, not a recipe').toMatchObject({ kind: 'favourite', auto: true });
    expect(derived.id).toMatch(/^recent:/);
}

export const pressed = page => page.locator('#cafe-strip .cafe-card[aria-pressed="true"]');

/** The no-recipe page: its title band, the dial-in's label, and no card pressed. */
export async function expectNoRecipePage(page) {
    await expect(page.locator('#cafe-title')).toHaveText('No recipe selected');
    await expect(page.locator('#cafe-dial-label')).toHaveText('Dial-in · not saved to a recipe');
    await expect(pressed(page)).toHaveCount(0);
}

/** The Workflow without the marker that says which recipe is loaded: what the machine is set to. */
export function settingsOf(workflow) {
    const copy = structuredClone(workflow);
    if (copy.context?.extras?.dye) delete copy.context.extras.dye.recipeId;
    return copy;
}

/** The menu a press held on a card opens (Streamline's context menu). */
export const menu = page => page.locator('#app-context-menu.context-menu--open');

/**
 * A finger held on a card until Streamline's press-and-hold opens its menu
 * (its timer fires while the press is held: src/modules/ui.js,
 * `setupPressAndHold`), then lifted, and the item picked.
 */
export async function holdAndPick(page, slot, item) {
    const box = await card(page, slot).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(menu(page), 'the press opens the menu').toBeVisible();
    await page.mouse.up();
    const entry = menu(page).locator('.context-menu__item').filter({ hasText: item });
    await expect(entry).toHaveCount(1);
    await entry.click();
    await expect(menu(page)).toBeHidden();
}
