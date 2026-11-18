// A recipe load keeps the barista at the machine (docs/cafe/DESIGN.md, "The
// barista"): the fork's hook in Streamline's applyRecipe leaves the name out of
// the write, whatever the recipe's record holds. All sample data is made up.
//
// dyeStrip.js touches the DOM at load, so applyRecipe is lifted out of its
// source with the two paths that build its patch, and run with the rest
// injected, as test/dye2-plugin-source.test.mjs runs its functions. Everything
// between the recipe and the write is Streamline's own code, so a change there
// that sends a name or a clear again fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { clearInheritedFields, assertDeclaredFields } from '../src/modules/workflow-fields.js';
import { recipeIdPatch, dropDeletedGrinder, profileFingerprint, profilePatchWithSteps } from '../src/modules/dye-selection.js';

const source = readFileSync(new URL('../src/modules/dyeStrip.js', import.meta.url), 'utf8');
const lift = pattern => {
    const match = source.match(pattern);
    assert.ok(match, `dyeStrip.js: no match for ${pattern}`);
    return match[0].replace('export ', '');
};

const BODY = [
    lift(/function mergeContext\(patch, fragment\) \{[\s\S]*?\r?\n\}/),
    lift(/async function applyStoredWorkflow\(workflow\) \{[\s\S]*?\r?\n\}/),
    lift(/async function applyRecipeLegacy\(recipe\) \{[\s\S]*?\r?\n\}/),
    lift(/export async function applyRecipe\(recipe\) \{[\s\S]*?\r?\n\}/),
].join('\n');

const PROFILE = { title: 'Sample Profile', steps: [{ name: 'pour', temperature: 93 }] };

function build() {
    const writes = [];
    const deps = {
        getWorkflow: async () => ({ context: { baristaName: 'Ana' }, profile: PROFILE }),
        clearInheritedFields,
        dropDeletedGrinder,
        grinderCatalogue: async () => null,
        mergeRecipeLiveSettings: async () => ({}),
        recipeIdPatch,
        withAutoSaveSuppressed: fn => fn(),
        updateWorkflow: async (patch, writer) => { writes.push({ patch: structuredClone(patch), writer }); return {}; },
        armSelection: async () => true,
        profileFingerprint,
        refreshAfterApply: async () => {},
        profilePatchWithSteps,
        resolveFullProfile: async () => PROFILE,
    };
    const applyRecipe = new Function(...Object.keys(deps),
        `let applySeq = 0; let dye2Armed = false; let activeItem = null;\n${BODY}\nreturn applyRecipe;`)(...Object.values(deps));
    return { applyRecipe, writes };
}

// A recipe's record, as DYE2 stores one with a saved Workflow, and as an older
// one with dashboard numbers only.
const stored = context => ({ id: 'r-1', name: 'Sample House', workflow: { context: { targetDoseWeight: 18, targetYield: 36, ...context }, profile: { title: 'Sample Profile' } } });
const legacy = fields => ({ id: 'r-2', name: 'Sample Legacy', dashboardVariables: { dose: 18, drink: 36 }, ...fields });

const RECORDS = {
    'a stored record naming a barista': stored({ baristaName: 'Bo' }),
    'a stored record with a blank barista, as Decent Sync writes every one': stored({ baristaName: '' }),
    'a stored record with a cleared barista, as DYE2 writes one': stored({ baristaName: null }),
    'a stored record with no barista': stored({}),
    'a stored record with no context at all': { id: 'r-3', workflow: { profile: { title: 'Sample Profile' } } },
    'an older record naming a barista': legacy({ barista: 'Bo' }),
    'an older record with no barista': legacy({}),
};

for (const [what, recipe] of Object.entries(RECORDS)) {
    test(`a recipe load sends neither another name nor a clear: ${what}`, async () => {
        const { applyRecipe, writes } = build();
        await applyRecipe(recipe);
        assert.equal(writes.length, 1, 'one write');
        const [{ patch, writer }] = writes;
        assert.equal(writer, 'dye.applyRecipe');
        assert.ok(!('baristaName' in (patch.context || {})), `the write leaves the Workflow's barista as it was: ${JSON.stringify(patch.context)}`);
        assert.equal(assertDeclaredFields('dye.applyRecipe', patch), true);
    });
}

test('the load still clears what the recipe does not name, the drinker among them', async () => {
    // The hook takes the barista out of Streamline's #189 clear and nothing else.
    const { applyRecipe, writes } = build();
    await applyRecipe(stored({ drinkerName: '' }));
    const { context } = writes[0].patch;
    assert.equal(context.drinkerName, null);
    assert.equal(context.grinderId, null);
    assert.equal(context.extras.basketId, null);
    assert.equal(context.targetDoseWeight, 18);
    assert.equal(context.extras.dye.recipeId, 'r-1', 'and the recipe is the one loaded');
});

test('the hook is in applyRecipe, after the patch is whole and before its write', () => {
    const body = lift(/export async function applyRecipe\(recipe\) \{[\s\S]*?\r?\n\}/);
    const hook = body.indexOf('delete patch.context.baristaName;');
    assert.ok(hook > body.indexOf('mergeContext(patch, recipeIdPatch(recipe.id));'), 'after the last line that adds to the context');
    assert.ok(hook < body.indexOf("updateWorkflow(patch, 'dye.applyRecipe')"), 'before the write');
    assert.doesNotMatch(lift(/export async function applyFavourite\([\s\S]*?\r?\n\}/), /baristaName/,
        'a favourite is Streamline\'s own, and the page never applies one');
});
