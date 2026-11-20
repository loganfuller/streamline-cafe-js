// The weekly run's pins: fake-decaid/pins.json with Decaid, DYE2 and Decent
// Sync moved to their newest stable releases (GitHub's "latest", which is never
// a pre-release or a draft), each release file with the checksum GitHub gives
// it. Streamline stays at its pin: the skin is built on it. Writes the file
// named, for FAKE_DECAID_PINS (docs/cafe/TESTING.md, "The weekly run").
//
//   node scripts/fake-decaid-recorder/latest-pins.mjs <out.json>
//
// GITHUB_TOKEN, where set, is sent with GitHub's API requests.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ROOT } from './stack.mjs';

const out = process.argv[2];
if (!out) throw new Error('usage: latest-pins.mjs <out.json>');
const pins = JSON.parse(await readFile(join(ROOT, 'fake-decaid', 'pins.json'), 'utf8'));

async function latest(repo) {
    const headers = { Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
    if (!res.ok) throw new Error(`${repo}'s latest release: ${res.status}`);
    const release = await res.json();
    if (release.prerelease || release.draft) throw new Error(`${repo}'s latest release ${release.tag_name} is not a stable one`);
    const file = name => {
        const found = release.assets.find(a => a.name === name);
        if (!found) throw new Error(`${repo} ${release.tag_name} has no ${name}`);
        if (!/^sha256:[0-9a-f]{64}$/.test(found.digest || '')) throw new Error(`${repo} ${release.tag_name}: GitHub gives ${name} no sha256`);
        return { name, sha256: found.digest.slice('sha256:'.length) };
    };
    return { version: release.tag_name.replace(/^v/, ''), file };
}

const decaid = await latest(pins.decaid.repo);
const dye2 = await latest(pins.dye2.repo);
const sync = await latest(pins.decentSync.repo);
const image = pins.decentSync.image.replace(/:[^:/]+$/, `:${sync.version}`);

const written = {
    about: `The weekly run's pins: the newest stable releases on ${new Date().toISOString().slice(0, 10)}, written by scripts/fake-decaid-recorder/latest-pins.mjs. Not committed.`,
    decaid: { ...pins.decaid, version: decaid.version, assets: { arm64: decaid.file(`decaid-linux-arm64-${decaid.version}.tar.gz`), x64: decaid.file(`decaid-linux-x64-${decaid.version}.tar.gz`) } },
    dye2: { ...pins.dye2, version: dye2.version, asset: dye2.file(`dye2.reaplugin-v${dye2.version}.zip`) },
    decentSync: { ...pins.decentSync, version: sync.version, image, asset: sync.file(`decent-sync.reaplugin-v${sync.version}.zip`) },
    streamline: pins.streamline,
};
await writeFile(out, `${JSON.stringify(written, null, 2)}\n`);
const moved = ['decaid', 'dye2', 'decentSync'].map(key => `${key} ${pins[key].version}${written[key].version === pins[key].version ? '' : ` → ${written[key].version}`}`);
console.log(`latest stable: ${moved.join(', ')}`);
