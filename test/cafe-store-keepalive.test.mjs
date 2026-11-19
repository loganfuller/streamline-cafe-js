// Which of Decaid's store writes go with `keepalive` (fork issue #74). The
// browser refuses a keepalive request once its body, with the keepalive bodies
// still in flight, passes 64 KiB, so DYE2's whole-list writes go without it;
// setKVValue and deleteKVValue keep it by default, for settingsSync's write
// fired just before the page may navigate away (docs/cafe/UPSTREAM_EDITS.md,
// api.js). Streamline's setValueInStore never sent it.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const source = readFileSync(new URL('../src/modules/api.js', import.meta.url), 'utf8');
const pick = pattern => {
    const match = source.match(pattern);
    assert.ok(match, `api.js has ${pattern}`);
    return match[0].replace('export ', '');
};
const lifted = [
    pick(/export const DYE2_KV_NAMESPACE = .*;/),
    pick(/export async function setKVValue\([^)]*\) \{[\s\S]*?\r?\n\}/),
    pick(/export async function deleteKVValue\([^)]*\) \{[\s\S]*?\r?\n\}/),
    pick(/export async function setDye2KvArray\([^)]*\) \{[\s\S]*?\r?\n\}/),
].join('\n');

function apiWith() {
    const calls = [];
    const fetch = async (url, options = {}) => {
        calls.push({ url, ...options });
        return { ok: true, status: 200, text: async () => '' };
    };
    const api = new Function('fetch', 'API_BASE_URL', `${lifted}\nreturn { setKVValue, deleteKVValue, setDye2KvArray };`)(fetch, 'http://decaid/api/v1');
    return { api, calls };
}

test('DYE2\'s lists are written without keepalive, whatever their size', async () => {
    const { api, calls } = apiWith();
    const rows = Array.from({ length: 14 }, (_, i) => ({ id: `r${i}`, notes: 'x'.repeat(5500) }));
    await api.setDye2KvArray('recipes', rows);
    await api.setDye2KvArray('autoFavourites', []);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'http://decaid/api/v1/store/dye2.reaplugin/recipes');
    assert.equal(calls[0].method, 'POST');
    assert.ok(calls[0].body.length > 64 * 1024, 'the list is over 64 KiB');
    assert.deepEqual(JSON.parse(calls[0].body), rows);
    assert.equal(calls[0].keepalive, false);
    assert.equal(calls[1].keepalive, false);
});

test('setKVValue and deleteKVValue keep keepalive by default, as Streamline sends it', async () => {
    const { api, calls } = apiWith();
    await api.setKVValue('streamline', 'some.setting', 1);
    await api.setKVValue('streamlineCafe', 'view', { mode: 'reference' });
    await api.deleteKVValue('streamline', 'some.setting');
    assert.deepEqual(calls.map(call => call.keepalive), [true, true, true]);
});

test('a write the store refuses still throws without keepalive', async () => {
    const fetch = async () => ({ ok: false, status: 500, text: async () => 'no' });
    const api = new Function('fetch', 'API_BASE_URL', `${lifted}\nreturn { setDye2KvArray };`)(fetch, 'http://decaid/api/v1');
    await assert.rejects(api.setDye2KvArray('recipes', []), /KV setValue failed: 500 no/);
});
