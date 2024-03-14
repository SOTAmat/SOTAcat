async function updatePotaTable()
{
    const data = await gLatestPotaJson;
    if (data == null)
    {
        console.info('POTA Json is null');
        return;
    }

    const tbody = document.querySelector('#potaTable tbody');
    let newTbody = document.createElement('tbody');

    data.forEach(spot =>
    {
        const row = newTbody.insertRow();

        if (spot.duplicate) {
            if (!showDupsCheckbox.checked)
                return; // Skip this iteration, effectively continuing to the next one
            else {
                let replacedColor = getComputedStyle(document.documentElement).getPropertyValue('--backgroundSpotDuplicateColor').trim();
                row.style.backgroundColor = replacedColor; // Set background color using CSS variable
            }
        }

        let timeCell = row.insertCell();
        let hiddenSpan = document.createElement('span');
        hiddenSpan.style.display = 'none';
        hiddenSpan.textContent = spot.timestamp;
        timeCell.appendChild(hiddenSpan);
        const date = new Date(spot.timestamp);
        const formattedTime = date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
        timeCell.appendChild(document.createTextNode(formattedTime));

        const parkCell = row.insertCell();
        const parkLink = document.createElement('a');
        parkLink.href = `https://pota.app/#/park/${spot.reference}`;
        parkLink.textContent = `${spot.reference}`;
        parkCell.appendChild(parkLink);

        row.insertCell().textContent = spot.distance;
        row.insertCell().textContent = spot.mode;

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

function potaOnAppearing()
{
    console.info('POTA tab appearing');
    refreshSotaPotaJson();
}
