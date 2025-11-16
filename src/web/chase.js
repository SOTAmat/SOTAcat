// ============================================================================
// Chase Page Logic
// ============================================================================
// Unified page for tracking SOTA, POTA, and other xOTA spots via Spothole API

// Configuration constants - adjust these to change behavior
const CHASE_HISTORY_DURATION_SECONDS = 3600; // 1 hour (3600 seconds)
const CHASE_DEFAULT_MODE_FILTER = 'SSB'; // Default mode filter
const CHASE_API_SPOT_LIMIT = 500; // Maximum number of spots to fetch from API
const CHASE_MIN_REFRESH_INTERVAL_MS = 60000; // Minimum time between API calls (60 seconds)

// Global variables for chase page state
let typeFilter = null; // Type filter for xOTA programs (SOTA/POTA/etc.)
let modeFilter = null; // Mode filter state
let lastChaseRefreshTime = 0;
let lastChaseRefreshCompleteTime = 0; // Timestamp when last refresh completed
let refreshTimerInterval = null; // Timer for updating "last refresh" display
// Sort state variables
let sortField = "timestamp";
let lastSortField = sortField;
let descending = true;

// ============================================================================
// State Management Functions
// ============================================================================

function chase_saveSortState() {
    localStorage.setItem('chaseSortField', sortField);
    localStorage.setItem('chaseSortDescending', descending);
}

function chase_loadSortState() {
    const savedSortField = localStorage.getItem('chaseSortField');
    const savedSortDescending = localStorage.getItem('chaseSortDescending');

    if (savedSortField !== null) {
        sortField = savedSortField;
        lastSortField = savedSortField;
    } else {
        sortField = "timestamp";
        lastSortField = "timestamp";
    }

    if (savedSortDescending !== null) {
        descending = (savedSortDescending === 'true');
    } else {
        descending = true;
    }
}

// Type filter state management
function loadTypeFilter() {
    const savedType = localStorage.getItem('chaseTypeFilter');
    typeFilter = savedType !== null ? savedType : 'xOTA'; // Default to xOTA only (not DX cluster)
    return typeFilter;
}

function saveTypeFilter(type) {
    typeFilter = type;
    localStorage.setItem('chaseTypeFilter', type);
}

function onTypeFilterChange(type) {
    saveTypeFilter(type);
    chase_applyTableFilters();
}

// Mode filter state management
function loadGlobalModeFilter() {
    const savedMode = localStorage.getItem('globalModeFilter');
    modeFilter = savedMode !== null ? savedMode : 'All';
    return modeFilter;
}

function saveGlobalModeFilter(mode) {
    modeFilter = mode;
    localStorage.setItem('globalModeFilter', mode);
}

function applyGlobalModeFilter() {
    // Get the mode selector element
    const modeSelector = document.getElementById('mode-filter');
    if (modeSelector && modeFilter !== null) {
        modeSelector.value = modeFilter;
    }

    // Apply the filter to the current table
    chase_applyTableFilters();
}

function onModeFilterChange(mode) {
    saveGlobalModeFilter(mode);
    applyGlobalModeFilter();
}

// ============================================================================
// Utility Functions
// ============================================================================

// Update the "Last refresh X ago" display
function updateRefreshTimer() {
    const timerElement = document.getElementById('last-refresh-time');
    if (!timerElement) return;

    if (lastChaseRefreshCompleteTime === 0) {
        timerElement.textContent = 'Last refresh 0:00 ago';
        return;
    }

    const now = Date.now();
    const elapsedSeconds = Math.floor((now - lastChaseRefreshCompleteTime) / 1000);
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;

    timerElement.textContent = `Last refresh ${minutes}:${seconds.toString().padStart(2, '0')} ago`;
}

// Start the refresh timer interval
function startRefreshTimer() {
    // Clear any existing interval
    if (refreshTimerInterval) {
        clearInterval(refreshTimerInterval);
    }

    // Update immediately
    updateRefreshTimer();

    // Update every second
    refreshTimerInterval = setInterval(updateRefreshTimer, 1000);
}

// Stop the refresh timer interval
function stopRefreshTimer() {
    if (refreshTimerInterval) {
        clearInterval(refreshTimerInterval);
        refreshTimerInterval = null;
    }
}

// Frequency band detection for styling
function getFrequencyBand(frequencyHz) {
    const freqMHz = frequencyHz / 1000000;

    if (freqMHz >= 1.8 && freqMHz <= 2.0) return '160m';
    if (freqMHz >= 3.5 && freqMHz <= 4.0) return '80m';
    if (freqMHz >= 5.3 && freqMHz <= 5.4) return '60m';
    if (freqMHz >= 7.0 && freqMHz <= 7.3) return '40m';
    if (freqMHz >= 10.1 && freqMHz <= 10.15) return '30m';
    if (freqMHz >= 14.0 && freqMHz <= 14.35) return '20m';
    if (freqMHz >= 18.068 && freqMHz <= 18.168) return '17m';
    if (freqMHz >= 21.0 && freqMHz <= 21.45) return '15m';
    if (freqMHz >= 24.89 && freqMHz <= 24.99) return '12m';
    if (freqMHz >= 28.0 && freqMHz <= 29.7) return '10m';
    if (freqMHz >= 50.0 && freqMHz <= 54.0) return '6m';
    if (freqMHz >= 144.0 && freqMHz <= 148.0) return '2m';
    if (freqMHz >= 420.0 && freqMHz <= 450.0) return '70cm';
    if (freqMHz >= 1240.0 && freqMHz <= 1300.0) return '23cm';

    // Return null for frequencies outside amateur bands
    return null;
}

// Handle clickable frequencies - tune radio to selected frequency/mode
function tuneRadioHz(frequency, mode) {
    let useMode = mode.toUpperCase();
    if (useMode == "SSB") {
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

// ============================================================================
// Table Rendering
// ============================================================================

async function chase_updateChaseTable() {
    const data = await latestChaseJson;
    if (data == null) {
        console.info('Chase Json is null');
        return;
    }

    data.sort((a, b) => {
        if (a[sortField] < b[sortField]) return descending ? 1 : -1;
        if (a[sortField] > b[sortField]) return descending ? -1 : 1;
        return 0;
    });

    const tbody = document.querySelector('#chase-table tbody');
    let newTbody = document.createElement('tbody');

    data.forEach(spot => {
        const row = newTbody.insertRow();
        const modeType = spot.modeType;

        // Add classes for filtering
        row.classList.add(`row-mode-${modeType}`);
        row.classList.add(`row-type-${spot.sig}`); // Type-based class for filtering

        // Make entire row clickable to tune radio (except for links)
        row.style.cursor = 'pointer';
        row.onclick = function(event) {
            // Don't tune if user clicked on a link (Call or Ref columns)
            if (event.target.tagName === 'A' || event.target.closest('a')) {
                return; // Let the link handle it
            }
            // Tune the radio
            if (spot.hertz && spot.hertz > 0) {
                tuneRadioHz(spot.hertz, spot.modeType);
            }
        };

        // 1. UTC time
        const formattedTime = spot.timestamp.getUTCHours().toString().padStart(2, '0') + ':' +
                             spot.timestamp.getUTCMinutes().toString().padStart(2, '0');
        row.insertCell().textContent = formattedTime;

        // 2. Callsign
        const callsignCell = row.insertCell();
        const callsignLink = document.createElement('a');
        callsignLink.href = `https://qrz.com/db/${spot.baseCallsign}`;
        callsignLink.target = '_blank';
        callsignLink.textContent = spot.activatorCallsign;
        callsignCell.appendChild(callsignLink);

        // 3. MHz Frequency (styled digits, row click tunes radio)
        const frequencyCell = row.insertCell();
        if (spot.hertz && typeof spot.hertz === 'number') {
            const freqMHz = spot.hertz / 1000000;
            const [wholePart, fracPart] = freqMHz.toFixed(3).split('.');

            // Create styled frequency display with emphasis on MHz part
            const wholeSpan = document.createElement('span');
            wholeSpan.className = 'freq-whole';
            wholeSpan.textContent = wholePart;

            const fracSpan = document.createElement('span');
            fracSpan.className = 'freq-frac';
            fracSpan.textContent = '.' + fracPart;

            frequencyCell.appendChild(wholeSpan);
            frequencyCell.appendChild(fracSpan);

            // Add band coloring
            const band = getFrequencyBand(spot.hertz);
            if (band) {
                frequencyCell.classList.add('band-cell', `band-${band}`);
            }
        }

        // 4. Mode
        const modeCell = row.insertCell();
        modeCell.textContent = spot.mode.toUpperCase().trim();
        modeCell.classList.add('mode-cell');
        modeCell.classList.add(`mode-cell-${modeType}`);

        // 5. Type (xOTA program badge: SOTA/POTA/etc.)
        const typeCell = row.insertCell();
        const typeBadge = document.createElement('span');
        typeBadge.className = `type-badge type-badge-${spot.sig}`;
        typeBadge.textContent = spot.sig;
        typeCell.appendChild(typeBadge);

        // 6. Reference (with appropriate link based on type)
        const refCell = row.insertCell();

        // Generate appropriate link based on sig type
        if (spot.sig === 'SOTA' && spot.locationID !== '-') {
            const refLink = document.createElement('a');
            refLink.href = `https://sotl.as/summits/${spot.locationID}`;
            refLink.target = '_blank';
            refLink.textContent = spot.locationID;
            refCell.appendChild(refLink);
        } else if (spot.sig === 'POTA' && spot.locationID !== '-') {
            const refLink = document.createElement('a');
            refLink.href = `https://pota.app/#/park/${spot.locationID}`;
            refLink.target = '_blank';
            refLink.textContent = spot.locationID;
            refCell.appendChild(refLink);
        } else if (spot.sig === 'WWFF' && spot.locationID !== '-') {
            const refLink = document.createElement('a');
            refLink.href = `https://wwff.co/directory/?showRef=${spot.locationID}`;
            refLink.target = '_blank';
            refLink.textContent = spot.locationID;
            refCell.appendChild(refLink);
        } else {
            // Cluster or other types without reference - just show text (or dash)
            refCell.textContent = spot.locationID;
        }

        // 7. Distance
        row.insertCell().textContent = spot.distance.toLocaleString();

        // 8. Details
        row.insertCell().textContent = spot.details;

        // 9. Comments
        row.insertCell().textContent = spot.comments;
    });

    tbody.parentNode.replaceChild(newTbody, tbody);
    console.info('Chase table updated');

    setTimeout(chase_applyTableFilters, 0);
}

// ============================================================================
// Filtering
// ============================================================================

function chase_applyTableFilters() {
    const tableBody = document.querySelector('#chase-table tbody');
    if (!tableBody) {
        console.warn('Chase table body not found, cannot apply filters');
        return;
    }

    const allRows = tableBody.querySelectorAll('tr');
    if (allRows.length === 0) {
        console.warn('No rows in Chase table, skipping filter application');
        return;
    }

    // Get current filter settings
    const selectedMode = modeFilter || 'All';
    const selectedType = typeFilter || 'All';

    console.log(`Applying Chase filters - Mode: ${selectedMode}, Type: ${selectedType}, Rows: ${allRows.length}`);

    let visibleRows = 0;
    let hiddenRows = 0;

    allRows.forEach(row => {
        // Check filters
        let modeMatch = false;
        let typeMatch = false;

        // Mode filter
        if (selectedMode === "All") {
            modeMatch = true;
        } else if (selectedMode === "DATA") {
            modeMatch = row.classList.contains('row-mode-DATA') ||
                       row.classList.contains('row-mode-FT8') ||
                       row.classList.contains('row-mode-FT4');
        } else {
            modeMatch = row.classList.contains(`row-mode-${selectedMode}`);
        }

        // Type filter
        if (selectedType === "All") {
            typeMatch = true;
        } else if (selectedType === "xOTA") {
            // Show all xOTA spots (SOTA, POTA, WWFF, GMA, IOTA, WCA, etc.) but NOT Cluster
            typeMatch = !row.classList.contains('row-type-Cluster');
        } else if (selectedType === "Cluster") {
            // Show only DX cluster spots (non-xOTA)
            typeMatch = row.classList.contains('row-type-Cluster');
        } else {
            // Specific type (SOTA, POTA, WWFF, GMA, IOTA, WCA)
            typeMatch = row.classList.contains(`row-type-${selectedType}`);
        }

        // Show row only if ALL filters match
        if (modeMatch && typeMatch) {
            row.style.display = '';
            // Apply alternating row background based on visible row index
            row.classList.toggle('even-row', visibleRows % 2 === 1);
            visibleRows++;
        } else {
            row.style.display = 'none';
            row.classList.remove('even-row');
            hiddenRows++;
        }
    });

    console.log(`Chase filter applied: ${visibleRows} visible rows, ${hiddenRows} hidden rows`);
}

// ============================================================================
// Sorting
// ============================================================================

function chase_updateSortIndicators(headers, sortField, descending) {
    headers.forEach(header => {
        const span = header.querySelector('span[data-sort-field]');
        if (span && span.getAttribute('data-sort-field') === sortField) {
            span.setAttribute('data-sort-dir', descending ? 'desc' : 'asc');
        } else if (span) {
            span.removeAttribute('data-sort-dir');
        }
    });
}

// ============================================================================
// Data Fetching
// ============================================================================

async function refreshChaseJson(force) {
    // Get refresh button for UI feedback
    const refreshButton = document.getElementById('refresh-button');
    const originalText = refreshButton?.textContent;

    // Check rate limit
    const now = Date.now();
    const timeSinceLastFetch = now - lastChaseRefreshTime;

    if (!force && timeSinceLastFetch < CHASE_MIN_REFRESH_INTERVAL_MS) {
        console.info(`Chase rate limit: Skipping fetch, only ${Math.round(timeSinceLastFetch / 1000)}s since last fetch (min 60s)`);
        if (typeof chase_updateChaseTable === 'function') {
            chase_updateChaseTable();
        }
        return;
    }

    try {
        // Set button to refreshing state
        if (refreshButton) {
            refreshButton.textContent = 'Refreshing...';
            refreshButton.disabled = true;
            refreshButton.classList.add('btn-disabled');
        }

        console.log('Fetching Chase data from Spothole API');
        lastChaseRefreshTime = Date.now();

        // Build fetch options
        // NOTE: Always fetch all spots from Spothole API regardless of UI filters.
        // Filtering is done client-side in chase_applyTableFilters() for better UX
        // (allows users to toggle filters without re-fetching data).
        const fetchOptions = {
            max_age: CHASE_HISTORY_DURATION_SECONDS,
            limit: CHASE_API_SPOT_LIMIT,
            dedupe: true
        };

        // Get user location
        const location = await getLocation();

        // Fetch and process spots
        const spots = await fetchAndProcessSpots(fetchOptions, location, true);

        latestChaseJson = spots;
        console.info(`Chase Json updated: ${spots.length} spots`);

        if (typeof chase_updateChaseTable === 'function') {
            chase_updateChaseTable();
        } else {
            console.error('chase_updateChaseTable function not found');
        }

        // Update refresh complete time and restart timer
        lastChaseRefreshCompleteTime = Date.now();
        startRefreshTimer();

    } catch (error) {
        console.error('Error fetching or processing Chase data:', error);
        // Show error to user if this was a manual refresh
        if (force) {
            alert('Failed to fetch spots from Spothole API. Please check your internet connection and try again.');
        }
    } finally {
        // Restore button to original state
        if (refreshButton) {
            refreshButton.textContent = originalText || 'Refresh Now';
            refreshButton.disabled = false;
            refreshButton.classList.remove('btn-disabled');
        }
    }
}

// ============================================================================
// Page Lifecycle
// ============================================================================

function chaseOnAppearing() {
    console.info('Chase tab appearing');

    // Start the refresh timer
    startRefreshTimer();

    // Attach refresh button event listener
    const refreshButton = document.getElementById('refresh-button');
    if (refreshButton) {
        refreshButton.addEventListener('click', () => refreshChaseJson(true));
    }

    // Load all saved settings
    chase_loadSortState();

    // Load and apply filters
    loadGlobalModeFilter();

    // Override with Chase default if not set
    if (!modeFilter || modeFilter === 'All') {
        modeFilter = CHASE_DEFAULT_MODE_FILTER;
    }

    loadTypeFilter();

    const modeSelector = document.getElementById('mode-filter');
    if (modeSelector) {
        modeSelector.value = modeFilter;
        modeSelector.onchange = function() {
            onModeFilterChange(this.value);
        };
    }

    const typeSelector = document.getElementById('type-filter');
    if (typeSelector) {
        typeSelector.value = typeFilter;
        typeSelector.onchange = function() {
            onTypeFilterChange(this.value);
        };
    }

    // Load data
    if (latestChaseJson != null) {
        console.log('Chase tab appearing: Using existing data');
        chase_updateChaseTable();
    } else {
        console.log('Chase tab appearing: Fetching new data');
        refreshChaseJson(true);
    }

    // Set up column sorting
    const headers = document.querySelectorAll('#chase-table th');
    headers.forEach(header => {
        const sortSpan = header.querySelector('span[data-sort-field]');
        if (sortSpan) {
            header.replaceWith(header.cloneNode(true));
            const newHeader = document.querySelector(`#chase-table th span[data-sort-field='${sortSpan.getAttribute('data-sort-field')}']`).closest('th');

            newHeader.addEventListener('click', function() {
                const clickedSortField = sortSpan.getAttribute('data-sort-field');
                if (clickedSortField === lastSortField) {
                    descending = !descending;
                } else {
                    lastSortField = clickedSortField;
                    descending = true;
                }
                sortField = clickedSortField;
                chase_saveSortState();
                chase_updateSortIndicators(document.querySelectorAll('#chase-table th'), sortField, descending);
                chase_updateChaseTable();
            });
        }
    });

    chase_updateSortIndicators(document.querySelectorAll('#chase-table th'), sortField, descending);
}

function chaseOnLeaving() {
    console.info('Chase tab leaving');

    // Stop the refresh timer
    stopRefreshTimer();

    // Save all settings
    chase_saveSortState();
}
