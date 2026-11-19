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
        // Comments only: a // that starts a line or follows a space, not one in a URL.
        const source = readFileSync(file, 'utf8').replace(/(^|\s)\/\/.*$/gm, '$1');
        assert.doesNotMatch(source, /waitForTimeout|\bsleep\(|setTimeout\(/, `${file.pathname}: a fixed sleep`);
        assert.doesNotMatch(source, /\.then\([^()]*(\([^()]*\)[^()]*)*,\s*(\([^)]*\)|\w+)\s*=>/, `${file.pathname}: a .then with a rejection handler`);
        // A .catch that doesn't throw again, or a catch block left empty.
        for (const [at] of source.matchAll(/\.catch\(/g).map(m => [m.index])) {
            assert.match(source.slice(at, at + 200), /throw\b/, `${file.pathname}: a .catch that swallows (${source.slice(at, at + 60).replace(/\s+/g, ' ')})`);
        }
        assert.doesNotMatch(source, /catch\s*(\([^)]*\))?\s*\{\s*\}/, `${file.pathname}: an empty catch`);
        // A wait or check in a try whose catch doesn't throw again.
        assert.doesNotMatch(source, /try\s*\{[^}]*\b(waitFor\w*|expect|poll)\b[^}]*\}\s*catch\s*(\([^)]*\))?\s*\{(?![^}]*\bthrow\b)[^}]*\}/, `${file.pathname}: a wait whose failure is caught`);
    }
});
