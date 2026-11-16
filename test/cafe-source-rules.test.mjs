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

test('cafe-only state is written to the streamlineCafe namespace, and only there', () => {
    const writers = SOURCES.filter(({ text }) => /\b(setKVValue|deleteKVValue)\b/.test(text));
    assert.deepEqual(writers.map(({ name }) => name), ['editor.js']);
    const [{ text }] = writers;
    assert.match(text, /const CAFE_NAMESPACE = 'streamlineCafe';/);
    const calls = [...text.matchAll(/\b(?:setKVValue|deleteKVValue)\(\s*([^,)]*)/g)].map(match => match[1].trim());
    assert.ok(calls.length >= 2);
    assert.deepEqual([...new Set(calls)], ['CAFE_NAMESPACE']);
});

test('no module writes Streamline\'s strip mode', () => {
    assert.deepEqual(filesWith(/\bsetStripMode\b|dyeStripMode/), []);
});

test('the modules the page\'s decisions live in touch no browser global at load', async () => {
    assert.equal(typeof globalThis.window, 'undefined');
    assert.equal(typeof globalThis.document, 'undefined');
    for (const name of ['recipe-write.js', 'slot-hold.js', 'translations.js']) {
        await assert.doesNotReject(import(new URL(name, CAFE_DIR)), name);
    }
});
