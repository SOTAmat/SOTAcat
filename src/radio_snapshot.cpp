#include "radio_snapshot.h"

#include <cstdlib>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

#include <esp_log.h>
static const char * TAG8 = "sc:snapshot";

// Lock-ordering invariant: NEVER call any kxRadio.* function while holding s_mutex.
// The snapshot mutex is leaf-level; KXRadio's mutex sits above it in the order.

static RadioSnapshotData s_data;

// Function-local magic static. C++11 guarantees thread-safe one-time
// initialization, eliminating the TOCTOU race a lazy "if (!s_mutex) create"
// pattern would have. Mirrors KXRadio::getInstance() at src/kx_radio.cpp:129-132.
static SemaphoreHandle_t get_mutex () {
    static SemaphoreHandle_t s_mutex = [] {
        SemaphoreHandle_t m = xSemaphoreCreateMutex();
        if (!m) {
            ESP_LOGE (TAG8, "Failed to create radio snapshot mutex");
            abort();
        }
        return m;
    }();
    return s_mutex;
}

namespace radio_snapshot {

RadioSnapshotData get () {
    SemaphoreHandle_t mtx = get_mutex();
    xSemaphoreTake (mtx, portMAX_DELAY);
    RadioSnapshotData copy = s_data;
    xSemaphoreGive (mtx);
    return copy;
}

void set_frequency (long hz, int64_t now_us) {
    SemaphoreHandle_t mtx = get_mutex();
    xSemaphoreTake (mtx, portMAX_DELAY);
    s_data.frequency_hz       = hz;
    s_data.frequency_stamp_us = now_us;
    xSemaphoreGive (mtx);
}

void set_mode (long mode, int64_t now_us) {
    SemaphoreHandle_t mtx = get_mutex();
    xSemaphoreTake (mtx, portMAX_DELAY);
    s_data.mode          = mode;
    s_data.mode_stamp_us = now_us;
    xSemaphoreGive (mtx);
}

void set_volume (long volume, int64_t now_us) {
    SemaphoreHandle_t mtx = get_mutex();
    xSemaphoreTake (mtx, portMAX_DELAY);
    s_data.volume          = volume;
    s_data.volume_stamp_us = now_us;
    xSemaphoreGive (mtx);
}

void set_power (long power, int64_t now_us) {
    SemaphoreHandle_t mtx = get_mutex();
    xSemaphoreTake (mtx, portMAX_DELAY);
    s_data.power          = power;
    s_data.power_stamp_us = now_us;
    xSemaphoreGive (mtx);
}

void set_xmit_state (long state, int64_t now_us) {
    SemaphoreHandle_t mtx = get_mutex();
    xSemaphoreTake (mtx, portMAX_DELAY);
    s_data.xmit_state    = state;
    s_data.xmit_stamp_us = now_us;
    xSemaphoreGive (mtx);
}

}  // namespace radio_snapshot
