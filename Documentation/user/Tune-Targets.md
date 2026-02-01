# Tune Targets

**Who this is for:** Users who want WebSDR/KiwiSDR to tune automatically when chasing

## What Are Tune Targets?

When you tap a spot in CHASE, SOTAcat can open browser tabs to WebSDR or KiwiSDR receivers, pre-tuned to the spot's frequency.

## Setup

In Settings → Tune Targets:

1. Tap **Add** to create a new target
2. Enter a URL with placeholders
3. Save

## Placeholders

| Placeholder | Replaced With | Example |
|-------------|---------------|---------|
| `{FREQ-HZ}` | Frequency in Hz | `14062000` |
| `{FREQ-KHZ}` | Frequency in kHz | `14062` |
| `{FREQ-MHZ}` | Frequency in MHz | `14.062` |
| `{MODE}` | Mode (cw, usb, lsb, etc.) | `cw` |

## Example URLs

**WebSDR:**
```
http://websdr.example.com/?tune={FREQ-KHZ}{MODE}
```

**KiwiSDR:**
```
http://kiwisdr.example.com:8073/?f={FREQ-KHZ}{MODE}
```

<!-- 📷 SCREENSHOT NEEDED: Settings Tune Targets help popup -->

## Tips

- Add up to 5 tune targets
- "Enable on mobile browsers" opens tabs automatically on tap
- Test your URLs by manually substituting values first

---

[← Networking](Networking.md)
