// Holding a stepper's − or + repeats it. Streamline's steppers step once per
// tap; the cafe page adds the repeat on top without touching them, by firing the
// same step the tap fires.
//
// The timing lives here with the clock passed in, so it runs under node:test.

export const HOLD_DELAY_MS = 450;   // long enough that a slow tap is still one step
export const HOLD_EVERY_MS = 110;

/**
 * One press at a time. `press()` starts the wait, `release()` ends it and
 * answers whether any repeat fired, which is when the caller must swallow the
 * tap's own step. `fire()` answering false ends the repeat: the control it
 * steps is no longer available.
 */
export function createHoldRepeat({ fire, setTimer = setTimeout, clearTimer = clearTimeout,
    delayMs = HOLD_DELAY_MS, everyMs = HOLD_EVERY_MS }) {
    let timer = null;
    let repeated = false;

    const tick = () => {
        timer = null;
        if (fire() === false) return;
        repeated = true;
        timer = setTimer(tick, everyMs);
    };

    return {
        press() {
            clearTimer(timer);
            repeated = false;
            timer = setTimer(tick, delayMs);
        },
        release() {
            clearTimer(timer);
            timer = null;
            const fired = repeated;
            repeated = false;
            return fired;
        },
    };
}
