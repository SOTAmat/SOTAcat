// Standalone host test — no ESP-IDF. Build: see test/host/Makefile
#include "../../include/radio_park.h"
#include <cassert>
#include <cstdio>

// Opaque "request handles" — the table never dereferences them.
static int a, b, c, d;
#define H(x) ((void *) &(x))

static void test_park_and_done_get() {
    RadioParkTable t;
    assert (t.empty() && t.count() == 0);
    assert (t.park (RadioParkKind::GET_FREQUENCY, H (a), 0, 1000));
    assert (t.count() == 1 && t.occupied (RadioParkKind::GET_FREQUENCY));
    // Nothing parked on another kind.
    assert (t.on_done (RadioParkKind::GET_MODE, 0) == nullptr);
    // GET completes on any generation, and the entry is removed.
    assert (t.on_done (RadioParkKind::GET_FREQUENCY, 0) == H (a));
    assert (t.empty());
    assert (t.on_done (RadioParkKind::GET_FREQUENCY, 0) == nullptr);
}

static void test_supersede() {
    RadioParkTable t;
    void * sup = H (d);  // sentinel: must be cleared even when nothing displaced
    assert (t.park (RadioParkKind::GET_MODE, H (a), 0, 1000, &sup));
    assert (sup == nullptr);
    // Newcomer on an occupied kind displaces the occupant; count stays 1.
    assert (t.park (RadioParkKind::GET_MODE, H (b), 0, 2000, &sup));
    assert (sup == H (a));
    assert (t.count() == 1);
    assert (t.on_done (RadioParkKind::GET_MODE, 0) == H (b));
    assert (t.empty());
    // superseded pointer is optional.
    assert (t.park (RadioParkKind::GET_MODE, H (a), 0, 1000));
    assert (t.park (RadioParkKind::GET_MODE, H (b), 0, 1000));
    assert (t.count() == 1);
}

static void test_set_generation_gate() {
    RadioParkTable t;
    assert (t.park (RadioParkKind::SET_FREQUENCY, H (a), 5, 1000));
    // Completion of an op older than the one this request armed: not ours.
    assert (t.on_done (RadioParkKind::SET_FREQUENCY, 4) == nullptr);
    assert (t.count() == 1);
    // Exactly our generation satisfies.
    assert (t.on_done (RadioParkKind::SET_FREQUENCY, 5) == H (a));
    assert (t.empty());
    // A newer generation (ours was coalesced into a later arm) also satisfies.
    assert (t.park (RadioParkKind::SET_MODE, H (b), 7, 1000));
    assert (t.on_done (RadioParkKind::SET_MODE, 9) == H (b));
    // Wraparound-safe: gen 0xFFFFFFFF parked, applied 0x00000001 is "newer".
    assert (t.park (RadioParkKind::SET_MODE, H (c), 0xFFFFFFFFu, 1000));
    assert (t.on_done (RadioParkKind::SET_MODE, 1) == H (c));
    // ...and gen 1 parked, applied 0xFFFFFFFF is "older".
    assert (t.park (RadioParkKind::SET_MODE, H (c), 1, 1000));
    assert (t.on_done (RadioParkKind::SET_MODE, 0xFFFFFFFFu) == nullptr);
    assert (t.count() == 1);
}

static void test_expire() {
    RadioParkTable t;
    assert (t.park (RadioParkKind::GET_FREQUENCY, H (a), 0, 1000));
    assert (t.park (RadioParkKind::GET_MODE, H (b), 0, 3000));
    assert (t.park (RadioParkKind::SET_ATU, H (c), 1, 2000));
    assert (t.count() == 3);
    assert (t.next_deadline() == 1000);
    void * out[RADIO_PARK_KINDS];
    // Nothing due yet.
    assert (t.expire (999, out, RADIO_PARK_KINDS) == 0);
    // Deadline is inclusive: at exactly 1000, `a` expires.
    assert (t.expire (1000, out, RADIO_PARK_KINDS) == 1 && out[0] == H (a));
    assert (t.count() == 2 && t.next_deadline() == 2000);
    // At 5000 both remaining expire; order is by kind index; kinds reported.
    RadioParkKind kinds[RADIO_PARK_KINDS];
    assert (t.expire (5000, out, RADIO_PARK_KINDS, kinds) == 2);
    assert (out[0] == H (b) && out[1] == H (c));
    assert (kinds[0] == RadioParkKind::GET_MODE && kinds[1] == RadioParkKind::SET_ATU);
    assert (t.empty() && t.next_deadline() == INT64_MAX);
    // max_out truncation is respected and leaves the rest parked.
    assert (t.park (RadioParkKind::GET_FREQUENCY, H (a), 0, 10));
    assert (t.park (RadioParkKind::GET_MODE, H (b), 0, 10));
    assert (t.expire (10, out, 1) == 1);
    assert (t.count() == 1);
}

static void test_cap() {
    RadioParkTable t (2);
    assert (t.park (RadioParkKind::GET_FREQUENCY, H (a), 0, 1000));
    assert (t.park (RadioParkKind::GET_MODE, H (b), 0, 1000));
    assert (t.full());
    // At cap: a new kind is refused (caller falls back to a sync reply)...
    assert (!t.park (RadioParkKind::GET_XMIT, H (c), 0, 1000));
    assert (t.count() == 2);
    // ...but superseding an occupied kind is still allowed (no growth).
    void * sup = nullptr;
    assert (t.park (RadioParkKind::GET_MODE, H (c), 0, 1000, &sup));
    assert (sup == H (b) && t.count() == 2);
    // Cap is clamped into [1, RADIO_PARK_KINDS].
    RadioParkTable lo (0), hi (100);
    assert (lo.park (RadioParkKind::GET_XMIT, H (a), 0, 1));
    assert (!lo.park (RadioParkKind::GET_MODE, H (b), 0, 1));
    for (int i = 0; i < RADIO_PARK_KINDS; ++i)
        assert (hi.park ((RadioParkKind) i, H (a), 0, 1));
    assert (hi.full());
}

static void test_invalid_and_drain() {
    RadioParkTable t;
    assert (!t.park (RadioParkKind::COUNT, H (a), 0, 1));
    assert (!t.park ((RadioParkKind) -1, H (a), 0, 1));
    assert (!t.park (RadioParkKind::GET_FREQUENCY, nullptr, 0, 1));
    assert (t.on_done (RadioParkKind::COUNT, 0) == nullptr);
    assert (!t.occupied (RadioParkKind::COUNT));
    assert (t.empty());
    assert (t.park (RadioParkKind::GET_XMIT, H (a), 0, 1));
    assert (t.park (RadioParkKind::SET_VOLUME, H (b), 3, 1));
    void *        out[RADIO_PARK_KINDS];
    RadioParkKind kinds[RADIO_PARK_KINDS];
    assert (t.drain_all (out, RADIO_PARK_KINDS, kinds) == 2);
    assert (out[0] == H (a) && out[1] == H (b));
    assert (kinds[0] == RadioParkKind::GET_XMIT && kinds[1] == RadioParkKind::SET_VOLUME);
    assert (t.empty());
}

static void test_is_set_kind() {
    assert (!RadioParkTable::is_set_kind (RadioParkKind::GET_FREQUENCY));
    assert (!RadioParkTable::is_set_kind (RadioParkKind::GET_XMIT));
    assert (RadioParkTable::is_set_kind (RadioParkKind::SET_FREQUENCY));
    assert (RadioParkTable::is_set_kind (RadioParkKind::SET_ATU));
    assert (RadioParkTable::is_set_kind (RadioParkKind::SET_MANUAL_TUNE));
}

int main() {
    test_park_and_done_get();
    test_supersede();
    test_set_generation_gate();
    test_expire();
    test_cap();
    test_invalid_and_drain();
    test_is_set_kind();
    printf ("test_radio_park: OK\n");
    return 0;
}
