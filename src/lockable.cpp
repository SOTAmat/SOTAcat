#include "lockable.h"
#include <esp_log.h>

static const char * TAG8 = "sc:lockable";

/**
 * A mutex lock meant to be an inheritable base class
 * compatible with std::lock_guard.
 * Note that the constructor takes a string name
 * used to describe this instance in emitted messages.
 */

Lockable::Lockable (char const * name)
    : m_locked (false)
    , m_name (name) {
    m_mutex = xSemaphoreCreateMutex();
    if (!m_mutex) {
        ESP_LOGE (TAG8, "Failed to create mutex for %s", m_name);
        abort();  // or handle more gracefully
    }
}

Lockable::~Lockable() {
    if (m_mutex) {
        vSemaphoreDelete (m_mutex);
        m_mutex = nullptr;
    }
}

void Lockable::lock() {
    ESP_LOGD (TAG8, "locking %s", m_name);
    if (m_locked)
        ESP_LOGE (TAG8, "double-lock detected!");
    xSemaphoreTake (m_mutex, portMAX_DELAY);
    m_locked = true;
    ESP_LOGD (TAG8, "%s LOCKED --", m_name);
}

void Lockable::unlock() {
    xSemaphoreGive (m_mutex);
    m_locked = false;
    ESP_LOGD (TAG8, "-- %s UNLOCKED", m_name);
}
