// The Shot seam's second source, Decent Sync's plugin, and which of the two
// sources answers (docs/cafe/DESIGN.md, "Shots and the reference"). The
// plugin's answers are in the shapes "For a Skin's author" in Decent Sync's
// docs/PLUGIN.md gives. All sample data is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPluginShots, referenceFrom, changeOf } from '../src/cafe/plugin-shots.js';
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
function plugin({ reads = [], choices = [] } = {}) {
    const calls = { read: [], chosen: [], notServed: 0 };
    const next = list => {
        const value = list.shift();
        if (value === undefined) throw new Error('the plugin was asked more often than the test expects');
        if (value instanceof Error) throw value;
        return value;
    };
    const source = createPluginShots({
        readReference: async recipeId => { calls.read.push(recipeId); return next(reads); },
        chooseReference: async (recipeId, shotId) => { calls.chosen.push([recipeId, shotId]); return next(choices); },
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

// ── Which source answers ─────────────────────────────────────────────────────

const SERVED = { connected: true, served: true };
const UNREACHABLE = { connected: false, served: false, code: 'unreachable' };
const CAPTURE_ONLY = { connected: true, served: false, code: 'captureOnly' };

// The two sources, each counting what it was asked, and what the seam tells its caller.
function seam() {
    const calls = { tablet: [], plugin: [], asked: 0, changed: [] };
    const source = name => ({
        latestShot: async id => { calls[name].push(['latest', id]); return whole(`${name}-latest`); },
        referenceShot: async id => { calls[name].push(['reference', id]); return { shot: whole(`${name}-reference`), canChange: true }; },
        makeReference: async (id, shotId) => { calls[name].push(['make', id, shotId]); return { shot: whole(shotId), canChange: true }; },
    });
    const sources = createShotSources({
        tablet: source('tablet'),
        plugin: source('plugin'),
        askStatus: () => { calls.asked += 1; },
        changed: recipeId => calls.changed.push(recipeId),
    });
    return { sources, calls };
}

test('before the status has answered: the latest Shot alone, no reference, and none can be chosen', async () => {
    const { sources, calls } = seam();
    assert.equal(sources.source(), 'unknown');
    assert.equal((await sources.latestShot('r1')).id, 'tablet-latest');
    assert.deepEqual(await sources.referenceShot('r1'), { shot: null, canChange: false });
    await assert.rejects(sources.makeReference('r1', 'a'));
    sources.status(UNREACHABLE); // the plugin has not connected yet
    assert.equal(sources.source(), 'unknown');
    assert.deepEqual(await sources.referenceShot('r1'), { shot: null, canChange: false });
    assert.deepEqual(calls.tablet, [['latest', 'r1']], 'the choice kept on the tablet was not read');
    assert.deepEqual(calls.plugin, []);
    assert.deepEqual(calls.changed, [], 'and nothing is read again for an answer that says nothing');
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
