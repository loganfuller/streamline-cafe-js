// What the page tells Decent Sync's plugin it is, and the push that asks it to
// load again (docs/cafe/DESIGN.md, "Builds and installs", its "Reporting the
// page, and reloading"; the contract is the section of that name in Decent
// Sync's docs/PLUGIN.md). decent-sync.js sends the report and reloads.
//
// The report names the Skin and version this build calls itself, and when the
// page loaded, the same for every report of one load. The page loads again at
// its own address with `v` changed, so it is asked for again rather than
// served from the WebView's cache, as Streamline's own reload for a new build
// does (src/modules/app.js, `checkSkinUpdate`).

export function pageReport({ skinId, version, timeOrigin }) {
    return { skinId, version, loadedAt: new Date(timeOrigin).toISOString() };
}

export function asksReload(data) {
    if (typeof data !== 'string') return false;
    try {
        return JSON.parse(data)?.what === 'reload';
    } catch {
        return false;
    }
}

export function reloadUrl(href, now) {
    const url = new URL(href);
    url.searchParams.set('v', String(now));
    return url.toString();
}
