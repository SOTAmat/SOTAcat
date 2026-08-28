#pragma once

#include <cstring>

/**
 * Radio operating modes and their canonical names.
 *
 * Header-only and ESP-IDF-free so host tests can exercise the lookups
 * (see test/host/test_radio_mode.cpp).
 *
 * The enumerator values mirror the Elecraft MDn CAT codes, which skip 8:
 * MODE_CW_R = 7, MODE_DATA_R = 9. Never index a table by these values.
 * Use the scan-based lookups below, which stay correct across the gap.
 */
typedef enum {
    MODE_UNKNOWN = 0,
    MODE_LSB     = 1,
    MODE_USB     = 2,
    MODE_CW      = 3,
    MODE_FM      = 4,
    MODE_AM      = 5,
    MODE_DATA    = 6,
    MODE_CW_R    = 7,
    MODE_DATA_R  = 9,
    MODE_LAST    = 9
} radio_mode_t;

// Map of radio mode names to enum values. Canonical names first (one per
// enumerator), then aliases; radio_mode_name() returns the first match, so
// canonical rows must precede aliases for the same mode.
typedef struct {
    char const * const name;
    radio_mode_t       mode;
} radio_mode_map_t;

static const radio_mode_map_t radio_mode_map[] = {
    {"UNKNOWN", MODE_UNKNOWN},
    {"LSB",     MODE_LSB    },
    {"USB",     MODE_USB    },
    {"CW",      MODE_CW     },
    {"FM",      MODE_FM     },
    {"AM",      MODE_AM     },
    {"DATA",    MODE_DATA   },
    {"CW_R",    MODE_CW_R   },
    {"DATA_R",  MODE_DATA_R },

    // Aliases for "DATA":
    {"FT8",     MODE_DATA   },
    {"JS8",     MODE_DATA   },
    {"PK31",    MODE_DATA   },
    {"FT4",     MODE_DATA   },
    {"RTTY",    MODE_DATA   },
};

/**
 * Canonical name for a mode value, or nullptr if the value is not a
 * radio_mode_t enumerator (including the gap value 8).
 */
inline char const * radio_mode_name (long mode) {
    for (auto const & kv : radio_mode_map)
        if (kv.mode == mode)
            return kv.name;
    return nullptr;
}

/**
 * Mode value for a name (canonical or alias), or MODE_UNKNOWN if the name
 * is not recognized. Matching is exact and case-sensitive; callers normalize.
 */
inline radio_mode_t radio_mode_from_name (char const * name) {
    for (auto const & kv : radio_mode_map)
        if (!strcmp (name, kv.name))
            return kv.mode;
    return MODE_UNKNOWN;
}
