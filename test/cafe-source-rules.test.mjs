// What the modules under src/cafe/ may write, read off their source
// (docs/cafe/DESIGN.md, "Writing DYE2's records" and "Settings").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const CAFE_DIR = new URL('../src/cafe/', import.meta.url);
const SOURCES = readdirSync(CAFE_DIR).filter(name => name.endsWith('.js'))
    .map(name => ({ name, text: readFileSync(new URL(name, CAFE_DIR), 'utf8') }));

const filesWith = pattern => SOURCES.filter(({ text }) => pattern.test(text)).map(({ name }) => name);

test('one module writes DYE2\'s recipe records', () => {
    assert.deepEqual(filesWith(/\bsetDye2KvArray\b/), ['recipe-writer.js']);
});

test('no module reaches Decaid\'s store, or anything else, around api.js', () => {
    // A request of a module's own could write DYE2's records without the writer.
    assert.deepEqual(filesWith(/\bfetch\s*\(|\bXMLHttpRequest\b|\bsendBeacon\b|\bsetValueInStore\b/), []);
});

test('one module writes Decaid\'s store by key, in the streamlineCafe namespace', () => {
    // The page's own state: the choice of reference and the graph's view.
    assert.deepEqual(filesWith(/\b(setKVValue|deleteKVValue)\b/), ['cafe-store.js']);
    const store = SOURCES.find(({ name }) => name === 'cafe-store.js').text;
    assert.match(store, /const NAMESPACE = 'streamlineCafe';/);
    assert.deepEqual([...store.matchAll(/\b[gs]etKVValue\(([^,)]*)/g)].map(match => match[1]), ['NAMESPACE', 'NAMESPACE'], 'and reads and writes no other namespace');
});

test('the page reads Shots and the choice of reference through the Shot seam only', () => {
    assert.deepEqual(filesWith(/\bgetShots?\b|\bgetLatestShotSummary\b|\bgetShotIds\b/), ['shot-seam.js']);
    assert.deepEqual(filesWith(/\bREFERENCES_KEY\b/), ['cafe-store.js', 'shot-seam.js']);
    assert.deepEqual(filesWith(/from '\.\/tablet-shots\.js'/), ['shot-seam.js']);
    assert.deepEqual(filesWith(/from '\.\.\/modules\/idb\.js'/), [], 'Streamline\'s shot cache is not a source');
});

test('the fork\'s hooks are still in Streamline\'s chart, renderer and api modules', () => {
    const chart = readFileSync(new URL('../src/modules/chart.js', import.meta.url), 'utf8');
    assert.match(chart, /export function setChartOverlay\(overlay\) \{/);
    assert.match(chart, /export function setShotChooser\(chooser\) \{/);
    assert.match(chart, /const drawn = traces === chartTraces \? withCafeOverlay\(traces, layout, mode, 'main'\) : \{ traces, layout \};/, 'the overlay is on the chart\'s own lines only');
    assert.match(chart, /const \{ traces, layout \} = withCafeOverlay\(own, expandedLayout\(currentTheme, own, expandedXRange\(mode, own\)\), mode, 'expanded'\);/, 'and on the full-screen chart');
    assert.match(chart, /yref: 'paper',\s*name: stepName,/, 'a stage line keeps its step\'s name');
    const renderer = readFileSync(new URL('../src/modules/echarts-renderer.js', import.meta.url), 'utf8');
    assert.match(renderer, /function cafeShapeLabel\(shape\) \{/);
    assert.match(renderer, /\.\.\.cafeShapeLabel\(shape\)/, 'and the renderer writes a stage line\'s name');
    assert.match(chart, /export function plotHistoricalShot\(measurements, workflow = null\) \{\s*if \(cafeShotChooser && !cafeShotChooser\(measurements, workflow\)\) return;/);
    const api = readFileSync(new URL('../src/modules/api.js', import.meta.url), 'utf8');
    assert.match(api, /export async function getShot\(id\) \{/);
});

test('no module opens one of DYE2\'s pages', () => {
    // The page never leaves for DYE2's editor: recipes are made, chosen and
    // taken out of a slot here.
    assert.deepEqual(filesWith(/\bopenPluginOverlay\b|recipe-edit/), []);
});

test('Streamline\'s strip module is asked for three things only', () => {
    // Its apply, its start, and the one hook the fork added to it.
    const names = new Set();
    for (const { text } of SOURCES) {
        for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/modules\/dyeStrip\.js'/g)) {
            for (const name of match[1].split(',')) names.add(name.trim());
        }
    }
    assert.deepEqual([...names].sort(), ['applyRecipe', 'forgetAppliedItem', 'initDyeStrip']);
    const strip = readFileSync(new URL('../src/modules/dyeStrip.js', import.meta.url), 'utf8');
    assert.match(strip, /export function forgetAppliedItem\(\) \{\s*applySeq\+\+;/, 'the hook is still in dyeStrip.js after a merge of Streamline');
});

test('no module writes Streamline\'s strip mode', () => {
    assert.deepEqual(filesWith(/\bsetStripMode\b|dyeStripMode/), []);
});

test('the modules the page\'s decisions live in touch no browser global at load', async () => {
    assert.equal(typeof globalThis.window, 'undefined');
    assert.equal(typeof globalThis.document, 'undefined');
    for (const name of ['recipe-write.js', 'slot-menu.js', 'translations.js', 'shot-model.js', 'tablet-shots.js', 'reference-overlay.js', 'comparison.js', 'stage-names.js']) {
        await assert.doesNotReject(import(new URL(name, CAFE_DIR)), name);
    }
});
