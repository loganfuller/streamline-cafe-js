// The page's writes to Decaid's record of a bean batch: what is left of it,
// and its finish (docs/cafe/DESIGN.md, "Entering a batch's weight"). This is
// the one module under src/cafe/ that writes a batch's record, and a test
// fails if another does.
//
// Each is one write of one field, with Decaid's request that keeps every field
// it is not given. The whole record is never sent: its `extras` hold Decent
// Sync's id and Batch Code. A write is done once Decaid has answered with the
// record holding it. Writes are made one at a time, in the order asked, so
// one still on its way from a dialog since closed can't land after a later
// one. Nothing is asked of Decent Sync's plugin, which reports the changed
// record itself where it serves the Machine.
import { updateBeanBatch } from '../modules/api.js';
import { weightWrite, finishWrite, stored } from './weight-model.js';

let queue = Promise.resolve();

async function send(batchId, patch) {
    if (batchId == null || batchId === '' || !patch) throw new Error('No batch, or nothing to write to it');
    const answer = await updateBeanBatch(encodeURIComponent(String(batchId)), patch);
    if (!stored(answer, patch)) throw new Error(`Decaid did not store the change to batch ${batchId}`);
    return answer;
}

function write(batchId, patch) {
    const run = queue.then(() => send(batchId, patch));
    queue = run.catch(() => {});
    return run;
}

/** Save what is left of a batch, in whole grams above zero. Rejects where Decaid did not store it. */
export function saveBatchWeight(batchId, left) {
    return write(batchId, weightWrite(left));
}

/** Finish a batch on the tablet: archive its record. Rejects where Decaid did not store it. */
export function finishBatch(batchId) {
    return write(batchId, finishWrite());
}
