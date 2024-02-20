function sortDataByUTC(data)
{
    data.forEach(spot =>
    {
        // Convert and store timestamps once for each item
        spot.timestamp = new Date(spot.spotTime).getTime();
    });

    return data.sort((a, b) => b.timestamp - a.timestamp); // Sort timestamps
}


async function updatePotaTable()
{
    const dataIn = gLatestPotaJson;
    if (dataIn == null)
    {
        console.info('POTA Json is null');
        return;
    }

    const tbody = document.querySelector('#potaTable tbody');
    let newTbody = document.createElement('tbody');

    const data = sortDataByUTC(dataIn);

    const seenCallsigns = new Set(); // Set to track seen activatorCallsigns

    data.forEach(spot =>
    {
        const date = new Date(spot.spotTime);
        const formattedTime = date.getHours() + ':' + date.getMinutes().toString().padStart(2, '0');
        const row = newTbody.insertRow();

        // Check if the activatorCallsign is already seen
        if (seenCallsigns.has(spot.activator.split("/")[0])) {
            let replacedColor = getComputedStyle(document.documentElement).getPropertyValue('--backgroundSpotDuplicate').trim();
            row.style.backgroundColor = replacedColor; // Set background color using CSS variable
        } else {
            seenCallsigns.add(spot.activator.split("/")[0]);
        }


        row.insertCell().textContent = formattedTime;

        const parkCell = row.insertCell();
        const parkLink = document.createElement('a');
        parkLink.href = `https://pota.app/#/park/${spot.reference}`;
        parkLink.textContent = `${spot.reference}`;
        parkCell.appendChild(parkLink);

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
        callsignLink.href = `https://qrz.com/db/${spot.activator.split("/")[0]}`; // QRZ.com doesn't support callsign suffixes
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
    updatePotaTable();
}

