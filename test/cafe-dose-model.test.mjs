// What the line under Dose names (docs/cafe/DESIGN.md, "What the screen
// shows"). All sample data is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { doseNames, doseLine } from '../src/cafe/dose-model.js';

// The phrase with its places filled in, as cafeText answers in English.
const t = (phrase, vars = {}) => phrase.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole));
const TODAY = '2026-11-18';

const workflow = { context: { coffeeName: ' Sample Blend ', beanBatchId: 'batch-1' } };
const batch = (fields = {}) => ({ id: 'batch-1', ...fields });
const coded = { extras: { decentSyncBatchCode: 'SB-0211' } };
const roasted = day => ({ roastDate: `${day}T00:00:00Z` });
const line = (record, today = TODAY) => doseLine(doseNames(workflow, record, today), t);
const said = (record, today) => line(record, today).map(part => part.text).join('');

test('Dose names the Batch Code, the bean and the days since the roast, with " · " between them', () => {
    assert.equal(said(batch({ ...coded, ...roasted('2026-11-02') })), 'SB-0211 · Sample Blend · 16 d since roast');
});

test('a part the batch lacks is left out, with no placeholder', () => {
    assert.equal(said(batch(roasted('2026-11-02'))), 'Sample Blend · 16 d since roast', 'no Batch Code');
    assert.equal(said(batch({ extras: { decentSyncBatchCode: '  ' }, ...roasted('2026-11-02') })), 'Sample Blend · 16 d since roast', 'a blank code');
    assert.equal(said(batch(coded)), 'SB-0211 · Sample Blend', 'no roast date');
    assert.equal(said(batch()), 'Sample Blend', 'neither');
});

test('a batch roasted today is 0 d since roast, and one roasted yesterday 1 d', () => {
    assert.equal(said(batch({ ...coded, ...roasted(TODAY) })), 'SB-0211 · Sample Blend · 0 d since roast');
    assert.equal(said(batch({ ...coded, ...roasted('2026-11-17') })), 'SB-0211 · Sample Blend · 1 d since roast');
    assert.equal(said(batch({ ...coded, ...roasted('2026-11-16') })), 'SB-0211 · Sample Blend · 2 d since roast');
});

test('the days are counted to the calendar day handed in', () => {
    assert.equal(said(batch(roasted('2026-11-02')), '2026-11-19'), 'Sample Blend · 17 d since roast');
});

test('the code and the days come only from the record of the batch the Workflow names', () => {
    const other = { id: 'batch-2', ...coded, ...roasted('2026-11-02') };
    assert.deepEqual(doseNames(workflow, other, TODAY), { code: '', bean: 'Sample Blend', days: null });
    assert.deepEqual(doseNames({ context: { coffeeName: 'Sample Blend' } }, other, TODAY), { code: '', bean: 'Sample Blend', days: null });
    assert.deepEqual(doseNames(workflow, null, TODAY), { code: '', bean: 'Sample Blend', days: null });
});

test('a Workflow that names nothing gives an empty line', () => {
    assert.deepEqual(doseNames(null, null, TODAY), { code: '', bean: '', days: null });
    assert.deepEqual(doseNames({ context: { coffeeName: 42 } }, null, TODAY), { code: '', bean: '', days: null });
    assert.deepEqual(doseLine({ code: '', bean: '', days: null }, t), []);
});

test('only the bean\'s name shrinks, and each " · " goes with the code or the days, never with the name', () => {
    assert.deepEqual(line(batch({ ...coded, ...roasted('2026-11-02') })), [
        { text: 'SB-0211 · ', shrinks: false },
        { text: 'Sample Blend', shrinks: true },
        { text: ' · 16 d since roast', shrinks: false },
    ]);
    assert.deepEqual(doseLine({ code: 'SB-0211', bean: '', days: 16 }, t), [
        { text: 'SB-0211 · ', shrinks: false },
        { text: '16 d since roast', shrinks: false },
    ], 'with no name, one " · " between the code and the days');
    assert.deepEqual(doseLine({ code: '', bean: 'Sample Blend', days: null }, t), [{ text: 'Sample Blend', shrinks: true }]);
});

test('the days are said with one phrase, translated, whatever their number', () => {
    const asked = [];
    const spy = (phrase, vars) => { asked.push([phrase, vars]); return t(phrase, vars); };
    for (const days of [0, 1, 16]) doseLine({ code: '', bean: 'Sample Blend', days }, spy);
    assert.deepEqual(asked, [0, 1, 16].map(days => ['{days} d since roast', { days }]));
});
