# Changes to Streamline's files

Every change Streamline Cafe makes to a file that came from Streamline, so a merge of a Streamline release has a checklist. New files under `src/cafe/`, `docs/cafe/` and `test/cafe-*.test.mjs` are the fork's own and are not listed.

Add a row in the same pull request as the change. Remove a row when the change goes away.

## Lines that conflict at every adoption

Streamline bumps its version with each release, and the fork's version sits on the same lines. Resolve each to the new Streamline version with the counter back at 1, such as `0.2.28-cafe.1`. `test/cafe-version.test.mjs` fails if they disagree.

- `skin-manifest.json`: `version`
- `src/version.js`: `APP_VERSION`
- `package.json`: `version`
- `package-lock.json`: `version`, twice

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
