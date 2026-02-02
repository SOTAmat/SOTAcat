// ============================================================================
// Chase Page Logic
// ============================================================================
// Unified page for tracking SOTA, POTA, and other xOTA spots via Spothole API

// Configuration constants - adjust these to change behavior
const CHASE_HISTORY_DURATION_SECONDS = 3600; // 1 hour (3600 seconds)
const CHASE_API_SPOT_LIMIT = 500; // Maximum number of spots to fetch from API
const CHASE_MIN_REFRESH_INTERVAL_MS = 60000; // Minimum time between API calls (60 seconds)
const CHASE_AUTO_REFRESH_INTERVAL_MS = 60000; // Auto-refresh interval (60 seconds)
const CHASE_AUTO_SUGGEST_THRESHOLD = 3; // Number of manual refreshes to suggest auto-refresh
const CHASE_AUTO_SUGGEST_WINDOW_MS = 300000; // Time window to track refreshes (5 minutes)
const REFRESH_TIMER_UPDATE_INTERVAL_MS = 1000; // Update refresh timer every second
const AUTO_SUGGESTION_REVERT_TIMEOUT_MS = 5000; // Auto-suggestion revert delay
const VFO_FREQUENCY_TOLERANCE_HZ = 100; // +/- 100 Hz for matching radio to spots

// Chase page state encapsulated in a single object
const ChaseState = {
    // Filter state
    typeFilter: null,
    modeFilter: null,

    // Timing state
    lastRefreshTime: 0,
    lastRefreshCompleteTime: 0,
    refreshTimerInterval: null,

    // Auto-refresh state
    autoRefreshEnabled: false,
    autoRefreshTimeoutId: null,
    nextAutoRefreshTime: 0,

    // Usage tracking for smart suggestions
    manualRefreshTimes: [],
    suggestionRevertTimeoutId: null,

    // Sort state
    sortField: "timestamp",
    lastSortField: "timestamp",
    descending: true,

    // UI state
    chaseEventListenersAttached: false,

};

// ============================================================================
// State Management Functions
// ============================================================================

// Load saved sort preferences from localStorage and update ChaseState
function loadSortState() {
    const savedSortField = localStorage.getItem("chaseSortField");
    const savedSortDescending = localStorage.getItem("chaseSortDescending");

    if (savedSortField !== null) {
        ChaseState.sortField = savedSortField;
        ChaseState.lastSortField = savedSortField;
    } else {
        ChaseState.sortField = "timestamp";
        ChaseState.lastSortField = "timestamp";
    }

    if (savedSortDescending !== null) {
        ChaseState.descending = savedSortDescending === "true";
    } else {
        ChaseState.descending = true;
    }
}

// Save current sort preferences from ChaseState to localStorage
function saveSortState() {
    localStorage.setItem("chaseSortField", ChaseState.sortField);
    localStorage.setItem("chaseSortDescending", ChaseState.descending);
}

// Load saved type filter from localStorage (returns 'xOTA', 'Cluster', 'All', etc.)
function loadTypeFilter() {
    const savedType = localStorage.getItem("chaseTypeFilter");
    ChaseState.typeFilter = savedType !== null ? savedType : "xOTA"; // Default to xOTA only (not DX cluster)
    return ChaseState.typeFilter;
}

// Save type filter selection to localStorage and update ChaseState
function saveTypeFilter(type) {
    ChaseState.typeFilter = type;
    localStorage.setItem("chaseTypeFilter", type);
}

// Handle type filter dropdown change event (saves and applies new filter)
function onTypeFilterChange(type) {
    saveTypeFilter(type);
    applyTableFilters();
}

// Load saved mode filter from localStorage (returns 'All', 'CW', 'SSB', 'DATA', etc.)
function loadGlobalModeFilter() {
    const savedMode = localStorage.getItem("chaseModeFilter");
    ChaseState.modeFilter = savedMode !== null ? savedMode : "All";
    return ChaseState.modeFilter;
}

// Save mode filter selection to localStorage and update ChaseState
function saveGlobalModeFilter(mode) {
    ChaseState.modeFilter = mode;
    localStorage.setItem("chaseModeFilter", mode);
}

// Apply saved mode filter to UI dropdown and table rows
function applyGlobalModeFilter() {
    // Get the mode selector element
    const modeSelector = document.getElementById("mode-filter");
    if (modeSelector && ChaseState.modeFilter !== null) {
        modeSelector.value = ChaseState.modeFilter;
    }

    // Apply the filter to the current table
    applyTableFilters();
}

// Handle mode filter dropdown change event (saves and applies new filter)
function onModeFilterChange(mode) {
    saveGlobalModeFilter(mode);
    applyGlobalModeFilter();
}

// Load auto-refresh preference from localStorage
function loadAutoRefreshEnabled() {
    const saved = localStorage.getItem("chaseAutoRefreshEnabled");
    // Default to false (disabled) when no saved preference exists
    ChaseState.autoRefreshEnabled = saved !== null ? saved === "true" : false;
    return ChaseState.autoRefreshEnabled;
}

// Save auto-refresh preference to localStorage
function saveAutoRefreshEnabled(enabled) {
    ChaseState.autoRefreshEnabled = enabled;
    localStorage.setItem("chaseAutoRefreshEnabled", enabled.toString());
}

// ============================================================================
// Utility Functions
// ============================================================================

// Update the "Refreshed X ago" display or countdown for auto-refresh
function updateRefreshTimer() {
    const timerElement = document.getElementById("last-refresh-time");
    if (!timerElement) return;

    const now = Date.now();

    // Auto-refresh mode: show countdown
    if (ChaseState.autoRefreshEnabled && ChaseState.nextAutoRefreshTime > 0) {
        const remainingMs = ChaseState.nextAutoRefreshTime - now;

        if (remainingMs <= 0) {
            timerElement.textContent = "Auto-refreshing now...";
            return;
        }

        const remainingSeconds = Math.ceil(remainingMs / 1000);
        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = remainingSeconds % 60;

        if (minutes > 0) {
            timerElement.textContent = `Auto-refresh in ${minutes}:${seconds.toString().padStart(2, "0")}`;
        } else {
            timerElement.textContent = `Auto-refresh in ${seconds} sec`;
        }
        return;
    }

    // Manual mode: show time since last refresh
    if (ChaseState.lastRefreshCompleteTime === 0) {
        timerElement.textContent = "Refreshed 0:00 ago";
        return;
    }

    const elapsedSeconds = Math.floor((now - ChaseState.lastRefreshCompleteTime) / 1000);
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;

    timerElement.textContent = `Refreshed ${minutes}:${seconds.toString().padStart(2, "0")} ago`;
}

// Start the refresh timer interval
function startRefreshTimer() {
    // Clear any existing interval
    if (ChaseState.refreshTimerInterval) {
        clearInterval(ChaseState.refreshTimerInterval);
    }

    // Update immediately
    updateRefreshTimer();

    // Update every second
    ChaseState.refreshTimerInterval = setInterval(updateRefreshTimer, REFRESH_TIMER_UPDATE_INTERVAL_MS);
}

// Stop the refresh timer interval
function stopRefreshTimer() {
    if (ChaseState.refreshTimerInterval) {
        clearInterval(ChaseState.refreshTimerInterval);
        ChaseState.refreshTimerInterval = null;
    }
}

// Start auto-refresh mode
function startAutoRefresh() {
    ChaseState.autoRefreshEnabled = true;
    saveAutoRefreshEnabled(true);

    // Clear suggestion revert timeout since user accepted the suggestion
    if (ChaseState.suggestionRevertTimeoutId) {
        clearTimeout(ChaseState.suggestionRevertTimeoutId);
        ChaseState.suggestionRevertTimeoutId = null;
    }

    scheduleNextAutoRefresh();
    updateRefreshButtonLabel();
    updateRefreshTimer();
}

// Stop auto-refresh mode
function stopAutoRefresh() {
    ChaseState.autoRefreshEnabled = false;
    saveAutoRefreshEnabled(false);

    // Clear any pending auto-refresh timeout
    if (ChaseState.autoRefreshTimeoutId) {
        clearTimeout(ChaseState.autoRefreshTimeoutId);
        ChaseState.autoRefreshTimeoutId = null;
    }

    ChaseState.nextAutoRefreshTime = 0;

    // Clear manual refresh tracking to reset the suggestion trigger
    ChaseState.manualRefreshTimes = [];

    updateRefreshButtonLabel();
    updateRefreshTimer();
}

// Schedule the next auto-refresh
function scheduleNextAutoRefresh() {
    // Clear any existing timeout
    if (ChaseState.autoRefreshTimeoutId) {
        clearTimeout(ChaseState.autoRefreshTimeoutId);
        ChaseState.autoRefreshTimeoutId = null;
    }

    if (!ChaseState.autoRefreshEnabled) {
        return;
    }

    // Calculate next refresh time
    ChaseState.nextAutoRefreshTime = Date.now() + CHASE_AUTO_REFRESH_INTERVAL_MS;

    // Schedule the refresh
    ChaseState.autoRefreshTimeoutId = setTimeout(() => {
        Log.debug("Chase", "Auto-refresh triggered");
        refreshChaseJson(true, true); // force=true, isAutoRefresh=true
    }, CHASE_AUTO_REFRESH_INTERVAL_MS);

    updateRefreshTimer();
}

// getBandFromFrequency() is now defined in main.js

// Track manual refresh and determine if we should suggest auto-refresh
function trackManualRefresh() {
    const now = Date.now();

    // Add current refresh time
    ChaseState.manualRefreshTimes.push(now);

    // Remove refreshes outside the tracking window
    ChaseState.manualRefreshTimes = ChaseState.manualRefreshTimes.filter(
        (time) => now - time < CHASE_AUTO_SUGGEST_WINDOW_MS
    );

    // Check if we should suggest auto-refresh
    const shouldSuggest = ChaseState.manualRefreshTimes.length >= CHASE_AUTO_SUGGEST_THRESHOLD;

    // If we're now suggesting, set a timer to revert after 5 seconds
    if (shouldSuggest && !ChaseState.suggestionRevertTimeoutId) {
        // Only set the timeout if we don't already have one active
        Log.debug("Chase", "Setting 5-second revert timer for auto-refresh suggestion");
        ChaseState.suggestionRevertTimeoutId = setTimeout(() => {
            Log.debug("Chase", "Reverting auto-refresh suggestion");
            ChaseState.manualRefreshTimes = [];
            updateRefreshButtonLabel();
            ChaseState.suggestionRevertTimeoutId = null;
        }, AUTO_SUGGESTION_REVERT_TIMEOUT_MS);
    }

    return shouldSuggest;
}

// Update refresh button label based on current state
function updateRefreshButtonLabel() {
    const refreshButton = document.getElementById("refresh-button");
    if (!refreshButton) return;

    if (ChaseState.autoRefreshEnabled) {
        // Auto-refresh is enabled
        Log.debug("Chase", "Button state: Disable Auto-Refresh");
        refreshButton.textContent = "Disable Auto-Refresh";
        refreshButton.classList.add("btn-auto-refresh-active");
    } else if (shouldSuggestAutoRefresh()) {
        // Suggest enabling auto-refresh
        Log.debug("Chase", "Button state: Enable Auto-Refresh?");
        refreshButton.textContent = "Enable Auto-Refresh?";
        refreshButton.classList.remove("btn-auto-refresh-active");
    } else {
        // Normal manual refresh
        Log.debug("Chase", "Button state: Refresh Now");
        refreshButton.textContent = "Refresh Now";
        refreshButton.classList.remove("btn-auto-refresh-active");
    }
}

// Check if we should suggest auto-refresh (without modifying state)
function shouldSuggestAutoRefresh() {
    const now = Date.now();
    const recentRefreshes = ChaseState.manualRefreshTimes.filter((time) => now - time < CHASE_AUTO_SUGGEST_WINDOW_MS);
    return recentRefreshes.length >= CHASE_AUTO_SUGGEST_THRESHOLD;
}

// Tune radio to specified frequency (Hz) and mode (adjusts SSB sideband based on frequency)
async function tuneRadioHz(frequency, mode) {
    let useMode = mode.toUpperCase();
    if (useMode === "SSB") {
        if (frequency < LSB_USB_BOUNDARY_HZ) useMode = "LSB";
        else useMode = "USB";
    }

    // Open tune targets (WebSDR, KiwiSDR, etc.) - don't await, run in parallel
    openTuneTargets(frequency, useMode);

    try {
        const freqResponse = await fetch(`/api/v1/frequency?frequency=${frequency}`, { method: "PUT" });

        if (!freqResponse.ok) {
            Log.error("Chase", "Frequency update failed");
            return;
        }

        Log.debug("Chase", "Frequency updated:", frequency);

        const modeResponse = await fetch(`/api/v1/mode?bw=${useMode}`, { method: "PUT" });

        if (!modeResponse.ok) {
            Log.error("Chase", "Mode update failed");
            return;
        }

        Log.debug("Chase", "Mode updated:", useMode);

        // Update global VFO state and highlight matching row
        AppState.vfoFrequencyHz = frequency;
        AppState.vfoMode = useMode;
        AppState.vfoLastUpdated = Date.now();
        updateTunedRowHighlight();
    } catch (error) {
        Log.error("Chase", "Tune radio error:", error);
    }
}

// ============================================================================
// VFO Row Highlighting Functions
// ============================================================================

// Normalize radio mode for comparison with spot modeType
function normalizeRadioMode(mode) {
    if (!mode) return null;
    const m = mode.toUpperCase();
    if (m === "USB" || m === "LSB") return "SSB";
    return m;
}

// Check if radio mode is compatible with spot modeType
function modesCompatible(radioMode, spotModeType) {
    if (!radioMode || !spotModeType) return false;

    // Direct match (all data modes are now classified as "DATA")
    return radioMode === spotModeType;
}

// Update row highlighting based on current VFO frequency/mode
function updateTunedRowHighlight() {
    const vfoHz = AppState.vfoFrequencyHz;
    const vfoMode = AppState.vfoMode;

    // Clear all highlights if VFO state unknown
    if (!vfoHz || !vfoMode) {
        document.querySelectorAll("#chase-table tbody tr.tuned-row").forEach((row) => {
            row.classList.remove("tuned-row");
        });
        return;
    }

    const normalizedVfoMode = normalizeRadioMode(vfoMode);

    document.querySelectorAll("#chase-table tbody tr").forEach((row) => {
        const rowHz = parseInt(row.dataset.hertz, 10);
        const rowModeType = row.dataset.modeType;

        if (!rowHz || !rowModeType) {
            row.classList.remove("tuned-row");
            return;
        }

        const freqMatch = Math.abs(rowHz - vfoHz) <= VFO_FREQUENCY_TOLERANCE_HZ;
        const modeMatch = modesCompatible(normalizedVfoMode, rowModeType);

        if (freqMatch && modeMatch) {
            row.classList.add("tuned-row");
        } else {
            row.classList.remove("tuned-row");
        }
    });

    // Update Polo button state based on whether a spot is tuned
    updatePoloButtonState();
}

// ============================================================================
// Ham2K Polo Deep Link Integration
// ============================================================================
// Note: buildPoloDeepLink() and mapModeForPolo() are defined in main.js

// SOTA reference pattern for getSigFromReference
const CHASE_SOTA_REF_PATTERN = /^[A-Z0-9]{1,4}\/[A-Z]{2}-\d{3}$/;
// POTA reference pattern
const CHASE_POTA_REF_PATTERN = /^[A-Z]{1,2}-\d{4,5}$/;

// Derive sig from reference format (for user's own activation reference)
function getChaseUserSigFromReference(ref) {
    if (!ref) return null;
    if (CHASE_SOTA_REF_PATTERN.test(ref)) return "sota";
    if (CHASE_POTA_REF_PATTERN.test(ref)) return "pota";
    if (/^[A-Z]{2,4}FF-\d{4}$/i.test(ref)) return "wwff";
    return null;
}

// Valid Polo sig types (lowercase)
const VALID_POLO_SIGS = ["sota", "pota", "wwff", "gma", "wca", "zlota", "iota"];

// Check if a sig type is valid for Polo
function isValidPoloSig(sig) {
    if (!sig) return false;
    return VALID_POLO_SIGS.includes(sig.toLowerCase());
}

// Get data from the currently tuned row (if any)
function getTunedSpotData() {
    const tunedRow = document.querySelector("#chase-table tbody tr.tuned-row");
    if (!tunedRow) {
        Log.debug("Chase", "No tuned row found");
        return null;
    }

    const data = {
        activatorCallsign: tunedRow.dataset.activatorCallsign || "",
        locationId: tunedRow.dataset.locationId || "",
        sig: tunedRow.dataset.sig || "",
        hertz: parseInt(tunedRow.dataset.hertz, 10) || 0,
        modeType: tunedRow.dataset.modeType || "",
    };
    Log.debug("Chase", "Tuned spot data:", JSON.stringify(data));
    return data;
}

// Check if tuned spot is valid for Polo logging (has freq, mode, callsign)
function isTunedSpotValidForPolo() {
    const tunedSpot = getTunedSpotData();
    if (!tunedSpot) return false;

    // Must have frequency, mode, and callsign
    if (!tunedSpot.hertz || tunedSpot.hertz <= 0) return false;
    if (!tunedSpot.modeType) return false;
    if (!tunedSpot.activatorCallsign) return false;

    return true;
}

// Update Polo button enabled state based on whether a valid xOTA spot is tuned
function updatePoloButtonState() {
    const poloBtn = document.getElementById("polo-chase-button");
    if (!poloBtn) return;

    poloBtn.disabled = !isTunedSpotValidForPolo();
}

// Build Polo deep link for Chase page (their activation, optionally my activation for S2S)
function buildPoloChaseLink() {
    const tunedSpot = getTunedSpotData();
    if (!tunedSpot) {
        Log.debug("Chase", "buildPoloChaseLink: no tuned spot");
        return null;
    }

    // Their data from the tuned spot
    const theirCall = tunedSpot.activatorCallsign;
    const freq = tunedSpot.hertz;
    const mode = mapModeForPolo(tunedSpot.modeType);

    // Reference and sig are optional (only for x-OTA spots)
    const theirRef = tunedSpot.locationId && tunedSpot.locationId !== "-" ? tunedSpot.locationId : null;
    const theirSig = isValidPoloSig(tunedSpot.sig) ? tunedSpot.sig.toLowerCase() : null;

    // Check if user has their own activation reference (S2S/P2P scenario)
    const myRef = getLocationBasedReference() || "";
    const mySig = getChaseUserSigFromReference(myRef);

    const params = {
        theirCall: theirCall,
        theirRef: theirRef,
        theirSig: theirSig,
        freq: freq,
        mode: mode,
    };

    // Include user's activation reference if set (S2S/P2P)
    if (myRef && mySig) {
        params.myRef = myRef;
        params.mySig = mySig;
    }

    Log.info("Chase", "Polo params:", JSON.stringify(params));
    return buildPoloDeepLink(params);
}

// Launch Ham2K Polo app for logging chase QSO
function launchPoloChase() {
    const url = buildPoloChaseLink();
    if (url) {
        Log.info("Chase", "Launching Polo for chase:", url);
        // Use location.href for mobile deep link compatibility
        window.location.href = url;
    } else {
        Log.warn("Chase", "Cannot launch Polo - no valid xOTA spot tuned");
        alert("Cannot launch Polo - tune to a SOTA/POTA spot first");
    }
}

// ============================================================================
// Table Rendering
// ============================================================================

// Sort chase data in place by current sort field and direction
function sortChaseData(data) {
    data.sort((a, b) => {
        if (a[ChaseState.sortField] < b[ChaseState.sortField]) return ChaseState.descending ? 1 : -1;
        if (a[ChaseState.sortField] > b[ChaseState.sortField]) return ChaseState.descending ? -1 : 1;
        return 0;
    });
}

// Partition spots into user's own spots and others for pinning at top
// Handles prefixes (S5/KC6X) and suffixes (KC6X/P, KC6X/M)
function partitionMySpots(data, userCall) {
    if (!userCall) {
        return { mySpots: [], otherSpots: data };
    }

    const mySpots = [];
    const otherSpots = [];

    data.forEach((spot) => {
        const callParts = spot.activatorCallsign ? spot.activatorCallsign.toUpperCase().split("/") : [];
        if (callParts.includes(userCall)) {
            mySpots.push(spot);
        } else {
            otherSpots.push(spot);
        }
    });

    return { mySpots, otherSpots };
}

// Build reference link element based on spot type (SOTA, POTA, WWFF, ZLOTA)
function buildReferenceLink(spot) {
    if (spot.locationID === "-") {
        return document.createTextNode(spot.locationID);
    }

    const refLink = document.createElement("a");
    refLink.target = "_blank";
    refLink.textContent = spot.locationID;

    if (spot.sig === "SOTA") {
        refLink.href = `https://sotl.as/summits/${spot.locationID}`;
    } else if (spot.sig === "POTA") {
        refLink.href = `https://pota.app/#/park/${spot.locationID}`;
    } else if (spot.sig === "WWFF") {
        refLink.href = `https://wwff.co/directory/?showRef=${spot.locationID}`;
    } else if (spot.sig === "ZLOTA") {
        // Convert slash format (ZLP/WK-0503) to underscore format (ZLP_WK-0503) for URL
        const urlRef = spot.locationID.replace("/", "_");
        refLink.href = `https://ontheair.nz/assets/${urlRef}`;
    } else {
        // Cluster or other types without reference - just show text
        return document.createTextNode(spot.locationID);
    }

    return refLink;
}

// Build a single chase table row element
function buildChaseRow(spot, isMySpot) {
    const row = document.createElement("tr");
    const modeType = spot.modeType;

    // Add data attributes for VFO matching and Polo deep linking
    row.dataset.hertz = spot.hertz || 0;
    row.dataset.modeType = modeType;
    row.dataset.activatorCallsign = spot.activatorCallsign || "";
    row.dataset.locationId = spot.locationID || "";
    row.dataset.sig = spot.sig || "";

    // Add classes for filtering
    row.classList.add(`row-mode-${modeType}`);
    row.classList.add(`row-type-${spot.sig}`);

    // Add band class for band filtering
    const band = getBandFromFrequency(spot.hertz);
    if (band) {
        row.classList.add(`row-band-${band}`);
    }

    // Mark user's own spots with special class for frozen styling
    if (isMySpot) {
        row.classList.add("my-spot-row");
    }

    // Make entire row clickable to tune radio (except for links)
    row.classList.add("cursor-pointer");
    row.onclick = function (event) {
        if (event.target.tagName === "A" || event.target.closest("a")) {
            return; // Let the link handle it
        }
        if (spot.hertz && spot.hertz > 0) {
            tuneRadioHz(spot.hertz, spot.modeType);
        }
    };

    // 1. UTC time
    const formattedTime = `${spot.timestamp.getUTCHours().toString().padStart(2, "0")}:${spot.timestamp.getUTCMinutes().toString().padStart(2, "0")}`;
    row.insertCell().textContent = formattedTime;

    // 2. Callsign
    const callsignCell = row.insertCell();
    const callsignLink = document.createElement("a");
    callsignLink.href = `https://qrz.com/db/${spot.baseCallsign}`;
    callsignLink.target = "_blank";
    callsignLink.textContent = spot.activatorCallsign;
    callsignCell.appendChild(callsignLink);

    // 3. MHz Frequency (styled digits)
    const frequencyCell = row.insertCell();
    if (spot.hertz && typeof spot.hertz === "number") {
        const freqMHz = spot.hertz / 1000000;
        const [wholePart, fracPart] = freqMHz.toFixed(3).split(".");

        const wholeSpan = document.createElement("span");
        wholeSpan.className = "freq-whole";
        wholeSpan.textContent = wholePart;

        const fracSpan = document.createElement("span");
        fracSpan.className = "freq-frac";
        fracSpan.textContent = `.${fracPart}`;

        frequencyCell.appendChild(wholeSpan);
        frequencyCell.appendChild(fracSpan);

        // Add band coloring
        const freqBand = getBandFromFrequency(spot.hertz);
        if (freqBand) {
            frequencyCell.classList.add("band-cell", `band-${freqBand}`);
        }
    }

    // 4. Mode
    const modeCell = row.insertCell();
    modeCell.textContent = spot.mode.toUpperCase().trim();
    modeCell.classList.add("mode-cell");
    modeCell.classList.add(`mode-cell-${modeType}`);

    // 5. Type (xOTA program badge: SOTA/POTA/etc.)
    const typeCell = row.insertCell();
    const typeBadge = document.createElement("span");
    typeBadge.className = `type-badge type-badge-${spot.sig}`;
    typeBadge.textContent = spot.sig;
    typeCell.appendChild(typeBadge);

    // 6. Reference (with appropriate link based on type)
    const refCell = row.insertCell();
    refCell.appendChild(buildReferenceLink(spot));

    // 7. Distance
    row.insertCell().textContent = spot.distance.toLocaleString();

    // 8. Details
    row.insertCell().textContent = spot.details;

    // 9. Comments
    row.insertCell().textContent = spot.comments;

    return row;
}

// Update chase table display with sorted spots from AppState.latestChaseJson
async function updateChaseTable() {
    const data = await AppState.latestChaseJson;
    if (data === null) {
        Log.info("Chase", "Json is null");
        return;
    }

    sortChaseData(data);

    const userCall = AppState.callSign ? AppState.callSign.toUpperCase() : "";
    const { mySpots, otherSpots } = partitionMySpots(data, userCall);
    const orderedData = [...mySpots, ...otherSpots];

    const tbody = document.querySelector("#chase-table tbody");
    const newTbody = document.createElement("tbody");

    orderedData.forEach((spot, index) => {
        const isMySpot = index < mySpots.length;
        const row = buildChaseRow(spot, isMySpot);
        newTbody.appendChild(row);
    });

    tbody.parentNode.replaceChild(newTbody, tbody);
    Log.info("Chase", "table updated");

    setTimeout(applyTableFilters, 0);

    // Highlight row matching current VFO frequency/mode
    updateTunedRowHighlight();
}

// ============================================================================
// Filtering
// ============================================================================

// Apply mode and type filters to table rows, showing/hiding as needed
function applyTableFilters() {
    const tableBody = document.querySelector("#chase-table tbody");
    if (!tableBody) {
        Log.warn("Chase", "Table body not found, cannot apply filters");
        return;
    }

    const allRows = tableBody.querySelectorAll("tr");
    if (allRows.length === 0) {
        Log.warn("Chase", "No rows in table, skipping filter application");
        return;
    }

    // Get current filter settings
    const selectedMode = ChaseState.modeFilter || "All";
    const selectedType = ChaseState.typeFilter || "All";

    // Get band filter state - only filter if enabled AND we have a valid radio type
    let allowedBands = null;
    if (AppState.filterBandsEnabled && AppState.radioType) {
        allowedBands = getRadioBandCapabilities(AppState.radioType);
    }

    Log.debug("Chase", `Applying filters - Mode: ${selectedMode}, Type: ${selectedType}, BandFilter: ${allowedBands ? "active" : "off"}, Rows: ${allRows.length}`);

    let visibleRows = 0;
    let hiddenRows = 0;

    allRows.forEach((row) => {
        // Check filters
        let modeMatch = false;
        let typeMatch = false;

        // Mode filter
        if (selectedMode === "All") {
            modeMatch = true;
        } else if (selectedMode === "SSB+CW") {
            modeMatch = row.classList.contains("row-mode-SSB") || row.classList.contains("row-mode-CW");
        } else {
            modeMatch = row.classList.contains(`row-mode-${selectedMode}`);
        }

        // Type filter
        if (selectedType === "All") {
            typeMatch = true;
        } else if (selectedType === "xOTA") {
            // Show all xOTA spots (SOTA, POTA, WWFF, GMA, IOTA, WCA, etc.) but NOT Cluster
            typeMatch = !row.classList.contains("row-type-Cluster");
        } else if (selectedType === "Cluster") {
            // Show only DX cluster spots (non-xOTA)
            typeMatch = row.classList.contains("row-type-Cluster");
        } else {
            // Specific type (SOTA, POTA, WWFF, GMA, IOTA, WCA)
            typeMatch = row.classList.contains(`row-type-${selectedType}`);
        }

        // Band filter - check if spot's band is in the allowed bands list
        let bandMatch = true;
        if (allowedBands !== null) {
            // Find the band class on this row
            const bandClass = Array.from(row.classList).find(c => c.startsWith('row-band-'));
            if (bandClass) {
                const band = bandClass.replace('row-band-', '');
                bandMatch = allowedBands.includes(band);
            }
            // If no band class found, show the row (graceful degradation for unknown frequencies)
        }

        // Show row only if ALL filters match
        if (modeMatch && typeMatch && bandMatch) {
            row.classList.remove("hidden");
            // Apply alternating row background based on visible row index
            row.classList.toggle("even-row", visibleRows % 2 === 1);
            visibleRows++;
        } else {
            row.classList.add("hidden");
            row.classList.remove("even-row");
            hiddenRows++;
        }
    });

    Log.debug("Chase", `Filter applied: ${visibleRows} visible, ${hiddenRows} hidden`);
}

// ============================================================================
// Sorting
// ============================================================================

// Update visual sort indicators on table headers (shows ascending/descending arrows)
function updateSortIndicators(headers, sortField, descending) {
    headers.forEach((header) => {
        const span = header.querySelector("span[data-sort-field]");
        if (span && span.getAttribute("data-sort-field") === sortField) {
            span.setAttribute("data-sort-dir", descending ? "desc" : "asc");
        } else if (span) {
            span.removeAttribute("data-sort-dir");
        }
    });
}

// ============================================================================
// Data Fetching
// ============================================================================

// Fetch latest spot data from Spothole API with rate limiting (force=true bypasses rate limit)
async function refreshChaseJson(force, isAutoRefresh = false) {
    // Get refresh button for UI feedback
    const refreshButton = document.getElementById("refresh-button");

    // Track manual refreshes for smart suggestions (but not auto-refreshes)
    if (!isAutoRefresh) {
        const nowSuggestingAutoRefresh = trackManualRefresh();
        // Update button label if we just hit the threshold
        if (nowSuggestingAutoRefresh) {
            updateRefreshButtonLabel();
        }
    }

    // Check rate limit
    const now = Date.now();
    const timeSinceLastFetch = now - ChaseState.lastRefreshTime;

    if (!force && timeSinceLastFetch < CHASE_MIN_REFRESH_INTERVAL_MS) {
        Log.info("Chase", `rate limit: Skipping fetch, only ${Math.round(timeSinceLastFetch / 1000)}s since last fetch (min 60s)`);
        if (typeof updateChaseTable === "function") {
            updateChaseTable();
        }
        return;
    }

    try {
        // Set button to refreshing state
        if (refreshButton) {
            refreshButton.textContent = "Refreshing...";
            refreshButton.disabled = true;
        }

        Log.debug("Chase", "Fetching data from Spothole API");
        ChaseState.lastRefreshTime = Date.now();

        // Build fetch options
        // NOTE: Always fetch all spots from Spothole API regardless of UI filters.
        // Filtering is done client-side in applyTableFilters() for better UX
        // (allows users to toggle filters without re-fetching data).
        const fetchOptions = {
            max_age: CHASE_HISTORY_DURATION_SECONDS,
            limit: CHASE_API_SPOT_LIMIT,
            dedupe: true,
        };

        // Get user location
        const location = await getLocation();

        // Fetch and process spots
        const spots = await fetchAndProcessSpots(fetchOptions, location, true);

        AppState.latestChaseJson = spots;
        Log.info("Chase", `Json updated: ${spots.length} spots`);

        if (typeof updateChaseTable === "function") {
            updateChaseTable();
        } else {
            Log.error("Chase", "updateChaseTable function not found");
        }

        // Update refresh complete time and restart timer
        ChaseState.lastRefreshCompleteTime = Date.now();
        startRefreshTimer();

        // If auto-refresh is enabled, schedule the next refresh
        if (ChaseState.autoRefreshEnabled) {
            scheduleNextAutoRefresh();
        }
    } catch (error) {
        Log.error("Chase", "Error fetching or processing data:", error);
        // Show error to user if this was a manual refresh
        if (force && !isAutoRefresh) {
            alert("Failed to fetch spots from Spothole API. Please check your internet connection and try again.");
        }

        // If auto-refresh is enabled, schedule retry
        if (ChaseState.autoRefreshEnabled) {
            scheduleNextAutoRefresh();
        }
    } finally {
        // Restore button to original state
        if (refreshButton) {
            updateRefreshButtonLabel();
            refreshButton.disabled = false;
        }
    }
}

// ============================================================================
// Event Handler Attachment
// ============================================================================

// Attach all Chase page event listeners
function attachChaseEventListeners() {
    // Only attach once to prevent memory leaks
    if (ChaseState.chaseEventListenersAttached) {
        return;
    }
    ChaseState.chaseEventListenersAttached = true;

    const refreshButton = document.getElementById("refresh-button");
    if (refreshButton) {
        refreshButton.addEventListener("click", () => {
            if (ChaseState.autoRefreshEnabled) {
                // Currently in auto-refresh mode - turn it off
                stopAutoRefresh();
            } else if (shouldSuggestAutoRefresh()) {
                // Suggesting auto-refresh - turn it on
                startAutoRefresh();
                // Also do an immediate refresh
                refreshChaseJson(true);
            } else {
                // Normal manual refresh
                refreshChaseJson(true);
            }
        });
    }

    // Update button label to reflect current state
    updateRefreshButtonLabel();

    // Transmit toggle button
    const xmitBtn = document.getElementById("xmit-button");
    if (xmitBtn) {
        xmitBtn.addEventListener("click", toggleXmit);
    }

    // Polo chase button
    const poloChaseBtn = document.getElementById("polo-chase-button");
    if (poloChaseBtn) {
        poloChaseBtn.addEventListener("click", launchPoloChase);
    }

    // Load all saved settings
    loadSortState();

    // Load and apply filters
    loadGlobalModeFilter();
    loadTypeFilter();

    const modeSelector = document.getElementById("mode-filter");
    if (modeSelector) {
        modeSelector.onchange = function () {
            onModeFilterChange(this.value);
        };
    }

    const typeSelector = document.getElementById("type-filter");
    if (typeSelector) {
        typeSelector.onchange = function () {
            onTypeFilterChange(this.value);
        };
    }

    // Set up column sorting
    const headers = document.querySelectorAll("#chase-table th");
    headers.forEach((header) => {
        const sortSpan = header.querySelector("span[data-sort-field]");
        if (sortSpan) {
            header.replaceWith(header.cloneNode(true));
            const newHeader = document
                .querySelector(
                    `#chase-table th span[data-sort-field='${sortSpan.getAttribute("data-sort-field")}']`
                )
                .closest("th");

            newHeader.addEventListener("click", function () {
                const clickedSortField = sortSpan.getAttribute("data-sort-field");
                if (clickedSortField === ChaseState.lastSortField) {
                    ChaseState.descending = !ChaseState.descending;
                } else {
                    ChaseState.lastSortField = clickedSortField;
                    ChaseState.descending = true;
                }
                ChaseState.sortField = clickedSortField;
                saveSortState();
                updateSortIndicators(
                    document.querySelectorAll("#chase-table th"),
                    ChaseState.sortField,
                    ChaseState.descending
                );
                updateChaseTable();
            });
        }
    });
}

// ============================================================================
// Page Lifecycle
// ============================================================================

// Called when Chase tab becomes visible
async function onChaseAppearing() {
    Log.info("Chase", "tab appearing");

    // Load callsign for spot pinning (non-blocking)
    ensureCallSignLoaded();

    // Load radio type and filter settings for band filtering
    await loadRadioType();
    loadFilterBandsSetting();

    // Subscribe to VFO changes and start polling for row highlighting
    subscribeToVfo(updateTunedRowHighlight);
    startGlobalVfoPolling();

    // Start the refresh timer
    startRefreshTimer();

    // Load auto-refresh preference
    loadAutoRefreshEnabled();

    // Attach event listeners for all controls
    attachChaseEventListeners();

    // Sync xmit button state with global state
    syncXmitButtonState();

    // Set filter dropdown values (do this every time for state consistency)
    const modeSelector = document.getElementById("mode-filter");
    if (modeSelector) {
        modeSelector.value = ChaseState.modeFilter;
    }

    const typeSelector = document.getElementById("type-filter");
    if (typeSelector) {
        typeSelector.value = ChaseState.typeFilter;
    }

    // Load data
    if (AppState.latestChaseJson !== null) {
        Log.debug("Chase", "tab appearing: Using existing data");
        updateChaseTable();
    } else {
        Log.debug("Chase", "tab appearing: Fetching new data");
        refreshChaseJson(true);
    }

    // If auto-refresh was enabled, resume it (it was paused when leaving tab)
    if (ChaseState.autoRefreshEnabled) {
        scheduleNextAutoRefresh();
    }

    updateSortIndicators(document.querySelectorAll("#chase-table th"), ChaseState.sortField, ChaseState.descending);
}

// Called when Chase tab is hidden
function onChaseLeaving() {
    Log.info("Chase", "tab leaving");

    // Unsubscribe from VFO changes (this also stops polling if no other subscribers)
    unsubscribeFromVfo(updateTunedRowHighlight);

    // Stop the refresh timer display
    stopRefreshTimer();

    // Pause auto-refresh while away (but remember the state)
    if (ChaseState.autoRefreshTimeoutId) {
        clearTimeout(ChaseState.autoRefreshTimeoutId);
        ChaseState.autoRefreshTimeoutId = null;
        ChaseState.nextAutoRefreshTime = 0;
    }
    // Note: autoRefreshEnabled flag stays set, preserved in localStorage

    // Clear suggestion revert timeout
    if (ChaseState.suggestionRevertTimeoutId) {
        clearTimeout(ChaseState.suggestionRevertTimeoutId);
        ChaseState.suggestionRevertTimeoutId = null;
    }

    // Save all settings
    saveSortState();

    // Reset event listener flag so they can be reattached when returning to this tab
    // (necessary because DOM is recreated on each tab switch)
    ChaseState.chaseEventListenersAttached = false;
}
