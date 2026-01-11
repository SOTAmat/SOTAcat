#include "globals.h"
#include "kx_radio.h"
#include "timed_lock.h"
#include "webserver.h"

#include <esp_timer.h>

#include <esp_log.h>
static const char * TAG8 = "sc:hdl_mode";

// Mode cache to reduce radio contention under heavy load
static radio_mode_t  cached_mode      = MODE_UNKNOWN;
static int64_t       cached_mode_time = 0;
static const int64_t MODE_CACHE_US    = 200000;  // 200ms cache

// Struct to map radio mode names to their corresponding radio_mode_t enum values
typedef struct {
    char const * const name;  // Name of the radio mode as a string
    radio_mode_t       mode;  // Corresponding value from the radio_mode_t enumeration
} radio_mode_map_t;

// Array of radio mode mappings, ordered to match the radio_mode_t enumeration
static const radio_mode_map_t radio_mode_map[] = {
    {"UNKNOWN", MODE_UNKNOWN}, //  MODE_UNKNOWN = 0,
    {"LSB",     MODE_LSB    }, //  MODE_LSB     = 1,
    {"USB",     MODE_USB    }, //  MODE_USB     = 2,
    {"CW",      MODE_CW     }, //  MODE_CW      = 3,
    {"FM",      MODE_FM     }, //  MODE_FM      = 4,
    {"AM",      MODE_AM     }, //  MODE_AM      = 5,
    {"DATA",    MODE_DATA   }, //  MODE_DATA    = 6,
    {"CW_R",    MODE_CW_R   }, //  MODE_CW_R    = 7,
    {"DATA_R",  MODE_DATA_R }, //  MODE_DATA_R  = 9,

    // Aliases for "DATA":
    {"FT8",     MODE_DATA   },
    {"JS8",     MODE_DATA   },
    {"PK31",    MODE_DATA   },
    {"FT4",     MODE_DATA   },
    {"RTTY",    MODE_DATA   },
};

/**
 * Retrieves the current operating mode of the radio.
 * @return The current mode as a value from the radio_mode_t enumeration.
 */
radio_mode_t get_radio_mode () {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    int64_t now = esp_timer_get_time();
    long    mode;

    if (Ft8RadioExclusive) {
        if (cached_mode != MODE_UNKNOWN) {
            mode = cached_mode;
            ESP_LOGW (TAG8, "ft8 active - returning cached mode: %ld (%s)", mode, radio_mode_map[mode].name);
        }
        else {
            ESP_LOGW (TAG8, "ft8 active - no cached mode available");
            mode = MODE_UNKNOWN;
        }
    }
    // Check cache first to reduce radio mutex contention
    else if (cached_mode != MODE_UNKNOWN && (now - cached_mode_time) < MODE_CACHE_US) {
        mode = cached_mode;
        ESP_LOGV (TAG8, "returning cached mode: %ld (%s)", mode, radio_mode_map[mode].name);
    }
    else {
        // Cache miss or expired - query radio with timeout
        // Tier 1: Fast timeout for GET operations
        {
            TimedLock lock = kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_FAST_MS, "mode GET");
            if (lock.acquired()) {
                radio_mode_t current_mode = MODE_UNKNOWN;
                if (!kxRadio.get_mode (current_mode))
                    mode = MODE_UNKNOWN;
                else
                    mode = current_mode;

                if (mode > MODE_UNKNOWN && mode <= MODE_LAST) {
                    // Update cache
                    cached_mode      = static_cast<radio_mode_t> (mode);
                    cached_mode_time = now;
                    ESP_LOGD (TAG8, "cached new mode: %ld (%s)", mode, radio_mode_map[mode].name);
                }
                else {
                    ESP_LOGI (TAG8, "mode = %ld (%s)", mode, radio_mode_map[mode].name);
                }
            }
            else {
                // Mutex timeout - return stale cache if available
                if (cached_mode != MODE_UNKNOWN) {
                    mode = cached_mode;
                    ESP_LOGW (TAG8, "radio busy - returning stale cached mode: %ld (%s)", mode, radio_mode_map[mode].name);
                }
                else {
                    ESP_LOGW (TAG8, "radio busy - no cached mode available");
                    mode = MODE_UNKNOWN;
                }
            }
        }  // TimedLock destructor runs here, after radio access is complete
    }

    // Ensure the mode is valid - this is really a double-check that our array
    // of modes is properly formed, moreso than a potential runtime error.
    assert (radio_mode_map[mode].mode == mode);

    return static_cast<radio_mode_t> (mode);
}

/**
 * Handles an HTTP GET request to retrieve the current operating mode of the radio.
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK if the mode is successfully retrieved and sent; otherwise, an error code.
 */
esp_err_t handler_mode_get (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    radio_mode_t mode = get_radio_mode();

    // Validate the mode and respond with an error if unrecognized
    if (mode < MODE_UNKNOWN || mode > MODE_LAST)
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "unrecognized mode");

    REPLY_WITH_STRING (req, radio_mode_map[mode].name, "mode");
}

/**
 * Handles an HTTP PUT request to set the receiver bandwidth, which indirectly sets the radio mode.
 * Parses the 'bw' parameter from the HTTP request and adjusts the radio mode accordingly.
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK if the bandwidth mode is successfully set; otherwise, an error code.
 */
esp_err_t handler_mode_put (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    STANDARD_DECODE_SOLE_PARAMETER (req, "bw", bw);
    ESP_LOGI (TAG8, "requesting bw = '%s'", bw);

    radio_mode_t mode = MODE_UNKNOWN;

    // Tier 2: Moderate timeout for SET operations
    TIMED_LOCK_OR_FAIL (req, kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_MODERATE_MS, "mode SET")) {
        // Determine the radio mode based on the "bw" parameter
        if (!strcmp (bw, "SSB")) {
            // Get the current frequency and set the mode to LSB or USB based on the frequency
            long frequency = 0;
            if (!kxRadio.get_frequency (frequency))
                frequency = 0;
            if (frequency > 0)
                mode = (frequency < 10000000) ? MODE_LSB : MODE_USB;
        }
        else
#define COUNTOF(array) (sizeof (array) / sizeof (array[0]))
            // Iterate through the radio_mode_map to find a matching mode
            for (radio_mode_map_t const * mode_kv = &radio_mode_map[COUNTOF (radio_mode_map) - 1];
                 mode_kv >= &radio_mode_map[0];
                 --mode_kv)
                if (!strcmp (bw, mode_kv->name)) {
                    mode = mode_kv->mode;
                    break;
                }

        // Respond with an error if the mode is not recognized
        if (mode == MODE_UNKNOWN)
            REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "invalid bw");

        // Set the radio mode
        ESP_LOGI (TAG8, "mode = '%s'", radio_mode_map[mode].name);
        if (!kxRadio.set_mode (mode, SC_KX_COMMUNICATION_RETRIES))
            REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "invalid mode for radio");

        // Update cache after setting new mode
        cached_mode      = mode;
        cached_mode_time = esp_timer_get_time();
        ESP_LOGD (TAG8, "cache updated with new mode: %s", radio_mode_map[mode].name);
    }

    REPLY_WITH_SUCCESS();
}
