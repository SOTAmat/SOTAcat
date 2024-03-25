#pragma once

#ifdef SEEED_XIAO
#define UART_NUM UART_NUM_1
#else
#define UART_NUM UART_NUM_2
#endif

#ifdef SEEED_XIAO
#define UART2_TX_PIN 21
#define UART2_RX_PIN 20
#define LED_BLUE ((gpio_num_t)10)
#define LED_RED_SUPL ((gpio_num_t)9)
#define LED_RED ((gpio_num_t)8)
#define LED_OFF 1
#define LED_ON 0
#define ADC_BATTERY 0
#endif

#ifdef LOLIN32_LITE
#define UART2_TX_PIN 17
#define UART2_RX_PIN 16
#define LED_BLUE GPIO_NUM_22
#define LED_RED_SUPL 32
#define LED_RED 33
#define LED_OFF 1
#define LED_ON 0
#endif

#ifdef UM_TINYS3
#define UART2_TX_PIN GPIO_NUM_43
#define UART2_RX_PIN GPIO_NUM_44
#define LED_BLUE GPIO_NUM_17
#define LED_RED_SUPL GPIO_NUM_7
#define LED_RED GPIO_NUM_6
#define LED_RED 8
#define LED_OFF 1
#define LED_ON 0
#endif
