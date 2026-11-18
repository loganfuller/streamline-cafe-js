// The basket dialog's rows, and what choosing a basket writes
// (docs/cafe/DESIGN.md, "The grinder, bean and basket dialogs"). No browser
// global is touched: the phrases go through `t`, and DYE2's list is handed in.
//
// Baskets are DYE2's: its store key `baskets` holds the list. A choice writes
// the Workflow and nothing else, the basket's id and name as DYE2's own picker
// writes them. On a Machine Decent Sync serves, with a Recipe loaded, DYE2
// saves it onto the Recipe when the plugin asks it to save the dial-in.

/** The phrases the dialog may say, for the translations test. */
export const BASKET_PHRASES = {
    title: 'Basket',
    empty: 'No baskets',
    single: 'Single',
    double: 'Double',
    triple: 'Triple',
    bottomless: 'Bottomless',
    other: 'Other',
    diameter: '{mm} mm',
    unnamed: 'Unnamed',
};

// The sizes DYE2 offers. Any other is shown as it is written.
const SIZES = new Set(['single', 'double', 'triple', 'bottomless', 'other']);

// What DYE2 writes into the Workflow for a basket with no name.
const UNNAMED = 'Unnamed';

const text = value => (typeof value === 'string' ? value.trim() : '');
const sameId = (a, b) => a != null && b != null && String(a) === String(b);

/**
 * The baskets a dialog lists, from DYE2's store key as `getDye2KvArray` reads
 * it (a key never written is no baskets there): those not archived. DYE2
 * v0.1.40's have no `archived`, so all of them there. Null where the list
 * could not be read, which is not an empty list.
 */
export function listedBaskets(value) {
    if (!Array.isArray(value)) return null;
    return value.filter(basket => basket && typeof basket === 'object' && basket.id != null && basket.archived !== true);
}

/** The name DYE2 gives a basket: its name, else "Unnamed". */
export function basketName(basket) {
    return text(basket?.name) || UNNAMED;
}

/** A basket's size and diameter: "Double · 58 mm". */
function basketDetail(basket, t) {
    const size = text(basket?.size);
    const word = SIZES.has(size.toLowerCase()) ? BASKET_PHRASES[size.toLowerCase()] : null;
    const parts = [word ? t(word) : size];
    const mm = Number(basket?.diameterMm);
    if (basket?.diameterMm != null && basket.diameterMm !== '' && Number.isFinite(mm) && mm > 0) {
        parts.push(t(BASKET_PHRASES.diameter, { mm: String(mm) }));
    }
    return parts.filter(Boolean).join(' · ');
}

/**
 * The dialog's rows, sorted by name: each basket's name over its size and
 * diameter, and `inUse` for the Workflow's own. A basket the Workflow names
 * that is not listed, as one archived, marks no row.
 */
export function basketRows(baskets, context, t) {
    const rows = (baskets || []).map(basket => ({
        id: String(basket.id),
        basket,
        name: text(basket.name) || t(BASKET_PHRASES.unnamed),
        detail: basketDetail(basket, t),
        inUse: sameId(basket.id, context?.extras?.basketId),
    }));
    return rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

/**
 * The Workflow write that chooses `basket`, or null where it is the basket in
 * use (`context` is the Workflow's), which writes nothing. One write: its id
 * and its name.
 */
export function basketPick(basket, context) {
    if (!basket || basket.id == null || sameId(basket.id, context?.extras?.basketId)) return null;
    return { context: { extras: { basketId: basket.id, basketName: basketName(basket) } } };
}
