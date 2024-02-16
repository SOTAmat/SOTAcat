var sotamat_base_url = 'sotamat://api/v1?app=sotacat&appversion=2.1';

function updateSOTAmatLink()
{
    var currentUrl = window.location.href;
    var encodedReturnPath = encodeURIComponent(currentUrl);
    var newHref = sotamat_base_url + '&returnpath=' + encodedReturnPath;
    document.getElementById('sotamat_action').href = newHref;
}

function updateTableContent()
{
    var selectedTable = document.getElementById("tableSelector").value;
    switch (selectedTable)
    {
        case "sotaSpots":
            fetchAndUpdateData('https://api2.sota.org.uk/api/spots/-1/all', updateSotaTable);
            break;
        case "potaSpots":
            fetchAndUpdateData('https://api.pota.app/spot', updatePotaTable); // Replace with actual POTA API URL
            break;
        // Add more cases here for additional tables
    }
}

function fetchAndUpdateData(url, updateFunction)
{
    fetch(url)
        .then(response => response.json())
        .then(data => updateFunction(data))
        .catch(error => console.error('Error fetching data:', error));
}

function showOneTable(tableToShow) {
    var sotaTable = document.getElementById('sotaTable');
    var potaTable = document.getElementById('potaTable');

    // Hide all tables
    sotaTable.style.display = 'none';
    potaTable.style.display = 'none';

    // Show the selected table
    document.getElementById(tableToShow).style.display = 'table';
}

function updateSotaTable(data)
{
    showOneTable('sotaTable');
    const tbody = document.querySelector('#sotaTable tbody');
    let newTbody = document.createElement('tbody');

    const seenCallsigns = new Set(); // Set to track seen activatorCallsigns

    data.forEach(spot =>
    {
        const date = new Date(spot.timeStamp);
        const formattedTime = date.getHours() + ':' + date.getMinutes().toString().padStart(2, '0');
        const row = newTbody.insertRow();

        // Check if the activatorCallsign is already seen
        if (seenCallsigns.has(spot.activatorCallsign.split("/")[0])) {
            let replacedColor = getComputedStyle(document.documentElement).getPropertyValue('--replaced-spot-background').trim();
            row.style.backgroundColor = replacedColor; // Set background color using CSS variable
        } else {
            seenCallsigns.add(spot.activatorCallsign.split("/")[0]);
        }


        row.insertCell().textContent = formattedTime;

        const summitCell = row.insertCell();
        const summitLink = document.createElement('a');
        summitLink.href = `https://sotl.as/summits/${spot.associationCode}/${spot.summitCode}`;
        summitLink.textContent = `${spot.associationCode}/${spot.summitCode}`;
        summitCell.appendChild(summitLink);

        row.insertCell().textContent = spot.mode;

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
}

function sortDataByUTC(data) {
    return data.sort((a, b) => {
        // Directly parse the ISO 8601 formatted timestamps
        let dateA = new Date(a.spotTime);
        let dateB = new Date(b.spotTime);

        return dateB - dateA; // Sorts the dates in decending order
    });
}


function updatePotaTable(dataIn)
{
    showOneTable('potaTable');
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
            let replacedColor = getComputedStyle(document.documentElement).getPropertyValue('--replaced-spot-background').trim();
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

function tuneRadioMHz(freqMHz, mode)
{
    const frequency = parseFloat(freqMHz) * 1000000;
    tuneRadioHz(frequency, mode);
}

function tuneRadioKHz(freqKHz, mode)
{
    const frequency = parseFloat(freqKHz) * 1000;
    tuneRadioHz(frequency, mode);
}

function tuneRadioHz(frequency, mode) {
    useMode = mode.toUpperCase();
    if (useMode == "SSB")
    {
        if (frequency < 10000000) useMode = "LSB";
        else useMode = "USB";
    }

    fetch('/api/v1/frequency?frequency=' + frequency, {
        method: 'PUT'
    })
    .then(response => {
        if (response.ok) {
            console.log('Frequency updated successfully');
        } else {
            console.error('Error updating frequency');
        }
    })
    .catch(error => console.error('Fetch error:', error));

    fetch('/api/v1/rxBandwidth?bw=' + useMode, {
        method: 'PUT'
    })
    .then(response => {
        if (response.ok) {
            console.log('Mode updated successfully');
        } else {
            console.error('Error updating mode');
        }
    })
    .catch(error => console.error('Fetch error:', error));
}

document.addEventListener('DOMContentLoaded',
    function()
    {
        updateTableContent();
        setInterval(updateTableContent, 60000);
    });

function fetchBatteryPercent()
{
    fetch('/api/v1/batteryPercent')
        .then(response => response.text())
        .then(data =>
        {
            document.getElementById('batteryPercent').textContent = data;
        })
        .catch(error => console.error('Error:', error));
}

function fetchBatteryVoltage()
{
    fetch('/api/v1/batteryVoltage')
        .then(response => response.text())
        .then(data =>
        {
            document.getElementById('batteryVoltage').textContent = data;
        })
        .catch(error => console.error('Error:', error));
}

fetchBatteryPercent(); // Call the function immediately
setInterval(fetchBatteryPercent, 60000); // Then call it every 1 minute

fetchBatteryVoltage(); // Call the function immediately
setInterval(fetchBatteryVoltage, 60000); // Then call it every 1 minute

