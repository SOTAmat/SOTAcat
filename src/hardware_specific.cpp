#include "hardware_specific.h"
#include <driver/uart.h>

#include <esp_log.h>
static const char * TAG8 = "sc:hw_spec ";

SOTAcat_HW_Type HW_TYPE = SOTAcat_HW_Type::unknown;
int             UART_NUM;
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
    /*
     * Here is where we should do the magic to determine
     * which hardware we are using.
     * See https://github.com/SOTAmat/SOTAcat/pull/42
     * and https://sota-na.slack.com/archives/C06N224JD1R/p1722108863599379 (ff.)
     * for possible methods.
     */
    if (true)  // FIXME: replace with a real detection method
        return SOTAcat_HW_Type::AB6D_1;
    else
        return SOTAcat_HW_Type::K5EM_1;
}

void set_hardware_specific (void) {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    HW_TYPE = detect_hardware_type();
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
    switch (HW_TYPE) {
    case SOTAcat_HW_Type::AB6D_1:
        UART2_TX_PIN = ((gpio_num_t)21);
        LED_RED_SUPL = ((gpio_num_t)9);
        LED_RED      = ((gpio_num_t)8);
        break;
    case SOTAcat_HW_Type::K5EM_1:
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
