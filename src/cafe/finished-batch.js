// Whether the Bean Batch a recipe names, or the Workflow names, is archived on
// the tablet (docs/cafe/DESIGN.md, "A finished batch"). No browser global is
// touched.
//
// The recipe's batch is read from DYE2's record and whether a batch is archived
// from Decaid's own record of it. A batch is finished only when Decaid's record
// of that batch says so: a recipe or Workflow that names no batch, and a batch
// the tablet holds no record of, are not. Decent Sync's plugin pushes the batch
// whose record it archived or brought back, which the page then reads again.

const idOf = value => (typeof value === 'string' && value ? value : null);

/** The batch a DYE2 recipe record names, or null. */
export function recipeBatchId(recipe) {
    return idOf(recipe && recipe.beanBatchId);
}

/** The batch the Workflow names, or null. */
export function workflowBatchId(workflow) {
    return idOf(workflow && workflow.context && workflow.context.beanBatchId);
}

/** Is `batchId` archived, by `record`, Decaid's record of it? */
export function batchFinished(batchId, record) {
    return !!batchId && !!record && record.id === batchId && record.archived === true;
}

/** Each batch the strip's cards name, once, in the cards' order. */
export function cardBatchIds(cards) {
    const ids = (Array.isArray(cards) ? cards : []).map(card => recipeBatchId(card && card.recipe)).filter(Boolean);
    return [...new Set(ids)];
}

/**
 * Decaid's records of the batches in `ids`, after they were read again.
 * `known` is a Map of the records last read, by batch id. `reads` holds one
 * `{ id, record }` for each batch that was read; a batch whose read failed has
 * no entry, and keeps the record last read for it, as the rest of the page
 * keeps what it shows while Decaid can't be reached. A batch no card names any
 * more is forgotten.
 */
export function recordsAfterRead(known, ids, reads) {
    const read = new Map((Array.isArray(reads) ? reads : []).filter(entry => entry && entry.record).map(entry => [entry.id, entry.record]));
    const next = new Map();
    for (const id of ids) {
        const record = read.get(id) || (known && known.get(id));
        if (record) next.set(id, record);
    }
    return next;
}

/** The slots whose recipe names a finished batch, by `records` (a Map by batch id). */
export function finishedSlots(cards, records) {
    return (Array.isArray(cards) ? cards : [])
        .filter(card => {
            const id = recipeBatchId(card && card.recipe);
            return batchFinished(id, records && records.get(id));
        })
        .map(card => String(card.slot));
}

/**
 * Is the Workflow's batch finished? `batch` is the record last read for the
 * Workflow, and counts only while it is the record of the batch it names.
 */
export function workflowFinished(workflow, batch) {
    return batchFinished(workflowBatchId(workflow), batch);
}

/**
 * The batch a push on Decent Sync's `changes` socket names, from
 * `{ what: 'batch', batch }`: the plugin archived Decaid's record of it on the
 * tablet, or brought it back. Null for any other push, and for anything that is
 * not a push at all.
 */
export function pushedBatchId(data) {
    let push = data;
    if (typeof data === 'string') {
        try { push = JSON.parse(data); } catch (error) { return null; }
    }
    return push && typeof push === 'object' && push.what === 'batch' ? idOf(push.batch) : null;
}
