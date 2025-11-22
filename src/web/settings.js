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
        const response = await fetch(`/api/v1/time?time=${now}`, { method: 'PUT' });

        if (response.status === 204) {
            console.log('Time sync successful');
            return;  // No content, sync was successful
        } else if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Unknown error');
        }
    } catch (error) {
        console.error('Time sync failed:', error.message);
    }
}

// ============================================================================
// Callsign Management Functions
// ============================================================================

// Load saved callsign from device and populate input field
async function loadCallSign() {
    try {
        const response = await fetch('/api/v1/callsign');
        const data = await response.json();
        const callSignInput = document.getElementById('callsign');

        if (data.callsign) {
            callSignInput.value = data.callsign.toUpperCase();
            AppState.callSign = data.callsign.toUpperCase();
        } else {
            callSignInput.value = '';
            AppState.callSign = '';
        }
    } catch (error) {
        console.error('Failed to load call sign:', error);
        const callSignInput = document.getElementById('callsign');
        callSignInput.value = '';
        AppState.callSign = '';
    }
}

// Save operator callsign to device (validates A-Z, 0-9, and / only)
async function saveCallSign() {
    const callSignInput = document.getElementById('callsign');
    const callSign = callSignInput.value.toUpperCase().trim();

    // Validate the input using regex - uppercase letters, numbers, and slashes only
    const callSignPattern = /^[A-Z0-9\/]*$/;
    if (!callSignPattern.test(callSign) && callSign !== '') {
        alert('Call sign can only contain uppercase letters, numbers, and slashes (/)');
        return;
    }

    const settings = {
        callsign: callSign,
    };

    try {
        const response = await fetch('/api/v1/callsign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings),
        });

        if (response.ok) {
            // Update the global AppState
            AppState.callSign = callSign;
            alert('Call sign saved successfully.');
        } else {
            const data = await response.json();
            throw new Error(data.error || 'Unknown error');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to save call sign.');
    }
}

// Clear saved callsign from device and reload
async function clearCallSign() {
    const settings = {
        callsign: "",
    };

    try {
        const response = await fetch('/api/v1/callsign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings),
        });

        if (response.ok) {
            // Update the global AppState
            AppState.callSign = "";
            // Clear the input field
            loadCallSign();
            alert('Call sign cleared.');
        } else {
            const data = await response.json();
            throw new Error(data.error || 'Unknown error');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to clear call sign.');
    }
}

// ============================================================================
// GPS Location Override Functions
// ============================================================================

// Load GPS location override from device or show current location as placeholder
async function loadGpsLocation() {
    try {
        const response = await fetch('/api/v1/gps');
        const data = await response.json();
        const gpsLocationInput = document.getElementById('gps-location');

        if (data.gps_lat && data.gps_lon) {
            gpsLocationInput.value = `${data.gps_lat}, ${data.gps_lon}`;
        } else {
            const { latitude, longitude } = await getLocation();
            gpsLocationInput.placeholder = `e.g. ${latitude}, ${longitude}`;
        }
    } catch (error) {
        console.error('Failed to load GPS location:', error);
        const gpsLocationInput = document.getElementById('gps-location');
        gpsLocationInput.placeholder = 'Could not fetch location';
    }
}

// Save GPS location override to device (format: "latitude, longitude")
async function saveGpsLocation() {
    const gpsLocationInput = document.getElementById('gps-location');

    // Validate the input using regex
    const gpsPattern = /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/;
    if (!gpsPattern.test(gpsLocationInput.value) && gpsLocationInput.value.trim() !== '') {
        alert('Please enter a valid GPS location in the format: latitude, longitude (e.g. 37.93389, -122.01136)');
        return;
    }

    // Parse the input to get clean latitude and longitude values
    if (gpsLocationInput.value.trim() !== '') {
        const [latitude, longitude] = gpsLocationInput.value.split(',').map(coord => parseFloat(coord.trim()));

        const settings = {
            gps_lat: latitude.toString(),
            gps_lon: longitude.toString(),
        };

        try {
            const response = await fetch('/api/v1/gps', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings),
            });

            if (response.ok) {
                // Invalidate the cache in main.js
                AppState.gpsOverride = null;
                // Clear the distance cache to force recalculation with new location
                clearDistanceCache();
                // Force refresh of spots data with new location
                AppState.latestChaseJson = null;

                alert('GPS location override saved. The new location will be used for distance calculations.');
            } else {
                const data = await response.json();
                throw new Error(data.error || 'Unknown error');
            }
        } catch (error) {
            console.error('Error:', error);
            alert('Failed to save GPS location.');
        }
    } else {
        alert('Please enter a valid GPS location or use the Clear Override button to remove the override.');
    }
}

// Clear GPS location override from device and reload
async function clearGpsLocation() {
    const settings = {
        gps_lat: "",
        gps_lon: "",
    };

    try {
        const response = await fetch('/api/v1/gps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings),
        });

        if (response.ok) {
            // Invalidate the cache in main.js
            AppState.gpsOverride = null;
            // Clear the input field
            loadGpsLocation();
            // Clear the distance cache to force recalculation with default location
            clearDistanceCache();
            // Force refresh of spots data with new location
            AppState.latestChaseJson = null;

            alert('GPS location override cleared. Automatic location detection will be used.');
        } else {
            const data = await response.json();
            throw new Error(data.error || 'Unknown error');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to clear GPS location.');
    }
}

// ============================================================================
// WiFi Help Popup Functions
// ============================================================================

// Toggle WiFi configuration help popup
function toggleWifiHelp() {
    const popup = document.getElementById('wifi-help-popup');
    const isVisible = popup.style.display !== 'none';

    if (isVisible) {
        popup.style.display = 'none';
        document.body.style.overflow = ''; // Restore scrolling
    } else {
        popup.style.display = 'block';
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
    }
}

// Close popup when clicking outside of it
function handleClickOutsidePopup(event) {
    const popup = document.getElementById('wifi-help-popup');
    const helpButton = document.getElementById('wifi-help-button');

    if (popup && popup.style.display === 'block' &&
        !popup.contains(event.target) &&
        helpButton && !helpButton.contains(event.target)) {
        toggleWifiHelp();
    }
}

// ============================================================================
// Password Visibility Functions
// ============================================================================

// Toggle password field visibility (inputId: 'sta1-pass', 'sta2-pass', etc.)
function togglePasswordVisibility(inputId) {
    const passwordInput = document.getElementById(inputId);
    passwordInput.type = (passwordInput.type === "password") ? "text" : "password";
}

// ============================================================================
// WiFi Settings Functions
// ============================================================================

// Fetch WiFi settings from device
async function fetchSettings() {
    if (isLocalhost) return;
    try {
        const response = await fetch('/api/v1/settings', { method: 'GET' });
        const data = await response.json();

        document.getElementById('sta1-ssid').value = data.sta1_ssid;
        document.getElementById('sta1-pass').value = data.sta1_pass;
        document.getElementById('sta2-ssid').value = data.sta2_ssid;
        document.getElementById('sta2-pass').value = data.sta2_pass;
        document.getElementById('sta3-ssid').value = data.sta3_ssid;
        document.getElementById('sta3-pass').value = data.sta3_pass;
        document.getElementById('ap-ssid').value = data.ap_ssid;
        document.getElementById('ap-pass').value = data.ap_pass;
    } catch (error) {
        console.error('Failed to fetch settings:', error);
    }
}

// Save WiFi settings to device (causes immediate device reboot)
async function saveSettings() {
    console.log("Saving settings...");
    if (isLocalhost) return;

    const settings = {
        sta1_ssid: document.getElementById('sta1-ssid').value,
        sta1_pass: document.getElementById('sta1-pass').value,
        sta2_ssid: document.getElementById('sta2-ssid').value,
        sta2_pass: document.getElementById('sta2-pass').value,
        sta3_ssid: document.getElementById('sta3-ssid').value,
        sta3_pass: document.getElementById('sta3-pass').value,
        ap_ssid:   document.getElementById('ap-ssid').value,
        ap_pass:   document.getElementById('ap-pass').value,
    };

    try {
        const response = await fetch('/api/v1/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings),
        });

        // If the response is OK but empty (likely due to reboot), assume success
        if (response.ok) {
            console.log('Success:', response);
            alert("Settings saved successfully!\nYour SOTAcat is rebooting with the new settings.\nPlease restart your browser.");
            return;
        }

        // Otherwise, parse the response for potential errors
        const data = await response.json();
        throw new Error(data.error || 'Unknown error');

    } catch (error) {
        // If the error is a network error (likely due to reboot), ignore it
        if (error.message.includes('NetworkError')) {
            console.warn("Ignoring expected network error due to reboot.");
            return;
        }

        console.error('Error:', error);
        alert('Failed to save settings.');
    }
}

// ============================================================================
// WiFi Settings Validation Functions
// ============================================================================

// Validate that WiFi SSID and password fields are consistently filled
function customCheckSettingsValidity() {
    // Define pairs of SSID and password inputs
    const wifiPairs = [
        { ssid: document.getElementById('sta1-ssid'), pass: document.getElementById('sta1-pass') },
        { ssid: document.getElementById('sta2-ssid'), pass: document.getElementById('sta2-pass') },
        { ssid: document.getElementById('sta3-ssid'), pass: document.getElementById('sta3-pass') },
        { ssid: document.getElementById('ap-ssid'),   pass: document.getElementById('ap-pass')   }
    ];

    // Check each pair
    for (let pair of wifiPairs) {
        const ssidValue = pair.ssid.value;
        const passValue = pair.pass.value;

        // If one is empty and the other is not, return false
        if ((ssidValue === '' && passValue !== '') || (ssidValue !== '' && passValue === '')) {
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
    const fileInput = document.getElementById('ota-file');
    const uploadButton = document.getElementById('upload-button');

    if (fileInput.files.length > 0) {
        const fileName = fileInput.files[0].name;
        uploadButton.textContent = `Upload ${fileName}`;
        uploadButton.disabled = false; // Enable the button once a file is selected
    } else {
        uploadButton.textContent = 'Upload Firmware';
        uploadButton.disabled = true; // Keep the button disabled if no file is selected
    }
}

// Upload firmware file to device (causes immediate device reboot)
async function uploadFirmware() {
    const otaFileInput = document.getElementById('ota-file');
    const otaStatus = document.getElementById('ota-status');
    const uploadButton = document.getElementById('upload-button');
    const file = otaFileInput.files[0];

    if (!file) {
        alert('Please select a firmware file to upload.');
        return;
    }

    // Disable the button and update status to show upload is in progress
    uploadButton.disabled = true;
    uploadButton.textContent = 'Uploading firmware...';
    otaStatus.innerHTML = 'Uploading firmware... Please wait and do not refresh the page.';

    const blob = new Blob([file], { type: 'application/octet-stream' });

    try {
        const response = await fetch('/api/v1/ota', {
            method: 'POST',
            headers: {'Content-Type': 'application/octet-stream' },
            body: blob
        });

        if (response.ok) {
            // Update status to show firmware is being applied
            otaStatus.innerHTML = 'Firmware upload successful. Applying firmware update...';
            uploadButton.textContent = 'Applying firmware...';

            // Show final message and alert
            setTimeout(() => {
                otaStatus.innerHTML = 'Firmware upload successful. SOTAcat will now reboot.';
                uploadButton.textContent = 'Upload Complete';
                alert("Firmware upload successful.\nYour SOTAcat is rebooting with the new firmware.\nPlease restart your browser.");
            }, FIRMWARE_UPLOAD_SUCCESS_DELAY_MS);
            return;
        }

        // Handle error response
        uploadButton.disabled = false;
        uploadButton.textContent = 'Upload Firmware';

        const text = await response.text();
        let errorData;
        try {
            errorData = JSON.parse(text);
        } catch (e) {
            throw new Error('Failed to parse error response from server');
        }
        throw new Error(errorData.error || 'Unknown error occurred');

    } catch (error) {
        console.error('Firmware upload error:', error);
        otaStatus.innerHTML = `Firmware upload failed: ${error.message}`;
        alert(`Firmware upload failed: ${error.message}`);

        // Reset button state
        uploadButton.disabled = false;
        uploadButton.textContent = 'Upload Firmware';
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
        console.error('[Manual Version Check] Error:', error);
        alert('Error checking for firmware updates. Please try again later.');
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
    const syncTimeBtn = document.getElementById('sync-time-button');
    if (syncTimeBtn) {
        syncTimeBtn.addEventListener('click', syncTime);
    }

    // Call sign buttons
    const clearCallSignBtn = document.getElementById('clear-callsign-button');
    if (clearCallSignBtn) {
        clearCallSignBtn.addEventListener('click', clearCallSign);
    }

    const saveCallSignBtn = document.getElementById('save-callsign-button');
    if (saveCallSignBtn) {
        saveCallSignBtn.addEventListener('click', saveCallSign);
    }

    // Call sign input - enforce uppercase and valid characters
    const callSignInput = document.getElementById('callsign');
    if (callSignInput) {
        callSignInput.addEventListener('input', function() {
            // Convert to uppercase and filter to only allow A-Z, 0-9, and /
            this.value = this.value.toUpperCase().replace(/[^A-Z0-9\/]/g, '');
        });
    }

    // GPS buttons
    const clearGpsBtn = document.getElementById('clear-gps-button');
    if (clearGpsBtn) {
        clearGpsBtn.addEventListener('click', clearGpsLocation);
    }

    const saveGpsBtn = document.getElementById('save-gps-button');
    if (saveGpsBtn) {
        saveGpsBtn.addEventListener('click', saveGpsLocation);
    }

    // WiFi help buttons
    const wifiHelpBtn = document.getElementById('wifi-help-button');
    if (wifiHelpBtn) {
        wifiHelpBtn.addEventListener('click', toggleWifiHelp);
    }

    const wifiHelpCloseBtn = document.getElementById('wifi-help-close-button');
    if (wifiHelpCloseBtn) {
        wifiHelpCloseBtn.addEventListener('click', toggleWifiHelp);
    }

    // Password visibility toggles
    document.querySelectorAll('.password-visibility-toggle').forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            const targetId = this.getAttribute('data-target');
            togglePasswordVisibility(targetId);
        });
    });

    // Firmware update buttons
    const checkUpdatesBtn = document.getElementById('check-updates-button');
    if (checkUpdatesBtn) {
        checkUpdatesBtn.addEventListener('click', manualCheckFirmwareVersion);
    }

    const downloadFirmwareBtn = document.getElementById('download-firmware-button');
    if (downloadFirmwareBtn) {
        downloadFirmwareBtn.addEventListener('click', () => {
            window.location.href = 'https://sotamat.com/wp-content/uploads/SOTACAT-ESP32C3-OTA.bin';
        });
    }

    const selectFileBtn = document.getElementById('select-file-button');
    const otaFileInput = document.getElementById('ota-file');
    if (selectFileBtn && otaFileInput) {
        selectFileBtn.addEventListener('click', () => {
            otaFileInput.click();
        });
    }

    if (otaFileInput) {
        otaFileInput.addEventListener('change', updateButtonText);
    }

    const uploadBtn = document.getElementById('upload-button');
    if (uploadBtn) {
        uploadBtn.addEventListener('click', uploadFirmware);
    }

    // Click outside popup to close
    document.addEventListener('click', handleClickOutsidePopup);
}

// ============================================================================
// Page Lifecycle
// ============================================================================

// Called when Settings tab becomes visible
function onSettingsAppearing() {
    fetchSettings();
    if (!submitSettingsAttached)
        attachSubmitSettings();
    loadCallSign();
    loadGpsLocation();
    attachSettingsEventListeners();
}

// Called when Settings tab is hidden
function onSettingsLeaving() {
    console.info('Settings tab leaving');
    // Clean up document-level event listener to prevent memory leaks
    document.removeEventListener('click', handleClickOutsidePopup);
}
