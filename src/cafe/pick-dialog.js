// The dialog a dial-in row's name opens, to choose what the row names: the
// grinder's list, and the bean, basket and profile lists after it
// (docs/cafe/DESIGN.md, "What the screen shows"). A title, a line under it,
// Close, and rows of a name over a detail, the one in use marked "In use".
// The markup is in index.html; this module fills it in, shows it and answers
// with the row that was tapped. What a row says, and what a choice does, are
// the caller's.
import { cafeText, setText } from './text.js';

let wired = false;

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

/** Is the dialog showing? */
export function pickOpen() {
    return !!document.getElementById('cafe-pick-dialog')?.open;
}

/**
 * Show a list to choose from. `title` is a translation key; `subtitle` is
 * `{ key, vars }`, a key and what fills its places; `label` names the list for
 * a screen reader, already in the page's language; `rows` are
 * `{ name, detail, inUse }`, in the order shown. Resolves the row tapped, or
 * null when the dialog was closed without one.
 */
export function choose({ title, subtitle, label, rows }) {
    const dialog = document.getElementById('cafe-pick-dialog');
    const list = document.getElementById('cafe-pick-list');
    if (!dialog || !list || typeof dialog.showModal !== 'function' || dialog.open) return Promise.resolve(null);
    wire(dialog);
    return new Promise(resolve => {
        let chosen = null;
        setText(document.getElementById('cafe-pick-title'), title, { translate: true });
        setText(document.getElementById('cafe-pick-under'), subtitle.key, { translate: true, vars: subtitle.vars });
        list.setAttribute('aria-label', label);
        list.replaceChildren(...rows.map(row => rowButton(row, picked => { chosen = picked; dialog.close(); })));
        dialog.addEventListener('close', () => {
            list.replaceChildren();
            resolve(chosen);
        }, { once: true });
        dialog.showModal();
        // Opened on the row in use, where a long list puts it out of view.
        list.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' });
    });
}
