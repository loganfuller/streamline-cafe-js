// The public preview's sample cafe (docs/cafe/DESIGN.md, "The public
// preview"; #88): what the preview opens on, made by preview/sample-cafe.js
// on top of the tests' sample data; the pretend machine the bar's "Pull a
// shot" pours on, the real DE1Pro's pour played at its own pace; the two
// modes, served by Decent Sync and without it; Settings, Sleep and a phone.
// The check that closes slice 8. The fixture, and how it serves the site and
// moves the clock, is support/preview.mjs; the seed's own rules are
// test/preview-sample-cafe.test.mjs's.

import { readFileSync } from 'node:fs';

import { test, expect, START, ZONE } from './support/preview.mjs';
import { card, chartLines, legend, row, stageNames, remarks, pickDialog, pickRow, pickRows, menu, menuItems, REFERENCE_LINES } from './support/page-reads.mjs';
import { BARISTAS, NO_SHOTS, RECIPE_POURS, sampleCafe } from '../../preview/sample-cafe.js';
import { API_DEBOUNCE_MS } from '../../src/modules/workflow-watch.js';

const load = name => JSON.parse(readFileSync(new URL(`../../fake-decaid/recordings/${name}.json`, import.meta.url), 'utf8'));
const RECORDED = { sampleData: load('sample-data'), boot: load('boot'), simulated: load('pour'), real: load('real/de1pro-pour') };
const SERVED = sampleCafe({ ...RECORDED, decentSync: load('decent-sync') });
const TABLET = sampleCafe(RECORDED);
const RECORDS = SERVED.sampleData.store['dye2.reaplugin'].recipes;
const recordNamed = name => RECORDS.find(record => record.name === name);
const HOUSE = recordNamed('House espresso');
const SINGLE = recordNamed('Single origin');
const GUEST = recordNamed('Guest roast with a long name');
const POUR = RECORDED.real;
const MODES = { served: 'served by Decent Sync', tablet: 'without Decent Sync' };

test.use({ timezoneId: ZONE });

/** A recipe's card tapped, unless it is the one loaded, and the load settled. */
async function loadRecipe(preview, name) {
    const frame = preview.frame;
    const record = recordNamed(name);
    const shown = card(frame, record.stripSlot);
    if (await shown.getAttribute('aria-pressed') !== 'true') await shown.click();
    await expect(frame.locator('#cafe-title')).toHaveText(name);
    await expect(shown).toHaveAttribute('aria-pressed', 'true');
    await preview.advance(2000);
}

/** The stage lines of the graph's Shot: the name each shows, or null, and where it stands, in seconds. */
const stageLines = frame => frame.evaluate(async () => {
    const { echarts } = await import(new URL('src/modules/echarts-streamline.min.js', document.baseURI).href);
    const chart = echarts.getInstanceByDom(document.getElementById('plotly-chart'));
    const markers = chart?.getOption().series.find(series => series && series.id === 'markers-0');
    return (markers?.markLine?.data || []).map(line => ({ x: line.xAxis, name: line.label && line.label.show ? line.label.formatter() : null }));
});

/** The diff a comparison card shows, as a number, or null. */
const diffOf = (shown, key) => {
    const text = shown.cards.find(c => c.key === key)?.diff ?? '';
    const number = parseFloat(text.replace('−', '-'));
    return Number.isFinite(number) ? number : null;
};

for (const [mode, words] of Object.entries(MODES)) {
    test.describe(`the sample cafe, ${words}`, { tag: '@preview-cafe' }, () => {
        test.use({ mode });
        const made = mode === 'served' ? SERVED : TABLET;

        test('opens on House espresso: its latest Shot at full strength over a faded reference that differs, and a comparison row not all zero', async ({ preview }) => {
            const frame = await preview.open();
            await expect(frame.locator('#cafe-title')).toHaveText(HOUSE.name);
            await expect(card(frame, HOUSE.stripSlot)).toHaveAttribute('aria-pressed', 'true');
            expect(await preview.read('selection'), 'DYE2 has it loaded, not changed').toEqual({ kind: 'recipe', id: HOUSE.id, modified: false });
            await expect(frame.locator('#cafe-dial-label')).toHaveText(mode === 'served' ? /saved to the recipe/i : /not saved to the recipe/i);
            if (mode === 'served') await expect(frame.locator('#cafe-dial-label')).not.toHaveText(/not saved/i);

            const shown = await legend(frame);
            expect(shown.label).toBe('Latest');
            expect(shown.when, 'the newest Shot, an hour before the page opened, in the visitor\'s zone').toMatch(/^Today 01:00 PM/);
            expect(shown.reference, 'a reference, pulled the day before').toMatch(/Nov 17/);
            expect(shown.flag, 'on the recipe\'s own profile').toBeNull();
            const lines = await chartLines(frame);
            for (const name of REFERENCE_LINES) expect(lines.points[lines.names.indexOf(name)], `${name} drawn`).toBeGreaterThan(0);
            expect(Math.abs(lines.referenceEnd - lines.end), 'the reference runs to another length than the latest').toBeGreaterThan(0.5);

            const compared = await row(frame);
            const diffs = compared.cards.map(c => diffOf(compared, c.key)).filter(value => value !== null);
            expect(diffs.length, 'each card has its difference').toBeGreaterThan(3);
            expect(diffs.some(value => value !== 0), 'and they are not all zero').toBe(true);
            expect(Math.abs(diffOf(compared, 'time')), 'the time differs by seconds').toBeGreaterThanOrEqual(1);

            await expect(preview.bar.locator('#preview-mode')).toContainText(mode === 'served' ? 'served by Decent Sync' : 'without Decent Sync');
            await preview.screenshot(`preview-cafe-${mode}`);
        });

        test('each recipe\'s Shots name its profile\'s stages, on the curve\'s own changes of stage', async ({ preview }) => {
            const frame = await preview.open();
            for (const name of Object.keys(RECIPE_POURS)) {
                await loadRecipe(preview, name);
                const record = recordNamed(name);
                await expect(frame.locator('#cafe-shot-label'), `${name}: a latest Shot drawn`).toHaveText('Latest');
                const steps = record.workflow.profile.steps.map(step => step.name);
                const drawn = await stageLines(frame);
                const named = drawn.filter(line => line.name !== null);
                expect(named.length, `${name}: stage lines with names`).toBeGreaterThan(0);
                for (const line of named) expect(steps, `${name}: "${line.name}" is a stage of ${record.profileTitle}`).toContain(line.name);

                // Where the drawn Shot's own samples change stage, in seconds
                // from the end of its Preheat, where the graph's time starts.
                const changes = await frame.evaluate(async recordId => {
                    const fake = await window.cafePreview.ready;
                    const shot = fake.shots.all()
                        .filter(one => one.workflow?.context?.extras?.dye?.recipeId === recordId && one.measurements.some(m => m.machine.state.substate === 'pouring'))
                        .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))[0];
                    const at = text => Date.parse(`${text.slice(0, 23)}Z`);
                    const poured = shot.measurements.filter(m => m.machine.state.substate !== 'preparingForShot');
                    const start = at(poured[0].machine.timestamp);
                    const out = [];
                    let frameNow = null;
                    for (const m of poured) {
                        if (m.machine.profileFrame !== frameNow) out.push((at(m.machine.timestamp) - start) / 1000);
                        frameNow = m.machine.profileFrame;
                    }
                    return out;
                }, record.id);
                for (const line of drawn) {
                    const nearest = Math.min(...changes.map(t => Math.abs(t - line.x)));
                    expect(nearest, `${name}: the line at ${line.x.toFixed(2)} s sits on a change of stage (${changes.map(t => t.toFixed(2)).join(', ')})`).toBeLessThan(0.05);
                }
            }
        });

        test('the Shots list: about thirty over several days, the newest an hour old, with baristas, ratings, notes and some Unfinished', async ({ preview }) => {
            const frame = await preview.open();
            await frame.locator('#cafe-shots-btn').click();
            await expect(frame.locator('#cafe-shots-dialog')).toHaveAttribute('open', '');
            await expect(frame.locator('#cafe-shots-list .cafe-shots-row').first()).toBeVisible();
            await preview.advance(1000);
            const own = made.sampleData.shots.length;
            const all = own + (made.decentSync?.server.others.length ?? 0);
            await expect(frame.locator('#cafe-shots-list .cafe-shots-row')).toHaveCount(all);
            const rows = await frame.evaluate(() => [...document.querySelectorAll('#cafe-shots-list .cafe-shots-row')].map(row => ({
                time: row.querySelector('.cafe-shots-time').textContent,
                barista: row.querySelector('.cafe-shots-barista').textContent,
                rated: row.querySelectorAll('.cafe-shots-star').length > 0 && !row.querySelector('.cafe-shots-rating .cafe-shots-muted'),
                note: !!row.querySelector('.cafe-shots-note svg'),
                unfinished: !!row.querySelector('.cafe-shots-unfinished'),
                machine: row.querySelector('.cafe-shots-machine-name')?.textContent.trim() ?? '',
            })));
            const days = await frame.locator('#cafe-shots-list .cafe-shots-day').allTextContents();
            expect(days[0]).toBe('Today');
            expect(days.length, 'over several days').toBeGreaterThanOrEqual(4);
            expect(rows[0].time, 'the newest an hour before the page opened').toMatch(/01:00 PM/);
            const baristas = new Set(rows.map(r => r.barista).filter(Boolean));
            expect(baristas.size, 'several baristas').toBeGreaterThanOrEqual(3);
            for (const name of baristas) expect(BARISTAS).toContain(name);
            expect(rows.filter(r => r.rated).length, 'rated Shots').toBeGreaterThan(all / 2);
            expect(rows.filter(r => r.note).length, 'Shots with notes').toBeGreaterThan(5);
            if (mode === 'served') {
                expect(all, 'about thirty').toBeGreaterThanOrEqual(28);
                expect(new Set(rows.map(r => r.machine)), 'both Machines named').toEqual(new Set(['Sample Machine', 'Sample Machine Two']));
                expect(rows.filter(r => r.unfinished).length, 'some Unfinished').toBe(3);
            } else {
                expect(all, 'this machine\'s alone').toBe(own);
                expect(await frame.locator('#cafe-shots-list .cafe-shots-machine').evaluateAll(cells => cells.every(cell => getComputedStyle(cell).display === 'none')), 'no Machine named').toBe(true);
            }
            await preview.screenshot(`preview-cafe-shots-${mode}`);
        });

        test('Filter has no Shot yet, and the guest roast\'s reference reads "Different profile"', async ({ preview }) => {
            const frame = await preview.open();
            await loadRecipe(preview, NO_SHOTS);
            expect((await legend(frame)).line).toBe('No shot with this recipe on this machine yet');
            await loadRecipe(preview, GUEST.name);
            const shown = await legend(frame);
            expect(shown.label).toBe('Latest');
            expect(shown.flag).toBe('Different profile');
        });
    });
}

// ── Every control, in both modes ─────────────────────────────────────────────

/** A finger held on a card past Streamline's half second, let go, and the menu it opened. */
async function holdCard(preview, slot) {
    const box = await card(preview.frame, slot).boundingBox();
    await preview.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await preview.page.mouse.down();
    await preview.advance(600, 100);
    await preview.page.mouse.up();
    await expect(menu(preview.frame)).toBeVisible();
}

async function pickFromMenu(preview, label) {
    expect(await menuItems(preview.frame)).toContain(label);
    await menu(preview.frame).locator('.context-menu__item').filter({ hasText: label }).click();
    await expect(menu(preview.frame)).toBeHidden();
    await preview.advance(3000);
}

/** A row of the dial-in column tapped where its name is, and the pick dialog open. */
async function openPick(preview, section) {
    await preview.tapAt(preview.frame.locator(`#${section}-section .cafe-row-name`));
    await expect(pickDialog(preview.frame)).toBeVisible();
    await preview.advance(500);
}

async function untilPickClosed(preview) {
    await expect(preview.frame.locator('#cafe-pick-dialog:not([open])')).toBeAttached();
    await expect(preview.frame.locator('#cafe-pick-list .cafe-pick-row')).toHaveCount(0);
    await preview.advance(1500);
}

for (const [mode, words] of Object.entries(MODES)) {
    test.describe(`every control, ${words}`, { tag: '@preview-cafe' }, () => {
        test.use({ mode });

        test('a rating, a note, Make reference, a grinder, a bean and batch, a basket, a profile and a barista, and a recipe out of its slot and back', async ({ preview }) => {
            test.slow();
            const frame = await preview.open();
            const latest = (await preview.read('newestShot')).id;

            // A rating: the third star is 6 of 10.
            await frame.locator('#cafe-stars .cafe-star').nth(2).click();
            await expect.poll(() => preview.read('shot', latest).then(shot => shot.annotations.enjoyment), 'the rating reached the Shot').toBe(6);
            expect((await remarks(frame)).stars).toEqual([100, 100, 100, 0, 0]);

            // A note, edited.
            await frame.locator('#cafe-shot-note').click();
            await expect(frame.locator('#cafe-note-text')).toBeVisible();
            await frame.locator('#cafe-note-text').fill('Example note: a touch fast today.');
            await frame.locator('#cafe-note-save').click();
            await expect(frame.locator('#cafe-note-dialog')).not.toHaveAttribute('open');
            await expect.poll(() => preview.read('shot', latest).then(shot => shot.annotations.espressoNotes), 'the note reached the Shot').toBe('Example note: a touch fast today.');

            // Make reference, replacing the one chosen.
            await frame.locator('#cafe-make-reference').click();
            await expect(frame.locator('#cafe-reference-dialog[open]')).toBeVisible();
            await frame.locator('#cafe-reference-dialog-replace').click();
            await expect(frame.locator('#cafe-reference-badge')).toBeVisible();
            await preview.advance(1000);
            if (mode === 'served') expect(await preview.read('reference', HOUSE.name), 'the server\'s Reference Shot').toBe(latest);
            else expect((await preview.read('store', ['streamlineCafe', 'references']))[HOUSE.id], 'kept on the tablet').toBe(latest);

            // A grinder.
            await openPick(preview, 'grind');
            const grinders = await pickRows(frame);
            const grinder = grinders.find(row => !row.inUse).name;
            await pickRow(frame, grinder).click();
            await untilPickClosed(preview);
            await expect(frame.locator('#cafe-grind-desc')).toHaveText(grinder);
            expect((await preview.read('workflow')).context.grinderModel).toBe(grinder);

            // A bean's batch: highlighted, then "Use this batch".
            const batchBefore = (await preview.read('workflow')).context.beanBatchId;
            await openPick(preview, 'dose');
            await frame.locator('#cafe-pick-list .cafe-pick-row').nth(1).click();
            await expect(frame.locator('#cafe-pick-confirm-use')).toBeEnabled();
            await frame.locator('#cafe-pick-confirm-use').click();
            await untilPickClosed(preview);
            expect((await preview.read('workflow')).context.beanBatchId, 'another batch').not.toBe(batchBefore);

            // A basket.
            await openPick(preview, 'drink');
            await pickRow(frame, '20 g sample basket').click();
            await untilPickClosed(preview);
            await expect(frame.locator('#cafe-yield-desc')).toHaveText('20 g sample basket');
            expect((await preview.read('workflow')).context.extras.basketName).toBe('20 g sample basket');

            // A profile: highlighted, then "Use this profile".
            await openPick(preview, 'brew');
            const gentle = frame.locator('#cafe-pick-side .cafe-pick-side-row').filter({ hasText: 'Gentle and sweet' });
            await gentle.click();
            await expect(frame.locator('#cafe-pick-pane-title')).toHaveText('Gentle and sweet');
            await frame.locator('#cafe-pick-pane-use').click();
            await untilPickClosed(preview);
            await expect(frame.locator('#profile-name')).toHaveText('Gentle and sweet');
            expect((await preview.read('workflow')).profile.title).toBe('Gentle and sweet');
            expect((await preview.read('record', HOUSE.name)).profileTitle, 'and the recipe\'s').toBe('Gentle and sweet');

            // A barista.
            await frame.locator('#cafe-barista').click();
            await expect(pickDialog(frame)).toBeVisible();
            await frame.locator('#cafe-pick-list .cafe-pick-row').filter({ has: frame.locator('.cafe-pick-row-name', { hasText: /^Example Barista$/ }) }).click();
            await untilPickClosed(preview);
            await expect(frame.locator('#cafe-barista-name')).toHaveText('Example Barista');
            expect((await preview.read('workflow')).context.baristaName).toBe('Example Barista');

            await expect(frame.locator('#cafe-title'), 'House espresso stayed loaded throughout').toHaveText(HOUSE.name);
            expect((await preview.read('selection')).id).toBe(HOUSE.id);

            // Decaf out of its slot, and back.
            const decaf = recordNamed('Decaf');
            await holdCard(preview, decaf.stripSlot);
            await pickFromMenu(preview, 'Remove from slot');
            await expect(card(frame, decaf.stripSlot).locator('.cafe-card-name')).toHaveText(`Slot ${decaf.stripSlot}`);
            expect((await preview.read('record', 'Decaf')).stripSlot).toBeNull();
            await holdCard(preview, decaf.stripSlot);
            await pickFromMenu(preview, 'Choose a recipe…');
            await frame.locator('#cafe-recipe-list .cafe-recipe-row').filter({ hasText: 'Decaf' }).click();
            await expect(frame.locator('#cafe-recipe-dialog')).not.toHaveAttribute('open');
            await preview.advance(3000);
            await expect(card(frame, decaf.stripSlot).locator('.cafe-card-name')).toHaveText('Decaf');
            expect((await preview.read('record', 'Decaf')).stripSlot).toBe(decaf.stripSlot);
            expect(preview.unanswered(), 'every request answered').toEqual([]);
        });

        test(mode === 'served'
            ? 'a dose stepped with a recipe loaded is saved into it: still its dose after another recipe and back'
            : 'a dose stepped with a recipe loaded is not saved: the recipe\'s own dose comes back', async ({ preview }) => {
            const frame = await preview.open();
            await expect(frame.locator('#dose-in-value')).toHaveText('20g');
            await frame.locator('#dose-in-plus').click();
            await expect(frame.locator('#dose-in-value')).toHaveText('21g');
            await preview.advance(API_DEBOUNCE_MS + 2000);
            await loadRecipe(preview, SINGLE.name);
            await loadRecipe(preview, HOUSE.name);
            await expect(frame.locator('#dose-in-value')).toHaveText(mode === 'served' ? '21g' : '20g');
            expect((await preview.read('record', HOUSE.name)).dashboardVariables.dose).toBe(mode === 'served' ? 21 : 20);
        });
    });
}

// ── The pretend machine ──────────────────────────────────────────────────────

// The real pour's machine frames during the shot, in ms from its start, as the fake's machine plays them (fake-decaid/machine.js).
const REST_AT = POUR.idleAtMs + 500;
const PLAYED = POUR.frames.filter(f => f.ms <= REST_AT && !f.socket.startsWith('plugins/'));
const POUR_LENGTH = PLAYED.at(-1).ms;
const STORE_AT = Math.max(POUR_LENGTH, POUR.storedAtMs);
const ESPRESSO_FRAMES = PLAYED.filter(f => f.socket === 'machine/snapshot' && f.frame.state?.state === 'espresso').map(f => f.ms);

const pullButton = preview => preview.bar.locator('#preview-pull');

/** "Pull a shot" tapped, and the page's time the pour started. */
async function pull(preview) {
    await expect(pullButton(preview)).toBeEnabled();
    await pullButton(preview).click();
    await expect(pullButton(preview)).toBeDisabled();
    return (await preview.read('pour')).startedAt;
}

/** The clock moved to `ms` after the pour's start. */
async function until(preview, startedAt, ms) {
    const now = await preview.frame.evaluate(() => Date.now());
    if (startedAt + ms > now) await preview.advance(startedAt + ms - now);
}

// The full pour and a second pull, in both modes: the Shot is stored and
// drawn as the latest whether Decent Sync serves the machine or not.
for (const [mode, words] of Object.entries(MODES)) {
    test.describe(`the pretend machine, ${words}`, { tag: '@preview-cafe' }, () => {
        test.use({ mode });

        test('"Pull a shot" plays the real pour at its own pace through the page\'s live path, and its Shot is stored and drawn as the latest with no tap', async ({ preview }) => {
            test.slow();
            const frame = await preview.open();
            const before = (await preview.read('newestShot')).id;
            // A socket of the test's own, noting when each of the machine's frames in the shot reaches the page.
            await frame.evaluate(() => {
                const seen = window.__espresso = [];
                const ws = new WebSocket(`ws://${location.hostname}:8080/ws/v1/machine/snapshot`);
                ws.onmessage = event => { if (JSON.parse(event.data).state?.state === 'espresso') seen.push(Date.now()); };
            });
            await expect(pullButton(preview)).toHaveText('Pull a shot');
            // The clock held, so only the test's steps move it, to the millisecond.
            await preview.page.clock.pauseAt(await frame.evaluate(() => Date.now()) + 1000);
            const startedAt = await pull(preview);
            await expect(pullButton(preview)).toHaveText('Pouring…');

            await until(preview, startedAt, ESPRESSO_FRAMES[0] + 100);
            await expect(frame.locator('#main-page'), 'the graph goes live at the Preheat\'s start').toHaveClass(/cafe-shot-live/);
            await until(preview, startedAt, 30_000);
            await expect(frame.locator('#cafe-live'), 'the live cards').toBeVisible();
            expect((await chartLines(frame)).labelled.length, 'the lines named').toBeGreaterThan(0);
            if (mode === 'served') await preview.screenshot('preview-cafe-pour');

            await until(preview, startedAt, STORE_AT - 100);
            expect((await preview.read('newestShot')).id, 'not stored before the recorded moment').toBe(before);
            await expect(pullButton(preview), 'not offered while the pour runs').toBeDisabled();
            await until(preview, startedAt, STORE_AT + 1000);
            const stored = await preview.read('newestShot');
            expect(stored.id, 'stored at the recorded moment').not.toBe(before);
            expect(stored.workflow.context.extras.dye.recipeId, 'named for the recipe loaded').toBe(HOUSE.id);
            await preview.advance(3000);
            const shown = await legend(frame);
            expect(shown.label).toBe('Latest');
            expect(shown.when, 'the new Shot drawn as the latest, with no tap').toMatch(/^Today 02:00 PM/);
            await expect(frame.locator('#main-page')).not.toHaveClass(/cafe-shot-live/);
            await expect(pullButton(preview)).toBeEnabled();

            const arrived = (await frame.evaluate(() => window.__espresso)).map(at => at - startedAt);
            expect(arrived.length, 'every frame of the shot').toBe(ESPRESSO_FRAMES.length);
            const late = arrived.map((at, i) => at - ESPRESSO_FRAMES[i]);
            expect(Math.min(...late), 'none early').toBeGreaterThanOrEqual(0);
            expect(Math.max(...late), 'each at the recording\'s own moment, by the page\'s clock').toBeLessThanOrEqual(60);
            expect(preview.unanswered()).toEqual([]);
        });

        test('Sleep shows the screensaver and takes the button away; a tap wakes; a second pull works once the first is stored', async ({ preview }) => {
            test.slow();
            const frame = await preview.open();
            await frame.locator('#sleep-button').click();
            await expect(frame.locator('#screensaver')).toBeVisible();
            await expect(pullButton(preview), 'not offered while the machine sleeps').toBeDisabled();
            await frame.locator('#screensaver').click();
            await expect(frame.locator('#screensaver')).toBeHidden();
            await expect.poll(() => preview.read('machineState')).toMatchObject({ state: 'idle' });
            await expect(pullButton(preview)).toBeEnabled();

            const first = await pull(preview);
            await until(preview, first, STORE_AT + 1000);
            const one = (await preview.read('newestShot')).id;
            const second = await pull(preview);
            await until(preview, second, STORE_AT + 1000);
            const two = (await preview.read('newestShot')).id;
            expect(two).not.toBe(one);
            await expect(pullButton(preview)).toBeEnabled();
        });
    });
}

test.describe('the pretend machine, during a pour', { tag: '@preview-cafe' }, () => {
    test('a dialog open closes as a pour starts; a tap on a recipe card, on Sleep, or on the mode switch during a pour leaves the preview in a state it can go on from', async ({ preview }) => {
        test.slow();
        const frame = await preview.open();
        // A dialog open when the pour starts closes, as on a tablet.
        await frame.locator('#cafe-shots-btn').click();
        await expect(frame.locator('#cafe-shots-dialog')).toHaveAttribute('open', '');
        // A card tapped mid-pour loads nothing, as on a tablet (src/cafe/strip.js);
        // the Shot is stored under the recipe loaded, and a tap then loads.
        let startedAt = await pull(preview);
        await until(preview, startedAt, ESPRESSO_FRAMES[0] + 500);
        await expect(frame.locator('#cafe-shots-dialog'), 'the open dialog closed as the pour began').not.toHaveAttribute('open');
        await until(preview, startedAt, 20_000);
        await card(frame, SINGLE.stripSlot).click();
        await preview.advance(1000);
        await expect(frame.locator('#cafe-title')).toHaveText(HOUSE.name);
        await until(preview, startedAt, STORE_AT + 3000);
        expect((await preview.read('newestShot')).workflow.context.extras.dye.recipeId).toBe(HOUSE.id);
        await expect(pullButton(preview)).toBeEnabled();
        await loadRecipe(preview, SINGLE.name);

        // Sleep mid-pour.
        startedAt = await pull(preview);
        await until(preview, startedAt, 20_000);
        await frame.locator('#sleep-button').click();
        await until(preview, startedAt, STORE_AT + 3000);
        if (await frame.locator('#screensaver').isVisible()) await frame.locator('#screensaver').click();
        await expect(frame.locator('#screensaver')).toBeHidden();
        await preview.advance(1000);
        await expect(pullButton(preview), 'the machine can pour again').toBeEnabled();
        startedAt = await pull(preview);

        // The mode switched mid-pour: the preview starts again in the other mode, at rest.
        await until(preview, startedAt, 10_000);
        await preview.bar.locator('#preview-switch').click();
        await expect(preview.page).toHaveURL(/\?decent-sync=off$/);
        await preview.started();
        await expect(pullButton(preview)).toBeEnabled();
        await expect(preview.frame.locator('#main-page')).not.toHaveClass(/cafe-shot-live/);
    });
});

// ── The bar ──────────────────────────────────────────────────────────────────

test.describe('the bar', { tag: '@preview-cafe' }, () => {
    test('the switch starts the preview again in the other mode, the bar says which, and a reload stays in it', async ({ preview }) => {
        let frame = await preview.open();
        await expect(preview.bar.locator('#preview-mode')).toHaveText('Sample Machine at Sample Cafe, served by Decent Sync.');
        await expect(preview.bar.locator('#preview-switch')).toHaveText('Try without Decent Sync');
        expect(await preview.read('served')).toBe(true);

        await preview.bar.locator('#preview-switch').click();
        await expect(preview.page).toHaveURL(/\?decent-sync=off$/);
        frame = await preview.started();
        await expect(preview.bar.locator('#preview-mode')).toHaveText('Sample Machine without Decent Sync.');
        await expect(preview.bar.locator('#preview-switch')).toHaveText('Try with Decent Sync');
        expect(await preview.read('served')).toBe(false);
        await expect(frame.locator('#cafe-dial-label')).toHaveText(/not saved to the recipe/i);

        await preview.page.reload();
        frame = await preview.started();
        expect(await preview.read('served'), 'a reload stays without Decent Sync').toBe(false);
        await expect(preview.bar.locator('#preview-mode')).toHaveText('Sample Machine without Decent Sync.');

        await preview.bar.locator('#preview-switch').click();
        await expect(preview.page).not.toHaveURL(/decent-sync/);
        await preview.started();
        expect(await preview.read('served')).toBe(true);
    });

    test('Settings opens nothing of Streamline\'s, the bar says why, and the next tap takes the notice away', async ({ preview }) => {
        const frame = await preview.open();
        const notice = preview.bar.locator('#preview-notice');
        await expect(notice).toBeHidden();
        await frame.locator('#settings-btn').click();
        await expect(notice).toBeVisible();
        await expect(notice).toHaveText('Settings are Streamline\'s own and aren\'t part of this preview.');
        await preview.advance(2000);
        expect(new URL(frame.url()).searchParams.get('page'), 'no settings page').not.toBe('settings');
        await expect(frame.locator('#settings-page, #settings-container'), 'none drawn').toHaveCount(0);
        await expect(frame.locator('#main-page')).toBeVisible();
        await expect(frame.locator('#cafe-title')).toHaveText(HOUSE.name);
        await preview.screenshot('preview-cafe-settings');
        await frame.locator('#cafe-title').click();
        await expect(notice, 'gone at the next tap in the skin').toBeHidden();
        await frame.locator('#settings-btn').click();
        await expect(notice).toBeVisible();
        await preview.bar.locator('#preview-about').click();
        await expect(notice, 'or in the bar').toBeHidden();

        // The Steam, Hot water and Flush rows open the settings from the keyboard too.
        for (const row of ['#flush-label', '#steam-label', '#hotwater-label']) {
            for (const key of ['Enter', ' ']) {
                await frame.locator(row).press(key);
                await expect(notice, `${row} and ${JSON.stringify(key)}`).toBeVisible();
                await preview.advance(1000);
                expect(new URL(frame.url()).searchParams.get('page'), 'no settings page').not.toBe('settings');
                await expect(frame.locator('#cafe-title')).toHaveText(HOUSE.name);
                await preview.bar.locator('#preview-about').click();
                await expect(notice).toBeHidden();
            }
        }
    });
});

test.describe('on a phone in portrait', { tag: '@preview-cafe' }, () => {
    test.use({
        viewport: { width: 390, height: 844 },
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
    });

    test('the frame is at the window\'s width, the bar suggests a wider screen, and neither of Streamline\'s prompts shows', async ({ preview }) => {
        const frame = await preview.open();
        const box = await preview.page.locator('#preview-skin').boundingBox();
        expect(Math.abs(box.width - 390), `the frame is the window's width (${box.width})`).toBeLessThan(1);
        expect(Math.abs(box.width / box.height - 1.6)).toBeLessThan(0.01);
        const bar = await preview.bar.boundingBox();
        expect(Math.abs(box.y - (bar.y + bar.height)), `the frame sits at the top, under the bar (${box.y})`).toBeLessThan(1);
        await expect(preview.bar.locator('#preview-phone')).toBeVisible();
        await preview.advance(3000);
        await expect(frame.locator('#fullscreen-toast-container'), 'no rotate or fullscreen prompt').toBeHidden();
        await preview.screenshot('preview-cafe-phone');
    });

    test('a wide window shows no phone line', async ({ preview }) => {
        await preview.page.setViewportSize({ width: 1280, height: 800 });
        await preview.open();
        await expect(preview.bar.locator('#preview-phone')).toBeHidden();
    });
});
