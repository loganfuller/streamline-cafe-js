// DYE2's name for a recipe, and whether a recipe still has it
// (docs/cafe/DESIGN.md, "Changing the profile", and "The bean and batch
// dialog"). No browser global is touched.
//
// DYE2 names a recipe it makes from the first word of its profile's title, its
// bean and any beverage typed for it (`proposeRecipeName` in DYE2's
// workflow-record.ts, v0.1.42): "Turbo Ethiopia". The word is left out when it
// says nothing ("Default", "Custom"...). With no bean it adds the day the recipe
// was made, after "Recipe" where nothing else is left: "Turbo 26 Oct",
// "Recipe 26 Oct". A name already taken, compared without case, gets " 2",
// " 3" and so on. DYE2 keeps no mark of a name it made, so a name is DYE2's when
// the rule gives it again for the recipe's own profile, bean and beverage. A name
// someone typed that matches by chance counts too, and a rule DYE2 changes later
// leaves older names unmatched.

const GENERIC_PROFILE = /^(default|advanced|custom|profile|new|untitled)$/i;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "26 Oct", as DYE2 writes the day: no zero, the month's short English name.
const DAY = new RegExp(`^(?:[1-9]|[12]\\d|3[01]) (?:${MONTHS.join('|')})$`, 'i');

const text = value => (typeof value === 'string' ? value.trim() : '');
const lower = value => value.toLowerCase();

/** The first word of a profile's title, as DYE2 reads it: '' when it says nothing. */
export function profileWord(title) {
    const word = text(title).split(/\s+/)[0] || '';
    return GENERIC_PROFILE.test(word) ? '' : word;
}

/**
 * The name DYE2's rule gives before any count: `day` ("26 Oct") is added only
 * where there is no bean.
 */
export function baseName({ title, bean, beverage, day }) {
    const parts = [profileWord(title), text(bean), text(beverage)].filter(Boolean);
    if (!parts.length) parts.push('Recipe');
    if (!text(bean)) parts.push(day);
    return parts.join(' ');
}

const unique = values => [...new Set(values.map(text).filter(Boolean))];

// The profile titles a record may have been named from: the one DYE2 noted, the
// one in its stored Workflow, and its snapshot's.
function recordTitles(row) {
    return unique([row?.profileTitle, row?.workflow?.profile?.title, row?.profileSnapshot?.title]);
}

// The bean's name, as DYE2 noted it on the record and in its stored Workflow.
// '' stands for a record with no bean.
function recordBeans(row) {
    const beans = unique([row?.beanName, row?.workflow?.context?.coffeeName]);
    return beans.length ? beans : [''];
}

/** A record's name as DYE2's own lists read it: its `name`, else its `title`. */
export function recordName(row) {
    return text(row?.name) || text(row?.title);
}

// Split a trailing count (" 2", " 3"...) from a name.
function withoutCount(name) {
    const match = /^(.*\S) ([2-9]|[1-9]\d+)$/.exec(name);
    return match ? [name, match[1]] : [name];
}

/**
 * How DYE2's rule gave this record its name, or null when it did not: the title,
 * bean and day it was made from. The record's beverage is part of the rule, and
 * a name with or without DYE2's count matches. Compared without case.
 */
export function generatedFrom(row) {
    const name = recordName(row);
    if (!name) return null;
    const beverage = text(row?.beverage);
    // A record with no title DYE2 can read still has a name it could make: "Recipe 26 Oct".
    const titles = recordTitles(row);
    for (const candidate of withoutCount(name)) {
        for (const title of titles.length ? titles : ['']) {
            for (const bean of recordBeans(row)) {
                if (bean) {
                    if (lower(baseName({ title, bean, beverage })) === lower(candidate)) return { title, bean, beverage, day: null };
                    continue;
                }
                // No bean: any day DYE2 could have written.
                const head = baseName({ title, bean: '', beverage, day: '' }).trimEnd();
                const lowered = lower(candidate);
                if (!lowered.startsWith(`${lower(head)} `)) continue;
                const day = candidate.slice(head.length + 1);
                if (DAY.test(day)) return { title, bean: '', beverage, day };
            }
        }
    }
    return null;
}

/**
 * The name a record takes when its profile, its bean or both change, or null
 * when it keeps the one it has: a name someone gave it, or one the rule gives
 * the same before and after. `change.title` is the new profile's title and
 * `change.bean` the new bean's name; one left out stays as the name was made
 * from. A bean gained drops the day the old name held, as DYE2 adds one only
 * where there is no bean, and a bean with no name renames nothing. `others`
 * are the other records on the tablet: a name one of them has (its `name`,
 * else its `title`, without case) takes the next free count, as DYE2 does.
 * The record itself never counts against its new name.
 */
export function renamedWith(row, change, others = []) {
    const from = generatedFrom(row);
    if (!from) return null;
    if ('bean' in change && !text(change.bean)) return null;
    const title = 'title' in change ? change.title : from.title;
    const bean = 'bean' in change ? text(change.bean) : from.bean;
    const next = baseName({ title, bean, beverage: from.beverage, day: from.day });
    const before = baseName(from);
    if (lower(next) === lower(before)) return null;
    const self = other => other === row || (row?.id != null && other?.id != null && String(other.id) === String(row.id));
    const taken = new Set(others.filter(other => other && typeof other === 'object' && !self(other)).map(recordName).filter(Boolean).map(lower));
    if (!taken.has(lower(next))) return next;
    let n = 2;
    while (taken.has(lower(`${next} ${n}`))) n += 1;
    return `${next} ${n}`;
}

/** The name a record takes when its profile becomes one titled `title` (`renamedWith`). */
export function renamedFor(row, title, others = []) {
    return renamedWith(row, { title }, others);
}

/** The name a record takes when its bean becomes one named `bean` (`renamedWith`). */
export function renamedForBean(row, bean, others = []) {
    return renamedWith(row, { bean }, others);
}
