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

        if (spot.duplicate)
            row.classList.add('duplicate-row');
        if (spot.type && spot.type !== "" && spot.type !== "NORMAL") { // "" is a normal spot, other values are not
            row.classList.add('duplicate-row');
            row.classList.add('qrt-row');
        }

        const formattedTime = spot.timestamp.getUTCHours().toString().padStart(2, '0') + ':' + spot.timestamp.getUTCMinutes().toString().padStart(2, '0');
        row.insertCell().textContent = formattedTime;

        const summitCell = row.insertCell();
        const summitLink = document.createElement('a');
        summitLink.href = `https://sotl.as/summits/${spot.point}`;
        summitLink.textContent = spot.point;
        summitCell.appendChild(summitLink);

        row.insertCell().textContent = spot.distance.toLocaleString();
        const mode = spot.mode.toUpperCase().trim();
        row.insertCell().textContent = mode;
        row.classList.add('mode-' + spot.modeType);

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

        const callsignCell = row.insertCell();
        const callsignLink = document.createElement('a');
        callsignLink.href = `https://qrz.com/db/${spot.baseCallsign}`; // QRZ.com doesn't support callsign suffixes
        callsignLink.textContent = spot.activatorCallsign;
        callsignCell.appendChild(callsignLink);

        row.insertCell().textContent = spot.activatorName;
        row.insertCell().textContent = spot.details;
        row.insertCell().textContent = spot.comments;
    });

    tbody.parentNode.replaceChild(newTbody, tbody);
    console.info('SOTA table updated');
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

// Hide/Show Spot Dups

function saveShowSpotDupsCheckboxState()
{
    const isChecked = document.getElementById('showDupsSelector').checked;
    localStorage.setItem('showSpotDups', isChecked);
}

function changeShowSpotDupsCheckboxState(showDups) {
    let styleSheet = document.styleSheets[0]; // Assuming it's in the first stylesheet
    let duplicateRowsStyle = Array.from(styleSheet.cssRules).find(rule => rule.selectorText === '.duplicate-row');

    if (showDups)
        duplicateRowsStyle.style.display = '';     // Make sure rows are visible
    else
        duplicateRowsStyle.style.display = 'none'; // Hide rows
}

function loadShowSpotDupsCheckboxState()
{
    const savedState = localStorage.getItem('showSpotDups');
    // If there's a saved state, convert it to Boolean and set the checkbox
    if (savedState !== null) {
        document.getElementById('showDupsSelector').checked = (savedState === 'true');
        changeShowSpotDupsCheckboxState(document.getElementById('showDupsSelector').checked);
    }
}

// Column sorting

function updateSortIndicators(headers, sortField, descending) {
    headers.forEach(header => {
        if (header.getAttribute('data-sort-field') === sortField) {
            header.setAttribute('data-sort-dir', descending ? 'desc' : 'asc');
        } else {
            header.removeAttribute('data-sort-dir');
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
    let styleSheet = document.styleSheets[0]; // Assuming it's in the first stylesheet
    let allModeStyles = Array.from(styleSheet.cssRules).filter(rule =>
        rule.selectorText && /^\.mode-/.test(rule.selectorText));

    if (selectedMode === "All") {
        allModeStyles.forEach(mode => mode.style.display = ''); // Reset display to default for all modes
    }
    else {
        allModeStyles.forEach(mode => mode.style.display = 'none'); // Hide all mode styles
        let selectedModeStyle = allModeStyles.find(rule => rule.selectorText === `.mode-${selectedMode}`);
        if (selectedModeStyle) {
            selectedModeStyle.style.display = ''; // Show only the selected mode
        }
    }
}

// Page settings

function sotaOnAppearing() {
    console.info('SOTA tab appearing');

    loadAutoRefreshCheckboxState();
    loadShowSpotDupsCheckboxState();
    loadModeFilterState();
    loadHistoryDurationState();

    refreshSotaPotaJson(false);
    if (gRefreshInterval == null)
        gRefreshInterval = setInterval(refreshSotaPotaJson, 60 * 1000); // one minute

    const headers = document.querySelectorAll('#sotaTable span[data-sort-field]');
    headers.forEach(header => {
        header.addEventListener('click', function() {
            gSortField = this.getAttribute('data-sort-field');
            if (gSortField === gLastSortField) {
                gDescending = !gDescending; // Toggle the sorting direction on each click
            } else {
                gLastSortField = gSortField;
                gDescending = true; // Default to descending on first click
            }
            updateSortIndicators(headers, gSortField, gDescending);
            updateSotaTable();
        });
    });
    // Initially set the sort indicator and sort the table
    updateSortIndicators(headers, gSortField, gDescending);
    updateSotaTable(); // Assuming this function uses gSortField and gDescending to sort and display data
}
