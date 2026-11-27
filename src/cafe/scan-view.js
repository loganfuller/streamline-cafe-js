// The scan of a batch's QR code, in the bean and batch dialog's own box: the
// camera's picture in the lists' place, the plugin asked about the first code
// read, and what it answered (docs/cafe/DESIGN.md, "Scanning a batch's QR
// code"). One match goes back to the lists with that batch highlighted;
// several are listed to tap one; none is said over the picture, which goes on
// reading; and a camera that did not open, or a plugin that did not answer,
// has a message of its own in the picture's place. The markup is in
// index.html, inside the pick dialog. What an answer means and what each
// message says are scan-model.js's, the camera is scan-camera.js's, and asking
// the plugin and reading the lists again are handed in by bean-dialog.js.
//
// The camera is stopped when a code is matched, when a message takes the
// picture's place, when the scan is cancelled, and when the dialog closes or
// the page is hidden: `leave`, which the dialog calls however the scan ends.
import { logger } from '../modules/logger.js';
import { SCAN_PHRASES, holdsText, askable, askedJustNow, shownText, scanAnswer, scanRefusal, cameraFailure, scanMessage, matchesLine, matchRows, facingOf, otherFacing, facingLabel, mirrored } from './scan-model.js';
import { openCamera, stopCamera, reportedFacing, countCameras, readCodes } from './scan-camera.js';
import { readCafe, writeCafe, CAMERA_KEY } from './cafe-store.js';
import { cafeText, formatRoastDay, setText } from './text.js';

const el = id => document.getElementById(id);

function scanParts() {
    const parts = {
        camera: el('cafe-scan-camera'),
        video: el('cafe-scan-video'),
        facing: el('cafe-scan-facing'),
        switcher: el('cafe-scan-switch'),
        message: el('cafe-scan-message'),
        messageTitle: el('cafe-scan-message-title'),
        messageBody: el('cafe-scan-message-body'),
        panel: el('cafe-scan-panel'),
        panelTitle: el('cafe-scan-panel-title'),
        panelBody: el('cafe-scan-panel-body'),
        matches: el('cafe-scan-matches'),
        read: el('cafe-scan-read'),
        list: el('cafe-scan-match-list'),
        note: el('cafe-scan-note'),
        again: el('cafe-scan-again'),
        cancel: el('cafe-scan-cancel'),
    };
    return Object.values(parts).every(Boolean) ? parts : null;
}

function matchButton(row, onPick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cafe-pick-row';
    button.dataset.id = row.id;
    const words = document.createElement('span');
    words.className = 'cafe-pick-row-text';
    const name = document.createElement('span');
    name.className = 'cafe-pick-row-name';
    name.textContent = row.name;
    const detail = document.createElement('span');
    detail.className = 'cafe-pick-row-detail';
    row.details.forEach((part, index) => {
        const bit = document.createElement('bdi');
        bit.textContent = part;
        detail.append(...(index ? [' · ', bit] : [bit]));
    });
    words.append(name, detail);
    button.append(words);
    if (row.inUse) {
        const mark = document.createElement('span');
        mark.className = 'cafe-pick-in-use';
        mark.textContent = cafeText('In use');
        button.append(mark);
    }
    button.addEventListener('click', () => onPick(row));
    return button;
}

/**
 * Start a scan in the dialog's scan part, which the dialog has just shown.
 *
 * - `stage`: the dialog's, `{ title(key), under(line), back(next) }`: its
 *   title and the line under it while the scan shows, and the way back to the
 *   lists, filled again from `next` where one is given (pick-dialog.js).
 * - `ask(asking)`: asks the plugin, with `{ text }` or `{ match }`. Resolves
 *   its answer, and rejects where none came.
 * - `reread(match)`: reads the lists again from Decaid and answers the `next`
 *   to go back with, `match`'s batch highlighted where one is given, or null
 *   where they could not be read or do not hold it.
 * - `inUseCode()`: the Batch Code of the batch in use, or ''.
 *
 * Answers `leave`, which stops the camera and puts the part back as it was.
 */
export function startScan(stage, { ask, reread, inUseCode }) {
    const parts = scanParts();
    if (!parts) {
        stage.back();
        return () => {};
    }
    let alive = true;
    let stream = null;
    let stopReading = null;
    let opening = 0;
    let busy = false;
    let last = null;
    let facing = null;
    let asked = false;

    const closeCamera = () => {
        opening += 1;
        if (stopReading) stopReading();
        stopReading = null;
        if (stream) stopCamera(parts.video, stream);
        stream = null;
    };

    const say = message => {
        parts.message.hidden = !message;
        if (!message) return;
        setText(parts.messageTitle, message.title, { translate: true });
        setText(parts.messageBody, message.body.key, { translate: true, vars: message.body.vars });
    };

    const show = view => {
        parts.camera.hidden = view !== 'camera';
        parts.panel.hidden = view !== 'panel';
        parts.matches.hidden = view !== 'matches';
        parts.note.hidden = view !== 'camera';
        parts.again.hidden = view === 'camera';
        setText(parts.cancel, view === 'panel' ? SCAN_PHRASES.back : SCAN_PHRASES.cancel, { translate: true });
        if (view !== 'matches') {
            stage.title(SCAN_PHRASES.title);
            stage.under({ key: SCAN_PHRASES.hint });
            parts.list.replaceChildren();
        }
    };

    const panel = kind => {
        closeCamera();
        busy = false;
        const message = scanMessage(kind);
        setText(parts.panelTitle, message.title, { translate: true });
        setText(parts.panelBody, message.body.key, { translate: true, vars: message.body.vars });
        show('panel');
    };

    const label = cameras => {
        const key = facingLabel(facing, reportedFacing(stream), cameras);
        parts.facing.hidden = !key;
        if (key) setText(parts.facing, key, { translate: true });
        parts.switcher.hidden = cameras < 2;
        parts.video.classList.toggle('cafe-scan-mirrored', mirrored(facing, reportedFacing(stream)));
    };

    async function begin(message = null) {
        closeCamera();
        const mine = opening;
        busy = false;
        show('camera');
        say(message);
        parts.facing.hidden = true;
        parts.switcher.hidden = true;
        try {
            if (facing === null) facing = facingOf(await readCafe(CAMERA_KEY).catch(() => null));
            if (!alive || mine !== opening) return;
            const opened = await openCamera(parts.video, facing);
            if (!alive || mine !== opening) {
                stopCamera(parts.video, opened);
                return;
            }
            stream = opened;
        } catch (error) {
            if (!alive || mine !== opening) return;
            logger.warn('Cafe: the camera did not open', error);
            panel(cameraFailure(error?.name));
            return;
        }
        stopReading = readCodes(parts.video, onText, error => {
            logger.warn('Cafe: the QR decoder did not load', error);
            panel('cameraFailed');
        });
        const cameras = await countCameras();
        if (alive && mine === opening) label(cameras);
    }

    async function found(match) {
        closeCamera();
        const next = await reread(match);
        if (!alive) return;
        if (next) stage.back(next);
        else panel('unread');
    }

    function several(result, scanned) {
        closeCamera();
        busy = false;
        const rows = matchRows(result.matches, inUseCode(), formatRoastDay, cafeText);
        stage.title(SCAN_PHRASES.matchesTitle);
        stage.under(matchesLine(rows.length, result.more));
        setText(parts.read, shownText(scanned));
        parts.list.replaceChildren(...rows.map(row => matchButton(row, chosen => send({ match: chosen.id }, scanned))));
        show('matches');
    }

    async function send(asking, scanned) {
        if (busy) return;
        busy = true;
        if (asking.match === undefined) say(scanMessage('asking', scanned));
        else for (const button of parts.list.children) button.disabled = true;
        let result;
        try {
            result = scanAnswer(await ask(asking));
        } catch (error) {
            const kind = scanRefusal(error);
            result = { kind };
            if (kind !== 'noMatch') asked = true;
        }
        if (!alive) return;
        if (result.kind === 'match') return found(result);
        if (result.kind === 'several') return several(result, scanned);
        if (result.kind !== 'noMatch') return panel(result.kind);
        last = { text: scanned, at: Date.now() };
        if (stream) {
            busy = false;
            say(scanMessage('noMatch', scanned));
            return;
        }
        return begin(scanMessage('noMatch', scanned));
    }

    function onText(scanned) {
        if (busy || !holdsText(scanned) || askedJustNow(last, scanned, Date.now())) return;
        if (!askable(scanned)) {
            last = { text: scanned, at: Date.now() };
            say(scanMessage('noMatch', scanned));
            return;
        }
        send({ text: scanned }, scanned);
    }

    async function cancel() {
        closeCamera();
        parts.cancel.disabled = true;
        const next = asked ? await reread(null) : null;
        if (alive) stage.back(next || undefined);
    }

    const hidden = () => { if (document.visibilityState === 'hidden') stage.back(); };

    parts.cancel.onclick = cancel;
    parts.again.onclick = () => begin();
    parts.switcher.onclick = () => {
        facing = otherFacing(facing || 'user');
        writeCafe(CAMERA_KEY, facing).catch(error => logger.warn('Cafe: could not keep the choice of camera', error));
        begin();
    };
    parts.video.setAttribute('aria-label', cafeText('The camera\'s picture'));
    setText(parts.note, SCAN_PHRASES.note, { translate: true });
    setText(parts.again, SCAN_PHRASES.again, { translate: true });
    document.addEventListener('visibilitychange', hidden);
    begin();

    return () => {
        alive = false;
        closeCamera();
        document.removeEventListener('visibilitychange', hidden);
        parts.cancel.onclick = null;
        parts.cancel.disabled = false;
        parts.again.onclick = null;
        parts.switcher.onclick = null;
        parts.list.replaceChildren();
        say(null);
    };
}
