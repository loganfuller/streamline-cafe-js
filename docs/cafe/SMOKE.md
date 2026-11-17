# Streamline Cafe: the smoke run

A run of the real page in a real Chromium against a real Decaid with a simulated machine. It is done by hand before a release and for any change to the main page, and is not in CI: it needs Docker, a browser and several minutes. The unit tests under `test/cafe-*.test.mjs` are what CI runs.

Everything the run writes is made up. The sample beans, grinder and recipes are in `test/cafe-smoke/sample-data.mjs`; add to that file, with invented names, instead of copying a cafe's data.

## What it needs

- Docker, for a throwaway Decaid. The run removes and reinstalls DYE2, switches Streamline's "DYE2 on" setting, writes beans, a grinder and recipes, makes recipes and moves them between slots from the page, chooses reference Shots and clears the choices an earlier run left, changes the language, sets the Workflow's barista, and pulls simulated shots. Never point it at a tablet or at a Decaid someone uses.
- Network access to GitHub, where Decaid fetches DYE2's latest release from.
- Node, and this repository's dependencies (`npm ci`). Once per machine: `npx playwright install chromium`.

## Decaid, headless, with a simulated machine

Decaid publishes a Linux build with each release. It needs a display server and a session bus, so it runs under `xvfb-run` and `dbus-run-session`.

1. Start a container, with Decaid's port on the host's own port 8080. The skin calls Decaid on port 8080 of whatever host served the page, so the port can't be moved.

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

It prints one line per check and exits non-zero if any failed. Screenshots land in `test/cafe-smoke/out/`, which git ignores. `--headed` shows the browser; `--base=` and `--decaid=` point it elsewhere. Decaid writes a Shot's time as its own local time with no offset, so the browser runs in the container's time zone, UTC unless `--timezone=` names another; otherwise the legend's "Today" is wrong whenever the two zones' dates differ. Without `--streamline=` the switch to Streamline and back is skipped, and the run says so.

In order, it:

1. shows the "DYE2 is needed" screen for an older DYE2 (only on a Decaid that still has one), for DYE2 removed, for DYE2 switched off in Decaid, and for the setting off, and checks each time that nothing is drawn behind the card, no recipe is read or loaded, and nothing is installed;
2. opens Settings from that screen and comes back to the check, runs the check again with Reload, and starts the page with "Turn DYE2 on";
3. seeds the sample data, by setting the Workflow and asking DYE2 to save it as a recipe, so the records have the shape DYE2 writes;
4. checks the nine cards, the page with no recipe loaded, and what is gone from Streamline's page;
5. taps two cards in quick succession, then one, and checks the Workflow, DYE2's selection, the title, the dial-in column's label and what each dial-in row names;
6. steps a value and checks it changes this machine only, flips Temp | Vol, steps the steam flow, and checks a change made just before another recipe is tapped does not land on that recipe;
7. pulls a simulated shot and checks the state, the time and the weight against its target, then the Shot in the graph and its time in the legend;
8. checks the reference on the graph, with the recipe that shot was pulled with: the Reference view with no reference yet; Make reference choosing at once, the "This shot is the reference" badge and the choice in Decaid's store; a second shot with the reference faded behind it, on the main graph and the full-screen chart, the time axis showing the whole reference, and frames appended instead of the chart drawn again in full; the new Shot as the latest against the reference at rest; Targets, and the view still there after a reload; the "Replace the reference?" dialog, cancelled and then confirmed; a two-second shot, which is Unfinished and does not become the latest; and a recipe with no Shot on this machine, whose reference is drawn alone with "Different profile", then a choice naming a Shot that is gone;
9. opens the full-screen chart and comes back, opens Settings and comes back, and switches DYE2 off to check the page returns to the "DYE2 is needed" screen;
10. holds an empty slot and checks the menu's two items and the list that says there is nothing to choose; makes a new recipe in slot 8 and checks DYE2 named it, it is loaded, the machine is set as it was, and the skin placed it with one write;
11. holds a filled card and checks its three items; takes recipes out of their slots, chooses one for an empty slot and one in place of another, and checks DYE2's records, the list's order and that nothing loads; removes the loaded recipe's card and checks it is unloaded with the machine set as it was; replaces the loaded card with a new recipe; checks no menu opens during a shot, and that the page never left for one of DYE2's pages;
12. changes the language to German and to Arabic and checks the page's text, the roast date, that no label overflows its place or is shrunk below 14px, and that the layout stays left to right; then the menu and the list in German, the page with no recipe and the "DYE2 is needed" screen in German, and a change of language while that screen shows;
13. with `--streamline=`, opens official Streamline on the same Decaid, sets its strip to R, loads a recipe and arranges the strip on the cafe page, and checks the strip mode is still R in Decaid's store and on Streamline's page;
14. checks the dial-in column's label with Decent Sync serving the Machine and refusing it, and takes the screenshots a pull request needs: light and dark, with and without the on-screen machine buttons, with and without a recipe loaded;
15. with no recipe loaded, pulls two shots in one session and checks the graph draws each once Decaid has saved it, the legend names it "Last shot" with its time and barista, the page reads no Shot through the Shot seam, and the history arrows and Streamline's shot panel are out of reach during each shot and at rest.

The run puts DYE2's records back as they were before it made and moved recipes, so it can be repeated on the same Decaid.

Four things are not Decaid's own answers:

- **A machine with buttons of its own.** The simulated machine always reports none, so for those screenshots the run rewrites that one field of `GET /api/v1/machine/info` in the browser.
- **The recipes' names and the slots above 5.** DYE2 names a saved recipe after its bean and places only slots 1 to 5, so the run writes the names and slots 7 and 9 into DYE2's records itself. That is the fixture's write. The skin's own writer of those records is a separate module with its own guards.

- **A reference for a recipe with no Shot.** The page chooses a reference from the Shot in the graph, so a recipe with no Shot on the machine has none. For that check the run writes the choice into Decaid's store itself, naming a Shot pulled on another profile, and then a Shot that does not exist. It puts the choices back afterwards.

- **Decent Sync.** This Decaid has no Decent Sync plugin, and the plugin needs a server. For the label check the run adds the plugin to Decaid's plugin list in the browser and answers its Status request there: as a served Machine, as a Capture-only one, and as a plugin not yet connected at the first ask. Nothing saves a dial-in in that check: it shows the label only.

The theme is painted in the page and never stored: a stored theme is carried to Decaid's settings store, which every later page then reads back.

## Afterwards

```sh
docker rm -f cafe-smoke-decaid
```

A running Decaid keeps a CPU busy for as long as it is up.

## What it does not cover

A real machine and scale (the simulated scale reads no weight, so no Shot in the run has a weight-flow line, and the run's Unfinished Shot is one that never poured), the tablet's own WebView, the skin installed under its other id, touch input (a long-press is made with the mouse), the languages other than German, Arabic and French, a screen that is not 1920 by 1200, and a real Decent Sync plugin saving a change. Say so on the pull request when a change needs one of them.
