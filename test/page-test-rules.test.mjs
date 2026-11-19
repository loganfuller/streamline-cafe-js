// The page tests' own rules (docs/cafe/TESTING.md): no fixed sleep and no
// swallowed timeout. Time moves only through the clock helper in
// test/page/support/test.mjs, and a wait that runs out fails the test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const DIR = new URL('./page/', import.meta.url);
const files = [
    ...readdirSync(DIR).filter(name => name.endsWith('.mjs')).map(name => new URL(name, DIR)),
    ...readdirSync(new URL('support/', DIR)).filter(name => name.endsWith('.mjs')).map(name => new URL(`support/${name}`, DIR)),
];

test('no page test holds a fixed sleep or swallows a timeout', () => {
    assert.ok(files.length > 0);
    for (const file of files) {
        const source = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '');
        assert.doesNotMatch(source, /waitForTimeout|\bsleep\(|setTimeout\(/, `${file.pathname}: a fixed sleep`);
        assert.doesNotMatch(source, /\.catch\(\s*\(\)\s*=>\s*(\{\s*\}|null|undefined|false)\s*\)|\.then\(\s*\(\)\s*=>\s*true\s*,/, `${file.pathname}: a timeout swallowed`);
    }
});
