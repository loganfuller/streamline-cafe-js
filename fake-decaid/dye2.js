// DYE2's selection, as DYE2 v0.1.42 derives it, mirrors it and pushes it.
//
// Read from dye2 v0.1.42: dye2-plugin/src/plugin.ts (`derive`, `workflowChanged`,
// `mirror`, `announce`, `handleSelection`, `handleRecord`, the `skin` answer,
// `refreshRecents` on `shotStored`) and dye2-plugin/src/utils/workflow-record.ts (`recipeFields`,
// `recipeModified`, `deriveSelection`, `favouriteMatches`, `profileFingerprint`,
// `resolveRecipeFromHistory`); guided by decent-sync's
// server/test/support/simulated-dye2.ts, which follows DYE2 v0.1.40.
// Recorded: recordings/dye2-selection.json; the push once a Shot is stored, in
// recordings/pour.json (DYE2's `changed` socket through the store).
//
// - The selection is derived from the live Workflow each time, never stored: a
//   recipe by `context.extras.dye.recipeId`, `modified` when the Workflow has
//   moved off a field the recipe holds; else the first saved favourite, then
//   recent, whose fields the Workflow matches; else null.
// - After each Workflow change DYE2 mirrors the selection to its store key
//   `selection` and pushes `{ what: 'workflow' }` on its `changed` socket, only
//   when the kind, id or `modified` moved. It also pushes once a Shot is stored.
// - A change of profile under a recipe clears `recipeId`, unless the profile is
//   the recipe's own.
// - `POST selection` writes `recipeId` (the recipe's id, or null for anything
//   else) into the Workflow, and answers the selection.
//
// - `POST save-recipe` makes a recipe from the live Workflow, as DYE2's
//   `handleSaveRecipe` does: named by the body's `name`, else by
//   `proposeRecipeName` (utils/workflow-record.ts: the first word of the
//   profile's title unless it says nothing, the bean, any beverage typed; the
//   day where there is no bean; " 2", " 3" for a name taken), in the body's
//   slot 1 to 5 (its holder keeps its row and loses the slot) or none, the
//   Workflow's flush settings filled from the machine's; then the Workflow's
//   `recipeId` set to it, and a push. Its id is DYE2's shape, `recipe-` and
//   base 36, made from the page's time and a count rather than at random.
//   Recorded: recordings/dye2-save-recipe.json.
//
// What the test makes happen, which no request shows:
// - `recordReads()`: DYE2's `record` (Decent Sync's plugin asks for it after
//   each dial-in change) has read the recipes list; the function it answers
//   writes that list back whole, as `recordWorkflow` does once it has worked out
//   its patch, then pushes on `changed` and mirrors the selection from the
//   Workflow it read, as `handleRecord` does. A record written in between is
//   lost. The patch itself is left out: what a page test needs is the list as
//   it was read.
// - `restart()`: DYE2 starts again (Decaid's plugin disable and enable, which
//   unload it and load it afresh: plugin_loader_service.dart): it forgets what
//   it noted at the last load. Its `onLoad` asks for a look at the Workflow
//   comparing the record's profile (`trackWorkflow(wf, true)`), but on the
//   pinned stack that look cleared no recipe, whether the record held the
//   Workflow's profile or another: the recipe stayed loaded both times. Why
//   was not found; the model follows the recording, and DYE2's next look at
//   the Workflow notes the profile afresh. Recorded: recordings/dye2-restart.json,
//   which shows only that the recipe stays loaded: a fake that did nothing on
//   a restart would replay it too. What is forgotten (the noted profile and the
//   last mirrored selection) shows in no answer the stack gives; it is read
//   from DYE2's code, where a plugin loaded afresh starts with neither.
//
// Not kept: DYE2's recent favourites are read from the store and never worked
// out again from new Shots; `record` has no answer.

import { copy, isObject } from './workflow.js';

export const DYE2_ID = 'dye2.reaplugin';
const NS = DYE2_ID;

const MACHINE_MAP = {
    steamTempC: ['steamSettings', 'targetTemperature'],
    steamTimeS: ['steamSettings', 'duration'],
    steamFlowMls: ['steamSettings', 'flow'],
    steamStopAtTempC: ['steamSettings', 'stopAtTemperature'],
    hotWaterTempC: ['hotWaterData', 'targetTemperature'],
    hotWaterTimeS: ['hotWaterData', 'duration'],
    hotWaterMl: ['hotWaterData', 'volume'],
    hotWaterFlowMls: ['hotWaterData', 'flow'],
    flushTempC: ['rinseData', 'targetTemperature'],
    flushS: ['rinseData', 'duration'],
    flushFlowMls: ['rinseData', 'flow'],
};
const STEAM_OFF_KEYS = ['steamTempC', 'steamTimeS'];
const DE1_ONLY = { flushTempC: 'flushTemp', flushFlowMls: 'flushFlow' };

function num(v) {
    if (v == null || v === '') return undefined;
    const n = parseFloat(String(v));
    return Number.isFinite(n) ? n : undefined;
}
function grindValue(v) {
    if (v == null) return undefined;
    const s = String(v).trim();
    if (s === '') return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : s;
}
function put(out, k, v) {
    if (v !== undefined && v !== null) out[k] = v;
}

export function recipeFields(wf) {
    const out = {};
    const ctx = (wf && wf.context) || {};
    put(out, 'dose', ctx.targetDoseWeight);
    put(out, 'drink', ctx.targetYield);
    put(out, 'grind', grindValue(ctx.grinderSetting));
    const extras = ctx.extras || {};
    put(out, 'rpm', num(extras.rpm));
    put(out, 'feedRate', extras.feedRate);
    put(out, 'basketId', extras.basketId);
    put(out, 'basketName', extras.basketName);
    const steps = wf && wf.profile && wf.profile.steps;
    put(out, 'brewC', num(steps && steps[0] && steps[0].temperature));
    for (const [k, [group, field]] of Object.entries(MACHINE_MAP)) put(out, k, ((wf && wf[group]) || {})[field]);
    return out;
}

function steamOff(wf) {
    const t = Number(((wf && wf.steamSettings) || {}).targetTemperature);
    return Number.isFinite(t) && t < 135;
}

export function ownedRecipeFields(wf) {
    const out = recipeFields(wf);
    if (steamOff(wf)) for (const k of STEAM_OFF_KEYS) delete out[k];
    return out;
}

function machineFields(wf) {
    const all = recipeFields(wf);
    const out = {};
    for (const k of Object.keys(MACHINE_MAP)) if (all[k] !== undefined) out[k] = all[k];
    return out;
}

function withMachineSettings(wf, de1) {
    if (!wf || !de1) return wf;
    const out = { ...wf };
    for (const [name, key] of Object.entries(DE1_ONLY)) {
        if (de1[key] == null) continue;
        const [group, field] = MACHINE_MAP[name];
        out[group] = { ...(out[group] || {}), [field]: de1[key] };
    }
    return out;
}

function favouriteFields(wf) {
    const out = {};
    const ctx = (wf && wf.context) || {};
    put(out, 'dose', ctx.targetDoseWeight);
    put(out, 'drink', ctx.targetYield);
    put(out, 'grindSetting', grindValue(ctx.grinderSetting));
    put(out, 'rpm', num(ctx.extras && ctx.extras.rpm));
    put(out, 'feedRate', ctx.extras && ctx.extras.feedRate);
    return out;
}

function sameValue(cur, v) {
    return cur === v || (cur != null && v != null && !(typeof cur === 'string' && typeof v === 'string')
        && Number.isFinite(Number(cur)) && Number(cur) === Number(v));
}

function changedFields(patch, stored) {
    const out = {};
    for (const [k, v] of Object.entries(patch || {})) if (!sameValue(stored ? stored[k] : undefined, v)) out[k] = v;
    return out;
}

function heldFields(fields, stored) {
    const out = {};
    for (const [k, v] of Object.entries(fields || {})) if (stored && stored[k] != null) out[k] = v;
    return out;
}

function movedSinceArming(k, live, armed) {
    if (!armed || (!(k in MACHINE_MAP) && k !== 'basketId')) return false;
    return armed[k] !== undefined && !sameValue(armed[k], live);
}

function profileOf(recipe) {
    return (recipe.workflow && recipe.workflow.profile) || recipe.profileSnapshot || null;
}

function sortKeysReplacer(_key, value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const sorted = {};
        for (const k of Object.keys(value).sort()) sorted[k] = value[k];
        return sorted;
    }
    return value;
}

export function profileFingerprint(profile) {
    if (!profile) return null;
    const steps = Array.isArray(profile.steps)
        ? profile.steps.map(({ temperature, limiter, ...rest }) => ({ ...rest, limiter: limiter && Number(limiter.value) !== 0 ? limiter : null }))
        : profile.steps;
    return JSON.stringify({ title: profile.title, tank_temperature: profile.tank_temperature, steps }, sortKeysReplacer);
}

export function recipeModified(recipe, wf, armed = null) {
    const stored = recipe.dashboardVariables || {};
    const owned = ownedRecipeFields(wf);
    const held = heldFields(owned, stored);
    for (const k of [...Object.keys(MACHINE_MAP), 'basketId']) {
        if (owned[k] !== undefined && movedSinceArming(k, owned[k], armed)) held[k] = owned[k];
    }
    if (!profileOf(recipe)) delete held.brewC;
    return Object.keys(changedFields(held, stored)).length > 0;
}

function recipeProfileChanged(recipe, wf) {
    const mine = profileFingerprint(profileOf(recipe));
    const live = profileFingerprint(wf && wf.profile);
    return !!mine && !!live && mine !== live;
}

function idProfileChanged(base, recipe, wf) {
    if (!base) return !!recipe && recipeProfileChanged(recipe, wf);
    const live = profileFingerprint(wf && wf.profile);
    return !!base.profileFingerprint && !!live && live !== base.profileFingerprint;
}

function favouriteMatches(fav, wf) {
    const src = fav.auto ? favouriteFields(fav.workflow) : fav.snapshot || {};
    const held = heldFields(favouriteFields(wf), src);
    return Object.keys(held).length > 0 && Object.keys(changedFields(held, src)).length === 0;
}

export function recipeIdOf(wf) {
    const id = wf && wf.context && wf.context.extras && wf.context.extras.dye && wf.context.extras.dye.recipeId;
    return id == null || id === '' ? null : String(id);
}

const GENERIC_PROFILE = /^(default|advanced|custom|profile|new|untitled)$/i;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** DYE2's `proposeRecipeName`; `now` is the page's time, read in UTC, Decaid's zone. Not recorded: the save-recipe scenario's names all have a bean, so the day is held by the unit test alone. */
export function proposeRecipeName(wf, existingNames = [], beverage = '', now = 0) {
    const word = String((wf && wf.profile && wf.profile.title) || '').trim().split(/\s+/)[0] || '';
    const ctx = (wf && wf.context) || {};
    const bean = String(ctx.coffeeName || '').trim();
    const typed = String(beverage || '').trim();
    const parts = [GENERIC_PROFILE.test(word) ? '' : word, bean, typed].filter(Boolean);
    if (!parts.length) parts.push('Recipe');
    if (!bean) {
        const day = new Date(now);
        parts.push(`${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]}`);
    }
    const base = parts.join(' ');
    const taken = n => existingNames.some(x => String(x).toLowerCase() === n.toLowerCase());
    if (!taken(base)) return base;
    let n = 2;
    while (taken(`${base} ${n}`)) n++;
    return `${base} ${n}`;
}

/** DYE2's `explicitRecipeSlot`: 1 to 5, else none. */
function explicitRecipeSlot(requested) {
    if (requested == null || requested === '') return null;
    const want = Number(requested);
    return [1, 2, 3, 4, 5].includes(want) ? want : null;
}

export function deriveSelection(wf, rows, armed = null) {
    if (!wf) return null;
    const rid = recipeIdOf(wf);
    const recipe = rid && (rows.recipes || []).find(r => r && String(r.id) === rid);
    if (recipe) return { kind: 'recipe', id: rid, modified: recipeModified(recipe, wf, armed) };
    const favs = (rows.favourites || []).filter(f => f && f.id != null);
    const hit = favs.filter(f => !f.auto).concat(favs.filter(f => f.auto)).find(f => favouriteMatches(f, wf));
    if (!hit) return null;
    return hit.auto ? { kind: 'favourite', id: String(hit.id), modified: false, auto: true } : { kind: 'favourite', id: String(hit.id), modified: false };
}

/**
 * DYE2, loaded on a Decaid. `decaid` is what DYE2 reaches through its own
 * requests: the Workflow, the store, the newest Shots and the machine's
 * settings. `announce(payload)` pushes on `changed`.
 */
export function createDye2({ decaid, announce }) {
    let baseline = null;
    let mirrored = null;

    const kv = key => {
        const value = decaid.store.get(NS, key);
        return Array.isArray(value) ? value : [];
    };

    function recipeFor(rid, recipes) {
        if (!rid) return null;
        const row = recipes.find(r => r && String(r.id) === rid);
        if (row) return row;
        const shot = decaid.newestShots(50).find(s => s && recipeIdOf(s.workflow) === rid);
        return shot ? { id: rid, dashboardVariables: recipeFields(shot.workflow), workflow: shot.workflow } : null;
    }

    function derive(wf, known) {
        const recipes = known || kv('recipes');
        const hist = recipeFor(recipeIdOf(wf), recipes);
        const armed = baseline && baseline.id === recipeIdOf(wf) ? baseline.armedMachine : null;
        return deriveSelection(wf, { recipes: hist ? recipes.concat(hist) : recipes, favourites: kv('autoFavourites') }, armed);
    }

    function mirror(wf, recipes) {
        const sel = derive(wf, recipes);
        const key = sel ? `${sel.kind}:${sel.id}:${sel.modified}` : null;
        if (key === mirrored) return;
        mirrored = key;
        // Decaid's plugin storage stores no null: `{}` has no kind.
        decaid.store.set(NS, 'selection', sel || {});
        announce({ what: 'workflow' });
    }

    /** DYE2's `workflowUpdated` handler. Answers a Workflow write of its own, or null. */
    function workflowChanged(wf, cold = false) {
        if (!wf) return null;
        const rid = recipeIdOf(wf);
        let recipes;
        if (rid) {
            recipes = kv('recipes');
            const recipe = recipeFor(rid, recipes);
            const known = baseline && baseline.id === rid ? baseline : null;
            if ((known || cold) && idProfileChanged(known, recipe, wf) && (!recipe || recipeProfileChanged(recipe, wf))) {
                // The write fires another workflowUpdated, which mirrors the result.
                return { context: { extras: { dye: { recipeId: null } } } };
            }
            if (!baseline || baseline.id !== rid || baseline.profileFingerprint !== profileFingerprint(wf.profile)) {
                const full = withMachineSettings(wf, decaid.machineSettings());
                const owned = ownedRecipeFields(wf);
                baseline = {
                    kind: 'recipe', id: rid, profileFingerprint: profileFingerprint(wf.profile),
                    armedBrewC: owned.brewC === undefined ? null : owned.brewC,
                    armedBeanBatchId: null, armedGrinderId: null,
                    armedMachine: { ...machineFields(full), basketId: owned.basketId ?? null },
                };
            }
        } else baseline = null;
        mirror(wf, recipes);
        return null;
    }

    let made = 0;
    // `handleSaveRecipe`.
    function saveRecipe(body) {
        let wf = decaid.workflow();
        const recipes = kv('recipes');
        const ctx = wf.context || {};
        const beverage = (isObject(body) && typeof body.beverage === 'string' && body.beverage.trim()) || '';
        const name = (isObject(body) && typeof body.name === 'string' && body.name.trim())
            || proposeRecipeName(wf, recipes.map(r => r && (r.name || r.title)), beverage, decaid.now());
        const stripSlot = explicitRecipeSlot(isObject(body) ? body.slot : undefined);
        const id = `recipe-${decaid.now().toString(36)}${(++made).toString(36).padStart(4, '0')}`;
        wf = withMachineSettings(wf, decaid.machineSettings());
        const { dye, ...extras } = ctx.extras || {};
        const flags = {};
        const topKeys = ['beanBatchId', 'coffeeName', 'coffeeRoaster', 'grinderId', 'grinderModel', 'baristaName', 'drinkerName'];
        for (const k of topKeys.concat(['basketId', 'basketName', 'rpm', 'note'])) {
            const v = topKeys.includes(k) ? ctx[k] : extras[k];
            if (v !== undefined) flags[k] = v === null ? null : true;
        }
        if (Object.keys(flags).length) extras.dye = { v: 1, ...flags };
        const dashboardVariables = ownedRecipeFields(wf);
        if (ctx.grinderId) {
            dashboardVariables.grinderId = ctx.grinderId;
            dashboardVariables.grinderModel = ctx.grinderModel;
        }
        const row = {
            id, stripSlot, name, title: name, beverage,
            barista: ctx.baristaName, drinker: ctx.drinkerName,
            beanName: ctx.coffeeName, beanRoaster: ctx.coffeeRoaster, beanBatchId: ctx.beanBatchId,
            profileTitle: wf.profile && wf.profile.title, profileSnapshot: wf.profile,
            dashboardVariables,
            workflow: {
                context: { ...ctx, extras },
                profile: wf.profile,
                steamSettings: wf.steamSettings, hotWaterData: wf.hotWaterData, rinseData: wf.rinseData,
            },
            capturedAt: new Date(decaid.now()).toISOString(),
        };
        // As JSON carries it: a field left undefined is not written.
        decaid.store.set(NS, 'recipes', JSON.parse(JSON.stringify(recipes
            .map(r => (stripSlot != null && r && r.stripSlot === stripSlot ? { ...r, stripSlot: null } : r)).concat(row))));
        decaid.putWorkflow({ context: { extras: { dye: { v: 1, recipeId: id } } } });
        announce({ what: 'workflow' });
        return { status: 200, body: { id, name } };
    }

    return {
        workflowChanged,
        /**
         * DYE2's `record` has read the recipes list: the answer writes that list
         * back, then pushes on `changed` and mirrors the selection from the
         * Workflow it read. With no recipe loaded `record` writes nothing, and
         * the answer does nothing.
         */
        recordReads() {
            const read = copy(kv('recipes'));
            const wf = copy(decaid.workflow());
            const sel = derive(wf);
            if (!sel || sel.kind !== 'recipe') return () => {};
            return () => {
                decaid.store.set(NS, 'recipes', copy(read));
                // `handleRecord` once it has written: a push, then the selection
                // mirrored from the Workflow it read.
                announce({ what: 'workflow' });
                mirror(wf);
            };
        },
        /**
         * DYE2 starts again: what it noted is forgotten, and its selection is
         * mirrored and pushed afresh. The load-time look notes no profile, so
         * the next Workflow change is the one DYE2 notes the profile from. That
         * is a guess: by DYE2's code, `onLoad`'s cold look (`trackWorkflow(wf,
         * true)`) should clear a recipe whose record holds another profile, and
         * Decaid's source says that look runs; on the pinned stack it didn't
         * clear, and why was not found. A step to a third profile after a
         * restart, at the next re-record, would settle what DYE2 notes; no page
         * test changes the profile after a restart.
         */
        restart() {
            baseline = null;
            mirrored = null;
            mirror(decaid.workflow());
        },
        /** Once a Shot is stored DYE2 works out its recents again, and pushes. */
        shotStored: () => announce({ what: 'workflow' }),
        /** Answers a request to one of DYE2's routes, or null for one it has no answer to. */
        answer(method, endpoint, body) {
            if (endpoint === 'skin' && method === 'GET') return { status: 200, body: { version: 1, surfaces: [], live: { endpoint: 'changed' } } };
            if (endpoint === 'selection') {
                if (method !== 'GET') {
                    const id = isObject(body) && body.kind === 'recipe' && body.id != null ? String(body.id) : null;
                    decaid.putWorkflow({ context: { extras: { dye: { recipeId: id } } } });
                }
                return { status: 200, body: copy(derive(decaid.workflow())) };
            }
            if (endpoint === 'save-recipe' && method === 'POST') return saveRecipe(body);
            return null;
        },
    };
}
