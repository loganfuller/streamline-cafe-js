// Stages the GitHub Pages site: the public preview (docs/cafe/DESIGN.md, "The
// public preview"). The Pages workflow and the preview's page test both run it,
// so the test opens what Pages serves.
//
//   node preview/stage.mjs <folder>     (the workflow stages into _site)
//
// The site's root is the preview's own page (preview/index.html), holding the
// skin's page in a frame. That page, skin.html, is made here from index.html
// with the stand-in added first, so the preview and the skin can't drift; the
// skin's files are served as they are. The plain index.html has no address of
// its own.

import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
// What the stand-in starts the fake from (preview/stand-in.js, RECORDINGS).
const RECORDINGS = ['sample-data', 'boot', 'pour'];
const STAND_IN = '<script src="preview/stand-in.js"></script>';
// The stand-in goes on the line after the import map's: a browser that takes
// no import map once a module has loaded (the stand-in's import() is one)
// would drop a map that came later.
const IMPORT_MAP = '<script type="importmap">';

/** The skin's page with the stand-in as its first script after the import map, from index.html as it is. */
export function skinPage(html) {
    const open = html.indexOf(IMPORT_MAP);
    if (open < 0) throw new Error('index.html has no import map to put the stand-in after');
    if (html.indexOf(IMPORT_MAP, open + 1) >= 0) throw new Error('index.html has more than one import map');
    if (html.slice(0, open).includes('<script')) throw new Error('index.html has a script before its import map');
    // The map ends at the first "</script" after it, as the HTML parser reads it.
    const close = html.indexOf('</script', open);
    const end = close < 0 ? -1 : html.indexOf('>', close);
    const lineEnd = end < 0 ? -1 : html.indexOf('\n', end);
    if (lineEnd < 0) throw new Error('index.html\'s import map has no closing line');
    if (html.slice(end + 1, lineEnd).trim()) throw new Error('index.html has more on the line that closes its import map');
    const lineStart = html.lastIndexOf('\n', close) + 1;
    const indent = html.slice(lineStart).match(/^[ \t]*/)[0];
    const at = lineEnd + 1;
    return `${html.slice(0, at)}${indent}${STAND_IN}\n${html.slice(at)}`;
}

/** Stages the site into `out`, emptied first. Answers the paths staged, relative to it. */
export function stage(out) {
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'index.html'), readFileSync(join(ROOT, 'preview', 'index.html')));
    writeFileSync(join(out, 'skin.html'), skinPage(readFileSync(join(ROOT, 'index.html'), 'utf8')));
    cpSync(join(ROOT, 'src'), join(out, 'src'), { recursive: true });
    mkdirSync(join(out, 'preview'));
    cpSync(join(ROOT, 'preview', 'stand-in.js'), join(out, 'preview', 'stand-in.js'));
    mkdirSync(join(out, 'fake-decaid', 'recordings'), { recursive: true });
    for (const file of readdirSync(join(ROOT, 'fake-decaid'))) {
        if (file.endsWith('.js')) cpSync(join(ROOT, 'fake-decaid', file), join(out, 'fake-decaid', file));
    }
    for (const name of RECORDINGS) {
        cpSync(join(ROOT, 'fake-decaid', 'recordings', `${name}.json`), join(out, 'fake-decaid', 'recordings', `${name}.json`));
    }
    return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const out = resolve(process.argv[2] || '_site');
    stage(out);
    console.log(`Staged the preview into ${out}`);
}
