#pragma once

#include "lockable.h"
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
 * 1. Basic usage with manual check:
 *   ```
 *   TimedLock lock(kxRadio, 500, "power GET");
 *   if (!lock.acquired()) {
 *       REPLY_WITH_FAILURE(req, HTTPD_500_INTERNAL_SERVER_ERROR, "radio busy");
 *   }
 *   long power = kxRadio.get_from_kx("PC", SC_KX_COMMUNICATION_RETRIES, 3);
 *   // Automatically unlocks when lock goes out of scope
 *   ```
 *
 * 2. Using TIMED_LOCK macro:
 *   ```
 *   TIMED_LOCK(kxRadio, 500, "power GET") {
 *       long power = kxRadio.get_from_kx("PC", SC_KX_COMMUNICATION_RETRIES, 3);
 *   }
 *   // Auto unlocks at end of block
 *   ```
 *
 * 3. Using TIMED_LOCK_OR_FAIL macro (most convenient):
 *   ```
 *   TIMED_LOCK_OR_FAIL(req, kxRadio, 2000, "frequency SET") {
 *       kxRadio.put_to_kx("FA", 11, freq, SC_KX_COMMUNICATION_RETRIES);
 *   }
 *   // Auto unlocks and auto-returns HTTP 500 on timeout
 *   ```
 */
class TimedLock {
    Lockable &   m_lockable;
    bool         m_acquired;
    const char * m_operation;  // For logging

  public:
    /**
     * Attempt to acquire lock with timeout
     * @param lockable The Lockable object to lock
     * @param timeout_ms Timeout in milliseconds
     * @param operation Optional operation name for logging
     */
    TimedLock (Lockable & lockable, TickType_t timeout_ms, const char * operation = nullptr)
        : m_lockable (lockable)
        , m_acquired (false)
        , m_operation (operation) {

        m_acquired = (xSemaphoreTake (lockable.get_mutex(), pdMS_TO_TICKS (timeout_ms)) == pdTRUE);

        if (!m_acquired && m_operation) {
            ESP_LOGW ("TimedLock", "timeout acquiring mutex for %s", m_operation);
        }
    }

    /**
     * Automatically unlock on destruction (RAII)
     */
    ~TimedLock() {
        if (m_acquired) {
            m_lockable.unlock();
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
 * Helper macros for common patterns
 */

// Simple usage - check if acquired manually, creates scoped lock
#define TIMED_LOCK(lockable, timeout_ms, operation)                     \
    TimedLock _timed_lock_##__LINE__ (lockable, timeout_ms, operation); \
    if (_timed_lock_##__LINE__.acquired())

// Auto-fail HTTP request on timeout
#define TIMED_LOCK_OR_FAIL(req, lockable, timeout_ms, operation)                               \
    TimedLock _timed_lock_##__LINE__ (lockable, timeout_ms, operation);                        \
    if (!_timed_lock_##__LINE__.acquired()) {                                                  \
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "radio busy, please retry"); \
    }                                                                                          \
    if (_timed_lock_##__LINE__.acquired())
