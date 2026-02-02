// ============================================================================
// About Page Logic
// ============================================================================
// Handles display of build version and device information

// ============================================================================
// Version Display
// ============================================================================

// Parse version string (e.g. "K5EM_1:260201:2327-R") into human-readable parts.
// Format: {HARDWARE}_{VER}:{YYMMDD}:{HHMM}-{TYPE}
// Returns { hardware, buildDate, buildType } or null if unparseable.
function parseVersionString(versionStr) {
    if (!versionStr || typeof versionStr !== "string") return null;
    const s = versionStr.trim();
    const match = s.match(/^([^:]+):(\d{6}):(\d{4})-([RD])$/);
    if (!match) return null;
    const [, hwPart, yyMMdd, hhMM, typeCode] = match;

    // Hardware: "K5EM_1" -> "K5EM version 1"
    let hardware = hwPart;
    const underscoreIdx = hwPart.lastIndexOf("_");
    if (underscoreIdx > 0) {
        const name = hwPart.slice(0, underscoreIdx);
        const ver = hwPart.slice(underscoreIdx + 1);
        hardware = `${name} version ${ver}`;
    }

    // Date: "260201" (YYMMDD) -> "2026-02-01"
    const yy = parseInt(yyMMdd.slice(0, 2), 10);
    const century = yy >= 50 ? 1900 : 2000;
    const year = century + yy;
    const month = yyMMdd.slice(2, 4);
    const day = yyMMdd.slice(4, 6);
    const buildDate = `${year}-${month}-${day}`;

    // Time: "2327" (HHMM) -> "23:27"
    const buildTime = `${hhMM.slice(0, 2)}:${hhMM.slice(2, 4)}`;

    // Type: "R" -> "Release", "D" -> "Debug"
    const buildType = typeCode === "R" ? "Release" : "Debug";

    return {
        hardware,
        buildDate: `${buildDate}  ${buildTime}`,
        buildType,
    };
}

// Fetch and display current firmware build version (raw string + parsed details)
async function refreshVersion() {
    const versionEl = document.getElementById("build-version");
    const detailsEl = document.getElementById("build-version-details");
    if (!versionEl || !detailsEl) return;
    detailsEl.hidden = true;

    try {
        const response = await fetch("/api/v1/version");
        if (!response.ok) {
            if (response.status === 404) {
                versionEl.textContent = "";
                detailsEl.classList.add("version-details-hidden");
                detailsEl.hidden = true;
                return;
            }
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const text = await response.text();
        versionEl.textContent = text;

        const parsed = parseVersionString(text);
        if (parsed) {
            const hwEl = document.getElementById("build-hardware");
            const dateEl = document.getElementById("build-date");
            const typeEl = document.getElementById("build-type");
            if (hwEl) hwEl.textContent = parsed.hardware;
            if (dateEl) dateEl.textContent = parsed.buildDate;
            if (typeEl) typeEl.textContent = parsed.buildType;
            detailsEl.classList.remove("version-details-hidden");
            detailsEl.hidden = false;
        } else {
            detailsEl.classList.add("version-details-hidden");
            detailsEl.hidden = true;
        }
    } catch (error) {
        versionEl.textContent = "??";
        detailsEl.classList.add("version-details-hidden");
        detailsEl.hidden = true;
    }
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
