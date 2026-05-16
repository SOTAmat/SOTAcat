// Standalone host test — no ESP-IDF. Build: see test/host/Makefile
#include "../../include/radio_link_health.h"
#include <cassert>
#include <cstdio>

int main() {
    RadioLinkHealth h;  // starts unknown == down (never proven up)
    assert(!h.is_up());

    // A failure from the initial DOWN state must stay down (guards the
    // m_consecutive_failures = THRESHOLD initialization trick).
    RadioLinkHealth fresh;
    fresh.record_failure();
    assert(!fresh.is_up());

    // One failure is not enough to assert down once we've been up.
    h.record_success();
    assert(h.is_up());
    h.record_failure();
    assert(h.is_up());                 // 1 < threshold (3)
    h.record_failure();
    assert(h.is_up());                 // 2 < threshold
    h.record_failure();
    assert(!h.is_up());                // 3 consecutive -> down

    // Recovery requires a real success, and is immediate.
    h.record_failure();
    assert(!h.is_up());
    h.record_success();
    assert(h.is_up());                 // first success -> up, no flap window

    // Success resets the failure counter (anti-flap).
    h.record_failure();
    h.record_failure();
    h.record_success();
    h.record_failure();
    assert(h.is_up());                 // counter was reset by success

    printf("test_radio_link_health: OK\n");
    return 0;
}
