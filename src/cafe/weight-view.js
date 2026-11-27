// A batch's weight entered, in the bean and batch dialog's own box: the batch
// and what its record says on the left, and on the right one field for what
// the scale reads, the working, a message, Back and Save (docs/cafe/DESIGN.md,
// "Entering a batch's weight"). The markup is in index.html, inside the pick
// dialog. What is left, which state the view is in and what it says are
// weight-model.js's; the container's weight, the writes and reading the lists
// again are handed in by bean-dialog.js. This module writes nothing itself.
//
// On a tablet a tap on the field opens Streamline's numpad; where the numpad
// is not used the field is typed into.
import { logger } from '../modules/logger.js';
import { showToast } from '../modules/ui.js';
import { shouldUseNumpad } from '../modules/numpad-policy.js';
import { openModal as openNumpad } from '../modules/numpad-modal.js';
import { WEIGHT_PHRASES, MAX_TYPED, typedGrams, weighing, weightFacts, weightCode, fieldLabel, workingLine, weightMessage, saveLabel } from './weight-model.js';
import { cafeText, setText } from './text.js';

const NUMPAD_FIELD = 'cafe-batch-weight';

const el = id => document.getElementById(id);

function weightParts() {
    const parts = {
        name: el('cafe-weight-name'),
        code: el('cafe-weight-code'),
        facts: el('cafe-weight-facts'),
        form: el('cafe-weight-form'),
        label: el('cafe-weight-label'),
        field: el('cafe-weight-field'),
        working: el('cafe-weight-working'),
        sum: el('cafe-weight-working-sum'),
        equals: el('cafe-weight-working-equals'),
        left: el('cafe-weight-working-left'),
        message: el('cafe-weight-message'),
        messageTitle: el('cafe-weight-message-title'),
        messageBody: el('cafe-weight-message-body'),
        back: el('cafe-weight-back'),
        save: el('cafe-weight-save'),
    };
    return Object.values(parts).every(Boolean) ? parts : null;
}

function factRow(fact) {
    const row = document.createElement('div');
    row.className = 'cafe-weight-fact';
    const label = document.createElement('dt');
    label.textContent = fact.label;
    const value = document.createElement('dd');
    value.textContent = fact.value;
    row.append(label, value);
    return row;
}

function closeNumpad() {
    if (el('numpad-modal-overlay')?.open) el('numpad-cancel')?.click();
}

/**
 * Start the weight view in the dialog's weight part, which the dialog has just
 * shown.
 *
 * - `stage`: the dialog's, `{ title(key), under(line), back(next), close() }`
 *   (pick-dialog.js).
 * - `row`: the batch row highlighted, `{ bean, batch, name }` (`batchRows`).
 * - `note`: the batch's bean and roast date, as beside "Use this batch".
 * - `container()`: resolves the container's weight in whole grams, and rejects
 *   where it can't be read.
 * - `save(left)`, `finish()`: write what is left, or finish the batch. Each
 *   resolves once Decaid has stored it and rejects where it has not.
 * - `relist(held)`: reads the lists again from Decaid and answers the `next`
 *   to go back with, the batch highlighted where `held` is true and it is
 *   still listed, or null where they could not be read.
 *
 * Answers `leave`, which puts the part back as it was.
 */
export function startWeigh(stage, { row, note, container, save, finish, relist }) {
    const parts = weightParts();
    if (!parts) {
        stage.back();
        return () => {};
    }
    const numpad = shouldUseNumpad();
    let alive = true;
    let busy = false;
    let kept = null;
    let failed = null;

    const typed = () => typedGrams(parts.field.value);

    const draw = () => {
        const ready = kept != null;
        const now = ready ? weighing(typed(), kept, row.batch) : { state: 'empty', saves: false, finishes: false };
        const working = ready ? workingLine(typed(), kept, cafeText) : null;
        parts.working.hidden = !working;
        if (working) {
            setText(parts.sum, working.sum);
            setText(parts.left, working.left);
            parts.equals.hidden = !working.left;
            parts.left.hidden = !working.left;
        }
        const message = ready ? weightMessage(now.state, { container: kept, batch: row.batch, failed }) : null;
        parts.message.hidden = !message;
        if (message) {
            parts.message.dataset.tone = message.tone;
            setText(parts.messageTitle, message.title, { translate: true });
            setText(parts.messageBody, message.body.key, { translate: true, vars: message.body.vars });
        }
        setText(parts.save, saveLabel(now.state), { translate: true });
        parts.save.classList.toggle('cafe-weight-finish', now.finishes);
        parts.save.disabled = busy || !(now.saves || now.finishes);
        parts.field.disabled = busy || !ready;
        parts.back.disabled = busy;
        const digits = parts.field.value.length;
        parts.field.style.width = digits ? `${digits + 0.4}ch` : '';
        parts.field.parentElement.classList.toggle('cafe-weight-typed', digits > 0);
        return now;
    };

    const changed = () => {
        failed = null;
        draw();
    };

    const onInput = () => {
        const digits = parts.field.value.replace(/\D/g, '');
        const grams = typedGrams(digits);
        parts.field.value = grams == null ? '' : String(grams);
        changed();
    };

    const onTap = event => {
        if (!numpad || busy || kept == null) return;
        event.preventDefault();
        const shown = parts.field.value;
        const stand = { value: shown, getAttribute: () => shown, dispatchEvent: () => {} };
        openNumpad(stand, {
            fieldType: NUMPAD_FIELD,
            config: { title: parts.label.textContent, unit: 'g', min: 0, max: MAX_TYPED, defaultValue: '0' },
            onConfirm: value => {
                if (!alive || busy) return;
                const grams = typedGrams(value);
                parts.field.value = grams == null ? '' : String(grams);
                changed();
            },
        });
    };

    const onSubmit = async event => {
        event.preventDefault();
        if (busy || kept == null) return;
        const now = weighing(typed(), kept, row.batch);
        if (!now.saves && !now.finishes) return;
        busy = true;
        failed = null;
        draw();
        try {
            if (now.finishes) await finish();
            else await save(now.left);
        } catch (error) {
            logger.warn(`Cafe: could not ${now.finishes ? 'finish the batch' : 'save the batch\'s weight'}`, error);
            busy = false;
            failed = now.finishes ? 'finish' : 'save';
            if (alive) draw();
            return;
        }
        if (!alive) return;
        const next = await relist(!now.finishes);
        if (!alive) return;
        if (next) {
            stage.back(next);
            return;
        }
        showToast(cafeText('Could not read the beans'), 4000, 'error');
        stage.close();
    };

    stage.title(WEIGHT_PHRASES.open);
    stage.under({ text: note });
    setText(parts.name, row.name);
    const code = weightCode(row.batch);
    setText(parts.code, code);
    parts.code.hidden = !code;
    parts.facts.replaceChildren();
    parts.field.value = '';
    parts.field.readOnly = numpad;
    parts.field.placeholder = numpad ? cafeText('Tap to enter') : '0';
    setText(parts.label, WEIGHT_PHRASES.field, { translate: true });
    parts.field.oninput = onInput;
    parts.field.onclick = onTap;
    parts.form.onsubmit = onSubmit;
    parts.back.onclick = () => { if (!busy) stage.back(); };
    draw();

    container().then(grams => {
        if (!alive) return;
        kept = grams;
        setText(parts.label, fieldLabel(kept), { translate: true });
        parts.facts.replaceChildren(...weightFacts(row.batch, kept, cafeText).map(factRow));
        draw();
        if (!numpad) parts.field.focus();
    }).catch(error => {
        logger.warn('Cafe: could not read the batch container\'s weight', error);
        if (!alive) return;
        showToast(cafeText('Could not read the container\'s weight'), 4000, 'error');
        stage.back();
    });

    return () => {
        alive = false;
        closeNumpad();
        parts.field.oninput = null;
        parts.field.onclick = null;
        parts.form.onsubmit = null;
        parts.back.onclick = null;
        parts.field.value = '';
        parts.field.style.width = '';
        parts.field.parentElement.classList.remove('cafe-weight-typed');
        parts.field.disabled = false;
        parts.back.disabled = false;
        parts.save.disabled = true;
        parts.save.classList.remove('cafe-weight-finish');
        parts.facts.replaceChildren();
        parts.working.hidden = true;
        parts.message.hidden = true;
    };
}
