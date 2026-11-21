// The real stack's release downloads (scripts/fake-decaid-recorder/stack.mjs,
// `asset`). The journeys stand two stacks up at once, so two asks for the same
// file arrive together; each used to download it and write it in place, and one
// could hash the file while the other was rewriting it (a "sha256 …, pinned …"
// failure with the release unchanged).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cache = mkdtempSync(join(tmpdir(), 'fake-decaid-asset-'));
process.env.FAKE_DECAID_CACHE = cache;
const { asset } = await import('../scripts/fake-decaid-recorder/stack.mjs');

const BODY = Buffer.alloc(4 * 1024 * 1024, 7);
const SUM = createHash('sha256').update(BODY).digest('hex');

// A fetch that answers BODY after a pause, counting its calls.
function slowFetch() {
    const calls = [];
    const fetch = async url => {
        calls.push(url);
        await new Promise(resolve => setTimeout(resolve, 20));
        return new Response(BODY);
    };
    return { fetch, calls };
}

test.after(() => rmSync(cache, { recursive: true, force: true }));

test('two asks at once for the same asset download it once and both get the pinned file', async t => {
    const { fetch, calls } = slowFetch();
    t.mock.method(globalThis, 'fetch', fetch);
    const pin = { name: 'together.zip', sha256: SUM };
    const paths = await Promise.all([asset('o/r', 'v1', pin), asset('o/r', 'v1', pin)]);
    assert.equal(calls.length, 1);
    assert.equal(paths[0], paths[1]);
    assert.equal(createHash('sha256').update(readFileSync(paths[0])).digest('hex'), SUM);
    assert.deepEqual(readdirSync(cache).filter(name => name.startsWith('together.zip')), ['together.zip']);
});

test('a file in the cache that does not match its pin is downloaded again', async t => {
    writeFileSync(join(cache, 'stale.zip'), 'half a download');
    const { fetch, calls } = slowFetch();
    t.mock.method(globalThis, 'fetch', fetch);
    const path = await asset('o/r', 'v1', { name: 'stale.zip', sha256: SUM });
    assert.equal(calls.length, 1);
    assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), SUM);
});

test('a download that does not match its pin fails and leaves nothing under its name', async t => {
    const { fetch } = slowFetch();
    t.mock.method(globalThis, 'fetch', fetch);
    await assert.rejects(asset('o/r', 'v1', { name: 'wrong.zip', sha256: '0'.repeat(64) }), /wrong\.zip: sha256 .*pinned 0+/);
    assert.deepEqual(readdirSync(cache).filter(name => name.startsWith('wrong.zip')), []);
});
