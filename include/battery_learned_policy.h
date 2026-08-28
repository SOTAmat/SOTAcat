#pragma once

#include <cstdint>

/**
 * Save policy for the fuel gauge's learned parameters (host-testable; see
 * test/host/test_battery_learned.cpp).
 *
 * The MAX1726x application guidance is to checkpoint the learned capacity
 * parameters each time bit 6 of the Cycles register toggles (about every
 * 64% of battery cycled), so a restore after the gauge loses battery power
 * (deep-discharge cutoff, pack swap) is at most one interval old while NVS
 * write wear stays negligible.
 */
inline bool learned_save_due (uint16_t saved_cycles, uint16_t current_cycles) {
    return ((saved_cycles ^ current_cycles) & 0x0040) != 0;
}
