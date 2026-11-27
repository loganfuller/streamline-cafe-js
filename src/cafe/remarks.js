// A Shot's rating and note: what its record says, how five stars show a rating
// and what a tap on one writes, and what an edit sends (docs/cafe/DESIGN.md,
// "Rating and notes"). No browser global is touched.
//
// A rating is on Decaid's scale of 0 to 10, two points a star, where 0 and no
// rating are both unrated. Here an unrated Shot's rating is null, and a Shot
// with no note, or only blanks, has a note of null.

export const STARS = 5;
/** The longest note Decent Sync's plugin takes, in characters. */
export const NOTE_MAX = 40_000;

/** A rating as the page keeps it: a number above 0, to 10, or null for unrated. */
export function ratingOf(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(value, 10) : null;
}

/** A note as the page keeps it: its text, trimmed, or null where there is none. */
export function noteOf(value) {
    return (typeof value === 'string' ? value.trim() : '') || null;
}

/** The rating and note a Shot's record holds, as `{ rating, note }`. */
export function shotRemarks(shot) {
    const annotations = shot && shot.annotations;
    return { rating: ratingOf(annotations?.enjoyment), note: noteOf(annotations?.espressoNotes) };
}

/**
 * How much of each of the five stars is filled, from 0 to 1. An in-between
 * rating is drawn part-filled, so 7 is three and a half stars, as Decent Sync's
 * management interface draws it.
 */
export function starFills(rating) {
    const stars = (ratingOf(rating) || 0) / 2;
    return Array.from({ length: STARS }, (unused, index) => Math.min(1, Math.max(0, stars - index)));
}

/**
 * The rating a tap on a star writes: that many whole stars, or 0, which clears
 * the rating, for a tap on the star chosen. Only an exact match clears: on a
 * Shot rated 7 a tap on the fourth star sets 8.
 */
export function ratingForTap(rating, star) {
    const points = star * 2;
    return ratingOf(rating) === points ? 0 : points;
}

/** A rating as one star and its number of stars, "★ 4" or "★ 3.5"; '' for unrated. */
export function ratingText(rating) {
    const points = ratingOf(rating);
    return points === null ? '' : `★ ${Math.round(points * 5) / 10}`;
}

/** The text a note is saved as: trimmed, and no longer than the plugin takes. Empty text clears the note. */
export function noteToSave(text) {
    return String(text ?? '').trim().slice(0, NOTE_MAX);
}

/**
 * What Decaid's own Shot edit is sent for an edit of `{ rating?, note? }`: only
 * the field edited. Decaid merges it into the Shot's annotations key by key,
 * so every other annotation is kept.
 */
export function annotationsOf(edit) {
    const annotations = {};
    if (edit.rating !== undefined) annotations.enjoyment = edit.rating;
    if (edit.note !== undefined) annotations.espressoNotes = edit.note;
    return { annotations };
}

/** Does a Shot's rating and note, as read, hold what an edit asked for? A rating of 0 asked for none, and empty text for no note. */
export function editMade(edit, remarks) {
    if (!remarks) return false;
    if (edit.rating !== undefined && ratingOf(edit.rating) !== remarks.rating) return false;
    if (edit.note !== undefined && noteOf(edit.note) !== remarks.note) return false;
    return true;
}

/**
 * An edit that was not answered may have been made all the same. So the Shot
 * is read again, with `readShot()`, before the edit is called failed. Resolves
 * with the Shot's rating and note where they hold what was asked for. Rejects
 * otherwise, with `remarks`, what the read found, or null where it found
 * nothing.
 */
export async function editReadAgain(edit, readShot, failed) {
    let now = null;
    try {
        const shot = await readShot();
        now = shot ? shotRemarks(shot) : null;
    } catch (error) { /* not known: the edit is shown as failed */ }
    if (editMade(edit, now)) return now;
    throw Object.assign(new Error(failed.message), { code: failed.code, remarks: now });
}

/**
 * What an edit's answer, or a read after it, says of the rating or the note
 * the edit was of, and of nothing else. The answer also carries the other as
 * it stood when the edit was made, which a later edit of that one may have
 * changed since: an earlier rating's answer must not put a note back.
 */
export function editedRemarks(edit, remarks) {
    const of = {};
    if (!remarks) return of;
    if (edit.rating !== undefined) of.rating = remarks.rating ?? null;
    if (edit.note !== undefined) of.note = remarks.note ?? null;
    return of;
}

/** Do two Shots, or two answers for a reference, have the same rating and note? */
export function sameRemarks(a, b) {
    return (a?.rating ?? null) === (b?.rating ?? null) && (a?.note ?? null) === (b?.note ?? null);
}
