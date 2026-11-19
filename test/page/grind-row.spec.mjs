// The Grind row's number (#42; docs/cafe/DESIGN.md, "What the screen shows";
// once step 21 of the smoke run): a preset grinder's setting is shown by its
// name, with − and + writing nothing, a name is fitted between − and + and cut
// with an ellipsis only past the fitting's floor, a wide number is shown whole,
// and a 0.25-step grinder's setting keeps its places through a Workflow read
// and steps on its own grid (src/cafe/grind-text.js, `fitGrind` in
// src/cafe/page.js, the hooks in src/modules/ui.js).
//
// The sample data (fake-decaid/recordings/sample-data.json) holds the preset
// grinder and the 0.25-step one archived; a test un-archives the one it needs,
// as the smoke run did on Decaid. A grinder setting is put in the Workflow as
// the smoke run's `setGrind` did, by a Workflow write the page then reads
// (`streamline:workflow-refresh`, as a plugin's `changed` push makes it). That
// Decaid's merge of a Workflow write leaves the rest of the Workflow alone is a
// recorded scenario (fake-decaid/recordings/workflow-merge.json); that
// `GET /grinders/<id>` answers the grinder whole is recordings/grinders.json.

import { test, expect } from './support/test.mjs';
import { writes } from './support/page-reads.mjs';
import { profileOverride } from './support/fake-reads.mjs';
import { GRINDER, PRESET_GRINDER, QUARTER_GRINDER } from '../cafe-smoke/sample-data.mjs';

const VALUE = '#grind-value';

/** The sample data's grinder by model, un-archived as the smoke run's `ensure()` did. */
function grinder(fake, spec) {
    const found = fake.library.state.grinders.find(g => g.model === spec.model);
    found.archived = false;
    return found;
}

/** The smoke run's `setGrind`: a Workflow write of the grinder and its setting, as another client makes it. */
function setGrind(fake, { id, model }, grinderSetting) {
    const answer = fake.request({ method: 'PUT', url: '/api/v1/workflow', body: { context: { grinderId: id, grinderModel: model, grinderSetting } } });
    expect(answer.status, 'the Workflow write').toBe(200);
}

/** A Workflow read, as the page makes when a plugin says the Workflow changed, and the grinder it names looked up. */
async function readAgain(cafe) {
    await cafe.page.evaluate(() => document.dispatchEvent(new Event('streamline:workflow-refresh')));
    await cafe.advance(500);
}

// The value's text, measured by a Range, against the gap between − and +, and
// the size it was fitted to.
const fit = page => page.evaluate(() => {
    const value = document.getElementById('grind-value');
    const range = document.createRange();
    range.selectNodeContents(value);
    const text = range.getBoundingClientRect();
    const minus = document.getElementById('grind-minus').getBoundingClientRect();
    const plus = document.getElementById('grind-plus').getBoundingClientRect();
    return { left: text.left - minus.right, right: plus.left - text.right, size: parseFloat(getComputedStyle(value).fontSize) };
});

// A step of the setting: its Workflow write and the profile override that keeps it.
const grindWrite = (fake, grinderSetting) => [
    { write: 'PUT /api/v1/workflow', body: { context: { grinderSetting } } },
    profileOverride(fake, grinderSetting),
];

test.describe('the Grind row', { tag: '@grind' }, () => {
    test('a preset grinder\'s setting shows by its name, and − and + write nothing', async ({ cafe, fake }) => {
        const preset = grinder(fake, PRESET_GRINDER);
        expect(preset.settingType).toBe('preset');
        setGrind(fake, preset, 'Medium');
        const page = await cafe.open();
        await expect(page.locator(VALUE)).toHaveText('Medium');
        await cafe.screenshot('grind-row-preset-light');

        const mark = fake.log.length;
        await page.locator('#grind-plus').click();
        // Past the − and +'s debounce, when a step would have been written.
        await cafe.advance(1000);
        await expect(page.locator(VALUE)).toHaveText('Medium');
        expect(writes(cafe.since(mark)), '+ writes nothing').toEqual([]);
        await page.locator('#grind-minus').click();
        await cafe.advance(1000);
        await expect(page.locator(VALUE)).toHaveText('Medium');
        expect(writes(cafe.since(mark)), '− writes nothing').toEqual([]);
        expect(fake.workflow().context.grinderSetting).toBe('Medium');
    });

    test('a name is fitted between − and +, and one too long for the floor ends in an ellipsis', async ({ cafe, fake }) => {
        const preset = grinder(fake, PRESET_GRINDER);
        setGrind(fake, preset, 'Medium');
        const page = await cafe.open();
        await expect(page.locator(VALUE)).toHaveText('Medium');
        const medium = await fit(page);
        expect(medium.left, 'Medium clear of −').toBeGreaterThanOrEqual(4);
        expect(medium.right, 'Medium clear of +').toBeGreaterThanOrEqual(4);
        expect(medium.size, 'Medium shrunk no further than it must be').toBeGreaterThanOrEqual(20);

        setGrind(fake, preset, 'Extra coarse');
        await readAgain(cafe);
        await expect(page.locator(VALUE)).toHaveText('Extra coarse');
        const long = await fit(page);
        expect(long.left, 'a longer name clear of −').toBeGreaterThanOrEqual(4);
        expect(long.right, 'a longer name clear of +').toBeGreaterThanOrEqual(4);
        expect(long.size, 'a longer name shrunk to fit').toBeGreaterThanOrEqual(14);
        expect(long.size).toBeLessThan(30);

        // Too long even at the fitting's 8 px floor: cut inside the value's box,
        // never run under − or +.
        const tooLong = 'Extra coarse for cold brew and large batch service only';
        setGrind(fake, preset, tooLong);
        await readAgain(cafe);
        await expect(page.locator(VALUE)).toHaveText(tooLong);
        const clipped = await page.evaluate(() => {
            const value = document.getElementById('grind-value');
            const box = value.getBoundingClientRect();
            const minus = document.getElementById('grind-minus').getBoundingClientRect();
            const plus = document.getElementById('grind-plus').getBoundingClientRect();
            return { left: box.left - minus.right, right: plus.left - box.right, cut: value.scrollWidth > value.clientWidth, overflow: getComputedStyle(value).textOverflow };
        });
        expect(clipped).toMatchObject({ cut: true, overflow: 'ellipsis' });
        expect(clipped.left, 'the box clear of −').toBeGreaterThanOrEqual(0);
        expect(clipped.right, 'the box clear of +').toBeGreaterThanOrEqual(0);
    });

    // The fitting measures the row's own tabular digits, wider than a canvas
    // draws them, so a wide number is left to show whole.
    test('a wide number such as 111.25 is shown whole, not cut, and clear of − and +', async ({ cafe, fake }) => {
        const preset = grinder(fake, PRESET_GRINDER);
        const quarter = grinder(fake, QUARTER_GRINDER);
        setGrind(fake, preset, 'Medium');
        const page = await cafe.open();
        await expect(page.locator(VALUE)).toHaveText('Medium');

        setGrind(fake, quarter, '111.25');
        await readAgain(cafe);
        await expect(page.locator(VALUE)).toHaveText('111.25');
        expect(await page.locator(VALUE).evaluate(value => getComputedStyle(value).overflowX)).toBe('visible');
        const wide = await fit(page);
        expect(wide.left, 'clear of −').toBeGreaterThanOrEqual(0);
        expect(wide.right, 'clear of +').toBeGreaterThanOrEqual(0);
    });

    test('a 0.25-step grinder keeps its places through a Workflow read and steps on its own grid', async ({ cafe, fake }) => {
        const preset = grinder(fake, PRESET_GRINDER);
        const quarter = grinder(fake, QUARTER_GRINDER);
        expect(quarter.settingSmallStep).toBe(0.25);
        setGrind(fake, preset, 'Medium');
        const page = await cafe.open();
        await expect(page.locator(VALUE)).toHaveText('Medium');

        // The grinder's step is looked up after its setting is painted.
        setGrind(fake, quarter, '11.25');
        await readAgain(cafe);
        await expect(page.locator(VALUE)).toHaveText('11.25');

        let mark = fake.log.length;
        await page.locator('#grind-plus').click();
        await expect(page.locator(VALUE), '+ steps to 11.5, shown to its places').toHaveText('11.50');
        // Past the debounce, and Streamline's own read back after the write.
        await cafe.advance(2000);
        expect(writes(cafe.since(mark)), '11.50 written into the Workflow, once').toEqual(grindWrite(fake, '11.50'));
        expect(fake.workflow().context).toMatchObject({ grinderId: quarter.id, grinderSetting: '11.50' });
        await readAgain(cafe);
        await expect(page.locator(VALUE), 'still 11.50 after the next Workflow read').toHaveText('11.50');

        mark = fake.log.length;
        await page.locator('#grind-minus').click();
        await page.locator('#grind-minus').click();
        // A whole number shows whole (grindText), as Streamline did.
        await expect(page.locator(VALUE), '− twice steps to 11 on its grid').toHaveText('11');
        await cafe.advance(2000);
        expect(writes(cafe.since(mark)), 'the two steps written once, as 11.00').toEqual(grindWrite(fake, '11.00'));
        expect(fake.workflow().context.grinderSetting).toBe('11.00');

        setGrind(fake, quarter, '11.75');
        await readAgain(cafe);
        await expect(page.locator(VALUE)).toHaveText('11.75');
        await cafe.screenshot('grind-row-quarter-light');
    });

    // The sample data leaves the machine on its 0.5-step grinder; the other one
    // declares no step, so the row keeps Streamline's own whole-number and 0.1 rule.
    test('a whole-number and a 0.1-step setting show as on Streamline\'s page', async ({ cafe, fake }) => {
        const plain = grinder(fake, GRINDER);
        const page = await cafe.open();

        setGrind(fake, plain, '12');
        await readAgain(cafe);
        await expect(page.locator(VALUE), 'a whole number shows whole').toHaveText('12');
        setGrind(fake, plain, '2.60');
        await readAgain(cafe);
        await expect(page.locator(VALUE), 'a 0.1-step setting shows to one place').toHaveText('2.6');

        const mark = fake.log.length;
        await page.locator('#grind-plus').click();
        await expect(page.locator(VALUE), '+ steps it to 2.7').toHaveText('2.7');
        await cafe.advance(2000);
        expect(writes(cafe.since(mark))).toEqual(grindWrite(fake, '2.70'));
        await cafe.screenshot('grind-row-at-end');
    });
});
