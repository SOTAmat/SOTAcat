// Standalone host test — no ESP-IDF. Build: see test/host/Makefile
//
// CR-07: radio_set_via_http refused SETs during FT8 (503) but accepted them
// during a CW keyer transmission, returning 202 "accepted, applying" for a
// command that then expired silently at SET_APPLY_DEADLINE_MS while the
// keyer task held the radio mutex. The gate pinned here refuses both long
// exclusive owners up front, honestly.
#include "../../include/radio_set_gate.h"
#include <cassert>
#include <cstring>
#include <cstdio>

int main () {
    // Idle radio: no refusal.
    assert (radio_set_refusal (false, false) == RadioSetRefusal::NONE);
    assert (radio_set_refusal_message (RadioSetRefusal::NONE) == nullptr);

    // FT8 owns the radio: refuse, with the FT8 reason.
    assert (radio_set_refusal (true, false) == RadioSetRefusal::FT8);
    assert (!strcmp (radio_set_refusal_message (RadioSetRefusal::FT8), "radio busy (FT8)"));

    // The bug: keyer TX must refuse too, not 202-then-drop.
    assert (radio_set_refusal (false, true) == RadioSetRefusal::KEYER);
    assert (!strcmp (radio_set_refusal_message (RadioSetRefusal::KEYER), "radio busy (keyer)"));

    // Both at once (shouldn't happen, but precedence must be stable): FT8 wins.
    assert (radio_set_refusal (true, true) == RadioSetRefusal::FT8);

    printf ("test_radio_set_gate: all assertions passed\n");
    return 0;
}
