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
//   0  = failed (radio answered but command failed, or could not enqueue)
//  -1  = rejected immediately because link is known-down
//   2  = enqueued, no ack within timeout — will apply asynchronously
int radio_service_set_blocking(RadioCmdType type, long arg, uint32_t timeout_ms);

// Bounded ack-wait for radio_service_set_blocking(). Kept short so a SET
// handler cannot starve the single esp_http_server task longer than this
// (must stay well under the client's VFO_TIMEOUT_MS, 2000 ms). Fast ops
// (within-band tune, mode) confirm within this window and return HTTP
// 200; slower ops (band-switch tune, ATU) return HTTP 202 Accepted and
// complete asynchronously in the radio service task.
static constexpr uint32_t SET_ACK_TIMEOUT_MS = 800;
