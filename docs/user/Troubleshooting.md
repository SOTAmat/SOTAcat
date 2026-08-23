# Troubleshooting

**Who this is for:** Users experiencing issues

## Page Not Responding

1. Verify phone is connected to `SOTACAT_xxxx` WiFi
2. Try `http://192.168.4.1` (not https)
3. Check SOTAcat has power (LED on device — see [LED Patterns](LED-Patterns.md))

## .local Not Resolving

Android's Chrome browser doesn't support mDNS (`.local` addresses). Use numeric IPs instead:

- **Mode 1 (Phone → SOTAcat AP):** Use `http://192.168.4.1`
- **Mode 3 (Android Hotspot):** Enable "Pin IP to x.x.x.222" in Settings to prevent losing connectivity when cell network flaps. SOTAcat will be at `x.x.x.222` on your hotspot's subnet (e.g., `http://192.168.43.222`)

Use [Bonjour Browser](https://play.google.com/store/apps/details?id=de.wellenvogel.bonjourbrowser) to discover the exact address, then bookmark it.

## CHASE is Empty

This is normal when offline. CHASE fetches spots from the internet and has no offline storage.

To use CHASE, you need internet via:
- iPhone split networking (Mode 2)
- Android hotspot tether (Mode 3)

See [Networking](Networking.md) for setup instructions.

## Radio Not Responding

The circle in the header turns ⚫ within a couple of seconds of the radio going
quiet, and back to 🟢 within a few seconds of it answering again, on any tab and
without a reload. While it is ⚫ the rest of SOTAcat keeps working: you can browse
CHASE, use Settings, and send QRT or Spot SMS (they don't need the radio). Tune and
mode buttons report "radio link down" until it comes back.

1. Check the radio is powered on (a KX2/KX3 that has auto-powered-off shows ⚫)
2. Verify SOTAcat is plugged into the CAT port
3. Try a different CAT cable
4. Check baud rate matches (38400 default for KX2/KX3, 9600 baud for KH1)

If a Tune reports "radio busy (FT8)", SOTAmat is in the middle of an FT8
transmission through SOTAcat. Wait for it to finish; the circle is ⚪ meanwhile.

## Buttons Disabled or Missing Config

Some features require configuration:

- Tune targets disabled? → Configure in Settings
- Band/mode buttons grayed? → Radio may be in menu or transmitting
- License badges wrong? → Set license class in Settings

## CHASE Missing Spots

CHASE filters spots to bands your radio can natively cover (KX2/KX3/KH1 native band lists). If you operate with a transverter and expect VHF/UHF spots, disable **"Show only bands my radio can access"** under Settings. The filter defaults to on.

## Firmware Too Old to Update Itself

What the Settings page shows tells you which era of firmware you're on, and which update path you have:

- **No firmware section at all** — pre-August-2024 firmware with no OTA support. The only route to current firmware is USB: use the [browser flasher](https://sotamat.github.io/SOTAcat/flash/) (desktop Chrome, Edge, or Opera). Note this is a factory reset.
- **An "Upload Firmware" button** — manual OTA. Download `SOTACAT-ESP32C3-OTA.bin` from the [latest release](https://github.com/SOTAmat/SOTAcat/releases/latest) yourself and upload it there; settings are preserved.
- **A "Check Updates" wizard** — modern firmware. Let it fetch and install the update for you.

If the browser flasher rejects your browser (Firefox, Safari, phones), flash from the [command line](USB-Flashing.md) instead.

## Controls Broken After a Firmware Update

If the UI loads but some controls stop working after you update firmware (e.g. band, mode, or frequency buttons in the Tune section snap back or do nothing), your browser is likely running stale cached scripts from the old version.

Fix it by forcing a fresh load:

- **Quick check:** open the page in a Private/Incognito tab. If it works there, it's a cache problem.
- **iOS Safari:** Settings → Apps → Safari → Clear History and Website Data, then reopen the page.
- **Android Chrome / desktop:** fully quit the browser and reopen, or clear cached site data for the SOTAcat address.

## Still Stuck?

- **Bug?** [GitHub Issues](https://github.com/SOTAmat/SOTAcat/issues) — include firmware version, device type, steps to reproduce
- **Help?** #sotacat-sotamat on [SOTA-NA Slack](https://sota-na.slack.com)

---

[← Networking](Networking.md) · [FAQ →](FAQ.md)

