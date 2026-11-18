// The Reference view of the graph: the reference's lines, faded, with the Shot's own,
// and no targets (docs/cafe/DESIGN.md, "Shots and the reference"). No browser
// global is touched.
//
// Streamline's chart calls this with its own lines and layout just before it
// draws them, on the main chart and the full-screen one, through the hook the
// fork adds to chart.js (docs/cafe/UPSTREAM_EDITS.md). The chart's lines and
// layout are never changed: what is drawn in their place is built beside them.
//
// What the chart needs kept, from docs/AI_CHART_NOTES.md:
// - Its own lines keep their order, and the reference's three follow them, so a
//   line's index never moves.
// - The reference's three are always there in this view, empty when nothing is
//   to be drawn, so the count of lines does not change through a shot and the
//   chart keeps appending live frames without a full redraw.
// - The arrays of the reference's lines, and of a hidden target, are the same
//   arrays from one frame to the next.
// - A line-end label finds its line by colour on the main chart and by name on
//   the full-screen one, so the reference's lines have colours and names no
//   line of Streamline's has, and are never labelled.

// A live shot's time axis ends here as a share of its width, as in chart.js.
const LIVE_X_DATA_FRACTION = 0.93;

// Solid, in the Shot's own hues at part strength. The profile's targets are the
// dotted lines, in Targets, so a faded solid line is always the reference.
// `rgba` is how a line is faded: a line's style carries colour, width and dash
// only.
const COLORS = {
    light: { pressure: 'rgba(23, 194, 154, 0.5)', flow: 'rgba(3, 88, 207, 0.45)', weight: 'rgba(160, 112, 78, 0.5)' },
    dark: { pressure: 'rgba(0, 176, 135, 0.55)', flow: 'rgba(72, 140, 255, 0.55)', weight: 'rgba(190, 165, 145, 0.5)' },
};
// The full-screen chart draws the Shot's lines wide; the reference's stay thinner.
const REFERENCE_MAX_WIDTH = 3;
const NAMES = { pressure: 'Reference pressure', flow: 'Reference flow', weight: 'Reference weight' };
const KEYS = ['pressure', 'flow', 'weight'];

const NO_X = [];
const NO_Y = [];

/** The reference's colour for one of its three lines, for the legend's swatch. */
export function referenceColor(key, dark) {
    return COLORS[dark ? 'dark' : 'light'][key];
}

// The tick spacing chart.js gives a time axis of this many seconds.
function dtickForTime(seconds) {
    if (seconds < 15) return 1;
    if (seconds < 60) return 5;
    if (seconds < 100) return 20;
    return 30;
}

// The last second any of the chart's own lines reaches.
const ownEnd = traces => Math.max(0, ...traces.map(trace => (trace.x && trace.x.length ? trace.x[trace.x.length - 1] : 0)));

// The time axis, long enough for the whole reference. At rest it fits the
// longer of the two Shots: the chart has fitted the Shot's own lines and their
// labels already, and the axis only grows. During a shot it starts at the
// reference's length and follows the shot only once it runs past it. A chart
// left to fit its own axis, as after a change of theme, has room for its own
// lines and no more: it is given a range only where the reference is longer.
function withRoomFor(layout, seconds, mode, traces) {
    if (!(seconds > 0)) return layout;
    const xaxis = layout.xaxis || {};
    const shown = xaxis.autorange !== true && Array.isArray(xaxis.range) ? xaxis.range[1] : ownEnd(traces);
    const wanted = mode === 'live' ? seconds / LIVE_X_DATA_FRACTION : seconds;
    if (shown >= wanted) return layout;
    const next = { ...xaxis, range: [0, wanted], autorange: false };
    // The main chart spaces its ticks by the time shown; the full-screen chart
    // leaves that to the renderer.
    if ('dtick' in xaxis) next.dtick = dtickForTime(seconds);
    return { ...layout, xaxis: next };
}

/**
 * A running shot's time axis, from the start of its Preheat: it starts at zero
 * and runs at least a second. Streamline's chart fits an empty chart to
 * itself, and gives its first live frame, at time zero, an axis from -1 to 1;
 * either would move zero when the profile starts, after an empty Preheat. An
 * axis that is longer already, as the reference's or a shot's that has run a
 * second, is left as it is; one left to fit itself fits the chart's own lines.
 */
export function liveAxis(traces, layout) {
    const xaxis = layout.xaxis || {};
    const fitted = xaxis.autorange === true || !Array.isArray(xaxis.range);
    if (!fitted && xaxis.range[0] === 0 && xaxis.range[1] >= 1) return layout;
    const end = fitted ? ownEnd(traces) / LIVE_X_DATA_FRACTION : xaxis.range[0] >= 0 ? xaxis.range[1] : 0;
    return { ...layout, xaxis: { ...xaxis, range: [0, Math.max(1, end)], autorange: false } };
}

/**
 * The lines and layout to draw in place of the chart's own, in the Reference
 * view. `curves` is the reference's (`shotCurves`), or null to draw none: the
 * targets are hidden either way. A target is a line with a dash, on both
 * charts; the Shot's own lines have none.
 */
export function referenceOverlay(traces, layout, mode, { curves = null, dark = false } = {}) {
    // The Shot's own line width: the renderer's default on the main chart.
    const width = traces[0] && traces[0].line ? traces[0].line.width : undefined;
    const drawn = traces.map(trace => (trace.line && trace.line.dash ? { ...trace, x: NO_X, y: NO_Y } : trace));
    for (const key of KEYS) {
        const curve = curves ? curves[key] : null;
        drawn.push({
            x: curve ? curve.x : NO_X,
            y: curve ? curve.y : NO_Y,
            name: NAMES[key],
            type: 'scatter',
            mode: 'lines',
            line: { color: referenceColor(key, dark), ...(width ? { width: Math.min(width, REFERENCE_MAX_WIDTH) } : {}) },
            hoverinfo: 'skip',
        });
    }
    return { traces: drawn, layout: withRoomFor(layout, curves ? curves.seconds : 0, mode, traces) };
}
