// Whether Streamline Cafe may start, and what the "DYE2 is needed" screen says
// when it may not (docs/cafe/DESIGN.md, "Recipes and the strip").
//
// The page shows recipes and nothing in their place, so it starts only when the
// DYE2 plugin is installed, loaded and new enough, and Streamline's shared
// "DYE2 on" setting is on. No browser global is touched here: the caller reads
// Decaid's plugin list and the setting and passes them in.
import { compareVersions } from '../modules/skin-version.js';

export const DYE2_PLUGIN_ID = 'dye2.reaplugin';
// The first DYE2 that keeps a recipe's slot above 5 as written and answers the
// selection route the page reads the loaded recipe from.
export const MIN_DYE2_VERSION = '0.1.40';

/**
 * The first failing check, in the order the screen names them: installed,
 * loaded, new enough, switched on. null when the page may start.
 *
 * `plugins` is Decaid's plugin list, or anything that is not an array when the
 * list could not be read. Nothing is then known to be missing, so the plugin
 * checks are skipped and only the setting decides.
 */
export function dye2Gate({ plugins, enabled }) {
    if (Array.isArray(plugins)) {
        const plugin = plugins.find(p => p && p.id === DYE2_PLUGIN_ID);
        if (!plugin) return 'not-installed';
        if (!plugin.loaded) return 'not-loaded';
        if (compareVersions(plugin.version, MIN_DYE2_VERSION) < 0) return 'outdated';
    }
    return enabled ? null : 'setting-off';
}

// The screen's one line per reason. English is the translation key.
const LINES = {
    'not-installed': "DYE2 isn't installed",
    'not-loaded': 'DYE2 is installed but not loaded',
    'outdated': 'DYE2 is older than v{version}',
    'setting-off': 'DYE2 is turned off in Settings',
};

/** Every reason `dye2Gate` can give. */
export const GATE_REASONS = Object.keys(LINES);

/**
 * What the screen shows for a reason: its line, with what fills the line's
 * `{version}`, and which of the two ways out it offers. The setting is the skin's to turn on. The plugin is not: installing
 * one from a skin needs a management token, so the screen points to Decaid.
 */
export function gateScreen(reason) {
    const turnOn = reason === 'setting-off';
    return {
        line: LINES[reason],
        vars: { version: MIN_DYE2_VERSION },
        turnOn,
        hint: turnOn ? null : 'Install or update DYE2 in Decaid, under Plugins.',
    };
}
