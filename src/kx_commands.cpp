#include "driver/uart.h"
#include "esp_http_server.h"
#include "esp_timer.h"
#include "kx_commands.h"
#include "globals.h"
#include "settings.h"
#include "settings_radio_specific.h"

#include "esp_log.h"
static const char * TAG8 = "sc:kx_cmds.";

/**
 * The mutex lock on the serial port / uart for ACC comm to/fron the radio
 */

Lock::Lock() :
    m_locked(false) {
    m_mutex = xSemaphoreCreateMutex();
}

void Lock::lock() {
    ESP_LOGI(TAG8, "locking radio");
    xSemaphoreTake(m_mutex, portMAX_DELAY);
    m_locked = true;
    ESP_LOGI(TAG8, "radio LOCKED --");
}

void Lock::unlock() {
    xSemaphoreGive(m_mutex);
    m_locked = false;
    ESP_LOGI(TAG8, "-- radio UNLOCKED");
}

Lock RadioPortLock;

/**
 * Functions that directly communicate with the radio
 * These should all assert that the RadioPortLock is locked()
 * It's an error somewhere up in the call stack if not.
 */

void empty_kx_input_buffer(int wait_ms)
{
    ESP_LOGV(TAG8, "trace: %s()", __func__);

    if (!RadioPortLock.locked())
        ESP_LOGE(TAG8, "RADIO PORT NOT LOCKED! (coding error in caller)");

    char in_buff[64];
    long returned_chars = uart_read_bytes(UART_NUM, in_buff, sizeof(in_buff) - 1, pdMS_TO_TICKS(wait_ms));
    in_buff[returned_chars] = '\0';
    ESP_LOGV(TAG8, "empty_kx_input_buffer() called, ate %ld bytes in %d ms with chars: %s", returned_chars, wait_ms, in_buff);
}

// MDn; - Get the current mode: 1 (LSB), 2 (USB), 3 (CW), 4 (FM), 5 (AM), 6 (DATA), 7 (CWREV), or 9 (DATA-REV)
// FTn; - Get the current VFO:  0 for VFO A, 1 for VFO B
// FAnnnnnnnnnnn; - Get the current frequency A
// MN058;MP; - Get the current TUN PWR setting
// APn; - Get the current Audio Peaking filter setting for CW: 0 for APF OFF and 1 for APF ON

// --------------------------------------------------------------------------------------------
static bool uart_get_command(const char *cmd, int cmd_length, char *out_buff, int expected_chars, int tries, int wait_ms)
{
    ESP_LOGV(TAG8, "trace: %s()", __func__);

    if (!RadioPortLock.locked())
        ESP_LOGE(TAG8, "RADIO PORT NOT LOCKED! (coding error in caller)");

    uart_flush(UART_NUM);
    uart_write_bytes(UART_NUM, cmd, strlen(cmd));

    int64_t start_time = esp_timer_get_time();

    int returned_chars = uart_read_bytes(UART_NUM, out_buff, expected_chars, pdMS_TO_TICKS(wait_ms));

    if (returned_chars == 2 && out_buff[0] == '?' && out_buff[1] == ';')
    {
        // The radio is saying it was busy and unable to respond to the command yet.
        // We need to pause a bit and try again.  We don't count this as a "retry" since it wasn't an error.
        ESP_LOGW(TAG8, "radio busy, retrying...");
        vTaskDelay(pdMS_TO_TICKS(30));
        return uart_get_command(cmd, cmd_length, out_buff, expected_chars, tries, wait_ms);
    }

    int64_t end_time = esp_timer_get_time();
    float elapsed_ms = (end_time - start_time) / 1000.0;

    bool bad_response = false;

    if (returned_chars != expected_chars || out_buff[0] != cmd[0] || out_buff[1] != cmd[1] || (cmd_length == 3 && out_buff[2] != cmd[2]) || out_buff[expected_chars - 1] != ';')
        bad_response = true;
    else
    {
        // Check that all the value characters are digits
        for (int i = cmd_length; i < expected_chars - 1; i++)
        {
            if (out_buff[i] < '0' || out_buff[i] > '9')
            {
                bad_response = true;
                break;
            }
        }
    }

    if (bad_response)
    {
        ESP_LOGE(TAG8, "bad result from command '%s' after %.3f ms, returned bytes=%d, out_buff=%c%c%c%c%c%c...", cmd, elapsed_ms, returned_chars, out_buff[0], out_buff[1], out_buff[2], out_buff[3], out_buff[4], out_buff[5]);
        if (--tries > 0)
        {
            ESP_LOGI(TAG8, "Retrying...");
            empty_kx_input_buffer(wait_ms);
            return uart_get_command(cmd, cmd_length, out_buff, expected_chars, tries - 1, wait_ms);
        }

        return false;
    }

    out_buff[expected_chars - 1] = '\0'; // Null terminate the string after the semicolon
    ESP_LOGI(TAG8, "command '%s' returned '%s' after %.3f ms", cmd, out_buff, elapsed_ms);
    return true;
}

/*
 * Utilities
 */

// --------------------------------------------------------------------------------------------
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

/**
 * Functions that form our radio API
 */

// --------------------------------------------------------------------------------------------
long get_from_kx(const char *command, int tries, int num_digits)
{
    ESP_LOGV(TAG8, "trace: %s()", __func__);

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

// ====================================================================================================
long get_from_kx_menu_item(uint8_t menu_item, int tries)
{
    ESP_LOGV(TAG8, "trace: %s()", __func__);

    put_to_kx("MN", 3, menu_item, 2); // Ex. MN058;  - Switch into menu mode and select the TUN PWR menu item

    long value = get_from_kx("MP", tries, 3); // Get the menu item value

    put_to_kx("MN", 3, 255, 2); // Switch out of Menu mode

    return value;
}

// ====================================================================================================
bool put_to_kx(const char *command, int num_digits, long value, int tries)
{
    ESP_LOGV(TAG8, "put_to_kx(%s) attempting value %ld", command, value);

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
bool put_to_kx_menu_item(uint8_t menu_item, long value, int tries)
{
    ESP_LOGV(TAG8, "trace: %s()", __func__);

    put_to_kx("MN", 3, menu_item, 2); // Ex. MN058;  - Switch into menu mode and select the TUN PWR menu item

    // Get the menu item value
    put_to_kx("MP", 3, value, tries); // Ex. MP010; - Set the TUN PWR to 1.0 watts

    // Switch out of Menu mode
    put_to_kx("MN", 3, 255, 2); // Switch out of Menu mode

    return value;
}

// ====================================================================================================
void get_kx_state(kx_state_t *in_state)
{
    ESP_LOGV(TAG8, "trace: %s()", __func__);

    // Get the current radio state
    in_state->active_vfo = (uint8_t)get_from_kx("FT", 2, 1);   // FTn; - Get current VFO:  0 for VFO A, 1 for VFO B
    in_state->vfo_a_freq = get_from_kx("FA", 2, 11);           // FAnnnnnnnnnnn; - Get the current frequency A
    in_state->tun_pwr = (uint8_t)get_from_kx_menu_item(58, 2); // MN058;MPnnn; - Get the current TUN PWR setting

    in_state->mode = (uint8_t)get_from_kx("MD", 2, 1); // MDn; - Get current mode: 1 (LSB), 2 (USB), 3 (CW), 4 (FM), 5 (AM), 6 (DATA), 7 (CWREV), or 9 (DATA-REV)
    put_to_kx("MD", 1, 3, 2);                          // To get the peaking filter mode we have to be in CW mode
    in_state->audio_peaking = get_from_kx("AP", 2, 1); // APn; - Get Audio Peaking CW filter: 0 for APF OFF and 1 for APF ON
    put_to_kx("MD", 1, in_state->mode, 2);             // Now return to the prior mode
}

// ====================================================================================================
// Restore the radio to its prior state
void restore_kx_state(const kx_state_t *in_state, int tries)
{
    ESP_LOGV(TAG8, "trace: %s()", __func__);

    put_to_kx("MD", 1, 3, 2);                       // To reset the Peaking Filter mode we have to be in CW mode: MD3;
    put_to_kx("AP", 1, in_state->audio_peaking, 2); // APn;

    put_to_kx("MD", 1, in_state->mode, 2);
    put_to_kx("FA", 11, in_state->vfo_a_freq, 2);
    put_to_kx("FT", 1, in_state->active_vfo, 2);
    put_to_kx_menu_item(58, in_state->tun_pwr, 2);

    ESP_LOGI(TAG8, "restore done");
}
