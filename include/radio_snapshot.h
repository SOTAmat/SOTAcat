#pragma once
// Pure radio snapshot data + freshness predicates. No ESP-IDF deps so
// the freshness logic is host-unit-testable. The mutex-guarded singleton
// that wraps this lives in radio_snapshot.cpp.
#include <cstdint>

// How long a cached field is served as "fresh" before a GET handler
// also enqueues a background refresh. Generalizes the prior 200ms
// per-handler caches (handler_frequency.cpp FREQUENCY_CACHE_US).
static constexpr int64_t RADIO_SNAPSHOT_FRESH_US = 200'000;  // 200 ms

struct RadioSnapshotData {
    long    frequency_hz       = 0;   // 0 == unknown
    long    mode               = 0;   // 0 == MODE_UNKNOWN
    long    volume             = -1;  // -1 == unknown
    long    power              = -1;  // -1 == unknown
    long    xmit_state         = -1;  // -1 == unknown, 0 == RX, 1 == TX
    int64_t frequency_stamp_us = 0;
    int64_t mode_stamp_us      = 0;
    int64_t volume_stamp_us    = 0;
    int64_t power_stamp_us     = 0;
    int64_t xmit_stamp_us      = 0;

    bool has_frequency () const { return frequency_hz > 0; }

    bool has_mode () const { return mode > 0; }

    bool has_xmit () const { return xmit_state >= 0; }

    bool has_power () const { return power >= 0; }

    bool has_volume () const { return volume >= 0; }

    bool frequency_fresh (int64_t now_us) const { return fresh (has_frequency(), frequency_stamp_us, now_us); }

    bool mode_fresh (int64_t now_us) const { return fresh (has_mode(), mode_stamp_us, now_us); }

    bool xmit_fresh (int64_t now_us) const { return fresh (has_xmit(), xmit_stamp_us, now_us); }

    bool power_fresh (int64_t now_us) const { return fresh (has_power(), power_stamp_us, now_us); }

    bool volume_fresh (int64_t now_us) const { return fresh (has_volume(), volume_stamp_us, now_us); }

  private:
    // now_us < stamp (clock skew / unset clock) reads stale, never falsely
    // fresh — a negative age is not "recent".
    static bool fresh (bool known, int64_t stamp_us, int64_t now_us) {
        return known && now_us >= stamp_us && (now_us - stamp_us) < RADIO_SNAPSHOT_FRESH_US;
    }
};

// Thread-safe accessor for the single shared snapshot. Implemented in
// radio_snapshot.cpp with a FreeRTOS mutex distinct from the radio
// mutex — readers (HTTP handlers) never contend on UART.
namespace radio_snapshot {
// Copy the whole snapshot out under the lock.
RadioSnapshotData get ();
// Merge-update individual fields under the lock; pass the esp_timer
// "now" once so all touched stamps share it.
void set_frequency (long hz, int64_t now_us);
void set_mode (long mode, int64_t now_us);
void set_volume (long volume, int64_t now_us);
void set_power (long power, int64_t now_us);
void set_xmit_state (long state, int64_t now_us);
}  // namespace radio_snapshot
