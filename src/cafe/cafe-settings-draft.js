// A change to the skin's own settings that the Settings page has not saved
// yet (docs/cafe/DESIGN.md, "Settings"). The page's Save writes it, through
// the hooks in Streamline's two Save handlers (docs/cafe/UPSTREAM_EDITS.md);
// Cancel, and leaving Settings any other way, drop it, as the main page coming
// back into view says. It outlasts a move to another settings category, as
// Streamline's own unsaved changes do.
import { writeCafe, CONTAINER_KEY } from './cafe-store.js';

let container = null;

/** The container's weight changed and not yet saved, in whole grams, or null. */
export function draftContainer() {
    return container;
}

/** Keep a changed weight until Save; one changed back to what is kept is no change. */
export function stageContainer(grams, kept) {
    container = grams === kept ? null : grams;
}

/** Write what was changed. Rejects where Decaid did not take it, and keeps the change. */
export async function saveCafeSettings() {
    if (container == null) return;
    const grams = container;
    await writeCafe(CONTAINER_KEY, grams);
    if (container === grams) container = null;
}

if (typeof document !== 'undefined') {
    document.addEventListener('streamline:mainpagevisible', () => { container = null; });
}
