// The page tests' own wait, `cafe.settle()` (test/page/support/test.mjs): it
// returns only once every request the page has sent is answered, one still on
// its way to its route included (#96). settingsSync writes a synced setting to
// Decaid's store with a fetch it never awaits, sent with `keepalive`, and on a
// loaded runner that request once reached its route after `settle()` had
// returned, so the store still held the old value when the test read it.
//
// Here the request is held before the adapter's route has it, as a slow
// delivery would, and released only once the test has seen `settle()` still
// waiting.

import { test, expect } from './support/test.mjs';

const SETTINGS = 'streamlineSettings';
const DYE2_ENABLED = 'streamline.dye2Enabled';

test('settle waits for a setting\'s write the page has sent but its route has not yet received', async ({ cafe, fake, context }) => {
    const page = await cafe.open();
    expect(fake.store.get(SETTINGS, DYE2_ENABLED), 'the setting is on to start with').toBe('true');

    // A route added after the adapter's runs first; `fallback` hands the
    // request on to the adapter's, which only then counts it as being answered.
    let reached;
    const atRoute = new Promise(resolve => { reached = resolve; });
    let pass;
    const passed = new Promise(resolve => { pass = resolve; });
    await context.route(`**/api/v1/store/${SETTINGS}/${DYE2_ENABLED}`, async route => {
        reached();
        await passed;
        await route.fallback();
    });

    try {
        await page.evaluate(key => localStorage.setItem(key, 'false'), DYE2_ENABLED);
        await atRoute;
        // Other requests may be in `inflight` meanwhile, as the page's clock runs on.
        expect([...cafe.routes.inflight].filter(request => request.includes(DYE2_ENABLED)), 'the adapter has not received the write').toEqual([]);
        expect(await page.evaluate(() => window.__cafeFetchesOpen()), 'the page lists the write as sent').toContainEqual(expect.stringContaining(`POST http://127.0.0.1:8080/api/v1/store/${SETTINGS}/${DYE2_ENABLED}`));

        let settled = false;
        const settling = cafe.settle().then(() => { settled = true; });
        // Before #96, settle returned after one turn of the page with nothing in
        // `inflight`; these turns are sent after its first, so they come back after it.
        for (let turn = 0; turn < 3; turn += 1) await page.evaluate(() => 0);
        expect(settled, 'settle still waits for the write').toBe(false);

        pass();
        await settling;
    } finally {
        // A failed check above leaves the write held into the fixture's own settle otherwise.
        pass();
    }
    expect(fake.store.get(SETTINGS, DYE2_ENABLED), 'Decaid\'s store holds the setting off').toBe('false');
});
