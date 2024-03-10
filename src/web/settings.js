function syncTime() {
    // Get the browser's current utc time in whole seconds
    const now = Math.round(Date.now() / 1000);

    // Specify the server endpoint you are sending the request to
    const url = "YOUR_SERVER_ENDPOINT_HERE";

     // Create the PUT request using Fetch API
    fetch('/api/v1/time?time=' + now, { method: 'PUT' })
    .then(response => {
        if (response.ok) {
            return response.json();
        }
        throw new Error('Network response was not ok.');
    })
    .then(data => {
        console.log('Time sync successful:', data);
    })
    .catch(error => console.error('Fetch error:', error));
}
