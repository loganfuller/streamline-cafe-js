// Rating and notes (docs/cafe/DESIGN.md, "Rating and notes"; the legend's fit
// in every language is legend-fit.spec.mjs): the latest Shot's five stars, a
// tap that rates it at once and sends the rating alone, a tap on the chosen
// star that clears it, a rating given elsewhere drawn in half stars, a rating
// that fails and one whose answer was lost; the note's dialog, its fit above a
// soft keyboard, a slow save, a note saved trimmed and alone, one that fails
// and is kept, Cancel and an unchanged save that send nothing, and an emptied
// note; and the reference's rating and its note, opened to read.
//
// The page has the first sample recipe loaded, with no Decent Sync, so every
// edit is Decaid's own Shot edit (src/cafe/tablet-shots.js). Its latest Shot
// and its reference are two Shots pulled with that recipe, each a copy of the
// Shot Decaid stored for the recorded pour (fake-decaid/recordings/pour.json),
// added before the page opens as the model's starting state, with the
// reference chosen in the tablet's store as the page keeps it (recipe to
// Shot). Decaid's merge of an edit into a Shot's annotations, keeping the
// others, is fake-decaid/shots.js (recordings/shots.json).

import { test, expect, START } from './support/test.mjs';
import { recording } from './support/adapter.mjs';
import { dropAnswer, hold } from './support/faults.mjs';
import { load, legend, remarks, noteDialog, paint, writes } from './support/page-reads.mjs';
import { recordOf } from './support/fake-reads.mjs';
import { localTime } from '../../fake-decaid/index.js';
import { RECIPES } from './support/sample-data.mjs';

const [house] = RECIPES;
const POUR = recording('pour');
const LATEST = '00000000-0000-4000-8000-0000000c0001';
const REFERENCE = '00000000-0000-4000-8000-0000000c0002';
const SHOT_EDIT = /^\/api\/v1\/shots\/[^/?]+$/;
const NOTE = 'Sweet, a little thin.\nNext time: grind a step finer.';
const REFERENCE_NOTE = 'Syrupy body, stone fruit, long sweet finish.\nBeans eight days off roast.';
const PLACEHOLDER = 'How did it taste? What would you change next time?';

// ── Test data ────────────────────────────────────────────────────────────────

/** A copy of the recorded pour's Shot, pulled with the recipe `minutes` before the test starts. */
function pulled(fake, id, minutes, annotations = {}) {
    const at = START - minutes * 60_000;
    const { shot } = POUR;
    const context = shot.workflow.context;
    return {
        ...shot,
        id,
        timestamp: localTime(at, fake.timeZone),
        createdAt: new Date(at).toISOString(),
        updatedAt: new Date(at).toISOString(),
        workflow: { ...shot.workflow, context: { ...context, extras: { ...context.extras, dye: { ...context.extras.dye, recipeId: recordOf(fake, house.name).id } } } },
        annotations: { ...shot.annotations, ...annotations },
    };
}

/**
 * The page with the recipe loaded, its latest Shot in the graph and another of
 * its Shots chosen as the reference. `latest` and `reference` are annotations
 * each starts with.
 */
async function openWithReference(cafe, { latest = {}, reference = {} } = {}) {
    const { fake, page } = cafe;
    fake.shots.add(pulled(fake, REFERENCE, 120, reference));
    fake.shots.add(pulled(fake, LATEST, 30, latest));
    fake.store.set('streamlineCafe', 'references', { [recordOf(fake, house.name).id]: REFERENCE });
    await cafe.open();
    await load(cafe, house);
    await expect.poll(async () => {
        const now = await legend(page);
        return { label: now.label, reference: now.reference !== null, make: now.make };
    }, 'the latest Shot in the graph, against its reference').toEqual({ label: 'Latest', reference: true, make: 'Make reference' });
    return page;
}

// ── On the page ──────────────────────────────────────────────────────────────

const star = (page, n) => page.locator('#cafe-stars .cafe-star').nth(n - 1).click();
const stars = async page => (await remarks(page)).stars;
const toast = page => page.locator('#app-toast');
const dialogClosed = page => expect(page.locator('#cafe-note-dialog:not([open])')).toBeAttached();
const noteBox = page => page.locator('#cafe-note-text');

/** The page looks again, as when it comes back into view (Shots have no push), and the clock moves past its read. */
async function lookAgain(cafe) {
    await cafe.page.evaluate(() => document.dispatchEvent(new Event('streamline:mainpagevisible')));
    await cafe.advance(1500);
}

/** The edits of the latest Shot since `mark`, each its body. */
const edits = (cafe, mark, id = LATEST) => writes(cafe.since(mark)).filter(({ write }) => write === `PUT /api/v1/shots/${id}`).map(({ body }) => body);
/** Every edit of a Shot since `mark`. */
const shotEdits = (cafe, mark) => writes(cafe.since(mark)).filter(({ write }) => /^PUT \/api\/v1\/shots\//.test(write));
const annotations = fake => fake.shots.get(LATEST).annotations;
/** A Shot's annotations but the rating and the note. */
const others = values => Object.fromEntries(Object.entries(values || {}).filter(([key]) => !['enjoyment', 'espressoNotes'].includes(key)));

test.describe('rating and notes', { tag: '@remarks' }, () => {
    test('the stars: a tap rates the Shot at once, sending the rating alone; the chosen star clears it; a rating given elsewhere is drawn in half stars', async ({ cafe, fake }) => {
        const page = await openWithReference(cafe);
        expect(await remarks(page), 'a saved Shot has five empty stars and a plus for its note; a reference with no rating and no note shows neither')
            .toEqual({ stars: [0, 0, 0, 0, 0], note: 'add', referenceRating: null, referenceNote: false });
        const before = { ...annotations(fake) };

        let mark = fake.log.length;
        await star(page, 4);
        await expect.poll(() => stars(page), 'a tap on the fourth star rates the Shot four stars, at once').toEqual([100, 100, 100, 100, 0]);
        await cafe.advance(1000);
        expect(annotations(fake).enjoyment).toBe(8);
        expect(edits(cafe, mark), 'the edit sent Decaid the rating alone').toEqual([{ annotations: { enjoyment: 8 } }]);
        expect(others(annotations(fake)), 'and the Shot\'s other annotations are untouched').toEqual(others(before));
        expect(annotations(fake).espressoNotes).toBeUndefined();

        mark = fake.log.length;
        await star(page, 4);
        await expect.poll(() => stars(page), 'a tap on the chosen star clears the rating').toEqual([0, 0, 0, 0, 0]);
        await cafe.advance(1000);
        expect(edits(cafe, mark), 'by sending 0').toEqual([{ annotations: { enjoyment: 0 } }]);
        expect(annotations(fake).enjoyment > 0).toBe(false);

        // A rating between two stars, as one given elsewhere.
        expect(fake.request({ method: 'PUT', url: `/api/v1/shots/${LATEST}`, body: { annotations: { enjoyment: 7 } } }).status).toBe(200);
        await lookAgain(cafe);
        await expect.poll(() => stars(page), 'a rating given elsewhere shows at the page\'s next read, and 7 is drawn as three and a half stars').toEqual([100, 100, 100, 50, 0]);
        await cafe.screenshot('rating-half-star-light');

        mark = fake.log.length;
        await star(page, 4);
        await expect.poll(() => stars(page)).toEqual([100, 100, 100, 100, 0]);
        await cafe.advance(1000);
        expect(edits(cafe, mark), 'on a Shot rated 7 a tap on the fourth star sets 8: only an exact match clears').toEqual([{ annotations: { enjoyment: 8 } }]);
        expect(annotations(fake).enjoyment).toBe(8);
    });

    test('a rating that fails puts the stars back with a toast; one Decaid made whose answer was lost is shown as made, with no toast', async ({ cafe, fake }) => {
        const page = await openWithReference(cafe, { latest: { enjoyment: 8 } });
        expect(await stars(page)).toEqual([100, 100, 100, 100, 0]);

        const allow = fake.refuse({ method: 'PUT', path: SHOT_EDIT });
        await star(page, 2);
        await expect(page.locator('#app-toast-message'), 'a toast says so').toHaveText('The rating could not be saved');
        await expect(toast(page)).toBeVisible();
        await expect.poll(() => stars(page), 'a rating that could not be saved puts the stars back').toEqual([100, 100, 100, 100, 0]);
        expect(annotations(fake).enjoyment).toBe(8);
        allow();

        // The toast goes, then an edit Decaid made whose answer never came.
        await cafe.advance(4500);
        await expect(toast(page)).toBeHidden();
        const restore = dropAnswer(cafe, { method: 'PUT', path: SHOT_EDIT, times: 1 });
        const mark = fake.log.length;
        await star(page, 5);
        await cafe.settle();
        await expect.poll(() => stars(page), 'it is read again and shown as made').toEqual([100, 100, 100, 100, 100]);
        await expect(toast(page), 'with no toast').toBeHidden();
        await cafe.advance(1000);
        await expect(toast(page)).toBeHidden();
        expect(await stars(page), 'and the stars stay as made once it has been read again').toEqual([100, 100, 100, 100, 100]);
        restore();
        expect(annotations(fake).enjoyment).toBe(10);
        expect(edits(cafe, mark), 'one edit, made by Decaid').toEqual([{ annotations: { enjoyment: 10 } }]);
        expect(cafe.since(mark, entry => entry.method === 'GET' && entry.path === `/api/v1/shots/${LATEST}`).length, 'read again first').toBeGreaterThan(0);
    });

    test('the note\'s dialog: it names the Shot, gives up height to a keyboard, takes nothing while saving, and saves the note trimmed and alone', async ({ cafe, fake }) => {
        const page = await openWithReference(cafe, { latest: { enjoyment: 8 } });
        const before = { ...annotations(fake) };
        await page.locator('#cafe-shot-note').click();
        const dialog = await noteDialog(page);
        expect(dialog, 'the plus opens the Shot\'s note to write').not.toBeNull();
        expect({ title: dialog.title, when: dialog.when, label: dialog.label, text: dialog.text, read: dialog.read, placeholder: dialog.placeholder, buttons: dialog.buttons, error: dialog.error },
            'it names the Shot as its row does, with a box labelled "Note", Cancel and "Save note"')
            .toEqual({ title: 'Latest', when: (await legend(page)).when, label: 'Note', text: '', read: null, placeholder: PLACEHOLDER, buttons: ['Cancel', 'Save note'], error: null });
        await noteBox(page).fill(`  ${NOTE}  \n`);
        await cafe.screenshot('note-dialog-light');
        await paint(page, 'dark');
        await cafe.screenshot('note-dialog-dark');
        await paint(page, 'light');

        // The soft keyboard, as Streamline's scaling reports it: what is left
        // above one. touch-keyboard.spec.mjs raises one through the
        // visualViewport and checks the dialog's top and bottom sit above it;
        // here, the text box gives up the height, and the dialog goes back.
        const scale = detail => page.evaluate(d => document.dispatchEvent(new CustomEvent('streamline:scaleupdate', { detail: d })), detail);
        await scale({ keyboardUp: true, visibleHeight: 400 });
        const lifted = await noteDialog(page);
        await cafe.screenshot('note-dialog-above-keyboard-light');
        await scale({ keyboardUp: false, visibleHeight: 1200 });
        const settled = await noteDialog(page);
        expect(lifted.boxHeight, 'with a keyboard up the text box keeps a few lines').toBeGreaterThanOrEqual(72);
        expect(lifted.boxHeight, 'and gives up the height').toBeLessThan(settled.boxHeight);
        expect(settled.box.bottom, 'it goes back after').toBeGreaterThan(400);
        expect(settled.box.bottom - settled.box.top, 'at its full height').toBeGreaterThan(lifted.box.bottom - lifted.box.top);

        // A save that takes a while: nothing can be typed into the box
        // meanwhile, since only the text as it stood at the tap is saved.
        const mark = fake.log.length;
        const slow = hold(cafe, { method: 'PUT', path: SHOT_EDIT });
        await page.locator('#cafe-note-save').click();
        await slow.reached;
        const during = await page.evaluate(() => ({ open: document.getElementById('cafe-note-dialog').open, locked: document.getElementById('cafe-note-text').readOnly, save: document.getElementById('cafe-note-save').disabled, cancel: document.getElementById('cafe-note-cancel').disabled }));
        expect(during, 'while a note is being saved the dialog stays, and its box and buttons take nothing').toEqual({ open: true, locked: true, save: true, cancel: true });
        slow.release();
        await dialogClosed(page);
        await cafe.settle();
        expect(await page.evaluate(() => document.getElementById('cafe-note-text').readOnly), 'the box can be typed in again the next time').toBe(false);
        await cafe.advance(1000);
        expect(edits(cafe, mark), 'the note is sent alone, trimmed').toEqual([{ annotations: { espressoNotes: NOTE } }]);
        expect(annotations(fake).espressoNotes).toBe(NOTE);
        expect(annotations(fake).enjoyment, 'the rating is untouched').toBe(8);
        expect(others(annotations(fake)), 'and the Shot\'s other annotations').toEqual(others(before));
        expect((await remarks(page)).note, 'the Shot\'s note icon is a page now, not a plus').toBe('note');

        await page.locator('#cafe-shot-note').click();
        expect((await noteDialog(page))?.text, 'the icon opens the note that was saved, to edit').toBe(NOTE);
    });

    test('a note that fails to save is kept; Cancel and an unchanged save send nothing; an emptied note clears it', async ({ cafe, fake }) => {
        const page = await openWithReference(cafe, { latest: { enjoyment: 8, espressoNotes: NOTE } });
        const MORE = `${NOTE}\nAnd a line that will not save at first.`;
        await page.locator('#cafe-shot-note').click();
        expect((await noteDialog(page))?.text).toBe(NOTE);

        const allow = fake.refuse({ method: 'PUT', path: SHOT_EDIT });
        await noteBox(page).fill(MORE);
        await page.locator('#cafe-note-save').click();
        await expect(page.locator('#cafe-note-error'), 'a line says why').toHaveText('The note could not be saved');
        const dialog = await noteDialog(page);
        expect(dialog, 'a note that could not be saved keeps the dialog open').not.toBeNull();
        expect(dialog.text, 'with its text').toBe(MORE);
        expect(dialog.error).toBe('The note could not be saved');
        expect(annotations(fake).espressoNotes).toBe(NOTE);
        await cafe.screenshot('note-dialog-not-saved-light');
        allow();
        await page.locator('#cafe-note-save').click();
        await dialogClosed(page);
        await cafe.settle();
        expect(annotations(fake).espressoNotes, 'and saving again saves it').toBe(MORE);

        let mark = fake.log.length;
        await page.locator('#cafe-shot-note').click();
        await noteBox(page).fill('Thrown away');
        await page.locator('#cafe-note-cancel').click();
        await dialogClosed(page);
        await cafe.settle();
        await page.locator('#cafe-shot-note').click();
        expect((await noteDialog(page))?.text, 'Cancel left the saved note').toBe(MORE);
        await page.locator('#cafe-note-save').click();
        await dialogClosed(page);
        await cafe.advance(1000);
        expect(edits(cafe, mark), 'Cancel changes nothing, and a note saved as it was sends nothing').toEqual([]);
        expect(annotations(fake).espressoNotes).toBe(MORE);

        mark = fake.log.length;
        await page.locator('#cafe-shot-note').click();
        await noteBox(page).fill('   ');
        await page.locator('#cafe-note-save').click();
        await dialogClosed(page);
        await cafe.advance(1000);
        expect(edits(cafe, mark), 'an emptied note clears it, by sending empty text').toEqual([{ annotations: { espressoNotes: '' } }]);
        expect(annotations(fake).espressoNotes || null).toBeNull();
        expect(annotations(fake).enjoyment).toBe(8);
        expect((await remarks(page)).note, 'and the icon is a plus again').toBe('add');
    });

    test('the reference\'s row: its rating as "★ 3.5", and its note opened to read, which Close leaves unedited', async ({ cafe, fake }) => {
        const page = await openWithReference(cafe, { latest: { enjoyment: 8, espressoNotes: NOTE } });
        expect(await remarks(page), 'a reference with no rating and no note shows neither').toMatchObject({ referenceRating: null, referenceNote: false });
        // Rated and noted elsewhere while the page is open, and looked at again.
        expect(fake.request({ method: 'PUT', url: `/api/v1/shots/${REFERENCE}`, body: { annotations: { enjoyment: 7, espressoNotes: REFERENCE_NOTE } } }).status).toBe(200);
        await lookAgain(cafe);
        await expect.poll(() => remarks(page), 'the reference\'s row shows its rating as "★ 3.5", and a note icon')
            .toEqual({ stars: [100, 100, 100, 100, 0], note: 'note', referenceRating: '★ 3.5', referenceNote: true });

        const mark = fake.log.length;
        await page.locator('#cafe-reference-note').click();
        const dialog = await noteDialog(page);
        expect(dialog, 'the reference\'s note opens').not.toBeNull();
        expect({ title: dialog.title, when: dialog.when, rating: dialog.rating, read: dialog.read, text: dialog.text, label: dialog.label, buttons: dialog.buttons },
            'to read: when and who, its rating, the note as text, and only Close')
            .toEqual({ title: 'Reference', when: (await legend(page)).reference, rating: '★ 3.5', read: REFERENCE_NOTE, text: null, label: null, buttons: ['Close'] });
        await cafe.screenshot('note-reference-light');
        await page.locator('#cafe-note-close').click();
        await dialogClosed(page);
        await cafe.advance(1000);
        expect(shotEdits(cafe, mark), 'Close closes it, and nothing was edited').toEqual([]);
        expect(fake.shots.get(REFERENCE).annotations).toMatchObject({ enjoyment: 7, espressoNotes: REFERENCE_NOTE });
    });
});
