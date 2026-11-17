// What the Shots list says, row by row, and how its pages join up
// (docs/cafe/DESIGN.md, "The Shots list"). No browser global is touched.
//
// A row is worked out from a row of Decaid's list, which carries the Shot's
// Workflow and annotations and no measurements, and from DYE2's records, which
// name the recipe: Decaid's row names it by its DYE2 record id only.
import { shotRecipeId, shotCredit } from './shot-model.js';
import { ratingOf, noteOf } from './remarks.js';
import { recipeName } from './strip-model.js';

/** How many rows a page of the list reads. */
export const PAGE_SIZE = 50;

const text = value => (typeof value === 'string' ? value.trim() : '');
const positive = value => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);
const pad = number => String(number).padStart(2, '0');

/** The calendar day a Date falls on, where the tablet is, as `YYYY-MM-DD`. */
export function dayOf(when) {
    return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
}

/**
 * What one row of the list says, from a row of Decaid's list.
 *
 * - `recipes`: DYE2's records. A Shot whose recipe the tablet no longer holds
 *   lists as a Shot with no recipe.
 * - `references`: recipe to Shot, the choice of reference kept on the tablet,
 *   or null where it is not known which Shots are references.
 *
 * The answer: `id`; `when`, a Date or null; `day`, the day it falls under, or
 * null; `recipe`, the DYE2 record or null; `name`, the recipe's name, or null
 * for none; `bean`; `dose` and `yield`, in grams or null; `rating`, null for
 * unrated; `barista`; `hasNote`; and `isReference`.
 */
export function shotRow(row, { recipes = [], references = null } = {}) {
    const workflow = row?.workflow;
    const context = workflow?.context || {};
    const annotations = row?.annotations || {};
    const recipeId = shotRecipeId(workflow);
    const recipe = recipeId === null ? null : (Array.isArray(recipes) ? recipes : []).find(r => r && String(r.id) === recipeId) || null;
    const { when, who } = shotCredit(row);
    const id = String(row.id);
    return {
        id,
        when,
        day: when ? dayOf(when) : null,
        recipe,
        name: recipe ? recipeName(recipe) : null,
        bean: text(context.coffeeName),
        // The dose the Shot weighed, or where it weighed none the one its
        // Workflow set; the yield Decaid kept, which is the scale's last
        // reading where the shot was not stopped on weight.
        dose: positive(annotations.actualDoseWeight) ?? positive(context.targetDoseWeight),
        yield: positive(annotations.actualYield),
        rating: ratingOf(annotations.enjoyment),
        barista: who,
        hasNote: noteOf(annotations.espressoNotes) !== null,
        isReference: !!recipe && !!references && typeof references === 'object' && references[String(recipe.id)] === id,
    };
}

/**
 * The list with a page added at its end. Decaid's list is ordered by time
 * alone and read by offset, so a Shot pulled since the page before moves every
 * row down one, and the next page starts with a row already listed. That row
 * is not listed twice.
 */
export function withPage(listed, page) {
    const seen = new Set(listed.map(row => row.id));
    const added = [];
    for (const row of page) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        added.push(row);
    }
    return added.length ? [...listed, ...added] : listed;
}

/**
 * Where the next page starts, and whether there is one: `offset`, how many of
 * Decaid's rows have been read, and `total`, how many it says it has. A page
 * shorter than asked for is the last.
 */
export function nextPage({ offset, read, asked, total }) {
    const next = offset + read;
    const done = read < asked || (typeof total === 'number' && next >= total);
    return { offset: next, done };
}

/**
 * The header a day's rows sit under: "Today", "Yesterday", or the date, in
 * `locale`. `words` holds the page's words for the first two.
 */
export function dayTitle(day, now, locale, words) {
    if (day === dayOf(now)) return words.today;
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (day === dayOf(yesterday)) return words.yesterday;
    const [year, month, date] = day.split('-').map(Number);
    const when = new Date(year, month - 1, date);
    const options = { weekday: 'short', day: 'numeric', month: 'short', ...(year === now.getFullYear() ? {} : { year: 'numeric' }) };
    try {
        return when.toLocaleDateString(locale, options);
    } catch (error) {
        return when.toLocaleDateString(undefined, options); // a locale the tablet does not know
    }
}

/**
 * The list as it is drawn: each day's header, then its rows, newest first as
 * Decaid lists them. A row with no time sits under the day before it.
 */
export function listItems(rows) {
    const items = [];
    let day;
    for (const row of rows) {
        if (row.day !== null && row.day !== day) {
            day = row.day;
            items.push({ header: day });
        }
        items.push({ row });
    }
    return items;
}

/** "18.0 → 36.4 g", with "—" for a weight the Shot did not keep. */
export function doseYieldText(row) {
    const grams = value => (value === null ? '—' : value.toFixed(1));
    return `${grams(row.dose)} → ${grams(row.yield)} g`;
}

/**
 * A row with the rating and note an edit on the page left: `remarks` is
 * `{ rating?, note? }`, holding only what the edit was of.
 */
export function withRemarks(row, remarks) {
    const next = { ...row };
    if (remarks.rating !== undefined) next.rating = ratingOf(remarks.rating);
    if (remarks.note !== undefined) next.hasNote = noteOf(remarks.note) !== null;
    return next;
}

/** The rows with a recipe's reference moved to the Shot `shotId`, or to none. */
export function withReference(rows, recipeId, shotId) {
    return rows.map(row => {
        if (!row.recipe || String(row.recipe.id) !== String(recipeId)) return row;
        const isReference = shotId != null && row.id === String(shotId);
        return row.isReference === isReference ? row : { ...row, isReference };
    });
}
