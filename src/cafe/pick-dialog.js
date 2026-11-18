// The dialog a dial-in row's name opens, to choose what the row names: the
// grinder, the bean and batch, and the basket, and the profile after them
// (docs/cafe/DESIGN.md, "The grinder, bean and basket dialogs"). A title, a
// line under it, Close, and rows of a name over a detail, the one in use
// marked "In use". The bean's has a second list on the left, whose rows choose
// nothing: a tap there shows that bean's batches on the right. The markup is
// in index.html; this module fills it in, shows it and answers with the row
// that was tapped. What a row says, and what a choice does, are the caller's.
import { cafeText, setText } from './text.js';

let wired = false;
// A list is showing, or its close has not yet been cleaned up. The dialog's
// close event runs a task after close(): a second list opened in between would
// have its rows cleared, and be answered, by the first one's cleanup.
let active = false;

function wire(dialog) {
    if (wired) return;
    wired = true;
    // A shot that starts takes the screen back, as from the page's other dialogs.
    const drop = () => { if (dialog.open) dialog.close(); };
    document.addEventListener('streamline:espresso-start', drop);
    document.addEventListener('streamline:mainpagehidden', drop);
}

const span = (className, text) => {
    const element = document.createElement('span');
    element.className = className;
    if (text) element.textContent = text;
    return element;
};

const CHECK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function rowButton(row, onPick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cafe-pick-row';
    button.setAttribute('aria-pressed', String(!!row.inUse));
    button.dataset.id = row.id ?? '';
    const words = span('cafe-pick-row-text');
    words.append(span('cafe-pick-row-name', row.name), span('cafe-pick-row-detail', row.detail));
    button.append(words);
    if (row.inUse) {
        const mark = span('cafe-pick-in-use');
        mark.innerHTML = CHECK; // a fixed icon, not text from Decaid
        mark.append(cafeText('In use'));
        button.append(mark);
    }
    button.addEventListener('click', () => onPick(row));
    return button;
}

// A row of the list on the left: a name over a detail, the one shown on the
// right filled in.
function sideButton(row, onShow) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cafe-pick-row cafe-pick-side-row';
    button.setAttribute('aria-pressed', String(!!row.highlighted));
    button.dataset.id = row.id ?? '';
    const words = span('cafe-pick-row-text');
    words.append(span('cafe-pick-row-name', row.name), span('cafe-pick-row-detail', row.detail));
    button.append(words);
    button.addEventListener('click', () => onShow(row));
    return button;
}

// The list's own words where it has no rows ("No baskets"), as a key.
function emptyLine(key) {
    const line = document.createElement('p');
    line.className = 'cafe-pick-empty';
    setText(line, key, { translate: true });
    return line;
}

// A visible heading over a list, or none: `key` is a translation key.
function heading(element, key) {
    if (!element) return;
    element.hidden = !key;
    if (key) setText(element, key, { translate: true });
}

/** Is the dialog showing? */
export function pickOpen() {
    return !!document.getElementById('cafe-pick-dialog')?.open;
}

/**
 * Show a list to choose from. `title` is a translation key; `subtitle` is
 * `{ key, vars }`, a key and what fills its places; `label` names the list for
 * a screen reader, already in the page's language, and `heading`, a key, is
 * shown over it where given; `rows` are `{ id, name, detail, inUse }`, in the
 * order shown, and `empty` is the key said where there are none. Resolves the
 * row tapped, or null when the dialog was closed without one.
 *
 * `side`, where given, is the list on the left: `{ heading, rows, show }`,
 * where `heading` is a key, `rows` are `{ id, name, detail, highlighted }`,
 * and `show(row)` answers what the dialog shows once that row is tapped:
 * `{ subtitle, rows }` for the right-hand list.
 */
export function choose({ title, subtitle, label, heading: listHeading = null, rows, empty = null, side = null }) {
    const dialog = document.getElementById('cafe-pick-dialog');
    const list = document.getElementById('cafe-pick-list');
    const sideColumn = document.getElementById('cafe-pick-side-column');
    const sideList = document.getElementById('cafe-pick-side');
    if (!dialog || !list || typeof dialog.showModal !== 'function' || dialog.open) return Promise.resolve(null);
    if (active || (side && (!sideColumn || !sideList))) return Promise.resolve(null);
    wire(dialog);
    active = true;
    return new Promise(resolve => {
        let chosen = null;
        const pick = row => { chosen = row; dialog.close(); };
        const under = document.getElementById('cafe-pick-under');
        const fill = (next, line) => {
            setText(under, line.key, { translate: true, vars: line.vars });
            list.replaceChildren(...(next.length || !empty ? next.map(row => rowButton(row, pick)) : [emptyLine(empty)]));
        };
        setText(document.getElementById('cafe-pick-title'), title, { translate: true });
        heading(document.getElementById('cafe-pick-heading'), listHeading);
        list.setAttribute('aria-label', label);
        dialog.querySelector('.cafe-pick-box')?.classList.toggle('cafe-pick-wide', !!side);
        if (sideColumn) sideColumn.hidden = !side;
        if (side) {
            heading(document.getElementById('cafe-pick-side-heading'), side.heading);
            const show = row => {
                for (const button of sideList.children) button.setAttribute('aria-pressed', String(button.dataset.id === row.id));
                const next = side.show(row);
                fill(next.rows, next.subtitle);
                list.scrollTop = 0;
            };
            sideList.replaceChildren(...side.rows.map(row => sideButton(row, show)));
        }
        fill(rows, subtitle);
        dialog.addEventListener('close', () => {
            list.replaceChildren();
            sideList?.replaceChildren();
            active = false;
            resolve(chosen);
        }, { once: true });
        dialog.showModal();
        // Opened on the row in use, where a long list puts it out of view.
        sideList?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' });
        list.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' });
    });
}
