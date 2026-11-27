// The Cafe category of Streamline's Settings page, the skin's own: one page,
// "Batches", with one setting, the weight of the empty container a batch is
// kept in (docs/cafe/DESIGN.md, "Settings" and "Entering a batch's weight").
// Streamline's settings shell mounts it as it mounts its own extracted
// categories, through the hooks listed in docs/cafe/UPSTREAM_EDITS.md.
//
// The setting is kept for the tablet in the skin's own namespace of Decaid's
// store (cafe-store.js), written as soon as it is changed: the page's Save and
// Cancel are for Decaid's own settings. On a tablet a tap on the field opens
// Streamline's numpad, as the page's other number fields do.
import { logger } from '../modules/logger.js';
import { showToast } from '../modules/ui.js';
import { shouldUseNumpad } from '../modules/numpad-policy.js';
import { openModal as openNumpad, initializeNumpadModal } from '../modules/numpad-modal.js';
import { WEIGHT_PHRASES, MAX_CONTAINER, containerWeight } from './weight-model.js';
import { readCafe, writeCafe, CONTAINER_KEY } from './cafe-store.js';
import { cafeText, setText } from './text.js';

const NUMPAD_FIELD = 'cafe-container-weight';

const MARKUP = `
    <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
        <h2 class="font-semibold text-[var(--text-primary)] text-[36px] text-center w-full" data-cafe-page></h2>
        <hr class="border-t border-[var(--border-primary)] w-full">
        <div class="cafe-setting">
            <p class="cafe-setting-heading" data-cafe-heading></p>
            <div class="cafe-setting-row">
                <label for="cafe-container-weight" data-cafe-label></label>
                <span class="cafe-setting-value">
                    <input id="cafe-container-weight" type="text" inputmode="numeric" autocomplete="off" maxlength="5" disabled>
                    <span aria-hidden="true">g</span>
                </span>
            </div>
            <p class="cafe-setting-help" data-cafe-help></p>
        </div>
    </div>`;

/** Mount the category into Streamline's settings content area. Answers its cleanup. */
export async function mountSettingsCategory({ container }) {
    container.innerHTML = MARKUP; // fixed markup, no text from Decaid
    const field = container.querySelector('#cafe-container-weight');
    setText(container.querySelector('[data-cafe-page]'), WEIGHT_PHRASES.page, { translate: true });
    setText(container.querySelector('[data-cafe-heading]'), WEIGHT_PHRASES.settingHeading, { translate: true });
    setText(container.querySelector('[data-cafe-label]'), WEIGHT_PHRASES.setting, { translate: true });
    setText(container.querySelector('[data-cafe-help]'), WEIGHT_PHRASES.settingHelp, { translate: true });

    const numpad = shouldUseNumpad();
    let alive = true;
    let kept = 0;
    let writing = Promise.resolve();

    const keep = value => {
        const grams = containerWeight(String(value).replace(/[^\d.]/g, ''));
        field.value = String(grams);
        if (grams === kept) return;
        const before = kept;
        kept = grams;
        writing = writing.then(() => writeCafe(CONTAINER_KEY, grams)).catch(error => {
            logger.warn('Cafe: could not keep the batch container\'s weight', error);
            showToast(cafeText('Could not save the container\'s weight'), 4000, 'error');
            if (kept !== grams) return;
            kept = before;
            if (alive) field.value = String(before);
        });
    };

    field.addEventListener('change', () => keep(field.value));
    field.addEventListener('click', event => {
        if (!numpad || field.disabled) return;
        event.preventDefault();
        const shown = field.value;
        const stand = { value: shown, getAttribute: () => shown, dispatchEvent: () => {} };
        openNumpad(stand, {
            fieldType: NUMPAD_FIELD,
            config: { title: cafeText('Batch container weight'), unit: 'g', min: 0, max: MAX_CONTAINER, defaultValue: '0' },
            onConfirm: value => { if (alive) keep(value); },
        });
    });

    try {
        const read = containerWeight(await readCafe(CONTAINER_KEY));
        kept = read;
        field.value = String(read);
        field.disabled = false;
        if (numpad) {
            initializeNumpadModal();
            field.readOnly = true;
        }
    } catch (error) {
        logger.warn('Cafe: could not read the batch container\'s weight', error);
        showToast(cafeText('Could not read the container\'s weight'), 4000, 'error');
    }

    return () => { alive = false; };
}
