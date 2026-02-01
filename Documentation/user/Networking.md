# Networking

**Who this is for:** Users having connection issues or setting up advanced networking
**Prereqs:** [Getting Started](Getting-Started.md)

## Three WiFi Modes

### Mode 1: Offline (Phone → SOTAcat AP)

Default mode. No internet required.

1. Phone connects to SOTAcat's hotspot (`SOTACAT_xxxx`)
2. Radio control works fully
3. CHASE requires internet (will be empty)

**Best for:** No cell service, RUN-only operation

### Mode 2: iPhone Split Networking

iPhone stays connected to both SOTAcat WiFi and cellular.

1. Connect to `SOTACAT_xxxx`
2. When prompted "This network has no internet", tap **Use Without Internet**
3. iPhone maintains cellular data connection

**Best for:** iPhones with cell service

### Mode 3: Android Hotspot Tether

SOTAcat joins your phone's hotspot.

1. Enable mobile hotspot on your Android phone
2. In SOTAcat Settings → WiFi, enter your hotspot SSID and password
3. Save and reboot SOTAcat
4. SOTAcat connects to your phone; you access it via the phone's network

**Best for:** Android phones that drop cellular when on WiFi

<!-- 📷 SCREENSHOT NEEDED: Settings WiFi configuration help popup -->

## One-Time Setup

In Settings, configure:

1. **Callsign** — Your amateur radio callsign
2. **License class** — For band privilege indicators
3. **WiFi networks** — Choose mode above

## Symptoms and Fixes

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Page not loading | Wrong URL or not connected | Use `192.168.4.1`, verify WiFi |
| `.local` not resolving | Android limitation | Use `192.168.4.1` instead |
| "Connection lost" overlay | Network changed or SOTAcat rebooted | Reconnect to SOTAcat WiFi |
| CHASE is empty | No internet (normal in Mode 1) | Use Mode 2 or 3 for spots |

## Connection Lost Recovery

When you see "Connection lost. Reconnecting...":

1. Check your phone is still on SOTAcat WiFi
2. If not, reconnect to `SOTACAT_xxxx`
3. Wait for auto-reconnect or tap **Retry**

<!-- 📷 SCREENSHOT NEEDED: Connection lost overlay -->

---

[← UI Tour](UI-Tour.md) · [Troubleshooting →](Troubleshooting.md)
