# Streamline Cafe: tests

Three layers, each answering a different question.

| Layer | What it runs | Where | When |
|---|---|---|---|
| Unit tests | Pure modules, under `node:test` | `test/*.test.mjs` | `npm test`, every pull request (Node 22, 24 and 26) |
| Page tests | The real page in Chromium, against a fake Decaid | `test/page/*.spec.mjs` | `npm run test:page`, every pull request (Node 26) |
| The real stack, pinned | The scenarios behind each rule the fake follows, recorded from the real Decaid and DYE2, replayed against the fake | `fake-decaid/recordings/`, replayed by `test/fake-decaid-recordings.test.mjs` | Replayed in `npm test`; recorded again on a version bump |

The by-hand smoke run ([`SMOKE.md`](SMOKE.md)) came before the page tests, and its steps are moving to them. These have moved: step 7 (a live shot and the graph at rest, `test/page/live-shot.spec.mjs`) and step 18 (the grinder dialog, `test/page/grinder-dialog.spec.mjs`). A change to a part of the page whose step has not moved yet still does that step's smoke run. A new slice writes its closing check as page tests, never as a new smoke step.

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
```

Each spec file is one feature and carries its tag: `@grinder` and `@shot` so far. A failure keeps its trace, screenshot and page snapshot in `test/page/out/results/` (`npx playwright show-trace <path>/trace.zip` opens a trace). The CI job uploads that folder when a test fails.

## How a page test works

`test/page/support/test.mjs` gives every test a fresh fake Decaid (`fake`) and a fresh browser context, and a `cafe` helper on the page. Tests run in parallel and leave nothing behind.

- **Two origins, no server.** The page is served from `http://127.0.0.1:24800`, its files read from the repository through a Playwright route, and it calls Decaid at `http://127.0.0.1:8080` as on a tablet. Every request and socket to Decaid goes to the model through `test/page/support/adapter.mjs`. Chromium is started with its Local Network Access check off, since a page answered by a route has no address it could tell is local.
- **Nothing unanswered.** A request or socket the model has no answer for is answered with a 599 and kept, and the test fails at its end naming it. So does any error on the page, and any request to a third origin.
- **One clock, moved by the test.** The page's clock is Playwright's, installed at 2026-11-18 14:00 in UTC (`START`, Decaid's own zone). It runs on by itself, and a test moves it forward only through `cafe.advance(ms)`, which steps it half a second at a time, lets the requests each step made be answered before the next, and has the fake's machine send its frames at rest. `cafe.pour(toMs)` plays the recorded pour with the clock moving with its frames, `cafe.untilStored()` moves the clock on to when Decaid stored it (as long after the page had the machine back at rest as on the recorded stack), and `cafe.storeShot()` has Decaid store its Shot.
- **No fixed sleep, no swallowed timeout.** A test waits on a condition (`expect(...).toHaveText`, `expect.poll`) or moves the clock. `test/page-test-rules.test.mjs` fails on a `waitForTimeout`, a sleep or a `.catch(() => {})` under `test/page/`.
- **"Nothing was written"** is asserted by moving the clock past when it would have been, then reading the fake's log: `fake.log` holds every request with its body, and `cafe.since(mark, test)` the ones since a mark. Count writes and named reads, not every request: Streamline's polls keep firing.
- **No motion.** CSS transitions and animations are switched off by a stylesheet: they run on real time, and nothing in `src/` waits for one.
- **The machine's buttons.** A tablet whose machine has buttons of its own (`GHC`) puts Settings, Shots and Sleep at the bottom of the dial-in column; the recorded machine has none. `fake.patchBoot('GET /api/v1/machine/info', info => ({ ...info, GHC: true }))` before the page opens gives it some.
- **A request refused.** `fake.refuse({ method, path, status, abort })` answers the requests matching `path` (a regular expression over the path and query) with that status, or drops them, until the function it returns is called.

## The fake Decaid

`fake-decaid/` is a plain model of what Decaid, DYE2 and the simulated machine hold, which answers a request as the real ones would. It keeps no timers and uses no Node API (`test/fake-decaid.test.mjs` checks both), so the public preview (#9) can load it in a page. No build copies it to a tablet: a release takes `index.html`, `skin-manifest.json` and `src/` only.

| File | What it keeps | Read from |
|---|---|---|
| `workflow.js` | The Workflow and Decaid's merge of a write into it | Decaid v0.9.2, `workflow_handler.dart`, `json_utils.dart`, `workflow_context.dart` |
| `store.js` | The key-value store | Decaid v0.9.2, `kv_store_handler.dart` |
| `dye2.js` | DYE2's derived selection, its mirror and `changed` push, the profile rule, `POST selection`, its `skin` answer | DYE2 v0.1.42, `plugin.ts`, `utils/workflow-record.ts` |
| `shots.js` | Shots: the list and its filters, by ids, the latest, one, an edit | Decaid v0.9.2, `shots_handler.dart`, `shot_annotations.dart` |
| `library.js` | Grinders and bean batches, read only | Decaid v0.9.2, `grinders_handler.dart`, `grinder_dao.dart`, `beans_handler.dart` |
| `machine.js` | The machine's state, its sockets, the recorded pour replayed, the Shot stored | Decaid v0.9.2, `de1handler.dart`, `de1_state_manager.dart`, `shot_annotations.dart` |
| `boot.js` | The recorded answers to what Streamline's own modules read at start | `recordings/boot.json` |
| `index.js` | Ties them together: `createFakeDecaid`, `request`, `connect`, `flush`, the test's events | |

Each file's opening comment names its rules, the source they were read from, and the recording behind them. Decent Sync's test simulators (`server/test/support/` in `loganfuller/decent-sync`) were the guide; nothing is shared with that repository.

**What the test does to it:** `fake.startPour()`, `playPour(ms)`, `finishPour()` and `storeShot()` replay the recorded pour and store its Shot with the Workflow as it is then; `fake.tick()` sends the machine's frames at rest; `fake.setNow(ms)` is the page's time, which `cafe.advance` keeps. The sample data's Shots are moved back in time, so the newest was pulled an hour before the test starts. **What it reads:** `fake.workflow()`, `fake.selection()`, `fake.store.get(namespace, key)`, `fake.shots.get(id)`, `fake.library.state`, `fake.log`.

**What it does not keep, yet:** DYE2's `save-recipe` and `record`, and its recent favourites worked out again after a Shot (they are read as the sample data left them); writes to grinders, beans and batches; the Shot list's `search`, `beanId` and `minEnjoyment` filters; Decent Sync's plugin. Each answers nothing, so a page test that needs one fails naming it, and the port that needs it adds it with its scenario.

**The sample data** (`recordings/sample-data.json`) is the made-up data of `test/cafe-smoke/sample-data.mjs` written into the real stack by `scripts/fake-decaid-recorder/seed.mjs` and read back: beans, batches, DYE2's baskets and recipe records, three grinders (one archived), and a Shot on each of the two others at a setting of its own. It is each test's starting state. No cafe's names, beans or recipes.

## The real stack

The pins are in `fake-decaid/pins.json`: Decaid v0.9.2, DYE2 v0.1.42, Decent Sync v1.11.1, Streamline v0.2.28, each with the checksum of the release file the recorder downloads. The pilot uses the first two. A bump is a pull request of its own, which records everything again and fixes what the replay then reports.

**Recording.** It needs Docker and network access to GitHub, and takes about two and a half minutes:

```sh
node scripts/fake-decaid-recorder/record.mjs        # or: npm run record:fake-decaid
```

It builds an image of Decaid's system libraries once (`scripts/fake-decaid-recorder/Dockerfile`), starts a throwaway container with the pinned Decaid and, before Decaid's first start, the pinned DYE2, with a simulated machine and scale. Then, in order, it writes the sample data, records each scenario, records the boot (the page opened against the stack, over 65 seconds of the page's clock, so the update check at 30 s and the plugins' look at 60 s are in it), and records one pour with the frames of the page's three machine sockets and DYE2's `changed` socket, and the Shot Decaid stored. It records nothing, and removes the container, unless the running Decaid, the loaded DYE2 and the page's Streamline are the pinned versions. It removes the container at the end. `--keep` leaves it running; `--api=` and `--token-file=` point it at one already running, to work on a scenario; `--only=sample-data,scenarios,boot,pour` picks parts; `--scenario=name` records that scenario only (with `--only` absent). Recordings to commit come from one whole run on a fresh container. Each run's container has a name of its own, so a second recorder never removes one kept with `--keep`; `--keep` prints its id, to remove with `docker rm -f` when done, and the file its token is kept in, which it never prints. A run stopped with Ctrl-C removes its container; one killed outright may not, and `docker rm -f $(docker ps -aq --filter label=streamline-cafe-js.fake-decaid=recorder)` removes every recorder container left.

Three things headless Decaid v0.9.2 does that the recorder works around, and which a port may meet:

- In its default gateway mode Decaid opens its live-shot screen for the first shot and, with no one there to close it, starts no other shot. The recorder pulls each shot in Decaid's `tracking` mode, which runs the same shot sequencer with no screen, and puts the mode back.
- After a shot the machine stopped itself, Decaid starts no other until it is asked for idle. The recorder asks once the Shot is stored.
- The simulated machine stops a shot on weight, and on Adaptive v3 it pours too slowly ever to reach 36 g. The sample data's shots and the pour are on the Default profile, and its simulated scale weighs.

**A scenario** is a short list of requests in `scripts/fake-decaid-recorder/scenarios.mjs`. The recorder sends it to the stack and writes, for each request, the answer and anything DYE2 pushed on `changed` meanwhile, with the Workflow and DYE2's keys it started from (`given`). `test/fake-decaid-recordings.test.mjs` starts a fresh fake from the sample data and that `given`, sends the same requests and compares: an answer whole but for a Shot's `updatedAt`, a refusal by its status, and the pushes. It also replays the pour and compares the Shot the fake stores with the one Decaid stored, and what the shot-state socket and DYE2's `changed` socket said at the store, in their order.

**Adding a rule to the model:**

1. Read what the page needs in Decaid's or DYE2's source at the pinned version.
2. Write it in the `fake-decaid/` file it belongs to, and name the source and version in that file's opening comment.
3. Add a scenario that shows it to `scenarios.mjs`. Work on it against a kept stack: one run with `--keep`, then `--api=`, `--token-file=` (the file `--keep` names) and `--scenario=<name>`, which records that scenario and nothing else. To commit it, record everything again from a fresh container (`npm run record:fake-decaid`): the sample data's ids and times are new on each fresh stack, and every other recording names them, so a scenario recorded alone with fresh sample data leaves the others out of step. Then run `npm test`: the replay fails until the model answers as the stack did.
4. Add a unit test of the rule to `test/fake-decaid.test.mjs`.

A pull request that changes what the model does adds or records again the scenario that proves it. A Streamline release adopted records the boot again.

## Screenshots for a pull request

The page tests write the screenshots the smoke steps took to `test/page/out/screenshots/` (which git ignores), named for what they show: `grinder-dialog-light.png`, `page-shot-running-light.png` and the like. On made-up data, and the same on every run. Push them to the pull request's `pr-assets/<n>` branch and show them in its description, as the smoke run's were.

## Measured in the pilot (#57)

On an Apple-silicon Mac, Chromium 158: each test takes 0.5 to 1.9 s on one worker, a median of 1.0 s, its page's boot (about 170 files and 55 requests, 0.4 s to the strip) included. All nine take about 10 s on one worker and 4 s on five. Twenty repeats of both specs on five workers: 180 runs, no failure. The two smoke steps they replace held at least 81 s of fixed waits, real-time pours and fade waits between them, before any page's boot or Decaid's store.
