// What the Shots list says, row by row, and how its pages join up
// (docs/cafe/DESIGN.md, "The Shots list"). No browser global is touched.
//
// A row is worked out from a Shot as the Shot seam lists it, which is the same
// thing whether Decaid or Decent Sync's plugin listed it, and from DYE2's
// records, which name the recipe: Decaid's row names it by its DYE2 record id
// only.
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
 * What one row of the list says, from a Shot as the seam lists it, which is
 * the same thing whichever source listed it.
 *
 * - `recipes`: DYE2's records, which name a recipe the row names by its record
 *   id. A recipe this tablet has no record of is named as the row names it,
 *   and one the row does not name either lists as a Shot with no recipe.
 *
 * The answer: `id`; `when`, a Date or null; `day`, the day it falls under, or
 * null; `recipe`, the DYE2 record or null; `name`, the recipe's name, or null
 * for none; `bean`; `dose`, `yield`, in grams, and `duration`, in seconds,
 * each null where it is not known; `rating`, null for unrated; `barista`;
 * `hasNote`; `unfinished`; `machine`, the name of the Machine that pulled it,
 * or null, and `thisMachine`; `referenceOf`, the recipes it is the reference
 * of, or null where that is not known; and `isReference`.
 */
export function shotRow(listed, { recipes = [] } = {}) {
    const records = Array.isArray(recipes) ? recipes : [];
    const record = id => (id == null ? null : records.find(r => r && String(r.id) === String(id)) || null);
    const recipe = record(listed.recipeId);
    const when = listed.when instanceof Date && !Number.isNaN(listed.when.getTime()) ? listed.when : null;
    const referenceOf = Array.isArray(listed.referenceOf) ? listed.referenceOf : null;
    return {
        id: String(listed.id),
        when,
        day: when ? dayOf(when) : null,
        recipe,
        name: recipe ? recipeName(recipe) : text(listed.recipeName) || null,
        bean: text(listed.bean),
        dose: positive(listed.dose),
        yield: positive(listed.yield),
        duration: positive(listed.duration),
        rating: ratingOf(listed.rating),
        barista: text(listed.barista),
        hasNote: listed.hasNote === true,
        unfinished: listed.unfinished === true,
        machine: text(listed.machine) || null,
        thisMachine: listed.thisMachine === true,
        referenceOf,
        isReference: isReferenceOf(referenceOf, record),
    };
}

// Does a row carry the "Reference" chip? It is the reference of a recipe this
// tablet holds a record of, or of one it holds none of, which only the
// Location's list names. A choice kept on the tablet for a recipe the tablet
// no longer holds is no chip.
function isReferenceOf(referenceOf, record) {
    return !!referenceOf && referenceOf.some(id => id === null || record(id) !== null);
}

/**
 * What the list says about where it comes from, from the seam's word on what
 * is listed and why (`shotsList` in sync-status.js):
 *
 * - `under`: what stands under the title, `{ text, translate }`, or null: the
 *   Location's name, which is no phrase, or "This machine only".
 * - `line`: why only this machine's Shots are listed, `{ text, translate }`,
 *   or null. A refusal the skin does not know gives its own message, which is
 *   the plugin's and in English.
 * - `location`: whether the rows are the Location's, which adds the Machine
 *   and Time columns and the Unfinished mark.
 */
export function listHeader(list) {
    const only = { text: 'This machine only', translate: true };
    switch (list && list.why) {
        case 'served':
            return { under: list.location ? { text: list.location, translate: false } : null, line: null, location: true };
        case 'notServed':
            return { under: only, line: { text: NOT_AT_A_LOCATION, translate: true }, location: false };
        case 'unreachable':
            return { under: only, line: { text: LIST_UNREACHABLE, translate: true }, location: false };
        case 'refused':
            return { under: only, line: list.message ? { text: list.message, translate: false } : null, location: false };
        default: // no plugin, or the plugin has not said yet
            return { under: null, line: null, location: false };
    }
}

/** The list's line on a Capture-only Machine, and on the wrong hardware. */
export const NOT_AT_A_LOCATION = "This machine isn't at a Decent Sync Location, so only its own shots are listed.";
/** The list's line while Decent Sync's server can't be reached. */
export const LIST_UNREACHABLE = "Decent Sync can't be reached, so only this machine's shots are listed.";

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

/** "27.3 s", how long a Shot ran, with "—" where the list does not say. */
export function durationText(row) {
    return row.duration === null ? '—' : `${row.duration.toFixed(1)} s`;
}

/**
 * The rows with a recipe's reference moved to the Shot `shotId`, or to none.
 * A row that is another recipe's reference too keeps its chip. Rows of a list
 * that does not know which Shots are references are left alone.
 */
export function withReference(rows, recipeId, shotId) {
    const key = String(recipeId);
    return rows.map(row => {
        if (!Array.isArray(row.referenceOf)) return row;
        const has = row.referenceOf.includes(key);
        const is = shotId != null && row.id === String(shotId);
        if (has === is) return row;
        const referenceOf = is ? [...row.referenceOf, key] : row.referenceOf.filter(id => id !== key);
        return { ...row, referenceOf, isReference: referenceOf.length > 0 };
    });
}
