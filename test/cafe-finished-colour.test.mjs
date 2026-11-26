// The red of a finished batch (docs/cafe/DESIGN.md, "A finished batch"): one
// colour of the fork's, with a value for each theme, that meets WCAG AA
// against every colour it is drawn beside.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const CAFE = read('../src/cafe/cafe.css');
const MAIN = read('../src/css/main.css');

const block = (css, selector) => {
    const start = css.indexOf(`${selector} {`);
    assert.notEqual(start, -1, selector);
    return css.slice(start, css.indexOf('}', start));
};
const token = (css, selector, name) => {
    const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(block(css, selector));
    assert.ok(match, `${name} in ${selector}`);
    return match[1];
};

const luminance = hex => [1, 3, 5]
    .map(at => parseInt(hex.slice(at, at + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => {
    const [dark, light] = [luminance(a), luminance(b)].sort((x, y) => x - y);
    return (light + 0.05) / (dark + 0.05);
};

const THEMES = [
    { name: 'light', cafe: ':root', main: ':root' },
    { name: 'dark', cafe: '[data-theme="dark"]', main: "[data-theme='dark']" },
];

test('the red has one value for each theme', () => {
    assert.equal(CAFE.match(/--cafe-finished:/g).length, 2);
    assert.notEqual(token(CAFE, ':root', '--cafe-finished'), token(CAFE, '[data-theme="dark"]', '--cafe-finished'));
});

for (const theme of THEMES) {
    test(`in the ${theme.name} theme the red meets the contrast text needs, on a card and under Dose`, () => {
        const red = token(CAFE, theme.cafe, '--cafe-finished');
        const card = token(MAIN, theme.main, '--profile-button-background-color');
        const column = token(MAIN, theme.main, '--box-color');
        assert.ok(contrast(red, card) >= 4.5, `a card's words, and a loaded card's on its fill: ${contrast(red, card).toFixed(2)}`);
        assert.ok(contrast(red, column) >= 4.5, `the batch under Dose, and a card's border on the strip: ${contrast(red, column).toFixed(2)}`);
    });
}

test('a red card draws only the red and the card\'s own background', () => {
    assert.match(CAFE, /\.cafe-card-finished \{\s*border-color: var\(--cafe-finished\);\s*color: var\(--cafe-finished\);\s*\}/);
    assert.match(CAFE, /\.cafe-card-finished\[aria-pressed="true"\] \{\s*border-color: var\(--cafe-finished\);\s*background: var\(--cafe-finished\);\s*color: var\(--profile-button-background-color\);\s*\}/);
    assert.match(CAFE, /\.cafe-card-finished \.cafe-card-bean \{\s*opacity: 1;\s*\}/);
    assert.match(CAFE, /\.cafe-row-desc\.cafe-batch-finished \{\s*color: var\(--cafe-finished\);\s*\}/);
});
