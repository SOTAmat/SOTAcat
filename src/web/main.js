// ----------------------------------------------------------------------------
// Global variables used across tabs
// ----------------------------------------------------------------------------
// Sort state variables
let gSortField = "timestamp";
let gLastSortField = gSortField;
let gDescending = true;
// Refresh interval timer
let gRefreshInterval = null;
// Data caches
let gLatestSotaJson = null;
let gSotaEpoch = null;
let gLatestPotaJson = null;
// Check if the page is being served from localhost
let gLocalhost = (window.location.hostname === 'localhost' ||
                  window.location.hostname === '127.0.0.1' ||
                  window.location.hostname === '[::1]'); // IPv6 loopback

// Add rate limiting for SOTA API
let gLastSotaFetchTime = 0;
const SOTA_MIN_FETCH_INTERVAL_MS = 60 * 1000; // 1 minute

// ----------------------------------------------------------------------------
// Launch SOTAmat application
// ----------------------------------------------------------------------------
function launchSOTAmat()
{
    var sotamat_base_url = 'sotamat://api/v1?app=sotacat&appversion=2.1';
    var currentUrl = window.location.href;
    var encodedReturnPath = encodeURIComponent(currentUrl);
    var newHref = sotamat_base_url + '&returnpath=' + encodedReturnPath;

    window.open(newHref, '_blank');
}


// ----------------------------------------------------------------------------
// Handle clickable frequencies
// ----------------------------------------------------------------------------
function tuneRadioMHz(freqMHz, mode) {  tuneRadioHz(parseFloat(freqMHz) * 1000000, mode);   }
function tuneRadioKHz(freqKHz, mode) {  tuneRadioHz(parseFloat(freqKHz) * 1000, mode);      }
function tuneRadioHz(frequency, mode)
{
    useMode = mode.toUpperCase();
    if (useMode == "SSB")
    {
        if (frequency < 10000000) useMode = "LSB";
        else useMode = "USB";
    }

    fetch('/api/v1/frequency?frequency=' + frequency, { method: 'PUT' })
    .then(response => {
        if (response.ok) {
                console.log('Frequency updated successfully');
                fetch('/api/v1/mode?bw=' + useMode, { method: 'PUT' })
                .then(response => {
                    if (response.ok)    {   console.log('Mode updated successfully');   }
                    else                {   console.error('Error updating mode');       }
                })
                .catch(error => console.error('Fetch error:', error));
        }
        else
        {
            console.error('Error updating frequency');
        }
    })
    .catch(error => console.error('Fetch error:', error));
}


// ----------------------------------------------------------------------------
// Update status indicators
// ----------------------------------------------------------------------------
function fetchAndUpdateElement(url, elementId) {
    fetch(url)
        .then(response => {
            if (!response.ok)
            {
                if (response.status === 404)
                {
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
// Info: Build Version and Type
// ----------------------------------------------------------------------------
function refreshVersion()
{
    if (gLocalhost) return;
    fetchAndUpdateElement('/api/v1/version', 'buildVersion');
}

refreshVersion(); // Initial and only refresh - the UI only needs to know this once

// ----------------------------------------------------------------------------
// Status:Clock
// ----------------------------------------------------------------------------
function refreshUTCClock()
{
    // Update the UTC clock, but only show the hours and the minutes and nothing else
    const utcTime = new Date().toUTCString();
    document.getElementById('currentUTCTime').textContent = utcTime.slice(17, 22);
}

refreshUTCClock(); // Initial refresh
setInterval(refreshUTCClock, 10000); // Refresh every 10 seconds

// ----------------------------------------------------------------------------
// Status:Battery
// ----------------------------------------------------------------------------
function updateBatteryInfo() {
    if (gLocalhost) return;
    fetchAndUpdateElement('/api/v1/batteryPercent', 'batteryPercent');
    fetchAndUpdateElement('/api/v1/batteryVoltage', 'batteryVoltage');
}

updateBatteryInfo(); // Call the function immediately
setInterval(updateBatteryInfo, 60000); // Then refresh it every 1 minute

// ----------------------------------------------------------------------------
// Status:Connection
// ----------------------------------------------------------------------------
function updateConnectionStatus() {
    if (gLocalhost) return;
    fetchAndUpdateElement('/api/v1/connectionStatus', 'connectionStatus');
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
        const onLeavingFunctionName = `${currentTabName}OnLeaving`;
        if (typeof window[onLeavingFunctionName] === 'function')
        {
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
    return activeTab ? activeTab : 'sota'; // Default to 'sota' if no tab is saved
}

// Keep track of loaded scripts
const loadedTabScripts = new Set();

// Check if the script for a given Tab has already been loaded to avoid duplicates
function loadTabScriptIfNeeded(tabName)
{
    // Skip script loading for tabs known not to have JS files
    if (tabName === 'about') {
        console.log(`Tab ${tabName} doesn't need a script, skipping`);
        return Promise.resolve();
    }

    const scriptPath = `${tabName}.js`;
    console.log(`Checking if script needs to be loaded: ${scriptPath}`);

    return new Promise((resolve, reject) =>
    {
        if (loadedTabScripts.has(scriptPath))
        {
            // Script already loaded, resolve immediately
            console.log(`Script ${scriptPath} already loaded, skipping`);
            resolve();
            return;
        }

        console.log(`Loading script: ${scriptPath}`);
        fetch(scriptPath)
            .then(response =>
            {
                if (!response.ok)
                {
                    console.warn(`Script ${scriptPath} fetch failed with status: ${response.status}`);
                    // If the script doesn't need to be loaded (e.g., not found), resolve the promise
                    resolve();
                    return;
                }
                
                // Create script tag and add to document
                const scriptTag = document.createElement('script');
                scriptTag.src = scriptPath;
                scriptTag.onload = () =>
                {
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

function openTab(tabName)
{
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
        const tabButton = document.getElementById(currentTabName + 'TabButton');
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
                document.getElementById('contentArea').innerHTML = text;
                console.log(`Content for ${currentTabName} loaded`);
                
                // The About tab doesn't need script loading
                if (currentTabName === 'about') {
                    // Call the placeholder function directly
                    aboutOnAppearing();
                    console.log(`Tab switch to ${currentTabName} complete`);
                    return Promise.resolve();
                }
                
                return loadTabScriptIfNeeded(currentTabName);
            })
            .then(() => {
                // Skip for the About tab as we've already handled it
                if (currentTabName === 'about') {
                    return;
                }
                
                // Once the script is loaded, call the onAppearing function
                const onAppearingFunctionName = `${currentTabName}OnAppearing`;
                console.log(`Calling ${onAppearingFunctionName} function`);
                
                // Ensure all required global variables are initialized
                if (typeof gRefreshInterval === 'undefined') {
                    console.warn('gRefreshInterval was undefined, initializing to null');
                    window.gRefreshInterval = null;
                }
                
                if (typeof window[onAppearingFunctionName] === 'function') {
                    try {
                        window[onAppearingFunctionName]();
                    } catch (error) {
                        console.error(`Error in ${onAppearingFunctionName}:`, error);
                        // Try to recover from common errors
                        if (error.message.includes('gRefreshInterval')) {
                            alert(`Error initializing tab: A refresh variable was not properly initialized.\nThe issue has been fixed. Please try again.`);
                        } else {
                            throw error; // Re-throw other errors
                        }
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
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOMContentLoaded event fired');
    
    // Ensure all tab buttons use the same click handler
    document.querySelectorAll('.tabBar button').forEach(button => {
        button.addEventListener('click', function(event) {
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
            console.log('[Version Check] Error during version check:', error);
        });
    }, 1000);
});

// ----------------------------------------------------------------------------
// Get SOTA/POTA data
// ----------------------------------------------------------------------------

// Function to calculate distance between two points using the Haversine formula
// returns distance in kilometers
function calculateDistance(lat1, lon1, lat2, lon2) {
    function toRad(x) { return x * Math.PI / 180; }
    function squared (x) { return x * x }

    const R = 6371; // Earth's radius in kilometers
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = squared(Math.sin(dLat / 2)) +
          Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
          squared(Math.sin(dLon / 2));
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

async function getLocation() {
    // First check if there's a GPS location override in localStorage
    const savedLocation = localStorage.getItem('gpsLocationOverride');
    if (savedLocation) {
        // Use the override location if it exists
        console.log('Using GPS location override from localStorage');
        return JSON.parse(savedLocation);
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

// Cache to store distance by summitCode.
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

// Further enrich base spot details with:
// - locationID = spot location (like W6/NC-417 or US-0041)
// - hertz = frequency of transmission
// - timestamp = time of spot, in seconds since epoch UTC
// - baseCallsign = call sign omitting suffixes
// - mode = upcased mode as reported
// - modeType = one of CW, SSB, FT8, FT4, DATA, or OTHER (which is a catch-all)
// - duplicate = whether the spot is a duplicate of a prior spot (boolean)
// Return an array sorted by descending timestamp
async function enrichSpots(spots,
                           baseurl,
                           getTimeFunc,
                           getActivationLocationFunc,
                           getActivatorFunc,
                           getLocationDetailsFunc,
                           getFrequencyHzFunc) {
    spots.forEach(spot => {
        spot.locationID = getActivationLocationFunc(spot);
        spot.hertz = getFrequencyHzFunc(spot);
        spot.timestamp = getTimeFunc(spot);
        spot.baseCallsign = getActivatorFunc(spot).split("/")[0];
        spot.mode = spot.mode.toUpperCase();
        spot.modeType = spot.mode;
        if (!["CW", "SSB", "FM", "FT8", "FT4", "DATA", "OTHER"].includes(spot.modeType))
            spot.modeType = "OTHER";
        spot.details = getLocationDetailsFunc(spot);
        spot.type = ("type" in spot) ? spot.type : null;
    });

    // find duplicates
    // first we must sport by time
    // then we keep track of which baseCallsigns we've already seen
    // and mark the spot as a duplicate if we see it again, unless it's a QRT spot.
    spots.sort((a, b) => b.timestamp - a.timestamp); // Sort descending (newest first)
    const seenCallsigns = new Set(); // Set to track seen activatorCallsigns
    spots.forEach(spot => {
        // Only mark as duplicate if the callsign was seen AND it's not a QRT spot.
        spot.duplicate = seenCallsigns.hasOwnProperty(spot.baseCallsign) && spot.type?.toUpperCase() !== 'QRT';
        seenCallsigns[spot.baseCallsign] = true; // Mark this callsign as seen regardless
    });

    const { latitude: currentLat, longitude: currentLon } = await getLocation();
    const spotsWithDistance = await Promise.all(spots.map(async (spot) => {
        const summitCode = spot.locationID;

        // Check if the summit's distance calculation is already in progress or done
        if (!distanceCache[summitCode]) {
            // If not, start the fetch and calculation, and store the promise in the cache
            distanceCache[summitCode] = (async () => {
                try {
                    const response = await fetch(`${baseurl}/${summitCode}`,
                                                 { headers: { 'Accept-Encoding': 'gzip, deflate, br, zstd' } });
                    if (!response.ok) {
                        // If the response status is not OK, throw an error to be caught by the catch block
                        throw new Error('Network response was not ok.');
                    }
                    const { latitude, longitude } = await response.json();
                    const distance = Math.round(calculateDistance(currentLat, currentLon, latitude, longitude));
                    return distance;
                } catch (error) {
                    console.error("Error calculating distance for summit", summitCode, error);
                    return 99999; // Set distance to a noticable number - on fetch or processing failure
                }
            })();
        }

        // Wait for the distance calculation to complete (either it was already in progress or just started above)
        const distance = await distanceCache[summitCode];

        // Return new spot object with distance included
        return {...spot, distance};
    }));

    return spotsWithDistance;
}

async function shouldCheckNewSpots(epoch) {
    const autoRefreshCheckbox = document.getElementById('autoRefreshSelector');
    const autoRefreshEnabled = autoRefreshCheckbox ? autoRefreshCheckbox.checked : false;
    
    if (!autoRefreshEnabled) {
        return false;
    }
    if (epoch === null) {
        return true;
    }
    
    // Check rate limit before making epoch API call
    const now = Date.now();
    const timeSinceLastFetch = now - gLastSotaFetchTime;
    if (timeSinceLastFetch < SOTA_MIN_FETCH_INTERVAL_MS) {
        return false; // Don't even check epoch if we're rate limited
    }
    
    try {
        // Fetch the latest epoch from the API
        const response = await fetch('https://api-db2.sota.org.uk/api/spots/epoch');
        if (!response.ok) {
            console.error('Failed to fetch epoch data:', response.statusText);
            return true; // safer to simply retrieve all the spots again
        }

        const latestEpoch = await response.text();
        return epoch !== latestEpoch;
    }
    catch (error) {
        console.error('Error fetching epoch or processing response:', error);
        return true; // safer to simply retrieve all the spots again
    }
}

async function refreshSotaPotaJson(force) {
    if (currentTabName === 'sota') {
        // Check rate limit for SOTA API
        const now = Date.now();
        const timeSinceLastFetch = now - gLastSotaFetchTime;
        
        if (!force && timeSinceLastFetch < SOTA_MIN_FETCH_INTERVAL_MS) {
            console.info(`SOTA rate limit: Skipping fetch, only ${Math.round(timeSinceLastFetch / 1000)}s since last fetch (min 60s)`);
            // Still update the table with cached data
            if (typeof sota_updateSotaTable === 'function') {
                sota_updateSotaTable();
            }
            return;
        }
        
        // Check if we should fetch new data
        const shouldCheck = await shouldCheckNewSpots(gSotaEpoch);
        
        // Always fetch data when switching to SOTA tab or when forced
        if (force || gLatestSotaJson == null || shouldCheck) {
            // Additional rate limit check for forced refreshes
            if (force && timeSinceLastFetch < SOTA_MIN_FETCH_INTERVAL_MS) {
                const remainingSeconds = Math.ceil((SOTA_MIN_FETCH_INTERVAL_MS - timeSinceLastFetch) / 1000);
                alert(`Please wait ${remainingSeconds} more seconds before refreshing. The SOTA API limits requests to once per minute.`);
                return;
            }
            
            const limit = document.getElementById("historyDurationSelector").value;
            try {
                console.log('Fetching SOTA data with limit:', limit);
                gLastSotaFetchTime = Date.now(); // Update last fetch time
                const result = await fetch(`https://api-db2.sota.org.uk/api/spots/${limit}/all/all/`,
                                         { headers: { 'Accept-Encoding': 'gzip, deflate, br, zstd' } });
                const data = await result.json();
                gSotaEpoch = data[0]?.epoch ?? null; // assume first spot's epoch is the one

                // Store the promise
                const enrichmentPromise = enrichSpots(data,
                                                  'https://api-db2.sota.org.uk/api/summits',
                                                  function(spot){return new Date(`${spot.timeStamp}`);}, // getTimeFunc
                                                  function(spot){return spot.summitCode;},               // getCodeFunc
                                                  function(spot){return spot.activatorCallsign;},        // getActivatorFunc
                                                  function(spot){return `${spot.summitName}, ${spot.AltM}m, ${spot.points} points`;}, // getLocationDetailsFunc
                                                  function(spot){ return (spot.frequency || 0) * 1000 * 1000; }); // getFrequencyHzFunc (SOTA: MHz -> Hz)

                // Wait for enrichment and then update the table
                gLatestSotaJson = await enrichmentPromise;
                console.info('SOTA Json updated and enriched');
                // Call the renamed function
                if (typeof sota_updateSotaTable === 'function') {
                    sota_updateSotaTable(); // Call updateSotaTable *after* enrichment is complete
                } else {
                    console.error('sota_updateSotaTable function not found when trying to update SOTA table');
                }

            } catch (error) {
                console.error('Error fetching or processing SOTA data:', error);
                // Handle error appropriately, maybe clear the table or show an error message
            }
        } else {
            console.info('Using cached SOTA data');
            // Make sure to update the table with cached data using the renamed function
            if (typeof sota_updateSotaTable === 'function') {
                sota_updateSotaTable();
            } else {
                console.error('sota_updateSotaTable function not found when trying to update SOTA table from cache');
            }
        }
    }
    else if (currentTabName === 'pota') {
        // Check if auto-refresh is enabled for POTA (since POTA doesn't have epoch checking)
        const autoRefreshCheckbox = document.getElementById('autoRefreshSelector');
        const autoRefreshEnabled = autoRefreshCheckbox ? autoRefreshCheckbox.checked : false;
        
        // Always fetch data when switching to POTA tab or when forced, or when auto-refresh is enabled
        if (force || gLatestPotaJson == null || autoRefreshEnabled) {
            try {
                console.log('Fetching POTA data');
                const result = await fetch('https://api.pota.app/spot/activator',
                                         { headers: { 'Accept-Encoding': 'gzip, deflate, br, zstd' } });
                const data = await result.json();

                const enrichmentPromise = enrichSpots(data,
                                                  'https://api.pota.app/park',
                                                  function(spot){return new Date(`${spot.spotTime}Z`);}, // getTimeFunc
                                                  function(spot){return spot.reference;},                // getCodeFunc
                                                  function(spot){return spot.activator;},                // getActivatorFunc
                                                  function(spot){return spot.details;},                 // getLocationDetailsFunc
                                                  function(spot){ return (spot.frequency || 0) * 1000; }); // getFrequencyHzFunc (POTA: KHz -> Hz)

                // Wait for enrichment and then update the table
                gLatestPotaJson = await enrichmentPromise;
                console.info('POTA Json updated and enriched');
                // Call the renamed function
                if (typeof pota_updatePotaTable === 'function') {
                    pota_updatePotaTable(); // Call updatePotaTable *after* enrichment is complete
                } else {
                     console.error('pota_updatePotaTable function not found when trying to update POTA table');
                }

            } catch (error) {
                console.error('Error fetching or processing POTA data:', error);
                // Handle error appropriately
            }
        } else {
            console.info('Using cached POTA data');
            // Make sure to update the table with cached data using the renamed function
            if (typeof pota_updatePotaTable === 'function') {
                pota_updatePotaTable();
            } else {
                console.error('pota_updatePotaTable function not found when trying to update POTA table from cache');
            }
        }
    }
}

const VERSION_CHECK_INTERVAL_DAYS = 1.0;
const VERSION_CHECK_STORAGE_KEY = 'sotacat_version_check';
const MANIFEST_URL = 'https://sotamat.com/wp-content/uploads/manifest.json';
const VERSION_CHECK_TIMEOUT_MS = 5000;

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
async function checkFirmwareVersion() {
    console.log('[Version Check] Starting version check');
    if (!shouldCheckVersion()) {
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
            console.log('[Version Check] Failed to get current version, status:', response.status);
            return;
        }
        const currentVersion = await response.text();
        console.log('[Version Check] Current device version:', currentVersion);
        const currentBuildTime = normalizeVersion(currentVersion);
        if (!currentBuildTime) {
            console.error('[Version Check] Failed to parse current version');
            return;
        }

        // Modify manifest fetch to handle CORS
        console.log('[Version Check] Fetching manifest from:', MANIFEST_URL);
        const manifestResponse = await fetch(MANIFEST_URL, {
            signal: controller.signal,
            mode: 'cors',  // Try CORS first
            headers: {
                'Accept': 'application/json'
            }
        }).catch(async () => {
            console.log('[Version Check] CORS failed, trying no-cors mode');
            // If CORS fails, try no-cors mode
            return fetch(MANIFEST_URL, {
                signal: controller.signal,
                mode: 'no-cors'  // Fallback to no-cors
            });
        });

        if (!manifestResponse.ok) {
            console.log('[Version Check] Failed to fetch manifest, status:', manifestResponse.status);
            return;
        }
        
        let manifest;
        try {
            manifest = await manifestResponse.json();
        } catch (e) {
            console.info('Version check skipped: Invalid manifest JSON');
            return;
        }
        
        // Clear the timeout since we got our response
        clearTimeout(timeoutId);
        
        const latestVersion = normalizeVersion(manifest.version);
        if (!latestVersion) {
            console.info('Version check skipped: Invalid version format in manifest');
            return;
        }

        // Compare versions using Unix timestamps
        console.info('[Version Check] Latest version timestamp:', new Date(latestVersion * 1000).toISOString());
        console.info('[Version Check] Current version timestamp:', new Date(currentBuildTime * 1000).toISOString());

        // Inform the user there is new firmware, and show them the datetime of the new version.
        if (latestVersion > currentBuildTime) {
            const userResponse = confirm(
                'A new firmware version is available for your SOTAcat device.\n\n' +
                'Would you like to go to the Settings page to update your firmware?\n\n' +
                `Your version: ${new Date(currentBuildTime * 1000).toISOString()}\n` +
                `New version: ${new Date(latestVersion    * 1000).toISOString()}`
            );
            
            if (userResponse) {
                openTab('Settings');
            }
        }
        
        // Update last check timestamp
        localStorage.setItem(VERSION_CHECK_STORAGE_KEY, Date.now().toString());
        
    } catch (error) {
        console.log('[Version Check] Error during version check:', error.message);
        throw error;  // Re-throw to be caught by the caller
    }
}

// ----------------------------------------------------------------------------
// Placeholder functions for tabs without dedicated JS files
// ----------------------------------------------------------------------------
function aboutOnAppearing() {
    console.log('About tab appearing');
    // No special initialization needed for the About tab
}

function aboutOnLeaving() {
    console.log('About tab leaving');
    // No special cleanup needed for the About tab
}
