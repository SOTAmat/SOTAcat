// ============================================================================
// Settings Page Logic
// ============================================================================
// Handles device configuration including time sync, callsign, GPS location,
// WiFi settings, and firmware updates

// ============================================================================
// Constants
// ============================================================================

const FIRMWARE_UPLOAD_SUCCESS_DELAY_MS = 2000;

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
            Log.debug("Settings", "Time sync successful");
            return; // No content, sync was successful
        } else if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || "Unknown error");
        }
    } catch (error) {
        Log.error("Settings", "Time sync failed:", error.message);
    }
}

// ============================================================================
// Callsign & License Class Management Functions
// ============================================================================

// Track the original values to detect changes
let originalCallSignValue = "";
let originalLicenseClass = "";

// Load saved callsign from device and license class from localStorage
async function loadCallSign() {
    await ensureCallSignLoaded();
    const callSignInput = document.getElementById("callsign");
    const licenseSelect = document.getElementById("license-class");
    const saveCallSignBtn = document.getElementById("save-callsign-button");

    callSignInput.value = AppState.callSign || "";

    // Load license class from localStorage
    const savedLicense = localStorage.getItem("sotacat_licenseClass") || "";
    if (licenseSelect) {
        licenseSelect.value = savedLicense;
    }

    // Store original values and reset save button
    originalCallSignValue = callSignInput.value;
    originalLicenseClass = savedLicense;
    if (saveCallSignBtn) {
        saveCallSignBtn.disabled = true;
        saveCallSignBtn.className = "btn-secondary";
    }
}

// Enable save button when callsign or license class changes from original value
function onCallSignInputChange() {
    const callSignInput = document.getElementById("callsign");
    const licenseSelect = document.getElementById("license-class");
    const saveCallSignBtn = document.getElementById("save-callsign-button");

    if (saveCallSignBtn) {
        const callSignChanged = callSignInput.value !== originalCallSignValue;
        const licenseChanged = licenseSelect && licenseSelect.value !== originalLicenseClass;
        const hasChanged = callSignChanged || licenseChanged;
        saveCallSignBtn.disabled = !hasChanged;
        saveCallSignBtn.className = hasChanged ? "btn-primary" : "btn-secondary";
    }
}

// Save operator callsign to device and license class to localStorage
async function saveCallSign() {
    const callSignInput = document.getElementById("callsign");
    const licenseSelect = document.getElementById("license-class");
    const callSign = callSignInput.value.toUpperCase().trim();
    const licenseClass = licenseSelect ? licenseSelect.value : "";

    // Validate the callsign using regex - uppercase letters, numbers, and slashes only
    const callSignPattern = /^[A-Z0-9\/]*$/;
    if (!callSignPattern.test(callSign) && callSign !== "") {
        alert("Call sign can only contain uppercase letters, numbers, and slashes (/)");
        return;
    }

    const settings = {
        callsign: callSign,
    };

    try {
        const response = await fetch("/api/v1/callsign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(settings),
        });

        if (response.ok) {
            // Update the global AppState
            AppState.callSign = callSign;

            // Save license class to localStorage
            if (licenseClass) {
                localStorage.setItem("sotacat_licenseClass", licenseClass);
            } else {
                localStorage.removeItem("sotacat_licenseClass");
            }

            // Update original values and reset save button
            originalCallSignValue = callSignInput.value;
            originalLicenseClass = licenseClass;
            const saveCallSignBtn = document.getElementById("save-callsign-button");
            if (saveCallSignBtn) {
                saveCallSignBtn.disabled = true;
                saveCallSignBtn.className = "btn-secondary";
            }

            alert("Settings saved successfully.");
        } else {
            const data = await response.json();
            throw new Error(data.error || "Unknown error");
        }
    } catch (error) {
        Log.error("Settings", "Failed to save settings:", error);
        alert("Failed to save settings.");
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
        Log.error("Settings", "Failed to load GPS location:", error);
        gpsLocationInput.value = "";
        gpsLocationInput.placeholder = "default: 38.0522, -122.9694";
    }

    // Store original value and reset save button
    originalGpsValue = gpsLocationInput.value;
    if (saveGpsBtn) {
        saveGpsBtn.disabled = true;
        saveGpsBtn.className = "btn-secondary";
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
            saveGpsBtn.className = "btn-primary";
        } else {
            saveGpsBtn.className = "btn-secondary";
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
                saveGpsBtn.className = "btn-secondary";
            }

            alert(`Location saved: (${latitude}, ${longitude})`);
        } else {
            const data = await response.json();
            throw new Error(data.error || "Unknown error");
        }
    } catch (error) {
        Log.error("Settings", "Failed to save GPS location:", error);
        alert("Failed to save location.");
    }
}

// ============================================================================
// Tune Targets Functions
// ============================================================================

// Maximum number of tune targets allowed
const MAX_TUNE_TARGETS = 5;

// Track original tune targets state for change detection
// Format: [{url: "...", enabled: true}, ...]
let originalTuneTargets = [];
let originalTuneTargetsMobile = false;

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

// Load tune targets from device (falls back to AppState if device unavailable)
async function loadTuneTargets() {
    const mobileCheckbox = document.getElementById("tune-targets-mobile");
    const saveBtn = document.getElementById("save-tune-targets-button");

    let loadedFromDevice = false;
    try {
        const response = await fetch("/api/v1/tuneTargets");
        if (response.ok) {
            const data = await response.json();
            originalTuneTargets = normalizeTuneTargets(data.targets);
            originalTuneTargetsMobile = data.mobile || false;
            loadedFromDevice = true;
        }
    } catch (error) {
        Log.warn("Settings", "Device unavailable for tune targets load:", error);
    }

    // Fall back to AppState if device unavailable (may have session or cached data)
    if (!loadedFromDevice) {
        if (AppState.tuneTargets && AppState.tuneTargets.length > 0) {
            originalTuneTargets = [...AppState.tuneTargets];
            originalTuneTargetsMobile = AppState.tuneTargetsMobile || false;
            Log.debug("Settings", "Using tune targets from session state");
        } else {
            // Try localStorage cache as last resort
            loadTuneTargetsFromLocalStorage();
            if (AppState.tuneTargets && AppState.tuneTargets.length > 0) {
                originalTuneTargets = [...AppState.tuneTargets];
                originalTuneTargetsMobile = AppState.tuneTargetsMobile || false;
                Log.debug("Settings", "Using tune targets from localStorage cache");
            } else {
                originalTuneTargets = [];
                originalTuneTargetsMobile = false;
            }
        }
    }

    // Populate the UI
    renderTuneTargetsList();
    if (mobileCheckbox) {
        mobileCheckbox.checked = originalTuneTargetsMobile;
    }

    // Reset save button
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.className = "btn-secondary";
    }

    // Update example button states
    updateExampleButtonStates();
}

// Render the tune targets list UI from originalTuneTargets
function renderTuneTargetsList() {
    const listContainer = document.getElementById("tune-targets-list");
    if (!listContainer) return;

    // Use originalTuneTargets as the source (loaded from device)
    // If empty, show one blank row for user to add
    const targets = originalTuneTargets.length > 0 ? originalTuneTargets : [{ url: "", enabled: true }];

    renderTuneTargetsFromArray(targets);
}

// Get current tune targets from the UI
// Returns array of {url, enabled} objects
function getCurrentTuneTargets() {
    const rows = document.querySelectorAll(".tune-target-row");
    const targets = [];

    rows.forEach((row) => {
        const input = row.querySelector(".tune-target-input");
        const toggle = row.querySelector(".toggle-switch input");
        if (input) {
            targets.push({
                url: input.value,
                enabled: toggle ? toggle.checked : true,
            });
        }
    });

    // If empty, return an array with one empty target to show at least one input
    return targets.length > 0 ? targets : [{ url: "", enabled: true }];
}

// Add a new tune target input
function addTuneTarget() {
    const targets = getCurrentTuneTargets();
    if (targets.length >= MAX_TUNE_TARGETS) return;

    targets.push({ url: "", enabled: true });
    renderTuneTargetsFromArray(targets);
    updateTuneTargetsSaveButton();
    updateExampleButtonStates();
}

// Remove a tune target by index
function removeTuneTarget(index) {
    const targets = getCurrentTuneTargets();
    if (targets.length <= 1) {
        // Don't remove the last one, just clear it
        targets[0] = { url: "", enabled: true };
    } else {
        targets.splice(index, 1);
    }
    renderTuneTargetsFromArray(targets);
    updateTuneTargetsSaveButton();
    updateExampleButtonStates();
}

// Render tune targets list from an array of {url, enabled} objects
function renderTuneTargetsFromArray(targets) {
    const listContainer = document.getElementById("tune-targets-list");
    if (!listContainer) return;

    listContainer.innerHTML = "";

    targets.forEach((target, index) => {
        const row = document.createElement("div");
        row.className = "tune-target-row";

        // Toggle switch for enable/disable
        const toggleLabel = document.createElement("label");
        toggleLabel.className = "toggle-switch";
        toggleLabel.title = target.enabled ? "Enabled - click to disable" : "Disabled - click to enable";

        const toggleInput = document.createElement("input");
        toggleInput.type = "checkbox";
        toggleInput.checked = target.enabled;
        toggleInput.dataset.index = index;
        toggleInput.addEventListener("change", onTuneTargetToggleChange);

        const toggleSlider = document.createElement("span");
        toggleSlider.className = "toggle-slider";

        toggleLabel.appendChild(toggleInput);
        toggleLabel.appendChild(toggleSlider);

        // URL input
        const input = document.createElement("input");
        input.type = "text";
        input.className = "tune-target-input";
        input.placeholder = "e.g., http://websdr.example.com/?tune=<FREQ-KHZ><MODE>";
        input.value = target.url;
        input.maxLength = 255;
        input.dataset.index = index;
        input.addEventListener("input", onTuneTargetInputChange);

        // Remove button
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "btn-icon btn-remove";
        removeBtn.textContent = "−";
        removeBtn.title = "Remove target";
        removeBtn.addEventListener("click", () => removeTuneTarget(index));

        row.appendChild(toggleLabel);
        row.appendChild(input);
        row.appendChild(removeBtn);
        listContainer.appendChild(row);
    });

    updateAddButtonState();
}

// Update add button state based on count
function updateAddButtonState() {
    const addBtn = document.getElementById("add-tune-target-button");
    const targets = getCurrentTuneTargets();
    if (addBtn) {
        addBtn.disabled = targets.length >= MAX_TUNE_TARGETS;
    }
}

// Handle tune target input change
function onTuneTargetInputChange() {
    updateTuneTargetsSaveButton();
    updateExampleButtonStates();
}

// Handle tune target toggle switch change
function onTuneTargetToggleChange(event) {
    // Update the title to reflect new state
    const toggleLabel = event.target.closest(".toggle-switch");
    if (toggleLabel) {
        toggleLabel.title = event.target.checked ? "Enabled - click to disable" : "Disabled - click to enable";
    }
    updateTuneTargetsSaveButton();
}

// Handle mobile checkbox change
function onTuneTargetsMobileChange() {
    updateTuneTargetsSaveButton();
}

// Check if tune targets have changed from original
function haveTuneTargetsChanged() {
    const currentTargets = getCurrentTuneTargets().filter((t) => t.url.trim() !== "");
    const mobileCheckbox = document.getElementById("tune-targets-mobile");
    const currentMobile = mobileCheckbox ? mobileCheckbox.checked : false;

    // Compare mobile setting
    if (currentMobile !== originalTuneTargetsMobile) return true;

    // Compare targets arrays (compare as objects)
    const originalNonEmpty = originalTuneTargets.filter((t) => t.url.trim() !== "");
    if (currentTargets.length !== originalNonEmpty.length) return true;

    for (let i = 0; i < currentTargets.length; i++) {
        if (currentTargets[i].url !== originalNonEmpty[i].url) return true;
        if (currentTargets[i].enabled !== originalNonEmpty[i].enabled) return true;
    }

    return false;
}

// Update save button state
function updateTuneTargetsSaveButton() {
    const saveBtn = document.getElementById("save-tune-targets-button");
    if (saveBtn) {
        const hasChanged = haveTuneTargetsChanged();
        saveBtn.disabled = !hasChanged;
        saveBtn.className = hasChanged ? "btn-primary" : "btn-secondary";
    }
}

// Add an example URL to the tune targets list
function addExampleTuneTarget(url) {
    const targets = getCurrentTuneTargets();

    // Check if already at max
    if (targets.length >= MAX_TUNE_TARGETS) {
        alert(`Maximum of ${MAX_TUNE_TARGETS} tune targets allowed.`);
        return;
    }

    // Check if URL already exists
    if (targets.some((t) => t.url === url)) {
        alert("This URL is already in your tune targets.");
        return;
    }

    // If there's only one empty target, replace it; otherwise append
    if (targets.length === 1 && targets[0].url.trim() === "") {
        targets[0] = { url: url, enabled: true };
    } else {
        targets.push({ url: url, enabled: true });
    }

    renderTuneTargetsFromArray(targets);
    updateTuneTargetsSaveButton();
    updateExampleButtonStates();
}

// Update example button states based on current targets
function updateExampleButtonStates() {
    const targets = getCurrentTuneTargets();
    const exampleButtons = document.querySelectorAll(".btn-add-example");

    exampleButtons.forEach((btn) => {
        const url = btn.dataset.url;
        const alreadyAdded = targets.some((t) => t.url === url);
        const atMax = targets.filter((t) => t.url.trim() !== "").length >= MAX_TUNE_TARGETS;

        btn.disabled = alreadyAdded || atMax;
        btn.textContent = alreadyAdded ? "added" : "+ add";
    });
}

// Save tune targets to device (falls back to session-only if device unavailable)
async function saveTuneTargets() {
    const targets = getCurrentTuneTargets().filter((t) => t.url.trim() !== "");
    const mobileCheckbox = document.getElementById("tune-targets-mobile");
    const mobile = mobileCheckbox ? mobileCheckbox.checked : false;

    const payload = {
        targets: targets,
        mobile: mobile,
    };

    let savedToDevice = false;
    try {
        const response = await fetch("/api/v1/tuneTargets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (response.ok) {
            savedToDevice = true;
        }
    } catch (error) {
        Log.warn("Settings", "Device unavailable for tune targets save:", error);
    }

    // Always update session state (AppState) so targets work for this session
    originalTuneTargets = [...targets];
    originalTuneTargetsMobile = mobile;
    AppState.tuneTargets = normalizeTuneTargets(targets);
    AppState.tuneTargetsMobile = mobile;

    // Also save to localStorage as a cache (write-through)
    saveTuneTargetsToLocalStorage(AppState.tuneTargets, AppState.tuneTargetsMobile);

    // Reset save button
    const saveBtn = document.getElementById("save-tune-targets-button");
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.className = "btn-secondary";
    }

    if (savedToDevice) {
        alert("Tune targets saved.");
    } else {
        alert("Tune targets saved for this session (device unavailable).");
    }
}

// ============================================================================
// Tune Targets Help Popup Functions
// ============================================================================

// Toggle Tune Targets help popup
function toggleTuneTargetsHelp() {
    const popup = document.getElementById("tune-targets-help-popup");
    const isVisible = popup.style.display !== "none";

    if (isVisible) {
        popup.style.display = "none";
        document.body.style.overflow = ""; // Restore scrolling
    } else {
        popup.style.display = "block";
        document.body.style.overflow = "hidden"; // Prevent background scrolling
    }
}

// ============================================================================
// WiFi Help Popup Functions
// ============================================================================

// Toggle WiFi configuration help popup
function toggleWifiHelp() {
    const popup = document.getElementById("wifi-help-popup");
    const isVisible = popup.style.display !== "none";

    if (isVisible) {
        popup.style.display = "none";
        document.body.style.overflow = ""; // Restore scrolling
    } else {
        popup.style.display = "block";
        document.body.style.overflow = "hidden"; // Prevent background scrolling
    }
}

// Close popup when clicking outside of it
function handleClickOutsidePopup(event) {
    // Handle WiFi help popup
    const wifiPopup = document.getElementById("wifi-help-popup");
    const wifiHelpButton = document.getElementById("wifi-help-button");

    if (
        wifiPopup &&
        wifiPopup.style.display === "block" &&
        !wifiPopup.contains(event.target) &&
        wifiHelpButton &&
        !wifiHelpButton.contains(event.target)
    ) {
        toggleWifiHelp();
    }

    // Handle Tune Targets help popup
    const tuneTargetsPopup = document.getElementById("tune-targets-help-popup");
    const tuneTargetsHelpButton = document.getElementById("tune-targets-help-button");

    if (
        tuneTargetsPopup &&
        tuneTargetsPopup.style.display === "block" &&
        !tuneTargetsPopup.contains(event.target) &&
        tuneTargetsHelpButton &&
        !tuneTargetsHelpButton.contains(event.target)
    ) {
        toggleTuneTargetsHelp();
    }
}

// ============================================================================
// Password Visibility Functions
// ============================================================================

// Toggle password field visibility (inputId: 'sta1-pass', 'sta2-pass', etc.)
function togglePasswordVisibility(inputId) {
    const passwordInput = document.getElementById(inputId);
    passwordInput.type = passwordInput.type === "password" ? "text" : "password";
}

// ============================================================================
// WiFi Settings Functions
// ============================================================================

// Track the original WiFi values to detect changes
let originalWifiValues = {};

// WiFi field IDs for change tracking
const WIFI_FIELD_IDS = [
    "sta1-ssid",
    "sta1-pass",
    "sta2-ssid",
    "sta2-pass",
    "sta3-ssid",
    "sta3-pass",
    "ap-ssid",
    "ap-pass",
];

// Store current WiFi values as the original baseline
function storeOriginalWifiValues() {
    originalWifiValues = {};
    WIFI_FIELD_IDS.forEach((id) => {
        const element = document.getElementById(id);
        if (element) {
            originalWifiValues[id] = element.value;
        }
    });
}

// Check if any WiFi field has changed from original value
function hasWifiChanged() {
    return WIFI_FIELD_IDS.some((id) => {
        const element = document.getElementById(id);
        return element && element.value !== originalWifiValues[id];
    });
}

// Update WiFi save button state based on whether values have changed
function updateWifiSaveButton() {
    const saveWifiBtn = document.getElementById("save-wifi-button");
    if (saveWifiBtn) {
        const hasChanged = hasWifiChanged();
        saveWifiBtn.disabled = !hasChanged;
        saveWifiBtn.className = hasChanged ? "btn-primary btn-large" : "btn-secondary btn-large";
    }
}

// Fetch WiFi settings from device
async function fetchSettings() {
    if (isLocalhost) return;
    try {
        const response = await fetch("/api/v1/settings", { method: "GET" });
        const data = await response.json();

        document.getElementById("sta1-ssid").value = data.sta1_ssid;
        document.getElementById("sta1-pass").value = data.sta1_pass;
        document.getElementById("sta2-ssid").value = data.sta2_ssid;
        document.getElementById("sta2-pass").value = data.sta2_pass;
        document.getElementById("sta3-ssid").value = data.sta3_ssid;
        document.getElementById("sta3-pass").value = data.sta3_pass;
        document.getElementById("ap-ssid").value = data.ap_ssid;
        document.getElementById("ap-pass").value = data.ap_pass;

        // Store original values and reset save button
        storeOriginalWifiValues();
        updateWifiSaveButton();
    } catch (error) {
        Log.error("Settings", "Failed to fetch settings:", error);
    }
}

// Save WiFi settings to device (causes immediate device reboot)
async function saveSettings() {
    Log.debug("Settings", "Saving settings...");
    if (isLocalhost) return;

    const settings = {
        sta1_ssid: document.getElementById("sta1-ssid").value,
        sta1_pass: document.getElementById("sta1-pass").value,
        sta2_ssid: document.getElementById("sta2-ssid").value,
        sta2_pass: document.getElementById("sta2-pass").value,
        sta3_ssid: document.getElementById("sta3-ssid").value,
        sta3_pass: document.getElementById("sta3-pass").value,
        ap_ssid: document.getElementById("ap-ssid").value,
        ap_pass: document.getElementById("ap-pass").value,
    };

    try {
        const response = await fetch("/api/v1/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(settings),
        });

        // If the response is OK but empty (likely due to reboot), assume success
        if (response.ok) {
            Log.debug("Settings", "Settings saved successfully");
            alert(
                "Settings saved successfully!\nYour SOTAcat is rebooting with the new settings.\nPlease restart your browser."
            );
            return;
        }

        // Otherwise, parse the response for potential errors
        const data = await response.json();
        throw new Error(data.error || "Unknown error");
    } catch (error) {
        // If the error is a network error (likely due to reboot), ignore it
        if (error.message.includes("NetworkError")) {
            Log.warn("Settings", "Ignoring expected network error due to reboot.");
            return;
        }

        Log.error("Settings", "Failed to save settings:", error);
        alert("Failed to save settings.");
    }
}

// ============================================================================
// WiFi Settings Validation Functions
// ============================================================================

// Validate that WiFi SSID and password fields are consistently filled
function customCheckSettingsValidity() {
    // Define pairs of SSID and password inputs
    const wifiPairs = [
        { ssid: document.getElementById("sta1-ssid"), pass: document.getElementById("sta1-pass") },
        { ssid: document.getElementById("sta2-ssid"), pass: document.getElementById("sta2-pass") },
        { ssid: document.getElementById("sta3-ssid"), pass: document.getElementById("sta3-pass") },
        { ssid: document.getElementById("ap-ssid"), pass: document.getElementById("ap-pass") },
    ];

    // Check each pair
    for (let pair of wifiPairs) {
        const ssidValue = pair.ssid.value;
        const passValue = pair.pass.value;

        // If one is empty and the other is not, return false
        if ((ssidValue === "" && passValue !== "") || (ssidValue !== "" && passValue === "")) {
            // Optionally, you can alert the user which input group is incorrectly filled
            alert(`Both "${pair.ssid.name}" and "${pair.pass.name}" must be either filled in or left blank.`);
            return false;
        }
    }

    return true;
}

// Handle WiFi settings form submission with validation (event handler)
function onSubmitSettings(event) {
    const wifiForm = document.getElementById("wifi-settings");

    // Prevent the form from submitting until we've done our custom validation
    event.preventDefault();

    // Perform built-in HTML5 validation first. This will show popup for invalid inputs.
    if (!wifiForm.checkValidity()) {
        return;
    }

    // If HTML5 validation passes, we perform our custom validation
    if (!customCheckSettingsValidity()) {
        return;
    }

    saveSettings();
}

// ============================================================================
// Firmware Upload Functions
// ============================================================================

// Update upload button and step number when file is selected
function updateButtonText() {
    const fileInput = document.getElementById("ota-file");
    const uploadButton = document.getElementById("upload-button");
    const stepNumber = document.getElementById("upload-step-number");

    if (fileInput.files.length > 0) {
        const fileName = fileInput.files[0].name;
        uploadButton.textContent = `Upload ${fileName}`;
        uploadButton.disabled = false;
        uploadButton.className = "btn-primary";
        if (stepNumber) {
            stepNumber.classList.remove("step-number-disabled");
        }
    } else {
        uploadButton.textContent = "Upload Firmware";
        uploadButton.disabled = true;
        uploadButton.className = "btn-secondary";
        if (stepNumber) {
            stepNumber.classList.add("step-number-disabled");
        }
    }
}

// Upload firmware file to device (causes immediate device reboot)
async function uploadFirmware() {
    const otaFileInput = document.getElementById("ota-file");
    const otaStatus = document.getElementById("ota-status");
    const uploadButton = document.getElementById("upload-button");
    const file = otaFileInput.files[0];

    if (!file) {
        alert("Please select a firmware file to upload.");
        return;
    }

    // Disable the button and update status to show upload is in progress
    uploadButton.disabled = true;
    uploadButton.textContent = "Uploading firmware...";
    otaStatus.innerHTML = "Uploading firmware... Please wait and do not refresh the page.";

    const blob = new Blob([file], { type: "application/octet-stream" });

    try {
        const response = await fetch("/api/v1/ota", {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: blob,
        });

        if (response.ok) {
            // Update status to show firmware is being applied
            otaStatus.innerHTML = "Firmware upload successful. Applying firmware update...";
            uploadButton.textContent = "Applying firmware...";

            // Show final message and alert
            setTimeout(() => {
                otaStatus.innerHTML = "Firmware upload successful. SOTAcat will now reboot.";
                uploadButton.textContent = "Upload Complete";
                alert(
                    "Firmware upload successful.\nYour SOTAcat is rebooting with the new firmware.\nPlease restart your browser."
                );
            }, FIRMWARE_UPLOAD_SUCCESS_DELAY_MS);
            return;
        }

        // Handle error response - re-sync button with file input state
        updateButtonText();

        const text = await response.text();
        let errorData;
        try {
            errorData = JSON.parse(text);
        } catch (e) {
            throw new Error("Failed to parse error response from server");
        }
        throw new Error(errorData.error || "Unknown error occurred");
    } catch (error) {
        Log.error("Settings", "Firmware upload error:", error);
        otaStatus.innerHTML = `Firmware upload failed: ${error.message}`;
        alert(`Firmware upload failed: ${error.message}`);

        // Re-sync button with file input state
        updateButtonText();
    }
}

// ============================================================================
// Version Checking Functions
// ============================================================================

// Manually trigger firmware version check (returns message string or throws error)
async function manualCheckFirmwareVersion() {
    try {
        const result = await checkFirmwareVersion(true);
        if (result) {
            alert(result);
        }
    } catch (error) {
        Log.error("Settings", "Manual version check error:", error);
        alert("Error checking for firmware updates. Please try again later.");
    }
}

// ============================================================================
// Event Handler Attachment
// ============================================================================

let submitSettingsAttached = false;
let settingsEventListenersAttached = false;

// Attach WiFi settings form submit handler (called once)
function attachSubmitSettings() {
    const wifiForm = document.getElementById("wifi-settings");
    wifiForm.addEventListener("submit", onSubmitSettings);
    submitSettingsAttached = true;
}

// Attach all Settings page event listeners
function attachSettingsEventListeners() {
    // Only attach once to prevent memory leaks
    if (settingsEventListenersAttached) {
        return;
    }
    settingsEventListenersAttached = true;

    // Sync time button
    const syncTimeBtn = document.getElementById("sync-time-button");
    if (syncTimeBtn) {
        syncTimeBtn.addEventListener("click", syncTime);
    }

    const saveCallSignBtn = document.getElementById("save-callsign-button");
    if (saveCallSignBtn) {
        saveCallSignBtn.addEventListener("click", saveCallSign);
    }

    // Call sign input - enforce uppercase, valid characters, and track changes
    const callSignInput = document.getElementById("callsign");
    if (callSignInput) {
        callSignInput.addEventListener("input", function () {
            // Convert to uppercase and filter to only allow A-Z, 0-9, and /
            this.value = this.value.toUpperCase().replace(/[^A-Z0-9\/]/g, "");
            // Update save button state based on changes
            onCallSignInputChange();
        });
    }

    // License class select - track changes
    const licenseClassSelect = document.getElementById("license-class");
    if (licenseClassSelect) {
        licenseClassSelect.addEventListener("change", onCallSignInputChange);
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

    // WiFi help buttons
    const wifiHelpBtn = document.getElementById("wifi-help-button");
    if (wifiHelpBtn) {
        wifiHelpBtn.addEventListener("click", toggleWifiHelp);
    }

    const wifiHelpCloseBtn = document.getElementById("wifi-help-close-button");
    if (wifiHelpCloseBtn) {
        wifiHelpCloseBtn.addEventListener("click", toggleWifiHelp);
    }

    // Tune Targets help buttons
    const tuneTargetsHelpBtn = document.getElementById("tune-targets-help-button");
    if (tuneTargetsHelpBtn) {
        tuneTargetsHelpBtn.addEventListener("click", toggleTuneTargetsHelp);
    }

    const tuneTargetsHelpCloseBtn = document.getElementById("tune-targets-help-close-button");
    if (tuneTargetsHelpCloseBtn) {
        tuneTargetsHelpCloseBtn.addEventListener("click", toggleTuneTargetsHelp);
    }

    // Password visibility toggles
    document.querySelectorAll(".password-visibility-toggle").forEach((checkbox) => {
        checkbox.addEventListener("change", function () {
            const targetId = this.getAttribute("data-target");
            togglePasswordVisibility(targetId);
        });
    });

    // WiFi field change tracking
    WIFI_FIELD_IDS.forEach((id) => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener("input", updateWifiSaveButton);
        }
    });

    // Firmware update buttons
    const checkUpdatesBtn = document.getElementById("check-updates-button");
    if (checkUpdatesBtn) {
        checkUpdatesBtn.addEventListener("click", manualCheckFirmwareVersion);
    }

    const downloadFirmwareBtn = document.getElementById("download-firmware-button");
    if (downloadFirmwareBtn) {
        downloadFirmwareBtn.addEventListener("click", () => {
            window.location.href = "https://sotamat.com/wp-content/uploads/SOTACAT-ESP32C3-OTA.bin";
        });
    }

    const selectFileBtn = document.getElementById("select-file-button");
    const otaFileInput = document.getElementById("ota-file");
    if (selectFileBtn && otaFileInput) {
        selectFileBtn.addEventListener("click", () => {
            otaFileInput.click();
        });
    }

    if (otaFileInput) {
        otaFileInput.addEventListener("change", updateButtonText);
    }

    const uploadBtn = document.getElementById("upload-button");
    if (uploadBtn) {
        uploadBtn.addEventListener("click", uploadFirmware);
    }

    // Click outside popup to close
    document.addEventListener("click", handleClickOutsidePopup);

    // Tune targets buttons and checkbox
    const addTuneTargetBtn = document.getElementById("add-tune-target-button");
    if (addTuneTargetBtn) {
        addTuneTargetBtn.addEventListener("click", addTuneTarget);
    }

    const saveTuneTargetsBtn = document.getElementById("save-tune-targets-button");
    if (saveTuneTargetsBtn) {
        saveTuneTargetsBtn.addEventListener("click", saveTuneTargets);
    }

    const tuneTargetsMobileCheckbox = document.getElementById("tune-targets-mobile");
    if (tuneTargetsMobileCheckbox) {
        tuneTargetsMobileCheckbox.addEventListener("change", onTuneTargetsMobileChange);
    }

    // Example "add" buttons
    document.querySelectorAll(".btn-add-example").forEach((btn) => {
        btn.addEventListener("click", function () {
            const url = this.dataset.url;
            if (url) {
                addExampleTuneTarget(url);
            }
        });
    });
}

// ============================================================================
// Page Lifecycle
// ============================================================================

// Called when Settings tab becomes visible
function onSettingsAppearing() {
    fetchSettings();
    if (!submitSettingsAttached) attachSubmitSettings();
    loadCallSign();
    loadGpsLocation();
    loadTuneTargets();
    attachSettingsEventListeners();
    fetchAndUpdateElement("/api/v1/version", "build-version");
}

// Called when Settings tab is hidden
function onSettingsLeaving() {
    Log.info("Settings", "tab leaving");
    // Clean up document-level event listener to prevent memory leaks
    document.removeEventListener("click", handleClickOutsidePopup);

    // Reset event listener flags so they can be reattached when returning to this tab
    // (necessary because DOM is recreated on each tab switch)
    submitSettingsAttached = false;
    settingsEventListenersAttached = false;
}
