// Standalone host test — no ESP-IDF. Build: see test/host/Makefile
//
// Contract pinned here: the GET-side dispatch order for cached radio
// values. Freshness wins outright; FT8 exclusivity serves last-known
// without arming a refresh (the service does no CAT work then); a known-
// down link is refused honestly AFTER the refresh is armed (the refresh
// slot doubles as the recovery probe); otherwise the request parks.
#include "../../include/radio_get_gate.h"
#include <cassert>
#include <cstdio>

int main () {
    using A = RadioGetAction;

    // Fresh beats everything.
    assert (radio_get_action (true, false, true) == A::SERVE_FRESH);
    assert (radio_get_action (true, true, false) == A::SERVE_FRESH);

    // FT8 exclusivity: stale immediately, and no refresh churn.
    assert (radio_get_action (false, true, true) == A::SERVE_STALE);
    assert (radio_get_action (false, true, false) == A::SERVE_STALE);
    assert (!radio_get_should_refresh (false, true));

    // Link down (not FT8): refuse — but the refresh IS armed first.
    assert (radio_get_action (false, false, false) == A::REFUSE_LINK_DOWN);
    assert (radio_get_should_refresh (false, false));

    // Normal stale path: refresh and park.
    assert (radio_get_action (false, false, true) == A::TRY_PARK);
    assert (radio_get_should_refresh (false, false));

    // Fresh never refreshes.
    assert (!radio_get_should_refresh (true, false));
    assert (!radio_get_should_refresh (true, true));

    printf ("test_radio_get_gate: all assertions passed\n");
    return 0;
}
