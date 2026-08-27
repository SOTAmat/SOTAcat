#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = [
#     "flask",
#     "flask-cors",
# ]
# ///
"""
SOTAcat Mock API Server

Simulates the SOTAcat device API for offline UI development and testing.
Serves both the static web files and mock API endpoints.

Usage:
    pipx run server.py [--port 8080]
    # or
    uv run server.py [--port 8080]
    # or
    python server.py [--port 8080]  # if flask installed
"""

import argparse
import json
import os
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

try:
    from flask import Flask, jsonify, request, send_from_directory, Response
    from flask_cors import CORS
except ImportError:
    print("Error: Required dependencies not installed")
    print("Install with: pip install flask flask-cors")
    sys.exit(1)


# Default mock state - simulates a connected SOTAcat device
DEFAULT_STATE = {
    # Radio state
    "frequency": 14285000,  # 20m SSB
    "mode": "USB",
    "power": 15,
    "xmit": 0,  # 0 = RX, 1 = TX
    "volume": 120,  # AF gain 0-255
    "radio_type": "KX2",  # "KX2", "KX3", or "Unknown"
    # Radio-link emulation (see MockRadio). Settable live via _debug/state.
    "radio_latency_ms": 50,  # simulated CAT round-trip per operation
    "radio_dead": False,     # radio off / unplugged: CAT never answers
    "ft8": False,            # FT8 transmission in progress (radio exclusive)
    # Device info (format: {HW}_{VER}:{YYMMDD}:{HHMM}-{R|D})
    "version": "TEST_1:260101:0101-D",
    "rssi": -62,
    "connected": True,
    # Battery info (matches handler_batteryInfo_get JSON format)
    "batteryInfo": {
        "is_smart": True,
        "voltage_v": 4.17,
        "current_ma": -84.9,
        "temp_c": 34.5,
        "state_of_charge_pct": 85.2,
        "capacity_mah": 496.5,
        "time_to_empty_hrs": 5.25,
        "time_to_full_hrs": 0.0,
        "charging": False,
    },
    # User settings (persisted to NVRAM on real device)
    "callsign": "N0CALL",
    "license": "G",  # License class: T, G, E, or empty
    "gps_lat": "38.0522",
    "gps_lon": "-122.9694",
    # Tune targets
    "tune_targets": [
        {"url": "http://websdr.ewi.utwente.nl:8901/", "enabled": True},
        {"url": "http://rx.linkfanel.net/", "enabled": False},
    ],
    "tune_targets_mobile": False,
    # CW macros (empty by default — must be configured in Settings)
    "cw_macros": [],
    # WiFi settings
    "sta1_ssid": "HomeNetwork",
    "sta1_pass": "********",
    "sta2_ssid": "",
    "sta2_pass": "",
    "sta3_ssid": "",
    "sta3_pass": "",
    "ap_ssid": "SOTAcat",
    "ap_pass": "12345678",
}


# Firmware-contract constants (mirror include/radio_park_httpd.h /
# include/radio_service.h). Keep in sync; test_radio_contract.py asserts against
# these same bounds on real hardware.
RADIO_GET_WAIT_MS = 300     # GET waits at most this long for a refresh
RADIO_SET_WAIT_MS = 1500    # PUT waits at most this long for confirmation
RADIO_LINK_DOWN_FAILS = 3   # consecutive CAT failures -> link down
RADIO_LINK_DOWN_PROBE_S = 5   # one recovery probe (TQ ping, ~0.2 s) per this interval while down

VALID_MODES = ["LSB", "USB", "CW", "FM", "AM", "DATA", "CW_R", "DATA_R"]
MODE_ALIASES = {"FT8": "DATA", "JS8": "DATA", "PK31": "DATA", "FT4": "DATA", "RTTY": "DATA"}


class MockRadio:
    """Emulates the firmware's radio-service + async-handler contract
    (docs/superpowers/specs/2026-08-17-radio-async-handlers-design.md):

      GET frequency/mode/connectionStatus  -> bare text; waits <= RADIO_GET_WAIT_MS
                                              for a fresh value, else last-known.
      PUT frequency/mode/volume/atu        -> 204 applied | 500 refused |
                                              202 (confirmation outran RADIO_SET_WAIT_MS,
                                              or superseded by a newer same-kind PUT) |
                                              503 (link down, or FT8 active).
      Link health: RADIO_LINK_DOWN_FAILS consecutive failed CAT ops -> down
      (⚫, PUT 503, one probe per RADIO_LINK_DOWN_PROBE_S); first success -> up.

    `state` is the shared mock state dict: reads radio_latency_ms / radio_dead
    / ft8 live, so tests can flip them through /api/v1/_debug/state.
    """

    def __init__(self, state: dict):
        self.state = state
        self.lock = threading.Lock()   # serializes "CAT" like the radio mutex
        self.consecutive_fails = 0
        self.link_up = True            # boot: connect() succeeded
        self.last_probe = 0.0
        self.set_gen = {}              # kind -> latest generation (supersede)
        # Firmware coalesces refresh requests into ONE pending slot per kind
        # and drains SET slots before refreshes; model both so a slow radio
        # under GET polling cannot starve a SET (as it cannot on the device).
        self.refresh_lock = threading.Lock()
        self.refresh_inflight = False
        self.pending_sets = 0

    # -- emulated CAT exchange -------------------------------------------
    def _cat(self):
        """One serialized CAT op. Returns True on success. A dead radio costs
        the full latency (bounded, like the firmware's UART timeout) and
        fails; a live one costs latency and succeeds."""
        with self.lock:
            latency = max(0, int(self.state.get("radio_latency_ms", 50))) / 1000.0
            if self.state.get("radio_dead"):
                # Link already down -> this is a cheap TQ recovery ping.
                time.sleep(0.2 if not self.link_up else (min(latency, 2.0) or 0.05))
                self.consecutive_fails += 1
                # Firmware fast-confirm: after a failure, up to THRESHOLD-1
                # quick TQ; pings (~0.2 s each) decide the link right away.
                while self.consecutive_fails < RADIO_LINK_DOWN_FAILS:
                    time.sleep(0.2)
                    self.consecutive_fails += 1
                self.link_up = False
                return False
            time.sleep(latency)
            self.consecutive_fails = 0
            self.link_up = True
            return True

    def _start_refresh(self, on_done=None):
        """Arm ONE refresh (coalesced: a refresh already in flight serves this
        request too). While link-down, throttle to one probe per interval.
        Returns the Event that fires when the (shared) refresh completes."""
        with self.refresh_lock:
            if self.refresh_inflight:
                return self.refresh_done
            now = time.time()
            if not self.link_up and now - self.last_probe < RADIO_LINK_DOWN_PROBE_S:
                return None
            self.last_probe = now
            self.refresh_inflight = True
            self.refresh_done = threading.Event()
            done = self.refresh_done

        def worker():
            # SET slots drain first: yield while any SET is queued.
            while self.pending_sets > 0:
                time.sleep(0.01)
            try:
                self._cat()
            finally:
                with self.refresh_lock:
                    self.refresh_inflight = False
                done.set()

        threading.Thread(target=worker, daemon=True).start()
        return done

    # -- GET side ----------------------------------------------------------
    def get_value(self, key):
        """Return the current value for `key` after a bounded wait for a
        refresh (like a parked GET). Never blocks past RADIO_GET_WAIT_MS.
        Returns None when the link is down (handler replies 503; the probe
        is still armed)."""
        if not self.link_up:
            self._start_refresh()
            return None
        if self.state.get("ft8"):
            return self.state[key]  # stale, instantly
        done = self._start_refresh()
        if done is not None:
            done.wait(RADIO_GET_WAIT_MS / 1000.0)
        return self.state[key]  # fresh if the refresh finished, else last-known

    def status_symbol(self):
        if not self.link_up:
            self._start_refresh()  # firmware: connectionStatus arms the recovery probe
            return "⚫"
        if self.state.get("ft8"):
            return "⚪"
        self.get_value("xmit")
        return "🔴" if self.state.get("xmit") else "🟢"

    # -- SET side ----------------------------------------------------------
    def apply(self, kind, mutate):
        """Enqueue a SET; `mutate()` applies it to state and returns True/False
        (radio accepted / refused). Returns (status, message)."""
        if self.state.get("ft8"):
            return 503, "radio busy (FT8)"
        if not self.link_up:
            return 503, "radio link down"
        gen = self.set_gen.get(kind, 0) + 1
        self.set_gen[kind] = gen
        done = threading.Event()
        result = {}
        self.pending_sets += 1

        def worker():
            try:
                ok = self._cat()
                if ok:
                    ok = bool(mutate())
                result["ok"] = ok
            finally:
                self.pending_sets -= 1
                done.set()

        threading.Thread(target=worker, daemon=True).start()
        finished = done.wait(RADIO_SET_WAIT_MS / 1000.0)
        if self.set_gen.get(kind) != gen:
            return 202, f"{kind} superseded"
        if not finished:
            return 202, f"{kind} accepted, applying"
        if result.get("ok"):
            return 204, ""
        return 500, f"{kind} failed"


class MockSOTAcatServer:
    def __init__(self, web_dir: str):
        self.app = Flask(__name__, static_folder=None)
        CORS(self.app)  # Allow cross-origin for development
        self.web_dir = Path(web_dir).resolve()
        self.state = dict(DEFAULT_STATE)
        self.radio = MockRadio(self.state)  # shares the dict: reset must update in place
        self._setup_routes()

    def _setup_routes(self):
        # ------------------------------------------------------------------
        # Cache policy — mirrors the firmware (src/webserver.cpp
        # dynamic_file_handler + the REPLY_WITH_* macros in webserver.h):
        #   * embedded web assets  -> ETag = firmware version + no-cache
        #                             (revalidate; honor If-None-Match -> 304)
        #   * /api/v1/* responses  -> no-store (live device state, never cached)
        # NOTE: this reproduces the contract in a SEPARATE codebase. A green
        # test against this mock validates the test/contract, not the firmware;
        # the authoritative run is against a real device.
        # ------------------------------------------------------------------
        @self.app.after_request
        def apply_cache_policy(response):
            if request.path.startswith("/api/"):
                response.headers["Cache-Control"] = "no-store"
                for h in ("ETag", "Last-Modified", "Expires"):
                    response.headers.pop(h, None)
                return response

            etag = '"%s"' % self.state["version"]
            if request.headers.get("If-None-Match") == etag:
                not_modified = Response(status=304)
                not_modified.headers["ETag"] = etag
                not_modified.headers["Cache-Control"] = "no-cache"
                return not_modified

            response.headers["ETag"] = etag
            response.headers["Cache-Control"] = "no-cache"
            for h in ("Last-Modified", "Expires"):
                response.headers.pop(h, None)
            return response

        # Static file serving
        @self.app.route("/")
        def index():
            return send_from_directory(self.web_dir, "index.html")

        @self.app.route("/<path:filename>")
        def static_files(filename):
            return send_from_directory(self.web_dir, filename)

        # ============================================================
        # API v1 Endpoints
        # ============================================================

        # Version
        @self.app.route("/api/v1/version", methods=["GET"])
        def get_version():
            return self.state["version"]

        # --- Radio endpoints: firmware-contract-faithful (bare text GETs,
        # 204/500/202/503 PUTs, bounded waits) — see MockRadio.
        def radio_reply(status, message):
            if status == 204:
                return Response("", status=204, headers={"Cache-Control": "no-store"})
            key = "message" if status == 202 else "error"
            return Response(json.dumps({key: message}), status=status,
                            mimetype="application/json")

        def text_reply(value):
            if value is None:
                return radio_reply(503, "radio link down")
            return Response(str(value), status=200, mimetype="text/plain",
                            headers={"Cache-Control": "no-store"})

        # Frequency
        @self.app.route("/api/v1/frequency", methods=["GET"])
        def get_frequency():
            return text_reply(self.radio.get_value("frequency"))

        @self.app.route("/api/v1/frequency", methods=["PUT"])
        def set_frequency():
            try:
                freq = int(request.args.get("frequency", ""))
            except ValueError:
                freq = 0
            if freq <= 0:
                return radio_reply(404, "invalid frequency")

            def mutate():
                self.state["frequency"] = freq
                print(f"[MOCK] Frequency set to {freq} Hz")
                return True

            return radio_reply(*self.radio.apply("frequency change", mutate))

        # Mode
        @self.app.route("/api/v1/mode", methods=["GET"])
        def get_mode():
            return text_reply(self.radio.get_value("mode"))

        @self.app.route("/api/v1/mode", methods=["PUT"])
        def set_mode():
            mode = request.args.get("mode", "").upper()
            mode = MODE_ALIASES.get(mode, mode)
            if mode != "SSB" and mode not in VALID_MODES:
                return radio_reply(404, "invalid mode")

            def mutate():
                # "SSB" resolves at apply time from the then-current frequency
                m = mode
                if m == "SSB":
                    m = "LSB" if self.state["frequency"] < 10_000_000 else "USB"
                self.state["mode"] = m
                print(f"[MOCK] Mode set to {m}")
                return True

            return radio_reply(*self.radio.apply("mode change", mutate))

        # Volume (delta)
        @self.app.route("/api/v1/volume", methods=["PUT"])
        def set_volume():
            try:
                delta = int(request.args.get("delta", ""))
            except ValueError:
                return radio_reply(404, "invalid delta")

            def mutate():
                self.state["volume"] = max(0, min(255, self.state.get("volume", 0) + delta))
                print(f"[MOCK] Volume adjusted by {delta} -> {self.state['volume']}")
                return True

            return radio_reply(*self.radio.apply("volume change", mutate))

        # Callsign
        @self.app.route("/api/v1/callsign", methods=["GET"])
        def get_callsign():
            return jsonify({"callsign": self.state["callsign"]})

        @self.app.route("/api/v1/callsign", methods=["POST"])
        def set_callsign():
            data = request.get_json() or {}
            if "callsign" in data:
                self.state["callsign"] = data["callsign"].upper()
                print(f"[MOCK] Callsign set to {self.state['callsign']}")
            return "", 200

        # License class
        @self.app.route("/api/v1/license", methods=["GET"])
        def get_license():
            return jsonify({"license": self.state["license"]})

        @self.app.route("/api/v1/license", methods=["POST"])
        def set_license():
            data = request.get_json() or {}
            if "license" in data:
                self.state["license"] = data["license"].upper()
                print(f"[MOCK] License set to {self.state['license']}")
            return "", 200

        # GPS
        @self.app.route("/api/v1/gps", methods=["GET"])
        def get_gps():
            return jsonify(
                {"gps_lat": self.state["gps_lat"], "gps_lon": self.state["gps_lon"]}
            )

        @self.app.route("/api/v1/gps", methods=["POST"])
        def set_gps():
            data = request.get_json() or {}
            if "gps_lat" in data:
                self.state["gps_lat"] = data["gps_lat"]
            if "gps_lon" in data:
                self.state["gps_lon"] = data["gps_lon"]
            print(f"[MOCK] GPS set to {self.state['gps_lat']}, {self.state['gps_lon']}")
            return "", 200

        # Tune Targets
        @self.app.route("/api/v1/tuneTargets", methods=["GET"])
        def get_tune_targets():
            return jsonify(
                {
                    "targets": self.state["tune_targets"],
                    "mobile": self.state["tune_targets_mobile"],
                }
            )

        @self.app.route("/api/v1/tuneTargets", methods=["POST"])
        def set_tune_targets():
            data = request.get_json() or {}
            if "targets" in data:
                self.state["tune_targets"] = data["targets"]
            if "mobile" in data:
                self.state["tune_targets_mobile"] = data["mobile"]
            print(
                f"[MOCK] Tune targets updated: {len(self.state['tune_targets'])} targets"
            )
            return "", 200

        # CW Macros
        @self.app.route("/api/v1/cwMacros", methods=["GET"])
        def get_cw_macros():
            return jsonify({"macros": self.state["cw_macros"]})

        @self.app.route("/api/v1/cwMacros", methods=["POST"])
        def set_cw_macros():
            data = request.get_json() or {}
            if "macros" in data:
                self.state["cw_macros"] = data["macros"]
            print(
                f"[MOCK] CW macros updated: {len(self.state['cw_macros'])} macros"
            )
            return "", 200

        # WiFi Settings
        @self.app.route("/api/v1/settings", methods=["GET"])
        def get_settings():
            return jsonify(
                {
                    "sta1_ssid": self.state["sta1_ssid"],
                    "sta1_pass": self.state["sta1_pass"],
                    "sta2_ssid": self.state["sta2_ssid"],
                    "sta2_pass": self.state["sta2_pass"],
                    "sta3_ssid": self.state["sta3_ssid"],
                    "sta3_pass": self.state["sta3_pass"],
                    "ap_ssid": self.state["ap_ssid"],
                    "ap_pass": self.state["ap_pass"],
                }
            )

        @self.app.route("/api/v1/settings", methods=["POST"])
        def set_settings():
            data = request.get_json() or {}
            for key in [
                "sta1_ssid",
                "sta1_pass",
                "sta2_ssid",
                "sta2_pass",
                "sta3_ssid",
                "sta3_pass",
                "ap_ssid",
                "ap_pass",
            ]:
                if key in data:
                    self.state[key] = data[key]
            print(f"[MOCK] WiFi settings updated")
            return "", 200

        # Battery and Signal
        @self.app.route("/api/v1/batteryInfo", methods=["GET"])
        def get_battery_info():
            # Returns comprehensive battery JSON (matches handler_batteryInfo_get format)
            return jsonify(self.state["batteryInfo"])

        @self.app.route("/api/v1/rssi", methods=["GET"])
        def get_rssi():
            return jsonify({"rssi": self.state["rssi"]})

        @self.app.route("/api/v1/connectionStatus", methods=["GET"])
        def get_connection_status():
            # Bare glyph, like the firmware: ⚫ link down · ⚪ FT8/unknown ·
            # 🔴 transmitting · 🟢 idle
            return text_reply(self.radio.status_symbol())

        # Radio type
        @self.app.route("/api/v1/radioType", methods=["GET"])
        def get_radio_type():
            # Returns plain text: "KX2", "KX3", or "Unknown"
            return self.state["radio_type"]

        # Time sync
        @self.app.route("/api/v1/time", methods=["PUT"])
        def set_time():
            try:
                time_val = int(request.args.get("time", ""))
            except ValueError:
                time_val = -1
            if time_val < 0:
                return radio_reply(400, "invalid time value")

            def mutate():
                print(f"[MOCK] Time sync received: {time_val}")
                return True

            return radio_reply(*self.radio.apply("time sync", mutate))

        # Power control
        @self.app.route("/api/v1/power", methods=["GET"])
        def get_power():
            return text_reply(self.radio.get_value("power"))

        @self.app.route("/api/v1/power", methods=["PUT"])
        def set_power():
            try:
                power = int(request.args.get("power", ""))
            except ValueError:
                power = -1
            if power < 0:
                return radio_reply(404, "invalid power")

            def mutate():
                self.state["power"] = power
                print(f"[MOCK] Power set to {power}W")
                return True

            return radio_reply(*self.radio.apply("power change", mutate))

        # Volume (absolute read)
        @self.app.route("/api/v1/volume", methods=["GET"])
        def get_volume():
            return text_reply(self.radio.get_value("volume"))

        # Transmit control
        @self.app.route("/api/v1/xmit", methods=["PUT"])
        def set_xmit():
            try:
                state_val = int(request.args.get("state", ""))
            except ValueError:
                return radio_reply(404, "invalid state")

            def mutate():
                self.state["xmit"] = 1 if state_val else 0
                print(f"[MOCK] Transmit state: {'TX' if state_val else 'RX'}")
                return True

            return radio_reply(*self.radio.apply("TX/RX toggle", mutate))

        # CW message playback
        @self.app.route("/api/v1/msg", methods=["PUT"])
        def play_message():
            try:
                bank = int(request.args.get("bank", ""))
            except ValueError:
                bank = 0
            if bank <= 0:
                return radio_reply(404, "invalid bank")

            def mutate():
                print(f"[MOCK] Playing CW message bank {bank}")
                return True

            return radio_reply(*self.radio.apply("message play", mutate))

        # CW keyer
        @self.app.route("/api/v1/keyer", methods=["PUT"])
        def send_keyer():
            message = request.args.get("message", "")
            print(f"[MOCK] Keying CW: {message}")
            return "", 200

        # ATU tune
        @self.app.route("/api/v1/atu", methods=["PUT"])
        def tune_atu():
            def mutate():
                print(f"[MOCK] ATU tune initiated")
                return True

            return radio_reply(*self.radio.apply("ATU tune", mutate))

        # Manual tune (firmware enforces the five-second safety timeout)
        @self.app.route("/api/v1/manualTune", methods=["PUT"])
        def manual_tune():
            state_val = request.args.get("state", "")
            if state_val not in ("0", "1"):
                return radio_reply(404, "invalid state")

            def mutate():
                self.state["manual_tune"] = state_val == "1"
                print(f"[MOCK] Manual tune: {'active' if state_val == '1' else 'stopped'}")
                return True

            return radio_reply(*self.radio.apply("manual tune", mutate))

        # OTA update (just acknowledge, don't do anything)
        @self.app.route("/api/v1/ota", methods=["POST"])
        def ota_update():
            print(f"[MOCK] OTA update received (ignored in mock mode)")
            return "", 200

        # Debug endpoint to view/modify state
        @self.app.route("/api/v1/_debug/state", methods=["GET"])
        def debug_get_state():
            return jsonify(self.state)

        @self.app.route("/api/v1/_debug/state", methods=["POST"])
        def debug_set_state():
            data = request.get_json() or {}
            self.state.update(data)
            print(f"[MOCK] State updated via debug endpoint")
            return jsonify(self.state)

        @self.app.route("/api/v1/_debug/reset", methods=["POST"])
        def debug_reset_state():
            self.state.clear()
            self.state.update(DEFAULT_STATE)  # in place: MockRadio holds this dict
            print(f"[MOCK] State reset to defaults")
            return jsonify(self.state)

    def run(self, host="0.0.0.0", port=8080, debug=True):
        print(f"\n{'='*60}")
        print(f"SOTAcat Mock Server")
        print(f"{'='*60}")
        print(f"Web UI:     http://localhost:{port}/")
        print(f"API Base:   http://localhost:{port}/api/v1/")
        print(f"Debug:      http://localhost:{port}/api/v1/_debug/state")
        print(f"Web Dir:    {self.web_dir}")
        print(f"{'='*60}\n")
        self.app.run(host=host, port=port, debug=debug)


def main():
    parser = argparse.ArgumentParser(description="SOTAcat Mock API Server")
    parser.add_argument(
        "--port", type=int, default=8080, help="Port to run server on (default: 8080)"
    )
    parser.add_argument(
        "--web-dir",
        type=str,
        default="../../src/web",
        help="Path to web UI directory (default: ../../src/web)",
    )
    parser.add_argument(
        "--host", type=str, default="0.0.0.0", help="Host to bind to (default: 0.0.0.0)"
    )
    parser.add_argument(
        "--radio-latency", type=int, default=50, metavar="MS",
        help="Simulated CAT round-trip per radio operation in ms (default: 50). "
             "Values above the GET/SET wait bounds exercise the stale/202 paths.",
    )
    parser.add_argument(
        "--radio-dead", action="store_true",
        help="Start with the radio unreachable (CAT never answers): link goes "
             "down after a few failures; GETs stay fast, PUTs 503.",
    )
    args = parser.parse_args()

    # Resolve web directory relative to script location
    script_dir = Path(__file__).parent
    web_dir = (script_dir / args.web_dir).resolve()

    if not web_dir.exists():
        print(f"Error: Web directory not found: {web_dir}")
        sys.exit(1)

    if not (web_dir / "index.html").exists():
        print(f"Error: index.html not found in {web_dir}")
        sys.exit(1)

    server = MockSOTAcatServer(str(web_dir))
    server.state["radio_latency_ms"] = args.radio_latency
    server.state["radio_dead"] = args.radio_dead
    server.run(host=args.host, port=args.port)


if __name__ == "__main__":
    main()
