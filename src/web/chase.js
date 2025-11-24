// ============================================================================
// Chase Page Logic
// ============================================================================
// Unified page for tracking SOTA, POTA, and other xOTA spots via Spothole API

// Configuration constants - adjust these to change behavior
const CHASE_HISTORY_DURATION_SECONDS = 3600; // 1 hour (3600 seconds)
const CHASE_DEFAULT_MODE_FILTER = "SSB"; // Default mode filter
const CHASE_API_SPOT_LIMIT = 500; // Maximum number of spots to fetch from API
const CHASE_MIN_REFRESH_INTERVAL_MS = 60000; // Minimum time between API calls (60 seconds)
const CHASE_AUTO_REFRESH_INTERVAL_MS = 60000; // Auto-refresh interval (60 seconds)
const CHASE_AUTO_SUGGEST_THRESHOLD = 3; // Number of manual refreshes to suggest auto-refresh
const CHASE_AUTO_SUGGEST_WINDOW_MS = 300000; // Time window to track refreshes (5 minutes)
const REFRESH_TIMER_UPDATE_INTERVAL_MS = 1000; // Update refresh timer every second
const AUTO_SUGGESTION_REVERT_TIMEOUT_MS = 5000; // Auto-suggestion revert delay

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
    const savedMode = localStorage.getItem("globalModeFilter");
    ChaseState.modeFilter = savedMode !== null ? savedMode : "All";
    return ChaseState.modeFilter;
}

// Save mode filter selection to localStorage and update ChaseState
function saveGlobalModeFilter(mode) {
    ChaseState.modeFilter = mode;
    localStorage.setItem("globalModeFilter", mode);
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
    ChaseState.autoRefreshEnabled = saved === "true";
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

// Update the "Last refresh X ago" display or countdown for auto-refresh
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
        timerElement.textContent = "Last refresh 0:00 ago";
        return;
    }

    const elapsedSeconds = Math.floor((now - ChaseState.lastRefreshCompleteTime) / 1000);
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;

    timerElement.textContent = `Last refresh ${minutes}:${seconds.toString().padStart(2, "0")} ago`;
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
        console.log("Auto-refresh triggered");
        refreshChaseJson(true, true); // force=true, isAutoRefresh=true
    }, CHASE_AUTO_REFRESH_INTERVAL_MS);

    updateRefreshTimer();
}

// Determine amateur band from frequency in Hz (returns '160m', '40m', '20m', etc., or null)
function getFrequencyBand(frequencyHz) {
    const freqMHz = frequencyHz / 1000000;

    if (freqMHz >= 1.8 && freqMHz <= 2.0) return "160m";
    if (freqMHz >= 3.5 && freqMHz <= 4.0) return "80m";
    if (freqMHz >= 5.3 && freqMHz <= 5.4) return "60m";
    if (freqMHz >= 7.0 && freqMHz <= 7.3) return "40m";
    if (freqMHz >= 10.1 && freqMHz <= 10.15) return "30m";
    if (freqMHz >= 14.0 && freqMHz <= 14.35) return "20m";
    if (freqMHz >= 18.068 && freqMHz <= 18.168) return "17m";
    if (freqMHz >= 21.0 && freqMHz <= 21.45) return "15m";
    if (freqMHz >= 24.89 && freqMHz <= 24.99) return "12m";
    if (freqMHz >= 28.0 && freqMHz <= 29.7) return "10m";
    if (freqMHz >= 50.0 && freqMHz <= 54.0) return "6m";
    if (freqMHz >= 144.0 && freqMHz <= 148.0) return "2m";
    if (freqMHz >= 420.0 && freqMHz <= 450.0) return "70cm";
    if (freqMHz >= 1240.0 && freqMHz <= 1300.0) return "23cm";

    // Return null for frequencies outside amateur bands
    return null;
}

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
        console.log("Setting 5-second revert timer for auto-refresh suggestion");
        ChaseState.suggestionRevertTimeoutId = setTimeout(() => {
            console.log('Reverting auto-refresh suggestion back to "Refresh Now"');
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
        console.log("Button state: Disable Auto-Refresh");
        refreshButton.textContent = "Disable Auto-Refresh";
        refreshButton.classList.add("btn-auto-refresh-active");
    } else if (shouldSuggestAutoRefresh()) {
        // Suggest enabling auto-refresh
        console.log("Button state: Enable Auto-Refresh?");
        refreshButton.textContent = "Enable Auto-Refresh?";
        refreshButton.classList.remove("btn-auto-refresh-active");
    } else {
        // Normal manual refresh
        console.log("Button state: Refresh Now");
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
function tuneRadioHz(frequency, mode) {
    let useMode = mode.toUpperCase();
    if (useMode == "SSB") {
        if (frequency < 10000000) useMode = "LSB";
        else useMode = "USB";
    }

    fetch(`/api/v1/frequency?frequency=${frequency}`, { method: "PUT" })
        .then((response) => {
            if (response.ok) {
                console.log("Frequency updated successfully");
                fetch(`/api/v1/mode?bw=${useMode}`, { method: "PUT" })
                    .then((response) => {
                        if (response.ok) {
                            console.log("Mode updated successfully");
                        } else {
                            console.error("Error updating mode");
                        }
                    })
                    .catch((error) => console.error("Fetch error:", error));
            } else {
                console.error("Error updating frequency");
            }
        })
        .catch((error) => console.error("Fetch error:", error));
}

// ============================================================================
// Table Rendering
// ============================================================================

// Update chase table display with sorted spots from AppState.latestChaseJson
async function updateChaseTable() {
    const data = await AppState.latestChaseJson;
    if (data == null) {
        console.info("Chase Json is null");
        return;
    }

    data.sort((a, b) => {
        if (a[ChaseState.sortField] < b[ChaseState.sortField]) return ChaseState.descending ? 1 : -1;
        if (a[ChaseState.sortField] > b[ChaseState.sortField]) return ChaseState.descending ? -1 : 1;
        return 0;
    });

    const tbody = document.querySelector("#chase-table tbody");
    const newTbody = document.createElement("tbody");

    data.forEach((spot) => {
        const row = newTbody.insertRow();
        const modeType = spot.modeType;

        // Add classes for filtering
        row.classList.add(`row-mode-${modeType}`);
        row.classList.add(`row-type-${spot.sig}`); // Type-based class for filtering

        // Make entire row clickable to tune radio (except for links)
        row.style.cursor = "pointer";
        row.onclick = function (event) {
            // Don't tune if user clicked on a link (Call or Ref columns)
            if (event.target.tagName === "A" || event.target.closest("a")) {
                return; // Let the link handle it
            }
            // Tune the radio
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

        // 3. MHz Frequency (styled digits, row click tunes radio)
        const frequencyCell = row.insertCell();
        if (spot.hertz && typeof spot.hertz === "number") {
            const freqMHz = spot.hertz / 1000000;
            const [wholePart, fracPart] = freqMHz.toFixed(3).split(".");

            // Create styled frequency display with emphasis on MHz part
            const wholeSpan = document.createElement("span");
            wholeSpan.className = "freq-whole";
            wholeSpan.textContent = wholePart;

            const fracSpan = document.createElement("span");
            fracSpan.className = "freq-frac";
            fracSpan.textContent = `.${fracPart}`;

            frequencyCell.appendChild(wholeSpan);
            frequencyCell.appendChild(fracSpan);

            // Add band coloring
            const band = getFrequencyBand(spot.hertz);
            if (band) {
                frequencyCell.classList.add("band-cell", `band-${band}`);
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

        // Generate appropriate link based on sig type
        if (spot.sig === "SOTA" && spot.locationID !== "-") {
            const refLink = document.createElement("a");
            refLink.href = `https://sotl.as/summits/${spot.locationID}`;
            refLink.target = "_blank";
            refLink.textContent = spot.locationID;
            refCell.appendChild(refLink);
        } else if (spot.sig === "POTA" && spot.locationID !== "-") {
            const refLink = document.createElement("a");
            refLink.href = `https://pota.app/#/park/${spot.locationID}`;
            refLink.target = "_blank";
            refLink.textContent = spot.locationID;
            refCell.appendChild(refLink);
        } else if (spot.sig === "WWFF" && spot.locationID !== "-") {
            const refLink = document.createElement("a");
            refLink.href = `https://wwff.co/directory/?showRef=${spot.locationID}`;
            refLink.target = "_blank";
            refLink.textContent = spot.locationID;
            refCell.appendChild(refLink);
        } else if (spot.sig === "ZLOTA" && spot.locationID !== "-") {
            const refLink = document.createElement("a");
            // Convert slash format (ZLP/WK-0503) to underscore format (ZLP_WK-0503) for URL
            const urlRef = spot.locationID.replace("/", "_");
            refLink.href = `https://ontheair.nz/assets/${urlRef}`;
            refLink.target = "_blank";
            refLink.textContent = spot.locationID;
            refCell.appendChild(refLink);
        } else {
            // Cluster or other types without reference - just show text (or dash)
            refCell.textContent = spot.locationID;
        }

        // 7. Distance
        row.insertCell().textContent = spot.distance.toLocaleString();

        // 8. Details
        row.insertCell().textContent = spot.details;

        // 9. Comments
        row.insertCell().textContent = spot.comments;
    });

    tbody.parentNode.replaceChild(newTbody, tbody);
    console.info("Chase table updated");

    setTimeout(applyTableFilters, 0);
}

// ============================================================================
// Filtering
// ============================================================================

// Apply mode and type filters to table rows, showing/hiding as needed
function applyTableFilters() {
    const tableBody = document.querySelector("#chase-table tbody");
    if (!tableBody) {
        console.warn("Chase table body not found, cannot apply filters");
        return;
    }

    const allRows = tableBody.querySelectorAll("tr");
    if (allRows.length === 0) {
        console.warn("No rows in Chase table, skipping filter application");
        return;
    }

    // Get current filter settings
    const selectedMode = ChaseState.modeFilter || "All";
    const selectedType = ChaseState.typeFilter || "All";

    console.log(`Applying Chase filters - Mode: ${selectedMode}, Type: ${selectedType}, Rows: ${allRows.length}`);

    let visibleRows = 0;
    let hiddenRows = 0;

    allRows.forEach((row) => {
        // Check filters
        let modeMatch = false;
        let typeMatch = false;

        // Mode filter
        if (selectedMode === "All") {
            modeMatch = true;
        } else if (selectedMode === "DATA") {
            modeMatch =
                row.classList.contains("row-mode-DATA") ||
                row.classList.contains("row-mode-FT8") ||
                row.classList.contains("row-mode-FT4");
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

        // Show row only if ALL filters match
        if (modeMatch && typeMatch) {
            row.style.display = "";
            // Apply alternating row background based on visible row index
            row.classList.toggle("even-row", visibleRows % 2 === 1);
            visibleRows++;
        } else {
            row.style.display = "none";
            row.classList.remove("even-row");
            hiddenRows++;
        }
    });

    console.log(`Chase filter applied: ${visibleRows} visible rows, ${hiddenRows} hidden rows`);
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
    const originalText = refreshButton?.textContent;

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
        console.info(
            `Chase rate limit: Skipping fetch, only ${Math.round(timeSinceLastFetch / 1000)}s since last fetch (min 60s)`
        );
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
            refreshButton.classList.add("btn-disabled");
        }

        console.log("Fetching Chase data from Spothole API");
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
        console.info(`Chase Json updated: ${spots.length} spots`);

        if (typeof updateChaseTable === "function") {
            updateChaseTable();
        } else {
            console.error("updateChaseTable function not found");
        }

        // Update refresh complete time and restart timer
        ChaseState.lastRefreshCompleteTime = Date.now();
        startRefreshTimer();

        // If auto-refresh is enabled, schedule the next refresh
        if (ChaseState.autoRefreshEnabled) {
            scheduleNextAutoRefresh();
        }
    } catch (error) {
        console.error("Error fetching or processing Chase data:", error);
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
            refreshButton.classList.remove("btn-disabled");
        }
    }
}

// ============================================================================
// Page Lifecycle
// ============================================================================

// Called when Chase tab becomes visible
function onChaseAppearing() {
    console.info("Chase tab appearing");

    // Start the refresh timer
    startRefreshTimer();

    // Load auto-refresh preference
    loadAutoRefreshEnabled();

    // Attach refresh button event listener (only once to prevent memory leaks)
    if (!ChaseState.chaseEventListenersAttached) {
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

        // Load all saved settings
        loadSortState();

        // Load and apply filters
        loadGlobalModeFilter();

        // Override with Chase default if not set
        if (!ChaseState.modeFilter || ChaseState.modeFilter === "All") {
            ChaseState.modeFilter = CHASE_DEFAULT_MODE_FILTER;
        }

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
    if (AppState.latestChaseJson != null) {
        console.log("Chase tab appearing: Using existing data");
        updateChaseTable();
    } else {
        console.log("Chase tab appearing: Fetching new data");
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
    console.info("Chase tab leaving");

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
}
