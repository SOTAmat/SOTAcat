// We'll keep these global sorting variables here for now,
// although they apply equally to sota and pota.
// Soon, we may collapse sota and pota display.
// NOTE: All global variables (gSortField, gLastSortField, gDescending, gRefreshInterval)
// are now declared in main.js for shared access across all tabs

// Add functions to save and load sort state for POTA
function pota_saveSortState() {
    localStorage.setItem('potaSortField', gSortField);
    localStorage.setItem('potaSortDescending', gDescending);
}

function pota_loadSortState() {
    const savedSortField = localStorage.getItem('potaSortField');
    const savedSortDescending = localStorage.getItem('potaSortDescending');
    
    if (savedSortField !== null) {
        gSortField = savedSortField;
        gLastSortField = savedSortField;
    } else {
        // Default to timestamp if no saved value
        gSortField = "timestamp";
        gLastSortField = "timestamp";
    }
    
    if (savedSortDescending !== null) {
        gDescending = (savedSortDescending === 'true');
    } else {
        // Default to descending if no saved value
        gDescending = true;
    }
}

async function pota_updatePotaTable()
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
        callsignLink.target = '_blank'; // opens the link in a new tab
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
        parkLink.target = '_blank'; // opens the link in a new tab
        parkLink.textContent = `${spot.locationID}`;
        parkCell.appendChild(parkLink);

        // 6. Distance
        row.insertCell().textContent = spot.distance.toLocaleString();

        // 7. Location Description (assuming maps to Locator)
        const locatorCell = row.insertCell();
        locatorCell.textContent = spot.locationDesc || ''; // Handle potential undefined
        locatorCell.classList.add('locator-cell');

        // 8. Name (assuming maps to Details)
        row.insertCell().textContent = spot.name || ''; // Handle potential undefined

        // 9. Comments
        row.insertCell().textContent = spot.comments;
    });

    tbody.parentNode.replaceChild(newTbody, tbody);
    console.info('POTA table updated');

    // Apply combined filters AFTER the table is built
    setTimeout(pota_applyTableFilters, 0);
}

function potaOnAppearing() {
    console.info('POTA tab appearing');

    // Load all saved settings first
    pota_loadSortState();
    pota_loadAutoRefreshCheckboxState();
    pota_loadShowSpecialRowsState(); // Updated function name
    pota_loadModeFilterState();
    pota_loadHistoryDurationState(); // Added history duration loading

    // Add/update event listeners that might have been cleared or point to old functions
    // (Similar logic as added to sotaOnAppearing, targeting POTA controls)
    const modeSelector = document.getElementById('modeFilter');
    if (modeSelector) {
        modeSelector.onchange = function() {
            pota_changeModeFilter(this.value);
            pota_saveModeFilterState();
        };
    }
    const specialCheckbox = document.getElementById('showSpecialRowsSelector') || document.getElementById('showDupsSelector');
    if (specialCheckbox) {
        specialCheckbox.onchange = function() {
            pota_changeShowSpecialRowsState(this.checked);
            pota_saveShowSpecialRowsState();
        };
    }
    const autoRefreshCheckbox = document.getElementById('autoRefreshSelector');
    if (autoRefreshCheckbox) {
        autoRefreshCheckbox.onchange = function() {
            pota_changeAutoRefreshCheckboxState(this.checked);
            pota_saveAutoRefreshCheckboxState();
        };
    }
    const historySelector = document.getElementById('historyDurationSelector');
    if (historySelector) {
        historySelector.onchange = function() {
            refreshSotaPotaJson(true); // Global function
            pota_saveHistoryDurationState();
        };
    }

    // Apply filters to existing data if already loaded
    if (gLatestPotaJson != null) {
        console.log('POTA tab appearing: Using existing data');
        // Ensure table is filled with existing data
        pota_updatePotaTable();
        
        // REMOVED: Redundant explicit filter application
        // console.log('POTA tab appearing: Reapplying filters');
        // const modeFilter = document.getElementById('modeFilter')?.value || 'All';
        // const showSpecialCheckbox = document.getElementById('showSpecialRowsSelector') || document.getElementById('showDupsSelector');
        // const showSpecial = showSpecialCheckbox ? showSpecialCheckbox.checked : true;
        // console.log(`Explicitly applying filters - Mode: ${modeFilter}, ShowSpecial: ${showSpecial}`);
        // pota_applyTableFilters();
    } else {
        // Fetch new data
        console.log('POTA tab appearing: Fetching new data');
        refreshSotaPotaJson(true); // Force refresh to ensure we have fresh data
    }

    // Set up refresh interval only if auto-refresh is enabled (reuse the autoRefreshCheckbox variable from above)
    if (autoRefreshCheckbox && autoRefreshCheckbox.checked && gRefreshInterval == null) {
        gRefreshInterval = setInterval(() => {
            refreshSotaPotaJson(false); // Explicitly pass false for non-forced refresh
        }, 60 * 1000); // one minute
        console.log('POTA auto-refresh interval started on tab appearing');
    }

    const headers = document.querySelectorAll('#potaTable th'); 
    headers.forEach(header => {
        const sortSpan = header.querySelector('span[data-sort-field]');
        if (sortSpan) {
             // Remove existing listeners to avoid duplicates
            header.replaceWith(header.cloneNode(true));
            const newHeader = document.querySelector(`#potaTable th span[data-sort-field='${sortSpan.getAttribute('data-sort-field')}']`).closest('th');

            newHeader.addEventListener('click', function() {
                const clickedSortField = sortSpan.getAttribute('data-sort-field');
                if (clickedSortField === gLastSortField) {
                    gDescending = !gDescending;
                } else {
                    gLastSortField = clickedSortField;
                    gDescending = true;
                }
                gSortField = clickedSortField;
                // Save sort state when it changes
                pota_saveSortState();
                pota_updateSortIndicators(document.querySelectorAll('#potaTable th'), gSortField, gDescending);
                pota_updatePotaTable();
            });
        }
    });

    pota_updateSortIndicators(document.querySelectorAll('#potaTable th'), gSortField, gDescending);
}

// History Duration

function pota_saveHistoryDurationState()
{
    const value = document.getElementById('historyDurationSelector').value;
    localStorage.setItem('historyDuration', value); // Use same key as SOTA for now
}

function pota_loadHistoryDurationState() {
    const savedState = localStorage.getItem('historyDuration');
    if (savedState !== null) {
        const selector = document.getElementById('historyDurationSelector');
        if (selector) selector.value = savedState;
    }
    // Note: POTA API fetch in main.js currently doesn't use this value.
    // Need to adjust refreshSotaPotaJson in main.js if POTA API supports time filtering.
}

// Auto-refresh spots

function pota_saveAutoRefreshCheckboxState()
{
    const checkbox = document.getElementById('autoRefreshSelector');
    if (checkbox) {
        syncAutoRefreshState(checkbox.checked);
    }
}

function pota_changeAutoRefreshCheckboxState(autoRefresh) {
    if (autoRefresh) {
        // Start the interval if not already running
        if (gRefreshInterval == null) {
            gRefreshInterval = setInterval(() => {
                refreshSotaPotaJson(false); // Explicitly pass false for non-forced refresh
            }, 60 * 1000); // one minute
            console.log('POTA auto-refresh interval started');
        }
    } else {
        // Stop the interval
        if (gRefreshInterval != null) {
            clearInterval(gRefreshInterval);
            gRefreshInterval = null;
            console.log('POTA auto-refresh interval stopped');
        }
    }
}

function pota_loadAutoRefreshCheckboxState()
{
    const savedState = localStorage.getItem('autoRefresh');
    const checkbox = document.getElementById('autoRefreshSelector');
    
    if (checkbox) {
        // If there's a saved state, use it; otherwise default to true (matching HTML default)
        const isChecked = savedState !== null ? (savedState === 'true') : true;
        checkbox.checked = isChecked;
        pota_changeAutoRefreshCheckboxState(isChecked);
        
        // If no saved state exists, save the default state
        if (savedState === null) {
            localStorage.setItem('autoRefresh', isChecked);
        }
    }
}

// Hide/Show Special Rows (QRT/QSY or Duplicates)

function pota_saveShowSpecialRowsState() // Renamed from saveShowSpotDupsCheckboxState
{
    // Get a reference to the checkbox correctly regardless of ID
    const checkbox = document.getElementById('showSpecialRowsSelector') || document.getElementById('showDupsSelector');
    if (checkbox) {
        localStorage.setItem('showSpecialRows', checkbox.checked);
    }
}

// Renamed from changeShowSpotDupsCheckboxState
function pota_changeShowSpecialRowsState(showSpecial) {
    pota_applyTableFilters(); // Call the central filter function
}

function pota_loadShowSpecialRowsState() // Renamed from loadShowSpotDupsCheckboxState
{
    const savedState = localStorage.getItem('showSpecialRows');
    let isChecked = true; // Default to true (checked) if nothing is saved

    // If there's a saved state, convert it to Boolean
    if (savedState !== null) {
        isChecked = (savedState === 'true');
    }
    
    // Try to find the checkbox with either possible ID
    const checkbox = document.getElementById('showSpecialRowsSelector') || document.getElementById('showDupsSelector');
    if (checkbox) {
        checkbox.checked = isChecked;
         // Update the onchange handler
        checkbox.onchange = function() {
            pota_changeShowSpecialRowsState(this.checked);
            pota_saveShowSpecialRowsState();
        };
    }

    // Do NOT call changeShowSpecialRowsState here, it will be called after table update
    console.log(`Loaded ShowSpecialRows state: ${isChecked}`);
}

// Column sorting

function pota_updateSortIndicators(headers, sortField, descending) {
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

function pota_saveModeFilterState()
{
    const selector = document.getElementById('modeFilter');
    if (selector) localStorage.setItem('modeFilter', selector.value);
}

function pota_loadModeFilterState()
{
    const savedState = localStorage.getItem('modeFilter');
    if (savedState !== null) {
        const selector = document.getElementById('modeFilter');
        if (selector) {
            console.log('Setting POTA mode filter to:', savedState);
            // Just set the value without triggering the filter - it will be applied later
            selector.value = savedState;
             // Update the onchange handler
            selector.onchange = function() {
                pota_changeModeFilter(this.value);
                pota_saveModeFilterState();
            };
            // Don't call changeModeFilter here - it will be called in applyTableFilters
        }
    }
}

function pota_changeModeFilter(selectedMode) {
    pota_applyTableFilters(); // Call the central filter function
}

// Combined filter application logic (Adapted from sota.js)
function pota_applyTableFilters() {
    const tableBody = document.querySelector('#potaTable tbody'); // Target POTA table
    if (!tableBody) {
        console.warn('POTA table body not found, cannot apply filters');
        return;
    }

    const allRows = tableBody.querySelectorAll('tr');
    if (allRows.length === 0) {
        console.warn('No rows in POTA table, skipping filter application');
        return;
    }

    // Get current filter settings
    // Try to find the checkbox with either possible ID
    const selectedMode = document.getElementById('modeFilter')?.value || 'All';
    const showSpecialCheckbox = document.getElementById('showSpecialRowsSelector') || document.getElementById('showDupsSelector');
    const showSpecial = showSpecialCheckbox ? showSpecialCheckbox.checked : true; // Default to true if checkbox not found

    console.log(`Applying POTA filters - Mode: ${selectedMode}, ShowSpecial: ${showSpecial}, Rows: ${allRows.length}`);

    let visibleRows = 0;
    let hiddenRows = 0;

    allRows.forEach(row => {
        // POTA doesn't have an explicit QRT class yet, so isQRT is always false
        const isQRT = false; // row.classList.contains('row-mode-QRT');
        const isSpecial = row.classList.contains('special-row'); // Includes duplicates

        // Special case: Always show QRT rows if ShowQRT/QSY is checked, regardless of mode filter
        // (This case is currently inactive for POTA as isQRT is false)
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

    console.log(`POTA filter applied: ${visibleRows} visible rows, ${hiddenRows} hidden rows`);
}

// Cleanup when tab is left (if necessary)
function potaOnLeaving() {
    console.info('POTA tab leaving');
    // Save all settings when leaving the tab
    pota_saveSortState();
    pota_saveAutoRefreshCheckboxState();
    pota_saveShowSpecialRowsState();
    pota_saveModeFilterState();
    
    // Don't save historyDurationState because it's shared with SOTA
    // and is not effectively used in POTA yet
    
    // Stop the auto-refresh interval when leaving the tab
    if (gRefreshInterval != null) {
        clearInterval(gRefreshInterval);
        gRefreshInterval = null;
    }
}
