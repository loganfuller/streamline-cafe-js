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

test('no module writes Decaid\'s store by key', () => {
    // Nothing on the page keeps state of its own yet. When something does, it
    // goes in the streamlineCafe namespace, and this test names the module.
    assert.deepEqual(filesWith(/\b(setKVValue|deleteKVValue)\b/), []);
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
    for (const name of ['recipe-write.js', 'slot-menu.js', 'translations.js']) {
        await assert.doesNotReject(import(new URL(name, CAFE_DIR)), name);
    }
});
