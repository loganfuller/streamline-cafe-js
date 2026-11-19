// The page's dialogs at a tablet's size (issue #39; once step 20 of the smoke
// run). A modal dialog draws in the top layer, outside Streamline's scaled
// canvas, so each carries a canvas of its own (`.cafe-dialog-canvas` in
// src/cafe/cafe.css), scaled by the factors src/modules/scaling.js sets. Each
// dialog is opened at 1920 by 1200, where the page's scale is 1 and its sizes
// are design px, then at 1340 by 800 and 1280 by 800: there each part measures
// its size at 1920 times the page's scale, within a pixel, the box fits inside
// the window, and nothing scrolls sideways. The Shots box's height is the
// screen's, less a margin, so it is checked only to fit.
//
// One page is resized rather than a page opened at each size, as the smoke run
// did: scaling.js adopts a window whose width changed at once (trackBaseline in
// src/modules/keyboard-fit.js), with no keyboard taken for it, and every dialog
// is opened afresh at each size, so what it draws comes from the factors then.
//
// Nothing here relies on a rule of Decaid's or DYE2's beyond reads: the
// grinders, beans and batches, DYE2's records and baskets, the profiles and the
// Shots are the sample data (fake-decaid/recordings/sample-data.json, boot.json).
// The recipe list needs a recipe in no slot, which the sample data has none of,
// so one is added to DYE2's records before the page opens. The Shots list draws
// stars only for a rated Shot, and the sample data's are unrated, so the newest
// is rated through Decaid's own Shot edit (recorded: recordings/shots.json),
// as the smoke run had by its step 20. The reference's
// dialog asks before a chosen reference is replaced, which needs one already
// chosen: it is opened as src/cafe/graph.js opens it, with made-up names in it.

import { test, expect } from './support/test.mjs';
import { tapAt, load } from './support/page-reads.mjs';
import { dialogDrawn } from '../cafe-smoke/page-helpers.mjs';
import { RECIPES } from '../cafe-smoke/sample-data.mjs';

const [house] = RECIPES;
const SIZES = [{ width: 1920, height: 1200 }, { width: 1340, height: 800 }, { width: 1280, height: 800 }];
const PICK = 'cafe-pick-dialog';

// What is measured of each, by name: the grinder, the bean, the basket, the
// profile and the barista share one <dialog>.
const PARTS = {
    'cafe-recipe-dialog': ['h3', '.cafe-recipe-row', '.cafe-recipe-row-name', '.modal-action .cafe-btn'],
    'cafe-pick-dialog': ['h3', '#cafe-pick-under', '.cafe-pick-head .cafe-btn', '.cafe-pick-row'],
    'cafe-bean-dialog': ['h3', '#cafe-pick-under', '.cafe-pick-head .cafe-btn', '#cafe-pick-side-heading', '.cafe-pick-side-row', '#cafe-pick-list .cafe-pick-row', '#cafe-pick-confirm'],
    'cafe-basket-dialog': ['h3', '#cafe-pick-under', '.cafe-pick-head .cafe-btn', '.cafe-pick-row'],
    'cafe-shots-dialog': ['h3', '.cafe-shots-head .cafe-btn', '.cafe-shots-columns', '.cafe-shots-row', '.cafe-shots-star'],
    'cafe-reference-dialog': ['h3', '#cafe-reference-dialog-recipe', '.cafe-reference-dialog-shots', '#cafe-reference-dialog-replace'],
    'cafe-note-dialog': ['h3', '#cafe-note-meta', '#cafe-note-text', '#cafe-note-save'],
    'cafe-barista-dialog': ['h3', '#cafe-pick-under', '.cafe-pick-head .cafe-btn', '#cafe-pick-list .cafe-pick-row', '#cafe-pick-add'],
    'cafe-barista-name-dialog': ['h3', '#cafe-pick-under', '#cafe-pick-entry-label', '#cafe-pick-entry-text', '#cafe-pick-entry-use'],
    'cafe-profile-dialog': ['h3', '#cafe-pick-under', '.cafe-pick-head .cafe-btn', '#cafe-pick-side-heading', '.cafe-pick-side-row', '#cafe-pick-pane-heading', '#cafe-pick-pane-title', '#cafe-pick-pane-byline', '#cafe-pick-pane-text', '#cafe-pick-pane-in-use'],
};

/** DYE2's records with one more recipe, in no slot, for the recipe list to list. */
function addRecipeInNoSlot(fake) {
    const records = fake.store.get('dye2.reaplugin', 'recipes');
    const like = records.find(row => row && row.name === house.name);
    fake.store.set('dye2.reaplugin', 'recipes', [...records, {
        ...like, id: 'sample-in-no-slot', name: 'Sample recipe in no slot', title: 'Sample recipe in no slot', stripSlot: null, showOnStreamlineDashboard: false,
    }]);
}

/**
 * The newest Shot rated four stars, as Decaid's own edit does, so the Shots
 * list draws a row's stars: the sample data's Shots are unrated.
 */
function rateNewestShot(fake) {
    const { body: newest } = fake.request({ method: 'GET', url: '/api/v1/shots/latest' });
    const { status } = fake.request({ method: 'PUT', url: `/api/v1/shots/${newest.id}`, body: { annotations: { enjoyment: 8 } } });
    expect(status).toBe(200);
}

/** The page, with a recipe loaded unless `recipe` is null. */
async function openPage(cafe, { recipe = house } = {}) {
    const page = await cafe.open();
    if (recipe) await load(cafe, recipe);
    return page;
}

/** The window at `viewport`, and the page's scale following it. */
async function resize(cafe, { width, height }) {
    const { page } = cafe;
    if (page.viewportSize().width !== width || page.viewportSize().height !== height) {
        await page.setViewportSize({ width, height });
        // The resize is handled on the next frame, and once more 250 ms on.
        await cafe.advance(500);
    }
    const scale = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--streamline-scale-x'));
    await expect.poll(async () => Number(await scale()), 'the page\'s scale follows the window').toBeCloseTo(width / 1920, 6);
}

/**
 * Opens one dialog at each size in turn, measures it, takes its screenshot and
 * closes it. Its parts at 1340 and 1280 are compared with their size at 1920.
 */
async function atEachSize(cafe, name, { open, close, id = name }) {
    const { page } = cafe;
    let design = null;
    for (const viewport of SIZES) {
        const size = `${viewport.width}x${viewport.height}`;
        await resize(cafe, viewport);
        await open();
        await expect(page.locator(`#${id}[open]`), `${size}: ${name} opens`).toBeVisible();
        await cafe.settle();
        const drawn = await dialogDrawn(page, id, PARTS[name]);
        expect(drawn, `${size}: ${name} is open to measure`).not.toBeNull();
        await cafe.screenshot(`dialog-${name.replace(/^cafe-|-dialog$/g, '')}-${size}-light`);

        const [width, height] = drawn.window;
        const { box } = drawn;
        expect(box.left >= 0 && box.top >= 0 && box.right <= width && box.bottom <= height, `${size}: ${name} fits inside the window (${JSON.stringify(box)})`).toBe(true);
        expect(drawn.sideways, `${size}: ${name} shows no sideways scrollbar`).toEqual([]);
        if (viewport.width === 1920) {
            expect([drawn.scaleX, drawn.scaleY], `${size}: the page's scale is 1, so ${name} is in design px`).toEqual([1, 1]);
            design = drawn;
        } else {
            const off = offFromDesign(name, drawn, design);
            expect(off, `${size}: ${name}'s heading, text, rows and buttons are their size at 1920 times the page's scale (${Math.round(drawn.scaleX * 1000) / 1000})`).toEqual([]);
        }

        await close();
        await expect(page.locator(`#${id}:not([open])`)).toBeAttached();
        if (id === PICK) await expect(page.locator('#cafe-pick-list .cafe-pick-row')).toHaveCount(0);
        await cafe.settle();
    }
}

/** Each part, and the box, whose size is not its size at 1920 times the scale, within a pixel. */
function offFromDesign(name, drawn, design) {
    const parts = { ...drawn.parts, box: name === 'cafe-shots-dialog' ? [drawn.box.size[0], null] : drawn.box.size };
    const want = { ...design.parts, box: design.box.size };
    return Object.entries(parts).flatMap(([part, measured]) => {
        const at1920 = want[part];
        if (!measured || !at1920) return [`${part}: ${measured ? 'not at 1920' : 'missing'}`];
        // A part that isn't drawn measures 0 at every size, and proves nothing.
        if ([...measured, ...at1920].includes(0)) return [`${part}: not drawn (${measured.join(' × ')}, ${at1920.join(' × ')} at 1920)`];
        return measured.flatMap((value, axis) => {
            if (value === null) return [];
            const expected = at1920[axis] * (axis === 0 ? drawn.scaleX : drawn.scaleY);
            return Math.abs(value - expected) <= 1 ? [] : [`${part} ${axis === 0 ? 'width' : 'height'} ${value}, not ${Math.round(expected * 10) / 10}`];
        });
    });
}

const closePick = cafe => () => cafe.page.locator('#cafe-pick-dialog .cafe-pick-head .cafe-btn').click();
/** A tap on a dial-in row's name, which opens its dialog. */
const rowName = (cafe, section) => () => tapAt(cafe.page, `#${section} .cafe-row-name`);

/** A finger held on a card past Streamline's half second, and the menu it opens. */
async function holdCard(cafe, slot) {
    const { page } = cafe;
    const box = await page.locator('#cafe-strip .cafe-card').nth(slot - 1).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await cafe.advance(600);
    await page.mouse.up();
    await expect(page.locator('#app-context-menu.context-menu--open')).toBeVisible();
}

test.describe('the dialogs at a tablet\'s size', { tag: '@dialogs' }, () => {
    test('the recipe list, from an empty slot\'s menu', async ({ cafe, fake }) => {
        addRecipeInNoSlot(fake);
        const page = await openPage(cafe);
        await atEachSize(cafe, 'cafe-recipe-dialog', {
            open: async () => {
                await holdCard(cafe, 4);
                const item = page.locator('#app-context-menu.context-menu--open .context-menu__item').nth(1);
                await expect(item, 'slot 4 is empty, so its menu offers the list').toHaveText('Choose a recipe…');
                await item.click();
            },
            close: () => page.locator('#cafe-recipe-dialog .modal-action button').click(),
        });
    });

    test('the grinder dialog', async ({ cafe }) => {
        await openPage(cafe);
        await atEachSize(cafe, PICK, { open: rowName(cafe, 'grind-section'), close: closePick(cafe) });
    });

    test('the bean dialog', async ({ cafe }) => {
        await openPage(cafe);
        await atEachSize(cafe, 'cafe-bean-dialog', { id: PICK, open: rowName(cafe, 'dose-section'), close: closePick(cafe) });
    });

    test('the basket dialog', async ({ cafe }) => {
        await openPage(cafe);
        await atEachSize(cafe, 'cafe-basket-dialog', { id: PICK, open: rowName(cafe, 'drink-section'), close: closePick(cafe) });
    });

    test('the profile dialog', async ({ cafe }) => {
        await openPage(cafe);
        await atEachSize(cafe, 'cafe-profile-dialog', { id: PICK, open: rowName(cafe, 'brew-section'), close: closePick(cafe) });
    });

    test('the Shots list', async ({ cafe, fake }) => {
        rateNewestShot(fake);
        const page = await openPage(cafe);
        await atEachSize(cafe, 'cafe-shots-dialog', {
            open: () => page.locator('#cafe-shots-btn').click(),
            close: () => page.locator('#cafe-shots-dialog .cafe-shots-head .cafe-btn').click(),
        });
    });

    test('the reference\'s dialog', async ({ cafe }) => {
        const page = await openPage(cafe);
        await atEachSize(cafe, 'cafe-reference-dialog', {
            open: () => page.evaluate(() => {
                document.getElementById('cafe-reference-dialog-recipe').textContent = 'Sample Espresso';
                document.getElementById('cafe-reference-dialog-new').textContent = 'Today 09:41 · Sample Barista';
                document.getElementById('cafe-reference-dialog-old').textContent = 'Yesterday 16:05 · Sample Barista';
                document.getElementById('cafe-reference-dialog').showModal();
            }),
            close: () => page.locator('#cafe-reference-dialog button', { hasText: 'Cancel' }).click(),
        });
    });

    // With no recipe loaded the graph holds the tablet's newest Shot, "Last shot".
    test('the note dialog', async ({ cafe }) => {
        const page = await openPage(cafe, { recipe: null });
        await expect(page.locator('#cafe-shot-note'), 'a Shot to write a note on is in the graph').toBeVisible();
        await atEachSize(cafe, 'cafe-note-dialog', {
            open: () => page.locator('#cafe-shot-note').click(),
            close: () => page.locator('#cafe-note-cancel').click(),
        });
    });

    test('the barista dialog', async ({ cafe }) => {
        const page = await openPage(cafe);
        await atEachSize(cafe, 'cafe-barista-dialog', { id: PICK, open: () => page.locator('#cafe-barista').click(), close: closePick(cafe) });
    });

    test('the barista\'s name field', async ({ cafe }) => {
        const page = await openPage(cafe);
        await atEachSize(cafe, 'cafe-barista-name-dialog', {
            id: PICK,
            open: async () => {
                await page.locator('#cafe-barista').click();
                await expect(page.locator('#cafe-pick-add')).toBeVisible();
                await page.locator('#cafe-pick-add').click();
                await expect(page.locator('#cafe-pick-entry-text')).toBeVisible();
            },
            close: closePick(cafe),
        });
    });
});
