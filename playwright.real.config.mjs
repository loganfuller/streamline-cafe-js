// The real journeys: the page against the real stack stood up from the pins
// (fake-decaid/pins.json), one at a time, since Decaid admits about 15 sockets
// per client address. How and when they run is in docs/cafe/TESTING.md.
//
//   npm run test:real                                      stand up, run, remove
//   REAL_STACK_KEEP=1 npm run test:real                    leave the stacks up
//   REAL_STACK=<file> npx playwright test -c playwright.real.config.mjs test/real/decaid.spec.mjs

import { defineConfig } from 'playwright/test';

export default defineConfig({
    testDir: 'test/real',
    testMatch: '*.spec.mjs',
    outputDir: 'test/real/out/results',
    globalSetup: './test/real/support/global-setup.mjs',
    workers: 1,
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: 0,
    // Shots pulled in real time, a plugin's polls, a server stopped and started.
    timeout: 300_000,
    // Stands the stacks up: two Decaids seeded at once, then Decent Sync's second setup.
    globalTimeout: 3_600_000,
    expect: { timeout: 30_000 },
    reporter: process.env.CI
        ? [['list'], ['json', { outputFile: 'test/real/out/results.json' }], ['html', { outputFolder: 'test/real/out/report', open: 'never' }]]
        : [['list'], ['json', { outputFile: 'test/real/out/results.json' }]],
    use: { trace: 'off' },
});
