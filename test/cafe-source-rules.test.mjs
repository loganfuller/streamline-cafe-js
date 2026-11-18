// What the modules under src/cafe/ may write, read off their source
// (docs/cafe/DESIGN.md, "Writing DYE2's records" and "Settings").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const CAFE_DIR = new URL('../src/cafe/', import.meta.url);
const SOURCES = readdirSync(CAFE_DIR).filter(name => name.endsWith('.js'))
    .map(name => ({ name, text: readFileSync(new URL(name, CAFE_DIR), 'utf8') }));

const filesWith = pattern => SOURCES.filter(({ text }) => pattern.test(text)).map(({ name }) => name);

test('one module writes DYE2\'s recipe records', () => {
    assert.deepEqual(filesWith(/\bsetDye2KvArray\b/), ['recipe-writer.js']);
});

test('no module reaches Decaid\'s store, or anything else, around api.js', () => {
    // A request of a module's own could write DYE2's records without the writer.
    assert.deepEqual(filesWith(/\bfetch\s*\(|\bXMLHttpRequest\b|\bsendBeacon\b|\bsetValueInStore\b/), []);
});

test('one module writes Decaid\'s store by key, in the streamlineCafe namespace', () => {
    // The page's own state: the choice of reference and the graph's view.
    assert.deepEqual(filesWith(/\b(setKVValue|deleteKVValue)\b/), ['cafe-store.js']);
    const store = SOURCES.find(({ name }) => name === 'cafe-store.js').text;
    assert.match(store, /const NAMESPACE = 'streamlineCafe';/);
    assert.deepEqual([...store.matchAll(/\b[gs]etKVValue\(([^,)]*)/g)].map(match => match[1]), ['NAMESPACE', 'NAMESPACE'], 'and reads and writes no other namespace');
});

test('the page reads Shots and the choice of reference through the Shot seam only', () => {
    assert.deepEqual(filesWith(/\bgetShots?\b|\bgetLatestShotSummary\b|\bgetShotIds\b/), ['shot-seam.js']);
    assert.deepEqual(filesWith(/\bREFERENCES_KEY\b/), ['cafe-store.js', 'shot-seam.js']);
    assert.deepEqual(filesWith(/from '\.\/tablet-shots\.js'/), ['shot-seam.js']);
    assert.deepEqual(filesWith(/from '\.\/plugin-shots\.js'/), ['shot-seam.js']);
    assert.deepEqual(filesWith(/from '\.\/shot-sources\.js'/), ['shot-seam.js']);
    assert.deepEqual(filesWith(/from '\.\.\/modules\/idb\.js'/), [], 'Streamline\'s shot cache is not a source');
});

test('the Shots list and a Shot by its id are read through the seam only', () => {
    // The list is the seam's page, read by the list's dialog alone; a Shot by
    // its id is the seam's too, read by the graph alone, for an opened Shot.
    assert.deepEqual(filesWith(/\bshotsPage\b[^;]*from '\.\/shot-seam\.js'/), ['shots-dialog.js']);
    assert.deepEqual(filesWith(/\bshotById\b[^;]*from '\.\/shot-seam\.js'/), ['graph.js']);
    assert.deepEqual(filesWith(/\bopenShot\b[^;]*from '\.\/graph\.js'/), ['shots-dialog.js'], 'and a Shot is opened only by the graph, told by the list');
});

test('a grinder\'s Shots are read through the seam only, by the grinder dialog', () => {
    // The setting a grinder was last used at comes from this tablet's own
    // Shots, on a served Machine too: the seam asks the tablet source alone.
    assert.deepEqual(filesWith(/\bgrinderShots\b[^;]*from '\.\/shot-seam\.js'/), ['grinder-dialog.js']);
    assert.deepEqual(filesWith(/\bgrinderShots\b/), ['grinder-dialog.js', 'shot-seam.js', 'shot-sources.js', 'tablet-shots.js']);
    const sources = SOURCES.find(({ name }) => name === 'shot-sources.js').text;
    assert.match(sources, /grinderShots: \(grinderId, limit\) => tablet\.grinderShots\(grinderId, limit\),/);
});

test('a choice in a pick dialog writes the Workflow, through its own writer, and no DYE2 record', () => {
    // Decent Sync records the Recipe's grinder, and a batch of its own Bean,
    // from the Workflow, and DYE2 saves the basket when the plugin asks it to
    // save the dial-in; the skin writes nothing onto a recipe for a choice,
    // with Decent Sync or without.
    assert.deepEqual(filesWith(/\bupdateWorkflow\b/), ['basket-dialog.js', 'bean-dialog.js', 'grinder-dialog.js']);
    const writes = name => [...SOURCES.find(source => source.name === name).text.matchAll(/\bupdateWorkflow\(([^)]*)\)/g)].map(match => match[1]);
    assert.deepEqual(writes('grinder-dialog.js'), ["patch, 'cafe.grinder'"]);
    // A batch goes through Streamline's own bean writer, as its bean picker writes one.
    assert.deepEqual(writes('bean-dialog.js'), ["patch, 'beans.select'"]);
    assert.deepEqual(writes('basket-dialog.js'), ["patch, 'cafe.basket'"]);
    for (const name of ['grinder-dialog.js', 'grinder-model.js', 'bean-dialog.js', 'bean-model.js', 'basket-dialog.js', 'basket-model.js', 'pick-dialog.js']) {
        const { text } = SOURCES.find(source => source.name === name);
        assert.doesNotMatch(text, /from '\.\/(recipe-writer|recipe-write|arrange)\.js'|save-recipe|\/record\b|setDye2Kv|setKVValue/, name);
    }
});

test('the Shot seam\'s edit is the page\'s only way to change a Shot', () => {
    // Decaid's own Shot edit, and its delete, are named by the seam alone.
    assert.deepEqual(filesWith(/\b(updateShot|deleteShot)\b/), ['shot-seam.js', 'tablet-shots.js']);
    const tablet = SOURCES.find(({ name }) => name === 'tablet-shots.js').text;
    assert.doesNotMatch(tablet, /^import .*modules\/api\.js/m, 'the tablet source is handed Decaid\'s edit by the seam');
    // The plugin's edit is sent by the one module that speaks to the plugin.
    assert.deepEqual(filesWith(/shot\?id=/), ['decent-sync.js']);
    assert.deepEqual(filesWith(/\beditPluginShot\b/), ['shot-seam.js']);
    // And the page reaches either only through the seam.
    assert.deepEqual(filesWith(/\beditShot\b[^;]*from '\.\/shot-seam\.js'/), ['graph.js']);
});

test('one module speaks to Decent Sync\'s plugin', () => {
    // Its Status request has two readers, the dial-in label and the Shot seam,
    // and its Reference Shot is read and chosen through the seam alone.
    assert.deepEqual(filesWith(/decent-sync\.reaplugin/), ['decent-sync.js']);
    assert.deepEqual(filesWith(/\bconnectPluginMessages\b|\bconnectPluginPush\b|\bWebSocket\b/), ['decent-sync.js'], 'and one socket, through api.js');
    assert.deepEqual(filesWith(/from '\.\/decent-sync\.js'/), ['page.js', 'shot-seam.js']);
    assert.deepEqual(filesWith(/\b(readReference|chooseReference|onPush)\b/), ['decent-sync.js', 'plugin-shots.js', 'shot-seam.js']);
});

test('one module names the plugin\'s `shots` and `shot` requests', () => {
    // The Location's list and a Shot whole: the endpoints are named in
    // decent-sync.js alone, and handed to the plugin source by the seam.
    assert.deepEqual(filesWith(/[`'"]shots?\?/), ['decent-sync.js']);
    assert.deepEqual(filesWith(/\b(listLocationShots|readLocationShot)\b/), ['shot-seam.js']);
    const sync = SOURCES.find(({ name }) => name === 'decent-sync.js').text;
    assert.match(sync, /export function listShots\(cursor, limit\) \{/);
    assert.match(sync, /export function readShot\(shotId\) \{/);
    // Whether a row is this machine's or its Location's is asked nowhere above the seam.
    for (const name of ['shots-dialog.js', 'graph.js', 'graph-state.js']) {
        const { text } = SOURCES.find(source => source.name === name);
        assert.doesNotMatch(text, /from '\.\/(tablet-shots|plugin-shots|shot-sources|sync-status|decent-sync)\.js'/, name);
    }
});

test('the fork\'s hooks are still in Streamline\'s chart, renderer and api modules', () => {
    const chart = readFileSync(new URL('../src/modules/chart.js', import.meta.url), 'utf8');
    assert.match(chart, /export function setChartOverlay\(overlay\) \{/);
    assert.match(chart, /export function setShotChooser\(chooser\) \{/);
    assert.match(chart, /const drawn = traces === chartTraces \? withCafeOverlay\(traces, layout, mode, 'main'\) : \{ traces, layout \};/, 'the overlay is on the chart\'s own lines only');
    assert.match(chart, /const \{ traces, layout \} = withCafeOverlay\(own, expandedLayout\(currentTheme, own, expandedXRange\(mode, own\)\), mode, 'expanded'\);/, 'and on the full-screen chart');
    assert.match(chart, /yref: 'paper',\s*name: stepName,/, 'a stage line keeps its step\'s name');
    const renderer = readFileSync(new URL('../src/modules/echarts-renderer.js', import.meta.url), 'utf8');
    assert.match(renderer, /function cafeShapeLabel\(shape\) \{/);
    assert.match(renderer, /\.\.\.cafeShapeLabel\(shape\)/, 'and the renderer writes a stage line\'s name');
    assert.match(chart, /export function plotHistoricalShot\(measurements, workflow = null\) \{\s*if \(cafeShotChooser && !cafeShotChooser\(measurements, workflow\)\) return;/);
    const api = readFileSync(new URL('../src/modules/api.js', import.meta.url), 'utf8');
    assert.match(api, /export async function getShot\(id\) \{/);
    assert.match(api, /export function connectPluginMessages\(pluginId, endpoint, onMessage, onOpen\) \{/);
});

test('no module opens one of DYE2\'s pages', () => {
    // The page never leaves for DYE2's editor: recipes are made, chosen and
    // taken out of a slot here.
    assert.deepEqual(filesWith(/\bopenPluginOverlay\b|recipe-edit|\bopenGrinderSurface\b|grinder-picker/), []);
});

test('Streamline\'s strip module is asked for three things only', () => {
    // Its apply, its start, and the one hook the fork added to it.
    const names = new Set();
    for (const { text } of SOURCES) {
        for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/modules\/dyeStrip\.js'/g)) {
            for (const name of match[1].split(',')) names.add(name.trim());
        }
    }
    assert.deepEqual([...names].sort(), ['applyRecipe', 'forgetAppliedItem', 'initDyeStrip']);
    const strip = readFileSync(new URL('../src/modules/dyeStrip.js', import.meta.url), 'utf8');
    assert.match(strip, /export function forgetAppliedItem\(\) \{\s*applySeq\+\+;/, 'the hook is still in dyeStrip.js after a merge of Streamline');
});

test('no module writes Streamline\'s strip mode', () => {
    assert.deepEqual(filesWith(/\bsetStripMode\b|dyeStripMode/), []);
});

test('the modules the page\'s decisions live in touch no browser global at load', async () => {
    assert.equal(typeof globalThis.window, 'undefined');
    assert.equal(typeof globalThis.document, 'undefined');
    for (const name of ['recipe-write.js', 'slot-menu.js', 'translations.js', 'shot-model.js', 'shot-list.js', 'tablet-shots.js', 'plugin-shots.js', 'shot-sources.js', 'sync-status.js', 'reference-overlay.js', 'comparison.js', 'stage-names.js', 'remarks.js', 'graph-state.js', 'grinder-model.js', 'bean-model.js', 'basket-model.js', 'page-model.js']) {
        await assert.doesNotReject(import(new URL(name, CAFE_DIR)), name);
    }
});

test('the graph\'s Shot is assigned only from what graph-state.js answers', () => {
    // graph.js keeps the module's state whole: it never sets the Shot in the
    // graph, its reference or its rating and note itself.
    const graph = SOURCES.find(({ name }) => name === 'graph.js').text;
    assert.deepEqual([...graph.matchAll(/\bstate\s*=(?!=)[^;]*/g)].map(match => match[0]), ['state = initialGraphState()', 'state = step.state', 'state = initialGraphState({ live: !!window.app?.isShotActive?.() })']);
    assert.doesNotMatch(graph, /\b(latest|reference|remarks|recipe|live|settling|handed)\s*=(?!=)/);
    assert.doesNotMatch(graph, /\bstate\.\w+\s*=(?!=)/);
});
