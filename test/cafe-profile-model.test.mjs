// The profile dialog's rows, its description, the profile in use and the line
// under its title (docs/cafe/DESIGN.md, "The profile dialog"). All sample data
// is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PROFILE_PHRASES, listedProfiles, wholeProfiles, brewTemp, profileInUse, profileView, profileSubtitle } from '../src/cafe/profile-model.js';

const t = (phrase, vars = {}) => phrase.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole));

const step = (name, temperature, extra = {}) => ({ name, temperature, sensor: 'coffee', pump: 'pressure', pressure: 9, seconds: 20, exit: null, ...extra });

// Decaid's profile records, as `GET /profiles?includeHidden=true` answers them.
const record = (id, profile, visibility = 'visible') => ({ id, profile, visibility, isDefault: false });
const bloom = record('p-bloom', {
    title: 'Sample Bloom', author: 'Sample Author', notes: 'Line one.\r\nLine two, <b>not markup</b>.\n',
    beverage_type: 'espresso', tank_temperature: 0, steps: [step('bloom', 92), step('pour', 90)],
});
const lever = record('p-lever', {
    title: 'Sample Lever', author: 'Another Author', notes: '', beverage_type: 'espresso', tank_temperature: 0,
    steps: [step('rise', 88.6), step('decline', 86)],
});
const tea = record('p-tea', {
    title: 'sample Tea', notes: 'For tea.', beverage_type: 'tea_portafilter', tank_temperature: 0, steps: [step('steep', 85)],
});
const hidden = record('p-hidden', {
    title: 'Sample Hidden', author: 'Sample Author', notes: 'Hidden notes.', beverage_type: 'espresso', tank_temperature: 0,
    steps: [step('only', 94)],
}, 'hidden');
const deleted = record('p-deleted', { title: 'Sample Deleted', steps: [step('only', 93)] }, 'deleted');
const empty = record('p-empty', { title: 'Sample Empty', steps: [] });

const ALL = [lever, hidden, bloom, deleted, tea, empty];

// The Workflow's copy of a profile: as Decaid holds it, with the yield as its stop weight.
const inWorkflow = (profile, extra = {}) => ({ ...profile, target_weight: 36, ...extra });
// The Brew stepper shifts every step's temperature.
const stepped = (profile, by) => ({ ...profile, steps: profile.steps.map(s => ({ ...s, temperature: s.temperature + by })) });

const view = (options = {}) => profileView({ records: listedProfiles(ALL), t, ...options });
const summary = rows => rows.map(({ id, name, detail, inUse, highlighted }) => ({ id, name, detail, inUse, highlighted }));

test('the list is the profiles Decaid shows, each with steps, of any beverage type', () => {
    assert.deepEqual(listedProfiles(ALL).map(r => r.id), ['p-lever', 'p-bloom', 'p-tea']);
    assert.equal(listedProfiles(null), null, 'a read that failed is a list that can\'t be read');
    assert.equal(listedProfiles({}), null);
    assert.deepEqual(listedProfiles([]), [], 'no profiles is an empty list');
    assert.deepEqual(listedProfiles([null, { profile: bloom.profile }, { id: 'x' }]), [], 'a record with no id or no profile is not listed');
    const older = { id: 'p-old', profile: bloom.profile };
    assert.deepEqual(listedProfiles([older]), [older], 'a record with no visibility is shown');
});

test('a hidden profile is not listed, nor a deleted one, nor Streamline\'s drafts, which Decaid never holds', () => {
    const ids = listedProfiles(ALL).map(r => r.id);
    assert.equal(ids.includes('p-hidden'), false);
    assert.equal(ids.includes('p-deleted'), false);
    assert.equal(ids.includes('p-empty'), false, 'a profile with no steps can\'t be chosen');
});

test('rows are sorted by title: each title over "By" and its author, then its own brew temperature', () => {
    const { rows } = view({ workflowProfile: inWorkflow(bloom.profile) });
    assert.deepEqual(summary(rows), [
        { id: 'p-bloom', name: 'Sample Bloom', detail: 'By Sample Author · 92°c', inUse: true, highlighted: true },
        { id: 'p-lever', name: 'Sample Lever', detail: 'By Another Author · 89°c', inUse: false, highlighted: false },
        { id: 'p-tea', name: 'sample Tea', detail: '85°c', inUse: false, highlighted: false },
    ]);
});

test('a profile with no author says only its temperature, and its description "Brews at"', () => {
    const { rows, pane } = view({ workflowProfile: inWorkflow(bloom.profile) });
    const row = rows.find(r => r.id === 'p-tea');
    assert.equal(row.detail, '85°c');
    assert.equal(pane(row).byline, 'Brews at 85°c');
});

test('the description: title, "By" and the author with "brews at" and the temperature, and the notes as plain text', () => {
    const { opening } = view({ workflowProfile: inWorkflow(bloom.profile) });
    assert.deepEqual(opening, {
        title: 'Sample Bloom',
        byline: 'By Sample Author · brews at 92°c',
        text: 'Line one.\nLine two, <b>not markup</b>.',
        placeholder: false,
        inUse: true,
        use: null,
    });
});

test('a profile with no notes reads "This profile has no description."', () => {
    const { rows, pane } = view({ workflowProfile: inWorkflow(bloom.profile) });
    const shown = pane(rows.find(r => r.id === 'p-lever'));
    assert.equal(shown.text, 'This profile has no description.');
    assert.equal(shown.placeholder, true);
    const blank = profileView({ records: [record('p-blank', { title: 'Sample Blank', notes: '  \n ', steps: [step('a', 90)] })], t });
    assert.equal(blank.pane(blank.rows[0]).text, 'This profile has no description.');
});

test('"Use this profile" is offered for every profile but the one in use, with "Sets Brew to" its temperature', () => {
    const { rows, pane } = view({ workflowProfile: inWorkflow(bloom.profile) });
    assert.deepEqual(pane(rows.find(r => r.id === 'p-lever')).use, { label: 'Use this profile', note: 'Sets Brew to 89°c' });
    assert.equal(pane(rows.find(r => r.id === 'p-bloom')).use, null, 'the profile in use reads "In use"');
    assert.equal(pane(rows.find(r => r.id === 'p-bloom')).inUse, true);
});

test('the profile in use at a stepped temperature is still the one in use, as DYE2 compares', () => {
    const live = inWorkflow(stepped(lever.profile, 2));
    assert.equal(profileInUse(listedProfiles(ALL), live), lever);
    const { rows, opening } = view({ workflowProfile: live });
    assert.deepEqual(rows.filter(r => r.inUse).map(r => r.id), ['p-lever']);
    assert.equal(opening.byline, 'By Another Author · brews at 89°c', 'its own temperature, not the stepped one');
});

test('a profile in use that is not listed opens with its description from the Workflow, and no row highlighted', () => {
    for (const live of [inWorkflow(hidden.profile), inWorkflow({ ...bloom.profile, steps: [step('bloom', 92, { pressure: 6 })] })]) {
        const { rows, opening } = view({ workflowProfile: live });
        assert.equal(rows.some(r => r.inUse || r.highlighted), false);
        assert.equal(opening.title, live.title);
        assert.equal(opening.inUse, true);
        assert.equal(opening.use, null);
    }
    assert.equal(view({ workflowProfile: inWorkflow(hidden.profile) }).opening.text, 'Hidden notes.');
});

test('a profile is not in use by title alone, nor by its temperature: by its steps', () => {
    const sameTitle = inWorkflow({ ...bloom.profile, steps: [step('bloom', 92), step('pour', 90, { seconds: 40 })] });
    assert.equal(profileInUse(listedProfiles(ALL), sameTitle), null);
    assert.equal(profileInUse(listedProfiles(ALL), null), null);
    assert.equal(profileInUse(listedProfiles(ALL), undefined), null);
});

test('two listed profiles that compare the same: the loaded recipe\'s is in use, else the first', () => {
    const twin = record('p-twin', { ...bloom.profile });
    const records = listedProfiles([bloom, twin]);
    assert.equal(profileInUse(records, inWorkflow(bloom.profile)), bloom);
    assert.equal(profileInUse(records, inWorkflow(bloom.profile), 'p-twin'), twin);
    const { rows } = profileView({ records, workflowProfile: inWorkflow(bloom.profile), preferId: 'p-twin', t });
    assert.deepEqual(rows.filter(r => r.inUse).map(r => r.id), ['p-twin']);
});

test('two of one title that differ only in temperature: the one at the Workflow\'s temperatures is in use, and the other can be chosen', () => {
    const hot = record('p-hot', { ...bloom.profile, steps: [step('bloom', 94), step('pour', 92)] });
    const records = listedProfiles([hot, bloom]);
    assert.equal(profileInUse(records, inWorkflow(bloom.profile)), bloom, 'not the first listed');
    assert.equal(profileInUse(records, inWorkflow(hot.profile)), hot);
    // The recipe's profile stepped down to the other's exact temperatures, or
    // a record write whose Workflow write failed: the curve the machine has wins.
    assert.equal(profileInUse(records, inWorkflow(bloom.profile), 'p-hot'), bloom);
    assert.equal(profileInUse(records, inWorkflow(stepped(bloom.profile, 1)), 'p-hot'), hot, 'stepped to neither: the recipe\'s');
    const { rows, pane } = profileView({ records, workflowProfile: inWorkflow(bloom.profile), t });
    assert.deepEqual(pane(rows.find(r => r.id === 'p-hot')).use, { label: 'Use this profile', note: 'Sets Brew to 94°c' });
    // Stepped to a temperature neither has: which is in use can't be told, so
    // neither is marked, both can be chosen, and the Workflow's is described.
    const between = profileView({ records, workflowProfile: inWorkflow(stepped(bloom.profile, 1)), t });
    assert.equal(between.rows.some(r => r.inUse || r.highlighted), false);
    assert.ok(between.rows.every(r => between.pane(r).use));
    assert.equal(between.opening.inUse, true);
    assert.equal(between.opening.byline, 'By Sample Author · brews at 93°c');
});

test('a version hidden since, still in use: no listed row is in use, and the visible one like it can be chosen', () => {
    // The owner changed the curve's temperatures under the same title and hid
    // the old version, which the loaded recipe still runs.
    const old = record('p-old', { ...bloom.profile, steps: [step('bloom', 94), step('pour', 92)] }, 'hidden');
    const all = [old, bloom, lever];
    const shownView = live => profileView({ records: listedProfiles(all), known: wholeProfiles(all), workflowProfile: live, t, preferId: 'p-old' });
    const { rows, pane, opening } = shownView(inWorkflow(old.profile));
    assert.equal(rows.some(r => r.inUse || r.highlighted), false);
    assert.deepEqual(pane(rows.find(r => r.id === 'p-bloom')).use, { label: 'Use this profile', note: 'Sets Brew to 92°c' });
    assert.equal(opening.byline, 'By Sample Author · brews at 94°c', 'the Workflow\'s, as for any profile not listed');
    // With no recipe loaded, at the old version's own temperatures: the same.
    const loose = profileView({ records: listedProfiles(all), known: wholeProfiles(all), workflowProfile: inWorkflow(old.profile), t });
    assert.equal(loose.rows.some(r => r.inUse), false);
    // The visible version, at its own temperatures or stepped: it is in use, as
    // a superseded version Streamline's editor hid never wins over it.
    for (const live of [inWorkflow(bloom.profile), inWorkflow(stepped(bloom.profile, 1))]) {
        const { rows: now } = profileView({ records: listedProfiles(all), known: wholeProfiles(all), workflowProfile: live, t });
        assert.deepEqual(now.filter(r => r.inUse).map(r => r.id), ['p-bloom']);
    }
});

test('two of one title whose steps differ by other amounts: a stepped one is told apart by the steps between its steps', () => {
    // 94 then 90, stepped down to 93 then 89, and then hidden; 92 then 90 visible.
    const steep = record('p-steep', { ...bloom.profile, steps: [step('bloom', 94), step('pour', 90)] }, 'hidden');
    const all = [steep, bloom];
    const live = inWorkflow(stepped(steep.profile, -1));
    assert.equal(profileInUse(wholeProfiles(all), live), steep);
    const { rows, pane } = profileView({ records: listedProfiles(all), known: wholeProfiles(all), workflowProfile: live, t });
    assert.equal(rows.some(r => r.inUse), false);
    assert.ok(pane(rows.find(r => r.id === 'p-bloom')).use, 'the visible one can be chosen');
    // And the visible one stepped: it is the one in use.
    assert.equal(profileInUse(wholeProfiles(all), inWorkflow(stepped(bloom.profile, 3))), bloom);
});

test('with no profile in the Workflow, it opens on the first row, highlighted and offered', () => {
    const { rows, opening } = view({ workflowProfile: null });
    assert.deepEqual(rows.map(r => r.highlighted), [true, false, false]);
    assert.equal(rows.some(r => r.inUse), false);
    assert.equal(opening.title, 'Sample Bloom');
    assert.deepEqual(opening.use, { label: 'Use this profile', note: 'Sets Brew to 92°c' });
});

test('with nothing listed, the profile in use is still described; with nothing at all, nothing is', () => {
    const none = profileView({ records: [], workflowProfile: inWorkflow(lever.profile), t });
    assert.deepEqual(none.rows, []);
    assert.equal(none.opening.title, 'Sample Lever');
    assert.equal(profileView({ records: [], workflowProfile: null, t }).opening, null);
});

test('a temperature is written as the Brew row writes it, in the unit it uses', () => {
    assert.equal(brewTemp(92, 'C'), '92°c');
    assert.equal(brewTemp(88.6, 'C'), '89°c');
    assert.equal(brewTemp(92, 'F'), '198°F');
    assert.equal(brewTemp(null, 'C'), '');
    assert.equal(brewTemp(Number.NaN, 'F'), '');
    const { rows, pane } = view({ workflowProfile: inWorkflow(bloom.profile), unit: 'F' });
    assert.equal(rows.find(r => r.id === 'p-lever').detail, 'By Another Author · 191°F');
    assert.equal(pane(rows.find(r => r.id === 'p-lever')).use.note, 'Sets Brew to 191°F');
    assert.equal(pane(rows.find(r => r.id === 'p-bloom')).byline, 'By Sample Author · brews at 198°F');
});

test('a title is named as Streamline names it under Brew, and sorted as named', () => {
    const titleOf = title => ({ 'Sample Bloom': 'Zz Beispiel Bloom' })[title] || title;
    const { rows, opening } = view({ workflowProfile: inWorkflow(bloom.profile), titleOf });
    assert.deepEqual(rows.map(r => r.name), ['Sample Lever', 'sample Tea', 'Zz Beispiel Bloom']);
    assert.equal(opening.title, 'Zz Beispiel Bloom');
    const untitled = profileView({ records: [record('p-u', { steps: [step('a', 90)] })], t });
    assert.equal(untitled.rows[0].name, 'Untitled');
});

test('the line under the title: the recipe\'s name and "saved to the recipe", with Decent Sync or without; with none, this machine only', () => {
    assert.deepEqual(profileSubtitle({ id: 'r1', name: 'Sample House', title: 'Sample House' }),
        { key: '{recipe} · saved to the recipe', vars: { recipe: 'Sample House' } });
    assert.deepEqual(profileSubtitle(null), { key: 'No recipe loaded · changes this machine only' });
});

test('every phrase the dialog says is in its table', () => {
    const said = new Set(Object.values(PROFILE_PHRASES));
    const { rows, opening, pane } = view({ workflowProfile: inWorkflow(bloom.profile) });
    const plain = phrase => phrase.replace(/\{\w+\}/g, '');
    for (const shown of [opening, ...rows.map(pane)]) {
        if (shown.placeholder) assert.ok(said.has(shown.text));
        if (shown.use) assert.ok(said.has(shown.use.label));
    }
    assert.ok([...said].every(phrase => plain(phrase).trim() !== ''));
});
