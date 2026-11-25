// Standalone host test — no ESP-IDF. Build: see test/host/Makefile
#include "../../include/radio_snapshot.h"
#include <cassert>
#include <cstdio>

int main() {
    RadioSnapshotData s;  // default: nothing known
    assert(s.frequency_hz == 0);
    assert(s.mode == 0);
    assert(!s.has_frequency());
    assert(!s.has_mode());

    // Freshness: a value with timestamp T is fresh at T+window-1,
    // stale at T+window.
    s.frequency_hz       = 14285000;
    s.frequency_stamp_us = 1'000'000;
    assert(s.has_frequency());
    assert(s.frequency_fresh(1'000'000 + RADIO_SNAPSHOT_FRESH_US - 1));
    assert(!s.frequency_fresh(1'000'000 + RADIO_SNAPSHOT_FRESH_US));

    // Clock not yet advanced past the stamp (skew / unset clock):
    // must read stale, never falsely fresh.
    assert(!s.frequency_fresh(0));

    // Mode independent of frequency.
    s.mode            = 2;
    s.mode_stamp_us   = 5'000'000;
    assert(s.has_mode());
    assert(s.mode_fresh(5'000'000));
    assert(!s.mode_fresh(5'000'000 + RADIO_SNAPSHOT_FRESH_US + 1));

    // Same skew guard for mode.
    assert(!s.mode_fresh(0));

    // Xmit state, mirroring frequency/mode.
    s.xmit_state    = 0;
    s.xmit_stamp_us = 7'000'000;
    assert(s.has_xmit());
    assert(s.xmit_fresh(7'000'000));
    assert(!s.xmit_fresh(7'000'000 + RADIO_SNAPSHOT_FRESH_US + 1));
    // Same skew guard.
    assert(!s.xmit_fresh(0));

    // Keyer speed: unknown by default, and a zero reading is not a speed.
    {
        RadioSnapshotData k;
        assert(!k.has_keyer_speed());
        assert(!k.keyer_speed_fresh(1'000'000));
        k.keyer_speed          = 0;
        k.keyer_speed_stamp_us = 1'000'000;
        assert(!k.has_keyer_speed());
        k.keyer_speed = 22;
        assert(k.has_keyer_speed());
        assert(k.keyer_speed_fresh(1'000'000 + RADIO_SNAPSHOT_FRESH_US - 1));
        assert(!k.keyer_speed_fresh(1'000'000 + RADIO_SNAPSHOT_FRESH_US));
        assert(!k.keyer_speed_fresh(999'999));
    }

    printf("test_radio_snapshot: OK\n");
    return 0;
}
