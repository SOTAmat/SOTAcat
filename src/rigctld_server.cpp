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

static constexpr int RIGCTLD_PORT         = 4532;
static constexpr int RIGCTLD_MAX_LINE     = 256;
static constexpr int RIGCTLD_RECV_TIMEOUT = 2;  // seconds
static constexpr int RIGCTLD_STACK_SIZE   = 6144;

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

static int rigctld_read_line (int sock, char * buf, int buf_size) {
    int pos = 0;
    while (pos < buf_size - 1) {
        char c;
        int  n = recv (sock, &c, 1, 0);
        if (n < 0) {
            if (errno == EAGAIN || errno == EWOULDBLOCK)
                return -1;  // timeout
            return -2;      // error
        }
        if (n == 0)
            return -2;  // connection closed
        if (c == '\n') {
            // Strip trailing \r if present
            if (pos > 0 && buf[pos - 1] == '\r')
                pos--;
            buf[pos] = '\0';
            return pos;
        }
        buf[pos++] = c;
    }
    buf[pos] = '\0';
    return pos;
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
        "0x0\n"                                            // has_get_func
        "0x0\n"                                            // has_set_func
        "0x0\n"                                            // has_get_level
        "0x0\n"                                            // has_set_level
        "0x0\n"                                            // has_get_parm
        "0x0\n"                                            // has_set_parm
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

    ESP_LOGI (TAG8, "rigctld server listening on port %d", RIGCTLD_PORT);

    while (true) {
        esp_task_wdt_reset();

        // Use a timeout on accept so we can feed the watchdog
        struct timeval accept_tv;
        accept_tv.tv_sec  = 5;
        accept_tv.tv_usec = 0;
        setsockopt (listen_sock, SOL_SOCKET, SO_RCVTIMEO, &accept_tv, sizeof (accept_tv));

        struct sockaddr_in client_addr;
        socklen_t          client_len  = sizeof (client_addr);
        int                client_sock = accept (listen_sock, (struct sockaddr *)&client_addr, &client_len);

        if (client_sock < 0) {
            if (errno == EAGAIN || errno == EWOULDBLOCK)
                continue;  // timeout, loop back to feed watchdog
            ESP_LOGW (TAG8, "accept failed: errno %d", errno);
            vTaskDelay (pdMS_TO_TICKS (1000));
            continue;
        }

        ESP_LOGI (TAG8, "rigctld client connected from %s", inet_ntoa (client_addr.sin_addr));

        // Set receive timeout on client socket
        struct timeval recv_tv;
        recv_tv.tv_sec  = RIGCTLD_RECV_TIMEOUT;
        recv_tv.tv_usec = 0;
        setsockopt (client_sock, SOL_SOCKET, SO_RCVTIMEO, &recv_tv, sizeof (recv_tv));

        // Disable Nagle's algorithm for responsive command/response
        int nodelay = 1;
        setsockopt (client_sock, IPPROTO_TCP, TCP_NODELAY, &nodelay, sizeof (nodelay));

        // Handle commands from this client
        char line[RIGCTLD_MAX_LINE];
        bool keep_going = true;
        while (keep_going) {
            esp_task_wdt_reset();

            int len = rigctld_read_line (client_sock, line, sizeof (line));
            if (len == -1)
                continue;  // timeout, keep waiting
            if (len == -2)
                break;  // connection closed or error

            showActivity();
            keep_going = rigctld_handle_command (client_sock, line);
        }

        close (client_sock);
        ESP_LOGI (TAG8, "rigctld client disconnected");
    }
}

void start_rigctld_server () {
    xTaskCreate (&rigctld_server_task, "rigctld_task", RIGCTLD_STACK_SIZE, NULL, SC_TASK_PRIORITY_NORMAL, NULL);
    ESP_LOGI (TAG8, "rigctld server task started");
}
