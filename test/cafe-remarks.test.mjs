// A Shot's rating and note: stars to rating and back, what an edit sends by
// either route, and an edit that may have been made (docs/cafe/DESIGN.md,
// "Rating and notes"). All sample data is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    ratingOf, noteOf, shotRemarks, starFills, ratingForTap, ratingText, noteToSave, annotationsOf, editMade, editReadAgain, sameRemarks, NOTE_MAX,
} from '../src/cafe/remarks.js';
import { createTabletShots } from '../src/cafe/tablet-shots.js';
import { createPluginShots } from '../src/cafe/plugin-shots.js';
import { createShotSources } from '../src/cafe/shot-sources.js';

const shot = (id, annotations = {}) => ({ id, timestamp: '2026-11-12T10:00:00.000', workflow: {}, annotations, measurements: [] });

// ── Stars and ratings ────────────────────────────────────────────────────────

test('0 and no rating are both unrated, and a Shot with only blanks for a note has none', () => {
    for (const value of [0, null, undefined, NaN, -1, '8']) assert.equal(ratingOf(value), null, String(value));
    assert.equal(ratingOf(7), 7);
    assert.equal(ratingOf(12), 10);
    for (const value of ['', '   \n', null, undefined, 5]) assert.equal(noteOf(value), null, String(value));
    assert.equal(noteOf('  Sweet, a little thin\n'), 'Sweet, a little thin');
    assert.deepEqual(shotRemarks(shot('a', { enjoyment: 8, espressoNotes: 'Sweet', actualDoseWeight: 18 })), { rating: 8, note: 'Sweet' });
    assert.deepEqual(shotRemarks(shot('a', { enjoyment: 0, espressoNotes: ' ' })), { rating: null, note: null });
    assert.deepEqual(shotRemarks({ id: 'a' }), { rating: null, note: null }, 'a new Shot has neither');
});

test('a rating fills two points a star, and an in-between rating is part-filled', () => {
    assert.deepEqual(starFills(8), [1, 1, 1, 1, 0]);
    assert.deepEqual(starFills(7), [1, 1, 1, 0.5, 0], 'three and a half stars');
    assert.deepEqual(starFills(10), [1, 1, 1, 1, 1]);
    assert.deepEqual(starFills(0.5), [0.25, 0, 0, 0, 0]);
    for (const unrated of [0, null, undefined]) assert.deepEqual(starFills(unrated), [0, 0, 0, 0, 0]);
});

test('a tap writes whole stars, and a tap on the chosen star clears the rating', () => {
    assert.deepEqual([1, 2, 3, 4, 5].map(star => ratingForTap(null, star)), [2, 4, 6, 8, 10]);
    assert.equal(ratingForTap(8, 4), 0, 'the chosen star clears');
    assert.equal(ratingForTap(8, 3), 6);
    assert.equal(ratingForTap(8, 5), 10);
    assert.equal(ratingForTap(7, 4), 8, 'only an exact match clears');
    assert.equal(ratingForTap(7, 3), 6);
    assert.equal(ratingForTap(0, 1), 2);
});

test('the reference\'s rating reads as one star and its number of stars', () => {
    assert.equal(ratingText(8), '★ 4');
    assert.equal(ratingText(7), '★ 3.5');
    assert.equal(ratingText(10), '★ 5');
    assert.equal(ratingText(0), '');
    assert.equal(ratingText(null), '');
});

test('a note is trimmed, an emptied note is empty text, and none is longer than the plugin takes', () => {
    assert.equal(noteToSave('  Sweet\nand long  \n'), 'Sweet\nand long');
    assert.equal(noteToSave('   '), '');
    assert.equal(noteToSave(null), '');
    assert.equal(noteToSave('x'.repeat(NOTE_MAX + 10)).length, 40_000);
});

test('two Shots have the same rating and note, or they do not', () => {
    assert.ok(sameRemarks({ rating: 8, note: 'a' }, { rating: 8, note: 'a', shot: {} }));
    assert.ok(sameRemarks({ rating: null, note: null }, {}), 'none and not said are the same');
    assert.ok(sameRemarks(null, null));
    assert.ok(!sameRemarks({ rating: 8, note: 'a' }, { rating: 6, note: 'a' }));
    assert.ok(!sameRemarks({ rating: 8, note: 'a' }, { rating: 8, note: 'b' }));
});

// ── What an edit sends ───────────────────────────────────────────────────────

test('an edit sends Decaid only the field edited, so every other annotation is kept', () => {
    assert.deepEqual(annotationsOf({ rating: 8 }), { annotations: { enjoyment: 8 } });
    assert.deepEqual(annotationsOf({ note: 'Sweet' }), { annotations: { espressoNotes: 'Sweet' } });
    assert.deepEqual(annotationsOf({ rating: 0 }), { annotations: { enjoyment: 0 } }, '0 clears a rating');
    assert.deepEqual(annotationsOf({ note: '' }), { annotations: { espressoNotes: '' } }, 'empty text clears a note');
    assert.deepEqual(annotationsOf({ rating: 6, note: 'Both' }), { annotations: { enjoyment: 6, espressoNotes: 'Both' } });
});

test('an edit was made when the Shot holds what was asked for', () => {
    assert.ok(editMade({ rating: 8 }, { rating: 8, note: 'kept' }));
    assert.ok(editMade({ rating: 0 }, { rating: null, note: null }), 'a cleared rating reads as none');
    assert.ok(editMade({ note: '' }, { rating: 8, note: null }), 'a cleared note reads as none');
    assert.ok(!editMade({ rating: 8 }, { rating: 6, note: null }));
    assert.ok(!editMade({ note: 'new' }, { rating: 8, note: 'old' }));
    assert.ok(!editMade({ rating: 8 }, null), 'a Shot that could not be read holds nothing');
});

// ── Decaid's own Shot edit ───────────────────────────────────────────────────

// A tablet whose Shot edit merges the annotations sent, as Decaid's does.
function tablet({ shots = [], failEdit = null, failRead = false } = {}) {
    const calls = { updated: [], read: [], listed: [] };
    const source = createTabletShots({
        listShots: async limit => { calls.listed.push(limit); return { items: shots.slice(0, limit).map(({ measurements, ...row }) => row) }; },
        readShot: async id => {
            calls.read.push(id);
            if (failRead) throw new Error('offline');
            return shots.find(s => s.id === id) || null;
        },
        readChoices: async () => ({ r1: 'a' }),
        writeChoices: async () => {},
        updateShot: async (id, body) => {
            calls.updated.push([id, body]);
            const held = shots.find(s => s.id === id);
            if (failEdit !== 'lost' && failEdit) throw failEdit;
            if (!held) throw new Error(`Failed to update shot ${id}`);
            held.annotations = { ...held.annotations, ...body.annotations };
            if (failEdit === 'lost') throw new Error('the answer never arrived');
            return held;
        },
    });
    return { source, calls, shots };
}

test('without Decent Sync a rating goes to Decaid\'s own Shot edit, alone, and the note is untouched', async () => {
    const { source, calls, shots } = tablet({ shots: [shot('a', { enjoyment: 4, espressoNotes: 'Kept', actualYield: 36.2 })] });
    assert.deepEqual(await source.editShot('a', { rating: 8 }), { rating: 8, note: 'Kept' });
    assert.deepEqual(calls.updated, [['a', { annotations: { enjoyment: 8 } }]]);
    assert.deepEqual(shots[0].annotations, { enjoyment: 8, espressoNotes: 'Kept', actualYield: 36.2 });
    assert.deepEqual(calls.read, [], 'an edit Decaid answered is not read again');
});

test('a note goes alone too, and the rating is untouched', async () => {
    const { source, calls } = tablet({ shots: [shot('a', { enjoyment: 6 })] });
    assert.deepEqual(await source.editShot('a', { note: 'Sweet, a little thin' }), { rating: 6, note: 'Sweet, a little thin' });
    assert.deepEqual(calls.updated, [['a', { annotations: { espressoNotes: 'Sweet, a little thin' } }]]);
    assert.deepEqual(await source.editShot('a', { note: '' }), { rating: 6, note: null }, 'empty text clears it');
    assert.deepEqual(await source.editShot('a', { rating: 0 }), { rating: null, note: null }, '0 clears the rating');
});

test('an edit Decaid did not answer is read again: made, it is shown as made', async () => {
    const { source, calls } = tablet({ shots: [shot('a', { enjoyment: 4 })], failEdit: 'lost' });
    assert.deepEqual(await source.editShot('a', { rating: 8 }), { rating: 8, note: null });
    assert.deepEqual(calls.read, ['a']);
});

test('an edit that failed rejects with what the read found, or with nothing where it found none', async () => {
    const refused = tablet({ shots: [shot('a', { enjoyment: 4, espressoNotes: 'Old' })], failEdit: new Error('Failed to update shot a') });
    await assert.rejects(refused.source.editShot('a', { rating: 8 }), error => {
        assert.deepEqual(error.remarks, { rating: 4, note: 'Old' });
        assert.equal(error.refusal, undefined, 'Decaid has no message to show');
        return true;
    });
    const gone = tablet({ shots: [] });
    await assert.rejects(gone.source.editShot('a', { rating: 8 }), error => error.remarks === null);
    const offline = tablet({ shots: [shot('a')], failEdit: new Error('offline'), failRead: true });
    await assert.rejects(offline.source.editShot('a', { note: 'x' }), error => error.remarks === null);
});

test('editReadAgain keeps the failure\'s code', async () => {
    const failed = Object.assign(new Error('Sample refusal.'), { code: 'unreachable' });
    await assert.rejects(editReadAgain({ rating: 8 }, async () => shot('a', { enjoyment: 2 }), failed), error => error.code === 'unreachable' && error.message === 'Sample refusal.');
});

test('the tablet\'s newest Shot is read whole, whatever it was pulled with', async () => {
    const { source, calls } = tablet({ shots: [shot('new', { enjoyment: 6 }), shot('old')] });
    assert.equal((await source.newestShot()).id, 'new');
    assert.deepEqual([calls.listed, calls.read], [[1], ['new']]);
    assert.equal(await tablet().source.newestShot(), null, 'a tablet with no Shot has none');
});

test('the tablet\'s own reference carries its Shot\'s rating and note', async () => {
    const { source } = tablet({ shots: [shot('a', { enjoyment: 7, espressoNotes: 'Syrupy' })] });
    const reference = await source.referenceShot('r1');
    assert.deepEqual([reference.shot.id, reference.rating, reference.note, reference.canChange], ['a', 7, 'Syrupy', true]);
    const none = await tablet().source.referenceShot('r1');
    assert.deepEqual(none, { shot: null, canChange: true }, 'and none says neither');
});

// ── Decent Sync's plugin ─────────────────────────────────────────────────────

const refusal = (code, status, message = 'Sample refusal.') => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

function plugin({ answers = [], held = null } = {}) {
    const calls = { edited: [], read: [], notServed: 0 };
    const source = createPluginShots({
        readReference: async () => assert.fail('an edit reads no reference'),
        chooseReference: async () => assert.fail('an edit chooses no reference'),
        editShot: async (id, edit) => {
            calls.edited.push([id, edit]);
            const value = answers.shift();
            if (value instanceof Error) throw value;
            return value;
        },
        readShot: async id => { calls.read.push(id); return held; },
        notServed: () => { calls.notServed += 1; },
    });
    return { source, calls };
}

test('on a served Machine an edit is the plugin\'s call, with only the field edited, and its answer is the Shot as it now is', async () => {
    const { source, calls } = plugin({ answers: [{ rating: 8, note: null }, { rating: 8, note: 'Sweet' }, { rating: null, note: '  ' }] });
    assert.deepEqual(await source.editShot('a', { rating: 8 }), { rating: 8, note: null });
    assert.deepEqual(await source.editShot('a', { note: 'Sweet' }), { rating: 8, note: 'Sweet' });
    assert.deepEqual(await source.editShot('a', { rating: 0 }), { rating: null, note: null }, 'none, and only blanks, read as none');
    assert.deepEqual(calls.edited, [['a', { rating: 8 }], ['a', { note: 'Sweet' }], ['a', { rating: 0 }]]);
    assert.deepEqual(calls.read, []);
});

test('an edit answered unreachable or serverTooOld, by Decaid with no code, or not at all, is read again before it is called failed', async () => {
    for (const failure of [refusal('unreachable', 503), refusal('serverTooOld', 503), refusal(null, 500), new Error('Failed to fetch')]) {
        const made = plugin({ answers: [failure], held: shot('a', { enjoyment: 8 }) });
        assert.deepEqual(await made.source.editShot('a', { rating: 8 }), { rating: 8, note: null }, `${failure.code}: the Shot holds the rating`);
        assert.deepEqual(made.calls.read, ['a'], 'the read is Decaid\'s');
        const lost = plugin({ answers: [failure], held: shot('a', { enjoyment: 4 }) });
        await assert.rejects(lost.source.editShot('a', { rating: 8 }), error => {
            assert.deepEqual(error.remarks, { rating: 4, note: null });
            assert.equal(error.refusal, undefined, 'nothing is shown as the plugin\'s word');
            return true;
        });
    }
});

test('any other refusal shows its message, reads nothing and changes nothing', async () => {
    for (const code of ['noSuchShot', 'shotUnwritten', 'invalidRequest']) {
        const { source, calls } = plugin({ answers: [refusal(code, 400, `Refused as ${code}.`)] });
        await assert.rejects(source.editShot('a', { note: 'x' }), error => error.refusal === `Refused as ${code}.` && error.code === code && error.remarks === undefined);
        assert.deepEqual([calls.read, calls.notServed], [[], 0]);
    }
    const moved = plugin({ answers: [refusal('captureOnly', 409)] });
    await assert.rejects(moved.source.editShot('a', { rating: 2 }), error => error.refusal === 'Sample refusal.');
    assert.equal(moved.calls.notServed, 1, 'a Machine no longer served has its status asked again');
});

// ── Which route an edit takes ────────────────────────────────────────────────

test('an edit goes to the plugin on a served Machine, and to Decaid otherwise and before the source is known', async () => {
    const calls = [];
    const source = name => ({
        editShot: async (id, edit) => { calls.push([name, id, edit]); return { rating: 8, note: null }; },
        newestShot: async () => { calls.push([name, 'newest']); return shot('n'); },
    });
    const sources = createShotSources({ tablet: source('tablet'), plugin: source('plugin'), askStatus: () => {}, changed: () => {} });
    const route = async () => { calls.length = 0; await sources.editShot('a', { rating: 8 }); return calls[0][0]; };
    assert.equal(await route(), 'tablet', 'before any status answer the Shot in the graph is the tablet\'s own');
    sources.status({ code: 'unreachable' });
    assert.equal(await route(), 'tablet', 'still not known');
    sources.status({ served: true });
    assert.equal(await route(), 'plugin');
    sources.status({ code: 'unreachable' });
    assert.equal(await route(), 'plugin', 'a served Machine stays with the plugin through an outage, which writes its own Shot without the server');
    sources.status({ code: 'captureOnly' });
    assert.equal(await route(), 'tablet');
    sources.status(null);
    assert.equal(await route(), 'tablet', 'no plugin');
    sources.status({ served: true });
    calls.length = 0;
    assert.equal((await sources.newestShot()).id, 'n');
    assert.deepEqual(calls, [['tablet', 'newest']], 'the newest Shot is the tablet\'s own, whatever the source');
});
