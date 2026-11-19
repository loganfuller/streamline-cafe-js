// Rating and notes with Decent Sync serving (docs/cafe/DESIGN.md, "Rating and
// notes"; once the page's half of step "5." of the second smoke run,
// test/cafe-smoke/run-decent-sync.mjs, SMOKE.md's S6): every edit of the
// latest Shot is one request to the plugin's `shot`, with the field edited
// alone, and none to Decaid's own Shot edit; the plugin writes the tablet's
// Shot through Decaid. A rating and a note given to the Reference Shot on the
// server reach the open page by the plugin's push, with its row written and
// the chart not drawn again, and its note opens to read. And the plugin's
// refusals of an edit: one with a reason shows the plugin's message and puts
// the stars back; `shotUnwritten` and `unreachable` are read again first, and
// one that was made after all is shown as made, with no toast.
//
// The plugin is the fake's (fake-decaid/decent-sync.js), serving the Machine
// from recordings/decent-sync.json. House espresso's latest Shot on this
// tablet is the label "A"; its Reference Shot, chosen on the server before the
// page opens, is "C", Sample Machine Two's, pulled with the same Recipe. The
// same checks without Decent Sync, through Decaid's own edit, are
// remarks.spec.mjs's; this spec does not repeat its failure cases where the
// plugin's path is the same (a note kept when its save fails is checked here
// only for the plugin's own message in the dialog's line).

import { test, expect } from './support/test.mjs';
import { recording } from './support/adapter.mjs';
import { load, legend, remarks, noteDialog, watchDraws, drawCounts } from './support/page-reads.mjs';
import { recordOf } from './support/fake-reads.mjs';
import { REFUSALS } from '../../fake-decaid/decent-sync.js';
import { RECIPES } from '../cafe-smoke/sample-data.mjs';

const [house] = RECIPES;
const { A: LATEST, C: REFERENCE } = recording('decent-sync').labels;
const PLUGIN_SHOT = '/api/v1/plugins/decent-sync.reaplugin/shot';
const PLUGIN_EDIT = /^\/api\/v1\/plugins\/decent-sync\.reaplugin\/shot\?id=/;
const STATUS = '/api/v1/plugins/decent-sync.reaplugin/status';
const REFERENCE_ASK = '/api/v1/plugins/decent-sync.reaplugin/reference';
const NOTE = 'Bright, with a clean finish.\nKeep the grind where it is.';
const REFERENCE_NOTE = 'The one to match.';

// ── On the page ──────────────────────────────────────────────────────────────

/**
 * The page with House espresso loaded: its latest Shot, "A", in the graph
 * against its Reference Shot, "C", chosen on the server before the page opens.
 */
async function openWithReference(cafe) {
    const { fake, page } = cafe;
    fake.decentSync.chooseReference(recordOf(fake, house.name).id, REFERENCE);
    await cafe.open();
    await load(cafe, house);
    await expect(page.locator('#cafe-dial-label')).toHaveText('Dial-in · saved to the recipe');
    await expect.poll(async () => {
        const now = await legend(page);
        return { label: now.label, reference: now.reference !== null, make: now.make };
    }, 'the latest Shot in the graph, against the Reference Shot the server chose').toEqual({ label: 'Latest', reference: true, make: 'Make reference' });
    return page;
}

const star = (page, n) => page.locator('#cafe-stars .cafe-star').nth(n - 1).click();
const stars = async page => (await remarks(page)).stars;
const toast = page => page.locator('#app-toast');
const toastText = page => page.locator('#app-toast-message');
const dialogClosed = page => expect(page.locator('#cafe-note-dialog:not([open])')).toBeAttached();
const annotations = (fake, id = LATEST) => fake.shots.get(id).annotations;

/** Every Shot edit the page sent since `mark`, to the plugin or to Decaid, as "PUT /path?query body". */
const shotEdits = (cafe, mark) => cafe.since(mark, entry => entry.method === 'PUT' && /\/shots?(\/|$|\?)/.test(entry.path))
    .map(entry => `${entry.path}${entry.search} ${JSON.stringify(entry.body)}`);
/** The plugin's edit of `id`, as `shotEdits` names it, with `body`. */
const editOf = (body, id = LATEST) => `${PLUGIN_SHOT}?id=${encodeURIComponent(id)} ${JSON.stringify(body)}`;
/** How many times `path` was asked with GET since `mark`. */
const asked = (cafe, mark, path) => cafe.since(mark, entry => entry.method === 'GET' && entry.path === path).length;

/**
 * The plugin's next edit is made, the plugin then answering `refusal` instead
 * of what it made, as one that wrote through Decaid and could not say so.
 * Answers a function that stops it.
 */
function madeButRefused(cafe, code) {
    let taken = false;
    return cafe.routes.intercept(request => !taken && request.method === 'PUT' && PLUGIN_EDIT.test(`${request.path}${request.search}`), ({ forward }) => {
        taken = true;
        const made = forward();
        expect(made.status, 'the plugin made the edit').toBe(200);
        return { status: REFUSALS[code].status, body: { code, message: REFUSALS[code].message } };
    });
}

/** The plugin's edits refused with `code`, its status and sentence, until the function it answers is called. */
const refuseEdits = (fake, code) => fake.refuse({ method: 'PUT', path: PLUGIN_EDIT, status: REFUSALS[code].status, body: { code, message: REFUSALS[code].message } });

test.describe('rating and notes with Decent Sync', { tag: '@sync-remarks' }, () => {
    test.use({ decentSync: true });

    test('every edit is one request to the plugin, with the field edited alone, which writes the tablet\'s Shot through Decaid', async ({ cafe, fake }) => {
        const page = await openWithReference(cafe);
        expect(await remarks(page), 'the latest Shot has empty stars and a plus; the Reference Shot, with no rating or note, neither')
            .toEqual({ stars: [0, 0, 0, 0, 0], note: 'add', referenceRating: null, referenceNote: false });
        const start = fake.log.length;

        let mark = fake.log.length;
        await star(page, 4);
        await expect.poll(() => stars(page), 'a tap on the fourth star rates the Shot four stars').toEqual([100, 100, 100, 100, 0]);
        await cafe.advance(1000);
        expect(shotEdits(cafe, mark), 'one request to the plugin, with the rating alone, and nothing to Decaid\'s own Shot edit').toEqual([editOf({ rating: 8 })]);
        expect(annotations(fake).enjoyment, 'the plugin wrote the tablet\'s own Shot through Decaid').toBe(8);

        mark = fake.log.length;
        await star(page, 4);
        await expect.poll(() => stars(page), 'a tap on the chosen star clears the rating').toEqual([0, 0, 0, 0, 0]);
        await cafe.advance(1000);
        expect(shotEdits(cafe, mark), 'by sending 0').toEqual([editOf({ rating: 0 })]);
        expect(annotations(fake).enjoyment > 0).toBe(false);

        mark = fake.log.length;
        await star(page, 5);
        await expect.poll(() => stars(page)).toEqual([100, 100, 100, 100, 100]);
        await cafe.advance(1000);
        expect(shotEdits(cafe, mark)).toEqual([editOf({ rating: 10 })]);
        expect(annotations(fake).enjoyment).toBe(10);

        mark = fake.log.length;
        await page.locator('#cafe-shot-note').click();
        expect((await noteDialog(page))?.buttons).toEqual(['Cancel', 'Save note']);
        await page.locator('#cafe-note-text').fill(`  ${NOTE}  `);
        await cafe.screenshot('sync-note-dialog-light');
        await page.locator('#cafe-note-save').click();
        await dialogClosed(page);
        await cafe.advance(1000);
        expect(shotEdits(cafe, mark), 'the note is sent to the plugin trimmed, and alone').toEqual([editOf({ note: NOTE })]);
        expect(annotations(fake), 'and written into the tablet\'s Shot with the rating untouched').toMatchObject({ espressoNotes: NOTE, enjoyment: 10 });
        expect(await remarks(page), 'the note icon is a page now').toMatchObject({ stars: [100, 100, 100, 100, 100], note: 'note' });

        expect(shotEdits(cafe, start).length, 'four edits in all, every one to the plugin').toBe(4);
        expect(shotEdits(cafe, start).every(edit => edit.startsWith(`${PLUGIN_SHOT}?`))).toBe(true);
    });

    test('a rating and a note given to the Reference Shot on the server show on its row by the push, with the chart not drawn again, and its note opens to read', async ({ cafe, fake }) => {
        // The latest Shot rated and noted already, as the smoke run left it.
        fake.decentSync.editShot(LATEST, { rating: 10, note: NOTE });
        const page = await openWithReference(cafe);
        expect(await remarks(page)).toEqual({ stars: [100, 100, 100, 100, 100], note: 'note', referenceRating: null, referenceNote: false });

        await cafe.advance(1500);
        await watchDraws(page);
        const mark = fake.log.length;
        const opened = cafe.routes.opened.length;
        fake.decentSync.editShot(REFERENCE, { rating: 7, note: REFERENCE_NOTE });
        fake.flush();
        await cafe.settle();
        await expect.poll(() => remarks(page), 'the Reference Shot\'s row shows its rating as "★ 3.5" and a note icon, on the open page')
            .toEqual({ stars: [100, 100, 100, 100, 100], note: 'note', referenceRating: '★ 3.5', referenceNote: true });
        await cafe.advance(1000);
        expect((await drawCounts(page)).full, 'and the chart was not drawn again for it').toBe(0);
        expect(asked(cafe, mark, REFERENCE_ASK), 'the push had the page ask the plugin for the reference').toBeGreaterThan(0);
        expect(cafe.routes.opened.length, 'with no socket opened again: no reload').toBe(opened);
        expect(shotEdits(cafe, mark), 'and the page sent no edit').toEqual([]);

        await page.locator('#cafe-reference-note').click();
        const reading = await noteDialog(page);
        expect(reading, 'the Reference Shot\'s note opens').not.toBeNull();
        expect({ title: reading.title, when: reading.when, rating: reading.rating, read: reading.read, text: reading.text, buttons: reading.buttons },
            'to read, with when and who, its rating, and only Close')
            .toEqual({ title: 'Reference', when: (await legend(page)).reference, rating: '★ 3.5', read: REFERENCE_NOTE, text: null, buttons: ['Close'] });
        await cafe.screenshot('sync-reference-note-light');
        await page.locator('#cafe-note-close').click();
        await dialogClosed(page);
        await cafe.advance(1000);
        expect(shotEdits(cafe, mark), 'Close edits nothing').toEqual([]);
        await cafe.screenshot('sync-rated-light');
    });

    test('a rating the plugin refuses with a reason: the stars go back and a toast shows the plugin\'s message; `shotUnwritten` is read again first', async ({ cafe, fake }) => {
        fake.decentSync.editShot(LATEST, { rating: 8 });
        const page = await openWithReference(cafe);
        expect(await stars(page)).toEqual([100, 100, 100, 100, 0]);

        // A refusal that means the Machine is not served: its message, in the
        // plugin's words, and the status asked again.
        let mark = fake.log.length;
        let allow = refuseEdits(fake, 'captureOnly');
        await star(page, 2);
        await expect(toastText(page), 'a toast with the plugin\'s own message').toHaveText(REFUSALS.captureOnly.message);
        await expect(toast(page)).toBeVisible();
        await expect.poll(() => stars(page), 'the stars go back').toEqual([100, 100, 100, 100, 0]);
        allow();
        await cafe.advance(1000);
        expect(asked(cafe, mark, STATUS), 'a refusal that says the Machine is not served has the status asked again').toBeGreaterThan(0);
        expect(asked(cafe, mark, `/api/v1/shots/${LATEST}`), 'and is not read again').toBe(0);
        expect(annotations(fake).enjoyment).toBe(8);

        // `shotUnwritten`: Decaid may have made it, so the Shot is read again
        // from Decaid; it does not hold the rating, so the message shows.
        await cafe.advance(4000);
        await expect(toast(page)).toBeHidden();
        mark = fake.log.length;
        allow = refuseEdits(fake, 'shotUnwritten');
        await star(page, 3);
        await expect(toastText(page)).toHaveText(REFUSALS.shotUnwritten.message);
        await expect(toast(page)).toBeVisible();
        await expect.poll(() => stars(page)).toEqual([100, 100, 100, 100, 0]);
        allow();
        expect(asked(cafe, mark, `/api/v1/shots/${LATEST}`), 'read again from Decaid first').toBeGreaterThan(0);
        expect(shotEdits(cafe, mark), 'one edit, to the plugin').toEqual([editOf({ rating: 6 })]);
        expect(annotations(fake).enjoyment).toBe(8);
    });

    test('an edit the plugin made but answered `shotUnwritten` or `unreachable` is read again and shown as made, with no toast; one not made goes back', async ({ cafe, fake }) => {
        fake.decentSync.editShot(LATEST, { rating: 8 });
        const page = await openWithReference(cafe);

        for (const [code, n, rating] of [['shotUnwritten', 2, 4], ['unreachable', 5, 10]]) {
            const mark = fake.log.length;
            const stop = madeButRefused(cafe, code);
            await star(page, n);
            await cafe.settle();
            await expect.poll(() => stars(page), `${code}, but made: read again and shown as made`).toEqual(Array.from({ length: 5 }, (_, i) => (i < n ? 100 : 0)));
            await cafe.advance(1000);
            await expect(toast(page), 'with no toast').toBeHidden();
            stop();
            expect(annotations(fake).enjoyment).toBe(rating);
            expect(asked(cafe, mark, `/api/v1/shots/${LATEST}`), 'read again from Decaid, where the tablet holds it').toBeGreaterThan(0);
            expect(shotEdits(cafe, mark)).toEqual([editOf({ rating })]);
        }

        // `unreachable`, and not made: the read found the rating as it was.
        const mark = fake.log.length;
        const allow = refuseEdits(fake, 'unreachable');
        await star(page, 1);
        await expect(toastText(page), 'nothing in the plugin\'s answer to show, so the page\'s own words').toHaveText('The rating could not be saved');
        await expect(toast(page)).toBeVisible();
        await expect.poll(() => stars(page), 'the row follows what the read found').toEqual([100, 100, 100, 100, 100]);
        allow();
        expect(asked(cafe, mark, `/api/v1/shots/${LATEST}`), 'read again first').toBeGreaterThan(0);
        expect(annotations(fake).enjoyment).toBe(10);
        await expect(page.locator('#cafe-dial-label'), 'the Machine is still served').toHaveText('Dial-in · saved to the recipe');
    });

    test('a note the plugin refuses is kept, with the plugin\'s message in the dialog\'s line', async ({ cafe, fake }) => {
        const page = await openWithReference(cafe);
        const allow = refuseEdits(fake, 'captureOnly');
        await page.locator('#cafe-shot-note').click();
        await page.locator('#cafe-note-text').fill(NOTE);
        await page.locator('#cafe-note-save').click();
        await expect(page.locator('#cafe-note-error'), 'a line in the dialog says why, in the plugin\'s words').toHaveText(REFUSALS.captureOnly.message);
        const dialog = await noteDialog(page);
        expect({ text: dialog?.text, buttons: dialog?.buttons }, 'the dialog stays open with its text').toEqual({ text: NOTE, buttons: ['Cancel', 'Save note'] });
        expect(annotations(fake).espressoNotes).toBeUndefined();
        allow();

        const mark = fake.log.length;
        await page.locator('#cafe-note-save').click();
        await dialogClosed(page);
        await cafe.advance(1000);
        expect(shotEdits(cafe, mark), 'saved again, through the plugin').toEqual([editOf({ note: NOTE })]);
        expect(annotations(fake).espressoNotes).toBe(NOTE);
        expect((await remarks(page)).note).toBe('note');
    });
});
