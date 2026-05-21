#pragma once
// The radio service task is the SOLE owner of the radio mutex. HTTP
// handlers never call kxRadio.* directly anymore — they enqueue work
// here and either return immediately (GET refresh) or wait for a
// bounded ack (SET). See 2026-05-15-radio-decoupling-design.md.
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

// Fire-and-forget: enqueue a refresh of one cached field. Coalesces —
// if an identical refresh is already queued, this is a no-op. Never
// blocks. Used by GET handlers when the snapshot is stale.
void radio_service_request_refresh(RadioCmdType which);

// Enqueue a SET and block the calling (HTTP handler) task up to
// timeout_ms for a real ack. Returns:
//   1  = applied and confirmed
//   0  = failed/timed out (radio answered but command failed, or no ack)
//  -1  = rejected immediately because link is known-down
int radio_service_set_blocking(RadioCmdType type, long arg, uint32_t timeout_ms);

// Per-operation ack timeouts for radio_service_set_blocking(). Sized to
// the radio's real CAT-op duration, not the spec's optimistic ~800 ms
// (which fails band-switch tunes and is completely insufficient for
// ATU tunes that legitimately take 5-10 s on the radio side).
//
// Reference: pre-decoupling code used RADIO_LOCK_TIMEOUT_MODERATE_MS
// (2 s) for most SETs and RADIO_LOCK_TIMEOUT_CRITICAL_MS (10 s) for
// ATU; these values match that intent with headroom for retries.
static constexpr uint32_t SET_FREQ_TIMEOUT_MS   = 3000;   // band-switch tunes measure 0.7-1.7 s
static constexpr uint32_t SET_MODE_TIMEOUT_MS   = 2000;
static constexpr uint32_t SET_VOLUME_TIMEOUT_MS = 1000;
static constexpr uint32_t SET_ATU_TIMEOUT_MS    = 12000;  // ATU tune is 5-10 s on the radio
