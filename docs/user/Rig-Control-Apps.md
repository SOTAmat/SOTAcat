# Rig Control from Desktop Apps (rigctld)

SOTAcat speaks the Hamlib **NET rigctl** protocol on TCP port **4532**, so
ham apps can control your radio over WiFi. No serial cable is needed, and no
extra software on the SOTAcat side. Apps that offer a "Hamlib NET rigctl"
(model 2) rig type target this protocol. The ones tested so far are listed
under [Verified clients](#verified-clients).

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

## Verified clients

- **rigctl** (Hamlib 4.5.5 command-line client) — tested against SOTAcat
  hardware: frequency/mode get and set, PTT read, S-meter, power and AF
  levels, and the session handshake.
- **Ham2K**: partly verified. See [Ham2K](#ham2k) for what was tested and
  what is known not to work.

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

## Ham2K

Ham2K connects as a rigctld client. Each line below says how it is known.
"From source" means read from the SOTAcat firmware and from Ham2K's driver
(`ham2k/halo` at commit `1cd2b43`), not observed in the app.

### Verified on hardware

- Ham2K finds a SOTAcat by itself. Ham2K listed the unit under "Detected
  Equipment" and connected to it once added, both with the SOTAcat joined
  to the Android phone's own hotspot and with phone and SOTAcat on a home
  network (firmware 261125:1424-R). SOTAcat advertises the mDNS service
  `_sotacat._tcp` that Ham2K browses for; the name shown is the unit's
  hotspot name.
- Ham2K connects and holds a steady poll of PTT, frequency and mode (serial
  capture, firmware 260907:1424-R).
- Keyer speed, on a KX2: Ham2K reads the speed at connect, sets it, and
  reads it again when its CW messages dialog reopens.
- A CW message sent from Ham2K keys the KX2, and Ham2K's on-screen pacing
  follows the sidetone.

### Known not to work (from source)

- **Transmit meters.** While transmitting, Ham2K asks for
  `RFPOWER_METER_WATTS`, `SWR`, `ALC` and `VD_METER`. SOTAcat answers each
  with `RPRT -4`, after which Ham2K stops asking for that connection.
- **Stopping a CW message or a voice memory in progress.** SOTAcat does not
  implement `stop_morse`
  ([#156](https://github.com/SOTAmat/SOTAcat/issues/156)) or
  `stop_voice_mem` ([#162](https://github.com/SOTAmat/SOTAcat/issues/162))
  and answers `RPRT -4`.
- **RF gain and mute.** Ham2K sends `set_level RF` and `set_func MUTE`.
  SOTAcat implements neither and answers `RPRT -4`.
- **Power setting.** See [below](#ham2k-power-setting).

### Not tested with Ham2K

- Setting frequency and mode from Ham2K. A frequency set was seen to work
  during early bench work, but neither has a recorded check.
- Voice memory playback. `send_voice_mem` is verified with `rigctl` only.
- What Ham2K shows when SOTAcat refuses a change with `RPRT -9` during an
  FT8 transmission or a CW keyer message.
- Ham2K with a KX3 or a KH1.

### Ham2K power setting

Setting power from Ham2K is expected to land far below the value asked for.
This comes from reading both sides' source and has **not been tested on
hardware** ([#150](https://github.com/SOTAmat/SOTAcat/issues/150)).

Ham2K's rigctld driver (`ham2k/halo` at commit `56e775d`) sends
`RFPOWER` as watts divided by an assumed 100 W maximum. SOTAcat follows
Hamlib and reads `RFPOWER` as a fraction of the radio's maximum, 12 W. By
that arithmetic, asking Ham2K for 1 W sets 0 W, and asking for 5, 10 or
12 W sets 1 W.

Until Ham2K uses a 12 W scale for SOTAcat, set power at the radio.

## Supported commands

Every command the server understands, from the dispatcher in
`src/rigctld_server.cpp`. Short forms are the single letters `rigctl` uses;
long forms take a leading backslash (`\get_freq`). Any other command answers
`RPRT -4`.

| Short | Long form | Argument | Reply | Notes |
|-------|-----------|----------|-------|-------|
| `f` | `get_freq` | | frequency in Hz | |
| `F` | `set_freq` | Hz (a float's integer part is used) | `RPRT` | 0 or non-numeric → `-1` |
| `m` | `get_mode` | | mode, then passband `0` | USB, LSB, CW, CWR, AM, FM, PKTUSB, PKTLSB |
| `M` | `set_mode` | mode name, optional passband (ignored) | `RPRT` | RTTY and DATA set data mode; unknown name → `-1` |
| `t` | `get_ptt` | | `0` or `1` | `1` while a CW keyer message is being sent |
| `T` | `set_ptt` | `0` or `1` | `RPRT` | |
| `v` | `get_vfo` | | `VFOA` | always |
| `V` | `set_vfo` | `VFOA`, `Main` or `currVFO` | `RPRT` | anything else → `-4` (no VFO B) |
| `s` | `get_split_vfo` | | `0`, then `VFOA` | split is never on |
| `l` | `get_level` | `RFPOWER` | 0.0–1.0 | 1.0 = 12 W |
| | | `AF` | 0.0–1.0 | 1.0 = AF knob 60; KX2/KX3 verified, KH1 untested |
| | | `STRENGTH` | dB relative to S9 | 6 dB per S-meter bar; `-4` on the KH1 (no S-meter CAT) |
| | | `RAWSTR` | 0–15 | raw KX S-meter bars; `-4` on the KH1 |
| | | `KEYSPD` | wpm, integer | the radio's CW keyer speed; `-4` on the KH1; verified on a KX2 against the radio's display, including after a dial change, and with Ham2K; KX3 and KH1 untested |
| | | any other | `RPRT -4` | |
| `L` | `set_level` | `RFPOWER` 0.0–1.0 | `RPRT` | rounded to whole watts, 12 W max; see [Ham2K power setting](#ham2k-power-setting) |
| | | `AF` 0.0–1.0 | `RPRT` | steps the AF knob toward the nearest 5-count step |
| | | `KEYSPD` wpm | `RPRT` | rounded to a whole wpm, clamped to 8–50; below 1 → `-1`; `-4` on the KH1; verified on a KX2 (the display follows; 5 reads back 8, 60 reads back 50); KX3 and KH1 untested |
| | | any other | `RPRT -4` | missing value → `-1` |
| `u` | `get_func` | `TUNER` | `0` | the ATU tune is a momentary press, never latched; other names → `-4` |
| `U` | `set_func` | `TUNER 1` | `RPRT` | starts an ATU tune and returns at once; `TUNER 0` is a no-op `0`; other names → `-4` |
| `b` | `send_morse` | text | `RPRT` | same keyer path as the web UI; blocks until sent; `-9` if the keyer or FT8 holds the radio |
| | `send_voice_mem` | `1` or `2` | `RPRT` | plays the radio's M1/M2 message bank; no single-letter form; verified bank 1 on a KX2, bank 2 and KH1 untested |
| `_` | `get_info` | | `SOTAcat <radio>` | radio type as detected, e.g. `SOTAcat KX2` |
| | `get_powerstat` | | `1` or `0` | `1` while the radio link is up; `set_powerstat` is deliberately `-4` (it could switch the radio off) |
| | `dump_state` | | capability block | Hamlib protocol 1; advertises 500 kHz–54 MHz, funcs TUNER, levels AF, RFPOWER, KEYSPD, RAWSTR, STRENGTH |
| | `chk_vfo` | | `0` | |
| `q`, `Q` | `quit` | | `RPRT 0` | closes the connection |

An extended-response prefix (`+`, `;`, `|` or `,`) on any command is honoured:
the reply then carries the command name, labelled fields and a trailing
`RPRT`, as Hamlib's rigctld does. Three replies follow Hamlib's exceptions:
`get_level` and `get_func` give the value unlabelled under their header, and
`chk_vfo` answers `ChkVFO: 0` alone, with no header and no `RPRT`.

### Reply codes

| `RPRT` | Hamlib name | Meaning here |
|--------|-------------|--------------|
| `0` | RIG_OK | done, or for `set_func TUNER 1`, tune started |
| `-1` | RIG_EINVAL | missing or malformed argument |
| `-4` | RIG_ENIMPL | command, level or func not implemented, or not available on this radio |
| `-5` | RIG_ETIMEOUT | the radio did not answer in time |
| `-6` | RIG_EIO | radio link down, the radio rejected the CAT command, or the value has not been read from the radio yet |
| `-9` | RIG_ERJCTED | refused: an FT8 transmission or a CW keyer message owns the radio |

A `set_level` value must be a plain decimal number such as `0.5` or `25`. A
sign, an exponent, hex, `nan`, `inf` or trailing text gets `RPRT -1` and
changes nothing (verified on a KX2).

Not (yet) supported: split / VFO B, RIT/XIT, filter bandwidth.
While the radio link is down the server answers `RPRT -6`. While the web UI
has the radio on the air, during an FT8 transmission or while a CW keyer
message is being sent, reads return the last-known state at once and
changes are refused with `RPRT -9` until the transmission ends.

A message sent with `send_morse` is different. The server handles its
clients' commands one at a time, so while that message keys, commands from
every rigctld connection wait and are applied once it ends. A `KEYSPD`
set sent during the message takes effect after it (seen on a KX2).

The web UI and rigctld clients share one radio picture. A frequency set over
rigctld shows up in the SOTAcat header, and vice versa.
