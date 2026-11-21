// What the page tests and the real journeys read off the page and do on it.
// The chart's module is found from the page's own address, so a page served
// under a path, as the public preview is, reads the chart it draws.

import { expect } from './test.mjs';

/**
 * Starts counting how the chart in `id` is drawn: frames appended to its first
 * line, and times it is given lines in full. `drawCounts(page)` reads the
 * counts since. A page test plays the frames in between
 * (`cafe.pour`).
 */
export const watchDraws = (page, id = 'plotly-chart') => page.evaluate(async chartId => {
    const { echarts } = await import(new URL('src/modules/echarts-streamline.min.js', document.baseURI).href);
    const chart = echarts.getInstanceByDom(document.getElementById(chartId));
    const counts = { appended: 0, full: 0 };
    const { setOption, appendData } = chart;
    chart.setOption = function (option, ...rest) { if (option.series?.some(series => series.data)) counts.full += 1; return setOption.call(this, option, ...rest); };
    chart.appendData = function (...args) { if (args[0].seriesIndex === 0) counts.appended += 1; return appendData.apply(this, args); };
    window.__cafeDraws = counts;
}, id);

/** The counts since `watchDraws`: `{ appended, full }`. */
export const drawCounts = page => page.evaluate(() => ({ ...window.__cafeDraws }));

/** The page, with a tablet's numbers opening the numpad, as Streamline decides at start. */
export async function openPage(cafe) {
    await cafe.open({ before: () => { window._forceNumpadMobile = true; } });
    return cafe.page;
}

/** A recipe's card on the strip, by its slot. */
export const card = (page, slot) => page.locator('#cafe-strip .cafe-card').nth(slot - 1);

/** A tap on a recipe's card, and the load through Streamline's apply settled. */
export async function load(cafe, recipe) {
    await card(cafe.page, recipe.slot).click();
    await expect(cafe.page.locator('#cafe-title')).toHaveText(recipe.name);
    await cafe.advance(2000);
}

export const pickDialog = page => page.locator('#cafe-pick-dialog[open]');
export const pickClosed = page => page.locator('#cafe-pick-dialog:not([open])');
export const pickRows = page => page.locator('#cafe-pick-list .cafe-pick-row').evaluateAll(rows => rows.map(row => ({
    name: row.querySelector('.cafe-pick-row-name').textContent,
    detail: row.querySelector('.cafe-pick-row-detail').textContent,
    inUse: !!row.querySelector('.cafe-pick-in-use') && (row.parentElement.classList.contains('cafe-pick-confirming') || row.getAttribute('aria-pressed') === 'true'),
})));
export const pickRow = (page, name) => page.locator('#cafe-pick-list .cafe-pick-row').filter({ has: page.locator('.cafe-pick-row-name', { hasText: name }) });

/**
 * The pick dialog closed, and its close event handled, which empties its list
 * and lets it open again: a tap before that opens nothing
 * (src/cafe/pick-dialog.js, `active`).
 */
export async function untilPickClosed(cafe) {
    await expect(pickClosed(cafe.page)).toBeAttached();
    await expect(cafe.page.locator('#cafe-pick-list .cafe-pick-row')).toHaveCount(0);
    await cafe.settle();
}

/**
 * A tap where a finger lands: on a row's name, or the name under it. The two
 * sit inside one button and take no pointer events of their own.
 */
export async function tapAt(page, selector) {
    const box = await page.locator(selector).boundingBox();
    await page.mouse.click(box.x + Math.min(box.width / 2, 40), box.y + box.height / 2);
}

/** Every write to Decaid, the store and DYE2 included: anything asked but a read. */
export const isWrite = entry => entry.method !== 'GET' && entry.method !== 'HEAD' && entry.method !== 'OPTIONS';
/** The writes since a mark, as "METHOD path" with the body, for a test to compare whole. */
export const writes = entries => entries.filter(isWrite).map(({ method, path, body }) => ({ write: `${method} ${path}`, body }));

/** The menu a press held on a card opens (Streamline's context menu). */
export const menu = page => page.locator('#app-context-menu.context-menu--open');
/** Its items' text, in order. */
export const menuItems = page => menu(page).locator('.context-menu__item').allTextContents();

/** A finger held on a card past Streamline's half second, let go, and the menu it opened. */
export async function holdCard(cafe, slot) {
    const { page } = cafe;
    const box = await card(page, slot).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await cafe.advance(600);
    await page.mouse.up();
    await expect(menu(page)).toBeVisible();
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
    // "Today 14:32 · Ana": the row's time, and the barista's name where it has
    // one, which the row cuts short or leaves out when it is narrow.
    const credit = of => [`cafe-${of}-when`, `cafe-${of}-who`].map(id => document.getElementById(id).textContent.trim()).filter(Boolean).join(' ') || null;
    return {
        label: shown('cafe-shot-label'), when: credit('shot'), make: shown('cafe-make-reference'),
        muted: shown('cafe-make-reference') !== null && document.getElementById('cafe-make-reference').disabled,
        // A row has no box of its own: it shows where its name does.
        reference: document.querySelector('#cafe-legend-reference .cafe-legend-name').offsetParent === null ? null : credit('reference') || '',
        flag: shown('cafe-different-profile'), badge: shown('cafe-reference-badge'), line: shown('cafe-legend-line'),
        notice: shown('cafe-legend-notice'), targets: document.querySelector('#cafe-legend-targets .cafe-legend-name').offsetParent === null ? null : document.getElementById('cafe-legend-targets').textContent.trim(),
        view: [...document.querySelectorAll('#cafe-view button')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.view).join(),
    };
});

// What a chart holds: each line's name, how many points it has and whether it
// carries an end label, and where the time axis ends.
export const chartLines = (page, id = 'plotly-chart') => page.evaluate(async chartId => {
    const { echarts } = await import(new URL('src/modules/echarts-streamline.min.js', document.baseURI).href);
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
    const { echarts } = await import(new URL('src/modules/echarts-streamline.min.js', document.baseURI).href);
    const chart = echarts.getInstanceByDom(document.getElementById(chartId));
    const markers = chart?.getOption().series.find(series => series && series.id === 'markers-0');
    return (markers?.markLine?.data || []).map(line => (line.label && line.label.show ? line.label.formatter() : null));
}, id);

export const REFERENCE_LINES = ['Reference pressure', 'Reference flow', 'Reference weight'];

// The stars and the notes on the legend. `stars` is how much of each star is
// filled, in percent, or null where the Shot's row has no stars; `note` is
// which icon the row's note button shows, `note` or `add`, or null with no
// button; `referenceRating` is the text of the reference's rating, or null; and
// `referenceNote` whether its note icon shows.
export const remarks = page => page.evaluate(() => {
    const shown = id => {
        const element = document.getElementById(id);
        return element && element.offsetParent !== null ? element : null;
    };
    const button = shown('cafe-shot-note');
    return {
        stars: shown('cafe-stars') ? [...document.querySelectorAll('#cafe-stars .cafe-star')].map(star => Math.round(parseFloat(star.style.getPropertyValue('--cafe-star-fill')) || 0)) : null,
        note: button ? [...button.querySelectorAll('svg')].filter(icon => getComputedStyle(icon).display !== 'none').map(icon => (icon.classList.contains('cafe-icon-add') ? 'add' : 'note')).join() : null,
        referenceRating: shown('cafe-reference-rating') ? shown('cafe-reference-rating').textContent : null,
        referenceNote: !!shown('cafe-reference-note'),
    };
});

// The note's dialog, or null while it is closed: its title, the line under it,
// the box's text and placeholder where it is one to write in, the note where it
// is one to read, the buttons that show, and the line that says a save failed.
export const noteDialog = page => page.evaluate(() => {
    const dialog = document.getElementById('cafe-note-dialog');
    if (!dialog.open) return null;
    const shown = id => {
        const element = document.getElementById(id);
        return element && getComputedStyle(element).display !== 'none' ? element : null;
    };
    const box = dialog.querySelector('.cafe-dialog').getBoundingClientRect();
    return {
        title: shown('cafe-note-title').textContent,
        when: shown('cafe-note-when').textContent,
        rating: shown('cafe-note-rating')?.textContent || '',
        label: shown('cafe-note-label')?.textContent ?? null,
        text: shown('cafe-note-text')?.value ?? null,
        placeholder: shown('cafe-note-text')?.placeholder ?? null,
        read: shown('cafe-note-read')?.textContent ?? null,
        buttons: [...dialog.querySelectorAll('button')].filter(button => getComputedStyle(button).display !== 'none').map(button => button.textContent.trim()),
        error: shown('cafe-note-error')?.textContent ?? null,
        box: { top: Math.round(box.top), bottom: Math.round(box.bottom) },
        boxHeight: shown('cafe-note-text') ? Math.round(shown('cafe-note-text').getBoundingClientRect().height) : null,
    };
});

// Does the legend's row hold everything it shows? `out` names what runs past
// its right edge or is cut short, but for when a Shot was pulled and by whom,
// which give way in a narrow row, the name first. `times` and `names` are how
// many pixels each time and each name lacks, 0 for one shown whole.
export const legendFits = page => page.evaluate(() => {
    const legend = document.getElementById('cafe-legend');
    const edge = legend.getBoundingClientRect().right + 0.5;
    const out = [];
    for (const element of legend.querySelectorAll('span, button, svg')) {
        const box = element.getBoundingClientRect();
        if (!box.width) continue;
        const name = element.id || element.getAttribute('class') || element.tagName;
        if (box.right > edge) out.push(`${name} runs past the row`);
        else if (element.scrollWidth > element.clientWidth + 1 && !element.matches('.cafe-legend-when, .cafe-legend-who')) out.push(`${name} is cut short`);
    }
    // By the text's own width: a box a tenth of a pixel short already ends in "…".
    const lacking = selector => [...legend.querySelectorAll(selector)].filter(element => element.textContent).map(element => {
        const text = document.createRange();
        text.selectNodeContents(element);
        return Math.max(0, Math.round((text.getBoundingClientRect().width - element.getBoundingClientRect().width) * 10) / 10);
    });
    return { out, times: lacking('.cafe-legend-when'), names: lacking('.cafe-legend-who') };
});

// The Shots list's header while the list is open: what stands under its title
// and its line, each null where it does not show, and the columns that show.
export const shotsHeader = page => page.evaluate(() => {
    const shown = id => {
        const element = document.getElementById(id);
        return element && getComputedStyle(element).display !== 'none' ? element.textContent.trim() : null;
    };
    return {
        title: shown('cafe-shots-title'),
        under: shown('cafe-shots-under'),
        line: shown('cafe-shots-line'),
        columns: [...document.querySelectorAll('#cafe-shots-dialog .cafe-shots-columns > span')].filter(span => getComputedStyle(span).display !== 'none').map(span => span.textContent.trim()),
    };
});

// One of the page's dialogs as drawn, while it is open (issue #39): the page's
// scale, read off Streamline's canvas; the window; the box; each part's width
// and height, by the selectors `parts` names (the first match of each); and
// what shows a sideways scrollbar, the dialog itself included. Sizes are
// screen px.
export const dialogDrawn = (page, id, parts) => page.evaluate(({ id, parts }) => {
    const dialog = document.getElementById(id);
    if (!dialog?.open) return null;
    const canvas = document.getElementById('scaled-content');
    const page = canvas.getBoundingClientRect();
    const size = rect => [Math.round(rect.width * 10) / 10, Math.round(rect.height * 10) / 10];
    const box = dialog.querySelector('.cafe-dialog').getBoundingClientRect();
    const sideways = [dialog, ...dialog.querySelectorAll('*')].filter(element => {
        const overflow = getComputedStyle(element).overflowX;
        return (overflow === 'auto' || overflow === 'scroll') && element.scrollWidth > element.clientWidth + 1;
    }).map(element => element.id || element.className || element.tagName);
    return {
        scaleX: page.width / 1920,
        scaleY: page.height / parseFloat(canvas.style.height),
        window: [window.innerWidth, window.innerHeight],
        box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom, size: size(box) },
        parts: Object.fromEntries(parts.map(selector => [selector, dialog.querySelector(selector) ? size(dialog.querySelector(selector).getBoundingClientRect()) : null])),
        sideways,
    };
}, { id, parts });
