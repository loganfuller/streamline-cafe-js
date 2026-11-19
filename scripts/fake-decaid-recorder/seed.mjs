// The made-up sample data, written into the real Decaid the way the smoke run
// writes it (test/cafe-smoke/run.mjs), so DYE2's records have the shape DYE2
// writes. The recorder then reads the state back as the page tests' starting
// point (fake-decaid/recordings/sample-data.json).

import { BEANS, GRINDER, SECOND_GRINDER, ARCHIVED_GRINDER, PRESET_GRINDER, QUARTER_GRINDER, GRINDER_USE, RECIPES, MORE_BATCHES, BASKETS } from '../../test/cafe-smoke/sample-data.mjs';

const DYE2 = 'dye2.reaplugin';

/**
 * @param {(method: string, path: string, body?: unknown, options?: { manage?: boolean }) => Promise<any>} decaid
 * @param {{ pullShot: (workflowContext: object) => Promise<object> }} machine
 */
export async function seed(decaid, machine) {
    await decaid('POST', '/store/streamlineSettings/streamline.dye2Enabled', 'true');
    const profiles = await decaid('GET', '/profiles');
    const batches = {};
    for (const bean of BEANS) {
        const made = await decaid('POST', '/beans', { roaster: bean.roaster, name: bean.name });
        const batch = await decaid('POST', `/beans/${made.id}/batches`, { roastDate: bean.roastDate });
        batches[bean.name] = { id: batch.id, beanId: made.id, roaster: bean.roaster };
    }
    for (const extra of MORE_BATCHES) {
        const made = await decaid('POST', `/beans/${batches[extra.bean].beanId}/batches`, { roastDate: extra.roastDate });
        if (extra.archived) await decaid('PUT', `/bean-batches/${made.id}`, { ...made, archived: true });
    }
    await decaid('POST', `/store/${DYE2}/baskets`, BASKETS);
    const grinder = await decaid('POST', '/grinders', GRINDER);
    const second = await decaid('POST', '/grinders', SECOND_GRINDER);
    const retired = await decaid('POST', '/grinders', ARCHIVED_GRINDER);
    await decaid('PUT', `/grinders/${retired.id}`, { ...retired, archived: true });
    // The Grind row's two (#42), archived, as the smoke run left them: a page
    // test that needs one takes it out of the archive in the fake.
    for (const spec of [PRESET_GRINDER, QUARTER_GRINDER]) {
        const made = await decaid('POST', '/grinders', spec);
        await decaid('PUT', `/grinders/${made.id}`, { ...made, archived: true });
    }

    const ids = {};
    const basketNamed = name => BASKETS.find(basket => basket.name === name);
    for (const recipe of RECIPES) {
        const profile = profiles.find(p => p.profile?.title === recipe.profile)?.profile;
        if (!profile) throw new Error(`Decaid has no profile titled "${recipe.profile}"`);
        await decaid('PUT', '/workflow', {
            profile,
            context: {
                targetDoseWeight: recipe.dose, targetYield: recipe.yield,
                coffeeName: recipe.bean, coffeeRoaster: batches[recipe.bean].roaster, beanBatchId: batches[recipe.bean].id,
                grinderId: grinder.id, grinderModel: grinder.model, grinderSetting: recipe.grind,
                extras: { basketId: basketNamed(recipe.basket)?.id || null, basketName: recipe.basket || null },
            },
        });
        const saved = await decaid('POST', `/plugins/${DYE2}/save-recipe`, recipe.slot <= 5 ? { slot: recipe.slot } : {});
        ids[saved.id] = recipe;
    }
    // The names, and the slots above 5, which DYE2's own pages cannot set: the
    // fixture's write, as in the smoke run.
    const rows = await decaid('GET', `/store/${DYE2}/recipes`);
    await decaid('POST', `/store/${DYE2}/recipes`, rows.map(row => (ids[row.id]
        ? { ...row, name: ids[row.id].name, title: ids[row.id].name, stripSlot: ids[row.id].slot, showOnStreamlineDashboard: true }
        : row)));

    // No recipe loaded, then a shot on each of the two grinders at a setting of
    // its own, which the grinder dialog says each was last used at. On the
    // Default profile at 36 g, which the simulated machine stops on weight after
    // a few seconds (on Adaptive v3 it pours too slowly ever to reach it).
    await decaid('POST', `/plugins/${DYE2}/selection`, {});
    const house = profiles.find(p => p.profile?.title === 'Default').profile;
    for (const [made, use] of [[grinder, GRINDER_USE.first], [second, GRINDER_USE.second]]) {
        await machine.pullShot({
            profile: house,
            context: { targetDoseWeight: 18, targetYield: 36, grinderId: made.id, grinderModel: made.model, grinderSetting: use.setting, extras: { rpm: use.rpm } },
        });
    }
    return { grinder, second, retired, batches };
}
