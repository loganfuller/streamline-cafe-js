// The cafe page's own text in every language Streamline has finished
// (docs/cafe/DESIGN.md, "Translations").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { SUPPORTED_LANGUAGES, parseTranslationColumn } from '../src/modules/i18n-parser.js';
import { CAFE_TRANSLATIONS, cafeTranslation, fillIn, dateLocale } from '../src/cafe/translations.js';
import { gateScreen, GATE_REASONS } from '../src/cafe/dye2-gate.js';
import { pageHeading } from '../src/cafe/page-model.js';
import { slotMenu } from '../src/cafe/slot-menu.js';
import { graphModel } from '../src/cafe/shot-model.js';
import { PHRASES } from '../src/cafe/comparison.js';

// Streamline's own list says which languages are finished: it is not copied here.
const FINISHED = SUPPORTED_LANGUAGES.filter(code => code !== 'en' && !code.includes('unfinished'));

const CSV = readFileSync(new URL('../src/ui/de1 gui translation - Sheet1.csv', import.meta.url), 'utf8');
const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const CAFE_DIR = new URL('../src/cafe/', import.meta.url);
const SOURCES = readdirSync(CAFE_DIR).filter(name => name.endsWith('.js'))
    .map(name => ({ name, text: readFileSync(new URL(name, CAFE_DIR), 'utf8') }));

// The cafe page: #main-page, up to the comment that closes it.
const MAIN_PAGE = INDEX.slice(INDEX.indexOf('<div id="main-page"'), INDEX.indexOf('<!-- #main-page -->'));

// Streamline's translation of a phrase, or '' where its file has none. Its
// parser answers the English for an empty cell, which would hide a gap, so the
// cells are read here. A phrase is found as Streamline's lookup finds it: by
// the key, then without regard to case.
const streamlineCells = (() => {
    const cells = line => {
        const out = [];
        let value = '';
        let quoted = false;
        for (let i = 0; i < line.length; i += 1) {
            const ch = line[i];
            if (ch === '"' && quoted && line[i + 1] === '"') { value += '"'; i += 1; }
            else if (ch === '"') quoted = !quoted;
            else if (ch === ',' && !quoted) { out.push(value.trim()); value = ''; }
            else value += ch;
        }
        out.push(value.trim());
        return out;
    };
    const lines = CSV.replace(/^﻿/, '').split(/\r?\n/);
    const header = cells(lines[0]);
    const exact = new Map();
    const folded = new Map();
    for (const line of lines.slice(1)) {
        const row = cells(line);
        if (!row[0]) continue;
        exact.set(row[0], row); // the last row for a key wins, as in Streamline's parser
        folded.set(row[0].toLowerCase(), row[0]);
    }
    return (key, language) => {
        const row = exact.get(key) || exact.get(folded.get(key.toLowerCase()));
        return row ? row[header.indexOf(language)] || '' : '';
    };
})();

// Every phrase the cafe page shows: the keys in its markup, the phrases its
// modules look up by name, and the ones its models hand to the page.
function usedKeys() {
    const keys = new Set();
    // The whole document: the page, and the dialog it opens.
    for (const match of INDEX.matchAll(/data-cafe-text="([^"]*)"/g)) keys.add(match[1]);
    for (const { text } of SOURCES) {
        for (const match of text.matchAll(/\bcafeText\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(match[1].replace(/\\'/g, "'"));
        // A phrase written onto an element by name, to follow the language.
        for (const match of text.matchAll(/\bsetText\([^;]*?,\s*'((?:[^'\\]|\\.)*)',\s*\{\s*translate:\s*true/g)) keys.add(match[1].replace(/\\'/g, "'"));
    }
    for (const reason of GATE_REASONS) {
        const screen = gateScreen(reason);
        keys.add(screen.line);
        if (screen.hint) keys.add(screen.hint);
    }
    const recipe = { id: 'r', title: 'Sample', beanName: 'Sample Blend' };
    for (const card of [{ slot: '1', recipe: null }, { slot: '1', recipe }]) {
        for (const item of slotMenu(card)) keys.add(item.label);
    }
    for (const heading of [pageHeading(null, ''), pageHeading(recipe, 'Profile', true), pageHeading(recipe, 'Profile', false)]) {
        keys.add(heading.dialLabel);
        if (heading.translate) { keys.add(heading.title); keys.add(heading.subtitle); }
    }
    // The legend's row label and its line of text, in every state that has one.
    const shot = { id: 'a' };
    for (const state of [
        { recipe, shot }, { recipe, shot: null }, { recipe, live: true }, { recipe: null, shot },
    ]) {
        const shown = graphModel({ view: 'reference', reference: null, ...state });
        if (shown.row) keys.add(shown.row.label);
        if (shown.line) keys.add(shown.line);
    }
    // The comparison row's titles and what each card says beside its number.
    for (const phrase of Object.values(PHRASES)) keys.add(phrase);
    return keys;
}

const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

test('Streamline has seventeen finished languages besides English', () => {
    assert.equal(FINISHED.length, 17);
    assert.ok(FINISHED.includes('de') && FINISHED.includes('ar') && FINISHED.includes('heb'));
});

test('the test reads Streamline\'s file as Streamline does', () => {
    const { table } = parseTranslationColumn(CSV, 'de');
    assert.equal(streamlineCells('Settings', 'de'), table.Settings);
    assert.equal(streamlineCells('roasted', 'de'), table.Roasted);
    assert.equal(streamlineCells('Clock', 'ar'), '', 'the gap this table fills for Clock');
});

test('every phrase the cafe page shows has every finished language', () => {
    const keys = usedKeys();
    assert.ok(keys.size >= 30, `only ${keys.size} phrases found: the scan has lost its way`);
    const missing = [];
    for (const key of keys) {
        for (const language of FINISHED) {
            const own = CAFE_TRANSLATIONS[key] && CAFE_TRANSLATIONS[key][language];
            if (!own && !streamlineCells(key, language)) missing.push(`${JSON.stringify(key)} lacks ${language}`);
        }
    }
    assert.deepEqual(missing, [], `\nAdd these to src/cafe/translations.js:\n${missing.join('\n')}\n`);
});

test('a phrase a module looks up is named in the call, so the scan sees it', () => {
    // The lookups by a variable are the card menu's, whose labels the scan
    // takes from slotMenu() itself, and the comparison row's, whose phrases it
    // takes from PHRASES.
    const byVariable = { 'strip.js': ['cafeText(item.label)'], 'compare-row.js': ['cafeText(part.phrase, vars)'] };
    for (const { name, text } of SOURCES) {
        if (name === 'text.js') continue; // where the lookup is defined
        const unnamed = [...text.matchAll(/\bcafeText\((?!\s*')[^)]*\)/g)].map(match => match[0]);
        assert.deepEqual(unnamed, byVariable[name] || [], `${name}: cafeText() takes its phrase as a quoted string`);
    }
});

test('the page\'s markup is keyed for the cafe\'s lookup, bar what Streamline re-labels', () => {
    const streamlineKeyed = [...MAIN_PAGE.matchAll(/<[^>]*\sdata-i18n-key="[^"]*"[^>]*>/g)]
        .map(match => /\sid="([^"]*)"/.exec(match[0])?.[1]);
    assert.deepEqual(streamlineKeyed.sort(), ['cupwarmer-text', 'machine-status', 'sleep-button']);
    // Text in the markup is what the key says, so the page reads right before
    // the lookup has run.
    for (const match of INDEX.matchAll(/data-cafe-text="([^"]*)"[^>]*>([^<]*)</g)) {
        assert.equal(match[2], match[1]);
    }
});

test('every entry says whether a machine translated it', () => {
    for (const [key, entry] of Object.entries(CAFE_TRANSLATIONS)) {
        assert.equal(typeof entry.machine, 'boolean', `${JSON.stringify(key)} has no machine mark`);
    }
});

test('the table holds only Streamline\'s finished languages, and no empty text', () => {
    for (const [key, entry] of Object.entries(CAFE_TRANSLATIONS)) {
        for (const [language, text] of Object.entries(entry)) {
            if (language === 'machine') continue;
            assert.ok(FINISHED.includes(language), `${JSON.stringify(key)}: ${language} is not a finished language of Streamline's`);
            assert.ok(typeof text === 'string' && text.trim() === text && text !== '', `${JSON.stringify(key)}: ${language} is empty or padded`);
        }
    }
});

test('a translation keeps the places its phrase has', () => {
    for (const [key, entry] of Object.entries(CAFE_TRANSLATIONS)) {
        for (const [language, text] of Object.entries(entry)) {
            if (language === 'machine') continue;
            assert.deepEqual(placeholders(text), placeholders(key), `${JSON.stringify(key)} in ${language}`);
        }
    }
});

test('the table holds nothing the page does not show', () => {
    const keys = usedKeys();
    assert.deepEqual(Object.keys(CAFE_TRANSLATIONS).filter(key => !keys.has(key)), []);
});

test('the table holds only what Streamline\'s file lacks', () => {
    const doubled = [];
    for (const [key, entry] of Object.entries(CAFE_TRANSLATIONS)) {
        for (const language of Object.keys(entry)) {
            if (language !== 'machine' && streamlineCells(key, language)) doubled.push(`${JSON.stringify(key)} in ${language}`);
        }
    }
    assert.deepEqual(doubled, [], 'Streamline translates these already');
});

test('a lookup tries the table, then Streamline, then English', () => {
    const streamline = key => ({ Dose: 'Dosis' })[key] || key;
    assert.equal(cafeTranslation('Hold to add', 'de', streamline), CAFE_TRANSLATIONS['Hold to add'].de);
    assert.equal(cafeTranslation('Dose', 'de', streamline), 'Dosis');
    assert.equal(cafeTranslation('Something new', 'de', streamline), 'Something new');
    assert.equal(cafeTranslation('Hold to add', 'en', streamline), 'Hold to add');
    // Clock is here only for the languages Streamline has not filled in.
    assert.equal(cafeTranslation('Clock', 'he', key => key), CAFE_TRANSLATIONS.Clock.he);
    assert.equal(cafeTranslation('Clock', 'de', () => 'Uhr'), 'Uhr');
});

test('a language Streamline has not finished falls back to English', () => {
    assert.equal(cafeTranslation('Hold to add', 'jp-unfinished', key => key), 'Hold to add');
    assert.equal(cafeTranslation('Slot {n}', 'ru-unfinished', key => key, { n: 4 }), 'Slot 4');
});

test('a phrase named like something every object has is not mistaken for an entry', () => {
    assert.equal(cafeTranslation('constructor', 'de', key => key), 'constructor');
    assert.equal(cafeTranslation('toString', 'de', key => key), 'toString');
});

test('places are filled in whichever language answers', () => {
    assert.equal(cafeTranslation('Slot {n}', 'de', key => key, { n: 7 }), 'Platz 7');
    assert.equal(cafeTranslation('Could not load {name}', 'de', key => key, { name: 'House' }), 'House konnte nicht geladen werden');
    assert.equal(fillIn('{a} and {b}', { a: 1 }), '1 and {b}');
    assert.equal(fillIn('plain', undefined), 'plain');
    // A name is put in as it is, whatever it holds.
    assert.equal(fillIn('Could not load {name}', { name: '$& {n}' }), 'Could not load $& {n}');
});

test('dates are formatted in the page\'s language', () => {
    assert.equal(dateLocale('de'), 'de');
    assert.equal(dateLocale('de-ch'), 'de-CH');
    assert.equal(dateLocale('kr'), 'ko');
    assert.equal(dateLocale('no'), 'nb');
    assert.equal(dateLocale('heb'), 'he');
    assert.equal(dateLocale('jp-unfinished'), 'en');
    assert.equal(dateLocale(undefined), 'en');
    for (const code of ['en', ...FINISHED]) {
        assert.doesNotThrow(() => new Date(0).toLocaleDateString(dateLocale(code), { month: 'short' }), code);
    }
});
