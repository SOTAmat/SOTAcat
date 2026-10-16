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
| | | any other | `RPRT -4` | |
| `L` | `set_level` | `RFPOWER` 0.0–1.0 | `RPRT` | rounded to whole watts, 12 W max |
| | | `AF` 0.0–1.0 | `RPRT` | steps the AF knob toward the nearest 5-count step |
| | | any other | `RPRT -4` | missing value → `-1` |
| `u` | `get_func` | `TUNER` | `0` | the ATU tune is a momentary press, never latched; other names → `-4` |
| `U` | `set_func` | `TUNER 1` | `RPRT` | starts an ATU tune and returns at once; `TUNER 0` is a no-op `0`; other names → `-4` |
| `b` | `send_morse` | text | `RPRT` | same keyer path as the web UI; blocks until sent; `-9` if the keyer or FT8 holds the radio |
| | `send_voice_mem` | `1` or `2` | `RPRT` | plays the radio's M1/M2 message bank; no single-letter form; verified bank 1 on a KX2, bank 2 and KH1 untested |
| `_` | `get_info` | | `SOTAcat <radio>` | radio type as detected, e.g. `SOTAcat KX2` |
| | `get_powerstat` | | `1` or `0` | `1` while the radio link is up; `set_powerstat` is deliberately `-4` (it could switch the radio off) |
| | `dump_state` | | capability block | Hamlib protocol 1; advertises 500 kHz–54 MHz, funcs TUNER, levels AF, RFPOWER, RAWSTR, STRENGTH |
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
| `-6` | RIG_EIO | radio link down, or the radio rejected the CAT command |
| `-9` | RIG_ERJCTED | refused: an FT8 transmission or a CW keyer message owns the radio |

Not (yet) supported: split / VFO B, RIT/XIT, keyer speed, filter bandwidth.
While the radio link is down the server answers `RPRT -6`; during an FT8
transmission started from the web UI, reads return the last-known state and
changes are refused until the transmission ends.

The web UI and desktop apps share one radio picture — a frequency set from
WSJT-X shows up in the SOTAcat header, and vice versa.
