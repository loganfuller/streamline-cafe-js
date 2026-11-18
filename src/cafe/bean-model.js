// The bean and batch dialog's two lists, the line under its title, and what
// choosing a batch writes (docs/cafe/DESIGN.md, "The grinder, bean and basket
// dialogs"). No browser global is touched: the phrases go through `t`, the
// roast day through `formatDay`, and Decaid's answers and today's date are
// handed in.
//
// A choice writes the Workflow and nothing else: the bean's name, its roaster
// and the batch's id, under Streamline's own bean writer (`beans.select`). On a
// Machine Decent Sync serves, with a Recipe loaded, Decent Sync records a batch
// of the Recipe's own Bean from that write; a batch of another Bean stays this
// machine's (decent-sync ADR-0022, "What stays the Machine's own").
import { selectableBeans, selectableBatches, currentBeanContext } from '../modules/bean-selection.js';
import { pickSubtitle, roastDay } from './page-model.js';

/** The phrases the dialog may say, for the translations test. */
export const BEAN_PHRASES = {
    title: 'Bean and batch',
    beanHeading: 'Bean',
    batchHeading: 'Batches',
    empty: 'No beans with a batch',
    oneBatch: '1 batch',
    batches: '{count} batches',
    roasted: 'Roasted {date}',
    oneDay: '1 day off roast',
    days: '{days} days off roast',
    noRoastDate: 'No roast date',
    unnamed: 'Unnamed',
    otherBean: '{recipe} · a different bean changes this machine only',
};

const text = value => (typeof value === 'string' ? value.trim() : '');
const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** Decaid's answer as a list: an array or `{ items }`. Null where it is no list. */
export function listOf(answer) {
    if (Array.isArray(answer)) return answer;
    if (Array.isArray(answer?.items)) return answer.items;
    return null;
}

// Newest roast first; a batch with no roast date after every dated one. Two on
// the same day keep the order Decaid gave them.
function newestFirst(batches) {
    return batches
        .map((batch, index) => ({ batch, index, day: roastDay(batch.roastDate) }))
        .sort((a, b) => {
            if (a.day && b.day && a.day !== b.day) return a.day < b.day ? 1 : -1;
            if (!a.day !== !b.day) return a.day ? -1 : 1;
            return a.index - b.index;
        })
        .map(entry => entry.batch);
}

/**
 * The bean list: each bean not archived that has a batch not archived, with
 * those batches newest roast first, sorted by the bean's name. `batches` is
 * every batch read for those beans, archived ones too. Null where either
 * answer is not a list: a list read in part is not offered.
 */
export function beanList(beans, batches) {
    const beanRows = listOf(beans);
    const batchRows = listOf(batches);
    if (!beanRows || !batchRows) return null;
    const listed = selectableBatches(batchRows);
    return selectableBeans(beanRows)
        .map(bean => ({ bean, batches: newestFirst(listed.filter(batch => sameId(batch.beanId, bean.id))) }))
        .filter(entry => entry.batches.length > 0)
        .sort((a, b) => byName(text(a.bean.name), text(b.bean.name)));
}

/**
 * The bean the dialog opens on: the bean of the batch the Workflow names (a
 * batch archived since is still found in `batches`, which holds those too),
 * else the listed bean with the Workflow's name and roaster, else the first.
 * Null for an empty list.
 */
export function openingBean(list, context, batches) {
    if (!list?.length) return null;
    const listed = id => list.find(entry => sameId(entry.bean.id, id));
    const inUse = (listOf(batches) || []).find(batch => sameId(batch?.id, context?.beanBatchId));
    const byBatch = inUse && listed(inUse.beanId);
    if (byBatch) return String(byBatch.bean.id);
    const name = text(context?.coffeeName);
    const roaster = text(context?.coffeeRoaster);
    const byWords = name && list.find(entry => text(entry.bean.name) === name && text(entry.bean.roaster) === roaster);
    return String((byWords || list[0]).bean.id);
}

/**
 * The Recipe's own Bean: the one its DYE2 record names, by its `beanId`, or
 * failing that the bean of its `beanBatchId`, found in `batches` or in
 * `recipeBatch` (that one batch, read on its own). Null for a recipe that
 * names neither, which has no Bean.
 */
export function recipeBeanId(recipe, batches, recipeBatch = null) {
    if (!recipe) return null;
    if (recipe.beanId != null && text(String(recipe.beanId))) return String(recipe.beanId);
    if (recipe.beanBatchId == null) return null;
    const batch = [...(listOf(batches) || []), recipeBatch].find(row => sameId(row?.id, recipe.beanBatchId));
    return batch?.beanId != null ? String(batch.beanId) : null;
}

/**
 * The left list's rows: each bean's name over its roaster and how many
 * batches it has, the one shown on the right `highlighted`.
 */
export function beanRows(list, highlightedId, t) {
    return (list || []).map(({ bean, batches }) => {
        const count = batches.length === 1 ? t(BEAN_PHRASES.oneBatch) : t(BEAN_PHRASES.batches, { count: batches.length });
        return {
            id: String(bean.id),
            bean,
            name: text(bean.name) || t(BEAN_PHRASES.unnamed),
            detail: [text(bean.roaster), count].filter(Boolean).join(' · '),
            highlighted: sameId(bean.id, highlightedId),
        };
    });
}

/**
 * Whole days from the roast day to `today`, both YYYY-MM-DD, or null without
 * a roast day. A roast dated after today counts as 0.
 */
export function daysOffRoast(day, today) {
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(today || '')) return null;
    const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
    return Number.isFinite(days) ? Math.max(0, days) : null;
}

/**
 * The right list's rows, for one bean of `beanList`: "Roasted" and the date
 * over the days off roast, or "No roast date" alone, with the Workflow's own
 * batch `inUse`. `today` is the tablet's calendar day, YYYY-MM-DD, and
 * `formatDay` writes a YYYY-MM-DD day in the page's language.
 */
export function batchRows(entry, context, today, formatDay, t) {
    return (entry?.batches || []).map(batch => {
        const day = roastDay(batch.roastDate);
        const days = daysOffRoast(day, today);
        return {
            id: String(batch.id),
            bean: entry.bean,
            batch,
            name: day ? t(BEAN_PHRASES.roasted, { date: formatDay(day) }) : t(BEAN_PHRASES.noRoastDate),
            detail: days === null ? '' : days === 1 ? t(BEAN_PHRASES.oneDay) : t(BEAN_PHRASES.days, { days }),
            inUse: sameId(batch.id, context?.beanBatchId),
        };
    });
}

/**
 * The Workflow write that chooses `batch` of `bean`, or null where it is the
 * batch in use (`context` is the Workflow's), which writes nothing. One write,
 * as Streamline's own bean picker makes it: the bean's name, its roaster and
 * the batch's id.
 */
export function batchPick(bean, batch, context) {
    if (!batch || sameId(batch.id, context?.beanBatchId)) return null;
    const patch = currentBeanContext(bean, batch);
    return patch ? { context: patch } : null;
}

/**
 * The line under the dialog's title, which follows the bean highlighted on
 * the left: as the grinder's (`pickSubtitle`), except that where Decent Sync
 * saves (`saved`) and that bean is not the Recipe's own (`ownBeanId`, from
 * `recipeBeanId`), a choice stays this machine's, and the line says so. A
 * Recipe that names no Bean takes any batch with its Bean.
 */
export function beanSubtitle(recipe, saved, highlightedId, ownBeanId) {
    const line = pickSubtitle(recipe, saved);
    if (!recipe || !saved || ownBeanId == null || highlightedId == null || sameId(highlightedId, ownBeanId)) return line;
    return { key: BEAN_PHRASES.otherBean, vars: line.vars };
}
