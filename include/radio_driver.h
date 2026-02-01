#pragma once

#include "kx_radio.h"

struct RadioTimeHms {
    int hrs;
    int min;
    int sec;
};

class IRadioDriver {
  public:
    virtual ~IRadioDriver() = default;

    virtual bool supports_keyer () const = 0;
    virtual bool supports_volume () const = 0;

    virtual bool get_frequency (KXRadio & radio, long & out_hz) = 0;
    virtual bool set_frequency (KXRadio & radio, long hz, int tries) = 0;

    virtual bool get_mode (KXRadio & radio, radio_mode_t & out_mode) = 0;
    virtual bool set_mode (KXRadio & radio, radio_mode_t mode, int tries) = 0;

    virtual bool get_power (KXRadio & radio, long & out_power) = 0;
    virtual bool set_power (KXRadio & radio, long power) = 0;

    virtual bool get_volume (KXRadio & radio, long & out_volume) = 0;
    virtual bool set_volume (KXRadio & radio, long volume) = 0;

    virtual bool get_xmit_state (KXRadio & radio, long & out_state) = 0;
    virtual bool set_xmit_state (KXRadio & radio, bool on) = 0;

    virtual bool play_message_bank (KXRadio & radio, int bank) = 0;
    virtual bool tune_atu (KXRadio & radio) = 0;

    virtual bool send_keyer_message (KXRadio & radio, const char * message) = 0;

    virtual bool sync_time (KXRadio & radio, const RadioTimeHms & client_time) = 0;

    virtual bool get_radio_state (KXRadio & radio, kx_state_t * state) = 0;
    virtual bool restore_radio_state (KXRadio & radio, const kx_state_t * state, int tries) = 0;

    virtual bool ft8_prepare (KXRadio & radio, long base_freq) = 0;
    virtual void ft8_tone_on (KXRadio & radio) = 0;
    virtual void ft8_tone_off (KXRadio & radio) = 0;
    virtual void ft8_set_tone (KXRadio & radio, long base_freq, long frequency) = 0;
};
