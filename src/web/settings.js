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
// Callsign Management Functions
// ============================================================================

// Track the original callsign value to detect changes
let originalCallSignValue = "";

// Load saved callsign from device and populate input field
async function loadCallSign() {
    await ensureCallSignLoaded();
    const callSignInput = document.getElementById("callsign");
    const saveCallSignBtn = document.getElementById("save-callsign-button");

    callSignInput.value = AppState.callSign || "";

    // Store original value and reset save button
    originalCallSignValue = callSignInput.value;
    if (saveCallSignBtn) {
        saveCallSignBtn.disabled = true;
        saveCallSignBtn.className = "btn-secondary";
    }
}

// Enable save button when callsign input changes from original value
function onCallSignInputChange() {
    const callSignInput = document.getElementById("callsign");
    const saveCallSignBtn = document.getElementById("save-callsign-button");

    if (saveCallSignBtn) {
        const hasChanged = callSignInput.value !== originalCallSignValue;
        saveCallSignBtn.disabled = !hasChanged;
        saveCallSignBtn.className = hasChanged ? "btn-primary" : "btn-secondary";
    }
}

// Save operator callsign to device (validates A-Z, 0-9, and / only)
async function saveCallSign() {
    const callSignInput = document.getElementById("callsign");
    const callSign = callSignInput.value.toUpperCase().trim();

    // Validate the input using regex - uppercase letters, numbers, and slashes only
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

            // Update original value and reset save button
            originalCallSignValue = callSignInput.value;
            const saveCallSignBtn = document.getElementById("save-callsign-button");
            if (saveCallSignBtn) {
                saveCallSignBtn.disabled = true;
                saveCallSignBtn.className = "btn-secondary";
            }

            alert("Call sign saved successfully.");
        } else {
            const data = await response.json();
            throw new Error(data.error || "Unknown error");
        }
    } catch (error) {
        Log.error("Settings", "Failed to save call sign:", error);
        alert("Failed to save call sign.");
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
    const popup = document.getElementById("wifi-help-popup");
    const helpButton = document.getElementById("wifi-help-button");

    if (
        popup &&
        popup.style.display === "block" &&
        !popup.contains(event.target) &&
        helpButton &&
        !helpButton.contains(event.target)
    ) {
        toggleWifiHelp();
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

// Update upload button text when file is selected
function updateButtonText() {
    const fileInput = document.getElementById("ota-file");
    const uploadButton = document.getElementById("upload-button");

    if (fileInput.files.length > 0) {
        const fileName = fileInput.files[0].name;
        uploadButton.textContent = `Upload ${fileName}`;
        uploadButton.disabled = false; // Enable the button once a file is selected
    } else {
        uploadButton.textContent = "Upload Firmware";
        uploadButton.disabled = true; // Keep the button disabled if no file is selected
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

        // Handle error response
        uploadButton.disabled = false;
        uploadButton.textContent = "Upload Firmware";

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

        // Reset button state
        uploadButton.disabled = false;
        uploadButton.textContent = "Upload Firmware";
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

    // Password visibility toggles
    document.querySelectorAll(".password-visibility-toggle").forEach((checkbox) => {
        checkbox.addEventListener("change", function () {
            const targetId = this.getAttribute("data-target");
            togglePasswordVisibility(targetId);
        });
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
