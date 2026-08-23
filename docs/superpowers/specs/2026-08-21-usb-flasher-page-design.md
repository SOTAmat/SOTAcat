# USB Web Serial Flasher on GitHub Pages — Design

**Status:** Design approved 2026-08-21. Implemented on this branch 2026-08-22.
Tested 2026-08-22: localhost smoke test, then a real flash of a connected
SOTAcat from the localhost-served page — successful. Tested 2026-08-23: CLI
acceptance — USB-Flashing.md commands run verbatim (esptool v5.3.1, Linux,
auto-detected port among 34 candidates incl. an unrelated FTDI adapter); erase
+ write via the stub flasher, hash verified, device booted to AP mode. Open
Question 3 settled: stub is reliable, no `--no-stub` needed. 2026-08-23:
v260804.2114 manifest asset patched to the relative path per Rollout
sequencing and re-verified from a fresh download (binary untouched, all
deploy assertions pass). Merged to main 2026-08-23 (6e40057); first deploy
passed all assertions and the post-deploy sha256 check; a real SOTAcat was
then flashed from the live Pages URL successfully — launch gate met. Sole
remaining item, sotamat.com coordination (Open Question 4), filed as
[SOTAmatApp#11](https://github.com/SOTAmat/SOTAmatApp/issues/11).
**Date:** 2026-08-21
**Scope:** New page under `website/flash/`, a new `docs/user/USB-Flashing.md`,
a change to `_write_manifest_file()` in `pio-pre-build-script.py`, additions to
`.github/workflows/pages.yml`, and docs wiring. No firmware changes.

## Problem

Three separate failures leave some users with no working path to current firmware.

**1. Pre-OTA devices cannot update themselves.** OTA arrived in `81e9a78`
(2024-08-22, "fix #13: implement OTA updates"). The repo's first commit is
2024-02-13, so roughly six months of builds have no `/api/v1/ota` endpoint and
no firmware section on the Settings page at all. A user on such a build (e.g.
`240514:2227-D`) has nothing to click; USB is the only route.

**2. The only public USB flasher is broken.** `https://sotamat.com/sotacat/`
embeds `esp-web-tools@10` pointed at `https://sotamat.com/wp-content/uploads/manifest.json`,
which names tag `v260323.0932`. That release does not exist — the asset URL
returns 404, `gh release view` reports "release not found", the remote has no
such tag, and nothing in repo history ever stamped `260323`. It is a phantom
build of exactly the kind `docs/dev/BUILD.md` §mirror warns about: a local
rebuild re-stamped `BUILD_DATE_TIME`, its artifacts were uploaded to WordPress,
and no matching release was ever published. The mirrored
`SOTACAT-ESP32C3-OTA.bin` beside it (1,199,888 bytes, `Last-Modified`
2026-03-23 16:36 GMT) corroborates the story.

**3. The manifest format cannot work cross-origin any more.** Even with a
correct tag, esp-web-tools fetches the firmware with `fetch()`, and GitHub
release assets no longer permit that (see Verified Facts). A manifest hosted on
one origin pointing at a binary on GitHub is unusable by any browser.

Compounding all three: no user-facing doc covers USB flashing at all.

## Goal

A first-party, always-current USB flashing page hosted on infrastructure we
control, which cannot silently rot the way the WordPress mirror did, and which
`docs/user/` links to as the canonical USB path.

Paired with it, a written CLI procedure covering what the page structurally
cannot: browsers without Web Serial, mobile, and rollback. The page is the easy
path; the doc is the one that always works.

## Non-goals

- **Not a firmware hub.** OTA remains documented in Getting-Started and on the
  device's own Settings page. This page does one thing: install over USB.
- **No version picker.** Latest release only. Rolling back means the CLI, which
  `docs/user/USB-Flashing.md` covers.
- **No replacement for `make github-release`.** The release process is unchanged
  except for one added assertion.
- **Not a fix for sotamat.com.** That page is outside this repo. Once this ships
  it can point at our manifest or simply link here; coordinating that is
  follow-up work, not a dependency.

## Verified facts

Everything below was checked on 2026-08-21, not assumed.

| Fact | Evidence |
|---|---|
| Pages publishes `website/`, not `docs/` | `pages.yml` uploads `./website` and `build_type` is `workflow`, which makes the API's `source: main:/docs` vestigial. `…/geolocation/bridge.js` → 200; `…/user/Troubleshooting.md` → 404 |
| Site is `https://sotamat.github.io/SOTAcat/` with `https_enforced: true` | `gh api repos/SOTAmat/SOTAcat/pages`. Satisfies Web Serial's secure-context requirement |
| GitHub **release assets** send no CORS headers | `GET` with `Origin`, `Sec-Fetch-Mode: cors` → no `access-control-allow-origin`; final hop is `release-assets.githubusercontent.com` (`server: Windows-Azure-Blob/1.0`); preflight `OPTIONS` → 404. Control: `api.github.com` returns `access-control-allow-origin: *`, so the probe is sound |
| GitHub **Pages** sends `access-control-allow-origin: *` | `GET` with `Origin` on `…/geolocation/bridge.js` |
| esp-web-tools resolves part paths against the manifest URL | `install-dialog-*.js`: `u = new URL(manifestPath, location)`, then `new URL(e.path, u)`, fetched with `fetch()` |
| The release's `manifest.json` has no consumers | No references in `src/`, `include/`, or `test/`. `main.js` looks up `SOTACAT-ESP32C3-OTA.bin` by name; `settings.js:1294` uses the `releases/latest/download/` alias |
| `releases/latest/download/<asset>` tracks the newest release | `esp32c3.bin` → 200, 1,280,576 bytes; `SOTACAT-ESP32C3-OTA.bin` → 200, 1,215,040 bytes |
| Merged image layout | `merge_binaries.py`: bootloader `0x0`, partitions `0x8000`, app `0x10000`, dio/80m/4MB |

## Architecture

Three artifacts under `website/flash/`, served at
`https://sotamat.github.io/SOTAcat/flash/`:

```
website/flash/index.html      committed
website/flash/manifest.json   downloaded from the release at deploy
website/flash/esp32c3.bin     downloaded from the release at deploy
```

The manifest and binary sit **side by side on one origin**. That is the whole
architectural idea: it satisfies CORS (same-origin), and a relative path in the
manifest means nothing is pinned to a tag, so the artifacts cannot drift out of
step with each other.

### 1. Manifest contract (`pio-pre-build-script.py`)

`_write_manifest_file()` changes one field, from an absolute per-tag URL to a
relative filename:

```python
"parts": [{"path": "esp32c3.bin", "offset": 0}]
```

The `version` field still carries the real tag from `build_info.h`, so the
install dialog names the version truthfully.

This makes the **release's own `manifest.json` the single source of truth** —
CI copies it, never regenerates it, so there is no second definition of the
schema to drift. It also deletes a documented hazard: `BUILD.md:135` currently
lists "`manifest.json`'s embedded download URL carries the release tag …
`_write_manifest_file()` bakes an absolute URL *before* the release exists" as
a known failure mode. With a relative path the build script no longer needs to
know a URL that does not yet exist.

The absolute form was not pointless — it served a "manifest hosted elsewhere,
binary on GitHub" model that presumably worked when release assets still sent
CORS headers. GitHub's move to Azure Blob-backed asset serving eroded that, and
the only consumer built on it (sotamat.com) is already broken twice over.

The `github-release` target in the `Makefile` gains the same assertion, run
against `firmware/webtools/manifest.json` after `package_webtools` and before
`gh release create`, so a regression fails at the point of creation rather than
one step downstream at deploy.

### 2. The page (`website/flash/index.html`)

Self-contained HTML and CSS, no framework, no build step. It drops into the
existing `upload-pages-artifact` path untouched. Content, in order:

1. **Requirements first** — desktop Chrome, Edge, or Opera. Web Serial does not
   exist on iOS or Android, and a user on a phone must learn that before
   reading anything else.
2. **A prominent factory-reset warning**, with a link to Getting-Started for the
   settings-preserving OTA route. Users who can OTA should not be here.
3. **The install button**, with both `unsupported` and `not-allowed` slots
   filled, reusing the plain-language wording sotamat.com already proved out:

   ```html
   <esp-web-install-button manifest="manifest.json">
   ```

   The `unsupported` slot links to `USB-Flashing.md` — a user who has just
   learned their browser cannot do this needs the alternative in the same
   breath, not a search. Because Pages does not publish `docs/` (verified
   above), that link must be an absolute
   `https://github.com/SOTAmat/SOTAcat/blob/main/docs/user/USB-Flashing.md`.
   It is the one hand-maintained cross-repo link in the design; the acceptance
   test checks it resolves.

4. **The two gotchas that actually defeat people** — charge-only USB cables, and
   the 60-second idle sleep window.
5. **Where to go next** — link to Getting-Started for reconnecting to the
   `SOTAcat-XXXX` hotspot. This page does not restate setup.
6. **Displayed release version**, fetched from
   `api.github.com/repos/SOTAmat/SOTAcat/releases/latest` (CORS-enabled, verified)
   as progressive enhancement, linking to the release notes. If that fetch fails
   the page still installs; it just does not name the version.

`esp-web-tools@10` loads from unpkg, matching upstream's documented usage and
the existing sotamat page. Accepted risk, recorded under Open Questions.

### 3. Deploy workflow (`.github/workflows/pages.yml`)

Triggers gain a release event — the site now redeploys when a release is
published, not only when `website/` changes:

```yaml
on:
  push:
    branches: [main]
    paths: ['website/**', '.github/workflows/pages.yml']
  release:
    types: [published]
  workflow_dispatch:
```

A staging step runs before `upload-pages-artifact`, writing into the runner's
throwaway `./website` tree. Nothing is committed:

```yaml
- name: Stage firmware for the flasher
  env: { GH_TOKEN: ${{ github.token }} }
  run: |
    set -euo pipefail
    TAG=$(gh release view --repo "$GITHUB_REPOSITORY" --json tagName -q .tagName)
    gh release download "$TAG" --repo "$GITHUB_REPOSITORY" \
      --pattern 'esp32c3.bin' --pattern 'manifest.json' --dir website/flash
    test -s website/flash/esp32c3.bin
    [ "$(jq -r '.builds[0].parts[0].path' website/flash/manifest.json)" = "esp32c3.bin" ]
    [ "$(jq -r '.version' website/flash/manifest.json)" = "$TAG" ]
```

`set -euo pipefail`, `test -s`, and hard assertions with no `|| true` anywhere:
a missing asset or a manifest that regressed to an absolute URL kills the deploy
rather than publishing a flasher that fails in a user's browser.

A post-deploy step then checks reality rather than intent:

```yaml
- name: Verify deployed firmware matches the release
  run: |
    set -euo pipefail
    for i in 1 2 3 4 5; do
      curl -fsSL "${{ steps.deployment.outputs.page_url }}flash/esp32c3.bin" \
        -o deployed.bin && break || sleep 10
    done
    [ "$(sha256sum < deployed.bin)" = "$(sha256sum < website/flash/esp32c3.bin)" ]
```

The bounded retry absorbs Pages propagation lag, then fails loudly. This makes
"the live site serves the exact bytes of the published release" a CI-enforced
invariant — precisely the property nobody was checking when the WordPress mirror
drifted onto a phantom build.

`.gitignore` gains `website/flash/esp32c3.bin` and `website/flash/manifest.json`
so a local test run cannot accidentally commit a binary.

Existing `permissions: contents: read` already covers `gh release download`, and
the existing `concurrency: pages` group with `cancel-in-progress: false` queues a
release and a push racing each other.

### 4. CLI fallback (`docs/user/USB-Flashing.md`)

A new user doc, not a developer one — `dev/BUILD.md` covers building from
source, which is a different audience with a different goal. This covers
flashing a *published* binary from the command line.

It exists because the page cannot serve everyone. Web Serial is desktop
Chrome/Edge/Opera only: Firefox, Safari, iOS, and Android users have no
browser path at all, and today they have nowhere to go. It is also the only
route for rollback.

The content is the knowledge that currently lives in support conversations and
nowhere else:

- **Which binary, and at which offset.** `esp32c3.bin` is the merged image
  (bootloader `0x0`, partitions `0x8000`, app `0x10000`) and flashes at `0x0`.
  `SOTACAT-ESP32C3-OTA.bin` is the app image and is for the Settings page only.
  Confusing the two is the most likely user error and the question that
  prompted this whole design.
- **Erase first, and why.** `write-flash 0x0` alone is the intuitive move and is
  wrong for pre-OTA devices. The partition layout changed on 2024-08-22
  (`ota_1` `0x170000` → `0x190000`, slots `0x160000` → `0x180000`, `eeprom` and
  `spiffs` dropped), so a stale `nvs` at `0x9000` and `otadata` at `0xe000`
  survive the write and reference a layout that no longer exists. `erase-flash`
  first. This is also why the doc must state plainly that flashing over USB is
  a factory reset — same warning the page carries.
- **esptool 5.x renamed its commands.** `erase-flash` and `write-flash`;
  the underscore forms still run but emit a deprecation warning. The doc names
  the version it was written against and shows the current spelling, so its
  rot is visible rather than silent.
- **Ports are auto-detected.** `--port` is only needed when several serial
  devices are present; the doc shows the bare command first.
- **Rollback**, using the `esp32c3.bin` from any older release.

Explicitly not covered: building from source, `pio run -t upload`, and
per-platform driver installation beyond a pointer. Scope creep here turns a
recovery card into a development guide.

## Rollout sequencing

The build-script change only affects the **next** release. `v260804.2114`'s
published `manifest.json` still carries the absolute, CORS-blocked URL, so a
workflow that copies it verbatim today would deploy a broken flasher.

**Resolution:** patch that one asset once. Download the published
`manifest.json`, change only `.builds[0].parts[0].path` to `esp32c3.bin`
(leaving `name` and `version` exactly as released), and
`gh release upload v260804.2114 manifest.json --clobber`. The binary assets are
not touched. Then let the assertions above guard everything after. Mutating a published
artifact is normally worth resisting; this file has no working consumers, is
currently wrong in a way that helps nobody, and the alternative is leaving
pre-OTA users on hex offsets until the next release.

Rejected: normalizing the path defensively in CI, which would work but silently
mask a build-script regression — the exact failure mode this design exists to
eliminate.

## Failure modes

| Failure | Behavior | Rationale |
|---|---|---|
| Release lacks `esp32c3.bin` | Deploy fails; **all** Pages deploys blocked until fixed | A release missing its asset is broken and should shout. Accepted coupling between the release process and the docs site |
| Manifest path regresses to absolute | Deploy fails at the assertion | Caught in CI, never by a user mid-flash |
| Deployed bytes differ from the release | Post-deploy sha256 check fails | Guards against a mangled artifact upload |
| Pages propagation lag | Bounded retry, then fail | No indefinite wait, no false pass |
| unpkg down or package yanked | Page loads, button never upgrades | Accepted; see Open Questions |
| Visitor's browser lacks Web Serial | `unsupported` slot renders and links to `USB-Flashing.md` | The one failure the page cannot fix, so it must hand off rather than dead-end |
| `api.github.com` version fetch fails | Page still installs, version not shown | Progressive enhancement only |
| No release exists (fresh fork) | `gh release view` fails, deploy fails | Acceptable; a fork without releases has nothing to flash |

## Testing

Web Serial cannot be unit-tested, so coverage is layered:

1. **CI, every deploy** — manifest assertions plus the sha256 identity check
   above. Automated, no human in the loop.
2. **Pre-merge, no hardware** — serve `website/` over `localhost` (a secure
   context, so Web Serial is live) and confirm the button renders and the port
   dialog opens.
3. **Acceptance, with hardware** — flash a real device from the deployed page.
   The only test that proves the whole chain end to end; it is the launch gate.
   Ideally on a genuinely old (pre-OTA) device, though a current one still
   exercises the path.
4. **Acceptance, CLI** — run the commands in `USB-Flashing.md` verbatim against
   real hardware, on the esptool version the doc names. A recovery procedure
   nobody has executed is a guess. This also settles Open Question 3.

## Docs wiring

- **`docs/user/USB-Flashing.md`** — new; see Architecture §4. Also add it to
  the *For Users* index in `docs/README.md`.
- **`docs/user/Troubleshooting.md`** — new era-diagnosis section. No firmware
  section on Settings = pre-2024-08-22, USB only; "Upload Firmware" = manual OTA
  (fetch the `.bin` from Releases yourself); "Check Updates" wizard = modern.
  Links to the flasher for the first case, and to `USB-Flashing.md` for anyone
  whose browser the flasher rejects. Routing lives here because the page itself
  is USB-only.
- **`docs/user/Getting-Started.md`** — the *Updating Firmware* section gains a
  pointer to the flasher for first-time and recovery flashing.
- **`website/README.md`** — its charter ("This directory contains code, not
  documentation") stops being true; it must describe both the geolocation bridge
  and the flasher.
- **`docs/dev/BUILD.md`** — drop the absolute-URL hazard row at `:135`; update
  the `jq` verification at `:177`, since only `.version` will carry the tag;
  revise the mirror guidance at `:211` to say *link to the Pages flasher* rather
  than *mirror byte-identically*; document the new release→Pages coupling.

## Open questions

1. **unpkg as a runtime dependency.** A third party sits in the firmware-recovery
   path, and the page silently stops working if unpkg is down or the package is
   yanked. Vendoring `dist/web/` (the loader plus its dynamically imported
   chunks) would remove that. Deferred deliberately; revisit if unpkg ever fails
   us.
2. **Prerelease policy.** `gh release view` with no tag returns the latest
   non-prerelease, so publishing a prerelease leaves the flasher on the last
   stable build. Believed correct, but it is a silent policy worth confirming
   rather than discovering.
3. **`CONFIG_ESPTOOLPY_NO_STUB=y`.** ~~`sdkconfig.defaults:35` disables the
   esptool stub loader with the comment "slower, but sometimes more reliable".
   Whether that reflects a known stub problem on this board — and so whether
   `USB-Flashing.md` should tell users to pass `--no-stub` — is unverified.~~
   **Settled 2026-08-23** by the CLI acceptance test: erase-flash and
   write-flash both ran via the stub on real hardware (esptool v5.3.1,
   USB-Serial/JTAG), write hash verified, device booted. The doc's bare
   commands stand; no `--no-stub` advice needed.
4. **sotamat.com coordination.** Once this ships, that page should link here or
   point its button at `https://sotamat.github.io/SOTAcat/flash/manifest.json`
   (viable — Pages sends `access-control-allow-origin: *`). Outside this repo;
   needs a conversation with its owner.
