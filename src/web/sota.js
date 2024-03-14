async function updateSotaTable()
{
    const data = await gLatestSotaJson;
    if (data == null) {
        console.info('SOTA Json is null');
        return;
    }

    var showDupsCheckbox = document.getElementById('showDupsSelector');

    const tbody = document.querySelector('#sotaTable tbody');
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
        callsignLink.href = `https://qrz.com/db/${spot.baseCallsign}`; // QRZ.com doesn't support callsign suffixes
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
        document.getElementById('showDupsSelector').checked = (savedState === 'true');
}

function sotaOnAppearing()
{
    console.info('SOTA tab appearing');
    loadShowSotaSpotDupsCheckboxState();
    refreshSotaPotaJson();
}
