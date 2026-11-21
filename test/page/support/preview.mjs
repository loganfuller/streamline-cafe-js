// The public preview's page tests' own fixture (test/page/preview.spec.mjs,
// test/page/preview-cafe.spec.mjs): the Pages site staged as the workflow
// stages it (preview/stage.mjs) and opened at its root with no adapter and no
// route to a fake in Node. The fake Decaid runs in the page, beneath
// src/modules/api.js, through the stand-in (preview/stand-in.js); every
// request and socket that leaves the page is kept and refused
// (preview-site.mjs), so a test can say none did.
//
// The page's clock is Playwright's, moved on as the page tests move it; the
// stand-in's own timers (the machine's frames at rest, the pushes sent after
// an answer, the pour's frames) run on it.

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test as base, expect } from 'playwright/test';

import { SITES, FAVICON_ORIGIN, removeSite, serveSite, stageSite } from './preview-site.mjs';
import { SCREENSHOTS } from './test.mjs';

export { expect };

/** 14:00 in Toronto, the visitor's zone in these specs. */
export const START = Date.parse('2026-11-18T19:00:00Z');
export const ZONE = 'America/Toronto';
export const UNANSWERED = 'Streamline Cafe preview: the sample machine has no answer for';
const NO_MOTION = `*, *::before, *::after { transition: none !important; animation: none !important; }`;

/** The address of the preview in a mode: served by Decent Sync, or without it. */
export const addressOf = (site, mode) => (mode === 'tablet' ? `${site}?decent-sync=off` : site);

export class Preview {
    constructor(page, site, mode, escaped, errors, lines) {
        this.page = page;
        this.site = site;
        this.mode = mode;
        this.escapedAll = escaped;
        this.errors = errors;
        this.lines = lines;
    }

    /** The skin's page, in the preview's frame. */
    get frame() {
        const frame = this.page.frames().find(f => f.url().startsWith('http') && new URL(f.url()).pathname.endsWith('/skin.html'));
        if (!frame) throw new Error('the preview has no skin frame');
        return frame;
    }

    /** The bar above the skin. */
    get bar() {
        return this.page.locator('#preview-bar');
    }

    /** Opens the site's root, in this test's mode, and waits until the skin is drawn with the machine's sockets open. */
    async open() {
        await this.page.goto(addressOf(this.site, this.mode));
        return this.started();
    }

    /** Waits until the skin, opened or reloaded, is drawn with the machine's sockets open. */
    async started() {
        await expect(this.page.frameLocator('#preview-skin').locator('#cafe-strip .cafe-card')).toHaveCount(9);
        await expect.poll(() => this.frame.evaluate(() => ['/ws/v1/machine/snapshot', '/ws/v1/machine/shotState'].every(p => window.cafePreview.opened.includes(p)))).toBe(true);
        await this.advance(1000);
        return this.frame;
    }

    /** Moves the page's clock on in steps, the page having a turn after each. */
    async advance(ms, step = 500) {
        for (let moved = 0; moved < ms; moved += step) {
            await this.page.clock.runFor(Math.min(step, ms - moved));
            await this.frame.evaluate(() => 0);
        }
    }

    /** A tap where a finger lands, by the page's mouse: on a control whose text takes no pointer events, the button under it. */
    async tapAt(locator) {
        const box = await locator.boundingBox();
        await this.page.mouse.click(box.x + Math.min(box.width / 2, 40), box.y + box.height / 2);
    }

    /** What the fake in the page holds. */
    read(what, arg) {
        return this.frame.evaluate(async ([what, arg]) => {
            const fake = await window.cafePreview.ready;
            const records = () => fake.store.get('dye2.reaplugin', 'recipes') || [];
            const reads = {
                selection: () => fake.selection(),
                dose: () => fake.workflow().context?.targetDoseWeight,
                workflow: () => fake.workflow(),
                recordId: name => records().find(row => row && row.name === name)?.id,
                record: name => records().find(row => row && row.name === name),
                newestShot: () => fake.shots.newest(1)[0],
                shot: id => fake.shots.get(id),
                shots: () => fake.shots.newest(1000).map(shot => ({ id: shot.id, timestamp: shot.timestamp })),
                log: () => fake.log.map(entry => ({ request: `${entry.method} ${entry.path}`, at: entry.at })),
                store: ([namespace, key]) => fake.store.get(namespace, key),
                pour: () => fake.machine.state.pour,
                pourTimes: () => ({ ...fake.machine.pourTimes(), length: fake.machine.pourLength() }),
                machineState: () => fake.machine.state.snapshot.state,
                served: () => window.cafePreview.served,
                reference: name => fake.decentSync?.recipe(records().find(row => row && row.name === name).id).referenceShotId ?? null,
            };
            return reads[what](arg);
        }, [what, arg]);
    }

    /** Requests and sockets that left the page, but the skin's favicon. */
    escaped() {
        return this.escapedAll.filter(line => !line.startsWith(`GET ${FAVICON_ORIGIN}/`));
    }

    /** The stand-in's console lines naming a request it had no answer for. */
    unanswered() {
        return this.lines.filter(line => line.startsWith(UNANSWERED));
    }

    /** A named screenshot of the whole preview, for the pull request. */
    async screenshot(name) {
        await mkdir(SCREENSHOTS, { recursive: true });
        await this.page.screenshot({ path: join(SCREENSHOTS, `${name}.png`) });
    }
}

export const test = base.extend({
    site: [async ({}, use) => {
        const root = stageSite();
        await use(root);
        removeSite(root);
    }, { scope: 'worker' }],
    /** Which address the site is served at (preview-site.mjs, SITES). */
    origin: ['local', { option: true }],
    /** Which mode the preview opens in: `served` by Decent Sync, or `tablet`, without it. */
    mode: ['served', { option: true }],
    preview: async ({ page, context, site, origin, mode }, use) => {
        const errors = [];
        context.on('weberror', error => errors.push(`${error.page()?.url() ?? 'a page'}: ${error.error().message}`));
        const lines = [];
        page.on('console', message => lines.push(message.text()));
        const escaped = await serveSite(context, site, SITES[origin]);
        await context.addInitScript(css => {
            document.addEventListener('DOMContentLoaded', () => {
                const style = document.createElement('style');
                style.textContent = css;
                document.head.appendChild(style);
            });
        }, NO_MOTION);
        await page.clock.install({ time: START });
        const preview = new Preview(page, SITES[origin], mode, escaped, errors, lines);
        await use(preview);
        expect(preview.escaped(), 'requests and sockets that left the page').toEqual([]);
        expect(errors, 'errors on the page').toEqual([]);
    },
});
