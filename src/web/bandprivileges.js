// ============================================================================
// FCC License Class Band Privileges
// ============================================================================
// Data source: FCC Part 97 as of January 2025
// Structured for mode-aware and bandwidth-aware privilege checking
// Extensible design for future regional support

// ============================================================================
// Constants
// ============================================================================

// Default signal bandwidths in Hz (conservative estimates)
const MODE_BANDWIDTH_HZ = {
    CW: 500,
    CW_R: 500,
    USB: 3000,
    LSB: 3000,
    SSB: 3000,
    AM: 6000,
    FM: 15000,
    DATA: 3000,
    DATA_R: 3000,
};

// ============================================================================
// FCC HF Band Privilege Table
// ============================================================================
// Each segment defines: frequency range (Hz), allowed modes, license classes
// Mode categories: CW, DATA, PHONE
// License classes: T (Technician), G (General), E (Extra)

const FCC_HF_PRIVILEGES = {
    "160m": [
        { min: 1800000, max: 2000000, modes: ["CW", "DATA", "PHONE"], classes: ["E", "G"] },
    ],
    "80m": [
        { min: 3500000, max: 3600000, modes: ["CW", "DATA"], classes: ["E", "G"] },
        { min: 3600000, max: 3700000, modes: ["CW", "DATA", "PHONE"], classes: ["E"] },
        { min: 3700000, max: 3800000, modes: ["CW", "DATA", "PHONE"], classes: ["E"] },  // General has NO privileges 3.6-3.8
        { min: 3800000, max: 4000000, modes: ["CW", "DATA", "PHONE"], classes: ["E", "G"] },
    ],
    "60m": [
        // Channelized band - simplified with narrow segments around each channel
        { min: 5330500, max: 5333500, modes: ["CW", "DATA", "PHONE"], classes: ["E", "G"] },
        { min: 5346500, max: 5349500, modes: ["CW", "DATA", "PHONE"], classes: ["E", "G"] },
        { min: 5357000, max: 5360000, modes: ["CW", "DATA", "PHONE"], classes: ["E", "G"] },
        { min: 5371500, max: 5374500, modes: ["CW", "DATA", "PHONE"], classes: ["E", "G"] },
        { min: 5403500, max: 5406500, modes: ["CW", "DATA", "PHONE"], classes: ["E", "G"] },
    ],
    "40m": [
        { min: 7000000, max: 7025000, modes: ["CW"], classes: ["E"] },
        { min: 7025000, max: 7125000, modes: ["CW", "DATA"], classes: ["E", "G", "T"] },
        { min: 7125000, max: 7175000, modes: ["CW", "DATA", "PHONE"], classes: ["E", "G"] },
        { min: 7175000, max: 7300000, modes: ["CW", "DATA", "PHONE"], classes: ["E", "G", "T"] },
    ],
    "30m": [
        // WARC band - CW/DATA only, no phone
        { min: 10100000, max: 10150000, modes: ["CW", "DATA"], classes: ["E", "G", "T"] },
    ],
    "20m": [
        { min: 14000000, max: 14025000, modes: ["CW"], classes: ["E"] },
        { min: 14025000, max: 14150000, modes: ["CW", "DATA"], classes: ["E", "G"] },
        { min: 14150000, max: 14225000, modes: ["CW", "DATA", "PHONE"], classes: ["E"] },
        { min: 14225000, max: 14350000, modes: ["CW", "DATA", "PHONE"], classes: ["E", "G"] },
    ],
    "17m": [
        // WARC band
        { min: 18068000, max: 18110000, modes: ["CW", "DATA"], classes: ["E", "G", "T"] },
        { min: 18110000, max: 18168000, modes: ["CW", "DATA", "PHONE"], classes: ["E", "G", "T"] },
    ],
    "15m": [
        { min: 21000000, max: 21025000, modes: ["CW"], classes: ["E"] },
        { min: 21025000, max: 21200000, modes: ["CW", "DATA"], classes: ["E", "G"] },
        { min: 21200000, max: 21275000, modes: ["CW", "DATA", "PHONE"], classes: ["E"] },
        { min: 21275000, max: 21450000, modes: ["CW", "DATA", "PHONE"], classes: ["E", "G", "T"] },
    ],
    "12m": [
        // WARC band
        { min: 24890000, max: 24930000, modes: ["CW", "DATA"], classes: ["E", "G", "T"] },
        { min: 24930000, max: 24990000, modes: ["CW", "DATA", "PHONE"], classes: ["E", "G", "T"] },
    ],
    "10m": [
        { min: 28000000, max: 28300000, modes: ["CW", "DATA"], classes: ["E", "G", "T"] },
        { min: 28300000, max: 29700000, modes: ["CW", "DATA", "PHONE"], classes: ["E", "G", "T"] },
    ],
};

// ============================================================================
// Mode Category Mapping
// ============================================================================

/**
 * Map radio mode to FCC privilege category
 * @param {string} radioMode - Mode from radio (USB, LSB, CW, DATA, etc.)
 * @returns {string} Category: 'CW', 'DATA', or 'PHONE'
 */
function getModeCategory(radioMode) {
    const mode = (radioMode || "").toUpperCase();

    if (mode === "CW" || mode === "CW_R") {
        return "CW";
    }

    if (mode === "DATA" || mode === "DATA_R") {
        return "DATA";
    }

    // USB, LSB, AM, FM, SSB are all phone modes
    if (["USB", "LSB", "AM", "FM", "SSB"].includes(mode)) {
        return "PHONE";
    }

    // Unknown mode - treat as PHONE (most restrictive for privilege checking)
    return "PHONE";
}

/**
 * Get bandwidth for a given mode
 * @param {string} radioMode - Mode from radio
 * @returns {number} Bandwidth in Hz
 */
function getModeBandwidth(radioMode) {
    const mode = (radioMode || "USB").toUpperCase();
    return MODE_BANDWIDTH_HZ[mode] || 3000;
}

// ============================================================================
// Bandwidth Edge Calculations
// ============================================================================

/**
 * Calculate lower edge of signal based on mode
 * @param {number} frequencyHz - Dial frequency in Hz
 * @param {string} radioMode - Current mode
 * @param {number} bandwidth - Signal bandwidth in Hz
 * @returns {number} Lower edge frequency in Hz
 */
function getSignalLowerEdge(frequencyHz, radioMode, bandwidth) {
    const mode = (radioMode || "").toUpperCase();

    // LSB: signal extends below dial frequency
    if (mode === "LSB") {
        return frequencyHz - bandwidth;
    }

    // USB, DATA: signal extends above dial frequency
    if (mode === "USB" || mode === "DATA" || mode === "DATA_R") {
        return frequencyHz;
    }

    // CW, AM, FM: centered on dial frequency
    return frequencyHz - bandwidth / 2;
}

/**
 * Calculate upper edge of signal based on mode
 * @param {number} frequencyHz - Dial frequency in Hz
 * @param {string} radioMode - Current mode
 * @param {number} bandwidth - Signal bandwidth in Hz
 * @returns {number} Upper edge frequency in Hz
 */
function getSignalUpperEdge(frequencyHz, radioMode, bandwidth) {
    const mode = (radioMode || "").toUpperCase();

    // USB, DATA: signal extends above dial frequency
    if (mode === "USB" || mode === "DATA" || mode === "DATA_R") {
        return frequencyHz + bandwidth;
    }

    // LSB: signal at or below dial frequency
    if (mode === "LSB") {
        return frequencyHz;
    }

    // CW, AM, FM: centered on dial frequency
    return frequencyHz + bandwidth / 2;
}

// ============================================================================
// Privilege Segment Lookup
// ============================================================================

/**
 * Find the privilege segment containing a frequency
 * Uses >= min and < max for all segments except the last (which uses <= max)
 * This ensures boundary frequencies belong to the higher segment
 * @param {number} frequencyHz - Frequency in Hz
 * @param {Array} segments - Array of privilege segments for a band
 * @returns {Object|null} Matching segment or null
 */
function findPrivilegeSegment(frequencyHz, segments) {
    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const isLastSegment = i === segments.length - 1;

        // Use < max for all except last segment (which uses <= max)
        // This ensures boundary frequencies (e.g., 7.125) belong to the higher segment
        if (isLastSegment) {
            if (frequencyHz >= segment.min && frequencyHz <= segment.max) {
                return segment;
            }
        } else {
            if (frequencyHz >= segment.min && frequencyHz < segment.max) {
                return segment;
            }
        }
    }
    return null;
}

// ============================================================================
// Main Privilege Checking Function
// ============================================================================

/**
 * Check license privileges for a given frequency, mode, and user license
 * @param {number} frequencyHz - Center frequency in Hz
 * @param {string} radioMode - Current radio mode (USB, CW, DATA, etc.)
 * @param {string|null} userLicenseClass - User's license class ('T', 'G', 'E', or null)
 * @returns {Object} Privilege status
 */
function checkPrivileges(frequencyHz, radioMode, userLicenseClass) {
    const band = getBandFromFrequency(frequencyHz);
    const modeCategory = getModeCategory(radioMode);
    const bandwidth = getModeBandwidth(radioMode);

    // Calculate occupied bandwidth edges
    const lowerEdge = getSignalLowerEdge(frequencyHz, radioMode, bandwidth);
    const upperEdge = getSignalUpperEdge(frequencyHz, radioMode, bandwidth);

    // Result object
    const result = {
        inBand: !!band,
        privileges: [],
        modeAllowed: false,
        userCanTransmit: false,
        warning: null,
        edgeWarning: null,
    };

    if (!band) {
        result.warning = "Out of band";
        return result;
    }

    const bandPrivileges = FCC_HF_PRIVILEGES[band];
    if (!bandPrivileges) {
        // Band exists in BAND_PLAN but no FCC privileges defined (e.g., 11m CB)
        result.warning = "No amateur privileges";
        return result;
    }

    // Find the segment containing the dial frequency
    const segment = findPrivilegeSegment(frequencyHz, bandPrivileges);
    if (!segment) {
        result.warning = "Outside licensed segment";
        return result;
    }

    // Check if current mode category is allowed in this segment
    result.modeAllowed = segment.modes.includes(modeCategory);
    if (!result.modeAllowed) {
        const modeNames = {
            CW: "CW",
            DATA: "Data",
            PHONE: "Phone",
        };
        result.warning = `${modeNames[modeCategory]} not allowed here`;
    }

    // Get license classes that have privileges here (for the badges)
    // Only include classes that can use the current mode
    if (result.modeAllowed) {
        result.privileges = [...segment.classes];
    }
    // If mode not allowed, no one can transmit with this mode
    // But we still want to show who COULD be here with correct mode
    // So store segment classes separately for badge display
    result.segmentClasses = [...segment.classes];

    // Check if user can transmit (license in privileges AND mode allowed)
    if (userLicenseClass) {
        result.userCanTransmit =
            result.modeAllowed && segment.classes.includes(userLicenseClass);

        if (!result.userCanTransmit && result.modeAllowed) {
            result.warning = "Outside your privileges";
        }
    }

    // Check bandwidth edge conditions
    const lowerEdgeSegment = findPrivilegeSegment(lowerEdge, bandPrivileges);
    const upperEdgeSegment = findPrivilegeSegment(upperEdge, bandPrivileges);

    if (!lowerEdgeSegment || lowerEdge < bandPrivileges[0].min) {
        result.edgeWarning = "Signal extends out of band";
    } else if (
        !upperEdgeSegment ||
        upperEdge > bandPrivileges[bandPrivileges.length - 1].max
    ) {
        result.edgeWarning = "Signal extends out of band";
    } else if (lowerEdgeSegment !== segment || upperEdgeSegment !== segment) {
        // Signal spans multiple segments - check mode and privileges

        // First check if mode is allowed in all edge segments
        const lowerModeAllowed = lowerEdgeSegment.modes.includes(modeCategory);
        const upperModeAllowed = upperEdgeSegment.modes.includes(modeCategory);

        if (!lowerModeAllowed || !upperModeAllowed) {
            const modeNames = { CW: "CW", DATA: "Data", PHONE: "Phone" };
            result.edgeWarning = `Signal extends into non-${modeNames[modeCategory].toLowerCase()} segment`;
            result.userCanTransmit = false;
        } else if (userLicenseClass) {
            // Mode is allowed, check if user's class has privileges in all segments
            const lowerHasPriv = lowerEdgeSegment.classes.includes(userLicenseClass);
            const upperHasPriv = upperEdgeSegment.classes.includes(userLicenseClass);

            if (!lowerHasPriv || !upperHasPriv) {
                result.edgeWarning = "Signal spans privilege boundary";
                result.userCanTransmit = false;
            }
        }
    }

    return result;
}

/**
 * Get privilege status for each license class at a frequency/mode
 * @param {number} frequencyHz - Frequency in Hz
 * @param {string} radioMode - Current mode
 * @returns {Object} Status for each class: { T: boolean, G: boolean, E: boolean }
 */
function getLicenseClassStatus(frequencyHz, radioMode) {
    const result = {
        T: false,
        G: false,
        E: false,
    };

    const check = checkPrivileges(frequencyHz, radioMode, null);

    // If mode is allowed, use the privileges list
    // If mode is not allowed, no one can TX with this mode
    if (check.modeAllowed && check.privileges) {
        for (const cls of check.privileges) {
            result[cls] = true;
        }
    }

    return result;
}

/**
 * Get user's license class from AppState
 * @returns {string|null} License class ('T', 'G', 'E') or null
 */
function getUserLicenseClass() {
    return AppState.licenseClass || null;
}
