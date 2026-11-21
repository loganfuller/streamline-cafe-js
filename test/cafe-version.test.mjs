// Streamline Cafe's identity and version scheme (docs/cafe/DESIGN.md, "Identity"
// and "Following Streamline"). The id matters most: Decaid installs a skin into a
// folder named for its id, so a build that still said "streamline.js" would
// replace Streamline on the tablet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { APP_VERSION, SKIN_ID } from '../src/version.js';
import { compareVersions, shouldPromptReload } from '../src/modules/skin-version.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const manifest = JSON.parse(read('../skin-manifest.json'));
const pkg = JSON.parse(read('../package.json'));
const lock = JSON.parse(read('../package-lock.json'));
const release = read('../.github/workflows/release.yml');

// The Streamline version the build contains, plus a counter that starts at 1.
const CAFE_VERSION = /^\d+\.\d+\.\d+-cafe\.[1-9]\d*$/;

// A `main` build's version, as release.yml stamps it.
const distStamp = (run, sha) => `${APP_VERSION}.dev.${run}.${sha}`;

test('the skin is Streamline Cafe under its own id', () => {
    assert.equal(SKIN_ID, 'streamline-cafe.js');
    assert.equal(manifest.id, 'streamline-cafe.js');
    assert.equal(manifest.name, 'Streamline Cafe');
});

test('one version everywhere: the Streamline version plus a cafe counter', () => {
    assert.match(APP_VERSION, CAFE_VERSION);
    assert.equal(manifest.version, APP_VERSION);
    assert.equal(pkg.version, APP_VERSION);
    assert.equal(lock.version, APP_VERSION);
    assert.equal(lock.packages[''].version, APP_VERSION);
});

test('cafe versions order by Streamline version, then by counter', () => {
    assert.equal(compareVersions('0.2.27-cafe.2', '0.2.27-cafe.1'), 1);
    assert.equal(compareVersions('0.2.27-cafe.10', '0.2.27-cafe.9'), 1);
    assert.equal(compareVersions('0.2.28-cafe.1', '0.2.27-cafe.9'), 1);
    assert.equal(compareVersions('0.2.27-cafe.1', '0.2.27-cafe.1'), 0);
});

test('a main build orders by run number, after the release it is built on', () => {
    assert.equal(compareVersions(distStamp(13, 'aaaaaaa'), distStamp(12, 'fffffff')), 1);
    assert.equal(compareVersions(distStamp(100, '0000000'), distStamp(99, 'fffffff')), 1);
    assert.equal(compareVersions(distStamp(1, 'abc1234'), APP_VERSION), 1);
});

test('a running main build offers a reload only for a later main build on disk', () => {
    const older = distStamp(12, 'fffffff');
    const newer = distStamp(13, 'aaaaaaa');
    assert.equal(shouldPromptReload({ running: older, disk: newer }), true);
    assert.equal(shouldPromptReload({ running: newer, disk: older }), false);
    assert.equal(shouldPromptReload({ running: newer, disk: newer }), false);
});

test('the release workflow builds only under the cafe ids', () => {
    assert.doesNotMatch(release, /"streamline\.js(-dist)?"/);
    assert.match(release, /\.id = "streamline-cafe\.js-dist"/);
    assert.match(release, /\.id == "streamline-cafe\.js" or \.id == "streamline-cafe\.js-dist"/);
    // The main build looks itself up by its own id, and its stamp has no second "-".
    assert.match(release, /SKIN_ID = 'streamline-cafe\.js-dist'/);
    assert.doesNotMatch(release, /SKIN_ID = 'streamline\.js(-dist)?'/, 'Streamline\'s own stamp, on the same line from v0.2.29, would run after the fork\'s and win');
    assert.match(release, /dev="\$\{base\}\.dev\./);
});
