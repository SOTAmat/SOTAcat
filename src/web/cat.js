// ============================================================================
// CAT (Computer Aided Transceiver) Control Page Logic
// ============================================================================
// Provides radio control interface for frequency, mode, power, and keying

// ============================================================================
// State Object
// ============================================================================

// CAT page state encapsulated in a single object
const CatState = {
    // Transmit state
    isXmitActive: false,

    // VFO state
    currentFrequencyHz: 14225000, // Default to 20m
    currentMode: 'USB',

    // VFO polling state
    vfoUpdateInterval: null,
    lastUserAction: 0,
    isUpdatingVfo: false,
    pendingFrequencyUpdate: null,
    consecutiveErrors: 0,
    lastFrequencyChange: 0,

    // UI state
    messageInputListenersAttached: false,
    catEventListenersAttached: false
};

// ============================================================================
// Constants and Band Plan
// ============================================================================

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

// ============================================================================
// Message/Audio Playback Functions
// ============================================================================

// Play pre-recorded message from specified memory bank slot (1-3)
function playMsg(slot) {
  const url = `/api/v1/msg?bank=${slot}`;
  fetch(url, { method: "PUT" }).catch((error) =>
    console.error("Fetch error:", error),
  );
}

// ============================================================================
// Transmit Control Functions
// ============================================================================

// Send transmit state change request to radio (state: 0=RX, 1=TX)
function sendXmitRequest(state) {
  const url = `/api/v1/xmit?state=${state}`;
  fetch(url, { method: "PUT" }).catch((error) =>
    console.error("Fetch error:", error)
  );
}

// Toggle transmit state on/off
function toggleXmit() {
  const xmitButton = document.getElementById("xmit-button");
  CatState.isXmitActive = !CatState.isXmitActive;

  if (CatState.isXmitActive) {
    xmitButton.classList.add("active");
    sendXmitRequest(1);
  } else {
    xmitButton.classList.remove("active");
    sendXmitRequest(0);
  }
}

// ============================================================================
// Power Control Functions
// ============================================================================

// Set power to minimum (0W) or maximum (15W for KX3, 10W for KX2) - maximum: true/false
function setPowerMinMax(maximum) {
  // KX3 max power is 15w, KX2 will accept that and gracefully set 10w instead
  // On both radios, actual power may be lower than requested, depending on mode, battery, etc.
  const url = `/api/v1/power?power=${maximum ? "15" : "0"}`;
  fetch(url, { method: "PUT" }).catch((error) =>
    console.error("Fetch error:", error),
  );
}

// ============================================================================
// Keyer Functions
// ============================================================================

// Send CW message to radio keyer (message: string, 1-24 characters)
function sendKeys(message) {
  if (message.length < 1 || message.length > 24) {
    alert("Text length must be 1-24 characters.");
    return;
  }

  const url = `/api/v1/keyer?message=${message}`;
  fetch(url, { method: "PUT" }).catch((error) =>
    console.error("Fetch error:", error),
  );
}

// ============================================================================
// Frequency Formatting and Parsing Functions
// ============================================================================

// Format frequency from Hz to human-readable XX.XXX.XXX MHz format (returns string)
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

/**
 * Parse user frequency input into Hz
 * Supports various formats:
 * - Pure integers: 7225 -> 7.225 MHz, 14225 -> 14.225 MHz, 282 -> 28.200 MHz
 * - Single decimal: 7.225 -> 7.225 MHz, 14.070 -> 14.070 MHz
 * - Multi-period: 14.208.1 -> 14.208100 MHz
 *
 * Returns an object: { success: boolean, frequencyHz: number, error: string }
 */
function parseFrequencyInput(input) {
  // Clean the input
  const cleaned = input.trim();

  if (!cleaned) {
    return { success: false, error: 'Empty input' };
  }

  // Convert commas to periods (treat them as equivalent separators)
  const normalized = cleaned.replace(/,/g, '.');

  // Allow only digits and periods/commas
  if (!/^[0-9.,]+$/.test(cleaned)) {
    return { success: false, error: 'Invalid characters (only digits, periods, and commas allowed)' };
  }

  // Count periods (after normalization)
  const periodCount = (normalized.match(/\./g) || []).length;

  let frequencyHz;

  if (periodCount === 0) {
    // Pure integer input - interpret intelligently
    frequencyHz = parseIntegerFrequency(normalized);
  } else if (periodCount === 1) {
    // Single decimal - treat as MHz
    const mhz = parseFloat(normalized);
    if (isNaN(mhz)) {
      return { success: false, error: 'Invalid decimal format' };
    }
    frequencyHz = Math.round(mhz * 1000000);
  } else {
    // Multi-period format - treat periods as grouping separators
    frequencyHz = parseMultiPeriodFrequency(normalized);
  }

  if (frequencyHz === null) {
    return { success: false, error: 'Could not parse frequency' };
  }

  // Validate against band plan
  const band = getBandFromFrequency(frequencyHz);
  if (!band) {
    return {
      success: false,
      error: `Frequency ${(frequencyHz / 1000000).toFixed(3)} MHz not in any supported band`
    };
  }

  return { success: true, frequencyHz, band };
}

/**
 * Parse integer frequency inputs intelligently
 * Examples:
 * - 7225 -> 7.225 MHz (40m)
 * - 14225 -> 14.225 MHz (20m)
 * - 28085 -> 28.085 MHz (10m)
 * - 282 -> 28.200 MHz (10m)
 */
function parseIntegerFrequency(intStr) {
  const num = parseInt(intStr, 10);
  if (isNaN(num)) return null;

  // Try different interpretations and see which fits a band
  const candidates = [];

  // Interpretation 1: Last 3 digits are kHz
  if (num >= 1000) {
    const mhz = Math.floor(num / 1000);
    const khz = num % 1000;
    candidates.push(mhz * 1000000 + khz * 1000);
  }

  // Interpretation 2: Direct MHz (for smaller numbers)
  candidates.push(num * 1000000);

  // Interpretation 3: Last 2 digits are 10s of kHz (e.g., 282 -> 28.2 MHz)
  if (num >= 100) {
    const mhz = Math.floor(num / 10);
    const tenKhz = num % 10;
    candidates.push(mhz * 1000000 + tenKhz * 100000);
  }

  // Try to find a candidate that fits a known band
  for (const freqHz of candidates) {
    if (getBandFromFrequency(freqHz)) {
      return freqHz;
    }
  }

  // If none match, return the first interpretation (most common)
  return candidates[0] || null;
}

/**
 * Parse multi-period format like 14.208.1 -> 14.208100 MHz
 * The first part is the MHz whole number, subsequent parts are decimal digits
 */
function parseMultiPeriodFrequency(multiPeriod) {
  // Split by periods and concatenate
  const parts = multiPeriod.split('.');

  if (parts.length < 2) return null;

  const wholeMhz = parseInt(parts[0], 10);
  if (isNaN(wholeMhz)) return null;

  // Concatenate all decimal parts
  let decimalStr = parts.slice(1).join('');

  // Pad to 6 decimal places (1 Hz resolution)
  decimalStr = decimalStr.padEnd(6, '0');

  // Take only first 6 digits
  decimalStr = decimalStr.substring(0, 6);

  const decimalHz = parseInt(decimalStr, 10);
  if (isNaN(decimalHz)) return null;

  return wholeMhz * 1000000 + decimalHz;
}

// Determine which amateur band a frequency falls into (returns '40m', '20m', etc., or null)
function getBandFromFrequency(frequencyHz) {
  for (const [band, plan] of Object.entries(BAND_PLAN)) {
    if (frequencyHz >= plan.min && frequencyHz <= plan.max) {
      return band;
    }
  }
  return null; // Frequency doesn't match any of our supported bands
}

// ============================================================================
// VFO Display Functions
// ============================================================================

// Update frequency display with current VFO frequency
function updateFrequencyDisplay() {
  const display = document.getElementById('current-frequency');
  if (display) {
    display.textContent = formatFrequency(CatState.currentFrequencyHz);
    // Brief visual feedback
    display.style.color = 'var(--success)';
    setTimeout(() => {
      display.style.color = '';
    }, 200);
  }
}

// Update mode display with current VFO mode
function updateModeDisplay() {
  const display = document.getElementById('current-mode');
  if (display) {
    display.textContent = CatState.currentMode;
    // Brief visual feedback
    display.style.color = 'var(--warning)';
    setTimeout(() => {
      display.style.color = '';
    }, 200);
  }

  // Update mode button active states
  document.querySelectorAll('.btn-mode').forEach(btn => btn.classList.remove('active'));

  if (CatState.currentMode === 'CW') {
    document.getElementById('btn-cw')?.classList.add('active');
  } else if (CatState.currentMode === 'USB' || CatState.currentMode === 'LSB') {
    document.getElementById('btn-ssb')?.classList.add('active');
  } else if (CatState.currentMode === 'DATA') {
    document.getElementById('btn-data')?.classList.add('active');
  } else if (CatState.currentMode === 'AM') {
    document.getElementById('btn-am')?.classList.add('active');
  } else if (CatState.currentMode === 'FM') {
    document.getElementById('btn-fm')?.classList.add('active');
  }
}

// Update band button highlighting based on current frequency
function updateBandDisplay() {
  // Clear all active states first
  document.querySelectorAll('.btn-band').forEach(btn => btn.classList.remove('active'));

  // Determine which band the current frequency falls into
  const currentBand = getBandFromFrequency(CatState.currentFrequencyHz);

  if (currentBand) {
    // Find and activate the corresponding band button
    const bandButton = document.getElementById(`btn-${currentBand}`);
    if (bandButton) {
      bandButton.classList.add('active');
      console.log(`Band display updated: ${currentBand} active`);
    }
  } else {
    console.log('Current frequency not in any supported band range');
  }
}

// ============================================================================
// Frequency Editing Functions
// ============================================================================

// Make the frequency display editable when clicked
function enableFrequencyEditing() {
  const display = document.getElementById('current-frequency');
  const input = document.getElementById('frequency-input');
  const modeDisplay = document.getElementById('current-mode');
  if (!display || !input) return;

  // Store original value for restoration on cancel
  const originalFrequency = CatState.currentFrequencyHz;

  // Flag to prevent double-processing (when both Enter and blur fire)
  let isProcessing = false;

  // Switch from display to input and hide mode display
  display.style.display = 'none';
  input.style.display = '';
  if (modeDisplay) modeDisplay.style.display = 'none';
  input.value = display.textContent;

  // Handle input confirmation
  const confirmInput = () => {
    if (isProcessing) return; // Prevent double-processing
    isProcessing = true;

    const userInput = input.value.trim();

    if (!userInput) {
      // Empty input - cancel
      exitEditMode();
      return;
    }

    // Parse the frequency
    const result = parseFrequencyInput(userInput);

    if (result.success) {
      // Valid frequency - apply it
      setFrequency(result.frequencyHz);
      exitEditMode();
      console.log(`Frequency set to ${result.frequencyHz} Hz (${result.band})`);
    } else {
      // Invalid frequency - show error
      console.error('Invalid frequency input:', result.error);
      alert(result.error);
      exitEditMode();
    }
  };

  // Handle cancellation
  const cancelInput = () => {
    if (isProcessing) return; // Prevent double-processing
    isProcessing = true;

    // Restore original frequency
    CatState.currentFrequencyHz = originalFrequency;
    exitEditMode();
  };

  // Exit edit mode and restore display
  const exitEditMode = () => {
    input.style.display = 'none';
    display.style.display = '';
    if (modeDisplay) modeDisplay.style.display = '';
    display.textContent = formatFrequency(CatState.currentFrequencyHz);

    // Remove event listeners
    input.removeEventListener('blur', confirmInput);
    input.removeEventListener('keydown', handleKeydown);
  };

  // Keydown handler
  const handleKeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur(); // Trigger blur instead of calling confirmInput directly
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelInput();
    }
  };

  // Attach event handlers
  input.addEventListener('blur', confirmInput);
  input.addEventListener('keydown', handleKeydown);

  // Focus and select all text
  input.focus();
  input.select();
}

// ============================================================================
// VFO Control Functions
// ============================================================================

// Set radio frequency with 300ms debouncing to avoid flooding (frequencyHz: integer in Hz)
function setFrequency(frequencyHz) {
  CatState.lastUserAction = Date.now(); // Mark user action timestamp

  // Clear any pending frequency update
  if (CatState.pendingFrequencyUpdate) {
    clearTimeout(CatState.pendingFrequencyUpdate);
  }

  // Update display immediately for responsive feel
  CatState.currentFrequencyHz = frequencyHz;
  updateFrequencyDisplay();
  updateBandDisplay();

  // Debounce frequency updates to avoid flooding the radio
  CatState.pendingFrequencyUpdate = setTimeout(async () => {
    const url = `/api/v1/frequency?frequency=${frequencyHz}`;

    try {
      const response = await fetch(url, { method: 'PUT' });

      if (response.ok) {
        console.log('Frequency updated successfully:', frequencyHz);
      } else {
        console.error('Error updating frequency');
        // Revert display on error
        getCurrentVfoState();
      }
    } catch (error) {
      console.error('Fetch error:', error);
      // Revert display on error
      getCurrentVfoState();
    } finally {
      CatState.pendingFrequencyUpdate = null;
    }
  }, 300); // 300ms debounce
}

// Adjust frequency by specified delta in Hz (positive or negative)
function adjustFrequency(deltaHz) {
  const newFrequency = CatState.currentFrequencyHz + deltaHz;

  // Basic bounds checking (1.8 MHz to 29.7 MHz)
  if (newFrequency >= 1800000 && newFrequency <= 29700000) {
    setFrequency(newFrequency);
  } else {
    console.warn('Frequency out of bounds:', newFrequency);
  }
}

// Set radio mode (mode: 'CW', 'SSB', 'USB', 'LSB', 'DATA', etc.)
async function setMode(mode) {
  CatState.lastUserAction = Date.now(); // Mark user action timestamp

  let actualMode = mode;

  // Handle SSB mode selection based on frequency
  if (mode === 'SSB') {
    actualMode = CatState.currentFrequencyHz < 10000000 ? 'LSB' : 'USB';
  }

  const url = `/api/v1/mode?bw=${actualMode}`;

  try {
    const response = await fetch(url, { method: 'PUT' });

    if (response.ok) {
      CatState.currentMode = actualMode;
      updateModeDisplay();
      console.log('Mode updated successfully:', actualMode);
    } else {
      console.error('Error updating mode');
      // Revert display on error
      getCurrentVfoState();
    }
  } catch (error) {
    console.error('Fetch error:', error);
    // Revert display on error
    getCurrentVfoState();
  }
}

// Select band and set appropriate frequency and mode (band: '40m', '20m', '17m', '15m', '12m', '10m')
function selectBand(band) {
  if (BAND_PLAN[band]) {
    CatState.lastUserAction = Date.now(); // Mark user action to prevent polling conflicts

    // Set frequency first
    setFrequency(BAND_PLAN[band].initial);

    // Check current mode from radio after frequency change and only set sideband if in SSB mode
    // Wait for debounced frequency update to complete before checking mode
    setTimeout(async () => {
      try {
        // Get current mode from radio (don't trust cached value since user may have changed it on radio)
        const response = await fetch('/api/v1/mode', { method: 'GET' });

        if (!response.ok) {
          throw new Error('Failed to get current mode');
        }

        const modeFromRadio = await response.text();
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
      } catch (error) {
        console.error('Error checking current mode:', error);
      }
    }, 400); // Wait for frequency debounce (300ms) + network round-trip margin
  }
}

// ============================================================================
// VFO Polling Functions
// ============================================================================

// Poll radio for current VFO state (frequency and mode)
async function getCurrentVfoState() {
  if (CatState.isUpdatingVfo) return; // Avoid concurrent updates

  // Don't poll if user made a change in the last 2 seconds
  if (Date.now() - CatState.lastUserAction < 2000) return;

  // Back off if we've had consecutive errors
  if (CatState.consecutiveErrors > 2) {
    console.log('Backing off due to errors, skipping poll');
    return;
  }

  // If frequency changed recently (within 5 seconds), we're likely tuning - be more cautious
  const timeSinceFreqChange = Date.now() - CatState.lastFrequencyChange;
  if (timeSinceFreqChange < 5000 && timeSinceFreqChange > 0) {
    // Skip some polls when actively tuning to reduce server load
    if (Math.random() < 0.5) return;
  }

  CatState.isUpdatingVfo = true;

  try {
    // Fetch both frequency and mode in parallel
    const [frequencyResponse, modeResponse] = await Promise.all([
      fetch('/api/v1/frequency', { method: 'GET' }),
      fetch('/api/v1/mode', { method: 'GET' })
    ]);

    const frequency = frequencyResponse.ok ? await frequencyResponse.text() : null;
    const mode = modeResponse.ok ? await modeResponse.text() : null;

    // Success - reset error counter
    CatState.consecutiveErrors = 0;

    // Update frequency if it has changed
    if (frequency) {
      const newFreq = parseInt(frequency);
      if (newFreq !== CatState.currentFrequencyHz) {
        CatState.currentFrequencyHz = newFreq;
        CatState.lastFrequencyChange = Date.now(); // Track that frequency changed
        updateFrequencyDisplay();
        updateBandDisplay(); // Update band button active state
        console.log('Frequency updated from radio:', CatState.currentFrequencyHz);
      }
    }

    // Update mode if it has changed
    if (mode) {
      const newMode = mode.toUpperCase();
      if (newMode !== CatState.currentMode) {
        CatState.currentMode = newMode;
        updateModeDisplay();
        console.log('Mode updated from radio:', CatState.currentMode);
      }
    }
  } catch (error) {
    CatState.consecutiveErrors++;
    console.error(`Error getting VFO state (${CatState.consecutiveErrors} consecutive):`, error);
    // After 3 consecutive errors, we'll back off automatically
  } finally {
    CatState.isUpdatingVfo = false;
  }
}

// Start periodic VFO state polling
async function startVfoUpdates() {
  if (CatState.vfoUpdateInterval) {
    clearInterval(CatState.vfoUpdateInterval);
  }

  // Reset error tracking
  CatState.consecutiveErrors = 0;
  CatState.lastFrequencyChange = 0;

  // Get initial values
  CatState.isUpdatingVfo = true;

  try {
    const [frequencyResponse, modeResponse] = await Promise.all([
      fetch('/api/v1/frequency', { method: 'GET' }),
      fetch('/api/v1/mode', { method: 'GET' })
    ]);

    const frequency = frequencyResponse.ok ? await frequencyResponse.text() : null;
    const mode = modeResponse.ok ? await modeResponse.text() : null;

    if (frequency) {
      CatState.currentFrequencyHz = parseInt(frequency);
      updateFrequencyDisplay();
      updateBandDisplay();
      console.log('Initial frequency loaded:', CatState.currentFrequencyHz);
    }
    if (mode) {
      CatState.currentMode = mode.toUpperCase();
      updateModeDisplay();
      console.log('Initial mode loaded:', CatState.currentMode);
    }
  } catch (error) {
    console.error('Error loading initial VFO state:', error);
  } finally {
    CatState.isUpdatingVfo = false;

    // Start periodic updates (every 3 seconds, respecting user actions)
    CatState.vfoUpdateInterval = setInterval(() => {
      getCurrentVfoState();

      // Reset error counter if we've been stable for a while
      if (CatState.consecutiveErrors > 0 && Date.now() - CatState.lastFrequencyChange > 10000) {
        console.log('System stable, resetting error counter');
        CatState.consecutiveErrors = 0;
      }
    }, 3000);
  }
}

// Stop VFO state polling
function stopVfoUpdates() {
  if (CatState.vfoUpdateInterval) {
    clearInterval(CatState.vfoUpdateInterval);
    CatState.vfoUpdateInterval = null;
  }

  if (CatState.pendingFrequencyUpdate) {
    clearTimeout(CatState.pendingFrequencyUpdate);
    CatState.pendingFrequencyUpdate = null;
  }

  CatState.isUpdatingVfo = false;
  CatState.lastUserAction = 0;
}

// ============================================================================
// ATU (Antenna Tuner) Functions
// ============================================================================

// Initiate ATU auto-tune cycle
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

// ============================================================================
// UI State Persistence Functions
// ============================================================================

// Load saved CW message text from localStorage
function loadInputValues() {
  document.getElementById("message-1").value = localStorage.getItem("message1") || "";
  document.getElementById("message-2").value = localStorage.getItem("message2") || "";
  document.getElementById("message-3").value = localStorage.getItem("message3") || "";
}

// Save CW message text to localStorage
function saveInputValues() {
  localStorage.setItem("message1", document.getElementById("message-1").value);
  localStorage.setItem("message2", document.getElementById("message-2").value);
  localStorage.setItem("message3", document.getElementById("message-3").value);
}

// Toggle collapsible section visibility (sectionId: 'tune-section', 'spot-section', 'transmit-section')
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

// Load saved collapsed/expanded state for all sections
function loadCollapsibleStates() {
  const sections = ['tune-section', 'spot-section', 'transmit-section'];
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

// ============================================================================
// External Integration Functions
// ============================================================================

// Launch SOTAmat app with return path to this page
function launchSOTAmat() {
  const sotamat_base_url = 'sotamat://api/v1?app=sotacat&appversion=2.1';
  const currentUrl = window.location.href;
  const encodedReturnPath = encodeURIComponent(currentUrl);
  const newHref = `${sotamat_base_url}&returnpath=${encodedReturnPath}`;

  window.open(newHref, '_blank');
}

// ============================================================================
// Event Handler Attachment
// ============================================================================

// Attach all CAT page event listeners
function attachCatEventListeners() {
  // Only attach once to prevent memory leaks
  if (CatState.catEventListenersAttached) {
    return;
  }
  CatState.catEventListenersAttached = true;

  // Section toggle handlers
  document.querySelectorAll('.section-header[data-section]').forEach(header => {
    header.addEventListener('click', () => {
      const sectionId = header.getAttribute('data-section');
      toggleSection(sectionId);
    });
  });

  // Frequency display click-to-edit
  const frequencyDisplay = document.getElementById('current-frequency');
  if (frequencyDisplay) {
    frequencyDisplay.addEventListener('click', enableFrequencyEditing);
  }

  // Frequency adjustment buttons
  document.querySelectorAll('.btn-freq[data-freq-delta]').forEach(button => {
    button.addEventListener('click', () => {
      const delta = parseInt(button.getAttribute('data-freq-delta'));
      adjustFrequency(delta);
    });
  });

  // Band selection buttons
  document.querySelectorAll('.btn-band[data-band]').forEach(button => {
    button.addEventListener('click', () => {
      const band = button.getAttribute('data-band');
      selectBand(band);
    });
  });

  // Mode selection buttons
  document.querySelectorAll('.btn-mode[data-mode]').forEach(button => {
    button.addEventListener('click', () => {
      const mode = button.getAttribute('data-mode');
      setMode(mode);
    });
  });

  // Power control buttons
  const minPowerBtn = document.getElementById('min-power-button');
  if (minPowerBtn) {
    minPowerBtn.addEventListener('click', () => setPowerMinMax(false));
  }

  const maxPowerBtn = document.getElementById('max-power-button');
  if (maxPowerBtn) {
    maxPowerBtn.addEventListener('click', () => setPowerMinMax(true));
  }

  const tuneAtuBtn = document.getElementById('tune-atu-button');
  if (tuneAtuBtn) {
    tuneAtuBtn.addEventListener('click', tuneAtu);
  }

  // SOTAMAT button
  const sotamatBtn = document.getElementById('sotamat-button');
  if (sotamatBtn) {
    sotamatBtn.addEventListener('click', launchSOTAmat);
  }

  // Message playback buttons
  document.querySelectorAll('.btn-msg[data-msg-slot]').forEach(button => {
    button.addEventListener('click', () => {
      const slot = parseInt(button.getAttribute('data-msg-slot'));
      playMsg(slot);
    });
  });

  // Transmit toggle button
  const xmitBtn = document.getElementById('xmit-button');
  if (xmitBtn) {
    xmitBtn.addEventListener('click', toggleXmit);
  }

  // CW send buttons
  document.querySelectorAll('.btn-send[data-message-input]').forEach(button => {
    button.addEventListener('click', () => {
      const inputId = button.getAttribute('data-message-input');
      const inputElement = document.getElementById(inputId);
      if (inputElement) {
        sendKeys(inputElement.value);
      }
    });
  });
}

// ============================================================================
// Page Lifecycle
// ============================================================================

// Called when CAT tab becomes visible
function onCatAppearing() {
  console.info("CAT tab appearing");
  loadInputValues();
  loadCollapsibleStates();

  if (!CatState.messageInputListenersAttached) {
    CatState.messageInputListenersAttached = true;
    document.getElementById("message-1").addEventListener("input", saveInputValues);
    document.getElementById("message-2").addEventListener("input", saveInputValues);
    document.getElementById("message-3").addEventListener("input", saveInputValues);
  }

  // Attach event listeners for all controls
  attachCatEventListeners();

  startVfoUpdates();
}

// Called when CAT tab is hidden
function onCatLeaving() {
  console.info("CAT tab leaving");
  stopVfoUpdates();
}
