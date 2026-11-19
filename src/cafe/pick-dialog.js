// The dialog a dial-in row's name opens, to choose what the row names: the
// grinder, the bean and batch, the basket and the profile (docs/cafe/DESIGN.md,
// "The grinder, bean and basket dialogs" and "The profile dialog"), and the one
// the title band's barista opens ("The barista"). A title, a line under it,
// Close, and rows of a name over a detail, the one in use marked "In use". The
// bean's has a second list on the left, whose rows choose nothing: a tap there
// shows that bean's batches on the right. The profile's has the same list on
// the left and, in place of a second list, a description of the row tapped
// there, with a button under it that chooses that row. The bean's batches, on
// the right, are chosen the same way: a tap highlights a batch, and a button
// under them chooses it. The barista's has a row
// set apart under the list that turns the dialog into a text field, for a name
// to type. The markup is in index.html; this module fills it in, shows it and
// answers with the row that was tapped or confirmed, or the text typed. What a
// row and a description say, and what a choice does, are the caller's.
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
    // dialogs, a name being typed too. So does the machine going to sleep: a
    // modal dialog would sit over the screensaver, and a name chosen there
    // would outlast the sleep's clear.
    const drop = () => { if (dialog.open) dialog.close(); };
    document.addEventListener('streamline:espresso-start', drop);
    document.addEventListener('streamline:machine-asleep', drop);
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

// The check and "In use", after a row's words or in the place of the
// description's button.
function inUseMark() {
    const mark = span('cafe-pick-in-use');
    mark.innerHTML = CHECK; // a fixed icon, not text from Decaid
    mark.append(cafeText('In use'));
    return mark;
}

// A row of the list on the right: a name over a detail, the one in use marked
// "In use". A tap chooses it, or, where the list is `confirm`ed, highlights
// it, and `aria-pressed` then says which row is highlighted.
function rowButton(row, onPick, held = !!row.inUse) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cafe-pick-row';
    button.setAttribute('aria-pressed', String(held));
    button.dataset.id = row.id ?? '';
    const words = span('cafe-pick-row-text');
    words.append(span('cafe-pick-row-name', row.name), span('cafe-pick-row-detail', row.detail));
    button.append(words);
    if (row.inUse) button.append(inUseMark());
    button.addEventListener('click', () => onPick(row));
    return button;
}

// A row of the list on the left: a name over a detail, the one shown on the
// right filled in, and the one in use marked where the row says so (the
// profile's do; the bean's say nothing of it).
function sideButton(row, onShow) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cafe-pick-row cafe-pick-side-row';
    button.setAttribute('aria-pressed', String(!!row.highlighted));
    button.dataset.id = row.id ?? '';
    const words = span('cafe-pick-row-text');
    words.append(span('cafe-pick-row-name', row.name), span('cafe-pick-row-detail', row.detail));
    button.append(words);
    if (row.inUse) button.append(inUseMark());
    button.addEventListener('click', () => onShow(row));
    return button;
}

// The parts of the description `pane` adds, or null where the page lacks one.
function paneParts() {
    const parts = {
        column: el('cafe-pick-pane'),
        heading: el('cafe-pick-pane-heading'),
        title: el('cafe-pick-pane-title'),
        byline: el('cafe-pick-pane-byline'),
        text: el('cafe-pick-pane-text'),
        inUse: el('cafe-pick-pane-in-use'),
        note: el('cafe-pick-pane-note'),
        use: el('cafe-pick-pane-use'),
    };
    return Object.values(parts).every(Boolean) ? parts : null;
}

// One description, as plain text: what a profile's author wrote is never read
// as markup. `shown` is `{ title, byline, text, placeholder, inUse, use }`, all
// in the page's language, or null for nothing to describe: `placeholder` says
// `text` is the dialog's own words where there is no description, and `use`,
// `{ label, note }` or null, is the button that chooses what is described,
// with a note beside it.
function describe(parts, described) {
    const shown = described || {};
    parts.title.textContent = shown.title || '';
    parts.byline.textContent = shown.byline || '';
    parts.byline.hidden = !shown.byline;
    parts.text.textContent = shown.text || '';
    parts.text.classList.toggle('cafe-pick-pane-none', !!shown.placeholder);
    parts.text.scrollTop = 0;
    parts.inUse.hidden = !shown.inUse;
    parts.note.textContent = shown.use?.note || '';
    parts.note.hidden = !shown.use?.note;
    parts.use.textContent = shown.use?.label || '';
    parts.use.hidden = !shown.use;
}

// The parts of the button `confirm` adds under the list, or null where the
// page lacks one.
function confirmParts() {
    const parts = {
        column: el('cafe-pick-confirm'),
        inUse: el('cafe-pick-confirm-in-use'),
        note: el('cafe-pick-confirm-note'),
        use: el('cafe-pick-confirm-use'),
    };
    return Object.values(parts).every(Boolean) ? parts : null;
}

// The button under a `confirm`ed list, for the row highlighted, or none.
// `offer` is that row's `{ label, note }`, or null where it is the row in use
// and there is nothing to confirm: "In use" then stands in the button's place.
// With no row highlighted the button is shown, `idle` its label, and can't be
// tapped.
function offerUse(parts, row, offer, idle) {
    const settled = !!row && !offer;
    parts.inUse.hidden = !settled;
    parts.note.textContent = offer?.note || '';
    parts.note.hidden = !offer?.note;
    parts.use.textContent = offer?.label || idle;
    parts.use.hidden = settled;
    parts.use.disabled = !offer;
}

// No button under the list, and no handler.
function closeConfirm(parts, list) {
    list.classList.remove('cafe-pick-confirming');
    if (!parts) return;
    parts.column.hidden = true;
    parts.use.onclick = null;
}

// The dialog's own list again, with no description and no handler.
function closePane(parts, listColumn) {
    if (listColumn) listColumn.hidden = false;
    if (!parts) return;
    parts.column.hidden = true;
    parts.use.onclick = null;
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
 * `side`, where given, is the list on the left: `{ heading, rows, show, empty }`,
 * where `heading` is a key, `rows` are `{ id, name, detail, highlighted, inUse }`,
 * `show(row)` answers what the dialog shows once that row is tapped:
 * `{ subtitle, rows }` for the right-hand list, and `empty`, a key, is said
 * where it has no rows.
 *
 * `pane`, where given with `side`, puts a description in place of the
 * right-hand list, whose `rows` are then not shown: `{ heading, shown }`, where
 * `heading` is a key and `shown` the description the dialog opens on (see
 * `describe`). `show(row)` then answers `{ pane }`, that row's description,
 * and may answer a `subtitle` too. A tap on the left still chooses nothing: the
 * description's button resolves the row it describes, which is the one
 * highlighted, and the dialog opens on the row `highlighted` names, or on none.
 *
 * `confirm`, where given, makes a tap on the right-hand list highlight a row
 * and choose nothing, and adds a button under the list that chooses the row
 * highlighted: `{ idle, use }`, where `idle` is the button's label with no row
 * highlighted, already in the page's language, and `use(row)` answers that
 * row's `{ label, note }` for the button and the words beside it, or null
 * where it is the row in use and there is nothing to confirm. Each time the
 * list is filled, its row in use is highlighted, or none. The rows on the left
 * still choose nothing: with `side`, a tap there fills the list again.
 *
 * `entry`, where given, adds a row set apart under the list that turns the
 * dialog into a text field: `{ action, title, label, back, use }`, each a key,
 * for the row, the title while the field shows, the field's label and its two
 * buttons. "Back" shows the list again; the other resolves `{ entered }`, the
 * text as it was typed, once it holds more than spaces.
 */
export function choose({ title, subtitle, label, heading: listHeading = null, rows = [], empty = null, side = null, pane = null, confirm = null, entry = null }) {
    const dialog = document.getElementById('cafe-pick-dialog');
    const list = document.getElementById('cafe-pick-list');
    const sideColumn = document.getElementById('cafe-pick-side-column');
    const sideList = document.getElementById('cafe-pick-side');
    const parts = entryParts();
    const paneEls = paneParts();
    const described = pane ? paneEls : null;
    const confirmEls = confirmParts();
    const confirmed = confirm && !pane ? confirmEls : null;
    if (!dialog || !list || typeof dialog.showModal !== 'function' || dialog.open) return Promise.resolve(null);
    if (active || (side && (!sideColumn || !sideList)) || (entry && !parts) || (pane && (!side || !described))) return Promise.resolve(null);
    if (confirm && (pane || entry || !confirmed)) return Promise.resolve(null);
    wire(dialog);
    active = true;
    return new Promise(resolve => {
        let chosen = null;
        const pick = row => { chosen = row; dialog.close(); };
        const under = document.getElementById('cafe-pick-under');
        const titled = document.getElementById('cafe-pick-title');
        const listColumn = list.closest('.cafe-pick-column');
        const say = line => setText(under, line.key, { translate: true, vars: line.vars });
        // The row highlighted in a `confirm`ed list, which its button chooses.
        let heldRow = null;
        const hold = row => {
            heldRow = row;
            for (const button of list.children) {
                if (button.classList.contains('cafe-pick-row')) button.setAttribute('aria-pressed', String(!!row && button.dataset.id === String(row.id ?? '')));
            }
            offerUse(confirmed, row, row ? confirm.use(row) : null, confirm.idle);
        };
        const fill = (next, line) => {
            say(line);
            const onRow = confirmed ? hold : pick;
            list.replaceChildren(...(next.length || !empty ? next.map(row => rowButton(row, onRow)) : [emptyLine(empty)]));
            if (!confirmed) return;
            // No button under "No beans with a batch".
            confirmed.column.hidden = !next.length;
            hold(next.find(row => row.inUse) || null);
        };
        // The row the description is of, which its button chooses.
        let describedRow = null;
        setText(titled, title, { translate: true });
        heading(document.getElementById('cafe-pick-heading'), listHeading);
        list.setAttribute('aria-label', label);
        const box = dialog.querySelector('.cafe-pick-box');
        box?.classList.toggle('cafe-pick-wide', !!side && !pane);
        box?.classList.toggle('cafe-pick-described', !!pane);
        if (sideColumn) sideColumn.hidden = !side;
        if (side) {
            heading(document.getElementById('cafe-pick-side-heading'), side.heading);
            const show = row => {
                for (const button of sideList.children) button.setAttribute('aria-pressed', String(button.dataset.id === row.id));
                const next = side.show(row);
                if (pane) {
                    if (next.subtitle) say(next.subtitle);
                    describedRow = row;
                    describe(described, next.pane);
                    return;
                }
                fill(next.rows, next.subtitle);
                list.scrollTop = 0;
            };
            const sideRows = side.rows.map(row => sideButton(row, show));
            sideList.replaceChildren(...(sideRows.length || !side.empty ? sideRows : [emptyLine(side.empty)]));
        }
        closePane(paneEls, listColumn);
        closeConfirm(confirmEls, list);
        if (confirmed) {
            list.classList.add('cafe-pick-confirming');
            confirmed.column.hidden = false;
            confirmed.use.onclick = () => { if (heldRow && confirm.use(heldRow)) pick(heldRow); };
        }
        if (pane) {
            say(subtitle);
            list.replaceChildren();
            listColumn.hidden = true;
            described.column.hidden = false;
            heading(described.heading, pane.heading);
            describedRow = side.rows.find(row => row.highlighted) || null;
            describe(described, pane.shown);
            described.use.onclick = () => { if (describedRow) pick(describedRow); };
        } else {
            fill(rows, subtitle);
        }
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
            closePane(paneEls, listColumn);
            closeConfirm(confirmEls, list);
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
