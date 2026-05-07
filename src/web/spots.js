// ============================================================================
// Spots module — global spot fetching, caching, and auto-refresh
// ============================================================================
// Owns the lifecycle for spot data so any page (chase, run, ...) can read
// or refresh from a single source of truth. Replaces the equivalent
// localStorage + fetch + auto-refresh logic that previously lived in chase.js.

const SPOTS_CACHE_KEY = "chaseSpotCache";   // reused so existing caches keep working
const SPOTS_CACHE_TTL_SECONDS = 3600;        // matches CHASE_HISTORY_DURATION_SECONDS
const SPOTS_MIN_REFRESH_INTERVAL_MS = 60000;   // Rate-limit gate: minimum gap between API calls
const SPOTS_AUTO_REFRESH_INTERVAL_MS = 60000;  // Auto-refresh timer interval
const SPOTS_API_LIMIT = 500;

const SpotsState = {
    spots: null,                  // Array | null
    lastFetchTime: 0,             // ms since epoch of last fetch attempt
    lastFetchPromise: null,       // in-flight de-dupe
    lastFetchCompleteTime: 0,     // for chase's "Refreshed Ns ago" UI
    autoRefreshEnabled: false,
    autoRefreshTimeoutId: null,
    nextAutoRefreshTime: 0,
    subscribers: new Set(),
};

var Spots = {
    getAll() { return SpotsState.spots; },

    _saveCache(spots) {
        try {
            localStorage.setItem(SPOTS_CACHE_KEY, JSON.stringify({
                spots: spots,
                timestamp: Date.now(),
            }));
        } catch (e) {
            Log.warn("Spots")("Failed to save cache:", e);
        }
    },

    _restoreCache() {
        try {
            const cached = localStorage.getItem(SPOTS_CACHE_KEY);
            if (!cached) return false;

            const { spots, timestamp } = JSON.parse(cached);
            const ageMs = Date.now() - timestamp;
            if (ageMs > SPOTS_CACHE_TTL_SECONDS * 1000) {
                localStorage.removeItem(SPOTS_CACHE_KEY);
                return false;
            }

            SpotsState.spots = spots;
            SpotsState.lastFetchCompleteTime = timestamp;
            Log.info("Spots")(`Restored ${spots.length} spots (age ${Math.round(ageMs / 1000)}s)`);
            return true;
        } catch (e) {
            Log.warn("Spots")("Failed to restore cache:", e);
            localStorage.removeItem(SPOTS_CACHE_KEY);
            return false;
        }
    },

    clear() {
        // Narrow reset: cache + spots only. Auto-refresh state, rate-limit
        // timing, and any in-flight fetch are intentionally preserved
        // (e.g. callers like a GPS-override change just need stale data gone).
        SpotsState.spots = null;
        SpotsState.lastFetchCompleteTime = 0;
        try {
            localStorage.removeItem(SPOTS_CACHE_KEY);
        } catch (e) {
            // best-effort
        }
    },
};
