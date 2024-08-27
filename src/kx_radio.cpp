#include "kx_radio.h"
#include "hardware_specific.h"

#include <cstring>
#include <driver/uart.h>
#include <esp_timer.h>

/*
 * See https://ftp.elecraft.com/KX2/Manuals%20Downloads/K3S&K3&KX3&KX2%20Pgmrs%20Ref,%20G4.pdf
 * for full KX command documentation
 *
 * Example commands:
 *   APn; - Get the current Audio Peaking filter setting for CW: 0 for APF OFF and 1 for APF ON
 *   MDn; - Get the current mode: 1 (LSB), 2 (USB), 3 (CW), 4 (FM), 5 (AM), 6 (DATA), 7 (CWREV), or 9 (DATA-REV)
 *   FTn; - Get the current VFO:  0 for VFO A, 1 for VFO B
 *   MN058;MP; - Get the current TUN PWR setting
 *   FAnnnnnnnnnnn; - Get the current frequency A
 */

#include <esp_log.h>
static const char * TAG8 = "sc:kx_radio";

// Global static instance
KXRadio & kxRadio = KXRadio::getInstance();

// 0.5 seconds / 500 ms
#define KX_TIMEOUT_MS_SHORT_COMMANDS 100
#define KX_TIMEOUT_MS_LONG_COMMANDS  1000

/*
 * Utilities
 */

/**
 * Sends a command via UART, reads the response, checks for validity, and retries if necessary.
 * Handles errors like the device being busy and logs detailed communication status.
 *
 * @param cmd Command to be sent to UART.
 * @param cmd_length Length of the command.
 * @param out_buff Buffer to store the response.
 * @param expected_chars Expected number of characters in the response.
 * @param tries Number of retries for the command.
 * @param wait_ms Milliseconds to wait for a response.
 * @return bool True if successful, false otherwise.
 */
static bool uart_get_command (const char * cmd, int cmd_length, char * out_buff, int expected_chars, int tries, int wait_ms) {
    ESP_LOGV (TAG8, "trace: %s(cmd='%s', cmd_length=%d, expect=%d)", __func__, cmd, cmd_length, expected_chars);

    uart_flush (UART_NUM);
    uart_write_bytes (UART_NUM, cmd, strlen (cmd));

    int64_t start_time     = esp_timer_get_time();
    int     returned_chars = uart_read_bytes (UART_NUM, out_buff, expected_chars, pdMS_TO_TICKS (wait_ms));
    int64_t end_time       = esp_timer_get_time();
    float   elapsed_ms     = (end_time - start_time) / 1000.0;

    out_buff[returned_chars] = '\0';
    ESP_LOGD (TAG8, "command '%s' returned %d chars, '%s', after %.3f ms", cmd, returned_chars, out_buff, elapsed_ms);

    if (returned_chars == 2 && out_buff[0] == '?' && out_buff[1] == ';') {
        // The radio is saying it was busy and unable to respond to the command yet.
        // We need to pause a bit and try again.  We don't count this as a "retry" since it wasn't an error.
        ESP_LOGW (TAG8, "radio busy, retrying...");
        vTaskDelay (pdMS_TO_TICKS (30));
        return uart_get_command (cmd, cmd_length, out_buff, expected_chars, tries, wait_ms);
    }

    if (returned_chars != expected_chars || out_buff[0] != cmd[0] || out_buff[1] != cmd[1] ||
        (cmd_length == 3 && out_buff[2] != cmd[2]) || out_buff[expected_chars - 1] != ';') {
        ESP_LOGE (TAG8, "bad result from command '%s' after %.3f ms, returned bytes=%d, out_buff=%c%c%c%c%c%c...", cmd, elapsed_ms, returned_chars, out_buff[0], out_buff[1], out_buff[2], out_buff[3], out_buff[4], out_buff[5]);
        if (--tries > 0) {
            ESP_LOGI (TAG8, "Retrying...");
            kxRadio.empty_kx_input_buffer (wait_ms);
            return uart_get_command (cmd, cmd_length, out_buff, expected_chars, tries - 1, wait_ms);
        }
        return false;
    }

    return true;
}

/**
 * Parses a numeric response based on the expected format and number of digits.
 *
 * @param out_buff Buffer containing the response.
 * @param num_digits Number of digits expected in the response.
 * @return long Parsed numeric value from the response.
 */
static long parse_response (const char * out_buff, int num_digits) {
    switch (num_digits) {
    case 1:  // Handling n-type response
        return out_buff[2] - '0';
        break;
    case 3:  // Handling nnn-type response
        return strtol (out_buff + 2, NULL, 10);
        break;
    case 11:  // Handling long-type response
        return strtol (out_buff + 2, NULL, 10);
        break;
    default:
        // Invalid response size
        break;
    }

    return -1;  // Invalid response size
}

KXRadio::KXRadio()
    : Lockable ("radio")
    , m_is_connected (false) {}

KXRadio & KXRadio::getInstance() {
    static KXRadio instance;  // Static instance
    return instance;
}

/*
 * Functions that form our public radio API
 * These should all assert that the Radio is locked()
 * It's an error somewhere up in the call stack if not.
 */

/**
 * Tries to establish a UART connection with the radio at various baud rates, configures UART settings,
 * and attempts to lock in the baud rate at 38400 for subsequent communication.
 *
 * @return int Baud rate that was successfully set.
 *
 * Preconditions:
 *   The radio must be locked before calling this function. If not, an error is logged.
 */
int KXRadio::connect() {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    if (!locked())
        ESP_LOGE (TAG8, "RADIO NOT LOCKED! (coding error in caller)");

    int    baud_rates[] = {38400, 19200, 9600, 4800};
    size_t num_rates    = sizeof (baud_rates) / sizeof (baud_rates[0]);

    // Install the UART driver using an event queue to handle UART events
    uart_driver_install (UART_NUM, 1024, 0, 0, NULL, 0);

    // Configure the pins for UART2 (Serial2)
    uart_config_t uart_config = {
        .baud_rate           = baud_rates[0],
        .data_bits           = UART_DATA_8_BITS,
        .parity              = UART_PARITY_DISABLE,
        .stop_bits           = UART_STOP_BITS_1,
        .flow_ctrl           = UART_HW_FLOWCTRL_DISABLE,
        .rx_flow_ctrl_thresh = 0,  // not used since flow_ctrl disabled
        .source_clk          = UART_SCLK_APB,
    };
    uart_param_config (UART_NUM, &uart_config);
    uart_set_pin (UART_NUM, UART2_TX_PIN, UART2_RX_PIN, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
    if (HW_TYPE == SOTAcat_HW_Type::AB6D_1) {
        // Invert UART2 TX and RX signals
        uart_set_line_inverse (UART_NUM, UART_SIGNAL_RXD_INV | UART_SIGNAL_TXD_INV);
    }

    uint8_t buffer[256];
    while (true) {
        for (size_t i = 0; i < num_rates; ++i) {
            uart_set_baudrate (UART_NUM, baud_rates[i]);  // Change baud rate
            vTaskDelay (pdMS_TO_TICKS (250));             // Delay for stability before next try

            uart_flush (UART_NUM);
            uart_write_bytes (UART_NUM, ";RVR;", strlen (";RVR;"));

            int length = uart_read_bytes (UART_NUM, buffer, 256, 250 / portTICK_PERIOD_MS);
            if (length > 0) {
                buffer[length] = '\0';  // Null terminate the string
                ESP_LOGV (TAG8, "received %d bytes: %s", length, buffer);

                if (strstr ((char *)buffer, "RVR99.99;") != NULL) {
                    ESP_LOGI (TAG8, "correct baud rate found: %d", baud_rates[i]);
                    uart_write_bytes (UART_NUM, ";AI0;", strlen (";AI0;"));

                    if (baud_rates[i] != 38400) {
                        ESP_LOGI (TAG8, "forcing baud rate to 38400 for fsk use (ft8, etc.)...");
                        // Normally we would call "put_to_kx()" but the KX BRn; command does not allow a "get" response so we can't use that function here.
                        for (int j = 0; j < 2; j++) {
                            uart_write_bytes (UART_NUM, "BR3;", strlen ("BR3;"));
                            empty_kx_input_buffer (100);
                            uart_set_baudrate (UART_NUM, 38400);  // Change baud rate
                        }
                    }
                    m_is_connected = true;
                    empty_kx_input_buffer (600);
                    return baud_rates[i];
                }
            }
            else
                ESP_LOGI (TAG8, "no response received for baud rate %d", baud_rates[i]);
        }
    }
}

/**
 * Clears the UART input buffer, logging the discarded data.
 *
 * @param wait_ms Milliseconds to wait while reading from the buffer.
 *
 * Preconditions:
 *   The radio must be locked before calling this function. If not, an error is logged.
 */
void KXRadio::empty_kx_input_buffer (int wait_ms) {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    if (!locked())
        ESP_LOGE (TAG8, "RADIO NOT LOCKED! (coding error in caller)");

    char in_buff[64];
    long returned_chars     = uart_read_bytes (UART_NUM, in_buff, sizeof (in_buff) - 1, pdMS_TO_TICKS (wait_ms));
    in_buff[returned_chars] = '\0';
    ESP_LOGV (TAG8, "empty_kx_input_buffer() called, ate %ld bytes in %d ms with chars: %s", returned_chars, wait_ms, in_buff);
}

/**
 * Sends a command to the radio and retrieves a numeric response, handling retries and timeouts.
 *
 * @param command Command to be sent.
 * @param tries Number of attempts to successfully execute the command.
 * @param num_digits Number of digits in the expected response.
 * @return long Value retrieved from the response.
 *
 * Preconditions:
 *   The radio must be locked before calling this function. If not, an error is logged.
 */
long KXRadio::get_from_kx (const char * command, int tries, int num_digits) {
    ESP_LOGV (TAG8, "trace: %s(command = '%s')", __func__, command);

    if (!locked())
        ESP_LOGE (TAG8, "RADIO NOT LOCKED! (coding error in caller)");

    char cmd_buff[8]  = {0};
    char out_buff[16] = {0};

    int command_size = strlen (command);
    if ((command_size != 2 && command_size != 3) || num_digits < 1 || num_digits > 11) {
        ESP_LOGE (TAG8, "invalid command '%s' and expected digits of %d", command, num_digits);
        return '\0';
    }

    int wait_time = KX_TIMEOUT_MS_SHORT_COMMANDS;

    const char * long_command_prefixes = "AP FA FR FT MD PC";
    if (command != NULL && strstr (long_command_prefixes, command) != NULL)
        wait_time = KX_TIMEOUT_MS_LONG_COMMANDS;

    snprintf (cmd_buff, sizeof (cmd_buff), "%s;", command);
    int response_size = num_digits + command_size + 1;
    if (!uart_get_command (cmd_buff, command_size, out_buff, response_size, tries, wait_time))
        return -1;  // Error was already logged

    long result = parse_response (out_buff, num_digits);
    ESP_LOGD (TAG8, "kx command '%s' returns %ld", command, result);
    return result;
}

/**
 * Sends a string command to the radio and retrieves a string response. It handles retries
 * and uses specific timeout settings for communication.
 *
 * @param command The command string to be sent to the radio.
 * @param tries The number of attempts to execute the command successfully.
 * @param response Buffer to store the received response.
 * @param response_size The size of the response buffer.
 * @return bool True if the command was executed and a response was received successfully, false otherwise.
 *
 * Preconditions:
 *   The radio must be locked before calling this function. If not, an error is logged.
 */
bool KXRadio::get_from_kx_string (const char * command, int tries, char * response, int response_size) {
    ESP_LOGV (TAG8, "trace: %s(command = '%s')", __func__, command);

    if (!locked())
        ESP_LOGE (TAG8, "RADIO NOT LOCKED! (coding error in caller)");

    char cmd_buff[8] = {0};
    snprintf (cmd_buff, sizeof (cmd_buff), "%s;", command);

    int command_size = strlen (command);
    int wait_time    = KX_TIMEOUT_MS_SHORT_COMMANDS;

    return uart_get_command (cmd_buff, command_size, response, response_size, tries, wait_time);
}

/**
 * Retrieves a specific menu item's value from the radio. It involves switching to the
 * menu mode, retrieving the value, and then exiting the menu mode.
 *
 * @param menu_item The menu item number to query.
 * @param tries The number of attempts to execute the command and retrieve the value.
 * @return long The retrieved value of the menu item.
 *
 * Preconditions:
 *   The radio must be locked before calling this function. If not, an error is logged.
 */
long KXRadio::get_from_kx_menu_item (uint8_t menu_item, int tries) {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    if (!locked())
        ESP_LOGE (TAG8, "RADIO NOT LOCKED! (coding error in caller)");

    put_to_kx ("MN", 3, menu_item, SC_KX_COMMUNICATION_RETRIES);  // Ex. MN058;  - Switch into menu mode and select the TUN PWR menu item

    long value = get_from_kx ("MP", tries, 3);  // Get the menu item value

    put_to_kx ("MN", 3, 255, SC_KX_COMMUNICATION_RETRIES);  // Switch out of Menu mode

    return value;
}

/**
 * Sends a command to set a value on the radio, verifies the set operation, and retries if necessary.
 *
 * @param command Command to send.
 * @param num_digits Expected number of digits in the command.
 * @param value Value to be set by the command.
 * @param tries Number of attempts to successfully execute the command.
 * @return bool True if successful, false otherwise.
 *
 * Preconditions:
 *   The radio must be locked before calling this function. If not, an error is logged.
 */
bool KXRadio::put_to_kx (const char * command, int num_digits, long value, int tries) {
    ESP_LOGV (TAG8, "put_to_kx('%s') attempting value %ld", command, value);

    if (!locked())
        ESP_LOGE (TAG8, "RADIO NOT LOCKED! (coding error in caller)");

    if (strlen (command) != 2 || value < 0) {
        ESP_LOGE (TAG8, "invalid command '%s' or value %ld", command, value);
        return false;
    }

    char out_buff[16];
    switch (num_digits) {
    case 1:  // Handling n-type response
        if (value > 9) {
            ESP_LOGE (TAG8, "invalid value %u for command '%s'", (unsigned int)value, command);
            return false;
        }
        snprintf (out_buff, sizeof (out_buff), "%s%u;", command, (unsigned int)value);
        break;
    case 3:  // Handling nnn-type response
        if (value > 999) {
            ESP_LOGE (TAG8, "invalid value %u for command '%s'", (unsigned int)value, command);
            return false;
        }
        snprintf (out_buff, sizeof (out_buff), "%s%03u;", command, (unsigned int)value);
        break;
    case 11:  // Handling long-type response
        snprintf (out_buff, sizeof (out_buff), "%s%011ld;", command, value);
        break;
    default:
        ESP_LOGE (TAG8, "invalid num_digits and command '%s' with value %ld", command, value);
        return false;
    }

    long adjusted_value = value;
    if (num_digits == 11) {
        // The radio only reports frequencies in 10's of Hz, so we have to make sure the last digit is a 0.
        adjusted_value = ((long)(value / 10)) * 10;
    }

    for (int attempt = 0; attempt < tries; attempt++) {
        uart_flush (UART_NUM);
        uart_write_bytes (UART_NUM, out_buff, num_digits + 3);

        // Now read-back the value to verify it was set correctly
        long out_value = get_from_kx (command, 2, num_digits);

        if (out_value == adjusted_value) {
            ESP_LOGI (TAG8, "command '%s' successful; value = %ld", command, adjusted_value);
            return true;
        }

        ESP_LOGE (TAG8, "failed to set '%s' to %ld on %d tries", command, value, attempt + 1);
    }

    return false;
}

/**
 * Sets a specific menu item's value on the radio. This function includes steps to switch
 * into menu mode, set the menu item value, and then exit menu mode.
 *
 * @param menu_item The menu item number to be set.
 * @param value The value to set for the menu item.
 * @param tries The number of attempts to successfully execute the command.
 * @return bool True if the menu item value is successfully set, false otherwise.
 *
 * Preconditions:
 *   The radio must be locked before calling this function. If not, an error is logged.
 */
bool KXRadio::put_to_kx_menu_item (uint8_t menu_item, long value, int tries) {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    if (!locked())
        ESP_LOGE (TAG8, "RADIO NOT LOCKED! (coding error in caller)");

    put_to_kx ("MN", 3, menu_item, SC_KX_COMMUNICATION_RETRIES);  // Ex. MN058;  - Switch into menu mode and select the TUN PWR menu item

    // Set the menu item value
    put_to_kx ("MP", 3, value, tries);  // Ex. MP010; - Set the TUN PWR to 1.0 watts

    // Switch out of Menu mode
    put_to_kx ("MN", 3, 255, SC_KX_COMMUNICATION_RETRIES);  // Switch out of Menu mode

    return value;
}

/**
 * Sends a custom command string to the radio via UART. This function is typically used for
 * commands that do not require a response to be checked.
 *
 * @param cmd The command string to be sent to the radio.
 * @param tries The number of attempts to send the command.
 * @return bool Always returns true, indicating the command was sent.
 *
 * Preconditions:
 *   The radio must be locked before calling this function. If not, an error is logged.
 */
bool KXRadio::put_to_kx_command_string (const char * cmd, int tries) {
    ESP_LOGV (TAG8, "trace: %s(cmd = '%s')", __func__, cmd);

    if (!locked())
        ESP_LOGE (TAG8, "RADIO NOT LOCKED! (coding error in caller)");

    uart_flush (UART_NUM);
    uart_write_bytes (UART_NUM, cmd, strlen (cmd));

    return true;
}

/**
 * Retrieves and updates the current state of the radio into the provided structure. It gathers
 * settings such as the current mode, frequency of VFO A, active VFO, tuning power, and the status
 * of the audio peaking filter. This function also temporarily switches the radio mode to ensure
 * accurate retrieval of the audio peaking filter status.
 *
 * @param in_state Structure to store the current state of the radio.
 *
 * Preconditions:
 *   The radio must be locked before calling this function. If not, an error is logged.
 */
void KXRadio::get_kx_state (kx_state_t * in_state) {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    if (!locked())
        ESP_LOGE (TAG8, "RADIO NOT LOCKED! (coding error in caller)");

    in_state->mode = (radio_mode_t)get_from_kx ("MD", SC_KX_COMMUNICATION_RETRIES, 1);        // MDn; - Get current mode: 1 (LSB), 2 (USB), 3 (CW), 4 (FM), 5 (AM), 6 (DATA), 7 (CWREV), or 9 (DATA-REV)
    put_to_kx ("MD", 1, MODE_CW, SC_KX_COMMUNICATION_RETRIES);                                // To get the peaking filter mode we have to be in CW mode: MD3;
    in_state->audio_peaking = get_from_kx ("AP", SC_KX_COMMUNICATION_RETRIES, 1);             //   APn; - Get Audio Peaking CW filter: 0 for APF OFF and 1 for APF ON
    put_to_kx ("MD", 1, in_state->mode, SC_KX_COMMUNICATION_RETRIES);                         // Now return to the prior mode
    in_state->vfo_a_freq = get_from_kx ("FA", SC_KX_COMMUNICATION_RETRIES, 11);               // FAnnnnnnnnnnn; - Get the current frequency A
    in_state->active_vfo = (uint8_t)get_from_kx ("FT", SC_KX_COMMUNICATION_RETRIES, 1);       // FTn; - Get current VFO:  0 for VFO A, 1 for VFO B
    in_state->tun_pwr    = (uint8_t)get_from_kx_menu_item (58, SC_KX_COMMUNICATION_RETRIES);  // MN058;MPnnn; - Get the current TUN PWR setting
}

/**
 * Restores the radio's settings from the provided state structure, including mode, frequency,
 * and other operational parameters.
 *
 * @param in_state Structure containing the state to restore.
 * @param tries Number of attempts to successfully restore the state.
 *
 * Preconditions:
 *   The radio must be locked before calling this function. If not, an error is logged.
 */
void KXRadio::restore_kx_state (const kx_state_t * in_state, int tries) {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    if (!locked())
        ESP_LOGE (TAG8, "RADIO NOT LOCKED! (coding error in caller)");

    put_to_kx ("MD", 1, MODE_CW, SC_KX_COMMUNICATION_RETRIES);                  // To reset the Peaking Filter mode we have to be in CW mode: MD3;
    put_to_kx ("AP", 1, in_state->audio_peaking, SC_KX_COMMUNICATION_RETRIES);  // APn;
    put_to_kx ("MD", 1, in_state->mode, SC_KX_COMMUNICATION_RETRIES);
    put_to_kx ("FA", 11, in_state->vfo_a_freq, SC_KX_COMMUNICATION_RETRIES);
    put_to_kx ("FT", 1, in_state->active_vfo, SC_KX_COMMUNICATION_RETRIES);
    put_to_kx_menu_item (58, in_state->tun_pwr, SC_KX_COMMUNICATION_RETRIES);

    ESP_LOGI (TAG8, "restore done");
}
