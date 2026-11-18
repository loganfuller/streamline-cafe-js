# Streamline Cafe: design

Streamline Cafe is a recipe-first skin for [Decaid](https://github.com/decentespresso/decaid), made for cafes. It is a fork of [Streamline](https://github.com/decentespresso/streamline-js) that replaces Streamline's main page and keeps everything else.

**Status: in development.** The skin is not meant for a working cafe until its screen matches the design in full. Until then its builds are for development.

This file records what was decided and why. The code is the authority on how it works today. The fork's changes to Streamline's own files are listed in `UPSTREAM_EDITS.md`, which the first change that makes one adds beside this file.

Words such as Recipe, Recipe Slot, Reference Shot, Shot, Location, Machine, Workflow and Capture-only are used as [Decent Sync's glossary](https://github.com/loganfuller/decent-sync/blob/main/GLOSSARY.md) defines them.

## Who it is for

- Any cafe running Decent machines on Decaid. The repo carries no cafe's name, branding or data: sample data in docs, tests and the public preview is made up.
- **DYE2 is required.** The skin shows recipes and nothing else in their place, so without DYE2 it shows a "DYE2 is needed" screen (see [Recipes and the strip](#recipes-and-the-strip)).
- **Decent Sync is optional.** With it, the skin shows the Location's Shots and each Recipe's Reference Shot, and a dial-in change, a grinder chosen in its dialog among them, is saved onto the loaded Recipe. Without it, on a Capture-only Machine, or while the server can't be reached, the skin falls back to this machine's own Shots. Without it or on a Capture-only Machine, the reference is one kept on the tablet, and a dial-in change, or a grinder chosen, is this machine's alone. While the server can't be reached, a Machine it serves draws the copy of the Reference Shot that Decent Sync's plugin keeps on the tablet.

## What the screen shows

The owner keeps the screen's working design as a mockup, which is not in this repo. This section summarises it and is updated with it.

- **Recipes.** Nine fixed Recipe Slots in one row. An empty slot stays as an outline reading "Slot N" and "Hold to add", so cards never move. A tap loads a recipe. A long-press opens a menu on the card: make a new recipe from what the machine is set to, choose a recipe that is in no slot, or take the card's recipe out of its slot. Nothing on the page opens DYE2's editor.
- **The barista.** A button in the title band, between the recipe's title and the machine's status, names the barista at the machine, whom its next Shots record. A tap picks one from the names on recent Shots, "No barista", or a name typed in. The name lasts until the machine next sleeps (see [The barista](#the-barista)).
- **Dial-in column.** Steppers for dose, yield, grind, brew temperature, flush, steam flow and hot water, all with the same type and the same size buttons. Hot water is one control with Streamline's Temp | Vol toggle. With Decent Sync a change is saved onto the loaded recipe, and the column is labelled "Dial-in · saved to the recipe". Without it the change is this machine's alone, until another recipe loads, and the label reads "Dial-in · not saved to the recipe".
- **The Grind row's number.** A preset grinder's setting is shown by its name, shrunk to fit between − and + when it is wider than a number (a name too long even at the smallest size ends in an ellipsis), and − and + change nothing while the row holds a name, or "—" for no setting: a preset is chosen from the grinder dialog or typed on the numpad. Any other setting is shown with the places its grinder's step uses, as − and + write it, and never rounded to fewer than its own, so a 0.25-step grinder at 11.25 reads 11.25. A whole number reads whole, as on Streamline's page. A number too wide for the row, such as 111.25, is shrunk to fit, never cut.
- **Grinder, bean, basket and profile.** Dose names the bean and batch, Yield the basket, Grind the grinder and Brew the profile. A tap on one opens a dialog listing what the tablet offers: the grinder's, the bean and batch's and the basket's today, the profile's with its slice (see [The grinder, bean and basket dialogs](#the-grinder-bean-and-basket-dialogs)).
- **Graph.** At full strength: this machine's latest Shot pulled with the loaded recipe. Faded: the recipe's Reference Shot. Both are solid lines; the dotted lines are the profile's targets. A Reference | Targets toggle switches to Streamline's view of the Shot against the profile's targets. The legend says when each Shot was pulled and by whom, and ends the latest Shot's row with Make reference. Each profile stage the Shot reached is named at its line.
- **Comparison row.** Under the graph, five cards. In Reference: time, first drip, yield, ratio and peak pressure, each beside the reference's with the difference. In Targets: time with first drip, then dose, yield and ratio against what was set, and peak pressure alone. While a shot runs, six live cards take its place: time, weight, weight flow, water flow, pressure and temperature, beside the reference at the same second or beside what the profile asks for.
- **Rating and notes.** Five stars and a note icon on the row of the Shot in the graph. A tap on a star rates it, and the icon opens its note to write. The reference's row shows its rating and a note icon that opens its note to read.
- **Shots list.** A Shots button with Settings and Sleep opens a list of Shots: every Shot at the Location with Decent Sync, otherwise this machine's own. A row opens that Shot in the graph in the latest's place, with "Back to latest" beside the machine's status (see [The Shots list](#the-shots-list)). Until the Location's list arrives, every tablet lists its own Shots.
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

Streamline's modules keep running for the work that isn't drawing. Its shot-data module feeds the stop notice and the shot timer, and its history module still reads the tablet's Shots, so both stay even though their panels are gone. With a recipe loaded, which finished Shot the graph draws is the page's choice; with none, the history module draws (see [Shots and the reference](#shots-and-the-reference)). Either way the choice is made in `src/cafe/graph-state.js` (see [The latest Shot](#the-latest-shot)).

**The page's dialogs are scaled as the page is.** Streamline draws the page on a 1920 by 1200 canvas and scales it to the screen, but a `<dialog>` opened as a modal draws above the page, outside that canvas. So each of the page's dialogs holds its own canvas (`.cafe-dialog-canvas` in `cafe.css`), the screen's size in design pixels, scaled by the two factors Streamline's scaling writes for it (`--streamline-scale-x` and `--streamline-scale-y`; see `UPSTREAM_EDITS.md`). Sizes inside a dialog are in design pixels, as on the page, and a limit on a box is a share of its canvas, never of `vw` or `vh`. A new dialog goes inside such a canvas. Streamline's own slot menu and toast, which the page uses, are drawn unscaled, as they are on Streamline's own page.

## Recipes and the strip

- **The skin owns the strip.** Its own module draws the nine cards and handles taps, long-presses, the loaded highlight and slot placement.
- **Loading a recipe stays Streamline's.** The skin loads a recipe only by calling Streamline's `applyRecipe`, and reads which recipe is loaded through Streamline's selection helpers. DYE2 has no endpoint that applies a recipe: Streamline's apply writes the Workflow and tells DYE2 which recipe is loaded. A second implementation would be a second behaviour for Decent Sync to follow.
- **Streamline's strip module still starts,** with nothing to draw into. It keeps telling DYE2 which recipe is loaded, restores the selection after a trip to DYE2's editor, and re-reads DYE2's records when the page regains focus.
- **When the skin starts.** Only when the DYE2 plugin is installed, loaded and at least v0.1.40, and Streamline's shared "DYE2 on" setting is on. Otherwise a blocking screen says which is missing. For the setting it offers a button that turns it on. For the plugin it points to Decaid's Plugins screen, because installing a plugin from a skin needs a management token from Decaid v0.9.2. The screen is a centred card titled "Streamline Cafe needs DYE2", with one line for what is missing, and always a Reload button and a Settings button, so the settings page stays reachable.
- **When Decaid's plugin list can't be read,** nothing is known to be missing, so the screen is not shown for the plugin and only the setting decides. The page then starts as Streamline does against a Decaid it can't reach, and recovers the same way. The check waits five seconds for the list at most.
- **DYE2 switched off while the page runs.** On the way back from the settings page the skin reloads, which lands on the "DYE2 is needed" screen.
- **What the cards and the names follow.** DYE2's records and the Workflow have no push channel. The skin reads them at start-up, after a tap loads a recipe, when the page comes back into view or back from a subpage, when a plugin announces a Workflow change, and when the active profile changes. There is no timer.
- **Saving the dial-in is Decent Sync's.** DYE2 saves a change of the Workflow onto the loaded recipe only when asked: its `record` request, which Streamline sends when a barista picks "Save changes" in its strip's menu, and which Decent Sync's plugin sends after every change on a Machine it serves. A grinder, or a batch of the Recipe's own Bean, chosen in its dialog is saved the same way, from the Workflow: Decent Sync records it as the Recipe's, and the skin writes no record of its own. A basket chosen there is saved by DYE2's `record`, as a number is (see [The grinder, bean and basket dialogs](#the-grinder-bean-and-basket-dialogs)). The profile is the one choice the skin saves onto the recipe itself, with Decent Sync and without, because DYE2 unloads a recipe whose Workflow moves to a profile its record does not hold (see [Changing the profile from the dialog](#changing-the-profile-from-the-dialog)). The skin has no such menu and sends no such request, so on a tablet without Decent Sync nothing saves a dial-in change, and the page says so. A recipe is changed for good there in DYE2's editor. The skin learns whether Decent Sync saves from the plugin's Status request: a Machine it serves, yes; a Capture-only Machine, or no plugin, no; and while the server can't be asked, the last answer stands, because the plugin goes on saving on the tablet through an outage. The skin asks at start-up, when the page comes back into view, after each recipe load, and when the plugin says its connection to the server came or went (see [The reference with Decent Sync](#the-reference-with-decent-sync)); and while no answer has come either way, as when the skin loads before the plugin has connected, it asks again every half minute, slowing to every five. A plugin Decaid has not loaded yet says nothing either way too, and is asked again within seconds.
- **Before another recipe loads,** a change still on its way, a choice made in a dialog among them, is written first, so it does not land on the recipe about to load, and the recipe tapped is read again from DYE2's records, so what loads is what DYE2 holds, not what the card showed when it was drawn. Loads run one at a time, in the order tapped. A load whose earlier change has not reached the machine after a few seconds is not made, and says so. While a recipe loads the dial-in rows take no taps: a step made then could be written before or after the load. A tap on the card tapped last, while its load has not finished, is ignored, so a double tap loads; a tap on another card, the one loading included, moves the highlight there, and the newest tap is the one loaded next.
- **A tap on the loaded card unloads it,** and asks nothing first. Only the marker that says which recipe is loaded is cleared, as when a loaded recipe leaves its slot (below): the numbers, the grinder, the bean and batch, the basket, the profile and the barista stay as they were. The page is then the no-recipe page it already has, with no toast and no hint: the highlight leaving the card, at the tap, and the title changing are the feedback. From then on a change is this machine's alone, written to the Workflow and saved to no recipe, and a Shot pulled belongs to no recipe. A tap on any card loads it again as stored, the card just unloaded included, over what was dialled meanwhile; keeping that is the long-press menu's "New recipe from current settings" or "Replace with a new recipe", and nothing saves it onto an existing recipe. It is the same with Decent Sync, on a Capture-only Machine, with no plugin and while the server can't be reached, since the unload is DYE2's, on the tablet; and it is this machine's alone, so another machine with the recipe loaded keeps it. The unload takes its turn with the loads, as the change before it is written first, and is not made while a menu action or a pick runs. An unload alone is quick, often quicker than the gap between the two taps of a double tap, so it holds the strip for 400 ms from its tap, however soon it is done. While it runs and while it holds, the dial-in rows take no taps, the menu does not open, and a tap on the same card is ignored, so the second tap of a double tap on the loaded card does not load the recipe again; a tap on another card loads that card once the unload is done and its hold is over. A load is slow enough not to need this, and has no such hold. A recipe DYE2 no longer names as loaded when the unload's turn comes is not unloaded again: the strip is drawn as DYE2 says. One DYE2 can't be asked about then is not unloaded either, since another recipe may have been loaded meanwhile: that is an unload that failed. An unload that fails is a toast, "Could not unload {name}", and the card is highlighted again.
- **No card takes a tap while a shot runs,** the loaded card or any other: a load would change the running shot's yield and file its Shot under another recipe, and an unload would file it under none.
- **Just after a shot,** a load or an unload waits until Decaid has stored the Shot. Decaid copies the Workflow onto a Shot as it stores it, up to its 4 s backstop after the pour ends, so the Shot just pulled keeps the recipe it was pulled with. The wait is the barista's (see [The barista](#the-barista)) and goes with it, once Decaid stores the Shot before taking another change. A shot that ends during the wait gets its own wait. A tap that waits and finds a new shot running when the wait ends, or when DYE2 has been read just before the write, does nothing.
- **A change made just before an unload, known and accepted.** It is written to the machine first, as before a load, and nothing more is built. With Decent Sync, whose plugin saves a change onto the loaded recipe a moment after it reaches the Workflow and drops a save it finds no recipe loaded for, a step made within about a second of the tap can be on the machine and not on the recipe; loading the recipe again then brings the older number back. A load of another card has the same gap.
- **Nine slots.** DYE2 keeps a `stripSlot` of 6 to 9 as written, though its own editor places recipes only in 1 to 5. The skin places recipes in 6 to 9 itself.
- **A long-press arranges the strip, and never leaves the page.** One purpose of the skin is that a barista does not need DYE2's editor. A long-press opens Streamline's own menu on the card, and loads nothing.
  - An empty slot offers "New recipe from current settings" and "Choose a recipe…".
  - A filled card offers "Replace with a new recipe", "Replace with another recipe…" and "Remove from slot". Nothing asks "are you sure": the recipe replaced or removed is not lost, and can be chosen again.
- **A new recipe is made by DYE2,** with its `save-recipe` request, from the Workflow as it stands: the bean, grinder, basket, profile and every number. DYE2 names it, from the profile and the bean, and marks it as the loaded recipe. The skin then puts it in the slot that was held, for any slot from 1 to 9. A dial-in change still on its way is written first, so it is in the recipe.
- **A recipe is chosen from the recipes in no slot,** read from DYE2's records on the tablet, so the list opens without Decent Sync and while the server can't be reached. With Decent Sync those are the Location's Recipes in no slot. Each row is the recipe's name over its bean and profile, sorted by name. Choosing places the recipe and loads nothing: it loads on a tap. With nothing to choose, the list says so. A recipe in another slot is not listed: it is taken out of that slot first.
- **A recipe that leaves its slot stays in DYE2,** in no slot. If it was the loaded recipe it is unloaded, so a change on the machine is no longer saved onto a recipe with no card, and what the machine is set to does not change: which recipe is loaded is a marker in the Workflow, and only the marker is cleared. The one exception is a new recipe made on the loaded recipe's card, which is itself the loaded recipe afterwards.
- **The menu does not open while a shot runs or a recipe loads or unloads.** Making a recipe writes the Workflow. While an action from the menu runs, no card loads and the dial-in rows take no taps, as while a recipe loads.
- **A recipe chosen from the list is placed only if it is still in no slot.** One that another tablet put in a slot while the list was open is left there, and a toast says it could not be placed.
- **Streamline's strip module is told when the page changes which recipe is loaded.** That module keeps its own note of the recipe it last applied, and when its request telling DYE2 fails it retries for about a minute. A new recipe or an unload made on this page inside that minute would be undone by the retry. So before either, the page calls `forgetAppliedItem`, the one hook the fork adds to `dyeStrip.js`, which drops the note and stops the retry. Both kinds of unload, a tap on the loaded card and a recipe leaving its slot, go through one function in `src/cafe/arrange.js`, and a test fails if DYE2's selection is cleared anywhere else.
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

The writer puts a recipe in a slot, takes one out, and saves a new profile onto the loaded recipe, which a recipe must hold before the Workflow moves to it (see [Changing the profile from the dialog](#changing-the-profile-from-the-dialog)). A field may be named one level down, as `workflow.profile`: it is set inside what the row holds there, and the rest of that object is kept as just read. The fields to set may be worked out from the row as each attempt reads it, and are confirmed whatever the order of an object's keys. The grinder, bean and basket dialogs write no record: a choice writes the Workflow only, and Decent Sync, where it serves the Machine, records it as the Recipe's (see [The grinder, bean and basket dialogs](#the-grinder-bean-and-basket-dialogs)). A new recipe's row is DYE2's own write, made by its `save-recipe` request. The writes Streamline's own strip module makes are Streamline's, and are left as they are.

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

One module, `src/cafe/shot-seam.js`, is asked for eight things: a recipe's latest Shot on this machine, a recipe's reference, to make a Shot a recipe's reference, the tablet's newest Shot, to set a Shot's rating and note, a page of the Shots list, one Shot whole by its id, and a grinder's latest Shots, for the grinder dialog. With no recipe loaded the page asks it only for the newest Shot, for its rating and note (see [Rating and notes](#rating-and-notes)). Its answer for a reference says whether it can be changed now, and so does its answer for a Shot by its id. The page reads and changes Shots, and the choice, no other way, and a test fails if another module does, so which source answers changes no caller. A recipe is named by its DYE2 record id, the one Streamline's apply writes into the Workflow.

- **The latest Shot is always the tablet's own,** read from Decaid's Shots (`src/cafe/tablet-shots.js`), with Decent Sync or without. It is this machine's Shot. So are a grinder's latest Shots.
- **The Shots list and a Shot read by its id have two sources too.** On a Machine Decent Sync serves the list is every Shot at its Location, through the plugin, and a Shot another Machine pulled is read whole through it. Otherwise both are the tablet's own. See [The Location's Shots](#the-locations-shots).
- **The reference has two sources.** Where Decent Sync does not serve the Machine it is a choice kept on the tablet: one of Decaid's Shots, named in the `streamlineCafe` namespace as recipe to Shot. On a Machine Decent Sync serves it is the Recipe's Reference Shot, read and chosen through the plugin (`src/cafe/plugin-shots.js`): see [The reference with Decent Sync](#the-reference-with-decent-sync).
- **An edit of a Shot's rating or note has the same two routes:** the plugin on a Machine Decent Sync serves, Decaid's own Shot edit otherwise.
- **Streamline's shot cache is not a source.** It can't hold another machine's Shots: it removes any cached row that Decaid's own list doesn't return.

### The latest Shot

- **Which Shot is in the graph is decided in one module,** `src/cafe/graph-state.js`, which touches no browser global: a state, and a function from that state and an event to the next state and a list of things to do. The events are what can change it: a recipe loaded or unloaded, a shot started or ended, the page back in view, the history module asking the chart to draw, a reference push, the source of the reference changing, a timer running out, a row of the Shots list tapped, "Back to latest", the answers to its reads, to Make reference and to an edit of a rating or note, and an edit that could not be confirmed because the server is out of reach. The things to do are the reads through the Shot seam, a draw, and starting or stopping a timer, and `src/cafe/graph.js` does them and tells the module what each read found. The guards against an answer that arrives late are the module's too: each read carries a count, and only the newest read's answer is taken.
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
- **The time axis.** At rest it fits the longer of the two Shots. Where the chart is left to fit its own axis, as after a change of theme, it is given a range only if the reference is the longer. During a live shot, in Reference, it starts at the reference's length and grows only if the shot runs past it, so the whole reference shows from the first second. In Targets it follows live time, as in Streamline.
- **Reference | Targets,** at the right of the legend. Reference draws the Shot against the reference and no targets. Targets is Streamline's own chart: the Shot against the profile's targets, with the "Profile target" legend, and nothing of the reference. The view is remembered per tablet. It starts on Reference, and neither a recipe load nor a finished shot resets it.
- **The legend.** The Shot's row reads "Latest", or "Live shot" while one runs, with the day and time in the page's language, "Today" for today, and the barista the Shot recorded. The reference's row reads "Reference" with the same. Neither says which machine. Where the legend is too narrow for all it holds, the baristas' names give way first, both together, and only then the times: the two rows' pieces lie in the legend's one row, so what gives way is chosen across both. With stars, notes, Make reference and both names, each time is shown whole in every language Streamline has finished; with "Different profile" as well, the times are cut short in the languages with the longest phrases.
- **"Different profile"** flags a reference pulled on another profile than the recipe's. On a Machine Decent Sync serves it is Decent Sync's word, the answer's `profileDiffers`. Without Decent Sync the skin works it out, by the profiles' titles: Decaid's profile id is a hash of the profile's contents, so a brew temperature stepped on the page gives the same profile another id. It shows nothing when the recipe names no profile.
- **When the latest Shot is the reference,** a "This shot is the reference" badge takes the reference row's place, the reference's lines are not drawn, and there is no Make reference. Once the next shot starts, that Shot is drawn behind it.
- **With no Shot for the recipe yet** the reference is drawn alone, and a line says "No shot with this recipe on this machine yet". The line shows in Targets too, where the graph is then empty.

### Make reference

- It ends the latest Shot's row, and shows only where it can act: a recipe is loaded, a Shot is in the graph, no shot is running, and that Shot is not the reference already.
- With no reference yet it makes the Shot in the graph the reference at once. When it would replace one it asks first, in a dialog titled "Replace the reference?" that names the recipe, the new Shot and the one it replaces. If the reference is another by the time the barista agrees, as one chosen elsewhere while the dialog was open, nothing is replaced: the dialog did not name it.
- **Nothing on the page clears a reference.**
- A choice that names a Shot the tablet no longer has reads as no reference.
- On a Machine Decent Sync serves the choice goes to the server. While the server can't be reached Make reference is shown muted where the tablet's copy is drawn, and not at all where nothing could be read: see below.

### The reference with Decent Sync

On a Machine Decent Sync serves, the reference is the Recipe's Reference Shot: the one every tablet at the Location draws, whichever Machine pulled it. The contract is "For a Skin's author" in Decent Sync's [`docs/PLUGIN.md`](https://github.com/loganfuller/decent-sync/blob/main/docs/PLUGIN.md). One module speaks to the plugin, `src/cafe/decent-sync.js`, and a test fails if another does.

- **Which source answers** is one function of what the plugin answers to its Status request (`shotSource` in `src/cafe/sync-status.js`).
  - A served Machine: the plugin.
  - No plugin, a plugin switched off in Decaid, a Capture-only Machine, the wrong hardware (`hardwareMismatch`), or any refusal the skin does not know: the tablet.
  - While the server can't be asked (`unreachable`, `serverTooOld`, or Decaid itself not answering), the last answer stands. So a served Machine stays with the plugin through an outage.
  - A plugin Decaid lists and has not loaded yet, as for a moment after Decaid starts and while the plugin is reloaded, says nothing either way, and the last answer stands. Taken as no plugin, that moment would put a served Machine's reference on the tablet. It is asked again every 3 seconds, five times, and then on the timing below. One that never loads, as a plugin that fails to start, leaves a page that has had no answer yet with no reference and no line saying why, until Decaid loads it or it is switched off: the Machine may be served, so the tablet's own choice is not used.
- **Before any answer has said which,** as when the skin loads before the plugin has connected, the graph shows the latest Shot alone, with no reference and no Make reference. The choice kept on the tablet is not read meanwhile. It is never used on a Machine that may be served, or two tablets could draw different references for one recipe.
  - **Once the plugin itself has answered that it can't ask its server** (`unreachable` or `serverTooOld`), as on a page opened during an outage, the plugin is asked for the reference all the same. It answers from the copy it keeps on the tablet for each Recipe in a slot, and that is drawn as on a served Machine during an outage: Make reference muted, and the line "Decent Sync can't be reached, so the reference can't be changed". The copy came from the server, so it is the Location's Reference Shot, and two tablets can't draw different ones.
  - **Nothing can be chosen until the status says the Machine is served,** whatever the plugin answers meanwhile.
  - **Only the plugin's own word starts it.** Where Decaid itself did not answer, or lists the plugin as not loaded yet, nothing is asked.
  - **A plugin with no copy changes nothing.** One installed and never given a server holds none, and neither does a Recipe in no slot. The request is refused, no reference is drawn, and the line reads "Decent Sync can't be reached, so the reference can't be shown". So a plugin that never connects leaves the tablet with that line and no reference, where the same tablet with no plugin keeps its own.
  - **A copy may be out of date.** A Machine that turned Capture-only while its plugin was offline draws its old copy until the server is reached, as a page already open does. A refusal that says the Machine is not served has the status asked again.
- **When the status is asked.** At start-up, when the page comes back into view, after each recipe load, when the plugin's `changes` socket opens, when a push says the plugin's connection to the server came or went, at once after a read or a choice refused as `captureOnly` or `hardwareMismatch`, and after the Shots list is refused in a way that means "the tablet's own Shots". While no answer has come either way it is asked again on the timing the dial-in label uses. A Machine that turns Capture-only, or is served again, changes source at the next answer, with no reload.
- **Reading it.** The plugin's `reference` request, by the loaded recipe's DYE2 record id. The skin keeps no copy of its own, and reads and writes nothing under `streamlineCafe` for the reference on a served Machine.
- **A choice kept on the tablet is dropped, not carried over.** One made before the plugin was installed, or while the Machine was Capture-only, is not sent to the server. It stays in Decaid's store, unread, and is the reference again only if the Machine stops being served.
- **The legend** says when the Reference Shot was pulled and by whom, as it does for the tablet's own, and never where, though another Machine or Location may have pulled it. Its rating and note are the answer's own.
- **Choosing it.** Make reference sends the choice to the plugin. The answer is the reference as it now is, and the graph follows it without another read.
  - A choice answered `unreachable` or `serverTooOld`, or by Decaid with no `code`, or not answered at all, may have been made all the same. The reference is read again first. If it is the Shot chosen, the choice was made. If not, the graph follows what the read found, and a toast says the reference could not be saved. Where that read found the server out of reach it could not tell either way, and the server may yet make the choice: there is no toast then, and the line under the legend says the reference can't be changed.
  - Any other refusal shows the refusal's own message, which is the plugin's and in English, and changes nothing on screen.
- **A recipe the Library doesn't have yet,** which the plugin refuses as `noSuchRecipe`, as one made on the page a moment ago: it reads as no reference. Make reference is offered, and the refusal's message says why it did not work.
- **While the server can't be reached** the plugin answers from the copy it keeps on the tablet, and the skin draws it. The reference can't be changed then. Make reference is shown muted, and a line says "Decent Sync can't be reached, so the reference can't be changed".
  - The line has a line of its own under the legend, because the legend's row has no room for it, and the graph gives up its height. It stays through a shot, so the graph does not change height as one starts.
  - Where the reference can't be read at all, because the tablet has no copy, as for a recipe in no slot, none is drawn, there is no Make reference, and the line reads "Decent Sync can't be reached, so the reference can't be shown". So too when Decaid answers in the plugin's place.
- **A reference chosen elsewhere** arrives over the plugin's `changes` socket.
  - A push that names the recipe in the graph has its Shots read again, and the graph is drawn again only if the latest Shot or the reference is another than the one drawn. A push may repeat, as when the Recipe is renamed, and then nothing is drawn.
  - Decent Sync also pushes when the Reference Shot's rating or note changes. The reference's row is then written again, and the graph is not drawn again.
  - When the socket opens, and when a push says the connection came or went, the status is asked and the reference read after it.
  - A push with a `what` the skin doesn't know is ignored.
  - Only recipes in a slot are pushed. One in no slot is read when it loads.
- **During a shot nothing is read.** The reference's lines stay the ones the shot started with, and the shot's end reads both Shots again.
- **The socket** is opened through one export the fork adds to `api.js`, which uses Streamline's own socket helpers. Streamline's `connectPluginPush` keeps one socket for each plugin and gives it to the plugin's `changed` endpoint, so it could not carry this one as well. It opens once, after the plugin has first answered its status, so a tablet with no Decent Sync opens none. It is never closed, and comes back by itself after it drops.
- **When Decent Sync can't be asked for the reference while Decaid answers,** as for a refusal the skin does not know, the latest Shot is still drawn, and the reference read before stays. One read from the other source does not stay: when the source changes, the reference in the graph is dropped at once, during a shot too, and both Shots are read again. So the tablet's own choice is not left on a Machine Decent Sync has come to serve, whichever read fails next.
- **A choice still on its way when the source changes** is not drawn when it answers. The read that follows the change is.

### Rating and notes

A barista rates the Shot in the graph and writes a note on it, on the Shot's own row of the legend, and sees the rating and note of the recipe's reference on its row.

- **The Shot's row** has five stars after its label, and a note icon before Make reference. The icon is a page, and a page with a plus where the Shot has no note.
- **Only a saved Shot has them.** They are hidden while a shot runs, in the seconds before Decaid has saved it, and where the recipe has no Shot on this machine yet.
- **Nothing says "Tap to rate".** Empty stars beside a Shot say it.

The stars:

- **Whole stars, two points a star,** on Decaid's scale of 0 to 10, where 0 is unrated. A tap writes 2, 4, 6, 8 or 10, as DYE2 and Decent Sync's management interface do.
- **A tap on the chosen star clears the rating.** Only an exact match clears: on a Shot rated 7, a tap on the fourth star sets 8.
- **An in-between rating is drawn part-filled,** so 7 is three and a half stars, as the management interface draws it. One Shot then reads the same in both places.
- **A tap saves at once,** with no confirmation, and the stars change as they are tapped. If the edit fails they go back to what they were, and a toast says so. A tap made while another rating is still on its way is not taken.
- **Stars, rating and back are worked out in `src/cafe/remarks.js`,** which touches no browser global.

The note:

- **The fork's own dialog, with a plain text box,** not Streamline's notes editor. That one is a full-screen Markdown editor, and DYE2 and the management interface show a note as plain text, so its marks would show raw.
- It names the Shot as its row does, with when it was pulled and by whom, and has a box labelled "Note", Cancel and "Save note".
- **The text is trimmed, and an emptied note clears it,** as in DYE2. The box takes at most 40,000 characters, the plugin's limit. A note saved as it was sends nothing.
- **While a note is being saved the box takes no typing,** and Cancel and Escape do nothing: what is saved is the text as it stood at the tap.
- **A note that could not be saved is not lost.** The dialog stays open with its text, and a line in the dialog says why. It is not a toast: the dialog is drawn over everything else on the page, a toast included.
- **A shot that starts closes the dialog,** as it closes the page's other dialogs: starting one is the barista's own choice. A note being written then is not saved, and one whose save was already on its way still is. A tap outside the dialog does not close it, so a stray tap does not throw away what was typed.
- **A note is text, never markup.** It is written into the page as text.
- **The soft keyboard.** This is the page's first text field. Streamline lays the page out for the window with no keyboard and lifts its canvas to keep a focused field in view, which does not move a dialog. So the dialog says it fits itself (`data-keyboard-fit`), as Streamline's own full-screen editors do, and takes the height Streamline's scaling reports as left above the keyboard, with the text box giving up what the box lacks. That height is in screen pixels and is set on the dialog itself, so its canvas turns it into design pixels. The smoke run checks it with a simulated keyboard (step 19: 360 pixels at 1340 by 800, through Streamline's own scaling); a real tablet's keyboard is checked by hand.

The reference's row:

- **Read only.** Its rating is one star and the number, "★ 4" or "★ 3.5", and its note icon opens the note in a dialog with only a Close button, showing the same when and who, and the rating. Each is hidden when there is none.
- **Where they come from.** On a Machine Decent Sync serves, the plugin's answer. Otherwise the Shot's own record on the tablet.
- **When the latest Shot is the reference,** its rating and note are edited on its own row, as for any Shot.

Where an edit goes:

- **The plugin on a Machine Decent Sync serves, Decaid's own Shot edit otherwise,** the rule the reference follows. Before the plugin has said whether the Machine is served, the edit goes to Decaid: the Shot in the graph is then the tablet's own.
- **The tablet's own Shot is edited with the server or without it:** the recipe's latest Shot, "Last shot" with no recipe, or one of its own opened from the Shots list. For such a Shot the plugin's call is Decaid's own edit, so it works while the server can't be reached and on a Capture-only Machine.
- **Another Machine's Shot,** opened from the Location's list, is edited by the same call, which the plugin then sends to the server. It is made now or not at all: see [The Location's Shots](#the-locations-shots).
- **Only the field edited is sent,** by either route. A rating leaves the note alone, and the reverse. To clear a rating 0 is sent, and to clear a note empty text. Decaid merges what it is sent into the Shot's annotations key by key, so every other annotation is kept.
- **An edit that may have been made is read again before it is shown as failed:** one the plugin answered `unreachable` or `serverTooOld`, or Decaid answered with no `code`, or that was not answered at all, and any failure of Decaid's own edit, which does not say why it failed. The Shot is read from Decaid where the tablet holds it, and through the plugin where it is another Machine's. If it holds what was asked for, the edit was made. If not, the row follows what the read found.
- **Any other refusal shows its message,** which is the plugin's and in English, as for Make reference, and changes nothing. One is read again first all the same: `shotUnwritten`, which the plugin also answers when Decaid did not answer its own edit, and Decaid may have made it. Its message shows only if the Shot does not hold what was asked for.

Which Shot, and when:

- **"Last shot", with no recipe loaded, is rated and noted too.** Streamline's history module hands the chart that Shot's measurements and Workflow and no record. So the page asks the seam for the tablet's newest Shot, whole, and takes its id, rating and note only if its first sample is the one the chart was handed. Until that read answers, and where the newest Shot is another, the row has no stars: they never act on a Shot other than the one drawn. No hook is added to Streamline's files for it.
- **An edit made elsewhere shows at the page's next read:** a recipe load, the page coming back into view, or a shot ending; for an opened Shot, also Decent Sync's server coming into reach or going out of it, and the read again of another Machine's Shot muted during an outage. That covers DYE2 on the same tablet and the management interface. Nothing is pushed for a Shot's edit, and no timer reads a Shot that can be changed.
- **After the page's own edit** the row shows what the edit answered, for the rating or the note it was of. The answer's other half is left: a rating still on its way when a note is saved would otherwise put the note back as it was. A read that began before an edit of that Shot is older than the edit, and does not put the old rating back, on the Shot's own row or on the reference's.
- **A change of rating or note never draws the graph again.** Only the legend's rows are written.

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

## The Shots list

A barista opens a list of Shots and taps one to see it in the graph, in the latest Shot's place, where it is rated, noted and made a reference as the latest is. The first two parts of this section are what the list does from the tablet's own Shots, which is what a tablet without Decent Sync does for good. On a Machine Decent Sync serves the list is the Location's, behind the same requests to the Shot seam: [The Location's Shots](#the-locations-shots) says what that changes.

### The list

- **The Shots button** is a third button with Settings and Sleep, the same size, and moves with them when the on-screen machine buttons show. While a shot runs it takes no taps, and a shot that starts closes the list, as it closes the page's other dialogs. A list still being read when a shot starts or the page goes behind another is not shown. When the Machine changes between served by Decent Sync and not, an open list closes and the kept one is dropped, since its chips were the other source's.
- **A dialog titled "Shots",** newest first, under a header for each day: "Today", "Yesterday", then the date, in the page's language. With no Decent Sync the header says no more than "Shots"; with it, the header says where the list comes from (see [The Location's Shots](#the-locations-shots)). A day's header gives no count: Decaid's list has a total, the plugin's has none, and a day cut by a page's edge would count wrong.
- **A row** gives when the Shot was pulled, its recipe's name over its bean, its dose and yield, its rating, the barista, and a note icon where it has a note. A Shot that is its recipe's reference carries a "Reference" chip. The row of the Shot in the graph is highlighted.
  - The dose is the one the Shot weighed, or where it weighed none the one its Workflow set. The yield is the one Decaid kept, which is the scale's last reading where the shot was not stopped on weight; a Shot with none shows "—".
  - An unrated Shot reads "Not rated", as in the mockup.
  - **No Time column and no Unfinished mark in the tablet's own list.** A row of Decaid's list carries no measurements and no duration, and reading every listed Shot whole to work them out is what Streamline's rules forbid for a list. The Location's list adds both, because its rows carry them.
  - **A recipe's name comes from DYE2's records,** because a row of Decaid's list names its recipe by its DYE2 record id only. A Shot whose recipe the tablet no longer holds lists and opens as a Shot with no recipe. So the list reads DYE2's records as it opens, and one whose records can't be read does not open: every Shot in it would read as one with no recipe.
  - **The "Reference" chip is the choice kept on the tablet,** read through the Shot seam where the tablet is where references are kept. On a Machine that is or may be served the choice kept on the tablet is never read, so the tablet's own list shows no chip there: before the plugin has said whether the Machine is served, and while the server can't be reached. The Location's list carries each row's own word. A choice that can't be read leaves the rows without their chips.
- **What a row says is worked out in `src/cafe/shot-list.js`,** which touches no browser global, from a Shot as the seam lists it and DYE2's records. `src/cafe/shots-dialog.js` draws it.
- **A page at a time.** 50 rows are read when the list opens, and the next 50 as the list is scrolled near its end. There is no button for it. Decaid's list is ordered by time and read by offset, so a Shot pulled since the page before moves every row down one: the row the next page starts with is already listed, and is not listed twice.
- **A list that can't be read is not an empty list.** A toast says so and the list does not open, as for the recipe list. A later page that can't be read leaves the rows there, says so at the end of the list, and is tried again at the next scroll. An empty list says there are no shots yet.
- **The list keeps its place while a Shot opened from it is in the graph:** its rows and where it was scrolled to, so several Shots can be opened one after another. A rating or note changed on the page is written into the kept row, and a reference made on the page moves the recipe's chip. Once the graph is back on the latest, the next opening reads the list afresh.

### An opened Shot

- **A tap on a row** closes the list and puts that Shot in the graph once it has been read whole: its lines and its reference's, on the main graph and the full-screen chart, and on the main graph its row of the legend with the stars, the note and Make reference, the comparison row and the stage names. The full-screen chart leaves those out, as it does for the latest. Until the read answers the graph keeps what it shows. A Shot that can't be read, or has gone, leaves the graph as it was, and a toast says so.
- **"Back to latest"** appears in the title band, beside the machine's status. It returns to the Shot that was there: the latest is kept while a Shot is opened, drawn again at once, then read again and drawn again only if it or its reference is another by now. The latest's own row in the list is "Back to latest" too, not an opened Shot.
- **Its label.** "Viewing" for a Shot of the loaded recipe, the recipe's name for a Shot of another, and "No recipe" for a Shot pulled with none. A recipe's name gives way in a narrow legend as the times do.
- **A Shot of another recipe keeps its own.** The graph, the legend and the comparison row follow the Shot, with its own recipe's reference behind it and "Different profile" judged against that recipe's profile. The header and the dial-in column stay on the loaded recipe. Make reference sets the Shot's own recipe's reference, and its confirmation names that recipe. Where the Shot is one of the loaded recipe's, the latest is shown with that reference on the way back.
- **A Shot pulled with no recipe** has no reference and no Make reference.
- **Every row opens, an Unfinished Shot's too.** It is drawn as it is. Once read whole it is known to be Unfinished, by the rule the latest Shot uses, and it has no Make reference: the server does not refuse an Unfinished Shot as a reference, so the page withholds the button itself. It is rated and noted as any Shot.
- **An opened Shot that is its recipe's reference** shows "This shot is the reference", as the latest does.
- **The reference and the edits go through the seam as they do for the latest,** so on a Machine Decent Sync serves an opened Shot's reference is already the Recipe's Reference Shot.
- **With no recipe loaded** the list opens and a Shot opens, with its own recipe's reference. "Back to latest" then returns to "Last shot".
- **An opened Shot is a state of `src/cafe/graph-state.js`,** beside the latest it goes back to.

What ends it, and what does not:

- **The graph goes back to the latest** on "Back to latest", when a shot starts, when a recipe is loaded or unloaded, and when the Machine changes between served by Decent Sync and not. A shot that starts with a Shot opened draws live with the loaded recipe's reference behind it, and the latest is in the graph when it ends. An open still on its way when one of these happens is not drawn when it answers.
- **Nothing else ends it.** There is no timeout. It stays through a trip to the settings page and the page going out of view, after which the Shot and its recipe's reference are read again, for an edit made elsewhere, and drawn again whatever the read finds, since the way back clears the chart; a Shot that has gone gives way to the latest, and one that can't be read is drawn as read before. The history module's request to draw is turned down and taken as the same cue. A reference push for the opened Shot's own recipe has it read again, and drawn again only if the Shot or its reference is another; one for the loaded recipe is left for the way back. A reference made, or pushed for its recipe, while another row's Shot is still being read has that Shot read again; where that tap fails, the Shot in the graph is read again. A tap on the opened Shot's own row leaves a read of it on its way. A Shot reopened while an edit of it was being saved is read again once the edit has ended. A reload shows the latest.
- **A finished shot still waiting to be saved** when a Shot is opened loses its live lines to that Shot. The looks for it stop, and the history module's request once it is saved, or the way back to the latest, reads it.

### The Location's Shots

On a Machine Decent Sync serves, the list is every Shot at the machine's Location, whichever Machine pulled it, and a Shot another Machine pulled opens, is rated, noted and made a reference like any other. The plugin answers the seam's two requests, so nothing above the seam changes but what the list and the legend say. The contract is "The Location's Shots", "A Shot whole" and "Editing a Shot's rating and note" in Decent Sync's [`docs/PLUGIN.md`](https://github.com/loganfuller/decent-sync/blob/main/docs/PLUGIN.md).

Which Shots are listed, and what the list says of it:

- **One function of the status** decides (`shotsList` in `src/cafe/sync-status.js`), and what the header says is a function of its answer (`listHeader` in `src/cafe/shot-list.js`).
  - A served Machine: the Location's Shots, through the plugin's `shots` request, 50 rows a page, by its cursor. The Location's name stands under the title, from the status. The plugin gives no total and no list of the Location's Machines, so the header names the Location and nothing else.
  - A Capture-only Machine, or the wrong hardware: the tablet's own Shots, under "This machine only", with the line "This machine isn't at a Decent Sync Location, so only its own shots are listed."
  - The server out of reach (`unreachable`, `serverTooOld`): the tablet's own Shots, under "This machine only", with the line "Decent Sync can't be reached, so only this machine's shots are listed." The plugin keeps no copy of the list on the tablet, as it does of a reference. So a served Machine's reference stays with the plugin through an outage while its list is the tablet's own.
  - No plugin at all, or one switched off: the tablet's own Shots, under "Shots" and no more.
  - Before the plugin has said whether the Machine is served, as when Decaid itself has not answered or the plugin is still loading: the tablet's own Shots with no line. Once an answer has come, one that says nothing either way leaves the last standing.
  - A refusal the skin does not know: the tablet's own Shots, under "This machine only", with the refusal's own message, which is the plugin's and in English.
- **The line is in the dialog,** under its title, with the icon the mockup gives it. It is not a toast: it stays while the list is open.
- **A refusal of the list itself** that means "the tablet's own Shots" (`unreachable`, `serverTooOld`, `captureOnly`, `hardwareMismatch`, or Decaid answering in the plugin's place) is answered from the tablet at once, under the line for that refusal, and the status is asked again. On a later page the list is read afresh from the tablet, from its newest Shot, and scrolled to its top: a cursor of the plugin's means nothing to Decaid. The tablet's list then goes on page by page, though the status still says the Machine is served, as while a tablet catches up after an outage, when the plugin refuses the list as `unreachable`; the list opened afresh is asked of the plugin again. Any other failure is a list that can't be read: a toast for a first page, the line at the end of the list for a later one.
- **A Machine that turns Capture-only, or is served again,** changes what is listed at the next status answer, with no reload. The kept list is dropped, and an opened Shot gives way to the latest, as for the reference. A list open or on its way is read again in place, so a tap is not lost: the list's own refusal, as `captureOnly` for a Machine whose sharing was turned off since the status was last asked, has the status asked, and its answer is such a change. A served Machine moved to another Location, through an outage too, is told the same way: the list, the references, an opened Shot and a choice of reference on its way were the other Location's. A Location renamed is the same Location.
- **Nothing is pushed for a Shot pulled or edited,** so the list is read when it opens, and an opened Shot is read again when the page comes back into view. A cursor stays good while Shots are pulled, so a Shot pulled since the first page is in no later one. It belongs to the Location that gave it: a Machine moved to another reads its list afresh.

What the Location's list adds:

- **A Machine column,** after Pulled, naming the Machine that pulled the Shot, with "This machine" under this one's name. This Machine is the one the status names, by its id on the server.
- **A Time column,** after Dose → yield: how long the Shot ran, its Preheat left out, as the server gives it.
- **Unfinished Shots are marked,** in the rating's place and muted, where the Shot has no rating. A rated Unfinished Shot shows its stars.
- **The "Reference" chip is the row's own word:** the Shot is the Reference Shot of one of the Location's Recipes, which may be another than the one it was pulled with. A reference made on the page moves that recipe's chip in the kept list, and a Shot that is another Recipe's reference too keeps its chip.
- **A row's time is the server's,** in UTC, shown in the tablet's own time.

A row of either source:

- **Becomes the same thing above the seam,** so the list and the graph never ask which source answered. `tabletRow` in `src/cafe/tablet-shots.js` and `locationRow` in `src/cafe/plugin-shots.js` each make it, and a test holds the two to one shape. What a source does not know is null: Decaid's row has no duration, no Machine and no word on whether the Shot is Unfinished.
- **A recipe is named by its DYE2 record on this tablet** where the tablet holds one. One it holds no record of, as another Location's Recipe, lists and opens under the name the server gives, with no reference and no Make reference: the plugin reads and chooses a reference by DYE2 record id only.
- **A Shot the server ties to no Recipe** lists and opens as "No recipe".

Another Machine's Shot, opened:

- **A Shot is asked of Decaid first, then of the plugin.** This tablet's own Shot is read from Decaid, as ever, with the server or without it. One Decaid does not hold is another Machine's, and is read whole through the plugin's `shot` request, one at a time: a read asked while another is on its way waits for it, whether it is a tap, a read again or the read after an edit. Every Shot's id is Decaid's own, on the server too, so the same id goes to both. The row's `onThisTablet` is not used for it: a Shot deleted from this tablet since is still read, through the plugin.
- **It opens as any Shot does:** its lines, its legend row, its comparison row, the stage names, and its own recipe's Reference Shot behind it. The legend says when it was pulled and by whom, and never where.
- **The legend's time is the record's own,** which is the pulling tablet's local time with no offset, read as this tablet's, as the Reference Shot's is. The list's time is the server's instant. The two agree wherever the tablets keep one time zone, as at one Location.
- **Its rating and its note are saved through the plugin,** with the server up, by the seam's edit. The kept list's row follows, and the list read afresh shows them from the server.
- **Make reference** sets its own recipe's Reference Shot, and a refusal shows its message.
- **A reference chosen elsewhere for the opened Shot's recipe** is followed, as one for the loaded recipe is.
- **A Shot the Location's list no longer lists,** which the plugin refuses as `noSuchShot`, is gone: one tapped says it could not be read, and one in the graph gives way to the latest.

While the server can't be reached:

- **Another Machine's Shot already in the graph can't be changed.** Its stars and Make reference are shown muted and take no tap. Its note opens to read only, and where it has none the icon takes no tap. One line under the legend says "Decent Sync can't be reached, so this shot can't be changed". It is the line Make reference has during an outage, not a toast, and it takes the place of the reference's own line: one line says why nothing of the Shot can be changed.
- **The seam says so.** Its answer for a Shot says whether the Shot can be changed now, and a read that fails because the server can't be asked for another Machine's Shot says that too. The page reads the opened Shot again when the plugin's connection comes or goes, and when a status answer says the server came into reach or went out of it, so the Shot is muted when the server drops and can be changed again when it is back, with no reload. The plugin refuses Shots for a while after its connection comes back, as its tablet catches up, so a muted Shot is also read again on its own: 10 seconds later, then twice as long each time, to 5 minutes, until a read finds the server. A read begun before the Shot was muted does not undo it. The Shot stays in the graph as read before.
- **This tablet's own Shot is rated and noted as ever:** the plugin's edit of it is Decaid's own. Its Make reference is muted with the line the page has for the reference.
- **An edit on its way when the server drops** is read again through the plugin before it is shown as failed. Where that read can't ask the server either, or reaches nothing, nothing is known either way, and the server may yet make the edit: there is no toast, the stars go back to what they were, and the line shows. A note being saved then stays in its dialog, with the same line in the dialog.
- **Another Machine's Shot tapped in a kept list** can't be read then: a toast says the shot could not be read, and the graph stays as it was.
- **An edit of another Machine's Shot is never queued.** Refused, it changes nothing, then or later.

## The grinder, bean and basket dialogs

A tap on the name under Grind, Dose or Yield opens a dialog listing what the tablet offers, and a tap on a row chooses it. The grinder's, the bean and batch's and the basket's are built; the profile's comes last, and the change it makes is built (see [Changing the profile from the dialog](#changing-the-profile-from-the-dialog)).

- **One dialog for every pick** (`src/cafe/pick-dialog.js`): a title, a line under it, Close, and rows of a name over a detail, the one in use marked "In use". A tap outside closes it, as Close does. The bean's has a second list on the left, whose rows choose nothing: a tap there shows that row's own list on the right, and may change the line under the title. The barista's has a row set apart under its list that turns it into a text field (see [The barista](#the-barista)). A list with no rows says so in a line of its own. What a row says, and what a choice writes, are worked out in a module of each dialog's own that touches no browser global (`grinder-model.js`, `bean-model.js`, `basket-model.js`).
- **The tap.** A row's name and the line under it are one button, on Dose, Yield and Grind alike. The value still opens the numpad. Nothing on the row opens one of DYE2's pages: Streamline wires a tap on `#grind-label` that opens DYE2's grinder page, and each label sits inside its button with no pointer events of its own, so a tap lands on the button and never passes through the label.
- **When it opens.** Not while a shot runs, a recipe loads, the strip is arranged, another choice is still being written, or the main page is behind another. A list still being read when a recipe load begins or ends is not shown, since the row in use it read may no longer be. A shot that starts closes it, as it closes the page's other dialogs.
- **A list that can't be read is not an empty list.** A toast says so, and the dialog does not open. A write that fails says so, and leaves the row as it was.
- **A choice writes the Workflow and nothing else,** in one write, under a writer in Streamline's table of Workflow writers: `cafe.grinder` and `cafe.basket`, which the fork declares (see `UPSTREAM_EDITS.md`), and for a batch Streamline's own `beans.select`, which its bean picker writes with. The skin writes no DYE2 record for it, with Decent Sync or without; the profile is the one choice that does. A tap on the row in use closes the dialog and writes nothing. There is no "None" row: nothing clears what a row names.
- **It waits its turn.** A choice is written after any dial-in change still on its way, and a recipe tapped meanwhile loads after it, so the writes reach the Workflow in the order they were made. The dial-in rows take no taps until it is written, as while a recipe loads. A choice still waiting when a shot starts is not written, and a toast says so.
- **Who saves it.**
  - On a Machine Decent Sync serves, with a Recipe loaded, Decent Sync records a grinder, or a batch of the Recipe's own Bean, from the Workflow as the Recipe's, writes it into the Recipe's DYE2 record on every tablet at the Location, and into the Workflow of each Machine that has the Recipe loaded. The name under the row there follows with no tap: Decent Sync's plugin has DYE2 announce the change on its `changed` socket, which Streamline's plugin surfaces already listen to, and they ask the page to read the Workflow again.
  - A batch of another Bean stays this Machine's own there: the Recipe stays loaded and is not changed (decent-sync ADR-0022, "What stays the Machine's own"). A Recipe that names no Bean takes the batch together with its Bean. If another Bean is ever to be saved onto the Recipe, that is a change to Decent Sync, not a record write from the skin.
  - A basket is saved by DYE2 when Decent Sync's plugin asks it to save the dial-in, as the numbers are, and reaches the Recipe as the tablet's edit of its record. Decent Sync keeps it only where it is one of the Library's Baskets; ADR-0022 lists a gap it accepts, where a basket picked before DYE2 has noted its starting point is saved late or not at all.
  - Without Decent Sync, or on a Capture-only Machine, a choice is this machine's until another recipe loads: loading the recipe again brings back its own. A dose change isn't saved there either. To keep a choice, a barista makes a recipe of what the machine is set to: "Replace with a new recipe" on the card.
  - With no recipe loaded it changes this machine only.
- **The line under the title says which.** With a recipe loaded: its name, then "saved to the recipe" where the dial-in column's label says so and "not saved to the recipe" where it says that. With none: "No recipe loaded · changes this machine only". It follows the same answer as the column (`pickSubtitle` in `src/cafe/page-model.js`). In the bean dialog it follows the bean highlighted on the left: where Decent Sync saves and that bean is not the Recipe's own, it reads the recipe's name, then "a different bean changes this machine only" (`beanSubtitle` in `src/cafe/bean-model.js`).
- **During an outage the line stays as it was,** as the column's label does. The Workflow is changed at once, and Decent Sync records the choice once the server is back, unless the recipe is loaded again first, which puts the record's grinder back.
- **No Location's name in a dialog.** A tablet without Decent Sync has none.

### The grinder dialog

- **"Grinder", with the tablet's grinders that are not archived,** sorted by name. A row is the grinder's model, else its name, else "Unnamed", over its burrs where Decaid holds them (the burr set's name, else its type) and "last used at" and the setting where a Shot gives one. An archived grinder the Workflow names is still named under Grind, and no row is marked.
- **Where it was last used.** The newest of the grinder's five latest Shots on this tablet that holds a setting, read through the Shot seam from the tablet's own Shots, on a Machine Decent Sync serves too. A setting that is not a number ("15 clicks", a preset's name) is shown and written as the Shot holds it; a number is shown without the zeros a stepper writes.
- **What a choice writes** (`src/cafe/grinder-model.js`): the grinder's id and model; the setting it was last used at, else its own default (`settingDefault`, which DYE2 keeps on the grinder, held to its range, and Decent Sync shares across the Location), else nothing, so the number stays as it is; and that Shot's RPM, else the grinder's own default, else none, cleared as DYE2's own picker clears it.
- **One write.** Decent Sync gives the Recipe the setting the Workflow holds after the grinder changes, so a second write for the setting would have the Recipe take the old setting first.
- **The row after a choice.** Before the rows take taps again the page paints the new number and gives the − and + the new grinder's step and range, as Streamline does once it reads the Workflow again, so a step made at once starts from the new grinder's. Streamline's own read follows. The setting is also kept as the profile's own grind, as a grind set on the row is, so a profile sent again, as on waking with no recipe loaded, does not put the old grinder's number back.
- **No marks under `context.extras.dye`.** DYE2's picker sets them to tell Streamline's after-shot clear which fields it wrote, and Streamline from v0.2.28 clears only the note.

### The bean and batch dialog

- **"Bean and batch", with two lists side by side.** On the left, under "Bean", the tablet's beans that are not archived and have a batch that is not archived, sorted by name: each bean's name over its roaster and how many batches it has. On the right, under "Batches", the highlighted bean's batches that are not archived, newest roast first: "Roasted" and the date over the days off roast, counted in calendar days to the tablet's today. A batch with no roast date reads "No roast date", with no second line, after the dated ones.
- **It opens on the bean in use,** with its batch marked "In use": the bean of the batch the Workflow names, read with the archived batches too, so a batch finished since still says which bean is in use; else the listed bean with the Workflow's name and roaster; else the first. A batch in use that is not listed is still named under Dose, and nothing is marked.
- **A tap on a bean shows its batches and chooses nothing.** A tap on a batch chooses it and closes the dialog. With no bean listed, the dialog says "No beans with a batch".
- **What a choice writes:** the bean's name, its roaster and the batch's id, under `beans.select`, as Streamline's own bean picker writes them (`currentBeanContext` in `src/modules/bean-selection.js`). The row then names the bean with the new batch's roast date, once the page has read the Workflow again.
- **The Recipe's own Bean** is the one its DYE2 record names: its `beanId`, or failing that the bean of its `beanBatchId`, read on its own where it is not among the listed beans' batches. A record that names neither has no Bean, so every batch reads "saved to the recipe" where Decent Sync saves.
- **Decaid answers each bean's batches by itself,** so the dialog reads the beans, then each one's batches, archived ones included, before it opens. Any of them failing is a list that can't be read.

### The basket dialog

- **"Basket", with DYE2's baskets that are not archived,** sorted by name, with no heading over the list. A row is the basket's name, else "Unnamed", over its size and its diameter. DYE2 v0.1.40's baskets have no `archived`, so every one is listed there. With none, the dialog says "No baskets".
- **DYE2's store key `baskets` is the list,** read through Streamline's `getDye2KvArray`, which answers a read that failed apart from an empty list. Decaid has no basket route of its own. On a Machine Decent Sync serves, the list is the Baskets the Location shows.
- **What a choice writes:** the basket's id and its name, else "Unnamed", under `cafe.basket`, as DYE2's own picker writes them. A basket in use that is not listed is still named under Yield, and nothing is marked.

## The barista

A barista says who is at the machine, and the Shots pulled there carry that name until the machine next sleeps. Decaid copies the Workflow's barista (`context.baristaName`) into each Shot as it stores the Shot, once the shot has settled (up to its 4 s backstop after the pour ends), so the name is the Workflow's, and the page keeps no copy of it anywhere: DYE2's dashboard field and the page always agree.

- **The button** is in the title band, after the recipe's title and before "Back to latest" and the machine's status, on every state of the page. It shows a person icon and the Workflow's barista, quiet, outlined as a dial-in pick's row is. With none it reads "Barista" in the accent colour, since it is the only prompt to pick one; nothing ever asks for a barista before a shot, or blocks one. A name too long for it ends in "…", and the dialog shows it whole. It follows the Workflow as the dial-in's names do, read at the same moments (see [Recipes and the strip](#recipes-and-the-strip)), so a name set in DYE2's dashboard shows without a tap once the page reads the Workflow again.
- **The dialog** is the page's pick dialog (see [The grinder, bean and basket dialogs](#the-grinder-bean-and-basket-dialogs)), titled "Barista", with "Named on this machine's shots · cleared when the machine wakes" under it, the same with Decent Sync and without, since nothing here is saved to a recipe. Its rows, worked out in `src/cafe/barista-model.js`:
  - the name in use, first, where no Shot read carries it (one just typed, or an old one), marked "In use", with no second line;
  - each name on recent Shots once, most recent first, as the name over "Last shot" and when. Two names that differ only in case or the spaces around them are one barista, as Decent Sync folds them, shown under its most recent spelling. A Shot with no name adds no row;
  - "No barista", over "Shots record no name", marked "In use" where there is none.

  Under the rows, set apart, "New barista". The recent Shots are the Shot seam's first page: the Location's on a Machine Decent Sync serves, and this tablet's own otherwise and while the server can't be reached. A name drops off once its Shots are no longer among them. A list that can't be read still opens the dialog, with the name in use, "No barista" and "New barista".
- **A new name.** "New barista" turns the same dialog into a "Name" field with "Back" and "Use this name". The name is trimmed, one that matches a listed name but for case is that listed name, and an empty one does nothing: "Use this name", and the keyboard's own key, do nothing while the field holds only spaces. The dialog fits itself above the soft keyboard, as the note's does.
- **A choice writes the Workflow's barista and nothing else,** in one write under `cafe.barista`, a writer the fork declares for that field alone (see `UPSTREAM_EDITS.md`): a name, a typed name, or "No barista", which clears it with an explicit null. It waits its turn behind a dial-in change still on its way, as a pick does. A tap on the row in use writes nothing; a typed name is written unless it is the name in use spelled the same. Whether a choice is the name in use is weighed as it is made, against the name the button shows then. A write that fails is a toast, and the button keeps the name the Workflow holds. A change of the name alone does not unload the recipe or mark it changed: DYE2's selection does not compare it, and its `record` never saves it.
- **A recipe load keeps the name.** Streamline's apply sends the barista as a null for every recipe that names none, which on a Machine Decent Sync serves is every recipe, and a recipe that does name one would put that name back. The barista belongs to the machine at that moment, not to a recipe, so the fork's hook in `applyRecipe` leaves the name out of the write (see `UPSTREAM_EDITS.md`), whatever the recipe's record holds.
- **Sleep clears the name.** Whenever the page sees the machine asleep, as it goes to sleep or when the page opens on a sleeping machine, it clears a name that is set, so every wake starts with no barista, however the machine was put to sleep or woken. It hears the sleep from the fork's hook in `api.js`'s machine socket, and reads the machine's state once as it starts, for a sleeping machine that sends no frame. The clear writes only when a name is set, so a sleeping machine is not written to again and again: each write is a Workflow change Decent Sync stores. The machine going to sleep also closes the dialog, typed text included, so it does not sit over the screensaver, and no name chosen there outlasts the clear. A clear that fails is logged, not shown, since the screensaver covers the page. Known and accepted: if the machine sleeps and wakes while the page is not running at all, the old name stays.
- **During a shot** the button shows the name and does not open the dialog: Decaid names a Shot from the Workflow as it stores it, so a change then would rename the running shot. A choice made, or a sleep seen, within five seconds of a shot's end waits out the rest of them before it writes, so it neither renames nor un-names the Shot Decaid is still to store; those waits end in the order they began, so a sleep's clear comes after a choice made before it. The button shows such a choice at once, and the Workflow's name again if the write then fails. A shot that starts closes the dialog, typed text included. It does not open while a recipe loads either, or while the strip is arranged or another choice is being written.
- **The pick is this machine's.** It is not shared with the Location's other machines, and it is a name only: no PIN, and no tie to a Decent Sync account.

## Changing the profile from the dialog

This is the riskiest behaviour in the design, so it is built last and behind a trial. The change itself is built (issue #50) and nothing on the page calls it yet: the Brew row takes no taps. The dialog comes next (issue #51), and calls `changeProfile` in `src/cafe/profile-changer.js`. What the change decides is worked out in `src/cafe/profile-change.js`, which touches no browser global, and a recipe's name in `src/cafe/recipe-name.js`.

Streamline unloads the recipe on every profile switch, and DYE2 unloads a recipe whose Workflow moves to a profile that is neither the one the Workflow had when the recipe was loaded nor the recipe's own. So the skin writes the new profile into the recipe's DYE2 record first, then the Workflow, through none of Streamline's profile-switch paths. There is no fallback: nothing sends a barista to DYE2's editor, and there is no dialog that shows a description only.

- **With a recipe loaded: the record first, then the Workflow.** The record takes the new profile through the fork's one writer: its id in Decaid (`profileId`, which Decent Sync reads as an edit of the Recipe's Profile), its title (`profileTitle`, which the page's cards, lists and "Different profile" read), its snapshot and the profile inside the record's own stored Workflow (what DYE2 compares the Workflow with, and what loading the recipe writes), and the recipe's brew temperature (`dashboardVariables.brewC`). The rest of the record, its stored Workflow's context among it, is kept. A record with no stored Workflow is given none. Only once the write is confirmed is the Workflow written, in one write under `cafe.profile`: the profile alone, never the recipe id or the dial-in. A record write that can't be confirmed writes no Workflow, and everything stays as it was.
- **The profile is written as Decaid holds it,** from Decaid's own profile record, in both writes, so the record's copy and the Workflow's agree by DYE2's comparison after Decaid's round trip. Every one of the 73 profiles a fresh Decaid v0.9.2 holds does, through Streamline's `updateWorkflow` (seen on headless Decaid, 2026-11-18). Only a profile Decaid holds a record for, with steps, can be chosen.
- **The machine stops at the recipe's yield.** The profile in the Workflow takes the Workflow's yield as its stop weight, as Streamline's own profile sends fold it, and the record's copies take the recipe's own yield, so loading the recipe again stops at it too.
- **Brew takes the new profile's own temperature,** its first step's as Decaid holds it, not one Streamline saved for that profile, and the record takes it as the recipe's brew temperature, so every Machine at the Location with the Recipe loaded gets the same. Decent Sync's management interface keeps the Recipe's temperature when its Profile is edited there; that stays as it is.
- **Dose, yield and grind stay as they are,** and so do steam, hot water and flush.
- **A name DYE2 gave the recipe follows the profile.** DYE2 names a recipe it makes from the first word of its profile's title, its bean and a beverage typed for it, leaves out a word that says nothing ("Default", "Advanced", "Custom", "Profile", "New", "Untitled"), adds the day it was made where there is no bean, and gives a name already taken " 2", " 3" and so on. DYE2 keeps no mark of a name it made, so the page works the name out again: a recipe whose name is the one DYE2's rule gives for its own profile title, bean and beverage, with or without the count, compared without regard to case, and with any day where it has no bean, takes the name the rule gives on the new profile, with the day the old name held, in the same record write, as its `name` and its `title`. Where another record on the tablet has that name it takes the next free count; the record itself never counts against it. Where the rule gives the same name on both profiles, nothing is renamed. A recipe named otherwise keeps its name; a name someone typed that matches by chance is renamed too, and a rule DYE2 changes later leaves older names as they are.
- **With no recipe loaded** the same Workflow write is made and no record is written. Streamline's saved dose, grind and yield for that profile are not applied.
- **A check afterwards.** DYE2 reads its whole list of records, waits, and writes it back, so a record write can be lost seconds after it was confirmed: its save of the dial-in may read the machine's settings over Bluetooth in between, 1.4 to 5.7 s by DYE2's own measure (dye2#40), which a simulated machine does not show. So 8 s after the change, once no shot runs and Decaid has stored the last one, and no recipe load or arrangement of the strip is under way (an arrangement writes DYE2's whole list too), the page reads the record and DYE2's selection again, in its turn as a change is. A record found back on the profile it had is written again; one on any other profile was changed since by someone else and is left alone. Where the same recipe's profile was changed again since, only the later change is checked: the earlier check would read a change back to the first profile as its record set back. A recipe found unloaded is loaded again once, by DYE2's selection request with its id, which marks it loaded and changes nothing else, after the record is seen to hold the profile; not where a tap on the strip has loaded or unloaded a recipe since the change, where DYE2 can't say, where another recipe is loaded by then, or where the machine is on another profile by then. If it is unloaded again, the check says so, and the profile stays the machine's own.
- **Streamline follows at once,** before the dial-in rows take taps again: its active profile, which its per-profile saves go to and the Brew stepper takes the profile's shape from, then, as after a recipe load, the name under Brew, the temperature and the chart's profile. A temperature step afterwards keeps the recipe loaded, since DYE2 compares no step's temperature.
- **It waits its turn** behind a dial-in change still on its way, as a pick does, and keeps the dial-in rows still while it is written. It is not begun during a shot, a recipe load or an arrangement of the strip, or while another choice is written, and one still waiting when a shot starts is not made. A shot, load or arrangement begun while it reads DYE2 and Decaid stops it before its next write.
- **Its answer** says whether the profile was changed, on which recipe, the recipe's new name where it took one, and, with a recipe, what the check afterwards found. Where the record took the profile and the Workflow write then failed, or a shot, load or arrangement began first, the machine stays on the old profile with the recipe loaded, and the answer says so.
- **Streamline's wake profile is left alone.** Where a cafe turns it on, it already replaces any recipe's profile on waking.
- **No wait after a shot's end.** A profile change in the seconds before Decaid stores a Shot changes what that Shot records, as any pick does (`decentespresso/decaid#1199`).
- **On every tablet.** The choice is saved onto the recipe on a Machine Decent Sync serves, on a Capture-only Machine and on a tablet without Decent Sync. The grinder, bean and basket are different because DYE2 keeps a recipe loaded through them, so saving them can be left to whoever saves the dial-in.
- **With Decent Sync.** The server takes the record's new `profileId` as an edit of the Recipe's Profile, on its poll, and with it the brew temperature and a new name, then writes the record on every tablet at the Location and the profile into the Workflow of each Machine with that Recipe loaded. During an outage the record and the Workflow change on the tablet, and the server takes the edit once it is back.
- **The trial.** Both smoke runs call `changeProfile` in the page (`SMOKE.md`, step 25 of the first and step 15 of the second). What they found is in pull request #55's description and on issue #8: the recipe stayed loaded in every case tried.

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
- Before each release, a Playwright smoke run by hand against headless Decaid with a simulated machine, with screenshots on the pull request. It is not in CI yet. It has two setups: Decaid alone, and Decaid with Decent Sync's plugin and a local Decent Sync server, with a second Decaid as a second Machine at the same Location. `SMOKE.md` says how to set them up, and `test/cafe-smoke/` holds the runs and their made-up data.

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
