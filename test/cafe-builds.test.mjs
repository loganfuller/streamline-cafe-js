// What each build publishes (docs/cafe/DESIGN.md, "Builds and installs" and
// "The public preview"). A release and the `dist` build ship index.html,
// skin-manifest.json and src/, and nothing in them names the preview or the
// fake Decaid, so neither can reach a tablet. The Pages site is the preview,
// staged by preview/stage.mjs, its skin page made from index.html as staged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import { skinPage, stage } from '../preview/stage.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');
const release = read('.github/workflows/release.yml');
const pages = read('.github/workflows/static.yml');

const SHIPPED = ['index.html', 'skin-manifest.json', 'src'];

function files(dir) {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : [path];
    });
}

// The shell lines of a workflow's `run:` steps that copy files.
const copies = workflow => workflow.split('\n').map(line => line.trim()).filter(line => /(^|[;&|]\s*)(cp|rsync)\s/.test(line));

test('a release and the dist build copy index.html, skin-manifest.json and src, and nothing else', () => {
    const list = release.match(/^\s*for path in ([^;]+); do$/m);
    assert.ok(list, 'release.yml stages its build from one list of paths');
    assert.deepEqual(list[1].trim().split(/\s+/), SHIPPED);
    assert.deepEqual(copies(release), ['cp -r "$path" dist/'], 'the list is the build\'s only copy');
    assert.doesNotMatch(release, /preview|fake-decaid/, 'release.yml names neither the preview nor the fake Decaid');
});

test('nothing a build ships names the preview or the fake Decaid', () => {
    // A file of the preview's, by its path: "preview/" alone is also Decaid's
    // LED preview route and a word in Streamline's comments.
    const needles = ['fake-decaid', ...readdirSync(join(ROOT, 'preview')).map(name => `preview/${name}`)];
    const shipped = SHIPPED.flatMap(path => statSync(join(ROOT, path)).isDirectory() ? files(join(ROOT, path)) : [join(ROOT, path)]);
    assert.ok(shipped.length > 100);
    const naming = [];
    for (const file of shipped) {
        const text = readFileSync(file, 'latin1');
        for (const needle of needles) if (text.includes(needle)) naming.push(`${relative(ROOT, file)} names ${needle}`);
    }
    assert.deepEqual(naming, []);
});

test('the preview\'s skin page is index.html with the stand-in as its first script after the import map, made when the site is staged', () => {
    const html = read('index.html');
    const page = skinPage(html);
    const STAND_IN = /^[ \t]*<script src="preview\/stand-in\.js"><\/script>\n/m;
    assert.equal(page.replace(STAND_IN, ''), html, 'index.html with one line added');
    const at = page.indexOf('preview/stand-in.js');
    const scripts = [...page.matchAll(/<script\b[^>]*>/g)].map(match => ({ tag: match[0], at: match.index }));
    assert.equal(scripts[0].tag, '<script type="importmap">', 'the import map comes first');
    assert.equal(scripts[1].at, page.lastIndexOf('<script', at), 'the stand-in is the first script after it');
    assert.ok(page.indexOf('</script>', scripts[0].at) < scripts[1].at, 'after the import map has closed');
    assert.equal(existsSync(join(ROOT, 'skin.html')), false, 'not kept in the repository');
    assert.equal(existsSync(join(ROOT, 'preview', 'skin.html')), false, 'not kept in the repository');
});

test('the stand-in goes after the import map however the map is closed, and a page it can\'t place it in is refused', () => {
    const page = '<head>\n  <meta charset="UTF-8">\n  <script type="importmap">{"imports":{}}</script> \n  <script>theme()</script>\n</head>\n';
    assert.equal(skinPage(page), page.replace('<script>theme', '<script src="preview/stand-in.js"></script>\n  <script>theme'), 'a one-line map, a space after it');
    const crlf = skinPage(page.replace(/\n/g, '\r\n'));
    assert.ok(crlf.indexOf('stand-in.js') < crlf.indexOf('theme()'), 'CRLF');
    assert.throws(() => skinPage(page.replace('</script> ', '</script><script>x()</script>')), /more on the line that closes its import map/);
    assert.throws(() => skinPage(page.replace('<script type="importmap">{"imports":{}}</script>', '')), /no import map/);
    assert.throws(() => skinPage(page.replace('<meta charset="UTF-8">', '<script>early()</script>')), /a script before its import map/);
    assert.throws(() => skinPage(page + '<script type="importmap">{}</script>\n'), /more than one import map/);
});

test('the Pages site is the preview, staged by its one script', () => {
    assert.match(pages, /^\s*run: node preview\/stage\.mjs _site$/m);
    assert.match(pages, /path: '\.\/_site'/);
    assert.deepEqual(copies(pages), [], 'the workflow copies nothing itself');

    const out = mkdtempSync(join(tmpdir(), 'cafe-pages-'));
    try {
        stage(out);
        assert.deepEqual(readdirSync(out).sort(), ['fake-decaid', 'index.html', 'preview', 'skin.html', 'src']);
        assert.equal(readFileSync(join(out, 'index.html'), 'utf8'), read('preview/index.html'), 'the root is the preview\'s own page');
        assert.equal(readFileSync(join(out, 'skin.html'), 'utf8'), skinPage(read('index.html')));
        assert.deepEqual(readdirSync(join(out, 'preview')).sort(), ['sample-cafe.js', 'stand-in.js'], 'of the preview, only what the page loads');
        const recordings = JSON.parse(read('preview/stand-in.js').match(/const RECORDINGS = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
        const staged = join(out, 'fake-decaid', 'recordings');
        assert.deepEqual(files(staged).map(path => relative(staged, path).split(sep).join('/')).sort(), recordings.map(name => `${name}.json`).sort(), 'the recordings the stand-in starts from');
        assert.deepEqual(readdirSync(join(out, 'fake-decaid')).filter(name => name !== 'recordings').sort(),
            readdirSync(join(ROOT, 'fake-decaid')).filter(name => name.endsWith('.js')).sort(), 'the fake\'s modules');
        assert.equal(files(join(out, 'src')).length, files(join(ROOT, 'src')).length, 'the skin\'s files as they are');
    } finally {
        rmSync(out, { recursive: true, force: true });
    }
});

test('the README links to the public preview, at the Pages site\'s root', () => {
    assert.match(read('README.md').split('\n')[0], /\]\(https:\/\/loganfuller\.github\.io\/streamline-cafe-js\/\)/);
});
