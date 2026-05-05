// ============================================================================
// SPOT Page Logic - CAT (Computer Aided Transceiver) Control
// ============================================================================
// Provides radio control interface for frequency, mode, power, and keying

// ============================================================================
// State Object
// ============================================================================

// Spot page state encapsulated in a single object
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
    spotEventListenersAttached: false,
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
    fetchQuiet(url, { method: "PUT" }, "Spot");
}

// ============================================================================
// Power Control Functions
// ============================================================================

// Set power to minimum (0W) or maximum (15W for KX3, 10W for KX2) - maximum: true/false
function setPowerMinMax(maximum) {
    // KX3 max power is 15w, KX2 will accept that and gracefully set 10w instead
    // On both radios, actual power may be lower than requested, depending on mode, battery, etc.
    RunState.lastUserAction = Date.now(); // Prevent VFO polling while setting power. KH reads power/freq from display
    const url = `/api/v1/power?power=${maximum ? "15" : "0"}`;
    fetchQuiet(url, { method: "PUT" }, "Spot");
}

// ============================================================================
// Volume Control Functions
// ============================================================================

// Adjust volume (AF gain) by delta amount (delta: positive or negative integer)
// KX2/KX3 AF gain range is 0-255; step of 21 ≈ 5 display units
function changeVolume(delta) {
    const url = `/api/v1/volume?delta=${delta}`;
    fetchQuiet(url, { method: "PUT" }, "Spot");
}

// ============================================================================
// Keyer Functions
// ============================================================================

// Send CW message to radio keyer (message: string, up to ~128 characters)
// Backend handles splitting into <=24-char KYW commands at whitespace boundaries.
// sendKeys() moved to main.js

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
    const currentMode = AppState.vfoMode || "USB";

    // Determine mode family class once
    const modeClasses = ["msg-mode-cw", "msg-mode-voice", "msg-mode-data"];
    let msgClass = "msg-mode-voice"; // default for SSB/USB/LSB/AM/FM
    if (currentMode === "CW") {
        msgClass = "msg-mode-cw";
    } else if (currentMode === "DATA") {
        msgClass = "msg-mode-data";
    }

    // Update VFO mode display text + color class
    const display = document.getElementById("current-mode");
    if (display) {
        display.textContent = currentMode;
        modeClasses.forEach((cls) => display.classList.remove(cls));
        display.classList.add(msgClass);
        // Brief visual feedback using CSS class
        display.classList.add("feedback-warning");
        setTimeout(() => {
            display.classList.remove("feedback-warning");
        }, VISUAL_FEEDBACK_DURATION_MS);
    }

    // Update mode button active states
    document.querySelectorAll(".btn-mode").forEach((btn) => btn.classList.remove("active"));
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

    // Update Msg button colors to match current mode family
    const msgButtons = document.querySelectorAll(".btn-msg");
    msgButtons.forEach((btn) => {
        modeClasses.forEach((cls) => btn.classList.remove(cls));
        btn.classList.add(msgClass);
    });

    // XMIT (Toggle TX) is meaningful only in PHONE modes (SSB/USB/LSB/AM/FM).
    // CW uses the keyer / Msg buttons; DATA uses external software. Disable
    // and drop mode-color classes outside PHONE so the button reads as
    // unavailable rather than tappable-and-blue.
    const xmitBtn = document.getElementById("xmit-button");
    if (xmitBtn) {
        modeClasses.forEach((cls) => xmitBtn.classList.remove(cls));
        const isPhone = currentMode !== "CW" && currentMode !== "CW_R" &&
                        currentMode !== "DATA" && currentMode !== "DATA_R";
        if (isPhone) {
            xmitBtn.classList.add(msgClass);   // msg-mode-voice → green
            xmitBtn.disabled = false;
            xmitBtn.title = "";
        } else {
            xmitBtn.disabled = true;
            xmitBtn.title = currentMode === "CW" || currentMode === "CW_R"
                ? "Toggle TX not available in CW mode — use Msg buttons / keyer"
                : "Toggle TX not available in DATA mode";
            // Also clear .active in case the radio is mid-transmit when mode changes
            xmitBtn.classList.remove("active");
        }
    }

    applyKeyerFamilyHints();
}

// Returns "cw" | "data" | null — the family of signal that will actually be
// transmitted when we key.  CW/CW_R stay in CW; DATA/DATA_R send as RTTY
// (DT2) or PSK31 (DT3) depending on the DT sub-mode set on the radio;
// everything else gets forced to CW by the backend (see the RTTY-keying plan,
// Task 2).  null means "mode unknown yet" (e.g., pre-connect).
function getKeyerFamily(mode) {
    const m = (mode || "").toUpperCase();
    if (!m || m === "UNKNOWN") return null;
    if (m === "DATA" || m === "DATA_R") return "data";
    return "cw"; // CW, CW_R, USB, LSB, AM, FM — all emit CW from the keyer
}

// Update the RUN-tab Transmit section to reflect what the keyer will emit:
// • data-keyer-family="cw"   → CW macro and Key buttons tint muted blue
// • data-keyer-family="data" → tint muted amber, Key button label → "Send"
// • attribute absent         → default styling (mode unknown)
// CSS rules live in style.css under the existing mode-color section.
function applyKeyerFamilyHints() {
    const family = getKeyerFamily(AppState.vfoMode);
    const container = document.getElementById("transmit-section");
    if (container) {
        if (family === null) {
            container.removeAttribute("data-keyer-family");
        } else {
            container.setAttribute("data-keyer-family", family);
        }
    }
    const sendBtn = document.getElementById("cw-freeform-send");
    if (sendBtn) {
        sendBtn.textContent = (family === "data") ? "Send" : "Key";
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
            Log.debug("Spot")(`Band display updated: ${currentBand} active`);
        }
    } else {
        Log.debug("Spot")("Current frequency not in any supported band range");
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

    // Update button disabled states based on privilege
    updateButtonPrivileges();

    // Update band-range graph (horizontal bar showing band privileges + tick)
    updateBandRangeDisplay();

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

// License classes ordered most-accessible → most-restricted
const LICENSE_CLASS_RANK = ["N", "T", "G", "A", "E"];

// Mode categories rendered as side-by-side stripes inside each segment.
// Keep this order stable so the stripe layout stays consistent across rows.
const MODE_CATEGORIES = ["CW", "DATA", "PHONE"];

// Map mode categories to CSS token names (on-dark palette)
const STRIPE_TOKEN_BY_CATEGORY = {
    CW: "--mode-cw-on-dark",
    DATA: "--mode-data-on-dark",
    PHONE: "--mode-voice-on-dark",
};

// Determine which license-class badges are currently rendered in the VFO
// (matches the visibility logic in updatePrivilegeDisplay()).
// Novice + Advanced badges are hidden unless the user actually holds one of
// those classes — the legacy classes are otherwise just visual clutter.
function getVisibleLicenseClasses() {
    const showLegacy = AppState.licenseClass === "N" || AppState.licenseClass === "A";
    return showLegacy ? ["N", "T", "G", "A", "E"] : ["T", "G", "E"];
}

// Render the band-range graph as a stack of thin rows — one row per
// currently-visible license class, top = most-restrictive (E), bottom =
// least (T or N). The chart is OPERATOR-CENTRIC: it visualizes the band
// from the perspective of the user's currently-selected radio mode.
//
// Per segment within each row:
//   • Class lacks privileges in this segment → render nothing.
//   • Class has privileges AND current mode is permitted → solid stripe
//     in the current mode's color (PHONE green / CW blue / DATA yellow).
//     Other modes that may also be allowed in this segment are
//     deliberately not depicted — the operator is in their chosen mode.
//   • Class has privileges but current mode is forbidden → side-by-side
//     stripes for the modes that ARE allowed (the user's current mode
//     is excluded since it's not allowed here anyway). The visual
//     "solid vs striped" distinction becomes the cue that "you'd need
//     to switch mode to operate here".
//
// A single tick + bandwidth overlay sits above all rows. Tooltips spell
// out the full FCC mode list per segment regardless of current mode, so
// the underlying truth stays discoverable on hover.
//
// Stripe positions inside a segment do NOT correspond to frequency
// sub-ranges — all listed modes are permitted across the segment's full
// frequency range; the stripes are a "which modes are available here" key.
function updateBandRangeDisplay() {
    const container = document.getElementById("vfo-band-range");
    const stack = document.getElementById("vfo-band-range-stack");
    if (!container || !stack) return;

    const frequencyHz = AppState.vfoFrequencyHz || DEFAULT_FREQUENCY_HZ;
    const mode = AppState.vfoMode || "USB";
    const band = getBandFromFrequency(frequencyHz);
    const segments = band ? FCC_AMATEUR_PRIVILEGES[band] : null;

    if (!segments || segments.length === 0) {
        container.classList.add("hidden");
        stack.replaceChildren();
        return;
    }

    container.classList.remove("hidden");

    const bandStart = segments[0].min;
    const bandEnd = segments[segments.length - 1].max;
    const bandSpan = bandEnd - bandStart;
    if (bandSpan <= 0) {
        container.classList.add("hidden");
        return;
    }

    const userLicense = getUserLicenseClass();
    const currentModeCategory = getModeCategory(mode);
    const pct = (hz) => ((hz - bandStart) / bandSpan) * 100;
    const fMHz = (hz) => (hz / 1e6).toFixed(3);

    // Visible classes are returned in ascending privilege order
    // (e.g. ["T","G","E"]). For top-to-bottom rendering with the most-
    // restrictive class on top, reverse to ["E","G","T"].
    const rowsTopToBottom = [...getVisibleLicenseClasses()].reverse();

    const frag = document.createDocumentFragment();

    for (const cls of rowsTopToBottom) {
        const row = document.createElement("div");
        row.className = "vfo-band-range-row";
        row.dataset.license = cls;

        const label = document.createElement("span");
        label.className = "vfo-band-range-label";
        label.textContent = cls;
        if (cls === userLicense) label.classList.add("user-class");
        row.appendChild(label);

        const track = document.createElement("div");
        track.className = "vfo-band-range-track";

        for (const seg of segments) {
            if (!seg.classes.includes(cls)) continue;

            const segEl = document.createElement("div");
            segEl.className = "vfo-band-range-segment";
            const left = pct(seg.min);
            const width = pct(seg.max) - left;
            segEl.style.left = `${left}%`;
            segEl.style.width = `${width}%`;

            // Operator-centric coloring: solid current-mode color when
            // permitted; otherwise side-by-side stripes of the alternative
            // modes (excluding the current mode, which is forbidden here).
            const currentModePermitted = seg.modes.includes(currentModeCategory);
            const stripeModes = currentModePermitted
                ? [currentModeCategory]
                : MODE_CATEGORIES.filter((m) => seg.modes.includes(m));
            for (const m of stripeModes) {
                const stripe = document.createElement("div");
                stripe.className = "vfo-band-range-mode-stripe";
                stripe.style.setProperty("--stripe-color", `var(${STRIPE_TOKEN_BY_CATEGORY[m]})`);
                segEl.appendChild(stripe);
            }

            segEl.title = `${cls} · ${fMHz(seg.min)}–${fMHz(seg.max)} MHz · ${seg.modes.join("/")}`;
            track.appendChild(segEl);
        }

        row.appendChild(track);
        frag.appendChild(row);
    }

    // Single tick + bandwidth overlay spanning all rows. Positioned via CSS
    // to skip the label column, so its 0–100% maps onto the same frequency
    // axis as each row's track.
    const overlay = document.createElement("div");
    overlay.className = "vfo-band-range-overlay";

    const bw = getModeBandwidth(mode);
    const lowerEdge = getSignalLowerEdge(frequencyHz, mode, bw);
    const upperEdge = getSignalUpperEdge(frequencyHz, mode, bw);
    if (upperEdge >= bandStart && lowerEdge <= bandEnd) {
        const bwEl = document.createElement("div");
        bwEl.className = "vfo-band-range-bandwidth";
        const bwLeft = Math.max(0, pct(lowerEdge));
        const bwRight = Math.min(100, pct(upperEdge));
        bwEl.style.left = `${bwLeft}%`;
        bwEl.style.width = `${Math.max(0, bwRight - bwLeft)}%`;
        overlay.appendChild(bwEl);
    }

    if (frequencyHz >= bandStart && frequencyHz <= bandEnd) {
        const tick = document.createElement("div");
        tick.className = "vfo-band-range-tick";
        tick.style.left = `${pct(frequencyHz)}%`;
        const status = checkPrivileges(frequencyHz, mode, userLicense);
        if ((userLicense && !status.userCanTransmit) || !status.modeAllowed) {
            tick.classList.add("out-of-priv");
        }
        overlay.appendChild(tick);
    }

    frag.appendChild(overlay);
    stack.replaceChildren(frag);
}

// Update mode and msg button disabled states based on band privileges
function updateButtonPrivileges() {
    const frequencyHz = AppState.vfoFrequencyHz || DEFAULT_FREQUENCY_HZ;
    const currentMode = AppState.vfoMode || "USB";
    const userLicense = getUserLicenseClass();

    // Check each mode category (3 calls — SSB/AM/FM share PHONE)
    const cwStatus = checkPrivileges(frequencyHz, "CW", userLicense);
    const phoneStatus = checkPrivileges(frequencyHz, "USB", userLicense);
    const dataStatus = checkPrivileges(frequencyHz, "DATA", userLicense);

    // No license configured → enforce band plan only (modeAllowed)
    // License configured → enforce full privilege check (userCanTransmit)
    function isPermitted(status) {
        if (!status.inBand) return false;
        return userLicense ? status.userCanTransmit : status.modeAllowed;
    }

    const cwOk = isPermitted(cwStatus);
    const phoneOk = isPermitted(phoneStatus);
    const dataOk = isPermitted(dataStatus);

    // Mode buttons
    const ids = { "btn-cw": cwOk, "btn-ssb": phoneOk, "btn-am": phoneOk, "btn-fm": phoneOk, "btn-data": dataOk };
    for (const [id, ok] of Object.entries(ids)) {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = !ok;
    }

    // Msg buttons: disabled if current mode is not transmittable
    const cat = getModeCategory(currentMode);
    const txOk = cat === "CW" ? cwOk : cat === "DATA" ? dataOk : phoneOk;
    document.querySelectorAll(".btn-msg").forEach((btn) => {
        btn.disabled = !txOk;
    });
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
            Log.debug("Spot")(`Frequency set to ${result.frequencyHz} Hz (${result.band})`);
        } else {
            // Invalid frequency - show error
            Log.error("Spot")("Invalid frequency input:", result.error);
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
            Log.error("Spot")("VFO callback error:", error);
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
                Log.debug("Spot")("Frequency updated:", frequencyHz);
            } else {
                Log.error("Spot")("Frequency update failed");
                // Revert display on error
                getCurrentVfoState();
            }
        } catch (error) {
            Log.error("Spot")("Frequency fetch error:", error);
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
        Log.warn("Spot")("Frequency out of bounds:", newFrequency);
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

    const url = `/api/v1/mode?mode=${actualMode}`;

    try {
        const response = await fetch(url, { method: "PUT" });

        if (response.ok) {
            AppState.vfoMode = actualMode;
            AppState.vfoLastUpdated = Date.now();
            updateModeDisplay();
            updatePrivilegeDisplay();
            notifyVfoSubscribers();
            Log.debug("Spot")("Mode updated:", actualMode);
        } else {
            Log.error("Spot")("Mode update failed");
            // Revert display on error
            getCurrentVfoState();
        }
    } catch (error) {
        Log.error("Spot")("Mode fetch error:", error);
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
                Log.error("Spot")("Error checking current mode:", error);
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
        Log.debug("Spot")("Backing off due to errors, skipping poll");
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
                Log.debug("Spot")("Frequency updated from radio:", AppState.vfoFrequencyHz);
                changed = true;
            }
        }

        // Update mode if it has changed
        if (mode) {
            const newMode = mode.toUpperCase();
            if (newMode !== AppState.vfoMode) {
                AppState.vfoMode = newMode;
                updateModeDisplay();
                Log.debug("Spot")("Mode updated from radio:", AppState.vfoMode);
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
        Log.error("Spot")(`VFO state error (${RunState.consecutiveErrors} consecutive):`, error);
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
            Log.debug("Spot")("Initial frequency loaded:", AppState.vfoFrequencyHz);
        }
        if (mode) {
            AppState.vfoMode = mode.toUpperCase();
            updateModeDisplay();
            Log.debug("Spot")("Initial mode loaded:", AppState.vfoMode);
        }
        // Update privilege display with initial state
        updatePrivilegeDisplay();
        // Notify subscribers of initial state
        AppState.vfoLastUpdated = Date.now();
        notifyVfoSubscribers();
    } catch (error) {
        Log.error("Spot")("Error loading initial VFO state:", error);
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
                Log.debug("Spot")("System stable, resetting error counter");
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
            Log.error("Spot")("ATU tune failed");
            return;
        }

        // Visual feedback
        const atuBtn = document.querySelector(".btn-tune");
        if (atuBtn) {
            atuBtn.classList.add("feedback-bg-success");
            setTimeout(() => {
                atuBtn.classList.remove("feedback-bg-success");
            }, ATU_FEEDBACK_DURATION_MS);
        }
    } catch (error) {
        Log.error("Spot")("ATU fetch error:", error);
    }
}

// ============================================================================
// CW Macro Button Functions
// ============================================================================

const DEFAULT_CW_MACROS = [
    { label: "CQ SOTA", template: "CQ SOTA DE {MYCALL} {MYCALL} K" },
    { label: "UR 5NN", template: "UR 5NN {MYREF} BK" },
    { label: "MY REF", template: "{MYREF}" },
    { label: "PSE AGN", template: "PSE AGN" },
    { label: "TU 73 QRZ", template: "TU 73 QRZ" },
];

// Render CW macro buttons into the #cw-macro-buttons container
function renderCwMacroButtons() {
    const container = document.getElementById("cw-macro-buttons");
    if (!container) return;

    const macros = AppState.cwMacros && AppState.cwMacros.length > 0 ? AppState.cwMacros : DEFAULT_CW_MACROS;
    container.innerHTML = "";

    macros.forEach((macro, index) => {
        const btn = document.createElement("button");
        btn.className = "btn btn-cw-macro";
        btn.textContent = macro.label;
        btn.title = macro.template;
        btn.addEventListener("click", () => onCwMacroButtonPress(index));
        container.appendChild(btn);
    });
}

// Handle CW macro button press: expand template and send
function onCwMacroButtonPress(index) {
    const macros = AppState.cwMacros && AppState.cwMacros.length > 0 ? AppState.cwMacros : DEFAULT_CW_MACROS;
    if (index < 0 || index >= macros.length) return;

    const expanded = expandCwMacroTemplate(macros[index].template);
    if (expanded) {
        sendKeys(expanded.toUpperCase());
    }
}

// Mapping from DOM section IDs to localStorage keys
const SECTION_STORAGE_KEYS = {
    "tune-section": "spotTuneSectionExpanded",
    "spot-section": "spotSpotSectionExpanded",
    "transmit-section": "spotTransmitSectionExpanded",
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

// Solo a section: expand it and collapse all others.
// If it's already the only expanded section, expand all others back.
function soloSection(sectionId) {
    const allSections = ["tune-section", "spot-section", "transmit-section"];

    // Check if this section is already solo (only one expanded, and it's this one)
    const expandedSections = allSections.filter(
        (id) => !document.getElementById(id).classList.contains("collapsed")
    );
    const isSolo = expandedSections.length === 1 && expandedSections[0] === sectionId;

    allSections.forEach((id) => {
        const content = document.getElementById(id);
        const iconId = id.replace("-section", "-icon");
        const icon = document.getElementById(iconId);
        const key = SECTION_STORAGE_KEYS[id];

        if (isSolo) {
            // Un-solo: expand all
            content.classList.remove("collapsed");
            icon.innerHTML = "&#9660;";
            localStorage.setItem(key, "true");
        } else if (id === sectionId) {
            // Solo: expand this one
            content.classList.remove("collapsed");
            icon.innerHTML = "&#9660;";
            localStorage.setItem(key, "true");
        } else {
            // Solo: collapse others
            content.classList.add("collapsed");
            icon.innerHTML = "&#9654;";
            localStorage.setItem(key, "false");
        }
    });
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

// Launch SOTAmat app with current activation evidence (ref, callsign, freq, mode).
// Uses the same xOTA encoder as the Polo deep link for vocabulary parity:
//   our.refs=<sig>:<ref>, our.call, frequency (Hz), mode (uppercase),
//   returnpath (bare origin).
// Each field is omitted when its source is missing, so SOTAmat (>=2.2) can
// pre-fill what we know and fall back to GPS/radio polling for the rest.
// SOTAmat <=2.1 ignores the new params; returnpath is already path-stripped
// on the SOTAmat side, so this is fully backwards-compatible.
function launchSOTAmat() {
    const myRef = getLocationBasedReference() || "";
    const validRef = isValidSpotReference(myRef);
    const url = buildXotaDeepLink({
        baseUrl: "sotamat://api/v1?app=sotacat&appversion=2.2",
        myRef:  validRef ? myRef : null,
        mySig:  validRef ? getSigFromReference(myRef) : null,
        myCall: AppState.callSign || null,
        freq:   AppState.vfoFrequencyHz || null,
        mode:   mapModeForPolo(AppState.vfoMode),
    });
    Log.info("Spot")("Launching SOTAmat:", url);
    window.location.href = url;
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
// SOTAmāt button is always enabled - the app has its own GPS and summit logic
// SMS and Polo buttons require a valid reference (location-based)
function updateSpotButtonStates() {
    const ref = getLocationBasedReference() || "";
    const isValid = isValidSpotReference(ref);

    const sotamatBtn = document.getElementById("sotamat-button");
    const smsSpotBtn = document.getElementById("sms-spot-button");
    const smsQrtBtn = document.getElementById("sms-qrt-button");
    const poloSpotBtn = document.getElementById("polo-spot-button");

    if (sotamatBtn) sotamatBtn.disabled = false; // SOTAmāt app handles location itself
    if (smsSpotBtn) smsSpotBtn.disabled = !isValid;
    if (smsQrtBtn) smsQrtBtn.disabled = !isValid;
    if (poloSpotBtn) poloSpotBtn.disabled = !isValid;

    Log.debug("Spot")(`SOTAmāt enabled, SMS/Polo ${isValid ? "enabled" : "disabled"}, ref="${ref}"`);
}

// Map radio mode to SOTAMAT-compatible mode string
function mapModeForSotamat(mode) {
    if (!mode) return "ssb";
    const upper = mode.toUpperCase();
    if (upper === "USB" || upper === "LSB") return "ssb";
    if (upper === "CW_R") return "cw";
    if (upper === "FT8" || upper === "FT4") return "data";
    return upper.toLowerCase();
}

// Build SMS URI for spotting current activation
// SOTA uses "sm" command, POTA uses "psm" command
function buildSpotSmsUri() {
    const ref = getLocationBasedReference() || "";
    if (!isValidSpotReference(ref)) return null;

    const cmd = isSotaReference(ref) ? "sm" : "psm";
    const freqMhz = ((AppState.vfoFrequencyHz || 14285000) / 1000000).toFixed(4);
    const mode = mapModeForSotamat(AppState.vfoMode || "SSB");

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

    const message = `${cmd} ${ref} ${freqMhz} QRT`;
    return `sms:${SOTAMAT_SMS_NUMBER}?body=${encodeURIComponent(message)}`;
}

// Open SMS app with spot message
function sendSpotSms() {
    const uri = buildSpotSmsUri();
    if (uri) {
        Log.info("Spot")("Opening SMS for spot:", uri);
        window.location.href = uri;
    }
}

// Open SMS app with QRT message
function sendQrtSms() {
    const uri = buildQrtSmsUri();
    if (uri) {
        Log.info("Spot")("Opening SMS for QRT:", uri);
        window.location.href = uri;
    }
}

// ============================================================================
// Ham2K Polo Deep Link Integration
// ============================================================================
// Note: buildXotaDeepLink() and mapModeForPolo() are defined in main.js

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

    return buildXotaDeepLink({
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
        Log.info("Spot")("Launching Polo for spot:", url);
        // Use location.href for mobile deep link compatibility
        window.location.href = url;
    } else {
        Log.warn("Spot")("Cannot launch Polo - no valid reference set");
    }
}

// ============================================================================
// Event Handler Attachment
// ============================================================================

// Attach all Spot page event listeners
function attachSpotEventListeners() {
    // Only attach once to prevent memory leaks
    Log.debug("Spot")(`attachSpotEventListeners called, flag: ${RunState.spotEventListenersAttached}`);
    if (RunState.spotEventListenersAttached) {
        Log.debug("Spot")("Event listeners already attached, skipping");
        return;
    }
    Log.debug("Spot")("Attaching event listeners to DOM");
    RunState.spotEventListenersAttached = true;

    // Section toggle handlers
    document.querySelectorAll(".section-header[data-section]").forEach((header) => {
        header.addEventListener("click", () => {
            const sectionId = header.getAttribute("data-section");
            toggleSection(sectionId);
        });
    });

    // Solo icon handlers (expand one, collapse others; or unsolo)
    document.querySelectorAll(".solo-icon[data-solo]").forEach((icon) => {
        icon.addEventListener("click", (e) => {
            e.stopPropagation();
            soloSection(icon.getAttribute("data-solo"));
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
        volDownBtn.addEventListener("click", () => changeVolume(-1));
    }

    const volUpBtn = document.getElementById("vol-up-button");
    if (volUpBtn) {
        volUpBtn.addEventListener("click", () => changeVolume(1));
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

    // Free-form CW input
    const cwFreeformInput = document.getElementById("cw-freeform-input");
    const cwFreeformSend = document.getElementById("cw-freeform-send");
    if (cwFreeformInput && cwFreeformSend) {
        cwFreeformInput.addEventListener("input", () => {
            cwFreeformSend.disabled = !cwFreeformInput.value.trim();
        });
        cwFreeformSend.addEventListener("click", () => {
            const text = cwFreeformInput.value.trim().toUpperCase();
            if (text) {
                const expanded = expandCwMacroTemplate(text);
                if (expanded) {
                    sendKeys(expanded);
                }
            }
        });
        cwFreeformInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && cwFreeformInput.value.trim()) {
                e.preventDefault();
                cwFreeformSend.click();
            }
        });
    }

}

// ============================================================================
// Page Lifecycle
// ============================================================================

// Called when Spot tab becomes visible
async function onSpotAppearing() {
    Log.info("Spot")("tab appearing");
    loadCollapsibleStates();

    // Ensure callsign, location, and macros are loaded before rendering buttons.
    // Without these awaits, {MYCALL} and {MYREF} resolve to "" on first visit,
    // and macro buttons may show defaults with wrong index-to-template mappings
    // when AppState.cwMacros loads asynchronously after buttons are already rendered.
    await ensureCallSignLoaded();
    await getLocation();
    await loadCwMacrosAsync();

    // Render CW macro buttons from AppState (or defaults)
    renderCwMacroButtons();

    // Attach event listeners for all controls
    attachSpotEventListeners();

    // Sync xmit button state with global state
    syncXmitButtonState();

    // Update spot action buttons based on reference validity
    updateSpotButtonStates();

    // Ensure license class is loaded before VFO updates (needed for privilege badges)
    await ensureLicenseClassLoaded();

    startVfoUpdates();
}

// Called when Spot tab is hidden
function onSpotLeaving() {
    Log.info("Spot")("tab leaving");
    stopVfoUpdates();

    // Reset event listener flag so they can be reattached when returning to this tab
    // (necessary because DOM is recreated on each tab switch)
    RunState.spotEventListenersAttached = false;
}

// RUN tab aliases for the renamed tab
function onRunAppearing() {
    return onSpotAppearing();
}

function onRunLeaving() {
    return onSpotLeaving();
}
