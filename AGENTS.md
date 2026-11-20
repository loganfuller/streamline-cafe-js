# Agent Instructions

Start with [`docs/AI_REPO_MAP.md`](docs/AI_REPO_MAP.md). Open only the topic note that matches the task. Do not preload every AI note, the user manual, both API schemas, the generated bundles, `src/settings/settings.js`, or the legacy Tcl sources.

## Always

- Preserve existing work. Keep changes focused and do not rewrite unrelated code or documentation.
- Verify behavior in current source, local API schemas, and tests. Older prose, plans, and agent files can lag the implementation.
- Treat machine control, firmware updates, credentials, profile notes, feedback text, and browser-stored data as sensitive. Do not log secrets or inject untrusted text as HTML.
- Ask before destructive or externally visible repository actions. Do not tag, force-push, publish a release, dispatch a workflow, or change repository settings without explicit authorization.
- Use **Decaid** in new prose. Keep compatibility identifiers such as `reaHostname`, REA-named functions, `streamline.js`, and legacy storage namespaces unless a migration is explicitly designed.
- Update an AI note only when a reusable, non-obvious constraint changes. Remove stale guidance instead of accumulating history.

## Hard Rules

- This is a browser-native vanilla JavaScript application. App code is loaded as native ES modules; do not introduce a framework or an app-code bundler for a local change.
- `src/modules/settingsSync.js` must start before `src/modules/app.js`, and code that reads synchronized preferences during boot must await `settingsReady`.
- Put Decaid REST and WebSocket behavior behind `src/modules/api.js` and its existing socket helpers. Do not create a second connection stack in a page or component.
- SPA page mounts must be idempotent. Pair listeners, observers, timers, sockets, chart instances, and temporary DOM with explicit cleanup.
- `src/settings/settings-tree.js` is the only settings-navigation source of truth. Never copy its category list into another module.
- Keep `src/settings/settings.js` off the main-page boot path. Non-extracted settings categories reach it through `src/settings/categories/legacy-category.js`.
- Do not hand-edit `src/css/app.css` or `src/modules/echarts-streamline.min.js`. Change their inputs and rebuild them.
- Preserve the chart live-update path, series ordering, and equal-length `x`/`y` arrays. A full chart redraw on every frame is a regression.
- Make related IndexedDB writes in one transaction. Keep summary-first history paging; do not read every full shot for list views.
- Node tests import DOM-free modules only. Extract pure logic rather than adding jsdom or importing modules that touch `window`, `document`, `localStorage`, or IndexedDB at module load.
- Never broaden credential persistence or copy secrets into the synchronized Decaid KV namespace.

## Change Discipline

- Prefer small pure helpers and existing modules over new globals. Add to `window.app` only when injected HTML or an established cross-page bridge requires it.
- Use the existing logger for production diagnostics and avoid noisy per-frame logging.
- Follow existing naming and module boundaries. Do not perform broad style modernization during a functional fix.
- When HTML is injected by the router, translate it and initialize it through its page or category mount function; do not rely on a fresh `DOMContentLoaded`.
- Source files and generated files belong in the same change when a build input changes.
- Add or update focused `node:test` coverage for pure policy, parsing, state-transition, queueing, migration, and rendering decisions.

## Deep References

- [Repository map](docs/AI_REPO_MAP.md)
- [Runtime and routing](docs/AI_RUNTIME_NOTES.md)
- [Decaid API and WebSockets](docs/AI_API_NOTES.md)
- [Workflow ownership](docs/AI_WORKFLOW_NOTES.md)
- [UI, styling, i18n, and WebView behavior](docs/AI_UI_NOTES.md)
- [Settings architecture](docs/AI_SETTINGS_NOTES.md)
- [Charts](docs/AI_CHART_NOTES.md)
- [Profiles and favorites](docs/AI_PROFILES_NOTES.md)
- [History, IndexedDB, and preference persistence](docs/AI_STORAGE_NOTES.md)
- [Build and tests](docs/AI_BUILD_NOTES.md)
- [Legacy Tcl and experimental references](docs/AI_LEGACY_NOTES.md)
- [Release audit](docs/AI_RELEASE_NOTES.md)

## Streamline Cafe (this fork)

This repository is Streamline Cafe, a fork of Streamline with its own main page. Its design is [`docs/cafe/DESIGN.md`](docs/cafe/DESIGN.md), and the bullets below carry the rules from it that every change needs. Before changing an area, read that area's sections of DESIGN.md by line range (`grep -n '^#' docs/cafe/DESIGN.md` lists them): the section a `src/cafe/` file names in its opening comment, or the one "Design sections by area" below names. Where DESIGN.md and the rules above disagree, DESIGN.md wins.

Scout first: for a task spanning files, send one Explore subagent for a file-and-symbol map, where subagents are available to you, then batch independent lookups into a single turn.

- The skin id is `streamline-cafe.js`. Never build or publish under `streamline.js`: a skin installed under an id replaces the one already there. The storage namespaces stay Streamline's, on purpose.
- Put new behaviour in new files under `src/cafe/`. Change Streamline's own files only through small hooks, and list each one, with any Streamline test you change, in `docs/cafe/UPSTREAM_EDITS.md`.
- Keep the element ids Streamline's modules drive in `index.html`. Where a module needs an element the layout drops, keep a hidden stub instead of editing the module.
- Load a recipe only through Streamline's `applyRecipe`. Never write Streamline's strip mode setting.
- Before changing which recipe is loaded any other way (DYE2's `save-recipe`, clearing its selection, or marking a recipe loaded again), call `forgetAppliedItem()`, the fork's one hook in `src/modules/dyeStrip.js`. Every request to DYE2's selection but a read is in `src/cafe/arrange.js`. Never open one of DYE2's pages from the cafe page.
- Write DYE2's recipe records only through the fork's one writer module, `src/cafe/recipe-writer.js`. A choice in one of the page's dialogs writes no record: it writes the Workflow, through Streamline's `updateWorkflow` under a `cafe.*` writer declared in `src/modules/workflow-fields.js`. Two exceptions, each with a recipe loaded and each written into the record before the Workflow: the profile, only through `changeProfile` in `src/cafe/profile-changer.js`, and a batch of another bean than the recipe's own, only through `changeBean` in `src/cafe/bean-changer.js`.
- Read Shots and the choice of reference, and set a Shot's rating and note, only through the Shot seam, `src/cafe/shot-seam.js`. Keep the page's own state in the `streamlineCafe` namespace, through `src/cafe/cafe-store.js`.
- Speak to Decent Sync's plugin only through `src/cafe/decent-sync.js`. On a Machine it serves, never read or write the reference kept on the tablet.
- Decide which Shot is in the graph, and when the Shots are read again, only in `src/cafe/graph-state.js`. `src/cafe/graph.js` tells it what happened and does what it answers.
- Draw on the graph only through the fork's three hooks in `src/modules/chart.js`: the overlay, the Shot chooser and the live line labels. Lines added to the chart follow Streamline's own, and keep their count and their arrays through a shot. Text on a stage line goes through the fork's hook in `src/modules/echarts-renderer.js`.
- Work out every number under the graph in `src/cafe/comparison.js`, as Decent Sync works it out. Write the live cards only from the chart's own live draw, never from a timer or a second read of the machine.
- Key the cafe page's text with `data-cafe-text` or `cafeText()`, never `data-i18n-key`. A phrase Streamline's translation file lacks goes into `src/cafe/translations.js` in every language Streamline has finished, marked `machine: true` when a machine translated it.
- Leave a part of the screen out until its slice builds it, so every control on the page does something.
- For a change to the main page, run the page tests ([`docs/cafe/TESTING.md`](docs/cafe/TESTING.md)) and put the screenshots they write in the pull request's description from the moment it opens. A new slice writes its closing check as page tests against the fake Decaid. A change to what the page writes to Decaid, DYE2 or Decent Sync's plugin also runs the real journeys that cover it (`npm run test:real`, TESTING.md's "The real journeys"); a pull request that changes the pins, the recorder or the journeys gets the real-stack workflow on its own. A change to what the fake Decaid does adds or records again the scenario that backs it. Sample data is made up: no cafe's names, beans or recipes.
- Adopt Streamline by merging a tagged release in its own pull request, merged with a merge commit and never squashed. Never push Streamline's tags to this repository.
- Do not open issues or pull requests on `decentespresso` repositories from work on this fork.

### Design sections by area

Pick a DESIGN.md section by its heading. These areas sit under headings that do not name them:

- The layout, a control, the dial-in column, rating and notes, or the Shots list: "What the screen shows".
- The "needs DYE2" screen, the long-press menu, or saving the dial-in: "Recipes and the strip".
- What a change does with Decent Sync, without it, on a Capture-only Machine, or with its server out of reach: "Who it is for", then the area's own section.
- The graph's legend, time axis, overlay, or Reference | Targets toggle: "The reference on the graph".
- A Decaid, DYE2 or Decent Sync version the page relies on: "Builds and installs".
- Which of Streamline's modules still run on the page: "How the code is shaped".
- Starting a slice: "Order of work", then the sections for what it builds.
