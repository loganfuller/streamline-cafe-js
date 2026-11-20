// The real journeys' fixtures (docs/cafe/TESTING.md, "The real journeys"): the
// stacks stood up from the pins (stacks.mjs), and tablets on them. A tablet is
// the cafe page in Chromium, its files answered from the repository, calling
// Decaid at 127.0.0.1:8080 as on a tablet, which a host rule maps to that
// stack's Decaid. Nothing is faked: every request reaches the real stack.
//
//   import { test, expect } from './support/journey.mjs';
//   test('…', async ({ stacks, tablet }) => { const page = await tablet(stacks.decaid); … });
//
// A journey waits on conditions (`expect.poll`, `until`), never a fixed sleep,
// but for proving nothing arrives: `quiet(ms, why)` waits that long, and `why`
// names what the wait is (the plugin's poll interval, say).

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { test as base, expect } from 'playwright/test';

import { attachStacks, officialStreamline } from './stacks.mjs';
import { pull, until, appliedWith, PLUGIN } from '../../../scripts/fake-decaid-recorder/decent-sync.mjs';
import { servePage, PAGE_ORIGIN } from '../../page/support/page-files.mjs';

export { expect, pull, until, appliedWith, PLUGIN };

const ROOT = join(import.meta.dirname, '..', '..', '..');
export const SCREENSHOTS = join(ROOT, 'test', 'real', 'out', 'screenshots');
/** Where official Streamline is served from (smoke step 14): another origin, calling the same Decaid. */
export const STREAMLINE_ORIGIN = 'http://127.0.0.1:24801';
export const DYE2 = 'dye2.reaplugin';

// No transition or animation runs, as in the page tests: a dialog drawn closing
// would still be on a screenshot, and nothing in src/ waits for one to end.
const NO_MOTION = `*, *::before, *::after { transition: none !important; animation: none !important; }`;

/** The only fixed wait a journey holds: for proving that nothing arrives in `ms`, `why` naming the wait. */
export async function quiet(ms, why) {
    if (!why) throw new Error('quiet() needs the reason for its wait');
    await new Promise(resolve => setTimeout(resolve, ms));
}

/** Screenshot of a tablet's page, for the pull request. */
export async function shoot(page, name) {
    await mkdir(SCREENSHOTS, { recursive: true });
    await page.screenshot({ path: join(SCREENSHOTS, `${name}.png`) });
}

export const test = base.extend({
    // The stacks, read from the state file the global setup wrote.
    stacks: [async ({}, use) => { await use(await attachStacks()); }, { scope: 'worker' }],

    // A journey that failed with Decent Sync's server stopped leaves it started
    // again for the next, whose own `finally` the test's timeout may have skipped.
    serverBack: [async ({ stacks }, use) => {
        await use();
        if (!stacks.sync.serverRunning()) await stacks.sync.startServer();
    }, { auto: true }],

    // One browser per Decaid, its 8080 mapped to that Decaid's port: a tablet
    // of that Machine. Kept for the worker.
    browsers: [async ({}, use) => {
        const open = new Map();
        await use(async port => {
            if (!open.has(port)) {
                open.set(port, await chromium.launch({
                    headless: !process.env.HEADED,
                    args: [`--host-resolver-rules=MAP 127.0.0.1:8080 127.0.0.1:${port}`, '--disable-features=LocalNetworkAccessChecks'],
                }));
            }
            return open.get(port);
        });
        for (const browser of open.values()) await browser.close();
    }, { scope: 'worker' }],

    /**
     * `tablet(side, options)`: a page of its own on `side`'s Decaid (`stacks.decaid`,
     * `stacks.sync` or `stacks.sync.second`), opened and drawn. `streamline: true`
     * opens official Streamline instead of the cafe page; `open: false` answers
     * the page unopened, for a journey that opens it itself. The cafe page is
     * answered once its machine status reads `ready` (`Ready`, the machine
     * idle): a tap before then can land before the strip's handlers are set.
     * Its contexts are
     * closed at the test's end, and any error on one fails the test.
     */
    tablet: async ({ browsers }, use, testInfo) => {
        const contexts = [];
        const errors = [];
        await use(async (side, { viewport = { width: 1920, height: 1200 }, streamline = false, open = true, ready = /^Ready$/ } = {}) => {
            const browser = await browsers(side.port);
            const context = await browser.newContext({ viewport, timezoneId: 'UTC', locale: 'en-US' });
            contexts.push(context);
            // A tap on a control that never takes one fails in 30 s, not at the
            // test's timeout, which would skip the journey's own `finally`.
            context.setDefaultTimeout(30_000);
            await servePage(context, ROOT);
            await context.addInitScript(css => {
                document.addEventListener('DOMContentLoaded', () => {
                    const style = document.createElement('style');
                    style.textContent = css;
                    document.head.appendChild(style);
                });
            }, NO_MOTION);
            if (streamline) await servePage(context, await officialStreamline(), STREAMLINE_ORIGIN);
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(`${streamline ? 'Streamline' : 'cafe page'} on ${side.api}: ${error.message}`));
            if (!open) return page;
            if (streamline) {
                await page.goto(`${STREAMLINE_ORIGIN}/index.html`);
                await page.waitForLoadState('load');
            } else {
                await page.goto(`${PAGE_ORIGIN}/index.html`);
                await page.locator('#cafe-strip .cafe-card').first().waitFor({ timeout: 30_000 });
                await expect(page.locator('#machine-status'), 'the page has the machine').toHaveText(ready);
            }
            return page;
        });
        if (testInfo.status !== testInfo.expectedStatus) {
            for (const [index, context] of contexts.entries()) {
                for (const [at, page] of context.pages().entries()) {
                    await testInfo.attach(`tablet-${index}-${at}`, { body: await page.screenshot(), contentType: 'image/png' }).catch(() => {});
                }
            }
        }
        for (const context of contexts) await context.close();
        expect(errors, 'no error on any page').toEqual([]);
    },
});

/** The DYE2 recipe id a Workflow names, as Streamline's apply writes it. */
export const recipeIdOf = workflow => workflow?.context?.extras?.dye?.recipeId ?? null;

/** A recipe's card on the strip, by its slot. */
export const card = (page, slot) => page.locator('#cafe-strip .cafe-card').nth(slot - 1);

/**
 * The strip's load or unload over, and for an unload its hold against a
 * double tap (src/cafe/recipe-loader.js, `UNLOAD_HOLD_MS`): the page keeps the
 * dial-in still, and ignores a tap on the strip, until then (`cafe-loading` on
 * the main page, src/cafe/page.js).
 */
export async function untilStripSettled(page) {
    await expect(page.locator('#main-page:not(.cafe-loading)'), 'the strip\'s load or unload has finished').toBeAttached();
}

/**
 * A tap on a sample recipe's card, once the strip has settled, and the load
 * through Streamline's apply seen on the page (its title) and in `side`'s
 * Workflow. Answers the DYE2 record.
 */
export async function loadByCard(page, side, recipe) {
    const loaded = await record(side, recipe.name);
    await untilStripSettled(page);
    await card(page, recipe.slot).click();
    await expect(page.locator('#cafe-title')).toHaveText(recipe.name);
    await expect.poll(async () => recipeIdOf(await side.decaid('GET', '/workflow')), { message: `${recipe.name} is loaded into the Workflow` }).toBe(loaded.id);
    return loaded;
}

/** A Decaid's DYE2 record of a sample recipe, by name. */
export async function record(side, name) {
    return (await side.decaid('GET', `/store/${DYE2}/recipes`)).find(row => row.name === name) || null;
}
