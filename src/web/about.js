// ----------------------------------------------------------------------------
// Info: Build Version and Type
// ----------------------------------------------------------------------------
function refreshVersion()
{
    if (gLocalhost) return;
    
    // Fetch the version and update both the original display and the parsed details
    fetch('/api/v1/version')
        .then(response => response.text())
        .then(versionString => {
            // Update the original version display
            document.getElementById('buildVersionSettings').textContent = versionString;
            // Update the parsed version details
            updateVersionDetails(versionString);
        })
        .catch(error => {
            console.error('Error fetching version:', error);
            document.getElementById('buildVersionSettings').textContent = 'Error loading version';
            document.getElementById('hardwareVersion').textContent = 'Hardware Version: Error';
            document.getElementById('firmwareDate').textContent = 'Firmware Date: Error';
            document.getElementById('buildType').textContent = 'Build Type: Error';
        });
}

function parseVersionString(versionString) {
    // Parse version string format: "AB6D_1:250928:0011-R"
    // Format: hardwareVersion:YYMMDD:HHMM-buildType
    
    try {
        // Split by colon first to separate hardware version from date/time
        const parts = versionString.split(':');
        if (parts.length !== 3) {
            throw new Error('Invalid version format');
        }
        
        const hardwareVersion = parts[0]; // "AB6D_1"
        const dateTimePart = parts[1]; // "250928"
        const timeBuildPart = parts[2]; // "0011-R"
        
        // Split time and build type by dash
        const timeBuildParts = timeBuildPart.split('-');
        if (timeBuildParts.length !== 2) {
            throw new Error('Invalid time/build format');
        }
        
        const timePart = timeBuildParts[0]; // "0011"
        const buildTypeCode = timeBuildParts[1]; // "R"
        
        // Format date: YYMMDD -> YY-MM-DD
        const year = dateTimePart.substring(0, 2);
        const month = dateTimePart.substring(2, 4);
        const day = dateTimePart.substring(4, 6);
        const formattedDate = `${year}-${month}-${day}`;
        
        // Format time: HHMM -> HH:MM
        const hours = timePart.substring(0, 2);
        const minutes = timePart.substring(2, 4);
        const formattedTime = `${hours}:${minutes}`;
        
        // Convert build type code to readable format
        let buildType;
        switch (buildTypeCode.toUpperCase()) {
            case 'D':
                buildType = 'Debug';
                break;
            case 'R':
                buildType = 'Release';
                break;
            default:
                buildType = buildTypeCode;
        }
        
        return {
            hardwareVersion: hardwareVersion,
            firmwareDate: `${formattedDate} ${formattedTime}`,
            buildType: buildType
        };
    } catch (error) {
        console.error('Error parsing version string:', error);
        return {
            hardwareVersion: 'Unknown',
            firmwareDate: 'Unknown',
            buildType: 'Unknown'
        };
    }
}

function updateVersionDetails(versionString) {
    const parsed = parseVersionString(versionString);
    
    document.getElementById('hardwareVersion').textContent = `Hardware Version: ${parsed.hardwareVersion}`;
    document.getElementById('firmwareDate').textContent = `Firmware Date: ${parsed.firmwareDate}`;
    document.getElementById('buildType').textContent = `Build Type: ${parsed.buildType}`;
}

function aboutOnAppearing()
{
    refreshVersion();
}

function aboutOnLeaving() {
    // No special cleanup needed for the About tab
}
