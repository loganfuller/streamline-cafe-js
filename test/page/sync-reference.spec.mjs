// The reference with Decent Sync serving (docs/cafe/DESIGN.md, "The reference
// with Decent Sync"), the page's half: the column labelled "saved to the
// recipe"; the latest Shot alone with Make reference, though the tablet's own
// store holds a choice for the recipe, which is never read; the reference asked
// of the plugin by the recipe's DYE2 record id; Make reference as one PUT to
// the plugin and nothing written to the tablet's store, then the badge from the
// plugin's answer; a live pour with the Reference Shot behind it, its frames
// appended; and at rest the legend saying when each Shot was pulled and who
// pulled it, never where, with Make reference back for the new Shot.
//
// Decent Sync's plugin is the fake's (fake-decaid/decent-sync.js), serving the
// Machine at "Sample Cafe" from recordings/decent-sync.json. House espresso's
// latest Shot on the tablet is the recording's Shot A (barista "Example
// Barista"), at the Location, so the plugin takes it as a Reference Shot. The
// pour is the recorded one (recordings/pour.json), on House espresso's profile,
// with "Sample Barista" in the Workflow, so the two Shots' credits differ.
//
// What stays in the real journey: the server holding the choice as the Recipe's
// Reference Shot after the PUT (the fake's own rule, read here only to confirm
// the PUT reached it), and the tablet's recipes joining the Location's Library.

import { test, expect } from './support/test.mjs';
import { recording } from './support/adapter.mjs';
import { legend, chartLines, paint, load, writes, watchDraws, drawCounts, REFERENCE_LINES } from './support/page-reads.mjs';
import { recordOf } from './support/fake-reads.mjs';
import { RECIPES } from './support/sample-data.mjs';
import { shotCurves } from '../../src/cafe/shot-model.js';
import { shotStages } from '../../src/cafe/stage-names.js';

const [house] = RECIPES;
const { A, B } = recording('decent-sync').labels;
const POUR = recording('pour');
const SAVED = 'Dial-in · saved to the recipe';
const PLUGIN = '/api/v1/plugins/decent-sync.reaplugin';
const REFERENCES = '/api/v1/store/streamlineCafe/references';
const SECOND_BARISTA = 'Sample Barista';
// Two moments of the pour, in its fourth step and its fifth (reference.spec.mjs).
const MID_MS = 9000;
const LATER_MS = 12000;

// ── Reading what the page asked ──────────────────────────────────────────────

/** The plugin's `reference` requests in `entries`, as "GET ?recipe=…". */
const referenceAsks = (entries, method) => entries
    .filter(entry => entry.method === method && entry.path === `${PLUGIN}/reference`)
    .map(entry => ({ search: entry.search, body: entry.body }));

/** Every request, read or write, to the tablet's own choice of references in Decaid's store. */
const storeReferences = fake => fake.log.filter(entry => entry.path.startsWith(REFERENCES)).map(entry => `${entry.method} ${entry.path}`);

/** "Today 13:30 · Ana" for a Shot, as the legend writes it (src/cafe/graph.js, `paintCredit`), in the page's locale and zone. */
const creditOf = (page, shot) => page.evaluate(async record => {
    const { whenText, shotCredit } = await import('/src/cafe/shot-model.js');
    const { when, who } = shotCredit(record);
    const time = whenText(when, new Date(), navigator.language, 'Today');
    return who ? `${time} · ${who}` : time;
}, { timestamp: shot.timestamp, workflow: { context: { baristaName: shot.workflow?.context?.baristaName ?? null } } });

const inShot = entry => entry.socket === 'machine/snapshot' && ['preinfusion', 'pouring'].includes(entry.frame.state.substate);
/** The stages the pour has reached by `ms`, as the chart marks them. */
const stagesBy = (ms, workflow) => shotStages(POUR.frames.filter(entry => entry.ms <= ms && entry.socket === 'machine/snapshot').map(entry => ({ machine: entry.frame })), workflow);

/** Plays the pour on to `ms`, and lets the chart draw its last frame. */
async function pourTo(cafe, ms) {
    await cafe.pour(ms);
    await cafe.advance(500);
}

/** The page open, House espresso loaded, and the column labelled "saved to the recipe". */
async function openServed(cafe) {
    const page = await cafe.open();
    await load(cafe, house);
    await expect(page.locator('#cafe-dial-label')).toBeVisible();
    await expect(page.locator('#cafe-dial-label')).toHaveText(SAVED);
    return page;
}

test.describe('the reference with Decent Sync serving', { tag: '@sync-reference' }, () => {
    test.use({ decentSync: true });

    test('sync-no-reference-light: the latest Shot alone and Make reference, the tablet\'s own choice never read, the reference asked by DYE2 record id', async ({ cafe, fake }) => {
        const recordId = recordOf(fake, house.name).id;
        // A choice the tablet made for the recipe before Decent Sync served it.
        fake.store.set('streamlineCafe', 'references', { [recordId]: B });
        expect(fake.decentSync.recipe(recordId).referenceShotId, 'no Reference Shot on the server').toBeNull();

        const page = await openServed(cafe);
        await expect.poll(() => legend(page), 'with no Reference Shot: the latest Shot alone, and Make reference').toMatchObject({
            label: 'Latest', reference: null, badge: null, make: 'Make reference', muted: false, notice: null, flag: null,
        });
        expect((await legend(page)).when, 'the latest is Shot A').toBe(await creditOf(page, fake.shots.get(A)));
        expect((await chartLines(page)).points.slice(7), 'no reference drawn').toEqual([0, 0, 0]);
        expect(storeReferences(fake), 'the choice kept on the tablet is never read').toEqual([]);
        const asks = referenceAsks(fake.log, 'GET');
        expect(asks.length, 'the reference is read from the plugin').toBeGreaterThan(0);
        expect(asks.every(ask => ask.search === `?recipe=${encodeURIComponent(recordId)}`), `by the recipe's DYE2 record id: ${JSON.stringify(asks)}`).toBe(true);
        await cafe.screenshot('sync-no-reference-light');
    });

    test('sync-shot-is-reference-light: Make reference is one PUT to the plugin, nothing written to the tablet\'s store, and the badge from its answer', async ({ cafe, fake }) => {
        const recordId = recordOf(fake, house.name).id;
        const page = await openServed(cafe);
        await expect.poll(async () => (await legend(page)).make).toBe('Make reference');

        const mark = fake.log.length;
        await page.locator('#cafe-make-reference').click();
        await expect(page.locator('#cafe-reference-badge')).toBeVisible();
        await cafe.advance(2000);
        expect(await legend(page), 'the graph follows the answer').toMatchObject({
            label: 'Latest', badge: 'This shot is the reference', make: null, reference: null,
        });
        await expect(page.locator('#cafe-reference-dialog[open]'), 'with none chosen, nothing is asked').toHaveCount(0);
        const since = cafe.since(mark);
        expect(writes(since), 'the one write: the choice, to the plugin').toEqual([
            { write: `PUT ${PLUGIN}/reference`, body: { shotId: A } },
        ]);
        expect(referenceAsks(since, 'PUT'), 'by the recipe\'s DYE2 record id').toEqual([
            { search: `?recipe=${encodeURIComponent(recordId)}`, body: { shotId: A } },
        ]);
        expect(storeReferences(fake), 'and nothing read or written in the tablet\'s own store').toEqual([]);
        expect(fake.decentSync.recipe(recordId).referenceShotId, 'the plugin took it').toBe(A);
        await cafe.screenshot('sync-shot-is-reference-light');
    });

    test('sync-live-reference-light and sync-reference: a pour with the Reference Shot behind it, and at rest the legend naming who, never where, with Make reference back', async ({ cafe, fake }) => {
        const recordId = recordOf(fake, house.name).id;
        fake.decentSync.chooseReference(recordId, A);
        const reference = fake.shots.get(A);
        const curves = shotCurves(reference.measurements);
        const page = await openServed(cafe);
        await expect.poll(async () => (await legend(page)).badge, 'Shot A is the latest, and the reference').toBe('This shot is the reference');
        fake.request({ method: 'PUT', url: '/api/v1/workflow', body: { context: { baristaName: SECOND_BARISTA } } });

        await pourTo(cafe, MID_MS);
        await expect(page.locator('#main-page.cafe-shot-live')).toBeAttached();
        const now = await legend(page);
        expect(now.label).toBe('Live shot');
        expect(now.reference, 'the reference has its row').toBe(await creditOf(page, reference));
        const lines = await chartLines(page);
        expect(lines.names.length).toBe(10);
        expect(lines.names.slice(7)).toEqual(REFERENCE_LINES);
        expect(lines.points.slice(7), 'the whole Reference Shot is drawn behind the live shot').toEqual([curves.pressure.x.length, curves.flow.x.length, curves.weight.x.length]);
        expect(lines.points[0], 'the live shot\'s own frames so far').toBe(POUR.frames.filter(entry => entry.ms <= MID_MS && inShot(entry)).length);

        await watchDraws(page);
        await pourTo(cafe, LATER_MS);
        const draws = await drawCounts(page);
        const framesPlayed = POUR.frames.filter(entry => entry.ms > MID_MS && entry.ms <= LATER_MS && inShot(entry)).length;
        const stagesReached = stagesBy(LATER_MS, fake.workflow()).length - stagesBy(MID_MS, fake.workflow()).length;
        expect(draws.appended, 'a live shot still draws by appending frames, with Decent Sync\'s reference behind it').toBeGreaterThanOrEqual(10);
        expect(draws.appended + draws.full, 'at most one draw a frame').toBeLessThanOrEqual(framesPlayed);
        expect(draws.full, 'drawn in full only for a new stage\'s line').toBe(stagesReached);
        await cafe.screenshot('sync-live-reference-light');

        await cafe.pour();
        await cafe.untilStored();
        const second = await cafe.storeShot();
        await cafe.advance(4000);
        const latest = fake.shots.get(second);
        expect(latest.workflow.context.baristaName).toBe(SECOND_BARISTA);
        await expect.poll(async () => (await legend(page)).when, 'the new Shot is the latest').toBe(await creditOf(page, latest));
        const rest = await legend(page);
        expect(rest, 'at rest: the latest against the reference, and Make reference back').toMatchObject({
            label: 'Latest', reference: await creditOf(page, reference), make: 'Make reference', muted: false, flag: null, badge: null, notice: null,
        });
        expect(rest.when.endsWith(` · ${SECOND_BARISTA}`), `who pulled the new Shot: ${rest.when}`).toBe(true);
        expect(rest.reference.endsWith(' · Example Barista'), `who pulled the reference: ${rest.reference}`).toBe(true);
        const legendText = await page.locator('#cafe-legend').textContent();
        expect(legendText, 'never where').not.toMatch(/Sample (Machine|Cafe)/);
        expect((await chartLines(page)).points.slice(7), 'the reference drawn at rest').toEqual([curves.pressure.x.length, curves.flow.x.length, curves.weight.x.length]);
        expect(storeReferences(fake), 'the tablet\'s own store never asked').toEqual([]);
        await cafe.screenshot('sync-reference-light');
        await paint(page, 'dark');
        await cafe.advance(500);
        await cafe.screenshot('sync-reference-dark');
    });

    test('a Reference Shot another Machine pulled: the legend names its barista, not its Machine or Location', async ({ cafe, fake }) => {
        const { C } = recording('decent-sync').labels;
        const recordId = recordOf(fake, house.name).id;
        fake.decentSync.chooseReference(recordId, C);
        const other = fake.decentSync.others().find(entry => entry.shot.id === C);
        expect(other.machine.name, 'pulled on the other Machine').toBe('Sample Machine Two');
        const page = await openServed(cafe);
        const credit = await creditOf(page, other.shot);
        expect(credit.endsWith(' · Second Barista'), credit).toBe(true);
        await expect.poll(async () => (await legend(page)).reference, 'the reference\'s row: when, and who').toBe(credit);
        expect(await legend(page)).toMatchObject({ label: 'Latest', when: await creditOf(page, fake.shots.get(A)), make: 'Make reference', badge: null });
        expect(await page.locator('#cafe-legend').textContent(), 'never where').not.toMatch(/Sample (Machine|Cafe)/);
        expect(storeReferences(fake)).toEqual([]);
    });
});
