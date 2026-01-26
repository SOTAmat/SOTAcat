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
// Connection Loss Detection Constants
// ============================================================================

const DISCONNECT_THRESHOLD = 3;        // failures before showing overlay
const RECONNECT_RETRY_MS = 3000;       // retry interval when disconnected
const GIVE_UP_THRESHOLD_MS = 30000;    // show "find device" after this

// Fetch timeouts (must be less than their polling intervals)
const CONNECTION_STATUS_TIMEOUT_MS = 3000;  // < 5 sec polling interval
const BATTERY_INFO_TIMEOUT_MS = 30000;      // < 60 sec polling interval
const VFO_TIMEOUT_MS = 2000;                // < 3 sec polling interval

// ============================================================================
// Frequency Constants
// ============================================================================

const LSB_USB_BOUNDARY_HZ = 10000000; // 10 MHz - below is LSB, above is USB
const DEFAULT_FREQUENCY_HZ = 14225000; // 20m band - fallback when VFO state unknown
const HF_MIN_FREQUENCY_HZ = 1800000;  // 160m band lower edge (1.8 MHz)
const HF_MAX_FREQUENCY_HZ = 29700000; // 10m band upper edge (29.7 MHz) - KX2 limit
// const HF_MAX_FREQUENCY_HZ = 54000000; // 6m band upper edge (54 MHz) - KX3 limit

// ============================================================================
// Reference Patterns (used by qrx.js and run.js)
// ============================================================================

const SOTA_REF_PATTERN = /^[A-Z0-9]{1,4}\/[A-Z]{2}-\d{3}$/;  // W6/NC-298
const POTA_REF_PATTERN = /^[A-Z]{1,2}-\d{4,5}$/;             // US-1234
const WWFF_REF_PATTERN = /^[A-Z]{2,4}FF-\d{4}$/;             // VKFF-0001
const IOTA_REF_PATTERN = /^(AF|AN|AS|EU|NA|OC|SA)-\d{3}$/;   // EU-123

// ============================================================================
// Polling Control
// ============================================================================
// Prevent request pile-up during tab transitions and slow network conditions

let pollingPaused = false; // Pause all polling during tab switches
let connectionStatusController = null; // AbortController for connection status requests
let batteryController = null; // AbortController for battery/rssi requests
let vfoController = null; // AbortController for VFO (frequency/mode) requests

// ============================================================================
// Logging Utilities
// ============================================================================
// Unified logging with consistent context prefixes

const Log = {
    debug: (ctx, ...args) => console.log(`[${ctx}]`, ...args),
    info: (ctx, ...args) => console.log(`[${ctx}]`, ...args),
    warn: (ctx, ...args) => console.warn(`[${ctx}]`, ...args),
    error: (ctx, ...args) => console.error(`[${ctx}]`, ...args),
};

// Fire-and-forget fetch for commands that don't need response handling
function fetchQuiet(url, options = {}, context = "Fetch") {
    return fetch(url, options).catch((err) => Log.error(context, url, err.message));
}

// ============================================================================
// Global Application State
// ============================================================================

const AppState = {
    // Data caches
    latestChaseJson: null,

    // Tab management
    currentTabName: null,

    // Connection loss detection
    connectionState: 'connected',  // 'connected' | 'reconnecting' | 'disconnected'
    consecutiveFailures: 0,
    lastSuccessfulPoll: Date.now(),

    // Location
    gpsOverride: null,

    // User settings
    callSign: "",
    licenseClass: null,  // null = not loaded, "" = loaded but not set

    // Radio info
    radioType: null,           // "KX2", "KX3", or "Unknown"
    filterBandsEnabled: false, // Filter chase spots to radio-supported bands

    // Version checking
    versionCheckRetryTimer: null,

    // VFO state (shared between CAT and Chase pages)
    vfoFrequencyHz: null,   // null = unknown/not connected
    vfoMode: null,
    vfoLastUpdated: 0,
    vfoUpdateInterval: null,
    vfoChangeCallbacks: [], // subscribers for VFO change notifications

    // Tune targets (WebSDR, KiwiSDR URLs)
    tuneTargets: null,         // null = not loaded, [] = loaded but empty
    tuneTargetsMobile: false,
    tuneTargetWindows: [],     // references to opened windows

    // Transmit state (shared between Spot and Chase pages)
    isXmitActive: false,
};

// ============================================================================
// User Settings Functions
// ============================================================================

// Normalize tune targets from API response (handles both old string[] and new object[] formats)
function normalizeTuneTargets(targets) {
    if (!targets || !Array.isArray(targets)) return [];

    return targets.map((item) => {
        if (typeof item === "string") {
            // Old format: convert string to object, default enabled=true
            return { url: item, enabled: true };
        } else if (typeof item === "object" && item !== null) {
            // New format: ensure both fields exist
            return {
                url: item.url || "",
                enabled: item.enabled !== false, // default to true if not specified
            };
        }
        return { url: "", enabled: true };
    });
}

// Load tune targets into AppState - called at app startup for Safari compatibility
// IMPORTANT: Must be called early so openTuneTargets can be synchronous
// Falls back to localStorage cache when hardware API is unavailable (e.g., local dev)
async function loadTuneTargetsAsync() {
    try {
        const response = await fetch("/api/v1/tuneTargets");
        if (response.ok) {
            const data = await response.json();
            AppState.tuneTargets = normalizeTuneTargets(data.targets);
            AppState.tuneTargetsMobile = data.mobile || false;
            // Cache to localStorage for offline/local dev use
            saveTuneTargetsToLocalStorage(AppState.tuneTargets, AppState.tuneTargetsMobile);
            Log.debug("App", "Tune targets loaded from API:", AppState.tuneTargets.length);
        } else {
            // API returned error - fall back to localStorage
            loadTuneTargetsFromLocalStorage();
        }
    } catch (error) {
        Log.warn("App", "Failed to load tune targets from API:", error);
        // Fall back to localStorage cache
        loadTuneTargetsFromLocalStorage();
    }
}

// Save tune targets to localStorage for offline/local dev use
function saveTuneTargetsToLocalStorage(targets, mobile) {
    try {
        localStorage.setItem("tuneTargets", JSON.stringify(targets));
        localStorage.setItem("tuneTargetsMobile", mobile.toString());
    } catch (error) {
        Log.warn("App", "Failed to cache tune targets to localStorage:", error);
    }
}

// Load tune targets from localStorage cache
function loadTuneTargetsFromLocalStorage() {
    try {
        const cached = localStorage.getItem("tuneTargets");
        const cachedMobile = localStorage.getItem("tuneTargetsMobile");
        if (cached) {
            AppState.tuneTargets = normalizeTuneTargets(JSON.parse(cached));
            AppState.tuneTargetsMobile = cachedMobile === "true";
            Log.debug("App", "Tune targets loaded from localStorage cache:", AppState.tuneTargets.length);
        } else {
            AppState.tuneTargets = [];
            AppState.tuneTargetsMobile = false;
            Log.debug("App", "No cached tune targets in localStorage");
        }
    } catch (error) {
        Log.warn("App", "Failed to load tune targets from localStorage:", error);
        AppState.tuneTargets = [];
        AppState.tuneTargetsMobile = false;
    }
}

// Check if we're running on a mobile browser
function isMobileBrowser() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// Open tune target URLs with frequency and mode substitution
// Called when tuning the radio to also open WebSDR/KiwiSDR tabs
// IMPORTANT: This function is SYNCHRONOUS to preserve user gesture for Safari popup blocker
function openTuneTargets(frequencyHz, mode) {
    // If targets not loaded yet, skip (they load at app startup)
    if (!AppState.tuneTargets || AppState.tuneTargets.length === 0) {
        return; // No tune targets configured or not loaded yet
    }

    // Check mobile permission
    if (isMobileBrowser() && !AppState.tuneTargetsMobile) {
        Log.debug("App", "Tune targets blocked: mobile browser and mobile access not enabled");
        return;
    }

    // Calculate frequency in different units
    const frequencyKHz = frequencyHz / 1000;
    const frequencyMHz = frequencyHz / 1000000;
    const modeLower = mode.toLowerCase();

    // Open each ENABLED target URL
    AppState.tuneTargets.forEach((target, index) => {
        // Skip disabled targets or empty URLs
        if (!target.enabled || !target.url || target.url.trim() === "") {
            return;
        }

        // Substitute placeholders (using {} delimiters to match N1MM logger)
        let finalUrl = target.url;
        finalUrl = finalUrl.replace(/\{FREQ-HZ\}/gi, frequencyHz);
        finalUrl = finalUrl.replace(/\{FREQ-KHZ\}/gi, frequencyKHz);
        finalUrl = finalUrl.replace(/\{FREQ-MHZ\}/gi, frequencyMHz);
        finalUrl = finalUrl.replace(/\{MODE\}/gi, modeLower);

        // Get or create window for this target
        const windowName = `_sotacat_tune_${index}`;

        try {
            // Check if we have an existing window reference that's still open
            if (AppState.tuneTargetWindows[index] && !AppState.tuneTargetWindows[index].closed) {
                // Try to navigate existing window - may fail cross-origin on Safari
                try {
                    AppState.tuneTargetWindows[index].location.href = finalUrl;
                    Log.debug("App", `Navigating tune target ${index} to:`, finalUrl);
                } catch (navError) {
                    // Cross-origin navigation blocked - open fresh
                    Log.debug("App", `Tune target ${index} cross-origin, opening fresh`);
                    AppState.tuneTargetWindows[index] = window.open(finalUrl, windowName);
                }
            } else {
                // Open new window
                AppState.tuneTargetWindows[index] = window.open(finalUrl, windowName);
                Log.debug("App", `Opened tune target ${index}:`, finalUrl);
            }
        } catch (error) {
            // Popup blocked or other error
            Log.warn("App", `Tune target ${index} error:`, error.message);
        }
    });
}

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
        Log.warn("App", "Failed to load callsign:", error);
    }
    return AppState.callSign;
}

// Load user license class into AppState if not already loaded
// Returns the license class (or empty string if not set)
async function ensureLicenseClassLoaded() {
    if (AppState.licenseClass !== null) {
        return AppState.licenseClass;
    }
    try {
        const response = await fetch("/api/v1/license");
        const data = await response.json();
        AppState.licenseClass = (data.license || "").toUpperCase();
    } catch (error) {
        Log.warn("App", "Failed to load license class:", error);
        AppState.licenseClass = "";
    }
    return AppState.licenseClass;
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

// Radio band capabilities for filtering chase spots
// KX2/KX3 both cover the same HF bands plus 6m
// null = show all bands (no filtering)
const RADIO_BAND_CAPABILITIES = {
    "KX2": ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m"],
    "KX3": ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m"],
    "Unknown": null  // null = show all bands (no filtering)
};

// Get list of bands a radio can access (returns array or null for all bands)
function getRadioBandCapabilities(radioType) {
    return RADIO_BAND_CAPABILITIES[radioType] || null;
}

// Load radio type from device into AppState
async function loadRadioType() {
    try {
        const response = await fetch("/api/v1/radioType");
        if (response.ok) {
            AppState.radioType = await response.text();
            Log.debug("App", "Radio type loaded:", AppState.radioType);
        }
    } catch (error) {
        Log.warn("App", "Failed to load radio type:", error);
        AppState.radioType = "Unknown";
    }
}

// Load filter bands setting from localStorage
function loadFilterBandsSetting() {
    const saved = localStorage.getItem("sotacat_filter_bands");
    AppState.filterBandsEnabled = saved === "true";
    return AppState.filterBandsEnabled;
}

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
// Ham2K Polo Deep Link Utilities (shared across CAT and Chase pages)
// ============================================================================

// Map SOTAcat mode to Polo-compatible mode string
function mapModeForPolo(mode) {
    if (!mode) return null;
    const upperMode = mode.toUpperCase();
    // Map USB/LSB to SSB for Polo
    if (upperMode === "USB" || upperMode === "LSB") return "SSB";
    // CW modes
    if (upperMode === "CW" || upperMode === "CW_R") return "CW";
    // Pass through standard modes
    if (["FM", "AM", "DATA", "FT8", "FT4"].includes(upperMode)) return upperMode;
    return upperMode; // Default: pass through as-is
}

// Build Ham2K Polo deep link URL from parameters
// All parameters are optional - only non-null/non-empty values are included
// Parameters: myRef, mySig, myCall, theirRef, theirSig, theirCall, freq, mode, time
function buildPoloDeepLink(params) {
    const baseUrl = "com.ham2k.polo://qso";
    const validParams = [
        "myRef",
        "mySig",
        "myCall",
        "theirRef",
        "theirSig",
        "theirCall",
        "freq",
        "mode",
        "time",
    ];

    const queryParts = [];
    for (const key of validParams) {
        const value = params[key];
        if (value !== null && value !== undefined && value !== "") {
            queryParts.push(`${key}=${encodeURIComponent(value)}`);
        }
    }

    if (queryParts.length === 0) return null;
    return `${baseUrl}?${queryParts.join("&")}`;
}

// ============================================================================
// Transmit Control Functions
// ============================================================================

// Send transmit state change request to radio (state: 0=RX, 1=TX)
function sendXmitRequest(state) {
    const url = `/api/v1/xmit?state=${state}`;
    fetchQuiet(url, { method: "PUT" }, "Xmit");
}

// Toggle transmit state on/off (shared between Spot and Chase pages)
function toggleXmit() {
    const xmitButton = document.getElementById("xmit-button");
    AppState.isXmitActive = !AppState.isXmitActive;

    if (AppState.isXmitActive) {
        if (xmitButton) xmitButton.classList.add("active");
        sendXmitRequest(1);
    } else {
        if (xmitButton) xmitButton.classList.remove("active");
        sendXmitRequest(0);
    }
}

// Sync xmit button UI with current state (call on page appearing)
function syncXmitButtonState() {
    const xmitButton = document.getElementById("xmit-button");
    if (xmitButton) {
        if (AppState.isXmitActive) {
            xmitButton.classList.add("active");
        } else {
            xmitButton.classList.remove("active");
        }
    }
}

// ============================================================================
// VFO State Management Functions
// ============================================================================

// Fetch current VFO state from radio and update AppState
// Notifies all registered callbacks if state changed
async function fetchVfoState() {
    if (isLocalhost) return;
    if (pollingPaused) return;
    if (vfoController) return; // Skip if previous request still in-flight

    vfoController = new AbortController();
    const timeoutId = setTimeout(() => vfoController.abort(), VFO_TIMEOUT_MS);
    try {
        const [freqResponse, modeResponse] = await Promise.all([
            fetch("/api/v1/frequency", { signal: vfoController.signal }),
            fetch("/api/v1/mode", { signal: vfoController.signal }),
        ]);

        if (!freqResponse.ok || !modeResponse.ok) {
            Log.warn("VFO", "Failed to fetch VFO state");
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
                    Log.error("VFO", "Callback error:", error);
                }
            });
        }
    } catch (error) {
        if (error.name === "AbortError" && pollingPaused) return; // Expected when polling paused
        Log.warn("VFO", "Error fetching VFO state:", error);
    } finally {
        clearTimeout(timeoutId);
        vfoController = null;
    }
}

// Start global VFO polling (if not already running)
function startGlobalVfoPolling() {
    if (isLocalhost) return;

    if (AppState.vfoUpdateInterval) {
        Log.debug("VFO", "Polling already active");
        return;
    }

    Log.debug("VFO", "Starting global VFO polling");

    // Fetch immediately
    fetchVfoState();

    // Start polling interval
    AppState.vfoUpdateInterval = setInterval(fetchVfoState, VFO_POLLING_INTERVAL_MS);
}

// Stop global VFO polling
function stopGlobalVfoPolling() {
    if (AppState.vfoUpdateInterval) {
        Log.debug("VFO", "Stopping global VFO polling");
        clearInterval(AppState.vfoUpdateInterval);
        AppState.vfoUpdateInterval = null;
    }
}

// Subscribe to VFO changes (callback receives frequency, mode)
function subscribeToVfo(callback) {
    if (!AppState.vfoChangeCallbacks.includes(callback)) {
        AppState.vfoChangeCallbacks.push(callback);
        Log.debug("VFO", "Subscriber added, total:", AppState.vfoChangeCallbacks.length);
    }
}

// Unsubscribe from VFO changes
function unsubscribeFromVfo(callback) {
    const index = AppState.vfoChangeCallbacks.indexOf(callback);
    if (index > -1) {
        AppState.vfoChangeCallbacks.splice(index, 1);
        Log.debug("VFO", "Subscriber removed, total:", AppState.vfoChangeCallbacks.length);
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
    const element = document.getElementById(elementId);
    if (!element) {
        Log.warn("App", `Element not found: ${elementId}`);
        return;
    }

    try {
        const response = await fetch(url);

        if (!response.ok) {
            if (response.status === 404) {
                element.textContent = "";
                return;
            }
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const text = await response.text();
        element.textContent = text;
    } catch (error) {
        element.textContent = "??";
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

// Format battery time remaining in a compact format
function formatBatteryTime(hours, type) {
    if (!hours || hours <= 0) return "";
    const arrow = type === "full" ? "\u2191" : "\u2193"; // ↑ or ↓
    if (hours > 99) return `${arrow}99+`;
    const totalMins = Math.round(hours * 60);
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    const str = h > 0 ? `${h}h${m > 0 ? m + "m" : ""}` : `${m}m`;
    return `${arrow}${str}`;
}

// Update battery percentage and WiFi signal strength display
async function updateBatteryInfo() {
    if (isLocalhost) return;
    if (pollingPaused) return;
    if (batteryController) return; // Skip if previous request still in-flight

    batteryController = new AbortController();
    const timeoutId = setTimeout(() => batteryController.abort(), BATTERY_INFO_TIMEOUT_MS);
    try {
        const [batteryInfoResponse, rssiResponse] = await Promise.all([
            fetch("/api/v1/batteryInfo", { signal: batteryController.signal }),
            fetch("/api/v1/rssi", { signal: batteryController.signal }),
        ]);

        if (batteryInfoResponse.ok) {
            const info = await batteryInfoResponse.json();
            document.getElementById("battery-percent").textContent =
                Math.round(info.state_of_charge_pct);
            document.getElementById("battery-icon").textContent =
                info.charging ? " \u26A1 " : " \uD83D\uDD0B ";

            // Time display for smart batteries
            const timeEl = document.getElementById("battery-time");
            if (timeEl) {
                if (info.is_smart && info.charging && info.time_to_full_hrs > 0) {
                    timeEl.textContent = formatBatteryTime(info.time_to_full_hrs, "full");
                } else if (info.is_smart && !info.charging && info.time_to_empty_hrs > 0) {
                    timeEl.textContent = formatBatteryTime(info.time_to_empty_hrs, "empty");
                } else {
                    timeEl.textContent = "";
                }
            }
        }
        if (rssiResponse.ok) {
            document.getElementById("wifi-rssi").textContent = await rssiResponse.text();
        }
    } catch (error) {
        if (error.name === "AbortError" && pollingPaused) return;
        document.getElementById("battery-percent").textContent = "??";
        document.getElementById("wifi-rssi").textContent = "??";
        const timeEl = document.getElementById("battery-time");
        if (timeEl) timeEl.textContent = "";
    } finally {
        clearTimeout(timeoutId);
        batteryController = null;
    }
}

// Update WiFi connection status display
async function updateConnectionStatus() {
    if (isLocalhost) return;
    if (pollingPaused) return;
    if (connectionStatusController) return; // Skip if previous request still in-flight

    connectionStatusController = new AbortController();
    const timeoutId = setTimeout(() => connectionStatusController.abort(), CONNECTION_STATUS_TIMEOUT_MS);
    try {
        const response = await fetch("/api/v1/connectionStatus", {
            signal: connectionStatusController.signal,
        });

        if (response.ok) {
            // Success - reset failure tracking
            AppState.consecutiveFailures = 0;
            AppState.lastSuccessfulPoll = Date.now();
            if (AppState.connectionState !== 'connected') {
                setConnectionState('connected');
            }
            document.getElementById("connection-status").textContent = await response.text();
        } else {
            handlePollFailure();
            document.getElementById("connection-status").textContent = "??";
        }
    } catch (error) {
        // Timeout aborts should still count as failures; only skip for polling pauses
        if (error.name === "AbortError" && pollingPaused) return;
        handlePollFailure();
        document.getElementById("connection-status").textContent = "??";
    } finally {
        clearTimeout(timeoutId);
        connectionStatusController = null;
    }
}

// Handle connection poll failure - track consecutive failures and update connection state
function handlePollFailure() {
    AppState.consecutiveFailures++;
    if (AppState.consecutiveFailures >= DISCONNECT_THRESHOLD) {
        if (AppState.connectionState === 'connected') {
            setConnectionState('reconnecting');
        }
        const elapsed = Date.now() - AppState.lastSuccessfulPoll;
        if (elapsed > GIVE_UP_THRESHOLD_MS && AppState.connectionState === 'reconnecting') {
            setConnectionState('disconnected');
        }
    }
}

// Update connection state and refresh overlay UI
function setConnectionState(newState) {
    Log.debug("Connection", `State: ${AppState.connectionState} -> ${newState}`);
    AppState.connectionState = newState;
    updateConnectionOverlay();
}

// Update the connection overlay based on current connection state
function updateConnectionOverlay() {
    const overlay = document.getElementById('connection-overlay');
    const reconnecting = document.getElementById('overlay-reconnecting');
    const disconnected = document.getElementById('overlay-disconnected');

    if (!overlay) return;

    switch (AppState.connectionState) {
        case 'connected':
            overlay.classList.add('hidden');
            break;
        case 'reconnecting':
            overlay.classList.remove('hidden');
            reconnecting.classList.remove('hidden');
            disconnected.classList.add('hidden');
            break;
        case 'disconnected':
            overlay.classList.remove('hidden');
            reconnecting.classList.add('hidden');
            disconnected.classList.remove('hidden');
            break;
    }
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
            Log.debug("Tab", `Calling ${onLeavingFunctionName}`);
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
    Log.debug("Script", `Checking: ${scriptPath}`);

    if (loadedTabScripts.has(scriptPath)) {
        // Script already loaded, resolve immediately
        Log.debug("Script", `Already loaded: ${scriptPath}`);
        return;
    }

    Log.debug("Script", `Loading: ${scriptPath}`);

    try {
        const response = await fetch(scriptPath);

        if (!response.ok) {
            Log.warn("Script", `Fetch failed: ${scriptPath} (${response.status})`);
            // If the script doesn't need to be loaded (e.g., not found), resolve the promise
            return;
        }

        // Create script tag and add to document
        return new Promise((resolve, reject) => {
            const scriptTag = document.createElement("script");
            scriptTag.src = scriptPath;
            scriptTag.onload = () => {
                Log.debug("Script", `Loaded: ${scriptPath}`);
                loadedTabScripts.add(scriptPath);
                resolve();
            };
            scriptTag.onerror = (error) => {
                Log.error("Script", `Load error: ${scriptPath}`, error);
                reject(error);
            };

            // Add the script to the page
            document.body.appendChild(scriptTag);
        });
    } catch (error) {
        Log.error("Script", `Fetch error: ${scriptPath}`, error);
        throw error;
    }
}

// Switch to a different tab (tabName: 'chase', 'cat', 'settings', 'about')
async function openTab(tabName) {
    Log.debug("Tab", `Switching to: ${tabName}`);

    // Pause polling during tab transition to prioritize page load
    pollingPaused = true;

    try {
        // Clean up current tab logic
        cleanupCurrentTab();

        // Explicitly remove 'tabActive' class from ALL tab buttons first
        document.querySelectorAll(".tabBar button").forEach((button) => {
            button.classList.remove("tabActive");
        });

        // Set the new current tab name
        AppState.currentTabName = tabName.toLowerCase();
        Log.debug("Tab", `Current tab: ${AppState.currentTabName}`);

        // Find and highlight the active tab
        const tabButton = document.getElementById(AppState.currentTabName + "-tab-button");
        if (tabButton) {
            tabButton.classList.add("tabActive");
        } else {
            Log.error("Tab", `Button not found: ${AppState.currentTabName}`);
        }

        // Save the active tab to localStorage
        saveActiveTab(AppState.currentTabName);

        const contentPath = `${AppState.currentTabName}.html`;
        Log.debug("Tab", `Fetching: ${contentPath}`);

        const response = await fetch(contentPath);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${contentPath}: ${response.status} ${response.statusText}`);
        }

        const text = await response.text();
        document.getElementById("content-area").innerHTML = text;
        Log.debug("Tab", `Content loaded: ${AppState.currentTabName}`);

        await loadTabScriptIfNeeded(AppState.currentTabName);

        // Once the script is loaded, call the onAppearing function
        const tabNameCapitalized = AppState.currentTabName.charAt(0).toUpperCase() + AppState.currentTabName.slice(1);
        const onAppearingFunctionName = `on${tabNameCapitalized}Appearing`;
        Log.debug("Tab", `Calling ${onAppearingFunctionName}`);

        if (typeof window[onAppearingFunctionName] === "function") {
            try {
                window[onAppearingFunctionName]();
            } catch (error) {
                Log.error("Tab", `Error in ${onAppearingFunctionName}:`, error);
                throw error;
            }
        } else {
            Log.warn("Tab", `Function not found: ${onAppearingFunctionName}`);
        }
        Log.debug("Tab", `Switch complete: ${AppState.currentTabName}`);
    } catch (error) {
        Log.error("Tab", `Switch failed: ${AppState.currentTabName}`, error);
        // Attempt recovery by reloading the current tab
        alert(
            `Error switching tabs: ${error.message}\nPlease try once more, or reload the page if the issue persists.`
        );
    } finally {
        // Resume polling after tab transition completes (or fails)
        pollingPaused = false;
    }
}

// ============================================================================
// Application Initialization
// ============================================================================

// Initialize the application when DOM is loaded
document.addEventListener("DOMContentLoaded", function () {
    Log.debug("App", "DOMContentLoaded");

    // Process any geolocation callback parameters from HTTPS bridge redirect
    processGeolocationCallback();

    // Preload tune targets at startup (required for Safari popup blocker compatibility)
    // This must happen early so openTuneTargets() can be synchronous
    loadTuneTargetsAsync();

    // Ensure all tab buttons use the same click handler
    document.querySelectorAll(".tabBar button").forEach((button) => {
        button.addEventListener("click", function (event) {
            event.preventDefault();
            const tabName = this.getAttribute("data-tab");
            Log.debug("Tab", `Button clicked: ${tabName}`);
            openTab(tabName);
        });
    });

    // Get the active tab from localStorage
    const activeTab = loadActiveTab();
    Log.debug("App", "Active tab from storage:", activeTab);

    // Initialize or open any tab in the UI
    openTab(activeTab);

    // Schedule version check after page loads
    setTimeout(() => {
        Log.debug("Version", "Executing initial check");
        checkFirmwareVersion().catch((error) => {
            Log.warn("Version", "Initial check failed:", error);
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
// Geolocation Bridge Callback Handling
// ============================================================================

// Process incoming geolocation parameters from HTTPS bridge redirect
function processGeolocationCallback() {
    const params = new URLSearchParams(window.location.search);

    // Check for successful geolocation
    const geoLat = params.get("geo_lat");
    const geoLon = params.get("geo_lon");
    const geoAccuracy = params.get("geo_accuracy");

    if (geoLat && geoLon) {
        Log.info("GPS", `Received location from bridge: ${geoLat}, ${geoLon} (accuracy: ${geoAccuracy}m)`);
        saveGeolocationFromBridge(geoLat, geoLon, geoAccuracy);
        cleanUrlParams();
        return true;
    }

    // Check for geolocation error
    const geoError = params.get("geo_error");
    const geoMessage = params.get("geo_message");

    if (geoError) {
        Log.warn("GPS", `Geolocation bridge error: ${geoError} - ${geoMessage}`);
        if (geoError !== "cancelled") {
            alert(`Could not get browser location: ${geoMessage || geoError}`);
        }
        cleanUrlParams();
        return true;
    }

    return false;
}

// Save GPS coordinates to device and invalidate caches
// Returns true on success, throws on failure
async function saveGpsToDevice(lat, lon) {
    const settings = {
        gps_lat: lat.toString(),
        gps_lon: lon.toString(),
    };

    const response = await fetch("/api/v1/gps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
    });

    if (response.ok) {
        AppState.gpsOverride = null;
        clearDistanceCache();
        AppState.latestChaseJson = null;
        return true;
    }

    const data = await response.json();
    throw new Error(data.error || "Unknown error");
}

// Save geolocation received from bridge to ESP32
async function saveGeolocationFromBridge(lat, lon, accuracy) {
    // Store coords for QRX page to pick up (in case page isn't loaded yet)
    sessionStorage.setItem("pendingGeolocation", JSON.stringify({ lat, lon }));

    // Update input field immediately (if on QRX page)
    const gpsInput = document.getElementById("gps-location");
    if (gpsInput) {
        gpsInput.value = `${lat}, ${lon}`;
        // Fetch locality via reverse geocoding (fire and forget)
        fetchLocalityFromCoords(lat, lon);
    }

    try {
        await saveGpsToDevice(lat, lon);
    } catch (error) {
        Log.error("GPS", "Failed to save browser location:", error);
        alert("Failed to save location to device.");
    }
}

// Fetch locality name from coordinates using Nominatim reverse geocoding
async function fetchLocalityFromCoords(lat, lon) {
    const localityDiv = document.getElementById("gps-locality");
    if (!localityDiv) return;

    try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&addressdetails=1&zoom=10`;
        const response = await fetch(url, {
            headers: { "User-Agent": "sotacat (github.com/SOTAmat/SOTAcat)" },
        });

        if (response.ok) {
            const data = await response.json();
            if (data.display_name) {
                localityDiv.textContent = data.display_name;
                localityDiv.title = data.display_name;
            }
        }
    } catch (error) {
        Log.debug("GPS", "Locality lookup failed:", error.message);
    }
}

// Remove query parameters from URL without page reload
function cleanUrlParams() {
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
}

// ============================================================================
// Geolocation and Distance Functions
// ============================================================================

// Default location: KPH Maritime Radio Station, Point Reyes, CA
const DEFAULT_LOCATION = { latitude: 38.0522, longitude: -122.9694 };

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

// Get user location from NVRAM or default to KPH (returns {latitude, longitude})
async function getLocation() {
    // Return cached location if available
    if (AppState.gpsOverride) {
        return AppState.gpsOverride;
    }

    // Try to fetch from NVRAM
    try {
        const response = await fetch("/api/v1/gps");
        const data = await response.json();
        if (data.gps_lat && data.gps_lon) {
            Log.debug("GPS", "Using location from NVRAM");
            AppState.gpsOverride = { latitude: parseFloat(data.gps_lat), longitude: parseFloat(data.gps_lon) };
            return AppState.gpsOverride;
        }
    } catch (error) {
        Log.warn("GPS", "Failed to fetch from NVRAM:", error);
    }

    // Fall back to default location (KPH)
    Log.debug("GPS", "Using default location (KPH)");
    return DEFAULT_LOCATION;
}

// Distance cache for reference lookups
const distanceCache = {};

// Clear distance cache (called when GPS location changes)
function clearDistanceCache() {
    // Clear the distance cache to force recalculation with new location
    for (const key in distanceCache) {
        delete distanceCache[key];
    }
    Log.debug("GPS", "Distance cache cleared for location change");
}

// ============================================================================
// Firmware Version Checking Functions
// ============================================================================

// Version check configuration constants
const VERSION_CHECK_INTERVAL_DAYS = 1.0;
const VERSION_CHECK_STORAGE_KEY = "sotacatVersionCheck";
const VERSION_CHECK_SUCCESS_KEY = "sotacatVersionCheckSuccess";
const MANIFEST_URL = "https://sotamat.com/wp-content/uploads/manifest.json";
const VERSION_CHECK_TIMEOUT_MS = 5000;
const VERSION_CHECK_RETRY_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// Start retry timer for failed version checks
function startVersionCheckRetryTimer() {
    // Clear any existing timer
    if (AppState.versionCheckRetryTimer) {
        clearInterval(AppState.versionCheckRetryTimer);
    }

    Log.debug("Version", "Starting retry timer (will retry every 15 minutes)");
    AppState.versionCheckRetryTimer = setInterval(async () => {
        Log.debug("Version", "Retry timer triggered - attempting version check");
        try {
            await checkFirmwareVersion(false); // false = automatic check
            // If we get here, the check succeeded, so stop retrying
            stopVersionCheckRetryTimer();
        } catch (error) {
            Log.debug("Version", "Retry failed:", error.message);
            // Keep retrying
        }
    }, VERSION_CHECK_RETRY_INTERVAL_MS);
}

// Stop retry timer
function stopVersionCheckRetryTimer() {
    if (AppState.versionCheckRetryTimer) {
        Log.debug("Version", "Stopping retry timer");
        clearInterval(AppState.versionCheckRetryTimer);
        AppState.versionCheckRetryTimer = null;
    }
}

// Parse version string to Unix timestamp (returns seconds since epoch, or null on failure)
function normalizeVersion(versionString) {
    Log.debug("Version", "Parsing version string:", versionString);

    // Extract date and time components from version string
    let match;
    if (versionString.includes("-Release")) {
        // Handle manifest format (e.g., "2024-11-29_11:37-Release")
        match = versionString.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2}):(\d{2})/);
        Log.debug("Version", "Manifest format detected, match:", match);
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
        Log.debug("Version", "Device format detected, match:", match);
    }

    if (!match) {
        Log.debug("Version", "Failed to match version pattern");
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

    Log.debug("Version", "Parsed components:", {
        year,
        originalMonth,
        day,
        hour,
        minute,
    });

    const date = new Date(Date.UTC(year, month, day, hour, minute));
    const timestamp = date.getTime() / 1000;

    Log.debug("Version", "Resulting timestamp:", timestamp, "Date:", date.toISOString());

    return timestamp;
}

// Check if enough time has passed since last version check (returns boolean)
function shouldCheckVersion() {
    const lastCheck = localStorage.getItem(VERSION_CHECK_STORAGE_KEY);
    Log.debug("Version", "Last check timestamp:", lastCheck);
    if (!lastCheck) {
        Log.debug("Version", "No previous check found, returning true");
        return true;
    }

    const lastCheckDate = new Date(parseInt(lastCheck, 10));
    const now = new Date();
    const daysSinceLastCheck = (now - lastCheckDate) / (1000 * 60 * 60 * 24);

    Log.debug("Version", "Days since last check:", daysSinceLastCheck);
    Log.debug("Version", "Check interval:", VERSION_CHECK_INTERVAL_DAYS);
    const shouldCheck = daysSinceLastCheck >= VERSION_CHECK_INTERVAL_DAYS;
    Log.debug("Version", "Should check?", shouldCheck);
    return shouldCheck;
}

// Perform version check (manualCheck: boolean - true for user-initiated, false for automatic)
async function checkFirmwareVersion(manualCheck = false) {
    Log.debug("Version", "Starting version check");
    if (!manualCheck && !shouldCheckVersion()) {
        Log.debug("Version", "Skipping check due to interval");
        return;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), VERSION_CHECK_TIMEOUT_MS);

        // Get current version from device
        Log.debug("Version", "Fetching current version from device");
        const response = await fetch("/api/v1/version", {
            signal: controller.signal,
        });
        if (!response.ok) {
            const error = `Failed to get current version from device (HTTP ${response.status})`;
            Log.warn("Version", error);
            if (manualCheck) {
                throw new Error(error);
            }
            return;
        }
        const currentVersion = await response.text();
        Log.debug("Version", "Current device version:", currentVersion);
        const currentBuildTime = normalizeVersion(currentVersion);
        if (!currentBuildTime) {
            const error = `Failed to parse current version format: ${currentVersion}`;
            Log.error("Version", error);
            if (manualCheck) {
                throw new Error(error);
            }
            return;
        }

        // Fetch manifest (CORS required to read response body)
        // Add timestamp to URL to bypass cache
        const cacheBustUrl = `${MANIFEST_URL}?t=${Date.now()}`;
        Log.debug("Version", "Fetching manifest from:", cacheBustUrl);
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
            Log.warn("Version", error);
            if (manualCheck) {
                throw new Error(error);
            }
            return;
        }

        if (!manifestResponse.ok) {
            const error = `Failed to fetch manifest from server (HTTP ${manifestResponse.status})`;
            Log.warn("Version", error);
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
            Log.warn("Version", error);
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
            Log.warn("Version", error);
            if (manualCheck) {
                throw new Error(error);
            }
            return;
        }

        // Compare versions using Unix timestamps
        Log.info("Version", "Latest version timestamp:", new Date(latestVersion * 1000).toISOString());
        Log.info("Version", "Current version timestamp:", new Date(currentBuildTime * 1000).toISOString());

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
                    Log.debug("Version", "User dismissed update notification - will retry tomorrow");
                }
            } else {
                // No update needed - update timestamp
                shouldUpdateTimestamp = true;
            }
        }

        // Only update timestamp if appropriate
        if (shouldUpdateTimestamp) {
            localStorage.setItem(VERSION_CHECK_STORAGE_KEY, Date.now().toString());
            Log.debug("Version", "Updated last check timestamp");
        }

        // Always track successful completion (even if we don't update the check timestamp)
        localStorage.setItem(VERSION_CHECK_SUCCESS_KEY, Date.now().toString());
        Log.debug("Version", "Version check completed successfully");

        // Stop retry timer on successful check
        stopVersionCheckRetryTimer();
    } catch (error) {
        Log.debug("Version", "Error during version check:", error.message);

        // Start retry timer for failed automatic checks
        if (!manualCheck) {
            startVersionCheckRetryTimer();
        }

        throw error; // Re-throw to be caught by the caller
    }
}
