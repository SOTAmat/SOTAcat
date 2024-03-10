#pragma once

#include "globals.h"
#include <stdint.h>
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
bool get_from_kx_string(const char *command, int tries, char *result, int result_size);
bool put_to_kx_command_string(const char * cmd, int tries);

#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include <mutex> // for convenience when using std::lock_guard

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

/*
 * The recommended way of exclusively accessing the radio's ACC port
 * is to use a scoped lock guard, as in
 *     long result;
 *     {
 *         const std::lock_guard<Lock> lock(RadioPortLock);
 *         result = get_from_kx("TQ", 2, 1);
 *     }
 * Where it's not possible to tightly scope access, then it is reasonable
 * to use
 *     RadioPortLock.lock() and RadioPort.unlock()
 * directly, taking care that they are precisely balanced.
 */
