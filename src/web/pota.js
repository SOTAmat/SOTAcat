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

        const parkCell = row.insertCell();
        const parkLink = document.createElement('a');
        parkLink.href = `https://pota.app/#/park/${spot.point}`;
        parkLink.textContent = `${spot.point}`;
        parkCell.appendChild(parkLink);

        row.insertCell().textContent = spot.distance.toLocaleString();
        row.insertCell().textContent = spot.mode;
        row.classList.add('mode-' + spot.modeType);

        const frequencyCell = row.insertCell();
        const frequencyLink = document.createElement('a');
        frequencyLink.href = `#`; // Placeholder
        frequencyLink.textContent = (spot.hertz/1000/1000).toFixed(1)
        frequencyLink.onclick = function(event) {
            event.preventDefault(); // Prevent default link behavior
            tuneRadioKHz(spot.frequency, spot.mode);
        }
        frequencyCell.appendChild(frequencyLink);

        const callsignCell = row.insertCell();
        const callsignLink = document.createElement('a');
        callsignLink.href = `https://qrz.com/db/${spot.baseCallsign}`; // QRZ.com doesn't support callsign suffixes
        callsignLink.textContent = spot.activator;
        callsignCell.appendChild(callsignLink);

        row.insertCell().textContent = spot.locationDesc;
        row.insertCell().textContent = spot.name;
        row.insertCell().textContent = spot.comments;
    });

    tbody.parentNode.replaceChild(newTbody, tbody);

    console.info('POTA table updated');
}

function potaOnAppearing() {
    console.info('POTA tab appearing');

    loadAutoRefreshCheckboxState();
    loadShowSpotDupsCheckboxState();
    loadModeFilterState();

    refreshSotaPotaJson(false);
    if (gRefreshInterval == null)
        gRefreshInterval = setInterval(refreshSotaPotaJson, 60 * 1000); // one minute

    const headers = document.querySelectorAll('#potaTable th span[data-sort-field]');
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
            updatePotaTable();
        });
    });

    // Initially set the sort indicator and sort the table
    updateSortIndicators(headers, gSortField, gDescending);
    updatePotaTable(); // Assuming this function uses gSortField and gDescending to sort and display data
}
