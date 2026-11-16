// The Reference view: the reference's lines behind the Shot's own, through the
// hook in Streamline's chart (docs/cafe/DESIGN.md, "Shots and the reference").
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { referenceOverlay, referenceColor } from '../src/cafe/reference-overlay.js';

// Streamline's seven lines, as chart.js orders them.
const seven = () => [
    { name: 'Pressure', x: [0, 1], y: [1, 8], line: { color: '#17c29a' } },
    { name: 'Flow', x: [0, 1], y: [4, 2], line: { color: '#0358cf' } },
    { name: 'Target Pressure', x: [0, 1], y: [9, 9], line: { color: '#A0E0D1', dash: 'dot' } },
    { name: 'Target Flow', x: [0, 1], y: [0, 0], line: { color: '#BED9FF', dash: 'dot' } },
    { name: '°C', x: [0, 1], y: [9, 9], line: { color: '#ff97a1' } },
    { name: 'Target °C', x: [0, 1], y: [9.3, 9.3], line: { color: '#FFD1D5', dash: 'dot' } },
    { name: 'Weight', x: [0, 1], y: [0, 1], line: { color: '#E9D3C3' } },
];
const curves = (seconds = 30) => ({
    pressure: { x: [0, seconds], y: [1, 9] },
    flow: { x: [0, seconds], y: [4, 2] },
    weight: { x: [5, seconds], y: [0, 2] },
    seconds,
});
const layout = xaxis => ({ xaxis, yaxis: { range: [0, 10] }, annotations: [] });

test('the reference\'s three lines follow Streamline\'s seven, which keep their order', () => {
    const traces = seven();
    const reference = curves();
    const { traces: drawn } = referenceOverlay(traces, layout({ range: [0, 40], dtick: 5 }), 'full', { curves: reference });
    assert.equal(drawn.length, 10);
    assert.deepEqual(drawn.slice(0, 7).map(t => t.name), traces.map(t => t.name));
    assert.deepEqual(drawn.slice(7).map(t => t.name), ['Reference pressure', 'Reference flow', 'Reference weight']);
    assert.strictEqual(drawn[7].x, reference.pressure.x);
    assert.strictEqual(drawn[8].y, reference.flow.y);
    assert.strictEqual(drawn[9].x, reference.weight.x);
    for (const trace of drawn.slice(7)) {
        assert.equal('dash' in trace.line, false, 'solid: the dotted lines are the profile\'s targets');
        assert.match(trace.line.color, /^rgba\(\d+, \d+, \d+, 0\.\d+\)$/, 'faded');
        assert.equal(trace.hoverinfo, 'skip');
    }
});

test('the reference\'s colours and names are no line\'s of Streamline\'s, so no end label finds them', () => {
    const own = new Set(seven().map(t => t.line.color.toLowerCase()));
    for (const dark of [false, true]) {
        const { traces: drawn } = referenceOverlay(seven(), layout({ range: [0, 40] }), 'full', { curves: curves(), dark });
        for (const trace of drawn.slice(7)) {
            assert.equal(own.has(trace.line.color.toLowerCase()), false);
            assert.equal(seven().some(t => t.name === trace.name), false);
        }
        assert.equal(new Set(drawn.slice(7).map(t => t.line.color)).size, 3);
        assert.equal(drawn[7].line.color, referenceColor('pressure', dark));
    }
    assert.notEqual(referenceColor('pressure', true), referenceColor('pressure', false));
});

test('no target is drawn, and the Shot\'s own lines are the chart\'s own objects', () => {
    const traces = seven();
    const { traces: drawn } = referenceOverlay(traces, layout({ range: [0, 40] }), 'full', { curves: curves() });
    for (const index of [0, 1, 4, 6]) assert.strictEqual(drawn[index], traces[index]);
    for (const index of [2, 3, 5]) {
        assert.deepEqual([drawn[index].x, drawn[index].y], [[], []]);
        assert.equal(drawn[index].name, traces[index].name);
        assert.equal(traces[index].x.length, 2, 'the chart\'s own target line is not emptied');
    }
});

test('with no reference to draw the count is the same, the three lines empty', () => {
    const { traces: drawn, layout: shown } = referenceOverlay(seven(), layout({ range: [0, 40], dtick: 5 }), 'full', {});
    assert.equal(drawn.length, 10);
    for (const trace of drawn.slice(7)) assert.deepEqual([trace.x, trace.y], [[], []]);
    assert.deepEqual(shown.xaxis, { range: [0, 40], dtick: 5 });
});

test('the arrays are the same from one frame to the next, so a live shot keeps appending', () => {
    const traces = seven();
    const reference = curves();
    const first = referenceOverlay(traces, layout({ range: [0, 2] }), 'live', { curves: reference }).traces;
    traces[0].x.push(2); traces[0].y.push(9); // a live frame lands on the chart's own array
    const second = referenceOverlay(traces, layout({ range: [0, 3] }), 'live', { curves: reference }).traces;
    assert.equal(first.length, second.length);
    first.forEach((trace, index) => {
        assert.strictEqual(trace.x, second[index].x, `line ${index}`);
        assert.strictEqual(trace.y, second[index].y, `line ${index}`);
    });
    assert.equal(second[0].x.length, 3);
});

test('the full-screen chart: targets hidden by their dash, the reference no wider than 3', () => {
    const expanded = [
        { name: 'Pressure', x: [0], y: [1], line: { color: '#17c29a', width: 4.5 } },
        { name: 'Target Pressure', x: [0], y: [9], line: { color: '#A0E0D1', width: 3, dash: [6, 6] } },
        { name: 'Water °C', x: [0], y: [9], line: { color: '#d9822b', width: 3 } },
        { name: 'Water Target °C', x: [0], y: [9], line: { color: '#e8b480', width: 1.5, dash: [12, 12] } },
    ];
    const { traces: drawn } = referenceOverlay(expanded, layout({ range: [0, 40] }), 'full', { curves: curves() });
    assert.deepEqual(drawn.map(t => t.x.length), [1, 0, 1, 0, 2, 2, 2]);
    assert.equal(drawn[4].line.width, 3);
    assert.equal('width' in referenceOverlay(seven(), layout({}), 'full', { curves: curves() }).traces[7].line, false, 'the main chart keeps the renderer\'s width');
});

test('at rest the time axis fits the longer of the two Shots', () => {
    const shorter = referenceOverlay(seven(), layout({ range: [0, 26.4], autorange: false, dtick: 5 }), 'full', { curves: curves(40) }).layout;
    assert.deepEqual(shorter.xaxis, { range: [0, 40], autorange: false, dtick: 5 });
    const longer = layout({ range: [0, 52], autorange: false, dtick: 5 });
    assert.strictEqual(referenceOverlay(seven(), longer, 'full', { curves: curves(40) }).layout, longer, 'a longer Shot keeps the room the chart gave its labels');
    const alone = referenceOverlay(seven(), layout({ range: [0, 7], autorange: true, dtick: 1 }), 'full', { curves: curves(70) }).layout;
    assert.deepEqual(alone.xaxis, { range: [0, 70], autorange: false, dtick: 20 }, 'no Shot yet: the reference alone');
});

test('during a shot the axis starts at the reference\'s length and follows the shot only past it', () => {
    const during = seconds => referenceOverlay(seven(), layout({ range: seconds > 0 ? [0, seconds / 0.93] : [-1, 1], autorange: false, dtick: 1 }), 'live', { curves: curves(30) }).layout.xaxis;
    assert.deepEqual(during(0), { range: [0, 30 / 0.93], autorange: false, dtick: 5 });
    assert.deepEqual(during(12).range, [0, 30 / 0.93]);
    assert.deepEqual(during(29.9).range, [0, 30 / 0.93]);
    assert.deepEqual(during(31), { range: [0, 31 / 0.93], autorange: false, dtick: 1 }, 'past the reference the axis is the chart\'s own');
});

test('the layout the chart handed over is never changed in place', () => {
    const given = layout({ range: [0, 10], autorange: false, dtick: 1 });
    const copy = JSON.parse(JSON.stringify(given));
    const { layout: shown } = referenceOverlay(seven(), given, 'full', { curves: curves(40) });
    assert.deepEqual(given, copy);
    assert.notStrictEqual(shown, given);
    assert.strictEqual(shown.yaxis, given.yaxis);
    // The full-screen chart spaces its own ticks: none is added.
    assert.equal('dtick' in referenceOverlay(seven(), layout({ range: [0, 10] }), 'full', { curves: curves(40) }).layout.xaxis, false);
});

// ── Through Streamline's chart ───────────────────────────────────────────────

test('the hooks in chart.js: the overlay on the chart\'s own lines only, and the chooser', async () => {
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
    const main = () => instances[0].getOption();
    const lastMain = () => options.filter(call => call.instance === instances[0]).at(-1).option;
    const names = option => option.series.filter(series => series.id.startsWith('trace-')).map(series => series.name);

    const chart = await import(`../src/modules/chart.js?cafe-overlay=${Date.now()}`);
    chart.initChart();
    chart.clearChart();
    await settle();
    assert.equal(names(main()).length, 7, 'with no overlay the chart is Streamline\'s own');

    const reference = curves(30);
    chart.setChartOverlay((traces, shown, mode) => referenceOverlay(traces, shown, mode, { curves: reference }));
    await settle();
    assert.deepEqual(names(main()).slice(7), ['Reference pressure', 'Reference flow', 'Reference weight'], 'setting the overlay draws again with it');
    assert.deepEqual(main().series[7].data, [[0, 1], [30, 9]]);
    assert.deepEqual([main().xAxis[0].min, main().xAxis[0].max], [0, 30], 'no Shot yet: the axis is the reference\'s');

    // A live shot, with the reference behind it.
    const start = new Date('2026-01-01T00:00:00.000Z');
    const frame = seconds => ({
        timestamp: new Date(start.getTime() + seconds * 1000).toISOString(),
        state: { substate: 'pouring' }, pressure: seconds, flow: seconds / 2, targetPressure: 9, targetFlow: 0,
        groupTemperature: 92, targetGroupTemperature: 93, mixTemperature: 90, targetMixTemperature: 85,
    });
    chart.clearChart();
    await settle();
    chart.updateChart(start, frame(1), 1);
    chart.updateChart(start, frame(2), 2);
    await settle(120);
    assert.deepEqual(main().series[0].data, [[1, 1], [2, 2]]);
    assert.deepEqual(main().series[2].data, [], 'no target is drawn in the Reference view');
    assert.deepEqual(main().series[7].data, [[0, 1], [30, 9]]);
    assert.deepEqual([lastMain().xAxis[0].min, lastMain().xAxis[0].max], [0, 30 / 0.93], 'the whole reference shows from the first second');

    const rendersBefore = options.length;
    const appendsBefore = appends.length;
    chart.updateChart(start, frame(3), 3);
    await settle(120);
    const frameOptions = options.slice(rendersBefore).map(call => call.option);
    assert.equal(frameOptions.length, 1);
    assert.equal(Object.hasOwn(frameOptions[0], 'series'), false, 'a live frame is appended, not drawn again in full');
    const appended = appends.slice(appendsBefore);
    assert.deepEqual(appended.find(call => call.seriesIndex === 0).data, [[3, 3]]);
    assert.equal(appended.some(call => call.seriesIndex >= 7 || [2, 3, 5].includes(call.seriesIndex)), false, 'nothing is appended to the reference or to a hidden target');
    assert.equal(main().series.filter(series => series.id.startsWith('trace-')).length, 10);

    chart.updateChart(start, frame(40), 40);
    await settle(120);
    assert.equal(lastMain().xAxis[0].max, 40 / 0.93, 'past the reference the axis follows the shot');

    // At rest: the end labels name the Shot's own lines and never the reference's.
    chart.finalizeLiveChart();
    await settle();
    assert.deepEqual(main().series.filter(series => series.markPoint).map(series => series.name), ['Pressure', 'Flow', '°C', 'Weight']);
    assert.equal(main().series.length >= 10, true);

    // The full-screen chart draws the reference too, after its own lines.
    chart.openExpandedChart();
    await settle(20);
    const expanded = instances[1].getOption();
    assert.deepEqual(names(expanded).slice(-3), ['Reference pressure', 'Reference flow', 'Reference weight']);
    assert.deepEqual(expanded.series.filter(series => series.markPoint).map(series => series.name), ['Pressure', 'Flow', 'Weight', '°C', 'Water °C']);
    assert.deepEqual(expanded.series[3].data, [], 'its targets are hidden too');
    chart.closeExpandedChart();
    await settle();

    // A profile preview is drawn from a copy of the lines: it never carries the reference.
    chart.plotProfile({ steps: [{ seconds: 10, pump: 'pressure', pressure: 9, temperature: 92 }, { seconds: 20, pump: 'flow', flow: 2, temperature: 92 }] });
    await settle();
    assert.equal(names(main()).length, 7);
    assert.equal(main().series[2].data.length > 0, true, 'and keeps its target lines');

    // The chooser: a finished Shot is drawn only when it says so.
    const asked = [];
    let allow = false;
    chart.setShotChooser((measurements, workflow) => { asked.push([measurements, workflow]); return allow; });
    const measurements = [1, 2, 3].map(seconds => ({ machine: frame(seconds) }));
    const workflow = { profile: { steps: [] } };
    const before = options.length;
    chart.plotHistoricalShot(measurements, workflow);
    await settle();
    assert.equal(options.length, before, 'turned down: nothing is drawn');
    assert.deepEqual(asked, [[measurements, workflow]]);
    allow = true;
    chart.plotHistoricalShot(measurements, workflow);
    await settle();
    assert.deepEqual(main().series[0].data, [[0, 1], [1, 2], [2, 3]]);
    assert.equal(names(main()).length, 10, 'a finished Shot is the chart\'s own lines: the reference is behind it');
    assert.equal(main().xAxis[0].max, 30, 'and the axis fits the longer of the two');

    // Removing the overlay gives Streamline's chart back.
    chart.setShotChooser(null);
    chart.setChartOverlay(null);
    await settle();
    assert.equal(names(main()).length, 7);
    assert.equal(main().series[2].data.length, 3, 'with its targets');
});
