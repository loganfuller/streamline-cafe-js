// A batch chosen in the bean and batch dialog, and the recipe's bean with it
// (docs/cafe/DESIGN.md, "The bean and batch dialog"). No browser global is
// touched: the caller passes in the reads and writes (bean-changer.js binds
// them).
//
// With a recipe loaded, a batch of another bean than the recipe's own becomes
// the recipe's bean: its DYE2 record takes the bean first, through the fork's
// one writer, and only once that write is confirmed is the Workflow written, as
// a batch always is, under Streamline's `beans.select`. A recipe that names no
// bean takes its first one the same way. A batch of the recipe's own bean, and
// any batch with no recipe loaded, is the Workflow write alone: Decent Sync
// saves it where it serves the Machine.
//
// What the record takes: the bean's id (what Decent Sync reads as the Recipe's
// Bean, and the one it reads a batch under), its name and roaster and the
// batch's id at the top of the row (what DYE2 builds the Workflow from when it
// applies the recipe, and what the page's cards read), `subtitle` as DYE2's own
// save sets it, and the same bean in the record's own stored Workflow (what
// Streamline's strip applies). A name DYE2 gave the recipe follows the bean
// (recipe-name.js).
//
// DYE2 keeps a recipe loaded through a bean change, so unlike the profile's
// change nothing here loads a recipe again. DYE2 does read its whole list,
// wait and write it back, so a record write can still be lost seconds after it
// was confirmed: once that window has passed the record is read again, and a
// record found back on the bean it had is written again.

import { currentBeanContext } from '../modules/bean-selection.js';
import { renamedForBean } from './recipe-name.js';
import { AFTER_CHECK_MS } from './profile-change.js';

// How often the check looks again for a moment with no recipe load or
// arrangement of the strip under way.
const SETTLE_POLL_MS = 250;

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const text = value => (typeof value === 'string' ? value.trim() : '');
const idOf = value => (value == null || !text(String(value)) ? null : String(value));
const sameId = (a, b) => idOf(a) !== null && idOf(a) === idOf(b);

/**
 * Does a pick of a batch of bean `beanId` write the recipe's record? Only with
 * a recipe loaded, and only for a bean that is not the recipe's own
 * (`ownBeanId`, from `recipeBeanId` in bean-model.js): a recipe that names no
 * bean takes any.
 */
export function writesRecord(recipe, ownBeanId, beanId) {
    return !!recipe && idOf(beanId) !== null && !sameId(beanId, ownBeanId);
}

/**
 * The fields the loaded recipe's record takes for `batch` of `bean`, worked
 * out from the row as just read and the other records, which a new name must
 * not take. Null where the two are no pick (`currentBeanContext`). The stored
 * Workflow's context is the row's own as just read with the bean set in it, so
 * every other field of it is kept; a row with no stored Workflow is given none.
 */
export function beanFields(row, rows, bean, batch) {
    const context = currentBeanContext(bean, batch);
    if (!context) return null;
    const fields = {
        beanId: String(bean.id),
        beanName: context.coffeeName,
        beanRoaster: context.coffeeRoaster,
        beanBatchId: context.beanBatchId,
        subtitle: context.coffeeName || row?.beverage || '',
    };
    if (isObject(row?.workflow)) {
        fields['workflow.context'] = { ...(isObject(row.workflow.context) ? row.workflow.context : {}), ...context };
    }
    const name = renamedForBean(row, context.coffeeName, rows || []);
    if (name) {
        fields.name = name;
        fields.title = name;
    }
    return fields;
}

/** The bean a record holds, as the check tells it again: the bean's id and the batch's. */
export const heldBean = row => ({ beanId: idOf(row?.beanId), batchId: idOf(row?.beanBatchId) });

/** Does the record hold `batch` of `bean`, at the top of the row and in its stored Workflow? */
export function holdsBean(row, bean, batch) {
    if (!isObject(row) || !sameId(row.beanId, bean?.id) || !sameId(row.beanBatchId, batch?.id)) return false;
    return !isObject(row.workflow) || sameId(row.workflow.context?.beanBatchId, batch.id);
}

// Is the record back on one of the beans `befores` names, by the bean's id and the batch's?
const backOn = (row, befores) => {
    const now = heldBean(row);
    return befores.some(b => b.beanId === now.beanId && b.batchId === now.batchId);
};

/**
 * What the check afterwards does, from `rows`, DYE2's records as read again
 * (null when they could not be read), the recipe and the pick, and `befores`,
 * the beans the record had before the change and any an earlier change still
 * unchecked found or wrote (`heldBean`). Answers `{ outcome, rewrite }`: a
 * record back on a bean it had is written again; one on any other bean was
 * changed since, by someone else, and is left alone.
 */
export function beanAfterCheck({ rows, recipeId, bean, batch, befores }) {
    if (!rows) return { outcome: 'unreadable', rewrite: false };
    const row = rows.find(r => isObject(r) && sameId(r.id, recipeId));
    if (!row) return { outcome: 'gone', rewrite: false };
    if (holdsBean(row, bean, batch)) return { outcome: 'held', rewrite: false };
    if (backOn(row, befores)) return { outcome: 'rewritten', rewrite: true };
    return { outcome: 'moved', rewrite: false };
}

/**
 * - `settled()` says whether nothing else now writes what a change or its check
 *   writes: no shot runs, and no recipe load or arrangement of the strip is
 *   under way. Asked again just before each write.
 * - `queue(task)` runs `task` in its turn, after any dial-in change still on its
 *   way, and rejects without running it when that change never landed or a shot
 *   started while it waited.
 * - `readSelection()` resolves DYE2's selection, or undefined when it could not be asked.
 * - `readWorkflow()` resolves the Workflow, and rejects when it could not be read.
 * - `readRecords()` resolves DYE2's records, or null when they could not be read.
 * - `saveRecord(id, fields, options)` is the writer's `setFields`.
 * - `writeWorkflow(patch)` is the one Workflow write, and rejects when it failed.
 * - `idle()` resolves once no shot runs and Decaid has stored the last one.
 * - `wait(ms)` waits.
 * - `now()` is the time in milliseconds.
 * - `onChecked(outcome, recipeId)` is told what each check afterwards found.
 *
 * Returns `change({ bean, batch, recipeId })`. `recipeId` is the recipe whose
 * record the pick writes (`writesRecord`), or null for the Workflow write alone.
 * Resolves `{ ok: true, recipeId, name, checked }` or `{ ok: false, reason }`:
 * `name` is the recipe's new name, or null where it kept its own; `checked`
 * resolves what the check afterwards found, or is null where no record was
 * written. Reasons: `pick` (no bean and batch to write), `busy` (the change
 * before it never landed, or a shot started or the strip began to change
 * before anything was written), `recipe` (DYE2 has another recipe loaded, or
 * none, than the one named), `unreadable` (DYE2 or the Workflow could not be
 * read, or they disagree on which recipe is loaded), the writer's reasons
 * (`gone`, `unconfirmed`), and `workflow` (the record took the bean and the
 * Workflow did not: its write failed, or a shot started, the strip began to
 * change or another recipe was loaded first; as the record was written, this
 * answer carries `checked` too). The check's outcomes are
 * `beanAfterCheck`'s, and `superseded` (a later change to the same recipe has
 * its own check), `lost`, `moved` and `skipped`.
 */
export function createBeanChange({
    settled = () => true, queue, readSelection, readWorkflow, readRecords,
    saveRecord, writeWorkflow, idle = async () => {}, wait, now = Date.now, onChecked = () => {},
}) {
    // The latest change made to each recipe's record, as the profile's change
    // keeps them (profile-change.js): a check for an earlier one is superseded,
    // and the later check takes over the beans the earlier one found and wrote
    // while that one's check has not run, or wrote the record again less than
    // one DYE2 window before (`rewroteAt`): a DYE2 save that read the list
    // before the rewrite has written it back by then, so an old bean found on a
    // later change is someone's choice.
    const latest = new Map();
    let changes = 0;
    const notNow = () => new Error('not now');
    const open = entry => !!entry && !entry.done && (entry.rewroteAt == null || now() - entry.rewroteAt <= AFTER_CHECK_MS);

    async function changeNow(bean, batch, expected) {
        let workflow;
        try {
            workflow = await readWorkflow();
        } catch (error) {
            return { ok: false, reason: 'unreadable' };
        }
        const selection = await readSelection();
        if (selection === undefined) return { ok: false, reason: 'unreadable' };
        const recipeId = selection && selection.kind === 'recipe' && selection.id != null ? String(selection.id) : null;
        // The line under the title named this recipe: one loaded or unloaded
        // since, elsewhere, is not the one the barista was told would change.
        if (recipeId !== expected) return { ok: false, reason: 'recipe' };
        const mark = workflow?.context?.extras?.dye?.recipeId;
        if ((mark == null ? null : String(mark)) !== recipeId) return { ok: false, reason: 'unreadable' };
        if (!settled()) return { ok: false, reason: 'busy' };
        let before;
        let name = null;
        let first = true;
        const result = await saveRecord(recipeId, (row, rows) => {
            if (first) before = heldBean(row);
            first = false;
            const fields = beanFields(row, rows, bean, batch);
            name = fields.name ?? null;
            return fields;
        }, {
            unless: () => (settled() ? null : 'busy'),
        });
        // A record write that can't be confirmed writes no Workflow: the batch
        // would be the machine's alone, with the recipe saying otherwise.
        if (!result.ok) return { ok: false, reason: result.reason };
        changes += 1;
        const generation = changes;
        const earlier = latest.get(recipeId);
        const befores = open(earlier) ? [...earlier.befores, earlier.mine, before] : [before];
        const mine = { beanId: String(bean.id), batchId: String(batch.id) };
        latest.set(recipeId, { generation, befores, mine, rewrote: false, rewroteAt: null, done: false });
        // From here the record is this change's, whatever comes of the Workflow:
        // its check runs either way, as it has taken over the earlier one's.
        const written = { recipeId, name, bean, batch, generation };
        const noWorkflow = { ok: false, reason: 'workflow', written };
        // Read again: another recipe loaded elsewhere while the record was
        // written gets no Workflow write, as one that failed, and nor does a
        // shot or an arrangement begun meanwhile.
        try {
            workflow = await readWorkflow();
        } catch (error) {
            return noWorkflow;
        }
        if (!settled() || String(workflow?.context?.extras?.dye?.recipeId ?? '') !== recipeId) return noWorkflow;
        // A batch already the Workflow's (picked before, while it stayed this
        // machine's own) needs the record alone.
        if (!sameId(workflow?.context?.beanBatchId, batch.id)) {
            try {
                await writeWorkflow({ context: currentBeanContext(bean, batch) });
            } catch (error) {
                return noWorkflow;
            }
        }
        return { ok: true, ...written };
    }

    const entryOf = change => {
        const entry = latest.get(change.recipeId);
        return entry && entry.generation === change.generation ? entry : null;
    };

    async function readPlan({ recipeId, bean, batch }, befores) {
        return beanAfterCheck({ rows: await readRecords(), recipeId, bean, batch, befores });
    }

    // A look first, outside the page's turn, so the dial-in rows are kept still
    // only where something is to be written.
    async function lookNow(change) {
        const entry = entryOf(change);
        if (!entry) return 'superseded';
        const plan = await readPlan(change, entry.befores);
        if (!entryOf(change)) return 'superseded';
        if (plan.rewrite) return null;
        if (!entry.rewrote) entry.done = true;
        return plan.outcome;
    }

    async function checkNow(change) {
        const entry = entryOf(change);
        if (!entry) return 'superseded';
        const { recipeId, bean, batch } = change;
        const plan = await readPlan(change, entry.befores);
        let outcome = plan.outcome;
        if (plan.rewrite) {
            if (!settled()) throw notNow();
            const result = await saveRecord(recipeId, (row, rows) => beanFields(row, rows, bean, batch), {
                unless: (rows, row) => {
                    if (!settled()) return 'busy';
                    return holdsBean(row, bean, batch) || backOn(row, entry.befores) ? null : 'moved';
                },
            });
            if (!result.ok && result.reason === 'busy') throw notNow();
            if (!result.ok) outcome = result.reason === 'moved' ? 'moved' : 'lost';
            else {
                entry.rewrote = true;
                entry.rewroteAt = now();
            }
        }
        if (!entry.rewrote) entry.done = true;
        return outcome;
    }

    async function untilSettled() {
        for (;;) {
            await idle();
            if (settled()) return;
            await wait(SETTLE_POLL_MS);
        }
    }

    async function checkLater(change) {
        await wait(AFTER_CHECK_MS);
        for (let attempt = 0; attempt < 3; attempt += 1) {
            await untilSettled();
            const look = await lookNow(change);
            if (look) return look;
            try {
                return await queue(() => checkNow(change));
            } catch (error) {
                // the change before it never landed, or a shot or an arrangement began
            }
        }
        return 'skipped';
    }

    async function change({ bean, batch, recipeId: expected = null } = {}) {
        const context = currentBeanContext(bean, batch);
        if (!context) return { ok: false, reason: 'pick' };
        if (expected == null) {
            // The Workflow write alone, as Streamline's own bean picker makes it.
            try {
                await queue(() => writeWorkflow({ context }));
            } catch (error) {
                return { ok: false, reason: 'workflow' };
            }
            return { ok: true, recipeId: null, name: null, checked: null };
        }
        let made;
        try {
            made = await queue(() => changeNow(bean, batch, String(expected)));
        } catch (error) {
            return { ok: false, reason: 'busy' };
        }
        const checkOf = written => checkLater(written).then(outcome => { onChecked(outcome, written.recipeId); return outcome; });
        if (!made.ok) return made.written ? { ok: false, reason: made.reason, checked: checkOf(made.written) } : made;
        const { recipeId, name } = made;
        return { ok: true, recipeId, name, checked: checkOf(made) };
    }

    return { change };
}
