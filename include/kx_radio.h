#pragma once

#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>
#include <cstdint>
#include <cstdlib>

#include <cstdlib>

#define SC_KX_COMMUNICATION_RETRIES 3

/**
 * Enumeration of radio operation modes.
 */
typedef enum {
    MODE_UNKNOWN = 0,
    MODE_LSB     = 1,
    MODE_USB     = 2,
    MODE_CW      = 3,
    MODE_FM      = 4,
    MODE_AM      = 5,
    MODE_DATA    = 6,
    MODE_CW_R    = 7,
    MODE_DATA_R  = 9,
    MODE_LAST    = 9
} radio_mode_t;

enum class RadioType {
    UNKNOWN,
    KX2,
    KX3,
    KH1
};

typedef struct {
    radio_mode_t mode;
    uint8_t      active_vfo;
    long int     vfo_a_freq;
    uint8_t      tun_pwr;
    uint8_t      audio_peaking;
} kx_state_t;

// Forward declaration for TimedLock
class TimedLock;
class IRadioDriver;
struct RadioTimeHms;

/*
 * The recommended way of exclusively accessing the radio's ACC port
 * is to use the TIMED_LOCK_OR_FAIL macro or kxRadio.timed_lock() helper:
 *
 *     TIMED_LOCK_OR_FAIL(req, kxRadio.timed_lock(RADIO_LOCK_TIMEOUT_FAST_MS, "operation")) {
 *         result = kxRadio.get_from_kx("TQ", SC_KX_COMMUNICATION_RETRIES, 1);
 *     }
 *
 * For custom timeout handling, use TimedLock directly:
 *     {
 *         TimedLock lock = kxRadio.timed_lock(RADIO_LOCK_TIMEOUT_FAST_MS, "operation");
 *         if (lock.acquired()) {
 *             result = kxRadio.get_from_kx("TQ", SC_KX_COMMUNICATION_RETRIES, 1);
 *         }
 *     }
 */

class KXRadio {
  private:
    SemaphoreHandle_t m_mutex;
    bool              m_is_connected;
    RadioType         m_radio_type;
    IRadioDriver *    m_driver;
    KXRadio();
    void detect_radio_type ();
    void select_driver ();

    // Check if current task holds the mutex
    bool is_locked () const {
        return m_mutex != nullptr && xSemaphoreGetMutexHolder (m_mutex) == xTaskGetCurrentTaskHandle();
    }

  public:
    static KXRadio & getInstance ();

    int connect ();

    bool is_connected () const { return m_is_connected; }

    // Helper method to create a TimedLock for this radio
    // Returns a TimedLock that can be used with TIMED_LOCK_OR_FAIL or manually
    TimedLock timed_lock (TickType_t timeout_ms, const char * operation);

    void empty_kx_input_buffer (int wait_ms);

    long get_from_kx (const char * command, int tries, int num_digits);
    bool put_to_kx (const char * command, int num_digits, long value, int tries);
    long get_from_kx_menu_item (uint8_t menu_item, int tries);
    bool put_to_kx_menu_item (uint8_t menu_item, long value, int tries);
    bool get_from_kx_string (const char * command, int tries, char * result, int result_size);
    bool put_to_kx_command_string (const char * command, int tries);

    bool get_frequency (long & out_hz);
    bool set_frequency (long hz, int tries);
    bool get_mode (radio_mode_t & out_mode);
    bool set_mode (radio_mode_t mode, int tries);
    bool get_power (long & out_power);
    bool set_power (long power);
    bool get_volume (long & out_volume);
    bool set_volume (long volume);
    bool get_xmit_state (long & out_state);
    bool set_xmit_state (bool on);
    bool play_message_bank (int bank);
    bool tune_atu ();
    bool supports_keyer () const;
    bool supports_volume () const;
    bool send_keyer_message (const char * message);
    bool sync_time (const RadioTimeHms & client_time);
    bool get_radio_state (kx_state_t * in_state);
    bool restore_radio_state (const kx_state_t * in_state, int tries);
    bool ft8_prepare (long base_freq);
    void ft8_tone_on ();
    void ft8_tone_off ();
    void ft8_set_tone (long base_freq, long frequency);

    RadioType get_radio_type () const { return m_radio_type; }

    const char * get_radio_type_string () const {
        switch (m_radio_type) {
        case RadioType::KX2: return "KX2";
        case RadioType::KX3: return "KX3";
        case RadioType::KH1: return "KH1";
        default: return "Unknown";
        }
    }
};

extern KXRadio & kxRadio;  // global singleton
