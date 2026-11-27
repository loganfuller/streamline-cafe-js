// The scan of a batch's QR code in the bean and batch dialog: what the plugin's
// answer means, which text is asked about, what each message says, the rows of
// several matches, and which camera opens (docs/cafe/DESIGN.md, "Scanning a
// batch's QR code"). No browser global is touched: the phrases go through `t`,
// a roast day through `formatDay`, and the time is handed in.
//
// The page reads the code and sends its text to Decent Sync's plugin, which
// answers with the batch and has brought it to the Machine's Location where it
// was not there. The three answers of one batch (`moved`, `added` and
// `alreadyThere`) are read alike. The contract is "Scanning a Bean Batch's QR
// code" in Decent Sync's page for a Skin's author.
import { BEAN_PHRASES, batchCode } from './bean-model.js';

/** The phrases the scan may say, for the translations test. */
export const SCAN_PHRASES = {
    open: 'Scan a batch\'s QR code',
    title: 'Scan a batch',
    hint: 'Hold the label\'s QR code up to the camera. It is read as soon as it is in view.',
    note: 'A batch that is somewhere else is brought here when it is read.',
    cancel: 'Cancel scan',
    again: 'Scan again',
    back: 'Back to the list',
    switchCamera: 'Switch camera',
    front: 'Front camera',
    rear: 'Rear camera',
    picture: 'The camera\'s picture',
    askingTitle: 'Looking up the batch',
    read: 'Read from the label: {text}',
    noMatchTitle: 'No batch in the Library matches',
    noMatchBody: 'Read from the label: {text}. The camera is still scanning.',
    unreachableTitle: 'Decent Sync can\'t be reached',
    unreachableBody: 'The label was read, but the batch can\'t be looked up right now. Pick the batch from the list.',
    noAnswerTitle: 'No answer in time',
    noAnswerBody: 'The batch may have been brought here all the same. Check the list, or scan again.',
    refusedTitle: 'Camera access is off',
    refusedBody: 'Allow it for this skin in Decaid, under Live camera access, then scan again.',
    noCameraTitle: 'This tablet has no camera',
    noCameraBody: 'Pick the batch from the list.',
    cameraFailedTitle: 'The camera can\'t be used right now',
    cameraFailedBody: 'Pick the batch from the list, or scan again.',
    unreadTitle: 'Could not read the beans',
    matchesTitle: 'Which batch is it?',
    matches: 'The label matches {count} batches. Nothing is brought here until you choose one.',
    matchesMore: 'The label matches more than {count} batches, and these are the newest. Nothing is brought here until you choose one.',
    readFrom: 'Read from the label',
};

/** How often a frame of the camera's picture is read for a code. */
export const SAMPLE_MS = 250;
/** The longer side of the picture a frame is read at, in pixels. */
export const SAMPLE_SIDE = 480;
/** How long the same text is not asked about again, from its answer. */
export const SAME_TEXT_MS = 5000;
/** The longest text the plugin takes (`MAX_SCANNED_TEXT_LENGTH` in Decent Sync's protocol). */
export const MAX_SCANNED_TEXT = 2048;
const SHOWN_TEXT = 120;

const text = value => (typeof value === 'string' ? value.trim() : '');
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const id = value => (value == null || value === '' ? null : String(value));

/** Did a code hold anything to ask about? One that held nothing, or only spaces, is no reading. */
export function holdsText(scanned) {
    return text(scanned) !== '';
}

/**
 * May the plugin be asked about this text? Not text longer than it takes, or
 * with a NUL or an unpaired surrogate: the plugin refuses those as a bad
 * request, so they are no label of a batch, and nothing is asked.
 */
export function askable(scanned) {
    return typeof scanned === 'string' && scanned.length <= MAX_SCANNED_TEXT && !scanned.includes('\u0000') && !LONE_SURROGATE.test(scanned);
}

/**
 * Was this text answered too recently to ask about again? `last` is
 * `{ text, at }`, the text last answered and when, or null. A label held in
 * view is read several times a second, and each answer for it would be the same.
 */
export function askedJustNow(last, scanned, now) {
    return !!last && last.text === scanned && now - last.at < SAME_TEXT_MS;
}

/** The text read, as a message shows it: on one line, and cut where it is long. */
export function shownText(scanned) {
    const line = text(scanned).replace(/\s+/g, ' ');
    return line.length > SHOWN_TEXT ? `${line.slice(0, SHOWN_TEXT)}…` : line;
}

/**
 * What the plugin's answer to a scan says:
 *
 * - `{ kind: 'match', batchId, beanId }`: one batch, which is at the Machine's
 *   Location now, by the tablet's own ids. Whether it was moved there, added
 *   there or there already makes no difference to the page.
 * - `{ kind: 'several', matches, more }`: the batches the text matched, each
 *   `{ id, roaster, name, roastDate, batchCode }`, and whether more matched.
 * - `{ kind: 'noMatch' }`.
 * - `{ kind: 'unreachable' }`: an answer in no shape the page knows.
 */
export function scanAnswer(answer) {
    const outcome = answer && typeof answer === 'object' ? answer.outcome : undefined;
    if (outcome === 'moved' || outcome === 'added' || outcome === 'alreadyThere') {
        const batchId = id(answer.batchId);
        const beanId = id(answer.beanId);
        return batchId && beanId ? { kind: 'match', batchId, beanId } : { kind: 'unreachable' };
    }
    if (outcome === 'several') {
        const matches = (Array.isArray(answer.matches) ? answer.matches : []).filter(match => match && id(match.id));
        return matches.length ? { kind: 'several', matches, more: answer.more === true } : { kind: 'noMatch' };
    }
    return outcome === 'noMatch' ? { kind: 'noMatch' } : { kind: 'unreachable' };
}

/**
 * What a scan that was not answered says, from the error the page's ask of
 * the plugin rejects with (decent-sync.js):
 *
 * - `noAnswer`: no answer came in the page's own time, or the request reached
 *   nothing. The batch may have been brought all the same.
 * - `noMatch`: the plugin refused the text as one it can't read.
 * - `unreachable`: any other refusal, `unreachable` and `serverTooOld` among
 *   them, and an answer of Decaid's own in the plugin's place.
 */
export function scanRefusal(error) {
    if (!error || error.timedOut === true || error.status === undefined) return 'noAnswer';
    if (error.code === 'invalidRequest') return 'noMatch';
    return 'unreachable';
}

/**
 * Why the camera did not open, from the name of the error the browser's media
 * API rejected with: `refused` where access was not allowed, `noCamera` where
 * the tablet has none, or has no media API, and `cameraFailed` for anything
 * else, as a camera another app holds.
 */
export function cameraFailure(name) {
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'refused';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'noCamera';
    return 'cameraFailed';
}

const MESSAGES = {
    asking: { title: SCAN_PHRASES.askingTitle, body: SCAN_PHRASES.read, scanning: true },
    noMatch: { title: SCAN_PHRASES.noMatchTitle, body: SCAN_PHRASES.noMatchBody, scanning: true },
    unreachable: { title: SCAN_PHRASES.unreachableTitle, body: SCAN_PHRASES.unreachableBody },
    noAnswer: { title: SCAN_PHRASES.noAnswerTitle, body: SCAN_PHRASES.noAnswerBody },
    refused: { title: SCAN_PHRASES.refusedTitle, body: SCAN_PHRASES.refusedBody },
    noCamera: { title: SCAN_PHRASES.noCameraTitle, body: SCAN_PHRASES.noCameraBody },
    cameraFailed: { title: SCAN_PHRASES.cameraFailedTitle, body: SCAN_PHRASES.cameraFailedBody },
    unread: { title: SCAN_PHRASES.unreadTitle, body: SCAN_PHRASES.noCameraBody },
};

/**
 * What the scan says for `kind`: `{ title, body, scanning }`, where `title` is
 * a key, `body` is `{ key, vars }` and `scanning` says the message is shown
 * over the camera's picture, which goes on reading. Any other message stands
 * in the picture's place, the camera stopped. `scanned` is the text read, for
 * the two that show it.
 */
export function scanMessage(kind, scanned = '') {
    const message = MESSAGES[kind] || MESSAGES.cameraFailed;
    const vars = message.body.includes('{text}') ? { text: shownText(scanned) } : undefined;
    return { title: message.title, body: { key: message.body, vars }, scanning: message.scanning === true };
}

/** The line under the title over several matches: how many, and that more matched where they did. */
export function matchesLine(count, more) {
    return { key: more ? SCAN_PHRASES.matchesMore : SCAN_PHRASES.matches, vars: { count } };
}

/**
 * The rows of several matches, in the plugin's order, newest roast first: the
 * Bean's name and the batch's roast date over the roaster and the Batch Code,
 * each left out where the match has none. `inUse` is Decaid's record of the
 * batch the Workflow names: the match it is is marked `inUse`, by the Decent
 * Sync id the plugin keeps on the record, or by its Batch Code where the
 * record has no id yet. `formatDay` writes a YYYY-MM-DD day in the page's
 * language.
 */
export function matchRows(matches, inUse, formatDay, t) {
    const usedId = text(inUse?.extras?.decentSyncId).toLowerCase();
    const usedCode = batchCode(inUse).toLowerCase();
    const isInUse = (match, code) => (usedId ? text(match.id).toLowerCase() === usedId : usedCode !== '' && code.toLowerCase() === usedCode);
    return (matches || []).map(match => {
        const day = /^\d{4}-\d{2}-\d{2}$/.test(match.roastDate || '') ? match.roastDate : null;
        const roasted = day ? t(BEAN_PHRASES.roasted, { date: formatDay(day) }) : t(BEAN_PHRASES.noRoastDate);
        const code = text(match.batchCode);
        const details = [text(match.roaster), code].filter(Boolean);
        return {
            id: String(match.id),
            name: `${text(match.name) || t(BEAN_PHRASES.unnamed)} · ${roasted}`,
            details,
            detail: details.join(' · '),
            inUse: isInUse(match, code),
        };
    });
}

/** The camera the scan opens on, from the choice kept: the one facing the barista unless the other was chosen. */
export function facingOf(kept) {
    return kept === 'environment' ? 'environment' : 'user';
}

/** The other camera than `facing`. */
export function otherFacing(facing) {
    return facing === 'user' ? 'environment' : 'user';
}

/** How many cameras the browser's list of devices holds. */
export function cameraCount(devices) {
    return (Array.isArray(devices) ? devices : []).filter(device => device && device.kind === 'videoinput').length;
}

/**
 * What the camera's picture is labelled, as a key, or null for no label:
 * the side the camera itself reports, or, where it reports none, the side
 * asked for on a tablet with more than one camera. One camera of no side
 * known is not called either.
 */
export function facingLabel(facing, reported, cameras) {
    const side = reported === 'user' || reported === 'environment' ? reported : cameras > 1 ? facing : null;
    if (!side) return null;
    return side === 'user' ? SCAN_PHRASES.front : SCAN_PHRASES.rear;
}

/**
 * Is the picture shown mirrored? The camera facing the barista is, as a
 * mirror, so a label moved to the left moves left in the picture. The frame
 * read for a code is never mirrored.
 */
export function mirrored(facing, reported) {
    return (reported === 'user' || reported === 'environment' ? reported : facing) === 'user';
}

/**
 * The size a frame is read at: the picture's own, made smaller until its
 * longer side is `SAMPLE_SIDE`. Null for a picture with no size yet.
 */
export function sampleSize(width, height) {
    if (!(width > 0) || !(height > 0)) return null;
    const scale = Math.min(1, SAMPLE_SIDE / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
