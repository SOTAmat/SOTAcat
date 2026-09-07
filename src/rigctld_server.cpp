/*
 * Implements (minimal) RIGCTL protocol on TCP port 4532
 * See https://manpages.ubuntu.com/manpages/xenial/man1/rigctl.1.html for commands
 * Typical usage: rigctl --rig-file=sotacat.local --model=2
 */

#include "rigctld_server.h"
#include "globals.h"
#include "kx_radio.h"
#include "radio_service.h"
#include "radio_snapshot.h"
#include "rigctld_proto.h"
#include "timed_lock.h"

#include <cctype>
#include <cstdio>
#include <cstring>
#include <esp_task_wdt.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <lwip/sockets.h>

#include <esp_log.h>
static const char * TAG8 = "sc:rigctld.";

static constexpr int RIGCTLD_PORT        = 4532;
static constexpr int RIGCTLD_MAX_LINE    = 256;
static constexpr int RIGCTLD_STACK_SIZE  = 6144;
static constexpr int RIGCTLD_MAX_CLIENTS = 2;  // sized into CONFIG_LWIP_MAX_SOCKETS (sdkconfig.defaults)

// The radio service task owns all CAT I/O (docs/dev/Radio-Access.md).
// rigctld is a client of that service, never a radio-mutex user — GETs
// read the snapshot (refreshing it when stale), SETs enqueue and wait for
// the worker. rigctld runs on its own task, so blocking here is fine; the
// sole exception is send_morse, which uses the sanctioned direct-lock
// keyer path (same claim as handler_cat.cpp's keyer_task).
static constexpr uint32_t RIGCTLD_GET_WAIT_MS = 3000;                   // refresh can queue behind a ~1.5 s tune
static constexpr uint32_t RIGCTLD_SET_WAIT_MS = SET_APPLY_DEADLINE_MS;  // the op is dropped past this anyway

// Hamlib error codes
static constexpr int RIG_OK       = 0;
static constexpr int RIG_EINVAL   = -1;
static constexpr int RIG_ENIMPL   = -4;
static constexpr int RIG_ETIMEOUT = -5;
static constexpr int RIG_EIO      = -6;
static constexpr int RIG_ERJCTED  = -9;  // rejected: FT8 owns the radio, or keyer busy

// Mode values cross rigctld_proto.h as `long`; pin them to radio_mode_t.
static_assert ((long)MODE_UNKNOWN == RIGCTLD_MODE_UNKNOWN);
static_assert ((long)MODE_LSB == 1 && (long)MODE_USB == 2 && (long)MODE_CW == 3);
static_assert ((long)MODE_FM == 4 && (long)MODE_AM == 5 && (long)MODE_DATA == 6);
static_assert ((long)MODE_CW_R == 7 && (long)MODE_DATA_R == 9);

// ====================================================================================================
// Socket helpers
// ====================================================================================================

static bool rigctld_send (int sock, const char * data) {
    int len  = strlen (data);
    int sent = send (sock, data, len, 0);
    if (sent < 0) {
        ESP_LOGW (TAG8, "send failed: errno %d", errno);
        return false;
    }
    return true;
}

// ====================================================================================================
// Command handlers
// ====================================================================================================

static void rigctld_rprt (int sock, int code) {
    char resp[16];
    snprintf (resp, sizeof (resp), "RPRT %d\n", code);
    rigctld_send (sock, resp);
}

// Per-command response context. Ham2K and other Hamlib clients poll in the
// extended-response protocol (a '+' or punctuation prefix, see
// rigctld_ext_prefix): the reply is then a "name:<sep>" header, one or more
// "Label: value<sep>" fields, and a trailing "RPRT <code><sep>". Terse mode
// (no prefix) is unchanged: bare values for GETs, "RPRT <code>" for SETs and
// errors. One command runs at a time on the server task, so this is built
// per command and passed by reference to the handler.
struct Resp {
    int          sock;
    bool         ext         = false;
    char         sep         = '\n';
    const char * name        = nullptr;  // long command name for the ext header
    const char * hdrarg      = nullptr;  // echoed after "name:" (level/func name)
    bool         header_done = false;
    bool         valued      = false;  // a GET field was emitted
};

// Emit the "name:[ hdrarg]<sep>" header once, extended mode only.
static void resp_hdr (Resp & r) {
    if (!r.ext || r.header_done || !r.name)
        return;
    r.header_done = true;
    char h[64];
    if (r.hdrarg)
        snprintf (h, sizeof (h), "%s: %s%c", r.name, r.hdrarg, r.sep);
    else
        snprintf (h, sizeof (h), "%s:%c", r.name, r.sep);
    rigctld_send (r.sock, h);
}

// One GET result field. Terse: the bare value on its own line. Extended:
// "Label: value<sep>" under the once-emitted header.
static void resp_field (Resp & r, const char * label, const char * value) {
    r.valued = true;
    char line[96];
    if (r.ext) {
        resp_hdr (r);
        snprintf (line, sizeof (line), "%s: %s%c", label, value, r.sep);
    }
    else
        snprintf (line, sizeof (line), "%s\n", value);
    rigctld_send (r.sock, line);
}

// Terminate. Extended: header (if not yet) then "RPRT <code><sep>", plus a
// closing newline when the separator is not itself a newline. Terse: a GET
// that produced a value needs no RPRT; SETs and every error send "RPRT
// <code>".
static void resp_end (Resp & r, int code) {
    if (r.ext) {
        resp_hdr (r);
        char e[24];
        snprintf (e, sizeof (e), "RPRT %d%c", code, r.sep);
        rigctld_send (r.sock, e);
        if (r.sep != '\n')
            rigctld_send (r.sock, "\n");
    }
    else if (!(r.valued && code == RIG_OK))
        rigctld_rprt (r.sock, code);
}

// Fetch a fresh snapshot for `which`'s field, blocking briefly while the
// service refreshes it. During FT8 the service does no CAT work, so serve
// the (possibly stale) snapshot instead of blocking out the transmission —
// same contract as the web GETs. Returns RIG_OK with *out filled (the
// caller still checks the field's has_*()), or a negative Hamlib error.
static int rigctld_fetch (RadioCmdType which, RadioSnapshotData & out) {
    if (!Ft8RadioExclusive && !radio_service_refresh_wait (which, RIGCTLD_GET_WAIT_MS))
        return radio_service_link_up() ? RIG_ETIMEOUT : RIG_EIO;
    out = radio_snapshot::get();
    return RIG_OK;
}

// Enqueue a SET on the radio service and wait for the worker to drain it.
static int rigctld_apply (RadioCmdType type, long arg) {
    if (Ft8RadioExclusive)
        return RIG_ERJCTED;
    uint32_t gen = 0;
    if (radio_service_set (type, arg, &gen) < 0)
        return RIG_EIO;  // link down, or service not started
    switch (radio_service_set_wait (type, gen, RIGCTLD_SET_WAIT_MS)) {
    case 1: return RIG_OK;
    case 0: return RIG_EIO;  // CAT failed, or expired-skipped
    default: return RIG_ETIMEOUT;
    }
}

static void cmd_get_freq (Resp & r) {
    RadioSnapshotData s;
    int               rc = rigctld_fetch (RadioCmdType::REFRESH_FREQUENCY, s);
    if (rc == RIG_OK && s.has_frequency()) {
        char v[24];
        snprintf (v, sizeof (v), "%ld", s.frequency_hz);
        resp_field (r, "Frequency", v);
        resp_end (r, RIG_OK);
    }
    else
        resp_end (r, rc == RIG_OK ? RIG_EIO : rc);
}

static void cmd_set_freq (Resp & r, const char * arg) {
    // Hamlib sends frequency as a float ("14074000.000000"); atol takes
    // the integer prefix.
    long freq = arg ? atol (arg) : 0;
    if (freq <= 0) {
        resp_end (r, RIG_EINVAL);
        return;
    }
    resp_end (r, rigctld_apply (RadioCmdType::SET_FREQUENCY, freq));
}

static void cmd_get_mode (Resp & r) {
    RadioSnapshotData s;
    int               rc = rigctld_fetch (RadioCmdType::REFRESH_MODE, s);
    if (rc == RIG_OK && s.has_mode()) {
        resp_field (r, "Mode", rigctld_mode_to_hamlib (s.mode));
        resp_field (r, "Passband", "0");
        resp_end (r, RIG_OK);
    }
    else
        resp_end (r, rc == RIG_OK ? RIG_EIO : rc);
}

static void cmd_set_mode (Resp & r, const char * arg) {
    if (!arg || !*arg) {
        resp_end (r, RIG_EINVAL);
        return;
    }

    // Only the mode name; any passband argument after the space is ignored.
    char mode_name[16];
    int  i = 0;
    for (; arg[i] && arg[i] != ' ' && i < (int)sizeof (mode_name) - 1; i++)
        mode_name[i] = arg[i];
    mode_name[i] = '\0';

    long mode = rigctld_hamlib_to_mode (mode_name);
    if (mode == RIGCTLD_MODE_UNKNOWN) {
        resp_end (r, RIG_EINVAL);
        return;
    }
    resp_end (r, rigctld_apply (RadioCmdType::SET_MODE, mode));
}

static void cmd_get_ptt (Resp & r) {
    // The CW keyer holds the radio outside the service (sanctioned direct
    // path), so the snapshot can't see that TX; the claim flag can.
    if (kxRadio.is_keyer_active()) {
        resp_field (r, "PTT", "1");
        resp_end (r, RIG_OK);
        return;
    }
    RadioSnapshotData s;
    int               rc = rigctld_fetch (RadioCmdType::REFRESH_XMIT, s);
    if (rc == RIG_OK && s.has_xmit()) {
        resp_field (r, "PTT", s.xmit_state ? "1" : "0");
        resp_end (r, RIG_OK);
    }
    else
        resp_end (r, rc == RIG_OK ? RIG_EIO : rc);
}

static void cmd_set_ptt (Resp & r, const char * arg) {
    if (!arg || !*arg) {
        resp_end (r, RIG_EINVAL);
        return;
    }
    resp_end (r, rigctld_apply (RadioCmdType::SET_XMIT, atol (arg)));
}

static void cmd_get_vfo (Resp & r) {
    resp_field (r, "VFO", "VFOA");
    resp_end (r, RIG_OK);
}

static void cmd_get_split_vfo (Resp & r) {
    resp_field (r, "Split", "0");
    resp_field (r, "TX VFO", "VFOA");
    resp_end (r, RIG_OK);
}

// Hamlib probes power status at session start; the link state is the honest
// answer (a dead link most often IS the radio powered off). set_powerstat is
// deliberately unimplemented: PS0 would power the radio OFF.
static void cmd_get_powerstat (Resp & r) {
    resp_field (r, "Power Status", radio_service_link_up() ? "1" : "0");
    resp_end (r, RIG_OK);
}

// Single-VFO server (until split lands): selecting VFOA is a no-op success,
// anything else is unimplemented.
static void cmd_set_vfo (Resp & r, const char * arg) {
    if (!arg || !*arg) {
        resp_end (r, RIG_EINVAL);
        return;
    }
    if (!strcasecmp (arg, "VFOA") || !strcasecmp (arg, "Main") || !strcasecmp (arg, "currVFO"))
        resp_end (r, RIG_OK);
    else
        resp_end (r, RIG_ENIMPL);
}

// TUNER is the only func: the ATU tune is a momentary switch press, never
// latched, so get always reads 0 and "set 0" has nothing to do.
static void cmd_get_func (Resp & r, const char * arg) {
    char func[16];
    if (!rigctld_split_level (arg, func, sizeof (func), nullptr)) {
        resp_end (r, RIG_EINVAL);
        return;
    }
    if (!strcmp (func, "TUNER")) {
        resp_field (r, "Func Status", "0");
        resp_end (r, RIG_OK);
    }
    else
        resp_end (r, RIG_ENIMPL);
}

static void cmd_set_func (Resp & r, const char * arg) {
    char         func[16];
    const char * val_str = nullptr;
    if (!rigctld_split_level (arg, func, sizeof (func), &val_str) || !val_str) {
        resp_end (r, RIG_EINVAL);
        return;
    }
    if (strcmp (func, "TUNER") != 0) {
        resp_end (r, RIG_ENIMPL);
        return;
    }
    if (atol (val_str) == 0) {
        resp_end (r, RIG_OK);  // nothing to disengage
        return;
    }
    // RPRT 0 means "tune started": the KX ATU tune is fire-and-forget at the
    // CAT level (a switch press with no completion readback).
    resp_end (r, rigctld_apply (RadioCmdType::SET_ATU, 0));
}

static void cmd_get_level (Resp & r, const char * arg) {
    char level[24];
    if (!rigctld_split_level (arg, level, sizeof (level), nullptr)) {
        resp_end (r, RIG_EINVAL);
        return;
    }

    if (!strcmp (level, "RFPOWER")) {
        RadioSnapshotData s;
        int               rc = rigctld_fetch (RadioCmdType::REFRESH_POWER, s);
        if (rc == RIG_OK && s.has_power()) {
            char v[16];
            snprintf (v, sizeof (v), "%.4f", rigctld_rfpower_from_watts (s.power));
            resp_field (r, "Level Value", v);
            resp_end (r, RIG_OK);
        }
        else
            resp_end (r, rc == RIG_OK ? RIG_EIO : rc);
    }
    else if (!strcmp (level, "AF")) {
        if (!kxRadio.supports_volume()) {
            resp_end (r, RIG_ENIMPL);
            return;
        }
        RadioSnapshotData s;
        int               rc = rigctld_fetch (RadioCmdType::REFRESH_VOLUME, s);
        if (rc == RIG_OK && s.has_volume()) {
            char v[16];
            snprintf (v, sizeof (v), "%.4f", rigctld_af_from_volume (s.volume));
            resp_field (r, "Level Value", v);
            resp_end (r, RIG_OK);
        }
        else
            resp_end (r, rc == RIG_OK ? RIG_EIO : rc);
    }
    else if (!strcmp (level, "STRENGTH") || !strcmp (level, "RAWSTR")) {
        if (!kxRadio.supports_smeter()) {
            resp_end (r, RIG_ENIMPL);
            return;
        }
        RadioSnapshotData s;
        int               rc = rigctld_fetch (RadioCmdType::REFRESH_SMETER, s);
        if (rc == RIG_OK && s.has_smeter()) {
            char v[16];
            // RAWSTR: the raw KX bar count. STRENGTH: calibrated dB rel S9.
            snprintf (v, sizeof (v), "%ld", level[0] == 'R' ? s.smeter : rigctld_strength_db_from_bars (s.smeter));
            resp_field (r, "Level Value", v);
            resp_end (r, RIG_OK);
        }
        else
            resp_end (r, rc == RIG_OK ? RIG_EIO : rc);
    }
    else
        resp_end (r, RIG_ENIMPL);
}

static void cmd_set_level (Resp & r, const char * arg) {
    char         level[24];
    const char * val_str = nullptr;
    if (!rigctld_split_level (arg, level, sizeof (level), &val_str) || !val_str) {
        resp_end (r, RIG_EINVAL);
        return;
    }

    float val = strtof (val_str, nullptr);

    if (!strcmp (level, "RFPOWER")) {
        resp_end (r, rigctld_apply (RadioCmdType::SET_POWER, rigctld_watts_from_rfpower (val)));
    }
    else if (!strcmp (level, "AF")) {
        if (!kxRadio.supports_volume()) {
            resp_end (r, RIG_ENIMPL);
            return;
        }
        // Hamlib AF is absolute, but SET_VOLUME's arg is a delta in web-UI
        // steps: read the current volume and step toward the target.
        RadioSnapshotData s;
        int               rc = rigctld_fetch (RadioCmdType::REFRESH_VOLUME, s);
        if (rc != RIG_OK || !s.has_volume()) {
            resp_end (r, rc == RIG_OK ? RIG_EIO : rc);
            return;
        }
        long delta = rigctld_af_step_delta (rigctld_af_target (val), s.volume);
        if (delta == 0) {
            resp_end (r, RIG_OK);  // nearest step is where we already are
            return;
        }
        resp_end (r, rigctld_apply (RadioCmdType::SET_VOLUME, delta));
    }
    else
        resp_end (r, RIG_ENIMPL);
}

static void cmd_send_morse (Resp & r, const char * arg) {
    if (!arg || !*arg) {
        resp_end (r, RIG_EINVAL);
        return;
    }
    if (!kxRadio.supports_keyer()) {
        resp_end (r, RIG_ENIMPL);
        return;
    }
    if (Ft8RadioExclusive) {
        resp_end (r, RIG_ERJCTED);
        return;
    }
    // Keying takes the radio mutex directly — the sanctioned keyer path
    // (see handler_cat.cpp keyer_task): claim the keyer so the web UI
    // shows TX and the two keyer entry points exclude each other, then
    // hold the mutex for the whole transmission. rigctld has its own
    // task, so unlike the HTTP handler no helper task is needed.
    if (!kxRadio.try_begin_keyer_operation()) {
        resp_end (r, RIG_ERJCTED);  // keyer busy
        return;
    }
    bool ok = false;
    {
        TimedLock lock = kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_CRITICAL_MS, "rigctld morse");
        if (lock.acquired()) {
            esp_task_wdt_reset();  // budget the ~15 s keying after the lock wait, not with it
            ok = kxRadio.send_keyer_message (arg);
        }
    }
    kxRadio.end_keyer_operation();
    resp_end (r, ok ? RIG_OK : RIG_EIO);
}

static void cmd_get_info (Resp & r) {
    char info[48];
    snprintf (info, sizeof (info), "SOTAcat %s", kxRadio.get_radio_type_string());
    resp_field (r, "Info", info);
    resp_end (r, RIG_OK);
}

static void cmd_dump_state (int sock) {
    // Protocol version 1 dump_state response
    static const char dump[] =
        "1\n"                                              // protocol version
        "2\n"                                              // rig model = netrigctl
        "0\n"                                              // ITU region
        "500000 54000000 0x1ff -1 -1 0x40000003 0x3\n"     // RX range
        "0 0 0 0 0 0 0\n"                                  // RX range sentinel
        "500000 54000000 0x1ff 10 12000 0x40000003 0x3\n"  // TX range
        "0 0 0 0 0 0 0\n"                                  // TX range sentinel
        "0 0\n"                                            // tuning steps sentinel
        "0 0\n"                                            // filters sentinel
        "0\n"                                              // max RIT
        "0\n"                                              // max XIT
        "0\n"                                              // max IF shift
        "0\n"                                              // announces
        "\n"                                               // preamp
        "\n"                                               // attenuator
        // Bit values from Hamlib 4.5.5 rig.h. Hamlib clients refuse any
        // level/func not advertised here, so these masks are load-bearing.
        // A radio lacking one at runtime (KH1: AF, SM) still answers -4.
        "0x40000000\n"  // has_get_func: TUNER
        "0x40000000\n"  // has_set_func: TUNER
        "0x44001008\n"  // has_get_level: AF|RFPOWER|RAWSTR|STRENGTH
        "0x1008\n"      // has_set_level: AF|RFPOWER
        "0x0\n"         // has_get_parm
        "0x0\n"         // has_set_parm
        "done\n";

    rigctld_send (sock, dump);
}

// chk_vfo (Hamlib 0xf0) is excluded from the extended header/RPRT wrapping
// even under a '+' prefix, so it always replies with the bare VFO-mode flag.
static void cmd_chk_vfo (int sock) {
    rigctld_send (sock, "0\n");
}

// ====================================================================================================
// Command dispatcher
// ====================================================================================================

static bool rigctld_handle_command (int sock, const char * line) {
    ESP_LOGI (TAG8, "rigctld cmd: '%s'", line);

    Resp r;
    r.sock               = sock;
    const char * cmdline = rigctld_ext_prefix (line, &r.ext, &r.sep);
    const char * arg     = nullptr;
    switch (rigctld_parse_line (cmdline, &arg)) {
    case RigctlCmd::NONE: break;  // empty line, keep connection
    case RigctlCmd::GET_FREQ:
        r.name = "get_freq";
        cmd_get_freq (r);
        break;
    case RigctlCmd::SET_FREQ:
        r.name = "set_freq";
        cmd_set_freq (r, arg);
        break;
    case RigctlCmd::GET_MODE:
        r.name = "get_mode";
        cmd_get_mode (r);
        break;
    case RigctlCmd::SET_MODE:
        r.name = "set_mode";
        cmd_set_mode (r, arg);
        break;
    case RigctlCmd::GET_PTT:
        r.name = "get_ptt";
        cmd_get_ptt (r);
        break;
    case RigctlCmd::SET_PTT:
        r.name = "set_ptt";
        cmd_set_ptt (r, arg);
        break;
    case RigctlCmd::GET_VFO:
        r.name = "get_vfo";
        cmd_get_vfo (r);
        break;
    case RigctlCmd::GET_SPLIT_VFO:
        r.name = "get_split_vfo";
        cmd_get_split_vfo (r);
        break;
    case RigctlCmd::GET_LEVEL:
        r.name   = "get_level";
        r.hdrarg = arg;
        cmd_get_level (r, arg);
        break;
    case RigctlCmd::SET_LEVEL:
        r.name   = "set_level";
        r.hdrarg = arg;
        cmd_set_level (r, arg);
        break;
    case RigctlCmd::SEND_MORSE:
        r.name = "send_morse";
        cmd_send_morse (r, arg);
        break;
    case RigctlCmd::GET_INFO:
        r.name = "get_info";
        cmd_get_info (r);
        break;
    case RigctlCmd::DUMP_STATE: cmd_dump_state (sock); break;
    case RigctlCmd::CHK_VFO: cmd_chk_vfo (sock); break;
    case RigctlCmd::GET_POWERSTAT:
        r.name = "get_powerstat";
        cmd_get_powerstat (r);
        break;
    case RigctlCmd::SET_VFO:
        r.name = "set_vfo";
        cmd_set_vfo (r, arg);
        break;
    case RigctlCmd::GET_FUNC:
        r.name   = "get_func";
        r.hdrarg = arg;
        cmd_get_func (r, arg);
        break;
    case RigctlCmd::SET_FUNC:
        r.name   = "set_func";
        r.hdrarg = arg;
        cmd_set_func (r, arg);
        break;
    case RigctlCmd::QUIT:
        r.name = "quit";
        resp_end (r, RIG_OK);
        return false;  // close the connection
    case RigctlCmd::UNKNOWN:
    default:
        resp_end (r, RIG_ENIMPL);
        break;
    }
    return true;
}

// ====================================================================================================
// TCP server task
// ====================================================================================================

// Up to RIGCTLD_MAX_CLIENTS concurrent sessions (e.g. WSJT-X + a logger),
// multiplexed with select() on this one task. Commands from all clients
// are SERIALIZED: while one client's SET waits on the worker (<= 5 s) or
// a morse transmission keys (~15 s), the others' input simply queues in
// their sockets — same latency bound one client always had. When every
// slot is taken, the listen socket is left OUT of the select set, so a
// further connect waits in the TCP backlog until a slot frees (the
// pre-multi-client behavior).
struct RigctldClient {
    int  sock = -1;
    char line[RIGCTLD_MAX_LINE];
    int  len = 0;
};

static void rigctld_close_client (RigctldClient & c) {
    close (c.sock);
    c.sock = -1;
    c.len  = 0;
    ESP_LOGI (TAG8, "rigctld client disconnected");
}

// Drain what recv() returned, handling every complete line. Returns false
// when the connection should close (peer gone, error, or quit).
static bool rigctld_client_input (RigctldClient & c) {
    char buf[128];
    int  n = recv (c.sock, buf, sizeof (buf), 0);
    if (n <= 0)
        return false;  // closed or error
    for (int i = 0; i < n; ++i) {
        char ch = buf[i];
        if (ch == '\n') {
            // Strip trailing \r if present
            if (c.len > 0 && c.line[c.len - 1] == '\r')
                c.len--;
            c.line[c.len] = '\0';
            c.len         = 0;
            showActivity();
            if (!rigctld_handle_command (c.sock, c.line))
                return false;
        }
        else if (c.len < RIGCTLD_MAX_LINE - 1)
            c.line[c.len++] = ch;
        // Overlong line: excess bytes are dropped; the truncated line is
        // handled at the newline (matches the old reader's behavior).
    }
    return true;
}

static void rigctld_server_task (void *) {
    ESP_ERROR_CHECK (esp_task_wdt_add (NULL));

    int listen_sock = socket (AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listen_sock < 0) {
        ESP_LOGE (TAG8, "failed to create socket: errno %d", errno);
        esp_task_wdt_delete (NULL);
        vTaskDelete (NULL);
        return;
    }

    int opt = 1;
    setsockopt (listen_sock, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof (opt));

    struct sockaddr_in addr = {};
    addr.sin_family         = AF_INET;
    addr.sin_addr.s_addr    = htonl (INADDR_ANY);
    addr.sin_port           = htons (RIGCTLD_PORT);

    if (bind (listen_sock, (struct sockaddr *)&addr, sizeof (addr)) < 0) {
        ESP_LOGE (TAG8, "bind failed: errno %d", errno);
        close (listen_sock);
        esp_task_wdt_delete (NULL);
        vTaskDelete (NULL);
        return;
    }

    if (listen (listen_sock, 1) < 0) {
        ESP_LOGE (TAG8, "listen failed: errno %d", errno);
        close (listen_sock);
        esp_task_wdt_delete (NULL);
        vTaskDelete (NULL);
        return;
    }

    ESP_LOGI (TAG8, "rigctld server listening on port %d (max %d clients)", RIGCTLD_PORT, RIGCTLD_MAX_CLIENTS);

    static RigctldClient clients[RIGCTLD_MAX_CLIENTS];

    while (true) {
        esp_task_wdt_reset();

        fd_set rfds;
        FD_ZERO (&rfds);
        int  maxfd     = -1;
        bool have_slot = false;
        for (auto & c : clients)
            if (c.sock < 0)
                have_slot = true;
        if (have_slot) {  // full table: leave connects in the backlog
            FD_SET (listen_sock, &rfds);
            maxfd = listen_sock;
        }
        for (auto & c : clients)
            if (c.sock >= 0) {
                FD_SET (c.sock, &rfds);
                if (c.sock > maxfd)
                    maxfd = c.sock;
            }

        // 1 s bound keeps the task watchdog fed while idle.
        struct timeval tv = {.tv_sec = 1, .tv_usec = 0};
        int            n  = select (maxfd + 1, &rfds, NULL, NULL, &tv);
        if (n < 0) {
            ESP_LOGW (TAG8, "select failed: errno %d", errno);
            vTaskDelay (pdMS_TO_TICKS (1000));
            continue;
        }
        if (n == 0)
            continue;  // timeout: loop back to feed the watchdog

        if (have_slot && FD_ISSET (listen_sock, &rfds)) {
            struct sockaddr_in client_addr;
            socklen_t          client_len  = sizeof (client_addr);
            int                client_sock = accept (listen_sock, (struct sockaddr *)&client_addr, &client_len);
            if (client_sock >= 0) {
                int nodelay = 1;  // responsive command/response
                setsockopt (client_sock, IPPROTO_TCP, TCP_NODELAY, &nodelay, sizeof (nodelay));
                for (auto & c : clients)
                    if (c.sock < 0) {
                        c.sock = client_sock;
                        c.len  = 0;
                        ESP_LOGI (TAG8, "rigctld client connected from %s", inet_ntoa (client_addr.sin_addr));
                        client_sock = -1;
                        break;
                    }
                if (client_sock >= 0)
                    close (client_sock);  // unreachable: have_slot was checked
            }
        }

        for (auto & c : clients)
            if (c.sock >= 0 && FD_ISSET (c.sock, &rfds)) {
                esp_task_wdt_reset();  // a command can run for seconds
                if (!rigctld_client_input (c))
                    rigctld_close_client (c);
            }
    }
}

void start_rigctld_server () {
    xTaskCreate (&rigctld_server_task, "rigctld_task", RIGCTLD_STACK_SIZE, NULL, SC_TASK_PRIORITY_NORMAL, NULL);
    ESP_LOGI (TAG8, "rigctld server task started");
}
