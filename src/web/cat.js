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

// ARRL Band Plan with frequency ranges in Hz
// Using conservative band edges to increase compatibility across license classes
const BAND_PLAN = {
  '40m': {
    min: 7000000,    // 7.000 MHz
    max: 7300000,    // 7.300 MHz
    initial: 7175000 // 7.175 MHz (existing default)
  },
  '20m': {
    min: 14000000,   // 14.000 MHz
    max: 14350000,   // 14.350 MHz
    initial: 14225000 // 14.225 MHz (existing default)
  },
  '17m': {
    min: 18068000,   // 18.068 MHz
    max: 18168000,   // 18.168 MHz
    initial: 18110000 // 18.110 MHz (existing default)
  },
  '15m': {
    min: 21000000,   // 21.000 MHz
    max: 21450000,   // 21.450 MHz
    initial: 21275000 // 21.275 MHz (existing default)
  },
  '12m': {
    min: 24890000,   // 24.890 MHz
    max: 24990000,   // 24.990 MHz
    initial: 24930000 // 24.930 MHz (existing default)
  },
  '10m': {
    min: 28000000,   // 28.000 MHz
    max: 29700000,   // 29.700 MHz
    initial: 28300000 // 28.300 MHz (existing default)
  }
};

// Legacy compatibility - keep BAND_FREQUENCIES for existing code
const BAND_FREQUENCIES = {
  '40m':  BAND_PLAN['40m'].initial,
  '20m':  BAND_PLAN['20m'].initial,
  '17m':  BAND_PLAN['17m'].initial,
  '15m':  BAND_PLAN['15m'].initial,
  '12m':  BAND_PLAN['12m'].initial,
  '10m':  BAND_PLAN['10m'].initial
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

function getBandFromFrequency(frequencyHz) {
  for (const [band, plan] of Object.entries(BAND_PLAN)) {
    if (frequencyHz >= plan.min && frequencyHz <= plan.max) {
      return band;
    }
  }
  return null; // Frequency doesn't match any of our supported bands
}

function updateBandDisplay() {
  // Clear all active states first
  document.querySelectorAll('.band-btn').forEach(btn => btn.classList.remove('active'));

  // Determine which band the current frequency falls into
  const currentBand = getBandFromFrequency(currentFrequencyHz);

  if (currentBand) {
    // Find and activate the corresponding band button
    const bandButton = document.getElementById(`${currentBand}Btn`);
    if (bandButton) {
      bandButton.classList.add('active');
      console.log(`Band display updated: ${currentBand} active`);
    }
  } else {
    console.log('Current frequency not in any supported band range');
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

function getCurrentVfoState() {
  if (isUpdatingVfo) return; // Avoid concurrent updates

  // Don't poll if user made a change in the last 2 seconds
  if (Date.now() - lastUserAction < 2000) return;

  isUpdatingVfo = true;
  
  // Fetch both frequency and mode in parallel
  Promise.all([
    fetch('/api/v1/frequency', { method: 'GET' }).then(r => r.ok ? r.text() : null),
    fetch('/api/v1/mode', { method: 'GET' }).then(r => r.ok ? r.text() : null)
  ])
  .then(([frequency, mode]) => {
    // Update frequency if it has changed
    if (frequency) {
      const newFreq = parseInt(frequency);
      if (newFreq !== currentFrequencyHz) {
        currentFrequencyHz = newFreq;
        updateFrequencyDisplay();
        updateBandDisplay(); // Update band button active state
        console.log('Frequency updated from radio:', currentFrequencyHz);
      }
    }
    
    // Update mode if it has changed
    if (mode) {
      const newMode = mode.toUpperCase();
      if (newMode !== currentMode) {
        currentMode = newMode;
        updateModeDisplay();
        console.log('Mode updated from radio:', currentMode);
      }
    }
  })
  .catch(error => {
    console.error('Error getting VFO state:', error);
  })
  .finally(() => {
    isUpdatingVfo = false;
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
          updateBandDisplay(); // Update band button active state
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
  updateBandDisplay(); // Update band button active state immediately
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
  if (BAND_PLAN[band]) {
    // Set frequency first
    setFrequency(BAND_PLAN[band].initial);
    
    // Check current mode after frequency change and only set sideband if in SSB mode
    setTimeout(() => {
      // Get current mode from radio
      fetch('/api/v1/mode', { method: 'GET' })
        .then(response => {
          if (response.ok) {
            return response.text();
          }
          throw new Error('Failed to get current mode');
        })
        .then(currentMode => {
          const mode = currentMode.toUpperCase();
          
          // Only set sideband if current mode is SSB (USB or LSB)
          if (mode === 'USB' || mode === 'LSB') {
            // Set appropriate sideband for the band
            let targetMode = 'USB'; // Default for higher bands
            if (band === '40m') {
              targetMode = 'LSB'; // 40m typically uses LSB
            }
            
            // Only change if different from current mode
            if (targetMode !== mode) {
              setMode(targetMode);
            }
          }
          // If not in SSB mode (AM, FM, DATA, CW, etc.), leave mode unchanged
        })
        .catch(error => {
          console.error('Error checking current mode:', error);
        });
    }, 500); // Delay to ensure frequency is set and radio auto-mode is complete
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
        getCurrentVfoState();
      }
    })
    .catch(error => {
      console.error('Fetch error:', error);
      // Revert display on error
      getCurrentVfoState();
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
      updateBandDisplay();
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
      getCurrentVfoState();
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
