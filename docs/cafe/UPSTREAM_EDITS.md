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
| `index.html` | The main page's markup is the cafe layout. It keeps the ids Streamline's modules drive, and hidden stubs for the two history arrows, the fullscreen toggle, and the steam tile's duration and mode elements. `<head>` gains `src/cafe/cafe.css`. The inline module that started Streamline's strip is gone: `src/cafe/start.js` starts it once DYE2 is known to be there. |
| `src/modules/app.js` | One import and one line at the top of `initMainPageOnce`: the main page starts only when `cafeMayStart()` in `src/cafe/start.js` says so. While it says no, `initMainPageOnce` returns `null` without starting, and the next call asks again. |
| `src/css/app.css` | Rebuilt for the fork's page. See above. |
| `.gitignore` | `test/cafe-smoke/out/`, the smoke run's screenshots. |

Streamline's modules are otherwise unedited. Where the page needs one to behave differently, it does so from outside, in `src/cafe/` and `src/cafe/cafe.css`:

- **Steam.** `ui.js` steps whichever of steam time and steam flow its tile mode names. `src/cafe/page.js` puts the mode back to flow at start-up and after each recipe load, through `setSteamTileModeIfSafe`.
- **Taps Streamline wires that the page does not offer yet.** `app.js` opens the profile list from `#profile-name` and DYE2's grinder page from `#grind-label`. `cafe.css` takes pointer events off both.
- **The help button.** `help-launcher.js` adds a "?" that explains Streamline's page. `cafe.css` hides it while the main page shows.
- **The footer.** `main.css` reserves 242px under `<main>` for Streamline's footer cards; `cafe.css` gives it back to the graph.

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
