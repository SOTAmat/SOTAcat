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

Releases are published to [GitHub Releases](https://github.com/SOTAmat/SOTAcat/releases) and are used by the firmware's automatic version-check feature.

```bash
make github-release
```

This single command:
1. Builds release firmware and runs the `package_webtools` PlatformIO target
2. Extracts the version tag from `include/build_info.h` (e.g., `BUILD_DATE_TIME "260225:1828"` becomes tag `v260225.1828`)
3. Creates a GitHub release with auto-generated notes and attaches three assets:

| Asset | Purpose |
|-------|---------|
| `SOTACAT-ESP32C3-OTA.bin` | OTA update binary |
| `esp32c3.bin` | Full merged flash image (for ESP Web Tools) |
| `manifest.json` | ESP Web Tools install manifest |

**Prerequisites:** The [GitHub CLI](https://cli.github.com/) (`gh`) must be installed and authenticated.

**Editing release notes:** The release is created with auto-generated notes from commits since the last release. You can edit the notes afterward on the GitHub Releases page.

## End Users

For pre-built firmware with one-button install, see [sotamat.com/sotacat](https://sotamat.com/sotacat#InstallingFirmware)

---

[Architecture →](Architecture.md)

