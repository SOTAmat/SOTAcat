#pragma once
// The radio service task owns radio CAT I/O for the HTTP handlers (FT8
// and a few unconverted handlers still take the radio mutex directly).
// Handlers never call kxRadio.* — they enqueue work here and either reply
// at once or park the request (radio_park_httpd.h) until the worker
// reports completion. See 2026-05-15-radio-decoupling-design.md and
// 2026-08-17-radio-async-handlers-design.md.
#include "radio_park.h"

#include <cstdint>

enum class RadioCmdType {
    REFRESH_FREQUENCY,
    REFRESH_MODE,
    REFRESH_XMIT,
    SET_FREQUENCY,
    SET_MODE,        // arg = radio_mode_t value, or RADIO_MODE_SSB_AUTO
    SET_VOLUME,      // arg = delta
    SET_POWER,       // arg = power
    SET_ATU,         // arg unused
};

// Start the task. Call once, AFTER kxRadio.connect() has completed in
// setup(). Idempotent.
void radio_service_start();

// True once the link-health machine has a successful exchange and has
// not since hit the consecutive-failure threshold. O(1), no locking of
// the radio. Mirrors kxRadio.is_connected() intent but is kept live by
// the service task.
bool radio_service_link_up();

// Fire-and-forget: request a refresh of one cached field. Sets a
// per-type slot (newest-wins coalescing — a burst of identical refresh
// requests collapses to one) and wakes the radio service task. Never
// blocks. Used by GET handlers when the snapshot is stale.
void radio_service_request_refresh(RadioCmdType which);

// Fire-and-forget SET. Stores the command in a per-type slot (newest-
// wins; volume deltas accumulate) and wakes the radio service task,
// then returns immediately — it NEVER blocks the HTTP server task.
// Returns:
//    0 = accepted; will apply asynchronously
//   -1 = rejected: link known-down, or service not started (handler 503)
// On accept, *gen_out (if non-null) receives the slot generation this
// call armed. Every arm bumps the per-type generation; the worker reports
// the drained generation in its completion (radio_park_notify_done), so a
// parked request can tell "my op finished" from "an older op finished".
// Handlers that don't park may ignore it and confirm via a later GET.
int radio_service_set(RadioCmdType type, long arg, uint32_t * gen_out = nullptr);

// SET_MODE arg meaning "SSB": the worker picks LSB/USB from the frequency
// AT APPLY TIME (below RADIO_SSB_LSB_USB_BOUNDARY_HZ -> LSB), i.e. after any
// frequency SET queued ahead of it has been applied. Resolving in the HTTP
// handler from the snapshot picked the wrong sideband when a tune was still
// pending (PUT freq 14.2 MHz, PUT mode SSB -> snapshot still 7.2 MHz -> LSB).
static constexpr long    RADIO_MODE_SSB_AUTO             = -1;
static constexpr long    RADIO_SSB_LSB_USB_BOUNDARY_HZ   = 10'000'000;

// Map a service op to the park-table kind whose parked HTTP request it
// satisfies. Returns false for ops no handler can park on (SET_POWER).
bool radio_service_park_kind(RadioCmdType type, RadioParkKind & kind);

// How long after enqueue a SET command remains valid for the worker to
// apply. 5 s covers a few rapid back-to-back band-switch tunes (each
// ~1.5 s of CAT) without dropping any; a SET stuck behind a full ~13 s
// FT8 transmission still expires and is skipped (don't retune the radio
// long after the user's click).
static constexpr uint32_t SET_APPLY_DEADLINE_MS = 5000;
