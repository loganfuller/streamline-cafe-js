// The dialog a Shot's note is written in, and the one the reference's note is
// read in (docs/cafe/DESIGN.md, "Rating and notes"). The markup is in
// index.html; this module fills it in and shows it. A note is text, never
// markup: it is written into the page as text.
import { cafeText, setText } from './text.js';
import { ratingText } from './remarks.js';

const el = id => document.getElementById(id);
const show = (element, shown) => { if (element) element.style.display = shown ? '' : 'none'; };

let wired = false;
let onSave = null;   // what "Save note" does with the text; null while the dialog only shows a note
let saving = false;

// Streamline lays its canvas out for the window as it is with no keyboard, and
// lifts the canvas to keep a focused field above one. This dialog is not in
// the canvas, so it says it fits itself (`data-keyboard-fit`) and takes the
// height Streamline's scaling reports as left above the keyboard: the box sits
// in what can be seen, and the text box gives up the height.
function fit(detail) {
    const dialog = el('cafe-note-dialog');
    if (detail && detail.keyboardUp === true && detail.visibleHeight > 0) {
        dialog.style.setProperty('--cafe-note-visible', `${Math.floor(detail.visibleHeight)}px`);
    } else {
        dialog.style.removeProperty('--cafe-note-visible');
    }
}

function failed(message) {
    const line = el('cafe-note-error');
    setText(line, message || '');
    show(line, !!message);
}

// A note that could not be saved is not lost: the dialog stays open with its
// text, and a line in it says why. A toast would lie under the dialog.
async function save() {
    if (!onSave || saving) return;
    const run = onSave;
    saving = true;
    el('cafe-note-save').disabled = true;
    el('cafe-note-cancel').disabled = true;
    // What is saved is the text as it stood at the tap: nothing typed while
    // the save is on its way could be kept, so nothing can be typed then.
    el('cafe-note-text').readOnly = true;
    failed('');
    try {
        await run(el('cafe-note-text').value);
        if (onSave === run) el('cafe-note-dialog').close();
    } catch (error) {
        if (onSave === run) failed(error.message);
    } finally {
        saving = false;
        el('cafe-note-save').disabled = false;
        el('cafe-note-cancel').disabled = false;
        el('cafe-note-text').readOnly = false;
    }
}

function wire(dialog) {
    if (wired) return;
    wired = true;
    el('cafe-note-save').addEventListener('click', save);
    // A note on its way is not left behind by Escape either.
    dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
    dialog.addEventListener('close', () => {
        onSave = null;
        fit(null);
    });
    document.addEventListener('streamline:scaleupdate', event => { if (dialog.open) fit(event.detail); });
    // A shot that starts takes the screen back, as from the page's other
    // dialogs: starting one is the barista's own choice. A note being written
    // is closed unsaved; one whose save is already on its way is still saved.
    document.addEventListener('streamline:espresso-start', () => { if (dialog.open) dialog.close(); });
}

function open({ title, credit, rating = null, note, save: saveWith = null }) {
    const dialog = el('cafe-note-dialog');
    if (!dialog || typeof dialog.showModal !== 'function' || dialog.open) return;
    wire(dialog);
    const editing = typeof saveWith === 'function';
    onSave = editing ? saveWith : null;
    setText(el('cafe-note-title'), title, { translate: true });
    setText(el('cafe-note-when'), credit);
    setText(el('cafe-note-rating'), ratingText(rating));
    const box = el('cafe-note-text');
    box.value = editing ? note || '' : '';
    box.placeholder = cafeText('How did it taste? What would you change next time?');
    setText(el('cafe-note-read'), editing ? '' : note || '');
    for (const id of ['cafe-note-label', 'cafe-note-text', 'cafe-note-cancel', 'cafe-note-save']) show(el(id), editing);
    for (const id of ['cafe-note-read', 'cafe-note-close']) show(el(id), !editing);
    failed('');
    dialog.showModal();
}

/**
 * Open a Shot's note to write. `title` is the phrase its row is labelled with
 * and `credit` when it was pulled and by whom. `save(text)` is called with the
 * box's text on "Save note": the dialog closes when it resolves, and stays
 * open with the text, showing the error's message, when it rejects.
 */
export function editNote({ title, credit, note, save: saveWith }) {
    open({ title, credit, note, save: saveWith });
}

/** Open a Shot's note to read, with its rating beside when it was pulled and by whom. */
export function readNote({ title, credit, rating, note }) {
    open({ title, credit, rating, note });
}
