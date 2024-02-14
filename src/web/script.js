var sotamat_base_url = 'sotamat://api/v1?app=sotacat&appversion=2.1';

function updateSOTAmatLink()
{
    var currentUrl = window.location.href;
    var encodedReturnPath = encodeURIComponent(currentUrl);
    var newHref = sotamat_base_url + '&returnpath=' + encodedReturnPath;
    document.getElementById('sotamat_action').href = newHref;
}

function fetchAndUpdateData()
{
    fetch('https://api2.sota.org.uk/api/spots/-1/all')
        .then(response => response.json())
        .then(data =>
        {
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
                    tuneRadio(spot.frequency, spot.mode);
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
        })
        .catch(error => console.error('Error fetching data:', error));
}

function tuneRadio(freqMHz, mode) {
    const frequency = parseFloat(freqMHz) * 1000000;
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

document.addEventListener('DOMContentLoaded', function()
{
    fetchAndUpdateData();
    setInterval(fetchAndUpdateData, 60000);
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

// Call the function immediately
fetchBatteryPercent();
// Then call it every 1 minute
setInterval(fetchBatteryPercent, 60000);

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

// Call the function immediately
fetchBatteryVoltage();

// Then call it every 1 minute
setInterval(fetchBatteryVoltage, 60000);
