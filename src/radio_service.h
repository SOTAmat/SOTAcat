#pragma once
// The radio service task is the SOLE owner of the radio mutex. HTTP
// handlers never call kxRadio.* directly anymore — they enqueue work
// here and return immediately: refreshes and SETs are both fire-and-
// forget. A SET handler replies HTTP 202 and the client confirms the
// outcome via a later GET. See 2026-05-15-radio-decoupling-design.md.
#include <cstdint>

enum class RadioCmdType {
    REFRESH_FREQUENCY,
    REFRESH_MODE,
    REFRESH_XMIT,
    SET_FREQUENCY,
    SET_MODE,        // arg = radio_mode_t value
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

// How long after enqueue a SET command remains valid for the worker to
// apply. 5 s covers a few rapid back-to-back band-switch tunes (each
// ~1.5 s of CAT) without dropping any; a SET stuck behind a full ~13 s
// FT8 transmission still expires and is skipped (don't retune the radio
// long after the user's click).
static constexpr uint32_t SET_APPLY_DEADLINE_MS = 5000;
