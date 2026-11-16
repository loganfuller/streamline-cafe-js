// A value waiting to be written: set it as often as it changes, and it is
// written once, a moment after the last change. The page uses it for the steam
// flow, which it steps itself.
//
// Writes never overlap: one waits for the one before it. `flush()` resolves
// once nothing is waiting and nothing is being written, so a write is never
// left behind, or still under way, when a recipe is about to load underneath
// it. The clock is passed in, so this runs under node:test.

export function createPendingWrite({ write, delayMs, setTimer = setTimeout, clearTimer = clearTimeout }) {
    let timer = null;
    let waiting = false;
    let value;
    let active = Promise.resolve(); // the write under way, or the last one finished

    // Begin writing what is waiting, after any write under way. `write` reports
    // its own failure: a rejection is not rethrown.
    function start() {
        clearTimer(timer);
        timer = null;
        if (!waiting) return;
        const sending = value;
        waiting = false;
        value = undefined;
        active = active.then(() => write(sending)).catch(() => {});
    }

    async function flush() {
        for (;;) {
            start();
            const current = active;
            await current;
            // A change made during that write is written too.
            if (!waiting && active === current) return;
        }
    }

    return {
        set(next) {
            value = next;
            waiting = true;
            clearTimer(timer);
            timer = setTimer(start, delayMs);
        },
        flush,
        /** The value waiting to be written, or undefined. */
        pending: () => (waiting ? value : undefined),
    };
}
