// The start-up check and the "DYE2 is needed" screen's wording
// (docs/cafe/DESIGN.md, "Recipes and the strip").
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dye2Gate, gateScreen, MIN_DYE2_VERSION, DYE2_PLUGIN_ID } from '../src/cafe/dye2-gate.js';

const dye2 = (over = {}) => ({ id: DYE2_PLUGIN_ID, version: MIN_DYE2_VERSION, loaded: true, ...over });
const others = [{ id: 'decent-sync.reaplugin', version: '1.10.0', loaded: true }];

test('the page may start when DYE2 is installed, loaded, new enough and switched on', () => {
    assert.equal(dye2Gate({ plugins: [...others, dye2()], enabled: true }), null);
    assert.equal(dye2Gate({ plugins: [dye2({ version: '0.2.0' })], enabled: true }), null);
    assert.equal(dye2Gate({ plugins: [dye2({ version: 'v0.1.41' })], enabled: true }), null);
});

test('each failing check has its own reason', () => {
    assert.equal(dye2Gate({ plugins: others, enabled: true }), 'not-installed');
    assert.equal(dye2Gate({ plugins: [], enabled: true }), 'not-installed');
    assert.equal(dye2Gate({ plugins: [dye2({ loaded: false })], enabled: true }), 'not-loaded');
    assert.equal(dye2Gate({ plugins: [dye2({ version: '0.1.39' })], enabled: true }), 'outdated');
    assert.equal(dye2Gate({ plugins: [dye2()], enabled: false }), 'setting-off');
});

test('the first failing check decides: installed, loaded, version, then the setting', () => {
    // Everything wrong at once names the plugin, not the setting.
    assert.equal(dye2Gate({ plugins: others, enabled: false }), 'not-installed');
    assert.equal(dye2Gate({ plugins: [dye2({ loaded: false, version: '0.1.0' })], enabled: false }), 'not-loaded');
    assert.equal(dye2Gate({ plugins: [dye2({ version: '0.1.0' })], enabled: false }), 'outdated');
});

test('a version DYE2 does not state, or a pre-release of the floor, is too old', () => {
    assert.equal(dye2Gate({ plugins: [dye2({ version: undefined })], enabled: true }), 'outdated');
    assert.equal(dye2Gate({ plugins: [dye2({ version: `${MIN_DYE2_VERSION}-beta.1` })], enabled: true }), 'outdated');
});

test('a plugin list that could not be read names nothing as missing', () => {
    // Nothing is known about the plugin, so only the setting decides.
    for (const plugins of [null, undefined, { error: 'unreachable' }]) {
        assert.equal(dye2Gate({ plugins, enabled: true }), null);
        assert.equal(dye2Gate({ plugins, enabled: false }), 'setting-off');
    }
});

test('the screen says which is missing, and offers the way out that fits', () => {
    assert.equal(gateScreen('not-installed').line, "DYE2 isn't installed");
    assert.equal(gateScreen('not-loaded').line, 'DYE2 is installed but not loaded');
    assert.equal(gateScreen('outdated').line, 'DYE2 is older than v{version}');
    assert.deepEqual(gateScreen('outdated').vars, { version: '0.1.40' });
    assert.equal(gateScreen('setting-off').line, 'DYE2 is turned off in Settings');

    // The setting is the skin's to turn on. The plugin is Decaid's to install.
    assert.deepEqual(gateScreen('setting-off'), {
        line: 'DYE2 is turned off in Settings', vars: { version: MIN_DYE2_VERSION }, turnOn: true, hint: null,
    });
    for (const reason of ['not-installed', 'not-loaded', 'outdated']) {
        const screen = gateScreen(reason);
        assert.equal(screen.turnOn, false);
        assert.equal(screen.hint, 'Install or update DYE2 in Decaid, under Plugins.');
    }
});

test('the version in the line is the floor the check uses', () => {
    const { line, vars } = gateScreen('outdated');
    assert.ok(line.endsWith('v{version}'));
    assert.equal(vars.version, MIN_DYE2_VERSION);
});
