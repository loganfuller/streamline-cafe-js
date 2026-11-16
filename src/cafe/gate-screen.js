// The "DYE2 is needed" screen: a card that takes the page's place while a
// check in dye2-gate.js fails. The markup is in index.html; this module fills
// it in, shows it and wires its three buttons.
import { DYE2_ENABLED_KEY } from '../modules/dye2-enabled.js';
import { loadPage, prefetchSettingsPage } from '../modules/router.js';
import { logger } from '../modules/logger.js';
import { gateScreen } from './dye2-gate.js';
import { setText } from './text.js';

let wired = false;

// The check runs again wherever the main page starts: app.js's
// initMainPageOnce, which is also what leaving the settings page calls.
export function checkAgain() {
    window.app.initMainPageOnce().catch(error => logger.error('Cafe: the start-up check failed', error));
}

function wire() {
    if (wired) return;
    wired = true;
    document.getElementById('cafe-gate-reload')?.addEventListener('click', checkAgain);
    document.getElementById('cafe-gate-turn-on')?.addEventListener('click', () => {
        // The same write Streamline's own settings toggle makes; settingsSync
        // carries it to Decaid's store, where both skins read it.
        try { localStorage.setItem(DYE2_ENABLED_KEY, 'true'); } catch (error) { logger.warn('Cafe: could not turn DYE2 on', error); }
        checkAgain();
    });
    const settings = document.getElementById('cafe-gate-settings');
    settings?.addEventListener('pointerdown', () => { prefetchSettingsPage().catch(() => {}); }, { once: true });
    settings?.addEventListener('click', () => loadPage('src/settings/settings.html'));
}

export function showGate(reason) {
    const page = document.getElementById('main-page');
    if (!page) return;
    wire();
    const { line, vars, turnOn, hint } = gateScreen(reason);
    setText(document.getElementById('cafe-gate-line'), line, { translate: true, vars });
    const hintEl = document.getElementById('cafe-gate-hint');
    if (hintEl) {
        hintEl.style.display = hint ? '' : 'none';
        if (hint) setText(hintEl, hint, { translate: true });
    }
    const turnOnBtn = document.getElementById('cafe-gate-turn-on');
    if (turnOnBtn) turnOnBtn.style.display = turnOn ? '' : 'none';
    page.classList.remove('cafe-pending');
    page.classList.add('cafe-gated');
}

export function hideGate() {
    const page = document.getElementById('main-page');
    if (!page) return;
    page.classList.remove('cafe-pending', 'cafe-gated');
}
