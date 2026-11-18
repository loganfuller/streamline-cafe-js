// The profile dialog's rows, its description of a profile, which profile is in
// use and the line under its title (docs/cafe/DESIGN.md, "The profile dialog").
// No browser global is touched: the phrases go through `t`, a profile's title
// through `titleOf` (Streamline's own translation of it, as the name under
// Brew is written), and Decaid's list, the Workflow's profile and the
// temperature unit are handed in.
//
// The list is every profile Decaid shows as visible, of any beverage type,
// sorted by title, with no families, groups or search. On a Machine Decent
// Sync serves those are the Profiles its Location shows. A choice is made
// through `changeProfile` (profile-changer.js), never here.
import { profileFingerprint } from '../modules/dye-selection.js';
import { celsiusToFahrenheit } from '../modules/units.js';
import { ownBrewC } from './profile-change.js';
import { pickSubtitle } from './page-model.js';

/** The phrases the dialog may say, for the translations test. */
export const PROFILE_PHRASES = {
    title: 'Profile',
    heading: 'Profiles',
    description: 'Description',
    empty: 'No profiles',
    by: 'By {author}',
    byAndBrews: 'By {author} · brews at {temp}',
    brews: 'Brews at {temp}',
    none: 'This profile has no description.',
    use: 'Use this profile',
    sets: 'Sets Brew to {temp}',
    untitled: 'Untitled',
};

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const text = value => (typeof value === 'string' ? value.trim() : '');

// Decaid's record of a profile is shown unless it is hidden or deleted: an
// older record with no visibility at all is shown.
const shown = record => record.visibility == null || record.visibility === 'visible';

/**
 * The profiles the dialog lists, from Decaid's list as `getProfiles` reads it
 * (hidden and deleted ones included): those Decaid shows, each a whole
 * profile with steps, since only such a profile can be chosen. Streamline's
 * local drafts are never in Decaid's list. Null where the list could not be
 * read, which is not an empty list.
 */
export function listedProfiles(records) {
    if (!Array.isArray(records)) return null;
    return records.filter(record => isObject(record) && record.id != null && isObject(record.profile)
        && Array.isArray(record.profile.steps) && record.profile.steps.length > 0 && shown(record));
}

/**
 * A temperature in Celsius, written as the Brew row writes it in the unit it
 * uses (Streamline's `formatTemp(celsius, 0)`): "93°c", or "199°F" where `unit`
 * is 'F'. Empty where there is none.
 */
export function brewTemp(celsius, unit) {
    if (typeof celsius !== 'number' || !Number.isFinite(celsius)) return '';
    return unit === 'F' ? `${celsiusToFahrenheit(celsius).toFixed(0)}°F` : `${celsius.toFixed(0)}°c`;
}

const stepTemps = profile => JSON.stringify((Array.isArray(profile?.steps) ? profile.steps : []).map(s => s?.temperature ?? null));

/**
 * The listed record that is the profile in use: the one that matches the
 * Workflow's profile as DYE2 compares two profiles (its title, its tank
 * temperature and its steps, each step's temperature left out), so a profile
 * whose temperature was stepped is still the one in use. Where several match
 * (as two of one title that differ only in temperature do): the one
 * `preferId` names (the loaded recipe's profile), else the one at the
 * Workflow's own step temperatures (the first, where those are twins, any of
 * which is the same choice). Null where none matches, as for a profile hidden
 * or edited since, and where which one is in use can't be told, so that none
 * is marked in use and each can be chosen.
 */
export function profileInUse(records, workflowProfile, preferId = null) {
    const fp = profileFingerprint(isObject(workflowProfile) ? workflowProfile : null);
    if (!fp) return null;
    const matches = (records || []).filter(record => profileFingerprint(record.profile) === fp);
    if (matches.length < 2) return matches[0] || null;
    const preferred = matches.find(record => preferId != null && String(record.id) === String(preferId));
    if (preferred) return preferred;
    return matches.find(record => stepTemps(record.profile) === stepTemps(workflowProfile)) || null;
}

const sortName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/**
 * What the dialog shows, from the listed records (`listedProfiles`), the
 * Workflow's profile, the loaded recipe's profile id where one is loaded
 * (`preferId`, which breaks a tie between two profiles that compare the same),
 * the temperature `unit` ('C' or 'F'), `t` and `titleOf`.
 *
 * Answers:
 * - `rows`, sorted by title: `{ id, name, detail, inUse, highlighted, record }`,
 *   each the profile's title over "By" and its author, then its own brew
 *   temperature, the one in use marked and highlighted;
 * - `opening`, the description the dialog opens on: the profile in use's, or,
 *   where it is not listed, one read from the Workflow with no row
 *   highlighted; where the Workflow has no profile, the first row's,
 *   highlighted; and null where there is no row either;
 * - `pane(row)`, a row's description once it is tapped.
 *
 * A description is `{ title, byline, text, placeholder, inUse, use }`: the
 * title, "By" and the author with "brews at" and the temperature, the notes as
 * plain text with their line breaks ("This profile has no description." where
 * there are none, with `placeholder`), and `use`, the button that chooses it
 * with "Sets Brew to" and the temperature beside it, or null on the profile in
 * use, which reads "In use".
 */
export function profileView({ records, workflowProfile, preferId = null, unit = 'C', t, titleOf = title => title }) {
    const name = profile => {
        const title = text(profile?.title);
        return title ? titleOf(title) : t(PROFILE_PHRASES.untitled);
    };
    const temp = profile => brewTemp(ownBrewC(profile), unit);
    const describe = (profile, inUse) => {
        const author = text(profile?.author);
        const degrees = temp(profile);
        let byline = '';
        if (author && degrees) byline = t(PROFILE_PHRASES.byAndBrews, { author, temp: degrees });
        else if (author) byline = t(PROFILE_PHRASES.by, { author });
        else if (degrees) byline = t(PROFILE_PHRASES.brews, { temp: degrees });
        const notes = typeof profile?.notes === 'string' ? profile.notes.replace(/\r\n?/g, '\n').trim() : '';
        return {
            title: name(profile),
            byline,
            text: notes || t(PROFILE_PHRASES.none),
            placeholder: !notes,
            inUse,
            use: inUse ? null : { label: t(PROFILE_PHRASES.use), note: degrees ? t(PROFILE_PHRASES.sets, { temp: degrees }) : '' },
        };
    };
    const using = profileInUse(records, workflowProfile, preferId);
    const rows = (records || []).map(record => {
        const author = text(record.profile.author);
        return {
            id: String(record.id),
            record,
            name: name(record.profile),
            detail: [author ? t(PROFILE_PHRASES.by, { author }) : '', temp(record.profile)].filter(Boolean).join(' · '),
            inUse: record === using,
            highlighted: record === using,
        };
    }).sort(sortName);
    let opening;
    if (using) opening = describe(using.profile, true);
    else if (isObject(workflowProfile)) opening = describe(workflowProfile, true);
    else if (rows.length) {
        rows[0].highlighted = true;
        opening = describe(rows[0].record.profile, false);
    } else {
        opening = null; // no profile listed and none in the Workflow: nothing to describe
    }
    return { rows, opening, pane: row => describe(row.record.profile, row.inUse) };
}

/**
 * The line under the dialog's title. The profile is the one choice the skin
 * saves onto the loaded recipe itself, on every tablet, with Decent Sync or
 * without, and through an outage too: with a recipe loaded it reads the
 * recipe's name, then "saved to the recipe"; with none, that it changes this
 * machine only.
 */
export function profileSubtitle(recipe) {
    return pickSubtitle(recipe, true);
}
