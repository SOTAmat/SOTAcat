// Standalone host test — no ESP-IDF. Build: see test/host/Makefile
//
// The gate refuses SETs while either long exclusive owner (FT8, CW keyer)
// holds the radio, replying 503 up front rather than accepting a command
// that could only expire unapplied.
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

    // Keyer TX refuses with its own reason.
    assert (radio_set_refusal (false, true) == RadioSetRefusal::KEYER);
    assert (!strcmp (radio_set_refusal_message (RadioSetRefusal::KEYER), "radio busy (keyer)"));

    // Both at once (shouldn't happen, but precedence must be stable): FT8 wins.
    assert (radio_set_refusal (true, true) == RadioSetRefusal::FT8);

    printf ("test_radio_set_gate: all assertions passed\n");
    return 0;
}
