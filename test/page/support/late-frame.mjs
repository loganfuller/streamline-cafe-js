// A socket frame that reaches the page late, as one held up on a loaded
// tablet. This is the page tests' one fixed wait (test/page-test-rules.test.mjs
// leaves this file out): the frame is held for real time, not the page's, so
// that a page clock left running by itself fires the timers it would meanwhile.

/**
 * The frames to the socket `path` that `matches` (given the parsed frame)
 * reach the page `ms` of real time late. Each counts as being answered until
 * it is sent, so `cafe.settle` and `cafe.advance` wait for it. A frame sent to
 * the socket while one is held is not held, and overtakes it. Called before the
 * page opens; answers a function that stops it for sockets opened afterwards.
 */
export function late(cafe, { path, matches, ms }) {
    let held = 0;
    return cafe.routes.interceptSocket(path, send => cafe.fake.connect(path, text => {
        if (!matches(JSON.parse(text))) {
            send(text);
            return;
        }
        held += 1;
        const asking = `WS ${path} (held ${held})`;
        cafe.routes.inflight.add(asking);
        setTimeout(() => {
            cafe.routes.inflight.delete(asking);
            send(text);
        }, ms);
    }));
}
