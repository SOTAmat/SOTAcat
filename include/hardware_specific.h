#pragma once
#include <driver/gpio.h>

enum class SOTAcat_HW_Type {
    unknown,
    AB6D_1,  // the original hand-built shrink-tubed module
    K5EM_1   // the first module with battery monitor and professional casing
};

extern SOTAcat_HW_Type HW_TYPE;

extern int        UART_NUM;
extern gpio_num_t UART2_TX_PIN;
extern gpio_num_t UART2_RX_PIN;
extern gpio_num_t LED_BLUE;
extern gpio_num_t LED_RED_SUPL;
extern gpio_num_t LED_RED;
extern int        LED_OFF;
extern int        LED_ON;
extern int        ADC_BATTERY;

extern void set_hardware_specific (void);
