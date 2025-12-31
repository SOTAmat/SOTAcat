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
const referenceDetailsCache = {};
const callsignDetailsCache = {};

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
    Log.debug("Spothole", "Fetching spots from:", url);

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
        Log.debug("Spothole", `Received ${data.length} spots`);
        return data;
    } catch (error) {
        if (error.name === "AbortError") {
            throw new Error("Spothole API request timed out");
        }
        Log.error("Spothole", "Error fetching spots:", error);
        throw error;
    }
}

/**
 * Fetch reference details (summit/park information)
 * @param {string} sigRef - Reference code (e.g., "W6/NC-417", "K-0817")
 * @returns {Promise<Object>} Reference details object
 */
async function fetchReferenceDetails(sigRef) {
    // Check cache first
    if (referenceDetailsCache[sigRef]) {
        return referenceDetailsCache[sigRef];
    }

    const url = `${SPOTHOLE_BASE_URL}/lookup/sigref?sigref=${encodeURIComponent(sigRef)}`;
    Log.debug("Spothole", "Fetching reference details:", sigRef);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), SPOTHOLE_API_TIMEOUT_MS);

        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                Accept: "application/json",
            },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            Log.warn("Spothole", `Reference lookup failed for ${sigRef}: ${response.status}`);
            return null;
        }

        const data = await response.json();

        // Cache the result
        referenceDetailsCache[sigRef] = data;
        return data;
    } catch (error) {
        Log.warn("Spothole", "Error fetching reference details:", error);
        return null;
    }
}

/**
 * Fetch callsign details (name, QTH, etc.)
 * @param {string} callsign - Callsign to look up
 * @returns {Promise<Object>} Callsign details object
 */
async function fetchCallsignDetails(callsign) {
    // Check cache first
    if (callsignDetailsCache[callsign]) {
        return callsignDetailsCache[callsign];
    }

    const url = `${SPOTHOLE_BASE_URL}/lookup/call?call=${encodeURIComponent(callsign)}`;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), SPOTHOLE_API_TIMEOUT_MS);

        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                Accept: "application/json",
            },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            return null;
        }

        const data = await response.json();

        // Cache the result
        callsignDetailsCache[callsign] = data;
        return data;
    } catch (error) {
        Log.warn("Spothole", "Error fetching callsign details:", error);
        return null;
    }
}

// ============================================================================
// Data Transformation Functions
// ============================================================================

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
        let modeType = mode;

        // USB and LSB are members of the SSB mode family
        if (["USB", "LSB"].includes(modeType)) {
            modeType = "SSB";
        }

        if (!["CW", "SSB", "AM", "FM", "DATA"].includes(modeType)) {
            // Check for data modes (from Spothole /api/v1/options + legacy WSJT modes)
            const dataModes = [
                "RTTY", "PSK", "PSK31", "BPSK", "BPSK31",  // RTTY and PSK variants
                "FT8", "FT4", "JT65", "JT9", "JS8",        // WSJT-X and JS8Call
                "MFSK", "MFSK32", "OLIVIA",                // MFSK variants
                "HELL", "SSTV", "PKT", "MSK144",           // Other digital modes
            ];
            if (dataModes.includes(modeType)) {
                modeType = "DATA";
            } else {
                modeType = "OTHER";
            }
        }

        // Calculate distance if we have coordinates
        let distance = 99999; // Default to large number if no location
        if (location && spot.dx_latitude && spot.dx_longitude) {
            distance = Math.round(
                calculateDistance(location.latitude, location.longitude, spot.dx_latitude, spot.dx_longitude)
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

            // Fields to be enriched later
            activatorName: spot.dx_name || "", // Name from API or enrichment
            details: refDetails, // Reference name from sig_refs or enrichment
        };
    });
}

/**
 * Enrich spots with additional details (names, reference info)
 * This is done asynchronously and can be skipped for performance
 * @param {Array} spots - Array of transformed spots
 * @param {boolean} enrichReferences - Whether to fetch reference details
 * @param {boolean} enrichCallsigns - Whether to fetch callsign details
 * @returns {Promise<Array>} Enriched spots
 */
async function spothole_enrichSpots(spots, enrichReferences = true, enrichCallsigns = false) {
    Log.debug("Spothole", `Enriching ${spots.length} spots (refs: ${enrichReferences}, calls: ${enrichCallsigns})`);

    // Collect unique references and callsigns
    const uniqueRefs = new Set();
    const uniqueCalls = new Set();

    spots.forEach((spot) => {
        if (spot.sig_ref) uniqueRefs.add(spot.sig_ref);
        if (spot.baseCallsign) uniqueCalls.add(spot.baseCallsign);
    });

    // Fetch all reference details in parallel (if enabled)
    if (enrichReferences && uniqueRefs.size > 0) {
        const refPromises = Array.from(uniqueRefs).map((ref) =>
            fetchReferenceDetails(ref).catch((err) => {
                Log.warn("Spothole", `Failed to fetch details for ${ref}:`, err);
                return null;
            })
        );
        await Promise.all(refPromises);
    }

    // Fetch all callsign details in parallel (if enabled)
    if (enrichCallsigns && uniqueCalls.size > 0) {
        const callPromises = Array.from(uniqueCalls).map((call) =>
            fetchCallsignDetails(call).catch((err) => {
                Log.warn("Spothole", `Failed to fetch details for ${call}:`, err);
                return null;
            })
        );
        await Promise.all(callPromises);
    }

    // Now enrich each spot with cached data
    spots.forEach((spot) => {
        // Enrich with reference details
        if (enrichReferences && spot.locationID) {
            const refDetails = referenceDetailsCache[spot.locationID];
            if (refDetails) {
                spot.details = formatReferenceDetails(refDetails, spot.sig);
            }
        }

        // Enrich with callsign details
        if (enrichCallsigns && spot.baseCallsign) {
            const callDetails = callsignDetailsCache[spot.baseCallsign];
            if (callDetails && callDetails.name) {
                spot.activatorName = callDetails.name;
            }
        }
    });

    return spots;
}

/**
 * Format reference details based on sig type
 * @param {Object} refDetails - Reference details from API
 * @param {string} sig - Source type (SOTA, POTA, etc.)
 * @returns {string} Formatted details string
 */
function formatReferenceDetails(refDetails, sig) {
    if (!refDetails) return "";

    if (sig === "SOTA") {
        // Format like: "Mount Tamalpais, 785m, 8 points"
        const parts = [];
        if (refDetails.name) parts.push(refDetails.name);
        if (refDetails.altitude_m) parts.push(`${refDetails.altitude_m}m`);
        if (refDetails.points) parts.push(`${refDetails.points} points`);
        return parts.join(", ");
    } else if (sig === "POTA") {
        // Format like: "Mount Tamalpais State Park"
        return refDetails.name || "";
    } else {
        // Generic format
        return refDetails.name || "";
    }
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
 * @param {boolean} enrichDetails - Whether to enrich with reference/callsign details
 * @returns {Promise<Array>} Processed and enriched spots
 */
async function fetchAndProcessSpots(options, location, enrichDetails = true) {
    try {
        // Fetch raw spots from Spothole
        const rawSpots = await fetchSpots(options);

        // Transform to our internal format
        let spots = spothole_transformSpots(rawSpots, location);

        // Sort by timestamp (newest first)
        spots.sort((a, b) => b.timestamp - a.timestamp);

        // Optionally enrich with additional details
        if (enrichDetails) {
            spots = await spothole_enrichSpots(spots, true, false); // Enrich references but not callsigns (too slow)
        }

        return spots;
    } catch (error) {
        Log.error("Spothole", "Error in fetchAndProcessSpots:", error);
        throw error;
    }
}
