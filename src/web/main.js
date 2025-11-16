// ----------------------------------------------------------------------------
// Global variables used across tabs
// ----------------------------------------------------------------------------
// Data caches
let latestChaseJson = null; // Chase page data from Spothole API
// Check if the page is being served from localhost
const isLocalhost = (window.location.hostname === 'localhost' ||
                     window.location.hostname === '127.0.0.1' ||
                     window.location.hostname === '[::1]'); // IPv6 loopback

// ----------------------------------------------------------------------------
// Update status indicators
// ----------------------------------------------------------------------------
function fetchAndUpdateElement(url, elementId) {
    fetch(url)
        .then(response => {
            if (!response.ok) {
                if (response.status === 404) {
                    return '';
                }
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.text();
        })
        .then(text => {
            document.getElementById(elementId).textContent = text;
        })
        .catch(error => {
            document.getElementById(elementId).textContent = '??';
        });
}

// ----------------------------------------------------------------------------
// Status:Clock
// ----------------------------------------------------------------------------
function refreshUTCClock() {
    // Update the UTC clock, but only show the hours and the minutes and nothing else
    const utcTime = new Date().toUTCString();
    document.getElementById('current-utc-time').textContent = utcTime.slice(17, 22);
}

refreshUTCClock(); // Initial refresh
setInterval(refreshUTCClock, 10000); // Refresh every 10 seconds

// ----------------------------------------------------------------------------
// Status:Battery
// ----------------------------------------------------------------------------
function updateBatteryInfo() {
    if (isLocalhost) return;
    fetchAndUpdateElement('/api/v1/batteryPercent', 'battery-percent');
    fetchAndUpdateElement('/api/v1/batteryVoltage', 'battery-voltage');
}

updateBatteryInfo(); // Call the function immediately
setInterval(updateBatteryInfo, 60000); // Then refresh it every 1 minute

// ----------------------------------------------------------------------------
// Status:Connection
// ----------------------------------------------------------------------------
function updateConnectionStatus() {
    if (isLocalhost) return;
    fetchAndUpdateElement('/api/v1/connectionStatus', 'connection-status');
}

updateConnectionStatus(); // Call the function immediately
setInterval(updateConnectionStatus, 5000); // Then refresh it every 5 seconds


// ----------------------------------------------------------------------------
// Tab handling
// ----------------------------------------------------------------------------

let currentTabName = null;

// This function is called before loading new tab content.
// It calls the onLeaving function of the current tab if it exists.
function cleanupCurrentTab() {
    if (currentTabName) {
        // Call onLeaving function if it exists for the current tab
        const tabNameCapitalized = currentTabName.charAt(0).toUpperCase() + currentTabName.slice(1);
        const onLeavingFunctionName = `on${tabNameCapitalized}Leaving`;
        if (typeof window[onLeavingFunctionName] === 'function') {
            console.log(`Calling ${onLeavingFunctionName} function`);
            window[onLeavingFunctionName]();
        }
    }
}

// Save the currently active tab to localStorage
function saveActiveTab(tabName) {
    localStorage.setItem('activeTab', tabName.toLowerCase());
}

// Load the previously active tab from localStorage
function loadActiveTab() {
    const activeTab = localStorage.getItem('activeTab');
    return activeTab ? activeTab : 'chase'; // Default to 'chase' if no tab is saved
}

// Keep track of loaded scripts
const loadedTabScripts = new Set();

// Check if the script for a given Tab has already been loaded to avoid duplicates
function loadTabScriptIfNeeded(tabName) {
    const scriptPath = `${tabName}.js`;
    console.log(`Checking if script needs to be loaded: ${scriptPath}`);

    return new Promise((resolve, reject) => {
        if (loadedTabScripts.has(scriptPath)) {
            // Script already loaded, resolve immediately
            console.log(`Script ${scriptPath} already loaded, skipping`);
            resolve();
            return;
        }

        console.log(`Loading script: ${scriptPath}`);
        fetch(scriptPath)
            .then(response => {
                if (!response.ok) {
                    console.warn(`Script ${scriptPath} fetch failed with status: ${response.status}`);
                    // If the script doesn't need to be loaded (e.g., not found), resolve the promise
                    resolve();
                    return;
                }

                // Create script tag and add to document
                const scriptTag = document.createElement('script');
                scriptTag.src = scriptPath;
                scriptTag.onload = () => {
                    console.log(`Script ${scriptPath} loaded successfully`);
                    loadedTabScripts.add(scriptPath);
                    resolve(); // Resolve the promise once the script is loaded
                };
                scriptTag.onerror = (error) => {
                    console.error(`Error loading script ${scriptPath}:`, error);
                    reject(error);
                };

                // Add the script to the page
                document.body.appendChild(scriptTag);
            })
            .catch(error => {
                console.error(`Error fetching script ${scriptPath}:`, error);
                reject(error);
            });
    });
}

function openTab(tabName) {
    console.log(`Switching to tab: ${tabName}`);

    try {
        // Clean up current tab logic
        cleanupCurrentTab();

        // Explicitly remove 'tabActive' class from ALL tab buttons first
        document.querySelectorAll('.tabBar button').forEach(button => {
            button.classList.remove('tabActive');
        });

        // Set the new current tab name
        currentTabName = tabName.toLowerCase();
        console.log(`Current tab set to: ${currentTabName}`);

        // Find and highlight the active tab
        const tabButton = document.getElementById(currentTabName + '-tab-button');
        if (tabButton) {
            tabButton.classList.add('tabActive');
        } else {
            console.error(`Tab button for ${currentTabName} not found`);
        }

        // Save the active tab to localStorage
        saveActiveTab(currentTabName);

        const contentPath = `${currentTabName}.html`;
        console.log(`Fetching content from: ${contentPath}`);

        fetch(contentPath)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to fetch ${contentPath}: ${response.status} ${response.statusText}`);
                }
                return response.text();
            })
            .then(text => {
                document.getElementById('content-area').innerHTML = text;
                console.log(`Content for ${currentTabName} loaded`);
                return loadTabScriptIfNeeded(currentTabName);
            })
            .then(() => {
                // Once the script is loaded, call the onAppearing function
                const tabNameCapitalized = currentTabName.charAt(0).toUpperCase() + currentTabName.slice(1);
                const onAppearingFunctionName = `on${tabNameCapitalized}Appearing`;
                console.log(`Calling ${onAppearingFunctionName} function`);

                if (typeof window[onAppearingFunctionName] === 'function') {
                    try {
                        window[onAppearingFunctionName]();
                    } catch (error) {
                        console.error(`Error in ${onAppearingFunctionName}:`, error);
                        throw error;
                    }
                } else {
                    console.warn(`Function ${onAppearingFunctionName} not found`);
                }
                console.log(`Tab switch to ${currentTabName} complete`);
            })
            .catch(error => {
                console.error(`Error during tab switch to ${currentTabName}:`, error);
                // Attempt recovery by reloading the current tab
                alert(`Error switching tabs: ${error.message}\nPlease try once more, or reload the page if the issue persists.`);
            });
    } catch (error) {
        console.error(`Unexpected error in openTab(${tabName}):`, error);
    }
}

// Add to the DOMContentLoaded event listener in main.js
document.addEventListener('DOMContentLoaded', function () {
    console.log('DOMContentLoaded event fired');

    // Ensure all tab buttons use the same click handler
    document.querySelectorAll('.tabBar button').forEach(button => {
        button.addEventListener('click', function (event) {
            event.preventDefault();
            const tabName = this.getAttribute('data-tab');
            console.log(`Tab button clicked: ${tabName}`);
            openTab(tabName);
        });
    });

    // Get the active tab from localStorage
    const activeTab = loadActiveTab();
    console.log('Active tab from localStorage:', activeTab);

    // Initialize or open any tab in the UI
    openTab(activeTab);

    // Schedule version check after page loads
    setTimeout(() => {
        console.log('[Version Check] Executing initial version check');
        checkFirmwareVersion().catch(error => {
            console.log('[Version Check] Initial version check failed:', error);
            // Retry timer will be started automatically by checkFirmwareVersion
        });
    }, 1000);
});

// ----------------------------------------------------------------------------
// Enrichment and distance calculations
// ----------------------------------------------------------------------------

// Function to calculate distance between two points using the Haversine formula
// returns distance in kilometers
function calculateDistance(lat1, lon1, lat2, lon2) {
    function toRad(x) { return x * Math.PI / 180; }
    function squared(x) { return x * x }

    const R = 6371; // Earth's radius in kilometers
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = squared(Math.sin(dLat / 2)) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        squared(Math.sin(dLon / 2));
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

let gpsOverride = null;

async function getLocation() {
    // First check if there's a GPS location override from the backend
    if (gpsOverride) {
        console.log('Using cached GPS location override');
        return gpsOverride;
    }

    try {
        const response = await fetch('/api/v1/gps');
        const data = await response.json();
        if (data.gps_lat && data.gps_lon) {
            console.log('Using GPS location override from NVRAM');
            gpsOverride = { latitude: parseFloat(data.gps_lat), longitude: parseFloat(data.gps_lon) };
            return gpsOverride;
        }
    } catch (error) {
        console.error('Failed to fetch GPS override:', error);
    }

    // Otherwise, use IP-based geolocation
    // Unfortunately, the geolocation API is only available in HTTPS
    //
    //  return new Promise((resolve, reject) => {
    //      navigator.geolocation.getCurrentPosition(position => {
    //          const { latitude, longitude } = position.coords;
    //          resolve({ latitude, longitude });
    //      }, error => {
    //          console.error("Error getting location", error);
    //          reject(error);
    //      });
    //  });
    // So, we'll use a less accurate, but more available alternative
    try {
        // Use fetch API to get location from IP. Note: Ensure CORS policies are handled if calling from the browser.
        const response = await fetch('http://ip-api.com/json/?fields=status,message,lat,lon', {
            mode: 'cors' // This might be required for CORS requests if the server supports it.
        });
        const position = await response.json();
        if (response.ok && position.status === 'success') {
            // Extract latitude and longitude from the successful response
            const { lat: latitude, lon: longitude } = position;
            return { latitude, longitude };
        } else {
            // Handle error status or unsuccessful fetch operation
            throw new Error(position.message || "Failed to fetch location from IP-API");
        }
    } catch (error) {
        console.error("Error retrieving location: ", error);
        throw error; // Propagate the error to be handled by the caller
    }
}

// Cache to store distance by reference (summits, parks, etc.)
// We declare it outside the following function so that it can persist
// across function calls, but it's not really meant to be used outside
// of the conjunction of the function.
const distanceCache = {};

// used when GPS location changes
function clearDistanceCache() {
    // Clear the distance cache to force recalculation with new location
    for (const key in distanceCache) {
        delete distanceCache[key];
    }
    console.log('Distance cache cleared for location change');
}

// ----------------------------------------------------------------------------
// Version checking
// ----------------------------------------------------------------------------
const VERSION_CHECK_INTERVAL_DAYS = 1.0;
const VERSION_CHECK_STORAGE_KEY = 'sotacat_version_check';
const VERSION_CHECK_SUCCESS_KEY = 'sotacat_version_check_success';
const MANIFEST_URL = 'https://sotamat.com/wp-content/uploads/manifest.json';
const VERSION_CHECK_TIMEOUT_MS = 5000;
const VERSION_CHECK_RETRY_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// Global variable to track retry timer
let versionCheckRetryTimer = null;

// Start retry timer for failed version checks
function startVersionCheckRetryTimer() {
    // Clear any existing timer
    if (versionCheckRetryTimer) {
        clearInterval(versionCheckRetryTimer);
    }

    console.log('[Version Check] Starting retry timer (will retry every 15 minutes)');
    versionCheckRetryTimer = setInterval(async () => {
        console.log('[Version Check] Retry timer triggered - attempting version check');
        try {
            await checkFirmwareVersion(false); // false = automatic check
            // If we get here, the check succeeded, so stop retrying
            stopVersionCheckRetryTimer();
        } catch (error) {
            console.log('[Version Check] Retry failed:', error.message);
            // Keep retrying
        }
    }, VERSION_CHECK_RETRY_INTERVAL_MS);
}

// Stop retry timer
function stopVersionCheckRetryTimer() {
    if (versionCheckRetryTimer) {
        console.log('[Version Check] Stopping retry timer');
        clearInterval(versionCheckRetryTimer);
        versionCheckRetryTimer = null;
    }
}

// Add the version check functions
function normalizeVersion(versionString) {
    console.log('[Version Check] Parsing version string:', versionString);

    // Extract date and time components from version string
    let match;
    if (versionString.includes('-Release')) {
        // Handle manifest format (e.g., "2024-11-29_11:37-Release")
        match = versionString.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2}):(\d{2})/);
        console.log('[Version Check] Manifest format detected, match:', match);
    } else if (versionString.includes(':')) {
        // Handle device format (e.g., "AB6D_1:241129:2346-R")
        const parts = versionString.split(':');
        match = parts[1].match(/(\d{2})(\d{2})(\d{2})/);
        if (match && parts[2]) {
            const timeMatch = parts[2].match(/(\d{2})(\d{2})/);
            if (timeMatch) {
                match = [...match, timeMatch[1], timeMatch[2]];
            }
        }
        console.log('[Version Check] Device format detected, match:', match);
    }

    if (!match) {
        console.log('[Version Check] Failed to match version pattern');
        return null;
    }

    let year, month, day, hour, minute;

    if (versionString.includes('-Release')) {
        // Manifest format parsing
        year = parseInt(match[1]);
        month = parseInt(match[2]);
        day = parseInt(match[3]);
        hour = parseInt(match[4]);
        minute = parseInt(match[5]);
    } else {
        // Device format parsing
        year = 2000 + parseInt(match[1]);
        month = parseInt(match[2]);
        day = parseInt(match[3]);
        hour = parseInt(match[4] || '0');
        minute = parseInt(match[5] || '0');
    }

    // Adjust month after parsing (JS months are 0-based)
    const originalMonth = month;  // Save for logging
    month = month - 1;

    console.log('[Version Check] Parsed components:', {
        year, originalMonth, day, hour, minute
    });

    const date = new Date(Date.UTC(year, month, day, hour, minute));
    const timestamp = date.getTime() / 1000;

    console.log('[Version Check] Resulting timestamp:', timestamp,
        'Date:', date.toISOString());

    return timestamp;
}

function shouldCheckVersion() {
    const lastCheck = localStorage.getItem(VERSION_CHECK_STORAGE_KEY);
    console.log('[Version Check] Last check timestamp:', lastCheck);
    if (!lastCheck) {
        console.log('[Version Check] No previous check found, returning true');
        return true;
    }

    const lastCheckDate = new Date(parseInt(lastCheck));
    const now = new Date();
    const daysSinceLastCheck = (now - lastCheckDate) / (1000 * 60 * 60 * 24);

    console.log('[Version Check] Days since last check:', daysSinceLastCheck);
    console.log('[Version Check] Check interval:', VERSION_CHECK_INTERVAL_DAYS);
    const shouldCheck = daysSinceLastCheck >= VERSION_CHECK_INTERVAL_DAYS;
    console.log('[Version Check] Should check?', shouldCheck);
    return shouldCheck;
}

// Perform version check
async function checkFirmwareVersion(manualCheck = false) {
    console.log('[Version Check] Starting version check');
    if (!manualCheck && !shouldCheckVersion()) {
        console.log('[Version Check] Skipping check due to interval');
        return;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), VERSION_CHECK_TIMEOUT_MS);

        // Get current version from device
        console.log('[Version Check] Fetching current version from device');
        const response = await fetch('/api/v1/version', {
            signal: controller.signal
        });
        if (!response.ok) {
            const error = `Failed to get current version from device (HTTP ${response.status})`;
            console.warn('[Version Check]', error);
            if (manualCheck) {
                throw new Error(error);
            }
            return;
        }
        const currentVersion = await response.text();
        console.log('[Version Check] Current device version:', currentVersion);
        const currentBuildTime = normalizeVersion(currentVersion);
        if (!currentBuildTime) {
            const error = `Failed to parse current version format: ${currentVersion}`;
            console.error('[Version Check]', error);
            if (manualCheck) {
                throw new Error(error);
            }
            return;
        }

        // Fetch manifest (CORS required to read response body)
        // Add timestamp to URL to bypass cache
        const cacheBustUrl = `${MANIFEST_URL}?t=${Date.now()}`;
        console.log('[Version Check] Fetching manifest from:', cacheBustUrl);
        let manifestResponse;
        try {
            manifestResponse = await fetch(cacheBustUrl, {
                signal: controller.signal,
                mode: 'cors',
                headers: {
                    'Accept': 'application/json'
                }
            });
        } catch (fetchError) {
            const error = `Failed to fetch manifest from server: ${fetchError.message}`;
            console.warn('[Version Check]', error);
            if (manualCheck) {
                throw new Error(error);
            }
            return;
        }

        if (!manifestResponse.ok) {
            const error = `Failed to fetch manifest from server (HTTP ${manifestResponse.status})`;
            console.warn('[Version Check]', error);
            if (manualCheck) {
                throw new Error(error);
            }
            return;
        }

        let manifest;
        try {
            manifest = await manifestResponse.json();
        } catch (e) {
            const error = `Invalid JSON in manifest: ${e.message}`;
            console.warn('[Version Check]', error);
            if (manualCheck) {
                throw new Error(error);
            }
            return;
        }

        // Clear the timeout since we got our response
        clearTimeout(timeoutId);

        const latestVersion = normalizeVersion(manifest.version);
        if (!latestVersion) {
            const error = `Invalid version format in manifest: ${manifest.version}`;
            console.warn('[Version Check]', error);
            if (manualCheck) {
                throw new Error(error);
            }
            return;
        }

        // Compare versions using Unix timestamps
        console.info('[Version Check] Latest version timestamp:', new Date(latestVersion * 1000).toISOString());
        console.info('[Version Check] Current version timestamp:', new Date(currentBuildTime * 1000).toISOString());

        // Handle different cases for manual vs automatic checks
        let shouldUpdateTimestamp = false;

        if (manualCheck) {
            // Manual check - always show popup with version strings and update timestamp
            shouldUpdateTimestamp = true;
            const currentVersionString = currentVersion;
            const serverVersionString = manifest.version;

            if (latestVersion > currentBuildTime) {
                return `A new firmware is available: please update using instructions on the Settings page.\n\nYour version:\n${new Date(currentBuildTime * 1000).toISOString()}\nServer version:\n${new Date(latestVersion * 1000).toISOString()}`;
            } else if (latestVersion < currentBuildTime) {
                return `Your firmware is newer than the official version on the server.\n\nYour version:\n${new Date(currentBuildTime * 1000).toISOString()}\nServer version:\n${new Date(latestVersion * 1000).toISOString()}`;
            } else {
                return `You already have the current firmware. No update needed.\n\nYour version:\n${new Date(currentBuildTime * 1000).toISOString()}\nServer version:\n${new Date(latestVersion * 1000).toISOString()}`;
            }
        } else {
            // Automatic check - only show popup if firmware is different
            if (latestVersion > currentBuildTime) {
                // Newer firmware available - show dialog
                const userResponse = confirm(
                    'A new firmware version is available for your SOTAcat device.\n\n' +
                    'Would you like to go to the Settings page to update your firmware?\n\n' +
                    `Your version: ${new Date(currentBuildTime * 1000).toISOString()}\n` +
                    `New version: ${new Date(latestVersion * 1000).toISOString()}`
                );

                if (userResponse) {
                    openTab('Settings');
                    // User accepted - update timestamp so we don't bug them again today
                    shouldUpdateTimestamp = true;
                } else {
                    // User dismissed - don't update timestamp so we'll notify again tomorrow
                    console.log('[Version Check] User dismissed update notification - will retry tomorrow');
                }
            } else {
                // No update needed - update timestamp
                shouldUpdateTimestamp = true;
            }
        }

        // Only update timestamp if appropriate
        if (shouldUpdateTimestamp) {
            localStorage.setItem(VERSION_CHECK_STORAGE_KEY, Date.now().toString());
            console.log('[Version Check] Updated last check timestamp');
        }

        // Always track successful completion (even if we don't update the check timestamp)
        localStorage.setItem(VERSION_CHECK_SUCCESS_KEY, Date.now().toString());
        console.log('[Version Check] Version check completed successfully');

        // Stop retry timer on successful check
        stopVersionCheckRetryTimer();

    } catch (error) {
        console.log('[Version Check] Error during version check:', error.message);

        // Start retry timer for failed automatic checks
        if (!manualCheck) {
            startVersionCheckRetryTimer();
        }

        throw error;  // Re-throw to be caught by the caller
    }
}
