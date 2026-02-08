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
            Log.debug("QRX")("Time sync successful");
            return; // No content, sync was successful
        } else if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || "Unknown error");
        }
    } catch (error) {
        Log.error("QRX")("Time sync failed:", error.message);
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
                // Display cached locality (no fetch - only fetched when user clicks Locate Me)
                const lat = parseFloat(data.gps_lat);
                const lon = parseFloat(data.gps_lon);
                const cacheKey = buildLocationKey("locality", lat, lon);
                const cached = localStorage.getItem(cacheKey);
                if (localityDiv) {
                    localityDiv.textContent = cached || "";
                    localityDiv.title = cached || "";
                }
            } else {
                gpsLocationInput.value = "";
                gpsLocationInput.placeholder = "default: 38.0522, -122.9694";
                if (localityDiv) localityDiv.textContent = "";
            }
        } catch (error) {
            Log.error("QRX")("Failed to load GPS location:", error);
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

    // Update Nearest SOTA button (requires location)
    updateNearestSotaButtonState();
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

        // Reload reference/summit info for new location (will be empty if not cached)
        await loadReference();
    } catch (error) {
        Log.error("QRX")("Failed to save GPS location:", error);
        alert("Failed to save location.");
    }
}

// ============================================================================
// Nearest SOTA Functions
// ============================================================================

const SOTA_DISTANCE_API_URL = "https://api-db2.sota.org.uk/api/summits/distance";
const SOTA_SEARCH_RANGE_KM = 0.1;

// Fetch nearest SOTA summit and populate reference input
async function fetchNearestSota() {
    const referenceInput = document.getElementById("reference-input");
    const summitInfoDiv = document.getElementById("summit-info");
    const nearestBtn = document.getElementById("nearest-sota-button");

    if (!referenceInput) return;

    // Disable button and show loading state
    if (nearestBtn) {
        nearestBtn.disabled = true;
        nearestBtn.textContent = "Searching...";
    }
    if (summitInfoDiv) {
        summitInfoDiv.textContent = "";
    }

    try {
        // Get current location
        const location = await getLocation();
        if (!location || !location.latitude || !location.longitude) {
            alert("No location available. Please set your location first.");
            return;
        }

        const { latitude, longitude } = location;

        // Fetch summits near the location, starting with small range and expanding if needed
        let summits = [];
        let range = SOTA_SEARCH_RANGE_KM;
        const maxRange = 100; // Max 100km search radius

        while (summits.length === 0 && range <= maxRange) {
            const url = `${SOTA_DISTANCE_API_URL}/${latitude}/${longitude}/${range}`;
            Log.debug("QRX")(`Fetching SOTA summits: ${url}`);

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`SOTA API error: ${response.status}`);
            }

            summits = await response.json();
            if (summits.length === 0) {
                range = range < 1 ? 1 : range < 10 ? 10 : range < 50 ? 50 : 100;
            }
        }

        if (!summits || summits.length === 0) {
            alert("No SOTA summits found within 100km of your location.");
            return;
        }

        // Sort by distance and pick the nearest
        summits.sort((a, b) => a.distance - b.distance);
        const nearest = summits[0];

        // Populate the reference input with the summit code
        referenceInput.value = nearest.summitCode;
        onReferenceInputChange(); // Trigger change handler to enable save button

        // Display summit info with distance (convert km to miles/feet)
        if (summitInfoDiv) {
            const distanceMiles = nearest.distance * 0.621371;
            let distanceStr;
            if (distanceMiles < 0.1) {
                const distanceFeet = Math.round(distanceMiles * 5280);
                distanceStr = `${distanceFeet}ft away`;
            } else {
                distanceStr = `${distanceMiles.toFixed(1)}mi away`;
            }
            summitInfoDiv.textContent = `${nearest.name} • ${nearest.altFt}ft • ${nearest.points}pt • ${distanceStr}`;
            // Cache with location-based key
            const cacheKey = buildLocationKey("summitInfo", latitude, longitude);
            localStorage.setItem(cacheKey, summitInfoDiv.textContent);
        }

        Log.info("QRX")(`Nearest SOTA: ${nearest.summitCode} - ${nearest.name}`);
    } catch (error) {
        Log.error("QRX")("Failed to fetch nearest SOTA:", error);
        alert(`Failed to find nearest SOTA summit: ${error.message}`);
    } finally {
        // Restore button state
        if (nearestBtn) {
            nearestBtn.disabled = false;
            nearestBtn.textContent = "Nearest SOTA";
        }
    }
}

// ============================================================================
// Reference Functions (SOTA/POTA/X-OTA)
// ============================================================================

const REFERENCE_PATTERN = /^[A-Z0-9/@-]*$/;

// Track the original reference value to detect changes
let originalReferenceValue = "";

// Load reference from localStorage
async function loadReference() {
    const referenceInput = document.getElementById("reference-input");
    const saveBtn = document.getElementById("save-reference-button");
    const summitInfoDiv = document.getElementById("summit-info");

    // Ensure location is cached for sync helpers
    const location = await getLocation();

    // Load reference for current location (no fetch - only fetched on button press)
    if (referenceInput) {
        let stored = getLocationBasedReference();
        if (!stored) {
            const legacy = localStorage.getItem("qrxReference") || "";
            if (legacy) {
                setLocationBasedReference(legacy);
                localStorage.removeItem("qrxReference");
                stored = legacy;
            }
        }
        referenceInput.value = stored;
        originalReferenceValue = stored;
    }

    // Display cached summit info for current location
    if (summitInfoDiv) {
        if (location && location.latitude && location.longitude) {
            const cacheKey = buildLocationKey("summitInfo", location.latitude, location.longitude);
            summitInfoDiv.textContent = localStorage.getItem(cacheKey) || "";
        } else {
            summitInfoDiv.textContent = "";
        }
    }

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.className = "btn btn-secondary";
    }

    updateNearestSotaButtonState();
    updatePoloSetupButtonState();
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

// Handle reference input blur - apply auto-formatting
function onReferenceBlur() {
    const referenceInput = document.getElementById("reference-input");
    if (!referenceInput) return;

    const formatted = inferAndFormatReference(referenceInput.value);
    if (formatted !== referenceInput.value) {
        referenceInput.value = formatted;
        onReferenceInputChange(); // Update save button state
    }
}

// Save reference to localStorage
async function saveReference() {
    const referenceInput = document.getElementById("reference-input");
    const saveBtn = document.getElementById("save-reference-button");
    const summitInfoDiv = document.getElementById("summit-info");

    if (referenceInput) {
        const value = referenceInput.value.trim();
        setLocationBasedReference(value);
        originalReferenceValue = value;
        Log.debug("QRX")("Reference saved:", value);
    }

    // Clear summit info (manually entered reference invalidates Nearest SOTA result)
    const location = await getLocation();
    if (location && location.latitude && location.longitude) {
        const cacheKey = buildLocationKey("summitInfo", location.latitude, location.longitude);
        localStorage.removeItem(cacheKey);
    }
    if (summitInfoDiv) {
        summitInfoDiv.textContent = "";
    }

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.className = "btn btn-secondary";
    }

    updatePoloSetupButtonState();
}

// Clear reference from input and localStorage
async function clearReference() {
    const referenceInput = document.getElementById("reference-input");
    const saveBtn = document.getElementById("save-reference-button");
    const summitInfoDiv = document.getElementById("summit-info");

    if (referenceInput) {
        referenceInput.value = "";
    }

    // Clear reference and summit info for current location
    const location = await getLocation();
    setLocationBasedReference("");
    if (location && location.latitude && location.longitude) {
        const cacheKey = buildLocationKey("summitInfo", location.latitude, location.longitude);
        localStorage.removeItem(cacheKey);
    }

    originalReferenceValue = "";
    Log.debug("QRX")("Reference cleared");

    if (summitInfoDiv) {
        summitInfoDiv.textContent = "";
    }

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.className = "btn btn-secondary";
    }

    updatePoloSetupButtonState();
}

// ============================================================================
// PoLo Integration Functions
// ============================================================================

// Reference patterns defined in main.js: SOTA_REF_PATTERN, POTA_REF_PATTERN,
// WWFF_REF_PATTERN, IOTA_REF_PATTERN

// Infer xOTA type and format reference from raw input
function inferAndFormatReference(input) {
    if (!input) return input;

    // Uppercase and strip all non-alphanumeric chars
    const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!raw) return input;

    // Rule 1: WWFF - {2-4 letters}FF{4 digits}
    const wwffMatch = raw.match(/^([A-Z]{2,4})(FF)(\d{4})$/);
    if (wwffMatch) {
        return `${wwffMatch[1]}FF-${wwffMatch[3]}`;
    }

    // Rule 2: IOTA - {continent code}{3 digits}
    const iotaMatch = raw.match(/^(AF|AN|AS|EU|NA|OC|SA)(\d{3})$/);
    if (iotaMatch) {
        return `${iotaMatch[1]}-${iotaMatch[2]}`;
    }

    // Rule 3: POTA - {1-2 letters}{4-5 digits}
    const potaMatch = raw.match(/^([A-Z]{1,2})(\d{4,5})$/);
    if (potaMatch) {
        return `${potaMatch[1]}-${potaMatch[2]}`;
    }

    // Rule 4: SOTA - {1-4 alphanum}{2 letters}{3 digits}
    const sotaMatch = raw.match(/^([A-Z0-9]{1,4})([A-Z]{2})(\d{3})$/);
    if (sotaMatch) {
        return `${sotaMatch[1]}/${sotaMatch[2]}-${sotaMatch[3]}`;
    }

    // No pattern matched - return cleaned uppercase version
    return input.toUpperCase().replace(/[^A-Z0-9/@-]/g, "");
}

// Check if reference is valid for PoLo
function isValidPoloReference(ref) {
    if (!ref) return false;
    return SOTA_REF_PATTERN.test(ref) || POTA_REF_PATTERN.test(ref) || WWFF_REF_PATTERN.test(ref);
}

// Derive sig from reference format
function getPoloSigFromReference(ref) {
    if (!ref) return null;
    if (SOTA_REF_PATTERN.test(ref)) return "sota";
    if (POTA_REF_PATTERN.test(ref)) return "pota";
    if (WWFF_REF_PATTERN.test(ref)) return "wwff";
    return null;
}

// Build Polo deep link for operation setup (myRef + mySig only)
function buildPoloSetupLink() {
    const myRef = getLocationBasedReference();
    if (!isValidPoloReference(myRef)) return null;
    const mySig = getPoloSigFromReference(myRef);
    if (!mySig) return null;
    return buildPoloDeepLink({ myRef: myRef, mySig: mySig });
}

// Launch Ham2K Polo app to setup operation
function launchPoloSetup() {
    const url = buildPoloSetupLink();
    if (url) {
        Log.info("QRX")("Launching Polo for operation setup:", url);
        window.location.href = url;
    } else {
        Log.warn("QRX")("Cannot launch Polo - no valid reference set");
    }
}

// Update Nearest SOTA button state (requires explicit location)
function updateNearestSotaButtonState() {
    const btn = document.getElementById("nearest-sota-button");
    if (!btn) return;
    // Enable only if user has explicitly set a location (GPS input has value)
    const gpsInput = document.getElementById("gps-location");
    const hasLocation = gpsInput && gpsInput.value.trim() !== "";
    btn.disabled = !hasLocation;
}

// Update PoLo setup button state
function updatePoloSetupButtonState() {
    const btn = document.getElementById("setup-polo-button");
    if (!btn) return;
    const ref = getLocationBasedReference();
    btn.disabled = !isValidPoloReference(ref);
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
        referenceInput.addEventListener("blur", onReferenceBlur);
    }

    const nearestSotaBtn = document.getElementById("nearest-sota-button");
    if (nearestSotaBtn) {
        nearestSotaBtn.addEventListener("click", fetchNearestSota);
    }

    const saveReferenceBtn = document.getElementById("save-reference-button");
    if (saveReferenceBtn) {
        saveReferenceBtn.addEventListener("click", saveReference);
    }

    const clearReferenceBtn = document.getElementById("clear-reference-button");
    if (clearReferenceBtn) {
        clearReferenceBtn.addEventListener("click", clearReference);
    }

    // PoLo setup button
    const setupPoloBtn = document.getElementById("setup-polo-button");
    if (setupPoloBtn) {
        setupPoloBtn.addEventListener("click", launchPoloSetup);
    }
}

// ============================================================================
// Page Lifecycle
// ============================================================================

// Called when QRX tab becomes visible
async function onQrxAppearing() {
    Log.info("QRX")("tab appearing");
    attachQrxEventListeners();
    loadGpsLocation();
    await loadReference();
}

// Called when QRX tab is hidden
function onQrxLeaving() {
    Log.info("QRX")("tab leaving");
    // Reset event listener flag so they can be reattached when returning
    qrxEventListenersAttached = false;
}
