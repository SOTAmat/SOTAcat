#pragma once

#include "kx_commands.h"
typedef struct
{
    long baseFreq;
    uint8_t *tones;
    kx_state_t *kx_state;
} ft8_task_pack_t;