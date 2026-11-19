// The legend at its fullest, in every language (docs/cafe/DESIGN.md, "The
// latest Shot", "Shots and the reference"; once the end of step 9 of the smoke
// run, `ratingAndNotes` in test/cafe-smoke/run.mjs): the Shot's row with its
// time and barista, its stars, its note and Make reference, and the reference's
// row with its time and barista, its rating and its note; that row fits in
// English and each language Streamline has finished, nothing running past it
// and nothing cut short but a barista's name; then the same with "Different
// profile", where a time may be cut short too.
//
// The starting state, as the smoke run had it by then: House espresso loaded,
// its latest Shot rated and noted, and an older Shot of the same recipe, rated
// and noted, chosen as its reference on the tablet (the `streamlineCafe`
// namespace's `references`, src/cafe/cafe-store.js), each naming a barista.
// The two Shots are copies of a sample Shot, added before the page opens.
// The reference's profile is changed through Decaid's `PUT /shots/<id>`
// (fake-decaid/shots.js, recordings/shots.json) and the page looks again as
// when it comes back into view, as the smoke run did.
//
// A language is changed through the page's `setLanguage` (src/modules/i18n.js),
// the function Streamline's Settings list calls, as the smoke run changed it;
// the legend is painted again on its `streamline:languagechange`
// (src/cafe/graph.js). The language it writes to Decaid's store is this test's
// fake's alone.
//
// The zone is pinned to UTC, where both Shots were pulled today: in a zone
// where the start is just past midnight they are yesterday's, and the legend
// shows a date, which is wider.

import { test, expect } from './support/test.mjs';
import { legend, remarks, legendFits, load } from './support/page-reads.mjs';
import { recordOf } from './support/fake-reads.mjs';
import { localTime } from '../../fake-decaid/index.js';
import { SUPPORTED_LANGUAGES } from '../../src/modules/i18n-parser.js';
import { RECIPES, BARISTAS } from '../cafe-smoke/sample-data.mjs';

const [house] = RECIPES;
const FINISHED_LANGUAGES = SUPPORTED_LANGUAGES.filter(code => code !== 'en' && !code.includes('unfinished'));
const LATEST_ID = '00000000-0000-4000-8000-0000000c0001';
const REFERENCE_ID = '00000000-0000-4000-8000-0000000c0002';
const NOTE = 'Bright and sweet, a little thin.';
const REFERENCE_NOTE = 'Syrupy body, stone fruit, long sweet finish.\nBeans eight days off roast.';
const OTHER_PROFILE = 'Sample other profile';
// "Today 13:50 · Example Barista", in a twelve-hour clock or a 24-hour one.
const credit = name => new RegExp(`^Today \\d{1,2}:\\d{2}(\\s?[AP]M)? · ${name}$`);

// ── Test data ────────────────────────────────────────────────────────────────

/**
 * Two Shots of House espresso, copies of the sample data's newest: the latest,
 * ten minutes before the test starts, rated 8 with a note and pulled by
 * "Example Barista"; and the reference, forty minutes before, rated 7 with a
 * note and pulled by "Sample Barista", chosen on the tablet.
 */
function twoShots(fake) {
    const recipeId = recordOf(fake, house.name).id;
    const [newest] = fake.shots.newest(1);
    const sample = fake.shots.get(newest.id);
    const add = (id, minutes, baristaName, annotations) => {
        const at = fake.now() - minutes * 60_000;
        const context = sample.workflow.context;
        fake.shots.add({
            ...sample,
            id,
            timestamp: localTime(at, fake.timeZone),
            createdAt: new Date(at).toISOString(),
            updatedAt: new Date(at).toISOString(),
            workflow: { ...sample.workflow, context: { ...context, baristaName, extras: { ...context.extras, dye: { ...context.extras?.dye, recipeId } } } },
            annotations: { ...sample.annotations, ...annotations },
        });
    };
    add(REFERENCE_ID, 40, BARISTAS[0], { enjoyment: 7, espressoNotes: REFERENCE_NOTE });
    add(LATEST_ID, 10, BARISTAS[1], { enjoyment: 8, espressoNotes: NOTE });
    fake.store.set('streamlineCafe', 'references', { [recipeId]: REFERENCE_ID });
}

/** The page open with House espresso loaded, its two Shots in the legend. */
async function openFull(cafe, fake) {
    twoShots(fake);
    const page = await cafe.open();
    await load(cafe, house);
    await expect.poll(async () => (await legend(page)).reference, 'the reference is in the legend').toMatch(credit(BARISTAS[0]));
    return page;
}

// ── Languages ────────────────────────────────────────────────────────────────

/** The page in `code`, as Streamline's Settings list sets it, painted in it and its fonts loaded. */
async function inLanguage(cafe, code) {
    const set = await cafe.page.evaluate(async language => {
        const { setLanguage } = await import('/src/modules/i18n.js');
        const now = await setLanguage(language);
        await document.fonts.ready;
        return now;
    }, code);
    expect(set, `the page is in ${code}`).toBe(code);
    await cafe.settle();
}

/**
 * The legend's fit in English and each finished language: `unfit`, each
 * language where something runs past the row or is cut short (a time or a name
 * given way entirely counts), and `cut`, each where a time lacks a tenth of a
 * pixel or more. `name` takes the German screenshot, as the smoke run did.
 */
async function inEveryLanguage(cafe, name) {
    const unfit = [];
    const cut = [];
    for (const code of ['en', ...FINISHED_LANGUAGES]) {
        await inLanguage(cafe, code);
        const fit = await legendFits(cafe.page);
        if (fit.out.length || fit.times.length !== 2 || fit.names.length !== 2) unfit.push(`${code}: ${fit.out.join(', ') || 'a time or a name is missing'}`);
        if (fit.times.some(lack => lack >= 0.1)) cut.push(`${code} ${Math.max(...fit.times)}px`);
        if (code === 'de') await cafe.screenshot(`${name}-de-light`);
    }
    await inLanguage(cafe, 'en');
    return { unfit, cut };
}

// ── The tests ────────────────────────────────────────────────────────────────

test.describe('the legend at its fullest, in every language', { tag: '@legend' }, () => {
    // What fits turns on the text: "Today", not a date, before the time.
    test.use({ timezoneId: 'UTC' });
    test('stars, a note, a barista and Make reference, and a reference with a rating, a barista and a note: it fits in every finished language, only a name cut short', async ({ cafe, fake }) => {
        const page = await openFull(cafe, fake);
        const full = await legend(page);
        expect(full.label).toBe('Latest');
        expect(full.when, 'the Shot\'s time and barista').toMatch(credit(BARISTAS[1]));
        expect(full.reference, 'the reference\'s time and barista').toMatch(credit(BARISTAS[0]));
        expect(full.make).toBe('Make reference');
        expect(full.muted, 'Make reference takes a tap').toBe(false);
        expect(full.flag, 'no "Different profile"').toBeNull();
        expect(await remarks(page), 'the Shot\'s four stars and its note; the reference\'s "★ 3.5" and its note').toEqual({ stars: [100, 100, 100, 100, 0], note: 'note', referenceRating: '★ 3.5', referenceNote: true });
        await cafe.screenshot('legend-full-light');

        const fits = await inEveryLanguage(cafe, 'legend-full');
        expect(FINISHED_LANGUAGES.length, 'Streamline\'s finished languages').toBeGreaterThan(10);
        expect(fits.unfit, 'nothing runs past the row, and nothing but a barista\'s name is cut short').toEqual([]);
        expect(fits.cut, 'never a time').toEqual([]);
        expect((await legend(page)).when, 'back in English').toMatch(credit(BARISTAS[1]));
    });

    test('the fullest row, with "Different profile" as well: it still holds everything in every finished language, only the names and times cut short', async ({ cafe, fake }) => {
        const page = await openFull(cafe, fake);
        const answer = fake.request({ method: 'PUT', url: `/api/v1/shots/${REFERENCE_ID}`, body: { workflow: { profile: { title: OTHER_PROFILE } } } });
        expect(answer.status).toBe(200);
        // Shots have no push: the page looks again when it comes back into view.
        await page.evaluate(() => document.dispatchEvent(new Event('streamline:mainpagevisible')));
        await cafe.settle();
        await expect.poll(async () => (await legend(page)).flag, 'the reference was pulled on another profile').toBe('Different profile');
        const full = await legend(page);
        expect(full.make).toBe('Make reference');
        expect(full.when).toMatch(credit(BARISTAS[1]));
        expect(full.reference).toMatch(credit(BARISTAS[0]));
        expect(await remarks(page)).toEqual({ stars: [100, 100, 100, 100, 0], note: 'note', referenceRating: '★ 3.5', referenceNote: true });
        await cafe.screenshot('legend-fullest-light');

        const fits = await inEveryLanguage(cafe, 'legend-fullest');
        expect(fits.unfit, 'nothing runs past the row, and nothing but the names and the times is cut short').toEqual([]);
        // The smoke run noted where a time is cut short here, and passed either way.
        test.info().annotations.push({ type: 'times cut short', description: fits.cut.length ? fits.cut.join(', ') : 'none' });
    });
});
