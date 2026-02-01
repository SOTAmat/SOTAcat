// SOTAcat Geolocation Bridge
// This page runs on HTTPS to access browser geolocation, then redirects
// back to SOTAcat (HTTP) with the coordinates.

(function () {
    "use strict";

    // Parse URL parameters
    const params = new URLSearchParams(window.location.search);
    const returnPath = params.get("returnpath");

    // Validate returnpath is a safe destination (sotacat.local or private IP)
    function isValidReturnPath(path) {
        if (!path) return false;
        try {
            const url = new URL(path);
            const hostname = url.hostname.toLowerCase();

            // Allow sotacat.local (mDNS)
            if (hostname === "sotacat.local") return true;

            // Allow private IP ranges: 192.168.x.x, 10.x.x.x, 172.16-31.x.x
            const privateIPPattern =
                /^(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;
            if (privateIPPattern.test(hostname)) return true;

            // Allow localhost for testing
            if (hostname === "localhost" || hostname === "127.0.0.1") return true;

            return false;
        } catch (e) {
            return false;
        }
    }

    // Update status display
    function updateStatus(html, type) {
        const status = document.getElementById("status");
        status.className = "status " + type;
        status.innerHTML = html;
    }

    // Show action buttons
    function showActions() {
        document.getElementById("actions").classList.add("visible");
    }

    // Hide action buttons
    function hideActions() {
        document.getElementById("actions").classList.remove("visible");
    }

    // Build redirect URL with coordinates
    function buildRedirectUrl(lat, lon, accuracy) {
        const separator = returnPath.includes("?") ? "&" : "?";
        return `${returnPath}${separator}geo_lat=${lat}&geo_lon=${lon}&geo_accuracy=${accuracy}`;
    }

    // Build redirect URL with error
    function buildErrorRedirectUrl(code, message) {
        const separator = returnPath.includes("?") ? "&" : "?";
        return `${returnPath}${separator}geo_error=${code}&geo_message=${encodeURIComponent(message)}`;
    }

    // Redirect with location data
    function redirectWithLocation(lat, lon, accuracy) {
        if (!isValidReturnPath(returnPath)) {
            updateStatus("<p>Invalid return path. Cannot redirect.</p>", "error");
            return;
        }

        const latStr = lat.toFixed(6);
        const lonStr = lon.toFixed(6);
        const accStr = Math.round(accuracy);

        updateStatus(
            `<p>Location acquired!</p>` +
                `<div class="coords">${latStr}, ${lonStr}</div>` +
                `<p style="font-size: 13px; color: #666; margin-top: 8px;">Accuracy: ~${accStr}m</p>` +
                `<p>Redirecting to SOTAcat...</p>`,
            "success"
        );

        // Brief delay to show success, then redirect
        setTimeout(function () {
            window.location.href = buildRedirectUrl(latStr, lonStr, accStr);
        }, 800);
    }

    // Redirect with error info
    function redirectWithError(code, message) {
        if (!isValidReturnPath(returnPath)) {
            updateStatus(`<p>${message}</p>`, "error");
            showActions();
            return;
        }

        window.location.href = buildErrorRedirectUrl(code, message);
    }

    // Request geolocation
    function requestLocation() {
        hideActions();

        // Check for returnpath first
        if (!returnPath) {
            updateStatus(
                "<p>Missing return path parameter.</p>" +
                    "<p style='font-size: 13px; color: #666;'>This page should be opened from SOTAcat.</p>",
                "error"
            );
            return;
        }

        if (!isValidReturnPath(returnPath)) {
            updateStatus(
                "<p>Invalid return path.</p>" +
                    "<p style='font-size: 13px; color: #666;'>Return path must be sotacat.local or a private IP address.</p>",
                "error"
            );
            return;
        }

        // Check for geolocation support
        if (!navigator.geolocation) {
            updateStatus("<p>Geolocation is not supported by your browser.</p>", "error");
            showActions();
            return;
        }

        // Show pending state
        updateStatus('<div class="spinner"></div><p>Requesting location access...</p>', "pending");

        // Request position
        navigator.geolocation.getCurrentPosition(
            // Success
            function (position) {
                redirectWithLocation(position.coords.latitude, position.coords.longitude, position.coords.accuracy);
            },
            // Error
            function (error) {
                var message;
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        message = "Location permission denied. Please enable location access in your browser settings.";
                        break;
                    case error.POSITION_UNAVAILABLE:
                        message = "Location unavailable. Ensure location services are enabled on your device.";
                        break;
                    case error.TIMEOUT:
                        message = "Location request timed out. Please try again.";
                        break;
                    default:
                        message = "Could not determine location.";
                }
                updateStatus("<p>" + message + "</p>", "error");
                showActions();
            },
            // Options
            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 0,
            }
        );
    }

    // Retry button handler
    window.retryLocation = function () {
        requestLocation();
    };

    // Cancel button handler
    window.cancel = function () {
        redirectWithError("cancelled", "User cancelled location request");
    };

    // Start on page load
    requestLocation();
})();
