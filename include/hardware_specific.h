#pragma once
#include <driver/gpio.h>
#include <driver/uart.h>

enum class SOTAcat_HW_Type {
    unknown,
    AB6D_1,  // the original hand-built shrink-tubed module
    K5EM_1   // the first module with battery monitor and professional casing
};

extern const char * HW_TYPE_STR;

extern SOTAcat_HW_Type HW_TYPE;

extern uart_port_t UART_NUM;
extern gpio_num_t  UART2_TX_PIN;
extern gpio_num_t  UART2_RX_PIN;
extern gpio_num_t  LED_BLUE;
extern gpio_num_t  LED_RED_SUPL;
extern gpio_num_t  LED_RED;
extern gpio_num_t  I2C_SCL_PIN;
extern gpio_num_t  I2C_SDA_PIN;
extern gpio_num_t  USB_DET_PIN;
extern int         LED_OFF;
extern int         LED_ON;
extern int         ADC_BATTERY;

extern void set_hardware_specific (void);
