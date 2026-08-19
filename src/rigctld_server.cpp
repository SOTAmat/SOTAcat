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

static void cmd_get_freq (int sock) {
    RadioSnapshotData s;
    int               rc = rigctld_fetch (RadioCmdType::REFRESH_FREQUENCY, s);
    if (rc == RIG_OK && s.has_frequency()) {
        char resp[32];
        snprintf (resp, sizeof (resp), "%ld\n", s.frequency_hz);
        rigctld_send (sock, resp);
    }
    else
        rigctld_rprt (sock, rc == RIG_OK ? RIG_EIO : rc);
}

static void cmd_set_freq (int sock, const char * arg) {
    // Hamlib sends frequency as a float ("14074000.000000"); atol takes
    // the integer prefix.
    long freq = arg ? atol (arg) : 0;
    if (freq <= 0) {
        rigctld_rprt (sock, RIG_EINVAL);
        return;
    }
    rigctld_rprt (sock, rigctld_apply (RadioCmdType::SET_FREQUENCY, freq));
}

static void cmd_get_mode (int sock) {
    RadioSnapshotData s;
    int               rc = rigctld_fetch (RadioCmdType::REFRESH_MODE, s);
    if (rc == RIG_OK && s.has_mode()) {
        char resp[32];
        snprintf (resp, sizeof (resp), "%s\n0\n", rigctld_mode_to_hamlib (s.mode));
        rigctld_send (sock, resp);
    }
    else
        rigctld_rprt (sock, rc == RIG_OK ? RIG_EIO : rc);
}

static void cmd_set_mode (int sock, const char * arg) {
    if (!arg || !*arg) {
        rigctld_rprt (sock, RIG_EINVAL);
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
        rigctld_rprt (sock, RIG_EINVAL);
        return;
    }
    rigctld_rprt (sock, rigctld_apply (RadioCmdType::SET_MODE, mode));
}

static void cmd_get_ptt (int sock) {
    // The CW keyer holds the radio outside the service (sanctioned direct
    // path), so the snapshot can't see that TX; the claim flag can.
    if (kxRadio.is_keyer_active()) {
        rigctld_send (sock, "1\n");
        return;
    }
    RadioSnapshotData s;
    int               rc = rigctld_fetch (RadioCmdType::REFRESH_XMIT, s);
    if (rc == RIG_OK && s.has_xmit()) {
        char resp[16];
        snprintf (resp, sizeof (resp), "%ld\n", s.xmit_state);
        rigctld_send (sock, resp);
    }
    else
        rigctld_rprt (sock, rc == RIG_OK ? RIG_EIO : rc);
}

static void cmd_set_ptt (int sock, const char * arg) {
    if (!arg || !*arg) {
        rigctld_rprt (sock, RIG_EINVAL);
        return;
    }
    rigctld_rprt (sock, rigctld_apply (RadioCmdType::SET_XMIT, atol (arg)));
}

static void cmd_get_vfo (int sock) {
    rigctld_send (sock, "VFOA\n");
}

static void cmd_get_split_vfo (int sock) {
    rigctld_send (sock, "0\nVFOA\n");
}

// Hamlib probes power status at session start; the link state is the honest
// answer (a dead link most often IS the radio powered off). set_powerstat is
// deliberately unimplemented: PS0 would power the radio OFF.
static void cmd_get_powerstat (int sock) {
    rigctld_send (sock, radio_service_link_up() ? "1\n" : "0\n");
}

// Single-VFO server (until split lands): selecting VFOA is a no-op success,
// anything else is unimplemented.
static void cmd_set_vfo (int sock, const char * arg) {
    if (!arg || !*arg) {
        rigctld_rprt (sock, RIG_EINVAL);
        return;
    }
    if (!strcasecmp (arg, "VFOA") || !strcasecmp (arg, "Main") || !strcasecmp (arg, "currVFO"))
        rigctld_rprt (sock, RIG_OK);
    else
        rigctld_rprt (sock, RIG_ENIMPL);
}

// TUNER is the only func: the ATU tune is a momentary switch press, never
// latched, so get always reads 0 and "set 0" has nothing to do.
static void cmd_get_func (int sock, const char * arg) {
    char func[16];
    if (!rigctld_split_level (arg, func, sizeof (func), nullptr)) {
        rigctld_rprt (sock, RIG_EINVAL);
        return;
    }
    if (!strcmp (func, "TUNER"))
        rigctld_send (sock, "0\n");
    else
        rigctld_rprt (sock, RIG_ENIMPL);
}

static void cmd_set_func (int sock, const char * arg) {
    char         func[16];
    const char * val_str = nullptr;
    if (!rigctld_split_level (arg, func, sizeof (func), &val_str) || !val_str) {
        rigctld_rprt (sock, RIG_EINVAL);
        return;
    }
    if (strcmp (func, "TUNER") != 0) {
        rigctld_rprt (sock, RIG_ENIMPL);
        return;
    }
    if (atol (val_str) == 0) {
        rigctld_rprt (sock, RIG_OK);  // nothing to disengage
        return;
    }
    // RPRT 0 means "tune started": the KX ATU tune is fire-and-forget at the
    // CAT level (a switch press with no completion readback).
    rigctld_rprt (sock, rigctld_apply (RadioCmdType::SET_ATU, 0));
}

static void cmd_get_level (int sock, const char * arg) {
    char level[16];
    if (!rigctld_split_level (arg, level, sizeof (level), nullptr)) {
        rigctld_rprt (sock, RIG_EINVAL);
        return;
    }

    if (!strcmp (level, "RFPOWER")) {
        RadioSnapshotData s;
        int               rc = rigctld_fetch (RadioCmdType::REFRESH_POWER, s);
        if (rc == RIG_OK && s.has_power()) {
            char resp[32];
            snprintf (resp, sizeof (resp), "%.4f\n", rigctld_rfpower_from_watts (s.power));
            rigctld_send (sock, resp);
        }
        else
            rigctld_rprt (sock, rc == RIG_OK ? RIG_EIO : rc);
    }
    else if (!strcmp (level, "AF")) {
        if (!kxRadio.supports_volume()) {
            rigctld_rprt (sock, RIG_ENIMPL);
            return;
        }
        RadioSnapshotData s;
        int               rc = rigctld_fetch (RadioCmdType::REFRESH_VOLUME, s);
        if (rc == RIG_OK && s.has_volume()) {
            char resp[32];
            snprintf (resp, sizeof (resp), "%.4f\n", rigctld_af_from_volume (s.volume));
            rigctld_send (sock, resp);
        }
        else
            rigctld_rprt (sock, rc == RIG_OK ? RIG_EIO : rc);
    }
    else if (!strcmp (level, "STRENGTH") || !strcmp (level, "RAWSTR")) {
        if (!kxRadio.supports_smeter()) {
            rigctld_rprt (sock, RIG_ENIMPL);
            return;
        }
        RadioSnapshotData s;
        int               rc = rigctld_fetch (RadioCmdType::REFRESH_SMETER, s);
        if (rc == RIG_OK && s.has_smeter()) {
            char resp[32];
            // RAWSTR: the raw KX bar count. STRENGTH: calibrated dB rel S9.
            snprintf (resp, sizeof (resp), "%ld\n", level[0] == 'R' ? s.smeter : rigctld_strength_db_from_bars (s.smeter));
            rigctld_send (sock, resp);
        }
        else
            rigctld_rprt (sock, rc == RIG_OK ? RIG_EIO : rc);
    }
    else
        rigctld_rprt (sock, RIG_ENIMPL);
}

static void cmd_set_level (int sock, const char * arg) {
    char         level[16];
    const char * val_str = nullptr;
    if (!rigctld_split_level (arg, level, sizeof (level), &val_str) || !val_str) {
        rigctld_rprt (sock, RIG_EINVAL);
        return;
    }

    float val = strtof (val_str, nullptr);

    if (!strcmp (level, "RFPOWER")) {
        rigctld_rprt (sock, rigctld_apply (RadioCmdType::SET_POWER, rigctld_watts_from_rfpower (val)));
    }
    else if (!strcmp (level, "AF")) {
        if (!kxRadio.supports_volume()) {
            rigctld_rprt (sock, RIG_ENIMPL);
            return;
        }
        // Hamlib AF is absolute, but SET_VOLUME's arg is a delta in web-UI
        // steps: read the current volume and step toward the target.
        RadioSnapshotData s;
        int               rc = rigctld_fetch (RadioCmdType::REFRESH_VOLUME, s);
        if (rc != RIG_OK || !s.has_volume()) {
            rigctld_rprt (sock, rc == RIG_OK ? RIG_EIO : rc);
            return;
        }
        long delta = rigctld_af_step_delta (rigctld_af_target (val), s.volume);
        if (delta == 0) {
            rigctld_rprt (sock, RIG_OK);  // nearest step is where we already are
            return;
        }
        rigctld_rprt (sock, rigctld_apply (RadioCmdType::SET_VOLUME, delta));
    }
    else
        rigctld_rprt (sock, RIG_ENIMPL);
}

static void cmd_send_morse (int sock, const char * arg) {
    if (!arg || !*arg) {
        rigctld_rprt (sock, RIG_EINVAL);
        return;
    }
    if (!kxRadio.supports_keyer()) {
        rigctld_rprt (sock, RIG_ENIMPL);
        return;
    }
    if (Ft8RadioExclusive) {
        rigctld_rprt (sock, RIG_ERJCTED);
        return;
    }
    // Keying takes the radio mutex directly — the sanctioned keyer path
    // (see handler_cat.cpp keyer_task): claim the keyer so the web UI
    // shows TX and the two keyer entry points exclude each other, then
    // hold the mutex for the whole transmission. rigctld has its own
    // task, so unlike the HTTP handler no helper task is needed.
    if (!kxRadio.try_begin_keyer_operation()) {
        rigctld_rprt (sock, RIG_ERJCTED);  // keyer busy
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
    rigctld_rprt (sock, ok ? RIG_OK : RIG_EIO);
}

static void cmd_get_info (int sock) {
    char resp[64];
    snprintf (resp, sizeof (resp), "SOTAcat %s\n", kxRadio.get_radio_type_string());
    rigctld_send (sock, resp);
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

static void cmd_chk_vfo (int sock) {
    rigctld_send (sock, "0\n");
}

// ====================================================================================================
// Command dispatcher
// ====================================================================================================

static bool rigctld_handle_command (int sock, const char * line) {
    ESP_LOGI (TAG8, "rigctld cmd: '%s'", line);

    const char * arg = nullptr;
    switch (rigctld_parse_line (line, &arg)) {
    case RigctlCmd::NONE: break;  // empty line, keep connection
    case RigctlCmd::GET_FREQ: cmd_get_freq (sock); break;
    case RigctlCmd::SET_FREQ: cmd_set_freq (sock, arg); break;
    case RigctlCmd::GET_MODE: cmd_get_mode (sock); break;
    case RigctlCmd::SET_MODE: cmd_set_mode (sock, arg); break;
    case RigctlCmd::GET_PTT: cmd_get_ptt (sock); break;
    case RigctlCmd::SET_PTT: cmd_set_ptt (sock, arg); break;
    case RigctlCmd::GET_VFO: cmd_get_vfo (sock); break;
    case RigctlCmd::GET_SPLIT_VFO: cmd_get_split_vfo (sock); break;
    case RigctlCmd::GET_LEVEL: cmd_get_level (sock, arg); break;
    case RigctlCmd::SET_LEVEL: cmd_set_level (sock, arg); break;
    case RigctlCmd::SEND_MORSE: cmd_send_morse (sock, arg); break;
    case RigctlCmd::GET_INFO: cmd_get_info (sock); break;
    case RigctlCmd::DUMP_STATE: cmd_dump_state (sock); break;
    case RigctlCmd::CHK_VFO: cmd_chk_vfo (sock); break;
    case RigctlCmd::GET_POWERSTAT: cmd_get_powerstat (sock); break;
    case RigctlCmd::SET_VFO: cmd_set_vfo (sock, arg); break;
    case RigctlCmd::GET_FUNC: cmd_get_func (sock, arg); break;
    case RigctlCmd::SET_FUNC: cmd_set_func (sock, arg); break;
    case RigctlCmd::QUIT:
        rigctld_send (sock, "RPRT 0\n");
        return false;  // close the connection
    case RigctlCmd::UNKNOWN:
    default:
        rigctld_rprt (sock, RIG_ENIMPL);
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
