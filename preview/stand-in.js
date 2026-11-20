// The public preview's stand-in for Decaid (docs/cafe/DESIGN.md, "The public
// preview"). A classic script, the first in the <head> of the preview's copy of
// the skin's page (made from index.html by preview/stage.mjs), so it runs
// before any of the page's own scripts. It is never on a tablet: nothing a
// release or a `dist` build ships names it.
//
// It replaces the browser's `fetch` and `WebSocket` for Decaid's address, the
// port src/modules/api.js writes on its host, and answers from one fake Decaid
// (fake-decaid/) made in the page from the recordings it starts from. Every
// other request, the page's own files among them, passes to the browser as it
// is. It sits beneath api.js, which stays the page's only connection stack.
//
// The fake keeps no timers, so this script keeps them for it, as the page
// tests' adapter and `advance` do (test/page/support/): it gives the fake the
// page's time before each request, has the machine send its frames at rest,
// and sends what the sockets have waiting only after the page has the answer
// that caused it.
//
// Each visit starts fresh: before the page reads anything, the browser storage
// the skin wrote on an earlier visit, and only that, is cleared.
//
// `window.cafePreview` is the preview's own handle, for its test and the
// curious: `ready` (the fake, once made), `opened` (each socket path opened,
// in order) and `drop(path)` (Decaid closing a path's sockets).

(function () {
    'use strict';

    const DECAID_PORT = '8080'; // src/modules/api.js, REA_PORT
    const AT_REST_MS = 500; // the machine's frames at rest, as the page tests send them
    const LOG_KEPT = 200; // the fake's request log, kept from growing for as long as a tab is open
    const UNREAD_ANSWER_MS = 50; // pushes wait this long for an answer the page never reads
    // What the fake starts from. preview/stage.mjs copies these and no others.
    const RECORDINGS = ['sample-data', 'boot', 'pour'];

    const here = document.currentScript.src;
    const realFetch = window.fetch.bind(window);
    const RealWebSocket = window.WebSocket;

    // ── Each visit starts fresh ──────────────────────────────────────────────
    //
    // The keys the skin writes and the databases it opens are noted as it
    // writes them, under keys of the preview's own, so the next visit clears
    // exactly those: never the whole origin's storage, which every Pages site
    // of the account shares.

    const NOTED = 'streamlineCafePreview.written';
    const NOTED_DATABASES = 'streamlineCafePreview.databases';
    // The skin's one database (src/modules/idb.js), cleared even if a visit
    // was cut short before it was noted.
    const SKIN_DATABASES = ['shot_history'];

    const storageProto = Storage.prototype;
    const setItem = storageProto.setItem;
    const getItem = storageProto.getItem;
    const removeItem = storageProto.removeItem;
    const areas = new Map();

    function area(storage) {
        try {
            return storage === window.localStorage ? 'local' : storage === window.sessionStorage ? 'session' : null;
        } catch {
            return null;
        }
    }

    function noted(storage, key) {
        try {
            const list = JSON.parse(getItem.call(storage, key) || '[]');
            return Array.isArray(list) ? list.filter(item => typeof item === 'string') : [];
        } catch {
            return [];
        }
    }

    function note(storage, key) {
        const name = area(storage);
        if (!name || key === NOTED || key === NOTED_DATABASES) return;
        if (!areas.has(name)) areas.set(name, new Set(noted(storage, NOTED)));
        const keys = areas.get(name);
        if (keys.has(key)) return;
        keys.add(key);
        try {
            setItem.call(storage, NOTED, JSON.stringify([...keys]));
        } catch {
            // Storage full or refused: the key is still written, only not noted.
        }
    }

    function startFresh() {
        for (const name of ['localStorage', 'sessionStorage']) {
            let storage;
            try {
                storage = window[name];
                for (const key of noted(storage, NOTED)) removeItem.call(storage, key);
                removeItem.call(storage, NOTED);
            } catch {
                // Storage refused (a private window, blocked site data): nothing was kept.
            }
        }
        let databases = SKIN_DATABASES;
        try {
            databases = [...new Set([...SKIN_DATABASES, ...noted(window.localStorage, NOTED_DATABASES)])];
            removeItem.call(window.localStorage, NOTED_DATABASES);
        } catch {
            // As above.
        }
        // The page's own open waits until each delete is done (IndexedDB runs
        // requests for one database name in order).
        for (const name of databases) {
            try {
                window.indexedDB.deleteDatabase(name);
            } catch {
                // IndexedDB refused: the page finds none either.
            }
        }
    }

    startFresh();
    storageProto.setItem = function (key, value) {
        note(this, String(key));
        return setItem.call(this, key, value);
    };
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (name, ...rest) {
        try {
            const list = noted(window.localStorage, NOTED_DATABASES);
            if (!list.includes(String(name))) setItem.call(window.localStorage, NOTED_DATABASES, JSON.stringify([...list, String(name)]));
        } catch {
            // Not noted: the skin's own database is cleared regardless.
        }
        return open.call(this, name, ...rest);
    };

    // What the page needs to start: DYE2 turned on (src/modules/dye2-enabled.js).
    try {
        window.localStorage.setItem('streamline.dye2Enabled', 'true');
    } catch {
        // Without storage the page shows its "DYE2 is needed" screen.
    }

    // ── Decaid's address ─────────────────────────────────────────────────────

    // As src/modules/api.js finds it: the saved host, or the page's own.
    function decaidHost() {
        let saved = null;
        try {
            saved = getItem.call(window.localStorage, 'reaHostname');
        } catch {
            // No storage: the page's own host.
        }
        return (saved || window.location.hostname).toLowerCase();
    }

    function decaidUrl(text, protocols) {
        let url;
        try {
            url = new URL(text, window.location.href);
        } catch {
            return null;
        }
        return protocols.includes(url.protocol) && url.port === DECAID_PORT && url.hostname === decaidHost() ? url : null;
    }

    // ── The fake ─────────────────────────────────────────────────────────────

    const said = new Set();
    function unanswered(what) {
        if (said.has(what)) return;
        said.add(what);
        console.info(`Streamline Cafe preview: the sample machine has no answer for ${what}, answered "not found".`);
    }

    const sockets = new Set();
    const opened = [];
    let fake = null;
    let flushing = null;
    // Answers handed to the page and not yet read (nor given up on). Nothing
    // is sent while any is waiting, since the fake's sockets send all they
    // have at once, the push an unread answer caused among it.
    let unread = 0;

    // Sends what the sockets have waiting, in a task of its own, after
    // whatever caused it has been delivered.
    function flushSoon() {
        if (flushing !== null || unread > 0) return;
        flushing = setTimeout(() => {
            flushing = null;
            if (unread === 0) fake.flush();
        }, 0);
    }

    function keepLogShort() {
        if (fake.log.length > LOG_KEPT) fake.log.splice(0, fake.log.length - LOG_KEPT);
    }

    async function recording(name) {
        const response = await realFetch(new URL(`../fake-decaid/recordings/${name}.json`, here));
        if (!response.ok) throw new Error(`the preview's recording ${name} answered ${response.status}`);
        return response.json();
    }

    const ready = (async () => {
        const [model, ...recorded] = await Promise.all([
            import(new URL('../fake-decaid/index.js', here).href),
            ...RECORDINGS.map(recording),
        ]);
        const [sampleData, boot, pour] = recorded;
        const made = model.createFakeDecaid({
            sampleData, boot, pour,
            now: Date.now(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        });
        // A machine with buttons of its own, as a DE1Pro has: the page draws
        // none, and puts Settings, Shots and Sleep under the dial-in column.
        made.patchBoot('GET /api/v1/machine/info', info => ({ ...info, GHC: true }));
        fake = made;
        setInterval(() => {
            fake.setNow(Date.now());
            fake.tick();
            keepLogShort();
            flushSoon();
        }, AT_REST_MS);
        return made;
    })();
    ready.catch(error => console.error('Streamline Cafe preview: the sample machine could not start.', error));

    // ── fetch ────────────────────────────────────────────────────────────────

    const NO_BODY = new Set([101, 103, 204, 205, 304]);
    // Chrome refuses a keepalive request whose body is over 64 KiB.
    const KEEPALIVE_LIMIT = 65536;

    function aborted(signal) {
        return signal && signal.aborted ? (signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')) : null;
    }

    async function bodyOf(input, init) {
        let text;
        if (init && 'body' in init && init.body != null) {
            text = typeof init.body === 'string' ? init.body : await new Response(init.body).text();
        } else if (input instanceof Request && input.body) {
            text = await input.clone().text();
        }
        if (text === undefined || text === '') return { body: undefined, size: 0 };
        let body;
        try {
            body = JSON.parse(text);
        } catch {
            body = text;
        }
        return { body, size: new TextEncoder().encode(text).length };
    }

    // An answer whose pushes wait until the page has read it, or a little
    // while if it never does.
    function delivered(answer, status) {
        const response = new Response(NO_BODY.has(status) ? null : JSON.stringify(answer), {
            status,
            headers: { 'content-type': 'application/json' },
        });
        unread += 1;
        let waiting = true;
        const settle = () => {
            if (!waiting) return;
            waiting = false;
            unread -= 1;
            clearTimeout(timer);
            flushSoon();
        };
        const timer = setTimeout(settle, UNREAD_ANSWER_MS);
        for (const read of ['json', 'text', 'arrayBuffer', 'blob']) {
            const own = Response.prototype[read];
            Object.defineProperty(response, read, {
                configurable: true,
                writable: true,
                value() {
                    return own.call(this).finally(settle);
                },
            });
        }
        return response;
    }

    async function answerDecaid(url, input, init) {
        const signal = (init && init.signal) || (input instanceof Request ? input.signal : null);
        if (aborted(signal)) throw aborted(signal);
        const method = String((init && init.method) || (input instanceof Request ? input.method : 'GET')).toUpperCase();
        const { body, size } = await bodyOf(input, init);
        const keepalive = (init && init.keepalive) || (input instanceof Request && input.keepalive);
        if (keepalive && size > KEEPALIVE_LIMIT) throw new TypeError('Failed to fetch');
        let made;
        try {
            made = await ready;
        } catch {
            throw new TypeError('Failed to fetch');
        }
        if (aborted(signal)) throw aborted(signal);
        made.setNow(Date.now());
        const answer = made.request({ method, url: `${url.pathname}${url.search}`, body });
        keepLogShort();
        if (!answer) {
            unanswered(`${method} ${url.pathname}`);
            return delivered({ error: 'Not found' }, 404);
        }
        if (answer.abort) {
            flushSoon();
            throw new TypeError('Failed to fetch');
        }
        return delivered(answer.body, answer.status);
    }

    window.fetch = function fetch(input, init) {
        const url = decaidUrl(input instanceof Request ? input.url : String(input), ['http:', 'https:']);
        if (!url) return realFetch(input, init);
        return answerDecaid(url, input, init);
    };

    // ── WebSocket ────────────────────────────────────────────────────────────

    const STATES = { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 };

    class PreviewSocket extends EventTarget {
        #handle = null;
        #path;

        constructor(url, protocols) {
            super();
            const decaid = decaidUrl(String(url), ['ws:', 'wss:', 'http:', 'https:']);
            // Any other address is the browser's own socket.
            if (!decaid) return protocols === undefined ? new RealWebSocket(url) : new RealWebSocket(url, protocols);
            if (decaid.protocol === 'http:') decaid.protocol = 'ws:';
            if (decaid.protocol === 'https:') decaid.protocol = 'wss:';
            this.url = decaid.href;
            this.#path = decaid.pathname;
            this.readyState = STATES.CONNECTING;
            this.protocol = '';
            this.extensions = '';
            this.binaryType = 'blob';
            this.bufferedAmount = 0;
            this.onopen = null;
            this.onmessage = null;
            this.onerror = null;
            this.onclose = null;
            ready.then(
                made => setTimeout(() => this.#open(made), 0),
                () => setTimeout(() => this.#fail(), 0),
            );
        }

        #fire(event) {
            this.dispatchEvent(event);
            const handler = this[`on${event.type}`];
            if (typeof handler === 'function') handler.call(this, event);
        }

        #open(made) {
            if (this.readyState !== STATES.CONNECTING) return;
            made.setNow(Date.now());
            const handle = made.connect(this.#path, text => this.#receive(text));
            if (!handle) {
                unanswered(`the socket ${this.#path}`);
                this.#fail();
                return;
            }
            this.#handle = handle;
            this.readyState = STATES.OPEN;
            sockets.add(this);
            opened.push(this.#path);
            this.#fire(new Event('open'));
            // What it sends as it opens, after the page has it open.
            flushSoon();
        }

        #receive(text) {
            if (this.readyState !== STATES.OPEN) return;
            this.#fire(new MessageEvent('message', { data: text, origin: new URL(this.url).origin }));
        }

        // A connection refused, or never made: Decaid's socket is not there.
        #fail() {
            if (this.readyState === STATES.CLOSED) return;
            this.readyState = STATES.CLOSED;
            this.#fire(new Event('error'));
            this.#fire(new CloseEvent('close', { code: 1006, reason: '', wasClean: false }));
        }

        #closed(code, reason) {
            this.readyState = STATES.CLOSED;
            sockets.delete(this);
            if (this.#handle) this.#handle.close();
            this.#handle = null;
            this.#fire(new CloseEvent('close', { code, reason, wasClean: true }));
        }

        send() {
            if (this.readyState === STATES.CONNECTING) throw new DOMException("Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.", 'InvalidStateError');
            // Decaid reads nothing the page sends on these sockets.
        }

        close(code, reason = '') {
            if (this.readyState === STATES.CLOSING || this.readyState === STATES.CLOSED) return;
            if (this.readyState === STATES.CONNECTING) {
                this.readyState = STATES.CLOSING;
                setTimeout(() => this.#fail(), 0);
                return;
            }
            this.readyState = STATES.CLOSING;
            setTimeout(() => this.#closed(code ?? 1005, String(reason)), 0);
        }

        /** Decaid closes the socket. */
        dropped() {
            if (this.readyState !== STATES.OPEN) return;
            this.#closed(1001, '');
        }
    }
    for (const [name, value] of Object.entries(STATES)) {
        Object.defineProperty(PreviewSocket, name, { value, enumerable: true });
        Object.defineProperty(PreviewSocket.prototype, name, { value, enumerable: true });
    }
    Object.defineProperty(PreviewSocket, 'name', { value: 'WebSocket' });
    window.WebSocket = PreviewSocket;

    window.cafePreview = Object.freeze({
        ready,
        opened,
        drop(path) {
            for (const socket of [...sockets]) if (new URL(socket.url).pathname === path) socket.dropped();
        },
    });
})();
