// The barista at the machine: what the title band's button says, which rows its
// dialog lists, what a typed name becomes, and what a pick and the machine
// sleeping write (docs/cafe/DESIGN.md, "The barista"). No browser global is
// touched: the phrases go through `t`, the time through `when`, and the Shots
// are handed in.
//
// The name is the Workflow's `context.baristaName` and lives nowhere else.
// Decaid copies it into each Shot as the shot ends. A pick writes that one
// field, a recipe load leaves it as it was, and the page clears it when it
// sees the machine asleep.

/** The phrases the button and its dialog may say, for the translations test. */
export const BARISTA_PHRASES = {
    button: 'Barista',
    title: 'Barista',
    subtitle: 'Named on this machine\'s shots · cleared when the machine wakes',
    list: 'Baristas',
    lastShot: 'Last shot',
    none: 'No barista',
    noneDetail: 'Shots record no name',
    add: 'New barista',
    field: 'Name',
    back: 'Back',
    use: 'Use this name',
    failed: 'Could not change the barista',
};

const text = value => (typeof value === 'string' ? value.trim() : '');

/**
 * Two names are one barista when they differ only in case or in the spaces
 * around them, as Decent Sync folds them.
 */
export const foldBarista = name => text(name).toLowerCase();

/** The Workflow's barista, trimmed, or '' where none is named. */
export function baristaName(context) {
    return text(context?.baristaName);
}

/**
 * The dialog's rows, in the order shown:
 *
 * - the name in use, where no Shot read carries it, marked and with no second
 *   line;
 * - each name on `shots`, once, most recent first, under its most recent
 *   spelling, over "Last shot" and when (`when(date)`, '' for none, which
 *   leaves the line out);
 * - "No barista", marked where none is in use.
 *
 * `shots` are the seam's rows, newest first, each with `barista` and `when`.
 * A Shot with no name adds no row. Each row carries `barista`, the name a tap
 * chooses, or null for "No barista".
 */
export function baristaRows(shots, current, t, when) {
    const inUse = foldBarista(current);
    const seen = new Map();
    for (const shot of Array.isArray(shots) ? shots : []) {
        const name = text(shot?.barista);
        const fold = foldBarista(name);
        if (!fold || seen.has(fold)) continue;
        const said = when(shot.when ?? null);
        seen.set(fold, {
            id: `name:${fold}`,
            barista: name,
            name,
            detail: said ? `${t(BARISTA_PHRASES.lastShot)} ${said}` : '',
            inUse: fold === inUse,
        });
    }
    const rows = [...seen.values()];
    if (inUse && !seen.has(inUse)) {
        const name = text(current);
        rows.unshift({ id: `name:${inUse}`, barista: name, name, detail: '', inUse: true });
    }
    rows.push({ id: 'none', barista: null, name: t(BARISTA_PHRASES.none), detail: t(BARISTA_PHRASES.noneDetail), inUse: !inUse });
    return rows;
}

/**
 * What a name typed under "New barista" becomes: trimmed, and where it matches
 * a listed name but for case, that listed name. Null for one that is empty,
 * which does nothing.
 */
export function typedBarista(typed, rows) {
    const name = text(typed);
    if (!name) return null;
    const fold = foldBarista(name);
    const listed = (rows || []).find(row => row.barista && foldBarista(row.barista) === fold);
    return listed ? listed.barista : name;
}

/**
 * The Workflow write that makes `name` the barista, or clears it for null, in
 * one field. Null where it is the barista in use already (`context` is the
 * Workflow's), which writes nothing: the row in use, or "No barista" with none.
 */
export function baristaPick(name, context) {
    const next = text(name);
    if (foldBarista(next) === foldBarista(baristaName(context))) return null;
    return { context: { baristaName: next || null } };
}

/**
 * Is the machine asleep, by Decaid's answer to a read of its state (a machine
 * snapshot, whose `state` is `{ state, substate }`)?
 */
export function asleep(snapshot) {
    const state = snapshot && typeof snapshot.state === 'object' ? snapshot.state?.state : snapshot?.state;
    return state === 'sleeping';
}

/**
 * The write that clears the barista when the machine is seen asleep, or null
 * where none is named, so a sleeping machine is not written to again and again.
 */
export function sleepClear(context) {
    return baristaName(context) ? { context: { baristaName: null } } : null;
}
