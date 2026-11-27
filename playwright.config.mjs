// The page tests: the real page in Chromium against the fake Decaid in
// fake-decaid/, through Playwright's routes. How they work is in
// docs/cafe/TESTING.md.
//
//   npx playwright test                         every page test
//   npx playwright test test/page/grinder-dialog.spec.mjs
//   npx playwright test --grep @grinder
//   CAFE_TZ=Asia/Tokyo npx playwright test   in another zone than UTC

import { join } from 'node:path';
import { defineConfig } from 'playwright/test';

// What the page's camera shows: a batch's label, one frame for ever
// (test/page/camera/make-label.mjs).
const LABEL = join(import.meta.dirname, 'test', 'page', 'camera', 'batch-label.y4m');
const LOCAL_NETWORK = '--disable-features=LocalNetworkAccessChecks';
const CAMERA_SPEC = 'scan.spec.mjs';

export default defineConfig({
    testDir: 'test/page',
    testMatch: '*.spec.mjs',
    outputDir: 'test/page/out/results',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: 0,
    timeout: 30_000,
    expect: { timeout: 5_000 },
    reporter: process.env.CI ? [['list'], ['html', { outputFolder: 'test/page/out/report', open: 'never' }]] : 'list',
    use: {
        browserName: 'chromium',
        viewport: { width: 1920, height: 1200 },
        // The tablet's zone, which Decaid's is too. CAFE_TZ runs the tests in
        // another: CAFE_TZ=Pacific/Auckland npx playwright test
        timezoneId: process.env.CAFE_TZ || 'UTC',
        locale: 'en-US',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        launchOptions: {
            // The page's files are answered by a route, so Chromium knows no
            // address for them and would treat the page as public, refusing
            // its requests to Decaid on the loopback address.
            args: [LOCAL_NETWORK],
        },
    },
    // The scan of a batch's QR code needs a camera, which Chromium's headless
    // shell does not have: its tests run in full Chromium's own headless mode,
    // with Chromium's fake camera playing the label's picture to a page
    // allowed the camera. A test allows it for its own context.
    projects: [
        { name: 'page', testIgnore: CAMERA_SPEC },
        {
            name: 'camera',
            testMatch: CAMERA_SPEC,
            use: {
                channel: 'chromium',
                launchOptions: { args: [LOCAL_NETWORK, '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${LABEL}`] },
            },
        },
    ],
});
