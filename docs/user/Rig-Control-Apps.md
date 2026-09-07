# Rig Control from Desktop Apps (rigctld)

SOTAcat speaks the Hamlib **NET rigctl** protocol on TCP port **4532**, so
desktop ham apps can control your radio over WiFi — no serial cable, no extra
software on the SOTAcat side. Anything that offers a "Hamlib NET rigctl"
(model 2) rig type works.

## Connecting

Point the app at your SOTAcat's address, port 4532:

- Hostname: `sotacat.local` (or the IP from your router / `x.x.x.222` pin)
- Rig model: **2** (Hamlib NET rigctl)

Quick check from a terminal with Hamlib installed:

```bash
rigctl -m 2 -r sotacat.local:4532 f     # read frequency
rigctl -m 2 -r sotacat.local:4532 F 14285000   # set frequency
rigctl -m 2 -r sotacat.local:4532 l STRENGTH   # S-meter, dB relative to S9
```

## Verified client

- **rigctl** (Hamlib 4.5.5 command-line client) — tested against SOTAcat
  hardware: frequency/mode get and set, PTT read, S-meter, power and AF
  levels, and the session handshake.

## Untested

Apps with a "Hamlib NET rigctl" backend (WSJT-X, JS8Call, QLog, SDR++'s
*Rigctl client* module, and others) target this protocol, but **none have
been tested with SOTAcat** — apps layer their own requirements on top of the
protocol, so no compatibility is claimed until one is verified. If you try
one, please report results — good or bad — on the SOTAmat Slack, and this
page will be updated. Note that SOTAcat does not implement split or VFO B,
which some digital-mode workflows expect.

Two apps can be connected at the same time; a third connection waits until
one disconnects.

## What is supported

| Command | Notes |
|---------|-------|
| Frequency get/set | |
| Mode get/set | USB/LSB/CW/CWR/AM/FM/PKTUSB/PKTLSB (RTTY and DATA map to data mode) |
| PTT get/set | |
| S-meter | `STRENGTH` (dB relative to S9) and `RAWSTR` (KX bar units 0–15); KX2/KX3 only |
| Power level | `RFPOWER`, read/set, scaled to 12 W max |
| AF gain | `AF`, read/set (KX2/KX3 only) |
| CW keying | `send_morse` — same keyer path as the web UI |
| ATU tune | `set_func TUNER 1` |

Not (yet) supported: split / VFO B, RIT/XIT, keyer speed, filter bandwidth.
While the radio link is down the server answers `RPRT -6`; during an FT8
transmission started from the web UI, reads return the last-known state and
changes are refused until the transmission ends.

The web UI and desktop apps share one radio picture — a frequency set from
WSJT-X shows up in the SOTAcat header, and vice versa.
