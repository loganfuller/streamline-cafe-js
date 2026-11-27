// What the Grind row shows for the Workflow's grinder setting (docs/cafe/DESIGN.md,
// "What the screen shows"). Streamline's `updateGrindDisplay` in ui.js asks it,
// through the fork's hook there (docs/cafe/UPSTREAM_EDITS.md). No browser global
// is touched, so node:test imports it.
//
// Streamline read every setting as a number to one place: a preset grinder's
// "Medium" became NaN, and a 0.25-step grinder's 11.25 became 11.3, which the
// next + then stepped off the grinder's grid.

import { grindDecimals } from '../modules/grinder-sync.js';

// A number as the Workflow writes one ("11.25", "11.30", "12"), or as another
// writer might (".5", "11."); anything else, such as a preset grinder's
// "Medium" or "3 Fine", is shown as it is.
const NUMBER = /^-?(\d+\.?\d*|\.\d+)$/;

// Places a number carries once read to the two the row keeps.
const placesOf = n => (String(Number(n.toFixed(2))).split('.')[1] || '').length;

/**
 * The Grind row's text for a setting, given the row's step now.
 *
 * A whole number shows whole, as Streamline did. Any other number shows the
 * places of the step, as the row's + and − write it, and never fewer than its
 * own, up to two: the step can still be the last grinder's while a new
 * grinder's setting is painted (the Workflow's grinder is read after its
 * setting), and a setting must not be rounded onto the wrong grid. A setting
 * that is not a number is shown as it is, and an empty one as "—", as Streamline's
 * first paint shows a Workflow with no grind.
 */
export function grindText(setting, step) {
    const text = String(setting ?? '').trim();
    if (!text) return '—';
    if (!NUMBER.test(text)) return text;
    const n = Number(text);
    // Whole once kept to the row's two places, so 11.999 reads 12, not 12.00.
    if (Number.isInteger(Number(n.toFixed(2)))) return String(Math.round(n));
    const stepPlaces = Number.isFinite(step) && step > 0 && !Number.isInteger(step) ? grindDecimals(step) : 1;
    return n.toFixed(Math.min(2, Math.max(stepPlaces, placesOf(n))));
}

/** The row's text as a number to step from, or null when it holds none ("Medium", "—"). */
export function grindNumber(text) {
    const value = String(text ?? '').trim();
    return NUMBER.test(value) ? Number(value) : null;
}
