# Building SOTAcat Firmware

**Who this is for:** Developers contributing to SOTAcat firmware

## Prerequisites

- [PlatformIO](https://platformio.org/) (standalone or VSCode extension)
- Python 3.x (for integration tests)
- Git

## Quick Start

```bash
git clone git@github.com:SOTAmat/SOTAcat.git
cd SOTAcat
pio run --target upload
```

## VSCode Setup

1. Install [VSCode](https://code.visualstudio.com/)
2. Install [PlatformIO extension](https://platformio.org/install/ide?install=vscode)
3. Open the SOTAcat folder
4. Select build target in status bar (bottom)
5. Click "PlatformIO: Upload" (→ icon)

## Makefile Targets

### Build

| Target | Description |
|--------|-------------|
| `make build` | Build firmware (release) |
| `make debug` | Build debug firmware |
| `make release` | Build release firmware |
| `make upload` | Build and upload via USB |
| `make ota` | Build OTA-ready binary |

### OTA Updates

| Target | Description |
|--------|-------------|
| `make ota-upload` | Upload via WiFi to `sotacat.local` |
| `make ota-upload IP=192.168.1.100` | Upload to specific IP |

### Testing

| Target | Description |
|--------|-------------|
| `make test-setup` | Create Python venv and install deps |
| `make test` | Run integration tests |
| `make test HOST=192.168.1.100` | Test specific device |

### Release

| Target | Description |
|--------|-------------|
| `make github-release` | Build firmware and create a GitHub release |

### Utility

| Target | Description |
|--------|-------------|
| `make monitor` | Open serial monitor |
| `make clean` | Clean build artifacts |
| `make help` | Show all targets |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENV` | `seeed_xiao_esp32c3_release` | Build environment |
| `IP` | `sotacat.local` | Device for OTA upload |
| `HOST` | `sotacat.local` | Device for testing |

## Common Issues

**"x509_crt_bundle not found" or "file failed to open for reading: x509_crt_bundle"**

The pre-build script pre-generates the certificate bundle. If it still fails, ensure `cryptography` is installed in the ESP-IDF Python environment:
```bash
# Windows:
& "$env:USERPROFILE\.platformio\penv\.espidf-5.5.0\Scripts\python.exe" -m pip install cryptography

# macOS/Linux:
~/.platformio/penv/.espidf-5.5.0/bin/python -m pip install cryptography
```

**"ModuleNotFoundError: No module named 'intelhex'"**

Install in PlatformIO's Python:
```bash
& "$env:USERPROFILE\.platformio\penv\Scripts\pip.exe" install intelhex
```

**"ModuleNotFoundError: No module named 'idf_component_manager'"**

The pre-build script auto-installs this when missing. If it still fails, run manually:
```bash
# Windows (adjust path if your PlatformIO/IDF version differs):
& "$env:USERPROFILE\.platformio\penv\.espidf-5.5.0\Scripts\python.exe" -m pip install idf-component-manager

# macOS/Linux:
~/.platformio/penv/.espidf-5.5.0/bin/python -m pip install idf-component-manager
```

**"Submodule not initialized"**
```bash
git submodule update --init --recursive
```

**Upload fails with permission error**
```bash
# Linux: add user to dialout group
sudo usermod -aG dialout $USER
# Then log out and back in
```

## Creating a Release

**GitHub Releases is the sole source of truth for SOTACAT firmware.** Both the firmware's automatic version-check (which queries the GitHub Releases API) and the ESP Web Tools flasher read exclusively from [GitHub Releases](https://github.com/SOTAmat/SOTAcat/releases). `make github-release` is the only sanctioned publish path.

**Prerequisites:** The [GitHub CLI](https://cli.github.com/) (`gh`) must be installed and authenticated, and a device must be available for pre-publish testing.

### What must hold, or deployed devices break

A release is not just a tarball — every SOTACAT in the field polls it daily. Violating any
of these silently breaks the update path for *all* users, not just new ones:

| Invariant | Enforced by | Failure mode |
|-----------|-------------|--------------|
| Tag is exactly `vYYMMDD.HHMM` — no suffix, no semver | `normalizeVersion` in `src/web/main.js` | "Invalid version format in release tag"; update check dead |
| Assets named exactly `SOTACAT-ESP32C3-OTA.bin`, `esp32c3.bin`, `manifest.json` | exact-name asset lookup in `src/web/main.js`; fallback URL in `src/web/settings.js` | Update prompt appears, download 404s |
| Release is **not** a draft and **not** a prerelease | GitHub's `/releases/latest` skips both | Release invisible to every consumer |
| `manifest.json`'s embedded download URL carries the release tag | `_write_manifest_file()` bakes an absolute URL *before* the release exists | ESP Web Tools flasher 404s for new users |
| `include/build_info.h` in the **tagged commit** equals the tag | `src/hardware_specific.cpp` builds the device version string from it | Device version never matches the tag → perpetual update prompt, or permanent false "up to date" |

The three assets, all built into `firmware/webtools/` by the `package_webtools` target:

| Asset | Purpose |
|-------|---------|
| `SOTACAT-ESP32C3-OTA.bin` | OTA update binary |
| `esp32c3.bin` | Full merged flash image (for ESP Web Tools) |
| `manifest.json` | ESP Web Tools install manifest |

### The tag is discovered, not chosen

`make github-release` builds *first*, then derives the tag from `include/build_info.h`
(`BUILD_DATE_TIME "260225:1828"` → `v260225.1828`), then requires a hand-written
`RELEASE_NOTES_<TAG>.md` in the repo root. So you cannot name the notes file until the
build has stamped the version. Release is therefore a two-pass process.

`build_info.h` is re-stamped only when a source file's **mtime** is newer than the
header's (`_should_update_build_info()` in `pio-pre-build-script.py`). That heuristic is
not trustworthy — a `git checkout`, a stash, or a file-sync client can advance the header's
mtime while restoring older content, after which no build will ever re-stamp it. Force the
stamp rather than trusting it.

### Procedure

```bash
# 1. Start clean and in sync — `gh release create` passes no --target, so it tags
#    whatever origin/main points at, not your local HEAD.
git status --porcelain          # must be empty
git rev-parse HEAD origin/main  # must be identical

# 2. Force a fresh stamp and build the artifacts.
touch src/web/main.js
pio run -e seeed_xiao_esp32c3_release -t package_webtools
#    Confirm the log says "Updated include/build_info.h ...", not "Skipped".

TAG=$(sed -n 's/.*BUILD_DATE_TIME "\([0-9]*\):\([0-9]*\)".*/v\1.\2/p' include/build_info.h)
STAMP=$(sed -n 's/.*BUILD_DATE_TIME "\([^"]*\)".*/\1/p' include/build_info.h)
sha256sum firmware/webtools/* | tee /tmp/release-digests.txt

# 3. Verify the artifacts before they touch hardware.
jq -r '.version, .builds[0].parts[0].path' firmware/webtools/manifest.json   # both carry $TAG
strings firmware/webtools/SOTACAT-ESP32C3-OTA.bin | grep -F "$STAMP"        # binary carries $STAMP

# 4. Test the exact candidate on a real device.
make test-unit
make ota-upload IP=sotacat.local
curl -s http://sotacat.local/api/v1/version          # must echo $STAMP
SOTACAT_TEST_HOST=sotacat.local SOTACAT_TEST_ARGS="--all --ui" \
  pio run -e seeed_xiao_esp32c3_release -t verify_and_publish_webtools
sha256sum -c /tmp/release-digests.txt                # tested bits == publish candidate

# 5. Write RELEASE_NOTES_$TAG.md (see below), then commit and push.
git add include/build_info.h && git commit -m "release $TAG"
git push origin main
git show HEAD:include/build_info.h                   # must contain $STAMP

# 6. Publish, then verify from the outside as a device sees it.
make github-release
curl -s https://api.github.com/repos/SOTAmat/SOTAcat/releases/latest \
  | jq '{tag_name, draft, prerelease, assets: [.assets[].name]}'
```

Finally, on the device — still running `$TAG` — trigger "check for updates" in Settings. It
must report **up to date** and must not prompt. A prompt here means the tag and the device
version disagree.

**Release notes:** `RELEASE_NOTES_<TAG>.md` is required — `make github-release` aborts
without it. It is gitignored (transient input, published to the release body), so there are
no examples in the repo; retrieve the form from a published release with
`gh release view <previous-tag> --json body -q .body`. Draft it from
`git log --oneline <previous-tag>..HEAD`. Notes can be edited afterward on the Releases page.

### Mirroring a release to sotamat.com (optional, not recommended)

Hosting a copy of the firmware on sotamat.com is **optional and not recommended**. If a mirror is published, it must be a byte-identical copy of the `SOTACAT-ESP32C3-OTA.bin` asset from an already-published GitHub Release — never a fresh local rebuild. A rebuild re-stamps `BUILD_DATE_TIME` in `include/build_info.h` (see [above](#the-tag-is-discovered-not-chosen)), producing a phantom version that no update check can ever see: devices flashed with it will report "up to date" against an older GitHub tag. See issue [#100](https://github.com/SOTAmat/SOTAcat/issues/100) for the incident that motivated this rule.

## End Users

For pre-built firmware with one-button install, see [sotamat.com/sotacat](https://sotamat.com/sotacat#InstallingFirmware). When present, the firmware hosted there mirrors the latest GitHub Release; the authoritative download is always [GitHub Releases](https://github.com/SOTAmat/SOTAcat/releases).

---

[Architecture →](Architecture.md)

