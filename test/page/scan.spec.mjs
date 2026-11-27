// Scanning a batch's QR code from the bean and batch dialog (#110), on a
// Machine Decent Sync serves whose plugin can match scanned text.
//
// The camera is Chromium's fake one, playing one picture for ever: a label
// whose QR code holds the made-up Batch Code SR-0412 (camera/make-label.mjs,
// playwright.config.mjs). A test allows its own context the camera, and what
// the label matches is what the test gives the fake plugin's server
// (`fake.decentSync.canScan`). The picture comes in real time and the page
// reads it on its own clock, so a test pauses that clock once the dialog is
// open, waits for the picture and the decoder, then moves the clock one
// reading on.

import { test, expect } from './support/test.mjs';
import { hold } from './support/faults.mjs';
import { PAGE_ORIGIN } from './support/page-files.mjs';
import { pickDialog, pickClosed, tapAt, writes, openPage, load, paint } from './support/page-reads.mjs';
import { recordOf, matchMachine } from './support/fake-reads.mjs';
import { RECIPES } from './support/sample-data.mjs';
import { LABEL_TEXT } from './camera/make-label.mjs';

const [house] = RECIPES;
const DOSE = '#dose-section .cafe-row-name';
const SCAN = '/api/v1/plugins/decent-sync.reaplugin/scan';
const CAMERA_STORE = '/api/v1/store/streamlineCafe/scanCamera';
const TITLE = 'Bean and batch';
const ICON = 'http://fast.decentespresso.com/favicon-32x32.png';

const WORKFLOW = '/api/v1/workflow';
const RECORDS = '/api/v1/store/dye2.reaplugin/recipes';
const STATUS = '/api/v1/plugins/decent-sync.reaplugin/status';
const CLOSE = '#cafe-pick-dialog form[method="dialog"] .cafe-btn';
const ROWS = { grinder: '#grind-section .cafe-row-name', basket: '#drink-section .cafe-row-name', profile: '#brew-section .cafe-row-name' };

const beanNamed = (fake, name) => fake.library.state.beans.find(bean => bean.name === name);
const batchOf = (fake, name, day) => fake.library.state.batches.find(batch => batch.beanId === beanNamed(fake, name).id && batch.roastDate.startsWith(day) && !batch.archived);
/** The batch the sample Workflow names: Sample Single Origin's. */
const inUse = fake => batchOf(fake, 'Sample Single Origin', '2026-10-28');

// ── The server's batches, as a test gives them to the fake plugin. Made up.
const ARRIVING = '5c1f0a52-7d3b-4e86-9a41-2b6d8f0c3e17';
/** A roast of Sample Blend the tablet has never held, at `at` on the server. */
const arriving = (fake, at, more = {}) => ({
    id: '019b7c1e-52aa-7c41-8e0d-3f5a6b7c8d90', batchCode: LABEL_TEXT, roastDate: '2026-11-12', roaster: 'Sample Roasters', name: 'Sample Blend',
    at, weight: 5000, beanId: beanNamed(fake, 'Sample Blend').id, batchId: ARRIVING, ...more,
});
/** A batch the tablet holds already, at the Machine's Location, carrying the label's code. */
const here = (fake, batch, bean) => ({
    id: '019b7c1e-52aa-7c41-8e0d-3f5a6b7c8d91', batchCode: LABEL_TEXT, roastDate: batch.roastDate.slice(0, 10), roaster: bean.roaster, name: bean.name,
    at: 'here', beanId: bean.id, batchId: batch.id,
});

// ── The page.
// Every camera the page opens is kept, with what it asked for, so a test can
// read whether its tracks were stopped.
const WATCH_CAMERAS = () => {
    window.__cameras = [];
    const media = navigator.mediaDevices;
    const open = media.getUserMedia.bind(media);
    media.getUserMedia = async constraints => {
        const camera = { constraints, stream: null };
        window.__cameras.push(camera);
        camera.stream = await open(constraints);
        return camera.stream;
    };
};
const cameras = page => page.evaluate(() => window.__cameras.map(camera => ({
    facing: camera.constraints.video.facingMode,
    audio: camera.constraints.audio,
    tracks: camera.stream ? camera.stream.getTracks().map(track => `${track.kind} ${track.readyState}`) : null,
})));
const live = async page => (await cameras(page)).flatMap(camera => camera.tracks || []).filter(track => track.endsWith('live'));

const tracks = async page => (await cameras(page)).flatMap(camera => camera.tracks || []);
// A tablet with two cameras, which the fake camera is not: the browser's list
// of devices says so, and the camera opened is still the fake one.
const TWO_CAMERAS = () => {
    const media = navigator.mediaDevices;
    const list = media.enumerateDevices.bind(media);
    media.enumerateDevices = async () => [...await list(), { kind: 'videoinput', deviceId: 'rear', groupId: 'rear', label: 'Rear' }];
};
// A camera slow to open: the first one asked for is held until the test lets it open.
const HOLD_FIRST_CAMERA = () => {
    const media = navigator.mediaDevices;
    const open = media.getUserMedia.bind(media);
    let first = true;
    media.getUserMedia = async constraints => {
        if (!first) return open(constraints);
        first = false;
        await new Promise(resolve => { window.__openFirstCamera = resolve; });
        return open(constraints);
    };
};
// A tablet with no camera: the media API says it found none.
const NO_CAMERA = () => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Requested device not found', 'NotFoundError'); };
};

const scanButton = page => page.locator('#cafe-pick-scan-open');
const scanPart = page => page.locator('#cafe-pick-scan');
const title = page => page.locator('#cafe-pick-title');
const under = page => page.locator('#cafe-pick-under');
const scans = fake => fake.log.filter(entry => entry.path === SCAN).map(entry => entry.body);
const highlightedBean = page => page.locator('#cafe-pick-side .cafe-pick-row[aria-pressed="true"] .cafe-pick-row-name').allTextContents();
const heldBatch = page => page.locator('#cafe-pick-list .cafe-pick-row[aria-pressed="true"]').evaluateAll(rows => rows.map(row => ({
    name: row.querySelector('.cafe-pick-row-name').textContent,
    detail: row.querySelector('.cafe-pick-row-detail').textContent,
})));
const useButton = page => page.locator('#cafe-pick-confirm-use');
const message = page => page.evaluate(() => {
    const shown = id => { const element = document.getElementById(id); return !element.hidden && element.offsetParent !== null; };
    const text = id => document.getElementById(id).textContent;
    if (shown('cafe-scan-panel')) return { in: 'panel', title: text('cafe-scan-panel-title'), body: text('cafe-scan-panel-body') };
    if (shown('cafe-scan-message')) return { in: 'picture', title: text('cafe-scan-message-title'), body: text('cafe-scan-message-body') };
    return null;
});

/** The page open on a served Machine whose plugin matches scanned text, the camera allowed, and the dialog open. */
async function dialogOpen(cafe, batches, { allowed = true, before = WATCH_CAMERAS, recipe = null } = {}) {
    if (allowed) await cafe.page.context().grantPermissions(['camera'], { origin: PAGE_ORIGIN });
    cafe.fake.decentSync.canScan(batches);
    if (recipe) matchMachine(cafe.fake, recipe.name);
    await cafe.open({ before });
    if (recipe) await load(cafe, recipe);
    await tapAt(cafe.page, DOSE);
    await expect(pickDialog(cafe.page)).toBeVisible();
    await cafe.settle();
    // The page reads the picture on its own clock, which the test now moves.
    await cafe.pauseClock();
    return cafe.page;
}

/** The QR button tapped, and the camera's picture and the decoder there to be read. */
async function scanOpen(cafe) {
    await scanButton(cafe.page).click();
    await expect(scanPart(cafe.page)).toBeVisible();
    await expect.poll(() => cafe.page.evaluate(() => document.getElementById('cafe-scan-video').readyState >= 2 && typeof window.jsQR === 'function')).toBe(true);
    await cafe.settle();
}

/** The page's clock moved one reading of the picture on, and what came of it answered. */
const read = cafe => cafe.advance(500);

/** The dialog open, the label scanned, and the lists back with its batch highlighted. */
async function scanned(cafe, batches, options) {
    const page = await dialogOpen(cafe, batches, options);
    await scanOpen(cafe);
    await read(cafe);
    await expect(scanPart(page)).toBeHidden();
    return page;
}

/** The scan showing, with the plugin's server out of reach since the dialog opened. */
async function scanOutOfReach(cafe, batches) {
    const page = await dialogOpen(cafe, batches);
    cafe.fake.decentSync.stopServer();
    await scanOpen(cafe);
    await read(cafe);
    return page;
}

const MESSAGES = {
    noMatch: { in: 'picture', title: 'No batch in the Library matches', body: `Read from the label: ${LABEL_TEXT}. The camera is still scanning.` },
    unreachable: { in: 'panel', title: 'Decent Sync can\'t be reached', body: 'The label was read, but the batch can\'t be looked up right now. Pick the batch from the list.' },
    noAnswer: { in: 'panel', title: 'No answer in time', body: 'The batch may have been brought here all the same. Check the list, or scan again.' },
    refused: { in: 'panel', title: 'Camera access is off', body: 'Allow it for this skin in Decaid, under Live camera access, then scan again.' },
    noCamera: { in: 'panel', title: 'This tablet has no camera', body: 'Pick the batch from the list.' },
};

/** "Back to the list", and a batch of the lists highlighted for "Use this batch": they can still be used. */
async function backToUsableLists(cafe) {
    const { page } = cafe;
    await expect(page.locator('#cafe-scan-cancel')).toHaveText('Back to the list');
    await page.locator('#cafe-scan-cancel').click();
    await expect(scanPart(page)).toBeHidden();
    await cafe.settle();
    await expect(title(page)).toHaveText(TITLE);
    await page.locator('#cafe-pick-side .cafe-pick-row').filter({ hasText: 'Sample Blend' }).click();
    await page.locator('#cafe-pick-list .cafe-pick-row').first().click();
    await expect(useButton(page)).toBeEnabled();
}


// Full Chromium asks for the page's icon, which the headless shell the other
// page tests run in never does. It is Streamline's, on its own site.
test.beforeEach(async ({ cafe }) => {
    await cafe.page.context().route(ICON, route => route.fulfill({ status: 204 }));
});

test.describe('the QR button', { tag: '@scan' }, () => {
    test.describe('on a Machine Decent Sync serves, whose plugin matches scanned text', () => {
        test.use({ decentSync: true });

        test('it is to the left of Close in the bean and batch dialog, named for a screen reader, and in no other dialog', async ({ cafe, fake }) => {
            const page = await dialogOpen(cafe, [arriving(fake, 'one')]);
            await expect(scanButton(page)).toBeVisible();
            await expect(page.getByRole('button', { name: 'Scan a batch\'s QR code' })).toBeVisible();
            const [button, close] = [await scanButton(page).boundingBox(), await page.locator(CLOSE).boundingBox()];
            expect(button.x + button.width, 'left of Close').toBeLessThanOrEqual(close.x);
            expect(Math.abs(button.y - close.y), 'on Close\'s line').toBeLessThan(1);
            expect([button.width, button.height], 'a finger\'s size').toEqual([56, 56]);
            await cafe.screenshot('scan-button-light');
            await paint(page, 'dark');
            await cafe.screenshot('scan-button-dark');
            await paint(page, 'light');
            await page.locator(CLOSE).click();
            await expect(pickClosed(page)).toBeAttached();
            for (const [name, row] of Object.entries(ROWS)) {
                await tapAt(page, row);
                await expect(pickDialog(page)).toBeVisible();
                await cafe.settle();
                await expect(scanButton(page), `the ${name} dialog`).toBeHidden();
                await page.locator(CLOSE).click();
                await expect(pickClosed(page)).toBeAttached();
            }
            await page.locator('#cafe-barista').click();
            await expect(pickDialog(page)).toBeVisible();
            await cafe.settle();
            await expect(scanButton(page), 'the barista dialog').toBeHidden();
        });

        test('it is absent on a Capture-only Machine, at a Location or at none, and while the server is from before the request', async ({ cafe, fake }) => {
            fake.decentSync.canScan([arriving(fake, 'one')]);
            fake.decentSync.setSharing(false);
            const page = await cafe.open();
            const absent = async why => {
                await page.evaluate(() => window.dispatchEvent(new Event('focus')));
                await cafe.advance(1000);
                await tapAt(page, DOSE);
                await expect(pickDialog(page)).toBeVisible();
                await cafe.settle();
                await expect(scanButton(page), why).toBeHidden();
                await page.locator(CLOSE).click();
                await expect(pickClosed(page)).toBeAttached();
            };
            await absent('sharing off');
            fake.decentSync.setSharing(true);
            fake.decentSync.setState('captureOnly');
            await absent('at no Location');
            fake.decentSync.setState('served');
            fake.decentSync.canScan([arriving(fake, 'one')], { server: false });
            await absent('a server from before the request');
            expect(fake.request({ method: 'GET', url: STATUS }).body).toMatchObject({ served: true, scan: false });
        });

        test('it is absent with a plugin whose status says nothing of scanned text', async ({ cafe, fake }) => {
            const page = await cafe.open();
            expect(fake.request({ method: 'GET', url: STATUS }).body, 'the pinned plugin\'s status').not.toHaveProperty('scan');
            await tapAt(page, DOSE);
            await expect(pickDialog(page)).toBeVisible();
            await cafe.settle();
            await expect(scanButton(page)).toBeHidden();
        });
    });

    test('it is absent with no Decent Sync plugin', async ({ cafe }) => {
        const page = await cafe.open();
        await tapAt(page, DOSE);
        await expect(pickDialog(page)).toBeVisible();
        await cafe.settle();
        await expect(scanButton(page)).toBeHidden();
    });
});

test.describe('scanning a batch\'s QR code', { tag: '@scan' }, () => {
    test.use({ decentSync: true });

    test('the decoder loads when the scan first opens, and the camera is asked for video alone', async ({ cafe, fake }) => {
        const page = await dialogOpen(cafe, [arriving(fake, 'one')]);
        const decoder = () => page.evaluate(() => ({ script: document.querySelectorAll('script[src*="jsQR"]').length, loaded: typeof window.jsQR }));
        expect(await decoder(), 'not with the page, nor with the dialog').toEqual({ script: 0, loaded: 'undefined' });
        expect(await cameras(page)).toEqual([]);
        await scanOpen(cafe);
        expect(await decoder()).toEqual({ script: 1, loaded: 'function' });
        expect(await cameras(page)).toEqual([{ facing: 'user', audio: false, tracks: ['video live'] }]);
        await expect(title(page)).toHaveText('Scan a batch');
        await expect(under(page)).toHaveText('Hold the label\'s QR code up to the camera. It is read as soon as it is in view.');
        await expect(page.locator('#cafe-scan-note')).toHaveText('A batch that is somewhere else is brought here when it is read.');
        await expect(page.locator('#cafe-scan-cancel')).toHaveText('Cancel scan');
        await expect(scanButton(page), 'no second scan from inside one').toBeHidden();
        await expect(page.locator('#cafe-scan-switch'), 'one camera: nothing to switch to').toBeHidden();
        await cafe.screenshot('scan-view-light');
        await paint(page, 'dark');
        await cafe.screenshot('scan-view-dark');
    });

    for (const size of [{ width: 1340, height: 800 }, { width: 1280, height: 800 }]) {
        test(`the scan fits a ${size.width} by ${size.height} screen, its buttons in reach`, async ({ cafe }) => {
            await cafe.page.setViewportSize(size);
            const page = await dialogOpen(cafe, []);
            await scanOpen(cafe);
            const inside = async (selector, what) => {
                const box = await page.locator(selector).boundingBox();
                expect(box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width && box.y + box.height <= size.height, `${what} is on the screen`).toBe(true);
                return box;
            };
            await inside('#cafe-pick-dialog .cafe-pick-box', 'the box');
            await inside('#cafe-scan-cancel', 'Cancel scan');
            await inside(CLOSE, 'Close');
            const picture = await inside('#cafe-scan-camera', 'the picture');
            expect(picture.height, 'and the picture has room for a label').toBeGreaterThan(200);
            await read(cafe);
            await inside('#cafe-scan-message', 'the message over the picture');
            await cafe.screenshot(`scan-no-match-${size.width}-light`);
        });
    }

    for (const [outcome, at] of [['moved', 'one'], ['added', 'several'], ['added', 'none']]) {
        test(`a batch at ${at === 'one' ? 'one other Location' : at === 'several' ? 'several other Locations' : 'no Location'} is ${outcome}: captured with nothing tapped, asked once, and highlighted`, async ({ cafe, fake }) => {
            const page = await dialogOpen(cafe, [arriving(fake, at)]);
            await scanOpen(cafe);
            const mark = fake.log.length;
            await read(cafe);
            await expect(scanPart(page)).toBeHidden();
            expect(scans(fake), 'the text as it was read, once').toEqual([{ text: LABEL_TEXT }]);
            expect(fake.decentSync.batches()[0].at, 'brought to the Machine\'s Location').toBe('here');
            await expect(title(page)).toHaveText(TITLE);
            await expect(scanButton(page)).toBeVisible();
            expect(await highlightedBean(page), 'its Bean shown').toEqual(['Sample Blend']);
            const left = outcome === 'moved' ? ' · ⁦5.0 kg⁩ left' : '';
            expect(await heldBatch(page), 'the lists read again, the batch highlighted').toEqual([{ name: 'Roasted Nov 12', detail: `${LABEL_TEXT}${left} · 6 days off roast` }]);
            await expect(useButton(page)).toBeEnabled();
            await expect(useButton(page)).toHaveText('Use this batch');
            await expect(page.locator('#cafe-pick-confirm-note')).toHaveText('Sample Blend · Roasted Nov 12');
            expect(await tracks(page), 'the camera stopped').toEqual(['video ended']);
            expect(writes(cafe.since(mark)).map(entry => entry.write), 'nothing written but the plugin asked').toEqual([`PUT ${SCAN}`]);
            if (outcome === 'moved') await cafe.screenshot('scan-matched-light');
        });
    }

    test('a batch already at the Location changes nothing and is highlighted the same way', async ({ cafe, fake }) => {
        const batch = batchOf(fake, 'Sample Blend', '2026-11-02');
        const before = JSON.stringify(fake.library.state);
        const page = await scanned(cafe, [here(fake, batch, beanNamed(fake, 'Sample Blend'))]);
        expect(scans(fake)).toEqual([{ text: LABEL_TEXT }]);
        expect(JSON.stringify(fake.library.state), 'Decaid\'s records as they were').toBe(before);
        expect(await highlightedBean(page)).toEqual(['Sample Blend']);
        expect((await heldBatch(page)).map(row => row.name)).toEqual(['Roasted Nov 2']);
        await expect(useButton(page)).toBeEnabled();
    });

    test('a scan of the batch in use shows "In use", as a tap on it does', async ({ cafe, fake }) => {
        const page = await scanned(cafe, [here(fake, inUse(fake), beanNamed(fake, 'Sample Single Origin'))]);
        expect(await highlightedBean(page)).toEqual(['Sample Single Origin']);
        expect((await heldBatch(page)).map(row => row.name)).toEqual(['Roasted Oct 28']);
        await expect(page.locator('#cafe-pick-confirm-in-use')).toBeVisible();
        await expect(useButton(page)).toBeHidden();
    });

    test('"Use this batch" after a scan, with no recipe loaded, is the one Workflow write a tapped batch makes', async ({ cafe, fake }) => {
        const page = await scanned(cafe, [arriving(fake, 'one')]);
        const mark = fake.log.length;
        await useButton(page).click();
        await expect(pickClosed(page)).toBeAttached();
        await cafe.advance(1000);
        expect(writes(cafe.since(mark))).toEqual([{ write: `PUT ${WORKFLOW}`, body: { context: { beanBatchId: ARRIVING, coffeeName: 'Sample Blend', coffeeRoaster: 'Sample Roasters' } } }]);
        expect(fake.workflow().context.beanBatchId).toBe(ARRIVING);
        await expect(page.locator('#cafe-dose-desc')).toHaveText('Sample Blend · roasted Nov 12');
    });

    test('"Use this batch" after a scan, with a recipe of another Bean loaded, saves the Bean onto the recipe and then writes the Workflow', async ({ cafe, fake }) => {
        const single = beanNamed(fake, 'Sample Single Origin');
        const arrived = arriving(fake, 'one', { name: single.name, roaster: single.roaster, beanId: single.id });
        const page = await scanned(cafe, [arrived], { recipe: house });
        await expect(under(page)).toHaveText(`${house.name} · changes the recipe's bean`);
        const mark = fake.log.length;
        await useButton(page).click();
        await expect(pickClosed(page)).toBeAttached();
        await cafe.advance(1000);
        const made = writes(cafe.since(mark)).filter(entry => entry.write === `POST ${RECORDS}` || entry.write === `PUT ${WORKFLOW}`);
        expect(made.map(entry => entry.write), 'the record first, then the Workflow, as for a tapped batch').toEqual([`POST ${RECORDS}`, `PUT ${WORKFLOW}`]);
        expect(made[1].body).toEqual({ context: { beanBatchId: ARRIVING, coffeeName: single.name, coffeeRoaster: single.roaster } });
        expect(recordOf(fake, house.name)).toMatchObject({ beanId: single.id, beanBatchId: ARRIVING });
    });

    test('"Cancel scan" while a match\'s lists are read keeps the lists Cancel read, not the older read answered after them', async ({ cafe, fake }) => {
        const page = await dialogOpen(cafe, [arriving(fake, 'one')]);
        await scanOpen(cafe);
        const blend = beanNamed(fake, 'Sample Blend');
        // The match's read of Sample Blend's batches is answered as they are now, but only once the test lets it.
        let answered;
        let letGo;
        const reached = new Promise(resolve => { answered = resolve; });
        const released = new Promise(resolve => { letGo = resolve; });
        let taken = false;
        const stop = cafe.routes.intercept(request => !taken && request.method === 'GET' && request.path.endsWith(`/beans/${blend.id}/batches`), async ({ forward }) => {
            taken = true;
            stop();
            const answer = forward();
            answered();
            await released;
            return answer;
        });
        await page.clock.runFor(500);
        await reached;
        // A batch of Sample Blend is finished meanwhile: the read Cancel makes no longer lists it.
        const finished = batchOf(fake, 'Sample Blend', '2026-11-02');
        finished.archived = true;
        await page.locator('#cafe-scan-cancel').click();
        await expect(scanPart(page)).toBeHidden();
        letGo();
        await cafe.settle();
        await page.locator('#cafe-pick-side .cafe-pick-row').filter({ hasText: 'Sample Blend' }).click();
        const rows = await page.locator('#cafe-pick-list .cafe-pick-row .cafe-pick-row-name').allTextContents();
        expect(rows, 'the finished batch is not offered').not.toContain('Roasted Nov 2');
        expect(rows).toContain('Roasted Nov 12');
    });

    test('the page going out of view while a match\'s lists are read goes back to lists read again, with the batch that came', async ({ cafe, fake }) => {
        const page = await dialogOpen(cafe, [arriving(fake, 'one')]);
        await scanOpen(cafe);
        const lists = hold(cafe, { method: 'GET', path: /\/api\/v1\/beans\?/ });
        await page.clock.runFor(500);
        await lists.reached;
        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await expect(scanPart(page)).toBeHidden();
        expect(await tracks(page)).toEqual(['video ended']);
        lists.release();
        await cafe.settle();
        const blend = page.locator('#cafe-pick-side .cafe-pick-row').filter({ hasText: 'Sample Blend' });
        await expect(blend.locator('.cafe-pick-row-detail'), 'the lists shown are the ones read after the batch came').toHaveText('Sample Roasters · 3 batches');
        await blend.click();
        expect(await page.locator('#cafe-pick-list .cafe-pick-row .cafe-pick-row-name').allTextContents()).toContain('Roasted Nov 12');
    });

    test('closing the dialog after a scan leaves the batch at the Location and writes nothing', async ({ cafe, fake }) => {
        const page = await scanned(cafe, [arriving(fake, 'one')]);
        const workflow = JSON.stringify(fake.workflow());
        const mark = fake.log.length;
        await page.locator(CLOSE).click();
        await expect(pickClosed(page)).toBeAttached();
        await cafe.advance(2000);
        expect(writes(cafe.since(mark))).toEqual([]);
        expect(JSON.stringify(fake.workflow())).toBe(workflow);
        expect(fake.decentSync.batches()[0].at).toBe('here');
    });

    test('several matches are listed, a tap on one asks the plugin with that batch and highlights it', async ({ cafe, fake }) => {
        const blend = beanNamed(fake, 'Sample Blend');
        const held = batchOf(fake, 'Sample Blend', '2026-11-02');
        const batches = [
            arriving(fake, 'one'),
            { ...here(fake, held, blend), id: '019b7c1e-52aa-7c41-8e0d-3f5a6b7c8d92' },
            arriving(fake, 'none', { id: '019b7c1e-52aa-7c41-8e0d-3f5a6b7c8d93', roastDate: null, batchId: '6e0d8b17-1a2f-4c3d-9e5f-7a8b9c0d1e2f' }),
        ];
        const page = await dialogOpen(cafe, batches);
        await scanOpen(cafe);
        await read(cafe);
        await expect(title(page)).toHaveText('Which batch is it?');
        await expect(under(page)).toHaveText('The label matches 3 batches. Nothing is brought here until you choose one.');
        await expect(page.locator('#cafe-scan-read')).toHaveText(LABEL_TEXT);
        const rows = page.locator('#cafe-scan-match-list .cafe-pick-row');
        expect(await rows.evaluateAll(list => list.map(row => [row.querySelector('.cafe-pick-row-name').textContent, row.querySelector('.cafe-pick-row-detail').textContent])), 'newest roast first').toEqual([
            ['Sample Blend · Roasted Nov 12', `Sample Roasters · ${LABEL_TEXT}`],
            ['Sample Blend · Roasted Nov 2', `Sample Roasters · ${LABEL_TEXT}`],
            ['Sample Blend · No roast date', `Sample Roasters · ${LABEL_TEXT}`],
        ]);
        expect(await tracks(page), 'the camera stopped while they are listed').toEqual(['video ended']);
        expect(fake.decentSync.batches().map(batch => batch.at), 'nothing changed until one is tapped').toEqual(['one', 'here', 'none']);
        await cafe.screenshot('scan-matches-light');
        await paint(page, 'dark');
        await cafe.screenshot('scan-matches-dark');
        await paint(page, 'light');

        await rows.nth(0).click();
        await expect(scanPart(page)).toBeHidden();
        await cafe.settle();
        expect(scans(fake)).toEqual([{ text: LABEL_TEXT }, { match: batches[0].id }]);
        expect(fake.decentSync.batches().map(batch => batch.at)).toEqual(['here', 'here', 'none']);
        expect(await highlightedBean(page)).toEqual(['Sample Blend']);
        expect((await heldBatch(page)).map(row => row.name)).toEqual(['Roasted Nov 12']);
        await expect(useButton(page)).toBeEnabled();
    });

    test('while a tapped match is being asked about, "Scan again" can\'t be tapped', async ({ cafe, fake }) => {
        const batches = [arriving(fake, 'one'), arriving(fake, 'none', { id: '019b7c1e-52aa-7c41-8e0d-3f5a6b7c8d93', roastDate: '2026-11-05', batchId: '6e0d8b17-1a2f-4c3d-9e5f-7a8b9c0d1e2f' })];
        const page = await dialogOpen(cafe, batches);
        await scanOpen(cafe);
        await read(cafe);
        await expect(title(page)).toHaveText('Which batch is it?');
        await expect(page.locator('#cafe-scan-again')).toBeEnabled();
        const held = hold(cafe, { method: 'PUT', path: /\/plugins\/decent-sync\.reaplugin\/scan$/ });
        await page.locator('#cafe-scan-match-list .cafe-pick-row').nth(1).click();
        await held.reached;
        await expect(page.locator('#cafe-scan-again')).toBeDisabled();
        held.release();
        await expect(scanPart(page)).toBeHidden();
        await cafe.settle();
        expect(scans(fake)).toEqual([{ text: LABEL_TEXT }, { match: batches[1].id }]);
        expect(await live(page), 'no camera opened again').toEqual([]);
        expect((await heldBatch(page)).map(row => row.name)).toEqual(['Roasted Nov 5']);
    });

    test('"Scan again" over several matches returns to the camera, and "Cancel scan" to the lists', async ({ cafe, fake }) => {
        const batches = [arriving(fake, 'one'), arriving(fake, 'none', { id: '019b7c1e-52aa-7c41-8e0d-3f5a6b7c8d93', roastDate: '2026-11-05', batchId: '6e0d8b17-1a2f-4c3d-9e5f-7a8b9c0d1e2f' })];
        const page = await dialogOpen(cafe, batches);
        await scanOpen(cafe);
        await read(cafe);
        await expect(title(page)).toHaveText('Which batch is it?');
        await page.locator('#cafe-scan-again').click();
        await expect(title(page)).toHaveText('Scan a batch');
        await expect(page.locator('#cafe-scan-camera')).toBeVisible();
        await expect.poll(() => live(page), 'a camera open again').toEqual(['video live']);
        await expect.poll(() => page.evaluate(() => document.getElementById('cafe-scan-video').readyState >= 2)).toBe(true);
        await read(cafe);
        expect(scans(fake), 'the label still in view, and not asked about again at once').toEqual([{ text: LABEL_TEXT }]);
        await expect(title(page)).toHaveText('Scan a batch');
        await page.locator('#cafe-scan-cancel').click();
        await expect(scanPart(page)).toBeHidden();
        await expect(title(page)).toHaveText(TITLE);
        expect(await tracks(page)).toEqual(['video ended', 'video ended']);
        expect(fake.decentSync.batches().map(batch => batch.at), 'and nothing was brought').toEqual(['one', 'none']);
        expect(await highlightedBean(page), 'the lists as they were').toEqual(['Sample Single Origin']);
    });

    test('no match shows the text read and keeps the camera running, and the same text is not asked about again for a few seconds', async ({ cafe, fake }) => {
        const page = await dialogOpen(cafe, []);
        await scanOpen(cafe);
        await read(cafe);
        expect(await message(page)).toEqual(MESSAGES.noMatch);
        expect(scans(fake)).toEqual([{ text: LABEL_TEXT }]);
        expect(await live(page), 'still scanning').toEqual(['video live']);
        await expect(page.locator('#cafe-scan-cancel')).toHaveText('Cancel scan');
        await cafe.screenshot('scan-no-match-light');
        await paint(page, 'dark');
        await cafe.screenshot('scan-no-match-dark');
        await paint(page, 'light');
        await cafe.advance(4000);
        expect(scans(fake), 'the label still in view, and not asked about again').toEqual([{ text: LABEL_TEXT }]);
        await cafe.advance(1500);
        expect(scans(fake), 'asked again once a few seconds have passed').toEqual([{ text: LABEL_TEXT }, { text: LABEL_TEXT }]);
        expect(await live(page)).toEqual(['video live']);
        await page.locator('#cafe-scan-cancel').click();
        await expect(scanPart(page)).toBeHidden();
        expect(await live(page)).toEqual([]);
    });

    test('"Cancel scan" while a label is being looked up goes back to the lists, whatever the answer, without the camera opening again', async ({ cafe, fake }) => {
        const page = await dialogOpen(cafe, []);
        await scanOpen(cafe);
        const lookup = hold(cafe, { method: 'PUT', path: /\/plugins\/decent-sync\.reaplugin\/scan$/ });
        await page.clock.runFor(500);
        await lookup.reached;
        const lists = hold(cafe, { method: 'GET', path: /\/api\/v1\/beans\?/ });
        await page.locator('#cafe-scan-cancel').click();
        await lists.reached;
        expect(await live(page)).toEqual([]);
        // The label matches nothing, and that answer comes while the lists are read again.
        lookup.release();
        await expect.poll(() => page.evaluate(() => window.__cafeFetchesOpen().some(open => open.endsWith('/scan')))).toBe(false);
        await page.evaluate(() => new Promise(resolve => queueMicrotask(resolve)));
        lists.release();
        await expect(scanPart(page)).toBeHidden();
        await cafe.settle();
        await cafe.advance(1000);
        expect(await cameras(page), 'no camera opened again').toEqual([{ facing: 'user', audio: false, tracks: ['video ended'] }]);
        expect(scans(fake)).toEqual([{ text: LABEL_TEXT }]);
        await expect(title(page)).toHaveText(TITLE);
    });
});

test.describe('a scan that fails', { tag: '@scan' }, () => {
    test.use({ decentSync: true });

    test('a tablet with no camera says so, and the lists can still be used', async ({ cafe, fake }) => {
        const page = await dialogOpen(cafe, [arriving(fake, 'one')], { before: NO_CAMERA });
        await scanButton(page).click();
        await expect.poll(() => message(page)).toEqual(MESSAGES.noCamera);
        await expect(page.locator('#cafe-scan-again')).toBeVisible();
        await cafe.screenshot('scan-no-camera-light');
        await backToUsableLists(cafe);
        expect(scans(fake)).toEqual([]);
    });

    test('camera access refused names Decaid\'s setting, and the lists can still be used', async ({ cafe, fake }) => {
        const page = await dialogOpen(cafe, [arriving(fake, 'one')], { allowed: false });
        await scanButton(page).click();
        await expect.poll(() => message(page)).toEqual(MESSAGES.refused);
        expect(await tracks(page)).toEqual([]);
        await cafe.screenshot('scan-camera-refused-light');
        await backToUsableLists(cafe);
        expect(scans(fake)).toEqual([]);
    });

    test('the server out of reach says so with the camera stopped, and the lists can still be used', async ({ cafe, fake }) => {
        const page = await scanOutOfReach(cafe, [arriving(fake, 'one')]);
        expect(await message(page)).toEqual(MESSAGES.unreachable);
        expect(scans(fake)).toEqual([{ text: LABEL_TEXT }]);
        expect(fake.decentSync.batches()[0].at, 'nothing was brought').toBe('one');
        expect(await tracks(page)).toEqual(['video ended']);
        await cafe.screenshot('scan-unreachable-light');
        await paint(page, 'dark');
        await cafe.screenshot('scan-unreachable-dark');
        await paint(page, 'light');
        await backToUsableLists(cafe);
    });

    test('"Scan again" after the server came back reads the label and highlights the batch', async ({ cafe, fake }) => {
        const page = await scanOutOfReach(cafe, [arriving(fake, 'one')]);
        expect(await message(page)).toEqual(MESSAGES.unreachable);
        fake.decentSync.startServer();
        await page.locator('#cafe-scan-again').click();
        await expect.poll(() => live(page)).toEqual(['video live']);
        await expect.poll(() => page.evaluate(() => document.getElementById('cafe-scan-video').readyState >= 2)).toBe(true);
        await read(cafe);
        await expect(scanPart(page)).toBeHidden();
        expect((await heldBatch(page)).map(row => row.name)).toEqual(['Roasted Nov 12']);
    });

    test('"Cancel scan" over several matches, after a failure, leaves no match to tap while the lists are read again', async ({ cafe, fake }) => {
        const batches = [arriving(fake, 'one'), arriving(fake, 'none', { id: '019b7c1e-52aa-7c41-8e0d-3f5a6b7c8d93', roastDate: '2026-11-05', batchId: '6e0d8b17-1a2f-4c3d-9e5f-7a8b9c0d1e2f' })];
        const page = await scanOutOfReach(cafe, batches);
        expect(await message(page)).toEqual(MESSAGES.unreachable);
        fake.decentSync.startServer();
        await page.locator('#cafe-scan-again').click();
        await expect.poll(() => page.evaluate(() => document.getElementById('cafe-scan-video').readyState >= 2)).toBe(true);
        await read(cafe);
        await expect(title(page)).toHaveText('Which batch is it?');
        const lists = hold(cafe, { method: 'GET', path: /\/api\/v1\/beans\?/ });
        await page.locator('#cafe-scan-cancel').click();
        await lists.reached;
        await expect(page.locator('#cafe-scan-match-list .cafe-pick-row').first()).toBeDisabled();
        lists.release();
        await expect(scanPart(page)).toBeHidden();
        await cafe.settle();
        expect(scans(fake)).toEqual([{ text: LABEL_TEXT }, { text: LABEL_TEXT }]);
        expect(fake.decentSync.batches().map(batch => batch.at), 'nothing was brought').toEqual(['one', 'none']);
    });

    test('a refusal that says the Machine is no longer served asks the status again, and the next open has no QR button', async ({ cafe, fake }) => {
        const page = await dialogOpen(cafe, [arriving(fake, 'one')]);
        fake.decentSync.setSharing(false);
        await scanOpen(cafe);
        await read(cafe);
        expect(scans(fake)).toEqual([{ text: LABEL_TEXT }]);
        await expect(page.locator('#cafe-scan-panel')).toBeVisible();
        await page.locator('#cafe-scan-cancel').click();
        await expect(scanPart(page)).toBeHidden();
        await page.locator(CLOSE).click();
        await expect(pickClosed(page)).toBeAttached();
        await cafe.settle();
        await tapAt(page, DOSE);
        await expect(pickDialog(page)).toBeVisible();
        await cafe.settle();
        await expect(scanButton(page)).toBeHidden();
    });

    test('a match whose lists could not be read again says so, and "Back to the list" reads them again, with the batch that came', async ({ cafe, fake }) => {
        const page = await dialogOpen(cafe, [arriving(fake, 'one')]);
        await scanOpen(cafe);
        const allow = fake.refuse({ method: 'GET', path: /^\/api\/v1\/beans\?/, status: 500 });
        await read(cafe);
        await expect(page.locator('#cafe-scan-panel')).toBeVisible();
        expect(fake.decentSync.batches()[0].at, 'the batch came').toBe('here');
        allow();
        await page.locator('#cafe-scan-cancel').click();
        await expect(scanPart(page)).toBeHidden();
        await cafe.settle();
        const blend = page.locator('#cafe-pick-side .cafe-pick-row').filter({ hasText: 'Sample Blend' });
        await expect(blend.locator('.cafe-pick-row-detail'), 'the lists read again').toHaveText('Sample Roasters · 3 batches');
    });

    test('no answer in time says the batch may have come all the same, and the lists are read again', async ({ cafe, fake }) => {
        const page = await dialogOpen(cafe, [arriving(fake, 'one')]);
        await scanOpen(cafe);
        const held = hold(cafe, { method: 'PUT', path: /\/plugins\/decent-sync\.reaplugin\/scan$/ });
        await page.clock.runFor(500);
        await held.reached;
        await expect.poll(() => message(page)).toEqual({ in: 'picture', title: 'Looking up the batch', body: `Read from the label: ${LABEL_TEXT}` });
        await cafe.screenshot('scan-looking-up-light');
        await page.clock.runFor(14_000);
        expect((await message(page)).title, 'still waiting just under the page\'s own time').toBe('Looking up the batch');
        await page.clock.runFor(1000);
        await expect.poll(() => message(page)).toEqual(MESSAGES.noAnswer);
        expect(await tracks(page)).toEqual(['video ended']);
        await cafe.screenshot('scan-no-answer-light');
        // The answer comes after all: the batch was brought, and the page has stopped waiting for it.
        held.release();
        await cafe.settle();
        expect(await message(page)).toEqual(MESSAGES.noAnswer);
        expect(fake.decentSync.batches()[0].at).toBe('here');
        await page.locator('#cafe-scan-cancel').click();
        await expect(scanPart(page)).toBeHidden();
        await cafe.settle();
        const blend = page.locator('#cafe-pick-side .cafe-pick-row').filter({ hasText: 'Sample Blend' });
        await expect(blend.locator('.cafe-pick-row-detail'), 'the lists read again: the batch that came is in them').toHaveText('Sample Roasters · 3 batches');
        await blend.click();
        await page.locator('#cafe-pick-list .cafe-pick-row').first().click();
        await expect(useButton(page)).toBeEnabled();
    });
});

test.describe('the camera', { tag: '@scan' }, () => {
    test.use({ decentSync: true });

    const WAYS_OUT = {
        'Cancel scan': async cafe => { await cafe.page.locator('#cafe-scan-cancel').click(); },
        Close: async cafe => { await cafe.page.locator(CLOSE).click(); },
        'a tap outside': async cafe => { await cafe.page.mouse.click(30, 30); },
        'a shot starting': async cafe => { await cafe.pour(cafe.fake.machine.pourMoment((frame, socket) => socket === 'machine/snapshot' && frame.state?.state === 'espresso')); },
        'the machine going to sleep': async cafe => { cafe.fake.machine.setState('sleeping'); await cafe.advance(500); },
        'the main page hidden behind Settings': async cafe => {
            await cafe.page.evaluate(() => document.getElementById('settings-btn').click());
            await expect(cafe.page.locator('#subpage-host #settings-content-area')).toBeVisible();
        },
    };
    for (const [way, leave] of Object.entries(WAYS_OUT)) {
        test(`its tracks are stopped by ${way}`, async ({ cafe }) => {
            const page = await dialogOpen(cafe, []);
            await scanOpen(cafe);
            expect(await tracks(page)).toEqual(['video live']);
            await leave(cafe);
            await expect.poll(() => tracks(page)).toEqual(['video ended']);
            await expect(scanPart(page)).toBeHidden();
            if (way === 'Cancel scan') await expect(pickDialog(page), 'the dialog stays, on its lists').toBeVisible();
            else await expect(pickClosed(page)).toBeAttached();
            expect(await page.evaluate(() => document.getElementById('cafe-scan-video').srcObject), 'and its picture taken off the page').toBeNull();
        });
    }

    test('while a label is being looked up, the camera can\'t be switched, so only its answer comes back', async ({ cafe, fake }) => {
        const before = `(${WATCH_CAMERAS})(); (${TWO_CAMERAS})();`;
        const page = await dialogOpen(cafe, [arriving(fake, 'one')], { before });
        await scanOpen(cafe);
        await expect(page.locator('#cafe-scan-switch')).toBeEnabled();
        const held = hold(cafe, { method: 'PUT', path: /\/plugins\/decent-sync\.reaplugin\/scan$/ });
        await page.clock.runFor(500);
        await held.reached;
        await expect(page.locator('#cafe-scan-switch')).toBeDisabled();
        held.release();
        await expect(scanPart(page)).toBeHidden();
        await cafe.settle();
        expect(scans(fake)).toEqual([{ text: LABEL_TEXT }]);
        expect(await cameras(page), 'one camera opened, and stopped').toEqual([{ facing: 'user', audio: false, tracks: ['video ended'] }]);
        expect((await heldBatch(page)).map(row => row.name)).toEqual(['Roasted Nov 12']);
    });

    test('a camera that opens after its scan was left is stopped without taking the picture off a newer scan', async ({ cafe }) => {
        const before = `(${HOLD_FIRST_CAMERA})(); (${WATCH_CAMERAS})();`;
        const page = await dialogOpen(cafe, [], { before });
        await scanButton(page).click();
        await expect(scanPart(page)).toBeVisible();
        await expect.poll(() => page.evaluate(() => typeof window.__openFirstCamera === 'function'), 'the first camera asked for').toBe(true);
        await page.locator('#cafe-scan-cancel').click();
        await expect(scanPart(page)).toBeHidden();
        await scanOpen(cafe);
        await page.evaluate(() => window.__openFirstCamera());
        await expect.poll(() => tracks(page), 'the late one stopped').toEqual(['video ended', 'video live']);
        expect(await page.evaluate(() => document.getElementById('cafe-scan-video').srcObject === window.__cameras[1].stream), 'the newer scan\'s picture still shown').toBe(true);
        await page.locator('#cafe-scan-cancel').click();
        await expect.poll(() => tracks(page)).toEqual(['video ended', 'video ended']);
    });

    test('the switch appears with more than one camera, and the choice is remembered after the page reloads', async ({ cafe, fake }) => {
        const before = `(${WATCH_CAMERAS})(); (${TWO_CAMERAS})();`;
        const page = await dialogOpen(cafe, [], { before });
        await scanOpen(cafe);
        expect(await cameras(page), 'it opens on the camera facing the barista').toEqual([{ facing: 'user', audio: false, tracks: ['video live'] }]);
        await expect(page.locator('#cafe-scan-switch')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Switch camera' })).toBeVisible();
        await expect(page.locator('#cafe-scan-facing')).toHaveText('Front camera');
        await cafe.screenshot('scan-view-two-cameras-light');
        await page.locator('#cafe-scan-switch').click();
        await expect.poll(() => cameras(page)).toEqual([
            { facing: 'user', audio: false, tracks: ['video ended'] },
            { facing: 'environment', audio: false, tracks: ['video live'] },
        ]);
        await expect(page.locator('#cafe-scan-facing')).toHaveText('Rear camera');
        await cafe.settle();
        expect(fake.store.get('streamlineCafe', 'scanCamera'), 'kept in the Skin\'s own namespace of Decaid\'s store').toBe('environment');
        expect(writes(fake.log).filter(entry => entry.write.endsWith(CAMERA_STORE)).length).toBe(1);

        // The page starts again on a clock that runs.
        await page.clock.resume();
        await page.reload();
        await page.locator('#cafe-strip .cafe-card').first().waitFor();
        await expect.poll(() => cafe.routes.sockets.has('/ws/v1/machine/snapshot')).toBe(true);
        await cafe.settle();
        await tapAt(page, DOSE);
        await expect(pickDialog(page)).toBeVisible();
        await cafe.settle();
        await scanOpen(cafe);
        expect(await cameras(page), 'the camera chosen before').toEqual([{ facing: 'environment', audio: false, tracks: ['video live'] }]);
        await expect(page.locator('#cafe-scan-facing')).toHaveText('Rear camera');
    });
});
