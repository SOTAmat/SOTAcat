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

## End Users

For pre-built firmware with one-button install, see [sotamat.com/sotacat](https://sotamat.com/sotacat#InstallingFirmware)

---

[Architecture →](Architecture.md)

