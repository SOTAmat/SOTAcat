function playMsg(slot) {
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
  isXmitActive = !isXmitActive;

  if (isXmitActive) {
    xmitButton.classList.add("active");
    sendXmitRequest(1);
  } else {
    xmitButton.classList.remove("active");
    sendXmitRequest(0);
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
  if (message.length < 1 || message.length > 24) {
    alert("Text length must be 1-24 characters.");
    return;
  }

  const url = "/api/v1/keyer?message=" + message;
  fetch(url, { method: "PUT" }).catch((error) =>
    console.error("Fetch error:", error),
  );
}

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

let currentFrequencyHz = 14225000; // Default to 20m
let currentMode = 'USB';
let vfoUpdateInterval = null;
let lastUserAction = 0; // Timestamp of last user VFO action
let isUpdatingVfo = false; // Flag to prevent concurrent updates
let pendingFrequencyUpdate = null; // For debouncing frequency updates
let consecutiveErrors = 0; // Track consecutive polling errors for backoff
let lastFrequencyChange = 0; // Track when frequency last changed (for adaptive polling)

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
    // Brief visual feedback
    display.style.color = 'var(--success)';
    setTimeout(() => {
      display.style.color = '';
    }, 200);
  }
}

function updateModeDisplay() {
  const display = document.getElementById('currentMode');
  if (display) {
    display.textContent = currentMode;
    // Brief visual feedback
    display.style.color = 'var(--warning)';
    setTimeout(() => {
      display.style.color = '';
    }, 200);
  }

  // Update mode button active states
  document.querySelectorAll('.btn-mode').forEach(btn => btn.classList.remove('active'));

  if (currentMode === 'CW') {
    document.getElementById('cwModeBtn')?.classList.add('active');
  } else if (currentMode === 'USB' || currentMode === 'LSB') {
    document.getElementById('ssbModeBtn')?.classList.add('active');
  } else if (currentMode === 'DATA') {
    document.getElementById('dataModeBtn')?.classList.add('active');
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
  document.querySelectorAll('.btn-band').forEach(btn => btn.classList.remove('active'));

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

function getCurrentVfoState() {
  if (isUpdatingVfo) return; // Avoid concurrent updates

  // Don't poll if user made a change in the last 2 seconds
  if (Date.now() - lastUserAction < 2000) return;

  // Back off if we've had consecutive errors
  if (consecutiveErrors > 2) {
    console.log('Backing off due to errors, skipping poll');
    return;
  }

  // If frequency changed recently (within 5 seconds), we're likely tuning - be more cautious
  const timeSinceFreqChange = Date.now() - lastFrequencyChange;
  if (timeSinceFreqChange < 5000 && timeSinceFreqChange > 0) {
    // Skip some polls when actively tuning to reduce server load
    if (Math.random() < 0.5) return;
  }

  isUpdatingVfo = true;

  // Fetch both frequency and mode in parallel
  Promise.all([
    fetch('/api/v1/frequency', { method: 'GET' }).then(r => r.ok ? r.text() : null),
    fetch('/api/v1/mode', { method: 'GET' }).then(r => r.ok ? r.text() : null)
  ])
  .then(([frequency, mode]) => {
    // Success - reset error counter
    consecutiveErrors = 0;

    // Update frequency if it has changed
    if (frequency) {
      const newFreq = parseInt(frequency);
      if (newFreq !== currentFrequencyHz) {
        currentFrequencyHz = newFreq;
        lastFrequencyChange = Date.now(); // Track that frequency changed
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
    consecutiveErrors++;
    console.error(`Error getting VFO state (${consecutiveErrors} consecutive):`, error);
    // After 3 consecutive errors, we'll back off automatically
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

  // Update display immediately for responsive feel
  currentFrequencyHz = frequencyHz;
  updateFrequencyDisplay();
  updateBandDisplay();

  // Debounce frequency updates to avoid flooding the radio
  pendingFrequencyUpdate = setTimeout(() => {
    const url = `/api/v1/frequency?frequency=${frequencyHz}`;
    fetch(url, { method: 'PUT' })
      .then(response => {
        if (response.ok) {
          console.log('Frequency updated successfully:', frequencyHz);
        } else {
          console.error('Error updating frequency');
          // Revert display on error
          getCurrentVfoState();
        }
      })
      .catch(error => {
        console.error('Fetch error:', error);
        // Revert display on error
        getCurrentVfoState();
      })
      .finally(() => {
        pendingFrequencyUpdate = null;
      });
  }, 300); // 300ms debounce
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
    lastUserAction = Date.now(); // Mark user action to prevent polling conflicts

    // Set frequency first
    setFrequency(BAND_PLAN[band].initial);

    // Check current mode from radio after frequency change and only set sideband if in SSB mode
    // Wait for debounced frequency update to complete before checking mode
    setTimeout(() => {
      // Get current mode from radio (don't trust cached value since user may have changed it on radio)
      fetch('/api/v1/mode', { method: 'GET' })
        .then(response => {
          if (response.ok) {
            return response.text();
          }
          throw new Error('Failed to get current mode');
        })
        .then(modeFromRadio => {
          const mode = modeFromRadio.toUpperCase();

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
    }, 400); // Wait for frequency debounce (300ms) + network round-trip margin
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
  if (vfoUpdateInterval) {
    clearInterval(vfoUpdateInterval);
  }

  // Reset error tracking
  consecutiveErrors = 0;
  lastFrequencyChange = 0;

  // Get initial values
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

      // Reset error counter if we've been stable for a while
      if (consecutiveErrors > 0 && Date.now() - lastFrequencyChange > 10000) {
        console.log('System stable, resetting error counter');
        consecutiveErrors = 0;
      }
    }, 3000);
  });
}

function stopVfoUpdates() {
  if (vfoUpdateInterval) {
    clearInterval(vfoUpdateInterval);
    vfoUpdateInterval = null;
  }

  if (pendingFrequencyUpdate) {
    clearTimeout(pendingFrequencyUpdate);
    pendingFrequencyUpdate = null;
  }

  isUpdatingVfo = false;
  lastUserAction = 0;
}

function tuneAtu() {
  const url = "/api/v1/atu";
  fetch(url, { method: "PUT" })
    .then(response => {
      if (response.ok) {
        // Visual feedback
        const atuBtn = document.querySelector('.btn-tune');
        if (atuBtn) {
          atuBtn.style.background = 'var(--success)';
          setTimeout(() => {
            atuBtn.style.background = '';
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
  document.getElementById("message1").value = localStorage.getItem("message1") || "";
  document.getElementById("message2").value = localStorage.getItem("message2") || "";
  document.getElementById("message3").value = localStorage.getItem("message3") || "";
}

function saveInputValues() {
  localStorage.setItem("message1", document.getElementById("message1").value);
  localStorage.setItem("message2", document.getElementById("message2").value);
  localStorage.setItem("message3", document.getElementById("message3").value);
}

// Collapsible section functionality
function toggleSection(sectionId) {
  const content = document.getElementById(sectionId);
  const iconId = sectionId.replace('-section', '-icon');
  const icon = document.getElementById(iconId);

  if (content.style.display === 'none') {
    content.style.display = 'block';
    icon.innerHTML = '&#9660;'; // Down triangle
    localStorage.setItem(sectionId + '_expanded', 'true');
  } else {
    content.style.display = 'none';
    icon.innerHTML = '&#9654;'; // Right triangle
    localStorage.setItem(sectionId + '_expanded', 'false');
  }
}

function loadCollapsibleStates() {
  const sections = ['tune-section', 'transmit-section'];
  sections.forEach(sectionId => {
    const savedState = localStorage.getItem(sectionId + '_expanded');
    const content = document.getElementById(sectionId);
    const iconId = sectionId.replace('-section', '-icon');
    const icon = document.getElementById(iconId);

    if (savedState === 'false') {
      content.style.display = 'none';
      icon.innerHTML = '&#9654;'; // Right triangle
    } else {
      content.style.display = 'block';
      icon.innerHTML = '&#9660;'; // Down triangle
    }
  });
}

let gMessageInputListenersAttached = false;

function catOnAppearing() {
  console.info("CAT tab appearing");
  loadInputValues();
  loadCollapsibleStates();

  if (!gMessageInputListenersAttached) {
    gMessageInputListenersAttached = true;
    document.getElementById("message1").addEventListener("input", saveInputValues);
    document.getElementById("message2").addEventListener("input", saveInputValues);
    document.getElementById("message3").addEventListener("input", saveInputValues);
  }

  startVfoUpdates();
}

function catOnLeaving() {
  console.info("CAT tab leaving");
  stopVfoUpdates();
}
