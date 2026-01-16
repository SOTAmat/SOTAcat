// ============================================================================
// QRX Page Logic
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
            Log.debug("QRX", "Time sync successful");
            return; // No content, sync was successful
        } else if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || "Unknown error");
        }
    } catch (error) {
        Log.error("QRX", "Time sync failed:", error.message);
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
    const localityDiv = document.getElementById("gps-locality");

    // Check for pending geolocation from browser bridge (takes priority)
    const pending = sessionStorage.getItem("pendingGeolocation");
    if (pending) {
        try {
            const { lat, lon } = JSON.parse(pending);
            gpsLocationInput.value = `${lat}, ${lon}`;
            gpsLocationInput.placeholder = "latitude, longitude";
            fetchLocalityFromCoords(lat, lon);
            sessionStorage.removeItem("pendingGeolocation");
        } catch (e) {
            sessionStorage.removeItem("pendingGeolocation");
        }
    } else {
        // Otherwise load from device API
        try {
            const response = await fetch("/api/v1/gps");
            const data = await response.json();

            if (data.gps_lat && data.gps_lon) {
                gpsLocationInput.value = `${data.gps_lat}, ${data.gps_lon}`;
                gpsLocationInput.placeholder = "latitude, longitude";
                fetchLocalityFromCoords(parseFloat(data.gps_lat), parseFloat(data.gps_lon));
            } else {
                gpsLocationInput.value = "";
                gpsLocationInput.placeholder = "default: 38.0522, -122.9694";
                if (localityDiv) localityDiv.textContent = "";
            }
        } catch (error) {
            Log.error("QRX", "Failed to load GPS location:", error);
            gpsLocationInput.value = "";
            gpsLocationInput.placeholder = "default: 38.0522, -122.9694";
            if (localityDiv) localityDiv.textContent = "";
        }
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

    try {
        await saveGpsToDevice(latitude, longitude);

        // Update original value and reset save button
        originalGpsValue = gpsLocationInput.value;
        if (saveGpsBtn) {
            saveGpsBtn.disabled = true;
            saveGpsBtn.className = "btn btn-secondary";
        }

        // Fetch and display locality for the new coordinates
        fetchLocalityFromCoords(latitude, longitude);
    } catch (error) {
        Log.error("QRX", "Failed to save GPS location:", error);
        alert("Failed to save location.");
    }
}

// ============================================================================
// Reference Functions (SOTA/POTA/X-OTA)
// ============================================================================

const REFERENCE_STORAGE_KEY = "qrxReference";
const REFERENCE_PATTERN = /^[A-Z0-9/@-]*$/;

// Track the original reference value to detect changes
let originalReferenceValue = "";

// Load reference from localStorage
function loadReference() {
    const referenceInput = document.getElementById("reference-input");
    const saveBtn = document.getElementById("save-reference-button");

    if (referenceInput) {
        const stored = localStorage.getItem(REFERENCE_STORAGE_KEY) || "";
        referenceInput.value = stored;
        originalReferenceValue = stored;
    }

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.className = "btn btn-secondary";
    }
}

// Handle reference input changes - auto-uppercase and filter invalid chars
function onReferenceInputChange() {
    const referenceInput = document.getElementById("reference-input");
    const saveBtn = document.getElementById("save-reference-button");

    if (referenceInput) {
        // Auto-uppercase and filter invalid characters
        const cleaned = referenceInput.value.toUpperCase().replace(/[^A-Z0-9/@-]/g, "");
        if (referenceInput.value !== cleaned) {
            referenceInput.value = cleaned;
        }

        // Enable save button if value changed from original
        if (saveBtn) {
            const hasChanged = referenceInput.value !== originalReferenceValue;
            saveBtn.disabled = !hasChanged;
            saveBtn.className = hasChanged ? "btn btn-primary" : "btn btn-secondary";
        }
    }
}

// Save reference to localStorage
function saveReference() {
    const referenceInput = document.getElementById("reference-input");
    const saveBtn = document.getElementById("save-reference-button");

    if (referenceInput) {
        const value = referenceInput.value.trim();
        localStorage.setItem(REFERENCE_STORAGE_KEY, value);
        originalReferenceValue = value;
        Log.debug("QRX", "Reference saved:", value);
    }

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.className = "btn btn-secondary";
    }
}

// Clear reference from input and localStorage
function clearReference() {
    const referenceInput = document.getElementById("reference-input");
    const saveBtn = document.getElementById("save-reference-button");

    if (referenceInput) {
        referenceInput.value = "";
    }

    localStorage.removeItem(REFERENCE_STORAGE_KEY);
    originalReferenceValue = "";
    Log.debug("QRX", "Reference cleared");

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.className = "btn btn-secondary";
    }
}

// ============================================================================
// Event Handler Attachment
// ============================================================================

let qrxEventListenersAttached = false;

function attachQrxEventListeners() {
    if (qrxEventListenersAttached) {
        return;
    }
    qrxEventListenersAttached = true;

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

    // Reference input and buttons
    const referenceInput = document.getElementById("reference-input");
    if (referenceInput) {
        referenceInput.addEventListener("input", onReferenceInputChange);
    }

    const saveReferenceBtn = document.getElementById("save-reference-button");
    if (saveReferenceBtn) {
        saveReferenceBtn.addEventListener("click", saveReference);
    }

    const clearReferenceBtn = document.getElementById("clear-reference-button");
    if (clearReferenceBtn) {
        clearReferenceBtn.addEventListener("click", clearReference);
    }
}

// ============================================================================
// Page Lifecycle
// ============================================================================

// Called when QRX tab becomes visible
function onQrxAppearing() {
    Log.info("QRX", "tab appearing");
    attachQrxEventListeners();
    loadGpsLocation();
    loadReference();
}

// Called when QRX tab is hidden
function onQrxLeaving() {
    Log.info("QRX", "tab leaving");
    // Reset event listener flag so they can be reattached when returning
    qrxEventListenersAttached = false;
}
