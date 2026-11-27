// The grinder dialog's rows, and what choosing a grinder writes
// (docs/cafe/DESIGN.md, "What the screen shows" and "Recipes and the strip").
// No browser global is touched: the phrases go through `t`, which the caller
// hands in (cafeText on the page), and Decaid's answers are handed in too.
//
// A choice writes the Workflow and nothing else. On a Machine Decent Sync
// serves, with a Recipe loaded, Decent Sync records the Recipe's grinder, and
// the setting and RPM the Workflow then holds, from that one write.

/** How many of a grinder's latest Shots are read for the setting it was last used at. */
export const GRINDER_WINDOW = 5;

/** The phrases a row may say, for the translations test. */
export const GRINDER_PHRASES = {
    lastUsed: 'last used at {setting}',
    unnamed: 'Unnamed',
    flat: 'Flat burrs',
    conical: 'Conical burrs',
};

// What DYE2 writes into the Workflow for a grinder with no model and no name.
const UNNAMED = 'Unnamed';

const text = value => (typeof value === 'string' ? value.trim() : '');
const sameId = (a, b) => a != null && b != null && String(a) === String(b);

// A number, or a numeric string read as one; anything else is null.
function numberOf(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
    return null;
}

/**
 * The grinders a dialog lists, from Decaid's answer, which is an array or
 * `{ items }`: those that are not archived. Null where the answer is not a
 * list at all, which is a list that can't be read, not an empty one.
 */
export function listedGrinders(answer) {
    const items = Array.isArray(answer) ? answer : Array.isArray(answer?.items) ? answer.items : null;
    if (!items) return null;
    return items.filter(grinder => grinder && typeof grinder === 'object' && grinder.id != null && grinder.archived !== true);
}

/** A grinder's name: its model, else its name, else null. */
export function grinderName(grinder) {
    return text(grinder?.model) || text(grinder?.name) || null;
}

// A Shot's grind setting as its Workflow holds it, as text, or null. Decaid
// keeps it as text; a number is read as one.
function settingOf(shot) {
    const setting = shot?.workflow?.context?.grinderSetting;
    if (typeof setting === 'number') return Number.isFinite(setting) ? String(setting) : null;
    return text(setting) || null;
}

function rpmOf(shot) {
    const rpm = numberOf(shot?.workflow?.context?.extras?.rpm);
    return rpm !== null && rpm > 0 ? rpm : null;
}

/**
 * The setting and RPM a grinder was last used at: the newest of its latest
 * Shots (`shots`, newest first, as Decaid lists them for that grinder) that
 * holds a setting, with that Shot's RPM, or null where none does. A Shot
 * whose Workflow names another grinder is not counted.
 */
export function lastUse(shots, grinderId) {
    for (const shot of Array.isArray(shots) ? shots : []) {
        if (!sameId(shot?.workflow?.context?.grinderId, grinderId)) continue;
        const setting = settingOf(shot);
        if (setting !== null) return { setting, rpm: rpmOf(shot) };
    }
    return null;
}

// A default kept on the grinder (DYE2 keeps them in its `extras`), held to the
// grinder's own range where it declares one, as DYE2's own picker holds it.
function ownDefault(grinder, key, minKey, maxKey) {
    const extras = grinder?.extras || {};
    let value = numberOf(extras[key]);
    if (value === null) return null;
    const min = numberOf(extras[minKey]);
    const max = numberOf(extras[maxKey]);
    if (min !== null && value < min) value = min;
    if (max !== null && value > max) value = max;
    return value;
}

/**
 * The setting a choice of `grinder` takes, as text, or null where the number
 * stays as it is: the setting it was last used at (`use`, from `lastUse`),
 * else its own default.
 */
export function pickedSetting(grinder, use) {
    if (use?.setting) return use.setting;
    const own = ownDefault(grinder, 'settingDefault', 'settingMin', 'settingMax');
    return own === null ? null : String(own);
}

/** The RPM a choice of `grinder` takes, or null for none: the Shot's, else its own default. */
export function pickedRpm(grinder, use) {
    if (use?.rpm) return use.rpm;
    return ownDefault(grinder, 'rpmDefault', 'rpmMin', 'rpmMax');
}

/**
 * The Workflow write that chooses `grinder`, or null where it is the grinder
 * in use (`context` is the Workflow's), which writes nothing. One write: the
 * grinder's id and model, the setting it takes, and its RPM. A setting the
 * grinder can't give is left out, so the Workflow keeps the number it has;
 * an RPM it can't give is cleared, as DYE2's own picker clears it.
 */
export function grinderPick(grinder, use, context) {
    if (!grinder || grinder.id == null || sameId(grinder.id, context?.grinderId)) return null;
    const patch = { grinderId: grinder.id, grinderModel: grinderName(grinder) || UNNAMED };
    const setting = pickedSetting(grinder, use);
    if (setting !== null) patch.grinderSetting = setting;
    patch.extras = { rpm: pickedRpm(grinder, use) };
    return { context: patch };
}

/** A setting as a row shows it: a number without trailing zeros, other text as it is. */
export function shownSetting(setting) {
    const value = text(String(setting ?? ''));
    return /^-?\d+(\.\d+)?$/.test(value) ? String(Number(value)) : value;
}

// The burrs, where Decaid holds them: the burr set's name, else its type.
function burrsOf(grinder, t) {
    const named = text(grinder?.burrs);
    if (named) return named;
    const type = text(grinder?.burrType).toLowerCase();
    if (type === 'flat') return t(GRINDER_PHRASES.flat);
    if (type === 'conical') return t(GRINDER_PHRASES.conical);
    return text(grinder?.burrType);
}

/**
 * The dialog's rows, sorted by name: each grinder's `name` over its `detail`
 * (its burrs, then the setting it was last used at), and `inUse` for the
 * Workflow's own. `uses` maps a grinder's id to its `lastUse`. A grinder the
 * Workflow names that is not listed, as one archived, marks no row.
 */
export function grinderRows(grinders, context, uses, t) {
    const rows = (grinders || []).map(grinder => {
        const use = uses?.get(String(grinder.id)) || null;
        const detail = [burrsOf(grinder, t)];
        if (use) detail.push(t(GRINDER_PHRASES.lastUsed, { setting: shownSetting(use.setting) }));
        return {
            id: String(grinder.id),
            grinder,
            use,
            name: grinderName(grinder) || t(GRINDER_PHRASES.unnamed),
            detail: detail.filter(Boolean).join(' · '),
            inUse: sameId(grinder.id, context?.grinderId),
        };
    });
    return rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}
