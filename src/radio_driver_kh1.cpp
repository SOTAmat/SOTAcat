#include "radio_driver_kh1.h"

#include "hardware_specific.h"

#include <cassert>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <memory>

#include <driver/uart.h>

/* Morse code array
The index of each character gives the morse code for that character in binary.
The bits of the character are read from RIGHT to left,
with a "1"=dit and "0"=dah and a final stop bit of "1"
*/
//                    0123456789112345678921234567893123456789412345678951234567896
//                    0         1         2         3         4         5         6
const char morse[] = "##TEMANIOWKUGRDS#JY#Q#XV#PCFZLBH01#2###3######=49#####/#8###"
                     "7#65############,########.#*######-####################?####";
//                    6         7         8         9         0         1         2

static bool get_kh1_display_frequency (KXRadio & radio, long & out_hz) {
    char response[20];
    char freq_char[10];

    if (!radio.get_from_kx_string ("DS1", SC_KX_COMMUNICATION_RETRIES, response, sizeof (response)))
        return false;

    snprintf (freq_char, sizeof (freq_char), "%.*s", 8, response + 3); // Characters 4-11 represent frequency as a string

    double freq_dec            = strtod (freq_char, NULL);
    out_hz                     = static_cast<long> (freq_dec * 1000);
    return out_hz > 0;
}

static bool get_kh1_display_mode (KXRadio & radio, radio_mode_t & out_mode) {
    char response[20];
    if (!radio.get_from_kx_string ("DS1", SC_KX_COMMUNICATION_RETRIES, response, sizeof (response)))
        return false;

    char mode_char = response[12];  // 13th character represents the mode
    switch (mode_char) {
    case 'L': out_mode = MODE_LSB; break;
    case 'U': out_mode = MODE_USB; break;
    case 'C': out_mode = MODE_CW; break;
    default: out_mode = MODE_UNKNOWN;
    }

    return out_mode != MODE_UNKNOWN;
}

static bool get_kh1_display_power (KXRadio & radio, long & out_power) {
    char response[20];
    char power_char[5];

    if (!radio.get_from_kx_string ("DS1", SC_KX_COMMUNICATION_RETRIES, response, sizeof (response)))
        return false;

    snprintf (power_char, sizeof (power_char), "%.*s", 4, response + 3); // Characters 4-7 represent power level as a string

    if (!strcmp (power_char, "LOW "))
        out_power = 0;
    else if (!strcmp (power_char, "HIGH"))
        out_power = 15;
    else
        out_power = -1;

    return out_power >= 0;
}

static bool set_kh1_power_level (KXRadio & radio, long power_level) {
    char power_return[20];
    char power_char[5];

    radio.put_to_kx_command_string ("SW2H;SW2H;", 1);
    if (radio.get_from_kx_string ("DS1", SC_KX_COMMUNICATION_RETRIES, power_return, sizeof (power_return))) {
        snprintf (power_char, sizeof (power_char), "%.*s", 4, power_return + 3); // Characters 4-7 represent power level as a string
        if (!strcmp (power_char, power_level > 0 ? "LOW " : "HIGH")) {
            radio.put_to_kx_command_string ("SW2H;SW2H;", 1);
        }
    }

    return true;
}

static bool get_kh1_display_time (KXRadio & radio, RadioTimeHms & radio_time) {
    char buf[sizeof ("DS2xxxxxxxxxxxHH:MM;")];
    if (!radio.get_from_kx_string ("DS2", SC_KX_COMMUNICATION_RETRIES, buf, sizeof (buf) - 1))
        return false;

    buf[sizeof (buf) - 1] = '\0';

    char hour_char[3] = {0};
    char min_char[3]  = {0};
    snprintf (hour_char, sizeof (hour_char), "%.*s", 2, buf + 14); // Characters 15-16 represent hour as a string       
    snprintf (min_char, sizeof (min_char), "%.*s", 2, buf + 17); // Characters 18-19 represent minute as a string       
    radio_time.hrs = atoi (hour_char);
    radio_time.min = atoi (min_char);
    radio_time.sec = 0;
    return true;
}

static void adjust_kh1_time_component (KXRadio & radio, const char * selector, int diff) {
    if (!diff)
        return;

    const size_t num_steps = static_cast<size_t> (std::abs (diff));
    assert (num_steps <= 60);

    const size_t     selector_len    = std::strlen (selector);
    constexpr size_t step_len        = sizeof ("ENVU;") - 1;
    const size_t     adjustment_size = selector_len + num_steps * step_len + 1;
    auto             adjustment      = std::make_unique<char[]> (adjustment_size);

    char * buf = adjustment.get();

    int written = snprintf (buf, adjustment_size, "%s", selector);
    for (int ii = diff; ii > 0; --ii)
        written += snprintf (buf + written, adjustment_size - written, "ENVU;");
    for (int ii = diff; ii < 0; ++ii)
        written += snprintf (buf + written, adjustment_size - written, "ENVD;");

    radio.put_to_kx_command_string (buf, 1);
    vTaskDelay (pdMS_TO_TICKS (30 * num_steps));
}

bool KH1RadioDriver::supports_keyer () const {
    return true;
}

bool KH1RadioDriver::supports_volume () const {
    return true;
}

bool KH1RadioDriver::get_frequency (KXRadio & radio, long & out_hz) {
    return get_kh1_display_frequency (radio, out_hz);
}

bool KH1RadioDriver::set_frequency (KXRadio & radio, long hz, int tries) {
    if (hz > 21450000)
        return false;

    long adjusted_value = (hz / 10) * 10;

    if (tries <= 0) {
        char command[16];
        snprintf (command, sizeof (command), "FA%08ld;", hz);
        return radio.put_to_kx_command_string (command, 1);
    }

    for (int attempt = 0; attempt < tries; attempt++) {
        char command[16];
        snprintf (command, sizeof (command), "FA%08ld;", hz);
        radio.put_to_kx_command_string (command, 1);

        vTaskDelay (pdMS_TO_TICKS (300));
        long out_value = 0;
        if (get_kh1_display_frequency (radio, out_value) && out_value == adjusted_value)
            return true;
    }

    return false;
}

bool KH1RadioDriver::get_mode (KXRadio & radio, radio_mode_t & out_mode) {
    return get_kh1_display_mode (radio, out_mode);
}

bool KH1RadioDriver::set_mode (KXRadio & radio, radio_mode_t mode, int tries) {
    if (mode > MODE_CW)
        return false;

    int kh_mode = (mode == MODE_CW) ? MODE_UNKNOWN : mode;
    const char * command = nullptr;
    switch (kh_mode) {
    case MODE_UNKNOWN: command = "MD0;"; break;
    case MODE_LSB: command = "MD1;"; break;
    case MODE_USB: command = "MD2;"; break;
    default: return false;
    }

    if (tries <= 0) {
        return radio.put_to_kx_command_string (command, 1);
    }

    for (int attempt = 0; attempt < tries; attempt++) {
        radio.put_to_kx_command_string (command, 1);

        vTaskDelay (pdMS_TO_TICKS (300));
        radio_mode_t out_mode = MODE_UNKNOWN;
        if (get_kh1_display_mode (radio, out_mode) && out_mode == mode)
            return true;
    }

    return false;
}

bool KH1RadioDriver::get_power (KXRadio & radio, long & out_power) {
    return get_kh1_display_power (radio, out_power);
}

bool KH1RadioDriver::set_power (KXRadio & radio, long power) {
    return set_kh1_power_level (radio, power);
}

bool KH1RadioDriver::get_volume (KXRadio & radio, long & out_volume) {
    radio.put_to_kx_command_string ("ENAU;ENAD;", 1); // Raise/lower volume so it is displayed
    char buf[sizeof ("DS1AFx15xxxxxxxxxxx;")];
    if (!radio.get_from_kx_string ("DS1", SC_KX_COMMUNICATION_RETRIES, buf, sizeof (buf) - 1))
        return false;

    char vol_char[3];
    snprintf (vol_char, sizeof (vol_char), "%.*s", 2, buf + 6); // Characters 7-8 represent volume as a string
    long volume = atol(vol_char);
    if (volume < 0)
        return false;
    out_volume = volume;
    return true;
}

bool KH1RadioDriver::set_volume (KXRadio & radio, long volume) {
    const char * dir = (volume > 0 ? "ENAU;ENAU;ENAU;" : "ENAD;ENAD;ENAD;"); // bump volume up or down 3 units
    radio.put_to_kx_command_string (dir, 1);
    
    return true;
}

bool KH1RadioDriver::get_xmit_state (KXRadio & radio, long & out_state) {
    char response[20];
    if (!radio.get_from_kx_string ("DS1", SC_KX_COMMUNICATION_RETRIES, response, sizeof (response)))
        return false;

    char xmit_char = response[3];
    out_state      = (xmit_char == 'P') ? 1 : 0;
    return true;
}

bool KH1RadioDriver::set_xmit_state (KXRadio & radio, bool on) {
    const char * command = on ? "HK1;" : "HK0;";
    return radio.put_to_kx_command_string (command, 1);
}

bool KH1RadioDriver::play_message_bank (KXRadio & radio, int bank) {
    const char * command = (bank == 1) ? "SW4T;SW1T;" : "SW4T;SW2T;";
    return radio.put_to_kx_command_string (command, 1);
}

bool KH1RadioDriver::tune_atu (KXRadio & radio) {
    return radio.put_to_kx_command_string ("SW3T;", 1);
}

bool KH1RadioDriver::send_keyer_message (KXRadio & radio, const char * message) {
    // get keyer speed from kh radio
    long kh_wpm;
    radio.put_to_kx_command_string ("SW2T;SW1T;", 1); // Raise/lower speed so it is displayed
    char buf[sizeof ("DS1XX WPM          ;")];
    if (radio.get_from_kx_string ("DS1", SC_KX_COMMUNICATION_RETRIES,  buf, sizeof (buf) - 1)) {
        buf[sizeof (buf) - 1] = '\0';
        char speed_char[3];
        snprintf (speed_char, sizeof (speed_char), "%.*s", 2, buf + 3); // Characters 4-5 represent speed as a string       
        kh_wpm = atoi(speed_char);
    }
    else {
        kh_wpm = 20;  // default to 20 wpm if we can't read it
    }

    int ditPeriod = 1200 / kh_wpm;  // dit period in ms
    while (*message) {
        char ch = *message++;
        if (ch == '\0')
            break;
        if (ch > 96)
            ch -= 32;                                   // convert lower case to upper case
        if (ch == 32)
            vTaskDelay(pdMS_TO_TICKS (4*ditPeriod));    // 7 total (last char includes 3)
        else {
            // send the character
            char* ptr = std::strchr(morse, ch);
            uint8_t bt = ptr - morse;
            while (bt>1) {
                uart_write_bytes (UART_NUM, "HK1;", sizeof ("HK1;") - 1);
                if (bt & 1) {
                    vTaskDelay(pdMS_TO_TICKS (ditPeriod));
                }
                else {
                    vTaskDelay(pdMS_TO_TICKS (ditPeriod*3));
                }
                uart_write_bytes (UART_NUM, "HK0;", sizeof ("HK0;") - 1);
                vTaskDelay(pdMS_TO_TICKS (ditPeriod));
                bt >>= 1;
            }
            vTaskDelay(pdMS_TO_TICKS (2*ditPeriod));     // add inter-character spacing
        }
    }

    return true;
}

bool KH1RadioDriver::sync_time (KXRadio & radio, const RadioTimeHms & client_time) {
    RadioTimeHms radio_time;
    if (!get_kh1_display_time (radio, radio_time))
        return false;

    radio.put_to_kx_command_string ("MNTIM;", 1);

    if (radio_time.min != client_time.min)
        adjust_kh1_time_component (radio, "SW3T;", client_time.min - radio_time.min);
    if (radio_time.hrs != client_time.hrs)
        adjust_kh1_time_component (radio, "SW2T;", client_time.hrs - radio_time.hrs);

    radio.put_to_kx_command_string ("SW4T;", 1);
    return true;
}

bool KH1RadioDriver::get_radio_state (KXRadio & radio, kx_state_t * state) {
    if (!state)
        return false;

    state->mode          = MODE_UNKNOWN;
    state->active_vfo    = 0;
    state->tun_pwr       = 0;
    state->audio_peaking = 0;
    return get_kh1_display_frequency (radio, state->vfo_a_freq);
}

bool KH1RadioDriver::restore_radio_state (KXRadio & radio, const kx_state_t * state, int tries) {
    if (!state)
        return false;

    return set_frequency (radio, state->vfo_a_freq, tries);
}

bool KH1RadioDriver::ft8_prepare (KXRadio & radio, long base_freq) {
    radio.put_to_kx_command_string ("FO00;", 1);
    return set_frequency (radio, base_freq, SC_KX_COMMUNICATION_RETRIES);
}

void KH1RadioDriver::ft8_tone_on (KXRadio & radio) {
    (void)radio;
    uart_write_bytes (UART_NUM, "HK1;", sizeof ("HK1;") - 1);
}

void KH1RadioDriver::ft8_tone_off (KXRadio & radio) {
    (void)radio;
    uart_write_bytes (UART_NUM, "HK0;", sizeof ("HK0;") - 1);
    uart_write_bytes (UART_NUM, "FO99;", sizeof ("FO99;") - 1);
}

void KH1RadioDriver::ft8_set_tone (KXRadio & radio, long base_freq, long frequency) {
    (void)radio;
    char command[8];
    unsigned offset = static_cast<unsigned> ((frequency - base_freq) % 100);
    snprintf (command, sizeof (command), "FO%02u;", offset);
    uart_write_bytes (UART_NUM, command, 5);
}
