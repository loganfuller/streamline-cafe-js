// What the line under Dose names: the batch's Batch Code, the bean's name and
// the days since the batch's roast (docs/cafe/DESIGN.md, "What the screen
// shows" and "The bean and batch dialog"). No browser global is touched: the
// phrase goes through `t`, and the tablet's calendar day is handed in.
import { roastDay } from './page-model.js';
import { batchCode, daysOffRoast, sinceRoastText } from './bean-model.js';

const SEPARATOR = ' · ';

const text = value => (typeof value === 'string' ? value.trim() : '');

/**
 * What Dose names, from the Workflow and `batch`, Decaid's record of the Bean
 * Batch it names: the bean's name, and the batch's Batch Code and whole days
 * from its roast day to `today` (YYYY-MM-DD). The code and the days come only
 * from the record of the batch the Workflow names, and are '' and null
 * otherwise or where the record has none.
 */
export function doseNames(workflow, batch, today) {
    const context = (workflow && workflow.context) || {};
    const sameBatch = Boolean(batch && context.beanBatchId && batch.id === context.beanBatchId);
    return {
        code: sameBatch ? batchCode(batch) : '',
        bean: text(context.coffeeName),
        days: sameBatch ? daysOffRoast(roastDay(batch.roastDate), today) : null,
    };
}

/**
 * The line under Dose, in its parts, left out where empty: the Batch Code, the
 * bean's name and the days since the roast, in the bean and batch dialog's
 * words ("16 d since roast"), with " · " between them. Each separator, in
 * `before` or `after`, goes with the code or the days, never with the bean's
 * name, which is the part shortened to fit, so neither is cut off with it.
 * `shrinks` marks the bean's name, and `kind` says which part each is.
 */
export function doseLine({ code, bean, days }, t) {
    const parts = [
        { kind: 'code', text: code, shrinks: false },
        { kind: 'bean', text: bean, shrinks: true },
        { kind: 'days', text: sinceRoastText(days, t), shrinks: false },
    ].filter(part => part.text);
    return parts.map((part, index) => {
        const whole = !part.shrinks;
        const before = whole && index > 0 && parts[index - 1].shrinks ? SEPARATOR : '';
        const after = whole && index < parts.length - 1 ? SEPARATOR : '';
        return { ...part, before, after };
    });
}
