// SOTAcat Geolocation Bridge
// This page runs on HTTPS to access browser geolocation, then redirects
// back to SOTAcat (HTTP) with the coordinates.

(function () {
    "use strict";

    // Parse URL parameters
    const params = new URLSearchParams(window.location.search);
    const returnPath = params.get("returnpath");

    // Validate returnpath is a safe destination (sotacat.local or private IP).
    // Returns a sanitized URL string if valid, or null if invalid.
    function validateReturnPath(path) {
        if (!path) return null;
        try {
            const url = new URL(path);

            // Only allow http/https protocols
            if (url.protocol !== "http:" && url.protocol !== "https:") return null;

            const hostname = url.hostname.toLowerCase();

            // Allow sotacat.local (mDNS)
            if (hostname === "sotacat.local") return url.href;

            // Allow private IP ranges: 192.168.x.x, 10.x.x.x, 172.16-31.x.x
            const privateIPPattern =
                /^(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;
            if (privateIPPattern.test(hostname)) return url.href;

            // Allow localhost for testing
            if (hostname === "localhost" || hostname === "127.0.0.1") return url.href;

            return null;
        } catch (e) {
            return null;
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

    // Build redirect URL with coordinates using a validated base URL
    function buildRedirectUrl(validatedBase, lat, lon, accuracy) {
        const url = new URL(validatedBase);
        url.searchParams.set("geo_lat", lat);
        url.searchParams.set("geo_lon", lon);
        url.searchParams.set("geo_accuracy", accuracy);
        return url.href;
    }

    // Build redirect URL with error using a validated base URL
    function buildErrorRedirectUrl(validatedBase, code, message) {
        const separator = validatedBase.includes("?") ? "&" : "?";
        return validatedBase + separator + "geo_error=" + code + "&geo_message=" + encodeURIComponent(message);
    }

    // Redirect with location data
    function redirectWithLocation(lat, lon, accuracy) {
        const validatedBase = validateReturnPath(returnPath);
        if (!validatedBase) {
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
        const redirectUrl = buildRedirectUrl(validatedBase, latStr, lonStr, accStr);
        setTimeout(function () {
            window.location.href = redirectUrl;
        }, 800);
    }

    // Redirect with error info
    function redirectWithError(code, message) {
        const validatedBase = validateReturnPath(returnPath);
        if (!validatedBase) {
            updateStatus("<p>" + message + "</p>", "error");
            showActions();
            return;
        }

        window.location.href = buildErrorRedirectUrl(validatedBase, code, message);
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

        if (!validateReturnPath(returnPath)) {
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
