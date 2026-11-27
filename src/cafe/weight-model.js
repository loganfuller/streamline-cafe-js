// A batch's weight entered in the bean and batch dialog: what is left once the
// container's weight is taken off what the scale reads, which state the view
// is in, what it says, and what is written to Decaid's record of the batch
// (docs/cafe/DESIGN.md, "Entering a batch's weight"). No browser global is
// touched: the phrases go through `t`, and Decaid's record, the typed text and
// the container's weight are handed in.
//
// Every weight here is in whole grams. What is typed is what the scale reads,
// the batch with its container; the container's weight is the skin's one
// setting, 0 where none is set. Nothing left finishes the batch: its record is
// archived, and no zero is written.
import { BEAN_PHRASES, batchCode, leftToRight } from './bean-model.js';

/** The phrases the view and the setting may say, for the translations test. */
export const WEIGHT_PHRASES = {
    open: 'Enter weight',
    batchHeading: 'Batch',
    leftNow: 'Left now',
    notWeighed: 'Not weighed yet',
    roasted: 'Roasted weight',
    container: 'Container',
    field: 'Weight',
    fieldWithContainer: 'Weight with its container',
    tap: 'Tap to enter',
    working: '{weight} − {container} container',
    back: 'Back',
    save: 'Save',
    finish: 'Finish batch',
    nothingLeftTitle: 'Nothing is left',
    nothingLeftBody: 'Saving finishes this batch. It leaves the list, and a recipe that names it shows in red until another batch is picked.',
    underContainerTitle: 'Less than the container',
    underContainerBody: 'The container alone weighs {weight}. Weigh the batch in its container and enter what the scale reads.',
    aboveRoastedTitle: 'More than this batch was roasted at',
    aboveRoastedBody: 'It was roasted at {weight}. Check the number before saving.',
    saveFailedTitle: 'Could not save the weight',
    finishFailedTitle: 'Could not finish the batch',
    failedBody: 'Nothing was changed. Try again.',
    containerUnread: 'Could not read the container\'s weight',
    category: 'Cafe',
    page: 'Batches',
    settingHeading: 'Weighing a batch',
    setting: 'Batch container weight',
    settingHelp: 'The weight of the empty container a batch is kept in. It is taken off each weight entered for a batch in the bean and batch dialog. At 0 nothing is taken off.',
};

/** The most a scale's reading may be, in grams. */
export const MAX_TYPED = 100_000;
/** The most the container's weight may be set to, in grams. */
export const MAX_CONTAINER = 20_000;

const whole = (value, most) => {
    const number = typeof value === 'string' && /^\d+(\.\d*)?$/.test(value.trim()) ? Number(value) : value;
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) return null;
    return Math.min(most, Math.round(number));
};

/**
 * The container's weight from what the skin kept, or from what was typed into
 * its setting: whole grams from 0 to `MAX_CONTAINER`, and 0 for anything that
 * is no weight, which is also what a tablet that has kept none answers.
 */
export function containerWeight(kept) {
    return whole(kept, MAX_CONTAINER) ?? 0;
}

/**
 * What was typed as a scale's reading: whole grams up to `MAX_TYPED`, or null
 * where nothing was typed, or what was is no weight.
 */
export function typedGrams(text) {
    return whole(typeof text === 'string' ? text : String(text ?? ''), MAX_TYPED);
}

/** A weight a record holds, in whole grams, or null where it holds none. */
export function recordGrams(value) {
    return typeof value === 'number' ? whole(value, Number.MAX_SAFE_INTEGER) : null;
}

/** A weight as the view writes it: whole grams, kept left to right. */
export function gramsText(grams) {
    return leftToRight(`${grams} g`);
}

/**
 * Where the view stands for what is typed (`typed`, whole grams or null), the
 * container's weight and Decaid's record of the batch:
 *
 * - `empty`: nothing typed, and nothing to save.
 * - `underContainer`: less than the container alone, which is refused.
 * - `nothingLeft`: exactly the container, so the batch is finished.
 * - `aboveRoasted`: more is left than the record's roasted weight, which is
 *   said and can still be saved.
 * - `ready`: a weight to save.
 *
 * `left` is what is left, or null where there is nothing to work it out from.
 */
export function weighing(typed, container, batch) {
    if (typed == null) return { state: 'empty', left: null, saves: false, finishes: false };
    const left = typed - container;
    if (left < 0) return { state: 'underContainer', left: null, saves: false, finishes: false };
    if (left === 0) return { state: 'nothingLeft', left, saves: false, finishes: true };
    const roasted = recordGrams(batch?.weight);
    const above = roasted != null && roasted > 0 && left > roasted;
    return { state: above ? 'aboveRoasted' : 'ready', left, saves: true, finishes: false };
}

/**
 * What the view says of the batch beside the field, as `{ label, value }`
 * rows: what is left now, or "Not weighed yet"; the roasted weight where the
 * record has one; and the container's weight where one is set.
 */
export function weightFacts(batch, container, t) {
    const left = recordGrams(batch?.weightRemaining);
    const roasted = recordGrams(batch?.weight);
    const facts = [{ label: t(WEIGHT_PHRASES.leftNow), value: left == null ? t(WEIGHT_PHRASES.notWeighed) : gramsText(left) }];
    if (roasted != null && roasted > 0) facts.push({ label: t(WEIGHT_PHRASES.roasted), value: gramsText(roasted) });
    if (container > 0) facts.push({ label: t(WEIGHT_PHRASES.container), value: gramsText(container) });
    return facts;
}

/** The batch's Batch Code, or '' (bean-model.js). */
export function weightCode(batch) {
    return batchCode(batch);
}

/** The field's label, a key: with no container set, nothing mentions one. */
export function fieldLabel(container) {
    return container > 0 ? WEIGHT_PHRASES.fieldWithContainer : WEIGHT_PHRASES.field;
}

/**
 * The working shown before anything is saved, "3240 g − 350 g container" and
 * "2890 g left", or null where no container is set or nothing is typed. `left`
 * is '' where less than the container was typed.
 */
export function workingLine(typed, container, t) {
    if (typed == null || container <= 0) return null;
    const left = typed - container;
    return {
        sum: t(WEIGHT_PHRASES.working, { weight: gramsText(typed), container: gramsText(container) }),
        left: left < 0 ? '' : t(BEAN_PHRASES.left, { weight: gramsText(left) }),
    };
}

/**
 * The message under the field, or null: `{ tone, title, body }`, where `tone`
 * is `stop` or `warn`, `title` a key and `body` `{ key, vars }`. `failed` is
 * `save` or `finish` after a write Decaid did not store, and is said in the
 * place of what the state would say.
 */
export function weightMessage(state, { container, batch, failed = null }) {
    if (failed) {
        const title = failed === 'finish' ? WEIGHT_PHRASES.finishFailedTitle : WEIGHT_PHRASES.saveFailedTitle;
        return { tone: 'stop', title, body: { key: WEIGHT_PHRASES.failedBody } };
    }
    if (state === 'nothingLeft') return { tone: 'stop', title: WEIGHT_PHRASES.nothingLeftTitle, body: { key: WEIGHT_PHRASES.nothingLeftBody } };
    if (state === 'underContainer') return { tone: 'stop', title: WEIGHT_PHRASES.underContainerTitle, body: { key: WEIGHT_PHRASES.underContainerBody, vars: { weight: gramsText(container) } } };
    if (state === 'aboveRoasted') return { tone: 'warn', title: WEIGHT_PHRASES.aboveRoastedTitle, body: { key: WEIGHT_PHRASES.aboveRoastedBody, vars: { weight: gramsText(recordGrams(batch?.weight)) } } };
    return null;
}

/** The button's label, a key: "Finish batch" where nothing is left. */
export function saveLabel(state) {
    return state === 'nothingLeft' ? WEIGHT_PHRASES.finish : WEIGHT_PHRASES.save;
}

/**
 * The one write a weight makes to Decaid's record of the batch: what is left,
 * alone. Decaid keeps every field it is not given. Null for what is no weight
 * to save: nothing left is a finish, not a zero.
 */
export function weightWrite(left) {
    return Number.isInteger(left) && left > 0 && left <= MAX_TYPED ? { weightRemaining: left } : null;
}

/** The one write that finishes a batch on the tablet: its record archived. */
export function finishWrite() {
    return { archived: true };
}

/** Does Decaid's answer to a write hold what was written? */
export function stored(answer, write) {
    return !!answer && !!write && Object.entries(write).every(([field, value]) => answer[field] === value);
}
