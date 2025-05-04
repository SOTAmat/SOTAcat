// We'll keep these global sorting variables here for now,
// although they apply equally to sota and pota.
// Soon, we may collapse sota and pota display.
gSortField = "timestamp";
gLastSortField = gSortField;
gDescending = true;
gRefreshInterval = null;

async function updateSotaTable()
{
    const data = await gLatestSotaJson;
    if (data == null) {
        console.info('SOTA Json is null');
        return;
    }

    data.sort((a, b) => {
        if (a[gSortField] < b[gSortField]) return gDescending ? 1 : -1;
        if (a[gSortField] > b[gSortField]) return gDescending ? -1 : 1;
        return 0;
    });

    const tbody = document.querySelector('#sotaTable tbody');
    let newTbody = document.createElement('tbody');

    data.forEach(spot =>
    {
        const row = newTbody.insertRow();
        let modeType = spot.modeType;
        let isSpecial = false; // Flag for special row status

        // Check for duplicate
        if (spot.duplicate) {
            // row.classList.add('duplicate-row'); // Keep for potential separate duplicate styling if needed later
            isSpecial = true;
        }
        // Check for QRT/QSY type
        if (spot.type && spot.type !== "" && spot.type !== "NORMAL") {
            spot.mode = spot.type;
            // Explicitly check for QRT to set the correct modeType for cell styling
            if (spot.type.toUpperCase() === 'QRT') {
                modeType = 'QRT'; // Use QRT for the specific class
            } else {
                // Decide how to handle other non-normal types like QSY if needed
                // For now, let's keep the original modeType if it's not QRT
                // modeType = spot.modeType; // This line might be redundant if modeType is already set
            }
            isSpecial = true;
        }

        // Add common class if either condition is met
        if (isSpecial) {
            row.classList.add('special-row');
        }
        // Add a class to the row for mode filtering
        row.classList.add(`row-mode-${modeType}`);

        // UTC time
        const formattedTime = spot.timestamp.getUTCHours().toString().padStart(2, '0') + ':' + spot.timestamp.getUTCMinutes().toString().padStart(2, '0');
        row.insertCell().textContent = formattedTime;

        // Callsign
        const callsignCell = row.insertCell();
        const callsignLink = document.createElement('a');
        callsignLink.href = `https://qrz.com/db/${spot.baseCallsign}`; // QRZ.com doesn't support callsign suffixes
        callsignLink.textContent = spot.activatorCallsign;
        callsignCell.appendChild(callsignLink);

        // MHz Frequency
        const frequencyCell = row.insertCell();
        const frequencyLink = document.createElement('a');
        frequencyLink.href = '#';  // Placeholder href to ensure link styling
        if (spot.frequency && typeof spot.frequency === 'number') {
           frequencyLink.textContent = spot.frequency.toFixed(3);
           frequencyLink.onclick = function(event) {
              event.preventDefault(); // Prevent default link behavior
              tuneRadioMHz(spot.frequency, spot.mode);
            }
        }
        frequencyCell.appendChild(frequencyLink);

        // Mode
        const modeCell = row.insertCell(); // Get the cell itself
        modeCell.textContent = spot.mode.toUpperCase().trim();
        modeCell.classList.add('mode-cell'); // Add base class for common styling
        modeCell.classList.add(`mode-cell-${modeType}`); // Add specific class for color
        // Remove the row class for mode type as we now style the cell
        // row.classList.add('mode-' + spot.modeType);

        // Summit
        const summitCell = row.insertCell();
        const summitLink = document.createElement('a');
        summitLink.href = `https://sotl.as/summits/${spot.locationID}`;
        summitLink.textContent = spot.locationID;
        summitCell.appendChild(summitLink);

        // Distance
        row.insertCell().textContent = spot.distance.toLocaleString();

        // Name
        row.insertCell().textContent = spot.activatorName;

        // Details
        row.insertCell().textContent = spot.details;

        // Comments
        row.insertCell().textContent = spot.comments;
    });

    tbody.parentNode.replaceChild(newTbody, tbody);
    console.info('SOTA table updated');

    // Apply combined filters AFTER the table is built
    applyTableFilters();
}

// History Duration

function saveHistoryDurationState()
{
    const value = document.getElementById('historyDurationSelector').value;
    localStorage.setItem('historyDuration', value);
}

function loadHistoryDurationState() {
    const savedState = localStorage.getItem('historyDuration');
    // If there's a saved state, convert it to Boolean and set the checkbox
    if (savedState !== null)
        document.getElementById('historyDurationSelector').value = savedState;
}

// Auto-refresh spots

function saveAutoRefreshCheckboxState()
{
    const isChecked = document.getElementById('autoRefreshSelector').checked;
    localStorage.setItem('autoRefresh', isChecked);
}

function changeAutoRefreshCheckboxState(autoRefresh) {
}

function loadAutoRefreshCheckboxState()
{
    const savedState = localStorage.getItem('autoRefresh');
    // If there's a saved state, convert it to Boolean and set the checkbox
    if (savedState !== null) {
        document.getElementById('autoRefreshSelector').checked = (savedState === 'true');
        changeAutoRefreshCheckboxState(document.getElementById('autoRefreshSelector').checked);
    }
}

// Hide/Show Special Rows (QRT/QSY or Duplicates)

function saveShowSpecialRowsState()
{
    const isChecked = document.getElementById('showDupsSelector').checked;
    localStorage.setItem('showSpecialRows', isChecked);
}

function changeShowSpecialRowsState(showSpecial) {
    applyTableFilters(); // Call the central filter function
}

function loadShowSpecialRowsState()
{
    const savedState = localStorage.getItem('showSpecialRows');
    let isChecked = true; // Default to true (checked) if nothing is saved

    // If there's a saved state, convert it to Boolean
    if (savedState !== null) {
        isChecked = (savedState === 'true');
    }
    // Set the checkbox state
    document.getElementById('showDupsSelector').checked = isChecked;

    // Do NOT call changeShowSpecialRowsState here, it will be called after table update
    console.log(`Loaded ShowSpecialRows state: ${isChecked}`);
}

// Column sorting

// Restore the function definition locally for SOTA
function updateSortIndicators(headers, sortField, descending) { // Expects a NodeList of TH elements
    headers.forEach(header => {
        const span = header.querySelector('span[data-sort-field]'); // Finds span inside TH
        if (span && span.getAttribute('data-sort-field') === sortField) {
            span.setAttribute('data-sort-dir', descending ? 'desc' : 'asc'); // Modifies span
        } else if (span) {
            span.removeAttribute('data-sort-dir'); // Modifies span
        }
    });
}

// Mode filtering

function saveModeFilterState()
{
    const value = document.getElementById('modeFilter').value;
    localStorage.setItem('modeFilter', value);
}

function loadModeFilterState()
{
    const savedState = localStorage.getItem('modeFilter');
    if (savedState !== null) {
        document.getElementById('modeFilter').value = savedState;
        changeModeFilter(document.getElementById('modeFilter').value);
    }
}

function changeModeFilter(selectedMode) {
    applyTableFilters(); // Call the central filter function
}

// Combined filter application logic
function applyTableFilters() {
    const tableBody = document.querySelector('#sotaTable tbody');
    if (!tableBody) return;

    const allRows = tableBody.querySelectorAll('tr');
    const selectedMode = document.getElementById('modeFilter').value;
    const showSpecial = document.getElementById('showDupsSelector').checked;

    console.log(`Applying filters - Mode: ${selectedMode}, ShowSpecial: ${showSpecial}`);

    allRows.forEach(row => {
        const isQRT = row.classList.contains('row-mode-QRT');
        const isSpecial = row.classList.contains('special-row'); // Includes QRT and duplicates

        // Special case: Always show QRT rows if ShowQRT/QSY is checked, regardless of mode filter
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

function sotaOnAppearing() {
    console.info('SOTA tab appearing');

    loadAutoRefreshCheckboxState();
    loadShowSpecialRowsState();
    loadModeFilterState();
    loadHistoryDurationState();

    refreshSotaPotaJson(false);
    if (gRefreshInterval == null)
        gRefreshInterval = setInterval(refreshSotaPotaJson, 60 * 1000); // one minute

    // Get TH elements instead of SPANs
    const headers = document.querySelectorAll('#sotaTable th');
    headers.forEach(header => {
        // Find the span inside the TH for getting the sort field
        const sortSpan = header.querySelector('span[data-sort-field]');
        if (sortSpan) { // Check if the span exists
            header.addEventListener('click', function() {
                // Use the span's attribute
                const clickedSortField = sortSpan.getAttribute('data-sort-field');
                if (clickedSortField === gLastSortField) {
                    gDescending = !gDescending; // Toggle the sorting direction on each click
                } else {
                    gLastSortField = clickedSortField;
                    gDescending = true; // Default to descending on first click
                }
                gSortField = clickedSortField; // Update gSortField
                // Pass the TH NodeList to the LOCAL updateSortIndicators function
                updateSortIndicators(headers, gSortField, gDescending);
                updateSotaTable();
            });
        }
    });
    // Initially set the sort indicator and sort the table
    // Pass the TH NodeList
    updateSortIndicators(headers, gSortField, gDescending);
    // updateSotaTable(); // Called by refreshSotaPotaJson
}

function sotaOnLeaving() {
    console.info('SOTA tab leaving');
    // Optional: Clear interval if needed, similar to potaOnLeaving
}
