# Streamline Cafe: tests

Layers, each answering a different question.

| Layer | What it runs | Where | When |
|---|---|---|---|
| Unit tests | Pure modules, under `node:test` | `test/*.test.mjs` | `npm test`, every pull request (Node 22, 24 and 26) |
| Page tests | The real page in Chromium, against a fake Decaid | `test/page/*.spec.mjs` | `npm run test:page`, every pull request (Node 26) |
| The preview's page test | The Pages site as the workflow stages it, the fake Decaid running in the page | `test/page/preview.spec.mjs` | With the page tests |
| The real stack, pinned | The scenarios behind each rule the fake follows, recorded from the real Decaid, DYE2 and Decent Sync, replayed against the fake | `fake-decaid/recordings/`, replayed by `test/fake-decaid-recordings.test.mjs` | Replayed in `npm test`; recorded again on a version bump |
| The real pour | One pour on a real DE1Pro with a real scale, for the weighted comparison row | `fake-decaid/recordings/real/`, replayed by `test/fake-decaid-recordings.test.mjs` | Replayed in `npm test`; captured by hand with the owner |
| The real journeys | The real page against the real pinned stack, for what only it can show | `test/real/*.spec.mjs` | `npm run test:real`; in the real-stack workflow on a pull request that changes the pins, the recorder or the journeys, before a release tag, on demand, and weekly against the newest stable releases |

**Which layer a check goes in.** A check of what the page does goes in a page test, against the fake Decaid; a new slice writes its closing check that way. A rule the fake follows is backed by a scenario recorded from the real stack (below). A real journey is only for what the real stack alone can show: what Decaid, DYE2, Decent Sync's server or a second tablet make of the page's writes, and what they push back. What none of them can show is checked on a real tablet ("What no test covers", below).

## Running them

Once per machine, after `npm ci`:

```sh
npx playwright install chromium
```

Then:

```sh
npm test                                              # unit tests, and the recordings replayed against the fake
npm run test:page                                     # every page test
npx playwright test test/page/grinder-dialog.spec.mjs # one spec
npx playwright test --grep @grinder                   # one tag
npx playwright test --grep @shot --headed             # watch them
npx playwright test --repeat-each=20                  # look for a flaky one
CAFE_TZ=Asia/Tokyo npx playwright test                # in a zone other than UTC
```

Each spec file is one feature and carries its tag: `@gate`, `@strip`, `@dialin`, `@shot`, `@fullscreen`, `@menu`, `@languages`, `@grinder`, `@touch`, `@dialogs`, `@grind`, `@bean`, `@barista`, `@unload`, `@profile`, `@reference`, `@remarks`, `@legend`, `@sync`, `@lastshot`, `@shots`, and with Decent Sync serving `@sync-reference`, `@sync-pushes`, `@sync-remarks`, `@sync-outage`, `@sync-capture`, `@sync-shots`, `@sync-shots-outage` and `@sync-picks`, with and without it `@dialin-saved`, and `@preheat`, `@profile-dialog`, `@live-labels` and `@preview`. A failure keeps its trace, screenshot and page snapshot in `test/page/out/results/` (`npx playwright show-trace <path>/trace.zip` opens a trace). In CI the page tests run as four `page` jobs, each with a quarter of the tests (`--shard`), and a job that fails uploads that folder as `page-tests-<shard>`.

## How a page test works

`test/page/support/test.mjs` gives every test a fresh fake Decaid (`fake`) and a fresh browser context, and a `cafe` helper on the page. Tests run in parallel and leave nothing behind. What the specs read and do on the page is shared in `support/page-reads.mjs`, and what they read of the fake's state (DYE2's records, the recipe loaded, Streamline's profile override) in `support/fake-reads.mjs`.

- **Two origins, no server.** The page is served from `http://127.0.0.1:24800`, its files read from the repository through a Playwright route, and it calls Decaid at `http://127.0.0.1:8080` as on a tablet. Every request and socket to Decaid goes to the model through `test/page/support/adapter.mjs`. Chromium is started with its Local Network Access check off, since a page answered by a route has no address it could tell is local.
- **Nothing unanswered.** A request or socket the model has no answer for is answered with a 599 and kept, and the test fails at its end naming it. So does any error on the page, and any request to a third origin.
- **Settled means answered.** `cafe.settle()`, which `cafe.open()` and each step of `cafe.advance()` end with, returns once every fetch the page has sent has its answer and the page has had a turn to read it, so a test reads the fake's state straight after. The page counts its own fetches (an init script in `support/adapter.mjs`), since a request reaches its route a moment after it is sent, longer for one sent with `keepalive` such as settingsSync's write to Decaid's store (#96).
- **One clock, moved by the test.** The page's clock is Playwright's, installed at 2026-11-18 14:00 UTC (`START`); a test starts at another time with `test.use({ start })`. The page's zone is Playwright's `timezoneId`, UTC unless `CAFE_TZ` names another, and Decaid's is the same, as on a tablet. A test whose expectations depend on the zone (a day's name, a time on the clock) pins it with `test.use({ timezoneId })`; every other test passes in any zone. It runs on by itself, and a test moves it forward only through `cafe.advance(ms)`, which steps it half a second at a time, lets the requests each step made be answered before the next, and has the fake's machine send its frames at rest. `cafe.pour(toMs)` plays the recorded pour with the clock moving with its frames, and paused meanwhile, so the page's timers fire only between its steps, once every frame of a step has reached the page (a timer firing between the machine's frame and the scale's after it left the live Weight card a frame behind, #92); it returns with its last step's frames on the page but not yet drawn, so a test reading the chart or the cards straight after waits with `expect` or moves the clock on first, and pours with no other page of the context open, as the clock is the context's, `cafe.untilStored()` moves the clock on to when Decaid stored it (as long after the page had the machine back at rest as on the recorded stack), and `cafe.storeShot()` has Decaid store its Shot.
- **No fixed sleep, no swallowed timeout.** A test waits on a condition (`expect(...).toHaveText`, `expect.poll`) or moves the clock. `test/page-test-rules.test.mjs` fails on a `waitForTimeout` or other sleep under `test/page/`, and on any way of swallowing a failed wait: a `.catch` or a `catch` around a wait that doesn't throw again, an empty `catch`, or a `.then` with a rejection handler.
- **"Nothing was written"** is asserted by moving the clock past when it would have been, then reading the fake's log: `fake.log` holds every request with its body, and `cafe.since(mark, test)` the ones since a mark. Count writes and named reads, not every request: Streamline's polls keep firing.
- **No motion.** CSS transitions and animations are switched off by a stylesheet: they run on real time, and nothing in `src/` waits for one.
- **The machine's buttons.** A tablet whose machine has buttons of its own (`GHC`) puts Settings, Shots and Sleep at the bottom of the dial-in column; the recorded machine has none. `fake.patchBoot('GET /api/v1/machine/info', info => ({ ...info, GHC: true }))` before the page opens gives it some.
- **A request refused.** `fake.refuse({ method, path, status, abort })` answers the requests matching `path` (a regular expression over the path and query) with that status, or drops them, until the function it returns is called. `support/faults.mjs` has the two the fake can't say: `dropAnswer(cafe, { method, path })`, where the fake makes the change and the page's request then fails, as Decaid's answer lost on the way back; and `hold(cafe, { method, path })`, a request held unanswered until `release()`, while the test reads the page with `expect` (and moves no clock, which waits for every answer). `late(cafe, { path, matches, ms })` in `support/late-frame.mjs` holds the socket frames it matches for `ms` of real time, as a frame held up on a loaded tablet; the clock helpers wait for them. It is the page tests' one fixed wait, and its file the one the rule against sleeps leaves out.
- **The pour.** The fake's machine plays the pinned stack's simulated pour unless a `describe` names the real DE1Pro's with `test.use({ pour: 'real/de1pro-pour' })` ("The real pour", below); `cafe.pour()` and `cafe.untilStored()` follow whichever it plays (`fake.machine.pourTimes()`).
- **Decent Sync's plugin.** `test.use({ decentSync: true })` in a `describe` gives its tests a fake with Decent Sync's plugin installed and serving the Machine at its Location (`fake-decaid/decent-sync.js`, below). The test makes things happen on its server and connection through `fake.decentSync`, each delivered to the page at the next flush: `stopServer()` and `startServer()`, `setSharing(false)` for a Capture-only Machine, `setState(code)` for any other state, `firstStart()` for a plugin never connected, and `chooseReference(recordId, shotId)`, `renameRecipe(recordId, name)` and `editShot(shotId, { rating, note })` made on the server. The plugin saves a Workflow change into the Loaded Recipe as the real one does: at the next flush it has DYE2 record it, and DYE2 pushes on `changed`. So with a recipe loaded, a dial-in change, a grinder or a basket the page writes into the Workflow reaches the recipe's record, while the page's own writes in `fake.log` stay as they were.
- **Sockets.** `cafe.routes.opened` lists the path of every socket the page opened, in order, a reopened one again; `cafe.routes.sockets` holds those open now. `await cafe.routes.drop(path)` closes the sockets open to `path` from Decaid's side, and the page reopens them on its own timer, which `cafe.advance` moves.
- **How the chart was drawn.** `watchDraws(page)`, then the frames played (`cafe.pour`), then `drawCounts(page)`: the frames appended to the chart's first line and the times it was given lines in full.

## The preview's page test

`test/page/preview.spec.mjs` runs with the page tests, but has no adapter and no route to a fake in Node: it checks the public preview as Pages serves it. It stages the site with `preview/stage.mjs`, the script the Pages workflow runs, into a temporary folder of the worker's own, removed when the worker ends, serves it under a project path through a route (`support/preview-site.mjs`), at a Pages-like https address and at a local one, and opens its root. The fake Decaid runs in the page, through the stand-in (DESIGN.md, "The public preview"), and the test reads it through `window.cafePreview.ready`. Every request and socket that leaves the page is kept and refused, and the test fails naming it, as it does on an error on the page. It moves the page's clock as the page tests do, and the stand-in's own timers run on it.

## The fake Decaid

`fake-decaid/` is a plain model of what Decaid, DYE2 and the simulated machine hold, which answers a request as the real ones would. It keeps no timers and uses no Node API (`test/fake-decaid.test.mjs` checks both), so the public preview loads it in a page, through the stand-in that keeps its timers there (DESIGN.md, "The public preview"). No build copies it to a tablet: a release takes `index.html`, `skin-manifest.json` and `src/` only, which `test/cafe-builds.test.mjs` holds.

| File | What it keeps | Read from |
|---|---|---|
| `workflow.js` | The Workflow and Decaid's merge of a write into it | Decaid v0.9.2, `workflow_handler.dart`, `json_utils.dart`, `workflow_context.dart` |
| `store.js` | The key-value store | Decaid v0.9.2, `kv_store_handler.dart` |
| `dye2.js` | DYE2's derived selection, its mirror and `changed` push, the profile rule, `POST selection`, `save-recipe` and the name it gives, `record` (what it writes into the loaded recipe's record and its stored Workflow, and what it pushes), its `skin` answer; `record`'s lost-update window, and DYE2 started again, as events | DYE2 v0.1.42, `plugin.ts`, `utils/workflow-record.ts`, `utils/recent-favs.ts`; Decaid v0.9.2, `plugin_loader_service.dart` |
| `shots.js` | Shots: the list and its filters, by ids, the latest, one, an edit | Decaid v0.9.2, `shots_handler.dart`, `shot_annotations.dart` |
| `library.js` | Grinders, beans and bean batches, read only | Decaid v0.9.2, `grinders_handler.dart`, `grinder_dao.dart`, `beans_handler.dart`, `bean_dao.dart` |
| `machine.js` | The machine's state, its sockets, the recorded pour replayed, the Shot stored, its calibration | Decaid v0.9.2, `de1handler.dart`, `de1_state_manager.dart`, `shot_annotations.dart`, `mock_de1.dart` |
| `boot.js` | The recorded answers to what Streamline's own modules read at start | `recordings/boot.json` |
| `decent-sync.js` | Decent Sync's plugin as a Skin reads it: `status` in each state, `reference` and the tablet's copies, `shots` and its cursor, `shot` and an edit, the `changes` push, its `skin` answer; behind them, the server's Machine, Location, Recipes, Reference Shots and the Location's Shots; and the save into the Loaded Recipe after a Workflow change, asked of DYE2's `record` at the next flush | Decent Sync v1.11.1, `plugin/src/skin-api.ts`, `reference-copies.ts`, `skins.ts`, `loaded-recipes.ts`, `loaded-recipe-rules.ts`, `dye2.ts`; `server/src/shots/location-shots.ts`, `location-references.ts`, `links.ts`, `extraction.ts`; `protocol/src/index.ts`; `docs/PLUGIN.md` |
| `index.js` | Ties them together: `createFakeDecaid`, `request`, `connect`, `flush` (the plugin's save waiting, then the frames waiting), the test's events; Decaid's plugin list, a plugin not loaded answering 404, and DYE2 disabled and enabled | Decaid v0.9.2, `plugins_handler.dart` |

Each file's opening comment names its rules, the source they were read from, and the recording behind them. Decent Sync's test simulators (`server/test/support/` in `loganfuller/decent-sync`) were the guide; nothing is shared with that repository.

**What the test does to it:** `fake.startPour()`, `playPour(ms)`, `finishPour()` and `storeShot()` replay the recorded pour and store its Shot with the Workflow as it is then; `fake.tick()` sends the machine's frames at rest; `fake.machine.setState('sleeping')` (or `'idle'`) puts the machine to sleep or wakes it, pushed on the snapshot socket; `fake.dye2RecordReads()` is the window inside DYE2's `record` that no request can hold open: it has read its recipes list, and the function it answers writes that list back whole, losing a record written in between, then pushes on `changed` (delivered at the next `fake.flush()`) and mirrors the selection from the Workflow it read, as DYE2's `handleRecord` does (`record` itself is a request, which a test sends through `fake.request`, as Decent Sync's plugin does); `fake.restartDye2()` is DYE2 disabled and enabled; `fake.disableDye2()` and `fake.enableDye2()` are each half of that, DYE2 then listed as not loaded with its routes answering 404, or loaded again; `fake.setNow(ms)` is the page's time, which `cafe.advance` keeps. A test may also change `fake.plugins`, Decaid's plugin list, before the page opens: DYE2 taken out of it is DYE2 not installed, and its `version` set lower is an older DYE2. `cafe.openGated()` opens a page that stops at the "DYE2 is needed" screen, which draws no cards and opens no machine socket. A test sends DYE2's or Decaid's own requests through `fake.request({ method, url, body })` (DYE2's `save-recipe`, a Workflow write from elsewhere), and may set up its data in `fake.library.state`, `fake.store` and `fake.shots` before the page opens. The sample data's Shots are moved back in time, so the newest was pulled an hour before the test starts. Made with `decentSync` (`recordings/decent-sync.json`), the fake lists Decent Sync's plugin as loaded, holds DYE2's records and baskets as its Library's sync left them (each sample recipe with a `decentSyncId`, in a Recipe Slot), and four Shots at the Location, labelled in the recording: A and B the tablet's own (A House espresso's latest; B, newer, on Single origin, another Profile, cut short and Unfinished), C and D the second Machine's (D cut short, Unfinished). The sample data's own Shots were pulled before the Machine joined the Location, so the plugin's list leaves them out, as the server does; a Shot stored during a test joins it, once the server is back if it was stored while out of reach. Its plugin saves each Workflow change made with a Recipe loaded into that Recipe's record, at the next flush (above); not a change of profile, the change that loads a recipe, a recipe whose record carries no `decentSyncId`, on a Capture-only Machine, or with DYE2 disabled. It saves on while the server is out of reach, as the real plugin does, which keeps the last word the server gave it. **What it reads:** `fake.workflow()`, `fake.selection()`, `fake.store.get(namespace, key)`, `fake.shots.get(id)`, `fake.library.state`, `fake.log`.

**What it does not keep, yet:** what Streamline's own settings pages read beyond the main page's boot (`GET /api/v1/machine/cupWarmer`, `/presence/schedules`, `/webui/skins/default` and `/account/decent`), so a test that opens Settings goes no further than its first page; DYE2's recent favourites worked out again after a Shot (they are read as the sample data left them); writes to grinders, beans, batches and the machine's calibration; the Shot list's `search`, `beanId` and `minEnjoyment` filters; what `decent-sync.js` says it leaves out (the server's own matching of a Shot's Profile, beyond its title; a Profile or slot changed on the tablet reaching the server; of the plugin's save, the saved dial-in reaching the server and its Recipes, its own writes into the Workflow, a load's included, its rule for steam turned back on, and its holding the Workflow's changes back from the server while it saves); a pour stopped early (an Unfinished Shot is added to `fake.shots` instead); a second pour from another recording in the same test (a spec picks one of the two recorded pours, above, and every pour it makes plays that one). Each answers nothing, so a page test that needs one fails naming it, and the port that needs it adds it with its scenario.

**The sample data** (`recordings/sample-data.json`) is the made-up data of `test/page/support/sample-data.mjs` written into the real stack by `scripts/fake-decaid-recorder/seed.mjs` and read back: beans, batches, DYE2's baskets and recipe records, five grinders (three archived: one retired, and the Grind row's preset grinder and 0.25-step grinder, which a test takes out of the archive in the fake), and a Shot on each of the two others at a setting of its own. It is each test's starting state, and the real journeys' too. No cafe's names, beans or recipes: add to that file, with invented names, rather than copying a cafe's data.

**Stand-ins.** A few things in the tests' state are not the real Decaid's or DYE2's own answers, but writes a test or the seed makes because nothing on the stack could make them:

- **The recipes' names and the slots above 5.** DYE2 names a saved recipe after its bean and places only slots 1 to 5, so the seed writes the names and slots 7 and 9 into DYE2's records itself. The page's own writer of those records is `src/cafe/recipe-writer.js`, with its own guards.
- **DYE2's baskets.** Decaid has no basket route and DYE2 makes a basket only from its own page, so the seed writes the three sample baskets into DYE2's `baskets` key, in the shape DYE2's page writes, before it makes the recipes, which name theirs by id. The page writes no basket.
- **A recipe DYE2 doesn't call changed.** The simulated machine reports its own steam, hot water and flush whatever its settings hold (a flush at 90 °C, where the sample recipes hold 25 °C), so DYE2 calls a sample recipe changed the moment it loads. A test that needs a recipe DYE2 does not call changed gives its record the machine's values first (`matchMachine` in `support/fake-reads.mjs`), and a test that checks a load writes those values gives the record values of its own. `matchMachine` also has the machine's settings report the Workflow's flush temperature and flow, which DYE2's `record` reads over the Workflow's (`GET /api/v1/machine/settings`, where the recorded machine says 25 °C): otherwise the first save into that record, Decent Sync's plugin's after the load, would write 25 °C back and call the recipe changed again.
- **A recipe DYE2 named.** The seed's names replace the names DYE2 gives a recipe after its bean, so the journeys whose pick changes the name with the Bean or the profile first give the Recipe DYE2's own name ("Sample Blend") through Decent Sync's server, as the management interface would.
- **Failures.** A request refused, dropped or held is the test's doing (`fake.refuse`, `support/faults.mjs`), not something the stack was seen to do.

## The real pour

`fake-decaid/recordings/real/de1pro-pour.json` is one pour on a real DE1Pro with a real scale (a BooKoo Mini, through its Decaid plugin), captured by hand for #79: Decaid's "Best practice (light roast)", 20 g in, 44 g asked for, stopped on weight at 43.6 g. Only the weighted comparison row (`reference-edges.spec.mjs`) plays it; every other spec keeps the simulated pour. What it shows that the simulated one can't: a real scale's first drip, yield and weight flow at its own rate (about ten frames a second), and a real machine's timing. Decaid stored the Shot before the machine's own frame back at rest, after the shot-state socket said "finished"; the fake stores when the test says, after the pour, so only the simulated pour is held to the order at the store.

Decaid v0.9.2 stores every Shot's weighed dose (`actualDoseWeight`) as the Workflow's `targetDoseWeight` (`ShotAnnotations.deriveForFinishedShot`); the scale gives the yield only. So the real pour's Targets dose card reads no difference, as the cup's dose was 20.0 g too. A weighed dose other than the target reaches a Shot only through an edit after the pour, such as DYE2's Edit Shot page, which the cafe page never makes: the weighted row's test makes one itself (a made-up 20.4 g, sent as DYE2 sends it), and the page reads it on its next look.

It lives in `real/` because no recorder makes it afresh: the pinned-versions check, the real-stack workflow's fresh replay and `compare.mjs` read only the top folder. `test/fake-decaid-recordings.test.mjs` replays it from the committed folder whatever recordings the rest replays, compares the Shot the fake stores with the one Decaid stored, and checks it holds nothing of the machine it was taken on.

**Capturing one again** needs the owner at the machine, and it is read-only but for the shot itself, which the owner pulls (a GHC machine starts no shot from its tablet). Agree the time and the steps with them first. Unload the recipe on the tablet before setting the profile, dose and yield, so nothing is saved into a recipe, and load it again afterwards. Then:

```sh
node scripts/fake-decaid-recorder/capture-real-pour.mjs --api=http://<tablet>:8080/api/v1 --out=<raw file outside the repository>
node scripts/fake-decaid-recorder/scrub-real-pour.mjs <raw file>
```

The capture listens to the sockets the recorder listens to and waits for a shot started on the machine, then reads the Shot Decaid stored. The raw file holds the machine's serial and the cafe's Workflow, so keep it out of the repository. The scrub writes the recording: the Workflow is the simulated pour's (the sample data's House espresso) but for the profile, dose and yield; the serial (`10001`) and the Shot's id are made up; of the Shot's annotations only the numbers are kept, so the extras a shot-upload plugin writes into a Shot after its store, and any note, are left out. It refuses to write if any text of the capture's own Workflow, serial or ids is left. Grep the result for the machine's real serial and Bluetooth address before committing it.

## The real stack

The pins are in `fake-decaid/pins.json`: Decaid v0.9.2, DYE2 v0.1.42, Decent Sync v1.11.1, Streamline v0.2.28, each with the checksum of the release file the recorder downloads (Decent Sync's server by its published image). A bump is a pull request of its own, which records everything again and fixes what the replay then reports.

**Recording.** It needs Docker and network access to GitHub and ghcr.io, and takes about eight minutes:

```sh
node scripts/fake-decaid-recorder/record.mjs        # or: npm run record:fake-decaid
```

It builds an image of Decaid's system libraries once (`scripts/fake-decaid-recorder/Dockerfile`), starts a throwaway container with the pinned Decaid and, before Decaid's first start, the pinned DYE2, with a simulated machine and scale. Then, in order, it writes the sample data, records each scenario, records the boot (the page opened against the stack, over 65 seconds of the page's clock, so the update check at 30 s and the plugins' look at 60 s are in it), and records one pour with the frames of the page's three machine sockets and DYE2's `changed` socket, and the Shot Decaid stored. Last comes Decent Sync's second setup (`decent-sync.mjs`): a Docker network, PostgreSQL and the server's pinned image; the pinned plugin installed on the same Decaid and connected as "Sample Machine" at "Sample Cafe"; a second Decaid, a simulated Bengle (two simulated DE1s share a serial, which the server refuses) with the pinned DYE2, as "Sample Machine Two". Its Library's sync rewrites DYE2's records, which is why it comes after everything else. Four Shots are pulled at the Location, two on each Decaid, and it writes the state the fake plugin starts from (`decent-sync.json`), then each scenario in `decent-sync-scenarios.mjs`. It records nothing, and removes the container, unless the running Decaid, the loaded DYE2 and the page's Streamline are the pinned versions. It removes the container at the end. `--keep` leaves it running; `--api=` and `--token-file=` point it at one already running, to work on a scenario; `--only=sample-data,scenarios,boot,pour,decent-sync` picks parts (`decent-sync` needs a Decaid with the sample data and no plugin yet: one this run stood up, or `--api=` with `--container=<its id>`); `--scenario=name` records that scenario only (with `--only` absent). Recordings to commit come from one whole run on a fresh container. Each run's container has a name of its own, so a second recorder never removes one kept with `--keep`; `--keep` prints its id, to remove with `docker rm -f` when done, and the file its token is kept in, which it never prints. A run stopped with Ctrl-C removes its container; one killed outright may not, and `docker rm -f $(docker ps -aq --filter label=streamline-cafe-js.fake-decaid=recorder)`, then `docker network rm $(docker network ls -q --filter label=streamline-cafe-js.fake-decaid=recorder)`, removes every recorder container and network left. Another checkout's recorder carries the same label: check none is running first.

Three things headless Decaid v0.9.2 does that the recorder works around, and which a port may meet:

- In its default gateway mode Decaid opens its live-shot screen for the first shot and, with no one there to close it, starts no other shot. The recorder pulls each shot in Decaid's `tracking` mode, which runs the same shot sequencer with no screen, and puts the mode back.
- After a shot the machine stopped itself, Decaid starts no other until it is asked for idle. The recorder asks once the Shot is stored.
- The simulated machine stops a shot on weight, and on Adaptive v3 it pours too slowly ever to reach 36 g. The sample data's shots and the pour are on the Default profile, and its simulated scale weighs.

**A scenario** is a short list of requests in `scripts/fake-decaid-recorder/scenarios.mjs`, and of events the model keeps as test events (`{ event: 'restart-dye2' }`: the recorder disables and enables DYE2 and waits for it, the replay calls `fake.restartDye2()`; `disable-dye2` and `enable-dye2` are each half of it). The recorder sends it to the stack and writes, for each request, the answer and anything DYE2 pushed on `changed` meanwhile, with the Workflow and DYE2's keys it started from (`given`). `test/fake-decaid-recordings.test.mjs` starts a fresh fake from the sample data and that `given`, sends the same requests and compares: an answer whole but for a Shot's `updatedAt` and a recipe's `capturedAt`, with the id DYE2 made a recipe at random standing for the one the model made, a refusal by its status, and the pushes. Decent Sync's scenarios (`decent-sync-scenarios.mjs`) are requests to the plugin's endpoints and events made on its server (`sync-sharing`, `sync-stop-server`, `sync-start-server`, `sync-choose-reference`, `sync-rename`, `sync-edit-shot`), each the fake plugin's event of the same name in the replay, which starts from a fake made with `decent-sync.json`, and two waits on the stack itself, `sync-saved` (until the plugin's save has written the record) and `sync-quiet` (past the plugin's poll, for a save that does not come), which the replay stands in for with a flush; a scenario may listen on DYE2's `changed` instead of the plugin's `changes`, its pushes then compared as pushed; what the plugin pushed on `changes` after an event is compared too, each push once, since the plugin may repeat one. It also replays the pour and compares the Shot the fake stores with the one Decaid stored, and what the shot-state socket and DYE2's `changed` socket said at the store, in their order.

**Adding a rule to the model:**

1. Read what the page needs in Decaid's or DYE2's source at the pinned version.
2. Write it in the `fake-decaid/` file it belongs to, and name the source and version in that file's opening comment.
3. Add a scenario that shows it to `scenarios.mjs`. Work on it against a kept stack: one run with `--keep`, then `--api=`, `--token-file=` (the file `--keep` names) and `--scenario=<name>`, which records that scenario and nothing else. To commit it, record everything again from a fresh container (`npm run record:fake-decaid`): the sample data's ids and times are new on each fresh stack, and every other recording names them, so a scenario recorded alone with fresh sample data leaves the others out of step. Then run `npm test`: the replay fails until the model answers as the stack did.
4. Add a unit test of the rule to `test/fake-decaid.test.mjs`.

A pull request that changes what the model does adds or records again the scenario that proves it. A Streamline release adopted records the boot again.

### Bumping a pin

A bump is a pull request of its own, one release at a time where they can be told apart:

1. In `fake-decaid/pins.json`, set the version and the release file's checksum (`gh api repos/<repo>/releases/tags/v<version> -q '.assets[] | [.name, .digest] | @tsv'` gives both; Decaid has an arm64 and an x64 file, Decent Sync a plugin file and an image tag of the same version). `node scripts/fake-decaid-recorder/latest-pins.mjs <file>` writes the newest stable releases' pins to compare with.
2. Record everything again on a fresh stack (`npm run record:fake-decaid`) and run `npm test`. The real pour (`recordings/real/`) is not recorded again: it keeps the ids of the recordings it was scrubbed against, which its tests leave out of their matches. If its tests fail because the new Workflow or Decaid's own profiles changed shape, scrub the raw capture again if you still have it (it stays outside the repository), or else copy the new `pour.json` Workflow into the recording by hand, keeping its profile, dose and yield. Where the replay now fails, the real stack has changed under the fake: change the model to answer as the new version does, naming the version in its file's opening comment, as in "Adding a rule to the model".
3. Run the page tests and the real journeys (`npm run test:real`), and fix what the new version changed.
4. Open the pull request. The pins changed, so the real-stack workflow runs the recorder and the journeys on it.

Adopting a Streamline release moves its pin with the merge of that release (`version` and `commit`), and records the boot again.

## The real journeys

Playwright tests of the real page against the real pinned stack, for what only it can show: what Decaid, DYE2, Decent Sync's server and a second tablet make of the page's writes, and what they push back. Everything else is a page test.

```sh
npm run test:real                                  # stand both stacks up, run every journey, remove them
REAL_STACK_KEEP=1 npm run test:real                # leave the stacks up afterwards
REAL_STACK=~/.cache/streamline-cafe-fake-decaid/journeys-stack.json \
  npx playwright test -c playwright.real.config.mjs test/real/decaid.spec.mjs   # on the kept stacks
```

It needs what the recorder needs (Docker, GitHub and ghcr.io). `test/real/support/stacks.mjs` stands up two stacks at once with the recorder's own scripts, from the same pins: `decaid`, a Decaid with the pinned DYE2 and the sample data, and `sync`, another such Decaid with Decent Sync's second setup on it (the server's pinned image and its PostgreSQL, the pinned plugin, and a second Decaid, a simulated Bengle, as the Location's second Machine). That takes a little over a minute on an Apple-silicon Mac. Their addresses and extensions tokens go in a state file in the recorder's cache (`~/.cache/streamline-cafe-fake-decaid/journeys-stack.json`), never printed; `REAL_STACK=<file>` names another, and `REAL_STACK_PORT` moves the four ports (18257 to 18260 by default, apart from the recorder's) for a second set beside the first. The stacks carry the recorder's label, so the label filter under "Recording" removes what a killed run left, or one stopped with Ctrl-C while the stacks were still standing up.

The journeys run one at a time (`workers: 1`): Decaid admits about 15 sockets per client address. `test/real/support/journey.mjs` gives each test `stacks` and `tablet(side)`, a page on that side's Decaid in a Chromium whose `127.0.0.1:8080` is that Decaid, as on its tablet, with the page's files answered from the repository; `tablet(side, { streamline: true })` opens official Streamline at its pinned commit instead. Any error on a page fails the test. A journey sets up what it needs and puts back what it changes, so each can run again on kept stacks, in any order. It waits on conditions, never a fixed sleep, but for proving that nothing arrives: `quiet(ms, why)`, its wait named (Decent Sync's poll interval, five seconds as the stacks set it). `test/page-test-rules.test.mjs` holds the journeys to the page tests' rules. Screenshots go to `test/real/out/screenshots/`, and Playwright's results to `test/real/out/results.json`.

The journeys, each tagged (`--grep @real-pour`):

| File | Journey | Tag |
|---|---|---|
| `decaid.spec.mjs` | A recipe loaded by its card, a pour drawn live, and the Shot Decaid stores drawn as the latest with its own numbers | `@real-pour` |
| | DYE2 deriving the loaded recipe from Streamline's apply, and no recipe after a tap on the loaded card or an unload made elsewhere | `@real-selection` |
| | A barista named on the page is the Workflow's, Decaid copies it into the Shot, and the page lists and credits it | `@real-barista` |
| | A tap on the loaded card as a pour ends: the stored Shot still names the recipe, the unload reaching DYE2 after the store | `@real-unload-after-shot` |
| `official-streamline.spec.mjs` | Official Streamline on the same Decaid, and back | `@real-streamline` |
| `decent-sync.spec.mjs` | A Reference Shot chosen on the server reaches the page; Make reference, a rating and a note reach the server and the second tablet; the server's edit and rename come back | `@real-sync-reference` |
| | Another Machine's Shot on the Location's list, rated, noted and made the reference, written into the Shot on the second tablet | `@real-sync-reference` |
| | A grinder chosen (a Workflow write alone), a batch of another Bean (#52), another profile in the dialog (#50, #51), and an unload, each followed to the server and the second tablet | `@real-sync-picks` |
| | The server stopped: the tablet's copy drawn, the list this machine's own, a profile chosen meanwhile caught up once it is back | `@real-sync-outage` |

`test/real/support/decaid-helpers.mjs` and `sync-helpers.mjs` hold what each file's journeys share. On an Apple-silicon Mac a whole run took 4.9 minutes, 65 seconds of it the stand-up.

## The real-stack workflow

`.github/workflows/real-stack.yml` runs the recorder and the journeys as two jobs on GitHub's arm64 runner (`ubuntu-24.04-arm`), where headless Decaid runs in Docker as it does on a Mac:

- on a pull request that changes the pins, the committed recordings or their replay, the journeys, the recorder, the workflow, or the sample data and page-test helpers the recorder and the journeys import (the paths are in the workflow); a newer push cancels its run, while the weekly run and a run on demand never cancel each other;
- on demand (Actions → Real stack → Run workflow, or `gh workflow run real-stack.yml --ref <branch>`), and before each release tag (`docs/AI_RELEASE_NOTES.md`, "Pre-Tag Gate");
- weekly, on Monday mornings (UTC), against the newest stable releases (below).

The recorder's job records everything afresh into a folder of its own (`record.mjs --out=`), then fails when the fresh recordings differ from the committed ones in either of two ways: the fake no longer answers as the fresh recordings say (`FAKE_DECAID_RECORDINGS=<folder> node --test test/fake-decaid-recordings.test.mjs`, the same replay `npm test` runs), or their shape differs (`node scripts/fake-decaid-recorder/compare.mjs fake-decaid/recordings <folder>`: a field present in one and not the other, or holding another kind of value; ids, times and the pour's frames are new on every stack, so values are left to the replay). Both run on a Mac too. The fresh recordings, the replay's results and the comparison are kept as the run's `real-stack-record` artifact, the journeys' results and screenshots as `real-stack-journeys`.

Measured on the spike (#62): the recorder's job takes about nine minutes, the recording itself about seven.

## The weekly run

Every Monday, and on demand with "latest" ticked, the workflow runs against the newest stable releases of Decaid, DYE2 and Decent Sync instead of the pins: `scripts/fake-decaid-recorder/latest-pins.mjs` writes their pins (GitHub's latest release of each, never a pre-release, each file with the checksum GitHub gives it; Streamline stays at its pin), and `FAKE_DECAID_PINS` points the recorder, the stacks and the replay at that file. Nothing else downloads a "latest". When a fresh recording differs, the recorder fails, or a journey fails, `scripts/fake-decaid-recorder/weekly-issue.mjs` opens an issue labelled `real-stack-weekly`, or adds a comment to the one open, naming the versions it ran, the recordings that differ and the journeys that failed, with a link to the run. The stack is a simulated machine with made-up data, so the issue carries no machine's or cafe's. A difference is the start of a bump.

## Screenshots for a pull request

The page tests write screenshots to `test/page/out/screenshots/` (which git ignores), named for what they show: `grinder-dialog-light.png`, `page-shot-running-light.png` and the like. On made-up data, and the same on every run. A change to the main page pushes the ones it changes to the pull request's `pr-assets/<n>` branch (open the pull request first, so `<n>` is its number) and shows them in its description from the moment it opens.

## What no test covers

Every layer runs desktop Chromium against a simulated machine or a model of one. These stay checks on a real tablet, before a release and whenever a change touches them; say on the pull request which ones a change needs.

- **The tablet's WebView.** Android's WebView is another build of Chromium, with its own fonts, scrolling and timers (they need not count the time the tablet slept).
- **Touch.** A real soft keyboard (`touch-keyboard.spec.mjs` stands a short window in for one), a finger on the stars, a long press held by a finger, a list dragged to scroll.
- **The skin installed.** The page installed on a tablet under its id, `streamline-cafe.js`, beside official Streamline, and Decaid installing DYE2 itself. A fresh Decaid v0.9.2 bundles DYE2 v0.1.37, older than the page's minimum of v0.1.40, so a tablet set up on it opens on the "DYE2 is older than v0.1.40" screen until DYE2 is updated. That is why the stacks place the pinned DYE2 before Decaid's first start; `test/cafe-dye2-gate.test.mjs` checks only that the pin is at or above the minimum, not what Decaid installs.
- **Decaid started again.** The fake's `restartDye2()`, and the scenario behind it, are DYE2 disabled and enabled; no test restarts Decaid itself with a recipe loaded.
- **Decent Sync's plugin saving the dial-in, past the tablet.** The journeys see the real plugin save a grinder, a batch of another Bean and a profile chosen on the page into the Recipe. On the tablet, the plugin saving a stepped dose into the loaded recipe's record is recorded (`recordings/decent-sync-saves.json`), DYE2's `record` behind it too (`dye2-record.json`), and the fake does both, so the page tests see the record take a stepped dose (`dial-in-saved.spec.mjs`, the page's label kept true) and a grind setting and basket chosen (`sync-picks.spec.mjs`); the unit tests hold the rest of what `record` writes, the yield and brew temperature among it. What no test sees is a stepped value reaching the server and the second tablet: the one journey that steps a value, the dose, does it with no recipe loaded and checks it reaches none. Nor does one see a save on a real tablet, where DYE2 may first read the machine's settings over Bluetooth, which takes seconds; the fake saves at the next flush.
- **A real machine**, beyond the one real pour: a real scale on every other shot, a real Preheat (the simulated one is about half a second; `preheat.spec.mjs` holds frames back to stand in for a longer one), a shot a barista stops early (the fake adds an Unfinished Shot instead), the machine's own buttons, steam and hot water.
- **Other screens** than 1920 by 1200, and the 1340 and 1280 by 800 the dialog tests measure.

## Measured

On 2026-11-20 at `868f4b8`, on an Apple-silicon Mac (10 cores) with Chromium 158, and on GitHub's runners:

| Layer | Size | On the Mac | In CI |
|---|---|---|---|
| `npm test` (unit tests and the recordings' replay) | 2400 tests | 4 s | under 30 s a Node version |
| Page tests | 241 tests (and 3 `fixme`), in 33 specs | 100 s on five workers (the default here), 207 s on one; a median of 0.71 s a test, the slowest 3.5 s | 8 min in one `page` job; see below for the split |
| Real journeys (`npm run test:real`) | 12 journeys | 5.0 min, the stacks' stand-up included | 6.7 min (`journeys`), beside 8.5 min for the fresh recording (`record`) |

The by-hand smoke run they replace, timed the same day at `4740af5` (its last commit before the porting began) on the pinned Decaid v0.9.2 and DYE2 v0.1.42, with Decent Sync 1.12.0: `run.mjs` passed 858 of 858 checks in 26.0 min, and `run-decent-sync.mjs` 178 of 178 in 6.8 min, so 33 min for one run of both, on one stack at a time, with a person to stand the stacks up and read the screenshots. It never ran in CI.

**The `page` job's split.** On one `ubuntu-latest` runner (4 vCPUs) the page tests took between 5.4 and 8.5 min on Playwright's default of two workers. A run on unchanged `main` compared worker counts on separate runners on 2026-11-20 ([44834819836](https://github.com/loganfuller/streamline-cafe-js/actions/runs/44834819836)). Two workers took 5.6 and 6.6 min, three took 6.3 and 6.0 min, and four took 7.6, 8.2 and 5.1 min. The tests' summed time rose with the worker count (2 workers: 651 and 784 s; 4 workers: 1,173 to 1,921 s), and in two of the three four-worker runs `reference-edges.spec.mjs:262` passed its 30 s timeout. So the job splits the tests across four runners (`--shard`) and keeps two workers on each.
