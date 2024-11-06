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
    fetchAndUpdateElement('/api/v1/batteryPercent', 'batteryPercent');
    fetchAndUpdateElement('/api/v1/batteryVoltage', 'batteryVoltage');
}

updateBatteryInfo(); // Call the function immediately
setInterval(updateBatteryInfo, 60000); // Then refresh it every 1 minute

// ----------------------------------------------------------------------------
// Status:Connection
// ----------------------------------------------------------------------------
function updateConnectionStatus() {
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
        // Assuming global functions named after tabs with 'OnLeaving' suffix
        const onLeavingFunctionName = `${currentTabName}OnLeaving`;
        if (typeof window[onLeavingFunctionName] === 'function')
        {
            window[onLeavingFunctionName]();
        }

        // De-highlight the tab by removing the "tabActive" class from the button with the ID of currentTabName + 'TabButton'
        const tabButton = document.getElementById(currentTabName + 'TabButton');
        if (tabButton)
        {
            tabButton.classList.remove('tabActive');
        }
    }
}

// Keep track of loaded scripts
const loadedTabScripts = new Set();

// Check if the script for a given Tab has already been loaded to avoid duplicates
function loadTabScriptIfNeeded(tabName)
{
    const scriptPath = `${tabName}.js`;

    return new Promise((resolve, reject) =>
    {
        if (loadedTabScripts.has(scriptPath))
        {
            // Script already loaded, resolve immediately
            resolve();
            return;
        }

        fetch(scriptPath)
            .then(response =>
            {
                if (!response.ok)
                {
                    // If the script doesn't need to be loaded (e.g., not found), resolve the promise
                    resolve();
                    return;
                }
                const scriptTag = document.createElement('script');
                scriptTag.src = scriptPath;
                scriptTag.onload = () =>
                {
                    loadedTabScripts.add(scriptPath);
                    resolve(); // Resolve the promise once the script is loaded
                };
                scriptTag.onerror = reject; // Reject the promise on error
                document.body.appendChild(scriptTag);
            })
            .catch(reject);
    });
}

function openTab(tabName)
{
    cleanupCurrentTab();

    // Highlight the new current tab by adding the "tabActive" class to the button with the ID of currentTabName + 'TabButton'
    currentTabName = tabName.toLowerCase();
    const tabButton = document.getElementById(currentTabName + 'TabButton');
    if (tabButton)
    {
        tabButton.classList.add('tabActive');
    }

    const contentPath = `${currentTabName}.html`;
    fetch(contentPath)
        .then(response => response.text())
        .then(text => {
            document.getElementById('contentArea').innerHTML = text;
            return loadTabScriptIfNeeded(currentTabName);
        })
        .then(() => {
            // Once the script is loaded, call the onAppearing function
            const onAppearingFunctionName = `${currentTabName}OnAppearing`;
            if (typeof window[onAppearingFunctionName] === 'function') {
                window[onAppearingFunctionName]();
            }
        })
        .catch(error => console.error('Error loading tab content:', error));
}

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

// Further enrich base spot details with:
// - point = spot location (like Wc/NC-417)
// - hertz = frequency of transmission
// - timestamp = time of spot, in seconds since epoch UTC
// - baseCallsign = call sign omitting suffixes
// - mode = upcased mode as reported
// - modeType = one of CW, SSB, FT8, DATA, or OTHER (which is a catch-all)
// - duplicate = whether the spot is a duplicate of a prior spot (boolean)
// Return an array sorted by descending timestamp
async function enrichSpots(spots,
                           baseurl,
                           getTimeFunc,
                           getActivationLocationFunc,
                           getActivatorFunc,
                           getLocationDetailsFunc) {
    spots.forEach(spot => {
        spot.point = getActivationLocationFunc(spot);
        spot.hertz = spot.frequency * 1000 * 1000;
        spot.timestamp = getTimeFunc(spot);
        spot.baseCallsign = getActivatorFunc(spot).split("/")[0];
        spot.mode = spot.mode.toUpperCase();
        spot.modeType = spot.mode;
        if (!["CW", "SSB", "FM", "FT8", "DATA"].includes(spot.modeType))
            spot.modeType = "OTHER";
        spot.details = getLocationDetailsFunc(spot);
        spot.type = ("type" in spot) ? spot.type : null;
    });

    // find duplicates
    // first we must sport by time
    // then we keep track of which baseCallsigns we've already seen
    // and mark the spot as a duplicate if we see it again
    spots.sort((a, b) => b.timestamp - a.timestamp);
    const seenCallsigns = new Set(); // Set to track seen activatorCallsigns
    spots.forEach(spot => {
        spot.duplicate = seenCallsigns.hasOwnProperty(spot.baseCallsign); // Check if the callsign has already been seen
        seenCallsigns[spot.baseCallsign] = true; // Mark this callsign as seen
    });

    const { latitude: currentLat, longitude: currentLon } = await getLocation();
    const spotsWithDistance = await Promise.all(spots.map(async (spot) => {
        const summitCode = spot.point;

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

gLatestSotaJson = null;
gSotaEpoch = null;
gLatestPotaJson = null;

async function shouldCheckNewSpots(epoch) {
    if (!document.getElementById('autoRefreshSelector').checked) return false;
    if (epoch === null) return true;
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
        if (!force && gLatestSotaJson != null && !await shouldCheckNewSpots(gSotaEpoch)) {
            console.info('no new spots');
            return;
        }
        const limit = document.getElementById("historyDurationSelector").value;
        fetch(`https://api-db2.sota.org.uk/api/spots/${limit}/all/all/`,
              { headers: { 'Accept-Encoding': 'gzip, deflate, br, zstd' } })
            .then(result => result.json()) // Resolve the promise to get the JSON data
            .then(data => {
                gSotaEpoch = data[0]?.epoch ?? null;  // assume first spot's epoch is the one

                gLatestSotaJson = enrichSpots(data,
                                              'https://api-db2.sota.org.uk/api/summits',
                                              function(spot){return new Date(`${spot.timeStamp}`);}, // getTimeFunc
                                              function(spot){return spot.summitCode;},               // getCodeFunc
                                              function(spot){return spot.activatorCallsign;},        // getActivatorFunc
                                              function(spot){return `${spot.summitName}, ${spot.AltM}m, ${spot.points} points`;}); // getLocationDetailsFunc

                gLatestSotaJson.then(() => {
                    console.info('SOTA Json updated');
                    updateSotaTable();
                });
            })
            .catch(error => ({ error }));
    }
    else if (currentTabName === 'pota') {
        if (!force && gLatestPotaJson != null && !await shouldCheckNewSpots(null)) {
            console.info('no new spots');
            return;
        }
        fetch('https://api.pota.app/spot/activator',
              { headers: { 'Accept-Encoding': 'gzip, deflate, br, zstd' } })
            .then(result => result.json()) // Resolve the promise to get the JSON data
            .then(data => {
                gLatestPotaJson = enrichSpots(data,
                                              'https://api.pota.app/park',
                                              function(spot){return new Date(`${spot.spotTime}Z`);}, // getTimeFunc
                                              function(spot){return spot.reference;},                // getCodeFunc
                                              function(spot){return spot.activator;},                // getActivatorFunc
                                              function(spot){return spot.details;});                 // getLocationDetailsFunc
                gLatestPotaJson.then(() => {
                    console.info('POTA Json updated');
                    updatePotaTable();
                });
            })
            .catch(error => ({ error }));
    }
}

document.addEventListener('DOMContentLoaded', function() {
    openTab('sota');
});
