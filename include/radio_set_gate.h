#pragma once

#include <cstddef>

/**
 * Accept-gate for HTTP radio SET commands (host-testable; see
 * test/host/test_radio_set_gate.cpp).
 *
 * Two owners hold the radio exclusively for long stretches: an FT8
 * transmission and the CW keyer task (radio mutex held for the whole
 * message, typically 10-15 s). During either, the radio-service worker
 * cannot acquire the mutex, so an accepted SET would only sit in its slot
 * until it expired at SET_APPLY_DEADLINE_MS — a silent drop behind a 202.
 * Refuse both up front with an honest 503 instead. FT8 takes precedence
 * when both flags read true, keeping the reason stable.
 */
enum class RadioSetRefusal {
    NONE,   // accept the command
    FT8,    // FT8 transmission owns the radio
    KEYER,  // CW keyer transmission owns the radio
};

inline RadioSetRefusal radio_set_refusal (bool ft8_exclusive, bool keyer_active) {
    if (ft8_exclusive)
        return RadioSetRefusal::FT8;
    if (keyer_active)
        return RadioSetRefusal::KEYER;
    return RadioSetRefusal::NONE;
}

// 503 reply body for a refusal; nullptr for NONE.
inline const char * radio_set_refusal_message (RadioSetRefusal r) {
    switch (r) {
    case RadioSetRefusal::FT8: return "radio busy (FT8)";
    case RadioSetRefusal::KEYER: return "radio busy (keyer)";
    default: return nullptr;
    }
}
