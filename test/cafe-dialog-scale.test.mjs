// The page's dialogs are scaled as the page is, read off the markup, the
// stylesheet and Streamline's scaling (docs/cafe/DESIGN.md, "How the code is
// shaped"; issue #39). A modal <dialog> draws in the top layer, outside
// #scaled-content and its transform, so each carries a canvas of its own.
// What the sizes come to on a smaller screen is measured by the smoke run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const html = read('index.html');
const css = read('src/cafe/cafe.css');
const scaling = read('src/modules/scaling.js');

// Each of the page's own dialogs, as the text between its tags.
const DIALOGS = [...html.matchAll(/<dialog\b[^>]*\bid="(cafe-[^"]+)"[^>]*>([\s\S]*?)<\/dialog>/g)]
    .map(([, id, inner]) => ({ id, inner }));

// The element that opens at `start` in `text`, to its closing tag, counting
// nested <div>s.
function divAt(text, start) {
    const tags = /<\/?div\b[^>]*>/g;
    tags.lastIndex = start;
    let depth = 0;
    for (let tag; (tag = tags.exec(text));) {
        depth += tag[0].startsWith('</') ? -1 : 1;
        if (depth === 0) return text.slice(start, tags.lastIndex);
    }
    return null;
}

// The stylesheet's rules, as selector and body, comments removed.
const RULES = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: selector.trim(), body }));

test('the page has its dialogs, each a modal', () => {
    assert.deepEqual(DIALOGS.map(({ id }) => id).sort(), [
        'cafe-note-dialog', 'cafe-pick-dialog', 'cafe-recipe-dialog', 'cafe-reference-dialog', 'cafe-shots-dialog',
    ], 'a new dialog of the page\'s is added here once it has its canvas');
});

test('everything in each dialog is inside its canvas', () => {
    for (const { id, inner } of DIALOGS) {
        const body = inner.replace(/<!--[\s\S]*?-->/g, '').trim();
        assert.ok(body.startsWith('<div class="cafe-dialog-canvas">'), `${id} opens with its canvas`);
        const canvas = divAt(body, 0);
        assert.equal(canvas, body, `${id} has nothing outside its canvas`);
        assert.match(canvas, /class="modal-box cafe-dialog\b/, `${id}'s box is in its canvas`);
    }
});

test('the canvas is the screen\'s size in design px, scaled by Streamline\'s two factors', () => {
    const rule = RULES.find(({ selector }) => selector === '.cafe-dialog-canvas');
    assert.ok(rule, 'cafe.css styles .cafe-dialog-canvas');
    const value = name => rule.body.match(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+);`))?.[1].trim();
    assert.equal(value('position'), 'absolute');
    assert.equal(value('left'), '0');
    assert.equal(value('top'), '0');
    assert.equal(value('width'), 'calc(100% / var(--streamline-scale-x, 1))');
    assert.equal(value('height'), 'calc(100% / var(--streamline-scale-y, 1))');
    assert.equal(value('transform-origin'), '0 0');
    assert.equal(value('transform'), 'scale(var(--streamline-scale-x, 1), var(--streamline-scale-y, 1))');
});

test('no limit inside a dialog is a share of the screen', () => {
    // vw and vh are screen px, which the canvas scales again; a share of the
    // canvas (a percentage) is in design px.
    const inDialog = /cafe-dialog|cafe-shots|cafe-pick|cafe-note|cafe-reference-dialog|cafe-recipe/;
    const screenUnit = /\d(?:d|s|l)?v(?:w|h|min|max)\b/;
    for (const { selector, body } of RULES) {
        if (inDialog.test(selector)) assert.doesNotMatch(body, screenUnit, selector);
    }
});

test('Streamline\'s scaling writes the factors its transform uses, next to it', () => {
    assert.match(scaling,
        /content\.style\.transform = `translate\(\$\{offsetX\}px, \$\{offsetY\}px\) scale\(\$\{sx\}, \$\{sy\}\)`;\n(?:\s*\/\/[^\n]*\n)+\s*document\.documentElement\.style\.setProperty\('--streamline-scale-x', String\(sx\)\);\n\s*document\.documentElement\.style\.setProperty\('--streamline-scale-y', String\(sy\)\);/);
});
