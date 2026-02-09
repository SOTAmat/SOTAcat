#pragma once

#include "radio_driver.h"

/* Morse code array
The index of each character gives the morse code for that character in binary.
The bits of the character are read from RIGHT to left,
with a "1"=dit and "0"=dah and a final stop bit of "1"
*/
//                    0123456789112345678921234567893123456789412345678951234567896
//                    0         1         2         3         4         5         6
const char morse[] = "##TEMANIOWKUGRDS#JY#Q#XV#PCFZLBH01#2###3######=49#####/#8###"
                     "7#65############,########.#*######-####################?####";
//                    6         7         8         9         0         1         2

class KH1RadioDriver : public IRadioDriver {
  public:
    bool supports_keyer () const override;
    bool supports_volume () const override;

    bool get_frequency (KXRadio & radio, long & out_hz) override;
    bool set_frequency (KXRadio & radio, long hz, int tries) override;

    bool get_mode (KXRadio & radio, radio_mode_t & out_mode) override;
    bool set_mode (KXRadio & radio, radio_mode_t mode, int tries) override;

    bool get_power (KXRadio & radio, long & out_power) override;
    bool set_power (KXRadio & radio, long power) override;

    bool get_volume (KXRadio & radio, long & out_volume) override;
    bool set_volume (KXRadio & radio, long volume) override;

    bool get_xmit_state (KXRadio & radio, long & out_state) override;
    bool set_xmit_state (KXRadio & radio, bool on) override;

    bool play_message_bank (KXRadio & radio, int bank) override;
    bool tune_atu (KXRadio & radio) override;

    bool send_keyer_message (KXRadio & radio, const char * message) override;

    bool sync_time (KXRadio & radio, const RadioTimeHms & client_time) override;

    bool get_radio_state (KXRadio & radio, kx_state_t * state) override;
    bool restore_radio_state (KXRadio & radio, const kx_state_t * state, int tries) override;

    bool ft8_prepare (KXRadio & radio, long base_freq) override;
    void ft8_tone_on (KXRadio & radio) override;
    void ft8_tone_off (KXRadio & radio) override;
    void ft8_set_tone (KXRadio & radio, long base_freq, long frequency) override;
};
