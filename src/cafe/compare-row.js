// The row of cards under the graph, drawn from what comparison.js works out
// (docs/cafe/DESIGN.md, "The comparison row"): five at rest, six while a shot
// runs. This module only writes text. It reads nothing and asks the chart for
// nothing, so painting it never makes the chart draw.
import { fitTextToWidth, getCurrentLanguage } from '../modules/i18n.js';
import { cafeText } from './text.js';
import { fillIn } from './translations.js';

// As many cards as the fuller of the two rows has: the sixth is hidden at rest.
const CARDS = 6;

let slots = null;

function build(row) {
    const made = [];
    for (let index = 0; index < CARDS; index += 1) {
        const root = document.createElement('div');
        root.className = 'cafe-compare-card';
        const part = (tag, name, fits) => {
            const element = document.createElement(tag);
            element.className = `cafe-compare-${name}`;
            // Streamline fits these again itself when the page is resized.
            if (fits) element.setAttribute('data-fit-text', '');
            return element;
        };
        const slot = { root, title: part('p', 'title', true), value: part('span', 'value'), diff: part('span', 'diff'), side: part('p', 'side', true) };
        const line = document.createElement('p');
        line.className = 'cafe-compare-line';
        line.append(slot.value, slot.diff);
        root.append(slot.title, line, slot.side);
        row.append(root);
        made.push(slot);
    }
    return made;
}

// A fixed phrase a language makes too long is shrunk to fit, as the page's
// other labels are. A number is written at the size the stylesheet gives it: it
// changes with every frame of a shot, and fitting costs more than writing.
function write(element, text, fit = false) {
    if (element.textContent === text) return;
    element.textContent = text;
    if (fit) fitTextToWidth(element);
    else if (element.style.fontSize) element.style.fontSize = '';
}

// In Arabic and Hebrew a number with its unit, "27.9 s", is kept together: set
// into right-to-left text as it is, the number is drawn on one side of the word
// before it and the unit on the other.
const isolated = vars => Object.fromEntries(Object.entries(vars).map(([name, value]) => [name, `\u2068${value}\u2069`]));

// `{ phrase, vars }` is a phrase in the page's language; `{ text }` is written
// as it is, as a profile step's own name is.
function worded(part) {
    if (!part) return '';
    if (!part.phrase) return part.text;
    const vars = part.vars && /^(ar|he)$/.test(getCurrentLanguage()) ? isolated(part.vars) : part.vars;
    return cafeText(part.phrase, vars);
}

// A title is drawn in capitals. It is put into capitals here, not by the
// stylesheet, so it is fitted at the width it is drawn at, and so what fills
// its places, "18.0 g", keeps its own letters.
function titled(part) {
    const capitals = cafeText(part.phrase).split(/(\{\w+\})/).map((piece, index) => (index % 2 ? piece : piece.toUpperCase())).join('');
    return fillIn(capitals, part.vars && /^(ar|he)$/.test(getCurrentLanguage()) ? isolated(part.vars) : part.vars);
}

/**
 * Write the row. `cards` is `restCards()` or `liveCards()`; `mode` is `rest` or
 * `live`, kept on the row for the stylesheet and the page tests.
 */
export function paintRow(cards, mode) {
    const row = document.getElementById('cafe-compare');
    if (!row) return;
    if (!slots) slots = build(row);
    if (row.dataset.mode !== mode) row.dataset.mode = mode;
    slots.forEach((slot, index) => {
        const shown = cards[index];
        const display = shown ? '' : 'none';
        if (slot.root.style.display !== display) slot.root.style.display = display;
        if (!shown) return;
        if (slot.root.dataset.card !== shown.key) slot.root.dataset.card = shown.key;
        write(slot.title, titled(shown.title), true);
        write(slot.value, shown.value);
        write(slot.diff, shown.diff);
        write(slot.side, worded(shown.side), !!shown.side && !!shown.side.phrase && !shown.side.vars);
    });
}
