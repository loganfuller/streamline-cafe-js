// The cafe page's own text, looked up in one place.
//
// English is the key, as on Streamline's page. Static markup carries
// `data-i18n-key` and is translated with the rest of the page; text a module
// builds goes through here. The fork's own translation table arrives with the
// next ticket and changes this file, not its callers.
import { getTranslation } from '../modules/i18n.js';

export function cafeText(key) {
    return getTranslation(key);
}

/**
 * Put text into an element. A translation key is kept on the element, so
 * Streamline's page translation re-translates it on a language change; a
 * recipe's or a bean's own name is not a key and is written as it is.
 */
export function setText(element, value, { translate = false } = {}) {
    if (!element) return;
    if (translate) element.setAttribute('data-i18n-key', value);
    else element.removeAttribute('data-i18n-key');
    const shown = translate ? cafeText(value) : value;
    if (element.textContent !== shown) element.textContent = shown;
}
