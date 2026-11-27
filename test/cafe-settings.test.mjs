// The Settings page's Cafe category: the skin's first setting of its own
// reaches Streamline's settings navigation through its one source, and each
// hook is marked as the fork's (docs/cafe/DESIGN.md, "Settings";
// docs/cafe/UPSTREAM_EDITS.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SETTINGS_TREE } from '../src/settings/settings-tree.js';
import { CAFE_TRANSLATIONS } from '../src/cafe/translations.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the Cafe category is in the one settings tree, between Miscellaneous and Updates, with one page', () => {
    const keys = Object.keys(SETTINGS_TREE);
    assert.deepEqual(keys.slice(keys.indexOf('miscellaneous'), keys.indexOf('updates') + 1), ['miscellaneous', 'cafe', 'updates']);
    assert.deepEqual(SETTINGS_TREE.cafe, { name: 'Cafe', subcategories: [{ id: 'cafebatches', name: 'Batches', settingsCategory: 'cafe_batches' }] });
    assert.match(read('src/settings/settings-tree.js'), /\/\/ Streamline Cafe: the fork's own category/);
});

test('the shell and the legacy module both mount it from the fork\'s own module', () => {
    const shell = read('src/settings/settings-shell.js');
    assert.match(shell, /\/\/ Streamline Cafe: [^\n]*\n\s*cafe: \(\) => import\('\.\.\/cafe\/cafe-settings\.js'\),/);
    const legacy = read('src/settings/settings.js');
    assert.match(legacy, /\/\/ Streamline Cafe: [^\n]*\n[^\n]*\n\s*const module = category === 'cafe_batches'\n\s*\? await import\('\.\.\/cafe\/cafe-settings\.js'\)/);
    assert.match(legacy, /\|\| category === 'ble_grinder' \|\| category === 'cafe_batches'\) \{\n\s*mountMaintenanceCategory\(category, contentArea\);/);
    assert.match(legacy, /case 'cafe_batches':\n\s*\/\/ Mounted by the extracted category module, not rendered here\.\n\s*return '';/);
    assert.equal([...shell.matchAll(/cafe-settings\.js/g)].length, 1);
    assert.equal([...legacy.matchAll(/cafe-settings\.js/g)].length, 1);
});

test('the navigation names it in the page\'s language, from the fork\'s table', () => {
    const html = read('src/settings/settings.html');
    assert.match(html, /<!-- Streamline Cafe: [^>]*-->\s*<li><button id="cafe-btn" class="settings-nav-btn[^"]*">10\. <span data-i18n-key="Cafe">Cafe<\/span><\/button><\/li>/);
    // Streamline's lookup tries the fork's table for a phrase its own file lacks.
    const i18n = read('src/modules/i18n.js');
    assert.match(i18n, /\/\/ Streamline Cafe: [\s\S]{0,300}export function setTranslationFallback\(lookup\) \{\n\s*fallbackTranslation = lookup;\n\}/);
    assert.match(i18n, /return fallbackTranslation\?\.\(key, currentLanguage\) \|\| key;/);
    assert.match(read('src/cafe/text.js'), /setTranslationFallback\(\(key, language\) => cafeTranslation\(key, language, \(\) => ''\)\);/);
    for (const key of ['Cafe', 'Batches', 'Batch container weight']) assert.ok(CAFE_TRANSLATIONS[key], `${key} is in the fork's table`);
});

test('the page\'s Save writes a changed setting, from the shell and from the legacy module, and leaving drops it', async () => {
    const shell = read('src/settings/settings-shell.js');
    assert.match(shell, /\/\/ Streamline Cafe: [^\n]*\nimport \{ saveCafeSettings \} from '\.\.\/cafe\/cafe-settings-draft\.js';/);
    assert.match(shell, /if \(getSnapshot\(\)\.dirty\) return;\n\s*if \(!await saveCafeSettings\(\)\) return;\n\s*ui\.showToast\('Settings updated'/);
    const legacy = read('src/settings/settings.js');
    assert.match(legacy, /\/\/ Streamline Cafe: [^\n]*\nimport \{ saveCafeSettings \} from '\.\.\/cafe\/cafe-settings-draft\.js';/);
    assert.match(legacy, /await flushPendingChanges\(\);\n\s*if \(!await saveCafeSettings\(\)\) return;\n\s*\} catch \(error\) \{/);
    assert.match(read('src/cafe/cafe-settings-draft.js'), /document\.addEventListener\('streamline:mainpagevisible', \(\) => \{ container = null; \}\);/);
});

test('the category\'s module keeps the setting through the fork\'s one store module, and off the main page\'s first load', () => {
    const module = read('src/cafe/cafe-settings.js');
    assert.match(module, /import \{ readCafe, CONTAINER_KEY \} from '\.\/cafe-store\.js';/);
    assert.doesNotMatch(module, /\bwriteCafe\b/, 'a change waits for the page\'s Save');
    assert.match(read('src/cafe/cafe-settings-draft.js'), /import \{ writeCafe, CONTAINER_KEY \} from '\.\/cafe-store\.js';/);
    assert.match(module, /export async function mountSettingsCategory\(\{ container \}\)/);
    assert.doesNotMatch(module, /data-i18n-key/);
    for (const path of ['index.html', 'src/cafe/start.js', 'src/cafe/page.js', 'src/cafe/bean-dialog.js']) {
        assert.doesNotMatch(read(path), /cafe-settings\.js/, `${path} does not load the Settings category`);
    }
});
