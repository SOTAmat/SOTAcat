#pragma once
// Pure rigctld protocol logic: line classification, Hamlib<->radio mode
// mapping, and level-value conversions. No ESP-IDF deps so it is
// host-unit-testable (test/host/test_rigctld_proto.cpp); the sockets and
// radio-service calls live in src/rigctld_server.cpp.
//
// Modes are passed as `long` holding radio_mode_t values (this header
// cannot include kx_radio.h and stay host-buildable); rigctld_server.cpp
// static_asserts the correspondence.
#include <cctype>
#include <cstddef>
#include <cstring>

// One entry per supported wire command; UNKNOWN replies RPRT ENIMPL.
enum class RigctlCmd {
    NONE,  // empty line: ignore, keep the connection
    GET_FREQ,
    SET_FREQ,
    GET_MODE,
    SET_MODE,
    GET_PTT,
    SET_PTT,
    GET_VFO,
    GET_SPLIT_VFO,
    GET_LEVEL,
    SET_LEVEL,
    SEND_MORSE,
    GET_INFO,
    DUMP_STATE,
    CHK_VFO,
    GET_POWERSTAT,
    SET_VFO,
    GET_FUNC,
    SET_FUNC,
    QUIT,
    UNKNOWN,
};

// Mirrors radio_mode_t (kx_radio.h) — see the static_asserts in
// src/rigctld_server.cpp.
inline constexpr long RIGCTLD_MODE_UNKNOWN = 0;

// Hamlib name for a radio_mode_t value; unknown values report "USB" (the
// least-wrong answer for a client that insists on one).
inline const char * rigctld_mode_to_hamlib (long mode) {
    switch (mode) {
    case 1: return "LSB";
    case 2: return "USB";
    case 3: return "CW";
    case 4: return "FM";
    case 5: return "AM";
    case 6: return "PKTUSB";  // MODE_DATA
    case 7: return "CWR";     // MODE_CW_R
    case 9: return "PKTLSB";  // MODE_DATA_R
    default: return "USB";
    }
}

// radio_mode_t value for a Hamlib mode name (case-insensitive); RTTY and
// DATA alias to MODE_DATA. Unknown/empty -> RIGCTLD_MODE_UNKNOWN.
inline long rigctld_hamlib_to_mode (const char * s) {
    if (!s || !*s)
        return RIGCTLD_MODE_UNKNOWN;
    char buf[16];
    int  i = 0;
    for (; s[i] && i < (int)sizeof (buf) - 1; i++)
        buf[i] = (char)toupper ((unsigned char)s[i]);
    buf[i] = '\0';
    if (!strcmp (buf, "USB"))
        return 2;
    if (!strcmp (buf, "LSB"))
        return 1;
    if (!strcmp (buf, "CW"))
        return 3;
    if (!strcmp (buf, "CWR"))
        return 7;
    if (!strcmp (buf, "AM"))
        return 5;
    if (!strcmp (buf, "FM"))
        return 4;
    if (!strcmp (buf, "PKTUSB"))
        return 6;
    if (!strcmp (buf, "PKTLSB"))
        return 9;
    if (!strcmp (buf, "RTTY"))
        return 6;
    if (!strcmp (buf, "DATA"))
        return 6;
    return RIGCTLD_MODE_UNKNOWN;
}

namespace rigctld_detail {
// Case-insensitive match of `name` against the command word at `cmd`
// (terminated by space or NUL).
inline bool cmd_is (const char * cmd, const char * name) {
    size_t n = strlen (name);
    return strncasecmp (cmd, name, n) == 0 && (cmd[n] == '\0' || cmd[n] == ' ');
}
}  // namespace rigctld_detail

// Classify one protocol line. Skips leading whitespace. For commands that
// take arguments, *arg_out points into `line` at the argument text (nullptr
// when absent); short-form args may but need not be space-separated
// ("F 14074000" and "F14074000" both parse). Pure string work — no I/O.
inline RigctlCmd rigctld_parse_line (const char * line, const char ** arg_out) {
    using rigctld_detail::cmd_is;
    if (arg_out)
        *arg_out = nullptr;
    if (!line)
        return RigctlCmd::NONE;
    while (*line == ' ' || *line == '\t')
        line++;
    if (!*line)
        return RigctlCmd::NONE;

    if (line[0] == '\\') {
        const char * cmd   = line + 1;
        const char * space = strchr (cmd, ' ');
        if (arg_out && space && space[1])
            *arg_out = space + 1;
        if (cmd_is (cmd, "dump_state"))
            return RigctlCmd::DUMP_STATE;
        if (cmd_is (cmd, "chk_vfo"))
            return RigctlCmd::CHK_VFO;
        if (cmd_is (cmd, "get_freq"))
            return RigctlCmd::GET_FREQ;
        if (cmd_is (cmd, "set_freq"))
            return RigctlCmd::SET_FREQ;
        if (cmd_is (cmd, "get_mode"))
            return RigctlCmd::GET_MODE;
        if (cmd_is (cmd, "set_mode"))
            return RigctlCmd::SET_MODE;
        if (cmd_is (cmd, "get_ptt"))
            return RigctlCmd::GET_PTT;
        if (cmd_is (cmd, "set_ptt"))
            return RigctlCmd::SET_PTT;
        if (cmd_is (cmd, "get_vfo"))
            return RigctlCmd::GET_VFO;
        if (cmd_is (cmd, "get_split_vfo"))
            return RigctlCmd::GET_SPLIT_VFO;
        if (cmd_is (cmd, "get_level"))
            return RigctlCmd::GET_LEVEL;
        if (cmd_is (cmd, "set_level"))
            return RigctlCmd::SET_LEVEL;
        if (cmd_is (cmd, "send_morse"))
            return RigctlCmd::SEND_MORSE;
        if (cmd_is (cmd, "get_info"))
            return RigctlCmd::GET_INFO;
        if (cmd_is (cmd, "get_powerstat"))
            return RigctlCmd::GET_POWERSTAT;
        if (cmd_is (cmd, "set_vfo"))
            return RigctlCmd::SET_VFO;
        if (cmd_is (cmd, "get_func"))
            return RigctlCmd::GET_FUNC;
        if (cmd_is (cmd, "set_func"))
            return RigctlCmd::SET_FUNC;
        if (cmd_is (cmd, "quit"))
            return RigctlCmd::QUIT;
        return RigctlCmd::UNKNOWN;
    }

    if (arg_out)
        *arg_out = (line[1] == ' ') ? (line[2] ? &line[2] : nullptr) : (line[1] ? &line[1] : nullptr);
    switch ((unsigned char)line[0]) {
    case 'f': return RigctlCmd::GET_FREQ;
    case 'F': return RigctlCmd::SET_FREQ;
    case 'm': return RigctlCmd::GET_MODE;
    case 'M': return RigctlCmd::SET_MODE;
    case 't': return RigctlCmd::GET_PTT;
    case 'T': return RigctlCmd::SET_PTT;
    case 'v': return RigctlCmd::GET_VFO;
    case 's': return RigctlCmd::GET_SPLIT_VFO;
    case 'l': return RigctlCmd::GET_LEVEL;
    case 'L': return RigctlCmd::SET_LEVEL;
    case 'b': return RigctlCmd::SEND_MORSE;
    case '_': return RigctlCmd::GET_INFO;
    case 'V': return RigctlCmd::SET_VFO;
    case 'u': return RigctlCmd::GET_FUNC;
    case 'U': return RigctlCmd::SET_FUNC;
    case 'q':
    case 'Q': return RigctlCmd::QUIT;
    case 0x8f: return RigctlCmd::DUMP_STATE;     // hamlib binary alias
    case 0xf0: return RigctlCmd::CHK_VFO;        // hamlib binary alias
    case 0x88: return RigctlCmd::GET_POWERSTAT;  // hamlib binary alias (0x87 set_powerstat stays UNKNOWN)
    default: return RigctlCmd::UNKNOWN;
    }
}

// Split a get_level/set_level argument ("RFPOWER 0.5", "af") into an
// uppercased level name and an optional value pointer into `arg`. False
// when there is no name.
inline bool rigctld_split_level (const char * arg, char * name_buf, size_t name_sz, const char ** val_out) {
    if (val_out)
        *val_out = nullptr;
    if (!arg || !*arg || !name_buf || name_sz == 0)
        return false;
    size_t i = 0;
    for (; arg[i] && arg[i] != ' ' && i < name_sz - 1; i++)
        name_buf[i] = (char)toupper ((unsigned char)arg[i]);
    name_buf[i] = '\0';
    if (i == 0)
        return false;
    if (val_out && arg[i] == ' ' && arg[i + 1])
        *val_out = &arg[i + 1];
    return true;
}

// --- level-value conversions ------------------------------------------
// RFPOWER: Hamlib 0.0..1.0 <-> KX watts (KX2 max 12 W, KX3 15 W — 12 is
// close enough). AF: Hamlib 0.0..1.0 <-> the AG knob's 0-60 display scale
// (issue #87, not the documented 0-255); the service's SET_VOLUME arg is a
// delta in web-UI steps of RIGCTLD_AF_STEP knob counts.
inline constexpr long RIGCTLD_MAX_WATTS = 12;
inline constexpr long RIGCTLD_AF_SCALE  = 60;
inline constexpr long RIGCTLD_AF_STEP   = 5;

inline float rigctld_rfpower_from_watts (long watts) {
    float v = (float)watts / (float)RIGCTLD_MAX_WATTS;
    return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v);
}

inline long rigctld_watts_from_rfpower (float val) {
    long w = (long)(val * (float)RIGCTLD_MAX_WATTS + 0.5f);
    return w < 0 ? 0 : (w > RIGCTLD_MAX_WATTS ? RIGCTLD_MAX_WATTS : w);
}

inline float rigctld_af_from_volume (long volume) {
    float v = (float)volume / (float)RIGCTLD_AF_SCALE;
    return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v);
}

inline long rigctld_af_target (float val) {
    long t = (long)(val * (float)RIGCTLD_AF_SCALE + 0.5f);
    return t < 0 ? 0 : (t > RIGCTLD_AF_SCALE ? RIGCTLD_AF_SCALE : t);
}

// Volume-service delta (in RIGCTLD_AF_STEP-count steps) that lands nearest
// `target` from `current`; 0 when the nearest step is where we already are
// (within half a step).
inline long rigctld_af_step_delta (long target, long current) {
    long diff = target - current;
    long half = RIGCTLD_AF_STEP / 2;
    return (diff + (diff >= 0 ? half : -half)) / RIGCTLD_AF_STEP;
}

// Hamlib STRENGTH is calibrated dB relative to S9; the KX S-meter reads in
// bar-graph units 0-15 where one bar is one S-unit (6 dB) and S9 sits at
// 9 bars. Bars above S9 keep the same 6 dB/bar slope (nominal "+10/+20"
// legends notwithstanding — honest within the meter's resolution).
inline long rigctld_strength_db_from_bars (long bars) {
    return (bars - 9) * 6;
}
