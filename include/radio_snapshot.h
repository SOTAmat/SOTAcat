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

    bool has_frequency() const { return frequency_hz > 0; }
    bool has_mode() const { return mode > 0; }

    bool frequency_fresh(int64_t now_us) const {
        // now_us < stamp (clock skew / unset clock) reads stale, never
        // falsely fresh — a negative age is not "recent".
        return has_frequency() && now_us >= frequency_stamp_us &&
               (now_us - frequency_stamp_us) < RADIO_SNAPSHOT_FRESH_US;
    }
    bool mode_fresh(int64_t now_us) const {
        return has_mode() && now_us >= mode_stamp_us &&
               (now_us - mode_stamp_us) < RADIO_SNAPSHOT_FRESH_US;
    }
};
