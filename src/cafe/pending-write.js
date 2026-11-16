// A value waiting to be written: set it as often as it changes, and it is
// written once, a moment after the last change. The page uses it for the steam
// flow, and for asking DYE2 to save a dial-in change onto the loaded recipe.
//
// Writes never overlap: one waits for the one before it. A value whose write
// failed stays waiting, for the next change or the next flush to try again.
// `flush()` resolves once nothing more can be written now, so a write is never
// left behind, or still under way, when something else is about to change
// underneath it. The clock is passed in, so this runs under node:test.

export function createPendingWrite({ write, delayMs, setTimer = setTimeout, clearTimer = clearTimeout }) {
    let timer = null;
    let waiting = false;
    let value;
    let failed = false;             // what is waiting is a value whose write just failed
    let active = Promise.resolve(); // the write under way, or the last one finished

    // Begin writing what is waiting, after any write under way. `write` reports
    // its own failure and rejects; the value is then put back, unless a newer one
    // has taken its place.
    function start() {
        clearTimer(timer);
        timer = null;
        if (!waiting) return;
        const sending = value;
        waiting = false;
        failed = false;
        value = undefined;
        active = active.then(() => write(sending)).then(() => {}, () => {
            if (waiting) return;
            value = sending;
            waiting = true;
            failed = true;
        });
    }

    // Write what is waiting, a value that failed before included, and wait for
    // it and for any write under way. A value that fails during the flush is
    // left waiting: the flush resolves all the same, and never rejects.
    async function flush() {
        for (;;) {
            start();
            const current = active;
            await current;
            if (active !== current) continue; // another write began meanwhile
            if (!waiting || failed) return;
        }
    }

    return {
        set(next) {
            value = next;
            waiting = true;
            failed = false;
            clearTimer(timer);
            timer = setTimer(start, delayMs);
        },
        flush,
        /** The value waiting to be written, or undefined. */
        pending: () => (waiting ? value : undefined),
    };
}
