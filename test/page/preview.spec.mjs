// The public preview (docs/cafe/DESIGN.md, "The public preview"; #87): the
// Pages site staged as the workflow stages it (preview/stage.mjs) and opened
// at its root with no adapter and no route to a fake in Node. The fake Decaid
// runs in the page, beneath src/modules/api.js, through the stand-in
// (preview/stand-in.js); every request and socket that leaves the page is
// kept and refused (support/preview-site.mjs), so a test can say none did.
//
// The page's clock is Playwright's, moved on as the page tests move it; the
// stand-in's own timers (the machine's frames at rest, the pushes sent after
// an answer) run on it.

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test as base, expect } from 'playwright/test';

import { SITES, FAVICON_ORIGIN, removeSite, serveSite, stageSite } from './support/preview-site.mjs';
import { SCREENSHOTS } from './support/test.mjs';
import { legend } from './support/page-reads.mjs';
import { RECIPES } from './support/sample-data.mjs';
import { API_DEBOUNCE_MS } from '../../src/modules/workflow-watch.js';

const [house] = RECIPES;
/** 14:00 in Toronto, the visitor's zone in this spec. */
const START = Date.parse('2026-11-18T19:00:00Z');
const ZONE = 'America/Toronto';
const BAR_TEXT = 'Preview on sample data. No machine is connected.';
const NO_MOTION = `*, *::before, *::after { transition: none !important; animation: none !important; }`;
const FOREIGN = 'another-site.key';
const FOREIGN_DB = 'another-site-db';
const UNANSWERED = 'Streamline Cafe preview: the sample machine has no answer for';

class Preview {
    constructor(page, site, escaped, errors, lines) {
        this.page = page;
        this.site = site;
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

    /** Opens the site's root and waits until the skin is drawn with the machine's sockets open. */
    async open() {
        await this.page.goto(this.site);
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

    /** What the fake in the page holds. */
    read(what, arg) {
        return this.frame.evaluate(async ([what, arg]) => {
            const fake = await window.cafePreview.ready;
            const reads = {
                selection: () => fake.selection(),
                dose: () => fake.workflow().context?.targetDoseWeight,
                recordId: name => (fake.store.get('dye2.reaplugin', 'recipes') || []).find(row => row && row.name === name)?.id,
                newestShot: () => fake.shots.newest(1)[0],
                shots: () => fake.shots.newest(1000).map(shot => ({ id: shot.id, timestamp: shot.timestamp })),
                log: () => fake.log.map(entry => ({ request: `${entry.method} ${entry.path}`, at: entry.at })),
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
}

const test = base.extend({
    site: [async ({}, use) => {
        const root = stageSite();
        await use(root);
        removeSite(root);
    }, { scope: 'worker' }],
    /** Which address the site is served at (support/preview-site.mjs, SITES). */
    origin: ['local', { option: true }],
    preview: async ({ page, context, site, origin }, use) => {
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
        const preview = new Preview(page, SITES[origin], escaped, errors, lines);
        await use(preview);
        expect(preview.escaped(), 'requests and sockets that left the page').toEqual([]);
        expect(errors, 'errors on the page').toEqual([]);
    },
});

test.use({ timezoneId: ZONE });

/** Each card's name, in slot order. */
const cardNames = frame => frame.locator('#cafe-strip .cafe-card .cafe-card-name').allTextContents();
const SLOT_NAMES = Array.from({ length: 9 }, (_, i) => RECIPES.find(r => r.slot === i + 1)?.name ?? `Slot ${i + 1}`);

/** What a first visit finds: the skin's storage, its page, and the shots its history holds. */
function firstVisitState(frame) {
    return frame.evaluate(async ([foreign]) => {
        const own = storage => Object.fromEntries(Object.keys(storage)
            .filter(key => key !== foreign && !key.startsWith('streamlineCafePreview.'))
            .sort()
            .map(key => [key, storage.getItem(key)]));
        const history = await new Promise((resolve, reject) => {
            const request = indexedDB.open('shot_history');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const db = request.result;
                const stores = db.transaction(['shot_summaries', 'settings']);
                const all = stores.objectStore('shot_summaries').getAll();
                const settings = stores.objectStore('settings').getAll();
                stores.onerror = () => reject(stores.error);
                stores.oncomplete = () => {
                    db.close();
                    resolve({
                        shots: all.result.map(s => ({ id: s.id, timestamp: s.timestamp })).sort((a, b) => a.id.localeCompare(b.id)),
                        settings: settings.result.sort((a, b) => String(a.id).localeCompare(String(b.id))),
                    });
                };
            };
        });
        return {
            local: own(localStorage),
            session: own(sessionStorage),
            theme: document.documentElement.dataset.theme ?? null,
            language: document.documentElement.lang,
            title: document.getElementById('cafe-title').textContent,
            pressed: document.querySelectorAll('#cafe-strip [aria-pressed="true"]').length,
            dose: document.getElementById('dose-in-value').textContent,
            history,
        };
    }, [FOREIGN]);
}

/** What another site of the same origin keeps in the browser. */
const foreignState = page => page.evaluate(async ([key, db]) => ({
    local: localStorage.getItem(key),
    session: sessionStorage.getItem(key),
    database: (await indexedDB.databases()).some(d => d.name === db),
}), [FOREIGN, FOREIGN_DB]);

/** A visit that changes what it can: a recipe loaded, the dose stepped, and the skin's storage written. */
async function changeEverything(preview) {
    const frame = preview.frame;
    await frame.locator('#cafe-strip .cafe-card').nth(house.slot - 1).click();
    await expect(frame.locator('#cafe-title')).toHaveText(house.name);
    await frame.locator('#dose-in-plus').click();
    await frame.evaluate(() => new Promise((resolve, reject) => {
        // A Shot the history kept that the next visit's machine never pulled.
        const request = indexedDB.open('shot_history');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const db = request.result;
            const write = db.transaction('shot_summaries', 'readwrite');
            write.objectStore('shot_summaries').put({ id: 'from-an-earlier-visit', timestamp: '2026-01-01T00:00:00.000Z' });
            write.onerror = () => reject(write.error);
            write.oncomplete = () => { db.close(); resolve(); };
        };
    }));
    await frame.evaluate(() => {
        localStorage.setItem('language', 'de');
        localStorage.setItem('theme', 'dark');
        localStorage.setItem('streamline.touchSound', 'true');
        sessionStorage.setItem('fullscreenPromptDismissed', 'true');
    });
    await preview.advance(API_DEBOUNCE_MS + 1000);
    // Ten minutes on, so Shots kept from this visit would carry other times than the next one's.
    await preview.page.clock.runFor(10 * 60_000);
}

for (const origin of Object.keys(SITES)) {
    test.describe(`the preview at ${SITES[origin]}`, { tag: '@preview' }, () => {
        test.use({ origin });

        test('opens past the "needs DYE2" screen on the sample machine, with nothing sent to Decaid\'s address or another origin', async ({ preview }) => {
            const frame = await preview.open();
            await expect(frame.locator('#main-page')).not.toHaveClass(/cafe-gated/);
            expect(await cardNames(frame), 'the nine slots, the sample recipes on their cards').toEqual(SLOT_NAMES);
            await expect(frame.locator('#cafe-title')).toHaveText('No recipe selected');
            await expect(frame.locator('#cafe-strip [aria-pressed="true"]')).toHaveCount(0);
            const shown = await legend(frame);
            expect(shown.label).toBe('Last shot');
            expect(shown.when, 'the newest sample Shot, an hour before the page opened, in the visitor\'s zone').toBe('Today 01:00 PM');
            expect((await preview.read('newestShot')).id, 'the newest sample Shot is the fake\'s').toBeTruthy();
            await expect(frame.locator('#machine-status'), 'a connected machine, at rest').toHaveText('Ready');
            expect(preview.unanswered(), 'every request at start answered').toEqual([]);
        });
    });
}

test.describe('the preview', { tag: '@preview' }, () => {
    test('two minutes at rest: no error, the update check and the plugin look come round answered, and the machine stays connected', async ({ preview }) => {
        test.slow();
        const frame = await preview.open();
        await preview.advance(125_000, 1000);
        const log = await preview.read('log');
        const after = (request, ms) => log.some(entry => entry.request === request && entry.at >= START + ms);
        expect(after('GET /api/v1/webui/skins', 30_000), 'Streamline\'s update check, thirty seconds on').toBe(true);
        expect(after('GET /api/v1/plugins', 60_000), 'the plugin look, sixty seconds on').toBe(true);
        expect(log.length, 'the fake\'s request log is kept short').toBeLessThanOrEqual(200);
        await expect(frame.locator('#machine-status')).toHaveText('Ready');
        const lines = preview.unanswered();
        expect(lines, 'each request with no answer named once').toEqual([...new Set(lines)]);
    });

    test('a tap loads a recipe and a stepper changes the dial-in, each answered by the model', async ({ preview }) => {
        const frame = await preview.open();
        await frame.locator('#cafe-strip .cafe-card').nth(house.slot - 1).click();
        await expect(frame.locator('#cafe-title')).toHaveText(house.name);
        await expect(frame.locator('#cafe-strip [aria-pressed="true"]')).toHaveCount(1);
        const id = await preview.read('recordId', house.name);
        // Not asked whether DYE2 calls it changed: the sample recipes' steam and
        // flush settings are not the sample machine's (#88 makes the cafe).
        await expect.poll(() => preview.read('selection'), 'DYE2 names the recipe loaded').toMatchObject({ kind: 'recipe', id });

        const dose = parseFloat(await frame.locator('#dose-in-value').textContent());
        await frame.locator('#dose-in-plus').click();
        await expect(frame.locator('#dose-in-value')).toHaveText(`${dose + 1}g`);
        await preview.advance(API_DEBOUNCE_MS + 1000);
        await expect.poll(() => preview.read('dose'), 'the step reached the Workflow').toBe(dose + 1);
        expect(preview.unanswered()).toEqual([]);
    });

    test('a request the model has no answer for is "not found", named once on the console, and shown nowhere on the page', async ({ preview }) => {
        const frame = await preview.open();
        const answers = await frame.evaluate(async () => {
            const url = `http://${location.hostname}:8080/api/v1/preview-no-such-route?n=`;
            const out = [];
            for (const n of [1, 2]) {
                const response = await fetch(`${url}${n}`);
                out.push([response.status, await response.json()]);
            }
            return out;
        });
        expect(answers).toEqual([[404, { error: 'Not found' }], [404, { error: 'Not found' }]]);
        const socket = await frame.evaluate(() => new Promise(resolve => {
            const seen = [];
            const ws = new WebSocket(`ws://${location.hostname}:8080/ws/v1/preview-no-such-socket`);
            ws.onerror = () => seen.push('error');
            ws.onclose = event => resolve([...seen, event.code]);
        }));
        expect(socket, 'a socket the model has none of is refused, as a connection Decaid refuses').toEqual(['error', 1006]);
        await preview.advance(1000);
        expect(preview.unanswered()).toEqual([
            `${UNANSWERED} GET /api/v1/preview-no-such-route, answered "not found".`,
            `${UNANSWERED} the socket /ws/v1/preview-no-such-socket, answered "not found".`,
        ]);
        await expect(frame.locator('body')).not.toContainText('preview-no-such');
        await expect(frame.locator('body')).not.toContainText('Not found');
        await expect(preview.page.locator('body')).not.toContainText('Not found');
    });

    test('a push reaches the page after the answer that caused it, and sockets closed and opened again are answered again', async ({ preview }) => {
        const frame = await preview.open();
        await frame.evaluate(async () => {
            const host = `${location.hostname}:8080`;
            const order = window.__order = [];
            const ws = new WebSocket(`ws://${host}/ws/v1/machine/snapshot`);
            await new Promise(resolve => { ws.onmessage = resolve; });
            // The first frame that says so; the machine at rest says it again every half second.
            ws.onmessage = event => { if (JSON.parse(event.data).state?.state === 'sleeping' && !order.includes('push')) order.push('push'); };
            const response = await fetch(`http://${host}/api/v1/machine/state/sleeping`, { method: 'PUT' });
            order.push('answer');
            await response.json();
            order.push('read');
        });
        await expect.poll(() => frame.evaluate(() => window.__order.join(' ')), 'the machine\'s frame came after the page read the answer to the request that sent it')
            .toBe('answer read push');
        await frame.evaluate(() => fetch(`http://${location.hostname}:8080/api/v1/machine/state/idle`, { method: 'PUT' }));

        const again = await frame.evaluate(async () => {
            const url = `ws://${location.hostname}:8080/ws/v1/machine/shotState`;
            const opened = () => new Promise((resolve, reject) => {
                const ws = new WebSocket(url);
                ws.onmessage = () => resolve(ws);
                ws.onclose = event => reject(new Error(`closed ${event.code}`));
            });
            const first = await opened();
            const closed = await new Promise(resolve => {
                first.onclose = event => resolve([event.code, event.wasClean, first.readyState]);
                first.close(1000);
            });
            const second = await opened();
            second.close(1000);
            return { closed, reopened: second.url };
        });
        expect(again).toEqual({ closed: [1000, true, 3], reopened: 'ws://127.0.0.1:8080/ws/v1/machine/shotState' });

        // Decaid closes the page's socket; the page opens it again, and is answered.
        const count = () => frame.evaluate(() => window.cafePreview.opened.filter(path => path === '/ws/v1/machine/shotState').length);
        const before = await count();
        await frame.evaluate(() => window.cafePreview.drop('/ws/v1/machine/shotState'));
        await preview.advance(6000);
        expect(await count(), 'the page opened the socket again').toBeGreaterThan(before);
        await expect(frame.locator('#machine-status')).toHaveText('Ready');
    });

    test('a push waits for its own answer to be read, not only for another\'s', async ({ preview }) => {
        const frame = await preview.open();
        await frame.evaluate(async () => {
            const order = window.__order = [];
            const ws = new WebSocket(`ws://${location.hostname}:8080/ws/v1/machine/snapshot`);
            await new Promise(resolve => { ws.onmessage = resolve; });
            ws.onmessage = event => { if (JSON.parse(event.data).state?.state === 'sleeping' && !order.includes('push')) order.push('push'); };
        });
        // The clock held, so only the steps below run the stand-in's timers.
        await preview.page.clock.pauseAt(await frame.evaluate(() => Date.now()) + 1000);
        await frame.evaluate(async () => {
            const host = `${location.hostname}:8080`;
            window.__unread = await fetch(`http://${host}/api/v1/machine/state/sleeping`, { method: 'PUT' });
            window.__order.push('answer');
            await (await fetch(`http://${host}/api/v1/machine/info`)).json();
            window.__order.push('other read');
        });
        // Short of the 50 ms an unread answer is waited for.
        await preview.page.clock.runFor(20);
        expect(await frame.evaluate(() => window.__order.join(' ')), 'no push while the answer that caused it is unread')
            .toBe('answer other read');
        await frame.evaluate(async () => {
            await window.__unread.json();
            window.__order.push('read');
        });
        await preview.page.clock.runFor(20);
        await expect.poll(() => frame.evaluate(() => window.__order.join(' '))).toBe('answer other read read push');
    });

    test('a machine with buttons of its own: no machine buttons, and Settings, Shots and Sleep under the dial-in column', async ({ preview }) => {
        const frame = await preview.open();
        await expect(frame.locator('#ghc-controls')).toBeHidden();
        for (const id of ['settings-btn', 'cafe-shots-btn', 'sleep-button']) {
            await expect(frame.locator(`#shot-settings #cafe-system #${id}`)).toBeVisible();
        }
        for (const id of ['ghc-coffee-btn', 'ghc-water-btn', 'ghc-steam-btn', 'ghc-flush-btn', 'ghc-stop-btn']) {
            await expect(frame.locator(`#${id}`)).toBeHidden();
        }
    });

    for (const [name, size] of [['wide', { width: 1920, height: 1080 }], ['narrow', { width: 820, height: 1000 }]]) {
        test(`the bar is outside the skin, and the skin keeps 16:10 in a ${name} window`, async ({ preview }) => {
            await preview.page.setViewportSize(size);
            const frame = await preview.open();
            const bar = preview.page.locator('#preview-bar');
            await expect(bar.locator('p')).toHaveText(BAR_TEXT);
            await expect(bar.getByRole('link', { name: 'Repository' })).toHaveAttribute('href', 'https://github.com/loganfuller/streamline-cafe-js');
            await expect(bar.getByRole('button', { name: 'Start over' })).toBeVisible();
            await expect(frame.locator('body'), 'nothing of the preview\'s in the skin\'s page').not.toContainText('Preview on sample data');
            await expect(frame.locator('a[href*="github.com"], #preview-bar, #preview-start-over')).toHaveCount(0);

            const box = await preview.page.locator('#preview-skin').boundingBox();
            const barBox = await bar.boundingBox();
            expect(barBox.y + barBox.height, 'the bar is above the skin').toBeLessThanOrEqual(box.y + 0.5);
            expect(box.x + box.width).toBeLessThanOrEqual(size.width + 0.5);
            expect(box.y + box.height).toBeLessThanOrEqual(size.height + 0.5);
            expect(Math.abs(box.width / box.height - 1.6), `the frame is 16:10 (${box.width} × ${box.height})`).toBeLessThan(0.01);
            const [width, height] = await frame.evaluate(() => [innerWidth, innerHeight]);
            expect(Math.abs(width / height - 1.6), `the skin's window is 16:10 (${width} × ${height})`).toBeLessThan(0.01);
            expect(Math.max(box.width, box.height * 1.6), 'as large as the window holds').toBeGreaterThan(Math.min(size.width, (size.height - barBox.height) * 1.6) - 2);

            await mkdir(SCREENSHOTS, { recursive: true });
            await preview.page.screenshot({ path: join(SCREENSHOTS, `preview-${name}.png`) });
        });
    }

    test('a reload, and "Start over", find the page as a first visit did; storage that isn\'t the skin\'s is untouched', async ({ preview }) => {
        const { page } = preview;
        let frame = await preview.open();
        await page.evaluate(([key, db]) => new Promise((resolve, reject) => {
            localStorage.setItem(key, 'kept');
            sessionStorage.setItem(key, 'kept');
            const request = indexedDB.open(db, 1);
            request.onupgradeneeded = () => request.result.createObjectStore('things');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => { request.result.close(); resolve(); };
        }), [FOREIGN, FOREIGN_DB]);
        const first = await firstVisitState(frame);
        const matchesFake = async state => {
            const shots = (await preview.read('shots')).sort((a, b) => a.id.localeCompare(b.id));
            expect(state.history.shots, 'the history holds this visit\'s Shots, at this visit\'s times, and no other').toEqual(shots);
        };
        await matchesFake(first);

        await changeEverything(preview);
        await page.reload();
        frame = await preview.started();
        let now = await firstVisitState(frame);
        await matchesFake(now);
        expect({ ...now, history: now.history.settings }, 'after a reload').toEqual({ ...first, history: first.history.settings });
        expect(await foreignState(page)).toEqual({ local: 'kept', session: 'kept', database: true });

        await changeEverything(preview);
        const reloaded = page.waitForEvent('framenavigated', navigated => navigated === page.mainFrame());
        await page.locator('#preview-start-over').click();
        await reloaded;
        frame = await preview.started();
        now = await firstVisitState(frame);
        await matchesFake(now);
        expect({ ...now, history: now.history.settings }, 'after "Start over"').toEqual({ ...first, history: first.history.settings });
        expect(await foreignState(page)).toEqual({ local: 'kept', session: 'kept', database: true });
    });
});
