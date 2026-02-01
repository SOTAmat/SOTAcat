#pragma once

#include <esp_log.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

/**
 * Timeout constants for 3-tier mutex locking strategy
 *
 * Tier 1: Fast timeout for GET operations that read radio state
 *         - Frequency GET, Mode GET, Power GET, Status GET
 *         - 500ms allows for typical UART roundtrip but fails fast under load
 *
 * Tier 2: Moderate timeout for SET operations that change radio state
 *         - Frequency SET, Mode SET, Power SET, Message play
 *         - 1000-2000ms accommodates slower operations and retries
 *
 * Tier 3: Long timeout for critical operations requiring completion
 *         - TX/RX toggle, Keyer, ATU, FT8, Time setting
 *         - 10000ms (10s) allows completion while preventing indefinite blocking
 */
constexpr TickType_t RADIO_LOCK_TIMEOUT_FAST_MS     = 500;    // Tier 1: GET operations
constexpr TickType_t RADIO_LOCK_TIMEOUT_MODERATE_MS = 2000;   // Tier 2: SET operations
constexpr TickType_t RADIO_LOCK_TIMEOUT_QUICK_MS    = 1000;   // Tier 2: Quick SET operations
constexpr TickType_t RADIO_LOCK_TIMEOUT_CRITICAL_MS = 10000;  // Tier 3: Critical operations
constexpr TickType_t RADIO_LOCK_TIMEOUT_FT8_MS      = 20000;  // FT8: Long transmission (~13s + margin)

/**
 * RAII wrapper for timeout-based mutex locking.
 *
 * Automatically unlocks the mutex when the TimedLock object goes out of scope.
 * Prevents common mutex lock/unlock bugs and provides cleaner code.
 *
 * Usage examples:
 *
 * 1. TIMED_LOCK_OR_FAIL macro (recommended for most cases):
 *   ```
 *   TIMED_LOCK_OR_FAIL(req, kxRadio, RADIO_LOCK_TIMEOUT_FAST_MS, "connection status GET") {
 *       transmitting = kxRadio.get_from_kx("TQ", SC_KX_COMMUNICATION_RETRIES, 1);
 *   }
 *   // Auto unlocks and auto-returns HTTP 500 "radio busy" on timeout
 *   ```
 *
 * 2. Manual TimedLock with custom fallback behavior (e.g., returning stale cached data):
 *   ```
 *   {
 *       TimedLock lock(kxRadio, RADIO_LOCK_TIMEOUT_FAST_MS, "frequency GET");
 *       if (lock.acquired()) {
 *           frequency = kxRadio.get_from_kx("FA", SC_KX_COMMUNICATION_RETRIES, 11);
 *       }
 *       else {
 *           // Custom handling: return stale cache instead of failing
 *           frequency = cached_frequency;
 *           ESP_LOGW(TAG8, "radio busy - returning stale cached frequency");
 *       }
 *   }  // Lock automatically released here
 *   ```
 */
class TimedLock {
    SemaphoreHandle_t m_mutex;
    bool              m_acquired;
    const char *      m_operation;  // For logging

  public:
    /**
     * Attempt to acquire lock with timeout
     * @param mutex The FreeRTOS mutex to lock
     * @param timeout_ms Timeout in milliseconds
     * @param operation Optional operation name for logging
     */
    TimedLock (SemaphoreHandle_t mutex, TickType_t timeout_ms, const char * operation = nullptr)
        : m_mutex (mutex)
        , m_acquired (false)
        , m_operation (operation) {

        m_acquired = (xSemaphoreTake (mutex, pdMS_TO_TICKS (timeout_ms)) == pdTRUE);

        if (m_acquired) {
            ESP_LOGD ("TimedLock", "%s LOCKED (timed) --", m_operation ? m_operation : "unknown");
        }
        else if (m_operation) {
            ESP_LOGW ("TimedLock", "timeout acquiring mutex for %s", m_operation);
        }
    }

    /**
     * Automatically unlock on destruction (RAII)
     */
    ~TimedLock() {
        if (m_acquired) {
            xSemaphoreGive (m_mutex);
        }
    }

    // Disable copying and moving
    TimedLock (const TimedLock &)             = delete;
    TimedLock & operator= (const TimedLock &) = delete;
    TimedLock (TimedLock &&)                  = delete;
    TimedLock & operator= (TimedLock &&)      = delete;

    /**
     * Check if lock was successfully acquired
     */
    bool acquired () const { return m_acquired; }

    /**
     * Explicit conversion to bool for easy checking
     */
    explicit operator bool() const { return m_acquired; }
};

/**
 * Helper macro for automatic failure on timeout
 *
 * TIMED_LOCK_OR_FAIL takes a TimedLock object (usually from kxRadio.timed_lock())
 * and automatically returns HTTP 500 if timeout occurs.
 * This is the recommended pattern for most HTTP handlers.
 *
 * Usage: TIMED_LOCK_OR_FAIL(req, kxRadio.timed_lock(RADIO_LOCK_TIMEOUT_FAST_MS, "operation")) { ... }
 */
#define TIMED_LOCK_OR_FAIL(req, timed_lock_expr)                                               \
    if (TimedLock _timed_lock_##__LINE__ = timed_lock_expr; !_timed_lock_##__LINE__.acquired()) { \
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "radio busy, please retry"); \
    } else
