# rigctld enrichment vs. radio-web decoupling — sequencing analysis

**Status:** advisory note for a future agent/maintainer. No code changes.
**Branches in scope:** `feature/rigctld-server` (this branch),
`feature/radio-web-decoupling`, `feature/radio-capability-learning`.

## TL;DR

We want to make the rigctld server (this branch) much richer — ideally a
phased roadmap with **read-only monitoring first** (S-meter / SWR / power /
ALC via `get_level`), then split/VFO-B (FT8), then RIT/XIT, keyer speed,
AGC/preamp/att, etc.

**Recommendation: land `feature/radio-web-decoupling` first, and build the
richer rigctld as a *client of the radio service*, not as a parallel mutex
user.** Building rigctld richness on the current direct-lock model means a
guaranteed rewrite, state incoherence with the web UI, and reintroducing the
exact contention the decoupling exists to remove. Two caveats below keep this
from being unconditional.

## The current rigctld access pattern (this branch)

`src/rigctld_server.cpp` runs on its **own** FreeRTOS task
(`xTaskCreate("rigctld_task", …)`) and talks to the radio **directly**:
`kxRadio.timed_lock()` + `get_from_kx()` / `put_to_kx()`. This mirrors how the
web handlers work on `main` today, so on `main` it is consistent.

## What the decoupling branch changes

`feature/radio-web-decoupling` introduces a dedicated **radio service task**
plus a mutex-guarded **snapshot** (`include/radio_snapshot.h`,
`src/radio_service.h`). Its hard invariant:

> The radio service task is the **SOLE owner** of the radio mutex. HTTP
> handlers never call `kxRadio.*` directly anymore — GETs read the snapshot
> and return in µs; SETs drop a command in a slot and return (HTTP 202).

Motivation: ESP-IDF's `esp_http_server` runs all requests on one task, so a
single blocking CAT call against a powered-off radio (~6 s timeout) froze the
whole web UI. Decoupling moves CAT I/O off the request path.

## The tension

Once decoupling lands, this branch's rigctld is the one component that still
grabs the radio mutex directly — violating the "sole owner" contract. Two
concrete, non-hypothetical consequences:

1. **State incoherence.** The snapshot (`RadioSnapshotData`) is updated *only*
   by the service task on confirmed CAT success. rigctld setting freq/mode
   directly never updates the snapshot, so the web UI (and logging clients)
   show stale/divergent state. The two faces of the same radio disagree.
2. **Reintroduced contention.** A direct-mutex rigctld is a third
   uncoordinated contender against the service task and FT8 — the exact class
   of bug already documented in
   `docs/for-AI-agents/radio-service-ft8-mutex-contention.md`.

## Why monitoring (Phase 1) is the *tightest* coupling point

- High-rate meter polling (S-meter/SWR) is precisely what the snapshot model
  is built for. Routed through the snapshot, a rigctld meter GET is a µs read
  with no UART contention — the contention caveat disappears instead of being
  worked around.
- But the snapshot today holds only `frequency/mode/volume/power/xmit` — **no
  meters** — and `RadioCmdType` is a fixed, web-shaped enum (no PTT-set, no
  morse, no meters, no split). So doing meters "the decoupled way" means
  **extending the snapshot and generalizing the service into a real radio
  RPC**. That work belongs in/after the decoupling branch, not bolted onto a
  legacy rigctld we would then discard.

## Verdict and caveats

**Prudent order: decoupling first; rigctld becomes the third client of the
radio service alongside the web UI.** Build the protocol facade once on the
shared substrate rather than twice.

- **Caveat 1 — don't build against a moving target.** The decoupling branch is
  large (~3,300 insertions, 22 commits) and *unmerged*; its notes say
  "server-side phase complete" with a client phase still pending. The payoff
  only lands once it reaches `main`. If it will sit unmerged for a long time,
  the calculus shifts toward shipping rigctld standalone now and refactoring
  later (accepting the interim incoherence + rework).
- **Caveat 2 — "adopt the service" means "generalize it."** Making rigctld a
  first-class client requires meter fields in the snapshot and
  PTT/morse/(later split + meter-refresh) entries in `RadioCmdType`. Ideally
  fold this generalization into the decoupling design so the service is a
  general radio RPC from the start, not retrofitted.

**Nuance (don't overclaim):** the decoupling's *headline* win — web UI not
freezing when the radio is off — does **not** directly help rigctld, which is
already on its own task and cannot freeze the web server. The wins that *do*
apply to rigctld are **state coherence** and **contention management** —
real, but quieter.

## Bigger picture: three branches, one substrate

`feature/radio-capability-learning` builds a **per-radio capability model**
(native + learned bands, transverter awareness). That is exactly the
source-of-truth a *dynamic* rigctld `dump_state` needs (advertise correct
ranges + func/level bitmasks per detected radio; KH1 = reduced caps).

So all three branches converge on one thing: a unified radio abstraction —
**access model** (service/snapshot, from decoupling) + **capability model**
(from capability-learning) + **protocol facades** on top (web UI, rigctld).
Richer rigctld is most prudent built *on* that substrate, not racing ahead of
it.

## Pointers

- This branch: `src/rigctld_server.cpp` — dispatcher (`rigctld_handle_command`),
  static `cmd_dump_state()` (the `0x0`-bitmask limitation that hides any new
  level/func from clients).
- Decoupling: `include/radio_snapshot.h`, `src/radio_service.h`,
  `docs/radio-web-decoupling-overview.md`,
  `docs/superpowers/specs/2026-05-15-radio-decoupling-design.md`,
  `docs/for-AI-agents/radio-service-ft8-mutex-contention.md`.
- Capability: `feature/radio-capability-learning` — `CapabilityState`,
  per-radio band/capability model (`src/web/`, `test/unit/test_capability.js`).
