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
