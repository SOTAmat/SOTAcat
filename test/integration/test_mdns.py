#!/usr/bin/env python3
"""
SOTAcat mDNS Service Advertisement Test

Asserts the `_sotacat._tcp` service record that Ham2K's "add equipment"
dialog browses for (SotacatDiscoverer in ham2k/halo), against real hardware:

  * Instance name is the unit's AP SSID (the HTTP settings API must agree).
  * SRV names the rigctld port (4532) and an mDNS host name ending `.local.`.
  * TXT `id` is 12 lowercase hex digits (the factory MAC).
  * TXT `fw` is the firmware version without its hardware prefix (the HTTP
    version API must agree).
  * A one-shot PTR query with the unicast-response bit, sent from an
    ephemeral port (the query Ham2K sends), is answered by unicast with
    PTR, SRV, TXT and A in a single packet.

Hardware only: the mock server does not speak mDNS. The machine running the
test must be on the same network segment as the unit.

Usage:
    python3 test_mdns.py --host sotacat.local
"""

import argparse
import re
import socket
import struct
import sys
import time

try:
    import requests
    from zeroconf import DNSIncoming, ServiceBrowser, ServiceListener, Zeroconf
except ImportError:
    print("Error: Required dependencies not installed (pip install requests zeroconf)")
    sys.exit(1)

SERVICE_TYPE = "_sotacat._tcp.local."
RIGCTLD_PORT = 4532
BROWSE_TIMEOUT_S = 10.0
ONE_SHOT_TIMEOUT_S = 3.0
MDNS_GROUP = ("224.0.0.251", 5353)
TYPE_PTR = 12
CLASS_IN_UNICAST_RESPONSE = 0x8001


def one_shot_record_types(expected_name: str) -> set:
    """Record types in the unit's unicast reply to a one-shot PTR query."""
    qname = b"".join(bytes([len(label)]) + label.encode() for label in SERVICE_TYPE.rstrip(".").split(".")) + b"\0"
    query = struct.pack(">6H", 0, 0, 1, 0, 0, 0) + qname + struct.pack(">2H", TYPE_PTR, CLASS_IN_UNICAST_RESPONSE)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.settimeout(ONE_SHOT_TIMEOUT_S)
        sock.sendto(query, MDNS_GROUP)
        try:
            while True:
                data, _ = sock.recvfrom(9000)
                records = DNSIncoming(data).answers()
                if any(getattr(r, "alias", None) == expected_name for r in records):
                    return {type(r).__name__ for r in records}
        except socket.timeout:
            return set()


class Collector(ServiceListener):
    def __init__(self):
        self.names = set()

    def add_service(self, zc, type_, name):
        self.names.add(name)

    def update_service(self, zc, type_, name):
        self.names.add(name)

    def remove_service(self, zc, type_, name):
        self.names.discard(name)


class Checker:
    def __init__(self):
        self.passed = 0
        self.failed = 0

    def check(self, ok: bool, label: str, detail: str = ""):
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f"  -> {detail}" if detail and not ok else ""))
        if ok:
            self.passed += 1
        else:
            self.failed += 1
        return ok


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="sotacat.local", help="Unit's HTTP host, for the settings and version APIs")
    args = parser.parse_args()

    ap_ssid = requests.get(f"http://{args.host}/api/v1/settings", timeout=10).json()["ap_ssid"]
    version = requests.get(f"http://{args.host}/api/v1/version", timeout=10).text.strip()
    expected_fw = version.split(":", 1)[1]  # "K5EM_1:261125:1251-R" -> "261125:1251-R"
    expected_name = f"{ap_ssid}.{SERVICE_TYPE}"
    print(f"Unit at {args.host}: ap_ssid={ap_ssid!r} version={version!r}")

    c = Checker()
    zc = Zeroconf()
    try:
        collector = Collector()
        ServiceBrowser(zc, SERVICE_TYPE, collector)
        deadline = time.monotonic() + BROWSE_TIMEOUT_S
        while expected_name not in collector.names and time.monotonic() < deadline:
            time.sleep(0.1)

        if not c.check(
            expected_name in collector.names,
            f"browse for {SERVICE_TYPE} finds instance {ap_ssid!r}",
            f"found {sorted(collector.names)} in {BROWSE_TIMEOUT_S:.0f} s",
        ):
            return 1

        info = zc.get_service_info(SERVICE_TYPE, expected_name, timeout=5000)
        if not c.check(info is not None, "SRV and TXT resolve"):
            return 1

        txt = {k.decode().lower(): (v or b"").decode() for k, v in info.properties.items()}
        print(f"  SRV port={info.port} target={info.server!r}  TXT={txt}")

        c.check(info.port == RIGCTLD_PORT, f"SRV port is {RIGCTLD_PORT}", f"got {info.port}")
        c.check(
            bool(info.server) and info.server.lower().endswith(".local."),
            "SRV target is a .local host name",
            f"got {info.server!r}",
        )
        c.check(
            re.fullmatch(r"[0-9a-f]{12}", txt.get("id", "")) is not None,
            "TXT id is 12 lowercase hex digits",
            f"got {txt.get('id')!r}",
        )
        c.check(txt.get("fw") == expected_fw, f"TXT fw is {expected_fw!r}", f"got {txt.get('fw')!r}")
    finally:
        zc.close()

    types = one_shot_record_types(expected_name)
    wanted = {"DNSPointer", "DNSService", "DNSText", "DNSAddress"}
    c.check(wanted <= types, "one-shot unicast query is answered with PTR, SRV, TXT and A in one packet", f"got {sorted(types)}")

    print(f"\n{c.passed} passed, {c.failed} failed")
    return 1 if c.failed else 0


if __name__ == "__main__":
    sys.exit(main())
