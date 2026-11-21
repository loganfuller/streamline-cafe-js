// The page tests' own rules (docs/cafe/TESTING.md): no fixed sleep and no
// swallowed timeout. Time moves only through the clock helper in
// test/page/support/test.mjs, and a wait that runs out fails the test. The real
// journeys (test/real/) keep the same rules: their one fixed wait, for proving
// nothing arrives, is `quiet(ms, why)` in test/real/support/journey.mjs. The
// page tests' one, for a socket frame held up, is `late()` in
// test/page/support/late-frame.mjs. Those two files are left out.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const inside = dir => readdirSync(new URL(dir, import.meta.url)).filter(name => name.endsWith('.mjs')).map(name => new URL(`${dir}${name}`, import.meta.url));
const files = [
    ...inside('./page/'),
    ...inside('./page/support/').filter(url => !url.pathname.endsWith('/late-frame.mjs')),
    ...inside('./real/'),
    ...inside('./real/support/').filter(url => !url.pathname.endsWith('/journey.mjs')),
];

// The arguments of the call whose `(` is at `open`: the text to its matching
// `)`, and whether a comma stands at its top level (a second argument).
function call(source, open) {
    let depth = 0;
    let comma = false;
    for (let at = open; at < source.length; at += 1) {
        const ch = source[at];
        if ('([{'.includes(ch)) depth += 1;
        else if (')]}'.includes(ch)) {
            depth -= 1;
            if (depth === 0) return { text: source.slice(open, at + 1), comma };
        } else if (ch === ',' && depth === 1) comma = true;
    }
    return { text: source.slice(open), comma };
}

test('no page test or real journey holds a fixed sleep or swallows a timeout', () => {
    assert.ok(files.length > 0);
    for (const file of files) {
        // Comments only: a // that starts a line or follows a space, not one in a URL.
        const source = readFileSync(file, 'utf8').replace(/(^|\s)\/\/.*$/gm, '$1');
        const near = at => source.slice(at, at + 60).replace(/\s+/g, ' ');
        assert.doesNotMatch(source, /waitForTimeout|\bsleep\(|setTimeout\(/, `${file.pathname}: a fixed sleep`);
        // A .then with a second argument: a rejection handler.
        for (const match of source.matchAll(/\.then\(/g)) {
            assert.ok(!call(source, match.index + 5).comma, `${file.pathname}: a .then with a rejection handler (${near(match.index)})`);
        }
        // A .catch that doesn't throw again, or a catch block left empty.
        for (const match of source.matchAll(/\.catch\(/g)) {
            assert.match(call(source, match.index + 6).text, /throw\b/, `${file.pathname}: a .catch that swallows (${near(match.index)})`);
        }
        assert.doesNotMatch(source, /catch\s*(\([^)]*\))?\s*\{\s*\}/, `${file.pathname}: an empty catch`);
        // A wait or check in a try whose catch doesn't throw again.
        for (const match of source.matchAll(/\btry\s*\{/g)) {
            const block = call(source, match.index + match[0].length - 1).text;
            if (!/\b(waitFor\w*|expect|poll)\b/.test(block)) continue;
            const after = source.slice(match.index + match[0].length - 1 + block.length);
            const handler = /^\s*catch\s*(\([^)]*\))?\s*\{/.exec(after);
            if (handler) assert.match(call(after, handler[0].length - 1).text, /\bthrow\b/, `${file.pathname}: a wait whose failure is caught (${near(match.index)})`);
        }
    }
});
