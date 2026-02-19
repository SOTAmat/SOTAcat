/*
 * Implements (minimal) RIGCTL protocol on TCP port 4532
 * See https://manpages.ubuntu.com/manpages/xenial/man1/rigctl.1.html for commands
 * Typical usage: rigctl --rig-file=sotacat.local --model=2
 */

#include "rigctld_server.h"
#include "globals.h"
#include "kx_radio.h"
#include "timed_lock.h"

#include <cctype>
#include <cstdio>
#include <cstring>
#include <esp_task_wdt.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <lwip/sockets.h>

#include <esp_log.h>
static const char * TAG8 = "sc:rigctld.";

static constexpr int RIGCTLD_PORT         = 4532;
static constexpr int RIGCTLD_MAX_LINE     = 256;
static constexpr int RIGCTLD_RECV_TIMEOUT = 2;  // seconds
static constexpr int RIGCTLD_STACK_SIZE   = 6144;

// Hamlib error codes
static constexpr int RIG_OK       = 0;
static constexpr int RIG_EINVAL   = -1;
static constexpr int RIG_ENIMPL   = -4;
static constexpr int RIG_ETIMEOUT = -5;
static constexpr int RIG_EIO      = -6;

// Forward declarations
extern radio_mode_t get_radio_mode ();

// ====================================================================================================
// Mode string mapping between Hamlib and SOTAcat
// ====================================================================================================

static const char * mode_to_hamlib_string (radio_mode_t mode) {
    switch (mode) {
    case MODE_LSB: return "LSB";
    case MODE_USB: return "USB";
    case MODE_CW: return "CW";
    case MODE_FM: return "FM";
    case MODE_AM: return "AM";
    case MODE_DATA: return "PKTUSB";
    case MODE_CW_R: return "CWR";
    case MODE_DATA_R: return "PKTLSB";
    default: return "USB";
    }
}

static radio_mode_t hamlib_string_to_mode (const char * s) {
    if (!s || !*s)
        return MODE_UNKNOWN;

    // Normalize to uppercase for comparison
    char buf[16];
    int  i = 0;
    for (; s[i] && i < (int)sizeof (buf) - 1; i++)
        buf[i] = (char)toupper ((unsigned char)s[i]);
    buf[i] = '\0';

    if (!strcmp (buf, "USB"))
        return MODE_USB;
    if (!strcmp (buf, "LSB"))
        return MODE_LSB;
    if (!strcmp (buf, "CW"))
        return MODE_CW;
    if (!strcmp (buf, "CWR"))
        return MODE_CW_R;
    if (!strcmp (buf, "AM"))
        return MODE_AM;
    if (!strcmp (buf, "FM"))
        return MODE_FM;
    if (!strcmp (buf, "PKTUSB"))
        return MODE_DATA;
    if (!strcmp (buf, "PKTLSB"))
        return MODE_DATA_R;
    if (!strcmp (buf, "RTTY"))
        return MODE_DATA;
    if (!strcmp (buf, "DATA"))
        return MODE_DATA;

    return MODE_UNKNOWN;
}

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

static void cmd_get_freq (int sock) {
    long freq = 0;
    {
        TimedLock lock = kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_FAST_MS, "rigctld get_freq");
        if (lock.acquired()) {
            if (kxRadio.get_frequency (freq)) {
                char resp[32];
                snprintf (resp, sizeof (resp), "%ld\n", freq);
                rigctld_send (sock, resp);
                return;
            }
        }
        else {
            char resp[16];
            snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_ETIMEOUT);
            rigctld_send (sock, resp);
            return;
        }
    }
    char resp[16];
    snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_EIO);
    rigctld_send (sock, resp);
}

static void cmd_set_freq (int sock, const char * arg) {
    if (!arg || !*arg) {
        char resp[16];
        snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_EINVAL);
        rigctld_send (sock, resp);
        return;
    }

    long freq = atol (arg);
    if (freq <= 0) {
        char resp[16];
        snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_EINVAL);
        rigctld_send (sock, resp);
        return;
    }

    {
        TimedLock lock = kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_MODERATE_MS, "rigctld set_freq");
        if (lock.acquired()) {
            if (kxRadio.set_frequency (freq, SC_KX_COMMUNICATION_RETRIES)) {
                rigctld_send (sock, "RPRT 0\n");
                return;
            }
        }
        else {
            char resp[16];
            snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_ETIMEOUT);
            rigctld_send (sock, resp);
            return;
        }
    }
    char resp[16];
    snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_EIO);
    rigctld_send (sock, resp);
}

static void cmd_get_mode (int sock) {
    radio_mode_t mode     = get_radio_mode();
    const char * mode_str = mode_to_hamlib_string (mode);
    char         resp[32];
    snprintf (resp, sizeof (resp), "%s\n0\n", mode_str);
    rigctld_send (sock, resp);
}

static void cmd_set_mode (int sock, const char * arg) {
    if (!arg || !*arg) {
        char resp[16];
        snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_EINVAL);
        rigctld_send (sock, resp);
        return;
    }

    // Parse mode name (ignore passband argument after space)
    char mode_name[16];
    int  i = 0;
    for (; arg[i] && arg[i] != ' ' && i < (int)sizeof (mode_name) - 1; i++)
        mode_name[i] = arg[i];
    mode_name[i] = '\0';

    radio_mode_t mode = hamlib_string_to_mode (mode_name);
    if (mode == MODE_UNKNOWN) {
        char resp[16];
        snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_EINVAL);
        rigctld_send (sock, resp);
        return;
    }

    {
        TimedLock lock = kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_MODERATE_MS, "rigctld set_mode");
        if (lock.acquired()) {
            if (kxRadio.set_mode (mode, SC_KX_COMMUNICATION_RETRIES)) {
                rigctld_send (sock, "RPRT 0\n");
                return;
            }
        }
        else {
            char resp[16];
            snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_ETIMEOUT);
            rigctld_send (sock, resp);
            return;
        }
    }
    char resp[16];
    snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_EIO);
    rigctld_send (sock, resp);
}

static void cmd_get_ptt (int sock) {
    long state = 0;
    {
        TimedLock lock = kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_FAST_MS, "rigctld get_ptt");
        if (lock.acquired()) {
            if (kxRadio.get_xmit_state (state)) {
                char resp[16];
                snprintf (resp, sizeof (resp), "%ld\n", state);
                rigctld_send (sock, resp);
                return;
            }
        }
        else {
            char resp[16];
            snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_ETIMEOUT);
            rigctld_send (sock, resp);
            return;
        }
    }
    char resp[16];
    snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_EIO);
    rigctld_send (sock, resp);
}

static void cmd_set_ptt (int sock, const char * arg) {
    if (!arg || !*arg) {
        char resp[16];
        snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_EINVAL);
        rigctld_send (sock, resp);
        return;
    }

    long ptt = atol (arg);

    {
        TimedLock lock = kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_CRITICAL_MS, "rigctld set_ptt");
        if (lock.acquired()) {
            if (kxRadio.set_xmit_state (ptt != 0)) {
                rigctld_send (sock, "RPRT 0\n");
                return;
            }
        }
        else {
            char resp[16];
            snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_ETIMEOUT);
            rigctld_send (sock, resp);
            return;
        }
    }
    char resp[16];
    snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_EIO);
    rigctld_send (sock, resp);
}

static void cmd_get_vfo (int sock) {
    rigctld_send (sock, "VFOA\n");
}

static void cmd_get_split_vfo (int sock) {
    rigctld_send (sock, "0\nVFOA\n");
}

static void cmd_get_level (int sock, const char * arg) {
    if (!arg || !*arg) {
        char resp[16];
        snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_EINVAL);
        rigctld_send (sock, resp);
        return;
    }

    // Normalize level name to uppercase
    char level[16];
    int  i = 0;
    for (; arg[i] && i < (int)sizeof (level) - 1; i++)
        level[i] = (char)toupper ((unsigned char)arg[i]);
    level[i] = '\0';

    if (!strcmp (level, "RFPOWER")) {
        long power = -1;
        {
            TimedLock lock = kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_FAST_MS, "rigctld get_power");
            if (lock.acquired()) {
                if (kxRadio.get_power (power)) {
                    // Hamlib RFPOWER is 0.0..1.0; KX power is 0..12 watts
                    // Normalize: power/12.0 (KX2 max 12W, KX3 max 15W but 12 is close enough)
                    float normalized = (float)power / 12.0f;
                    if (normalized > 1.0f)
                        normalized = 1.0f;
                    char resp[32];
                    snprintf (resp, sizeof (resp), "%.4f\n", normalized);
                    rigctld_send (sock, resp);
                    return;
                }
            }
            else {
                char resp[16];
                snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_ETIMEOUT);
                rigctld_send (sock, resp);
                return;
            }
        }
        char resp[16];
        snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_EIO);
        rigctld_send (sock, resp);
    }
    else if (!strcmp (level, "AF")) {
        long volume = -1;
        {
            TimedLock lock = kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_FAST_MS, "rigctld get_volume");
            if (lock.acquired()) {
                if (kxRadio.supports_volume() && kxRadio.get_volume (volume)) {
                    // Hamlib AF is 0.0..1.0; KX volume is 0..255
                    float normalized = (float)volume / 255.0f;
                    char  resp[32];
                    snprintf (resp, sizeof (resp), "%.4f\n", normalized);
                    rigctld_send (sock, resp);
                    return;
                }
            }
            else {
                char resp[16];
                snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_ETIMEOUT);
                rigctld_send (sock, resp);
                return;
            }
        }
        char resp[16];
        snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_EIO);
        rigctld_send (sock, resp);
    }
    else {
        char resp[16];
        snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_ENIMPL);
        rigctld_send (sock, resp);
    }
}

static void cmd_set_level (int sock, const char * arg) {
    if (!arg || !*arg) {
        char resp[16];
        snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_EINVAL);
        rigctld_send (sock, resp);
        return;
    }

    // Parse "LEVEL value"
    char level[16];
    int  i = 0;
    for (; arg[i] && arg[i] != ' ' && i < (int)sizeof (level) - 1; i++)
        level[i] = (char)toupper ((unsigned char)arg[i]);
    level[i] = '\0';

    const char * val_str = (arg[i] == ' ') ? &arg[i + 1] : nullptr;
    if (!val_str || !*val_str) {
        char resp[16];
        snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_EINVAL);
        rigctld_send (sock, resp);
        return;
    }

    float val = strtof (val_str, nullptr);

    if (!strcmp (level, "RFPOWER")) {
        // Hamlib RFPOWER is 0.0..1.0 → KX power in watts
        long power = (long)(val * 12.0f + 0.5f);
        if (power < 0)
            power = 0;
        if (power > 12)
            power = 12;

        {
            TimedLock lock = kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_MODERATE_MS, "rigctld set_power");
            if (lock.acquired()) {
                if (kxRadio.set_power (power)) {
                    rigctld_send (sock, "RPRT 0\n");
                    return;
                }
            }
            else {
                char resp[16];
                snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_ETIMEOUT);
                rigctld_send (sock, resp);
                return;
            }
        }
        char resp[16];
        snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_EIO);
        rigctld_send (sock, resp);
    }
    else if (!strcmp (level, "AF")) {
        // Hamlib AF is 0.0..1.0 → KX volume 0..255
        long volume = (long)(val * 255.0f + 0.5f);
        if (volume < 0)
            volume = 0;
        if (volume > 255)
            volume = 255;

        {
            TimedLock lock = kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_MODERATE_MS, "rigctld set_volume");
            if (lock.acquired()) {
                if (kxRadio.supports_volume() && kxRadio.set_volume (volume)) {
                    rigctld_send (sock, "RPRT 0\n");
                    return;
                }
            }
            else {
                char resp[16];
                snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_ETIMEOUT);
                rigctld_send (sock, resp);
                return;
            }
        }
        char resp[16];
        snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_EIO);
        rigctld_send (sock, resp);
    }
    else {
        char resp[16];
        snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_ENIMPL);
        rigctld_send (sock, resp);
    }
}

static void cmd_send_morse (int sock, const char * arg) {
    if (!arg || !*arg) {
        char resp[16];
        snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_EINVAL);
        rigctld_send (sock, resp);
        return;
    }

    {
        TimedLock lock = kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_CRITICAL_MS, "rigctld morse");
        if (lock.acquired()) {
            if (kxRadio.supports_keyer() && kxRadio.send_keyer_message (arg)) {
                rigctld_send (sock, "RPRT 0\n");
                return;
            }
        }
        else {
            char resp[16];
            snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_ETIMEOUT);
            rigctld_send (sock, resp);
            return;
        }
    }
    char resp[16];
    snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_EIO);
    rigctld_send (sock, resp);
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

    // Skip leading whitespace
    while (*line == ' ' || *line == '\t')
        line++;

    if (!*line)
        return true;  // empty line, keep connection

    // Long-form commands (backslash prefix)
    if (line[0] == '\\') {
        const char * cmd = line + 1;
        if (!strcasecmp (cmd, "dump_state")) {
            cmd_dump_state (sock);
            return true;
        }
        if (!strcasecmp (cmd, "chk_vfo")) {
            cmd_chk_vfo (sock);
            return true;
        }
        if (!strcasecmp (cmd, "get_freq")) {
            cmd_get_freq (sock);
            return true;
        }
        if (!strcasecmp (cmd, "get_mode")) {
            cmd_get_mode (sock);
            return true;
        }
        if (!strcasecmp (cmd, "get_vfo")) {
            cmd_get_vfo (sock);
            return true;
        }
        if (!strcasecmp (cmd, "get_ptt")) {
            cmd_get_ptt (sock);
            return true;
        }
        if (!strcasecmp (cmd, "get_split_vfo")) {
            cmd_get_split_vfo (sock);
            return true;
        }
        if (!strcasecmp (cmd, "get_info")) {
            cmd_get_info (sock);
            return true;
        }

        // Commands with arguments: "\cmd arg"
        const char * space = strchr (cmd, ' ');
        const char * arg   = space ? space + 1 : nullptr;
        char         cmd_name[32];
        if (space) {
            int len = space - cmd;
            if (len > (int)sizeof (cmd_name) - 1)
                len = sizeof (cmd_name) - 1;
            memcpy (cmd_name, cmd, len);
            cmd_name[len] = '\0';
        }
        else {
            strncpy (cmd_name, cmd, sizeof (cmd_name) - 1);
            cmd_name[sizeof (cmd_name) - 1] = '\0';
        }

        if (!strcasecmp (cmd_name, "set_freq")) {
            cmd_set_freq (sock, arg);
            return true;
        }
        if (!strcasecmp (cmd_name, "set_mode")) {
            cmd_set_mode (sock, arg);
            return true;
        }
        if (!strcasecmp (cmd_name, "set_ptt")) {
            cmd_set_ptt (sock, arg);
            return true;
        }
        if (!strcasecmp (cmd_name, "get_level")) {
            cmd_get_level (sock, arg);
            return true;
        }
        if (!strcasecmp (cmd_name, "set_level")) {
            cmd_set_level (sock, arg);
            return true;
        }
        if (!strcasecmp (cmd_name, "send_morse")) {
            cmd_send_morse (sock, arg);
            return true;
        }
        if (!strcasecmp (cmd_name, "quit")) {
            rigctld_send (sock, "RPRT 0\n");
            return false;
        }

        // Unknown long-form command
        char resp[16];
        snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_ENIMPL);
        rigctld_send (sock, resp);
        return true;
    }

    // Short-form commands
    char         cmd_char = line[0];
    const char * arg      = (line[1] == ' ') ? &line[2] : (line[1] ? &line[1] : nullptr);

    switch (cmd_char) {
    case 'f': cmd_get_freq (sock); break;
    case 'F': cmd_set_freq (sock, arg); break;
    case 'm': cmd_get_mode (sock); break;
    case 'M': cmd_set_mode (sock, arg); break;
    case 't': cmd_get_ptt (sock); break;
    case 'T': cmd_set_ptt (sock, arg); break;
    case 'v': cmd_get_vfo (sock); break;
    case 's': cmd_get_split_vfo (sock); break;
    case 'l': cmd_get_level (sock, arg); break;
    case 'L': cmd_set_level (sock, arg); break;
    case 'b': cmd_send_morse (sock, arg); break;
    case '_': cmd_get_info (sock); break;
    case 'q':
    case 'Q':
        rigctld_send (sock, "RPRT 0\n");
        return false;

    case (char)0x8f:
        cmd_dump_state (sock);
        break;
    case (char)0xf0:
        cmd_chk_vfo (sock);
        break;

    default: {
        char resp[16];
        snprintf (resp, sizeof (resp), "RPRT %d\n", RIG_ENIMPL);
        rigctld_send (sock, resp);
        break;
    }
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
