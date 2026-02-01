# SOTAcat — Phone-First Web Console for SOTA Activation

WiFi CAT control for Elecraft KX2/KX3. Connect your phone, control your radio.

```
┌─────────────────────────────────────────────────────┐
│  [UTC time]  [Battery %]  [RSSI]  [●]              │  ← Header
├──────────┬──────────┬──────────┬──────────┬────────┤
│   QRX    │  CHASE   │   RUN    │ Settings │ About  │  ← Tabs
└──────────┴──────────┴──────────┴──────────┴────────┘
```

| Tab | What You Do There |
|-----|-------------------|
| **QRX** | Clock sync, set location, enter activation reference |
| **CHASE** | Tap a spot → radio tunes automatically |
| **RUN** | Rig control, CW keyer, TX toggle, self-spot |
| **Settings** | Callsign, WiFi, tune targets |
| **About** | Version, attribution |

<!-- 📷 SCREENSHOT NEEDED: App header showing UTC, battery, RSSI, connection indicator -->

## Get Started in 60 Seconds

1. **Connect** — Join WiFi `SOTACAT_xxxx` (password: `12345678`)
2. **Open** — Browse to `http://192.168.4.1` or `http://sotacat.local`
3. **Verify** — You should see the header bar with UTC time, battery %, and green connection dot

> **Android note:** `.local` addresses may not work. Use `192.168.4.1` or see [Networking guide](Documentation/user/Networking.md).

## In the Field

### No Cell Service (Offline)
- **RUN** works fully: tune radio, send CW, toggle TX
- **CHASE** requires internet (empty when offline)
- Self-spot via **SOTAmat** FT8 synthesis (requires SOTAmat app + gateway coverage)

### With Cell Service
- **CHASE** live spots with tap-to-tune
- SMS Spot / SMS QRT buttons
- Full click-to-pounce workflow

> **Page not responding?** See [Networking troubleshooting](Documentation/user/Networking.md#connection-lost-recovery)

## What Works Without Internet

| Feature | Offline | Online | Notes |
|---------|---------|--------|-------|
| Radio control (RUN) | ✓ | ✓ | |
| CW keyer | ✓ | ✓ | |
| Clock sync | ✓ | ✓ | Syncs from phone clock |
| CHASE spots | ✗ | ✓ | Requires internet |
| SOTAmat FT8 | ✓* | ✓ | *Requires gateway coverage |

## Documentation

**Users:** [Getting Started](Documentation/user/Getting-Started.md) · [UI Tour](Documentation/user/UI-Tour.md) · [Networking](Documentation/user/Networking.md) · [Troubleshooting](Documentation/user/Troubleshooting.md)

**Developers:** [Build](Documentation/dev/BUILD.md) · [Architecture](Documentation/dev/Architecture.md) · [Web UI](Documentation/dev/Web-UI.md)

**Hardware:** [Get a SOTAcat](Documentation/Hardware.md)

## Get a SOTAcat

- **Buy pre-made:** [K5EM's Store](https://store.invertedlabs.com/product/sotacat/)
- **Build your own:** [Hardware guide](Documentation/Hardware.md)

## Support

- **Bug?** [GitHub Issues](https://github.com/SOTAmat/SOTAcat/issues)
- **Suggestion?** [GitHub Discussions](https://github.com/SOTAmat/SOTAcat/discussions)
- **Help?** #sotacat-sotamat on SOTA-NA Slack — [how to join](Documentation/user/FAQ.md#slack)

## Repository Layout

- `Documentation/` — User and developer documentation
- `docs/` — Geolocation engine code (powers "Locate me" feature)
