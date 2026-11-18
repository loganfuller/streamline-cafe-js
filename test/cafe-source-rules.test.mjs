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
    // The list is the seam's page, read by the list's dialog, and its first
    // page by the barista's, for the names on recent Shots; a Shot by its id
    // is the seam's too, read by the graph alone, for an opened Shot.
    assert.deepEqual(filesWith(/\bshotsPage\b[^;]*from '\.\/shot-seam\.js'/), ['barista-dialog.js', 'shots-dialog.js']);
    assert.match(SOURCES.find(({ name }) => name === 'barista-dialog.js').text, /\bshotsPage\(null, PAGE_SIZE\)/, 'the first page only');
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
    assert.deepEqual(filesWith(/\bupdateWorkflow\b/), ['barista-dialog.js', 'basket-dialog.js', 'bean-dialog.js', 'grinder-dialog.js', 'profile-changer.js']);
    const writes = name => [...SOURCES.find(source => source.name === name).text.matchAll(/\bupdateWorkflow\(([^)]*)\)/g)].map(match => match[1]);
    assert.deepEqual(writes('grinder-dialog.js'), ["patch, 'cafe.grinder'"]);
    // A batch goes through Streamline's own bean writer, as its bean picker writes one.
    assert.deepEqual(writes('bean-dialog.js'), ["patch, 'beans.select'"]);
    assert.deepEqual(writes('basket-dialog.js'), ["patch, 'cafe.basket'"]);
    // The profile is the one choice that writes a record too, and only before
    // its one Workflow write (the test below).
    assert.deepEqual(writes('profile-changer.js'), ["patch, 'cafe.profile'"]);
    // The barista's pick and the clear as the machine sleeps, each through the
    // page's write, which waits for a dial-in change still on its way.
    assert.deepEqual(writes('barista-dialog.js'), ["patch, 'cafe.barista'", "patch, 'cafe.barista'"]);
    const barista = SOURCES.find(source => source.name === 'barista-dialog.js').text;
    assert.equal([...barista.matchAll(/await write\(/g)].length, 2, 'both writes go through write()');
    for (const name of ['grinder-dialog.js', 'grinder-model.js', 'bean-dialog.js', 'bean-model.js', 'basket-dialog.js', 'basket-model.js', 'barista-dialog.js', 'barista-model.js', 'profile-dialog.js', 'profile-model.js', 'pick-dialog.js']) {
        const { text } = SOURCES.find(source => source.name === name);
        assert.doesNotMatch(text, /from '\.\/(recipe-writer|recipe-write|arrange)\.js'|save-recipe|\/record\b|setDye2Kv|setKVValue/, name);
    }
});

test('the profile is the one choice saved onto a DYE2 record, through the one writer', () => {
    // DYE2 unloads a recipe whose Workflow moves to a profile its record does
    // not hold, so the record takes the profile first (profile-change.js).
    assert.deepEqual(filesWith(/from '\.\/recipe-writer\.js'/), ['arrange.js', 'profile-changer.js']);
    const changer = SOURCES.find(({ name }) => name === 'profile-changer.js').text;
    assert.match(changer, /import \{ setRecipeFields \} from '\.\/recipe-writer\.js';/);
    assert.match(changer, /saveRecord: setRecipeFields,/);
    assert.deepEqual(filesWith(/\bsetRecipeFields\b/), ['profile-changer.js', 'recipe-writer.js']);
    // What it decides is worked out where no browser global is touched (the
    // modules imported below, at load), and reaches Decaid, DYE2 and Streamline
    // only through what profile-changer.js hands it.
    const model = SOURCES.find(({ name }) => name === 'profile-change.js').text;
    assert.deepEqual([...model.matchAll(/^import .* from '([^']+)';$/gm)].map(match => match[1]), ['../modules/dye-selection.js', './recipe-name.js']);
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

test('the Grind row\'s hook is still in ui.js', () => {
    // A preset's name shows as it is, a number to the step's places, and − and +
    // step nothing from a row that holds no number (#42).
    const ui = readFileSync(new URL('../src/modules/ui.js', import.meta.url), 'utf8');
    assert.match(ui, /^import \{ grindText, grindNumber \} from '\.\.\/cafe\/grind-text\.js';$/m);
    assert.match(ui, /export function updateGrindDisplay\(grinderData\) \{[^}]*grindValueEl\.textContent = grindText\(grindValue, grindStepNow\(\)\);/);
    assert.match(ui, /\(val\) => grindText\(val, grindStepNow\(\)\),\s*updateGrindValue, undefined, \(\) => workflowGrinderRange\.max, grindNumber\);/, 'the Grind row\'s − and + paint as a read does, and read its number strictly');
    assert.match(ui, /export function setGrinderGrindStep\(step\) \{[^}]*repaintGrindNumber\(\); \}/, 'a connected grinder\'s step repaints the number');
    assert.match(ui, /export function setWorkflowGrindStep\(step\) \{[^}]*repaintGrindNumber\(\); \}/, 'the Workflow grinder\'s step repaints the number');
    assert.equal(ui.match(/let currentValue = readValue\(valueEl\);\s*if \(currentValue === null\) return;/g)?.length, 2, 'and − and + both step nothing from no number');
});

test('no module opens one of DYE2\'s pages', () => {
    // The page never leaves for DYE2's editor: recipes are made, chosen and
    // taken out of a slot here.
    assert.deepEqual(filesWith(/\bopenPluginOverlay\b|recipe-edit|\bopenGrinderSurface\b|grinder-picker/), []);
});

test('DYE2\'s selection is cleared in one place, after Streamline\'s strip module is told', () => {
    // Every request to DYE2's selection but a read is in arrange.js: the
    // unload's, which a tap on the loaded card and a recipe leaving its slot
    // both go through, and the check after a profile change marking its recipe
    // loaded again. unloadSelection calls forgetAppliedItem before the post
    // (test/cafe-recipe-loader.test.mjs); this keeps the post inside it, and
    // markLoaded's after its own call.
    const posts = SOURCES.flatMap(({ name, text }) => [...text.matchAll(/callPluginEndpoint\(\s*DYE2_PLUGIN_ID\s*,\s*'selection'\s*,([^)]*)\)/g)]
        .filter(match => !/'GET'/.test(match[1])).map(() => name));
    assert.deepEqual(posts, ['arrange.js', 'arrange.js']);
    const arrange = SOURCES.find(({ name }) => name === 'arrange.js').text;
    assert.match(arrange, /unloadSelection\(\{ forget: forgetAppliedItem, post: \(\) => callPluginEndpoint\(DYE2_PLUGIN_ID, 'selection', \{\}\) \}\)/);
    assert.match(arrange, /export async function markLoaded\(recipeId\) \{\n    forgetAppliedItem\(\);\n    await callPluginEndpoint\(DYE2_PLUGIN_ID, 'selection', \{ kind: 'recipe', id: recipeId \}\);\n\}/);
    assert.deepEqual(filesWith(/\bmarkLoaded\b/), ['arrange.js', 'profile-change.js', 'profile-changer.js']);
    assert.deepEqual(filesWith(/\bunloadSelection\b/), ['arrange.js', 'recipe-loader.js']);
    assert.deepEqual(filesWith(/\bclearSelection\b/), ['arrange.js', 'strip.js']);
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
    // And the one in its applyRecipe: a recipe load keeps the barista
    // (test/cafe-barista-apply.test.mjs runs it).
    assert.match(strip, /\n    delete patch\.context\.baristaName;\n    const seq = \+\+applySeq;\n    await withAutoSaveSuppressed\(\(\) => updateWorkflow\(patch, 'dye\.applyRecipe'\)\);/,
        'the barista hook is still in applyRecipe after a merge of Streamline');
});

test('the machine seen asleep is announced from the one socket, and clears the barista', () => {
    // The fork's hook in api.js, beside Streamline's own espresso-start: the
    // first frame from a sleeping machine is seen too, as previousMachineState
    // starts out null.
    const api = readFileSync(new URL('../src/modules/api.js', import.meta.url), 'utf8');
    assert.match(api, /if \(stateValue === 'sleeping' && previousMachineState !== 'sleeping'\) document\.dispatchEvent\(new Event\('streamline:machine-asleep'\)\);/);
    assert.match(api, /let previousMachineState = null;/);
    // page.js clears the name; pick-dialog.js closes an open dialog, which
    // would sit over the screensaver.
    assert.deepEqual(filesWith(/streamline:machine-asleep/), ['page.js', 'pick-dialog.js']);
    assert.match(SOURCES.find(({ name }) => name === 'page.js').text,
        /addEventListener\('streamline:machine-asleep', clearAsleep\);[\s\S]*getMachineState\(\).then\(snapshot => \{ if \(asleep\(snapshot\)\) clearAsleep\(\); \}\)/,
        'and the state read once at start, for a page opened on a sleeping machine');
    assert.match(SOURCES.find(({ name }) => name === 'pick-dialog.js').text,
        /addEventListener\('streamline:machine-asleep', drop\);/, 'and an open dialog closes, as on a shot');
});

test('the barista lives in the Workflow alone', () => {
    // No copy in the page's own store, or in the browser's: DYE2's dashboard
    // field and the page then always agree.
    for (const name of ['barista-dialog.js', 'barista-model.js']) {
        const { text } = SOURCES.find(source => source.name === name);
        assert.doesNotMatch(text, /localStorage|sessionStorage|indexedDB|writeCafe|setKVValue/, name);
    }
    assert.doesNotMatch(SOURCES.find(({ name }) => name === 'cafe-store.js').text, /barista/i);
});

test('the profile dialog changes the profile through changeProfile alone', () => {
    // The record first, then the Workflow, both in profile-changer.js: the
    // dialog adds no write of a DYE2 record or of the Workflow.
    assert.deepEqual(filesWith(/\bchangeProfile\(/), ['profile-changer.js', 'profile-dialog.js']);
    assert.deepEqual(filesWith(/from '\.\/profile-changer\.js'/), ['page.js', 'profile-dialog.js']);
    const dialog = SOURCES.find(source => source.name === 'profile-dialog.js').text;
    assert.deepEqual([...dialog.matchAll(/\bchangeProfile\(([^)]*)\)/g)].map(match => match[1]), ['row.id, { recipeId: named }']);
    for (const name of ['profile-dialog.js', 'profile-model.js']) {
        const { text } = SOURCES.find(source => source.name === name);
        assert.doesNotMatch(text, /\b(updateWorkflow|putWorkflow|sendProfile|setActiveProfile|setRecipeFields|markLoaded|callPluginEndpoint)\b/, name);
    }
});

test('no module writes Streamline\'s strip mode', () => {
    assert.deepEqual(filesWith(/\bsetStripMode\b|dyeStripMode/), []);
});

test('the modules the page\'s decisions live in touch no browser global at load', async () => {
    assert.equal(typeof globalThis.window, 'undefined');
    assert.equal(typeof globalThis.document, 'undefined');
    for (const name of ['recipe-write.js', 'slot-menu.js', 'translations.js', 'shot-model.js', 'shot-list.js', 'tablet-shots.js', 'plugin-shots.js', 'shot-sources.js', 'sync-status.js', 'reference-overlay.js', 'comparison.js', 'stage-names.js', 'remarks.js', 'graph-state.js', 'grinder-model.js', 'bean-model.js', 'basket-model.js', 'barista-model.js', 'page-model.js', 'recipe-name.js', 'profile-change.js', 'profile-model.js']) {
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
