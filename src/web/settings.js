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

function togglePasswordVisibility(inputId) {
    var passwordInput = document.getElementById(inputId);
    passwordInput.type = (passwordInput.type === "password") ? "text" : "password";
}

async function fetchSettings() {
    try {
        const response = await fetch('/api/v1/settings', { method: 'GET' });
        const data = await response.json();

        document.getElementById('sta1-ssid').value = data.sta1_ssid;
        document.getElementById('sta1-pass').value = data.sta1_pass;
        document.getElementById('sta2-ssid').value = data.sta2_ssid;
        document.getElementById('sta2-pass').value = data.sta2_pass;
        document.getElementById('ap-ssid').value = data.ap_ssid;
        document.getElementById('ap-pass').value = data.ap_pass;
    } catch (error) {
        console.error('Failed to fetch settings:', error);
    }
}

function saveSettings() {
    console.log("Saving settings...");

    const settings = {
        sta1_ssid: document.getElementById('sta1-ssid').value,
        sta1_pass: document.getElementById('sta1-pass').value,
        sta2_ssid: document.getElementById('sta2-ssid').value,
        sta2_pass: document.getElementById('sta2-pass').value,
        ap_ssid:   document.getElementById('ap-ssid').value,
        ap_pass:   document.getElementById('ap-pass').value,
    };

    fetch('/api/v1/settings', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(settings),
    })
    .then(response => response.json())
    .then(data => {
        console.log('Success:', data);
        alert("Settings saved successfully!\nYour SOTAcat is rebooting with the new settings.\nPlease restart your browser.");
    })
    .catch((error) => {
        console.error('Error:', error);
        alert('Failed to save settings.');
    });
}

function customCheckSettingsValidity() {
    // Define pairs of SSID and password inputs
    const wifiPairs = [
        { ssid: document.getElementById('sta1-ssid'), pass: document.getElementById('sta1-pass') },
        { ssid: document.getElementById('sta2-ssid'), pass: document.getElementById('sta2-pass') },
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
    const file = otaFileInput.files[0];

    if (!file) {
        alert('Please select a firmware file to upload.');
        return;
    }

    const blob = new Blob([file], { type: 'application/octet-stream' });

    fetch('/api/v1/ota', {
        method: 'POST',
        headers: {'Content-Type': 'application/octet-stream' },
        body: blob
    })
    .then(response => {
        if (response.ok) {
            // Successful OTA upload, no content returned
            otaStatus.innerHTML = 'Firmware upload successful. SOTAcat will now reboot.';
            alert("Firmware upload successful.\nYour SOTAcat is rebooting with the new firmware.\nPlease restart your browser.");
            return null;  // No further processing needed
        }
        else {
            // Error occurred, expecting a JSON error message in a "text/plain" content type
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
        alert(`Firmware upload failed: ${message.error}`);
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
}
