// ============================================================================
// Spothole API Integration Layer
// ============================================================================
// This module provides a clean interface to the Spothole API for fetching
// unified xOTA (SOTA, POTA, WWFF, etc.) spot data.
//
// API Documentation: https://spothole.app/apidocs/openapi.yml

const SPOTHOLE_BASE_URL = "https://spothole.app/api/v1";
const SPOTHOLE_API_TIMEOUT_MS = 10000; // 10 seconds

// Cache for reference details (summit/park names, etc.)

// ============================================================================
// Main API Functions
// ============================================================================

/**
 * Fetch spots from Spothole API
 * @param {Object} options - Query parameters
 * @param {number} options.limit - Maximum number of spots to return (default: 200)
 * @param {number} options.max_age - Maximum age in seconds (3600=1hr, 10800=3hrs, 86400=24hrs)
 * @param {string} options.mode - Filter by mode (CW, SSB, FM, FT8, FT4, etc.)
 * @param {string} options.sig - Filter by source (SOTA, POTA, WWFF, etc.)
 * @param {boolean} options.dedupe - Remove duplicate callsigns (default: true)
 * @param {boolean} options.allow_qrt - Allow spots that are known to be QRT. (default: false)
 * @param {number} options.received_since - Unix timestamp for incremental updates
 * @returns {Promise<Array>} Array of spot objects
 */
async function fetchSpots(options = {}) {
    const params = new URLSearchParams({
        limit: options.limit || 200,
        dedupe: options.dedupe !== false ? "true" : "false",
        allow_qrt: options.allow_qrt !== true ? "false" : "true",
    });

    if (options.max_age) {
        params.append("max_age", options.max_age);
    }
    if (options.mode) {
        params.append("mode", options.mode);
    }
    if (options.sig) {
        params.append("sig", options.sig);
    }
    if (options.received_since) {
        params.append("received_since", options.received_since);
    }

    const url = `${SPOTHOLE_BASE_URL}/spots?${params.toString()}`;
    Log.debug("Spothole")("Fetching spots from:", url);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), SPOTHOLE_API_TIMEOUT_MS);

        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                Accept: "application/json",
                "Accept-Encoding": "gzip, deflate, br",
            },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        Log.debug("Spothole")(`Received ${data.length} spots`);
        return data;
    } catch (error) {
        if (error.name === "AbortError") {
            throw new Error("Spothole API request timed out");
        }
        Log.error("Spothole")("Error fetching spots:", error);
        throw error;
    }
}

// ============================================================================
// Data Transformation Functions
// ============================================================================

/**
 * Collapse a raw spot mode into its family for filtering/styling: CW, SSB,
 * AM, FM, DATA, or OTHER. The DATA family is whatever the shared
 * normalizeRadioMode (main.js) maps into a digital firmware mode, so a
 * mode that tunes as digital always filters as digital.
 */
function spotModeFamily(mode) {
    let family = String(mode || "").toUpperCase();
    if (family === "USB" || family === "LSB") family = "SSB";
    if (["CW", "SSB", "AM", "FM", "DATA"].includes(family)) return family;
    const mapped = normalizeRadioMode(family);
    if (mapped && DIGITAL_FIRMWARE_MODES.includes(mapped)) return "DATA";
    return "OTHER";
}

/**
 * Transform Spothole spot data into our internal format
 * This normalizes the data structure and adds computed fields
 * @param {Array} spotsData - Raw spots from Spothole API
 * @param {Object} location - Current user location {latitude, longitude}
 * @returns {Array} Transformed spot objects
 */
function spothole_transformSpots(spotsData, location) {
    return spotsData.map((spot) => {
        // Extract base callsign (remove /P, /M, etc.)
        const baseCallsign = (spot.dx_call || "").split("/")[0];

        // Normalize mode to uppercase
        const mode = (spot.mode || "UNKNOWN").toUpperCase();

        // Determine mode type for filtering/styling
        const modeType = spotModeFamily(mode);

        // Calculate distance if we have coordinates. calculateDistance
        // returns kilometers; the chase table's column is labeled Miles.
        const KM_TO_MILES = 0.621371;
        let distance = 99999; // Default to large number if no location
        if (location && spot.dx_latitude && spot.dx_longitude) {
            distance = Math.round(
                calculateDistance(location.latitude, location.longitude, spot.dx_latitude, spot.dx_longitude) * KM_TO_MILES
            );
        }

        // Convert timestamp to Date object
        const timestamp = new Date(spot.time * 1000); // Spothole uses Unix timestamp in seconds

        // Extract reference ID from sig_refs array (first one if multiple)
        const locationID = spot.sig_refs && spot.sig_refs.length > 0 ? spot.sig_refs[0].id : "-";

        // Extract reference details from sig_refs
        const refDetails = spot.sig_refs && spot.sig_refs.length > 0 ? spot.sig_refs[0].name : "";

        return {
            // Original Spothole fields (prefixed for clarity)
            spothole_dx_call: spot.dx_call,
            spothole_de_call: spot.de_call,
            spothole_freq: spot.freq,
            spothole_mode: spot.mode,
            spothole_sig: spot.sig,
            spothole_sig_refs: spot.sig_refs,
            spothole_comment: spot.comment,
            spothole_time: spot.time,
            spothole_dx_latitude: spot.dx_latitude,
            spothole_dx_longitude: spot.dx_longitude,
            spothole_dx_dxcc_id: spot.dx_dxcc_id,
            spothole_dx_continent: spot.dx_continent,
            spothole_dx_location_good: spot.dx_location_good,

            // Normalized fields for unified chase table display
            activatorCallsign: spot.dx_call || "UNKNOWN",
            baseCallsign: baseCallsign,
            hertz: spot.freq || 0,
            frequency: (spot.freq || 0) / 1000000, // MHz for compatibility
            mode: mode,
            modeType: modeType,
            locationID: locationID,
            sig: spot.sig || "Cluster", // Source type (SOTA, POTA, or Cluster for DX spots)
            distance: distance,
            timestamp: timestamp,
            comments: spot.comment || "",

            activatorName: spot.dx_name || "", // Name from API
            details: refDetails, // Reference name from sig_refs
        };
    });
}

// ============================================================================
// Main Orchestration Function
// ============================================================================

/**
 * Fetch and process spots from Spothole API
 * This is the main entry point for getting chase spots
 * @param {Object} options - Fetch options
 * @param {number} options.max_age - Maximum age in seconds
 * @param {string} options.mode - Filter by mode
 * @param {string} options.sig - Filter by source type
 * @param {Object} location - User location {latitude, longitude}
 * @returns {Promise<Array>} Processed spots
 */
async function fetchAndProcessSpots(options, location) {
    try {
        // Fetch raw spots from Spothole
        const rawSpots = await fetchSpots(options);

        // Transform to our internal format
        let spots = spothole_transformSpots(rawSpots, location);

        // Sort by timestamp (newest first)
        spots.sort((a, b) => b.timestamp - a.timestamp);

        return spots;
    } catch (error) {
        Log.error("Spothole")("Error in fetchAndProcessSpots:", error);
        throw error;
    }
}
