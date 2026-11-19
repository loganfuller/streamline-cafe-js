// A request that goes wrong on its way back, which `fake.refuse` (answered
// instead of the model) can't say: the fake makes the change and the page never
// hears it, or the answer is held while the test looks at the page.
//
//   const undo = dropAnswer(cafe, { method: 'PUT', path: /^\/api\/v1\/shots\/[^/]+$/ });
//   const held = hold(cafe, { method: 'PUT', path: /^\/api\/v1\/shots\/[^/]+$/ });
//   await held.reached; …; held.release();

const matcher = ({ method, path }) => request => (!method || request.method === method) && path.test(`${request.path}${request.search}`);

/**
 * The requests matching `path` (a regular expression over the path and query)
 * are answered by the fake, which makes the change, and the page's request then
 * fails as a dropped connection would, as Decaid's answer lost on the way back.
 * `times` limits how many. Answers a function that stops it.
 */
export function dropAnswer(cafe, { method, path, times = Infinity }) {
    let left = times;
    const stop = cafe.routes.intercept(request => left > 0 && matcher({ method, path })(request), ({ forward }) => {
        left -= 1;
        // One the fake has no answer for stays unanswered, and fails the test.
        return forward() ? { abort: true } : null;
    });
    return stop;
}

/**
 * The next request matching `path` waits, unanswered, until `release()`; then
 * the fake answers it. `reached` settles once it is waiting. The page's
 * request counts as being answered meanwhile, so the test reads the page with
 * `expect` and does not move the clock (`cafe.advance` and `cafe.settle`
 * wait for every answer) until it has released it.
 */
export function hold(cafe, { method, path }) {
    let arrived;
    let release;
    const reached = new Promise(resolve => { arrived = resolve; });
    const released = new Promise(resolve => { release = resolve; });
    let taken = false;
    const stop = cafe.routes.intercept(request => !taken && matcher({ method, path })(request), async ({ forward }) => {
        taken = true;
        stop();
        arrived();
        await released;
        return forward();
    });
    return { reached, release: () => release() };
}
