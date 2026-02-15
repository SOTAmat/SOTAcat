// ============================================================================
// Settings Page Logic
// ============================================================================
// Handles device configuration including time sync, callsign, GPS location,
// WiFi settings, and firmware updates

// ============================================================================
// Constants
// ============================================================================

const FIRMWARE_UPLOAD_SUCCESS_DELAY_MS = 2000;

// ============================================================================
// Callsign & License Class Management Functions
// ============================================================================

// Track the original values to detect changes
let originalCallSignValue = "";
let originalLicenseClass = "";

// Load saved callsign and license class from device
async function loadCallSign() {
    await ensureCallSignLoaded();
    await ensureLicenseClassLoaded();
    const callSignInput = document.getElementById("callsign");
    const licenseSelect = document.getElementById("license-class");
    const saveCallSignBtn = document.getElementById("save-callsign-button");

    callSignInput.value = AppState.callSign || "";

    // Load license class from AppState (loaded from device)
    const savedLicense = AppState.licenseClass || "";
    if (licenseSelect) {
        licenseSelect.value = savedLicense;
    }

    // Store original values and reset save button
    originalCallSignValue = callSignInput.value;
    originalLicenseClass = savedLicense;
    if (saveCallSignBtn) {
        saveCallSignBtn.disabled = true;
        saveCallSignBtn.className = "btn btn-secondary";
    }
}

// Enable save button when callsign or license class changes from original value
function onCallSignInputChange() {
    const callSignInput = document.getElementById("callsign");
    const licenseSelect = document.getElementById("license-class");
    const saveCallSignBtn = document.getElementById("save-callsign-button");

    if (saveCallSignBtn) {
        const callSignChanged = callSignInput.value !== originalCallSignValue;
        const licenseChanged = licenseSelect && licenseSelect.value !== originalLicenseClass;
        const hasChanged = callSignChanged || licenseChanged;
        saveCallSignBtn.disabled = !hasChanged;
        saveCallSignBtn.className = hasChanged ? "btn btn-primary" : "btn btn-secondary";
    }
}

// Save operator callsign and license class to device
async function saveCallSign() {
    const callSignInput = document.getElementById("callsign");
    const licenseSelect = document.getElementById("license-class");
    const callSign = callSignInput.value.toUpperCase().trim();
    const licenseClass = licenseSelect ? licenseSelect.value : "";

    // Validate the callsign using regex - uppercase letters, numbers, and slashes only
    const callSignPattern = /^[A-Z0-9\/]*$/;
    if (!callSignPattern.test(callSign) && callSign !== "") {
        alert("Call sign can only contain uppercase letters, numbers, and slashes (/)");
        return;
    }

    try {
        // Save callsign to device
        const callsignResponse = await fetch("/api/v1/callsign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ callsign: callSign }),
        });

        if (!callsignResponse.ok) {
            const data = await callsignResponse.json();
            throw new Error(data.error || "Failed to save callsign");
        }

        // Save license class to device
        const licenseResponse = await fetch("/api/v1/license", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ license: licenseClass }),
        });

        if (!licenseResponse.ok) {
            const data = await licenseResponse.json();
            throw new Error(data.error || "Failed to save license class");
        }

        // Update the global AppState
        AppState.callSign = callSign;
        AppState.licenseClass = licenseClass;

        // Update original values and reset save button
        originalCallSignValue = callSignInput.value;
        originalLicenseClass = licenseClass;
        const saveCallSignBtn = document.getElementById("save-callsign-button");
        if (saveCallSignBtn) {
            saveCallSignBtn.disabled = true;
            saveCallSignBtn.className = "btn btn-secondary";
        }

        alert("Settings saved successfully.");
    } catch (error) {
        Log.error("Settings")("Failed to save settings:", error);
        alert("Failed to save settings.");
    }
}

// ============================================================================
// Tune Targets Functions
// ============================================================================

// Maximum number of tune targets allowed
const MAX_TUNE_TARGETS = 5;

// Track original tune targets state for change detection
// Format: [{url: "...", enabled: true}, ...]
let originalTuneTargets = [];
let originalTuneTargetsMobile = false;

// Load tune targets from device (falls back to AppState if device unavailable)
async function loadTuneTargets() {
    const mobileCheckbox = document.getElementById("tune-targets-mobile");
    const saveBtn = document.getElementById("save-tune-targets-button");

    let loadedFromDevice = false;
    try {
        const response = await fetch("/api/v1/tuneTargets");
        if (response.ok) {
            const data = await response.json();
            originalTuneTargets = normalizeTuneTargets(data.targets);
            originalTuneTargetsMobile = data.mobile || false;
            loadedFromDevice = true;
        }
    } catch (error) {
        Log.warn("Settings")("Device unavailable for tune targets load:", error);
    }

    // Fall back to AppState if device unavailable (may have session or cached data)
    if (!loadedFromDevice) {
        if (AppState.tuneTargets && AppState.tuneTargets.length > 0) {
            originalTuneTargets = [...AppState.tuneTargets];
            originalTuneTargetsMobile = AppState.tuneTargetsMobile || false;
            Log.debug("Settings")("Using tune targets from session state");
        } else {
            // Try localStorage cache as last resort
            loadTuneTargetsFromLocalStorage();
            if (AppState.tuneTargets && AppState.tuneTargets.length > 0) {
                originalTuneTargets = [...AppState.tuneTargets];
                originalTuneTargetsMobile = AppState.tuneTargetsMobile || false;
                Log.debug("Settings")("Using tune targets from localStorage cache");
            } else {
                originalTuneTargets = [];
                originalTuneTargetsMobile = false;
            }
        }
    }

    // Populate the UI
    renderTuneTargetsList();
    if (mobileCheckbox) {
        mobileCheckbox.checked = originalTuneTargetsMobile;
    }

    // Reset save button
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.className = "btn btn-secondary";
    }

    // Update example button states
    updateExampleButtonStates();
}

// Render the tune targets list UI from originalTuneTargets
function renderTuneTargetsList() {
    const listContainer = document.getElementById("tune-targets-list");
    if (!listContainer) return;

    // Use originalTuneTargets as the source (loaded from device)
    // If empty, show one blank row for user to add
    const targets = originalTuneTargets.length > 0 ? originalTuneTargets : [{ url: "", enabled: true }];

    renderTuneTargetsFromArray(targets);
}

// Get current tune targets from the UI
// Returns array of {url, enabled} objects
function getCurrentTuneTargets() {
    const rows = document.querySelectorAll(".tune-target-row");
    const targets = [];

    rows.forEach((row) => {
        const input = row.querySelector(".tune-target-input");
        const toggle = row.querySelector(".toggle-switch input");
        if (input) {
            targets.push({
                url: input.value,
                enabled: toggle ? toggle.checked : true,
            });
        }
    });

    // If empty, return an array with one empty target to show at least one input
    return targets.length > 0 ? targets : [{ url: "", enabled: true }];
}

// Add a new tune target input
function addTuneTarget() {
    const targets = getCurrentTuneTargets();
    if (targets.length >= MAX_TUNE_TARGETS) return;

    targets.push({ url: "", enabled: true });
    renderTuneTargetsFromArray(targets);
    updateTuneTargetsSaveButton();
    updateExampleButtonStates();
}

// Remove a tune target by index
function removeTuneTarget(index) {
    const targets = getCurrentTuneTargets();
    if (targets.length <= 1) {
        // Don't remove the last one, just clear it
        targets[0] = { url: "", enabled: true };
    } else {
        targets.splice(index, 1);
    }
    renderTuneTargetsFromArray(targets);
    updateTuneTargetsSaveButton();
    updateExampleButtonStates();
}

// Render tune targets list from an array of {url, enabled} objects
function renderTuneTargetsFromArray(targets) {
    const listContainer = document.getElementById("tune-targets-list");
    if (!listContainer) return;

    listContainer.innerHTML = "";

    targets.forEach((target, index) => {
        const row = document.createElement("div");
        row.className = "tune-target-row";

        // Toggle switch for enable/disable
        const toggleLabel = document.createElement("label");
        toggleLabel.className = "toggle-switch";
        toggleLabel.title = target.enabled ? "Enabled - click to disable" : "Disabled - click to enable";

        const toggleInput = document.createElement("input");
        toggleInput.type = "checkbox";
        toggleInput.checked = target.enabled;
        toggleInput.dataset.index = index;
        toggleInput.addEventListener("change", onTuneTargetToggleChange);

        const toggleSlider = document.createElement("span");
        toggleSlider.className = "toggle-slider";

        toggleLabel.appendChild(toggleInput);
        toggleLabel.appendChild(toggleSlider);

        // URL input
        const input = document.createElement("input");
        input.type = "text";
        input.className = "tune-target-input";
        input.placeholder = "e.g., http://websdr.example.com/?tune={FREQ-KHZ}{MODE}";
        input.value = target.url;
        input.maxLength = 255;
        input.dataset.index = index;
        input.addEventListener("input", onTuneTargetInputChange);

        // Remove button
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "btn btn-icon btn-remove";
        removeBtn.textContent = "−";
        removeBtn.title = "Remove target";
        removeBtn.addEventListener("click", () => removeTuneTarget(index));

        row.appendChild(toggleLabel);
        row.appendChild(input);
        row.appendChild(removeBtn);
        listContainer.appendChild(row);
    });

    updateAddButtonState();
}

// Update add button state based on count
function updateAddButtonState() {
    const addBtn = document.getElementById("add-tune-target-button");
    const targets = getCurrentTuneTargets();
    if (addBtn) {
        addBtn.disabled = targets.length >= MAX_TUNE_TARGETS;
    }
}

// Handle tune target input change
function onTuneTargetInputChange() {
    updateTuneTargetsSaveButton();
    updateExampleButtonStates();
}

// Handle tune target toggle switch change
function onTuneTargetToggleChange(event) {
    // Update the title to reflect new state
    const toggleLabel = event.target.closest(".toggle-switch");
    if (toggleLabel) {
        toggleLabel.title = event.target.checked ? "Enabled - click to disable" : "Disabled - click to enable";
    }
    updateTuneTargetsSaveButton();
}

// Handle mobile checkbox change
function onTuneTargetsMobileChange() {
    updateTuneTargetsSaveButton();
}

// Check if tune targets have changed from original
function haveTuneTargetsChanged() {
    const currentTargets = getCurrentTuneTargets().filter((t) => t.url.trim() !== "");
    const mobileCheckbox = document.getElementById("tune-targets-mobile");
    const currentMobile = mobileCheckbox ? mobileCheckbox.checked : false;

    // Compare mobile setting
    if (currentMobile !== originalTuneTargetsMobile) return true;

    // Compare targets arrays (compare as objects)
    const originalNonEmpty = originalTuneTargets.filter((t) => t.url.trim() !== "");
    if (currentTargets.length !== originalNonEmpty.length) return true;

    for (let i = 0; i < currentTargets.length; i++) {
        if (currentTargets[i].url !== originalNonEmpty[i].url) return true;
        if (currentTargets[i].enabled !== originalNonEmpty[i].enabled) return true;
    }

    return false;
}

// Update save button state
function updateTuneTargetsSaveButton() {
    const saveBtn = document.getElementById("save-tune-targets-button");
    if (saveBtn) {
        const hasChanged = haveTuneTargetsChanged();
        saveBtn.disabled = !hasChanged;
        saveBtn.className = hasChanged ? "btn btn-primary" : "btn btn-secondary";
    }
}

// Add an example URL to the tune targets list
function addExampleTuneTarget(url) {
    const targets = getCurrentTuneTargets();

    // Check if already at max
    if (targets.length >= MAX_TUNE_TARGETS) {
        alert(`Maximum of ${MAX_TUNE_TARGETS} tune targets allowed.`);
        return;
    }

    // Check if URL already exists
    if (targets.some((t) => t.url === url)) {
        alert("This URL is already in your tune targets.");
        return;
    }

    // If there's only one empty target, replace it; otherwise append
    if (targets.length === 1 && targets[0].url.trim() === "") {
        targets[0] = { url: url, enabled: true };
    } else {
        targets.push({ url: url, enabled: true });
    }

    renderTuneTargetsFromArray(targets);
    updateTuneTargetsSaveButton();
    updateExampleButtonStates();
}

// Update example button states based on current targets
function updateExampleButtonStates() {
    const targets = getCurrentTuneTargets();
    const exampleButtons = document.querySelectorAll(".btn-add-example");

    exampleButtons.forEach((btn) => {
        const url = btn.dataset.url;
        const alreadyAdded = targets.some((t) => t.url === url);
        const atMax = targets.filter((t) => t.url.trim() !== "").length >= MAX_TUNE_TARGETS;

        btn.disabled = alreadyAdded || atMax;
        btn.textContent = alreadyAdded ? "added" : "+ add";
    });
}

// Save tune targets to device (falls back to session-only if device unavailable)
async function saveTuneTargets() {
    const targets = getCurrentTuneTargets().filter((t) => t.url.trim() !== "");
    const mobileCheckbox = document.getElementById("tune-targets-mobile");
    const mobile = mobileCheckbox ? mobileCheckbox.checked : false;

    const payload = {
        targets: targets,
        mobile: mobile,
    };

    let savedToDevice = false;
    try {
        const response = await fetch("/api/v1/tuneTargets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (response.ok) {
            savedToDevice = true;
        }
    } catch (error) {
        Log.warn("Settings")("Device unavailable for tune targets save:", error);
    }

    // Always update session state (AppState) so targets work for this session
    originalTuneTargets = [...targets];
    originalTuneTargetsMobile = mobile;
    AppState.tuneTargets = normalizeTuneTargets(targets);
    AppState.tuneTargetsMobile = mobile;

    // Also save to localStorage as a cache (write-through)
    saveTuneTargetsToLocalStorage(AppState.tuneTargets, AppState.tuneTargetsMobile);

    // Reset save button
    const saveBtn = document.getElementById("save-tune-targets-button");
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.className = "btn btn-secondary";
    }

    if (savedToDevice) {
        alert("Tune targets saved.");
    } else {
        alert("Tune targets saved for this session (device unavailable).");
    }
}

// ============================================================================
// CW Macros Functions
// ============================================================================

// Maximum number of CW macros allowed
const MAX_CW_MACROS = 8;

// Track original CW macros state for change detection
let originalCwMacros = [];

// Load CW macros from device (falls back to AppState if device unavailable)
async function loadCwMacros() {
    const saveBtn = document.getElementById("save-cw-macros-button");

    let loadedFromDevice = false;
    try {
        const response = await fetch("/api/v1/cwMacros");
        if (response.ok) {
            const data = await response.json();
            originalCwMacros = data.macros || [];
            loadedFromDevice = true;
        }
    } catch (error) {
        Log.warn("Settings")("Device unavailable for CW macros load:", error);
    }

    if (!loadedFromDevice) {
        if (AppState.cwMacros && AppState.cwMacros.length > 0) {
            originalCwMacros = [...AppState.cwMacros];
            Log.debug("Settings")("Using CW macros from session state");
        } else {
            loadCwMacrosFromLocalStorage();
            if (AppState.cwMacros && AppState.cwMacros.length > 0) {
                originalCwMacros = [...AppState.cwMacros];
                Log.debug("Settings")("Using CW macros from localStorage cache");
            } else {
                originalCwMacros = [];
            }
        }
    }

    renderCwMacrosList();

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.className = "btn btn-secondary";
    }

    updateCwExampleButtonStates();
}

// Render the CW macros list UI from originalCwMacros
function renderCwMacrosList() {
    const macros = originalCwMacros.length > 0 ? originalCwMacros : [{ label: "", template: "" }];
    renderCwMacrosFromArray(macros);
}

// Get current CW macros from the UI
function getCurrentCwMacros() {
    const rows = document.querySelectorAll(".cw-macro-row");
    const macros = [];

    rows.forEach((row) => {
        const labelInput = row.querySelector(".cw-macro-label");
        const templateInput = row.querySelector(".cw-macro-template");
        if (labelInput && templateInput) {
            macros.push({
                label: labelInput.value,
                template: templateInput.value.toUpperCase(),
            });
        }
    });

    return macros.length > 0 ? macros : [{ label: "", template: "" }];
}

// Add a new CW macro row
function addCwMacro() {
    const macros = getCurrentCwMacros();
    if (macros.length >= MAX_CW_MACROS) return;

    macros.push({ label: "", template: "" });
    renderCwMacrosFromArray(macros);
    updateCwMacrosSaveButton();
    updateCwExampleButtonStates();
}

// Remove a CW macro by index
function removeCwMacro(index) {
    const macros = getCurrentCwMacros();
    if (macros.length <= 1) {
        macros[0] = { label: "", template: "" };
    } else {
        macros.splice(index, 1);
    }
    renderCwMacrosFromArray(macros);
    updateCwMacrosSaveButton();
    updateCwExampleButtonStates();
}

// Render CW macros list from an array of {label, template} objects
function renderCwMacrosFromArray(macros) {
    const listContainer = document.getElementById("cw-macros-list");
    if (!listContainer) return;

    listContainer.innerHTML = "";

    macros.forEach((macro, index) => {
        const row = document.createElement("div");
        row.className = "cw-macro-row";

        const labelInput = document.createElement("input");
        labelInput.type = "text";
        labelInput.className = "cw-macro-label";
        labelInput.placeholder = "Label";
        labelInput.value = macro.label;
        labelInput.maxLength = 12;
        labelInput.addEventListener("input", onCwMacroInputChange);

        const templateInput = document.createElement("input");
        templateInput.type = "text";
        templateInput.className = "cw-macro-template";
        templateInput.placeholder = "Template, e.g. CQ SOTA DE {MYCALL} K";
        templateInput.value = macro.template;
        templateInput.maxLength = 64;
        templateInput.addEventListener("input", onCwMacroInputChange);

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "btn btn-icon btn-remove";
        removeBtn.textContent = "\u2212";
        removeBtn.title = "Remove macro";
        removeBtn.addEventListener("click", () => removeCwMacro(index));

        row.appendChild(labelInput);
        row.appendChild(templateInput);
        row.appendChild(removeBtn);
        listContainer.appendChild(row);
    });

    updateCwAddButtonState();
}

// Update add button state based on count
function updateCwAddButtonState() {
    const addBtn = document.getElementById("add-cw-macro-button");
    const macros = getCurrentCwMacros();
    if (addBtn) {
        addBtn.disabled = macros.length >= MAX_CW_MACROS;
    }
}

// Handle CW macro input change
function onCwMacroInputChange() {
    updateCwMacrosSaveButton();
    updateCwExampleButtonStates();
}

// Check if CW macros have changed from original
function haveCwMacrosChanged() {
    const currentMacros = getCurrentCwMacros().filter((m) => m.label.trim() !== "" || m.template.trim() !== "");
    const originalNonEmpty = originalCwMacros.filter((m) => m.label.trim() !== "" || m.template.trim() !== "");

    if (currentMacros.length !== originalNonEmpty.length) return true;

    for (let i = 0; i < currentMacros.length; i++) {
        if (currentMacros[i].label !== originalNonEmpty[i].label) return true;
        if (currentMacros[i].template !== originalNonEmpty[i].template) return true;
    }

    return false;
}

// Update save button state
function updateCwMacrosSaveButton() {
    const saveBtn = document.getElementById("save-cw-macros-button");
    if (saveBtn) {
        const hasChanged = haveCwMacrosChanged();
        saveBtn.disabled = !hasChanged;
        saveBtn.className = hasChanged ? "btn btn-primary" : "btn btn-secondary";
    }
}

// Add an example CW macro
function addExampleCwMacro(label, template) {
    const macros = getCurrentCwMacros();

    if (macros.length >= MAX_CW_MACROS) {
        alert(`Maximum of ${MAX_CW_MACROS} CW macros allowed.`);
        return;
    }

    if (macros.some((m) => m.label === label && m.template === template)) {
        alert("This macro is already in your list.");
        return;
    }

    if (macros.length === 1 && macros[0].label.trim() === "" && macros[0].template.trim() === "") {
        macros[0] = { label, template };
    } else {
        macros.push({ label, template });
    }

    renderCwMacrosFromArray(macros);
    updateCwMacrosSaveButton();
    updateCwExampleButtonStates();
}

// Update example button states
function updateCwExampleButtonStates() {
    const macros = getCurrentCwMacros();
    const exampleButtons = document.querySelectorAll(".btn-add-cw-example");

    exampleButtons.forEach((btn) => {
        const label = btn.dataset.label;
        const template = btn.dataset.template;
        const alreadyAdded = macros.some((m) => m.label === label && m.template === template);
        const nonEmpty = macros.filter((m) => m.label.trim() !== "" || m.template.trim() !== "");
        const atMax = nonEmpty.length >= MAX_CW_MACROS;

        btn.disabled = alreadyAdded || atMax;
        btn.textContent = alreadyAdded ? "added" : "+ add";
    });
}

// Save CW macros to device
async function saveCwMacros() {
    const macros = getCurrentCwMacros().filter((m) => m.label.trim() !== "" || m.template.trim() !== "");

    const payload = { macros };

    let savedToDevice = false;
    try {
        const response = await fetch("/api/v1/cwMacros", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (response.ok) {
            savedToDevice = true;
        }
    } catch (error) {
        Log.warn("Settings")("Device unavailable for CW macros save:", error);
    }

    originalCwMacros = [...macros];
    AppState.cwMacros = [...macros];
    saveCwMacrosToLocalStorage(macros);

    const saveBtn = document.getElementById("save-cw-macros-button");
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.className = "btn btn-secondary";
    }

    if (savedToDevice) {
        alert("CW macros saved.");
    } else {
        alert("CW macros saved for this session (device unavailable).");
    }
}

// ============================================================================
// CW Macros Help Popup Functions
// ============================================================================

function toggleCwMacrosHelp() {
    const popup = document.getElementById("cw-macros-help-popup");
    const isVisible = popup && !popup.classList.contains("hidden");

    if (isVisible) {
        popup.classList.add("hidden");
    } else {
        popup.classList.remove("hidden");
    }
    updateBodyOverflowLock();
}

// ============================================================================
// Chase Filters Functions
// ============================================================================

// Load filter bands setting and update checkbox UI
function loadFilterBandsSettingUI() {
    loadFilterBandsSetting(); // From main.js - loads into AppState
    const checkbox = document.getElementById("filter-bands-enabled");
    if (checkbox) {
        checkbox.checked = AppState.filterBandsEnabled;
    }
}

// Save filter bands setting to localStorage when checkbox changes
function onFilterBandsChange() {
    const checkbox = document.getElementById("filter-bands-enabled");
    if (checkbox) {
        const enabled = checkbox.checked;
        localStorage.setItem("sotacat_filter_bands", enabled ? "true" : "false");
        AppState.filterBandsEnabled = enabled;
        Log.info("Settings")(`Filter bands: ${enabled ? "enabled" : "disabled"}`);
    }
}

// Load UI compact mode setting into checkbox
function loadUiCompactModeSettingUI() {
    const checkbox = document.getElementById("ui-compact-mode");
    if (checkbox) {
        checkbox.checked = AppState.uiCompactMode;
    }
}

// Save UI compact mode setting and apply immediately
function onUiCompactModeChange() {
    const checkbox = document.getElementById("ui-compact-mode");
    if (!checkbox) return;
    const enabled = checkbox.checked;
    localStorage.setItem("sotacat_ui_compact", enabled ? "true" : "false");
    AppState.uiCompactMode = enabled;
    applyUiCompactMode();
    Log.info("Settings")(`Compact mode: ${enabled ? "enabled" : "disabled"}`);
}

// ============================================================================
// Tune Targets Help Popup Functions
// ============================================================================

function updateBodyOverflowLock() {
    const wifiPopup = document.getElementById("wifi-help-popup");
    const tuneTargetsPopup = document.getElementById("tune-targets-help-popup");
    const cwMacrosPopup = document.getElementById("cw-macros-help-popup");
    const anyOpen =
        (wifiPopup && !wifiPopup.classList.contains("hidden")) ||
        (tuneTargetsPopup && !tuneTargetsPopup.classList.contains("hidden")) ||
        (cwMacrosPopup && !cwMacrosPopup.classList.contains("hidden"));
    document.body.classList.toggle("overflow-hidden", anyOpen);
}

// Toggle Tune Targets help popup
function toggleTuneTargetsHelp() {
    const popup = document.getElementById("tune-targets-help-popup");
    const isVisible = popup && !popup.classList.contains("hidden");

    if (isVisible) {
        popup.classList.add("hidden");
    } else {
        popup.classList.remove("hidden");
    }
    updateBodyOverflowLock();
}

// ============================================================================
// WiFi Help Popup Functions
// ============================================================================

// Toggle WiFi configuration help popup
function toggleWifiHelp() {
    const popup = document.getElementById("wifi-help-popup");
    const isVisible = popup && !popup.classList.contains("hidden");

    if (isVisible) {
        popup.classList.add("hidden");
    } else {
        popup.classList.remove("hidden");
    }
    updateBodyOverflowLock();
}

// Close popup when clicking outside of it
function handleClickOutsidePopup(event) {
    // Handle WiFi help popup
    const wifiPopup = document.getElementById("wifi-help-popup");
    const wifiHelpButton = document.getElementById("wifi-help-button");

    if (
        wifiPopup &&
        !wifiPopup.classList.contains("hidden") &&
        !wifiPopup.contains(event.target) &&
        wifiHelpButton &&
        !wifiHelpButton.contains(event.target)
    ) {
        toggleWifiHelp();
    }

    // Handle Tune Targets help popup
    const tuneTargetsPopup = document.getElementById("tune-targets-help-popup");
    const tuneTargetsHelpButton = document.getElementById("tune-targets-help-button");

    if (
        tuneTargetsPopup &&
        !tuneTargetsPopup.classList.contains("hidden") &&
        !tuneTargetsPopup.contains(event.target) &&
        tuneTargetsHelpButton &&
        !tuneTargetsHelpButton.contains(event.target)
    ) {
        toggleTuneTargetsHelp();
    }

    // Handle CW Macros help popup
    const cwMacrosPopup = document.getElementById("cw-macros-help-popup");
    const cwMacrosHelpButton = document.getElementById("cw-macros-help-button");

    if (
        cwMacrosPopup &&
        !cwMacrosPopup.classList.contains("hidden") &&
        !cwMacrosPopup.contains(event.target) &&
        cwMacrosHelpButton &&
        !cwMacrosHelpButton.contains(event.target)
    ) {
        toggleCwMacrosHelp();
    }
}

// ============================================================================
// Password Visibility Functions
// ============================================================================

// Toggle password field visibility (inputId: 'sta1-pass', 'sta2-pass', etc.)
function togglePasswordVisibility(inputId) {
    const passwordInput = document.getElementById(inputId);
    const isPassword = passwordInput.type === "password";
    passwordInput.type = isPassword ? "text" : "password";

    const button = document.querySelector(`.password-visibility-toggle[data-target="${inputId}"]`);
    if (button) {
        button.classList.toggle("active", isPassword);
        button.querySelector(".eye-icon").style.display = isPassword ? "none" : "";
        button.querySelector(".eye-off-icon").style.display = isPassword ? "" : "none";
        button.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
        button.setAttribute("title", isPassword ? "Hide password" : "Show password");
    }
}

// ============================================================================
// WiFi Settings Functions
// ============================================================================

// Track the original WiFi values to detect changes
let originalWifiValues = {};

// WiFi field IDs for change tracking
const WIFI_FIELD_IDS = [
    "sta1-ssid",
    "sta1-pass",
    "sta1-ip-pin",
    "sta2-ssid",
    "sta2-pass",
    "sta2-ip-pin",
    "sta3-ssid",
    "sta3-pass",
    "sta3-ip-pin",
    "ap-ssid",
    "ap-pass",
];

// Store current WiFi values as the original baseline
function storeOriginalWifiValues() {
    originalWifiValues = {};
    WIFI_FIELD_IDS.forEach((id) => {
        const element = document.getElementById(id);
        if (element) {
            originalWifiValues[id] = element.type === "checkbox" ? element.checked : element.value;
        }
    });
}

// Check if any WiFi field has changed from original value
function hasWifiChanged() {
    return WIFI_FIELD_IDS.some((id) => {
        const element = document.getElementById(id);
        if (!element) return false;
        const currentValue = element.type === "checkbox" ? element.checked : element.value;
        return currentValue !== originalWifiValues[id];
    });
}

// Update WiFi save button state based on whether values have changed
function updateWifiSaveButton() {
    const saveWifiBtn = document.getElementById("save-wifi-button");
    if (saveWifiBtn) {
        const hasChanged = hasWifiChanged();
        saveWifiBtn.disabled = !hasChanged;
        saveWifiBtn.className = hasChanged ? "btn btn-primary btn-large" : "btn btn-secondary btn-large";
    }
}

// Fetch WiFi settings from device
async function fetchSettings() {
    if (isLocalhost) return;
    try {
        const response = await fetch("/api/v1/settings", { method: "GET" });
        const data = await response.json();

        document.getElementById("sta1-ssid").value = data.sta1_ssid;
        document.getElementById("sta1-pass").value = data.sta1_pass;
        document.getElementById("sta2-ssid").value = data.sta2_ssid;
        document.getElementById("sta2-pass").value = data.sta2_pass;
        document.getElementById("sta3-ssid").value = data.sta3_ssid;
        document.getElementById("sta3-pass").value = data.sta3_pass;
        document.getElementById("ap-ssid").value = data.ap_ssid;
        document.getElementById("ap-pass").value = data.ap_pass;

        // Load IP pinning checkboxes (default to false if not present)
        const sta1IpPin = document.getElementById("sta1-ip-pin");
        if (sta1IpPin) sta1IpPin.checked = data.sta1_ip_pin === true;
        const sta2IpPin = document.getElementById("sta2-ip-pin");
        if (sta2IpPin) sta2IpPin.checked = data.sta2_ip_pin === true;
        const sta3IpPin = document.getElementById("sta3-ip-pin");
        if (sta3IpPin) sta3IpPin.checked = data.sta3_ip_pin === true;

        // Store original values and reset save button
        storeOriginalWifiValues();
        updateWifiSaveButton();
    } catch (error) {
        Log.error("Settings")("Failed to fetch settings:", error);
    }
}

// Save WiFi settings to device (causes immediate device reboot)
async function saveSettings() {
    Log.debug("Settings")("Saving settings...");
    if (isLocalhost) return;

    const settings = {
        sta1_ssid: document.getElementById("sta1-ssid").value,
        sta1_pass: document.getElementById("sta1-pass").value,
        sta1_ip_pin: document.getElementById("sta1-ip-pin").checked,
        sta2_ssid: document.getElementById("sta2-ssid").value,
        sta2_pass: document.getElementById("sta2-pass").value,
        sta2_ip_pin: document.getElementById("sta2-ip-pin").checked,
        sta3_ssid: document.getElementById("sta3-ssid").value,
        sta3_pass: document.getElementById("sta3-pass").value,
        sta3_ip_pin: document.getElementById("sta3-ip-pin").checked,
        ap_ssid: document.getElementById("ap-ssid").value,
        ap_pass: document.getElementById("ap-pass").value,
    };

    try {
        const response = await fetch("/api/v1/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(settings),
        });

        // If the response is OK but empty (likely due to reboot), assume success
        if (response.ok) {
            Log.debug("Settings")("Settings saved successfully");
            alert(
                "Settings saved successfully!\nYour SOTAcat is rebooting with the new settings.\nPlease restart your browser."
            );
            return;
        }

        // Otherwise, parse the response for potential errors
        const data = await response.json();
        throw new Error(data.error || "Unknown error");
    } catch (error) {
        // If the error is a network error (likely due to reboot), ignore it
        if (error.message.includes("NetworkError")) {
            Log.warn("Settings")("Ignoring expected network error due to reboot.");
            return;
        }

        Log.error("Settings")("Failed to save settings:", error);
        alert("Failed to save settings.");
    }
}

// ============================================================================
// WiFi Settings Validation Functions
// ============================================================================

// Validate that WiFi SSID and password fields are consistently filled
function customCheckSettingsValidity() {
    // Define pairs of SSID and password inputs
    const wifiPairs = [
        { ssid: document.getElementById("sta1-ssid"), pass: document.getElementById("sta1-pass") },
        { ssid: document.getElementById("sta2-ssid"), pass: document.getElementById("sta2-pass") },
        { ssid: document.getElementById("sta3-ssid"), pass: document.getElementById("sta3-pass") },
        { ssid: document.getElementById("ap-ssid"), pass: document.getElementById("ap-pass") },
    ];

    // Check each pair
    for (let pair of wifiPairs) {
        const ssidValue = pair.ssid.value;
        const passValue = pair.pass.value;

        // If one is empty and the other is not, return false
        if ((ssidValue === "" && passValue !== "") || (ssidValue !== "" && passValue === "")) {
            // Optionally, you can alert the user which input group is incorrectly filled
            alert(`Both "${pair.ssid.name}" and "${pair.pass.name}" must be either filled in or left blank.`);
            return false;
        }
    }

    return true;
}

// Handle WiFi settings form submission with validation (event handler)
function onSubmitSettings(event) {
    const wifiForm = document.getElementById("wifi-settings");

    // Prevent the form from submitting until we've done our custom validation
    event.preventDefault();

    // Perform built-in HTML5 validation first. This will show popup for invalid inputs.
    if (!wifiForm.checkValidity()) {
        return;
    }

    // If HTML5 validation passes, we perform our custom validation
    if (!customCheckSettingsValidity()) {
        return;
    }

    saveSettings();
}

// ============================================================================
// Firmware Upload Functions
// ============================================================================

// Update upload button and step number when file is selected
function updateButtonText() {
    const fileInput = document.getElementById("ota-file");
    const uploadButton = document.getElementById("upload-button");
    const stepNumber = document.getElementById("upload-step-number");

    if (fileInput.files.length > 0) {
        const fileName = fileInput.files[0].name;
        uploadButton.textContent = `Upload ${fileName}`;
        uploadButton.disabled = false;
        uploadButton.className = "btn btn-primary";
        if (stepNumber) {
            stepNumber.classList.remove("step-number-disabled");
        }
    } else {
        uploadButton.textContent = "Upload Firmware";
        uploadButton.disabled = true;
        uploadButton.className = "btn btn-secondary";
        if (stepNumber) {
            stepNumber.classList.add("step-number-disabled");
        }
    }
}

// Upload firmware file to device (causes immediate device reboot)
async function uploadFirmware() {
    const otaFileInput = document.getElementById("ota-file");
    const otaStatus = document.getElementById("ota-status");
    const uploadButton = document.getElementById("upload-button");
    const file = otaFileInput.files[0];

    if (!file) {
        alert("Please select a firmware file to upload.");
        return;
    }

    // Disable the button and update status to show upload is in progress
    uploadButton.disabled = true;
    uploadButton.textContent = "Uploading firmware...";
    otaStatus.innerHTML = "Uploading firmware... Please wait and do not refresh the page.";

    const blob = new Blob([file], { type: "application/octet-stream" });

    try {
        const response = await fetch("/api/v1/ota", {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: blob,
        });

        if (response.ok) {
            // Update status to show firmware is being applied
            otaStatus.innerHTML = "Firmware upload successful. Applying firmware update...";
            uploadButton.textContent = "Applying firmware...";

            // Show final message and alert
            setTimeout(() => {
                otaStatus.innerHTML = "Firmware upload successful. SOTAcat will now reboot.";
                uploadButton.textContent = "Upload Complete";
                alert(
                    "Firmware upload successful.\nYour SOTAcat is rebooting with the new firmware.\nPlease restart your browser."
                );
            }, FIRMWARE_UPLOAD_SUCCESS_DELAY_MS);
            return;
        }

        // Handle error response - re-sync button with file input state
        updateButtonText();

        const text = await response.text();
        let errorData;
        try {
            errorData = JSON.parse(text);
        } catch (e) {
            throw new Error("Failed to parse error response from server");
        }
        throw new Error(errorData.error || "Unknown error occurred");
    } catch (error) {
        Log.error("Settings")("Firmware upload error:", error);
        otaStatus.innerHTML = `Firmware upload failed: ${error.message}`;
        alert(`Firmware upload failed: ${error.message}`);

        // Re-sync button with file input state
        updateButtonText();
    }
}

// ============================================================================
// Version Checking Functions
// ============================================================================

// Manually trigger firmware version check (returns message string or throws error)
async function manualCheckFirmwareVersion() {
    try {
        const result = await checkFirmwareVersion(true);
        if (result) {
            alert(result);
        }
    } catch (error) {
        Log.error("Settings")("Manual version check error:", error);
        alert("Error checking for firmware updates. Please try again later.");
    }
}

// ============================================================================
// Event Handler Attachment
// ============================================================================

let settingsEventListenersAttached = false;

// Attach all Settings page event listeners
function attachSettingsEventListeners() {
    // Only attach once to prevent memory leaks
    if (settingsEventListenersAttached) {
        return;
    }
    settingsEventListenersAttached = true;

    // WiFi settings form submit
    const wifiForm = document.getElementById("wifi-settings");
    if (wifiForm) {
        wifiForm.addEventListener("submit", onSubmitSettings);
    }

    const saveCallSignBtn = document.getElementById("save-callsign-button");
    if (saveCallSignBtn) {
        saveCallSignBtn.addEventListener("click", saveCallSign);
    }

    // Call sign input - enforce uppercase, valid characters, and track changes
    const callSignInput = document.getElementById("callsign");
    if (callSignInput) {
        callSignInput.addEventListener("input", function () {
            // Convert to uppercase and filter to only allow A-Z, 0-9, and /
            this.value = this.value.toUpperCase().replace(/[^A-Z0-9\/]/g, "");
            // Update save button state based on changes
            onCallSignInputChange();
        });
    }

    // License class select - track changes
    const licenseClassSelect = document.getElementById("license-class");
    if (licenseClassSelect) {
        licenseClassSelect.addEventListener("change", onCallSignInputChange);
    }

    // WiFi help buttons
    const wifiHelpBtn = document.getElementById("wifi-help-button");
    if (wifiHelpBtn) {
        wifiHelpBtn.addEventListener("click", toggleWifiHelp);
    }

    const wifiHelpCloseBtn = document.getElementById("wifi-help-close-button");
    if (wifiHelpCloseBtn) {
        wifiHelpCloseBtn.addEventListener("click", toggleWifiHelp);
    }

    // Tune Targets help buttons
    const tuneTargetsHelpBtn = document.getElementById("tune-targets-help-button");
    if (tuneTargetsHelpBtn) {
        tuneTargetsHelpBtn.addEventListener("click", toggleTuneTargetsHelp);
    }

    const tuneTargetsHelpCloseBtn = document.getElementById("tune-targets-help-close-button");
    if (tuneTargetsHelpCloseBtn) {
        tuneTargetsHelpCloseBtn.addEventListener("click", toggleTuneTargetsHelp);
    }

    // Password visibility toggles
    document.querySelectorAll(".password-visibility-toggle").forEach((button) => {
        button.addEventListener("click", function () {
            const targetId = this.getAttribute("data-target");
            togglePasswordVisibility(targetId);
        });
    });

    // WiFi field change tracking
    WIFI_FIELD_IDS.forEach((id) => {
        const element = document.getElementById(id);
        if (element) {
            // Use 'change' for checkboxes, 'input' for text fields
            const eventType = element.type === "checkbox" ? "change" : "input";
            element.addEventListener(eventType, updateWifiSaveButton);
        }
    });

    // Firmware update buttons
    const checkUpdatesBtn = document.getElementById("check-updates-button");
    if (checkUpdatesBtn) {
        checkUpdatesBtn.addEventListener("click", manualCheckFirmwareVersion);
    }

    const downloadFirmwareBtn = document.getElementById("download-firmware-button");
    if (downloadFirmwareBtn) {
        downloadFirmwareBtn.addEventListener("click", () => {
            window.location.href = "https://sotamat.com/wp-content/uploads/SOTACAT-ESP32C3-OTA.bin";
        });
    }

    const selectFileBtn = document.getElementById("select-file-button");
    const otaFileInput = document.getElementById("ota-file");
    if (selectFileBtn && otaFileInput) {
        selectFileBtn.addEventListener("click", () => {
            otaFileInput.click();
        });
    }

    if (otaFileInput) {
        otaFileInput.addEventListener("change", updateButtonText);
    }

    const uploadBtn = document.getElementById("upload-button");
    if (uploadBtn) {
        uploadBtn.addEventListener("click", uploadFirmware);
    }

    // Click outside popup to close
    document.addEventListener("click", handleClickOutsidePopup);

    // Tune targets buttons and checkbox
    const addTuneTargetBtn = document.getElementById("add-tune-target-button");
    if (addTuneTargetBtn) {
        addTuneTargetBtn.addEventListener("click", addTuneTarget);
    }

    const saveTuneTargetsBtn = document.getElementById("save-tune-targets-button");
    if (saveTuneTargetsBtn) {
        saveTuneTargetsBtn.addEventListener("click", saveTuneTargets);
    }

    const tuneTargetsMobileCheckbox = document.getElementById("tune-targets-mobile");
    if (tuneTargetsMobileCheckbox) {
        tuneTargetsMobileCheckbox.addEventListener("change", onTuneTargetsMobileChange);
    }

    // Tune Targets example "add" buttons
    document.querySelectorAll(".btn-add-example").forEach((btn) => {
        btn.addEventListener("click", function () {
            const url = this.dataset.url;
            if (url) {
                addExampleTuneTarget(url);
            }
        });
    });

    // CW Macros buttons
    const cwMacrosHelpBtn = document.getElementById("cw-macros-help-button");
    if (cwMacrosHelpBtn) {
        cwMacrosHelpBtn.addEventListener("click", toggleCwMacrosHelp);
    }

    const cwMacrosHelpCloseBtn = document.getElementById("cw-macros-help-close-button");
    if (cwMacrosHelpCloseBtn) {
        cwMacrosHelpCloseBtn.addEventListener("click", toggleCwMacrosHelp);
    }

    const addCwMacroBtn = document.getElementById("add-cw-macro-button");
    if (addCwMacroBtn) {
        addCwMacroBtn.addEventListener("click", addCwMacro);
    }

    const saveCwMacrosBtn = document.getElementById("save-cw-macros-button");
    if (saveCwMacrosBtn) {
        saveCwMacrosBtn.addEventListener("click", saveCwMacros);
    }

    // CW Macros example "add" buttons
    document.querySelectorAll(".btn-add-cw-example").forEach((btn) => {
        btn.addEventListener("click", function () {
            const label = this.dataset.label;
            const template = this.dataset.template;
            if (label && template) {
                addExampleCwMacro(label, template);
            }
        });
    });

    // Chase filters - band filter checkbox
    const filterBandsCheckbox = document.getElementById("filter-bands-enabled");
    if (filterBandsCheckbox) {
        filterBandsCheckbox.addEventListener("change", onFilterBandsChange);
    }

    // Display settings - compact mode checkbox
    const compactModeCheckbox = document.getElementById("ui-compact-mode");
    if (compactModeCheckbox) {
        compactModeCheckbox.addEventListener("change", onUiCompactModeChange);
    }
}

// ============================================================================
// Page Lifecycle
// ============================================================================

// Called when Settings tab becomes visible
function onSettingsAppearing() {
    fetchSettings();
    attachSettingsEventListeners();
    loadCallSign();
    loadTuneTargets();
    loadCwMacros();
    loadFilterBandsSettingUI();
    loadUiCompactModeSettingUI();
    fetchAndUpdateElement("/api/v1/version", "build-version");
}

// Called when Settings tab is hidden
function onSettingsLeaving() {
    Log.info("Settings")("tab leaving");
    // Clean up document-level event listener to prevent memory leaks
    document.removeEventListener("click", handleClickOutsidePopup);

    // Reset event listener flag so it can be reattached when returning to this tab
    // (necessary because DOM is recreated on each tab switch)
    settingsEventListenersAttached = false;
}
