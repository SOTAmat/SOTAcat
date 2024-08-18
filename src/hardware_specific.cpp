#include "hardware_specific.h"
#include <driver/gpio.h>
#include <driver/uart.h>

#include <esp_log.h>
static const char * TAG8 = "sc:hw_spec.";

SOTAcat_HW_Type HW_TYPE = SOTAcat_HW_Type::unknown;
const char *    HW_TYPE_STR  = "unknown";
uart_port_t     UART_NUM;
gpio_num_t      UART2_TX_PIN = ((gpio_num_t)-1);
gpio_num_t      UART2_RX_PIN = ((gpio_num_t)-1);
gpio_num_t      LED_BLUE     = ((gpio_num_t)-1);
gpio_num_t      LED_RED_SUPL = ((gpio_num_t)-1);
gpio_num_t      LED_RED      = ((gpio_num_t)-1);
gpio_num_t      I2C_SCL_PIN  = ((gpio_num_t)-1);
gpio_num_t      I2C_SDA_PIN  = ((gpio_num_t)-1);
gpio_num_t      USB_DET_PIN  = ((gpio_num_t)-1);
int             LED_OFF;
int             LED_ON;
int             ADC_BATTERY;

static SOTAcat_HW_Type detect_hardware_type (void) {
    ESP_LOGV (TAG8, "trace: %s()", __func__);
    /*
     * Here is where we should do the magic to determine
     * which hardware we are using.
     * See https://github.com/SOTAmat/SOTAcat/pull/42
     * and https://sota-na.slack.com/archives/C06N224JD1R/p1722108863599379 (ff.)
     * for possible methods.
     */

    // configure GPIO6 as input with a weak pull-down
    gpio_config_t io_conf;
    io_conf.intr_type    = GPIO_INTR_DISABLE;     // Disable interrupt
    io_conf.mode         = GPIO_MODE_INPUT;       // Set as input mode
    io_conf.pin_bit_mask = (1ULL << GPIO_NUM_6);  // Select GPIO6
    io_conf.pull_down_en = GPIO_PULLDOWN_ENABLE;  // Enable weak pull-down resistor
    io_conf.pull_up_en   = GPIO_PULLUP_DISABLE;   // Disable pull-up resistor
    gpio_config (&io_conf);

    // read the GPIO6 level
    int gpio_level = gpio_get_level (GPIO_NUM_6);

    // de-init GPIO6 (set back to default configuration)
    gpio_reset_pin (GPIO_NUM_6);

    // determine hardware type based on GPIO level
    if (gpio_level == 1) {
        ESP_LOGI (TAG8, "K5EM_1 hardware detected");
        return SOTAcat_HW_Type::K5EM_1;  // GPIO6 is high, K5EM_1 detected
    }
    else {
        ESP_LOGI (TAG8, "AB6D_1 hardware detected");
        return SOTAcat_HW_Type::AB6D_1;  // GPIO6 is low, AB6D_1 detected
    }
}

void set_hardware_specific (void) {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    LED_OFF = 1;
    LED_ON  = 0;

#ifdef SEEED_XIAO
    UART_NUM = UART_NUM_1;
#else
    UART_NUM = UART_NUM_2;
#endif

#ifdef SEEED_XIAO
    UART2_RX_PIN = ((gpio_num_t)20);
    LED_BLUE     = ((gpio_num_t)10);
    ADC_BATTERY  = 0;

    HW_TYPE = detect_hardware_type();
    switch (HW_TYPE) {
    case SOTAcat_HW_Type::AB6D_1:
        HW_TYPE_STR = "AB6D_1";
        UART2_TX_PIN = ((gpio_num_t)21);
        LED_RED_SUPL = ((gpio_num_t)9);
        LED_RED      = ((gpio_num_t)8);
        break;
    case SOTAcat_HW_Type::K5EM_1:
        HW_TYPE_STR = "K5EM_1";
        UART2_TX_PIN = ((gpio_num_t)4);  // deconflict with the fsbl outputs
        LED_RED      = ((gpio_num_t)9);
        LED_RED_SUPL = ((gpio_num_t)-1);  // remove second control line for red/amber LED
        USB_DET_PIN  = ((gpio_num_t)3);   // add USB detection
        I2C_SCL_PIN  = ((gpio_num_t)7);   // add I2C/SMBus battery monitor
        I2C_SDA_PIN  = ((gpio_num_t)6);   // add I2C/SMBus battery monitor
        break;
    default:
        ESP_LOGE (TAG8, "unknown hardware");
        break;
    }
#endif

#ifdef LOLIN32_LITE
    UART2_TX_PIN = 17;
    UART2_RX_PIN = 16;
    LED_BLUE     = GPIO_NUM_22;
    LED_RED_SUPL = 32;
    LED_RED      = 33;
#endif

#ifdef UM_TINYS3
    UART2_TX_PIN = GPIO_NUM_43;
    UART2_RX_PIN = GPIO_NUM_44;
    LED_BLUE     = GPIO_NUM_17;
    LED_RED_SUPL = GPIO_NUM_7;
    LED_RED      = GPIO_NUM_6;  // FIXME: strange - overridden below
    LED_RED      = 8;
#endif
}
