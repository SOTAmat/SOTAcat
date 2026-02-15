#include "radio_driver_kx.h"

#include "hardware_specific.h"

#include <cassert>
#include <cmath>
#include <cstring>
#include <memory>

#include <driver/uart.h>
#include <esp_log.h>

static const char * TAG8 = "sc:radio_kx";

static inline int decode_couplet (char ten, char one) {
    // note high bit 0x80 may be set on tens digit of each couplet, to represent the decimal point
    return 10 * ((ten & 0x7f) - '0') + one - '0';
}

static bool get_kx_display_time (KXRadio & radio, RadioTimeHms & radio_time) {
    char buf[sizeof ("DS@@123456af;")];
    if (!radio.get_from_kx_string ("DS", SC_KX_COMMUNICATION_RETRIES, buf, sizeof (buf) - 1))
        return false;

    buf[sizeof (buf) - 1] = '\0';
    radio_time.hrs        = decode_couplet (buf[4], buf[5]);
    radio_time.min        = decode_couplet (buf[6], buf[7]);
    radio_time.sec        = decode_couplet (buf[8], buf[9]);
    return true;
}

static void adjust_kx_time_component (KXRadio & radio, const char * selector, int diff) {
    if (!diff)
        return;

    const size_t num_steps = static_cast<size_t> (std::abs (diff));
    assert (num_steps <= 60);

    const size_t     selector_len    = std::strlen (selector);
    constexpr size_t step_len        = sizeof ("UP;") - 1;
    const size_t     adjustment_size = selector_len + num_steps * step_len + 1;
    auto             adjustment      = std::make_unique<char[]> (adjustment_size);

    char * buf = adjustment.get();

    int written = snprintf (buf, adjustment_size, "%s", selector);
    for (int ii = diff; ii > 0; --ii)
        written += snprintf (buf + written, adjustment_size - written, "UP;");
    for (int ii = diff; ii < 0; ++ii)
        written += snprintf (buf + written, adjustment_size - written, "DN;");

    radio.put_to_kx_command_string (buf, 1);
    vTaskDelay (pdMS_TO_TICKS (30 * num_steps));
}

bool KXRadioDriver::supports_keyer () const {
    return true;
}

bool KXRadioDriver::supports_volume () const {
    return true;
}

bool KXRadioDriver::get_frequency (KXRadio & radio, long & out_hz) {
    long frequency = radio.get_from_kx ("FA", SC_KX_COMMUNICATION_RETRIES, 11);
    if (frequency <= 0)
        return false;
    out_hz = frequency;
    return true;
}

bool KXRadioDriver::set_frequency (KXRadio & radio, long hz, int tries) {
    return radio.put_to_kx ("FA", 11, hz, tries);
}

bool KXRadioDriver::get_mode (KXRadio & radio, radio_mode_t & out_mode) {
    long mode = radio.get_from_kx ("MD", SC_KX_COMMUNICATION_RETRIES, 1);
    if (mode < MODE_UNKNOWN || mode > MODE_LAST)
        return false;
    out_mode = static_cast<radio_mode_t> (mode);
    return true;
}

bool KXRadioDriver::set_mode (KXRadio & radio, radio_mode_t mode, int tries) {
    if (mode < MODE_UNKNOWN || mode > MODE_LAST)
        return false;
    return radio.put_to_kx ("MD", 1, mode, tries);
}

bool KXRadioDriver::get_power (KXRadio & radio, long & out_power) {
    long power = radio.get_from_kx ("PC", SC_KX_COMMUNICATION_RETRIES, 3);
    if (power < 0)
        return false;
    out_power = power;
    return true;
}

bool KXRadioDriver::set_power (KXRadio & radio, long power) {
    // first set it to a known value, zero
    if (!radio.put_to_kx ("PC", 3, 0, SC_KX_COMMUNICATION_RETRIES))
        return false;

    if (!power)
        return true;

    radio.put_to_kx ("PC", 3, power, 0);

    long readback = radio.get_from_kx ("PC", SC_KX_COMMUNICATION_RETRIES, 3);
    if (readback == 0)
        return false;

    if (readback != power)
        ESP_LOGI (TAG8, "requested power %ld, acquired %ld", power, readback);

    return true;
}

bool KXRadioDriver::get_volume (KXRadio & radio, long & out_volume) {
    long volume = radio.get_from_kx ("AG", SC_KX_COMMUNICATION_RETRIES, 3);
    if (volume < 0)
        return false;
    out_volume = volume;
    return true;
}

bool KXRadioDriver::set_volume (KXRadio & radio, long delta) {
    // Read current volume
    long current_volume = -1;
    if (!radio.get_volume (current_volume))
        return false;

    // Calculate new volume, clamped to 0-255
    long new_volume = current_volume + delta*20;
    if (new_volume < 0)
        new_volume = 0;
    if (new_volume > 255)
        new_volume = 255;

    ESP_LOGI (TAG8, "volume: %ld + %ld = %ld", current_volume, delta, new_volume);

    return radio.put_to_kx ("AG", 3, new_volume, SC_KX_COMMUNICATION_RETRIES);
}

bool KXRadioDriver::get_xmit_state (KXRadio & radio, long & out_state) {
    long state = radio.get_from_kx ("TQ", SC_KX_COMMUNICATION_RETRIES, 1);
    if (state < 0)
        return false;
    out_state = state;
    return true;
}

bool KXRadioDriver::set_xmit_state (KXRadio & radio, bool on) {
    const char * command = on ? "TX;" : "RX;";
    return radio.put_to_kx_command_string (command, 1);
}

bool KXRadioDriver::play_message_bank (KXRadio & radio, int bank) {
    const char * command = (bank == 1) ? "SWT11;SWT19;" : "SWT11;SWT27;";
    return radio.put_to_kx_command_string (command, 1);
}

bool KXRadioDriver::tune_atu (KXRadio & radio) {
    const char * command = nullptr;
    switch (radio.get_radio_type()) {
    case RadioType::KX3:
        command = "SWT44;";
        break;
    case RadioType::KX2:
        command = "SWT20;";
        break;
    default:
        return false;
    }
    return radio.put_to_kx_command_string (command, 1);
}

bool KXRadioDriver::send_keyer_message (KXRadio & radio, const char * message) {
    if (!message)
        return false;

    // Strip < and > characters (prosign markers not supported by radio keyer)
    // and work with a mutable copy
    size_t msg_len = std::strlen (message);
    auto   cleaned = std::make_unique<char[]> (msg_len + 1);
    char * dst     = cleaned.get();
    for (const char * src = message; *src; ++src) {
        if (*src != '<' && *src != '>')
            *dst++ = *src;
    }
    *dst     = '\0';
    msg_len  = dst - cleaned.get();

    if (msg_len == 0)
        return false;

    radio_mode_t mode      = static_cast<radio_mode_t> (radio.get_from_kx ("MD", SC_KX_COMMUNICATION_RETRIES, 1));
    long         speed_wpm = radio.get_from_kx ("KS", SC_KX_COMMUNICATION_RETRIES, 3);

    if (mode != MODE_CW)
        radio.put_to_kx ("MD", 1, MODE_CW, SC_KX_COMMUNICATION_RETRIES);

    // KYW command limit is 24 characters. Split longer messages at whitespace boundaries.
    constexpr size_t KYW_MAX = 24;
    const char *     pos     = cleaned.get();
    const char *     end     = cleaned.get() + msg_len;

    while (pos < end) {
        // Skip leading whitespace between chunks
        while (pos < end && *pos == ' ')
            ++pos;
        if (pos >= end)
            break;

        size_t remaining = end - pos;
        size_t chunk_len;

        if (remaining <= KYW_MAX) {
            chunk_len = remaining;
        }
        else {
            // Find last space within the KYW_MAX window
            chunk_len = KYW_MAX;
            const char * space = nullptr;
            for (size_t i = 0; i < KYW_MAX && (pos + i) < end; ++i) {
                if (pos[i] == ' ')
                    space = pos + i;
            }
            if (space && space > pos)
                chunk_len = space - pos;
            // else hard-split at KYW_MAX (no whitespace found)
        }

        char command[32];  // "KYW" + 24 chars + ";" + null = 29 max
        snprintf (command, sizeof (command), "KYW%.*s;", (int)chunk_len, pos);
        radio.put_to_kx_command_string (command, 1);

        long duration_ms = 60 * 1000 * static_cast<long> (chunk_len) / (speed_wpm * 5);
        vTaskDelay (pdMS_TO_TICKS (duration_ms));

        pos += chunk_len;
    }

    // Tail delay for final character spacing
    vTaskDelay (pdMS_TO_TICKS (600));

    if (mode != MODE_CW)
        radio.put_to_kx ("MD", 1, mode, SC_KX_COMMUNICATION_RETRIES);

    return true;
}

bool KXRadioDriver::sync_time (KXRadio & radio, const RadioTimeHms & client_time) {
    RadioTimeHms radio_time;
    radio.put_to_kx ("MN", 3, 73, SC_KX_COMMUNICATION_RETRIES);
    if (!get_kx_display_time (radio, radio_time)) {
        radio.put_to_kx ("MN", 3, 255, SC_KX_COMMUNICATION_RETRIES);
        return false;
    }

    if (radio_time.sec != client_time.sec)
        adjust_kx_time_component (radio, "SWT20;", client_time.sec - radio_time.sec);
    if (radio_time.min != client_time.min)
        adjust_kx_time_component (radio, "SWT27;", client_time.min - radio_time.min);
    if (radio_time.hrs != client_time.hrs)
        adjust_kx_time_component (radio, "SWT19;", client_time.hrs - radio_time.hrs);

    radio.put_to_kx ("MN", 3, 255, SC_KX_COMMUNICATION_RETRIES);
    return true;
}

bool KXRadioDriver::get_radio_state (KXRadio & radio, kx_state_t * state) {
    if (!state)
        return false;

    state->mode = static_cast<radio_mode_t> (radio.get_from_kx ("MD", SC_KX_COMMUNICATION_RETRIES, 1));
    radio.put_to_kx ("MD", 1, MODE_CW, SC_KX_COMMUNICATION_RETRIES);
    state->audio_peaking = radio.get_from_kx ("AP", SC_KX_COMMUNICATION_RETRIES, 1);
    radio.put_to_kx ("MD", 1, state->mode, SC_KX_COMMUNICATION_RETRIES);
    state->vfo_a_freq = radio.get_from_kx ("FA", SC_KX_COMMUNICATION_RETRIES, 11);
    state->active_vfo = static_cast<uint8_t> (radio.get_from_kx ("FT", SC_KX_COMMUNICATION_RETRIES, 1));
    state->tun_pwr    = static_cast<uint8_t> (radio.get_from_kx_menu_item (58, SC_KX_COMMUNICATION_RETRIES));
    return true;
}

bool KXRadioDriver::restore_radio_state (KXRadio & radio, const kx_state_t * state, int tries) {
    if (!state)
        return false;

    radio.put_to_kx_menu_item (58, state->tun_pwr, SC_KX_COMMUNICATION_RETRIES);
    radio.put_to_kx ("FT", 1, state->active_vfo, SC_KX_COMMUNICATION_RETRIES);
    radio.put_to_kx ("FA", 11, state->vfo_a_freq, SC_KX_COMMUNICATION_RETRIES);
    radio.put_to_kx ("MD", 1, MODE_CW, SC_KX_COMMUNICATION_RETRIES);
    radio.put_to_kx ("AP", 1, state->audio_peaking, SC_KX_COMMUNICATION_RETRIES);
    radio.put_to_kx ("MD", 1, state->mode, SC_KX_COMMUNICATION_RETRIES);

    (void)tries;
    return true;
}

bool KXRadioDriver::ft8_prepare (KXRadio & radio, long base_freq) {
    bool ok = true;
    ok &= radio.put_to_kx ("FR", 1, 0, SC_KX_COMMUNICATION_RETRIES);
    ok &= radio.put_to_kx ("FT", 1, 0, SC_KX_COMMUNICATION_RETRIES);
    ok &= radio.put_to_kx ("FA", 11, base_freq, SC_KX_COMMUNICATION_RETRIES);
    ok &= radio.put_to_kx ("MD", 1, MODE_CW, SC_KX_COMMUNICATION_RETRIES);
    ok &= radio.put_to_kx ("AP", 1, 1, SC_KX_COMMUNICATION_RETRIES);
    if (!ok)
        return false;

    // Set TUN PWR to 10W (100 = 10.0W in 0.1W units) with readback verification
    constexpr long FT8_TUN_PWR = 100;  // 10.0 watts
    if (!radio.put_to_kx_menu_item (58, FT8_TUN_PWR, SC_KX_COMMUNICATION_RETRIES)) {
        return false;
    }

    // Verify power was set correctly by reading back
    long readback = radio.get_from_kx_menu_item (58, SC_KX_COMMUNICATION_RETRIES);
    if (readback != FT8_TUN_PWR) {
        ESP_LOGW (TAG8, "TUN PWR readback mismatch: requested %ld, got %ld", FT8_TUN_PWR, readback);
        // Retry once if readback doesn't match
        radio.put_to_kx_menu_item (58, FT8_TUN_PWR, SC_KX_COMMUNICATION_RETRIES);
        readback = radio.get_from_kx_menu_item (58, SC_KX_COMMUNICATION_RETRIES);
        if (readback != FT8_TUN_PWR) {
            ESP_LOGE (TAG8, "TUN PWR verification failed after retry: got %ld", readback);
            return false;
        }
    }
    ESP_LOGI (TAG8, "TUN PWR set to 10W for FT8 transmission (verified)");
    return true;
}

void KXRadioDriver::ft8_tone_on (KXRadio & radio) {
    (void)radio;
    uart_write_bytes (UART_NUM, "SWH16;", sizeof ("SWH16;") - 1);
}

void KXRadioDriver::ft8_tone_off (KXRadio & radio) {
    (void)radio;
    uart_write_bytes (UART_NUM, "SWH16;", sizeof ("SWH16;") - 1);
}

void KXRadioDriver::ft8_set_tone (KXRadio & radio, long base_freq, long frequency) {
    (void)radio;
    (void)base_freq;

    char command[16];
    snprintf (command, sizeof (command), "FA%011ld;", frequency);
    uart_write_bytes (UART_NUM, command, 14);
}
