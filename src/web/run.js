// ============================================================================
// RUN Page Logic - For Activators Running a Summit/Park
// ============================================================================
// The RUN page is for activators operating from a SOTA summit, POTA park, etc.
// (as opposed to the CHASE page, which is for hunters working activators).
// Provides radio control, self-spotting, and logging integration.

// ============================================================================
// State Object
// ============================================================================

// Run page state encapsulated in a single object
// Note: VFO frequency/mode are stored in global AppState for cross-page sharing
const RunState = {
    // VFO polling state (frequency/mode stored in AppState)
    vfoUpdateInterval: null,
    lastUserAction: 0,
    isUpdatingVfo: false,
    pendingFrequencyUpdate: null,
    consecutiveErrors: 0,
    lastFrequencyChange: 0,

    // UI state
    runEventListenersAttached: false,
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
    fetchQuiet(url, { method: "PUT" }, "Run");
}

// ============================================================================
// Power Control Functions
// ============================================================================

// Set power to minimum (0W) or maximum (15W for KX3, 10W for KX2) - maximum: true/false
function setPowerMinMax(maximum) {
    // KX3 max power is 15w, KX2 will accept that and gracefully set 10w instead
    // On both radios, actual power may be lower than requested, depending on mode, battery, etc.
    const url = `/api/v1/power?power=${maximum ? "15" : "0"}`;
    fetchQuiet(url, { method: "PUT" }, "Run");
}

// ============================================================================
// Volume Control Functions
// ============================================================================

// Adjust volume (AF gain) by delta amount (delta: positive or negative integer)
// KX2/KX3 AF gain range is 0-255; step of 21 ≈ 5 display units
function changeVolume(delta) {
    const url = `/api/v1/volume?delta=${delta}`;
    fetchQuiet(url, { method: "PUT" }, "Run");
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
    fetchQuiet(url, { method: "PUT" }, "Run");
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
        // Brief visual feedback using CSS class
        display.classList.add("feedback-success");
        setTimeout(() => {
            display.classList.remove("feedback-success");
        }, VISUAL_FEEDBACK_DURATION_MS);
    }
}

// Update mode display with current VFO mode
function updateModeDisplay() {
    const display = document.getElementById("current-mode");
    if (display) {
        display.textContent = AppState.vfoMode || "USB";
        // Brief visual feedback using CSS class
        display.classList.add("feedback-warning");
        setTimeout(() => {
            display.classList.remove("feedback-warning");
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
            Log.debug("Run", `Band display updated: ${currentBand} active`);
        }
    } else {
        Log.debug("Run", "Current frequency not in any supported band range");
    }
}

// Update license privilege badges and VFO warning states
function updatePrivilegeDisplay() {
    const vfoDisplay = document.getElementById("vfo-display");
    const warningEl = document.getElementById("vfo-warning");
    const badgeN = document.getElementById("badge-N");
    const badgeT = document.getElementById("badge-T");
    const badgeG = document.getElementById("badge-G");
    const badgeA = document.getElementById("badge-A");
    const badgeE = document.getElementById("badge-E");

    if (!vfoDisplay || !badgeN || !badgeT || !badgeG || !badgeA || !badgeE) return;

    const frequencyHz = AppState.vfoFrequencyHz || DEFAULT_FREQUENCY_HZ;
    const mode = AppState.vfoMode || "USB";
    const userLicense = getUserLicenseClass();

    // Show N/A badges only if user has selected Novice or Advanced license
    const showLegacyBadges = userLicense === "N" || userLicense === "A";
    badgeN.classList.toggle("hidden", !showLegacyBadges);
    badgeA.classList.toggle("hidden", !showLegacyBadges);

    // Add class to container for compact styling when showing all 5 badges
    const badgesContainer = document.getElementById("license-badges");
    if (badgesContainer) {
        badgesContainer.classList.toggle("show-all", showLegacyBadges);
    }

    // Check privileges using bandprivileges.js functions
    const status = checkPrivileges(frequencyHz, mode, userLicense);
    const classStatus = getLicenseClassStatus(frequencyHz, mode);

    // Update badge states - shows who CAN operate at this frequency/mode
    const badges = { N: badgeN, T: badgeT, G: badgeG, A: badgeA, E: badgeE };
    for (const [cls, badge] of Object.entries(badges)) {
        // Remove all state classes
        badge.classList.remove("allowed", "denied", "user-class");

        // Add allowed/denied based on whether this class can TX here
        if (classStatus[cls]) {
            badge.classList.add("allowed");
        } else {
            badge.classList.add("denied");
        }

        // Mark user's own license class
        if (cls === userLicense) {
            badge.classList.add("user-class");
        }
    }

    // Update VFO container warning states
    vfoDisplay.classList.remove("warning-mode", "warning-privilege");

    if (!status.inBand) {
        vfoDisplay.classList.add("warning-privilege");
    } else if (!status.modeAllowed) {
        vfoDisplay.classList.add("warning-mode");
    } else if (!userLicense || !status.userCanTransmit) {
        // Warn if unlicensed or outside user's privileges
        vfoDisplay.classList.add("warning-privilege");
    }

    // Update warning message
    if (warningEl) {
        if (!userLicense && status.inBand && status.modeAllowed) {
            // Unlicensed user in a valid band/mode
            warningEl.textContent = "Unlicensed";
        } else if (status.warning) {
            warningEl.textContent = status.warning;
        } else if (status.edgeWarning) {
            warningEl.textContent = status.edgeWarning;
        } else {
            warningEl.textContent = "";
        }
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
    display.classList.add("hidden");
    input.classList.remove("hidden");
    if (modeDisplay) modeDisplay.classList.add("hidden");
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
            Log.debug("Run", `Frequency set to ${result.frequencyHz} Hz (${result.band})`);
        } else {
            // Invalid frequency - show error
            Log.error("Run", "Invalid frequency input:", result.error);
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
        input.classList.add("hidden");
        display.classList.remove("hidden");
        if (modeDisplay) modeDisplay.classList.remove("hidden");
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
            Log.error("Run", "VFO callback error:", error);
        }
    });
}

// Set radio frequency with 300ms debouncing to avoid flooding (frequencyHz: integer in Hz)
function setFrequency(frequencyHz) {
    RunState.lastUserAction = Date.now(); // Mark user action timestamp

    // Clear any pending frequency update
    if (RunState.pendingFrequencyUpdate) {
        clearTimeout(RunState.pendingFrequencyUpdate);
    }

    // Update global state and display immediately for responsive feel
    AppState.vfoFrequencyHz = frequencyHz;
    AppState.vfoLastUpdated = Date.now();
    updateFrequencyDisplay();
    updateBandDisplay();
    updatePrivilegeDisplay();
    notifyVfoSubscribers();

    // Debounce frequency updates to avoid flooding the radio
    RunState.pendingFrequencyUpdate = setTimeout(async () => {
        const url = `/api/v1/frequency?frequency=${frequencyHz}`;

        try {
            const response = await fetch(url, { method: "PUT" });

            if (response.ok) {
                Log.debug("Run", "Frequency updated:", frequencyHz);
            } else {
                Log.error("Run", "Frequency update failed");
                // Revert display on error
                getCurrentVfoState();
            }
        } catch (error) {
            Log.error("Run", "Frequency fetch error:", error);
            // Revert display on error
            getCurrentVfoState();
        } finally {
            RunState.pendingFrequencyUpdate = null;
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
        Log.warn("Run", "Frequency out of bounds:", newFrequency);
    }
}

// Set radio mode (mode: 'CW', 'SSB', 'USB', 'LSB', 'DATA', etc.)
async function setMode(mode) {
    RunState.lastUserAction = Date.now(); // Mark user action timestamp

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
            updatePrivilegeDisplay();
            notifyVfoSubscribers();
            Log.debug("Run", "Mode updated:", actualMode);
        } else {
            Log.error("Run", "Mode update failed");
            // Revert display on error
            getCurrentVfoState();
        }
    } catch (error) {
        Log.error("Run", "Mode fetch error:", error);
        // Revert display on error
        getCurrentVfoState();
    }
}

// Select band and set appropriate frequency and mode (band: '40m', '20m', '17m', '15m', '12m', '10m')
function selectBand(band) {
    if (BAND_PLAN[band]) {
        RunState.lastUserAction = Date.now(); // Mark user action to prevent polling conflicts

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
                Log.error("Run", "Error checking current mode:", error);
            }
        }, MODE_CHECK_DELAY_MS);
    }
}

// ============================================================================
// VFO Polling Functions
// ============================================================================

// Poll radio for current VFO state (frequency and mode)
async function getCurrentVfoState() {
    if (RunState.isUpdatingVfo) return; // Avoid concurrent updates

    // Don't poll if user made a change in the last 2 seconds
    if (Date.now() - RunState.lastUserAction < 2000) return;

    // Back off if we've had consecutive errors
    if (RunState.consecutiveErrors > 2) {
        Log.debug("Run", "Backing off due to errors, skipping poll");
        return;
    }

    // If frequency changed recently (within 5 seconds), we're likely tuning - be more cautious
    const timeSinceFreqChange = Date.now() - RunState.lastFrequencyChange;
    if (timeSinceFreqChange < 5000 && timeSinceFreqChange > 0) {
        // Skip some polls when actively tuning to reduce server load
        if (Math.random() < 0.5) return;
    }

    RunState.isUpdatingVfo = true;

    try {
        // Fetch both frequency and mode in parallel
        const [frequencyResponse, modeResponse] = await Promise.all([
            fetch("/api/v1/frequency", { method: "GET" }),
            fetch("/api/v1/mode", { method: "GET" }),
        ]);

        const frequency = frequencyResponse.ok ? await frequencyResponse.text() : null;
        const mode = modeResponse.ok ? await modeResponse.text() : null;

        // Success - reset error counter
        RunState.consecutiveErrors = 0;

        let changed = false;

        // Update frequency if it has changed
        if (frequency) {
            const newFreq = parseInt(frequency, 10);
            if (newFreq !== AppState.vfoFrequencyHz) {
                AppState.vfoFrequencyHz = newFreq;
                RunState.lastFrequencyChange = Date.now(); // Track that frequency changed
                updateFrequencyDisplay();
                updateBandDisplay(); // Update band button active state
                Log.debug("Run", "Frequency updated from radio:", AppState.vfoFrequencyHz);
                changed = true;
            }
        }

        // Update mode if it has changed
        if (mode) {
            const newMode = mode.toUpperCase();
            if (newMode !== AppState.vfoMode) {
                AppState.vfoMode = newMode;
                updateModeDisplay();
                Log.debug("Run", "Mode updated from radio:", AppState.vfoMode);
                changed = true;
            }
        }

        // Notify subscribers if anything changed
        if (changed) {
            AppState.vfoLastUpdated = Date.now();
            updatePrivilegeDisplay();
            notifyVfoSubscribers();
        }
    } catch (error) {
        RunState.consecutiveErrors++;
        Log.error("Run", `VFO state error (${RunState.consecutiveErrors} consecutive):`, error);
        // After 3 consecutive errors, we'll back off automatically
    } finally {
        RunState.isUpdatingVfo = false;
    }
}

// Start periodic VFO state polling
async function startVfoUpdates() {
    if (RunState.vfoUpdateInterval) {
        clearInterval(RunState.vfoUpdateInterval);
    }

    // Reset error tracking
    RunState.consecutiveErrors = 0;
    RunState.lastFrequencyChange = 0;

    // Get initial values
    RunState.isUpdatingVfo = true;

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
            Log.debug("Run", "Initial frequency loaded:", AppState.vfoFrequencyHz);
        }
        if (mode) {
            AppState.vfoMode = mode.toUpperCase();
            updateModeDisplay();
            Log.debug("Run", "Initial mode loaded:", AppState.vfoMode);
        }
        // Update privilege display with initial state
        updatePrivilegeDisplay();
        // Notify subscribers of initial state
        AppState.vfoLastUpdated = Date.now();
        notifyVfoSubscribers();
    } catch (error) {
        Log.error("Run", "Error loading initial VFO state:", error);
    } finally {
        RunState.isUpdatingVfo = false;

        // Start periodic updates (every 3 seconds, respecting user actions)
        RunState.vfoUpdateInterval = setInterval(() => {
            getCurrentVfoState();

            // Reset error counter if we've been stable for a while
            if (
                RunState.consecutiveErrors > 0 &&
                Date.now() - RunState.lastFrequencyChange > ERROR_RESET_STABILITY_MS
            ) {
                Log.debug("Run", "System stable, resetting error counter");
                RunState.consecutiveErrors = 0;
            }
        }, VFO_POLLING_INTERVAL_MS);
    }
}

// Stop VFO state polling
function stopVfoUpdates() {
    if (RunState.vfoUpdateInterval) {
        clearInterval(RunState.vfoUpdateInterval);
        RunState.vfoUpdateInterval = null;
    }

    if (RunState.pendingFrequencyUpdate) {
        clearTimeout(RunState.pendingFrequencyUpdate);
        RunState.pendingFrequencyUpdate = null;
    }

    RunState.isUpdatingVfo = false;
    RunState.lastUserAction = 0;
}

// ============================================================================
// ATU (Antenna Tuner) Functions
// ============================================================================

// Initiate ATU auto-tune cycle
async function tuneAtu() {
    try {
        const response = await fetch("/api/v1/atu", { method: "PUT" });

        if (!response.ok) {
            Log.error("Run", "ATU tune failed");
            return;
        }

        // Visual feedback using CSS class
        const atuBtn = document.querySelector(".btn-tune");
        if (atuBtn) {
            atuBtn.classList.add("feedback-bg-success");
            setTimeout(() => {
                atuBtn.classList.remove("feedback-bg-success");
            }, ATU_FEEDBACK_DURATION_MS);
        }
    } catch (error) {
        Log.error("Run", "ATU fetch error:", error);
    }
}

// ============================================================================
// UI State Persistence Functions
// ============================================================================

// Load saved CW message text from localStorage
function loadInputValues() {
    document.getElementById("cw-message-1").value = localStorage.getItem("runCWMessage1") || "";
    document.getElementById("cw-message-2").value = localStorage.getItem("runCWMessage2") || "";
    document.getElementById("cw-message-3").value = localStorage.getItem("runCWMessage3") || "";
}

// Save CW message text to localStorage
function saveInputValues() {
    localStorage.setItem("runCWMessage1", document.getElementById("cw-message-1").value);
    localStorage.setItem("runCWMessage2", document.getElementById("cw-message-2").value);
    localStorage.setItem("runCWMessage3", document.getElementById("cw-message-3").value);
}

// Mapping from DOM section IDs to localStorage keys
const SECTION_STORAGE_KEYS = {
    "tune-section": "runTuneSectionExpanded",
    "run-section": "runSpotSectionExpanded",
    "transmit-section": "runTransmitSectionExpanded",
};

// Toggle collapsible section visibility (sectionId: 'tune-section', 'spot-section', 'transmit-section')
function toggleSection(sectionId) {
    const content = document.getElementById(sectionId);
    const iconId = sectionId.replace("-section", "-icon");
    const icon = document.getElementById(iconId);
    const storageKey = SECTION_STORAGE_KEYS[sectionId];

    if (content.classList.contains("collapsed")) {
        content.classList.remove("collapsed");
        icon.innerHTML = "&#9660;"; // Down triangle
        localStorage.setItem(storageKey, "true");
    } else {
        content.classList.add("collapsed");
        icon.innerHTML = "&#9654;"; // Right triangle
        localStorage.setItem(storageKey, "false");
    }
}

// Load saved collapsed/expanded state for all sections
function loadCollapsibleStates() {
    const sections = ["tune-section", "run-section", "transmit-section"];
    sections.forEach((sectionId) => {
        const storageKey = SECTION_STORAGE_KEYS[sectionId];
        const savedState = localStorage.getItem(storageKey);
        const content = document.getElementById(sectionId);
        const iconId = sectionId.replace("-section", "-icon");
        const icon = document.getElementById(iconId);

        if (savedState === "false") {
            content.classList.add("collapsed");
            icon.innerHTML = "&#9654;"; // Right triangle
        } else {
            content.classList.remove("collapsed");
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

// SOTAmat SMS spotting number
const SOTAMAT_SMS_NUMBER = "+16017682628";

// Reference patterns defined in main.js: SOTA_REF_PATTERN, POTA_REF_PATTERN

// Check if reference is a valid SOTA or POTA reference
function isValidSpotReference(ref) {
    if (!ref) return false;
    return SOTA_REF_PATTERN.test(ref) || POTA_REF_PATTERN.test(ref);
}

// Determine if reference is SOTA (vs POTA)
function isSotaReference(ref) {
    return SOTA_REF_PATTERN.test(ref);
}

// Update spot action buttons enabled state based on reference validity
function updateRunButtonStates() {
    const ref = getLocationBasedReference() || "";
    const isValid = isValidSpotReference(ref);

    const sotamatBtn = document.getElementById("sotamat-button");
    const smsSpotBtn = document.getElementById("sms-spot-button");
    const smsQrtBtn = document.getElementById("sms-qrt-button");
    const poloSpotBtn = document.getElementById("polo-spot-button");

    if (sotamatBtn) sotamatBtn.disabled = !isValid;
    if (smsSpotBtn) smsSpotBtn.disabled = !isValid;
    if (smsQrtBtn) smsQrtBtn.disabled = !isValid;
    if (poloSpotBtn) poloSpotBtn.disabled = !isValid;

    Log.debug("Run", `Run buttons ${isValid ? "enabled" : "disabled"}, ref="${ref}"`);
}

// Build SMS URI for spotting current activation
// SOTA uses "sm" command, POTA uses "psm" command
function buildSpotSmsUri() {
    const ref = getLocationBasedReference() || "";
    if (!isValidSpotReference(ref)) return null;

    const cmd = isSotaReference(ref) ? "sm" : "psm";
    const freqMhz = ((AppState.vfoFrequencyHz || 14285000) / 1000000).toFixed(4);
    const mode = (AppState.vfoMode || "SSB").toLowerCase();

    const message = `${cmd} ${ref} ${freqMhz} ${mode}`;
    return `sms:${SOTAMAT_SMS_NUMBER}?body=${encodeURIComponent(message)}`;
}

// Build SMS URI for QRT (end of activation)
// SOTA uses "sm" command, POTA uses "psm" command
function buildQrtSmsUri() {
    const ref = getLocationBasedReference() || "";
    if (!isValidSpotReference(ref)) return null;

    const cmd = isSotaReference(ref) ? "sm" : "psm";
    const freqMhz = ((AppState.vfoFrequencyHz || 14285000) / 1000000).toFixed(4);
    const mode = (AppState.vfoMode || "SSB").toLowerCase();

    const message = `${cmd} ${ref} ${freqMhz} ${mode} QRT`;
    return `sms:${SOTAMAT_SMS_NUMBER}?body=${encodeURIComponent(message)}`;
}

// Open SMS app with spot message
function sendSpotSms() {
    const uri = buildSpotSmsUri();
    if (uri) {
        Log.info("Run", "Opening SMS for spot:", uri);
        window.location.href = uri;
    }
}

// Open SMS app with QRT message
function sendQrtSms() {
    const uri = buildQrtSmsUri();
    if (uri) {
        Log.info("Run", "Opening SMS for QRT:", uri);
        window.location.href = uri;
    }
}

// ============================================================================
// Ham2K Polo Deep Link Integration
// ============================================================================
// Note: buildPoloDeepLink() and mapModeForPolo() are defined in main.js

// Derive sig (activation type) from reference format
// Returns lowercase sig for Polo: 'sota', 'pota', 'wwff', etc.
function getSigFromReference(ref) {
    if (!ref) return null;
    // SOTA: XX/YY-NNN (e.g., W6/HC-298, VK3/VE-123)
    if (SOTA_REF_PATTERN.test(ref)) return "sota";
    // POTA: XX-NNNN (e.g., US-1234, VE-0001)
    if (POTA_REF_PATTERN.test(ref)) return "pota";
    // WWFF: XXFF-NNNN (e.g., VKFF-0001, ONFF-0123)
    if (/^[A-Z]{2,4}FF-\d{4}$/i.test(ref)) return "wwff";
    // GMA: XX/YY-NNN (same format as SOTA but different program)
    // Note: We can't distinguish GMA from SOTA by format alone
    return null;
}

// Build Polo deep link for Spot page (my activation)
function buildPoloSpotLink() {
    const myRef = getLocationBasedReference() || "";
    if (!isValidSpotReference(myRef)) return null;

    const mySig = getSigFromReference(myRef);
    const freq = AppState.vfoFrequencyHz || null;
    const mode = mapModeForPolo(AppState.vfoMode);

    return buildPoloDeepLink({
        myRef: myRef,
        mySig: mySig,
        freq: freq,
        mode: mode,
    });
}

// Launch Ham2K Polo app for logging my activation
function launchPoloSpot() {
    const url = buildPoloSpotLink();
    if (url) {
        Log.info("Run", "Launching Polo for spot:", url);
        // Use location.href for mobile deep link compatibility
        window.location.href = url;
    } else {
        Log.warn("Run", "Cannot launch Polo - no valid reference set");
    }
}

// ============================================================================
// Event Handler Attachment
// ============================================================================

// Attach all Spot page event listeners
function attachRunEventListeners() {
    // Only attach once to prevent memory leaks
    Log.debug("Run", `attachRunEventListeners called, flag: ${RunState.runEventListenersAttached}`);
    if (RunState.runEventListenersAttached) {
        Log.debug("Run", "Event listeners already attached, skipping");
        return;
    }
    Log.debug("Run", "Attaching event listeners to DOM");
    RunState.runEventListenersAttached = true;

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

    // Volume control buttons
    const volDownBtn = document.getElementById("vol-down-button");
    if (volDownBtn) {
        volDownBtn.addEventListener("click", () => changeVolume(-21));
    }

    const volUpBtn = document.getElementById("vol-up-button");
    if (volUpBtn) {
        volUpBtn.addEventListener("click", () => changeVolume(21));
    }

    // SOTAMAT button
    const sotamatBtn = document.getElementById("sotamat-button");
    if (sotamatBtn) {
        sotamatBtn.addEventListener("click", launchSOTAmat);
    }

    // SMS spot button
    const smsSpotBtn = document.getElementById("sms-spot-button");
    if (smsSpotBtn) {
        smsSpotBtn.addEventListener("click", sendSpotSms);
    }

    // SMS QRT button
    const smsQrtBtn = document.getElementById("sms-qrt-button");
    if (smsQrtBtn) {
        smsQrtBtn.addEventListener("click", sendQrtSms);
    }

    // Polo spot button
    const poloSpotBtn = document.getElementById("polo-spot-button");
    if (poloSpotBtn) {
        poloSpotBtn.addEventListener("click", launchPoloSpot);
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

    // CW input validation - enable/disable Send buttons and persist values
    ["cw-message-1", "cw-message-2", "cw-message-3"].forEach((inputId) => {
        const input = document.getElementById(inputId);
        const button = document.querySelector(`.btn-send[data-message-input="${inputId}"]`);
        if (input && button) {
            input.addEventListener("input", () => {
                const hasContent = input.value.trim().length > 0;
                button.disabled = !hasContent;
                saveInputValues();
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

// Called when Spot tab becomes visible
async function onRunAppearing() {
    Log.info("Run", "tab appearing");
    loadInputValues();
    loadCollapsibleStates();

    // Attach event listeners for all controls
    attachRunEventListeners();

    // Sync xmit button state with global state
    syncXmitButtonState();

    // Update Send button states based on loaded input values
    updateSendButtonStates();

    // Update spot action buttons based on reference validity
    updateRunButtonStates();

    // Ensure license class is loaded before VFO updates (needed for privilege badges)
    await ensureLicenseClassLoaded();

    startVfoUpdates();
}

// Called when Spot tab is hidden
function onRunLeaving() {
    Log.info("Run", "tab leaving");
    stopVfoUpdates();

    // Reset event listener flag so they can be reattached when returning to this tab
    // (necessary because DOM is recreated on each tab switch)
    RunState.runEventListenersAttached = false;
}
