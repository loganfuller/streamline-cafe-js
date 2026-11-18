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
// since the change.

import { profileFingerprint } from '../modules/dye-selection.js';
import { renamedFor } from './recipe-name.js';

// How long after the change the record is read again. DYE2's longest window is
// its save of the dial-in, which reads the list, may read the machine's
// settings over Bluetooth (1.4 to 5.7 s by DYE2's own measure, dye2#40), and
// writes the list back. A simulated machine answers at once, so the trial can't
// measure it.
export const AFTER_CHECK_MS = 8000;

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

// The recipe's own yield, as its stored Workflow and its numbers hold it.
const recipeYield = row => positive(row?.workflow?.context?.targetYield) ?? positive(row?.dashboardVariables?.drink);

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
const namesRecipe = (selection, id) => !!selection && selection.kind === 'recipe' && String(selection.id) === String(id);

/**
 * What the check afterwards does, from what it read:
 *
 * - `rows`, DYE2's records, or null when they could not be read;
 * - `recipeId`, the recipe whose record took the profile, and `record`, the profile;
 * - `before`, DYE2's fingerprint of the profile the record had before the change;
 * - `selection`, DYE2's, or undefined when it could not be asked;
 * - `tapped`, whether a tap on the strip has loaded or unloaded a recipe since;
 * - `live`, the Workflow's profile, or null when it could not be read.
 *
 * Answers `{ outcome, rewrite, reload }`. A record back on the profile it had is
 * written again; one on any other profile was changed since, by someone else,
 * and is left alone. A recipe found unloaded is loaded again only where nothing
 * since says it should not be: no tap, and the machine still on the new profile.
 */
export function afterCheck({ rows, recipeId, record, before, selection, tapped, live }) {
    const none = outcome => ({ outcome, rewrite: false, reload: false });
    if (!rows) return none('unreadable');
    const row = rows.find(r => sameId(r, recipeId));
    if (!row) return none('gone');
    const held = holdsProfile(row, record);
    const reverted = !held && profileFingerprint(recordProfile(row)) === before;
    if (!held && !reverted) return none('moved');
    const answer = (outcome, reload = false) => ({ outcome, rewrite: reverted, reload });
    const settled = reverted ? 'rewritten' : 'held';
    if (namesRecipe(selection, recipeId)) return answer(settled);
    if (tapped) return answer('tapped');
    if (selection === undefined) return answer('unknown');
    const onProfile = !!live && profileFingerprint(live) === profileFingerprint(record.profile);
    if (!onProfile) return answer('unloaded');
    return answer('reloaded', true);
}

/**
 * - `mayChange()` says whether a change may begin now: not during a shot, a
 *   recipe load or an arrangement of the strip, or while a choice is written.
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
 * Returns `change(profileId)`, which resolves `{ ok: true, recipeId, name,
 * checked }` or `{ ok: false, reason }`. `recipeId` is the loaded recipe whose
 * record took the profile, or null; `name` its new name, or null where it kept
 * its own; `checked` resolves what the check afterwards found, or is null with
 * no recipe loaded. Reasons: `busy` (not now, or the change before it never
 * landed, or a shot started), `profile` (no such profile in Decaid),
 * `unreadable` (DYE2 or the Workflow could not be read), the writer's reasons
 * (`gone`, `unconfirmed`), and `workflow` (the record took the profile and the
 * Workflow write failed).
 */
export function createProfileChange({
    mayChange, queue, readProfile, readSelection, readWorkflow, readRecords,
    saveRecord, writeWorkflow, follow = async () => {}, markLoaded, epoch,
    idle = async () => {}, wait, onChecked = () => {},
}) {
    async function changeNow(profileId, at) {
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
        const selection = await readSelection();
        if (selection === undefined) return { ok: false, reason: 'unreadable' };
        let workflow;
        try {
            workflow = await readWorkflow();
        } catch (error) {
            return { ok: false, reason: 'unreadable' };
        }
        const recipeId = selection && selection.kind === 'recipe' && selection.id != null ? String(selection.id) : null;
        let before;
        let name = null;
        if (recipeId) {
            let first = true;
            const result = await saveRecord(recipeId, (row, rows) => {
                if (first) before = profileFingerprint(recordProfile(row));
                first = false;
                const fields = recordFields(row, rows, record);
                name = fields.name ?? null;
                return fields;
            });
            // A record write that can't be confirmed writes no Workflow: written
            // alone, the profile would unload the recipe.
            if (!result.ok) return { ok: false, reason: result.reason };
        }
        try {
            await writeWorkflow(workflowPatch(record, workflow));
        } catch (error) {
            return { ok: false, reason: 'workflow' };
        }
        await follow(record);
        return { ok: true, recipeId, name, record, before, at };
    }

    // The check afterwards, run in its turn as a change is.
    async function checkNow({ recipeId, record, before, at }) {
        const [rows, selection, workflow] = await Promise.all([
            readRecords(), readSelection(), readWorkflow().catch(() => null),
        ]);
        const plan = afterCheck({ rows, recipeId, record, before, selection, tapped: epoch() !== at, live: workflow?.profile ?? null });
        if (plan.rewrite) {
            const result = await saveRecord(recipeId, (row, rowsNow) => recordFields(row, rowsNow, record), {
                // Judged again on the records as the writer reads them: a record
                // moved on since is someone else's change.
                unless: (rowsNow, row) => (holdsProfile(row, record) || profileFingerprint(recordProfile(row)) === before ? null : 'moved'),
            });
            if (!result.ok) return result.reason === 'moved' ? 'moved' : 'lost';
        }
        if (!plan.reload) return plan.outcome;
        // A tap since the read: the strip is the barista's.
        if (epoch() !== at) return 'tapped';
        await markLoaded(recipeId);
        return namesRecipe(await readSelection(), recipeId) ? 'reloaded' : 'unloaded';
    }

    async function checkLater(change) {
        await wait(AFTER_CHECK_MS);
        // Not during a shot, and not before Decaid has stored it: loading the
        // recipe again would change what the Shot records. Its turn may still
        // find a shot started meanwhile: then once more, after that one.
        for (let attempt = 0; attempt < 2; attempt += 1) {
            await idle();
            try {
                return await queue(() => checkNow(change));
            } catch (error) {
                // the change before it never landed, or a shot started
            }
        }
        return 'skipped';
    }

    async function change(profileId) {
        if (!mayChange()) return { ok: false, reason: 'busy' };
        // From the call: a tap on the strip while the change waits its turn is
        // the barista's too.
        const at = epoch();
        let made;
        try {
            made = await queue(() => changeNow(profileId, at));
        } catch (error) {
            return { ok: false, reason: 'busy' };
        }
        if (!made.ok) return made;
        const { recipeId, name } = made;
        const checked = recipeId
            ? checkLater(made).then(outcome => { onChecked(outcome, recipeId); return outcome; })
            : null;
        return { ok: true, recipeId, name, checked };
    }

    return { change };
}
