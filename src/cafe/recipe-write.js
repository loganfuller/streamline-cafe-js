// How DYE2's recipe records are written (docs/cafe/DESIGN.md, "Writing DYE2's
// records"). No browser global is touched: the caller passes in the read and
// the write of the whole list. recipe-writer.js binds them to Decaid's store,
// and is the only module that may.
//
// Decaid's store has no conditional write, and DYE2 itself reads the list,
// waits and writes all of it back. So a write here:
//
// - reads the records again first, and never writes over a list it could not read;
// - changes only the named fields of one row, and keeps every field and every
//   row it does not know;
// - gives a slot one holder: the row placed in it takes it from any other;
// - reads again to confirm, and tries once more when the change is not there.

import { recipeStripCells } from '../modules/dye-selection.js';
import { SLOT_COUNT } from './strip-model.js';

const sameId = (row, id) => !!row && typeof row === 'object' && String(row.id) === String(id);

// Stored values are JSON, and a field this module wrote reads back in the order
// it was written.
const sameValue = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

// A recipe is in a slot when its `stripSlot` names it and it is not hidden from
// the strip, as DYE2 and Streamline's strip both read it.
const holdsSlot = (row, slot) => !!row && row.stripSlot === slot && row.showOnStreamlineDashboard !== false;

// The list with `fields` set on one row. A row given a slot takes it from every
// other row that names it, hidden or not, as DYE2's own save does.
function withFields(rows, id, fields) {
    const slot = fields.stripSlot;
    return rows.map(row => {
        if (sameId(row, id)) return { ...row, ...fields };
        if (slot != null && row && row.stripSlot === slot) return { ...row, stripSlot: null };
        return row;
    });
}

// Does the list hold the change?
function holdsFields(rows, id, fields) {
    const row = rows.find(r => sameId(r, id));
    if (!row) return false;
    const slot = fields.stripSlot;
    return Object.keys(fields).every(key => sameValue(row[key], fields[key]))
        && (slot == null || !rows.some(r => r && !sameId(r, id) && r.stripSlot === slot));
}

/**
 * - `read()` resolves DYE2's recipe records, or null when they could not be read.
 * - `write(rows)` writes the whole list, and rejects when it could not.
 *
 * Both calls resolve `{ ok: true, rows }` with the records as last read, or
 * `{ ok: false, reason }`:
 *
 * - `unreadable`: the records could not be read, so nothing was written;
 * - `gone`: the recipe is no longer in DYE2;
 * - `taken`: the slot holds another recipe than the caller expected;
 * - `placed`: the recipe is on another card by now (`placeInSlot` with `unplaced`);
 * - `moved`: the recipe is not in the slot the caller saw it in (`removeFromSlot`);
 * - `legacy`: no record names a slot at all, as an older DYE2 left them. The
 *   strip then places recipes by their ids, and one record given a slot would
 *   end that for all of them, emptying every other card;
 * - `unconfirmed`: written twice, and the change was not there either time.
 */
export function createRecipeWriter({ read, write }) {
    /**
     * Set the named fields of one recipe. `unless(rows, row)` may return a reason
     * not to, judged on the records as just read.
     */
    async function setFields(id, fields, { unless = () => null } = {}) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const rows = await read();
            if (!rows) return { ok: false, reason: 'unreadable' };
            const row = rows.find(r => sameId(r, id));
            if (!row) return { ok: false, reason: 'gone' };
            if ('stripSlot' in fields && !rows.some(r => r && typeof r === 'object' && r.stripSlot !== undefined)) {
                return { ok: false, reason: 'legacy' };
            }
            const reason = unless(rows, row);
            if (reason) return { ok: false, reason };
            if (holdsFields(rows, id, fields)) return { ok: true, rows };
            try {
                await write(withFields(rows, id, fields));
            } catch (error) {
                continue; // the next read says what DYE2 holds now
            }
            const after = await read();
            if (after && holdsFields(after, id, fields)) return { ok: true, rows: after };
        }
        return { ok: false, reason: 'unconfirmed' };
    }

    /**
     * Put a recipe in a Recipe Slot, shown on the strip. Whatever recipe was in
     * the slot loses it. Both options are judged on the records as just read:
     *
     * - `holder` is the recipe the caller saw in the slot, by id, or null for an
     *   empty slot. A slot that holds another recipe by now is left alone.
     * - `unplaced` says the caller saw the recipe on no card. One that is on
     *   another card by now is left there, and not moved off it unseen. "On a
     *   card" is the strip's own reading, the one the list of recipes to choose
     *   from is built by: a second row naming a slot another row holds, or one
     *   naming a slot that does not exist, is on none.
     */
    function placeInSlot(id, slot, { holder, unplaced = false } = {}) {
        return setFields(id, { stripSlot: slot, showOnStreamlineDashboard: true }, {
            unless(rows, row) {
                if (unplaced) {
                    const cell = recipeStripCells(rows, SLOT_COUNT).find(c => c.recipe === row);
                    if (cell && Number(cell.slot) !== slot) return 'placed';
                }
                if (holder === undefined) return null;
                const now = rows.find(r => !sameId(r, id) && holdsSlot(r, slot));
                return now && (holder === null || !sameId(now, holder)) ? 'taken' : null;
            },
        });
    }

    /**
     * Take a recipe out of its slot. It stays in DYE2's records, in no slot.
     * `slot` is the slot the caller saw it in: a recipe that is somewhere else
     * by now is left where it is.
     */
    function removeFromSlot(id, { slot } = {}) {
        return setFields(id, { stripSlot: null }, {
            unless: (rows, row) => (slot !== undefined && row.stripSlot != null && !holdsSlot(row, slot) ? 'moved' : null),
        });
    }

    return { setFields, placeInSlot, removeFromSlot };
}
