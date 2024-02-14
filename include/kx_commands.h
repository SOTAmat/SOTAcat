#pragma once

typedef struct
{
    uint8_t mode;
    uint8_t active_vfo;
    long int vfo_a_freq;
    uint8_t tun_pwr;
    uint8_t audio_peaking;
} kx_state_t;

void empty_kx_input_buffer(int wait_ms);
long get_from_kx(char *command, int tries, int num_digits);
bool put_to_kx(char *command, int num_digits, long value, int tries);
long get_from_kx_menu_item(uint8_t menu_item, int tries);
bool put_to_kx_menu_item(uint8_t menu_item, long value, int tries);
void get_kx_state(kx_state_t *in_state);
void restore_kx_state(kx_state_t *in_state, int tries);