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

        // Store the values in localStorage
        localStorage.setItem('gpsLocationOverride', JSON.stringify({ latitude, longitude }));

        // Clear the distance cache to force recalculation with new location
        clearDistanceCache();

        // Force refresh of spots data with new location
        gLatestSotaJson = null;
        gLatestPotaJson = null;

        alert('GPS location override saved. The new location will be used for distance calculations.');
    } else {
        alert('Please enter a valid GPS location or use the Clear Override button to remove the override.');
    }
}

async function clearGpsLocation() {
    // Remove the GPS location override from localStorage
    localStorage.removeItem('gpsLocationOverride');

    // Clear the input field
    loadGpsLocation();

    // Clear the distance cache to force recalculation with default location
    clearDistanceCache();

    // Force refresh of spots data with new location
    gLatestSotaJson = null;
    gLatestPotaJson = null;

    alert('GPS location override cleared. Automatic location detection will be used.');
}

async function loadGpsLocation() {
    // Check if there's a saved GPS location
    const savedLocation = localStorage.getItem('gpsLocationOverride');
    if (savedLocation) {
        const { latitude, longitude } = JSON.parse(savedLocation);

        // Set the input value
        const gpsLocationInput = document.getElementById('gps-location');
        gpsLocationInput.value = `${latitude}, ${longitude}`;
    }
    else {
        const { latitude, longitude } = await getLocation();
        const gpsLocationInput = document.getElementById('gps-location');
        gpsLocationInput.value = `e.g. ${latitude}, ${longitude}`;
    }
}

function togglePasswordVisibility(inputId) {
    var passwordInput = document.getElementById(inputId);
    passwordInput.type = (passwordInput.type === "password") ? "text" : "password";
}

async function fetchSettings() {
    if (gLocalhost) return;
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
    if (gLocalhost) return;

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

gSubmitSettingsAttached = false;

function attachSubmitSettings() {
    var wifiForm = document.getElementById("wifi-settings");
    wifiForm.addEventListener("submit", onSubmitSettings);
    gSubmitSettingsAttached = true;
}

function settingsOnAppearing() {
    fetchSettings();
    if (!gSubmitSettingsAttached)
        attachSubmitSettings();
    loadGpsLocation();
}
