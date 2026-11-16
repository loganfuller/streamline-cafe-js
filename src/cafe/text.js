// The cafe page's own text, looked up in one place (docs/cafe/DESIGN.md,
// "Translations").
//
// English is the key, as on Streamline's page. A lookup tries the fork's own
// table, then Streamline's translation file, then English (translations.js).
//
// The page's markup and the text a module puts into an element carry
// `data-cafe-text`, not Streamline's `data-i18n-key`: Streamline's page
// translation knows only its own file, and would write a phrase from the
// fork's table back in English every time it ran. The three elements a
// Streamline module re-labels itself (the machine status, Sleep and the cup
// warmer) keep `data-i18n-key` and stay Streamline's.
import { getTranslation, getCurrentLanguage, fitTextToWidth } from '../modules/i18n.js';
import { cafeTranslation, dateLocale } from './translations.js';

const KEY = 'data-cafe-text';
const VARS = 'data-cafe-vars';

/** A phrase in the page's language. `vars` fills its `{name}` places. */
export function cafeText(key, vars) {
    return cafeTranslation(key, getCurrentLanguage(), getTranslation, vars);
}

/**
 * The locale dates on the page are formatted in: the page's language. In
 * English the tablet's own English is kept where it has one, so "28 Oct" stays
 * in that order on a tablet set to it.
 */
export function cafeDateLocale() {
    const language = getCurrentLanguage();
    const own = typeof navigator !== 'undefined' ? navigator.language : '';
    if (language === 'en' && /^en\b/i.test(own || '')) return own;
    return dateLocale(language);
}

function paint(element) {
    let vars;
    try { vars = element.hasAttribute(VARS) ? JSON.parse(element.getAttribute(VARS)) : undefined; } catch (error) { /* shown unfilled */ }
    const shown = cafeText(element.getAttribute(KEY), vars);
    if (element.textContent === shown) return;
    element.textContent = shown;
    // Streamline fits its own labels as it translates them, which is before this
    // text was written: fit the new text to the same place.
    if (element.hasAttribute('data-fit-text')) fitTextToWidth(element);
}

/**
 * Put text into an element. A translation key is kept on the element, with what
 * fills its `{name}` places, so the text follows a change of language; a
 * recipe's or a bean's own name is not a key and is written as it is.
 */
export function setText(element, value, { translate = false, vars } = {}) {
    if (!element) return;
    if (!translate) {
        element.removeAttribute(KEY);
        element.removeAttribute(VARS);
        if (element.textContent !== value) element.textContent = value;
        return;
    }
    element.setAttribute(KEY, value);
    if (vars) element.setAttribute(VARS, JSON.stringify(vars));
    else element.removeAttribute(VARS);
    paint(element);
}

// Every keyed element on the page, in the language now chosen. Streamline
// announces the language once it is known at start-up and on every change in
// Settings.
function translateCafePage() {
    document.querySelectorAll(`[${KEY}]`).forEach(paint);
}

if (typeof document !== 'undefined') {
    document.addEventListener('streamline:languagechange', translateCafePage);
}
