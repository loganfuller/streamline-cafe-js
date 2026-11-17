// The Shots list: the Shots button, the dialog, a page of rows at a time, and
// a tap that opens a Shot in the graph (docs/cafe/DESIGN.md, "The Shots
// list"). The markup is in index.html. What a row and the header say is worked
// out in shot-list.js; the rows are read through the Shot seam, which says
// what it listed and why, and the recipes' names from DYE2's records. Whether
// the rows are this machine's or its Location's is never asked here: a row is
// the same thing either way.
import { getDye2KvArray } from '../modules/api.js';
import { showToast } from '../modules/ui.js';
import { logger } from '../modules/logger.js';
import { shotsPage } from './shot-seam.js';
import { openShot, shotInGraph, isShotOpened, onShotChanges } from './graph.js';
import { PAGE_SIZE, shotRow, withPage, dayTitle, listItems, doseYieldText, durationText, withRemarks, withReference, listHeader } from './shot-list.js';
import { starFills } from './remarks.js';
import { cafeText, cafeDateLocale, setText } from './text.js';

const RECIPES_KEY = 'recipes';
/** How near the end of the list, in pixels, a scroll reads the next page. */
const NEAR_END_PX = 600;

// The list as last read. It is kept while a Shot opened from it is in the
// graph, so several can be opened one after another; once the graph is back
// on the latest, the next opening reads it afresh.
let list = null;         // { rows, recipes, listed, next, failed, scrollTop }: `listed` is the seam's word on what is listed and why, `next` what the next page is asked with
let loading = null;      // the list a later page is on its way for
let opening = null;      // the generation a first page is on its way in
// Counts what ends a list on its way or on screen: a shot starting, the main
// page hidden behind another, where references are kept changing. A first page
// read across one is not shown.
let generation = 0;
let shotRunning = () => false;

const el = id => document.getElementById(id);

// ── Drawing ──────────────────────────────────────────────────────────────────

function cell(className, text) {
    const span = document.createElement('span');
    span.className = className;
    if (text !== undefined) span.textContent = text;
    return span;
}

// The rating as five stars, part-filled between two, or "Not rated". An
// Unfinished Shot is marked in the rating's place where it has none.
function ratingCell(rating, unfinished) {
    const cellEl = cell('cafe-shots-rating');
    if (unfinished && rating === null) {
        cellEl.append(cell('cafe-shots-unfinished', cafeText('Unfinished')));
        return cellEl;
    }
    if (rating === null) {
        cellEl.append(cell('cafe-shots-muted', cafeText('Not rated')));
        return cellEl;
    }
    const stars = cell('cafe-shots-stars');
    stars.setAttribute('role', 'img');
    stars.setAttribute('aria-label', `${Math.round(rating * 5) / 10} / 5`);
    for (const fill of starFills(rating)) {
        const star = cell('cafe-shots-star', '★');
        star.style.setProperty('--cafe-star-fill', `${fill * 100}%`);
        stars.append(star);
    }
    cellEl.append(stars);
    return cellEl;
}

const NOTE_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/></svg>';

// The Machine that pulled the Shot, with this one marked.
function machineCell(row) {
    const machine = cell('cafe-shots-machine');
    machine.append(cell('cafe-shots-machine-name', row.machine || ''));
    if (row.thisMachine) machine.append(cell('cafe-shots-this', cafeText('This machine')));
    return machine;
}

function rowButton(row, inGraph) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cafe-shots-row';
    button.dataset.shotId = row.id;
    if (row.id === inGraph) button.setAttribute('aria-current', 'true');

    let time = '';
    if (row.when) {
        try {
            time = row.when.toLocaleTimeString(cafeDateLocale(), { hour: '2-digit', minute: '2-digit' });
        } catch (error) {
            time = row.when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        }
    }
    const recipe = cell('cafe-shots-recipe');
    const top = cell('cafe-shots-recipe-top');
    // A recipe's name is its own; "No recipe" is a phrase, and muted.
    top.append(row.name === null ? cell('cafe-shots-name cafe-shots-muted', cafeText('No recipe')) : cell('cafe-shots-name', row.name));
    if (row.isReference) top.append(cell('cafe-shots-chip', cafeText('Reference')));
    recipe.append(top, cell('cafe-shots-bean', row.bean));

    const note = cell('cafe-shots-note');
    if (row.hasNote) {
        note.innerHTML = NOTE_ICON; // a fixed icon, never the note's text
        note.setAttribute('role', 'img');
        note.setAttribute('aria-label', cafeText('Note'));
    }
    // The Machine and how long the Shot ran are in every row, and shown only
    // in the Location's list, by the stylesheet.
    button.append(cell('cafe-shots-time', time), machineCell(row), recipe, cell('cafe-shots-weights', doseYieldText(row)), cell('cafe-shots-duration', durationText(row)), ratingCell(row.rating, row.unfinished), cell('cafe-shots-barista', row.barista), note);
    button.addEventListener('click', () => {
        el('cafe-shots-dialog')?.close();
        // A recipe this tablet has no DYE2 record of is opened under its name.
        openShot(row.id, row.recipe, row.recipe ? null : row.name);
    });
    return button;
}

// What the list says about where it comes from: the Location's name, or "This
// machine only" and why.
function paintHeader() {
    const { under, line, location } = listHeader(list.listed);
    el('cafe-shots-dialog')?.classList.toggle('cafe-shots-location', location);
    const underEl = el('cafe-shots-under');
    if (underEl) {
        setText(underEl, under ? under.text : '', { translate: !!under && under.translate });
        underEl.style.display = under ? '' : 'none';
    }
    const lineEl = el('cafe-shots-line');
    if (lineEl) {
        setText(el('cafe-shots-line-text'), line ? line.text : '', { translate: !!line && line.translate });
        lineEl.style.display = line ? '' : 'none';
    }
}

function render() {
    const body = el('cafe-shots-list');
    if (!body || !list) return;
    paintHeader();
    const now = new Date();
    const locale = cafeDateLocale();
    const words = { today: cafeText('Today'), yesterday: cafeText('Yesterday') };
    const inGraph = shotInGraph();
    body.replaceChildren(...listItems(list.rows).map(item => {
        if (item.header) {
            const header = document.createElement('div');
            header.className = 'cafe-shots-day';
            header.textContent = dayTitle(item.header, now, locale, words);
            return header;
        }
        return rowButton(item.row, inGraph);
    }));
    const empty = el('cafe-shots-empty');
    if (empty) empty.style.display = list.rows.length ? 'none' : '';
    paintEnd();
}

// The line at the end of the list: a later page that could not be read says
// so there, and is tried again at the next scroll.
function paintEnd() {
    const end = el('cafe-shots-end');
    if (!end || !list) return;
    const failed = list.failed && loading !== list;
    end.textContent = failed ? cafeText('Could not read more shots') : '';
    end.style.display = failed ? '' : 'none';
}

// ── Reading ──────────────────────────────────────────────────────────────────

// A page's rows, as the list draws them.
const rowsOf = (page, recipes) => page.rows.map(listed => shotRow(listed, { recipes }));

// The next page, once the list is scrolled near its end.
async function readMore() {
    if (!list || list.next === null || loading === list) return;
    const reading = list;
    loading = reading;
    paintEnd();
    try {
        const page = await shotsPage(reading.next, PAGE_SIZE);
        if (list !== reading) return; // read afresh meanwhile
        // What is listed changed since the page before, as when the server
        // went out of reach: the seam read the list afresh, and this is its
        // first page, under its own header.
        reading.rows = withPage(page.afresh ? [] : reading.rows, rowsOf(page, reading.recipes));
        reading.listed = page.list;
        reading.next = page.next;
        reading.failed = false;
        loading = null;
        if (page.afresh) {
            reading.scrollTop = 0;
            const scroller = el('cafe-shots-scroll');
            if (scroller) scroller.scrollTop = 0;
        }
        render();
    } catch (error) {
        logger.warn('Cafe: could not read more Shots', error);
        if (list === reading) reading.failed = true;
    } finally {
        // A page for a list read afresh meanwhile leaves that list's reading alone.
        if (loading === reading) loading = null;
        paintEnd();
    }
}

function onScroll(event) {
    const scroller = event.currentTarget;
    if (list) list.scrollTop = scroller.scrollTop;
    if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < NEAR_END_PX) readMore();
}

// ── Opening ──────────────────────────────────────────────────────────────────

// Shows the list; one already open, read again in place, is drawn again.
function showDialog() {
    const dialog = el('cafe-shots-dialog');
    if (!dialog || typeof dialog.showModal !== 'function') return;
    render();
    if (!dialog.open) dialog.showModal();
    const scroller = el('cafe-shots-scroll');
    if (scroller) scroller.scrollTop = list.scrollTop || 0;
}

// The Shots button. While a Shot opened from the list is in the graph the
// list opens where it was left; otherwise it is read afresh. A list that
// can't be read is not an empty list: a toast says so and it does not open.
async function openList() {
    // A first page read in a generation since ended does not hold up this tap.
    if (shotRunning() || opening === generation) return;
    if (list && isShotOpened()) {
        showDialog();
        return;
    }
    list = null;
    const asked = generation;
    opening = asked;
    try {
        const [recipes, page] = await Promise.all([getDye2KvArray(RECIPES_KEY), shotsPage(null, PAGE_SIZE)]);
        // A recipe is named from DYE2's records: without them every Shot would
        // read as one with no recipe.
        if (!recipes) throw new Error('DYE2\'s records could not be read.');
        if (generation !== asked) return;
        list = { rows: withPage([], rowsOf(page, recipes)), recipes, listed: page.list, next: page.next, scrollTop: 0, failed: false };
    } catch (error) {
        logger.warn('Cafe: could not read the Shots', error);
        if (generation !== asked) return;
        // A list open while it was read again in place closes.
        const dialog = el('cafe-shots-dialog');
        if (dialog?.open) dialog.close();
        showToast(cafeText('Could not read the shots'), 4000, 'error');
        return;
    } finally {
        if (opening === asked) opening = null;
    }
    // A shot that started while the list was read keeps the screen.
    if (shotRunning()) return;
    showDialog();
}

// ── Start ────────────────────────────────────────────────────────────────────

/** Called once, when the page starts. `isShotRunning()` says whether a shot runs. */
export function initShotsList({ isShotRunning = () => false } = {}) {
    shotRunning = isShotRunning;
    const button = el('cafe-shots-btn');
    button?.addEventListener('click', openList);
    el('cafe-shots-scroll')?.addEventListener('scroll', onScroll, { passive: true });
    // The list closed while it was read again in place, by its Close button
    // or a row tapped, stays closed: the page then read is not shown.
    el('cafe-shots-dialog')?.addEventListener('close', () => { if (opening === generation) generation += 1; });

    // While a shot runs the button takes no taps, and a shot that starts
    // closes the list, as it closes the page's other dialogs. A list still on
    // its way is not shown once a shot has started, the page has gone behind
    // another, or where references are kept has changed: its chips are the
    // other source's.
    const drop = ({ forget = false } = {}) => {
        generation += 1;
        if (forget) list = null;
        const dialog = el('cafe-shots-dialog');
        if (dialog?.open) dialog.close();
    };
    document.addEventListener('streamline:espresso-start', () => {
        if (button) button.disabled = true;
        drop();
    });
    document.addEventListener('streamline:mainpagehidden', () => drop());
    document.addEventListener('streamline:espresso-end', () => { if (button) button.disabled = false; });
    if (button) button.disabled = shotRunning();

    // What the page changes of a listed Shot is written into the kept list.
    onShotChanges({
        edited(shotId, remarks) {
            if (!list) return;
            list.rows = list.rows.map(row => (row.id === String(shotId) ? withRemarks(row, remarks) : row));
        },
        chosen(recipeId, shotId) {
            // Rows of a list that does not know which Shots are references are left alone.
            if (!list) return;
            list.rows = withReference(list.rows, recipeId, shotId);
        },
        // Where the list's Shots come from changed. A list open or on its way
        // is read again in place, from the new source, so the tap is not
        // lost: the list's own refusal, as for a Machine whose sharing was
        // turned off since the status was last asked, has the status asked,
        // and its answer is such a change. Otherwise the kept list is dropped.
        sourceMoved() {
            const shown = !!el('cafe-shots-dialog')?.open;
            // Only a first page on its way in this generation: one a shot or
            // the page going behind another has ended is not shown.
            const waiting = opening === generation;
            if ((!shown && !waiting) || shotRunning()) {
                drop({ forget: true });
                return;
            }
            generation += 1;
            list = null;
            // The other source's rows are not left to be tapped meanwhile.
            el('cafe-shots-list')?.replaceChildren();
            openList();
        },
    });
    document.addEventListener('streamline:languagechange', () => { if (el('cafe-shots-dialog')?.open) render(); });
}
