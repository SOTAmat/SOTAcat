# Keyer speed over rigctld and REST (#155)

Status: approved by Q on 2026-11-24 and built.

## Intent

Ham2K (the `ham2k/halo` app) shows a CW message as it goes out and paces that
display from the keyer speed. SOTAcat refuses `KEYSPD` with `RPRT -4`, which
halo treats as permanent for the connection, so it paces at the speed it
asked for while the radio keys at its dial speed. Reading the speed is the
author's top priority. Setting it is useful.

## Goals

- `get_level KEYSPD` and `set_level KEYSPD` on rigctld, in wpm, on KX2/KX3.
- A matching REST GET and PUT, so the two interfaces stay symmetric for
  settable radio state.
- Mock server, contract tests and docs kept in step.

## Non-goals

- A speed control in the web UI. File separately.
- KH1 keyer speed.
- `\stop_morse` and `stop_voice_mem`, which halo's SOTAcat entry expects and
  the firmware does not parse. Separate issue.

## Anti-goals

- Answering `0` or a guessed value when the speed is unknown. halo discards
  values below 1, and a wrong value mis-paces the display. Unknown is an
  error reply.
- Any CAT traffic from this feature while the keyer or FT8 holds the radio.
- Button presses on a KH1 caused by a client polling.

## What halo does with KEYSPD (read from its source, 2026-11-24)

- Reads once at connect, when the CW messages dialog opens, when the keyer
  is re-picked, and immediately after every set. It does not poll.
- `RPRT -1`, `-4` and `-11` retire the level for the connection. `-9`, `-5`
  and `-6` do not.
- After a set it paces at the asked speed until a read-back replaces it.
- Its SOTAcat entry pins the range 8 to 50 wpm.

## Approaches considered

| | Scope | Trade-off |
|---|---|---|
| A | rigctld only | All halo needs. Would be the first settable radio value with no REST twin. |
| **B (chosen)** | rigctld plus REST, mock, contract tests, docs | Keeps the pattern. The REST routes have no caller until a UI control exists. |
| C | rigctld read only | Barely smaller than A and leaves halo's speed control dead. |

Q chose B. Every settable value rigctld exposes today has a REST twin
(frequency, mode, power, volume, xmit, ATU, msg, keyer text). The only
rigctld-only state is the S-meter, a read-only meter.

## Design

### Step 0: bench probe (KX2, before any firmware code)

The CAT facts below are unverified. Confirm on the KX2:

1. `KS;` returns `KSnnn;` and matches the display.
2. `KSnnn;` sets the speed, and what the radio does with values outside
   8 to 50.
3. How `KS;` and `KSnnn;` behave while `KY` text is keying. This is for the
   record only: the design sends neither during a send.

If 1 or 2 fails, stop and revisit the design.

### Plumbing (follows power)

- `RadioCmdType`: add `REFRESH_KEYER_SPEED` after `REFRESH_SMETER` and
  `SET_KEYER_SPEED` after `SET_TIME`, and move the two `*_KINDS` constants
  to the new last members.
- `RadioSnapshotData`: `keyer_speed` (-1 unknown), stamp, `has_` and
  `_fresh` predicates, `set_keyer_speed`.
- `RadioParkKind`: `GET_KEYER_SPEED` and `SET_KEYER_SPEED`, keeping GETs
  before SETs.
- Driver interface: `supports_keyer_speed()`, `get_keyer_speed(out_wpm)`,
  `set_keyer_speed(wpm, out_achieved)`.
  - KX: `KS` get. Set clamps to 8 to 50, sends `KSnnn;`, reads back, and
    reports the achieved value, as `set_power` does.
  - KH1: `supports_keyer_speed()` is false. Get and set return false. The
    display scrape in `send_keyer_message` is untouched.
- Service worker: refresh and set cases beside power. A refresh for an
  unsupported radio completes without CAT, as the S-meter one does.

### rigctld

- `get_level KEYSPD`: integer wpm from the snapshot via `rigctld_fetch`.
  `-4` when unsupported, `-6` when the value is still unknown.
- `set_level KEYSPD n`: through `rigctld_apply`. `-4` when unsupported,
  `-1` when malformed, `-9` while FT8 or the keyer holds the radio.
- `dump_state`: add the `KEYSPD` bit to both level masks. It is `0x4000`
  (bit 14), confirmed against Hamlib master `rig.h` on 2026-11-24.

### REST

- `GET /api/v1/keyerSpeed`: wpm as text, via `radio_get_via_http`.
- `PUT /api/v1/keyerSpeed?wpm=N`: via `radio_set_via_http`. A value that is
  not a positive integer gets 404 "invalid wpm", matching power.
- Unsupported radio: 404 "keyer speed not supported on this radio",
  matching volume.
- Route name and parameter name are my call (camelCase like `cwMacros`,
  `tuneTargets`). Change them here if you prefer others.

### While a message is on the air

- GET serves the cached speed with no CAT traffic, the existing contract.
  halo reads at connect, so the cache is normally populated before a send.
- SET is refused by the shared set gate: `-9` on rigctld, 503 on REST.
- A send started with rigctld `send_morse` is different. The server
  serializes all rigctld clients, so their commands queue behind the
  blocking send and a queued set applies after the message. Q accepted
  this on 2026-11-25; it matches every other rigctld set.

### Tests

- Host: extend `test_radio_snapshot` for the new field, and
  `test_radio_park` if it enumerates kinds.
- Mock server: `keyer_speed` state, both REST routes, `KEYSPD` in
  `get_level` and `set_level`, the new masks.
- Contract: REST get, set and read-back, invalid value, refused during a
  keyer send. rigctld plain and extended `KEYSPD` get and set, and the
  `rigctl` binary round trip beside the existing `RFPOWER` one.
- Hardware, KX2 via OTA: the issue's acceptance list. `get_level KEYSPD`
  matches the display, follows a dial change, and `set_level` changes the
  display. Same through REST. Then halo itself against the device.

### Docs

- `docs/dev/REST-API.md` and `docs/dev/openapi-v1.yaml`: the two routes.
  The API contract test checks the YAML against the firmware route table.
- `docs/user/Rig-Control-Apps.md`: move keyer speed out of "not (yet)
  supported", list `KEYSPD`, note KH1 answers `-4`.
- Name the radios actually tested. KX3 and KH1 are labeled untested unless
  they reach the bench.

## Left to the builder

- Exact log text and local naming.
- Whether the clamp lives in the driver or a shared constant, provided the
  achieved value comes from the radio's read-back.
