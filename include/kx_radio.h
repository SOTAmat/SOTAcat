#pragma once

#include "lockable.h"

#include <stdint.h>

#define SC_KX_COMMUNICATION_RETRIES 3

/**
 * Enumeration of radio operation modes.
 */
typedef enum {
    MODE_UNKNOWN = 0,
    MODE_LSB     = 1,
    MODE_USB     = 2,
    MODE_CW      = 3,
    MODE_FM      = 4,
    MODE_AM      = 5,
    MODE_DATA    = 6,
    MODE_CW_R    = 7,
    MODE_DATA_R  = 9,
    MODE_LAST    = 9
} radio_mode_t;

typedef struct {
    radio_mode_t mode;
    uint8_t      active_vfo;
    long int     vfo_a_freq;
    uint8_t      tun_pwr;
    uint8_t      audio_peaking;
} kx_state_t;

/*
 * The recommended way of exclusively accessing the radio's ACC port
 * is to use a scoped lock guard, as in
 *     long result;
 *     {
 *         const std::lock_guard<Lockable> lock(kxRadio);
 *         result = kxRadio.get_from_kx("TQ", 2, 1);
 *     }
 * Where it's not possible to tightly scope access, then it is reasonable
 * to use
 *     kxRadio.lock() and kxRadio.unlock()
 * directly, taking care that they are precisely balanced.
 */

class KXRadio : public Lockable {
  private:
    bool m_is_connected;
    KXRadio();

  public:
    static KXRadio & getInstance ();

    int connect ();

    bool is_connected () const { return m_is_connected; }

    void empty_kx_input_buffer (int wait_ms);

    long get_from_kx (const char * command, int tries, int num_digits);
    bool put_to_kx (const char * command, int num_digits, long value, int tries);
    long get_from_kx_menu_item (uint8_t menu_item, int tries);
    bool put_to_kx_menu_item (uint8_t menu_item, long value, int tries);
    bool get_from_kx_string (const char * command, int tries, char * result, int result_size);
    bool put_to_kx_command_string (const char * command, int tries);
    void get_kx_state (kx_state_t * in_state);
    void restore_kx_state (const kx_state_t * in_state, int tries);
};

extern KXRadio & kxRadio;  // global singleton
