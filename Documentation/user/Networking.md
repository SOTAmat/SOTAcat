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

#### Recommended: Pin IP to .222

For each Client network, you can enable **Pin IP to .222** in Settings. When enabled, SOTAcat pins itself to `.222` on whatever subnet the network assigns. For example, if your hotspot uses `192.168.43.x`, SOTAcat will be at `192.168.43.222`.

**Why this matters for Android hotspots:** When the mobile cell network flaps (switching towers, brief signal loss), Android hotspots can reassign SOTAcat's IP address. Without a stable IP, your browser loses its connection and you have to rediscover SOTAcat each time. With the pinned `.222` address, your browser reconnects automatically after brief interruptions.

**Why you might NOT want this:** On home networks with many devices, the `.222` address might already be in use by another device, causing an IP conflict. For home networks, leave this disabled and use `sotacat.local` instead.

**Setup:**
1. In Settings, enable "Pin IP to .222" for your hotspot network
2. Use [Bonjour Browser](https://play.google.com/store/apps/details?id=de.wellenvogel.bonjourbrowser) to discover SOTAcat's `.222` address

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

