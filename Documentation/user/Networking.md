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

> **[ 📷 IMAGE: Settings WiFi configuration help popup ]**
> `../images/settings-wifi-help.png`

#### Stable IP Address (.200)

When connecting to a phone hotspot, SOTAcat automatically pins itself to `.200` on whatever subnet your phone assigns. For example, if your hotspot uses `192.168.43.x`, SOTAcat will always be at `192.168.43.200`.

**Why this matters:** Android hotspots can briefly disconnect when mobile data flaps (switching towers, signal drops, etc.). Without a stable IP, you'd need to rediscover SOTAcat's address each time. With the pinned `.200` address, your browser reconnects automatically after brief interruptions.

**First-time setup:**
1. Use [Bonjour Browser](https://play.google.com/store/apps/details?id=de.wellenvogel.bonjourbrowser) to discover SOTAcat
2. Note the address (e.g., `192.168.43.200`)
3. Bookmark it — this address stays stable as long as your hotspot uses the same subnet

**When you need to rediscover:** If your phone's hotspot changes subnets (rare — usually only after phone reboot or hotspot reconfiguration), use Bonjour Browser once to find the new `.200` address.

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

> **[ 📷 IMAGE: Connection lost overlay ]**
> `../images/connection-lost.png`

---

[← UI Tour](UI-Tour.md) · [Troubleshooting →](Troubleshooting.md)

