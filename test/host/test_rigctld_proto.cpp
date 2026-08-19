// Standalone host test — no ESP-IDF. Build: see test/host/Makefile
#include "../../include/rigctld_proto.h"
#include <cassert>
#include <cmath>
#include <cstdio>
#include <initializer_list>

static bool feq (float a, float b) { return std::fabs (a - b) < 1e-4f; }

static void test_mode_to_hamlib () {
    assert (!strcmp (rigctld_mode_to_hamlib (1), "LSB"));
    assert (!strcmp (rigctld_mode_to_hamlib (2), "USB"));
    assert (!strcmp (rigctld_mode_to_hamlib (3), "CW"));
    assert (!strcmp (rigctld_mode_to_hamlib (4), "FM"));
    assert (!strcmp (rigctld_mode_to_hamlib (5), "AM"));
    assert (!strcmp (rigctld_mode_to_hamlib (6), "PKTUSB"));
    assert (!strcmp (rigctld_mode_to_hamlib (7), "CWR"));
    assert (!strcmp (rigctld_mode_to_hamlib (9), "PKTLSB"));
    // Unknown values (incl. MODE_UNKNOWN and the gap at 8) fall back to USB.
    assert (!strcmp (rigctld_mode_to_hamlib (0), "USB"));
    assert (!strcmp (rigctld_mode_to_hamlib (8), "USB"));
    assert (!strcmp (rigctld_mode_to_hamlib (-1), "USB"));
}

static void test_hamlib_to_mode () {
    assert (rigctld_hamlib_to_mode ("USB") == 2);
    assert (rigctld_hamlib_to_mode ("LSB") == 1);
    assert (rigctld_hamlib_to_mode ("CW") == 3);
    assert (rigctld_hamlib_to_mode ("CWR") == 7);
    assert (rigctld_hamlib_to_mode ("AM") == 5);
    assert (rigctld_hamlib_to_mode ("FM") == 4);
    assert (rigctld_hamlib_to_mode ("PKTUSB") == 6);
    assert (rigctld_hamlib_to_mode ("PKTLSB") == 9);
    // Aliases both map to MODE_DATA.
    assert (rigctld_hamlib_to_mode ("RTTY") == 6);
    assert (rigctld_hamlib_to_mode ("DATA") == 6);
    // Case-insensitive.
    assert (rigctld_hamlib_to_mode ("usb") == 2);
    assert (rigctld_hamlib_to_mode ("PktUsb") == 6);
    // Unknown / empty / null.
    assert (rigctld_hamlib_to_mode ("SSTV") == RIGCTLD_MODE_UNKNOWN);
    assert (rigctld_hamlib_to_mode ("") == RIGCTLD_MODE_UNKNOWN);
    assert (rigctld_hamlib_to_mode (nullptr) == RIGCTLD_MODE_UNKNOWN);
    // Round trip over every real mode value.
    for (long m : {1L, 2L, 3L, 4L, 5L, 6L, 7L, 9L})
        assert (rigctld_hamlib_to_mode (rigctld_mode_to_hamlib (m)) == m);
}

static void test_parse_short_forms () {
    const char * arg = (const char *)1;  // sentinel: must be cleared
    assert (rigctld_parse_line ("f", &arg) == RigctlCmd::GET_FREQ && arg == nullptr);
    assert (rigctld_parse_line ("m", &arg) == RigctlCmd::GET_MODE);
    assert (rigctld_parse_line ("t", &arg) == RigctlCmd::GET_PTT);
    assert (rigctld_parse_line ("v", &arg) == RigctlCmd::GET_VFO);
    assert (rigctld_parse_line ("s", &arg) == RigctlCmd::GET_SPLIT_VFO);
    assert (rigctld_parse_line ("_", &arg) == RigctlCmd::GET_INFO);
    assert (rigctld_parse_line ("q", &arg) == RigctlCmd::QUIT);
    assert (rigctld_parse_line ("Q", &arg) == RigctlCmd::QUIT);

    // Args: space-separated and glued both work.
    assert (rigctld_parse_line ("F 14074000", &arg) == RigctlCmd::SET_FREQ);
    assert (arg && !strcmp (arg, "14074000"));
    assert (rigctld_parse_line ("F14074000", &arg) == RigctlCmd::SET_FREQ);
    assert (arg && !strcmp (arg, "14074000"));
    assert (rigctld_parse_line ("M USB 0", &arg) == RigctlCmd::SET_MODE);
    assert (arg && !strcmp (arg, "USB 0"));
    assert (rigctld_parse_line ("T 1", &arg) == RigctlCmd::SET_PTT);
    assert (arg && !strcmp (arg, "1"));
    assert (rigctld_parse_line ("l RFPOWER", &arg) == RigctlCmd::GET_LEVEL);
    assert (arg && !strcmp (arg, "RFPOWER"));
    assert (rigctld_parse_line ("L AF 0.5", &arg) == RigctlCmd::SET_LEVEL);
    assert (arg && !strcmp (arg, "AF 0.5"));
    assert (rigctld_parse_line ("b CQ TEST", &arg) == RigctlCmd::SEND_MORSE);
    assert (arg && !strcmp (arg, "CQ TEST"));
    // Bare arg-taking command and trailing space: no argument.
    assert (rigctld_parse_line ("F", &arg) == RigctlCmd::SET_FREQ && arg == nullptr);
    assert (rigctld_parse_line ("F ", &arg) == RigctlCmd::SET_FREQ && arg == nullptr);

    // Protocol-polish short forms.
    assert (rigctld_parse_line ("V VFOA", &arg) == RigctlCmd::SET_VFO);
    assert (arg && !strcmp (arg, "VFOA"));
    assert (rigctld_parse_line ("u TUNER", &arg) == RigctlCmd::GET_FUNC);
    assert (arg && !strcmp (arg, "TUNER"));
    assert (rigctld_parse_line ("U TUNER 1", &arg) == RigctlCmd::SET_FUNC);
    assert (arg && !strcmp (arg, "TUNER 1"));

    // Hamlib binary aliases.
    assert (rigctld_parse_line ("\x8f", &arg) == RigctlCmd::DUMP_STATE);
    assert (rigctld_parse_line ("\xf0", &arg) == RigctlCmd::CHK_VFO);
    assert (rigctld_parse_line ("\x88", &arg) == RigctlCmd::GET_POWERSTAT);
    assert (rigctld_parse_line ("\x87", &arg) == RigctlCmd::UNKNOWN);  // set_powerstat: never implement
}

static void test_parse_long_forms () {
    const char * arg = nullptr;
    assert (rigctld_parse_line ("\\dump_state", &arg) == RigctlCmd::DUMP_STATE);
    assert (rigctld_parse_line ("\\chk_vfo", &arg) == RigctlCmd::CHK_VFO);
    assert (rigctld_parse_line ("\\get_freq", &arg) == RigctlCmd::GET_FREQ);
    assert (rigctld_parse_line ("\\get_mode", &arg) == RigctlCmd::GET_MODE);
    assert (rigctld_parse_line ("\\get_ptt", &arg) == RigctlCmd::GET_PTT);
    assert (rigctld_parse_line ("\\get_vfo", &arg) == RigctlCmd::GET_VFO);
    assert (rigctld_parse_line ("\\get_split_vfo", &arg) == RigctlCmd::GET_SPLIT_VFO);
    assert (rigctld_parse_line ("\\get_info", &arg) == RigctlCmd::GET_INFO);
    assert (rigctld_parse_line ("\\quit", &arg) == RigctlCmd::QUIT);
    assert (rigctld_parse_line ("\\set_freq 7040000", &arg) == RigctlCmd::SET_FREQ);
    assert (arg && !strcmp (arg, "7040000"));
    assert (rigctld_parse_line ("\\set_mode CW 500", &arg) == RigctlCmd::SET_MODE);
    assert (arg && !strcmp (arg, "CW 500"));
    assert (rigctld_parse_line ("\\set_ptt 0", &arg) == RigctlCmd::SET_PTT);
    assert (arg && !strcmp (arg, "0"));
    assert (rigctld_parse_line ("\\get_level AF", &arg) == RigctlCmd::GET_LEVEL);
    assert (arg && !strcmp (arg, "AF"));
    assert (rigctld_parse_line ("\\set_level RFPOWER 0.8", &arg) == RigctlCmd::SET_LEVEL);
    assert (arg && !strcmp (arg, "RFPOWER 0.8"));
    assert (rigctld_parse_line ("\\send_morse HI", &arg) == RigctlCmd::SEND_MORSE);
    assert (arg && !strcmp (arg, "HI"));
    // Case-insensitive names.
    assert (rigctld_parse_line ("\\Get_Freq", &arg) == RigctlCmd::GET_FREQ);
    assert (rigctld_parse_line ("\\DUMP_STATE", &arg) == RigctlCmd::DUMP_STATE);
    // Protocol-polish long forms.
    assert (rigctld_parse_line ("\\get_powerstat", &arg) == RigctlCmd::GET_POWERSTAT);
    assert (rigctld_parse_line ("\\set_vfo VFOA", &arg) == RigctlCmd::SET_VFO);
    assert (arg && !strcmp (arg, "VFOA"));
    assert (rigctld_parse_line ("\\get_func TUNER", &arg) == RigctlCmd::GET_FUNC);
    assert (rigctld_parse_line ("\\set_func TUNER 1", &arg) == RigctlCmd::SET_FUNC);
    assert (arg && !strcmp (arg, "TUNER 1"));
    // A name that merely PREFIXES a known command is unknown, not a match...
    assert (rigctld_parse_line ("\\get_freqx", &arg) == RigctlCmd::UNKNOWN);
    // ...and unknown or never-implemented commands stay unknown.
    assert (rigctld_parse_line ("\\bogus", &arg) == RigctlCmd::UNKNOWN);
    assert (rigctld_parse_line ("\\set_powerstat 0", &arg) == RigctlCmd::UNKNOWN);
}

static void test_parse_edges () {
    const char * arg = nullptr;
    assert (rigctld_parse_line ("", &arg) == RigctlCmd::NONE);
    assert (rigctld_parse_line ("   ", &arg) == RigctlCmd::NONE);
    assert (rigctld_parse_line ("\t", &arg) == RigctlCmd::NONE);
    assert (rigctld_parse_line (nullptr, &arg) == RigctlCmd::NONE);
    // Leading whitespace is skipped.
    assert (rigctld_parse_line ("  f", &arg) == RigctlCmd::GET_FREQ);
    assert (rigctld_parse_line (" \tF 7040000", &arg) == RigctlCmd::SET_FREQ);
    assert (arg && !strcmp (arg, "7040000"));
    // Unknown single letters.
    assert (rigctld_parse_line ("x", &arg) == RigctlCmd::UNKNOWN);
    assert (rigctld_parse_line ("z 1", &arg) == RigctlCmd::UNKNOWN);
    // arg_out is optional.
    assert (rigctld_parse_line ("F 7040000", nullptr) == RigctlCmd::SET_FREQ);
}

static void test_split_level () {
    char         name[16];
    const char * val = (const char *)1;
    assert (rigctld_split_level ("RFPOWER 0.5", name, sizeof (name), &val));
    assert (!strcmp (name, "RFPOWER") && val && !strcmp (val, "0.5"));
    // Name is uppercased.
    assert (rigctld_split_level ("af 0.25", name, sizeof (name), &val));
    assert (!strcmp (name, "AF") && val && !strcmp (val, "0.25"));
    // No value.
    assert (rigctld_split_level ("AF", name, sizeof (name), &val));
    assert (!strcmp (name, "AF") && val == nullptr);
    assert (rigctld_split_level ("AF ", name, sizeof (name), &val));
    assert (val == nullptr);
    // No name at all.
    assert (!rigctld_split_level ("", name, sizeof (name), &val));
    assert (!rigctld_split_level (nullptr, name, sizeof (name), &val));
    // val_out is optional.
    assert (rigctld_split_level ("RFPOWER 0.5", name, sizeof (name), nullptr));
    // Overlong names truncate but don't overflow.
    assert (rigctld_split_level ("ANEXTREMELYLONGLEVELNAME 1", name, sizeof (name), &val));
    assert (strlen (name) == sizeof (name) - 1);
}

static void test_rfpower_conversions () {
    assert (feq (rigctld_rfpower_from_watts (0), 0.0f));
    assert (feq (rigctld_rfpower_from_watts (6), 0.5f));
    assert (feq (rigctld_rfpower_from_watts (10), 0.8333f));  // KX2 clamp value
    assert (feq (rigctld_rfpower_from_watts (12), 1.0f));
    assert (feq (rigctld_rfpower_from_watts (15), 1.0f));  // KX3 max clamps
    assert (feq (rigctld_rfpower_from_watts (-1), 0.0f));
    assert (rigctld_watts_from_rfpower (0.0f) == 0);
    assert (rigctld_watts_from_rfpower (0.5f) == 6);
    assert (rigctld_watts_from_rfpower (1.0f) == 12);
    assert (rigctld_watts_from_rfpower (2.0f) == 12);   // over-range clamps
    assert (rigctld_watts_from_rfpower (-0.5f) == 0);   // under-range clamps
    assert (rigctld_watts_from_rfpower (0.04f) == 0);   // rounds down
    assert (rigctld_watts_from_rfpower (0.042f) == 1);  // 0.504 W rounds up
}

static void test_af_conversions () {
    assert (feq (rigctld_af_from_volume (0), 0.0f));
    assert (feq (rigctld_af_from_volume (30), 0.5f));
    assert (feq (rigctld_af_from_volume (60), 1.0f));
    assert (feq (rigctld_af_from_volume (120), 1.0f));  // over knob scale clamps
    assert (rigctld_af_target (0.0f) == 0);
    assert (rigctld_af_target (0.5f) == 30);
    assert (rigctld_af_target (1.0f) == 60);
    assert (rigctld_af_target (1.5f) == 60);
    assert (rigctld_af_target (-0.1f) == 0);
}

static void test_af_step_delta () {
    // Exactly there and within half a step (2 counts): no delta.
    assert (rigctld_af_step_delta (30, 30) == 0);
    assert (rigctld_af_step_delta (32, 30) == 0);
    assert (rigctld_af_step_delta (28, 30) == 0);
    // Past half a step: one step, in the right direction.
    assert (rigctld_af_step_delta (33, 30) == 1);
    assert (rigctld_af_step_delta (27, 30) == -1);
    // Exact steps.
    assert (rigctld_af_step_delta (35, 30) == 1);
    assert (rigctld_af_step_delta (25, 30) == -1);
    assert (rigctld_af_step_delta (60, 0) == 12);
    assert (rigctld_af_step_delta (0, 60) == -12);
    // Rounds to the NEAREST step (7 -> 1 step of 5, 8 -> 2 steps).
    assert (rigctld_af_step_delta (37, 30) == 1);
    assert (rigctld_af_step_delta (38, 30) == 2);
    assert (rigctld_af_step_delta (23, 30) == -1);
    assert (rigctld_af_step_delta (22, 30) == -2);
}

static void test_strength_from_bars () {
    // One bar = one S-unit = 6 dB; S9 sits at 9 bars.
    assert (rigctld_strength_db_from_bars (9) == 0);    // S9
    assert (rigctld_strength_db_from_bars (0) == -54);  // S0
    assert (rigctld_strength_db_from_bars (1) == -48);  // S1
    assert (rigctld_strength_db_from_bars (7) == -12);  // S7
    assert (rigctld_strength_db_from_bars (12) == 18);  // S9+18
    assert (rigctld_strength_db_from_bars (15) == 36);  // S9+36 (meter max)
}

int main () {
    test_mode_to_hamlib();
    test_hamlib_to_mode();
    test_parse_short_forms();
    test_parse_long_forms();
    test_parse_edges();
    test_split_level();
    test_rfpower_conversions();
    test_af_conversions();
    test_af_step_delta();
    test_strength_from_bars();
    printf ("test_rigctld_proto: OK\n");
    return 0;
}
