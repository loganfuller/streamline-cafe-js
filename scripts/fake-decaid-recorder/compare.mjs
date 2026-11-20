// A fresh recording against the committed one, by shape: which recordings are
// missing or new, and in each, the fields present in one and not the other, or
// holding another kind of value (docs/cafe/TESTING.md, "The real-stack
// workflow"). The values themselves are new on every fresh stack (ids, times, a
// pour's frames), so what they mean to the fake is checked by replaying the
// fresh recordings against it (test/fake-decaid-recordings.test.mjs); this is
// the rest, a field Decaid, DYE2 or Decent Sync added, dropped or retyped.
//
//   node scripts/fake-decaid-recorder/compare.mjs <committed dir> <fresh dir> [--markdown=<file>]
//
// Exits 1 when anything differs, and writes what differs as Markdown where asked.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [committedDir, freshDir] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const markdown = process.argv.find(arg => arg.startsWith('--markdown='))?.slice('--markdown='.length);
if (!committedDir || !freshDir) throw new Error('usage: compare.mjs <committed dir> <fresh dir> [--markdown=<file>]');

// A key that names a record (a Shot's id, a bean's, a store key that is an id)
// stands for any such key: the ids are new on every stack.
// An id inside a key (DYE2 keys its shot index by bean, profile and grinder id,
// and by the recipe ids it makes at random, `recipe-mwo9hohd6k2t`) is one too.
// Only these forms: a field's name, however long (`targetGroupTemperature`),
// stays itself, so a field renamed upstream is reported.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\brecipe-[a-z0-9]{8,}\b/gi;
const ID = /^([0-9a-f]{24,}|\d+)$/i;
const keyOf = key => (ID.test(key) ? '<id>' : key.replace(UUID, '<id>'));
const kind = value => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);

/**
 * Every path in `value`, each element of an array as `[]`, with the kinds of
 * value seen there. A field null in one place and set in another is both, and
 * null is left out of the comparison (below): whether a field is set is the data's.
 */
function shape(value, path = '$', paths = new Map()) {
    const seen = paths.get(path) || new Set();
    seen.add(kind(value));
    paths.set(path, seen);
    if (Array.isArray(value)) for (const inner of value) shape(inner, `${path}[]`, paths);
    else if (value && typeof value === 'object') for (const [key, inner] of Object.entries(value)) shape(inner, `${path}.${keyOf(key)}`, paths);
    return paths;
}

const names = dir => readdirSync(dir).filter(file => file.endsWith('.json')).map(file => file.slice(0, -5)).sort();
const load = (dir, name) => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
// The versions a recording was made with differ by design when the pins do.
const SKIPPED = /^\$\.recordedWith\b/;

const committed = names(committedDir);
const fresh = names(freshDir);
const report = [];
for (const name of committed.filter(n => !fresh.includes(n))) report.push({ name, lines: ['not recorded afresh'] });
for (const name of fresh.filter(n => !committed.includes(n))) report.push({ name, lines: ['recorded afresh, not committed'] });
for (const name of committed.filter(n => fresh.includes(n))) {
    const was = shape(load(committedDir, name));
    const now = shape(load(freshDir, name));
    const lines = [];
    const kinds = set => [...set].filter(k => k !== 'null').sort();
    for (const [path, set] of now) {
        if (SKIPPED.test(path)) continue;
        if (!was.has(path)) lines.push(`+ ${path} (${kinds(set).join('|') || 'null'})`);
        else {
            const before = kinds(was.get(path));
            const after = kinds(set);
            if (before.length && after.length && before.join('|') !== after.join('|')) lines.push(`~ ${path}: ${before.join('|')} → ${after.join('|')}`);
        }
    }
    for (const [path, set] of was) {
        if (!SKIPPED.test(path) && !now.has(path)) lines.push(`- ${path} (${kinds(set).join('|') || 'null'})`);
    }
    if (lines.length) report.push({ name, lines: lines.sort() });
}

if (!report.length) {
    console.log(`the fresh recordings have the committed ones' shape (${committed.length} recordings)`);
} else {
    for (const { name, lines } of report) console.log(`${name}.json:\n${lines.map(line => `  ${line}`).join('\n')}`);
    console.log(`${report.length} recording(s) differ in shape (+ only in the fresh one, - only in the committed one, ~ another kind of value)`);
}
if (markdown) {
    const text = report.length
        ? report.map(({ name, lines }) => `- \`${name}.json\`\n\n  \`\`\`\n${lines.slice(0, 40).map(line => `  ${line}`).join('\n')}${lines.length > 40 ? `\n  … and ${lines.length - 40} more` : ''}\n  \`\`\``).join('\n')
        : '';
    writeFileSync(markdown, text);
}
process.exitCode = report.length ? 1 : 0;
