// The page tests' fixtures: a fresh fake Decaid and a fresh browser context for
// each test, the page's files answered from disk, the page's clock pinned, and
// a test that fails on any request the fake has no answer for or any page error
// (docs/cafe/TESTING.md).
//
//   import { test, expect } from './support/test.mjs';
//   test('…', { tag: '@grinder' }, async ({ cafe }) => { await cafe.open(); … });

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test as base, expect } from 'playwright/test';

import { createFakeDecaid } from '../../../fake-decaid/index.js';
import { attach, recording } from './adapter.mjs';
import { servePage, PAGE_ORIGIN } from './page-files.mjs';

export { expect };

const ROOT = join(import.meta.dirname, '..', '..', '..');
export const SCREENSHOTS = join(ROOT, 'test', 'page', 'out', 'screenshots');

/** The page's time when each test starts, in UTC, the zone Decaid's Shots are recorded in. */
export const START = Date.parse('2026-11-18T14:00:00Z');

// No transition or animation runs: they run on the browser's own time, which
// the page's clock does not jump, and nothing in src/ waits for one to end.
const NO_MOTION = `*, *::before, *::after { transition: none !important; animation: none !important; }`;

class Cafe {
    constructor(page, fake, routes, errors) {
        this.page = page;
        this.fake = fake;
        this.routes = routes;
        this.errors = errors;
    }

    /** Another page on the same fake, as a page opened afresh on the tablet. */
    async another() {
        const page = await this.page.context().newPage();
        await page.goto(`${PAGE_ORIGIN}/index.html`);
        await page.locator('#cafe-strip .cafe-card').first().waitFor();
        await this.settle(page);
        return page;
    }

    /**
     * Opens the page and waits until it is drawn with its sockets open. `before`
     * runs on the page first, as an init script.
     */
    async open({ before } = {}) {
        if (before) await this.page.addInitScript(before);
        await this.page.goto(`${PAGE_ORIGIN}/index.html`);
        await this.page.locator('#cafe-strip .cafe-card').first().waitFor();
        await expect.poll(() => this.routes.sockets.has('/ws/v1/machine/snapshot') && this.routes.sockets.has('/ws/v1/machine/shotState')).toBe(true);
        await this.settle();
        return this.page;
    }

    /**
     * Until no request is being answered, and the page has had a turn to read
     * what came. Fails, naming them, if requests are still being answered after
     * 5 s of real time.
     */
    async settle(page = this.page) {
        const deadline = Date.now() + 5000;
        for (;;) {
            if (this.routes.inflight.size === 0) {
                this.fake.flush();
                await page.evaluate(() => 0);
                if (this.routes.inflight.size === 0) return;
            }
            if (Date.now() > deadline) throw new Error(`requests still being answered after 5 s: ${[...this.routes.inflight].join(', ')}`);
            await new Promise(resolve => setImmediate(resolve));
        }
    }

    /**
     * Moves the page's clock `ms` forward in steps of `step`, firing each timer
     * due, the fake's machine sending its frames at rest, and the requests the
     * timers made answered before the next step. The clock also runs on by
     * itself, as Playwright installs it; this is the only way a test moves it
     * on faster.
     */
    async advance(ms, { step = 500, during } = {}) {
        for (let moved = 0; moved < ms; moved += step) {
            const by = Math.min(step, ms - moved);
            await this.page.clock.runFor(by);
            this.fake.setNow(await this.page.evaluate(() => Date.now()));
            if (during) during(moved + by);
            else this.fake.tick();
            this.fake.flush();
            await this.settle();
        }
    }

    /**
     * Pours the recorded shot up to `toMs` from its start (all of it by default),
     * the page's clock moving with its frames. The pour starts if it has not.
     */
    async pour(toMs = Infinity, { step = 250 } = {}) {
        if (!this.pouring) {
            this.fake.setNow(await this.page.evaluate(() => Date.now()));
            this.fake.startPour();
            this.pouring = { at: 0 };
        }
        const end = Math.min(toMs, this.fake.machine.pourLength());
        const from = this.pouring.at;
        if (end > from) {
            await this.advance(end - from, { step, during: moved => this.fake.playPour(from + moved) });
            this.pouring.at = end;
        }
        if (toMs === Infinity) {
            this.fake.finishPour();
            this.fake.flush();
            await this.settle();
            this.pouring = null;
        }
    }

    /** Decaid stores the pour's Shot, as it does up to 4 s after the pump stops. */
    async storeShot() {
        this.fake.setNow(await this.page.evaluate(() => Date.now()));
        const id = this.fake.storeShot();
        this.fake.flush();
        await this.settle();
        return id;
    }

    /** A named screenshot for the pull request, in a folder git ignores. */
    async screenshot(name) {
        await mkdir(SCREENSHOTS, { recursive: true });
        await this.page.screenshot({ path: join(SCREENSHOTS, `${name}.png`) });
    }

    /** The requests since `mark` (a length of the fake's log), as "METHOD /path?query". */
    since(mark, test = () => true) {
        return this.fake.log.slice(mark).filter(test);
    }
}

export const test = base.extend({
    fake: async ({}, use) => {
        const fake = createFakeDecaid({ sampleData: recording('sample-data'), boot: recording('boot'), pour: recording('pour'), now: START });
        await use(fake);
    },
    cafe: async ({ page, context, fake }, use) => {
        // Every page of the context, one it opens itself included.
        const errors = [];
        context.on('weberror', error => errors.push(`${error.page()?.url() ?? 'a page'}: ${error.error().message}`));
        await servePage(context, ROOT);
        const routes = await attach(context, fake);
        await context.addInitScript(css => {
            document.addEventListener('DOMContentLoaded', () => {
                const style = document.createElement('style');
                style.textContent = css;
                document.head.appendChild(style);
            });
        }, NO_MOTION);
        await page.clock.install({ time: START });
        const cafe = new Cafe(page, fake, routes, errors);
        await use(cafe);
        // What the test's last step asked, answered, before reading what failed.
        if (!page.isClosed()) await cafe.settle();
        expect(routes.unanswered, 'requests and sockets the fake Decaid has no answer for').toEqual([]);
        expect(errors, 'errors on the page').toEqual([]);
    },
});
