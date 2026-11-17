// What both smoke runs read off the page and ask of Decaid (docs/cafe/SMOKE.md):
// run.mjs, against Decaid alone, and run-decent-sync.mjs, against Decaid with
// Decent Sync's plugin and a server.

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Decaid's REST API: `decaid(method, path, body, { manage })`. `manage` sends the extensions token. */
export function decaidClient(api, token) {
    return async function decaid(method, path, body, { manage = false } = {}) {
        const res = await fetch(`${api}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json', ...(manage ? { Authorization: `Bearer ${token}` } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${text.slice(0, 200)}`);
        try { return JSON.parse(text); } catch { return text; }
    };
}

// The theme is painted, never stored: a stored one would be carried to Decaid's
// settings store, which every later page then reads back.
export const paint = (page, theme) => page.evaluate(t => window.app.ui.paintTheme(t), theme);

// The legend: the text of each part that shows, and null for one that does not.
// `muted` is whether Make reference shows and takes no tap.
export const legend = page => page.evaluate(() => {
    const shown = id => {
        const element = document.getElementById(id);
        return element && element.offsetParent !== null ? element.textContent.trim() : null;
    };
    return {
        label: shown('cafe-shot-label'), when: shown('cafe-shot-when'), make: shown('cafe-make-reference'),
        muted: shown('cafe-make-reference') !== null && document.getElementById('cafe-make-reference').disabled,
        reference: shown('cafe-legend-reference') === null ? null : shown('cafe-reference-when') || '',
        flag: shown('cafe-different-profile'), badge: shown('cafe-reference-badge'), line: shown('cafe-legend-line'),
        notice: shown('cafe-legend-notice'), targets: shown('cafe-legend-targets'),
        view: [...document.querySelectorAll('#cafe-view button')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.view).join(),
    };
});

// What a chart holds: each line's name, how many points it has and whether it
// carries an end label, and where the time axis ends.
export const chartLines = (page, id = 'plotly-chart') => page.evaluate(async chartId => {
    const { echarts } = await import('/src/modules/echarts-streamline.min.js');
    const chart = echarts.getInstanceByDom(document.getElementById(chartId));
    if (!chart) return null;
    const option = chart.getOption();
    const lines = option.series.filter(series => series && String(series.id).startsWith('trace-'));
    return {
        end: option.xAxis[0].max,
        names: lines.map(line => line.name),
        points: lines.map(line => line.data.length),
        labelled: lines.filter(line => line.markPoint).map(line => line.name),
        referenceEnd: Math.max(0, ...lines.filter(line => /^Reference /.test(line.name)).map(line => (line.data.length ? line.data[line.data.length - 1][0] : 0))),
    };
}, id);

// How the main chart was drawn over `ms`: frames appended to its first line,
// and times it was given lines in full.
export const countDraws = (page, ms) => page.evaluate(async wait => {
    const { echarts } = await import('/src/modules/echarts-streamline.min.js');
    const chart = echarts.getInstanceByDom(document.getElementById('plotly-chart'));
    const counts = { appended: 0, full: 0 };
    const { setOption, appendData } = chart;
    chart.setOption = function (option, ...rest) { if (option.series?.some(series => series.data)) counts.full += 1; return setOption.call(this, option, ...rest); };
    chart.appendData = function (...args) { if (args[0].seriesIndex === 0) counts.appended += 1; return appendData.apply(this, args); };
    await new Promise(resolve => setTimeout(resolve, wait));
    chart.setOption = setOption;
    chart.appendData = appendData;
    return counts;
}, ms);

// The comparison row: its mode, and each card that shows. In Arabic and Hebrew a
// number with its unit is kept together by two marks that are not text.
export const row = page => page.evaluate(() => {
    const text = element => element.textContent.replace(/[⁨⁩]/g, '');
    const element = document.getElementById('cafe-compare');
    return {
        mode: element.dataset.mode,
        height: Math.round(element.getBoundingClientRect().height),
        cards: [...element.querySelectorAll('.cafe-compare-card')].filter(card => card.offsetParent !== null).map(card => ({
            key: card.dataset.card,
            title: text(card.querySelector('.cafe-compare-title')),
            value: text(card.querySelector('.cafe-compare-value')),
            diff: text(card.querySelector('.cafe-compare-diff')),
            side: text(card.querySelector('.cafe-compare-side')),
        })),
    };
});
export const keys = shown => shown.cards.map(card => card.key).join(' ');
export const sides = shown => shown.cards.map(card => card.side);

// The stage lines on a chart, each with the name written on it, or null.
export const stageNames = (page, id = 'plotly-chart') => page.evaluate(async chartId => {
    const { echarts } = await import('/src/modules/echarts-streamline.min.js');
    const chart = echarts.getInstanceByDom(document.getElementById(chartId));
    const markers = chart?.getOption().series.find(series => series && series.id === 'markers-0');
    return (markers?.markLine?.data || []).map(line => (line.label && line.label.show ? line.label.formatter() : null));
}, id);

export const REFERENCE_LINES = ['Reference pressure', 'Reference flow', 'Reference weight'];
