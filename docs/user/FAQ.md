# FAQ

**Who this is for:** Common questions and community resources

## How do I join the SOTA-NA Slack? {#slack}

The #sotacat-sotamat channel is on the SOTA-NA Slack workspace.

1. Visit [sota-na.slack.com](https://sota-na.slack.com)
2. If you need an invitation, contact KC6X via [qrz.com](https://www.qrz.com/db/KC6X)
3. Once joined, find the #sotacat-sotamat channel

## What's the default WiFi password?

The default password for the SOTAcat hotspot is `12345678`.

If your device has a different password (some hardware revisions), check the About page or device documentation.

## Does SOTAmat really work without cell service?

Yes, but with requirements:
- You need the SOTAmat app installed on your phone
- SOTAcat generates an FT8 signal that must be received by a gateway station
- The gateway reports your spot to the network

This works in areas with no cell service but where FT8 propagation reaches an RBN/PSKreporter gateway.

## Why doesn't .local work on my Android?

Android's mDNS support varies by device and OS version. Use `http://192.168.4.1` instead, or install [Bonjour Browser](https://play.google.com/store/apps/details?id=de.wellenvogel.bonjourbrowser) to discover the address.

## Where do firmware updates come from?

The Firmware card in Settings checks [SOTAcat's GitHub Releases](https://github.com/SOTAmat/SOTAcat/releases) directly. That's the only authoritative source. Don't trust mirrors or side-channel binaries.

## Why is my CHASE list missing VHF/UHF (or other) spots?

By default, CHASE filters to bands your KX2/KX3/KH1 natively supports. If you operate with a transverter, uncheck **"Show only bands my radio can access"** in Settings to see all spots.

---

[← Troubleshooting](Troubleshooting.md)

