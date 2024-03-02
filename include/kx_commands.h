#pragma once

#include "globals.h"
typedef struct
{
    uint8_t mode;
    uint8_t active_vfo;
    long int vfo_a_freq;
    uint8_t tun_pwr;
    uint8_t audio_peaking;
} kx_state_t;

void empty_kx_input_buffer(int wait_ms);
long get_from_kx(const char *command, int tries, int num_digits);
bool put_to_kx(const char *command, int num_digits, long value, int tries);
long get_from_kx_menu_item(uint8_t menu_item, int tries);
bool put_to_kx_menu_item(uint8_t menu_item, long value, int tries);
void get_kx_state(kx_state_t *in_state);
void restore_kx_state(const kx_state_t *in_state, int tries);

#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

class Lock {
    bool m_locked;
    SemaphoreHandle_t m_mutex;
public:
    Lock();
    void lock();
    void unlock();

    bool locked() const { return m_locked; }
};
extern Lock RadioPortLock;
