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
     * Opens the page on the "DYE2 is needed" screen and waits until it is drawn
     * and nothing is being answered. A gated page draws no cards and opens no
     * machine socket (src/modules/app.js returns before it connects).
     */
    async openGated({ before } = {}) {
        if (before) await this.page.addInitScript(before);
        await this.page.goto(`${PAGE_ORIGIN}/index.html`);
        await this.page.locator('#main-page.cafe-gated').waitFor();
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
     * itself, as Playwright installs it, but for the length of a `pour`; this
     * is the only way a test moves it on faster.
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
     *
     * The clock is paused meanwhile, so it moves only as each step moves it and
     * the page's timers fire only then, after every frame of the step before
     * has reached the page. Running on by itself it could fire one between two
     * frames of a step: the chart's draw, between the machine's last frame and
     * the scale's after it, leaves the live Weight card a frame behind, as no
     * later machine frame comes to draw it again (issue #92).
     *
     * The last step's frames have reached the page but are not yet drawn when
     * it returns: the chart draws them on real time once the clock runs on
     * again. A test that reads the chart or the cards straight after waits on
     * them with `expect`, or moves the clock on first, as `pourTo` does.
     *
     * The clock is the browser context's, so pausing it pauses every page open
     * in it, each at its own time. Pour with `cafe.page` the only one open: a
     * page from `another()` whose clock ran ahead would have `pauseClock`
     * move `cafe.page` on, firing its timers, until it caught up.
     */
    async pour(toMs = Infinity, { step = 250 } = {}) {
        await this.pauseClock();
        try {
            await this.pourPaused(toMs, step);
        } finally {
            if (!this.page.isClosed()) await this.page.clock.resume();
        }
    }

    /**
     * Pauses the page's clock where it is. Playwright pauses it only at a time
     * given, a moment on from the page's now, which the clock may have passed
     * by itself before the call arrives: then it is paused where it was, and
     * paused again at its now.
     */
    async pauseClock() {
        for (;;) {
            const now = await this.page.evaluate(() => Date.now());
            try {
                await this.page.clock.pauseAt(now + 20);
                return;
            } catch (error) {
                if (!/past/i.test(String(error))) throw error;
            }
        }
    }

    async pourPaused(toMs, step) {
        if (!this.pouring) {
            this.fake.setNow(await this.page.evaluate(() => Date.now()));
            this.fake.startPour();
            this.pouring = { at: 0 };
            this.idleSeenAt = null;
        }
        const end = Math.min(toMs, this.fake.machine.pourLength());
        const { idleAtMs } = this.fake.machine.pourTimes();
        const from = this.pouring.at;
        const play = at => {
            this.fake.playPour(at);
            // The page's time when the machine's frame back at rest reached it.
            if (this.idleSeenAt === null && at >= idleAtMs) this.idleSeenAt = this.fake.now();
        };
        if (end > from) {
            await this.advance(end - from, { step, during: moved => play(from + moved) });
            this.pouring.at = end;
        }
        if (toMs === Infinity) {
            this.fake.finishPour();
            if (this.idleSeenAt === null) this.idleSeenAt = this.fake.now();
            this.fake.flush();
            await this.settle();
            this.pouring = null;
        }
    }

    /**
     * Moves the clock on after a whole pour to the moment the recorder had
     * the stored Shot from Decaid's list: as long after the page had the
     * machine back at rest as in the recording (`pourTimes()`). The Shot is
     * not stored; `storeShot()` does that.
     */
    async untilStored() {
        if (this.idleSeenAt == null) throw new Error('untilStored() follows a whole pour()');
        const { idleAtMs, storedAtMs } = this.fake.machine.pourTimes();
        const at = this.idleSeenAt + (storedAtMs - idleAtMs);
        for (;;) {
            const left = at - await this.page.evaluate(() => Date.now());
            if (left <= 0) return;
            await this.advance(Math.min(left, 500));
        }
    }

    /** Decaid stores the pour's Shot, as it does about 4 s after the pump stops. */
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
    /**
     * The page's time when the test starts. A test sets its own with
     * `test.use({ start })`. The page's zone is Playwright's `timezoneId`
     * (playwright.config.mjs, CAFE_TZ), and Decaid's is the same, as on a
     * tablet.
     */
    start: [START, { option: true }],
    /**
     * Whether Decent Sync's plugin is installed, serving the Machine at its
     * Location (fake-decaid/decent-sync.js, recordings/decent-sync.json). A
     * spec turns it on with `test.use({ decentSync: true })`, and drives it
     * through `fake.decentSync`.
     */
    decentSync: [false, { option: true }],
    /**
     * The recorded pour the fake's machine plays: the pinned stack's simulated
     * one (recordings/pour.json), unless a spec names another with
     * `test.use({ pour: 'real/de1pro-pour' })`, the real DE1Pro's
     * (docs/cafe/TESTING.md, "The real pour").
     */
    pour: ['pour', { option: true }],
    fake: async ({ start, timezoneId, decentSync, pour }, use) => {
        const fake = createFakeDecaid({
            sampleData: recording('sample-data'), boot: recording('boot'), pour: recording(pour),
            ...(decentSync ? { decentSync: recording('decent-sync') } : {}),
            now: start, timeZone: timezoneId ?? 'UTC',
        });
        await use(fake);
    },
    cafe: async ({ page, context, fake, start }, use) => {
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
        await page.clock.install({ time: start });
        const cafe = new Cafe(page, fake, routes, errors);
        await use(cafe);
        // What the test's last step asked, answered, before reading what failed.
        if (!page.isClosed()) await cafe.settle();
        expect(routes.unanswered, 'requests and sockets the fake Decaid has no answer for').toEqual([]);
        expect(errors, 'errors on the page').toEqual([]);
    },
});
