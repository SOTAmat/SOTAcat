# website/ — GitHub Pages Site

This directory is published to <https://sotamat.github.io/SOTAcat/> by
`.github/workflows/pages.yml`. It holds two things, both of which exist because
they need an **HTTPS origin** that the HTTP-only embedded device cannot provide.

## geolocation/ — Geolocation Bridge

Powers the "Locate me" feature in the QRX page.

Browsers require a secure context (HTTPS) for the Geolocation API. Since SOTAcat
serves pages over HTTP (no TLS on the embedded device), it can't call
`navigator.geolocation` directly.

**The workaround:**
1. QRX page opens this small HTTPS helper page
2. The page requests geolocation permission and gets coordinates
3. Coordinates are passed back to SOTAcat via URL parameters or postMessage

## flash/ — USB Web Serial Flasher

A one-button firmware installer at `/flash/`, built on
[esp-web-tools](https://esphome.github.io/esp-web-tools/). Web Serial also
requires a secure context, and the firmware binary must be fetched same-origin
(GitHub release assets send no CORS headers), so the Pages deploy **stages**
`manifest.json` and `esp32c3.bin` from the latest release into `flash/` at
deploy time. Only `index.html` is committed; the staged artifacts are
gitignored, and the workflow's assertions keep the deployed bytes identical to
the release.

The site therefore redeploys on every published release, not just on pushes
touching `website/`.

## For Documentation

See [docs/](../docs/) for user and developer guides — including
[USB-Flashing.md](../docs/user/USB-Flashing.md), the command-line counterpart
to the flasher page.
