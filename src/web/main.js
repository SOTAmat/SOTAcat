var sotamat_base_url = 'sotamat://api/v1?app=sotacat&appversion=2.1';

function launchSOTAmat()
{
    var currentUrl = window.location.href;
    var encodedReturnPath = encodeURIComponent(currentUrl);
    var newHref = sotamat_base_url + '&returnpath=' + encodedReturnPath;

    window.open(newHref, '_blank');
}


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
        if (response.ok)    {   console.log('Frequency updated successfully');  }
        else                {   console.error('Error updating frequency');      }
    })
    .catch(error => console.error('Fetch error:', error));

    fetch('/api/v1/rxBandwidth?bw=' + useMode, { method: 'PUT' })
    .then(response => {
        if (response.ok)    {   console.log('Mode updated successfully');   }
        else                {   console.error('Error updating mode');       }
    })
    .catch(error => console.error('Fetch error:', error));
}


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

function updateBatteryInfo() {
    fetchAndUpdateElement('/api/v1/batteryPercent', 'batteryPercent');
    fetchAndUpdateElement('/api/v1/batteryVoltage', 'batteryVoltage');
}

updateBatteryInfo(); // Call the function immediately
setInterval(updateBatteryInfo, 60000); // Then refresh it every 1 minute



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


document.addEventListener('DOMContentLoaded',
    function()
    {
        openTab('sota'); // Load the default tab content on initial load
    }
);


gLatestSotaJson = null;
gLatestPotaJson = null;

async function refreshSotaPotaJson()
{
    const sotaPromise = fetch('https://api2.sota.org.uk/api/spots/-1/all').then(res => res.json()).catch(error => ({ error }));
    const potaPromise = fetch('https://api.pota.app/spot/activator').then(res => res.json()).catch(error => ({ error }));

    const results = await Promise.allSettled([sotaPromise, potaPromise]); // Fetch both SOTA and POTA JSON in parallel, regardless of success

    results.forEach((result, index) =>
    {
        if (result.status === 'fulfilled')
        {
            if (index === 0)
            { // SOTA
                gLatestSotaJson = result.value;
                console.info('SOTA Json updated');
            }
            else if (index === 1)
            { // POTA
                gLatestPotaJson = result.value;
                console.info('POTA Json updated');
            }

            // If the SOTA page is currently open, update the SOTA table
            if (currentTabName === 'sota')
            {
                updateSotaTable();
            }
            // If the POTA page is currently open, update the POTA table
            else if (currentTabName === 'pota')
            {
                updatePotaTable();
            }
        }
        else
        {
            console.error('Error fetching JSON:', result.reason);
        }
    });
}

refreshSotaPotaJson(); // Initial refresh
setInterval(refreshSotaPotaJson, 60000); // Refresh every minute

function refreshUTCClock()
{
    // Update the UTC clock, but only show the hours and the minutes and nothging else
    const utcTime = new Date().toUTCString();
    document.getElementById('currentUTCTime').textContent = utcTime.slice(17, 22);
}

refreshUTCClock(); // Initial refresh
setInterval(refreshUTCClock, 10000); // Refresh every 10 seconds