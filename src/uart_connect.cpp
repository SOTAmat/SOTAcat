#include <string.h>
#include "driver/uart.h"
#include "esp_log.h"
#include "globals.h"
#include "kx_commands.h"
#include "settings.h"
#include "uart_connect.h"

int uart_connect()
{
    // Configure the pins for UART2 (Serial2)
    uart_config_t uart_config = {
        .baud_rate = 19200,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_APB,
    };

    // Install the UART driver using an event queue to handle UART events
    uart_driver_install(UART_NUM, 1024, 0, 0, NULL, 0);
    uart_param_config(UART_NUM, &uart_config);
    uart_set_pin(UART_NUM, UART2_TX_PIN, UART2_RX_PIN, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
    // Invert UART2 TX and RX signals
    uart_set_line_inverse(UART_NUM, UART_SIGNAL_RXD_INV | UART_SIGNAL_TXD_INV);

    int baud_rates[] = {4800, 9600, 19200, 38400};
    size_t num_rates = sizeof(baud_rates) / sizeof(baud_rates[0]);
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
                ESP_LOGI(TAG, "Received %d bytes: %s", length, buffer);

                if (strstr((char *)buffer, "RVR99.99;") != NULL)
                {
                    ESP_LOGI(TAG, "-------------------Correct baud rate found: %d", baud_rates[i]);
                    uart_write_bytes(UART_NUM, ";AI0;", strlen(";AI0;"));

                    if (baud_rates[i] != 38400)
                    {
                        ESP_LOGI(TAG, "Forcing baud rate to 38400 for FSK use (FT8, etc.)...");
                        // Normally we would call "put_to_kx()" but the KX BRn; command does not allow a "get" response so we can't use that function here.
                        for (int j = 0; j < 2; j++)
                        {
                            uart_write_bytes(UART_NUM, "BR3;", strlen("BR3;"));
                            empty_kx_input_buffer(100);
                            uart_set_baudrate(UART_NUM, 38400); // Change baud rate
                        }
                    }
                    return baud_rates[i];
                }
            }
            else
            {
                ESP_LOGI(TAG, "No response received for baud rate %d", baud_rates[i]);
            }
        }
    }
}
