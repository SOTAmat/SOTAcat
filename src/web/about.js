// ============================================================================
// About Page Logic
// ============================================================================
// Handles display of build version and device information

// ============================================================================
// Version Display
// ============================================================================

// Fetch and display current firmware build version
function refreshVersion() {
    if (isLocalhost) return;
    fetchAndUpdateElement("/api/v1/version", "build-version");
}

// ============================================================================
// Page Lifecycle
// ============================================================================

// Called when About tab becomes visible
function onAboutAppearing() {
    refreshVersion();
}

// Called when About tab is hidden
function onAboutLeaving() {
    // No special cleanup needed for the About tab
}
