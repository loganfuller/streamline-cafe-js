// The main graph's lines carry their names during a shot, as they do after it
// (issue #66; docs/cafe/DESIGN.md, "The reference on the graph"), through the
// live-labels hook in Streamline's chart and its real renderer.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { referenceOverlay, overlayAxis } from '../src/cafe/reference-overlay.js';

// ── Which axis the reference is fitted to ───────────────────────────────────

test('through a shot the main graph fits the reference to the axis it will have at rest, the full-screen chart to the live one', () => {
    assert.equal(overlayAxis(true, 'live', 'main'), 'full');
    assert.equal(overlayAxis(true, 'full', 'main'), 'full', 'a Preheat\'s draw, at rest, is the same');
    assert.equal(overlayAxis(true, 'live', 'expanded'), 'live');
    assert.equal(overlayAxis(true, 'full', 'expanded'), 'live');
    assert.equal(overlayAxis(false, 'full', 'main'), 'full', 'at rest it is the chart\'s own mode');
    assert.equal(overlayAxis(false, 'live', 'main'), 'live');
    assert.equal(overlayAxis(false, 'full', 'expanded'), 'full');
});

// ── Through Streamline's chart ───────────────────────────────────────────────

// A fake ECharts instance that keeps every setOption and appendData, and the
// option as merged, as the renderer's own tests do.
function harness() {
    const options = [];
    const appends = [];
    const instances = [];
    const createInstance = () => {
        let current = { legend: [], series: [] };
        const instance = {
            setOption(option, settings = {}) {
                options.push({ instance, option });
                const { series, ...rest } = option;
                current = { ...current, ...rest };
                if (!series) return;
                const copy = entry => ({ ...entry, ...(entry.data ? { data: entry.data.map(point => [...point]) } : {}) });
                // A full draw replaces the lines; a live frame merges by id.
                if (settings.replaceMerge?.includes('series')) {
                    current.series = series.map(copy);
                    return;
                }
                for (const entry of series) {
                    const index = current.series.findIndex(s => s.id === entry.id);
                    if (index >= 0) current.series[index] = { ...current.series[index], ...copy(entry) };
                    else current.series.push(copy(entry));
                }
            },
            appendData({ seriesIndex, data }) {
                appends.push({ instance, seriesIndex, data });
                for (const point of data) current.series[seriesIndex].data.push([...point]);
            },
            getOption() { return current; },
            resize() {}, dispose() {}, on() {}, off() {}, dispatchAction() {},
        };
        instances.push(instance);
        return instance;
    };
    const element = (id, width, height) => ({ id, offsetParent: {}, clientWidth: width, clientHeight: height, isConnected: true, style: {}, replaceChildren() {} });
    const chartElement = element('plotly-chart', 960, 390);
    const expandedElement = element('expanded-chart', 1920, 1104);
    const mainPage = { style: { display: 'block' }, classList: { add() {}, remove() {} }, querySelector: selector => (selector === '#plotly-chart' ? chartElement : null) };
    const documentTarget = new EventTarget();
    Object.assign(documentTarget, {
        visibilityState: 'visible',
        getElementById: id => ({ 'main-page': mainPage, 'expanded-chart': expandedElement })[id] || null,
        // Every character 8 px wide: "Pressure" is the widest label, at 64 px.
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
    return { options, appends, instances };
}

const settle = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

// The chart's measure when it has none of the element: the plot is 1307 px
// wide, and a label's room is its width, the 6 px gap and 10 px past it.
const PLOT_PX = 1307;
const ROOM_PX = 64 + 6 + 10;
const restEnd = seconds => seconds / (1 - ROOM_PX / PLOT_PX);

const start = new Date('2026-01-01T00:00:00.000Z');
const frame = (seconds, { pressure = seconds / 4, flow = seconds / 8 } = {}) => ({
    timestamp: new Date(start.getTime() + seconds * 1000).toISOString(),
    state: { substate: 'pouring' }, pressure, flow, targetPressure: 9, targetFlow: 0,
    groupTemperature: 92, targetGroupTemperature: 93, mixTemperature: 90, targetMixTemperature: 85,
});

// The labels on a chart's merged option, by line: its name, text, where it
// points, its colour and how far it was pushed down.
const labels = option => option.series
    .map((series, index) => ({ series, index }))
    .filter(({ series }) => series.markPoint)
    .map(({ series, index }) => ({
        index,
        name: series.name,
        text: series.markPoint.label.formatter,
        coord: series.markPoint.data[0].coord,
        color: series.markPoint.label.color,
        offset: series.markPoint.label.offset,
    }));

test('during a shot the main graph names its lines at their ends, moving them with no line sent again, and nothing moves at the end', async () => {
    const { options, appends, instances } = harness();
    const chart = await import(`../src/modules/chart.js?cafe-live-labels=${Date.now()}`);
    chart.initChart();
    const main = () => instances[0].getOption();
    const mainCalls = () => options.filter(call => call.instance === instances[0]).map(call => call.option);

    // Without the hook the chart is Streamline's: no label while a shot is live.
    chart.clearChart();
    await settle();
    chart.updateChart(start, frame(1), 1);
    await settle(120);
    assert.deepEqual(labels(main()), [], 'Streamline names no line during a shot');
    assert.equal(mainCalls().at(-1).xAxis[0].max, 1 / 0.93);
    chart.finalizeLiveChart();
    await settle();

    chart.setLiveLineLabels(true);

    // A Preheat: the chart is cleared and draws nothing, so nothing is named.
    chart.clearChart();
    await settle();
    assert.deepEqual(labels(main()), [], 'no label during the Preheat');

    // The profile's first sample: each of the four lines is named at it.
    chart.updateChart(start, frame(1), 0.5);
    await settle(120);
    const first = labels(main());
    assert.deepEqual(first.map(label => label.name), ['Pressure', 'Flow', '°C', 'Weight'], 'the four lines, and no target');
    assert.deepEqual(first.map(label => label.index), [0, 1, 4, 6]);
    assert.deepEqual(first.map(label => label.text), ['Pressure', 'Flow', '°C', 'Weight']);
    assert.deepEqual(first.map(label => label.color), ['#17c29a', '#0358cf', '#ff97a1', '#E9D3C3'], 'each in its line\'s colour');
    for (const label of first) {
        const series = main().series[label.index];
        assert.deepEqual(label.coord, series.data.at(-1), `${label.name} sits on its line's newest point`);
    }
    // Pressure, flow and weight start together near zero: pushed apart, to at
    // least 18 px between their middles, on the 533 px plot of a y axis 0 to 10.
    const drawnAt = label => (10 - label.coord[1]) / 10 * 533 + label.offset[1];
    const low = first.filter(label => label.name !== '°C').map(drawnAt).sort((a, b) => a - b);
    assert.ok(low[1] - low[0] >= 18 - 1e-9 && low[2] - low[1] >= 18 - 1e-9, `pushed apart: ${low}`);

    // Later frames: the labels follow, and the lines are appended, not sent again.
    for (const seconds of [2, 3, 4]) {
        const callsBefore = mainCalls().length;
        const appendsBefore = appends.length;
        chart.updateChart(start, frame(seconds), seconds);
        await settle(120);
        const frameCalls = mainCalls().slice(callsBefore);
        assert.equal(frameCalls.length, 1);
        const sent = frameCalls[0].series;
        assert.ok(sent, 'the labels travel with the frame');
        assert.equal(sent.some(entry => 'data' in entry), false, 'no line is sent again when only the labels move');
        assert.deepEqual(sent.map(entry => entry.id), ['trace-0', 'trace-1', 'trace-4', 'trace-6']);
        assert.ok(appends.slice(appendsBefore).some(call => call.seriesIndex === 0), 'the new sample is appended');
        for (const label of labels(main())) {
            assert.equal(label.coord[0], seconds, `${label.name} moved to the newest second`);
            assert.deepEqual(label.coord, main().series[label.index].data.at(-1));
        }
        // Room at the right for the widest label, as the finished chart has.
        assert.ok(Math.abs(frameCalls[0].xAxis[0].max - restEnd(seconds)) < 1e-9);
    }

    const lastLive = labels(main());
    const lastAxis = mainCalls().at(-1).xAxis[0].max;
    chart.finalizeLiveChart();
    await settle();
    assert.deepEqual(labels(main()), lastLive, 'the finished chart\'s labels are where the live ones were');
    assert.equal(main().xAxis[0].max, lastAxis, 'and its axis is the one the shot ended on');
});

test('in Reference the labels name the Shot\'s own lines, never the reference or a target, on an axis that ends as it rests', async () => {
    const { options, instances } = harness();
    const chart = await import(`../src/modules/chart.js?cafe-live-labels-reference=${Date.now()}`);
    chart.initChart();
    chart.setLiveLineLabels(true);
    const main = () => instances[0].getOption();
    const mainCalls = () => options.filter(call => call.instance === instances[0]).map(call => call.option);
    let live = false;
    const reference = {
        pressure: { x: [0, 10, 30], y: [1, 9, 6] },
        flow: { x: [0, 10, 30], y: [0, 2, 2] },
        weight: { x: [5, 30], y: [0, 3.6] },
        seconds: 30,
    };
    // As graph.js draws it: the axis through overlayAxis.
    chart.setChartOverlay((traces, shown, mode, which) => referenceOverlay(traces, shown, overlayAxis(live, mode, which), { curves: reference }));

    live = true;
    chart.clearChart();
    await settle();
    assert.deepEqual(labels(main()), [], 'no label during the Preheat');
    assert.equal(main().xAxis[0].max, 30, 'the Preheat\'s axis is the reference\'s, as at rest');

    for (const seconds of [1, 2, 3]) chart.updateChart(start, frame(seconds), seconds);
    await settle(120);
    assert.deepEqual(labels(main()).map(label => label.name), ['Pressure', 'Flow', '°C', 'Weight']);
    assert.equal(mainCalls().at(-1).xAxis[0].max, 30, 'shorter than the reference: the reference\'s length');

    // Past the reference, the axis grows once the widest label would pass the edge.
    chart.updateChart(start, frame(29), 29);
    await settle(120);
    assert.equal(mainCalls().at(-1).xAxis[0].max, restEnd(29), 'the labels\' room is past the reference\'s end');
    chart.updateChart(start, frame(31), 31);
    await settle(120);
    assert.equal(mainCalls().at(-1).xAxis[0].max, restEnd(31));
    for (const index of [2, 3, 5, 7, 8, 9]) assert.equal(main().series[index].markPoint, undefined, `${main().series[index].name} has no label`);

    const lastLive = labels(main());
    const lastAxis = mainCalls().at(-1).xAxis[0].max;
    live = false;
    chart.finalizeLiveChart();
    await settle();
    assert.deepEqual(labels(main()), lastLive);
    assert.equal(main().xAxis[0].max, lastAxis, 'nothing moves when the shot ends');

    // A shot shorter than the reference ends on the reference's length too.
    live = true;
    chart.clearChart();
    await settle();
    for (const seconds of [1, 2, 12]) chart.updateChart(start, frame(seconds), seconds);
    await settle(120);
    const shortLive = labels(main());
    assert.equal(mainCalls().at(-1).xAxis[0].max, 30);
    live = false;
    chart.finalizeLiveChart();
    await settle();
    assert.deepEqual(labels(main()), shortLive);
    assert.equal(main().xAxis[0].max, 30);
});

test('in Reference the ticks keep the reference\'s spacing as the axis starts to grow past it, and the frames are appended', async () => {
    const { options, appends, instances } = harness();
    const chart = await import(`../src/modules/chart.js?cafe-live-labels-ticks=${Date.now()}`);
    chart.initChart();
    chart.setLiveLineLabels(true);
    const mainCalls = () => options.filter(call => call.instance === instances[0]).map(call => call.option);
    let live = true;
    // 15.5 s: its ticks are every 5 s. The labels' room passes its end at about
    // 14.55 s, while the shot itself is still under 15 s, whose ticks are every 1 s.
    const reference = { pressure: { x: [0, 15.5], y: [1, 6] }, flow: { x: [0, 15.5], y: [0, 2] }, weight: { x: [0, 15.5], y: [0, 3] }, seconds: 15.5 };
    chart.setChartOverlay((traces, shown, mode, which) => referenceOverlay(traces, shown, overlayAxis(live, mode, which), { curves: reference }));
    chart.clearChart();
    await settle();
    for (const seconds of [1, 2, 13]) chart.updateChart(start, frame(seconds), seconds);
    await settle(120);
    for (const seconds of [14, 14.6, 14.8, 14.9, 15.1, 16]) {
        const callsBefore = mainCalls().length;
        const appendsBefore = appends.length;
        chart.updateChart(start, frame(seconds), seconds);
        await settle(120);
        const frameCalls = mainCalls().slice(callsBefore);
        assert.equal(frameCalls.length, 1, `one call at ${seconds} s`);
        assert.equal(frameCalls[0].series.some(entry => 'data' in entry), false, `no line sent again at ${seconds} s`);
        assert.ok(appends.slice(appendsBefore).some(call => call.seriesIndex === 0), `appended at ${seconds} s`);
        assert.equal(frameCalls[0].xAxis[0].interval, 5, `ticks every 5 s at ${seconds} s`);
        assert.equal(frameCalls[0].xAxis[0].max, Math.max(15.5, restEnd(seconds)));
    }
    // A shot that stops in that window keeps them at rest.
    live = false;
    chart.clearChart();
    await settle();
    live = true;
    for (const seconds of [1, 2, 14.8]) chart.updateChart(start, frame(seconds), seconds);
    await settle(120);
    live = false;
    chart.finalizeLiveChart();
    await settle();
    assert.equal(instances[0].getOption().xAxis[0].interval, 5);
});

test('a reference that ends at the Shot\'s own last second and value takes no label', async () => {
    const { instances } = harness();
    const chart = await import(`../src/modules/chart.js?cafe-live-labels-same-end=${Date.now()}`);
    chart.initChart();
    chart.setLiveLineLabels(true);
    const main = () => instances[0].getOption();
    let live = true;
    // The reference's pressure ends where the running shot's will, at 3 s and 0.75 bar.
    const reference = { pressure: { x: [0, 3], y: [0, 0.75] }, flow: { x: [], y: [] }, weight: { x: [], y: [] }, seconds: 3 };
    chart.setChartOverlay((traces, shown, mode, which) => referenceOverlay(traces, shown, overlayAxis(live, mode, which), { curves: reference }));
    chart.clearChart();
    await settle();
    for (const seconds of [1, 2, 3]) chart.updateChart(start, frame(seconds), seconds);
    await settle(120);
    assert.deepEqual(main().series[0].data.at(-1), [3, 0.75]);
    assert.deepEqual(labels(main()).map(label => label.index), [0, 1, 4, 6], 'during the shot');
    live = false;
    chart.finalizeLiveChart();
    await settle();
    assert.deepEqual(labels(main()).map(label => label.index), [0, 1, 4, 6], 'and at rest');
});

test('the full-screen chart is as it was: its own labels, on Streamline\'s live axis', async () => {
    const { instances } = harness();
    const chart = await import(`../src/modules/chart.js?cafe-live-labels-expanded=${Date.now()}`);
    chart.initChart();
    const expandedLabels = async labelled => {
        chart.setLiveLineLabels(labelled);
        chart.clearChart();
        await settle();
        chart.openExpandedChart();
        await settle(20);
        const before = instances.length - 1;
        for (const seconds of [1, 2, 3]) chart.updateChart(start, frame(seconds), seconds);
        await settle(120);
        const option = instances[before].getOption();
        const seen = { labels: labels(option), axis: option.xAxis[0].max };
        chart.closeExpandedChart();
        await settle();
        chart.finalizeLiveChart();
        await settle();
        return seen;
    };
    const without = await expandedLabels(false);
    const withHook = await expandedLabels(true);
    assert.deepEqual(withHook, without);
    assert.equal(withHook.axis, 3 / 0.93);
    assert.deepEqual(withHook.labels.map(label => label.name), ['Pressure', 'Flow', 'Weight', '°C', 'Water °C']);
});
