// The basket dialog's rows and what a choice writes (docs/cafe/DESIGN.md,
// "The grinder, bean and basket dialogs"). All sample data is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { listedBaskets, basketName, basketRows, basketPick } from '../src/cafe/basket-model.js';
import { assertDeclaredFields } from '../src/modules/workflow-fields.js';

const t = (phrase, vars = {}) => phrase.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole));

// DYE2's store key `baskets`, as v0.1.41 writes it.
const eighteen = { id: 'bskt-18', name: 'Sample 18 g', size: 'double', diameterMm: 58, createdAt: '2026-11-01T00:00:00Z', archived: false };
const twenty = { id: 'bskt-20', name: 'Sample 20 g', size: 'double', diameterMm: 58, createdAt: '2026-11-02T00:00:00Z' };
const naked = { id: 'bskt-naked', name: 'Sample Naked', size: 'bottomless', diameterMm: '58.5' };
const old = { id: 'bskt-old', name: 'Sample Retired', size: 'single', diameterMm: 58, archived: true };

test('the list is DYE2\'s baskets not archived', () => {
    assert.deepEqual(listedBaskets([eighteen, old, twenty]), [eighteen, twenty]);
    assert.deepEqual(listedBaskets([]), [], 'no baskets is an empty list');
    assert.equal(listedBaskets(null), null, 'a read that failed is a list that can\'t be read');
    assert.deepEqual(listedBaskets([null, { name: 'no id' }, twenty]), [twenty], 'a row with no id is not a basket to choose');
});

test('DYE2 v0.1.40\'s baskets have no `archived`, so every one is listed', () => {
    const before = [{ id: 'a', name: 'Sample A', size: 'single' }, { id: 'b', name: 'Sample B', size: 'triple' }];
    assert.deepEqual(listedBaskets(before), before);
});

test('a row is the basket\'s name over its size and diameter, sorted by name, the one in use marked', () => {
    const rows = basketRows(listedBaskets([twenty, naked, eighteen, old]), { extras: { basketId: 'bskt-20' } }, t);
    assert.deepEqual(rows.map(({ id, name, detail, inUse }) => ({ id, name, detail, inUse })), [
        { id: 'bskt-18', name: 'Sample 18 g', detail: 'Double · 58 mm', inUse: false },
        { id: 'bskt-20', name: 'Sample 20 g', detail: 'Double · 58 mm', inUse: true },
        { id: 'bskt-naked', name: 'Sample Naked', detail: 'Bottomless · 58.5 mm', inUse: false },
    ]);
});

test('a row says what it has: a size DYE2 does not offer as written, no size, no diameter, no name', () => {
    const [row] = basketRows([{ id: 'x', size: 'competition', diameterMm: 0 }], {}, t);
    assert.deepEqual([row.name, row.detail], ['Unnamed', 'competition']);
    assert.equal(basketRows([{ id: 'y', name: 'Sample', diameterMm: 54 }], {}, t)[0].detail, '54 mm');
    assert.equal(basketRows([{ id: 'z', name: 'Sample', size: 'other' }], {}, t)[0].detail, 'Other size');
});

test('an archived basket in use is not listed, and no row is marked', () => {
    const rows = basketRows(listedBaskets([eighteen, old]), { extras: { basketId: 'bskt-old' } }, t);
    assert.deepEqual(rows.map(row => row.id), ['bskt-18']);
    assert.equal(rows.some(row => row.inUse), false);
});

test('a basket writes its id and its name, in one write under cafe.basket', () => {
    const patch = basketPick(eighteen, { extras: { basketId: 'bskt-20' } });
    assert.deepEqual(patch, { context: { extras: { basketId: 'bskt-18', basketName: 'Sample 18 g' } } });
    assert.equal(assertDeclaredFields('cafe.basket', patch), true);
    assert.deepEqual(basketPick({ id: 'n', name: '  ' }, {}).context.extras, { basketId: 'n', basketName: 'Unnamed' },
        'a basket with no name is written as DYE2 writes it');
    assert.equal(basketName({}), 'Unnamed');
});

test('a tap on the basket in use writes nothing', () => {
    assert.equal(basketPick(eighteen, { extras: { basketId: 'bskt-18' } }), null);
    assert.equal(basketPick(null, {}), null);
});
