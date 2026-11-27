// Makes the pictures the page tests' camera shows: a batch's label, a QR code
// holding a made-up Batch Code, as one frame of video Chromium's fake camera
// plays for ever (playwright.config.mjs, docs/cafe/TESTING.md, "The camera").
//
//   node test/page/camera/make-label.mjs
//
// It writes batch-label.y4m beside itself, the code dark on light, and
// batch-label-light-on-dark.y4m, the same code light on dark as a sticker or
// a phone may show it, the same bytes on every run. The code is drawn by
// Streamline's own vendored encoder, so nothing is installed.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

/** The text the label's code holds: what the page reads, and asks Decent Sync's plugin about. */
export const LABEL_TEXT = 'SR-0412';

const WIDTH = 640;
const HEIGHT = 480;
const MODULE = 12;
const WHITE = 235;
const BLACK = 16;
const GREY = 128;

function label({ dark, light }) {
    const source = readFileSync(join(import.meta.dirname, '..', '..', '..', 'src', 'vendor', 'qrcodegen.js'), 'utf8');
    const { qrcodegen } = vm.runInNewContext(`${source}; ({ qrcodegen })`);
    const code = qrcodegen.QrCode.encodeText(LABEL_TEXT, qrcodegen.QrCode.Ecc.MEDIUM);
    const left = Math.floor((WIDTH - code.size * MODULE) / 2);
    const top = Math.floor((HEIGHT - code.size * MODULE) / 2);
    const luma = Buffer.alloc(WIDTH * HEIGHT, light);
    for (let y = 0; y < code.size * MODULE; y++) {
        for (let x = 0; x < code.size * MODULE; x++) {
            if (code.getModule(Math.floor(x / MODULE), Math.floor(y / MODULE))) luma[(top + y) * WIDTH + left + x] = dark;
        }
    }
    const chroma = Buffer.alloc((WIDTH / 2) * (HEIGHT / 2) * 2, GREY);
    return Buffer.concat([Buffer.from(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F30:1 Ip A1:1 C420jpeg\n`), Buffer.from('FRAME\n'), luma, chroma]);
}

if (process.argv[1] === import.meta.filename) {
    writeFileSync(join(import.meta.dirname, 'batch-label.y4m'), label({ dark: BLACK, light: WHITE }));
    writeFileSync(join(import.meta.dirname, 'batch-label-light-on-dark.y4m'), label({ dark: WHITE, light: BLACK }));
}
