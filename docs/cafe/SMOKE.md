# Streamline Cafe: the smoke run

A run of the real page in a real Chromium against a real Decaid with a simulated machine. It is done by hand before a release, and for a change to a part of the page whose step below has not moved to the page tests yet. It is not in CI: it needs Docker, a browser and several minutes.

Its steps are moving to the page tests, which run on every pull request against a fake Decaid ([`TESTING.md`](TESTING.md)). Steps 7, 18 to 23 and 25 have moved; what is left of steps 7 and 18 below only sets up what later steps rely on. A new slice writes its closing check as page tests, not as a step here.

There are two runs. The first, `test/cafe-smoke/run.mjs`, is the page against Decaid alone. The second, `test/cafe-smoke/run-decent-sync.mjs`, is the page against the same Decaid with Decent Sync's plugin and a local Decent Sync server, and a second Decaid as a second Machine at the same Location: see [The second run](#the-second-run-with-decent-sync).

Everything the run writes is made up. The sample beans, grinders and recipes are in `test/cafe-smoke/sample-data.mjs`; add to that file, with invented names, instead of copying a cafe's data.

## What it needs

- Docker, for a throwaway Decaid. The run removes and reinstalls DYE2, switches Streamline's "DYE2 on" setting, writes beans, batches, grinders, DYE2's baskets and recipes, makes recipes and moves them between slots from the page, chooses grinders, batches, baskets and profiles from the page, hides a profile and shows it again, chooses reference Shots and clears the choices an earlier run left, rates Shots and writes notes on them, changes the language, sets the Workflow's barista from the page and through Decaid's API, puts the simulated machine to sleep and wakes it, and pulls simulated shots. Never point it at a tablet or at a Decaid someone uses.
- Network access to GitHub, where Decaid fetches DYE2's latest release from.
- Node, and this repository's dependencies (`npm ci`). Once per machine: `npx playwright install chromium`.
- For the second run, Docker images of the Decent Sync server and PostgreSQL as well, and a second throwaway Decaid.

## Decaid, headless, with a simulated machine

Decaid publishes a Linux build with each release. It needs a display server and a session bus, so it runs under `xvfb-run` and `dbus-run-session`.

1. Start a container, with Decaid's port on the host's own port 8080. The skin calls Decaid on port 8080 of whatever host served the page. Another port works only where the run is told it with `--decaid=` (see [The run](#the-run)).

   ```sh
   docker run -d --name cafe-smoke-decaid -p 127.0.0.1:8080:8080 ubuntu:24.04 sleep infinity
   docker exec cafe-smoke-decaid bash -c 'apt-get update && apt-get install -y \
     xvfb xauth libgtk-3-0t64 libsecret-1-0 libjsoncpp25 libserialport0 liblzma5 libglu1-mesa \
     dbus dbus-x11 avahi-daemon ca-certificates curl libegl1 libgles2 libgl1-mesa-dri libegl-mesa0'
   ```

   Without the EGL and Mesa packages Decaid starts and its API never answers.

2. Put a Decaid release in it. Use `amd64` in place of `arm64` on an Intel host, and check the download against the release's `SHA256SUMS` file.

   ```sh
   mkdir decaid-download && cd decaid-download
   gh release download v0.9.2 --repo decentespresso/decaid \
     --pattern 'decaid-linux-arm64-*.tar.gz' --pattern '*SHA256SUMS.txt'
   shasum -a 256 decaid-linux-arm64-0.9.2.tar.gz    # compare with the SHA256SUMS file
   docker cp decaid-linux-arm64-0.9.2.tar.gz cafe-smoke-decaid:/tmp/decaid.tar.gz
   docker exec cafe-smoke-decaid bash -c 'mkdir -p /opt/decaid && tar -xzf /tmp/decaid.tar.gz -C /opt/decaid'
   ```

3. Tell it to simulate a machine and a scale, and start it with an extensions token. From Decaid v0.9.2 every request that manages a plugin needs that token; a token shorter than 32 characters is ignored.

   ```sh
   TOKEN=$(openssl rand -hex 32)
   docker exec cafe-smoke-decaid bash -c 'mkdir -p ~/.local/share/decaid && \
     echo "{\"simulateDevices\":[\"machine\",\"scale\"],\"onboardingCompleted\":true,\"accountStepSeen\":true}" \
       > ~/.local/share/decaid/shared_preferences.json && \
     mkdir -p /run/dbus && dbus-daemon --system --fork; avahi-daemon -D; true'
   docker exec -d -e DECAID_EXTENSIONS_TOKEN=$TOKEN cafe-smoke-decaid bash -c \
     'xvfb-run -a dbus-run-session -- /opt/decaid/bundle/decaid --serial --bypass-onboarding --no-account > /tmp/decaid.log 2>&1'
   ```

   Give it half a minute: `curl http://127.0.0.1:8080/api/v1/plugins` answers once it is up. A fresh Decaid v0.9.2 bundles DYE2 v0.1.37, which is older than the skin needs, so the first run starts on the "DYE2 is older than v0.1.40" screen.

## The skin

Serve the repository's root. Any static server does; run it from outside the directory it serves.

```sh
python3 -m http.server --bind 127.0.0.1 --directory /path/to/streamline-cafe-js 13999
```

For the switch to Streamline and back, serve the Streamline release the skin is built on beside it, from a copy outside this repository. The tag is in a clone that has fetched Streamline's tags:

```sh
mkdir /path/to/streamline-release
git archive v0.2.28 | tar -x -C /path/to/streamline-release
python3 -m http.server --bind 127.0.0.1 --directory /path/to/streamline-release 13998
```

## The run

```sh
node test/cafe-smoke/run.mjs --token=$TOKEN --streamline=http://127.0.0.1:13998
```

It prints one line per check and exits non-zero if any failed. Screenshots land in `test/cafe-smoke/out/`, which git ignores. `--headed` shows the browser; `--base=` and `--decaid=` point it elsewhere. The page calls Decaid on port 8080 of the host that served it, so a Decaid given on another port with `--decaid=` is reached through a mapping in the run's browser (`--host-resolver-rules`): two checkouts can then run at once, each with its Decaid on a port of its own and its skin served on another. Decaid writes a Shot's time as its own local time with no offset, so the browser runs in the container's time zone, UTC unless `--timezone=` names another; otherwise the legend's "Today" is wrong whenever the two zones' dates differ. Without `--streamline=` the switch to Streamline and back is skipped, and the run says so. `--only=preheat` runs step 26 alone, `--only=profile-dialog` step 27 and `--only=labels` step 28, on a Decaid a whole run has already set up.

In order, it:

1. shows the "DYE2 is needed" screen for an older DYE2 (only on a Decaid that still has one), for DYE2 removed, for DYE2 switched off in Decaid, and for the setting off, and checks each time that nothing is drawn behind the card, no recipe is read or loaded, and nothing is installed;
2. opens Settings from that screen and comes back to the check, runs the check again with Reload, and starts the page with "Turn DYE2 on";
3. seeds the sample data, by setting the Workflow and asking DYE2 to save it as a recipe, so the records have the shape DYE2 writes;
4. checks the nine cards, the page with no recipe loaded, and what is gone from Streamline's page;
5. taps two cards in quick succession, then one, and checks the Workflow, DYE2's selection, the title, the dial-in column's label and what each dial-in row names;
6. steps a value and checks it changes this machine only, flips Temp | Vol, steps the steam flow, and checks a change made just before another recipe is tapped does not land on that recipe;
7. pulls a simulated shot with that recipe loaded, which step 8 starts from. What the page shows during it and once Decaid has stored it is a page test now (`test/page/live-shot.spec.mjs`);
8. checks the reference on the graph, with the recipe that shot was pulled with: the Reference view with no reference yet; Make reference choosing at once, the "This shot is the reference" badge and the choice in Decaid's store; a second shot with the reference faded behind it, on the main graph and the full-screen chart, the time axis showing the whole reference, and frames appended instead of the chart drawn again in full; the new Shot as the latest against the reference at rest; Targets, and the view still there after a reload; the "Replace the reference?" dialog, cancelled and then confirmed; a two-second shot, which is Unfinished and does not become the latest; and a recipe with no Shot on this machine, whose reference is drawn alone with "Different profile", then a choice naming a Shot that is gone; and through all of it the comparison row: "No reference", "Ref = this shot", the live cards beside the reference and, after the toggle, beside the profile's targets, the row at rest in Reference and in Targets, the stage names in both views and none on the full-screen chart, and for the recipe with no Shot the reference's numbers and stages, then "No shot yet" in Targets; then, on a page where the run adds a scale's readings to each Shot, first drip, yield and ratio with their differences;
9. rates the Shot in the graph and writes its note, between the second shot and the Targets checks of step 8: empty stars and a plus on a saved Shot and none during a shot; a tap rating at once with the rating alone sent to Decaid and every other annotation kept; the chosen star clearing; a rating of 7 given through Decaid's API drawn as three and a half stars, and a tap on the fourth star then setting 8; a rating that fails putting the stars back with a toast; one Decaid made whose answer was lost shown as made; the note's dialog, its text saved trimmed and alone, kept with a line saying why when the save fails, unchanged by Cancel, sending nothing when saved as it was, and cleared when emptied; the dialog fitted above a keyboard, by sending the page the event Streamline's scaling sends when one opens; the reference's rating as "★ 3.5" and its note opened to read; and the legend's row in English and every language Streamline has finished: with both Shots' baristas, stars, notes and Make reference, where nothing but a barista's name may be cut short; and with "Different profile" as well, where the times may be;
10. opens the full-screen chart and comes back, opens Settings and comes back, and switches DYE2 off to check the page returns to the "DYE2 is needed" screen;
11. holds an empty slot and checks the menu's two items and the list that says there is nothing to choose; makes a new recipe in slot 8 and checks DYE2 named it, it is loaded, the machine is set as it was, and the skin placed it with one write;
12. holds a filled card and checks its three items; takes recipes out of their slots, chooses one for an empty slot and one in place of another, and checks DYE2's records, the list's order and that nothing loads; removes the loaded recipe's card and checks it is unloaded, with DYE2's selection naming no recipe (DYE2 may answer a `recent:` favourite it matched the Workflow against, which names none), and the machine set as it was; replaces the loaded card with a new recipe; checks no menu opens during a shot, and that the page never left for one of DYE2's pages;
13. changes the language to German and to Arabic and checks the page's text, the roast date, that no label overflows its place or is shrunk below 14px, and that the layout stays left to right; then the menu and the list in German, the page with no recipe and the "DYE2 is needed" screen in German, and a change of language while that screen shows;
14. with `--streamline=`, opens official Streamline on the same Decaid, sets its strip to R, loads a recipe and arranges the strip on the cafe page, and checks the strip mode is still R in Decaid's store and on Streamline's page;
15. checks the dial-in column's label with Decent Sync serving the Machine and refusing it, and, with a plugin that has not connected yet, the latest Shot alone with no reference and no Make reference, and the line that says why, until the status answers; and takes the screenshots a pull request needs: light and dark, with and without the on-screen machine buttons, with and without a recipe loaded;
16. with no recipe loaded, pulls two shots in one session and checks the graph draws each once Decaid has saved it, the legend names it "Last shot" with its time and barista, the page asks the Shot seam for the newest Shot only, and the history arrows and Streamline's shot panel are out of reach during each shot and at rest; and rates each of the two as "Last shot", writes a note on the second, and checks they are on the Shot drawn and still shown after a reload.

17. adds sixty Shots for the Shots list through Decaid's data import, then opens the list from the Shots button and checks the button sits with Settings and Sleep at their size, the header that says "Shots" and no more, with no line and no Machine or Time column, the first 50 rows under "Today", the Shot in the graph highlighted and the reference's chip; scrolls to read the next 50 with no Shot listed twice and a "Yesterday" header; checks the recipes' names, "No recipe", the stars, "Not rated" and the note icon; opens a Shot of the loaded recipe as "Viewing" with "Back to latest" and its own lines, rates it, and reopens the list where it was left, unread again, with the rating in the row; opens a Shot of another recipe, labelled with its name under the loaded recipe's header, and makes it that recipe's reference, leaving the loaded recipe's; opens a Shot with no recipe, with no Make reference; goes back to the latest, after which the list is read afresh and the latest's own row opens nothing; and starts a shot with a Shot opened, which draws live by appending frames, with the Shots button taking no taps, and ends with the latest in the graph. It deletes the sixty Shots and puts the choices of reference back afterwards.
18. makes sure of a second grinder and an archived one, which the second run uses. The grinder dialog itself is a page test now (`test/page/grinder-dialog.spec.mjs`).

19. a touchscreen whose `visualViewport` rests short of the window, and the soft keyboard (issue #38) is a page test now (`test/page/touch-keyboard.spec.mjs`).
20. every dialog at 1920, 1340 and 1280 wide (issue #39) is a page test now (`test/page/dialog-sizes.spec.mjs`).
21. the Grind row with a preset grinder, a 0.25 step and a wide number (issue #42) is a page test now (`test/page/grind-row.spec.mjs`).
22. the bean and batch dialog and the basket dialog is a page test now (`test/page/bean-basket-dialogs.spec.mjs`).
23. the barista at the machine, at two sizes, through sleep and wake (issue #47) is a page test now (`test/page/barista.spec.mjs`).
24. on a page at 1920 by 1200, and again on one at 1340 by 800, loads a recipe and taps its card again, and checks DYE2's selection names no recipe, the page is the no-recipe page with "Last shot" in the graph, the machine is set as it was, the page wrote no Workflow and no record, and nothing asked first or showed a toast; steps the dose and checks the Workflow has it and the recipe's record did not change; taps the card and checks the recipe loads as stored, over the step; double-taps another card and checks its recipe is loaded; pulls a shot and, while it runs, taps the loaded card and another, and checks nothing changed; taps the loaded card the moment a pour ends and checks the highlight leaves at once while DYE2 still names the recipe, the Shot just stored names the recipe, and the recipe is unloaded once it is stored; and taps the loaded card with DYE2's answer refused, and checks the toast "Could not unload" the recipe and the card still highlighted. Screenshots before and after the tap, and of the refusal, at both sizes.
25. the profile changed from the page with the recipe kept loaded (issue #50) is a page test now (`test/page/profile-change.spec.mjs`).
26. the graph going live at the Preheat (issue #64). The simulated machine's Preheat lasts about half a second, so the run puts the page's machine socket through itself (`machineFeed()` in `run.mjs`): it can hold Decaid's frames of a pour as a Preheat until it lets the profile start, leave out the Preheat's frames, or send Decaid's last frame in a state of its own with no shot pulled. With a recipe loaded and two shots pulled with it, the first made its reference: a Preheat empties the graph of the latest's lines and stage names, on the main graph and the full-screen chart, leaving the reference behind it in Reference with the time axis the live one at the reference's length, and nothing in Targets, on an axis from zero to one second; the legend reads "Live shot" and the six live cards have no values but a time of 0.0 s. Stopped in the Preheat, the latest is back with its time, lines, axis, stage names and cards. With the full-screen chart open, in both views, a Preheat empties it and its stop puts the latest back on it. A page opened during a Preheat is live, and its shot stopped there puts the latest back. A real shot with a Preheat held 2.5 seconds draws nothing until the profile starts, then its first sample at time zero with the axis unmoved and frames appended, and becomes the latest once saved; in Targets the same shot's axis starts at zero through the Preheat and the profile's start, and its end only grows; a shot whose Preheat frames are left out goes live and draws from time zero, as before. With no recipe loaded, a Preheat and its stop leave "Last shot" as it was. `--only=preheat` runs it alone, on a Decaid a whole run has already set up. Screenshots `preheat-*.png`. It puts the choices of reference and the graph's view back, unloads the recipe, and deletes the shots it pulled.
27. the profile dialog (issue #51), on a page at 1920 by 1200 with a recipe loaded: checks a tap on the Brew value opens the numpad, and a tap on the row's name, or on the profile's under it, opens the dialog, with nothing of Streamline's or DYE2's opened; "Profile", the line that says the choice is saved to the recipe, "Profiles" over every profile Decaid shows sorted by title, each with "By" and its author and its own temperature, the recipe's profile highlighted and marked "In use", and "Description" with its title, "By" and its author with "brews at" and its temperature, and its notes as plain text with their line breaks, with "In use" in the button's place; a tap on another profile highlights it and shows its description with "Use this profile" and "Sets Brew to" its temperature, the profile in use still marked; the profile with the longest notes scrolling them inside the dialog; that highlighting, Close and a tap outside write nothing; then chooses a profile, and checks the dialog closes, the recipe is still loaded and not called changed, its record holds the profile at its own temperature and keeps its name, the other records are untouched, the Workflow has the profile at its own temperature with dose, yield and grind as they were, the change was one record write then one Workflow write with nothing asked of DYE2's save or selection, the Brew row names the profile at its temperature, the dial-in rows, card and title band are as they were, and the chart's profile is the new one; after DYE2's window the recipe is still loaded and the record still holds the profile, and the dialog opens again on it, in use. Then a change whose record write is refused, which is a toast with the row and the Workflow as they were; profiles that can't be read, a toast and no dialog; a tap during a recipe load, and a shot that starts, which closes the dialog, and a tap during the shot, neither of which opens it. Then, with no recipe loaded, a profile hidden through Decaid's API and put in the Workflow: the line that says the choice changes this machine only, the hidden profile not listed, and its description in use with no row highlighted; and a choice, which changes the Workflow and no record. Last, on a page at 1340 by 800, the dialog opened from Brew on the profile in use, fitting inside the window, with the longest notes scrolling inside it. Screenshots of the dialog on the profile in use and on another at both sizes, after the change, and with the hidden profile in use. It shows the profile again, puts DYE2's records, the Workflow's profile and the unloaded state back as the step found them, and deletes the shot it pulled.

28. the line names during a shot (issue #66). It finds the language whose labels are widest, as the chart measures them, then pulls a six-second shot with a recipe loaded and makes it the reference. Then it watches ten-second shots with that recipe, each with its Preheat held two seconds through `machineFeed()`: in Reference and in Targets at 1920 by 1200 and at 1340 by 800 in English, in Targets at both sizes in the widest language, and an eight-second shot with no recipe loaded in Targets at 1920 by 1200. For each it checks that nothing is labelled during the Preheat; that from the profile's start Pressure, Flow, °C and Weight are named, in the page's language and each line's colour, and no target or reference line; that each label sits on its line's newest point at every look and moves with the shot; that no label's text reaches past the chart's right edge; and that the frames were appended with no full draw. When the shot ends it checks the labels have not moved by more than one frame's travel. Once Decaid has saved the Shot it checks the four labels are on the Shot drawn and inside the chart, and says how far each moved: the saved Shot is Decaid's record, which can end a sample away from what the page drew live. `--only=labels` runs it alone. Screenshots `live-labels-*-live.png`. It puts the language back to English, and the choices of reference and the graph's view, unloads the recipe, and deletes the shots it pulled.

The run puts DYE2's records back as they were before it made and moved recipes, so it can be repeated on the same Decaid. It leaves behind what the seed's fixtures made, which a repeat finds and uses: Sample Blend's two further batches and DYE2's three sample baskets.

Fourteen things are not Decaid's own answers:

- **A machine with buttons of its own.** The simulated machine always reports none, so for those screenshots the run rewrites that one field of `GET /api/v1/machine/info` in the browser.
- **The recipes' names and the slots above 5.** DYE2 names a saved recipe after its bean and places only slots 1 to 5, so the run writes the names and slots 7 and 9 into DYE2's records itself. That is the fixture's write. The skin's own writer of those records is a separate module with its own guards.

- **DYE2's baskets.** Decaid has no basket route and DYE2 makes a basket only from its own page, so the run writes the three sample baskets into DYE2's store key `baskets` itself, with ids and in the shape DYE2's page writes, before the seed makes the recipes, which then name theirs by id. That is the fixture's write: the skin writes no basket. A Decaid seeded before the baskets had ids keeps recipes that name theirs by name only; the basket dialog then marks none in use for them.

- **A reference for a recipe with no Shot.** The page chooses a reference from the Shot in the graph, so a recipe with no Shot on the machine has none. For that check the run writes the choice into Decaid's store itself, naming a Shot pulled on another profile, and then a Shot that does not exist. It puts the choices back afterwards.

- **A scale's readings.** The simulated scale reads no weight, so a Shot has no first drip, yield or ratio. On one page the run adds a scale's readings, a weighed dose and a yield to each Shot as the browser reads it, for the checks and screenshots of the row with every number in it. Decaid's own Shots are not changed.

- **A Shot edit that fails, and one whose answer is lost.** For those two checks the run drops the page's `PUT` to Decaid's Shot in the browser: once before it is sent, and once after Decaid has answered it.

- **A soft keyboard.** A headless browser raises none. The run sends the page the event Streamline's scaling sends when one opens, saying 400 pixels of the screen are left, and checks the note's dialog sits inside them. It does not show that a tablet's WebView reports a keyboard that way: that is checked by hand on a tablet.

- **A barista on both Shots and a reference on another profile, for the fullest row.** Both of that check's Shots are pulled on one profile with no barista set, so the run gives each record a barista, and the reference's another profile's title, through Decaid's API, and puts them back.

- **Sixty Shots for the Shots list.** A page is 50 rows, and pulling enough simulated shots to fill two would take most of an hour. So the run adds copies of a Shot it pulled through Decaid's own data import, the archive Decaid's export writes, each with an id of its own, a time set back from the evening before, and a recipe and barista of its own, and then gives each a rating and note through Decaid's Shot edit. Decaid's import takes a double only as a number written with a fraction, so the copies keep each number's text as Decaid wrote it. The import needs `zip` on the machine running the run. The page reads them as Decaid answers them.


- **An unload DYE2 refuses.** Step 24 answers the page's request that clears DYE2's selection with a refusal in the browser, once, for the toast and the card highlighted again.
- **A profile change that can't be made, and profiles that can't be read.** Step 27 drops the page's write of DYE2's records in the browser, for the toast and the row as it was, and then its read of Decaid's profiles, for the toast and no dialog. The profile it hides is hidden through Decaid's own API, and shown again afterwards.
- **A recipe DYE2 does not call changed.** The simulated machine's Workflow reports a flush at 90 °C whatever its settings hold, and the sample recipes hold 25 °C, so DYE2 calls each one changed as soon as it loads. Step 27 gives the loaded recipe's record the steam, hot water and flush the Workflow reports before the change, so that a recipe DYE2 does not call changed afterwards shows the change made it no different. It puts DYE2's records back afterwards.
- **A recipe DYE2 named.** The seed renames its recipes, so steps 13 and 15 of the second run give the sample Recipe DYE2's name for it ("Sample Blend") through the server's API, as the management interface would, and name it back afterwards.
- **Decent Sync.** In the first run this Decaid has no Decent Sync plugin. For the label check the run adds the plugin to Decaid's plugin list in the browser and answers its Status request there: as a served Machine, as a Capture-only one, and as a plugin that connects a few seconds after the page opens. It answers the plugin's `reference` request too, with no Reference Shot, and as a plugin with no copy while it is not connected, and takes its `changes` socket, on which it sends only the push that says its connection came. Nothing saves a dial-in in that check: it shows the label only. The real plugin is the second run's.

The theme is painted in the page and never stored: a stored theme is carried to Decaid's settings store, which every later page then reads back.

## The second run: with Decent Sync

The same page against the same Decaid, with Decent Sync's plugin connected to a Decent Sync server of its own, and a second Decaid connected to it as a second Machine at the same Location. Run it after the first run, which leaves DYE2 on and the sample recipes in place. It changes the server as well as the two Decaids, so never point it at a server someone uses.

### A local Decent Sync server

The server is one image and needs PostgreSQL. Both go on a Docker network with Decaid's container, so the plugin reaches the server by its container's name.

```sh
docker network create cafe-smoke
docker network connect cafe-smoke cafe-smoke-decaid
docker run -d --name cafe-smoke-sync-db --network cafe-smoke \
  -e POSTGRES_USER=decent_sync -e POSTGRES_PASSWORD=decent_sync -e POSTGRES_DB=decent_sync postgres:17
docker run -d --name cafe-smoke-sync --network cafe-smoke -p 127.0.0.1:3999:3000 \
  -e DATABASE_URL=postgresql://decent_sync:decent_sync@cafe-smoke-sync-db:5432/decent_sync \
  -e PUBLIC_URL=http://127.0.0.1:3999 -e DRAIN_GRACE_SECONDS=0 \
  ghcr.io/loganfuller/decent-sync:1.11.1
```

Take the server's newest release: the run installs the plugin from Decent Sync's newest GitHub release, and the two should be one release. `curl http://127.0.0.1:3999/api/setup` answers once the server is up. It has no account yet, and the run makes its first Admin, with a made-up address and password that `--email=` and `--password=` change.

### The second Machine

The Location's Shots list shows another Machine's Shots, so the run needs another Machine, and it is a real one: a second Decaid with a simulated machine of its own, whose Shots reach the server the way any tablet's do. Nothing the plugin answers is faked in the browser.

Start a second container as the first was started, on the same Docker network, with Decaid's port on the host's port 8081, and do steps 2 and 3 of [Decaid, headless](#decaid-headless-with-a-simulated-machine) in it with the same token, with one change: it simulates a Bengle, `"simulateDevices":["bengle","scale"]`.

```sh
docker run -d --name cafe-smoke-decaid-2 --network cafe-smoke -p 127.0.0.1:8081:8080 ubuntu:24.04 sleep infinity
```

Every simulated DE1 has the serial number `mock-de1`, and the server knows a machine by its hardware: a second simulated DE1 is refused as `hardwareMismatch`, the first Machine's hardware under another Machine's token. A simulated Bengle is another machine, `mock-bengle`, and pulls shots through the same API.

`curl http://127.0.0.1:8081/api/v1/plugins` answers once it is up. The run does the rest. It installs DYE2's newest release on it, turns Streamline's "DYE2 on" setting on, makes a Machine named Sample Machine Two at the sample Location, installs the plugin and connects it as that Machine, and waits for the Location's Recipes to reach its DYE2 records.

The second tablet runs the skin too. The skin calls Decaid on port 8080 of the host that served it, and both Decaids can't have that port. So the run opens the same page in a second browser, started with a host rule under which the first Decaid's address is the second's (`--host-resolver-rules=MAP 127.0.0.1:8080 127.0.0.1:8081`). That browser is the second Machine's tablet: the run loads a recipe there by its card and pulls its shots through the second Decaid's API.

### The run

```sh
node test/cafe-smoke/run-decent-sync.mjs --token=$TOKEN
```

It prints one line per check and exits non-zero if any failed, and its screenshots are named `sync-*.png`. `--sync=` is the server as the run reaches it (`http://127.0.0.1:3999`), `--sync-for-tablet=` the server as the plugin reaches it (`http://cafe-smoke-sync:3000`), and `--sync-container=` the container the run stops and starts (`cafe-smoke-sync`). `--decaid-2=` is the second Decaid as the run reaches it (`http://127.0.0.1:8081`), and `--token-2=` its extensions token where it is not the first's. `--base=`, `--decaid=`, `--timezone=`, `--out=` and `--headed` are the first run's. Where no second Decaid answers, the run fails that check and skips step 11.

In order, it:

1. makes the server's Admin, a Location named Sample Cafe and a Machine named Sample Machine, where they are missing; installs the plugin on Decaid, gives it the server's address and the Machine's token, and waits until the plugin serves the Machine and the tablet's sample recipes are the Location's Recipes;
2. clears two recipes' Reference Shots on the server, and writes a choice of reference for one of them into Decaid's store, as a tablet that chose one before the plugin came would hold;
3. checks the dial-in column's label, the latest Shot with no reference though the tablet keeps a choice, and that the reference was asked of the plugin by the recipe's DYE2 record id with nothing read from Decaid's store;
4. presses Make reference, and checks the server's Recipe names the Shot, the badge shows, and the choice was one request to the plugin with nothing written to Decaid's store;
5. pulls a second shot, and checks the Reference Shot drawn behind it with frames appended, then the legend: when and who for each Shot, and never where;
6. rates the latest Shot, clears the rating and writes a note, and checks each was one request to the plugin with only the field edited, that the page sent Decaid's own Shot edit nothing, and that the tablet's record and the server both hold the edit; then gives the Reference Shot a rating and a note through the server's own API, and checks they show on the reference's row of the open page with nothing drawn again, and that its note opens to read;
7. chooses Reference Shots through the server's own API, as the management interface does, and checks each arrives on the open page with no reload: the latest Shot, a Shot pulled on another profile with "Different profile", none, and one again; then renames the Recipe and names it back, and checks the push that repeats reads the reference and draws nothing;
8. opens Settings and comes back, and checks one `changes` socket was opened;
9. stops the server's container, and checks the tablet's copy is drawn, Make reference is muted and takes no tap, the line under the legend, and the dial-in label; opens a second page meanwhile and checks it draws the tablet's copy too, with its rating and note, Make reference muted and the same line, that nothing kept on the tablet was read for it, and that the tablet's own Shot can still be rated; starts the container and checks the reference can be changed again;
10. turns the Machine's sharing off on the server, and checks the page falls back to the tablet's own choice at the next recipe load, that Make reference there writes Decaid's store and asks the plugin nothing, that the server's Reference Shot is as it was, and that the Shots list is the tablet's own under "This machine only", with the line that says the machine is at no Decent Sync Location; turns sharing on and checks the reference is Decent Sync's again;
11. stands the second Machine up, loads a recipe on its tablet and pulls a shot and a two-second shot there, and waits until the first tablet's plugin lists both; then, on the first tablet, opens the Shots list and checks the Location's name under the title, no line, the Machine and Time columns, that it was read through the plugin and not from Decaid, the other Machine's rows among this one's with this one marked, each row's duration, the Unfinished mark, the chip on the Recipe's Reference Shot, and the highlight; shrinks the window to 1340 by 800 and checks the list, its Machine and Time columns with it, is scaled with the page, fits, and scrolls nothing sideways (issue #39), then puts the window back; opens the other Machine's Shot, and checks it was read whole through the plugin in one request, its lines, its recipe's Reference Shot, the comparison row, and the legend that says when and who and never where; rates it and writes its note, and checks each was one request to the plugin, that the server holds them, and that the server wrote them into the Shot on the tablet that holds it; checks the kept list's row, and the list read afresh; makes it its recipe's Reference Shot, and puts the reference back through the server's API, which the opened Shot follows; stops the server's container, and checks the line under the legend, the stars and Make reference muted and taking no tap, and the note opened to read only; goes back to the latest and checks the list is the tablet's own under "This machine only", with the line that says Decent Sync can't be reached and no chip, and that this tablet's own Shot opened from it is still rated; starts the container and checks the list is the Location's again and the other Machine's Shot can be changed;
12. pulls a shot on the second sample grinder on the first tablet, with no recipe loaded, and loads the Recipe on both tablets; on the first, opens the grinder dialog and checks the line that says the choice is saved to the recipe and where the grinder was last used, then chooses it, and checks the one write of the Workflow and no DYE2 record written by the skin, the Recipe on the server naming the Location's Grinder with the setting and RPM the choice wrote, the Recipe's record on each tablet naming it, and the second Machine's Grind row showing the grinder and its setting with no tap and no reload; and chooses the Recipe's own grinder back, which reaches the server and the second Machine too.
13. makes sure the sample baskets are Baskets the Location shows, and waits until both tablets hold them and Sample Blend's two batches; loads the Recipe on both tablets; on the first, opens the bean and batch dialog and checks the line under the title follows the bean highlighted: "saved to the recipe" on the Recipe's own Bean, "changes the recipe's bean" on another; chooses Sample Blend's older batch, by highlighting it, which writes nothing and keeps the dialog open, then "Use this batch" (#70), as every batch here is chosen, and checks the one write of the Workflow and no DYE2 record written by the skin, the Recipe on the server taking the batch, the Recipe's record on each tablet naming its own copy of the batch, and the second Machine's Dose row naming it with no tap and no reload; gives the Recipe the name DYE2 gives it ("Sample Blend") through the server's API and waits for both tablets' records to have it; chooses a batch of Example Decaf (issue #52), and checks it was one record write by the skin then one Workflow write, the Recipe on the server taking Example Decaf, its batch and the name DYE2 gives with it ("Example Decaf"), and how long that took; that the first Machine was never set back, polled every half second for at least 15 s; that the second Machine's Dose row names the new Bean with the Recipe still loaded, no tap and no reload, and how long that took; the Recipe's record on each tablet naming the Bean, its own copy of the batch and the new name; and the first page's title band showing the new name; chooses the 20 g basket, and checks the line, the one write, the Recipe on the server, its record on each tablet, and the second Machine's Yield row. It puts the Recipe's own Bean, batch, basket and name back through the server's API. The bean checks need Decent Sync v1.11.1 or later, which takes another Bean's batch from the Workflow and reads the tablet's recipes when the bean moves under a Loaded Recipe (decent-sync #570).
14. loads the Recipe on the second tablet and, on a page of the first tablet's own at 1920 by 1200 and again at 1340 by 800, loads it there and checks the server shows it loaded on both Machines; taps its card and checks the page reads no recipe and the server shows the first Machine with no Loaded Recipe; steps the dose there and checks the Workflow has it, the server's Recipe keeps its dose, and the second Machine keeps its dose and the Recipe loaded, on the server and on its page; pulls a shot and checks it reaches the server with no Recipe and the Shots list names it "No recipe"; taps the card and checks the Recipe loads as the server has it and the server shows it loaded again.
15. the trial of issue #50 with Decent Sync: gives the sample Recipe the name DYE2 gives it ("Sample Blend") through the server's API and waits for both tablets' records to have it; loads it on both tablets; pulls a shot on the first and makes it the Reference Shot through the server's API, drawn with no flag; then, calling `changeProfile` in the first tablet's page, changes the profile, and checks the change answers with DYE2's name on the new profile ("Best Sample Blend"); the Recipe on the server taking the Profile, the profile's own brew temperature and that name, and how long that took; that the first Machine was never set back, polled every half second; that the second Machine takes the profile at its own temperature and keeps the Recipe loaded, and how long that took; that both Machines brew at the profile's own temperature; that the first page's check afterwards found the recipe held; and, after a shot on the new profile long enough to pour (its preinfusion holds 13 s at least, and an Unfinished Shot never becomes the latest), that the Reference Shot, pulled on the old profile, is flagged "Different profile". Then it stops the server's container, changes the profile again, checks the first tablet's record, Workflow and loaded recipe have it, starts the container, and checks the server takes the change, at the profile's own brew temperature, and the second Machine follows at that temperature with the Recipe loaded. It puts the Recipe's profile, name and Reference Shot back, and deletes the shots it pulled. `--only=profile` runs this step alone, on Decaids and a server a whole run has set up.
16. the profile dialog with Decent Sync (issue #51): loads the Recipe on both tablets; on the first, opens the dialog from the Brew row and checks the line that says the choice is saved to the recipe, and the list of the Profiles the Location shows, sorted by title, with the Recipe's marked in use; chooses another, and checks the Recipe on the server takes it at the profile's own brew temperature, and how long that took; that the first Machine kept it with the Recipe loaded and its record holding it; that the second Machine's Brew row shows it at its own temperature with no tap and no reload, with the Recipe still loaded and its record holding it, and how long that took; and, on a page of the first tablet's own at 1340 by 800, the dialog opening on the Profile just chosen. Then it chooses the Recipe's own Profile back the same way, and checks the server and the second Machine follow. `--only=profile-dialog` runs this step alone.

It leaves the server running and the Machines sharing, whatever failed, and a repeat uses the same Admin, Location and Machines.

**The Location's Library for the dialogs.** The tablet's beans, batches and baskets reach the Library on the plugin's poll, every 5 seconds as the run sets it: there is no push for them. On a fresh server the first tablet's own beans, batches and DYE2 baskets join the Library when the plugin first reports them, as the Location has none yet; that is how Sample Blend's batches and the sample baskets become the Location's, and the second tablet is then written them. A tablet joining a Location that already has batches or Baskets has its own left out, so step 13 also shows each sample basket at the Location through the server's API (`POST /api/baskets`, or `PUT /api/baskets/<id>/locations/<location>` where the Library has one by that name). A basket must be one of the Library's Baskets for the Recipe to keep it: a record naming a basket the Library lacks names none.

The first run is the page without Decent Sync, and does not start while the plugin is loaded. To run it again on this Decaid, disable the plugin first. The second run enables it again. The sample recipes are the Library's by then. On a Decaid seeded before the sample baskets had ids, Decent Sync has taken from them the basket its Library does not hold, so the first run's "Yield names the basket" fails on such a Decaid once the second run has used it. A Decaid seeded since names its baskets by id, which join the Library with the tablet's other baskets. For a first run with nothing failing for that, start from a fresh Decaid and a fresh server.

```sh
curl -X POST http://127.0.0.1:8080/api/v1/plugins/decent-sync.reaplugin/disable -H "Authorization: Bearer $TOKEN"
```

## Afterwards

```sh
docker rm -f cafe-smoke-decaid cafe-smoke-decaid-2 cafe-smoke-sync cafe-smoke-sync-db
docker network rm cafe-smoke
```

A running Decaid keeps a CPU busy for as long as it is up.

## What it does not cover

A real machine and scale (the simulated scale reads no weight, so no Shot in the run has a weight-flow line, a live card never shows a weight above 0 g, and the run's Unfinished Shot is one that never poured), the tablet's own WebView, the skin installed under its other id, touch input (a long-press is made with the mouse; the page tests cover the taps of a short touchscreen), a real soft keyboard, the languages other than German, Arabic and French but for the legend's row, a grinder, batch or basket chosen while a dial-in change or a recipe load is still on its way, a grinder never used or one whose setting is not a number, a batch with no roast date, a Recipe that names no Bean (the unit tests do), a screen that is not 1920 by 1200 (the page tests measure the dialogs at 1340 and 1280 by 800), and a real Decent Sync plugin saving a dial-in number: the second run sees it save a grinder, a batch and a basket chosen, and nothing else. In the second run a reference chosen elsewhere is one chosen through the server's API: the second tablet's page is used only to load a recipe there. That run does not cover a recipe in no slot while the server is out of reach, a recipe the Library does not have yet, a choice or an edit the plugin refuses or whose answer is lost, an edit of another Machine's Shot still on its way when the server drops, a Location's list longer than one page, a list refused on a later page, a Shot of a recipe the tablet has no DYE2 record of, or the wrong hardware: the unit tests do. Say so on the pull request when a change needs one of them.
