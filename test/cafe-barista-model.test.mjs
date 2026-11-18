// The barista at the machine: the dialog's rows, what a typed name becomes, and
// what a pick and the machine sleeping write (docs/cafe/DESIGN.md, "The
// barista"). All sample data is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BARISTA_PHRASES, foldBarista, baristaName, baristaRows, typedBarista, baristaPick, sleepClear, asleep, storeWait, SHOT_STORE_MS, baristaStamps } from '../src/cafe/barista-model.js';
import { WORKFLOW_WRITERS, assertDeclaredFields } from '../src/modules/workflow-fields.js';

const t = (phrase, vars = {}) => phrase.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole));
const when = date => (date ? `at ${date.toISOString().slice(11, 16)}` : '');
const at = time => new Date(`2026-11-17T${time}:00Z`);

// The seam's first page, newest first, as either source lists a Shot.
const shots = [
    { id: 's6', barista: 'Ana', when: at('10:41') },
    { id: 's5', barista: '', when: at('10:38') },
    { id: 's4', barista: ' bo ', when: at('10:35') },
    { id: 's3', barista: 'ANA', when: at('10:33') },
    { id: 's2', barista: 'Bo', when: at('10:29') },
    { id: 's1', barista: 'Cy', when: null },
];

const shape = rows => rows.map(({ id, name, detail, inUse, barista }) => ({ id, name, detail, inUse, barista }));

test('each name on the Shots once, most recent first, under its most recent spelling, then "No barista"', () => {
    assert.deepEqual(shape(baristaRows(shots, 'Bo', t, when)), [
        { id: 'name:ana', name: 'Ana', detail: 'Last shot at 10:41', inUse: false, barista: 'Ana' },
        { id: 'name:bo', name: 'bo', detail: 'Last shot at 10:35', inUse: true, barista: 'bo' },
        { id: 'name:cy', name: 'Cy', detail: '', inUse: false, barista: 'Cy' },
        { id: 'none', name: 'No barista', detail: 'Shots record no name', inUse: false, barista: null },
    ]);
});

test('names differing in case or in the spaces around them are one barista', () => {
    assert.equal(foldBarista('  Ana '), foldBarista('ana'));
    assert.notEqual(foldBarista('Ana Lee'), foldBarista('AnaLee'), 'the spaces inside a name are kept');
    const rows = baristaRows([{ barista: 'ana ', when: at('09:00') }, { barista: 'Ana', when: at('08:00') }], ' ANA', t, when);
    assert.deepEqual(rows.map(row => [row.name, row.inUse]), [['ana', true], ['No barista', false]],
        'the name in use is marked on its listed spelling, not listed a second time');
});

test('a Shot with no name adds no row', () => {
    const rows = baristaRows([{ barista: '' }, { barista: '   ' }, { barista: null }, {}], 'Ana', t, when);
    assert.deepEqual(rows.map(row => row.id), ['name:ana', 'none']);
});

test('a name in use that no Shot carries is listed first, marked, with no second line', () => {
    const rows = baristaRows(shots, ' Dee ', t, when);
    assert.deepEqual(shape(rows)[0], { id: 'name:dee', name: 'Dee', detail: '', inUse: true, barista: 'Dee' });
    assert.equal(rows.filter(row => row.inUse).length, 1);
});

test('with no barista "No barista" is the row in use', () => {
    for (const current of ['', '   ', null, undefined]) {
        const rows = baristaRows(shots, current, t, when);
        assert.deepEqual(rows.filter(row => row.inUse).map(row => row.id), ['none'], JSON.stringify(current));
    }
});

test('an empty list, as one that could not be read, still has the name in use and "No barista"', () => {
    assert.deepEqual(baristaRows([], 'Ana', t, when).map(row => [row.name, row.inUse]), [['Ana', true], ['No barista', false]]);
    assert.deepEqual(baristaRows(null, '', t, when).map(row => [row.name, row.inUse]), [['No barista', true]]);
});

test('a typed name is trimmed, and one listed but for its case is the listed name', () => {
    const rows = baristaRows(shots, 'Dee', t, when);
    assert.equal(typedBarista('', rows), null, 'an empty name does nothing');
    assert.equal(typedBarista('    ', rows), null, 'nor one of spaces');
    assert.equal(typedBarista('  Eve  ', rows), 'Eve', 'a new name, padded');
    assert.equal(typedBarista('ANA', rows), 'Ana', 'a listed name in another case');
    assert.equal(typedBarista(' dee', rows), 'Dee', 'the name in use, which is listed too');
    assert.equal(typedBarista('No barista', rows), 'No barista', 'the words of the "No barista" row are a name like any other');
});

test('a pick writes the barista name alone, in one write under cafe.barista', () => {
    assert.deepEqual(WORKFLOW_WRITERS['cafe.barista'], ['context.baristaName'], 'a writer declared for that field alone');
    const named = baristaPick('Ana', 'Bo');
    assert.deepEqual(named, { context: { baristaName: 'Ana' } });
    assert.equal(assertDeclaredFields('cafe.barista', named), true);
    assert.deepEqual(baristaPick('  Eve ', ''), { context: { baristaName: 'Eve' } }, 'a typed name, trimmed');
});

test('"No barista" clears the name with an explicit null, which the Workflow\'s merge needs', () => {
    const cleared = baristaPick(null, 'Ana');
    assert.deepEqual(cleared, { context: { baristaName: null } });
    assert.equal(assertDeclaredFields('cafe.barista', cleared), true);
});

test('a tap on the row in use writes nothing', () => {
    assert.equal(baristaPick('Ana', 'Ana'), null);
    assert.equal(baristaPick('ana', ' Ana '), null, 'the same barista in another spelling');
    assert.equal(baristaPick(null, ''), null, '"No barista" with none');
    assert.equal(baristaPick(null, '  '), null, 'a name of spaces is none');
    assert.equal(baristaPick(null, null), null);
});

test('a typed name is written unless it is spelled as the name in use', () => {
    // "aNa" typed resolves to the listed "Ana" (typedBarista); with "ANA" in
    // the Workflow, that listing's spelling is written.
    assert.deepEqual(baristaPick('Ana', 'ANA', { typed: true }), { context: { baristaName: 'Ana' } });
    assert.equal(baristaPick(' Ana ', 'Ana', { typed: true }), null, 'the name in use, typed again');
    assert.equal(baristaPick('Ana', 'ANA'), null, 'a tap on the row in use, in another spelling, still writes nothing');
});

test('the machine asleep clears a set name, and writes nothing when none is set', () => {
    assert.deepEqual(sleepClear({ baristaName: 'Ana' }), { context: { baristaName: null } });
    assert.equal(assertDeclaredFields('cafe.barista', sleepClear({ baristaName: 'Ana' })), true);
    for (const context of [{}, { baristaName: null }, { baristaName: '' }, { baristaName: '   ' }, null, undefined]) {
        assert.equal(sleepClear(context), null, JSON.stringify(context));
    }
});

test('a read of the machine\'s state says whether it is asleep', () => {
    // Decaid answers a machine snapshot: its `state` is { state, substate }.
    assert.equal(asleep({ state: { state: 'sleeping', substate: 'idle' } }), true);
    assert.equal(asleep({ state: { state: 'idle', substate: 'idle' } }), false);
    assert.equal(asleep({ state: 'sleeping' }), true, 'a bare state, as a socket frame may carry');
    for (const nothing of [null, undefined, {}, { state: null }]) assert.equal(asleep(nothing), false);
});

test('the button names the Workflow\'s barista, trimmed, or none', () => {
    assert.equal(baristaName({ baristaName: '  Ana ' }), 'Ana');
    assert.equal(baristaName({ baristaName: null }), '');
    assert.equal(baristaName({ baristaName: 42 }), '');
    assert.equal(baristaName(undefined), '');
});

test('what the dialog says is a phrase of its own', () => {
    // The rows' words go through `t`, so the page's language reaches them.
    const shout = phrase => phrase.toUpperCase();
    const rows = baristaRows([{ barista: 'Ana', when: at('10:00') }], '', shout, when);
    assert.equal(rows[0].detail, 'LAST SHOT at 10:00');
    assert.deepEqual([rows[1].name, rows[1].detail], ['NO BARISTA', 'SHOTS RECORD NO NAME']);
    assert.equal(BARISTA_PHRASES.subtitle, 'Named on this machine\'s shots · cleared when the machine wakes',
        'the same with Decent Sync and without: nothing here is saved to a recipe');
});

test('a barista write waits out the seconds in which Decaid may still store the Shot just pulled', () => {
    assert.equal(SHOT_STORE_MS, 5000, 'Decaid\'s 4 s stopping backstop, and a second');
    assert.equal(storeWait(null, 1_000), 0, 'no shot yet this session');
    assert.equal(storeWait(10_000, 10_000), 5000, 'at the shot\'s end');
    assert.equal(storeWait(10_000, 13_500), 1500);
    assert.equal(storeWait(10_000, 15_000), 0);
    assert.equal(storeWait(10_000, 60_000), 0, 'long after');
    assert.equal(storeWait(Number.NaN, 1_000), 0);
});

test('the button shows the newest read of the barista, and a read begun before a write or a later read paints nothing', () => {
    const painted = [];
    const { see, look } = baristaStamps(name => painted.push(name));

    // A read alone paints what it found.
    look()('Ana');
    assert.deepEqual(painted, ['Ana']);

    // A read begun before a write, ending after it: stale.
    let read = look();
    see('Bo');
    read('Ana');
    assert.deepEqual(painted, ['Ana', 'Bo']);

    // Two reads overlapping, the later one ending first: the earlier is stale.
    const early = look();
    const late = look();
    late('Cy');
    early('Bo');
    assert.deepEqual(painted, ['Ana', 'Bo', 'Cy']);

    // Two reads overlapping, ending in the order they began: both paint, the
    // later last.
    const first = look();
    const second = look();
    first('Cy');
    second('Dee');
    assert.deepEqual(painted, ['Ana', 'Bo', 'Cy', 'Cy', 'Dee']);

    // A write while a read is out, and a read begun after the write ending
    // first: the read begun before the write is stale still.
    const before = look();
    see('Fay');
    const after = look();
    after('Fay');
    before('Dee');
    assert.deepEqual(painted.slice(-2), ['Fay', 'Fay']);

    // A read begun after a write paints.
    see('');
    read = look();
    read('Eve');
    assert.deepEqual(painted.slice(-2), ['', 'Eve']);
});
