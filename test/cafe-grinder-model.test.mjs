// The grinder dialog's rows and what a choice writes (docs/cafe/DESIGN.md,
// "What the screen shows"). All sample data is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    GRINDER_WINDOW, GRINDER_PHRASES, listedGrinders, grinderName, lastUse, pickedSetting, pickedRpm,
    grinderPick, shownSetting, grinderRows,
} from '../src/cafe/grinder-model.js';
import { assertDeclaredFields } from '../src/modules/workflow-fields.js';

// The phrase with its places filled in, as cafeText answers in English.
const t = (phrase, vars = {}) => phrase.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole));

// A row of Decaid's Shots list for a grinder, newest first, as `GET /shots?grinderId=` answers.
const shotOn = (grinderId, grinderSetting, rpm) => ({
    id: `${grinderId}-${grinderSetting}`,
    workflow: { context: { grinderId, grinderSetting, ...(rpm === undefined ? {} : { extras: { rpm } }) } },
});

const flat = { id: 'g-flat', model: 'Sample Flat 64', burrType: 'flat', extras: { settingDefault: 12, settingMin: 0, settingMax: 40, rpmDefault: 900 } };
const conical = { id: 'g-conical', model: 'Sample Conical 38', burrs: 'Sample Burr Set', burrType: 'conical' };

test('five of a grinder\'s latest Shots are read', () => {
    assert.equal(GRINDER_WINDOW, 5);
});

test('the list is the grinders not archived, from either shape Decaid answers', () => {
    const archived = { id: 'g-old', model: 'Sample Retired', archived: true };
    assert.deepEqual(listedGrinders([flat, archived, conical]), [flat, conical]);
    assert.deepEqual(listedGrinders({ items: [archived, conical] }), [conical]);
    assert.deepEqual(listedGrinders([]), [], 'an empty list is a list');
    assert.equal(listedGrinders(null), null, 'an answer that is no list is a list that can\'t be read');
    assert.equal(listedGrinders({ error: 'x' }), null);
    assert.deepEqual(listedGrinders([null, { model: 'no id' }, flat]), [flat], 'a row with no id is not a grinder to choose');
});

test('a grinder with Shots takes the setting and RPM of the newest that holds a setting', () => {
    const shots = [shotOn('g-flat', null, 700), shotOn('g-flat', '  ', 750), shotOn('g-flat', '14.50', 1100), shotOn('g-flat', '10', 800)];
    const use = lastUse(shots, 'g-flat');
    assert.deepEqual(use, { setting: '14.50', rpm: 1100 });
    assert.deepEqual(grinderPick(flat, use, { grinderId: 'g-conical' }), {
        context: { grinderId: 'g-flat', grinderModel: 'Sample Flat 64', grinderSetting: '14.50', extras: { rpm: 1100 } },
    });
});

test('that Shot with no RPM leaves the RPM to the grinder\'s own default, else none', () => {
    const use = lastUse([shotOn('g-flat', '9')], 'g-flat');
    assert.deepEqual(use, { setting: '9', rpm: null });
    assert.equal(pickedRpm(flat, use), 900);
    assert.equal(pickedRpm(conical, lastUse([shotOn('g-conical', '3')], 'g-conical')), null);
    assert.equal(grinderPick(conical, lastUse([shotOn('g-conical', '3')], 'g-conical'), {}).context.extras.rpm, null,
        'an RPM it can\'t give is cleared, not inherited from the grinder before');
});

test('a Shot of another grinder is not counted, though Decaid listed it', () => {
    assert.deepEqual(lastUse([shotOn('g-conical', '3'), shotOn('g-flat', '11')], 'g-flat'), { setting: '11', rpm: null });
    assert.equal(lastUse([shotOn('g-conical', '3')], 'g-flat'), null);
    assert.deepEqual(lastUse([{ id: 1, workflow: { context: { grinderId: 42, grinderSetting: '2' } } }], '42'), { setting: '2', rpm: null }, 'an id is an id, number or text');
});

test('a grinder whose latest Shots hold no setting takes its own default, held to its range', () => {
    const use = lastUse([shotOn('g-flat', null), shotOn('g-flat', '')], 'g-flat');
    assert.equal(use, null);
    assert.equal(pickedSetting(flat, use), '12');
    assert.equal(pickedSetting({ extras: { settingDefault: 55, settingMax: 40 } }, null), '40');
    assert.equal(pickedSetting({ extras: { settingDefault: -3, settingMin: 0 } }, null), '0');
    assert.equal(pickedSetting({ extras: { settingDefault: '7.5' } }, null), '7.5', 'a default kept as text is read as a number');
    assert.equal(pickedRpm({ extras: { rpmDefault: 2000, rpmMax: 1600 } }, null), 1600);
});

test('a grinder never used, with a default, takes that default', () => {
    assert.deepEqual(grinderPick(flat, null, { grinderId: 'g-conical', grinderSetting: '3' }), {
        context: { grinderId: 'g-flat', grinderModel: 'Sample Flat 64', grinderSetting: '12', extras: { rpm: 900 } },
    });
});

test('a grinder never used, with no default, leaves the number as it is', () => {
    const patch = grinderPick(conical, null, { grinderId: 'g-flat', grinderSetting: '12' });
    assert.deepEqual(patch, { context: { grinderId: 'g-conical', grinderModel: 'Sample Conical 38', extras: { rpm: null } } });
    assert.ok(!('grinderSetting' in patch.context), 'left out, so the Workflow keeps its number');
    assert.equal(pickedSetting({ extras: { settingDefault: 'fine' } }, null), null, 'a default that is no number is none');
});

test('a setting that is not a number is shown and written as the Shot holds it', () => {
    const use = lastUse([shotOn('g-preset', ' 15 clicks ')], 'g-preset');
    assert.deepEqual(use, { setting: '15 clicks', rpm: null });
    const preset = { id: 'g-preset', model: 'Sample Preset', settingType: 'preset' };
    assert.equal(grinderPick(preset, use, {}).context.grinderSetting, '15 clicks');
    const [row] = grinderRows([preset], {}, new Map([['g-preset', use]]), t);
    assert.equal(row.detail, 'last used at 15 clicks');
    assert.equal(shownSetting('Medium-Fine'), 'Medium-Fine');
});

test('a number is shown without the zeros a tile writes', () => {
    assert.equal(shownSetting('14.50'), '14.5');
    assert.equal(shownSetting('2.00'), '2');
    assert.equal(shownSetting('0.25'), '0.25');
    assert.equal(shownSetting(12), '12');
    assert.equal(lastUse([shotOn('g-flat', 12)], 'g-flat').setting, '12', 'a setting kept as a number is read as text');
});

test('the grinder in use writes nothing', () => {
    assert.equal(grinderPick(flat, lastUse([shotOn('g-flat', '9')], 'g-flat'), { grinderId: 'g-flat' }), null);
    assert.equal(grinderPick(null, null, {}), null);
});

test('one write, of the fields the cafe\'s writer declares', () => {
    for (const patch of [grinderPick(flat, null, {}), grinderPick(conical, null, {}), grinderPick(flat, { setting: '1', rpm: 600 }, {})]) {
        assert.equal(assertDeclaredFields('cafe.grinder', patch), true);
        assert.deepEqual(Object.keys(patch), ['context']);
    }
});

test('a grinder with no model is named by its name, and failing that as Unnamed', () => {
    assert.equal(grinderName({ model: '  Sample Model ', name: 'n' }), 'Sample Model');
    assert.equal(grinderName({ model: '', name: 'Sample Name' }), 'Sample Name');
    assert.equal(grinderName({}), null);
    assert.equal(grinderPick({ id: 'g-x', name: 'Sample Name' }, null, {}).context.grinderModel, 'Sample Name');
    assert.equal(grinderPick({ id: 'g-x' }, null, {}).context.grinderModel, 'Unnamed', 'as DYE2\'s own picker writes it');
    const [row] = grinderRows([{ id: 'g-x' }], {}, new Map(), t);
    assert.equal(row.name, GRINDER_PHRASES.unnamed);
});

test('a row is the grinder\'s name over its burrs and where it was last used, sorted by name', () => {
    const uses = new Map([['g-flat', { setting: '14.50', rpm: 1100 }]]);
    const rows = grinderRows([flat, conical, { id: 'g-bare', model: 'Sample Bare' }], { grinderId: 'g-conical' }, uses, t);
    assert.deepEqual(rows.map(({ id, name, detail, inUse }) => ({ id, name, detail, inUse })), [
        { id: 'g-bare', name: 'Sample Bare', detail: '', inUse: false },
        { id: 'g-conical', name: 'Sample Conical 38', detail: 'Sample Burr Set', inUse: true },
        { id: 'g-flat', name: 'Sample Flat 64', detail: 'Flat burrs · last used at 14.5', inUse: false },
    ]);
    assert.equal(rows[2].grinder, flat);
    assert.deepEqual(rows[2].use, { setting: '14.50', rpm: 1100 }, 'a row carries what a choice of it writes from');
    assert.equal(grinderRows([{ id: 'g', model: 'M', burrType: 'Conical' }], {}, new Map(), t)[0].detail, 'Conical burrs');
    assert.equal(grinderRows([{ id: 'g', model: 'M', burrType: 'blade' }], {}, new Map(), t)[0].detail, 'blade', 'a type DYE2 does not offer is shown as it is');
});

test('a grinder in use that is archived is still not listed, and no row is marked', () => {
    const archived = { id: 'g-old', model: 'Sample Retired', archived: true };
    const rows = grinderRows(listedGrinders([flat, archived, conical]), { grinderId: 'g-old', grinderModel: 'Sample Retired' }, new Map(), t);
    assert.deepEqual(rows.map(row => row.id), ['g-conical', 'g-flat']);
    assert.ok(rows.every(row => !row.inUse));
});
