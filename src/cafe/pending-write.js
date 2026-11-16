// A value waiting to be written: set it as often as it changes, and it is
// written once, a moment after the last change. The page uses it for the steam
// flow, and for asking DYE2 to save a dial-in change onto the loaded recipe.
//
// `flush()` writes what is waiting now, so a write is never left behind when
// something else is about to change underneath it. The clock is passed in, so
// this runs under node:test.

export function createPendingWrite({ write, delayMs, setTimer = setTimeout, clearTimer = clearTimeout }) {
    let timer = null;
    let waiting = false;
    let value;

    // Resolves when the write has finished, or at once when nothing is waiting.
    // `write` reports its own failures: a rejection here is not rethrown.
    function flush() {
        clearTimer(timer);
        timer = null;
        if (!waiting) return Promise.resolve();
        const sending = value;
        waiting = false;
        value = undefined;
        return Promise.resolve().then(() => write(sending)).catch(() => {});
    }

    return {
        set(next) {
            value = next;
            waiting = true;
            clearTimer(timer);
            timer = setTimer(flush, delayMs);
        },
        flush,
        /** The value waiting to be written, or undefined. */
        pending: () => (waiting ? value : undefined),
    };
}
