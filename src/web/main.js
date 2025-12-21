// ============================================================================
// Main Application Entry Point
// ============================================================================
// Core application logic including tab management, status updates, location
// services, and version checking

// ============================================================================
// Timing Constants
// ============================================================================

const INITIAL_VERSION_CHECK_DELAY_MS = 1000;
const UTC_CLOCK_UPDATE_INTERVAL_MS = 10000;
const BATTERY_INFO_UPDATE_INTERVAL_MS = 60000;
const CONNECTION_STATUS_UPDATE_INTERVAL_MS = 5000;
const VFO_POLLING_INTERVAL_MS = 3000;

// ============================================================================
// Global Application State
// ============================================================================

const AppState = {
    // Data caches
    latestChaseJson: null,

    // Tab management
    currentTabName: null,

    // Location
    gpsOverride: null,

    // User settings
    callSign: "",

    // Version checking
    versionCheckRetryTimer: null,

    // VFO state (shared between CAT and Chase pages)
    vfoFrequencyHz: null,   // null = unknown/not connected
    vfoMode: null,
    vfoLastUpdated: 0,
    vfoUpdateInterval: null,
    vfoChangeCallbacks: [], // subscribers for VFO change notifications
};

// ============================================================================
// User Settings Functions
// ============================================================================

// Load user callsign into AppState if not already loaded
// Returns the callsign (or empty string if not set)
async function ensureCallSignLoaded() {
    if (AppState.callSign) {
        return AppState.callSign;
    }
    try {
        const response = await fetch("/api/v1/callsign");
        const data = await response.json();
        if (data.callsign) {
            AppState.callSign = data.callsign.toUpperCase();
        }
    } catch (error) {
        console.warn("Failed to load callsign:", error);
    }
    return AppState.callSign;
}

// ============================================================================
// Frequency Utilities (shared across CAT and Chase pages)
// ============================================================================

// Complete band plan: VLF through microwave (27 bands)
// Bands with 'initial' property are available on CAT page band buttons
const BAND_PLAN = {
    "2200m": { min: 135700, max: 137800 },
    "600m": { min: 472000, max: 479000 },
    "160m": { min: 1800000, max: 2000000 },
    "80m": { min: 3500000, max: 4000000 },
    "60m": { min: 5300000, max: 5400000 },
    "40m": { min: 7000000, max: 7300000, initial: 7175000 },
    "30m": { min: 10100000, max: 10150000 },
    "20m": { min: 14000000, max: 14350000, initial: 14225000 },
    "17m": { min: 18068000, max: 18168000, initial: 18110000 },
    "15m": { min: 21000000, max: 21450000, initial: 21275000 },
    "12m": { min: 24890000, max: 24990000, initial: 24930000 },
    "11m": { min: 26965000, max: 27405000 },
    "10m": { min: 28000000, max: 29700000, initial: 28300000 },
    "8m": { min: 40660000, max: 40700000 },
    "6m": { min: 50000000, max: 54000000 },
    "5m": { min: 54000000, max: 69900000 },
    "4m": { min: 70000000, max: 70500000 },
    "2m": { min: 144000000, max: 148000000 },
    "1p25m": { min: 222000000, max: 225000000 },
    "70cm": { min: 420000000, max: 450000000 },
    "23cm": { min: 1240000000, max: 1300000000 },
    "2p4GHz": { min: 2400000000, max: 2450000000 },
    "5p8GHz": { min: 5650000000, max: 5925000000 },
    "10GHz": { min: 10000000000, max: 10500000000 },
    "24GHz": { min: 24000000000, max: 24250000000 },
    "47GHz": { min: 47000000000, max: 47200000000 },
    "76GHz": { min: 76000000000, max: 77500000000 },
};

// Determine which amateur band a frequency falls into (returns '40m', '20m', etc., or null)
function getBandFromFrequency(frequencyHz) {
    for (const [band, plan] of Object.entries(BAND_PLAN)) {
        if (frequencyHz >= plan.min && frequencyHz <= plan.max) {
            return band;
        }
    }
    return null;
}

// Format frequency from Hz to human-readable XX.XXX.XXX MHz format
function formatFrequency(frequencyHz) {
    const mhz = frequencyHz / 1000000;
    const formatted = mhz.toFixed(6);
    const parts = formatted.split(".");
    const wholePart = parts[0];
    const decimalPart = parts[1];

    // Insert periods for readability: XX.XXX.XXX
    if (decimalPart && decimalPart.length >= 3) {
        return `${wholePart}.${decimalPart.substring(0, 3)}.${decimalPart.substring(3)}`;
    }
    return formatted;
}

/**
 * Parse user frequency input into Hz
 * Supports various formats:
 * - Pure integers: 7225 -> 7.225 MHz, 14225 -> 14.225 MHz, 282 -> 28.200 MHz
 * - Single decimal: 7.225 -> 7.225 MHz, 14.070 -> 14.070 MHz
 * - Multi-period: 14.208.1 -> 14.208100 MHz
 *
 * Returns an object: { success: boolean, frequencyHz: number, band: string, error: string }
 */
function parseFrequencyInput(input) {
    const cleaned = input.trim();

    if (!cleaned) {
        return { success: false, error: "Empty input" };
    }

    // Convert commas to periods (treat them as equivalent separators)
    const normalized = cleaned.replace(/,/g, ".");

    // Allow only digits and periods/commas
    if (!/^[0-9.,]+$/.test(cleaned)) {
        return { success: false, error: "Invalid characters (only digits, periods, and commas allowed)" };
    }

    // Count periods (after normalization)
    const periodCount = (normalized.match(/\./g) || []).length;

    let frequencyHz;

    if (periodCount === 0) {
        // Pure integer input - interpret intelligently
        frequencyHz = parseIntegerFrequency(normalized);
    } else if (periodCount === 1) {
        // Single decimal - treat as MHz
        const mhz = parseFloat(normalized);
        if (isNaN(mhz)) {
            return { success: false, error: "Invalid decimal format" };
        }
        frequencyHz = Math.round(mhz * 1000000);
    } else {
        // Multi-period format - treat periods as grouping separators
        frequencyHz = parseMultiPeriodFrequency(normalized);
    }

    if (frequencyHz === null) {
        return { success: false, error: "Could not parse frequency" };
    }

    // Validate against band plan
    const band = getBandFromFrequency(frequencyHz);
    if (!band) {
        return {
            success: false,
            error: `Frequency ${(frequencyHz / 1000000).toFixed(3)} MHz not in any supported band`,
        };
    }

    return { success: true, frequencyHz, band };
}

/**
 * Parse integer frequency inputs intelligently
 * Examples: 7225 -> 7.225 MHz, 14225 -> 14.225 MHz, 282 -> 28.200 MHz
 */
function parseIntegerFrequency(intStr) {
    const num = parseInt(intStr, 10);
    if (isNaN(num)) return null;

    // Try different interpretations and see which fits a band
    const candidates = [];

    // Interpretation 1: Last 3 digits are kHz
    if (num >= 1000) {
        const mhz = Math.floor(num / 1000);
        const khz = num % 1000;
        candidates.push(mhz * 1000000 + khz * 1000);
    }

    // Interpretation 2: Direct MHz (for smaller numbers)
    candidates.push(num * 1000000);

    // Interpretation 3: Last 2 digits are 10s of kHz (e.g., 282 -> 28.2 MHz)
    if (num >= 100) {
        const mhz = Math.floor(num / 10);
        const tenKhz = num % 10;
        candidates.push(mhz * 1000000 + tenKhz * 100000);
    }

    // Try to find a candidate that fits a known band
    for (const freqHz of candidates) {
        if (getBandFromFrequency(freqHz)) {
            return freqHz;
        }
    }

    // If none match, return the first interpretation (most common)
    return candidates[0] || null;
}

/**
 * Parse multi-period format like 14.208.1 -> 14.208100 MHz
 */
function parseMultiPeriodFrequency(multiPeriod) {
    const parts = multiPeriod.split(".");

    if (parts.length < 2) return null;

    const wholeMhz = parseInt(parts[0], 10);
    if (isNaN(wholeMhz)) return null;

    // Concatenate all decimal parts
    let decimalStr = parts.slice(1).join("");

    // Pad to 6 decimal places (1 Hz resolution)
    decimalStr = decimalStr.padEnd(6, "0");

    // Take only first 6 digits
    decimalStr = decimalStr.substring(0, 6);

    const decimalHz = parseInt(decimalStr, 10);
    if (isNaN(decimalHz)) return null;

    return wholeMhz * 1000000 + decimalHz;
}

// ============================================================================
// VFO State Management Functions
// ============================================================================

// Fetch current VFO state from radio and update AppState
// Notifies all registered callbacks if state changed
async function fetchVfoState() {
    if (isLocalhost) return;

    try {
        const [freqResponse, modeResponse] = await Promise.all([
            fetch("/api/v1/frequency"),
            fetch("/api/v1/mode"),
        ]);

        if (!freqResponse.ok || !modeResponse.ok) {
            console.warn("[VFO] Failed to fetch VFO state");
            return;
        }

        const newFrequency = parseInt(await freqResponse.text(), 10);
        const newMode = (await modeResponse.text()).toUpperCase().trim();

        // Check if state changed
        const freqChanged = AppState.vfoFrequencyHz !== newFrequency;
        const modeChanged = AppState.vfoMode !== newMode;

        if (freqChanged || modeChanged) {
            AppState.vfoFrequencyHz = newFrequency;
            AppState.vfoMode = newMode;
            AppState.vfoLastUpdated = Date.now();

            // Notify all subscribers
            AppState.vfoChangeCallbacks.forEach((callback) => {
                try {
                    callback(newFrequency, newMode);
                } catch (error) {
                    console.error("[VFO] Callback error:", error);
                }
            });
        }
    } catch (error) {
        console.warn("[VFO] Error fetching VFO state:", error);
    }
}

// Start global VFO polling (if not already running)
function startGlobalVfoPolling() {
    if (isLocalhost) return;

    if (AppState.vfoUpdateInterval) {
        console.log("[VFO] Polling already active");
        return;
    }

    console.log("[VFO] Starting global VFO polling");

    // Fetch immediately
    fetchVfoState();

    // Start polling interval
    AppState.vfoUpdateInterval = setInterval(fetchVfoState, VFO_POLLING_INTERVAL_MS);
}

// Stop global VFO polling
function stopGlobalVfoPolling() {
    if (AppState.vfoUpdateInterval) {
        console.log("[VFO] Stopping global VFO polling");
        clearInterval(AppState.vfoUpdateInterval);
        AppState.vfoUpdateInterval = null;
    }
}

// Subscribe to VFO changes (callback receives frequency, mode)
function subscribeToVfo(callback) {
    if (!AppState.vfoChangeCallbacks.includes(callback)) {
        AppState.vfoChangeCallbacks.push(callback);
        console.log("[VFO] Subscriber added, total:", AppState.vfoChangeCallbacks.length);
    }
}

// Unsubscribe from VFO changes
function unsubscribeFromVfo(callback) {
    const index = AppState.vfoChangeCallbacks.indexOf(callback);
    if (index > -1) {
        AppState.vfoChangeCallbacks.splice(index, 1);
        console.log("[VFO] Subscriber removed, total:", AppState.vfoChangeCallbacks.length);
    }

    // Stop polling if no more subscribers
    if (AppState.vfoChangeCallbacks.length === 0) {
        stopGlobalVfoPolling();
    }
}

// ============================================================================
// Environment Detection
// ============================================================================

// Check if the page is being served from localhost
const isLocalhost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "[::1]"; // IPv6 loopback

// ============================================================================
// Generic UI Update Functions
// ============================================================================

// Fetch API endpoint and update element with response text (url: string, elementId: string)
async function fetchAndUpdateElement(url, elementId) {
    try {
        const response = await fetch(url);

        if (!response.ok) {
            if (response.status === 404) {
                document.getElementById(elementId).textContent = "";
                return;
            }
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const text = await response.text();
        document.getElementById(elementId).textContent = text;
    } catch (error) {
        document.getElementById(elementId).textContent = "??";
    }
}

// ============================================================================
// Status Bar Functions
// ============================================================================

// Update UTC clock display (HH:MM format)
function refreshUTCClock() {
    // Update the UTC clock, but only show the hours and the minutes and nothing else
    const utcTime = new Date().toUTCString();
    document.getElementById("current-utc-time").textContent = utcTime.slice(17, 22);
}

// Update battery percentage and WiFi signal strength display
function updateBatteryInfo() {
    if (isLocalhost) return;
    fetchAndUpdateElement("/api/v1/batteryPercent", "battery-percent");
    fetchAndUpdateElement("/api/v1/rssi", "wifi-rssi");
}

// Update WiFi connection status display
function updateConnectionStatus() {
    if (isLocalhost) return;
    fetchAndUpdateElement("/api/v1/connectionStatus", "connection-status");
}

// ============================================================================
// Tab Management Functions
// ============================================================================

// Clean up current tab before switching to a new one
function cleanupCurrentTab() {
    if (AppState.currentTabName) {
        // Call onLeaving function if it exists for the current tab
        const tabNameCapitalized = AppState.currentTabName.charAt(0).toUpperCase() + AppState.currentTabName.slice(1);
        const onLeavingFunctionName = `on${tabNameCapitalized}Leaving`;
        if (typeof window[onLeavingFunctionName] === "function") {
            console.log(`Calling ${onLeavingFunctionName} function`);
            window[onLeavingFunctionName]();
        }
    }
}

// Load previously active tab from localStorage (returns tab name string, defaults to 'chase')
function loadActiveTab() {
    const activeTab = localStorage.getItem("activeTab");
    return activeTab ? activeTab : "chase"; // Default to 'chase' if no tab is saved
}

// Save currently active tab to localStorage (tabName: 'chase', 'cat', 'settings', 'about')
function saveActiveTab(tabName) {
    localStorage.setItem("activeTab", tabName.toLowerCase());
}

// Track loaded tab scripts to avoid duplicates
const loadedTabScripts = new Set();

// Load tab-specific JavaScript file if not already loaded (tabName: 'chase', 'cat', 'settings', 'about')
async function loadTabScriptIfNeeded(tabName) {
    const scriptPath = `${tabName}.js`;
    console.log(`Checking if script needs to be loaded: ${scriptPath}`);

    if (loadedTabScripts.has(scriptPath)) {
        // Script already loaded, resolve immediately
        console.log(`Script ${scriptPath} already loaded, skipping`);
        return;
    }

    console.log(`Loading script: ${scriptPath}`);

    try {
        const response = await fetch(scriptPath);

        if (!response.ok) {
            console.warn(`Script ${scriptPath} fetch failed with status: ${response.status}`);
            // If the script doesn't need to be loaded (e.g., not found), resolve the promise
            return;
        }

        // Create script tag and add to document
        return new Promise((resolve, reject) => {
            const scriptTag = document.createElement("script");
            scriptTag.src = scriptPath;
            scriptTag.onload = () => {
                console.log(`Script ${scriptPath} loaded successfully`);
                loadedTabScripts.add(scriptPath);
                resolve();
            };
            scriptTag.onerror = (error) => {
                console.error(`Error loading script ${scriptPath}:`, error);
                reject(error);
            };

            // Add the script to the page
            document.body.appendChild(scriptTag);
        });
    } catch (error) {
        console.error(`Error fetching script ${scriptPath}:`, error);
        throw error;
    }
}

// Switch to a different tab (tabName: 'chase', 'cat', 'settings', 'about')
async function openTab(tabName) {
    console.log(`Switching to tab: ${tabName}`);

    try {
        // Clean up current tab logic
        cleanupCurrentTab();

        // Explicitly remove 'tabActive' class from ALL tab buttons first
        document.querySelectorAll(".tabBar button").forEach((button) => {
            button.classList.remove("tabActive");
        });

        // Set the new current tab name
        AppState.currentTabName = tabName.toLowerCase();
        console.log(`Current tab set to: ${AppState.currentTabName}`);

        // Find and highlight the active tab
        const tabButton = document.getElementById(AppState.currentTabName + "-tab-button");
        if (tabButton) {
            tabButton.classList.add("tabActive");
        } else {
            console.error(`Tab button for ${AppState.currentTabName} not found`);
        }

        // Save the active tab to localStorage
        saveActiveTab(AppState.currentTabName);

        const contentPath = `${AppState.currentTabName}.html`;
        console.log(`Fetching content from: ${contentPath}`);

        const response = await fetch(contentPath);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${contentPath}: ${response.status} ${response.statusText}`);
        }

        const text = await response.text();
        document.getElementById("content-area").innerHTML = text;
        console.log(`Content for ${AppState.currentTabName} loaded`);

        await loadTabScriptIfNeeded(AppState.currentTabName);

        // Once the script is loaded, call the onAppearing function
        const tabNameCapitalized = AppState.currentTabName.charAt(0).toUpperCase() + AppState.currentTabName.slice(1);
        const onAppearingFunctionName = `on${tabNameCapitalized}Appearing`;
        console.log(`Calling ${onAppearingFunctionName} function`);

        if (typeof window[onAppearingFunctionName] === "function") {
            try {
                window[onAppearingFunctionName]();
            } catch (error) {
                console.error(`Error in ${onAppearingFunctionName}:`, error);
                throw error;
            }
        } else {
            console.warn(`Function ${onAppearingFunctionName} not found`);
        }
        console.log(`Tab switch to ${AppState.currentTabName} complete`);
    } catch (error) {
        console.error(`Error during tab switch to ${AppState.currentTabName}:`, error);
        // Attempt recovery by reloading the current tab
        alert(
            `Error switching tabs: ${error.message}\nPlease try once more, or reload the page if the issue persists.`
        );
    }
}

// ============================================================================
// Application Initialization
// ============================================================================

// Initialize the application when DOM is loaded
document.addEventListener("DOMContentLoaded", function () {
    console.log("DOMContentLoaded event fired");

    // Ensure all tab buttons use the same click handler
    document.querySelectorAll(".tabBar button").forEach((button) => {
        button.addEventListener("click", function (event) {
            event.preventDefault();
            const tabName = this.getAttribute("data-tab");
            console.log(`Tab button clicked: ${tabName}`);
            openTab(tabName);
        });
    });

    // Get the active tab from localStorage
    const activeTab = loadActiveTab();
    console.log("Active tab from localStorage:", activeTab);

    // Initialize or open any tab in the UI
    openTab(activeTab);

    // Schedule version check after page loads
    setTimeout(() => {
        console.log("[Version Check] Executing initial version check");
        checkFirmwareVersion().catch((error) => {
            console.log("[Version Check] Initial version check failed:", error);
            // Retry timer will be started automatically by checkFirmwareVersion
        });
    }, INITIAL_VERSION_CHECK_DELAY_MS);
});

// ============================================================================
// Status Bar Update Intervals
// ============================================================================

// UTC Clock - update every 10 seconds
refreshUTCClock();
setInterval(refreshUTCClock, UTC_CLOCK_UPDATE_INTERVAL_MS);

// Battery info - update every 1 minute
updateBatteryInfo();
setInterval(updateBatteryInfo, BATTERY_INFO_UPDATE_INTERVAL_MS);

// Connection status - update every 5 seconds
updateConnectionStatus();
setInterval(updateConnectionStatus, CONNECTION_STATUS_UPDATE_INTERVAL_MS);

// ============================================================================
// Geolocation and Distance Functions
// ============================================================================

// Calculate distance between two points using Haversine formula (returns distance in km)
function calculateDistance(lat1, lon1, lat2, lon2) {
    function toRad(x) {
        return (x * Math.PI) / 180;
    }
    function squared(x) {
        return x * x;
    }

    const R = 6371; // Earth's radius in kilometers
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = squared(Math.sin(dLat / 2)) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * squared(Math.sin(dLon / 2));
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Get user location from GPS override or IP-based geolocation (returns {latitude, longitude})
async function getLocation() {
    // First check if there's a GPS location override from the backend
    if (AppState.gpsOverride) {
        console.log("Using cached GPS location override");
        return AppState.gpsOverride;
    }

    try {
        const response = await fetch("/api/v1/gps");
        const data = await response.json();
        if (data.gps_lat && data.gps_lon) {
            console.log("Using GPS location override from NVRAM");
            AppState.gpsOverride = { latitude: parseFloat(data.gps_lat), longitude: parseFloat(data.gps_lon) };
            return AppState.gpsOverride;
        }
    } catch (error) {
        console.error("Failed to fetch GPS override:", error);
    }

    // Otherwise, use IP-based geolocation
    // Unfortunately, the geolocation API is only available in HTTPS
    //
    //  return new Promise((resolve, reject) => {
    //      navigator.geolocation.getCurrentPosition(position => {
    //          const { latitude, longitude } = position.coords;
    //          resolve({ latitude, longitude });
    //      }, error => {
    //          console.error("Error getting location", error);
    //          reject(error);
    //      });
    //  });
    // So, we'll use a less accurate, but more available alternative
    try {
        // Use fetch API to get location from IP. Note: Ensure CORS policies are handled if calling from the browser.
        const response = await fetch("http://ip-api.com/json/?fields=status,message,lat,lon", {
            mode: "cors", // This might be required for CORS requests if the server supports it.
        });
        const position = await response.json();
        if (response.ok && position.status === "success") {
            // Extract latitude and longitude from the successful response
            const { lat: latitude, lon: longitude } = position;
            return { latitude, longitude };
        } else {
            // Handle error status or unsuccessful fetch operation
            throw new Error(position.message || "Failed to fetch location from IP-API");
        }
    } catch (error) {
        console.error("Error retrieving location: ", error);
        throw error; // Propagate the error to be handled by the caller
    }
}

// Distance cache for reference lookups
const distanceCache = {};

// Clear distance cache (called when GPS location changes)
function clearDistanceCache() {
    // Clear the distance cache to force recalculation with new location
    for (const key in distanceCache) {
        delete distanceCache[key];
    }
    console.log("Distance cache cleared for location change");
}

// ============================================================================
// Firmware Version Checking Functions
// ============================================================================

// Version check configuration constants
const VERSION_CHECK_INTERVAL_DAYS = 1.0;
const VERSION_CHECK_STORAGE_KEY = "sotacat_version_check";
const VERSION_CHECK_SUCCESS_KEY = "sotacat_version_check_success";
const MANIFEST_URL = "https://sotamat.com/wp-content/uploads/manifest.json";
const VERSION_CHECK_TIMEOUT_MS = 5000;
const VERSION_CHECK_RETRY_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// Start retry timer for failed version checks
function startVersionCheckRetryTimer() {
    // Clear any existing timer
    if (AppState.versionCheckRetryTimer) {
        clearInterval(AppState.versionCheckRetryTimer);
    }

    console.log("[Version Check] Starting retry timer (will retry every 15 minutes)");
    AppState.versionCheckRetryTimer = setInterval(async () => {
        console.log("[Version Check] Retry timer triggered - attempting version check");
        try {
            await checkFirmwareVersion(false); // false = automatic check
            // If we get here, the check succeeded, so stop retrying
            stopVersionCheckRetryTimer();
        } catch (error) {
            console.log("[Version Check] Retry failed:", error.message);
            // Keep retrying
        }
    }, VERSION_CHECK_RETRY_INTERVAL_MS);
}

// Stop retry timer
function stopVersionCheckRetryTimer() {
    if (AppState.versionCheckRetryTimer) {
        console.log("[Version Check] Stopping retry timer");
        clearInterval(AppState.versionCheckRetryTimer);
        AppState.versionCheckRetryTimer = null;
    }
}

// Parse version string to Unix timestamp (returns seconds since epoch, or null on failure)
function normalizeVersion(versionString) {
    console.log("[Version Check] Parsing version string:", versionString);

    // Extract date and time components from version string
    let match;
    if (versionString.includes("-Release")) {
        // Handle manifest format (e.g., "2024-11-29_11:37-Release")
        match = versionString.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2}):(\d{2})/);
        console.log("[Version Check] Manifest format detected, match:", match);
    } else if (versionString.includes(":")) {
        // Handle device format (e.g., "AB6D_1:241129:2346-R")
        const parts = versionString.split(":");
        match = parts[1].match(/(\d{2})(\d{2})(\d{2})/);
        if (match && parts[2]) {
            const timeMatch = parts[2].match(/(\d{2})(\d{2})/);
            if (timeMatch) {
                match = [...match, timeMatch[1], timeMatch[2]];
            }
        }
        console.log("[Version Check] Device format detected, match:", match);
    }

    if (!match) {
        console.log("[Version Check] Failed to match version pattern");
        return null;
    }

    let year, month, day, hour, minute;

    if (versionString.includes("-Release")) {
        // Manifest format parsing
        year = parseInt(match[1], 10);
        month = parseInt(match[2], 10);
        day = parseInt(match[3], 10);
        hour = parseInt(match[4], 10);
        minute = parseInt(match[5], 10);
    } else {
        // Device format parsing
        year = 2000 + parseInt(match[1], 10);
        month = parseInt(match[2], 10);
        day = parseInt(match[3], 10);
        hour = parseInt(match[4] || "0", 10);
        minute = parseInt(match[5] || "0", 10);
    }

    // Adjust month after parsing (JS months are 0-based)
    const originalMonth = month; // Save for logging
    month = month - 1;

    console.log("[Version Check] Parsed components:", {
        year,
        originalMonth,
        day,
        hour,
        minute,
    });

    const date = new Date(Date.UTC(year, month, day, hour, minute));
    const timestamp = date.getTime() / 1000;

    console.log("[Version Check] Resulting timestamp:", timestamp, "Date:", date.toISOString());

    return timestamp;
}

// Check if enough time has passed since last version check (returns boolean)
function shouldCheckVersion() {
    const lastCheck = localStorage.getItem(VERSION_CHECK_STORAGE_KEY);
    console.log("[Version Check] Last check timestamp:", lastCheck);
    if (!lastCheck) {
        console.log("[Version Check] No previous check found, returning true");
        return true;
    }

    const lastCheckDate = new Date(parseInt(lastCheck, 10));
    const now = new Date();
    const daysSinceLastCheck = (now - lastCheckDate) / (1000 * 60 * 60 * 24);

    console.log("[Version Check] Days since last check:", daysSinceLastCheck);
    console.log("[Version Check] Check interval:", VERSION_CHECK_INTERVAL_DAYS);
    const shouldCheck = daysSinceLastCheck >= VERSION_CHECK_INTERVAL_DAYS;
    console.log("[Version Check] Should check?", shouldCheck);
    return shouldCheck;
}

// Perform version check (manualCheck: boolean - true for user-initiated, false for automatic)
async function checkFirmwareVersion(manualCheck = false) {
    console.log("[Version Check] Starting version check");
    if (!manualCheck && !shouldCheckVersion()) {
        console.log("[Version Check] Skipping check due to interval");
        return;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), VERSION_CHECK_TIMEOUT_MS);

        // Get current version from device
        console.log("[Version Check] Fetching current version from device");
        const response = await fetch("/api/v1/version", {
            signal: controller.signal,
        });
        if (!response.ok) {
            const error = `Failed to get current version from device (HTTP ${response.status})`;
            console.warn("[Version Check]", error);
            if (manualCheck) {
                throw new Error(error);
            }
            return;
        }
        const currentVersion = await response.text();
        console.log("[Version Check] Current device version:", currentVersion);
        const currentBuildTime = normalizeVersion(currentVersion);
        if (!currentBuildTime) {
            const error = `Failed to parse current version format: ${currentVersion}`;
            console.error("[Version Check]", error);
            if (manualCheck) {
                throw new Error(error);
            }
            return;
        }

        // Fetch manifest (CORS required to read response body)
        // Add timestamp to URL to bypass cache
        const cacheBustUrl = `${MANIFEST_URL}?t=${Date.now()}`;
        console.log("[Version Check] Fetching manifest from:", cacheBustUrl);
        let manifestResponse;
        try {
            manifestResponse = await fetch(cacheBustUrl, {
                signal: controller.signal,
                mode: "cors",
                headers: {
                    Accept: "application/json",
                },
            });
        } catch (fetchError) {
            const error = `Failed to fetch manifest from server: ${fetchError.message}`;
            console.warn("[Version Check]", error);
            if (manualCheck) {
                throw new Error(error);
            }
            return;
        }

        if (!manifestResponse.ok) {
            const error = `Failed to fetch manifest from server (HTTP ${manifestResponse.status})`;
            console.warn("[Version Check]", error);
            if (manualCheck) {
                throw new Error(error);
            }
            return;
        }

        let manifest;
        try {
            manifest = await manifestResponse.json();
        } catch (e) {
            const error = `Invalid JSON in manifest: ${e.message}`;
            console.warn("[Version Check]", error);
            if (manualCheck) {
                throw new Error(error);
            }
            return;
        }

        // Clear the timeout since we got our response
        clearTimeout(timeoutId);

        const latestVersion = normalizeVersion(manifest.version);
        if (!latestVersion) {
            const error = `Invalid version format in manifest: ${manifest.version}`;
            console.warn("[Version Check]", error);
            if (manualCheck) {
                throw new Error(error);
            }
            return;
        }

        // Compare versions using Unix timestamps
        console.info("[Version Check] Latest version timestamp:", new Date(latestVersion * 1000).toISOString());
        console.info("[Version Check] Current version timestamp:", new Date(currentBuildTime * 1000).toISOString());

        // Handle different cases for manual vs automatic checks
        let shouldUpdateTimestamp = false;

        if (manualCheck) {
            // Manual check - always show popup with version strings and update timestamp
            shouldUpdateTimestamp = true;

            if (latestVersion > currentBuildTime) {
                return `A new firmware is available: please update using instructions on the Settings page.\n\nYour version:\n${new Date(currentBuildTime * 1000).toISOString()}\nServer version:\n${new Date(latestVersion * 1000).toISOString()}`;
            } else if (latestVersion < currentBuildTime) {
                return `Your firmware is newer than the official version on the server.\n\nYour version:\n${new Date(currentBuildTime * 1000).toISOString()}\nServer version:\n${new Date(latestVersion * 1000).toISOString()}`;
            } else {
                return `You already have the current firmware. No update needed.\n\nYour version:\n${new Date(currentBuildTime * 1000).toISOString()}\nServer version:\n${new Date(latestVersion * 1000).toISOString()}`;
            }
        } else {
            // Automatic check - only show popup if firmware is different
            if (latestVersion > currentBuildTime) {
                // Newer firmware available - show dialog
                const userResponse = confirm(
                    `A new firmware version is available for your SOTAcat device.\n\n` +
                        `Would you like to go to the Settings page to update your firmware?\n\n` +
                        `Your version: ${new Date(currentBuildTime * 1000).toISOString()}\n` +
                        `New version: ${new Date(latestVersion * 1000).toISOString()}`
                );

                if (userResponse) {
                    openTab("Settings");
                    // User accepted - update timestamp so we don't bug them again today
                    shouldUpdateTimestamp = true;
                } else {
                    // User dismissed - don't update timestamp so we'll notify again tomorrow
                    console.log("[Version Check] User dismissed update notification - will retry tomorrow");
                }
            } else {
                // No update needed - update timestamp
                shouldUpdateTimestamp = true;
            }
        }

        // Only update timestamp if appropriate
        if (shouldUpdateTimestamp) {
            localStorage.setItem(VERSION_CHECK_STORAGE_KEY, Date.now().toString());
            console.log("[Version Check] Updated last check timestamp");
        }

        // Always track successful completion (even if we don't update the check timestamp)
        localStorage.setItem(VERSION_CHECK_SUCCESS_KEY, Date.now().toString());
        console.log("[Version Check] Version check completed successfully");

        // Stop retry timer on successful check
        stopVersionCheckRetryTimer();
    } catch (error) {
        console.log("[Version Check] Error during version check:", error.message);

        // Start retry timer for failed automatic checks
        if (!manualCheck) {
            startVersionCheckRetryTimer();
        }

        throw error; // Re-throw to be caught by the caller
    }
}
