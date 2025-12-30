// ============================================================================
// CAT (Computer Aided Transceiver) Control Page Logic
// ============================================================================
// Provides radio control interface for frequency, mode, power, and keying

// ============================================================================
// State Object
// ============================================================================

// CAT page state encapsulated in a single object
// Note: VFO frequency/mode are stored in global AppState for cross-page sharing
const CatState = {
    // Transmit state
    isXmitActive: false,

    // VFO polling state (frequency/mode stored in AppState)
    vfoUpdateInterval: null,
    lastUserAction: 0,
    isUpdatingVfo: false,
    pendingFrequencyUpdate: null,
    consecutiveErrors: 0,
    lastFrequencyChange: 0,

    // UI state
    messageInputListenersAttached: false,
    catEventListenersAttached: false,
};

// ============================================================================
// Constants
// ============================================================================

// Timing constants (milliseconds)
const VISUAL_FEEDBACK_DURATION_MS = 200;
const FREQUENCY_UPDATE_DEBOUNCE_MS = 300;
const MODE_CHECK_DELAY_MS = 400;
// VFO_POLLING_INTERVAL_MS is defined in main.js
const ERROR_RESET_STABILITY_MS = 10000;
const ATU_FEEDBACK_DURATION_MS = 1000;

// Frequency constants defined in main.js: BAND_PLAN, DEFAULT_FREQUENCY_HZ,
// LSB_USB_BOUNDARY_HZ, HF_MIN_FREQUENCY_HZ, HF_MAX_FREQUENCY_HZ

// ============================================================================
// Message/Audio Playback Functions
// ============================================================================

// Play pre-recorded message from specified memory bank slot (1-3)
function playMsg(slot) {
    const url = `/api/v1/msg?bank=${slot}`;
    fetchQuiet(url, { method: "PUT" }, "CAT");
}

// ============================================================================
// Transmit Control Functions
// ============================================================================

// Send transmit state change request to radio (state: 0=RX, 1=TX)
function sendXmitRequest(state) {
    const url = `/api/v1/xmit?state=${state}`;
    fetchQuiet(url, { method: "PUT" }, "CAT");
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
    fetchQuiet(url, { method: "PUT" }, "CAT");
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
    fetchQuiet(url, { method: "PUT" }, "CAT");
}

// Frequency utilities (BAND_PLAN, formatFrequency, parseFrequencyInput,
// parseIntegerFrequency, parseMultiPeriodFrequency, getBandFromFrequency)
// are now defined in main.js

// ============================================================================
// VFO Display Functions
// ============================================================================

// Update frequency display with current VFO frequency
function updateFrequencyDisplay() {
    const display = document.getElementById("current-frequency");
    if (display) {
        display.textContent = formatFrequency(AppState.vfoFrequencyHz || DEFAULT_FREQUENCY_HZ);
        // Brief visual feedback
        display.style.color = "var(--success)";
        setTimeout(() => {
            display.style.color = "";
        }, VISUAL_FEEDBACK_DURATION_MS);
    }
}

// Update mode display with current VFO mode
function updateModeDisplay() {
    const display = document.getElementById("current-mode");
    if (display) {
        display.textContent = AppState.vfoMode || "USB";
        // Brief visual feedback
        display.style.color = "var(--warning)";
        setTimeout(() => {
            display.style.color = "";
        }, VISUAL_FEEDBACK_DURATION_MS);
    }

    // Update mode button active states
    document.querySelectorAll(".btn-mode").forEach((btn) => btn.classList.remove("active"));

    const currentMode = AppState.vfoMode || "USB";
    if (currentMode === "CW") {
        document.getElementById("btn-cw")?.classList.add("active");
    } else if (currentMode === "USB" || currentMode === "LSB") {
        document.getElementById("btn-ssb")?.classList.add("active");
    } else if (currentMode === "DATA") {
        document.getElementById("btn-data")?.classList.add("active");
    } else if (currentMode === "AM") {
        document.getElementById("btn-am")?.classList.add("active");
    } else if (currentMode === "FM") {
        document.getElementById("btn-fm")?.classList.add("active");
    }
}

// Update band button highlighting based on current frequency
function updateBandDisplay() {
    // Clear all active states first
    document.querySelectorAll(".btn-band").forEach((btn) => btn.classList.remove("active"));

    // Determine which band the current frequency falls into
    const currentBand = getBandFromFrequency(AppState.vfoFrequencyHz || DEFAULT_FREQUENCY_HZ);

    if (currentBand) {
        // Find and activate the corresponding band button
        const bandButton = document.getElementById(`btn-${currentBand}`);
        if (bandButton) {
            bandButton.classList.add("active");
            Log.debug("CAT", `Band display updated: ${currentBand} active`);
        }
    } else {
        Log.debug("CAT", "Current frequency not in any supported band range");
    }
}

// ============================================================================
// Frequency Editing Functions
// ============================================================================

// Make the frequency display editable when clicked
function enableFrequencyEditing() {
    const display = document.getElementById("current-frequency");
    const input = document.getElementById("frequency-input");
    const modeDisplay = document.getElementById("current-mode");
    if (!display || !input) return;

    // Store original value for restoration on cancel
    const originalFrequency = AppState.vfoFrequencyHz || DEFAULT_FREQUENCY_HZ;

    // Flag to prevent double-processing (when both Enter and blur fire)
    let isProcessing = false;

    // Switch from display to input and hide mode display
    display.style.display = "none";
    input.style.display = "";
    if (modeDisplay) modeDisplay.style.display = "none";
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
            Log.debug("CAT", `Frequency set to ${result.frequencyHz} Hz (${result.band})`);
        } else {
            // Invalid frequency - show error
            Log.error("CAT", "Invalid frequency input:", result.error);
            alert(result.error);
            exitEditMode();
        }
    };

    // Handle cancellation
    const cancelInput = () => {
        if (isProcessing) return; // Prevent double-processing
        isProcessing = true;

        // Restore original frequency
        AppState.vfoFrequencyHz = originalFrequency;
        exitEditMode();
    };

    // Exit edit mode and restore display
    const exitEditMode = () => {
        input.style.display = "none";
        display.style.display = "";
        if (modeDisplay) modeDisplay.style.display = "";
        display.textContent = formatFrequency(AppState.vfoFrequencyHz || DEFAULT_FREQUENCY_HZ);

        // Remove event listeners
        input.removeEventListener("blur", confirmInput);
        input.removeEventListener("keydown", handleKeydown);
    };

    // Keydown handler
    const handleKeydown = (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            input.blur(); // Trigger blur instead of calling confirmInput directly
        } else if (e.key === "Escape") {
            e.preventDefault();
            cancelInput();
        }
    };

    // Attach event handlers
    input.addEventListener("blur", confirmInput);
    input.addEventListener("keydown", handleKeydown);

    // Focus and select all text
    input.focus();
    input.select();
}

// ============================================================================
// VFO Control Functions
// ============================================================================

// Notify all VFO subscribers of state change
function notifyVfoSubscribers() {
    AppState.vfoChangeCallbacks.forEach((callback) => {
        try {
            callback(AppState.vfoFrequencyHz, AppState.vfoMode);
        } catch (error) {
            Log.error("CAT", "VFO callback error:", error);
        }
    });
}

// Set radio frequency with 300ms debouncing to avoid flooding (frequencyHz: integer in Hz)
function setFrequency(frequencyHz) {
    CatState.lastUserAction = Date.now(); // Mark user action timestamp

    // Clear any pending frequency update
    if (CatState.pendingFrequencyUpdate) {
        clearTimeout(CatState.pendingFrequencyUpdate);
    }

    // Update global state and display immediately for responsive feel
    AppState.vfoFrequencyHz = frequencyHz;
    AppState.vfoLastUpdated = Date.now();
    updateFrequencyDisplay();
    updateBandDisplay();
    notifyVfoSubscribers();

    // Debounce frequency updates to avoid flooding the radio
    CatState.pendingFrequencyUpdate = setTimeout(async () => {
        const url = `/api/v1/frequency?frequency=${frequencyHz}`;

        try {
            const response = await fetch(url, { method: "PUT" });

            if (response.ok) {
                Log.debug("CAT", "Frequency updated:", frequencyHz);
            } else {
                Log.error("CAT", "Frequency update failed");
                // Revert display on error
                getCurrentVfoState();
            }
        } catch (error) {
            Log.error("CAT", "Frequency fetch error:", error);
            // Revert display on error
            getCurrentVfoState();
        } finally {
            CatState.pendingFrequencyUpdate = null;
        }
    }, FREQUENCY_UPDATE_DEBOUNCE_MS);
}

// Adjust frequency by specified delta in Hz (positive or negative)
function adjustFrequency(deltaHz) {
    const newFrequency = (AppState.vfoFrequencyHz || DEFAULT_FREQUENCY_HZ) + deltaHz;

    // Basic bounds checking for HF range
    if (newFrequency >= HF_MIN_FREQUENCY_HZ && newFrequency <= HF_MAX_FREQUENCY_HZ) {
        setFrequency(newFrequency);
    } else {
        Log.warn("CAT", "Frequency out of bounds:", newFrequency);
    }
}

// Set radio mode (mode: 'CW', 'SSB', 'USB', 'LSB', 'DATA', etc.)
async function setMode(mode) {
    CatState.lastUserAction = Date.now(); // Mark user action timestamp

    let actualMode = mode;

    // Handle SSB mode selection based on frequency
    if (mode === "SSB") {
        actualMode = (AppState.vfoFrequencyHz || DEFAULT_FREQUENCY_HZ) < LSB_USB_BOUNDARY_HZ ? "LSB" : "USB";
    }

    const url = `/api/v1/mode?bw=${actualMode}`;

    try {
        const response = await fetch(url, { method: "PUT" });

        if (response.ok) {
            AppState.vfoMode = actualMode;
            AppState.vfoLastUpdated = Date.now();
            updateModeDisplay();
            notifyVfoSubscribers();
            Log.debug("CAT", "Mode updated:", actualMode);
        } else {
            Log.error("CAT", "Mode update failed");
            // Revert display on error
            getCurrentVfoState();
        }
    } catch (error) {
        Log.error("CAT", "Mode fetch error:", error);
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
                const response = await fetch("/api/v1/mode", { method: "GET" });

                if (!response.ok) {
                    throw new Error("Failed to get current mode");
                }

                const modeFromRadio = await response.text();
                const mode = modeFromRadio.toUpperCase();

                // Only set sideband if current mode is SSB (USB or LSB)
                if (mode === "USB" || mode === "LSB") {
                    // Set appropriate sideband for the band
                    let targetMode = "USB"; // Default for higher bands
                    if (band === "40m") {
                        targetMode = "LSB"; // 40m typically uses LSB
                    }

                    // Only change if different from current mode
                    if (targetMode !== mode) {
                        setMode(targetMode);
                    }
                }
                // If not in SSB mode (AM, FM, DATA, CW, etc.), leave mode unchanged
            } catch (error) {
                Log.error("CAT", "Error checking current mode:", error);
            }
        }, MODE_CHECK_DELAY_MS);
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
        Log.debug("CAT", "Backing off due to errors, skipping poll");
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
            fetch("/api/v1/frequency", { method: "GET" }),
            fetch("/api/v1/mode", { method: "GET" }),
        ]);

        const frequency = frequencyResponse.ok ? await frequencyResponse.text() : null;
        const mode = modeResponse.ok ? await modeResponse.text() : null;

        // Success - reset error counter
        CatState.consecutiveErrors = 0;

        let changed = false;

        // Update frequency if it has changed
        if (frequency) {
            const newFreq = parseInt(frequency, 10);
            if (newFreq !== AppState.vfoFrequencyHz) {
                AppState.vfoFrequencyHz = newFreq;
                CatState.lastFrequencyChange = Date.now(); // Track that frequency changed
                updateFrequencyDisplay();
                updateBandDisplay(); // Update band button active state
                Log.debug("CAT", "Frequency updated from radio:", AppState.vfoFrequencyHz);
                changed = true;
            }
        }

        // Update mode if it has changed
        if (mode) {
            const newMode = mode.toUpperCase();
            if (newMode !== AppState.vfoMode) {
                AppState.vfoMode = newMode;
                updateModeDisplay();
                Log.debug("CAT", "Mode updated from radio:", AppState.vfoMode);
                changed = true;
            }
        }

        // Notify subscribers if anything changed
        if (changed) {
            AppState.vfoLastUpdated = Date.now();
            notifyVfoSubscribers();
        }
    } catch (error) {
        CatState.consecutiveErrors++;
        Log.error("CAT", `VFO state error (${CatState.consecutiveErrors} consecutive):`, error);
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
            fetch("/api/v1/frequency", { method: "GET" }),
            fetch("/api/v1/mode", { method: "GET" }),
        ]);

        const frequency = frequencyResponse.ok ? await frequencyResponse.text() : null;
        const mode = modeResponse.ok ? await modeResponse.text() : null;

        if (frequency) {
            AppState.vfoFrequencyHz = parseInt(frequency, 10);
            updateFrequencyDisplay();
            updateBandDisplay();
            Log.debug("CAT", "Initial frequency loaded:", AppState.vfoFrequencyHz);
        }
        if (mode) {
            AppState.vfoMode = mode.toUpperCase();
            updateModeDisplay();
            Log.debug("CAT", "Initial mode loaded:", AppState.vfoMode);
        }
        // Notify subscribers of initial state
        AppState.vfoLastUpdated = Date.now();
        notifyVfoSubscribers();
    } catch (error) {
        Log.error("CAT", "Error loading initial VFO state:", error);
    } finally {
        CatState.isUpdatingVfo = false;

        // Start periodic updates (every 3 seconds, respecting user actions)
        CatState.vfoUpdateInterval = setInterval(() => {
            getCurrentVfoState();

            // Reset error counter if we've been stable for a while
            if (
                CatState.consecutiveErrors > 0 &&
                Date.now() - CatState.lastFrequencyChange > ERROR_RESET_STABILITY_MS
            ) {
                Log.debug("CAT", "System stable, resetting error counter");
                CatState.consecutiveErrors = 0;
            }
        }, VFO_POLLING_INTERVAL_MS);
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
async function tuneAtu() {
    try {
        const response = await fetch("/api/v1/atu", { method: "PUT" });

        if (!response.ok) {
            Log.error("CAT", "ATU tune failed");
            return;
        }

        // Visual feedback
        const atuBtn = document.querySelector(".btn-tune");
        if (atuBtn) {
            atuBtn.style.background = "var(--success)";
            setTimeout(() => {
                atuBtn.style.background = "";
            }, ATU_FEEDBACK_DURATION_MS);
        }
    } catch (error) {
        Log.error("CAT", "ATU fetch error:", error);
    }
}

// ============================================================================
// UI State Persistence Functions
// ============================================================================

// Load saved CW message text from localStorage
function loadInputValues() {
    document.getElementById("cw-message-1").value = localStorage.getItem("catCWMessage1") || "";
    document.getElementById("cw-message-2").value = localStorage.getItem("catCWMessage2") || "";
    document.getElementById("cw-message-3").value = localStorage.getItem("catCWMessage3") || "";
}

// Save CW message text to localStorage
function saveInputValues() {
    localStorage.setItem("catCWMessage1", document.getElementById("cw-message-1").value);
    localStorage.setItem("catCWMessage2", document.getElementById("cw-message-2").value);
    localStorage.setItem("catCWMessage3", document.getElementById("cw-message-3").value);
}

// Mapping from DOM section IDs to localStorage keys
const SECTION_STORAGE_KEYS = {
    "tune-section": "catTuneSectionExpanded",
    "spot-section": "catSpotSectionExpanded",
    "transmit-section": "catTransmitSectionExpanded",
};

// Toggle collapsible section visibility (sectionId: 'tune-section', 'spot-section', 'transmit-section')
function toggleSection(sectionId) {
    const content = document.getElementById(sectionId);
    const iconId = sectionId.replace("-section", "-icon");
    const icon = document.getElementById(iconId);
    const storageKey = SECTION_STORAGE_KEYS[sectionId];

    if (content.style.display === "none") {
        content.style.display = "block";
        icon.innerHTML = "&#9660;"; // Down triangle
        localStorage.setItem(storageKey, "true");
    } else {
        content.style.display = "none";
        icon.innerHTML = "&#9654;"; // Right triangle
        localStorage.setItem(storageKey, "false");
    }
}

// Load saved collapsed/expanded state for all sections
function loadCollapsibleStates() {
    const sections = ["tune-section", "spot-section", "transmit-section"];
    sections.forEach((sectionId) => {
        const storageKey = SECTION_STORAGE_KEYS[sectionId];
        const savedState = localStorage.getItem(storageKey);
        const content = document.getElementById(sectionId);
        const iconId = sectionId.replace("-section", "-icon");
        const icon = document.getElementById(iconId);

        if (savedState === "false") {
            content.style.display = "none";
            icon.innerHTML = "&#9654;"; // Right triangle
        } else {
            content.style.display = "block";
            icon.innerHTML = "&#9660;"; // Down triangle
        }
    });
}

// ============================================================================
// External Integration Functions
// ============================================================================

// Launch SOTAmat app with return path to this page
function launchSOTAmat() {
    const sotamat_base_url = "sotamat://api/v1?app=sotacat&appversion=2.1";
    const currentUrl = window.location.href;
    const encodedReturnPath = encodeURIComponent(currentUrl);
    const newHref = `${sotamat_base_url}&returnpath=${encodedReturnPath}`;

    window.open(newHref, "_blank");
}

// ============================================================================
// Event Handler Attachment
// ============================================================================

// Attach all CAT page event listeners
function attachCatEventListeners() {
    // Only attach once to prevent memory leaks
    Log.debug("CAT", `attachCatEventListeners called, flag: ${CatState.catEventListenersAttached}`);
    if (CatState.catEventListenersAttached) {
        Log.debug("CAT", "Event listeners already attached, skipping");
        return;
    }
    Log.debug("CAT", "Attaching event listeners to DOM");
    CatState.catEventListenersAttached = true;

    // Section toggle handlers
    document.querySelectorAll(".section-header[data-section]").forEach((header) => {
        header.addEventListener("click", () => {
            const sectionId = header.getAttribute("data-section");
            toggleSection(sectionId);
        });
    });

    // Frequency display click-to-edit
    const frequencyDisplay = document.getElementById("current-frequency");
    if (frequencyDisplay) {
        frequencyDisplay.addEventListener("click", enableFrequencyEditing);
    }

    // Frequency adjustment buttons
    document.querySelectorAll(".btn-freq[data-freq-delta]").forEach((button) => {
        button.addEventListener("click", () => {
            const delta = parseInt(button.getAttribute("data-freq-delta"), 10);
            adjustFrequency(delta);
        });
    });

    // Band selection buttons
    document.querySelectorAll(".btn-band[data-band]").forEach((button) => {
        button.addEventListener("click", () => {
            const band = button.getAttribute("data-band");
            selectBand(band);
        });
    });

    // Mode selection buttons
    document.querySelectorAll(".btn-mode[data-mode]").forEach((button) => {
        button.addEventListener("click", () => {
            const mode = button.getAttribute("data-mode");
            setMode(mode);
        });
    });

    // Power control buttons
    const minPowerBtn = document.getElementById("min-power-button");
    if (minPowerBtn) {
        minPowerBtn.addEventListener("click", () => setPowerMinMax(false));
    }

    const maxPowerBtn = document.getElementById("max-power-button");
    if (maxPowerBtn) {
        maxPowerBtn.addEventListener("click", () => setPowerMinMax(true));
    }

    const tuneAtuBtn = document.getElementById("tune-atu-button");
    if (tuneAtuBtn) {
        tuneAtuBtn.addEventListener("click", tuneAtu);
    }

    // SOTAMAT button
    const sotamatBtn = document.getElementById("sotamat-button");
    if (sotamatBtn) {
        sotamatBtn.addEventListener("click", launchSOTAmat);
    }

    // Message playback buttons
    document.querySelectorAll(".btn-msg[data-msg-slot]").forEach((button) => {
        button.addEventListener("click", () => {
            const slot = parseInt(button.getAttribute("data-msg-slot"), 10);
            playMsg(slot);
        });
    });

    // Transmit toggle button
    const xmitBtn = document.getElementById("xmit-button");
    if (xmitBtn) {
        xmitBtn.addEventListener("click", toggleXmit);
    }

    // CW send buttons
    document.querySelectorAll(".btn-send[data-message-input]").forEach((button) => {
        button.addEventListener("click", () => {
            const inputId = button.getAttribute("data-message-input");
            const inputElement = document.getElementById(inputId);
            if (inputElement) {
                sendKeys(inputElement.value);
            }
        });
    });

    // CW input validation - enable/disable Send buttons based on input content
    ["cw-message-1", "cw-message-2", "cw-message-3"].forEach((inputId) => {
        const input = document.getElementById(inputId);
        const button = document.querySelector(`.btn-send[data-message-input="${inputId}"]`);
        if (input && button) {
            // Update button state when input changes
            input.addEventListener("input", () => {
                const hasContent = input.value.trim().length > 0;
                button.disabled = !hasContent;
            });
        }
    });
}

// Update Send button states based on current input values
// Called on tab appear after loading saved values
function updateSendButtonStates() {
    ["cw-message-1", "cw-message-2", "cw-message-3"].forEach((inputId) => {
        const input = document.getElementById(inputId);
        const button = document.querySelector(`.btn-send[data-message-input="${inputId}"]`);
        if (input && button) {
            button.disabled = input.value.trim().length === 0;
        }
    });
}

// ============================================================================
// Page Lifecycle
// ============================================================================

// Called when CAT tab becomes visible
function onCatAppearing() {
    Log.info("CAT", "tab appearing");
    loadInputValues();
    loadCollapsibleStates();

    if (!CatState.messageInputListenersAttached) {
        CatState.messageInputListenersAttached = true;
        document.getElementById("cw-message-1").addEventListener("input", saveInputValues);
        document.getElementById("cw-message-2").addEventListener("input", saveInputValues);
        document.getElementById("cw-message-3").addEventListener("input", saveInputValues);
    }

    // Attach event listeners for all controls
    attachCatEventListeners();

    // Update Send button states based on loaded input values
    updateSendButtonStates();

    startVfoUpdates();
}

// Called when CAT tab is hidden
function onCatLeaving() {
    Log.info("CAT", "tab leaving");
    stopVfoUpdates();

    // Reset event listener flags so they can be reattached when returning to this tab
    // (necessary because DOM is recreated on each tab switch)
    CatState.catEventListenersAttached = false;
    CatState.messageInputListenersAttached = false;
}
