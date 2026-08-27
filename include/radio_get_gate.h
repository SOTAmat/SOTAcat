#pragma once

/**
 * Dispatch order for GET handlers serving cached radio values (host-
 * testable; see test/host/test_radio_get_gate.cpp).
 *
 * Freshness wins outright. FT8 exclusivity serves last-known immediately.
 * The radio service does no CAT work then, so arming a refresh would only
 * churn the slot. A known-down link is refused honestly, but its refresh IS
 * armed first: the refresh slot doubles as the link-recovery probe.
 * Otherwise the request parks so the reply can carry the refreshed value.
 */
enum class RadioGetAction {
    SERVE_FRESH,       // snapshot is current: serve it
    SERVE_STALE,       // FT8 owns the radio: serve last-known, no refresh
    REFUSE_LINK_DOWN,  // refresh armed as recovery probe, then 503
    TRY_PARK,          // refresh armed; park, else serve last-known
};

inline RadioGetAction radio_get_action (bool fresh, bool ft8_exclusive, bool link_up) {
    if (fresh)
        return RadioGetAction::SERVE_FRESH;
    if (ft8_exclusive)
        return RadioGetAction::SERVE_STALE;
    if (!link_up)
        return RadioGetAction::REFUSE_LINK_DOWN;
    return RadioGetAction::TRY_PARK;
}

inline bool radio_get_should_refresh (bool fresh, bool ft8_exclusive) {
    return !fresh && !ft8_exclusive;
}
