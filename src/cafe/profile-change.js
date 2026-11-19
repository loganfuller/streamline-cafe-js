// Changing the profile while the recipe stays loaded (docs/cafe/DESIGN.md,
// "Changing the profile"). No browser global is touched: the caller passes in
// the reads and writes (profile-changer.js binds them).
//
// DYE2 unloads a recipe whose Workflow moves to a profile that is neither the
// one the Workflow had when the recipe was loaded nor the recipe's own. So with
// a recipe loaded the recipe's DYE2 record takes the new profile first, through
// the fork's one writer of DYE2's records, and only once that write is
// confirmed is the Workflow written. The record's profile is the one DYE2 then
// compares the Workflow with, and it holds it.
//
// What the record takes: the profile's id in Decaid (what Decent Sync reads as
// the Recipe's edit), its title (what the page's cards and lists read), its
// snapshot and the profile inside the record's own stored Workflow (what DYE2
// compares, and what a later load writes), and the recipe's brew temperature,
// the profile's own. A name DYE2 gave the recipe follows the profile
// (recipe-name.js). The Workflow takes the profile alone, with the yield as its
// stop weight, as Streamline's own profile sends fold it: dose, yield, grind,
// steam, hot water and flush stay as they are, and no recipe id is sent.
//
// DYE2 reads its whole list of records, waits, and writes it back, so a record
// write can be lost seconds after it was confirmed. Once that window has
// passed the record is read again: a record found back on the profile it had
// is written again, and a recipe found unloaded is loaded again once, through
// DYE2's selection, unless a tap on the strip has loaded or unloaded a recipe
// since the change. With the recipe still loaded, a machine left on an old
// profile (the change's Workflow write not made, or the record set back
// reaching it) takes the record's.

import { profileFingerprint } from '../modules/dye-selection.js';
import { renamedFor } from './recipe-name.js';

// How long after the change the record is read again. DYE2's longest window is
// its save of the dial-in, which reads the list, may read the machine's
// settings over Bluetooth (1.4 to 5.7 s by DYE2's own measure, dye2#40), and
// writes the list back. A simulated machine answers at once, so the trial can't
// measure it.
export const AFTER_CHECK_MS = 8000;

// How often the check looks again for a moment with no recipe load or
// arrangement of the strip under way.
const SETTLE_POLL_MS = 250;

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

const positive = value => {
    const n = Number(value);
    return value !== null && value !== '' && Number.isFinite(n) && n > 0 ? n : null;
};

/** The profile's own brew temperature: its first step's, as Decaid holds it, or null. */
export function ownBrewC(profile) {
    const t = profile?.steps?.[0]?.temperature;
    return typeof t === 'number' && Number.isFinite(t) ? t : null;
}

/** The profile with `yieldGrams` as its stop weight, as Streamline's profile sends fold it; unchanged without one. */
export function withStopWeight(profile, yieldGrams) {
    const weight = positive(yieldGrams);
    return weight === null ? profile : { ...profile, target_weight: weight };
}

/** The profile DYE2 compares the Workflow with: the record's stored Workflow's, else its snapshot. */
export const recordProfile = row => (isObject(row?.workflow) && row.workflow.profile) || row?.profileSnapshot || null;

// The recipe's own yield, as its stored Workflow and its numbers hold it: an
// older record with a ratio and no drink at all yields its dose times its
// ratio, as Streamline's apply of such a record works it out (dyeStrip.js
// `applyRecipeLegacy`). A yield of 0 is none, as Streamline's profile sends
// read it: the profile keeps its own stop weight.
function recipeYield(row) {
    const numbers = row?.dashboardVariables;
    const stored = positive(row?.workflow?.context?.targetYield) ?? positive(numbers?.drink);
    if (stored !== null || numbers?.drink != null) return stored;
    const dose = positive(numbers?.dose);
    const ratio = positive(numbers?.ratio);
    return dose !== null && ratio !== null ? Math.round(dose * ratio * 10) / 10 : null;
}

/**
 * The fields the loaded recipe's record takes for the profile `record` (Decaid's
 * profile record: `{ id, profile }`), worked out from the row as just read and
 * the other records, which a new name must not take. A field one level down is
 * set inside what the row holds (recipe-write.js): the rest of its stored
 * Workflow and of its numbers is kept. A row with no stored Workflow is given
 * none: DYE2 then compares its snapshot.
 */
export function recordFields(row, rows, record) {
    const profile = record.profile;
    const stored = withStopWeight(profile, recipeYield(row));
    const fields = { profileId: record.id, profileTitle: profile.title ?? null, profileSnapshot: stored };
    if (isObject(row.workflow)) fields['workflow.profile'] = stored;
    const brewC = ownBrewC(profile);
    if (brewC !== null) fields['dashboardVariables.brewC'] = brewC;
    const name = renamedFor(row, profile.title, rows || []);
    if (name) {
        fields.name = name;
        fields.title = name;
    }
    return fields;
}

/** The one Workflow write: the profile alone, with the Workflow's own yield as its stop weight. */
export function workflowPatch(record, workflow) {
    return { profile: withStopWeight(record.profile, workflow?.context?.targetYield) };
}

/** Does the record hold the profile, by its id and by DYE2's comparison? */
export function holdsProfile(row, record) {
    return !!row && row.profileId != null && String(row.profileId) === String(record.id)
        && profileFingerprint(recordProfile(row)) === profileFingerprint(record.profile);
}

const sameId = (row, id) => isObject(row) && String(row.id) === String(id);

/** The profile a record holds, as the check tells it again: its id in Decaid, and DYE2's fingerprint. */
export const heldProfile = row => ({ id: row?.profileId ?? null, fp: profileFingerprint(recordProfile(row)) });

// Is the record back on one of the profiles `befores` names? By DYE2's
// comparison, and by the id where the record had one: a record DYE2 wrote back
// carries its old id with it, and another profile that compares the same does not.
const backOn = (row, befores) => {
    const now = heldProfile(row);
    return befores.some(b => b.fp === now.fp && (b.id == null || (now.id != null && String(now.id) === String(b.id))));
};
const namesRecipe = (selection, id) => !!selection && selection.kind === 'recipe' && String(selection.id) === String(id);

/**
 * What the check afterwards does, from what it read:
 *
 * - `rows`, DYE2's records, or null when they could not be read;
 * - `recipeId`, the recipe whose record took the profile, and `record`, the profile;
 * - `befores`, the profiles the record had before the change (`heldProfile`),
 *   and the ones any earlier change found and wrote, where that change's check
 *   had not run or had to write the record again;
 * - `selection`, DYE2's, or undefined when it could not be asked;
 * - `tapped`, whether a tap on the strip has loaded or unloaded a recipe since;
 * - `live`, the Workflow's profile, or null when it could not be read.
 *
 * Answers `{ outcome, rewrite, reload }`. A record back on the profile it had is
 * written again; one on any other profile was changed since, by someone else,
 * and is left alone. A recipe found unloaded is loaded again only where nothing
 * since says it should not be: no tap, no other recipe loaded, and the machine
 * still on the new profile.
 */
export function afterCheck({ rows, recipeId, record, befores, selection, tapped, live }) {
    const none = outcome => ({ outcome, rewrite: false, reload: false });
    if (!rows) return none('unreadable');
    const row = rows.find(r => sameId(r, recipeId));
    if (!row) return none('gone');
    const held = holdsProfile(row, record);
    const reverted = !held && backOn(row, befores);
    if (!held && !reverted) return none('moved');
    const answer = (outcome, reload = false) => ({ outcome, rewrite: reverted, reload });
    const settled = reverted ? 'rewritten' : 'held';
    if (namesRecipe(selection, recipeId)) return answer(settled);
    if (tapped) return answer('tapped');
    if (selection === undefined) return answer('unknown');
    // Another recipe loaded since, by DYE2's own page or another skin: its
    // dial-in is the machine's, and marking this one loaded would mislabel it.
    if (selection && selection.kind === 'recipe') return answer('replaced');
    const onProfile = !!live && profileFingerprint(live) === profileFingerprint(record.profile);
    if (!onProfile) return answer('unloaded');
    return answer('reloaded', true);
}

/**
 * - `mayChange()` says whether a change may begin now: not during a shot, a
 *   recipe load or an arrangement of the strip, or while a choice is written.
 * - `settled()` says whether nothing else now writes what a change or its check
 *   writes: no shot runs, and no recipe load or arrangement of the strip is
 *   under way. Asked again just before each write, since a shot or an
 *   arrangement may begin while DYE2 and Decaid are read.
 * - `queue(task)` runs `task` in its turn, after any dial-in change still on its
 *   way, and rejects without running it when that change never landed or a shot
 *   started while it waited.
 * - `readProfile(id)` resolves Decaid's profile record, `{ id, profile }`.
 * - `readSelection()` resolves DYE2's selection, or undefined when it could not be asked.
 * - `readWorkflow()` resolves the Workflow, and rejects when it could not be read.
 * - `readRecords()` resolves DYE2's records, or null when they could not be read.
 * - `saveRecord(id, fields, options)` is the writer's `setFields`.
 * - `writeWorkflow(patch)` is the one Workflow write, and rejects when it failed.
 * - `follow(record)` has Streamline follow the new profile at once.
 * - `markLoaded(id)` marks the recipe loaded through DYE2's selection.
 * - `epoch()` changes whenever a tap on the strip loads or unloads a recipe.
 * - `idle()` resolves once no shot runs and Decaid has stored the last one.
 * - `wait(ms)` waits.
 * - `onChecked(outcome, recipeId)` is told what each check afterwards found.
 *
 * Returns `change(profileId, { recipeId })`, which resolves `{ ok: true,
 * recipeId, name, checked }` or `{ ok: false, reason }`. `recipeId`, where
 * given, is the recipe the caller expects loaded, or null for none: the
 * change is refused (`recipe`) where DYE2 says another is, or one where null
 * was given. `recipeId` is the loaded recipe whose
 * record took the profile, or null; `name` its new name, or null where it kept
 * its own; `checked` resolves what the check afterwards found, or is null with
 * no recipe loaded. Reasons: `busy` (not now, or the change before it never
 * landed, or a shot started or the strip began to change before anything was
 * written), `recipe` (another recipe is loaded than the caller named),
 * `profile` (no such profile in Decaid), `unreadable` (DYE2 or the
 * Workflow could not be read, or they disagree on which recipe is loaded), the writer's reasons (`gone`, `unconfirmed`),
 * and `workflow` (the record took the profile and the Workflow did not: its
 * write failed, or a shot started, the strip began to change or DYE2 loaded
 * another recipe first; as the record was written, this answer carries
 * `checked` too, and the check writes the Workflow where the recipe is still
 * loaded and the machine on the profile it had). The
 * check's outcomes are `afterCheck`'s, and `superseded` (a later change to the
 * same recipe has its own check, which takes over this one's), `lost`, `moved`,
 * `skipped`, `followed` (the record held, and the Workflow, whose write at the
 * change was not made, took the profile), and `workflow` (the Workflow, owed
 * the profile, could not be read or written, or a shot or an arrangement was
 * under way, through every turn).
 */
export function createProfileChange({
    mayChange, settled = () => true, queue, readProfile, readSelection, readWorkflow, readRecords,
    saveRecord, writeWorkflow, follow = async () => {}, markLoaded, epoch,
    idle = async () => {}, wait, now = Date.now, onChecked = () => {},
}) {
    // The latest change made to each recipe's record: `{ generation, befores,
    // mine, rewrote, rewroteAt, done, owed }`, `mine` the profile it wrote. A
    // check for an earlier one is superseded: it would read the later change as
    // its own record set back (A, then B, then A again) and write B over it.
    // The later check takes over the profiles the earlier one found and wrote,
    // while that one's check has not run, or wrote the record again less than
    // one DYE2 window before (`rewroteAt`): a DYE2 save begun before either may
    // write back what it read, and one that read the list before the rewrite
    // has written it back once that window has passed. `owed`: the record holds
    // a profile the Workflow has yet to take (its write at the change not made,
    // or the record written again by the check).
    const latest = new Map();
    let changes = 0;
    // A write the check must not make now: its turn is tried again later.
    const notNow = () => new Error('not now');
    // The Workflow the record is owed could not be written now: likewise.
    const owing = () => Object.assign(notNow(), { follow: true });
    const open = entry => !!entry && !entry.done && (entry.rewroteAt == null || now() - entry.rewroteAt <= AFTER_CHECK_MS);

    async function changeNow(profileId, at, expected) {
        let record;
        try {
            record = await readProfile(profileId);
        } catch (error) {
            return { ok: false, reason: 'profile' };
        }
        // Only a profile Decaid holds, whole: a profile with no steps is no profile to run.
        if (!record || record.id == null || !Array.isArray(record.profile?.steps) || !record.profile.steps.length) {
            return { ok: false, reason: 'profile' };
        }
        let workflow;
        try {
            workflow = await readWorkflow();
        } catch (error) {
            return { ok: false, reason: 'unreadable' };
        }
        // Read last, so nothing is awaited between it and the first write but
        // the writer's own read of the records.
        const selection = await readSelection();
        if (selection === undefined) return { ok: false, reason: 'unreadable' };
        const recipeId = selection && selection.kind === 'recipe' && selection.id != null ? String(selection.id) : null;
        // The caller said which recipe the change is for (the dialog's line
        // named it): one loaded since, elsewhere, is not the one it named.
        if (expected !== undefined && recipeId !== (expected == null ? null : String(expected))) return { ok: false, reason: 'recipe' };
        // DYE2 derives the selection from the Workflow's mark, and answers no
        // selection where its own read of the Workflow failed. Where the two
        // disagree, which recipe is loaded is not known: nothing is written.
        const mark = workflow?.context?.extras?.dye?.recipeId;
        if ((mark == null ? null : String(mark)) !== recipeId) return { ok: false, reason: 'unreadable' };
        let before;
        let name = null;
        let generation = null;
        let entry = null;
        // Where the record took the profile and the Workflow did not: the check
        // runs all the same, as it has taken over any earlier one's, and writes
        // the Workflow where the recipe is still loaded and the machine still on
        // the profile it had here (`was`).
        const noWorkflow = () => {
            if (!entry) return { ok: false, reason: 'workflow' };
            entry.owed = true;
            const was = profileFingerprint(workflow?.profile);
            return { ok: false, reason: 'workflow', written: { recipeId, name, record, at, generation, was } };
        };
        // A shot or an arrangement begun while those were read: nothing is written.
        if (!settled()) return { ok: false, reason: 'busy' };
        if (recipeId) {
            let first = true;
            const result = await saveRecord(recipeId, (row, rows) => {
                if (first) before = heldProfile(row);
                first = false;
                const fields = recordFields(row, rows, record);
                name = fields.name ?? null;
                return fields;
            }, {
                // Asked again on the writer's own read, just before it writes.
                unless: () => (settled() ? null : 'busy'),
            });
            // A record write that can't be confirmed writes no Workflow: written
            // alone, the profile would unload the recipe.
            if (!result.ok) return { ok: false, reason: result.reason };
            // From here the record is this change's, whatever comes of the Workflow.
            changes += 1;
            generation = changes;
            // A DYE2 save begun before an earlier change still unchecked may
            // write back what that change found or what it wrote.
            const earlier = latest.get(recipeId);
            const befores = open(earlier) ? [...earlier.befores, earlier.mine, before] : [before];
            const mine = heldProfile({ profileId: record.id, workflow: { profile: record.profile } });
            entry = { generation, befores, mine, rewrote: false, rewroteAt: null, done: false, owed: false };
            latest.set(recipeId, entry);
            // The record holds the profile; another recipe loaded elsewhere
            // while it was written gets no Workflow write, as one that failed
            // (the profile would go onto that recipe's Workflow), and nor does a
            // shot or an arrangement begun meanwhile. The Workflow is read
            // again for it, not DYE2's selection: DYE2 derives that from the
            // Workflow's mark, and may answer from a Workflow read before the
            // load. The new one's yield is the stop weight written. Decaid has
            // no conditional write, so a load between this read and the write
            // is the after-check's to find.
            try {
                workflow = await readWorkflow();
            } catch (error) {
                return noWorkflow();
            }
            if (!settled() || String(workflow?.context?.extras?.dye?.recipeId ?? '') !== recipeId) return noWorkflow();
        }
        try {
            await writeWorkflow(workflowPatch(record, workflow));
        } catch (error) {
            return noWorkflow();
        }
        await follow(record);
        return { ok: true, recipeId, name, record, at, generation };
    }

    // The change's entry while it is the latest for its recipe, else null.
    const entryOf = change => {
        const entry = latest.get(change.recipeId);
        return entry && entry.generation === change.generation ? entry : null;
    };

    async function readPlan({ recipeId, record, at }, befores) {
        const [rows, selection, workflow] = await Promise.all([
            readRecords(), readSelection(), readWorkflow().catch(() => null),
        ]);
        return afterCheck({ rows, recipeId, record, befores, selection, tapped: epoch() !== at, live: workflow?.profile ?? null });
    }

    // A look first, outside the page's turn, so the dial-in rows are kept
    // still only where something is to be written: the outcome where nothing
    // is, else null.
    async function lookNow(change) {
        const entry = entryOf(change);
        if (!entry) return 'superseded';
        const plan = await readPlan(change, entry.befores);
        // A later change made while it read has its own check.
        if (!entryOf(change)) return 'superseded';
        // A record held, with the Workflow still owed the profile: the turn writes it.
        if (plan.rewrite || plan.reload || (entry.owed && plan.outcome === 'held')) return null;
        if (!entry.rewrote) entry.done = true;
        return plan.outcome;
    }

    // The check, in its turn as a change is: read again, and act on what it finds.
    async function checkNow(change) {
        const entry = entryOf(change);
        if (!entry) return 'superseded';
        const plan = await readPlan(change, entry.befores);
        const outcome = await act(change, entry, plan);
        // A rewrite, in this turn or one given up after it, says a DYE2 save
        // wrote the old list back, and another may yet: a later change keeps
        // what this one knew as set back.
        if (!entry.rewrote) entry.done = true;
        return outcome;
    }

    async function act(change, entry, plan) {
        const { recipeId, record, at } = change;
        const { befores } = entry;
        if (plan.rewrite) {
            if (!settled()) throw notNow();
            const result = await saveRecord(recipeId, (row, rowsNow) => recordFields(row, rowsNow, record), {
                // Judged again on the records as the writer reads them: a record
                // moved on since is someone else's change, and a shot or an
                // arrangement begun since gives up the turn.
                unless: (rowsNow, row) => {
                    if (!settled()) return 'busy';
                    return holdsProfile(row, record) || backOn(row, befores) ? null : 'moved';
                },
            });
            if (!result.ok && result.reason === 'busy') throw notNow();
            if (!result.ok) return result.reason === 'moved' ? 'moved' : 'lost';
            entry.rewrote = true;
            entry.rewroteAt = now();
            // The record set back may have reached the machine meanwhile.
            entry.owed = true;
        }
        if (!plan.reload) {
            const loaded = plan.outcome === 'held' || plan.outcome === 'rewritten';
            return entry.owed && loaded ? followRecord(change, entry, plan.outcome) : plan.outcome;
        }
        // A tap since the read: the strip is the barista's.
        if (epoch() !== at) return 'tapped';
        if (plan.rewrite) {
            // The rewrite took a moment: ask DYE2 again what is loaded now.
            const now = await readSelection();
            if (namesRecipe(now, recipeId)) return 'rewritten';
            if (now === undefined) return 'unknown';
            if (now && now.kind === 'recipe') return 'replaced';
            if (epoch() !== at) return 'tapped';
        }
        if (!settled()) throw notNow();
        await markLoaded(recipeId);
        return namesRecipe(await readSelection(), recipeId) ? 'reloaded' : 'unloaded';
    }

    // The Workflow follows the record, in the check's turn, with the recipe
    // loaded: a machine still on an old profile (the one it had when its write
    // at the change was not made, `was`, or one the record had before) takes
    // the record's, as the change would have written it. The record set back
    // may have reached the machine before it was written again, by its card
    // tapped. A machine on any other profile, or with another recipe loaded,
    // was set so since and is left alone. Where the Workflow can't be read or
    // written now, or a shot or an arrangement began, throws for the check's
    // next turn.
    async function followRecord({ recipeId, record, was }, entry, outcome) {
        let workflow;
        try {
            workflow = await readWorkflow();
        } catch (error) {
            throw owing();
        }
        const nothing = () => {
            entry.owed = false;
            return entry.rewrote && outcome === 'held' ? 'rewritten' : outcome;
        };
        if (String(workflow?.context?.extras?.dye?.recipeId ?? '') !== recipeId) return nothing();
        const live = profileFingerprint(workflow?.profile);
        if (live === profileFingerprint(record.profile)) return nothing();
        const old = (was !== undefined && live === was) || entry.befores.some(b => b.fp === live);
        if (!old) return nothing();
        if (!settled()) throw owing();
        try {
            await writeWorkflow(workflowPatch(record, workflow));
        } catch (error) {
            throw owing();
        }
        entry.owed = false;
        await follow(record);
        const selection = await readSelection();
        if (selection !== undefined && !namesRecipe(selection, recipeId)) return 'unloaded';
        return entry.rewrote ? 'rewritten' : 'followed';
    }

    // Once no shot runs and Decaid has stored the last one, and no recipe load
    // or arrangement of the strip is under way: an arrangement writes DYE2's
    // whole list too, and one of the two writes would be lost.
    async function untilSettled() {
        for (;;) {
            await idle();
            if (settled()) return;
            await wait(SETTLE_POLL_MS);
        }
    }

    async function checkLater(change) {
        await wait(AFTER_CHECK_MS);
        // Not during a shot, and not before Decaid has stored it: loading the
        // recipe again would change what the Shot records. Its turn may still
        // find a shot or an arrangement begun meanwhile: then twice more, after it.
        let follow = false;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            await untilSettled();
            const look = await lookNow(change);
            if (look) return look;
            try {
                return await queue(() => checkNow(change));
            } catch (error) {
                // the change before it never landed, or a shot or an
                // arrangement began, or the Workflow could not follow
                follow = !!error?.follow;
            }
        }
        // Given up: by now any DYE2 save begun before the change has written, so
        // a later change takes over none of its profiles, unless this check
        // wrote the record again, which keeps them one window more (`rewroteAt`).
        const entry = entryOf(change);
        if (entry && !entry.rewrote) entry.done = true;
        return follow ? 'workflow' : 'skipped';
    }

    async function change(profileId, { recipeId: expected } = {}) {
        if (!mayChange()) return { ok: false, reason: 'busy' };
        // From the call: a tap on the strip while the change waits its turn is
        // the barista's too.
        const at = epoch();
        let made;
        try {
            made = await queue(() => changeNow(profileId, at, expected));
        } catch (error) {
            return { ok: false, reason: 'busy' };
        }
        const checkOf = written => checkLater(written).then(outcome => { onChecked(outcome, written.recipeId); return outcome; });
        if (!made.ok) return made.written ? { ok: false, reason: made.reason, checked: checkOf(made.written) } : made;
        const { recipeId, name } = made;
        return { ok: true, recipeId, name, checked: recipeId ? checkOf(made) : null };
    }

    return { change };
}
