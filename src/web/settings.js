function syncTime() {
    // Get the browser's current UTC time in whole seconds
    const now = Math.round(Date.now() / 1000);

    // Create the PUT request using Fetch API
    fetch('/api/v1/time?time=' + now, { method: 'PUT' })
    .then(response => {
        if (response.status === 204) {
            console.log('Time sync successful');
            return null;  // No content, sync was successful
        } else if (!response.ok) {
            return response.json().then(data => {
                throw new Error(data.error || 'Unknown error');
            });
        }
    })
    .catch(error => console.error('Time sync failed:', error.message));
}

function saveGpsLocation() {
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

        fetch('/api/v1/gps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings),
        })
        .then(response => {
            if (response.ok) {
                // Invalidate the cache in main.js
                gpsOverride = null;
                // Clear the distance cache to force recalculation with new location
                clearDistanceCache();
                // Force refresh of spots data with new location
                latestChaseJson = null;

                alert('GPS location override saved. The new location will be used for distance calculations.');
            } else {
                response.json().then(data => {
                    throw new Error(data.error || 'Unknown error');
                });
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('Failed to save GPS location.');
        });
    } else {
        alert('Please enter a valid GPS location or use the Clear Override button to remove the override.');
    }
}

async function clearGpsLocation() {
    const settings = {
        gps_lat: "",
        gps_lon: "",
    };

    fetch('/api/v1/gps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
    })
    .then(response => {
        if (response.ok) {
            // Invalidate the cache in main.js
            gpsOverride = null;
            // Clear the input field
            loadGpsLocation();
            // Clear the distance cache to force recalculation with default location
            clearDistanceCache();
            // Force refresh of spots data with new location
            latestChaseJson = null;

            alert('GPS location override cleared. Automatic location detection will be used.');
        } else {
            response.json().then(data => {
                throw new Error(data.error || 'Unknown error');
            });
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('Failed to clear GPS location.');
    });
}

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

// Close popup when clicking outside of it (will be attached in settingsOnAppearing)
function handleClickOutsidePopup(event) {
    const popup = document.getElementById('wifi-help-popup');
    const helpButton = document.getElementById('wifi-help-button');

    if (popup && popup.style.display === 'block' &&
        !popup.contains(event.target) &&
        helpButton && !helpButton.contains(event.target)) {
        toggleWifiHelp();
    }
}

function togglePasswordVisibility(inputId) {
    var passwordInput = document.getElementById(inputId);
    passwordInput.type = (passwordInput.type === "password") ? "text" : "password";
}

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

function saveSettings() {
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

    fetch('/api/v1/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
    })
    .then(response => {
        // If the response is OK but empty (likely due to reboot), assume success
        if (response.ok) {
            console.log('Success:', response);
            alert("Settings saved successfully!\nYour SOTAcat is rebooting with the new settings.\nPlease restart your browser.");
            return;
        }

        // Otherwise, parse the response for potential errors
        return response.json().then(data => {
            throw new Error(data.error || 'Unknown error');
        });
    })
    .catch((error) => {
        // If the error is a network error (likely due to reboot), ignore it
        if (error.message.includes('NetworkError')) {
            console.warn("Ignoring expected network error due to reboot.");
            return;
        }

        console.error('Error:', error);
        alert('Failed to save settings.');
    });
}

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

function onSubmitSettings(event) {
    var wifiForm = document.getElementById("wifi-settings");

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

function uploadFirmware() {
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

    fetch('/api/v1/ota', {
        method: 'POST',
        headers: {'Content-Type': 'application/octet-stream' },
        body: blob
    })
    .then(response => {
        if (response.ok) {
            // Update status to show firmware is being applied
            otaStatus.innerHTML = 'Firmware upload successful. Applying firmware update...';
            uploadButton.textContent = 'Applying firmware...';
            
            // Show final message and alert
            setTimeout(() => {
                otaStatus.innerHTML = 'Firmware upload successful. SOTAcat will now reboot.';
                uploadButton.textContent = 'Upload Complete';
                alert("Firmware upload successful.\nYour SOTAcat is rebooting with the new firmware.\nPlease restart your browser.");
            }, 2000);
            return null;
        }
        else {
            // Reset button state on error
            uploadButton.disabled = false;
            uploadButton.textContent = 'Upload Firmware';
            
            return response.text().then(text => {
                let errorData;
                try {
                    errorData = JSON.parse(text);
                }
                catch (e) {
                    throw new Error('Failed to parse error response from server');
                }
                throw new Error(errorData.error || 'Unknown error occurred');
            });
        }
    })
    .catch(error => {
        console.error('Firmware upload error:', error);
        otaStatus.innerHTML = `Firmware upload failed: ${error.message}`;
        alert(`Firmware upload failed: ${error.message}`);
        
        // Reset button state
        uploadButton.disabled = false;
        uploadButton.textContent = 'Upload Firmware';
    });
}

let submitSettingsAttached = false;

function attachSubmitSettings() {
    var wifiForm = document.getElementById("wifi-settings");
    wifiForm.addEventListener("submit", onSubmitSettings);
    submitSettingsAttached = true;
}

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

function onSettingsAppearing() {
    fetchSettings();
    if (!submitSettingsAttached)
        attachSubmitSettings();
    loadGpsLocation();
    attachSettingsEventListeners();
}

function attachSettingsEventListeners() {
    // Sync time button
    const syncTimeBtn = document.getElementById('sync-time-button');
    if (syncTimeBtn) {
        syncTimeBtn.addEventListener('click', syncTime);
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
