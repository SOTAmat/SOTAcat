// ============================================================================
// Spots module — global spot fetching, caching, and auto-refresh
// ============================================================================
// Owns the lifecycle for spot data so any page (chase, run, ...) can read
// or refresh from a single source of truth. Replaces the equivalent
// localStorage + fetch + auto-refresh logic that previously lived in chase.js.

const SPOTS_CACHE_KEY = "chaseSpotCache";   // reused so existing caches keep working
const SPOTS_CACHE_TTL_SECONDS = 3600;        // matches CHASE_HISTORY_DURATION_SECONDS
const SPOTS_MIN_REFRESH_INTERVAL_MS = 60000;
const SPOTS_AUTO_REFRESH_INTERVAL_MS = 60000;
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
};
