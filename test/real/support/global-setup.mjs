// Stands the real stacks up before the journeys (stacks.mjs) and answers the
// teardown that removes them. REAL_STACK=<file> uses the stacks kept in that
// file and leaves them, or, where there is no such file yet, writes this run's
// there. REAL_STACK_KEEP=1 leaves this run's up, to run the journeys against
// again with REAL_STACK= (docs/cafe/TESTING.md).

import { existsSync } from 'node:fs';

import { standUpStacks, STATE } from './stacks.mjs';

export default async function globalSetup() {
    if (process.env.REAL_STACK && existsSync(STATE)) {
        console.log(`journeys on the stacks kept in ${STATE}`);
        return undefined;
    }
    const started = Date.now();
    const { state, stop } = await standUpStacks();
    console.log(`stacks up in ${Math.round((Date.now() - started) / 1000)} s: Decaid ${state.decaid.api}; with Decent Sync ${state.sync.api}, server ${state.sync.server.url}, second Decaid ${state.sync.second.api}`);
    if (process.env.REAL_STACK_KEEP) {
        console.log(`kept: run again with REAL_STACK=${STATE}; remove with the label filter in docs/cafe/TESTING.md`);
        return undefined;
    }
    // Ctrl-C skips the teardown: the containers go with it.
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stop(); process.exit(signal === 'SIGINT' ? 130 : 143); });
    return stop;
}
