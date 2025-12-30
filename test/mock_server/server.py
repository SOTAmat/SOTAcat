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

    # Device info
    "version": "2025-01-01_mock-dev",
    "battery": 85,
    "rssi": -62,
    "connected": True,

    # User settings (persisted to NVRAM on real device)
    "callsign": "N0CALL",
    "gps_lat": "38.0522",
    "gps_lon": "-122.9694",

    # Tune targets
    "tune_targets": [
        {"url": "http://websdr.ewi.utwente.nl:8901/", "enabled": True},
        {"url": "http://rx.linkfanel.net/", "enabled": False},
    ],
    "tune_targets_mobile": False,

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


class MockSOTAcatServer:
    def __init__(self, web_dir: str):
        self.app = Flask(__name__, static_folder=None)
        CORS(self.app)  # Allow cross-origin for development
        self.web_dir = Path(web_dir).resolve()
        self.state = dict(DEFAULT_STATE)
        self._setup_routes()

    def _setup_routes(self):
        # Static file serving
        @self.app.route('/')
        def index():
            return send_from_directory(self.web_dir, 'index.html')

        @self.app.route('/<path:filename>')
        def static_files(filename):
            return send_from_directory(self.web_dir, filename)

        # ============================================================
        # API v1 Endpoints
        # ============================================================

        # Version
        @self.app.route('/api/v1/version', methods=['GET'])
        def get_version():
            return self.state["version"]

        # Frequency
        @self.app.route('/api/v1/frequency', methods=['GET'])
        def get_frequency():
            return jsonify({"frequency": self.state["frequency"]})

        @self.app.route('/api/v1/frequency', methods=['PUT'])
        def set_frequency():
            freq = request.args.get('frequency')
            if freq:
                self.state["frequency"] = int(freq)
                print(f"[MOCK] Frequency set to {self.state['frequency']} Hz")
            return '', 200

        # Mode
        @self.app.route('/api/v1/mode', methods=['GET'])
        def get_mode():
            return jsonify({"mode": self.state["mode"]})

        @self.app.route('/api/v1/mode', methods=['PUT'])
        def set_mode():
            mode = request.args.get('bw')
            if mode:
                self.state["mode"] = mode
                print(f"[MOCK] Mode set to {self.state['mode']}")
            return '', 200

        # Callsign
        @self.app.route('/api/v1/callsign', methods=['GET'])
        def get_callsign():
            return jsonify({"callsign": self.state["callsign"]})

        @self.app.route('/api/v1/callsign', methods=['POST'])
        def set_callsign():
            data = request.get_json() or {}
            if 'callsign' in data:
                self.state["callsign"] = data["callsign"].upper()
                print(f"[MOCK] Callsign set to {self.state['callsign']}")
            return '', 200

        # GPS
        @self.app.route('/api/v1/gps', methods=['GET'])
        def get_gps():
            return jsonify({
                "gps_lat": self.state["gps_lat"],
                "gps_lon": self.state["gps_lon"]
            })

        @self.app.route('/api/v1/gps', methods=['POST'])
        def set_gps():
            data = request.get_json() or {}
            if 'gps_lat' in data:
                self.state["gps_lat"] = data["gps_lat"]
            if 'gps_lon' in data:
                self.state["gps_lon"] = data["gps_lon"]
            print(f"[MOCK] GPS set to {self.state['gps_lat']}, {self.state['gps_lon']}")
            return '', 200

        # Tune Targets
        @self.app.route('/api/v1/tuneTargets', methods=['GET'])
        def get_tune_targets():
            return jsonify({
                "targets": self.state["tune_targets"],
                "mobile": self.state["tune_targets_mobile"]
            })

        @self.app.route('/api/v1/tuneTargets', methods=['POST'])
        def set_tune_targets():
            data = request.get_json() or {}
            if 'targets' in data:
                self.state["tune_targets"] = data["targets"]
            if 'mobile' in data:
                self.state["tune_targets_mobile"] = data["mobile"]
            print(f"[MOCK] Tune targets updated: {len(self.state['tune_targets'])} targets")
            return '', 200

        # WiFi Settings
        @self.app.route('/api/v1/settings', methods=['GET'])
        def get_settings():
            return jsonify({
                "sta1_ssid": self.state["sta1_ssid"],
                "sta1_pass": self.state["sta1_pass"],
                "sta2_ssid": self.state["sta2_ssid"],
                "sta2_pass": self.state["sta2_pass"],
                "sta3_ssid": self.state["sta3_ssid"],
                "sta3_pass": self.state["sta3_pass"],
                "ap_ssid": self.state["ap_ssid"],
                "ap_pass": self.state["ap_pass"],
            })

        @self.app.route('/api/v1/settings', methods=['POST'])
        def set_settings():
            data = request.get_json() or {}
            for key in ["sta1_ssid", "sta1_pass", "sta2_ssid", "sta2_pass",
                        "sta3_ssid", "sta3_pass", "ap_ssid", "ap_pass"]:
                if key in data:
                    self.state[key] = data[key]
            print(f"[MOCK] WiFi settings updated")
            return '', 200

        # Battery and Signal
        @self.app.route('/api/v1/batteryPercent', methods=['GET'])
        def get_battery():
            return jsonify({"battery": self.state["battery"]})

        @self.app.route('/api/v1/rssi', methods=['GET'])
        def get_rssi():
            return jsonify({"rssi": self.state["rssi"]})

        @self.app.route('/api/v1/connectionStatus', methods=['GET'])
        def get_connection_status():
            return jsonify({"connected": self.state["connected"]})

        # Time sync
        @self.app.route('/api/v1/time', methods=['PUT'])
        def set_time():
            time_val = request.args.get('time')
            if time_val:
                print(f"[MOCK] Time sync received: {time_val}")
            return '', 200

        # Power control
        @self.app.route('/api/v1/power', methods=['PUT'])
        def set_power():
            power = request.args.get('power')
            if power:
                self.state["power"] = int(power)
                print(f"[MOCK] Power set to {self.state['power']}W")
            return '', 200

        # Transmit control
        @self.app.route('/api/v1/xmit', methods=['PUT'])
        def set_xmit():
            state_val = request.args.get('state')
            if state_val:
                self.state["xmit"] = int(state_val)
                status = "TX" if self.state["xmit"] else "RX"
                print(f"[MOCK] Transmit state: {status}")
            return '', 200

        # CW message playback
        @self.app.route('/api/v1/msg', methods=['PUT'])
        def play_message():
            bank = request.args.get('bank')
            print(f"[MOCK] Playing CW message bank {bank}")
            return '', 200

        # CW keyer
        @self.app.route('/api/v1/keyer', methods=['PUT'])
        def send_keyer():
            message = request.args.get('message', '')
            print(f"[MOCK] Keying CW: {message}")
            return '', 200

        # ATU tune
        @self.app.route('/api/v1/atu', methods=['PUT'])
        def tune_atu():
            print(f"[MOCK] ATU tune initiated")
            return '', 200

        # OTA update (just acknowledge, don't do anything)
        @self.app.route('/api/v1/ota', methods=['POST'])
        def ota_update():
            print(f"[MOCK] OTA update received (ignored in mock mode)")
            return '', 200

        # Debug endpoint to view/modify state
        @self.app.route('/api/v1/_debug/state', methods=['GET'])
        def debug_get_state():
            return jsonify(self.state)

        @self.app.route('/api/v1/_debug/state', methods=['POST'])
        def debug_set_state():
            data = request.get_json() or {}
            self.state.update(data)
            print(f"[MOCK] State updated via debug endpoint")
            return jsonify(self.state)

        @self.app.route('/api/v1/_debug/reset', methods=['POST'])
        def debug_reset_state():
            self.state = dict(DEFAULT_STATE)
            print(f"[MOCK] State reset to defaults")
            return jsonify(self.state)

    def run(self, host='0.0.0.0', port=8080, debug=True):
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
    parser = argparse.ArgumentParser(description='SOTAcat Mock API Server')
    parser.add_argument('--port', type=int, default=8080,
                        help='Port to run server on (default: 8080)')
    parser.add_argument('--web-dir', type=str, default='../../src/web',
                        help='Path to web UI directory (default: ../../src/web)')
    parser.add_argument('--host', type=str, default='0.0.0.0',
                        help='Host to bind to (default: 0.0.0.0)')
    args = parser.parse_args()

    # Resolve web directory relative to script location
    script_dir = Path(__file__).parent
    web_dir = (script_dir / args.web_dir).resolve()

    if not web_dir.exists():
        print(f"Error: Web directory not found: {web_dir}")
        sys.exit(1)

    if not (web_dir / 'index.html').exists():
        print(f"Error: index.html not found in {web_dir}")
        sys.exit(1)

    server = MockSOTAcatServer(str(web_dir))
    server.run(host=args.host, port=args.port)


if __name__ == '__main__':
    main()
