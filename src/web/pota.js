// We'll keep these global sorting variables here for now,
// although they apply equally to sota and pota.
// Soon, we may collapse sota and pota display.
// NOTE: gSortField, gLastSortField, gDescending, gRefreshInterval are declared in sota.js
// Ensure sota.js is loaded before pota.js or declare them here if needed.

async function updatePotaTable()
{
    const data = await gLatestPotaJson;
    if (data == null)
    {
        console.info('POTA Json is null');
        return;
    }

    data.sort((a, b) => {
        if (a[gSortField] < b[gSortField]) return gDescending ? 1 : -1;
        if (a[gSortField] > b[gSortField]) return gDescending ? -1 : 1;
        return 0;
    });

    const tbody = document.querySelector('#potaTable tbody');
    let newTbody = document.createElement('tbody');

    data.forEach(spot => {
        const row = newTbody.insertRow();
        let modeType = spot.modeType;
        let isSpecial = false; // Flag for special row status

        // Check for duplicate
        if (spot.duplicate) {
            isSpecial = true;
        }
        // Check for QRT/QSY type (POTA API doesn't seem to have explicit QRT/QSY types like SOTA)
        // We might need to adapt this logic based on how POTA spots indicate QRT/QSY, if at all.
        // For now, we only mark duplicates as special.
        // if (spot.type && spot.type !== "" && spot.type !== "NORMAL") { ... }

        // Add common class if the row is special (currently only duplicates)
        if (isSpecial) {
            row.classList.add('special-row');
        }
        // Add a class to the row for mode filtering
        row.classList.add(`row-mode-${modeType}`);

        // 1. UTC time
        const formattedTime = spot.timestamp.getUTCHours().toString().padStart(2, '0') + ':' + spot.timestamp.getUTCMinutes().toString().padStart(2, '0');
        row.insertCell().textContent = formattedTime;

        // 2. Callsign
        const callsignCell = row.insertCell();
        const callsignLink = document.createElement('a');
        callsignLink.href = `https://qrz.com/db/${spot.baseCallsign}`; // QRZ.com doesn't support callsign suffixes
        callsignLink.textContent = spot.activator;
        callsignCell.appendChild(callsignLink);

        // 3. KHz Frequency
        const frequencyCell = row.insertCell();
        const frequencyLink = document.createElement('a');
        frequencyLink.href = `#`; // Placeholder
        // Use the enriched spot.hertz value
        if (spot.hertz && typeof spot.hertz === 'number' && spot.hertz > 0) {
           // Display frequency in KHz
           frequencyLink.textContent = (spot.hertz / 1000).toFixed(1);
           frequencyLink.onclick = function(event) {
              event.preventDefault(); // Prevent default link behavior
              // Use tuneRadioHz function which expects frequency in Hz
              tuneRadioHz(spot.hertz, spot.mode);
            }
        } else {
            // Handle cases where frequency is zero or invalid
            frequencyLink.textContent = '-'; // Or some other placeholder
        }
        frequencyCell.appendChild(frequencyLink);

        // 4. Mode
        const modeCell = row.insertCell(); // Get the cell itself
        modeCell.textContent = spot.mode.toUpperCase().trim();
        modeCell.classList.add('mode-cell'); // Add base class for common styling
        modeCell.classList.add(`mode-cell-${modeType}`); // Add specific class for color

        // 5. Park ID
        const parkCell = row.insertCell();
        const parkLink = document.createElement('a');
        parkLink.href = `https://pota.app/#/park/${spot.locationID}`;
        parkLink.textContent = `${spot.locationID}`;
        parkCell.appendChild(parkLink);

        // 6. Distance
        row.insertCell().textContent = spot.distance.toLocaleString();

        // 7. Location Description (assuming maps to Locator)
        row.insertCell().textContent = spot.locationDesc || ''; // Handle potential undefined

        // 8. Name (assuming maps to Details)
        row.insertCell().textContent = spot.name || ''; // Handle potential undefined

        // 9. Comments
        row.insertCell().textContent = spot.comments;
    });

    tbody.parentNode.replaceChild(newTbody, tbody);
    console.info('POTA table updated');

    // Apply combined filters AFTER the table is built
    applyTableFilters();
}

function potaOnAppearing() {
    console.info('POTA tab appearing');

    loadAutoRefreshCheckboxState();
    loadShowSpecialRowsState(); // Updated function name
    loadModeFilterState();
    loadHistoryDurationState(); // Added history duration loading

    refreshSotaPotaJson(false);
    if (gRefreshInterval == null)
        gRefreshInterval = setInterval(refreshSotaPotaJson, 60 * 1000); // one minute

    // Select the TH elements, not the inner SPANs
    const headers = document.querySelectorAll('#potaTable th'); 
    headers.forEach(header => {
        // Find the span inside for getting the field and attaching listener
        const sortSpan = header.querySelector('span[data-sort-field]');
        if (sortSpan) { // Ensure the span exists
            header.addEventListener('click', function() { // Add listener to TH
                const clickedSortField = sortSpan.getAttribute('data-sort-field');
                if (clickedSortField === gLastSortField) {
                    gDescending = !gDescending; // Toggle the sorting direction on each click
                } else {
                    gLastSortField = clickedSortField;
                    gDescending = true; // Default to descending on first click
                }
                gSortField = clickedSortField; // Update gSortField
                // Pass the TH NodeList to the local updateSortIndicators function
                updateSortIndicators(headers, gSortField, gDescending);
                updatePotaTable();
            });
        }
    });

    // Initially set the sort indicator and sort the table
    // Pass the TH NodeList
    updateSortIndicators(headers, gSortField, gDescending);
    // updatePotaTable(); // updatePotaTable is called by refreshSotaPotaJson, which also calls applyTableFilters
}

// History Duration

function saveHistoryDurationState()
{
    const value = document.getElementById('historyDurationSelector').value;
    localStorage.setItem('historyDuration', value); // Use same key as SOTA for now
}

function loadHistoryDurationState() {
    const savedState = localStorage.getItem('historyDuration');
    if (savedState !== null) {
        const selector = document.getElementById('historyDurationSelector');
        if (selector) selector.value = savedState;
    }
    // Note: POTA API fetch in main.js currently doesn't use this value.
    // Need to adjust refreshSotaPotaJson in main.js if POTA API supports time filtering.
}

// Auto-refresh spots

function saveAutoRefreshCheckboxState()
{
    const checkbox = document.getElementById('autoRefreshSelector');
    if (checkbox) localStorage.setItem('autoRefresh', checkbox.checked);
}

function changeAutoRefreshCheckboxState(autoRefresh) {
    // Currently no specific action needed when checkbox changes, besides saving state
}

function loadAutoRefreshCheckboxState()
{
    const savedState = localStorage.getItem('autoRefresh');
    if (savedState !== null) {
        const checkbox = document.getElementById('autoRefreshSelector');
        if (checkbox) {
            checkbox.checked = (savedState === 'true');
            changeAutoRefreshCheckboxState(checkbox.checked);
        }
    }
}

// Hide/Show Special Rows (QRT/QSY or Duplicates)

function saveShowSpecialRowsState() // Renamed from saveShowSpotDupsCheckboxState
{
    const isChecked = document.getElementById('showSpecialRowsSelector').checked; // Updated ID
    localStorage.setItem('showSpecialRows', isChecked);
}

// Renamed from changeShowSpotDupsCheckboxState
function changeShowSpecialRowsState(showSpecial) {
    applyTableFilters(); // Call the central filter function
}

function loadShowSpecialRowsState() // Renamed from loadShowSpotDupsCheckboxState
{
    const savedState = localStorage.getItem('showSpecialRows');
    let isChecked = true; // Default to true (checked) if nothing is saved

    // If there's a saved state, convert it to Boolean
    if (savedState !== null) {
        isChecked = (savedState === 'true');
    }
    // Set the checkbox state
    const checkbox = document.getElementById('showSpecialRowsSelector'); // Updated ID
    if (checkbox) {
        checkbox.checked = isChecked;
    }

    // Do NOT call changeShowSpecialRowsState here, it will be called after table update
    console.log(`Loaded ShowSpecialRows state: ${isChecked}`);
}

// Column sorting

function updateSortIndicators(headers, sortField, descending) {
    headers.forEach(header => {
        const span = header.querySelector('span[data-sort-field]'); // Ensure we target the span if present
        if (span && span.getAttribute('data-sort-field') === sortField) {
            span.setAttribute('data-sort-dir', descending ? 'desc' : 'asc');
        } else if (span) {
            span.removeAttribute('data-sort-dir');
        }
    });
}

// Mode filtering

function saveModeFilterState()
{
    const selector = document.getElementById('modeFilter');
    if (selector) localStorage.setItem('modeFilter', selector.value);
}

function loadModeFilterState()
{
    const savedState = localStorage.getItem('modeFilter');
    if (savedState !== null) {
        const selector = document.getElementById('modeFilter');
        if (selector) {
            selector.value = savedState;
            // Call changeModeFilter only if needed initially, handled by applyTableFilters in onAppearing
            // changeModeFilter(selector.value);
        }
    }
}

function changeModeFilter(selectedMode) {
    applyTableFilters(); // Call the central filter function
}

// Combined filter application logic (Adapted from sota.js)
function applyTableFilters() {
    const tableBody = document.querySelector('#potaTable tbody'); // Target POTA table
    if (!tableBody) return;

    const allRows = tableBody.querySelectorAll('tr');
    const selectedMode = document.getElementById('modeFilter').value;
    const showSpecialCheckbox = document.getElementById('showSpecialRowsSelector');
    const showSpecial = showSpecialCheckbox ? showSpecialCheckbox.checked : true; // Default to true if checkbox not found

    console.log(`Applying POTA filters - Mode: ${selectedMode}, ShowSpecial: ${showSpecial}`);

    allRows.forEach(row => {
        // POTA doesn't have an explicit QRT class yet, so isQRT is always false
        const isQRT = false; // row.classList.contains('row-mode-QRT');
        const isSpecial = row.classList.contains('special-row'); // Includes duplicates

        // Special case: Always show QRT rows if ShowQRT/QSY is checked, regardless of mode filter
        // (This case is currently inactive for POTA as isQRT is false)
        if (isQRT && showSpecial) {
            row.style.display = '';
            return; // Use return instead of continue in forEach callback
        }

        // Normal filtering logic for all other rows
        let modeMatch = false;
        let specialAllowed = false;

        // Check mode filter
        if (selectedMode === "All" || row.classList.contains(`row-mode-${selectedMode}`)) {
            modeMatch = true;
        }

        // Check special row filter (applies to non-QRT special rows, or QRT rows when checkbox is off)
        if (!isSpecial || (isSpecial && showSpecial)) {
            specialAllowed = true;
        }

        // Set display based on BOTH filters for non-QRT rows or when QRT is hidden
        if (modeMatch && specialAllowed) {
            row.style.display = ''; // Show row
        } else {
            row.style.display = 'none'; // Hide row
        }
    });
}

// Page settings

function potaOnAppearing() {
    console.info('POTA tab appearing');

    loadAutoRefreshCheckboxState();
    loadShowSpecialRowsState(); // Updated function name
    loadModeFilterState();
    loadHistoryDurationState(); // Added history duration loading

    refreshSotaPotaJson(false);
    if (gRefreshInterval == null)
        gRefreshInterval = setInterval(refreshSotaPotaJson, 60 * 1000); // one minute

    const headers = document.querySelectorAll('#potaTable th'); 
    headers.forEach(header => {
        const sortSpan = header.querySelector('span[data-sort-field]');
        if (sortSpan) {
            header.addEventListener('click', function() {
                const clickedSortField = sortSpan.getAttribute('data-sort-field');
                if (clickedSortField === gLastSortField) {
                    gDescending = !gDescending;
                } else {
                    gLastSortField = clickedSortField;
                    gDescending = true;
                }
                gSortField = clickedSortField;
                updateSortIndicators(headers, gSortField, gDescending);
                updatePotaTable();
            });
        }
    });

    updateSortIndicators(headers, gSortField, gDescending);
}

// Cleanup when tab is left (if necessary)
function potaOnLeaving() {
    console.info('POTA tab leaving');
    // Clear the refresh interval if it's running specifically for this tab
    // Assuming gRefreshInterval might be shared or managed elsewhere, maybe not needed
    // if (gRefreshInterval) {
    //     clearInterval(gRefreshInterval);
    //     gRefreshInterval = null;
    // }
}
