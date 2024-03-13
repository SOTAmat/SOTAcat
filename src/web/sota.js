async function updateSotaTable()
{
    data = await gLatestSotaJson;
    if (data == null) {
        console.info('SOTA Json is null');
        return;
    }

    var showDupsCheckbox = document.getElementById('showDupsSelector');

    const tbody = document.querySelector('#sotaTable tbody');
    let newTbody = document.createElement('tbody');

    const seenCallsigns = new Set(); // Set to track seen activatorCallsigns

    data.forEach(spot =>
    {
        // Check if we should skip duplicates and if the activatorCallsign has been seen
        if (!showDupsCheckbox.checked && seenCallsigns.has(spot.activatorCallsign.split("/")[0])) {
            return; // Skip this iteration, effectively continuing to the next one
        }

        const row = newTbody.insertRow();

        // Check if the activatorCallsign is already seen
        if (spot.activatorCallsign)
        {
            if (seenCallsigns.has(spot.activatorCallsign.split("/")[0]))
            {
                let replacedColor = getComputedStyle(document.documentElement).getPropertyValue('--backgroundSpotDuplicateColor').trim();
                row.style.backgroundColor = replacedColor;
            }
            else
            {
                seenCallsigns.add(spot.activatorCallsign.split("/")[0]);
            }
        }

        const date = new Date(spot.timeStamp);
        const formattedTime = date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
        row.insertCell().textContent = formattedTime;

        const summitCell = row.insertCell();
        const summitLink = document.createElement('a');
        summitLink.href = `https://sotl.as/summits/${spot.associationCode}/${spot.summitCode}`;
        summitLink.textContent = `${spot.associationCode}/${spot.summitCode}`;
        summitCell.appendChild(summitLink);

        row.insertCell().textContent = spot.distance.toLocaleString();
        row.insertCell().textContent = spot.mode.toUpperCase();

        const frequencyCell = row.insertCell();
        const frequencyLink = document.createElement('a');
        frequencyLink.href = `#`; // Placeholder
        frequencyLink.textContent = spot.frequency;
        frequencyLink.onclick = function(event) {
            event.preventDefault(); // Prevent default link behavior
            tuneRadioMHz(spot.frequency, spot.mode);
        }
        frequencyCell.appendChild(frequencyLink);

        const callsignCell = row.insertCell();
        const callsignLink = document.createElement('a');
        callsignLink.href = `https://qrz.com/db/${spot.activatorCallsign.split("/")[0]}`; // QRZ.com doesn't support callsign suffixes
        callsignLink.textContent = spot.activatorCallsign;
        callsignCell.appendChild(callsignLink);

        row.insertCell().textContent = spot.activatorName;
        row.insertCell().textContent = spot.summitDetails;
        row.insertCell().textContent = spot.comments;
    });

    tbody.parentNode.replaceChild(newTbody, tbody);
    console.info('SOTA table updated');
}

function saveShowSotaSpotDupsCheckboxState()
{
    const isChecked = document.getElementById('showDupsSelector').checked;
    localStorage.setItem('showSotaSpotDups', isChecked);
}

function loadShowSotaSpotDupsCheckboxState()
{
    const savedState = localStorage.getItem('showSotaSpotDups');
    // If there's a saved state, convert it to Boolean and set the checkbox
    if (savedState !== null)
    {
        document.getElementById('showDupsSelector').checked = (savedState === 'true');
    }
}

function sotaOnAppearing()
{
    console.info('SOTA tab appearing');
    loadShowSotaSpotDupsCheckboxState();
    refreshSotaPotaJson();
}
