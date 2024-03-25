#include <cstring>
#include <driver/uart.h>
#include <esp_timer.h>
#include "kx_radio.h"
#include "settings.h"
#include "settings_radio_specific.h"

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
static const char * TAG8 = "sc:kx_cmds.";

// Global static instance
KXRadio& kxRadio = KXRadio::getInstance();

/*
 * Utilities
 */

static bool uart_get_command(const char *cmd, int cmd_length, char *out_buff, int expected_chars, int tries, int wait_ms)
{
    ESP_LOGV(TAG8, "trace: %s(cmd='%s', cmd_length=%d, expect=%d)", __func__, cmd, cmd_length, expected_chars);

    uart_flush(UART_NUM);
    uart_write_bytes(UART_NUM, cmd, strlen(cmd));

    int64_t start_time = esp_timer_get_time();
    int returned_chars = uart_read_bytes(UART_NUM, out_buff, expected_chars, pdMS_TO_TICKS(wait_ms));
    int64_t end_time = esp_timer_get_time();
    float elapsed_ms = (end_time - start_time) / 1000.0;

    out_buff[returned_chars] = '\0';
    ESP_LOGI(TAG8, "command '%s' returned %d chars, '%s', after %.3f ms", cmd, returned_chars, out_buff, elapsed_ms);

    if (returned_chars == 2 && out_buff[0] == '?' && out_buff[1] == ';')
    {
        // The radio is saying it was busy and unable to respond to the command yet.
        // We need to pause a bit and try again.  We don't count this as a "retry" since it wasn't an error.
        ESP_LOGW(TAG8, "radio busy, retrying...");
        vTaskDelay(pdMS_TO_TICKS(30));
        return uart_get_command(cmd, cmd_length, out_buff, expected_chars, tries, wait_ms);
    }

    if (returned_chars != expected_chars || out_buff[0] != cmd[0] || out_buff[1] != cmd[1] ||
        (cmd_length == 3 && out_buff[2] != cmd[2]) || out_buff[expected_chars - 1] != ';') {
        ESP_LOGE(TAG8, "bad result from command '%s' after %.3f ms, returned bytes=%d, out_buff=%c%c%c%c%c%c...", cmd, elapsed_ms, returned_chars, out_buff[0], out_buff[1], out_buff[2], out_buff[3], out_buff[4], out_buff[5]);
        if (--tries > 0)
        {
            ESP_LOGI(TAG8, "Retrying...");
            kxRadio.empty_kx_input_buffer(wait_ms);
            return uart_get_command(cmd, cmd_length, out_buff, expected_chars, tries - 1, wait_ms);
        }
        return false;
    }

    return true;
}

static long parse_response(const char *out_buff, int num_digits)
{
    switch (num_digits)
    {
    case 1: // Handling n-type response
        return out_buff[2] - '0';
        break;
    case 3: // Handling nnn-type response
        return strtol(out_buff + 2, NULL, 10);
        break;
    case 11: // Handling long-type response
        return strtol(out_buff + 2, NULL, 10);
        break;
    default:
        // Invalid response size
        break;
    }

    return -1; // Invalid response size
}

KXRadio::KXRadio() :
    Lockable("radio"),
    m_is_connected(false) {}

KXRadio& KXRadio::getInstance() {
    static KXRadio instance; // Static instance
    return instance;
}

/*
 * Functions that form our public radio API
 * These should all assert that the Radio is locked()
 * It's an error somewhere up in the call stack if not.
 */

// Find out what Baud rate the radio is running at by trying the possibilities until we get a valid response back.
// Once found, if the baud rate is not 38400, force it to 38400 for FSK use (FT8, etc.)
int KXRadio::connect()
{
    if (!locked())
        ESP_LOGE(TAG8, "RADIO NOT LOCKED! (coding error in caller)");

    int baud_rates[] = {38400, 19200, 9600, 4800};
    size_t num_rates = sizeof(baud_rates) / sizeof(baud_rates[0]);

    // Install the UART driver using an event queue to handle UART events
    uart_driver_install(UART_NUM, 1024, 0, 0, NULL, 0);

    // Configure the pins for UART2 (Serial2)
    uart_config_t uart_config = {
        .baud_rate = baud_rates[0],
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .rx_flow_ctrl_thresh = 0, // not used since flow_ctrl disabled
        .source_clk = UART_SCLK_APB,
    };
    uart_param_config(UART_NUM, &uart_config);
    uart_set_pin(UART_NUM, UART2_TX_PIN, UART2_RX_PIN, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
    // Invert UART2 TX and RX signals
    uart_set_line_inverse(UART_NUM, UART_SIGNAL_RXD_INV | UART_SIGNAL_TXD_INV);

    uint8_t buffer[256];
    while (true)
    {
        for (size_t i = 0; i < num_rates; ++i)
        {
            uart_set_baudrate(UART_NUM, baud_rates[i]); // Change baud rate
            vTaskDelay(pdMS_TO_TICKS(250));             // Delay for stability before next try

            uart_flush(UART_NUM);
            uart_write_bytes(UART_NUM, ";RVR;", strlen(";RVR;"));

            int length = uart_read_bytes(UART_NUM, buffer, 256, 250 / portTICK_PERIOD_MS);
            if (length > 0)
            {
                buffer[length] = '\0'; // Null terminate the string
                ESP_LOGV(TAG8, "received %d bytes: %s", length, buffer);

                if (strstr((char *)buffer, "RVR99.99;") != NULL)
                {
                    ESP_LOGI(TAG8, "correct baud rate found: %d", baud_rates[i]);
                    uart_write_bytes(UART_NUM, ";AI0;", strlen(";AI0;"));

                    if (baud_rates[i] != 38400)
                    {
                        ESP_LOGI(TAG8, "forcing baud rate to 38400 for fsk use (ft8, etc.)...");
                        // Normally we would call "put_to_kx()" but the KX BRn; command does not allow a "get" response so we can't use that function here.
                        for (int j = 0; j < 2; j++)
                        {
                            uart_write_bytes(UART_NUM, "BR3;", strlen("BR3;"));
                            empty_kx_input_buffer(100);
                            uart_set_baudrate(UART_NUM, 38400); // Change baud rate
                        }
                    }
                    m_is_connected = true;
                    empty_kx_input_buffer(600);
                    return baud_rates[i];
                }
            }
            else
                ESP_LOGI(TAG8, "no response received for baud rate %d", baud_rates[i]);
        }
    }
}

void KXRadio::empty_kx_input_buffer(int wait_ms)
{
    ESP_LOGV(TAG8, "trace: %s()", __func__);

    if (!locked())
        ESP_LOGE(TAG8, "RADIO NOT LOCKED! (coding error in caller)");

    char in_buff[64];
    long returned_chars = uart_read_bytes(UART_NUM, in_buff, sizeof(in_buff) - 1, pdMS_TO_TICKS(wait_ms));
    in_buff[returned_chars] = '\0';
    ESP_LOGV(TAG8, "empty_kx_input_buffer() called, ate %ld bytes in %d ms with chars: %s", returned_chars, wait_ms, in_buff);
}

// --------------------------------------------------------------------------------------------
long KXRadio::get_from_kx(const char *command, int tries, int num_digits)
{
    ESP_LOGV(TAG8, "trace: %s(command = '%s')", __func__, command);

    if (!locked())
        ESP_LOGE(TAG8, "RADIO NOT LOCKED! (coding error in caller)");

    char cmd_buff[8] = {0};
    char out_buff[16] = {0};

    int command_size = strlen(command);
    if ((command_size != 2 && command_size != 3) || num_digits < 1 || num_digits > 11)
    {
        ESP_LOGE(TAG8, "invalid command '%s' and expected digits of %d", command, num_digits);
        return '\0';
    }

    int wait_time = KX_TIMEOUT_MS_SHORT_COMMANDS;

    if (strncmp(command, "AP", 2) == 0 ||
        strncmp(command, "FA", 2) == 0 ||
        strncmp(command, "FR", 2) == 0 ||
        strncmp(command, "FT", 2) == 0 ||
        strncmp(command, "MD", 2) == 0)
        wait_time = KX_TIMEOUT_MS_LONG_COMMANDS;

    snprintf(cmd_buff, sizeof(cmd_buff), "%s;", command);
    int response_size = num_digits + command_size + 1;
    if (!uart_get_command(cmd_buff, command_size, out_buff, response_size, tries, wait_time))
        return -1; // Error was already logged

    long result = parse_response(out_buff, num_digits);
    ESP_LOGI(TAG8, "kx command '%s' returns %ld", command, result);
    return result;
}

// --------------------------------------------------------------------------------------------
bool KXRadio::get_from_kx_string(const char *command, int tries, char * response, int response_size)
{
    ESP_LOGV(TAG8, "trace: %s(command = '%s')", __func__, command);

    if (!locked())
        ESP_LOGE(TAG8, "RADIO NOT LOCKED! (coding error in caller)");

    char cmd_buff[8] = {0};
    snprintf(cmd_buff, sizeof(cmd_buff), "%s;", command);

    int command_size = strlen(command);
    int wait_time = KX_TIMEOUT_MS_SHORT_COMMANDS;

    return uart_get_command(cmd_buff, command_size, response, response_size, tries, wait_time);
}

// ====================================================================================================
long KXRadio::get_from_kx_menu_item(uint8_t menu_item, int tries)
{
    ESP_LOGV(TAG8, "trace: %s()", __func__);

    if (!locked())
        ESP_LOGE(TAG8, "RADIO NOT LOCKED! (coding error in caller)");

    put_to_kx("MN", 3, menu_item, 2); // Ex. MN058;  - Switch into menu mode and select the TUN PWR menu item

    long value = get_from_kx("MP", tries, 3); // Get the menu item value

    put_to_kx("MN", 3, 255, 2); // Switch out of Menu mode

    return value;
}

// ====================================================================================================
bool KXRadio::put_to_kx(const char *command, int num_digits, long value, int tries)
{
    ESP_LOGV(TAG8, "put_to_kx('%s') attempting value %ld", command, value);

    if (!locked())
        ESP_LOGE(TAG8, "RADIO NOT LOCKED! (coding error in caller)");

    if (strlen(command) != 2 || value < 0)
    {
        ESP_LOGE(TAG8, "invalid command '%s' or value %ld", command, value);
        return false;
    }

    char out_buff[16];
    switch (num_digits)
    {
    case 1: // Handling n-type response
        if (value > 9)
        {
            ESP_LOGE(TAG8, "invalid value %u for command '%s'", (unsigned int) value, command);
            return false;
        }
        snprintf(out_buff, sizeof(out_buff), "%s%u;", command, (unsigned int) value);
        break;
    case 3: // Handling nnn-type response
        if (value > 999)
        {
            ESP_LOGE(TAG8, "invalid value %u for command '%s'", (unsigned int) value, command);
            return false;
        }
        snprintf(out_buff, sizeof(out_buff), "%s%03u;", command, (unsigned int) value);
        break;
    case 11: // Handling long-type response
        snprintf(out_buff, sizeof(out_buff), "%s%011ld;", command, value);
        break;
    default:
        ESP_LOGE(TAG8, "invalid num_digits and command '%s' with value %ld", command, value);
        return false;
    }

    long adjusted_value = value;
    if (num_digits == 11)
    {
        // The radio only reports frequencies in 10's of Hz, so we have to make sure the last digit is a 0.
        adjusted_value = ((long) (value / 10)) * 10;
    }

    for (int attempt = 0; attempt < tries; attempt++)
    {
        uart_flush(UART_NUM);
        uart_write_bytes(UART_NUM, out_buff, num_digits + 3);

        // Now read-back the value to verify it was set correctly
        long out_value = get_from_kx(command, 1, num_digits);

        if (out_value == adjusted_value)
        {
            ESP_LOGI(TAG8, "command '%s' successful; value = %ld", command, adjusted_value);
            return true;
        }
 
        ESP_LOGE(TAG8, "failed to set '%s' to %ld on %d tries", command, value, attempt + 1);
    }

    return false;
}

// ====================================================================================================
bool KXRadio::put_to_kx_menu_item(uint8_t menu_item, long value, int tries)
{
    ESP_LOGV(TAG8, "trace: %s()", __func__);

    if (!locked())
        ESP_LOGE(TAG8, "RADIO NOT LOCKED! (coding error in caller)");

    put_to_kx("MN", 3, menu_item, 2); // Ex. MN058;  - Switch into menu mode and select the TUN PWR menu item

    // Get the menu item value
    put_to_kx("MP", 3, value, tries); // Ex. MP010; - Set the TUN PWR to 1.0 watts

    // Switch out of Menu mode
    put_to_kx("MN", 3, 255, 2); // Switch out of Menu mode

    return value;
}

// ====================================================================================================
bool KXRadio::put_to_kx_command_string(const char * cmd, int tries) {
    ESP_LOGV(TAG8, "trace: %s(cmd = '%s')", __func__, cmd);

    if (!locked())
        ESP_LOGE(TAG8, "RADIO NOT LOCKED! (coding error in caller)");

    uart_flush(UART_NUM);
    uart_write_bytes(UART_NUM, cmd, strlen(cmd));

    return true;
}

/**
 * Get the current radio state
 */
void KXRadio::get_kx_state(kx_state_t *in_state)
{
    ESP_LOGV(TAG8, "trace: %s()", __func__);

    if (!locked())
        ESP_LOGE(TAG8, "RADIO NOT LOCKED! (coding error in caller)");

    in_state->active_vfo = (uint8_t)get_from_kx("FT", 2, 1);   // FTn; - Get current VFO:  0 for VFO A, 1 for VFO B
    in_state->vfo_a_freq = get_from_kx("FA", 2, 11);           // FAnnnnnnnnnnn; - Get the current frequency A
    in_state->tun_pwr = (uint8_t)get_from_kx_menu_item(58, 2); // MN058;MPnnn; - Get the current TUN PWR setting
    in_state->mode = (uint8_t)get_from_kx("MD", 2, 1);         // MDn; - Get current mode: 1 (LSB), 2 (USB), 3 (CW), 4 (FM), 5 (AM), 6 (DATA), 7 (CWREV), or 9 (DATA-REV)
    put_to_kx("MD", 1, 3, 2);                          // To get the peaking filter mode we have to be in CW mode: MD3;
    in_state->audio_peaking = get_from_kx("AP", 2, 1);         // APn; - Get Audio Peaking CW filter: 0 for APF OFF and 1 for APF ON
    put_to_kx("MD", 1, in_state->mode, 2);             // Now return to the prior mode
}

/**
 * Restore the radio to its prior state
 */
void KXRadio::restore_kx_state(const kx_state_t *in_state, int tries)
{
    ESP_LOGV(TAG8, "trace: %s()", __func__);

    if (!locked())
        ESP_LOGE(TAG8, "RADIO NOT LOCKED! (coding error in caller)");

    put_to_kx("MD", 1, 3, 2);                       // To reset the Peaking Filter mode we have to be in CW mode: MD3;
    put_to_kx("AP", 1, in_state->audio_peaking, 2); // APn;
    put_to_kx("MD", 1, in_state->mode, 2);
    put_to_kx("FA", 11, in_state->vfo_a_freq, 2);
    put_to_kx("FT", 1, in_state->active_vfo, 2);
    put_to_kx_menu_item(58, in_state->tun_pwr, 2);

    ESP_LOGI(TAG8, "restore done");
}
