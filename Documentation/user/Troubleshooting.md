# Troubleshooting

**Who this is for:** Users experiencing issues

## Page Not Responding

1. Verify phone is connected to `SOTACAT_xxxx` WiFi
2. Try `http://192.168.4.1` (not https)
3. Check SOTAcat has power (LED on device)

## .local Not Resolving

Android's Chrome browser doesn't support mDNS (`.local` addresses). Use numeric IPs instead:

- **Mode 1 (Phone → SOTAcat AP):** Use `http://192.168.4.1`
- **Mode 3 (Android Hotspot):** SOTAcat pins to `.200` on your hotspot's subnet (e.g., `http://192.168.43.200`)

Use [Bonjour Browser](https://play.google.com/store/apps/details?id=de.wellenvogel.bonjourbrowser) to discover the exact address, then bookmark it.

## CHASE is Empty

This is normal when offline. CHASE fetches spots from the internet and has no offline storage.

To use CHASE, you need internet via:
- iPhone split networking (Mode 2)
- Android hotspot tether (Mode 3)

See [Networking](Networking.md) for setup instructions.

## Radio Not Responding

1. Check KX radio is powered on
2. Verify SOTAcat is plugged into CAT port
3. Try a different CAT cable
4. Check baud rate matches (38400 default for KX2/KX3)

## Buttons Disabled or Missing Config

Some features require configuration:

- Tune targets disabled? → Configure in Settings
- Band/mode buttons grayed? → Radio may be in menu or transmitting
- License badges wrong? → Set license class in Settings

## Still Stuck?

- **Bug?** [GitHub Issues](https://github.com/SOTAmat/SOTAcat/issues) — include firmware version, device type, steps to reproduce
- **Help?** #sotacat-sotamat on [SOTA-NA Slack](https://sota-na.slack.com)

---

[← Networking](Networking.md) · [FAQ →](FAQ.md)
