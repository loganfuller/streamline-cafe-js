// What the answer to Decent Sync's Status request means for the page: whether
// the dial-in is saved, and where a recipe's reference is kept
// (docs/cafe/DESIGN.md, "Recipes and the strip" and "Shots and the reference").
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decentSyncSaves, statusUnknown, statusRetryMs, shotSource, serverOutOfReach } from '../src/cafe/sync-status.js';

test('Decent Sync saves the dial-in on a Machine it serves', () => {
    assert.equal(decentSyncSaves(false, { connected: true, served: true }), true);
    assert.equal(decentSyncSaves(true, { connected: true, served: true }), true);
});

test('it saves nothing with no plugin, on a Capture-only Machine, or on the wrong hardware', () => {
    assert.equal(decentSyncSaves(true, null), false, 'no Decent Sync plugin loaded');
    assert.equal(decentSyncSaves(true, { served: false, code: 'captureOnly' }), false);
    assert.equal(decentSyncSaves(true, { served: false, code: 'hardwareMismatch' }), false);
    assert.equal(decentSyncSaves(true, { code: 'somethingNew' }), false, 'an unknown refusal is not a yes');
});

test('while the server cannot be asked, the last answer stands', () => {
    // The plugin goes on saving on the tablet through an outage.
    for (const code of ['unreachable', 'serverTooOld']) {
        assert.equal(decentSyncSaves(true, { served: false, code }), true);
        assert.equal(decentSyncSaves(false, { served: false, code }), false, 'and an outage alone never turns it on');
    }
    // Decaid itself did not answer.
    assert.equal(decentSyncSaves(true, {}), true);
    assert.equal(decentSyncSaves(false, {}), false);
    assert.equal(decentSyncSaves(undefined, {}), false);
});

test('only an answer that says nothing either way is asked for again', () => {
    assert.equal(statusUnknown({ served: false, code: 'unreachable' }), true);
    assert.equal(statusUnknown({ served: false, code: 'serverTooOld' }), true);
    assert.equal(statusUnknown({}), true, 'Decaid itself did not answer');
    // Definite answers, either way.
    assert.equal(statusUnknown({ connected: true, served: true }), false);
    assert.equal(statusUnknown({ served: false, code: 'captureOnly' }), false);
    assert.equal(statusUnknown({ served: false, code: 'hardwareMismatch' }), false);
    assert.equal(statusUnknown(null), false, 'no Decent Sync plugin: nothing to wait for');
});

test('asking again starts at half a minute and slows to five', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 20].map(statusRetryMs), [30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000]);
    assert.equal(statusRetryMs(0), 30_000);
});

test('a plugin Decaid has not loaded yet is asked again within seconds, a few times', () => {
    assert.deepEqual([1, 2, 5, 6, 7].map(tries => statusRetryMs(tries, true)), [3000, 3000, 3000, 300_000, 300_000]);
    assert.equal(statusUnknown({ loading: true }), true, 'it says nothing either way');
    assert.equal(decentSyncSaves(true, { loading: true }), true, 'so the last answer stands, as while the plugin is reloaded');
    assert.equal(shotSource('plugin', { loading: true }), 'plugin');
    assert.equal(shotSource('unknown', { loading: true }), 'unknown', 'and the tablet\'s own choice is not drawn meanwhile');
});

test('only the plugin\'s own word says its server is out of reach', () => {
    assert.equal(serverOutOfReach({ served: false, code: 'unreachable' }), true);
    assert.equal(serverOutOfReach({ served: false, code: 'serverTooOld' }), true);
    for (const answer of [{}, { loading: true }, null, { served: true }, { code: 'captureOnly' }]) assert.equal(serverOutOfReach(answer), false);
});

// ── Where the reference is kept ──────────────────────────────────────────────

const SERVED = { connected: true, served: true, machine: { id: 'm', name: 'Sample Machine' }, location: { id: 'l', name: 'Sample Cafe' } };
// Every refusal docs/PLUGIN.md lists. The status answers the refusal any other
// endpoint would give, so only the first four are expected of it.
const LASTING = ['captureOnly', 'hardwareMismatch', 'noSuchShot', 'noSuchRecipe', 'notAtThisLocation', 'archived', 'recipesUnread', 'shotUnwritten', 'invalidRequest'];
const CANT_ASK = ['unreachable', 'serverTooOld'];

test('a served Machine keeps its reference with Decent Sync', () => {
    for (const previous of ['unknown', 'tablet', 'plugin', undefined]) assert.equal(shotSource(previous, SERVED), 'plugin');
});

test('with no plugin at all the reference is kept on the tablet', () => {
    for (const previous of ['unknown', 'tablet', 'plugin', undefined]) assert.equal(shotSource(previous, null), 'tablet');
});

test('a Capture-only Machine, the wrong hardware, and any other refusal that lasts keep it on the tablet', () => {
    for (const code of [...LASTING, 'somethingNew']) {
        for (const previous of ['unknown', 'tablet', 'plugin']) {
            assert.equal(shotSource(previous, { connected: true, served: false, machine: null, location: null, code, message: 'Sample refusal.' }), 'tablet', code);
        }
    }
});

test('while the server cannot be asked the last answer stands, and before any answer the source is not known', () => {
    for (const answer of [...CANT_ASK.map(code => ({ connected: false, served: false, code })), {}]) {
        assert.equal(shotSource('plugin', answer), 'plugin', 'a served Machine stays with the plugin, which answers from the tablet\'s copy');
        assert.equal(shotSource('tablet', answer), 'tablet');
        assert.equal(shotSource('unknown', answer), 'unknown', 'the tablet\'s own choice is never drawn on a Machine that may be served');
        assert.equal(shotSource(undefined, answer), 'unknown');
    }
});

test('a Machine that turns Capture-only, or is served again, changes source at the next answer', () => {
    let source = 'unknown';
    const seen = [];
    for (const answer of [{ code: 'unreachable' }, SERVED, { code: 'unreachable' }, { code: 'captureOnly' }, {}, SERVED, null]) {
        source = shotSource(source, answer);
        seen.push(source);
    }
    assert.deepEqual(seen, ['unknown', 'plugin', 'plugin', 'tablet', 'tablet', 'plugin', 'tablet']);
});
