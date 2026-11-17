// The Shot seam's second source, Decent Sync's plugin, and which of the two
// sources answers (docs/cafe/DESIGN.md, "Shots and the reference" and "The
// Shots list"). The
// plugin's answers are in the shapes "For a Skin's author" in Decent Sync's
// docs/PLUGIN.md gives. All sample data is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPluginShots, referenceFrom, changeOf, locationRow } from '../src/cafe/plugin-shots.js';
import { createShotSources } from '../src/cafe/shot-sources.js';

const RECIPE = { id: 'recipe-1', name: 'House espresso', recordId: 'r1' };
const whole = id => ({ id, timestamp: '2026-11-12T10:00:00.000', workflow: { context: { baristaName: 'Sam' } }, annotations: {}, measurements: [] });
const answer = (id, { source = 'server', profileDiffers = false } = {}) => ({
    recipe: RECIPE,
    reference: id ? { shot: whole(id), recipe: null, referenceOf: [RECIPE], rating: 8, note: null, profileDiffers } : null,
    source,
});
// A refusal as api.js's callPluginEndpoint throws it: the refusal's code and
// message, and the HTTP status. One Decaid answered itself has no code.
const refusal = (code, status, message = 'Sample refusal.') => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const STATUS = { unreachable: 503, serverTooOld: 503, captureOnly: 409, hardwareMismatch: 409, noSuchShot: 404, noSuchRecipe: 404, notAtThisLocation: 403, archived: 409, recipesUnread: 500, shotUnwritten: 500, invalidRequest: 400 };

// A plugin that answers each request with the next of `reads` or `choices`: an
// answer, or an Error to reject with.
function plugin({ reads = [], choices = [], pages = [], wholes = [], edits = [], held = {} } = {}) {
    const calls = { read: [], chosen: [], listed: [], whole: [], decaid: [], edited: [], notServed: 0 };
    const next = list => {
        const value = list.shift();
        if (value === undefined) throw new Error('the plugin was asked more often than the test expects');
        if (value instanceof Error) throw value;
        return value;
    };
    const source = createPluginShots({
        readReference: async recipeId => { calls.read.push(recipeId); return next(reads); },
        chooseReference: async (recipeId, shotId) => { calls.chosen.push([recipeId, shotId]); return next(choices); },
        // The Location's list, one of its Shots whole, and an edit of one.
        listShots: async (cursor, limit) => { calls.listed.push([cursor, limit]); return next(pages); },
        readWhole: async id => { calls.whole.push(id); return next(wholes); },
        editShot: async (id, edit) => { calls.edited.push([id, edit]); return next(edits); },
        // Decaid's own Shots: `held` is the ones this tablet holds, by id.
        readShot: async id => {
            calls.decaid.push(id);
            if (held instanceof Error) throw held;
            return held[id] || null;
        },
        notServed: () => { calls.notServed += 1; },
    });
    return { source, calls };
}

// ── The plugin's answer ──────────────────────────────────────────────────────

test('the reference drawn is the plugin\'s answer, whichever Machine pulled it, and can be changed', async () => {
    const { source, calls } = plugin({ reads: [answer('a')] });
    const reference = await source.referenceShot('r1');
    assert.deepEqual([reference.shot.id, reference.canChange, reference.unreachable, reference.profileDiffers], ['a', true, false, false]);
    assert.equal(reference.shot.workflow.context.baristaName, 'Sam', 'the Shot is whole, as Decaid recorded it');
    assert.deepEqual(calls.read, ['r1'], 'the recipe is named by its DYE2 record id');
});

test('a Recipe with no Reference Shot has none, and one can be chosen', () => {
    assert.deepEqual(referenceFrom(answer(null)), { shot: null, canChange: true, unreachable: false });
});

test('an answer from the tablet\'s copy is drawn, and marks the reference as one that can\'t be changed now', () => {
    const copy = referenceFrom(answer('a', { source: 'tablet' }));
    assert.deepEqual([copy.shot.id, copy.canChange, copy.unreachable], ['a', false, true]);
    assert.deepEqual(referenceFrom(answer(null, { source: 'tablet' })), { shot: null, canChange: false, unreachable: true }, 'a copy may say the Recipe has none');
});

test('the reference\'s rating and note are the answer\'s own, and none where it has none', () => {
    const rated = referenceFrom({ ...answer('a'), reference: { ...answer('a').reference, rating: 7, note: ' Syrupy body ' } });
    assert.deepEqual([rated.rating, rated.note], [7, 'Syrupy body']);
    const bare = referenceFrom({ ...answer('a'), reference: { ...answer('a').reference, rating: 0, note: null } });
    assert.deepEqual([bare.rating, bare.note], [null, null], '0 is unrated');
    assert.deepEqual([referenceFrom(answer('a')).rating, referenceFrom(answer('a')).note], [8, null]);
});

test('"Different profile" is Decent Sync\'s word', () => {
    assert.equal(referenceFrom(answer('a', { profileDiffers: true })).profileDiffers, true);
    assert.equal(referenceFrom(answer('a')).profileDiffers, false);
    assert.equal('profileDiffers' in referenceFrom(answer(null)), false, 'nothing is said of no Shot');
});

test('an answer that is no answer reads as no reference', () => {
    for (const junk of [undefined, null, '', 'text', {}, { reference: {} }, { reference: { shot: {} } }]) {
        assert.equal(referenceFrom(junk).shot, null);
    }
});

// ── Reading it ───────────────────────────────────────────────────────────────

test('a reference that can\'t be read at all, with the server out of reach and no copy on the tablet, is none and says so', async () => {
    for (const refused of [refusal('unreachable', 503), refusal('serverTooOld', 503), refusal(null, 504), refusal(null, 404)]) {
        const { source } = plugin({ reads: [refused] });
        assert.deepEqual(await source.referenceShot('r1'), { shot: null, canChange: false, unreachable: true, unread: true }, refused.code || `Decaid's own ${refused.status}`);
    }
});

test('a recipe the Library does not have yet reads as no reference, which a choice may still be tried for', async () => {
    const { source } = plugin({ reads: [refusal('noSuchRecipe', 404)] });
    assert.deepEqual(await source.referenceShot('r1'), { shot: null, canChange: true, unreachable: false });
});

test('a Machine no longer served rejects the read, and the status is asked again', async () => {
    for (const code of ['captureOnly', 'hardwareMismatch']) {
        const { source, calls } = plugin({ reads: [refusal(code, 409)] });
        await assert.rejects(source.referenceShot('r1'), { code });
        assert.equal(calls.notServed, 1);
    }
});

test('any other refusal, and a request that reached nothing, reject: a failure is never "none"', async () => {
    for (const code of ['recipesUnread', 'invalidRequest', 'somethingNew']) {
        const { source, calls } = plugin({ reads: [refusal(code, STATUS[code] || 500)] });
        await assert.rejects(source.referenceShot('r1'), { code });
        assert.equal(calls.notServed, 0);
    }
    const { source } = plugin({ reads: [new TypeError('Failed to fetch')] });
    await assert.rejects(source.referenceShot('r1'), TypeError);
});

// ── Choosing it ──────────────────────────────────────────────────────────────

test('a choice is sent to the plugin, and the answer is the reference as it now is', async () => {
    const { source, calls } = plugin({ choices: [answer('b')] });
    const reference = await source.makeReference('r1', 'b');
    assert.deepEqual([reference.shot.id, reference.canChange, reference.unreachable], ['b', true, false]);
    assert.deepEqual(calls.chosen, [['r1', 'b']]);
    assert.deepEqual(calls.read, [], 'nothing is read again');
});

test('a choice answered unreachable, or by Decaid with no code, or not at all, is read again before it is called failed', async () => {
    for (const refused of [refusal('unreachable', 503), refusal('serverTooOld', 503), refusal(null, 504), new TypeError('Failed to fetch')]) {
        // It was made all the same.
        const made = plugin({ choices: [refused], reads: [answer('b')] });
        assert.equal((await made.source.makeReference('r1', 'b')).shot.id, 'b');
        assert.deepEqual(made.calls.read, ['r1']);
        // It was not: the error carries what the read found, for the page to follow.
        const not = plugin({ choices: [refused], reads: [answer('a', { source: 'tablet' })] });
        const error = await not.source.makeReference('r1', 'b').then(() => assert.fail('the choice was not made'), e => e);
        assert.deepEqual([error.reference.shot.id, error.reference.canChange, error.reference.unreachable], ['a', false, true]);
        assert.equal(error.refusal, undefined, 'and no refusal\'s message is shown for it');
    }
});

test('a choice confirmed by the tablet\'s copy was made', async () => {
    const { source } = plugin({ choices: [refusal('unreachable', 503)], reads: [answer('b', { source: 'tablet' })] });
    const reference = await source.makeReference('r1', 'b');
    assert.deepEqual([reference.shot.id, reference.canChange], ['b', false]);
});

test('a choice whose reading again fails too has failed, with nothing known to follow', async () => {
    const { source } = plugin({ choices: [refusal('unreachable', 503)], reads: [refusal('recipesUnread', 500)] });
    const error = await source.makeReference('r1', 'b').then(() => assert.fail('the choice was not made'), e => e);
    assert.equal(error.reference, null);
});

test('any other refusal shows its message, reads nothing and changes nothing', async () => {
    for (const code of ['noSuchShot', 'noSuchRecipe', 'notAtThisLocation', 'archived', 'recipesUnread', 'invalidRequest', 'captureOnly', 'hardwareMismatch', 'somethingNew']) {
        const { source, calls } = plugin({ choices: [refusal(code, STATUS[code] || 500, `Refused as ${code}.`)] });
        const error = await source.makeReference('r1', 'b').then(() => assert.fail('the choice was refused'), e => e);
        assert.deepEqual([error.code, error.refusal, error.reference], [code, `Refused as ${code}.`, undefined]);
        assert.deepEqual(calls.read, []);
        assert.equal(calls.notServed, ['captureOnly', 'hardwareMismatch'].includes(code) ? 1 : 0, code);
    }
});

// ── Pushes ───────────────────────────────────────────────────────────────────

test('a push names what changed: the connection, or a recipe\'s reference by its DYE2 record id', () => {
    assert.deepEqual(changeOf('{"what":"connection","connected":true}'), { what: 'connection' });
    assert.deepEqual(changeOf('{"what":"connection","connected":false}'), { what: 'connection' });
    assert.deepEqual(changeOf(JSON.stringify({ what: 'reference', recipe: RECIPE })), { what: 'reference', recipeId: 'r1' });
    assert.deepEqual(changeOf({ what: 'connection' }), { what: 'connection' }, 'the socket opening is told as one');
});

test('a push with a what the skin does not know is ignored, as is anything that is no push', () => {
    for (const data of ['{"what":"shots"}', '{"what":"workflow"}', '{}', 'not json', '', null, undefined, 7, '[]',
        JSON.stringify({ what: 'reference' }), JSON.stringify({ what: 'reference', recipe: { id: 'recipe-1', recordId: null } })]) {
        assert.equal(changeOf(data), null, String(data));
    }
});

// ── The Location's Shots ─────────────────────────────────────────────────────

// A row of the plugin's `shots` answer, as docs/PLUGIN.md gives it.
const listed = (id, fields = {}) => ({
    id,
    pulledAt: '2026-11-12T10:41:00.000Z',
    machine: { id: 'machine-right', name: 'Sample Right' },
    onThisTablet: false,
    recipe: RECIPE,
    bean: { roaster: 'Sample Roaster', name: 'Sample Blend' },
    dose: 18.2,
    targetDose: 18,
    yield: 36.4,
    targetYield: 36,
    duration: 27.31,
    rating: 8,
    barista: 'Sam',
    hasNote: true,
    unfinished: false,
    referenceOf: [],
    ...fields,
});

test('a page of the Location\'s list is the plugin\'s, by its cursor, with the Machine that pulled each Shot', async () => {
    const { source, calls } = plugin({ pages: [{ shots: [listed('s2'), listed('s1', { machine: { id: 'machine-left', name: 'Sample Left' } })], nextCursor: 'cursor-2' }, { shots: [listed('s0')], nextCursor: null }] });
    const first = await source.shotsPage(null, 50, 'machine-left');
    assert.deepEqual(first.rows.map(row => [row.id, row.machine, row.thisMachine]), [['s2', 'Sample Right', false], ['s1', 'Sample Left', true]]);
    assert.equal(first.next, 'cursor-2');
    const last = await source.shotsPage(first.next, 50, 'machine-left');
    assert.deepEqual([last.rows.map(row => row.id), last.next], [['s0'], null]);
    assert.deepEqual(calls.listed, [[null, 50], ['cursor-2', 50]]);
    assert.deepEqual([calls.decaid, calls.whole], [[], []], 'no Shot is read whole for the list');
});

test('a row names its recipe by this tablet\'s DYE2 record id, and the Recipes it is the reference of', () => {
    const row = locationRow(listed('s1', { referenceOf: [RECIPE, { id: 'recipe-x', name: 'Elsewhere', recordId: null }] }));
    assert.deepEqual([row.recipeId, row.recipeName, row.referenceOf], ['r1', 'House espresso', ['r1', null]]);
    assert.deepEqual([locationRow(listed('s1', { recipe: null })).recipeId, locationRow(listed('s1', { recipe: null })).recipeName], [null, null]);
});

test('a refusal of the list rejects with it, and an answer that is no list is a failure, never an empty list', async () => {
    for (const code of ['unreachable', 'captureOnly', 'invalidRequest']) {
        const { source } = plugin({ pages: [refusal(code, STATUS[code])] });
        await assert.rejects(source.shotsPage(null, 50), error => error.code === code);
    }
    for (const odd of ['', null, {}, { shots: 'none' }]) {
        await assert.rejects(plugin({ pages: [odd] }).source.shotsPage(null, 50), String(JSON.stringify(odd)));
    }
    const skipped = await plugin({ pages: [{ shots: [null, { name: 'no id' }, listed('s1')] }] }).source.shotsPage(null, 50);
    assert.deepEqual([skipped.rows.map(row => row.id), skipped.next], [['s1'], null]);
});

// ── A Shot whole ─────────────────────────────────────────────────────────────

test('this tablet\'s own Shot is read from Decaid, and the plugin is not asked', async () => {
    const { source, calls } = plugin({ held: { s1: whole('s1') } });
    const found = await source.shotById('s1');
    assert.deepEqual([found.shot.id, found.canChange], ['s1', true]);
    assert.deepEqual([calls.decaid, calls.whole], [['s1'], []]);
});

test('another Machine\'s Shot is read whole through the plugin, one request, and can be changed', async () => {
    const { source, calls } = plugin({ wholes: [{ shot: whole('s2'), recipe: RECIPE, referenceOf: [] }] });
    const found = await source.shotById('s2');
    assert.deepEqual([found.shot.id, found.canChange], ['s2', true]);
    assert.deepEqual([calls.decaid, calls.whole], [['s2'], ['s2']]);
});

test('whole Shots are asked of the plugin one at a time, whoever asks, and a refused one does not stop the next', async () => {
    const asked = [];
    const answers = [];
    const source = createPluginShots({
        readReference: async () => null, chooseReference: async () => null, listShots: async () => null,
        editShot: async () => { throw refusal('unreachable', 503); },
        readShot: async () => null,
        readWhole: id => { asked.push(id); return new Promise((resolve, reject) => answers.push({ resolve, reject })); },
    });
    const first = source.shotById('s1');
    const second = source.shotById('s2');
    // The read after an edit that may have been made waits its turn too.
    const edit = source.editShot('s3', { rating: 6 });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(asked, ['s1'], 'the second waits for the first');
    answers[0].reject(refusal('unreachable', 503));
    await assert.rejects(first);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(asked, ['s1', 's2']);
    answers[1].resolve({ shot: whole('s2') });
    assert.equal((await second).shot.id, 's2');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(asked, ['s1', 's2', 's3']);
    answers[2].resolve({ shot: { ...whole('s3'), annotations: { enjoyment: 60 } } });
    await edit.catch(() => {});
});

test('a Shot the Location\'s list no longer lists is gone', async () => {
    const { source } = plugin({ wholes: [refusal('noSuchShot', 404)] });
    assert.deepEqual(await source.shotById('s2'), { shot: null, canChange: true });
});

test('with the server out of reach another Machine\'s Shot can\'t be read, and the failure says why', async () => {
    for (const failure of [refusal('unreachable', 503), refusal('serverTooOld', 503), refusal(undefined, 504)]) {
        const { source } = plugin({ wholes: [failure] });
        await assert.rejects(source.shotById('s2'), error => error.unreachable === true, failure.code);
    }
    // This tablet's own is still read: Decaid answers with the server or without it.
    assert.equal((await plugin({ held: { s1: whole('s1') } }).source.shotById('s1')).shot.id, 's1');
});

test('any other failure to read a Shot rejects and is not an outage; a Machine no longer served has the status asked again', async () => {
    const lost = plugin({ wholes: [new Error('offline')] });
    await assert.rejects(lost.source.shotById('s2'), error => error.unreachable === undefined);
    const capture = plugin({ wholes: [refusal('captureOnly', 409)] });
    await assert.rejects(capture.source.shotById('s2'), error => error.unreachable === undefined);
    assert.equal(capture.calls.notServed, 1);
    await assert.rejects(plugin({ wholes: ['not an answer'] }).source.shotById('s2'));
    await assert.rejects(plugin({ held: new Error('Decaid is down') }).source.shotById('s2'), /Decaid is down/);
});

// ── An edit of another Machine's Shot ────────────────────────────────────────

test('another Machine\'s Shot is rated through the plugin, and the answer is the Shot as it now is', async () => {
    const { source, calls } = plugin({ edits: [{ rating: 8, note: null }] });
    assert.deepEqual(await source.editShot('s2', { rating: 8 }), { rating: 8, note: null });
    assert.deepEqual(calls.edited, [['s2', { rating: 8 }]]);
    assert.deepEqual([calls.decaid, calls.whole], [[], []], 'an edit that was answered reads nothing');
});

test('an edit of it that may have been made is read again through the plugin before it is called failed', async () => {
    const made = { shot: { ...whole('s2'), annotations: { enjoyment: 8 } }, recipe: RECIPE, referenceOf: [] };
    for (const failure of [refusal('unreachable', 503), refusal('serverTooOld', 503), refusal(undefined, 504), new Error('no answer')]) {
        const { source, calls } = plugin({ edits: [failure], wholes: [made] });
        assert.deepEqual(await source.editShot('s2', { rating: 8 }), { rating: 8, note: null }, `${failure.code}: the server made it`);
        assert.deepEqual([calls.decaid, calls.whole], [['s2'], ['s2']], 'Decaid does not hold it, so the read is the plugin\'s');
        const not = plugin({ edits: [failure], wholes: [{ shot: whole('s2'), recipe: RECIPE, referenceOf: [] }] });
        await assert.rejects(not.source.editShot('s2', { rating: 8 }), error => error.unreachable === undefined && error.remarks.rating === null && error.refusal === undefined);
    }
});

test('where that read can\'t ask the server either, nothing is known either way, and the failure says so', async () => {
    const { source } = plugin({ edits: [refusal('unreachable', 503)], wholes: [refusal('unreachable', 503)] });
    await assert.rejects(source.editShot('s2', { rating: 8 }), error => error.unreachable === true && error.remarks === null && error.refusal === undefined);
    // A read that fails for another reason is a failed edit.
    const other = plugin({ edits: [refusal('unreachable', 503)], wholes: [refusal('noSuchShot', 404)] });
    await assert.rejects(other.source.editShot('s2', { rating: 8 }), error => error.unreachable === undefined && error.remarks === null);
});

test('this tablet\'s own Shot is read again from Decaid, with the server out of reach too', async () => {
    const { source, calls } = plugin({ edits: [refusal(undefined, 504)], held: { s1: { ...whole('s1'), annotations: { enjoyment: 8 } } } });
    assert.deepEqual(await source.editShot('s1', { rating: 8 }), { rating: 8, note: null });
    assert.deepEqual([calls.decaid, calls.whole], [['s1'], []]);
});

test('any other refusal of an edit shows its message, reads nothing and changes nothing', async () => {
    for (const code of ['noSuchShot', 'invalidRequest', 'captureOnly']) {
        const { source, calls } = plugin({ edits: [refusal(code, STATUS[code], `Refused: ${code}.`)] });
        await assert.rejects(source.editShot('s2', { rating: 8 }), error => error.refusal === `Refused: ${code}.` && error.remarks === undefined);
        assert.deepEqual([calls.decaid, calls.whole], [[], []], code);
    }
});

// ── Which source answers ─────────────────────────────────────────────────────

const SERVED = { connected: true, served: true };
const UNREACHABLE = { connected: false, served: false, code: 'unreachable' };
const CAPTURE_ONLY = { connected: true, served: false, code: 'captureOnly' };

// The two sources, each counting what it was asked, and what the seam tells its
// caller. `pluginReference` is what the plugin answers for a reference, or an
// Error it rejects with, in place of its own Shot.
function seam({ pluginReference, pluginList, choicesFail = false } = {}) {
    const calls = { tablet: [], plugin: [], asked: 0, changed: [], moved: [] };
    let held = null; // a choice waits on this before it answers
    const source = name => ({
        latestShot: async id => { calls[name].push(['latest', id]); return whole(`${name}-latest`); },
        referenceShot: async id => {
            calls[name].push(['reference', id]);
            if (name === 'plugin' && pluginReference instanceof Error) throw pluginReference;
            if (name === 'plugin' && pluginReference) return pluginReference;
            return { shot: whole(`${name}-reference`), canChange: true };
        },
        shotsPage: async (from, limit, extra) => {
            calls[name].push(['page', from, limit, extra]);
            if (name === 'plugin' && pluginList instanceof Error) throw pluginList;
            return { rows: [{ id: `${name}-row` }], next: name === 'plugin' ? 'cursor-2' : 50 };
        },
        shotById: async id => { calls[name].push(['byId', id]); return { shot: whole(id), canChange: true }; },
        references: async () => {
            calls[name].push(['references']);
            if (choicesFail) throw new Error('offline');
            return { r1: 'tablet-row' };
        },
        makeReference: async (id, shotId) => {
            calls[name].push(['make', id, shotId]);
            if (held) await held;
            if (shotId === 'lost') throw Object.assign(new Error('Sample failure.'), { reference: { shot: whole('before'), canChange: false } });
            return { shot: whole(shotId), canChange: true };
        },
    });
    const sources = createShotSources({
        tablet: source('tablet'),
        plugin: source('plugin'),
        askStatus: () => { calls.asked += 1; },
        changed: (recipeId, moved) => { calls.changed.push(recipeId); calls.moved.push(moved); },
    });
    return { sources, calls, hold: gate => { held = gate; } };
}

test('before the status has answered: the latest Shot alone, no reference, and none can be chosen', async () => {
    const { sources, calls } = seam();
    assert.equal(sources.source(), 'unknown');
    assert.equal((await sources.latestShot('r1')).id, 'tablet-latest');
    assert.deepEqual(await sources.referenceShot('r1'), { shot: null, canChange: false });
    await assert.rejects(sources.makeReference('r1', 'a'));
    sources.status({}); // Decaid itself did not answer
    sources.status({ loading: true }); // Decaid has not loaded the plugin yet
    assert.equal(sources.source(), 'unknown');
    assert.deepEqual(await sources.referenceShot('r1'), { shot: null, canChange: false });
    assert.deepEqual(calls.tablet, [['latest', 'r1']], 'the choice kept on the tablet was not read');
    assert.deepEqual(calls.plugin, []);
    assert.deepEqual(calls.changed, [], 'and nothing is read again for an answer that says nothing');
});

// A page opened while the server is out of reach: the plugin has said so, and
// it is not known yet whether the Machine is served.
const COPY = { shot: whole('copy'), canChange: false, unreachable: true, profileDiffers: false, rating: 8, note: null };
const NO_COPY = { shot: null, canChange: false, unreachable: true, unread: true };

test('a plugin that can\'t ask its server, before the source is known, is asked for the reference: its copy is drawn, and can\'t be changed', async () => {
    for (const status of [UNREACHABLE, { connected: true, served: false, code: 'serverTooOld' }]) {
        const { sources, calls } = seam({ pluginReference: COPY });
        sources.status(status);
        assert.equal(sources.source(), 'unknown');
        assert.deepEqual([calls.changed, calls.moved], [[null], [false]], 'the page is told once, to read it');
        assert.deepEqual(await sources.referenceShot('r1'), COPY);
        await assert.rejects(sources.makeReference('r1', 'a'), 'nothing can be chosen until the status says the Machine is served');
        assert.deepEqual(calls.plugin, [['reference', 'r1']]);
        assert.deepEqual(calls.tablet, [], 'the choice kept on the tablet is not read while the source is not known');
        sources.status(status);
        assert.deepEqual(calls.changed, [null], 'and not again for the same answer');
    }
});

test('whatever the plugin answers before the source is known, the reference can\'t be changed', async () => {
    // The server came back between the status and the read: the answer is the
    // server's, and nothing is chosen before the status has said "served".
    const { sources } = seam({ pluginReference: { shot: whole('server'), canChange: true, unreachable: false, profileDiffers: false, rating: null, note: null } });
    sources.status(UNREACHABLE);
    const reference = await sources.referenceShot('r1');
    assert.deepEqual([reference.shot.id, reference.canChange], ['server', false]);
});

test('a plugin with no copy, before the source is known: no reference, and the answer says nothing could be read', async () => {
    const { sources, calls } = seam({ pluginReference: NO_COPY });
    sources.status(UNREACHABLE);
    assert.deepEqual(await sources.referenceShot('r1'), NO_COPY);
    assert.deepEqual(calls.tablet, []);
});

test('only the plugin\'s own word has it asked: Decaid not answering, and a plugin still loading, ask nothing', async () => {
    const { sources, calls } = seam({ pluginReference: COPY });
    for (const status of [{}, { loading: true }]) {
        sources.status(status);
        assert.deepEqual(await sources.referenceShot('r1'), { shot: null, canChange: false });
    }
    assert.deepEqual([calls.tablet, calls.plugin, calls.changed], [[], [], []]);
    sources.status(UNREACHABLE);
    assert.equal((await sources.referenceShot('r1')).shot.id, 'copy');
    sources.status({}); // Decaid stopped answering: the plugin no longer says so
    assert.deepEqual(await sources.referenceShot('r1'), { shot: null, canChange: false });
    assert.deepEqual(calls.changed, [null, null], 'the page reads again each time that word changes');
    assert.equal(calls.plugin.length, 1);
});

test('a refusal before the source is known rejects, so the page keeps what it shows', async () => {
    const { sources } = seam({ pluginReference: Object.assign(new Error('Sample refusal.'), { code: 'recipesUnread', status: 500 }) });
    sources.status(UNREACHABLE);
    await assert.rejects(sources.referenceShot('r1'), /Sample refusal/);
});

test('once the status says which, the source answers as ever', async () => {
    const { sources, calls } = seam();
    sources.status(UNREACHABLE);
    sources.status(SERVED);
    assert.equal((await sources.referenceShot('r1')).shot.id, 'plugin-reference');
    assert.deepEqual(calls.moved.slice(-1), [true]);
    const other = seam();
    other.sources.status(UNREACHABLE);
    other.sources.status(CAPTURE_ONLY);
    assert.deepEqual(await other.sources.referenceShot('r1'), { shot: whole('tablet-reference'), canChange: true });
    assert.deepEqual(other.calls.plugin, [], 'a Capture-only Machine\'s plugin was never asked');
});

test('on a served Machine the reference is the plugin\'s, and nothing kept on the tablet for it is read or written', async () => {
    const { sources, calls } = seam();
    sources.status(SERVED);
    assert.deepEqual(calls.changed, [null], 'the reference is read once the source is known');
    assert.equal((await sources.referenceShot('r1')).shot.id, 'plugin-reference');
    assert.equal((await sources.makeReference('r1', 'b')).shot.id, 'b');
    assert.equal((await sources.latestShot('r1')).id, 'tablet-latest', 'the latest Shot stays the tablet\'s');
    assert.deepEqual(calls.plugin, [['reference', 'r1'], ['make', 'r1', 'b']]);
    assert.deepEqual(calls.tablet, [['latest', 'r1']]);
    // Through an outage it stays with the plugin, which answers from its copy.
    sources.status(UNREACHABLE);
    assert.equal(sources.source(), 'plugin');
    await sources.referenceShot('r1');
    assert.deepEqual(calls.tablet, [['latest', 'r1']]);
});

test('with no plugin, and on a Capture-only Machine, the reference is the tablet\'s own choice', async () => {
    for (const status of [null, CAPTURE_ONLY, { served: false, code: 'hardwareMismatch' }]) {
        const { sources, calls } = seam();
        sources.status(status);
        assert.equal(sources.source(), 'tablet');
        assert.equal((await sources.referenceShot('r1')).shot.id, 'tablet-reference');
        assert.equal((await sources.makeReference('r1', 'b')).shot.id, 'b');
        assert.deepEqual(calls.plugin, []);
    }
});

test('a Machine that turns Capture-only, or is served again, changes source at the next status, and the reference is read again', async () => {
    const { sources, calls } = seam();
    sources.status(SERVED);
    sources.status(SERVED);
    assert.deepEqual(calls.changed, [null], 'an answer that changes nothing reads nothing');
    sources.status(CAPTURE_ONLY);
    assert.deepEqual([sources.source(), calls.changed.length], ['tablet', 2]);
    assert.equal((await sources.referenceShot('r1')).shot.id, 'tablet-reference');
    sources.status(SERVED);
    assert.deepEqual([sources.source(), calls.changed.length], ['plugin', 3]);
});

test('a change of source says the reference read before is the other source\'s; a change of connection alone does not', () => {
    const { sources, calls } = seam();
    sources.status(null);
    sources.status(SERVED);
    sources.push({ what: 'connection' });
    sources.status(UNREACHABLE);
    sources.push({ what: 'reference', recipeId: 'r1' });
    assert.deepEqual(calls.changed, [null, null, null, 'r1']);
    assert.deepEqual(calls.moved, [true, true, false, false]);
});

test('a choice answered after the source changed is not the reference to draw', async () => {
    const { sources, hold } = seam();
    sources.status(null);
    let release;
    hold(new Promise(resolve => { release = resolve; }));
    const made = sources.makeReference('r1', 'b');
    const lost = sources.makeReference('r1', 'lost');
    sources.status(SERVED); // served meanwhile: the reference is Decent Sync's now
    release();
    assert.equal(await made, null, 'the tablet\'s answer is not followed');
    const error = await lost.then(() => assert.fail('the choice failed'), e => e);
    assert.equal(error.reference, undefined, 'nor what a failed choice read');
    hold(null);
    assert.equal((await sources.makeReference('r1', 'c')).shot.id, 'c', 'a choice the source stood through is');
    const kept = await sources.makeReference('r1', 'lost').then(() => assert.fail('the choice failed'), e => e);
    assert.equal(kept.reference.shot.id, 'before');
});

test('a push that names a recipe says to read that recipe\'s reference again', () => {
    const { sources, calls } = seam();
    sources.status(SERVED);
    sources.push(changeOf(JSON.stringify({ what: 'reference', recipe: RECIPE })));
    assert.deepEqual(calls.changed, [null, 'r1']);
    assert.equal(calls.asked, 0, 'and the status is not asked for it');
    sources.push(changeOf('{"what":"somethingNew"}'));
    sources.push(null);
    assert.deepEqual(calls.changed, [null, 'r1'], 'a push the skin does not know changes nothing');
});

test('a push about a reference means nothing where the plugin is not the source', () => {
    const { sources, calls } = seam();
    sources.push({ what: 'reference', recipeId: 'r1' });
    sources.status(CAPTURE_ONLY);
    sources.push({ what: 'reference', recipeId: 'r1' });
    assert.deepEqual(calls.changed, [null]);
});

test('when the connection comes or goes, or the socket opens, the status is asked and the reference read after it', () => {
    const { sources, calls } = seam();
    sources.status(SERVED);
    sources.push({ what: 'connection' });
    assert.deepEqual([calls.asked, calls.changed.length], [1, 1], 'nothing is read before the status has answered');
    sources.status(UNREACHABLE); // the source stands, and the tablet's copy may now stand in
    assert.deepEqual(calls.changed, [null, null]);
    sources.status(UNREACHABLE); // an ask the connection did not cause
    assert.deepEqual(calls.changed, [null, null]);
});

// ── The Shots list ───────────────────────────────────────────────────────────

const AT_CAFE = { ...SERVED, machine: { id: 'machine-left', name: 'Sample Left' }, location: { id: 'l', name: 'Sample Cafe' } };
const pages = (calls, name) => calls[name].filter(([what]) => what === 'page');

test('on a served Machine the list is the Location\'s, through the plugin, a page at a time by its cursor', async () => {
    const { sources, calls } = seam();
    sources.status(AT_CAFE);
    const first = await sources.shotsPage(null, 50);
    assert.deepEqual(first.rows, [{ id: 'plugin-row' }]);
    assert.deepEqual(first.list, { of: 'location', why: 'served', location: 'Sample Cafe', locationId: 'l', machineId: 'machine-left' });
    assert.equal(first.afresh, false);
    const second = await sources.shotsPage(first.next, 50);
    assert.equal(second.afresh, false);
    assert.deepEqual(pages(calls, 'plugin'), [['page', null, 50, 'machine-left'], ['page', 'cursor-2', 50, 'machine-left']]);
    assert.deepEqual(pages(calls, 'tablet'), []);
    assert.ok(!calls.tablet.some(([what]) => what === 'references'), 'the choice kept on the tablet is never read');
});

test('with no plugin, on a Capture-only Machine, on the wrong hardware, with the server out of reach and before the plugin has said, the list is the tablet\'s own', async () => {
    const cases = [
        [undefined, 'unknown'], [{}, 'unknown'], [{ loading: true }, 'unknown'], [null, 'noPlugin'],
        [CAPTURE_ONLY, 'notServed'], [{ code: 'hardwareMismatch' }, 'notServed'],
        [UNREACHABLE, 'unreachable'], [{ code: 'serverTooOld' }, 'unreachable'], [{ code: 'somethingNew', message: 'Sample refusal.' }, 'refused'],
    ];
    for (const [answer, why] of cases) {
        const { sources, calls } = seam();
        if (answer !== undefined) sources.status(answer);
        const page = await sources.shotsPage(null, 50);
        assert.deepEqual([page.rows, page.list.of, page.list.why], [[{ id: 'tablet-row' }], 'tablet', why], why);
        assert.deepEqual(pages(calls, 'plugin'), [], `${why}: the plugin is not asked for the list`);
        const next = await sources.shotsPage(page.next, 50);
        assert.equal(next.afresh, false);
        assert.deepEqual(pages(calls, 'tablet').map(([, from]) => from), [null, 50]);
    }
});

test('a served Machine whose server has gone lists the tablet\'s own Shots, though its reference stays with the plugin', async () => {
    const { sources, calls } = seam();
    sources.status(AT_CAFE);
    sources.status(UNREACHABLE);
    assert.equal(sources.source(), 'plugin');
    const page = await sources.shotsPage(null, 50);
    assert.deepEqual([page.rows, page.list], [[{ id: 'tablet-row' }], { of: 'tablet', why: 'unreachable' }]);
    assert.deepEqual(pages(calls, 'plugin'), []);
    assert.ok(!calls.tablet.some(([what]) => what === 'references'), 'and no chip is read from the tablet\'s own choice');
});

test('a refusal of the list that means "the tablet\'s own Shots" is answered from the tablet, with its line, and the status is asked again', async () => {
    const lines = { unreachable: 'unreachable', serverTooOld: 'unreachable', captureOnly: 'notServed', hardwareMismatch: 'notServed' };
    for (const [code, why] of Object.entries(lines)) {
        const { sources, calls } = seam({ pluginList: refusal(code, STATUS[code]) });
        sources.status(AT_CAFE);
        const first = await sources.shotsPage(null, 50);
        assert.deepEqual([first.rows, first.list, first.afresh], [[{ id: 'tablet-row' }], { of: 'tablet', why }, false], code);
        assert.equal(calls.asked, 1, code);
        // On a later page the list is read afresh from the tablet, from its first row.
        const later = await sources.shotsPage({ of: 'location', at: 'cursor-2' }, 50);
        assert.deepEqual([later.rows, later.list, later.afresh], [[{ id: 'tablet-row' }], { of: 'tablet', why }, true], code);
        assert.deepEqual(pages(calls, 'tablet').map(([, from]) => from), [null, null]);
    }
    // Decaid answering in the plugin's place is treated as unreachable.
    const decaid = seam({ pluginList: refusal(undefined, 504) });
    decaid.sources.status(AT_CAFE);
    assert.equal((await decaid.sources.shotsPage(null, 50)).list.why, 'unreachable');
});

test('any other failure of the list rejects: a list that can\'t be read is not the tablet\'s list', async () => {
    for (const failure of [refusal('invalidRequest', 400), refusal('recipesUnread', 500), new Error('offline')]) {
        const { sources, calls } = seam({ pluginList: failure });
        sources.status(AT_CAFE);
        await assert.rejects(sources.shotsPage(null, 50));
        assert.deepEqual(pages(calls, 'tablet'), []);
        assert.equal(calls.asked, 0);
    }
});

test('a list the tablet gave in place of the Location\'s goes on from the tablet, page by page, while the plugin catches up', async () => {
    // The status already says served, but the plugin refuses the list while the tablet catches up after an outage.
    const { sources, calls } = seam({ pluginList: refusal('unreachable', 503) });
    sources.status(AT_CAFE);
    const first = await sources.shotsPage(null, 50);
    assert.deepEqual([first.list.why, first.afresh], ['unreachable', false]);
    const second = await sources.shotsPage(first.next, 50);
    assert.deepEqual([second.rows, second.list, second.afresh], [[{ id: 'tablet-row' }], { of: 'tablet', why: 'unreachable' }, false]);
    assert.deepEqual(pages(calls, 'tablet').map(([, from]) => from), [null, 50], 'the second page follows the first');
    assert.equal(pages(calls, 'plugin').length, 1, 'the plugin is not asked again for a later page');
    // Opened afresh, the list is asked of the plugin again.
    await sources.shotsPage(null, 50);
    assert.equal(pages(calls, 'plugin').length, 2);
    // A Machine moved meanwhile reads its list afresh.
    const fallback = await sources.shotsPage(null, 50);
    sources.status({ ...AT_CAFE, location: { id: 'l2', name: 'Sample Annex' } });
    const moved = await sources.shotsPage(fallback.next, 50);
    assert.equal(moved.afresh, true);
});

test('a cursor belongs to the Location that gave it: a Machine moved to another reads its list afresh', async () => {
    const { sources, calls } = seam();
    sources.status(AT_CAFE);
    const first = await sources.shotsPage(null, 50);
    sources.status({ ...AT_CAFE, location: { id: 'l2', name: 'Sample Annex' } });
    const later = await sources.shotsPage(first.next, 50);
    assert.deepEqual([later.list.locationId, later.afresh], ['l2', true]);
    assert.deepEqual(pages(calls, 'plugin').map(([, from]) => from), [null, null], 'the first Location\'s cursor is not sent for the second');
});

test('a Machine that turns Capture-only, or is served again, changes the list\'s source at the next status, and a later page is read afresh', async () => {
    const { sources, calls } = seam();
    sources.status(AT_CAFE);
    const first = await sources.shotsPage(null, 50);
    sources.status(CAPTURE_ONLY);
    assert.deepEqual(calls.moved.at(-1), true, 'an opened Shot gives way to the latest, and an open list closes');
    const later = await sources.shotsPage(first.next, 50);
    assert.deepEqual([later.rows, later.list.why, later.afresh], [[{ id: 'tablet-row' }], 'notServed', true]);
    assert.deepEqual(pages(calls, 'tablet').map(([, from]) => from), [null], 'the plugin\'s cursor means nothing to Decaid');
    sources.status(AT_CAFE);
    const again = await sources.shotsPage(later.next, 50);
    assert.deepEqual([again.rows, again.list.why, again.afresh], [[{ id: 'plugin-row' }], 'served', true]);
    assert.deepEqual(pages(calls, 'plugin').at(-1).slice(1, 3), [null, 50]);
});

test('a Shot by its id is the plugin\'s to read on a served Machine, through an outage too, and the tablet\'s otherwise', async () => {
    for (const [answers, name] of [[[AT_CAFE], 'plugin'], [[AT_CAFE, UNREACHABLE], 'plugin'], [[null], 'tablet'], [[CAPTURE_ONLY], 'tablet'], [[], 'tablet'], [[UNREACHABLE], 'tablet']]) {
        const { sources, calls } = seam();
        for (const answer of answers) sources.status(answer);
        assert.equal((await sources.shotById('s1')).shot.id, 's1');
        assert.deepEqual(calls[name].filter(([what]) => what === 'byId'), [['byId', 's1']], JSON.stringify(answers));
    }
});

test('which listed Shots are references is the choice kept on the tablet, only where that is the source', async () => {
    const own = seam();
    own.sources.status(null); // no plugin: the tablet's own choice
    await own.sources.shotsPage(null, 50);
    assert.deepEqual(pages(own.calls, 'tablet')[0][3], { r1: 'tablet-row' });
    for (const answer of [undefined, { code: 'unreachable' }]) {
        const { sources, calls } = seam();
        if (answer !== undefined) sources.status(answer);
        await sources.shotsPage(null, 50);
        assert.equal(pages(calls, 'tablet')[0][3], null, 'a Machine that is or may be served never reads the tablet\'s choice');
        assert.ok(!calls.tablet.some(([what]) => what === 'references'));
    }
});

test('a choice of reference that can\'t be read leaves the list its rows, without chips', async () => {
    const { sources, calls } = seam({ choicesFail: true });
    sources.status(null);
    const page = await sources.shotsPage(null, 50);
    assert.deepEqual([page.rows.length, pages(calls, 'tablet')[0][3]], [1, null]);
});
