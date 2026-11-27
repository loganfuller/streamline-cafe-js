// The tablet's camera for the scan of a batch's QR code, and the reading of
// its picture (docs/cafe/DESIGN.md, "Scanning a batch's QR code"). Video only,
// through the browser's media API, which Decaid allows a Skin once "Live
// camera access" is on for it. The picture is read by one vendored decoder,
// jsQR, on every platform, loaded when the scan first opens; the browser's
// own detector is not used. What a reading means is scan-model.js's.
import { loadQrDecoder } from '../modules/vendor-loader.js';
import { SAMPLE_MS, sampleSize, cameraCount } from './scan-model.js';

const media = () => (typeof navigator !== 'undefined' && navigator.mediaDevices) || null;

/**
 * Opens the camera on the side `facing` names (`user` or `environment`), or
 * on whichever the tablet has where it has none on that side. Resolves the
 * stream, not yet shown. Rejects with the media API's own error, or one named
 * `NotFoundError` where the browser has no media API.
 */
export async function openCamera(facing) {
    const devices = media();
    if (!devices || typeof devices.getUserMedia !== 'function') {
        throw Object.assign(new Error('This browser has no camera API'), { name: 'NotFoundError' });
    }
    return devices.getUserMedia({ audio: false, video: { facingMode: facing } });
}

/** Shows `stream`'s picture in `video`. */
export function showCamera(video, stream) {
    video.srcObject = stream;
    video.play().catch(() => {});
}

/** Stops every track of `stream` and takes its picture off `video`. */
export function stopCamera(video, stream) {
    for (const track of stream ? stream.getTracks() : []) track.stop();
    if (video.srcObject === stream) video.srcObject = null;
}

/** The side the open camera says it is on (`user`, `environment`), or undefined where it says none. */
export function reportedFacing(stream) {
    const track = stream?.getVideoTracks()[0];
    return track && typeof track.getSettings === 'function' ? track.getSettings().facingMode : undefined;
}

/** How many cameras the tablet has. One the browser can't list counts as none more. */
export async function countCameras() {
    const devices = media();
    if (!devices || typeof devices.enumerateDevices !== 'function') return 0;
    try {
        return cameraCount(await devices.enumerateDevices());
    } catch (error) {
        return 0;
    }
}

/**
 * Reads `video`'s picture for a QR code every `SAMPLE_MS`, at a reduced size,
 * and tells `onText` the text of each code read. Answers the function that
 * stops it. A frame is read only once the decoder has loaded and the picture
 * has a size; `onError` hears a decoder that could not be loaded.
 */
export function readCodes(video, onText, onError) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    let decode = null;
    let stopped = false;
    loadQrDecoder().then(loaded => { decode = loaded; }).catch(error => { if (!stopped) onError(error); });
    const timer = setInterval(() => {
        if (!decode || !context || video.readyState < 2) return;
        const size = sampleSize(video.videoWidth, video.videoHeight);
        if (!size) return;
        canvas.width = size.width;
        canvas.height = size.height;
        context.drawImage(video, 0, 0, size.width, size.height);
        const code = decode(context.getImageData(0, 0, size.width, size.height).data, size.width, size.height, { inversionAttempts: 'dontInvert' });
        if (code && typeof code.data === 'string') onText(code.data);
    }, SAMPLE_MS);
    return () => {
        stopped = true;
        clearInterval(timer);
    };
}
