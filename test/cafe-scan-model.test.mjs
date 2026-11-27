// The scan of a batch's QR code: what the plugin's answer means, which text
// is asked about, what each message says, the rows of several matches, and
// which camera opens (src/cafe/scan-model.js, docs/cafe/DESIGN.md, "Scanning
// a batch's QR code").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { SCAN_PHRASES, SAME_TEXT_MS, MAX_SCANNED_TEXT, SAMPLE_SIDE, holdsText, askable, askedJustNow, shownText, scanAnswer, scanRefusal, cameraFailure, scanMessage, matchesLine, matchRows, facingOf, otherFacing, cameraCount, facingLabel, mirrored, sampleSize, readText } from '../src/cafe/scan-model.js';
import { scanOffered } from '../src/cafe/sync-status.js';

const t = (key, vars) => key.replace(/\{(\w+)\}/g, (whole, name) => (vars && vars[name] !== undefined ? String(vars[name]) : whole));
const day = text => `day ${text}`;
const SERVED = { connected: true, served: true, machine: { id: 'm', name: 'Sample Machine' }, location: { id: 'l', name: 'Sample Cafe' } };

test('the scan is offered only where the plugin serves the Machine at a Location and can match scanned text', () => {
    assert.equal(scanOffered(false, { ...SERVED, scan: true }), true);
    assert.equal(scanOffered(true, SERVED), false, 'a plugin from before the request says nothing of it');
    assert.equal(scanOffered(true, { ...SERVED, scan: false }), false, 'a server from before the request');
    assert.equal(scanOffered(true, { ...SERVED, scan: 'yes' }), false, 'only true is yes');
    assert.equal(scanOffered(true, { ...SERVED, location: null, scan: true }), false, 'at no Location');
    assert.equal(scanOffered(true, null), false, 'no Decent Sync plugin');
    for (const code of ['captureOnly', 'hardwareMismatch', 'unreachable', 'serverTooOld', 'somethingNew']) {
        assert.equal(scanOffered(true, { served: false, code, scan: true }), false, code);
    }
});

test('an answer that says nothing either way leaves the scan as it was offered', () => {
    for (const answer of [{}, { loading: true }]) {
        assert.equal(scanOffered(true, answer), true);
        assert.equal(scanOffered(false, answer), false);
    }
});

test('the three answers of one batch are read alike, by the tablet\'s own ids', () => {
    for (const outcome of ['moved', 'added', 'alreadyThere']) {
        assert.deepEqual(scanAnswer({ outcome, batchId: 'b1', beanId: 'n1' }), { kind: 'match', batchId: 'b1', beanId: 'n1' }, outcome);
    }
    assert.deepEqual(scanAnswer({ outcome: 'moved', batchId: 7, beanId: 9 }), { kind: 'match', batchId: '7', beanId: '9' });
    assert.deepEqual(scanAnswer({ outcome: 'moved', beanId: 'n1' }), { kind: 'unreachable' }, 'a batch with no id can\'t be highlighted');
    assert.deepEqual(scanAnswer({ outcome: 'added', batchId: 'b1', beanId: '' }), { kind: 'unreachable' });
});

test('several matches, none, and an answer in no known shape', () => {
    const matches = [{ id: 'a', name: 'Sample Blend' }, { id: 'b', name: 'Sample Blend' }];
    assert.deepEqual(scanAnswer({ outcome: 'several', matches, more: false }), { kind: 'several', matches, more: false });
    assert.equal(scanAnswer({ outcome: 'several', matches, more: true }).more, true);
    assert.deepEqual(scanAnswer({ outcome: 'several', matches: [null, { name: 'no id' }, matches[0]] }).matches, [matches[0]], 'a match with no id can\'t be chosen');
    assert.deepEqual(scanAnswer({ outcome: 'several', matches: [] }), { kind: 'noMatch' });
    assert.deepEqual(scanAnswer({ outcome: 'noMatch' }), { kind: 'noMatch' });
    for (const answer of [null, undefined, '', 'moved', {}, { outcome: 'brought' }, { batchId: 'b1', beanId: 'n1' }]) {
        assert.deepEqual(scanAnswer(answer), { kind: 'unreachable' }, JSON.stringify(answer));
    }
});

test('a scan not answered: out of time, refused as unreachable, or refused as text it can\'t read', () => {
    assert.equal(scanRefusal({ timedOut: true }), 'noAnswer');
    assert.equal(scanRefusal(new Error('Failed to fetch')), 'noAnswer', 'a request that reached nothing');
    assert.equal(scanRefusal(undefined), 'noAnswer');
    assert.equal(scanRefusal({ status: 400, code: 'invalidRequest' }), 'noMatch');
    for (const error of [{ status: 503, code: 'unreachable' }, { status: 503, code: 'serverTooOld' }, { status: 409, code: 'captureOnly' }, { status: 404 }, { status: 500 }]) {
        assert.equal(scanRefusal(error), 'unreachable', JSON.stringify(error));
    }
});

test('which text is asked about', () => {
    assert.equal(holdsText('SR-0412'), true);
    for (const nothing of ['', '   ', '\n', null, undefined, 7]) assert.equal(holdsText(nothing), false);
    assert.equal(askable('SR-0412'), true);
    assert.equal(askable('x'.repeat(MAX_SCANNED_TEXT)), true);
    assert.equal(askable('x'.repeat(MAX_SCANNED_TEXT + 1)), false, 'longer than the plugin takes');
    assert.equal(askable('a\u0000b'), false, 'a NUL');
    assert.equal(askable('a\ud800b'), false, 'an unpaired surrogate');
    assert.equal(askable(7), false);
});

test('the same text is not asked about again for a few seconds, and any other is', () => {
    const last = { text: 'SR-0412', at: 10_000 };
    assert.equal(askedJustNow(null, 'SR-0412', 10_000), false);
    assert.equal(askedJustNow(last, 'SR-0412', 10_001), true);
    assert.equal(askedJustNow(last, 'SR-0412', 10_000 + SAME_TEXT_MS - 1), true);
    assert.equal(askedJustNow(last, 'SR-0412', 10_000 + SAME_TEXT_MS), false);
    assert.equal(askedJustNow(last, 'SR-0413', 10_001), false, 'another label is asked about at once');
});

test('the text read is shown on one line, cut where it is long', () => {
    assert.equal(shownText('  SR-0412\n'), 'SR-0412');
    assert.equal(shownText('Sample\n  Blend'), 'Sample Blend');
    const long = shownText('x'.repeat(500));
    assert.equal(long.length, 121);
    assert.ok(long.endsWith('…'));
});

test('each message has its own words; only "looking up" and "no match" leave the camera reading', () => {
    const said = kind => scanMessage(kind, ' SR-0412 ');
    assert.deepEqual(said('asking'), { title: SCAN_PHRASES.askingTitle, body: { key: SCAN_PHRASES.read, vars: { text: 'SR-0412' } }, scanning: true });
    assert.deepEqual(said('noMatch'), { title: SCAN_PHRASES.noMatchTitle, body: { key: SCAN_PHRASES.noMatchBody, vars: { text: 'SR-0412' } }, scanning: true });
    const stopped = { unreachable: 'unreachable', noAnswer: 'noAnswer', refused: 'refused', noCamera: 'noCamera', cameraFailed: 'cameraFailed' };
    const titles = new Set();
    for (const kind of Object.keys(stopped)) {
        const message = said(kind);
        assert.equal(message.title, SCAN_PHRASES[`${kind}Title`], kind);
        assert.deepEqual(message.body, { key: SCAN_PHRASES[`${kind}Body`], vars: undefined }, kind);
        assert.equal(message.scanning, false, kind);
        titles.add(message.title);
    }
    assert.equal(titles.size, 5, 'a message of its own for each');
    assert.match(SCAN_PHRASES.refusedBody, /Decaid, under Live camera access/);
    assert.equal(scanMessage('unread').title, 'Could not read the beans');
    assert.equal(scanMessage('somethingNew').title, SCAN_PHRASES.cameraFailedTitle);
});

test('no phrase of the scan names a Location', () => {
    for (const [name, phrase] of Object.entries(SCAN_PHRASES)) {
        assert.doesNotMatch(phrase, /location|\{location\}|\bcafe\b/i, name);
        assert.deepEqual([...phrase.matchAll(/\{(\w+)\}/g)].map(match => match[1]).filter(place => !['text', 'count'].includes(place)), [], `${name} is filled with nothing but the text read or a count`);
    }
});

test('the line over several matches says how many, and that more matched', () => {
    assert.deepEqual(matchesLine(3, false), { key: SCAN_PHRASES.matches, vars: { count: 3 } });
    assert.deepEqual(matchesLine(20, true), { key: SCAN_PHRASES.matchesMore, vars: { count: 20 } });
});

test('a match\'s row: the Bean and roast date over the roaster and Batch Code, each left out where there is none', () => {
    const rows = matchRows([
        { id: 'a', roaster: 'Sample Roasters', name: 'Sample Blend', roastDate: '2026-11-12', batchCode: 'SR-0412' },
        { id: 'b', roaster: null, name: 'Sample Blend', roastDate: null, batchCode: null },
        { id: 'c', roaster: ' Sample Roasters ', name: '', roastDate: 'yesterday', batchCode: ' sr-0398 ' },
    ], { extras: { decentSyncBatchCode: 'SR-0398' } }, day, t);
    assert.deepEqual(rows, [
        { id: 'a', name: 'Sample Blend · Roasted day 2026-11-12', details: ['Sample Roasters', 'SR-0412'], detail: 'Sample Roasters · SR-0412', inUse: false },
        { id: 'b', name: 'Sample Blend · No roast date', details: [], detail: '', inUse: false },
        { id: 'c', name: 'Unnamed · No roast date', details: ['Sample Roasters', 'sr-0398'], detail: 'Sample Roasters · sr-0398', inUse: true },
    ]);
    assert.equal(matchRows([{ id: 'a', batchCode: null }], null, day, t)[0].inUse, false, 'no code is no batch in use');
    assert.deepEqual(matchRows(null, null, day, t), []);
});

test('among matches sharing a Batch Code, only the batch in use is marked, by the Decent Sync id on its record', () => {
    const inUse = { extras: { decentSyncBatchCode: 'SR-0412', decentSyncId: '019B7C1E-52AA-7C41-8E0D-3F5A6B7C8D91' } };
    const rows = matchRows([
        { id: '019b7c1e-52aa-7c41-8e0d-3f5a6b7c8d90', name: 'Sample Blend', roastDate: '2026-11-12', batchCode: 'SR-0412' },
        { id: '019b7c1e-52aa-7c41-8e0d-3f5a6b7c8d91', name: 'Sample Blend', roastDate: '2026-11-02', batchCode: 'sr-0412' },
        { id: '019b7c1e-52aa-7c41-8e0d-3f5a6b7c8d92', name: 'Sample Blend', roastDate: null, batchCode: null },
    ], inUse, day, t);
    assert.deepEqual(rows.map(row => row.inUse), [false, true, false]);
    const coded = matchRows([{ id: 'x', batchCode: 'SR-0412' }, { id: 'y', batchCode: 'SR-0412' }], { extras: { decentSyncBatchCode: 'SR-0412' } }, day, t);
    assert.deepEqual(coded.map(row => row.inUse), [true, true], 'a record with no id yet is told by its code');
});

test('the camera opens facing the barista unless the other was chosen, and the choice flips', () => {
    for (const kept of [null, undefined, '', 'user', 'front', 7]) assert.equal(facingOf(kept), 'user', String(kept));
    assert.equal(facingOf('environment'), 'environment');
    assert.equal(otherFacing('user'), 'environment');
    assert.equal(otherFacing('environment'), 'user');
});

test('the switch counts cameras, and the picture is labelled only where its side is known', () => {
    const devices = [{ kind: 'audioinput' }, { kind: 'videoinput' }, null, { kind: 'videoinput' }, { kind: 'audiooutput' }];
    assert.equal(cameraCount(devices), 2);
    assert.equal(cameraCount(null), 0);
    assert.equal(facingLabel('user', undefined, 1), null, 'one camera of no side known is not called either');
    assert.equal(facingLabel('user', undefined, 2), SCAN_PHRASES.front);
    assert.equal(facingLabel('environment', undefined, 2), SCAN_PHRASES.rear);
    assert.equal(facingLabel('user', 'environment', 1), SCAN_PHRASES.rear, 'what the camera says of itself wins');
    assert.equal(facingLabel('environment', 'user', 2), SCAN_PHRASES.front);
});

test('only the camera facing the barista is shown as a mirror shows it', () => {
    assert.equal(mirrored('user', undefined), true);
    assert.equal(mirrored('environment', undefined), false);
    assert.equal(mirrored('user', 'environment'), false);
    assert.equal(mirrored('environment', 'user'), true);
});

test('a frame is read at a reduced size, never enlarged, and not before the picture has one', () => {
    assert.deepEqual(sampleSize(1920, 1080), { width: SAMPLE_SIDE, height: 270 });
    assert.deepEqual(sampleSize(1080, 1920), { width: 270, height: SAMPLE_SIDE });
    assert.deepEqual(sampleSize(320, 240), { width: 320, height: 240 });
    assert.equal(sampleSize(0, 0), null);
    assert.equal(sampleSize(640, undefined), null);
});

const vendored = (file, name) => vm.runInNewContext(`${readFileSync(new URL(`../src/vendor/${file}`, import.meta.url), 'utf8')}; ${name}`, {});
const jsQR = vendored('jsQR.js', 'jsQR');
const { QrCode } = vendored('qrcodegen.js', 'qrcodegen');

/** A QR code holding `text`, as RGBA pixels: its modules in `dark`, the rest and a four-module border in `light`. */
function picture(text, { dark, light }) {
    const code = QrCode.encodeText(text, QrCode.Ecc.MEDIUM);
    const scale = 6;
    const side = (code.size + 8) * scale;
    const pixels = new Uint8ClampedArray(side * side * 4);
    for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) {
            const module = [Math.floor(x / scale) - 4, Math.floor(y / scale) - 4];
            const inside = module.every(at => at >= 0 && at < code.size);
            pixels.fill(inside && code.getModule(...module) ? dark : light, (y * side + x) * 4, (y * side + x) * 4 + 3);
            pixels[(y * side + x) * 4 + 3] = 255;
        }
    }
    return { pixels, side };
}

test('a code is read dark on light, as a printed label shows it, and light on dark, as a sticker or a phone may', () => {
    for (const [colours, why] of [[{ dark: 16, light: 235 }, 'dark on light'], [{ dark: 235, light: 16 }, 'light on dark']]) {
        const { pixels, side } = picture('SR-0412', colours);
        assert.equal(readText(jsQR, pixels, side, side), 'SR-0412', why);
    }
    const { pixels, side } = picture('SR-0412', { dark: 128, light: 128 });
    assert.equal(readText(jsQR, pixels, side, side), null, 'a frame with no code in it');
});

test('a frame the decoder fails on, or answers without text, is a frame with no code', () => {
    const pixels = new Uint8ClampedArray(16);
    assert.equal(readText(() => { throw new TypeError("Cannot read properties of undefined (reading 'height')"); }, pixels, 2, 2), null);
    assert.equal(readText(() => null, pixels, 2, 2), null);
    assert.equal(readText(() => ({ data: 42 }), pixels, 2, 2), null);
    let asked = null;
    readText((...args) => { asked = args[3]; return null; }, pixels, 2, 2);
    assert.deepEqual(asked, { inversionAttempts: 'attemptBoth' }, 'both ways round, in one call');
});
