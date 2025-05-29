function playMsg(slot) {
  // Create the PUT request using Fetch API
  const url = "/api/v1/msg?bank=" + slot;
  fetch(url, { method: "PUT" }).catch((error) =>
    console.error("Fetch error:", error),
  );
}

let isXmitActive = false;

function sendXmitRequest(state) {
  const url = "/api/v1/xmit?state=" + state;
  fetch(url, { method: "PUT" }).catch((error) =>
    console.error("Fetch error:", error)
  );
}

function toggleXmit() {
  const xmitButton = document.getElementById("xmitButton");

  // Toggle the state
  isXmitActive = !isXmitActive;

  // Change button appearance
  if (isXmitActive) {
    xmitButton.classList.add("active");
    sendXmitRequest(1);  // Send "on" signal
  } else {
    xmitButton.classList.remove("active");
    sendXmitRequest(0);  // Send "off" signal
  }
}

function setPowerMinMax(maximum) {
  // KX3 max power is 15w, KX2 will accept that and gracefully set 10w instead
  // On both radios, actual power may be lower than requested, depending on mode, battery, etc.
  const url = "/api/v1/power?power=" + (maximum ? "15" : "0");
  fetch(url, { method: "PUT" }).catch((error) =>
    console.error("Fetch error:", error),
  );
}

function sendKeys(message) {
  if (message.length < 1 || message.length > 24)
    alert("Text length must be [1..24] characters.");
  else {
    const url = "/api/v1/keyer?message=" + message;
    fetch(url, { method: "PUT" }).catch((error) =>
      console.error("Fetch error:", error),
    );
  }
}

// VFO Control Functions

// Band frequencies in Hz
// Even though lower frequencies are available to Extra-class, we chose starts a
// bit higher, at lower license levels, to increase odds of contacts
const BAND_FREQUENCIES = {
  '40m':  7175000,
  '20m': 14225000,
  '17m': 18110000,
  '15m': 21275000,
  '12m': 24930000,
  '10m': 28300000
};

let currentFrequencyHz = 14225000; // Default to 20m
let currentMode = 'USB';
let vfoUpdateInterval = null;
let lastUserAction = 0; // Timestamp of last user VFO action
let isUpdatingVfo = false; // Flag to prevent concurrent updates
let pendingFrequencyUpdate = null; // For debouncing frequency updates

function formatFrequency(frequencyHz) {
  // Convert Hz to MHz and format as XX.XXX.XXX
  const mhz = frequencyHz / 1000000;
  const formatted = mhz.toFixed(6);
  const parts = formatted.split('.');
  const wholePart = parts[0];
  const decimalPart = parts[1];

  // Insert periods for readability: XX.XXX.XXX
  if (decimalPart && decimalPart.length >= 3) {
    return `${wholePart}.${decimalPart.substring(0, 3)}.${decimalPart.substring(3)}`;
  }
  return formatted;
}

function updateFrequencyDisplay() {
  const display = document.getElementById('currentFrequency');
  if (display) {
    display.textContent = formatFrequency(currentFrequencyHz);

    // Add brief visual feedback for updates
    display.style.backgroundColor = 'var(--color-success)';
    setTimeout(() => {
      display.style.backgroundColor = '';
    }, 200);
  }
}

function updateModeDisplay() {
  const display = document.getElementById('currentMode');
  if (display) {
    display.textContent = currentMode;

    // Add brief visual feedback for updates
    display.style.backgroundColor = 'var(--color-success)';
    setTimeout(() => {
      display.style.backgroundColor = '';
    }, 200);
  }

  // Update mode button active states
  document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById(currentMode.toLowerCase() + 'ModeBtn');
  if (activeBtn) {
    activeBtn.classList.add('active');
  } else if (currentMode === 'USB' || currentMode === 'LSB') {
    // Handle SSB modes
    const ssbBtn = document.getElementById('ssbModeBtn');
    if (ssbBtn) ssbBtn.classList.add('active');
  }
}

function getCurrentFrequency() {
  if (isUpdatingVfo) return; // Avoid concurrent updates

  // Don't poll if user made a change in the last 2 seconds
  if (Date.now() - lastUserAction < 2000) return;

  isUpdatingVfo = true;
  fetch('/api/v1/frequency', { method: 'GET' })
    .then(response => {
      if (response.ok) {
        return response.text();
      }
      throw new Error('Failed to get frequency');
    })
    .then(frequency => {
      const newFreq = parseInt(frequency);
      // Only update if frequency has actually changed
      if (newFreq !== currentFrequencyHz) {
        currentFrequencyHz = newFreq;
        updateFrequencyDisplay();
        console.log('Frequency updated from radio:', currentFrequencyHz);
      }
    })
    .catch(error => {
      console.error('Error getting frequency:', error);
    })
    .finally(() => {
      isUpdatingVfo = false;
    });
}

function getCurrentMode() {
  if (isUpdatingVfo) return; // Avoid concurrent updates

  // Don't poll if user made a change in the last 2 seconds
  if (Date.now() - lastUserAction < 2000) return;

  fetch('/api/v1/mode', { method: 'GET' })
    .then(response => {
      if (response.ok) {
        return response.text();
      }
      throw new Error('Failed to get mode');
    })
    .then(mode => {
      const newMode = mode.toUpperCase();
      // Only update if mode has actually changed
      if (newMode !== currentMode) {
        currentMode = newMode;
        updateModeDisplay();
        console.log('Mode updated from radio:', currentMode);
      }
    })
    .catch(error => {
      console.error('Error getting mode:', error);
    });
}

function setFrequency(frequencyHz) {
  lastUserAction = Date.now(); // Mark user action timestamp

  // Clear any pending frequency update
  if (pendingFrequencyUpdate) {
    clearTimeout(pendingFrequencyUpdate);
  }

  // Debounce frequency updates to avoid flooding the radio
  pendingFrequencyUpdate = setTimeout(() => {
    const url = `/api/v1/frequency?frequency=${frequencyHz}`;
    fetch(url, { method: 'PUT' })
      .then(response => {
        if (response.ok) {
          currentFrequencyHz = frequencyHz;
          updateFrequencyDisplay();
          console.log('Frequency updated successfully:', frequencyHz);
        } else {
          console.error('Error updating frequency');
          // Revert display on error
          getCurrentFrequency();
        }
      })
      .catch(error => {
        console.error('Fetch error:', error);
        // Revert display on error
        getCurrentFrequency();
      })
      .finally(() => {
        pendingFrequencyUpdate = null;
      });
  }, 300); // 300ms debounce

  // Update display immediately for responsive feel
  currentFrequencyHz = frequencyHz;
  updateFrequencyDisplay();
}

function adjustFrequency(deltaHz) {
  const newFrequency = currentFrequencyHz + deltaHz;

  // Basic bounds checking (1.8 MHz to 29.7 MHz)
  if (newFrequency >= 1800000 && newFrequency <= 29700000) {
    setFrequency(newFrequency);
  } else {
    console.warn('Frequency out of bounds:', newFrequency);
  }
}

function selectBand(band) {
  if (BAND_FREQUENCIES[band]) {
    setFrequency(BAND_FREQUENCIES[band]);

    // Set appropriate mode for the band
    let mode = 'USB'; // Default for higher bands
    if (band === '40m') {
      mode = 'LSB'; // 40m typically uses LSB
    }

    setTimeout(() => {
      setMode(mode);
    }, 100); // Small delay to ensure frequency is set first
  }
}

function setMode(mode) {
  lastUserAction = Date.now(); // Mark user action timestamp

  let actualMode = mode;

  // Handle SSB mode selection based on frequency
  if (mode === 'SSB') {
    actualMode = currentFrequencyHz < 10000000 ? 'LSB' : 'USB';
  }

  const url = `/api/v1/mode?bw=${actualMode}`;
  fetch(url, { method: 'PUT' })
    .then(response => {
      if (response.ok) {
        currentMode = actualMode;
        updateModeDisplay();
        console.log('Mode updated successfully:', actualMode);
      } else {
        console.error('Error updating mode');
        // Revert display on error
        getCurrentMode();
      }
    })
    .catch(error => {
      console.error('Fetch error:', error);
      // Revert display on error
      getCurrentMode();
    });
}

function startVfoUpdates() {
  // Clear any existing interval
  if (vfoUpdateInterval) {
    clearInterval(vfoUpdateInterval);
  }

  // Get initial values immediately (force update regardless of user action)
  isUpdatingVfo = true;
  Promise.all([
    fetch('/api/v1/frequency', { method: 'GET' }).then(r => r.ok ? r.text() : null),
    fetch('/api/v1/mode', { method: 'GET' }).then(r => r.ok ? r.text() : null)
  ]).then(([frequency, mode]) => {
    if (frequency) {
      currentFrequencyHz = parseInt(frequency);
      updateFrequencyDisplay();
      console.log('Initial frequency loaded:', currentFrequencyHz);
    }
    if (mode) {
      currentMode = mode.toUpperCase();
      updateModeDisplay();
      console.log('Initial mode loaded:', currentMode);
    }
  }).catch(error => {
    console.error('Error loading initial VFO state:', error);
  }).finally(() => {
    isUpdatingVfo = false;

    // Start periodic updates (every 3 seconds, respecting user actions)
    vfoUpdateInterval = setInterval(() => {
      getCurrentFrequency();
      getCurrentMode();
    }, 3000);
  });
}

function stopVfoUpdates() {
  if (vfoUpdateInterval) {
    clearInterval(vfoUpdateInterval);
    vfoUpdateInterval = null;
  }

  // Clear any pending frequency updates
  if (pendingFrequencyUpdate) {
    clearTimeout(pendingFrequencyUpdate);
    pendingFrequencyUpdate = null;
  }

  // Reset flags
  isUpdatingVfo = false;
  lastUserAction = 0;
}

function tuneAtu() {
  const url = "/api/v1/atu";
  fetch(url, { method: "PUT" })
    .then(response => {
      if (response.ok) {
        console.log('ATU tune initiated successfully');
        // Optionally add visual feedback
        const atuBtn = document.querySelector('.atu-btn');
        if (atuBtn) {
          atuBtn.style.backgroundColor = 'var(--color-success)';
          setTimeout(() => {
            atuBtn.style.backgroundColor = '';
          }, 1000);
        }
      } else {
        console.error('Error initiating ATU tune');
      }
    })
    .catch(error => {
      console.error('Fetch error:', error);
    });
}

function loadInputValues() {
  document.getElementById("message1").value =
    localStorage.getItem("message1") || "";
  document.getElementById("message2").value =
    localStorage.getItem("message2") || "";
  document.getElementById("message3").value =
    localStorage.getItem("message3") || "";
}

function saveInputValues() {
  localStorage.setItem("message1", document.getElementById("message1").value);
  localStorage.setItem("message2", document.getElementById("message2").value);
  localStorage.setItem("message3", document.getElementById("message3").value);
}

gMessageInputListenersAttached = false;

function catOnAppearing() {
  console.info("CAT tab appearing");
  loadInputValues();

  if (!gMessageInputListenersAttached) {
    gMessageInputListenersAttached = true;
    // Add event listeners to save input values when they change
    document
      .getElementById("message1")
      .addEventListener("input", saveInputValues);
    document
      .getElementById("message2")
      .addEventListener("input", saveInputValues);
    document
      .getElementById("message3")
      .addEventListener("input", saveInputValues);
  }

  // Start VFO updates when CAT tab becomes active
  startVfoUpdates();
}

function catOnLeaving() {
  console.info("CAT tab leaving");
  // Stop VFO updates when leaving CAT tab
  stopVfoUpdates();
}
