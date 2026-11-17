// The names of a profile's stages on the graph (docs/cafe/DESIGN.md, "Stage
// names"). No browser global is touched.
//
// Streamline's chart draws a line where each stage begins, as a shape in its
// layout, and the fork's hook in chart.js keeps the step's name on the shape
// (docs/cafe/UPSTREAM_EDITS.md). This module says which of those lines carry
// their name, and the fork's hook in echarts-renderer.js writes it. A name
// changes only when a stage is reached or a name stops fitting, so a live shot
// keeps appending frames.

// The chart's own colours for a stage line (STEP_MARKER_COLORS in chart.js,
// which does not export them).
const LINE_COLORS = { dark: '#7f8bbb', light: '#7c7c7c' };

/** The space kept clear on each side of a name, in pixels. */
const NAME_PAD = 6;

/** A name's size in pixels, and the font a caller measures it in. */
const NAME_SIZE = 13;
export const STAGE_NAME_FONT = `500 ${NAME_SIZE}px Inter, sans-serif`;

const named = shape => typeof shape.name === 'string' && shape.name.trim() !== '';

/**
 * Where each stage a Shot reached begins, and its name, as Streamline's chart
 * marks a finished Shot: in seconds from the first sample in preinfusion or
 * pouring, one for each change of the machine's profile frame within those two
 * phases, named by that step of the Shot's own profile. None for a Shot whose
 * Workflow carries no profile steps.
 */
export function shotStages(measurements, workflow) {
    const steps = workflow?.profile?.steps;
    const samples = (Array.isArray(measurements) ? measurements : []).filter(Boolean);
    if (!Array.isArray(steps)) return [];
    const inShot = substate => substate === 'preinfusion' || substate === 'pouring';
    const first = samples.find(sample => inShot(sample.machine?.state?.substate));
    if (!first) return [];
    const start = new Date(first.machine.timestamp);
    const stages = [];
    let frame = -1;
    for (const { machine } of samples) {
        if (!machine || !inShot(machine.state?.substate)) continue;
        const next = machine.profileFrame;
        if (next === undefined || next === null || next === frame || !(next >= 0 && next < steps.length)) continue;
        frame = next;
        stages.push({ seconds: (new Date(machine.timestamp) - start) / 1000, name: typeof steps[next]?.name === 'string' ? steps[next].name : '' });
    }
    return stages;
}

/** Stage lines for the chart's layout, drawn as the chart draws its own. */
export function stageShapes(stages, dark) {
    return stages.map(({ seconds, name }) => ({
        type: 'line',
        x0: seconds,
        x1: seconds,
        y0: 0,
        y1: 1,
        yref: 'paper',
        name,
        line: { color: dark ? LINE_COLORS.dark : LINE_COLORS.light, width: 2, dash: 'longdash' },
    }));
}

/**
 * The layout with each stage line's name written beside it, where the stage is
 * wide enough to hold it: from its line to the next stage's, or to the end of
 * the time axis. `plotWidth` is the width of the plot in pixels and
 * `measure(text)` the width of a name. The layout handed in is never changed,
 * and is answered as it is when no name is written.
 */
export function withStageNames(layout, { plotWidth, measure }) {
    const shapes = layout.shapes || [];
    const xaxis = layout.xaxis || {};
    if (!shapes.some(named) || xaxis.autorange === true || !Array.isArray(xaxis.range) || !(plotWidth > 0)) return layout;
    const [from, until] = xaxis.range;
    if (!(until > from)) return layout;
    const perSecond = plotWidth / (until - from);
    let any = false;
    const drawn = shapes.map((shape, index) => {
        if (!named(shape)) return shape;
        // The next line bounds it, so of steps skipped at one second only the
        // last, the one that ran from there, has room.
        const next = shapes[index + 1];
        const room = (Math.min(next ? next.x0 : until, until) - Math.max(shape.x0, from)) * perSecond;
        const name = shape.name.trim();
        if (measure(name) + NAME_PAD * 2 > room) return shape;
        any = true;
        return { ...shape, label: { text: name, color: shape.line?.color, size: NAME_SIZE, pad: NAME_PAD } };
    });
    return any ? { ...layout, shapes: drawn } : layout;
}
