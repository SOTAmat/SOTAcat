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

bool KXRadioDriver::set_volume (KXRadio & radio, long volume) {
    if (volume < 0 || volume > 255)
        return false;
    return radio.put_to_kx ("AG", 3, volume, SC_KX_COMMUNICATION_RETRIES);
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

    char command[256];
    snprintf (command, sizeof (command), "KYW%s;", message);

    radio_mode_t mode      = static_cast<radio_mode_t> (radio.get_from_kx ("MD", SC_KX_COMMUNICATION_RETRIES, 1));
    long         speed_wpm = radio.get_from_kx ("KS", SC_KX_COMMUNICATION_RETRIES, 3);
    long         chars     = static_cast<long> (std::strlen (message));

    if (mode != MODE_CW)
        radio.put_to_kx ("MD", 1, MODE_CW, SC_KX_COMMUNICATION_RETRIES);

    radio.put_to_kx_command_string (command, 1);

    long duration_ms = 60 * 1000 * chars / (speed_wpm * 5);
    vTaskDelay (pdMS_TO_TICKS (duration_ms));
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
    radio.put_to_kx ("FR", 1, 0, SC_KX_COMMUNICATION_RETRIES);
    radio.put_to_kx ("FT", 1, 0, SC_KX_COMMUNICATION_RETRIES);
    radio.put_to_kx ("FA", 11, base_freq, SC_KX_COMMUNICATION_RETRIES);
    radio.put_to_kx ("MD", 1, MODE_CW, SC_KX_COMMUNICATION_RETRIES);
    radio.put_to_kx ("AP", 1, 1, SC_KX_COMMUNICATION_RETRIES);

    if (!radio.put_to_kx_menu_item (58, 100, SC_KX_COMMUNICATION_RETRIES)) {
        return false;
    }
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
