// The page's report to Decent Sync's plugin, and the push that reloads it
// (src/cafe/page-report.js; docs/cafe/DESIGN.md, "Builds and installs").
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pageReport, asksReload, reloadUrl } from '../src/cafe/page-report.js';

test('the report names the build and when the page loaded, as an ISO 8601 time', () => {
    const origin = Date.parse('2026-11-24T09:15:30.250Z') + 0.375;
    assert.deepEqual(pageReport({ skinId: 'streamline-cafe.js-dist', version: '0.2.31-cafe.1.dev.4.81a2a30', timeOrigin: origin }), {
        skinId: 'streamline-cafe.js-dist', version: '0.2.31-cafe.1.dev.4.81a2a30', loadedAt: '2026-11-24T09:15:30.250Z',
    });
    assert.equal(pageReport({ skinId: 'a', version: 'b', timeOrigin: origin }).loadedAt, pageReport({ skinId: 'a', version: 'b', timeOrigin: origin }).loadedAt, 'the same for every report of one load');
});

test('only `{"what":"reload"}` asks the page to load again', () => {
    assert.equal(asksReload('{"what":"reload"}'), true);
    assert.equal(asksReload(JSON.stringify({ what: 'reload', extra: 1 })), true);
    for (const data of ['{"what":"connection","connected":true}', '{"what":"reference","recipe":{}}', '{"what":"Reload"}', '"reload"', 'reload', 'not json', 'null', '[]', '', undefined, null, { what: 'reload' }]) {
        assert.equal(asksReload(data), false, JSON.stringify(data));
    }
});

test('the reload asks for the page again at its own address, its `v` changed and the rest kept', () => {
    assert.equal(reloadUrl('http://localhost:3000/index.html', 1764000000000), 'http://localhost:3000/index.html?v=1764000000000');
    assert.equal(reloadUrl('http://localhost:3000/index.html?page=settings&v=1#top', 5), 'http://localhost:3000/index.html?page=settings&v=5#top');
});
