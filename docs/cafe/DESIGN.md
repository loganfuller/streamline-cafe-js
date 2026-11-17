# Streamline Cafe: design

Streamline Cafe is a recipe-first skin for [Decaid](https://github.com/decentespresso/decaid), made for cafes. It is a fork of [Streamline](https://github.com/decentespresso/streamline-js) that replaces Streamline's main page and keeps everything else.

**Status: in development.** The skin is not meant for a working cafe until its screen matches the design in full. Until then its builds are for development.

This file records what was decided and why. The code is the authority on how it works today. The fork's changes to Streamline's own files are listed in `UPSTREAM_EDITS.md`, which the first change that makes one adds beside this file.

Words such as Recipe, Recipe Slot, Reference Shot, Shot, Location, Machine, Workflow and Capture-only are used as [Decent Sync's glossary](https://github.com/loganfuller/decent-sync/blob/main/GLOSSARY.md) defines them.

## Who it is for

- Any cafe running Decent machines on Decaid. The repo carries no cafe's name, branding or data: sample data in docs, tests and the public preview is made up.
- **DYE2 is required.** The skin shows recipes and nothing else in their place, so without DYE2 it shows a "DYE2 is needed" screen (see [Recipes and the strip](#recipes-and-the-strip)).
- **Decent Sync is optional.** With it, the skin shows the Location's Shots and each Recipe's Reference Shot, and a dial-in change is saved onto the loaded Recipe. Without it, on a Capture-only Machine, or while the server can't be reached, the skin falls back to this machine's own Shots. Without it or on a Capture-only Machine, the reference is one kept on the tablet, and a dial-in change is this machine's alone. While the server can't be reached, a Machine it serves draws the copy of the Reference Shot that Decent Sync's plugin keeps on the tablet.

## What the screen shows

The owner keeps the screen's working design as a mockup, which is not in this repo. This section summarises it and is updated with it.

- **Recipes.** Nine fixed Recipe Slots in one row. An empty slot stays as an outline reading "Slot N" and "Hold to add", so cards never move. A tap loads a recipe. A long-press opens a menu on the card: make a new recipe from what the machine is set to, choose a recipe that is in no slot, or take the card's recipe out of its slot. Nothing on the page opens DYE2's editor.
- **Dial-in column.** Steppers for dose, yield, grind, brew temperature, flush, steam flow and hot water, all with the same type and the same size buttons. Hot water is one control with Streamline's Temp | Vol toggle. With Decent Sync a change is saved onto the loaded recipe, and the column is labelled "Dial-in · saved to the recipe". Without it the change is this machine's alone, until another recipe loads, and the label reads "Dial-in · not saved to the recipe".
- **Grinder, bean, basket and profile.** Dose names the bean and batch, Yield the basket, Grind the grinder and Brew the profile. A tap on one opens a dialog listing what the tablet offers.
- **Graph.** At full strength: this machine's latest Shot pulled with the loaded recipe. Faded: the recipe's Reference Shot. Both are solid lines; the dotted lines are the profile's targets. A Reference | Targets toggle switches to Streamline's view of the Shot against the profile's targets. The legend says when each Shot was pulled and by whom, and ends the latest Shot's row with Make reference. Each profile stage the Shot reached is named at its line.
- **Comparison row.** Under the graph, five cards. In Reference: time, first drip, yield, ratio and peak pressure, each beside the reference's with the difference. In Targets: time with first drip, then dose, yield and ratio against what was set, and peak pressure alone. While a shot runs, six live cards take its place: time, weight, weight flow, water flow, pressure and temperature, beside the reference at the same second or beside what the profile asks for.
- **Rating and notes.** Stars and a note for the Shot in the graph.
- **Shots list.** Every Shot at the Location with Decent Sync, otherwise this machine's own. A row opens that Shot in the graph.
- **No recipe loaded.** The title reads "No recipe selected", the dial-in column says it is not saved to a recipe, and the steppers change this machine only.
- **Gone from Streamline's page.** The P/F/R toggle, the favourite-profile buttons, the DYE button, the shot-history card, the phase table, every row of preset buttons, the steam time and the milk-pitcher steam mode. The settings that configure them stay in the settings page and do nothing here.
- **Kept from Streamline.** A tap on a value opens the numpad, a tap on the graph opens the full-screen chart, and the screensaver and the "tap to reload" notice work as they do there. The on-screen machine buttons show only when the machine has none of its own. Flush, Steam flow and Hot water open their settings page from their label.
- **Until a slice arrives, its part of the screen is left out.** Nothing on the page is a control that does nothing.

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

Streamline's modules keep running for the work that isn't drawing. Its shot-data module feeds the stop notice and the shot timer, and its history module still reads the tablet's Shots, so both stay even though their panels are gone. With a recipe loaded, which finished Shot the graph draws is the page's choice; with none, the history module draws (see [Shots and the reference](#shots-and-the-reference)).

## Recipes and the strip

- **The skin owns the strip.** Its own module draws the nine cards and handles taps, long-presses, the loaded highlight and slot placement.
- **Loading a recipe stays Streamline's.** The skin loads a recipe only by calling Streamline's `applyRecipe`, and reads which recipe is loaded through Streamline's selection helpers. DYE2 has no endpoint that applies a recipe: Streamline's apply writes the Workflow and tells DYE2 which recipe is loaded. A second implementation would be a second behaviour for Decent Sync to follow.
- **Streamline's strip module still starts,** with nothing to draw into. It keeps telling DYE2 which recipe is loaded, restores the selection after a trip to DYE2's editor, and re-reads DYE2's records when the page regains focus.
- **When the skin starts.** Only when the DYE2 plugin is installed, loaded and at least v0.1.40, and Streamline's shared "DYE2 on" setting is on. Otherwise a blocking screen says which is missing. For the setting it offers a button that turns it on. For the plugin it points to Decaid's Plugins screen, because installing a plugin from a skin needs a management token from Decaid v0.9.2. The screen is a centred card titled "Streamline Cafe needs DYE2", with one line for what is missing, and always a Reload button and a Settings button, so the settings page stays reachable.
- **When Decaid's plugin list can't be read,** nothing is known to be missing, so the screen is not shown for the plugin and only the setting decides. The page then starts as Streamline does against a Decaid it can't reach, and recovers the same way. The check waits five seconds for the list at most.
- **DYE2 switched off while the page runs.** On the way back from the settings page the skin reloads, which lands on the "DYE2 is needed" screen.
- **What the cards and the names follow.** DYE2's records and the Workflow have no push channel. The skin reads them at start-up, after a tap loads a recipe, when the page comes back into view or back from a subpage, when a plugin announces a Workflow change, and when the active profile changes. There is no timer.
- **Saving the dial-in is Decent Sync's.** DYE2 saves a change of the Workflow onto the loaded recipe only when asked: its `record` request, which Streamline sends when a barista picks "Save changes" in its strip's menu, and which Decent Sync's plugin sends after every change on a Machine it serves. The skin has no such menu and sends no such request, so on a tablet without Decent Sync nothing saves a dial-in change, and the page says so. A recipe is changed for good there in DYE2's editor. The skin learns whether Decent Sync saves from the plugin's Status request: a Machine it serves, yes; a Capture-only Machine, or no plugin, no; and while the server can't be asked, the last answer stands, because the plugin goes on saving on the tablet through an outage. The skin asks at start-up, when the page comes back into view, after each recipe load, and when the plugin says its connection to the server came or went (see [The reference with Decent Sync](#the-reference-with-decent-sync)); and while no answer has come either way, as when the skin loads before the plugin has connected, it asks again every half minute, slowing to every five.
- **Before another recipe loads,** a change still on its way is written first, so it does not land on the recipe about to load, and the recipe tapped is read again from DYE2's records, so what loads is what DYE2 holds, not what the card showed when it was drawn. Loads run one at a time, in the order tapped. A load whose earlier change has not reached the machine after a few seconds is not made, and says so. While a recipe loads the dial-in rows take no taps: a step made then could be written before or after the load.
- **Nine slots.** DYE2 keeps a `stripSlot` of 6 to 9 as written, though its own editor places recipes only in 1 to 5. The skin places recipes in 6 to 9 itself.
- **A long-press arranges the strip, and never leaves the page.** One purpose of the skin is that a barista does not need DYE2's editor. A long-press opens Streamline's own menu on the card, and loads nothing.
  - An empty slot offers "New recipe from current settings" and "Choose a recipe…".
  - A filled card offers "Replace with a new recipe", "Replace with another recipe…" and "Remove from slot". Nothing asks "are you sure": the recipe replaced or removed is not lost, and can be chosen again.
- **A new recipe is made by DYE2,** with its `save-recipe` request, from the Workflow as it stands: the bean, grinder, basket, profile and every number. DYE2 names it, from the profile and the bean, and marks it as the loaded recipe. The skin then puts it in the slot that was held, for any slot from 1 to 9. A dial-in change still on its way is written first, so it is in the recipe.
- **A recipe is chosen from the recipes in no slot,** read from DYE2's records on the tablet, so the list opens without Decent Sync and while the server can't be reached. With Decent Sync those are the Location's Recipes in no slot. Each row is the recipe's name over its bean and profile, sorted by name. Choosing places the recipe and loads nothing: it loads on a tap. With nothing to choose, the list says so. A recipe in another slot is not listed: it is taken out of that slot first.
- **A recipe that leaves its slot stays in DYE2,** in no slot. If it was the loaded recipe it is unloaded, so a change on the machine is no longer saved onto a recipe with no card, and what the machine is set to does not change: which recipe is loaded is a marker in the Workflow, and only the marker is cleared. The one exception is a new recipe made on the loaded recipe's card, which is itself the loaded recipe afterwards.
- **The menu does not open while a shot runs or a recipe loads.** Making a recipe writes the Workflow. While an action from the menu runs, no card loads and the dial-in rows take no taps, as while a recipe loads.
- **A recipe chosen from the list is placed only if it is still in no slot.** One that another tablet put in a slot while the list was open is left there, and a toast says it could not be placed.
- **Streamline's strip module is told when the page changes which recipe is loaded.** That module keeps its own note of the recipe it last applied, and when its request telling DYE2 fails it retries for about a minute. A new recipe or an unload made on this page inside that minute would be undone by the retry. So before either, the page calls `forgetAppliedItem`, the one hook the fork adds to `dyeStrip.js`, which drops the note and stops the retry.
- **A recipe is taken out of the slot its card showed.** One that another tablet moved while the menu was open is left where it is. The recipe a card showed is unloaded, after another took its slot, only if DYE2's records then show it on no card.
- **Records that can't be read are not an empty list.** A toast says the recipes could not be read, and the list does not open.
- **A slot is written for what the card showed.** If another tablet has put a different recipe in the slot meanwhile, nothing is written, a toast says the recipe could not be placed, and the strip is read again.
- **Renaming and deleting a recipe are not on the page.** With Decent Sync they are done in its management interface. Without it they are done in DYE2, opened from Decaid.

## Writing DYE2's records

DYE2 has no endpoint for a slot above 5, or for saving a grinder, bean, batch or profile onto an existing recipe. Its `record` endpoint saves only the dial-in numbers, and `save-recipe` always creates a new recipe. DYE2's contract asks skins not to write its records, but Streamline and Decent Sync's plugin both do.

One module in the fork is the only writer, `src/cafe/recipe-writer.js`, and a test fails if another module under `src/cafe/` writes them. Each write:

- reads the records again first, and writes nothing when they can't be read;
- changes only the named fields of one row, and keeps every field and every row it doesn't know;
- gives a slot one holder: a recipe placed in a slot takes it from any other row that names it, as DYE2's own save does;
- writes, reads again to confirm, and retries once.

Decaid's store has no conditional write, and DYE2 reads, waits and writes the whole list, sometimes over several seconds. A write that lands inside that window is lost, which is why each one is confirmed. The confirming read follows the write at once, so it catches a write the store refused and a change already written over. A copy DYE2 writes back later than that is not caught.

The writer puts a recipe in a slot and takes one out today. The dialogs for the grinder, bean, basket and profile add their fields through the same module. A new recipe's row is DYE2's own write, made by its `save-recipe` request. The writes Streamline's own strip module makes are Streamline's, and are left as they are.

## Settings

- **The same settings as Streamline.** The skin uses Streamline's namespaces in Decaid's store, so a tablet can switch between the two skins and keep its preferences.
- **The settings page is Streamline's,** unchanged. Settings that only matter to Streamline's page stay visible there.
- **The skin never writes Streamline's strip mode** (P/F/R), so switching back to Streamline finds it as it was left.
- **Cafe-only state** goes in a `streamlineCafe` namespace, written by one module, `src/cafe/cafe-store.js`. It holds the choice of reference (`references`, recipe to Shot) and the graph's view (`graphView`). The choice of reference is read and written only where Decent Sync does not serve the Machine. Decaid's store is the tablet's, not the skin's, so both of the skin's ids read the same values. There is no "Cafe" settings category until a setting needs one.
- **Settings kept only in the browser don't carry over,** because each skin id is served from its own origin: the remembered scale, the cached theme, the auto-steam session and screensaver images. They are set once more in this skin. There is no migration.

## Plugin surfaces

Streamline lets a plugin add things to its page, such as a step size on a stepper or a strip during a shot.

- Surfaces attached to parts the page keeps, the steppers and the screensaver, keep working, because that code is reused.
- Surfaces attached to parts the page drops are left out until a plugin a cafe uses needs one. DYE2 and Decent Sync declare none. A plugin's steam mode is one of them: it attaches to Streamline's steam mode toggle and its steam − and +, and the page has neither, because its steam row is the flow alone.
- A cafe's own additions may come as plugins later, so this may change.

## Shots and the reference

With a recipe loaded, the graph shows this machine's latest Shot pulled with it, and behind it the recipe's Reference Shot.

### The Shot seam

One module, `src/cafe/shot-seam.js`, is asked for three things: a recipe's latest Shot on this machine, a recipe's reference, and to make a Shot a recipe's reference. With no recipe loaded the page asks it nothing. Its answer for a reference says whether it can be changed now. The page reads Shots and the choice no other way, and a test fails if another module does, so which source answers changes no caller. A recipe is named by its DYE2 record id, the one Streamline's apply writes into the Workflow.

- **The latest Shot is always the tablet's own,** read from Decaid's Shots (`src/cafe/tablet-shots.js`), with Decent Sync or without. It is this machine's Shot.
- **The reference has two sources.** Where Decent Sync does not serve the Machine it is a choice kept on the tablet: one of Decaid's Shots, named in the `streamlineCafe` namespace as recipe to Shot. On a Machine Decent Sync serves it is the Recipe's Reference Shot, read and chosen through the plugin (`src/cafe/plugin-shots.js`): see [The reference with Decent Sync](#the-reference-with-decent-sync).
- **Streamline's shot cache is not a source.** It can't hold another machine's Shots: it removes any cached row that Decaid's own list doesn't return.

### The latest Shot

- The newest Shot on this tablet whose Workflow names the loaded recipe. It is always read from Decaid, with Decent Sync or without.
- **It is looked for among the tablet's newest 100 Shots,** one request to Decaid. Past that, the recipe has no Shot on this machine yet. A row of Decaid's list carries its Workflow and no measurements, so the newest match is read whole, and the next one tried if it is Unfinished.
- **An Unfinished Shot never takes its place.** That is a Shot where the machine never reached pouring and the scale never read 1 g: Decent Sync's rule, worked out from the Shot's own record. No sample is in the `pouring` substate, and no sample after the Shot's Preheat, its leading samples in `preparingForShot`, has a weight of 1 g or more. Both are needed, because a shot stopped on weight inside a long preinfusion never reports pouring though it ran whole.
- **When a shot ends** it becomes the latest once Decaid has it, unless it is Unfinished or was pulled with another recipe. Decaid saves a shot a few seconds after the pump stops, so the page looks for it at half a second, then 2, 4, 7, 11 and 15 seconds after the end, and stops at the first look that finds a new latest Shot. Until then the graph keeps the shot's live lines and its row names no time. When nothing had been read for the recipe before the shot started, the first answer read after the end is taken as the Shot before. After the last look the graph goes back to the Shot before it: the shot was Unfinished, pulled with another recipe, or never saved.
- **With a recipe loaded, which Shot is drawn is the page's choice.** Streamline's history module still asks the chart to draw the tablet's newest Shot: at start-up, on the way back from another page, and once a shot has been saved. The page turns that down, through a hook in the chart, and takes it as a cue to read the Shot and the reference again. The page also reads them when a recipe loads, when a shot ends, and when the page comes back into view. Shots have no push channel, and there is no timer but the looks after a shot.
- **With no recipe loaded, the history module draws,** as on Streamline's own page: the tablet's newest Shot, whatever it was pulled with and Unfinished or not, at start-up, on the way back from another page, and once each shot has been saved. The hook lets its request through, and the page reads no Shot itself. While a shot runs it turns every request down, with a recipe or without: the module may still be waiting for the shot before to be saved, and drawing that would reset the running shot's lines. The module counts a request turned down as drawn and does not make it again, so with no recipe the last one turned down is drawn as the shot ends, unless it is the Shot in the graph already: the shot just saved, where the end reached the page late, or the newest saved before it. The Shot is labelled "Last shot", with the line "Pick a recipe to compare". Before DYE2 has said which recipe is loaded the request is let through too, so the graph is not empty meanwhile.
- **The "Last shot" row names the Shot the history module handed the chart.** The hook is handed that Shot's measurements and Workflow, not its record: the barista is the Workflow's, and the time is the first sample's, which Decaid takes within a second of the record's own, so the two read the same to the minute but at a minute's edge. Reading the text the module writes into its hidden stub was the other way, and would mean parsing it.
- **When a recipe is unloaded,** the graph goes back to the Shot the history module last asked to draw. The page keeps each request, turned down or not, so that is the tablet's newest Shot as far as the module knows.
- **When a shot ends with no recipe loaded,** and no request was turned down during it, the graph keeps its live lines and the row names no time until the history module draws the saved Shot. The page makes none of the looks it makes for a recipe. A run Decaid never saves is never drawn, so if nothing has been drawn 15 seconds after the end, the graph goes back to the Shot before, as it does with a recipe.
- **Why the history module can be left to draw.** In Streamline v0.2.27 that module stopped drawing the newest Shot once a shot had ended in the same session: it followed the Shot it was showing by id, so when a new one landed it took the barista to be reading the Shot before. Until the fork adopted v0.2.28, which keeps the newest as the newest, the page read the newest Shot through the seam in its place.

### The reference on the graph

- **The overlay.** The reference's pressure, flow and weight flow, solid and faded in colours of their own, are drawn after Streamline's own seven lines, through a hook in the chart module. It is there at rest and through a live shot, on the main graph and the full-screen chart. A profile preview never carries it.
- **Faded, not dashed.** The ticket had the reference dashed. The owner changed it on the pull request: the profile's targets keep the dotted lines, so it is clear which of the two the Shot is compared with.
- **What keeps a live shot from a full redraw on each frame.** The reference's three lines are always present in the Reference view, empty when there is nothing to draw, and their arrays are the same from one frame to the next, so the count of lines and their order do not change through a shot.
- **The line-end labels** name the Shot's own lines and never the reference's: a label finds its line by colour on the main chart and by name on the full-screen one, and the reference's colours and names are no line's of Streamline's. One case is left: the renderer gives a line with no label of its colour the label that sits on its last point, so a reference that ends at the Shot's own last second and value takes that label. A simulated machine can pull two such Shots, and a real one does not.
- **The time axis.** At rest it fits the longer of the two Shots. During a live shot, in Reference, it starts at the reference's length and grows only if the shot runs past it, so the whole reference shows from the first second. In Targets it follows live time, as in Streamline.
- **Reference | Targets,** at the right of the legend. Reference draws the Shot against the reference and no targets. Targets is Streamline's own chart: the Shot against the profile's targets, with the "Profile target" legend, and nothing of the reference. The view is remembered per tablet. It starts on Reference, and neither a recipe load nor a finished shot resets it.
- **The legend.** The Shot's row reads "Latest", or "Live shot" while one runs, with the day and time in the page's language, "Today" for today, and the barista the Shot recorded. The reference's row reads "Reference" with the same. Neither says which machine.
- **"Different profile"** flags a reference pulled on another profile than the recipe's. On a Machine Decent Sync serves it is Decent Sync's word, the answer's `profileDiffers`. Without Decent Sync the skin works it out, by the profiles' titles: Decaid's profile id is a hash of the profile's contents, so a brew temperature stepped on the page gives the same profile another id. It shows nothing when the recipe names no profile.
- **When the latest Shot is the reference,** a "This shot is the reference" badge takes the reference row's place, the reference's lines are not drawn, and there is no Make reference. Once the next shot starts, that Shot is drawn behind it.
- **With no Shot for the recipe yet** the reference is drawn alone, and a line says "No shot with this recipe on this machine yet". The line shows in Targets too, where the graph is then empty.

### Make reference

- It ends the latest Shot's row, and shows only where it can act: a recipe is loaded, a Shot is in the graph, no shot is running, and that Shot is not the reference already.
- With no reference yet it makes the Shot in the graph the reference at once. When it would replace one it asks first, in a dialog titled "Replace the reference?" that names the recipe, the new Shot and the one it replaces.
- **Nothing on the page clears a reference.**
- A choice that names a Shot the tablet no longer has reads as no reference.
- On a Machine Decent Sync serves the choice goes to the server, and Make reference is shown muted while the server can't be reached: see below.

### The reference with Decent Sync

On a Machine Decent Sync serves, the reference is the Recipe's Reference Shot: the one every tablet at the Location draws, whichever Machine pulled it. The contract is "For a Skin's author" in Decent Sync's [`docs/PLUGIN.md`](https://github.com/loganfuller/decent-sync/blob/main/docs/PLUGIN.md). One module speaks to the plugin, `src/cafe/decent-sync.js`, and a test fails if another does.

- **Which source answers** is one function of what the plugin answers to its Status request (`shotSource` in `src/cafe/sync-status.js`).
  - A served Machine: the plugin.
  - No plugin loaded, a Capture-only Machine, the wrong hardware (`hardwareMismatch`), or any refusal the skin does not know: the tablet.
  - While the server can't be asked (`unreachable`, `serverTooOld`, or Decaid itself not answering), the last answer stands. So a served Machine stays with the plugin through an outage.
- **Before any answer has said which,** as when the skin loads before the plugin has connected, the graph shows the latest Shot alone, with no reference and no Make reference. The choice kept on the tablet is not read meanwhile. It is never used on a Machine that may be served, or two tablets could draw different references for one recipe. One consequence: a page opened while the server is out of reach draws no reference until the server is back, though the plugin holds a copy.
- **When the status is asked.** At start-up, when the page comes back into view, after each recipe load, when the plugin's `changes` socket opens, when a push says the plugin's connection to the server came or went, and at once after a read or a choice refused as `captureOnly` or `hardwareMismatch`. While no answer has come either way it is asked again on the timing the dial-in label uses. A Machine that turns Capture-only, or is served again, changes source at the next answer, with no reload.
- **Reading it.** The plugin's `reference` request, by the loaded recipe's DYE2 record id. The skin keeps no copy of its own, and reads and writes nothing under `streamlineCafe` for the reference on a served Machine.
- **A choice kept on the tablet is dropped, not carried over.** One made before the plugin was installed, or while the Machine was Capture-only, is not sent to the server. It stays in Decaid's store, unread, and is the reference again only if the Machine stops being served.
- **The legend** says when the Reference Shot was pulled and by whom, as it does for the tablet's own, and never where, though another Machine or Location may have pulled it.
- **Choosing it.** Make reference sends the choice to the plugin. The answer is the reference as it now is, and the graph follows it without another read.
  - A choice answered `unreachable` or `serverTooOld`, or by Decaid with no `code`, or not answered at all, may have been made all the same. The reference is read again first. If it is the Shot chosen, the choice was made. If not, a toast says the reference could not be saved, and the graph follows what the read found.
  - Any other refusal shows the refusal's own message, which is the plugin's and in English, and changes nothing on screen.
- **A recipe the Library doesn't have yet,** which the plugin refuses as `noSuchRecipe`, as one made on the page a moment ago: it reads as no reference. Make reference is offered, and the refusal's message says why it did not work.
- **While the server can't be reached** the plugin answers from the copy it keeps on the tablet, and the skin draws it. The reference can't be changed then. Make reference is shown muted, and a line says "Decent Sync can't be reached, so the reference can't be changed".
  - The line has a line of its own under the legend, because the legend's row has no room for it, and the graph gives up its height. It stays through a shot, so the graph does not change height as one starts.
  - Where the reference can't be read at all, because the tablet has no copy, as for a recipe in no slot, none is drawn, and the line reads "Decent Sync can't be reached, so the reference can't be shown". So too when Decaid answers in the plugin's place, as while the plugin is being reloaded.
- **A reference chosen elsewhere** arrives over the plugin's `changes` socket.
  - A push that names the recipe in the graph has its Shots read again, and the graph is drawn again only if the latest Shot or the reference is another than the one drawn. A push may repeat, as when the Recipe is renamed, and then nothing is drawn.
  - When the socket opens, and when a push says the connection came or went, the status is asked and the reference read after it.
  - A push with a `what` the skin doesn't know is ignored.
  - Only recipes in a slot are pushed. One in no slot is read when it loads.
- **During a shot nothing is read.** The reference's lines stay the ones the shot started with, and the shot's end reads both Shots again.
- **The socket** is opened through one export the fork adds to `api.js`, which uses Streamline's own socket helpers. Streamline's `connectPluginPush` keeps one socket for each plugin and gives it to the plugin's `changed` endpoint, so it could not carry this one as well. It opens once, after the plugin has first answered its status, so a tablet with no Decent Sync opens none. It is never closed, and comes back by itself after it drops.
- **When Decent Sync can't be asked for the reference while Decaid answers,** as for a refusal the skin does not know, the latest Shot is still drawn, and the reference read before stays.
- **A plugin that is installed and not loaded reads as no plugin.** If the skin starts before Decaid has loaded the plugin, a choice kept on the tablet is drawn until the status is next asked.

### The comparison row

A row of five cards under the graph, for the Shot in the graph. The graph gives up the row's height. A card is a title, the Shot's number, and under it what the number is compared with; a difference follows the number. There is no colour and no score: a difference is a number, not a verdict.

- **One module works out every number,** `src/cafe/comparison.js`, which touches no browser global. `src/cafe/compare-row.js` only writes the text.
- **A Shot is timed and measured as Decent Sync does it,** so a tablet and its server give one Shot the same numbers. The Preheat is the Shot's leading samples in `preparingForShot`. The profile starts at the first sample after them, and nothing in the Preheat counts.
  - **Time** runs from the start of the profile to the Shot's last sample.
  - **First drip** is Decent Sync's time to first drip: from the start of the profile to the scale's first reading of 1 g or more. A Shot with no scale has none.
  - **Peak pressure** is the highest pressure after the Preheat, so a heater test before the profile is not the peak.
  - **Yield** is the yield the Shot kept. Where it kept none, it is the scale's last reading.
  - **Dose** is the one the Shot weighed, or where it weighed none, the dose its Workflow set, which is the recipe's dose as the Shot was pulled. **Ratio** is the yield over that dose, written `1:2.02`, and its card names the dose: "Ratio · 18.0 g dose".
- **In Reference** each card gives the Shot's value, the reference's as "Ref 27.9 s", and the difference.
  - With no reference chosen each reads "No reference", with no difference. So does the row with no recipe loaded, which shows the last Shot's numbers.
  - When the Shot is the reference each reads "Ref = this shot".
  - With no Shot for the recipe yet the values are "—" and the cards give the reference's numbers.
- **In Targets** the cards are Time, with first drip beside it; Dose against the dose set; Yield against its target; Ratio against the ratio set; and Peak pressure.
  - **Peak pressure has no target.** The card shows the Shot's own peak with nothing beside it: a target for it does not hold for every profile.
  - The yield's target is the Workflow's. A yield of 0 there is stop-at-weight switched off, so the Shot had no target, whatever its profile's target weight; that weight stands in only for a Workflow that holds no yield at all. Where nothing was set a card reads "No target".
  - The Dose card shows only a dose the Shot weighed.
  - With no Shot for the recipe yet each card reads "No shot yet".
- **A value the Shot did not record is "—",** with no difference. A difference is the difference of the two numbers as they are shown, so 28.4 s beside 27.9 s is +0.5 s.
- **With no recipe loaded** the Shot is the one Streamline's history module hands the chart, which comes without the Shot's own record. So its yield is the scale's last reading and its dose is its Workflow's.
- **A card's title is put into capitals in the code, not by the stylesheet,** so a long one is fitted at the width it is drawn at, and the dose in the Ratio card's title keeps its "g".
- **Temperatures** follow the page's °C or °F. Numbers are written with a point in every language, as on the rest of the page.

### The live cards

While a shot runs, six cards take the row's place: Time, Weight, Weight flow, Water flow, Pressure and Temperature. The five return when the finished Shot is in the graph, so they stay through the few seconds Decaid takes to save it.

- **In Reference** each sits beside the reference at the same second of its own run, with the difference. Time's card says how long the reference ran.
  - **"The same second"** is seconds from the start of each Shot's profile, its Preheat left out, taking the reference's value between its two nearest samples.
  - The reference's weight flow is the scale's, or the machine's own on a machine that measures one, as on the graph.
  - With no reference the cards read "No reference". Once the shot runs past the reference's last second they read "Ref ended". Neither shows a difference, and the page does not switch to Targets by itself.
- **In Targets** each sits beside what the profile asks for at that moment: Time names the stage, Weight the weight the shot stops at, and Water flow, Pressure and Temperature their targets.
  - Where the profile sets no target for a card at that step it says "No target this step", which holds for any profile. A target of zero is a step that sets none.
  - No profile sets a weight flow, so that card reads "No profile target".
- **The toggle switches the cards** between the two during a shot.
- **The cards are written when the chart draws a live frame,** so they are repainted exactly as often as the chart is. The chart calls the page's overlay just before it draws, and the page reads the running shot's numbers off the lines the chart is about to draw. A card never says more than the graph shows, and writing the cards asks the chart for nothing. The scale's weight is not one of the chart's lines, and is read as the weight in the title band is. Once the shot has ended the scale may read a lifted cup, so the weight is then the last one the shot recorded. A draw made while a finished shot waits to be saved writes them once more, so a shot that ended behind the full-screen chart leaves its last frame on the cards, not the one from when that chart was opened.
- **The weight in the title band stays,** as the layout slice left it.

### Stage names

Streamline draws a line where each profile stage begins and gives it no name. The graph names each stage the Shot reached, by its step's name in the Shot's own profile, in both views.

- **On the main graph only.** The full-screen chart stays as it is.
- **Inside the plot, at the top of the stage's line and to its right.** A name is left out where its stage is too narrow to hold it: narrower than the name from its line to the next stage's, or to the end of the time axis. Of several steps skipped at one second, only the last, the one that ran, can have room.
- **At rest and during a shot,** each as its stage is reached. During a shot the time axis grows, so a name may give way as its stage narrows.
- **With no Shot for the recipe yet,** in Reference, the stage lines and names are the reference's, drawn with its lines.
- **What keeps a live shot from a full redraw on each frame.** The chart sends its stage lines again only when they change. A name is part of its line, so it is sent when a stage is reached and when a name stops or starts fitting, and at no other frame.
- **Two hooks carry it.** The chart keeps each step's name on the stage line it adds, and the renderer writes the name of a line that carries a label. Which lines carry one is worked out in `src/cafe/stage-names.js`.

## Changing the profile from the dialog

This is the riskiest behaviour in the design, so it is built last and behind a trial.

Streamline unloads the recipe on every profile switch, and DYE2 unloads a recipe whose Workflow moves to a profile its record doesn't hold. To keep the recipe loaded, the skin writes the new profile into the recipe's DYE2 record first, then writes the Workflow, without going through any of Streamline's profile-switch paths.

- **The trial.** On headless Decaid, prove the recipe stays loaded after the change.
- **If it fails.** The dialog shows the profile's description only, and the profile is changed in DYE2's editor.
- **With Decent Sync.** The change is an edit to the Recipe's Profile, so it reaches every Machine at the Location with that Recipe loaded, as the rest of the dial-in does.

## Translations

The screen's new text covers the languages Streamline supports.

- New strings live in the fork's own table, `src/cafe/translations.js`, with Streamline's language codes. A lookup tries that table, then Streamline's translation file, then English. Streamline's file is not edited: it is overwritten from a spreadsheet upstream.
- Where Streamline already has the same English text, its translation is used, and the table holds only what Streamline's file lacks.
- New phrases are machine-translated and marked so, entry by entry. Corrections are welcome as pull requests.
- Arabic and Hebrew are translated, and the layout stays left to right. Streamline has no right-to-left layout, and mirroring one page would make it the only screen that flips. Streamline also carries each of the two a second time, `arb` and `heb`, with the letters in the order a renderer with no right-to-left support draws them. The table follows it, so those two read the same across the page.
- A test fails when a string the page shows lacks any of Streamline's finished languages, read from Streamline's own list. Languages Streamline marks unfinished fall back to English where a phrase is missing.
- The page's own text is keyed by `data-cafe-text`, not Streamline's `data-i18n-key`. Streamline's page translation knows only its own file, and runs on every visit to a subpage, so it would put a phrase from the fork's table back into English. Three elements keep Streamline's key, because a Streamline module re-labels them itself: the machine status, Sleep and the cup warmer.
- A label a language makes too long for its place is shrunk to fit by Streamline's own text fitting, as its header buttons are.
- A date is written in the page's language too.

## Tests

- Streamline's convention, in CI on every pull request: pure modules under `node:test`.
- Before each release, a Playwright smoke run by hand against headless Decaid with a simulated machine, with screenshots on the pull request. It is not in CI yet. It has two setups: Decaid alone, and Decaid with Decent Sync's plugin and a local Decent Sync server. `SMOKE.md` says how to set them up, and `test/cafe-smoke/` holds the runs and their made-up data.

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

- what the sample data and its pretend machine do in the public preview (slice 8).
