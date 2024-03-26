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

        let timeCell = row.insertCell();
        let hiddenSpan = document.createElement('span');
        hiddenSpan.style.display = 'none';
        hiddenSpan.textContent = spot.timestamp;
        timeCell.appendChild(hiddenSpan);
        const formattedTime = spot.timestamp.getUTCHours().toString().padStart(2, '0') + ':' + spot.timestamp.getUTCMinutes().toString().padStart(2, '0');
        timeCell.appendChild(document.createTextNode(formattedTime));

        const parkCell = row.insertCell();
        const parkLink = document.createElement('a');
        parkLink.href = `https://pota.app/#/park/${spot.reference}`;
        parkLink.textContent = `${spot.reference}`;
        parkCell.appendChild(parkLink);

        row.insertCell().textContent = spot.distance.toLocaleString();
        row.insertCell().textContent = spot.mode.toUpperCase();

        const frequencyCell = row.insertCell();
        const frequencyLink = document.createElement('a');
        frequencyLink.href = `#`; // Placeholder
        frequencyLink.textContent = spot.frequency;
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
}

function potaOnAppearing() {
    console.info('POTA tab appearing');

    loadShowSpotDupsCheckboxState();
    refreshSotaPotaJson();
    if (gRefreshInterval == null)
        gRefreshInterval = setInterval(refreshSotaPotaJson, 60 * 1000); // one minute

    const headers = document.querySelectorAll('#potaTable th[data-sort-field]');
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
