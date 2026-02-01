# docs/ — Geolocation Module

**This directory contains code, not documentation.**

The JavaScript here powers the "Locate me" feature in the QRX page.

## Why This Exists

Browsers require a **secure context** (HTTPS) for the Geolocation API. Since SOTAcat serves pages over HTTP (no TLS on embedded device), we can't call `navigator.geolocation` directly.

**The workaround:**
1. QRX page opens a small HTTPS helper page (hosted externally or via GitHub Pages)
2. That page requests geolocation permission and gets coordinates
3. Coordinates are passed back to SOTAcat via URL parameters or postMessage

This module contains the HTTPS-side code that bridges the gap.

## For Documentation

See [Documentation/](../Documentation/) for user and developer guides.
