// The names of a profile's stages on the graph (docs/cafe/DESIGN.md, "Stage
// names").
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shotStages, stageShapes, withStageNames, STAGE_NAME_FONT } from '../src/cafe/stage-names.js';

const at = seconds => new Date(Date.UTC(2026, 0, 1, 8, 0, 0) + seconds * 1000).toISOString();
const sample = (seconds, substate, profileFrame) => ({ machine: { timestamp: at(seconds), state: { substate }, profileFrame, pressure: 1, flow: 1 } });
const workflow = { profile: { steps: [{ name: 'Fill' }, { name: 'Soak' }, { name: 'Rise and hold' }, { name: 'Decline' }] } };

// Eight pixels a letter, so a name's width is plain to read.
const measure = text => text.length * 8;
const shape = (x0, name) => ({ type: 'line', x0, x1: x0, name, line: { color: '#7c7c7c', width: 2, dash: 'longdash' } });
const layout = (shapes, xaxis = { range: [0, 40], autorange: false }) => ({ xaxis, margin: { l: 88, r: 45 }, shapes });
const names = shown => shown.shapes.map(s => (s.label ? s.label.text : null));

test('a Shot\'s stages: each change of profile frame in preinfusion or pouring, named from its own profile', () => {
    const stages = shotStages([
        sample(0, 'preparingForShot', 3), // the frame left over from the shot before
        sample(5, 'preinfusion', 0),
        sample(7, 'preinfusion', 0),
        sample(9, 'preinfusion', 1),
        sample(15, 'pouring', 2),
        sample(30, 'pouring', 2),
        sample(31, 'pouringDone', 3),
    ], workflow);
    assert.deepEqual(stages, [{ seconds: 0, name: 'Fill' }, { seconds: 4, name: 'Soak' }, { seconds: 10, name: 'Rise and hold' }]);
});

test('a frame the profile does not have, or no frame, starts no stage; a step with no name has none', () => {
    const stages = shotStages([sample(0, 'preinfusion', undefined), sample(1, 'preinfusion', 0), sample(2, 'pouring', 9), sample(3, 'pouring', null), sample(4, 'pouring', 1)],
        { profile: { steps: [{ name: 'Fill' }, {}] } });
    assert.deepEqual(stages, [{ seconds: 1, name: 'Fill' }, { seconds: 4, name: '' }]);
    assert.deepEqual(shotStages([sample(0, 'pouring', 0)], { profile: {} }), [], 'a Workflow with no profile steps');
    assert.deepEqual(shotStages([sample(0, 'preparingForShot', 0)], workflow), [], 'a Shot that never left its Preheat');
    assert.deepEqual(shotStages(null, null), []);
});

test('stage lines are drawn as the chart draws its own, in the theme\'s colour', () => {
    const [light] = stageShapes([{ seconds: 4, name: 'Soak' }], false);
    assert.deepEqual(light, { type: 'line', x0: 4, x1: 4, y0: 0, y1: 1, yref: 'paper', name: 'Soak', line: { color: '#7c7c7c', width: 2, dash: 'longdash' } });
    assert.equal(stageShapes([{ seconds: 4, name: 'Soak' }], true)[0].line.color, '#7f8bbb');
});

test('each stage line carries its name, in its line\'s colour', () => {
    // 400 px over 40 s: ten pixels a second.
    const given = layout([shape(0, 'Fill'), shape(10, 'Rise and hold'), shape(30, 'Decline')]);
    const shown = withStageNames(given, { plotWidth: 400, measure });
    assert.deepEqual(names(shown), ['Fill', 'Rise and hold', 'Decline']);
    assert.deepEqual(shown.shapes[1].label, { text: 'Rise and hold', color: '#7c7c7c', size: 13, pad: 6 });
    assert.match(STAGE_NAME_FONT, /\b13px\b/, 'the size a name is measured in is the size it is written in');
});

test('a name is left out where its stage is too narrow to hold it', () => {
    // "Rise and hold" is 104 px and needs 116 with its clear space.
    const narrow = withStageNames(layout([shape(0, 'Fill'), shape(10, 'Rise and hold'), shape(21, 'Decline')]), { plotWidth: 400, measure });
    assert.deepEqual(names(narrow), ['Fill', null, 'Decline']);
    const justFits = withStageNames(layout([shape(0, 'Fill'), shape(10, 'Rise and hold'), shape(21.6, 'Decline')]), { plotWidth: 400, measure });
    assert.deepEqual(names(justFits), ['Fill', 'Rise and hold', 'Decline']);
    // The last stage runs to the end of the time axis.
    assert.deepEqual(names(withStageNames(layout([shape(0, 'Fill'), shape(35, 'Decline')]), { plotWidth: 400, measure })), ['Fill', null]);
});

test('of stages skipped at one second only the last, the one that ran, is named', () => {
    const shown = withStageNames(layout([shape(0, 'Fill'), shape(0, 'Soak'), shape(0, 'Rise and hold'), shape(20, 'Decline')]), { plotWidth: 400, measure });
    assert.deepEqual(names(shown), [null, null, 'Rise and hold', 'Decline']);
});

test('a line with no name is left as it is, and so is a layout with nothing to name', () => {
    const plain = { type: 'line', x0: 5, line: { color: '#7c7c7c' } };
    const given = layout([plain, shape(10, '  ')]);
    assert.strictEqual(withStageNames(given, { plotWidth: 400, measure }), given);
    const mixed = withStageNames(layout([plain, shape(10, 'Decline')]), { plotWidth: 400, measure });
    assert.strictEqual(mixed.shapes[0], plain);
    assert.deepEqual(names(mixed), [null, 'Decline']);
    const empty = layout([]);
    assert.strictEqual(withStageNames(empty, { plotWidth: 400, measure }), empty);
    const noShapes = { xaxis: { range: [0, 40] } };
    assert.strictEqual(withStageNames(noShapes, { plotWidth: 400, measure }), noShapes);
});

test('no name is placed on an axis with no range, or on a chart with no width', () => {
    const shapes = [shape(0, 'Fill')];
    for (const given of [layout(shapes, { autorange: true, range: [0, 40] }), layout(shapes, {}), layout(shapes, { range: [5, 5] })]) {
        assert.strictEqual(withStageNames(given, { plotWidth: 400, measure }), given);
    }
    const hidden = layout(shapes);
    assert.strictEqual(withStageNames(hidden, { plotWidth: -133, measure }), hidden, 'the chart is not laid out');
});

test('the layout the chart handed over is never changed, and the answer is the same from one frame to the next', () => {
    const given = layout([shape(0, 'Fill'), shape(10, 'Decline')]);
    const copy = JSON.parse(JSON.stringify(given));
    const first = withStageNames(given, { plotWidth: 400, measure });
    assert.deepEqual(given, copy);
    // A live frame: the axis has grown a little, and no name has stopped fitting.
    const second = withStageNames({ ...given, xaxis: { range: [0, 40.1], autorange: false } }, { plotWidth: 400, measure });
    assert.equal(JSON.stringify(first.shapes), JSON.stringify(second.shapes), 'the chart\'s live path compares its shapes as text');
});

// ── Through Streamline's chart and renderer ──────────────────────────────────

test('the hooks: a stage line keeps its step\'s name, the renderer writes it, and a live shot still appends', async () => {
    const options = [];
    const appends = [];
    const instances = [];
    const createInstance = () => {
        let current = { legend: [], series: [] };
        const instance = {
            setOption(option) {
                options.push({ instance, option });
                const { series, ...rest } = option;
                current = { ...current, ...rest };
                if (series?.some(entry => entry.data)) current.series = series.map(entry => ({ ...entry, ...(entry.data ? { data: entry.data.map(point => [...point]) } : {}) }));
            },
            appendData({ seriesIndex, data }) { appends.push({ instance, seriesIndex, data }); },
            getOption() { return current; },
            resize() {}, dispose() {}, on() {}, off() {}, dispatchAction() {},
        };
        instances.push(instance);
        return instance;
    };
    const element = (id, width, height) => ({ id, offsetParent: {}, clientWidth: width, clientHeight: height, isConnected: true, style: {}, replaceChildren() {} });
    const chartElement = element('plotly-chart', 933, 390);
    const expandedElement = element('expanded-chart', 1920, 1104);
    const mainPage = { style: { display: 'block' }, classList: { add() {}, remove() {} }, querySelector: selector => (selector === '#plotly-chart' ? chartElement : null) };
    const documentTarget = new EventTarget();
    Object.assign(documentTarget, {
        visibilityState: 'visible',
        getElementById: id => ({ 'main-page': mainPage, 'expanded-chart': expandedElement })[id] || null,
        createElement: () => ({ style: {}, getContext: () => ({ measureText: text => ({ width: text.length * 8 }) }) }),
    });
    const windowTarget = new EventTarget();
    Object.assign(windowTarget, { devicePixelRatio: 2, echarts: { init: createInstance } });
    globalThis.document = documentTarget;
    globalThis.window = windowTarget;
    globalThis.localStorage = { getItem: () => 'light' };
    globalThis.performance = { now: () => 1000 };
    globalThis.requestAnimationFrame = callback => setTimeout(() => callback(1000), 0);
    globalThis.cancelAnimationFrame = clearTimeout;
    const settle = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
    // The stage lines of the main chart's last draw that carried them, each with the name written on it.
    const markers = instance => {
        const drawn = options.filter(call => call.instance === instance).map(call => call.option.series?.find(series => series.id === 'markers-0')).filter(Boolean).at(-1);
        return (drawn ? drawn.markLine.data : []).map(line => [line.xAxis, line.label ? line.label.formatter() : null]);
    };

    const chart = await import(`../src/modules/chart.js?cafe-stages=${Date.now()}`);
    chart.initChart();
    const charts = [];
    // 933 px less the chart's own margins (88 and 45) is 800 px of plot.
    chart.setChartOverlay((traces, layout, mode, which) => {
        charts.push(which);
        return { traces, layout: which === 'main' ? withStageNames(layout, { plotWidth: 933 - layout.margin.l - layout.margin.r, measure }) : layout };
    });
    chart.setCurrentProfile({ steps: [{ name: 'Fill' }, { name: 'Rise and hold' }] });
    chart.clearChart();
    await settle();

    const start = new Date('2026-01-01T00:00:00.000Z');
    const frame = (seconds, profileFrame) => ({
        timestamp: new Date(start.getTime() + seconds * 1000).toISOString(), profileFrame,
        state: { substate: 'pouring' }, pressure: seconds, flow: 2, targetPressure: 9, targetFlow: 0, groupTemperature: 92, targetGroupTemperature: 93,
    });
    chart.updateChart(start, frame(1, 0), 1);
    chart.updateChart(start, frame(2, 0), 2);
    await settle(120);
    assert.deepEqual(markers(instances[0]), [[0, 'Fill']], 'the stage the shot is in is named as it is reached');

    // A frame within the stage: appended, and the stage lines are not sent again.
    let before = options.length;
    chart.updateChart(start, frame(3, 0), 3);
    await settle(120);
    let sent = options.slice(before).map(call => call.option);
    assert.equal(sent.length, 1);
    assert.equal(Object.hasOwn(sent[0], 'series'), false, 'naming the stages keeps the live path: the frame is appended');
    assert.equal(appends.some(call => call.seriesIndex === 0 && call.data[0][0] === 3), true);

    // The next stage is reached: its line and name are added once.
    chart.updateChart(start, frame(20, 1), 20);
    await settle(120);
    assert.deepEqual(markers(instances[0]), [[0, 'Fill'], [20, null]], 'too narrow yet for "Rise and hold"');
    chart.updateChart(start, frame(40, 1), 40);
    await settle(120);
    assert.deepEqual(markers(instances[0]), [[0, 'Fill'], [20, 'Rise and hold']], 'named once the stage is wide enough');
    before = options.length;
    chart.updateChart(start, frame(41, 1), 41);
    await settle(120);
    sent = options.slice(before).map(call => call.option);
    assert.equal(sent.some(option => Object.hasOwn(option, 'series')), false, 'and frames are appended again after it');

    // At rest the names stay, and the layout the chart keeps has no label on it.
    chart.finalizeLiveChart();
    await settle();
    assert.deepEqual(markers(instances[0]), [[0, 'Fill'], [20, 'Rise and hold']]);

    // A finished Shot's stage lines carry their names too.
    const measurements = [[0, 0], [10, 0], [30, 1], [60, 1]].map(([seconds, profileFrame]) => ({ machine: frame(seconds, profileFrame) }));
    chart.plotHistoricalShot(measurements, { profile: { steps: [{ name: 'Soak' }, { name: 'Decline' }] } });
    await settle();
    assert.deepEqual(markers(instances[0]), [[0, 'Soak'], [30, 'Decline']]);

    // The full-screen chart is told which it is, and its lines stay bare.
    chart.openExpandedChart();
    await settle(20);
    assert.equal(charts.includes('expanded'), true);
    assert.deepEqual(markers(instances[1]), [[0, null], [30, null]]);
    chart.closeExpandedChart();
});
