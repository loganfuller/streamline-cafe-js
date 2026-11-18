// The profile dialog: a tap on the Brew row's name lists the profiles Decaid
// shows, describes the one highlighted, and "Use this profile" changes the
// profile with the recipe kept loaded (docs/cafe/DESIGN.md, "The profile
// dialog"). What a row and a description say, and which profile is in use,
// are profile-model.js's. This module reads what they need and shows the list
// (pick-dialog.js); the change itself is `changeProfile`'s (profile-changer.js),
// which writes the recipe's DYE2 record and then the Workflow, each in its turn
// among the dial-in's other writes. It writes nothing itself.
import { getProfiles, getWorkflow } from '../modules/api.js';
import { showToast } from '../modules/ui.js';
import { getTranslation } from '../modules/i18n.js';
import { getTempUnit } from '../modules/units.js';
import { logger } from '../modules/logger.js';
import { PROFILE_PHRASES, listedProfiles, wholeProfiles, profileView, profileSubtitle } from './profile-model.js';
import { changeProfile } from './profile-changer.js';
import { choose } from './pick-dialog.js';
import { cafeText } from './text.js';

let opening = false;

// The profiles Decaid shows, and every whole one it holds, hidden ones too.
// Rejects where the list can't be read.
async function readProfiles() {
    const all = await getProfiles();
    const records = listedProfiles(all);
    if (!records) throw new Error('Decaid did not answer a list of profiles');
    return { records, known: wholeProfiles(all) };
}

/**
 * Open the profile dialog, and change the profile to the one chosen.
 *
 * - `mayOpen()`: may it open now? Not while a shot runs, a recipe loads, the
 *   strip is arranged, or another choice is still being written.
 * - `epoch()`: changes whenever a recipe load begins or ends. What was read
 *   before a change describes the recipe before, so the dialog is not opened.
 * - `recipe()`: the loaded recipe's DYE2 record, or null with none loaded.
 */
export async function openProfileDialog({ mayOpen, epoch, recipe }) {
    if (opening || !mayOpen()) return;
    opening = true;
    const at = epoch();
    try {
        let profiles;
        let workflow;
        try {
            [profiles, workflow] = await Promise.all([readProfiles(), getWorkflow()]);
        } catch (error) {
            // A list that can't be read is not an empty list.
            logger.warn('Cafe: could not read the profiles', error);
            showToast(cafeText('Could not read the profiles'), 4000, 'error');
            return;
        }
        // A shot may have started, or a recipe loaded, while they were read: the
        // profile in use read then may no longer be.
        if (!mayOpen() || epoch() !== at) return;
        const loaded = recipe();
        const view = profileView({
            records: profiles.records,
            known: profiles.known,
            workflowProfile: workflow?.profile,
            preferId: loaded?.profileId ?? null,
            unit: getTempUnit(),
            t: cafeText,
            titleOf: getTranslation,
        });
        const row = await choose({
            title: PROFILE_PHRASES.title,
            subtitle: profileSubtitle(loaded),
            label: cafeText('Profiles'),
            side: {
                heading: PROFILE_PHRASES.heading,
                rows: view.rows,
                empty: PROFILE_PHRASES.empty,
                show: tapped => ({ pane: view.pane(tapped) }),
            },
            pane: { heading: PROFILE_PHRASES.description, shown: view.opening },
        });
        if (!row || row.inUse) return; // closed, or the profile in use: nothing to change
        // The change waits its turn behind a dial-in change still on its way,
        // and is not made where a shot or a recipe load has begun since, or
        // where DYE2 has another recipe loaded than the line under the title
        // named (one loaded elsewhere while the dialog was open).
        const named = loaded ? String(loaded.id) : null;
        const result = await changeProfile(row.id, { recipeId: named });
        if (!result.ok) {
            logger.warn(`Cafe: could not change the profile to ${row.id}: ${result.reason}`);
            showToast(cafeText('Could not change the profile'), 4000, 'error');
        }
    } finally {
        opening = false;
    }
}
