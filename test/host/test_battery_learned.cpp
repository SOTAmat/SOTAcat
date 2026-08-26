// Standalone host test — no ESP-IDF. Build: see test/host/Makefile
//
// Contract pinned here: the fuel gauge's learned parameters are persisted
// when bit 6 of the Cycles register toggles versus the last-saved value
// (about every 64% of battery cycled), and never otherwise — so NVS wear
// stays negligible while a deep-discharge or battery swap can always be
// restored from a checkpoint at most one save-interval old.
#include "../../include/battery_learned_policy.h"
#include <cassert>
#include <cstdio>

int main () {
    // No toggle: identical values, or changes confined to other bits.
    assert (!learned_save_due (0x0000, 0x0000));
    assert (!learned_save_due (0x0000, 0x003F));  // bits 0-5 differ only
    assert (!learned_save_due (0x0040, 0x0041));  // bit 6 same (set), low bit differs
    assert (!learned_save_due (0x0040, 0x007F));

    // Toggle of bit 6, either direction, regardless of other bits.
    assert (learned_save_due (0x0000, 0x0040));
    assert (learned_save_due (0x0040, 0x0000));
    assert (learned_save_due (0x0040, 0x0080));  // wrapped past bit 6: 0x40 -> 0x80
    assert (learned_save_due (0x003F, 0x0040));
    assert (learned_save_due (0x00FF, 0x00BF));

    // Higher bits changing without bit 6 do not trigger.
    assert (!learned_save_due (0x0080, 0x0180));

    printf ("test_battery_learned: all assertions passed\n");
    return 0;
}
