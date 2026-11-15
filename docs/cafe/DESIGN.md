# Streamline Cafe: design

Streamline Cafe is a recipe-first skin for [Decaid](https://github.com/decentespresso/decaid), made for cafes. It is a fork of [Streamline](https://github.com/decentespresso/streamline-js) that replaces Streamline's main page and keeps everything else.

This file records what was decided and why. The code is the authority on how it works today. The fork's changes to Streamline's own files are listed in `UPSTREAM_EDITS.md`, which the first change that makes one adds beside this file.

Words such as Recipe, Recipe Slot, Reference Shot, Shot, Location, Machine, Workflow and Capture-only are used as [Decent Sync's glossary](https://github.com/loganfuller/decent-sync/blob/main/GLOSSARY.md) defines them.

## Who it is for

- Any cafe running Decent machines on Decaid. The repo carries no cafe's name, branding or data: sample data in docs, tests and the public preview is made up.
- **DYE2 is required.** The skin shows recipes and nothing else in their place, so without DYE2 it shows a "DYE2 is needed" screen (see [Recipes and the strip](#recipes-and-the-strip)).
- **Decent Sync is optional.** With it, the skin shows the Location's Shots and each Recipe's Reference Shot. Without it, on a Capture-only Machine, or while the server can't be reached, the skin falls back to this machine's own Shots and a reference kept on the tablet.

## What the screen shows

The owner keeps the screen's working design as a mockup, which is not in this repo. This section summarises it and is updated with it.

- **Recipes.** Nine fixed Recipe Slots in one row. An empty slot stays as an outline, so cards never move. A tap loads a recipe. A long-press opens it in DYE2's editor, or on an empty slot creates one there.
- **Dial-in column.** Steppers for dose, yield, grind, brew temperature, flush, steam flow and hot water, each saved onto the loaded recipe. Hot water is one control with Streamline's Temp | Vol toggle.
- **Grinder, bean, basket and profile.** Dose names the bean and batch, Yield the basket, Grind the grinder and Brew the profile. A tap on one opens a dialog listing what the tablet offers.
- **Graph.** Solid: this machine's latest Shot pulled with the loaded recipe. Dashed and faded: the recipe's Reference Shot. A Reference | Targets toggle switches to Streamline's view of the Shot against the profile's targets.
- **Comparison row.** Under the graph: time, first drip, yield, ratio and peak pressure, each beside the reference's. While a shot runs, six live cards take its place.
- **Rating and notes.** Stars and a note for the Shot in the graph.
- **Shots list.** Every Shot at the Location with Decent Sync, otherwise this machine's own. A row opens that Shot in the graph.
- **Gone from Streamline's page.** The P/F/R toggle, the favourite-profile buttons, the DYE button, the shot-history card and the phase table. The on-screen machine buttons show only when the machine has none of its own, as in Streamline.

The skin follows Streamline's design language: `DESIGN_SYSTEM.md`, Tailwind CSS, daisyUI and ECharts.

## Identity

| | |
| --- | --- |
| Repository | `loganfuller/streamline-cafe-js` |
| Skin id | `streamline-cafe.js` |
| Skin id of a `main` build | `streamline-cafe.js-dist` |
| Name | Streamline Cafe |

The id is hard to change once a tablet has the skin. Decaid installs a skin into a folder named for its id, serves each skin on its own port, and stores the default skin by id. A skin installed under an id replaces whatever was installed under it, so the fork must never ship a build that still says `streamline.js`.

Skins with different ids sit side by side, so official Streamline can stay installed beside this one.

## Following Streamline

The fork keeps following Streamline instead of going its own way. Streamline changes often, and most of what changes is how it works with Decaid and DYE2, which this skin needs too.

- **What is adopted.** Tagged Streamline releases only, never unreleased `main`. For use with Decent Sync, a release is adopted once a Decent Sync release follows it, because Decent Sync mirrors what Streamline's recipe apply writes.
- **How.** Each adoption is its own pull request that merges the upstream tag, and it is merged with a merge commit. Squashing it would drop the shared history, and every later merge would then conflict from the start. Other pull requests are squashed.
- **Versions.** The Streamline version plus a counter: `0.2.27-cafe.1`, tagged `v0.2.27-cafe.1`. The counter restarts at 1 with each adopted Streamline release. The version says which Streamline the build contains.
- **Tags.** Streamline's tags are never pushed to this repository: the release workflow runs on every `v*` tag.
- **Nothing is offered upstream.** The fork carries its changes to Streamline's files itself.

## How the code is shaped

Three rules keep merges cheap.

1. **New behaviour goes in new files under `src/cafe/`.** Its logic lives in modules that touch no `window`, `document` or storage at load, tested with `node:test`, as Streamline's own rules require.
2. **`index.html` is the fork's own.** It keeps the element ids Streamline's modules drive. Where a module needs an element the layout drops, the page keeps a hidden stub instead of editing the module.
3. **Streamline's files get only small hooks.** Each hook, and each Streamline test the fork changes, is listed in `UPSTREAM_EDITS.md`, so a merge has a checklist.

Streamline's modules keep running for the work that isn't drawing. Its history module loads a finished Shot into the graph, and its shot-data module feeds the stop notice and the shot timer, so both stay even though their panels are gone.

## Recipes and the strip

- **The skin owns the strip.** Its own module draws the nine cards and handles taps, long-presses, the loaded highlight and slot placement.
- **Loading a recipe stays Streamline's.** The skin loads a recipe only by calling Streamline's `applyRecipe`, and reads which recipe is loaded through Streamline's selection helpers. DYE2 has no endpoint that applies a recipe: Streamline's apply writes the Workflow and tells DYE2 which recipe is loaded. A second implementation would be a second behaviour for Decent Sync to follow.
- **Streamline's strip module still starts,** with nothing to draw into. It keeps telling DYE2 which recipe is loaded, restores the selection after a trip to DYE2's editor, and re-reads DYE2's records when the page regains focus.
- **When the skin starts.** Only when the DYE2 plugin is installed, loaded and at least v0.1.40, and Streamline's shared "DYE2 on" setting is on. Otherwise a blocking screen says which is missing. For the setting it offers a button that turns it on. For the plugin it points to Decaid's Plugins screen, because installing a plugin from a skin needs a management token from Decaid v0.9.2.
- **Nine slots.** DYE2 keeps a `stripSlot` of 6 to 9 as written, though its own editor places recipes only in 1 to 5. The skin places recipes in 6 to 9 itself.
- **Empty slots.** A long-press creates a recipe in DYE2's editor. The skin remembers the held slot and the recipe ids that exist, and on its next load places the one new recipe in that slot if the slot is still empty. With none or several new recipes it places nothing. There is no "choose an existing recipe" option yet; this may change.

## Writing DYE2's records

DYE2 has no endpoint for a slot above 5, or for saving a grinder, bean, batch or profile onto an existing recipe. Its `record` endpoint saves only the dial-in numbers, and `save-recipe` always creates a new recipe. DYE2's contract asks skins not to write its records, but Streamline and Decent Sync's plugin both do.

One module in the fork is the only writer. Each write:

- reads the records again first;
- changes only the named fields of one row, and keeps every field it doesn't know;
- writes, reads again to confirm, and retries once.

Decaid's store has no conditional write, and DYE2 reads, waits and writes the whole list, sometimes over several seconds. A write that lands inside that window is lost, which is why each one is confirmed.

## Settings

- **The same settings as Streamline.** The skin uses Streamline's namespaces in Decaid's store, so a tablet can switch between the two skins and keep its preferences.
- **The settings page is Streamline's,** unchanged. Settings that only matter to Streamline's page stay visible there.
- **The skin never writes Streamline's strip mode** (P/F/R), so switching back to Streamline finds it as it was left.
- **Cafe-only state** goes in a `streamlineCafe` namespace. There is no "Cafe" settings category until a setting needs one.
- **Settings kept only in the browser don't carry over,** because each skin id is served from its own origin: the remembered scale, the cached theme, the auto-steam session and screensaver images. They are set once more in this skin. There is no migration.

## Shots and the reference

One seam with two sources, chosen by what Decent Sync's plugin answers to a status request.

- **With Decent Sync.** The plugin's endpoints for the Shots list, a Shot, the Reference Shot, and rating and note edits. The contract is "For a Skin's author" in Decent Sync's [`docs/PLUGIN.md`](https://github.com/loganfuller/decent-sync/blob/main/docs/PLUGIN.md). The skin keeps no cache of its own: the list is read when it opens, and the copy of a reference used while the server can't be reached is the plugin's. The plugin keeps that copy, and pushes a changed reference, only for a Recipe in a slot.
- **Without it, or when it refuses.** Decaid's own Shots. The choice of reference is kept in the `streamlineCafe` namespace, as recipe to Shot.

Streamline's shot cache can't hold another machine's Shots: it removes any cached row that Decaid's own list doesn't return. A reference chosen on the tablet alone is not carried into Decent Sync if the plugin is installed later.

## Changing the profile from the dialog

This is the riskiest behaviour in the design, so it is built last and behind a trial.

Streamline unloads the recipe on every profile switch, and DYE2 unloads a recipe whose Workflow moves to a profile its record doesn't hold. To keep the recipe loaded, the skin writes the new profile into the recipe's DYE2 record first, then writes the Workflow, without going through any of Streamline's profile-switch paths.

- **The trial.** On headless Decaid, prove the recipe stays loaded after the change.
- **If it fails.** The dialog shows the profile's description only, and the profile is changed in DYE2's editor.
- **With Decent Sync.** The change is an edit to the Recipe's Profile, so it reaches every Machine at the Location with that Recipe loaded, as the rest of the dial-in does.

## Translations

The screen's new text covers the languages Streamline supports.

- New strings live in the fork's own table, with Streamline's language codes. A lookup tries that table, then Streamline's translation file, then English. Streamline's file is not edited: it is overwritten from a spreadsheet upstream.
- Where Streamline already has the same English text, its translation is used.
- New phrases are machine-translated and marked so. Corrections are welcome as pull requests.
- A test fails when a string lacks any of Streamline's finished languages. Languages Streamline marks unfinished fall back to English where a phrase is missing.

## Tests

- Streamline's convention, in CI on every pull request: pure modules under `node:test`.
- Before each release, a Playwright smoke run by hand against headless Decaid with a simulated machine, with screenshots on the pull request. It is not in CI yet.

## Builds and installs

- **Release.** A zip per tag. Installing one release's zip by URL pins a tablet to it.
- **`dist`.** A build of every push to `main`, under the id `streamline-cafe.js-dist`. A tablet that installs the `dist` branch follows every push.
- **GitHub Pages.** The built skin from `main`, and a public preview with sample data that needs no Decaid (slice 8).

At a Location on Decent Sync, the skin needs Decaid v0.9.2 or later, DYE2 v0.1.40 or later, and a Decent Sync release that follows the Streamline version the skin is built on.

## Order of work

Each slice is released on its own, and starts by settling its own open points.

1. Identity and release pipeline: the new id, name and builds, with Streamline's screen unchanged.
2. The layout: the nine-slot strip, the dial-in column, the Targets graph, no footer.
3. The reference: overlay, legend, comparison row, live cards, Make reference.
4. Rating and notes.
5. The Shots list.
6. The grinder, bean and batch, and basket dialogs.
7. The profile dialog, after its trial.
8. The public preview with sample data.

Open points known when this was written:

- whether the graph's time axis stretches to the reference's length during a live shot (slice 3);
- how first drip is worked out for the comparison row (slice 3);
- how the skin decides a Shot is Unfinished without Decent Sync (slices 3 and 5);
- what the screen shows in languages that read right to left (slice 2);
- what the sample data and its pretend machine do in the public preview (slice 8).
