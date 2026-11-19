// A touchscreen whose screen rests short of its window, and the soft keyboard
// (issue #38; once step 19 of the smoke run). A button takes focus as it is
// pressed, and Streamline's keyboard lift used to move the canvas then, so the
// button left the finger and the first tap missed. One tap on Settings, Shots
// or Sleep acts, and the canvas doesn't move. A keyboard over a Shot's note
// still leaves the note's dialog in view, through Streamline's own scaling
// (src/modules/scaling.js, keyboard-fit.js; src/cafe/note-dialog.js), and a
// button focused with the keyboard up is lifted clear of it.
//
// The tablet is a 1340x800 Android WebView whose visualViewport rests half a
// pixel, or a 30 px system bar, short of the window; a keyboard is the
// visualViewport made shorter still, with the resize a WebView sends. Its
// machine has buttons of its own (GHC), so Settings, Shots and Sleep sit at the
// bottom of the dial-in column. Nothing here leans on a recorded scenario: the
// sleep request is answered by the fake's machine (fake-decaid/index.js), the
// Shots list and the Shot in the graph by the sample data
// (fake-decaid/recordings/sample-data.json).

import { test, expect } from './support/test.mjs';
import { noteDialog } from './support/page-reads.mjs';
import { KEYBOARD_GAP, SHRINK_ADOPT_MS } from '../../src/modules/keyboard-fit.js';

const WIDTH = 1340;
const HEIGHT = 800;
const KEYBOARD = 360;
const SLEEP = 'PUT /api/v1/machine/state/sleeping';

// On the page, before any of its own scripts: visualViewport's height is
// `window.__cafeSmokeShort` px short of the window, and every change of the
// canvas's transform is kept in `window.__cafeTransforms`.
function shortScreen() {
    const height = Object.getOwnPropertyDescriptor(VisualViewport.prototype, 'height');
    Object.defineProperty(VisualViewport.prototype, 'height', {
        configurable: true,
        get() { return Math.max(0, height.get.call(this) - window.__cafeSmokeShort); },
    });
    window.__cafeTransforms = [];
    document.addEventListener('DOMContentLoaded', () => {
        const content = document.getElementById('scaled-content');
        new MutationObserver(() => window.__cafeTransforms.push(content.style.transform))
            .observe(content, { attributes: true, attributeFilter: ['style'] });
    });
}

/**
 * The page on a screen `short` px short of its window, with the machine's own
 * buttons, long enough after load that a shrink would have been adopted.
 * Returns the canvas's transform at rest.
 */
async function openShort(cafe, fake, short) {
    fake.patchBoot('GET /api/v1/machine/info', info => ({ ...info, GHC: true }));
    await cafe.page.addInitScript(gap => { window.__cafeSmokeShort = gap; }, short);
    await cafe.open({ before: shortScreen });
    await cafe.advance(SHRINK_ADOPT_MS + 500);
    expect(await moved(cafe.page), 'the log saw the canvas laid out at load').not.toEqual([]);
    return transform(cafe.page);
}

const transform = page => page.evaluate(() => document.getElementById('scaled-content').style.transform);
const forget = page => page.evaluate(() => { window.__cafeTransforms.length = 0; });
const moved = page => page.evaluate(() => window.__cafeTransforms.slice());
const focused = page => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
const bottomOf = locator => locator.evaluate(element => Math.round(element.getBoundingClientRect().bottom));

/** A keyboard that leaves the screen `short` px short of the window, as its resize reaches the page. */
async function keyboard(cafe, short) {
    await cafe.page.evaluate(gap => {
        window.__cafeSmokeShort = gap;
        window.visualViewport.dispatchEvent(new Event('resize'));
    }, short);
    // Past the resize's frame and scaling.js's settle pass 250 ms after it.
    await cafe.advance(600);
}

test.describe('a short touchscreen and the soft keyboard', { tag: '@touch' }, () => {
    test.use({
        viewport: { width: WIDTH, height: HEIGHT },
        hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Safari/537.36',
    });

    for (const short of [0.5, 30]) {
        test.describe(`${short} px short`, () => {
            test('the machine\'s buttons end inside the band the lift used to catch; one tap on Shots opens the list, and the canvas doesn\'t move', async ({ cafe, fake }) => {
                const resting = await openShort(cafe, fake, short);
                const { page } = cafe;
                const bottom = await bottomOf(page.locator('#cafe-system'));
                expect(bottom + KEYBOARD_GAP, `the buttons, ending at ${bottom} of ${HEIGHT}, end within ${KEYBOARD_GAP} px of the screen's bottom`).toBeGreaterThan(HEIGHT - short);
                expect(bottom, 'and on the screen').toBeLessThanOrEqual(HEIGHT);

                await forget(page);
                await page.locator('#cafe-shots-btn').tap();
                await expect(page.locator('#cafe-shots-dialog[open]')).toBeVisible();
                await cafe.advance(500);
                expect(await moved(page), 'the canvas never moved').toEqual([]);
                await cafe.screenshot(`touch-${short}px-shots`);

                await page.keyboard.press('Escape');
                await expect(page.locator('#cafe-shots-dialog:not([open])')).toBeAttached();
                await cafe.advance(500);
                expect(await focused(page), 'focus back on Shots').toBe('cafe-shots-btn');
                expect(await transform(page), 'the canvas where it was').toBe(resting);
            });

            test('one tap on Sleep asks for sleep, and the canvas doesn\'t move', async ({ cafe, fake }) => {
                await openShort(cafe, fake, short);
                const { page } = cafe;
                const mark = fake.log.length;
                await forget(page);
                await page.locator('#sleep-button').tap();
                await cafe.advance(1000);
                expect(cafe.since(mark, entry => `${entry.method} ${entry.path}` === SLEEP), 'one request for sleep').toHaveLength(1);
                expect(await moved(page), 'the canvas never moved').toEqual([]);
            });

            test('one tap on Settings opens the settings page, and the canvas doesn\'t move', async ({ cafe, fake }) => {
                await openShort(cafe, fake, short);
                const { page } = cafe;
                await forget(page);
                await page.locator('#settings-btn').tap();
                await expect(page.locator('#subpage-host #settings-content-area')).toBeVisible();
                expect(await moved(page), 'the canvas never moved').toEqual([]);
            });

            test('a keyboard over the note\'s text leaves the dialog above it, and a button focused with it up is lifted clear', async ({ cafe, fake }) => {
                const resting = await openShort(cafe, fake, short);
                const { page } = cafe;
                const visible = HEIGHT - short - KEYBOARD;

                await expect(page.locator('#cafe-shot-note'), 'a Shot to write a note on is in the graph').toBeVisible();
                await page.locator('#cafe-shot-note').tap();
                await expect(page.locator('#cafe-note-dialog[open]')).toBeVisible();
                await page.locator('#cafe-note-text').tap();
                await keyboard(cafe, short + KEYBOARD);

                const typing = await noteDialog(page);
                expect(typing, 'the note\'s dialog is open').not.toBeNull();
                expect(await focused(page)).toBe('cafe-note-text');
                await cafe.screenshot(`touch-${short}px-note-keyboard`);
                expect(typing.box.top, 'the dialog\'s top on the screen').toBeGreaterThanOrEqual(0);
                expect(typing.box.bottom, `the dialog above the keyboard, in ${visible}`).toBeLessThanOrEqual(visible + 1);

                // Save note takes focus with the keyboard still up: the dialog
                // still fits, and the button is above the keyboard.
                await page.locator('#cafe-note-save').focus();
                await cafe.advance(300);
                expect(await focused(page)).toBe('cafe-note-save');
                expect(await bottomOf(page.locator('#cafe-note-save')), `Save note above the keyboard, in ${visible}`).toBeLessThanOrEqual(visible + 1);

                // Cancel with the keyboard still up: focus goes back to the
                // note's button, whose canvas is lifted so it clears the keyboard.
                await page.locator('#cafe-note-cancel').focus();
                await page.keyboard.press('Enter');
                await expect(page.locator('#cafe-note-dialog:not([open])')).toBeAttached();
                await cafe.advance(400);
                expect(await focused(page)).toBe('cafe-shot-note');
                const back = await bottomOf(page.locator('#cafe-shot-note'));
                expect(back, 'the note\'s button on the screen').toBeGreaterThan(0);
                expect(back, `and above the keyboard, in ${visible}`).toBeLessThanOrEqual(visible);

                // Shots, at the screen's bottom, focused with the keyboard
                // still up: the canvas lifts so it clears the keyboard.
                await page.locator('#cafe-shots-btn').focus();
                await cafe.advance(300);
                const low = await bottomOf(page.locator('#cafe-shots-btn'));
                expect(low, 'Shots on the screen').toBeGreaterThan(0);
                expect(low, `and above the keyboard, in ${visible} (canvas "${await transform(page)}")`).toBeLessThanOrEqual(visible);

                await keyboard(cafe, short);
                expect(await transform(page), 'once the keyboard closes the canvas is back at rest').toBe(resting);
            });
        });
    }
});
