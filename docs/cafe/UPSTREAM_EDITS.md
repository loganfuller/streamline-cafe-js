# Changes to Streamline's files

Every change Streamline Cafe makes to a file that came from Streamline, so a merge of a Streamline release has a checklist. New files under `src/cafe/`, `docs/cafe/` and `test/cafe-*.test.mjs` are the fork's own and are not listed.

Add a row in the same pull request as the change. Remove a row when the change goes away.

## Lines that conflict at every adoption

Streamline bumps its version with each release, and the fork's version sits on the same lines. Resolve each to the new Streamline version with the counter back at 1, such as `0.2.28-cafe.1`. `test/cafe-version.test.mjs` fails if they disagree.

- `skin-manifest.json`: `version`
- `src/version.js`: `APP_VERSION`
- `package.json`: `version`
- `package-lock.json`: `version`, twice

`src/css/app.css` is Tailwind's output for the page's markup and scripts, and the fork's page is not Streamline's. Don't merge it by hand: take either side, run `npm run build:css` and commit the result. CI fails when the committed file is not what the build writes.

## Identity

| File | Change |
| --- | --- |
| `skin-manifest.json` | The id `streamline-cafe.js`, the name "Streamline Cafe" and the description. |
| `src/version.js` | `SKIN_ID` is `streamline-cafe.js`. |
| `package.json`, `package-lock.json` | The package name, and in `package.json` the three repository links. |
| `index.html` | The page title. |
| `src/settings/settings.js` | The manual button links to this repository's README. `skinRepoSlug` falls back to `loganfuller/streamline-cafe-js`. |
| `README.md` | One paragraph above Streamline's manual saying what this fork is. |
| `AGENTS.md` | A section for this fork, appended at the end. |

## The main page

`index.html` is the fork's own (`DESIGN.md`, "How the code is shaped"), so a change Streamline makes to its page is read and carried over by hand, never merged in. What to look for in Streamline's `index.html` at each adoption: a new or renamed element id that a module reads, a new script or stylesheet in `<head>`, and a change to the two inline scripts there.

| File | Change |
| --- | --- |
| `index.html` | The main page's markup is the cafe layout. It keeps the ids Streamline's modules drive, and hidden stubs for the two history arrows, the history module's four text lines (`#shot-history-info`), the fullscreen toggle, and the steam tile's duration and mode elements. The steam row's − and + are the page's own, not Streamline's. `<head>` gains `src/cafe/cafe.css`. The inline module that started Streamline's strip is gone: `src/cafe/start.js` starts it once DYE2 is known to be there. |
| `src/modules/app.js` | One import and one line at the top of `initMainPageOnce`: the main page starts only when `cafeMayStart()` in `src/cafe/start.js` says so. While it says no, `initMainPageOnce` returns `null` without starting, and the next call asks again. |
| `src/modules/dyeStrip.js` | One added export, `forgetAppliedItem()`, placed just above the "DYE2 page navigation" section, with nothing else in the file changed. It bumps `applySeq`, clears `activeItemId`, `activeModified`, the active item and the parked selection, and sets `dye2Armed` to false, posting nothing. `src/cafe/arrange.js` calls it before DYE2's `save-recipe` and before clearing DYE2's selection, because the cafe page changes which recipe is loaded without an apply, and a selection request of this module's that is still retrying would otherwise put the old recipe back. At each adoption: keep the function, and check it still clears every variable the module keeps about the applied item (compare with `clearSelection`). `test/cafe-source-rules.test.mjs` fails if the export is gone. |
| `src/modules/chart.js` | Two hooks, in one block just above `renderMain`, three lines that call them, and one line in `addStepMarker`. **The overlay:** `setChartOverlay(fn)` keeps a function and draws again. `renderMain` calls it with the chart's own lines, layout and mode, and `'main'`, only when the lines it was given are `chartTraces` themselves, so a profile preview, which is drawn from a copy, never passes through it; `renderExpandedCharts` calls it for the full-screen chart, with `'expanded'`. It answers the lines and layout to draw, and the chart's own are never changed. `src/cafe/graph.js` gives the function: in the Reference view `src/cafe/reference-overlay.js` adds the reference's three lines after the chart's and hides the targets, and on the main chart `src/cafe/stage-names.js` names the stage lines. A live draw of the main chart is also when `graph.js` writes the live cards, from the lines it is handed: it finds each by the name `chart.js` gives it (`Pressure`, `Flow`, `Target Pressure`, `Target Flow`, `°C`, `Target °C`, `Weight`), and takes a temperature as drawn at a tenth. **The stage's name:** `addStepMarker` is handed each step's name and dropped it; one added line keeps it on the shape, as `name`. **The chooser:** `setShotChooser(fn)` keeps a function that `plotHistoricalShot` asks first, with its two arguments; when it answers false the Shot is not drawn. `src/cafe/graph.js` uses it, with a recipe loaded, to draw the Shot the Shot seam answers with where Streamline's history module would draw the tablet's newest. With no recipe loaded, or before DYE2 has said which is, it lets that module draw, and names in the legend the Shot it was handed. `setChartOverlay` draws again into whichever chart is showing, as every other draw in `chart.js` does, so it would draw over the profile selector's preview if set while that page is open; nothing on the cafe page opens that page today, and a change that does must look at this. At each adoption: keep the block and the three calls, and check what the overlay relies on: a target is a line with a `dash` and the Shot's own lines have none, on both charts; the main chart's end labels find a line by colour and the full-screen chart's by name; `LIVE_X_DATA_FRACTION` and `dtickForTime` are copied into `reference-overlay.js`, `SMOOTHING_FACTOR` into `shot-model.js`, whose `shotCurves` follows `plotHistoricalShot` in which samples it draws, and `STEP_MARKER_COLORS` and the stage line's width and dash into `stage-names.js`, whose `shotStages` follows `plotHistoricalShot` in where it marks a stage; check too that the seven lines keep their names, that `addStepMarker` is still handed the step's name, and that a live frame still reaches `renderMain` in `live` mode. `test/cafe-source-rules.test.mjs` fails if a hook or a call is gone, `test/cafe-reference-overlay.test.mjs` runs the overlay through the real `chart.js`, and `test/cafe-stage-names.test.mjs` runs the stage names through it and the renderer. |
| `src/modules/echarts-renderer.js` | One added function, `cafeShapeLabel(shape)`, just above `markerData`, and one line in `markerData` that spreads its answer into each stage line. A shape that carries a `label` (`text`, `color`, `size`, `pad`) has its text written inside the plot, at the top of its line and to the right of it. Streamline's own shapes carry none, so its charts are unchanged. `src/cafe/stage-names.js` adds the label. The shapes are part of what the renderer compares to decide whether a live frame can be appended (`liveLayoutSignature`), so a name is sent only when it changes. At each adoption: keep both, and check a stage line is still a `markLine` entry and that the shapes are still in `liveLayoutSignature`. |
| `src/modules/api.js` | Two added exports. `getShot(id)`, above `getShots`: one Shot whole, or null for a 404. Streamline's own modules fetch a Shot inline, and the fork's modules reach Decaid only through `api.js`. `connectPluginMessages(pluginId, endpoint, onMessage, onOpen)`, just under `closePluginPush`, with its own map of socket slots: a plugin's websocket whose messages are read, one socket for each plugin endpoint, closed before it is replaced, with the push sockets' reconnect timing. `connectPluginPush` keeps one socket for each plugin, which the plugin's `live` endpoint already holds, and hands on no message's content. `src/cafe/decent-sync.js` opens Decent Sync's `changes` socket with it. At each adoption: keep both, and check `createSocketSlot`, `RECONNECT_POLICY.background` and `ReconnectingWebSocket` are still what `connectPluginPush` uses. `test/cafe-source-rules.test.mjs` fails if either export is gone. |
| `src/modules/keyboard-fit.js` | `trackBaseline` keeps `baselineVisible`, the room the screen has with no keyboard, and measures a shrink from it rather than from the layout window; `adopt()` and a grow set it, and a grow's `shrunk` says whether that room is less than the window. A grow also needs the layout window to be no shorter than the baseline, so a host resize that leaves the screen its room is still adopted as a smaller window. While a shrink nobody typed into waits to be adopted, `pendingVisible` keeps the least room seen, and a field taking focus makes it a keyboard only if the screen then loses more room than that. The comment above it says what each field means. Before, a WebView whose `visualViewport` rests a fraction of a pixel or a system bar short of `innerHeight` left `shrunk` true for good once that gap was adopted, and `scaling.js` lifted on `shrunk` alone, so a button near the bottom was lifted whenever it took focus (issue #38). At each adoption: check `trackBaseline` is still the only place the baseline is decided and that `scaling.js` still passes it every pass. `test/cafe-keyboard-fit.test.mjs` runs it with a 0.5 px and a 30 px gap. Streamline's `test/scaling-fit.test.mjs` is unchanged and still passes. |
| `src/modules/scaling.js` | Three lines in `initScaling` and `updateScale`, each with its comment: the starting baseline has `baselineVisible`; the canvas is lifted for a focused element only while `baseline.keyboardLike` holds (a shrink that came while a field was typed into), not whenever the screen is short; and the adopt timer runs only while a shrink waits (`shrunkSince`), since a screen that rests short is `shrunk` for good. Before, a button near the bottom took focus on pointer-down, was lifted at once, and left the finger, so the first tap on Settings, Shots or Sleep missed. `keyboardUp` and `visibleHeight` in `streamline:scaleupdate` still follow `shrunk`, as before. At each adoption: keep the three, and check `updateScale` still runs on `focusin`. `test/cafe-keyboard-fit.test.mjs` fails if any of the three is gone. |
| `src/css/app.css` | Rebuilt for the fork's page. See above. |
| `.gitignore` | `test/cafe-smoke/out/`, the smoke run's screenshots. |

Streamline's modules are otherwise unedited: the hook in `app.js`, the one in `dyeStrip.js`, the two in `chart.js` with the step's name kept on its line, the one in `echarts-renderer.js`, the two exports in `api.js` and the keyboard fix in `keyboard-fit.js` and `scaling.js` are all there is. No Streamline test is changed for the chart hooks. Where the page needs one to behave differently, it does so from outside, in `src/cafe/` and `src/cafe/cafe.css`:

- **Steam.** `ui.js`'s steam − and + step whichever of time, flow and milk stop its tile's mode names, and the mode moves without the page. So the page has no `#steam-minus` or `#steam-plus`: its own two buttons step the flow from `src/cafe/page.js`, writing it as Streamline's numpad does. The tile's duration and mode elements stay as hidden stubs, because the tile does not paint without them.
- **Taps Streamline wires that the page does not offer yet.** `app.js` opens the profile list from `#profile-name` and DYE2's grinder page from `#grind-label`. `cafe.css` takes pointer events off both.
- **The help button.** `help-launcher.js` adds a "?" that explains Streamline's page. `cafe.css` hides it while the main page shows.
- **The footer.** `main.css` reserves 242px under `<main>` for Streamline's footer cards; `cafe.css` gives it back to the graph.
- **The shot's numbers.** `shotData.js` still gathers the running shot for the stop notice and the timer. The page asks its `getTotalTime()` whether a shot that ended had poured, and its `getCurrentShot()` for the weight a shot ended on. Its table is not on the page.
- **Translations.** `i18n.js` translates every element with `data-i18n-key` from Streamline's file alone. The page's own text is keyed by `data-cafe-text` and translated by `src/cafe/text.js` from the fork's table first. `#machine-status`, `#sleep-button` and `#cupwarmer-text` keep `data-i18n-key`, because `ui.js` and `app.js` set that key on them. `data-fit-text` on the page's labels is `i18n.js`'s own fitting.
- **The history module.** `history.js` still reads the tablet's Shots and asks the chart to draw the newest. With a recipe loaded the chart's chooser turns that down, and the page draws the Shot it read through the Shot seam. With none the chooser lets it through, and the legend names the Shot from the measurements and Workflow the chooser is handed. The module's four text lines are written into a hidden stub, and the legend is the page's own. The page relies on the module asking again once each shot has been saved, which it does from v0.2.28 (`applyHistoryPage` keeps position 0 as the newest when a shot lands). At each adoption: check `applyHistoryPage` and `refreshToNewestShot` still bring the panel back to the newest, and that `plotHistoricalShot` is still handed the Shot's measurements and Workflow.
- **The long-press.** `ui.js`'s `setupPressAndHold` and `context-menu.js`'s `openContextMenu` are called as exported, and the list of recipes is a daisyUI `<dialog>` like Streamline's profile list. Streamline's own cell menu, its `editRecipe` and `openPluginOverlay` are not used: the page opens none of DYE2's pages.

## Builds

| File | Change |
| --- | --- |
| `.github/workflows/release.yml` | A `main` build gets the id `streamline-cafe.js-dist`. Only the two cafe ids pass validation. The release zip is named `streamline-cafe.js-<tag>.zip`. |
| `.github/workflows/release.yml` | A `main` build's version is stamped `<version>.dev.<run>.<sha>`, where Streamline stamps `<version>-dev.<sha>.<run>`. The skin's version compare reads nothing past a second `-`, and the fork's version already has one, so Streamline's stamp would make every `main` build compare equal. |
| `.github/workflows/release.yml` | A `main` build's `SKIN_ID` is rewritten to the dist id. The running page looks itself up by `SKIN_ID` to see whether a newer build is on disk, so it has to carry the id it is installed under. |
| `.github/workflows/static.yml` | GitHub Pages gets the built skin only (`index.html`, `skin-manifest.json`, `src`), where Streamline publishes the whole repository. |

## Streamline's tests

| File | Change |
| --- | --- |
| `test/version.test.mjs` | Expects the id `streamline-cafe.js`. |
| `test/README.md` | The example test expects the same id. |

## Streamline's docs that no longer describe this fork

Not edited, so merges stay clean. Read them with the differences above.

- `docs/AI_RELEASE_NOTES.md`: the ids, the `main` build's stamp and what GitHub Pages publishes.
- `RELEASE.md`: the ids and the tag format, which here is `v<Streamline version>-cafe.<n>`.
