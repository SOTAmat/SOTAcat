// ============================================================================
// WRX Page Logic
// ============================================================================
// Handles radio setup utilities: time sync and GPS location management

// ============================================================================
// Time Synchronization Functions
// ============================================================================

// Sync device time with browser's UTC time
async function syncTime() {
    // Get the browser's current UTC time in whole seconds
    const now = Math.round(Date.now() / 1000);

    try {
        // Create the PUT request using Fetch API
        const response = await fetch(`/api/v1/time?time=${now}`, { method: "PUT" });

        if (response.status === 204) {
            Log.debug("WRX", "Time sync successful");
            return; // No content, sync was successful
        } else if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || "Unknown error");
        }
    } catch (error) {
        Log.error("WRX", "Time sync failed:", error.message);
    }
}

// ============================================================================
// GPS Location Override Functions
// ============================================================================

// HTTPS bridge URL for browser geolocation (GitHub Pages)
const GEOLOCATION_BRIDGE_URL = "https://sotamat.github.io/SOTAcat/geolocation/";

// Launch HTTPS geolocation bridge with return path to current page
function launchGeolocationBridge() {
    // Get current URL without query params (clean base for return)
    const currentUrl = window.location.href.split("?")[0];
    const encodedReturnPath = encodeURIComponent(currentUrl);
    const bridgeUrl = `${GEOLOCATION_BRIDGE_URL}?returnpath=${encodedReturnPath}`;

    // Navigate to bridge (not popup - we want to leave the page temporarily)
    window.location.href = bridgeUrl;
}

// Track the original GPS value to detect changes
let originalGpsValue = "";

// Load GPS location from device and display
async function loadGpsLocation() {
    const gpsLocationInput = document.getElementById("gps-location");
    const saveGpsBtn = document.getElementById("save-gps-button");

    try {
        const response = await fetch("/api/v1/gps");
        const data = await response.json();

        if (data.gps_lat && data.gps_lon) {
            gpsLocationInput.value = `${data.gps_lat}, ${data.gps_lon}`;
            gpsLocationInput.placeholder = "latitude, longitude";
        } else {
            gpsLocationInput.value = "";
            gpsLocationInput.placeholder = "default: 38.0522, -122.9694";
        }
    } catch (error) {
        Log.error("WRX", "Failed to load GPS location:", error);
        gpsLocationInput.value = "";
        gpsLocationInput.placeholder = "default: 38.0522, -122.9694";
    }

    // Store original value and reset save button
    originalGpsValue = gpsLocationInput.value;
    if (saveGpsBtn) {
        saveGpsBtn.disabled = true;
        saveGpsBtn.className = "btn btn-secondary";
    }
}

// Enable save button when GPS input changes from original value
function onGpsInputChange() {
    const gpsLocationInput = document.getElementById("gps-location");
    const saveGpsBtn = document.getElementById("save-gps-button");

    if (saveGpsBtn) {
        const hasChanged = gpsLocationInput.value !== originalGpsValue;
        saveGpsBtn.disabled = !hasChanged;
        if (hasChanged) {
            saveGpsBtn.className = "btn btn-primary";
        } else {
            saveGpsBtn.className = "btn btn-secondary";
        }
    }
}

// Save GPS location to device (format: "latitude, longitude")
async function saveGpsLocation() {
    const gpsLocationInput = document.getElementById("gps-location");
    const saveGpsBtn = document.getElementById("save-gps-button");
    const value = gpsLocationInput.value.trim();

    // Validate the input using regex
    const gpsPattern = /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/;
    if (!gpsPattern.test(value)) {
        alert("Enter coordinates as: latitude, longitude\nExample: 37.93389, -122.01136");
        return;
    }

    // Parse the input to get clean latitude and longitude values
    const [latitude, longitude] = value.split(",").map((coord) => parseFloat(coord.trim()));

    const settings = {
        gps_lat: latitude.toString(),
        gps_lon: longitude.toString(),
    };

    try {
        const response = await fetch("/api/v1/gps", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(settings),
        });

        if (response.ok) {
            // Invalidate caches
            AppState.gpsOverride = null;
            clearDistanceCache();
            AppState.latestChaseJson = null;

            // Update original value and reset save button
            originalGpsValue = gpsLocationInput.value;
            if (saveGpsBtn) {
                saveGpsBtn.disabled = true;
                saveGpsBtn.className = "btn btn-secondary";
            }

            alert(`Location saved: (${latitude}, ${longitude})`);
        } else {
            const data = await response.json();
            throw new Error(data.error || "Unknown error");
        }
    } catch (error) {
        Log.error("WRX", "Failed to save GPS location:", error);
        alert("Failed to save location.");
    }
}

// ============================================================================
// Event Handler Attachment
// ============================================================================

let wrxEventListenersAttached = false;

function attachWrxEventListeners() {
    if (wrxEventListenersAttached) {
        return;
    }
    wrxEventListenersAttached = true;

    // Sync time button
    const syncTimeBtn = document.getElementById("sync-time-button");
    if (syncTimeBtn) {
        syncTimeBtn.addEventListener("click", syncTime);
    }

    // GPS input and buttons
    const gpsLocationInput = document.getElementById("gps-location");
    if (gpsLocationInput) {
        gpsLocationInput.addEventListener("input", onGpsInputChange);
    }

    const getBrowserLocationBtn = document.getElementById("get-browser-location-button");
    if (getBrowserLocationBtn) {
        getBrowserLocationBtn.addEventListener("click", launchGeolocationBridge);
    }

    const saveGpsBtn = document.getElementById("save-gps-button");
    if (saveGpsBtn) {
        saveGpsBtn.addEventListener("click", saveGpsLocation);
    }
}

// ============================================================================
// Page Lifecycle
// ============================================================================

// Called when WRX tab becomes visible
function onWrxAppearing() {
    Log.info("WRX", "tab appearing");
    attachWrxEventListeners();
    loadGpsLocation();
}

// Called when WRX tab is hidden
function onWrxLeaving() {
    Log.info("WRX", "tab leaving");
    // Reset event listener flag so they can be reattached when returning
    wrxEventListenersAttached = false;
}
