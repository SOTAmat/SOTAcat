// Standalone host test — no ESP-IDF. Build: see test/host/Makefile
//
// CR-01: radio_mode_t skips value 8 (MODE_CW_R = 7, MODE_DATA_R = 9), so any
// lookup indexed by enum value misaligns past 7. The lookups here must be
// scan-based and total: every valid mode maps to its own name, the gap value 8
// and out-of-range values map to nullptr, never to a neighboring row.
#include "../../include/radio_mode.h"
#include <cassert>
#include <cstring>
#include <cstdio>

int main () {
    // Canonical names for every enumerator, including both sides of the gap.
    assert (!strcmp (radio_mode_name (MODE_UNKNOWN), "UNKNOWN"));
    assert (!strcmp (radio_mode_name (MODE_LSB), "LSB"));
    assert (!strcmp (radio_mode_name (MODE_USB), "USB"));
    assert (!strcmp (radio_mode_name (MODE_CW), "CW"));
    assert (!strcmp (radio_mode_name (MODE_FM), "FM"));
    assert (!strcmp (radio_mode_name (MODE_AM), "AM"));
    assert (!strcmp (radio_mode_name (MODE_DATA), "DATA"));
    assert (!strcmp (radio_mode_name (MODE_CW_R), "CW_R"));

    // The bug: value 9 must name DATA_R, not the FT8 alias that happens to
    // sit at index 9 of a packed table.
    assert (!strcmp (radio_mode_name (MODE_DATA_R), "DATA_R"));

    // The enum gap and out-of-range values have no name.
    assert (radio_mode_name (8) == nullptr);
    assert (radio_mode_name (-1) == nullptr);
    assert (radio_mode_name (MODE_LAST + 1) == nullptr);

    // Reverse lookup: canonical names and DATA aliases.
    assert (radio_mode_from_name ("DATA_R") == MODE_DATA_R);
    assert (radio_mode_from_name ("CW") == MODE_CW);
    assert (radio_mode_from_name ("FT8") == MODE_DATA);
    assert (radio_mode_from_name ("JS8") == MODE_DATA);
    assert (radio_mode_from_name ("PK31") == MODE_DATA);
    assert (radio_mode_from_name ("FT4") == MODE_DATA);
    assert (radio_mode_from_name ("RTTY") == MODE_DATA);
    assert (radio_mode_from_name ("NOSUCH") == MODE_UNKNOWN);
    assert (radio_mode_from_name ("") == MODE_UNKNOWN);

    printf ("test_radio_mode: all assertions passed\n");
    return 0;
}
