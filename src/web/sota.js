// We'll keep these global sorting variables here for now,
// although they apply equally to sota and pota.
// Soon, we may collapse sota and pota display.
// NOTE: These variables are now declared in main.js
// gSortField = "timestamp";
// gLastSortField = gSortField;
// gDescending = true;
// gRefreshInterval = null;

// Add functions to save and load sort state
function sota_saveSortState() {
    localStorage.setItem('sotaSortField', gSortField);
    localStorage.setItem('sotaSortDescending', gDescending);
}

function sota_loadSortState() {
    const savedSortField = localStorage.getItem('sotaSortField');
    const savedSortDescending = localStorage.getItem('sotaSortDescending');
    
    if (savedSortField !== null) {
        gSortField = savedSortField;
        gLastSortField = savedSortField;
    }
    
    if (savedSortDescending !== null) {
        gDescending = (savedSortDescending === 'true');
    }
}

async function sota_updateSotaTable()
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
        callsignLink.target = '_blank'; // opens the link in a new tab
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
        summitLink.target = '_blank'; // opens the link in a new tab
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

    // Apply combined filters AFTER the table is built and the DOM has likely updated
    // Use setTimeout to defer the filter application slightly, ensuring DOM is ready
    setTimeout(sota_applyTableFilters, 0);
}

// History Duration

function sota_saveHistoryDurationState()
{
    const value = document.getElementById('historyDurationSelector').value;
    localStorage.setItem('historyDuration', value);
}

function sota_loadHistoryDurationState() {
    const savedState = localStorage.getItem('historyDuration');
    // If there's a saved state, convert it to Boolean and set the checkbox
    if (savedState !== null)
        document.getElementById('historyDurationSelector').value = savedState;
}

// Auto-refresh spots

function sota_saveAutoRefreshCheckboxState()
{
    const checkbox = document.getElementById('autoRefreshSelector');
    if (checkbox) {
        syncAutoRefreshState(checkbox.checked);
    }
}

function sota_changeAutoRefreshCheckboxState(autoRefresh) {
    if (autoRefresh) {
        // Start the interval if not already running
        if (gRefreshInterval == null) {
            gRefreshInterval = setInterval(() => {
                refreshSotaPotaJson(false); // Explicitly pass false for non-forced refresh
            }, 60 * 1000); // one minute
            console.log('SOTA auto-refresh interval started');
        }
    } else {
        // Stop the interval
        if (gRefreshInterval != null) {
            clearInterval(gRefreshInterval);
            gRefreshInterval = null;
            console.log('SOTA auto-refresh interval stopped');
        }
    }
}

function sota_loadAutoRefreshCheckboxState()
{
    const savedState = localStorage.getItem('autoRefresh');
    const checkbox = document.getElementById('autoRefreshSelector');
    
    if (checkbox) {
        // If there's a saved state, use it; otherwise default to true (matching HTML default)
        const isChecked = savedState !== null ? (savedState === 'true') : true;
        checkbox.checked = isChecked;
        sota_changeAutoRefreshCheckboxState(isChecked);
        
        // If no saved state exists, save the default state
        if (savedState === null) {
            localStorage.setItem('autoRefresh', isChecked);
        }
    }
}

// Hide/Show Special Rows (QRT/QSY or Duplicates)

function sota_saveShowSpecialRowsState()
{
    const isChecked = document.getElementById('showDupsSelector').checked;
    localStorage.setItem('showSpecialRows', isChecked);
}

function sota_changeShowSpecialRowsState(showSpecial) {
    sota_applyTableFilters(); // Call the central filter function
}

function sota_loadShowSpecialRowsState()
{
    const savedState = localStorage.getItem('showSpecialRows');
    let isChecked = true; // Default to true (checked) if nothing is saved

    // If there's a saved state, convert it to Boolean
    if (savedState !== null) {
        isChecked = (savedState === 'true');
    }
    // Set the checkbox state
    const checkbox = document.getElementById('showDupsSelector');
    if (checkbox) {
        checkbox.checked = isChecked;
        // Update the onchange handler to call the renamed function
        checkbox.onchange = function() {
            sota_changeShowSpecialRowsState(this.checked);
            sota_saveShowSpecialRowsState();
        };
    } else {
        console.warn("Could not find #showDupsSelector to update onchange handler");
    }

    // Do NOT call changeShowSpecialRowsState here, it will be called after table update
    console.log(`Loaded ShowSpecialRows state: ${isChecked}`);
}

// Column sorting

// Restore the function definition locally for SOTA
function sota_updateSortIndicators(headers, sortField, descending) { // Expects a NodeList of TH elements
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

function sota_saveModeFilterState()
{
    const value = document.getElementById('modeFilter').value;
    localStorage.setItem('modeFilter', value);
}

function sota_loadModeFilterState()
{
    const savedState = localStorage.getItem('modeFilter');
    if (savedState !== null) {
        const selector = document.getElementById('modeFilter');
        if (selector) {
            console.log('Setting SOTA mode filter to:', savedState);
            // Just set the value without triggering the filter - it will be applied later
            selector.value = savedState;
            // Update the onchange handler to call the renamed function
            selector.onchange = function() {
                sota_changeModeFilter(this.value);
                sota_saveModeFilterState();
            };
            // Don't call changeModeFilter here - it will be called in applyTableFilters
        }
    }
}

function sota_changeModeFilter(selectedMode) {
    sota_applyTableFilters(); // Call the central filter function
}

// Combined filter application logic
function sota_applyTableFilters() {
    const tableBody = document.querySelector('#sotaTable tbody');
    if (!tableBody) {
        console.warn('SOTA table body not found, cannot apply filters');
        return;
    }

    const allRows = tableBody.querySelectorAll('tr');
    if (allRows.length === 0) {
        console.warn('No rows in SOTA table, skipping filter application');
        return;
    }

    // Get current filter settings
    const selectedMode = document.getElementById('modeFilter')?.value || 'All';
    const showSpecial = document.getElementById('showDupsSelector')?.checked || false;

    console.log(`Applying SOTA filters - Mode: ${selectedMode}, ShowSpecial: ${showSpecial}, Rows: ${allRows.length}`);

    let visibleRows = 0;
    let hiddenRows = 0;

    allRows.forEach(row => {
        const isQRT = row.classList.contains('row-mode-QRT');
        const isSpecial = row.classList.contains('special-row'); // Includes QRT and duplicates

        // Special case: Always show QRT rows if ShowQRT/QSY is checked, regardless of mode filter
        if (isQRT && showSpecial) {
            row.style.display = '';
            visibleRows++;
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
            visibleRows++;
        } else {
            row.style.display = 'none'; // Hide row
            hiddenRows++;
        }
    });

    console.log(`SOTA filter applied: ${visibleRows} visible rows, ${hiddenRows} hidden rows`);
}

// Page settings

function sotaOnAppearing() {
    console.info('SOTA tab appearing');

    // Load all saved settings first
    sota_loadSortState();
    sota_loadAutoRefreshCheckboxState();
    sota_loadShowSpecialRowsState();
    sota_loadModeFilterState();
    sota_loadHistoryDurationState();

    // Add/update event listeners that might have been cleared or point to old functions
    // Mode Filter
    const modeSelector = document.getElementById('modeFilter');
    if (modeSelector) {
        modeSelector.onchange = function() {
            sota_changeModeFilter(this.value);
            sota_saveModeFilterState();
        };
    }
    // Show Dups Checkbox
    const dupsCheckbox = document.getElementById('showDupsSelector');
    if (dupsCheckbox) {
        dupsCheckbox.onchange = function() {
            sota_changeShowSpecialRowsState(this.checked);
            sota_saveShowSpecialRowsState();
        };
    }
    // Auto Refresh Checkbox
    const autoRefreshCheckbox = document.getElementById('autoRefreshSelector');
    if (autoRefreshCheckbox) {
        autoRefreshCheckbox.onchange = function() {
            sota_changeAutoRefreshCheckboxState(this.checked); // Assuming this exists and needs renaming if shared
            sota_saveAutoRefreshCheckboxState();
        };
    }
    // History Duration Selector
    const historySelector = document.getElementById('historyDurationSelector');
    if (historySelector) {
        historySelector.onchange = function() {
            refreshSotaPotaJson(true); // This might be global, check definition
            sota_saveHistoryDurationState();
        };
    }

    // Apply filters to existing data if already loaded
    if (gLatestSotaJson != null) {
        console.log('SOTA tab appearing: Using existing data');
        // Ensure table is filled with existing data
        sota_updateSotaTable();
    } else {
        // Fetch new data
        console.log('SOTA tab appearing: Fetching new data');
        refreshSotaPotaJson(true); // Force refresh to ensure we have fresh data (This calls sota_updateSotaTable after enrichment)
    }

    // Set up refresh interval only if auto-refresh is enabled (reuse the autoRefreshCheckbox variable from above)
    if (autoRefreshCheckbox && autoRefreshCheckbox.checked && gRefreshInterval == null) {
        gRefreshInterval = setInterval(() => {
            refreshSotaPotaJson(false); // Explicitly pass false for non-forced refresh
        }, 60 * 1000); // one minute
        console.log('SOTA auto-refresh interval started on tab appearing');
    }

    // Get TH elements instead of SPANs
    const headers = document.querySelectorAll('#sotaTable th');
    headers.forEach(header => {
        // Find the span inside the TH for getting the sort field
        const sortSpan = header.querySelector('span[data-sort-field]');
        if (sortSpan) { // Check if the span exists
             // Remove existing listeners to avoid duplicates if sotaOnAppearing is called multiple times without full reload
            header.replaceWith(header.cloneNode(true)); // Simple way to remove all listeners
            const newHeader = document.querySelector(`#sotaTable th span[data-sort-field='${sortSpan.getAttribute('data-sort-field')}']`).closest('th');

            newHeader.addEventListener('click', function() { // Use the new header element
                // Use the span's attribute
                const clickedSortField = sortSpan.getAttribute('data-sort-field');
                if (clickedSortField === gLastSortField) {
                    gDescending = !gDescending; // Toggle the sorting direction on each click
                } else {
                    gLastSortField = clickedSortField;
                    gDescending = true; // Default to descending on first click
                }
                gSortField = clickedSortField; // Update gSortField
                // Save sort state when it changes
                sota_saveSortState();
                // Pass the TH NodeList to the LOCAL updateSortIndicators function
                sota_updateSortIndicators(document.querySelectorAll('#sotaTable th'), gSortField, gDescending); // Query fresh NodeList
                sota_updateSotaTable();
            });
        }
    });
    // Initially set the sort indicator and sort the table
    // Pass the TH NodeList
    sota_updateSortIndicators(document.querySelectorAll('#sotaTable th'), gSortField, gDescending); // Query fresh NodeList
}

function sotaOnLeaving() {
    console.info('SOTA tab leaving');
    // Save all settings when leaving the tab
    sota_saveSortState();
    sota_saveAutoRefreshCheckboxState();
    sota_saveShowSpecialRowsState();
    sota_saveModeFilterState();
    sota_saveHistoryDurationState();
    
    // Stop the auto-refresh interval when leaving the tab
    if (gRefreshInterval != null) {
        clearInterval(gRefreshInterval);
        gRefreshInterval = null;
    }
}
