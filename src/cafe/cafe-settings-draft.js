// A change to the skin's own settings that the Settings page has not saved
// yet (docs/cafe/DESIGN.md, "Settings"). The page's Save writes it, through
// the hooks in Streamline's two Save handlers (docs/cafe/UPSTREAM_EDITS.md);
// Cancel, and leaving Settings any other way, drop it, as the main page coming
// back into view says. It outlasts a move to another settings category, as
// Streamline's own unsaved changes do.
//
// One write at a time: while one is on its way the setting takes no change,
// and a second Save waits for it and writes nothing. A visit to Settings ends
// when the main page comes back; a write from a visit since ended changes
// nothing in a later one, and its Save does not leave Settings. A Save belongs
// to the visit it was tapped in, which its handler reads before Streamline's
// own write: one whose visit has ended by the fork's turn writes nothing.
import { writeCafe, CONTAINER_KEY } from './cafe-store.js';

let container = null;
let written = null;
let writing = null;
let visit = 0;
const watchers = new Set();

const tell = () => { for (const watcher of watchers) watcher(); };

/** The container's weight changed and not yet saved, in whole grams, or null. */
export function draftContainer() {
    return container;
}

/**
 * Keep a changed weight until Save. One changed back to what Decaid holds is
 * no change: the weight last written from this visit, or else `kept`, what
 * the page read when it opened.
 */
export function stageContainer(grams, kept) {
    if (writing) return;
    container = grams === (written ?? kept) ? null : grams;
}

/** Is a write on its way? The setting takes no change meanwhile. */
export function savingCafeSettings() {
    return writing != null;
}

/** Settles once no write is on its way, however the last one went. */
export function cafeSettingsSettled() {
    return (writing ?? Promise.resolve()).then(() => {}, () => {});
}

/** Call `watcher` when a write starts and when it ends. Answers a function that stops it. */
export function watchCafeSaving(watcher) {
    watchers.add(watcher);
    return () => watchers.delete(watcher);
}

/** The weight last written from this visit to Settings, or null. */
export function writtenContainer() {
    return written;
}

/** The visit to Settings now open: a Save handler reads it when Save is tapped. */
export function cafeSettingsVisit() {
    return visit;
}

async function write(grams, mine) {
    try {
        await writeCafe(CONTAINER_KEY, grams);
    } finally {
        writing = null;
        tell();
    }
    if (mine !== visit) return false;
    written = grams;
    if (container === grams) container = null;
    return container == null;
}

/**
 * Write what was changed, for a Save tapped in the visit `from`
 * (`cafeSettingsVisit()` then). Answers whether that Save may leave Settings:
 * false, with nothing written, for a visit that has ended since, false for a
 * second Save while one is writing, and for a visit that ended while it
 * wrote. Rejects where Decaid did not take it, and keeps the change.
 */
export function saveCafeSettings(from) {
    if (from !== visit) return Promise.resolve(false);
    if (writing) return writing.then(() => false, () => false);
    if (container == null) return Promise.resolve(true);
    writing = write(container, visit);
    tell();
    return writing;
}

if (typeof document !== 'undefined') {
    document.addEventListener('streamline:mainpagevisible', () => {
        visit += 1;
        container = null;
        written = null;
    });
}
