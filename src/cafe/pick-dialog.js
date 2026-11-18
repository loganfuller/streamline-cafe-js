// The dialog a dial-in row's name opens, to choose what the row names: the
// grinder, the bean and batch, and the basket, and the profile after them
// (docs/cafe/DESIGN.md, "The grinder, bean and basket dialogs"), and the one
// the title band's barista opens ("The barista"). A title, a line under it,
// Close, and rows of a name over a detail, the one in use marked "In use". The
// bean's has a second list on the left, whose rows choose nothing: a tap there
// shows that bean's batches on the right. The barista's has a row set apart
// under the list that turns the dialog into a text field, for a name to type.
// The markup is in index.html; this module fills it in, shows it and answers
// with the row that was tapped, or the text typed. What a row says, and what a
// choice does, are the caller's.
import { cafeText, setText } from './text.js';

let wired = false;
// A list is showing, or its close has not yet been cleaned up. The dialog's
// close event runs a task after close(): a second list opened in between would
// have its rows cleared, and be answered, by the first one's cleanup.
let active = false;

const el = id => document.getElementById(id);

// Streamline lifts its canvas to keep a focused field above the soft keyboard,
// but this dialog is not in the canvas. So, as the note's dialog does, it says
// it fits itself (`data-keyboard-fit`) and takes the height Streamline's
// scaling reports as left above the keyboard, in screen px: the box sits in
// what can be seen. Only the barista's name field takes the keyboard.
function fit(detail) {
    const dialog = el('cafe-pick-dialog');
    if (detail && detail.keyboardUp === true && detail.visibleHeight > 0) {
        dialog.style.setProperty('--cafe-pick-visible', `${Math.floor(detail.visibleHeight)}px`);
    } else {
        dialog.style.removeProperty('--cafe-pick-visible');
    }
}

function wire(dialog) {
    if (wired) return;
    wired = true;
    // A shot that starts takes the screen back, as from the page's other
    // dialogs, a name being typed too.
    const drop = () => { if (dialog.open) dialog.close(); };
    document.addEventListener('streamline:espresso-start', drop);
    document.addEventListener('streamline:mainpagehidden', drop);
    document.addEventListener('streamline:scaleupdate', event => { if (dialog.open) fit(event.detail); });
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

// The parts of the text field `entry` adds, or null where the page lacks one.
function entryParts() {
    const parts = {
        lists: document.querySelector('#cafe-pick-dialog .cafe-pick-lists'),
        add: el('cafe-pick-add'),
        addText: el('cafe-pick-add-text'),
        form: el('cafe-pick-entry'),
        label: el('cafe-pick-entry-label'),
        field: el('cafe-pick-entry-text'),
        back: el('cafe-pick-entry-back'),
        use: el('cafe-pick-entry-use'),
    };
    return Object.values(parts).every(Boolean) ? parts : null;
}

// The list again, with no text field, no handlers and no row set apart.
function closeEntry(parts) {
    if (!parts) return;
    parts.lists.hidden = false;
    parts.form.hidden = true;
    parts.add.hidden = true;
    parts.field.value = '';
    parts.add.onclick = null;
    parts.back.onclick = null;
    parts.form.onsubmit = null;
    parts.field.oninput = null;
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
 *
 * `entry`, where given, adds a row set apart under the list that turns the
 * dialog into a text field: `{ action, title, label, back, use }`, each a key,
 * for the row, the title while the field shows, the field's label and its two
 * buttons. "Back" shows the list again; the other resolves `{ entered }`, the
 * text as it was typed, once it holds more than spaces.
 */
export function choose({ title, subtitle, label, heading: listHeading = null, rows, empty = null, side = null, entry = null }) {
    const dialog = document.getElementById('cafe-pick-dialog');
    const list = document.getElementById('cafe-pick-list');
    const sideColumn = document.getElementById('cafe-pick-side-column');
    const sideList = document.getElementById('cafe-pick-side');
    const parts = entryParts();
    if (!dialog || !list || typeof dialog.showModal !== 'function' || dialog.open) return Promise.resolve(null);
    if (active || (side && (!sideColumn || !sideList)) || (entry && !parts)) return Promise.resolve(null);
    wire(dialog);
    active = true;
    return new Promise(resolve => {
        let chosen = null;
        const pick = row => { chosen = row; dialog.close(); };
        const under = document.getElementById('cafe-pick-under');
        const titled = document.getElementById('cafe-pick-title');
        const fill = (next, line) => {
            setText(under, line.key, { translate: true, vars: line.vars });
            list.replaceChildren(...(next.length || !empty ? next.map(row => rowButton(row, pick)) : [emptyLine(empty)]));
        };
        setText(titled, title, { translate: true });
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
        closeEntry(parts);
        if (entry) {
            const typed = () => parts.field.value.trim() !== '';
            const typing = on => {
                parts.lists.hidden = on;
                parts.form.hidden = !on;
                setText(titled, on ? entry.title : title, { translate: true });
                parts.field.value = '';
                parts.use.disabled = true;
                if (on) parts.field.focus();
            };
            setText(parts.addText, entry.action, { translate: true });
            setText(parts.label, entry.label, { translate: true });
            setText(parts.back, entry.back, { translate: true });
            setText(parts.use, entry.use, { translate: true });
            parts.add.hidden = false;
            parts.add.onclick = () => typing(true);
            parts.back.onclick = () => typing(false);
            parts.field.oninput = () => { parts.use.disabled = !typed(); };
            // "Use this name", or the keyboard's own key: a name of nothing but
            // spaces does nothing.
            parts.form.onsubmit = event => {
                event.preventDefault();
                if (!typed()) return;
                pick({ entered: parts.field.value });
            };
        }
        dialog.addEventListener('close', () => {
            list.replaceChildren();
            sideList?.replaceChildren();
            closeEntry(parts);
            fit(null);
            active = false;
            resolve(chosen);
        }, { once: true });
        dialog.showModal();
        // Opened on the row in use, where a long list puts it out of view.
        sideList?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' });
        list.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' });
    });
}
