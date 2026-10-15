#!/usr/bin/env python3
"""
SOTAcat REST API contract test, driven by docs/dev/openapi-v1.yaml.

Asserts three things:

  1. The YAML's route set equals the firmware's route table
     (api_handlers[] in src/webserver.cpp), so a route added to either
     side without the other fails here.
  2. Every operation in the YAML has at least one probe below, and every
     probe names an operation in the YAML.
  3. Each probe's reply has a status the YAML declares for that operation,
     and a body matching the declared schema: empty for 204, JSON validated
     against the schema for application/json, pattern/enum for text/plain.

test_radio_contract.py covers the radio GET/SET timing semantics in depth;
this test is the breadth counterpart.

Against real hardware, probes that transmit (keyer, msg, atu, FT8) run only
with --allow-tx, and probes that reboot the device (reboot, ota, settings
POST) only with --allow-reboot. Against the mock everything runs.

Usage:
    python3 test_api_contract.py --host localhost:8099
    python3 test_api_contract.py --host sotacat.local
    python3 test_api_contract.py --host sotacat.local --allow-tx --allow-reboot
"""

import argparse
import re
import sys
import time
from pathlib import Path

try:
    import requests
    import yaml
    from jsonschema import Draft202012Validator
except ImportError as e:
    print(f"Error: missing dependency: {e.name}")
    print("Install with: .venv/bin/pip install requests pyyaml jsonschema")
    sys.exit(1)

HERE = Path(__file__).resolve().parent
SPEC_PATH = HERE.parent.parent / "docs" / "dev" / "openapi-v1.yaml"
WEBSERVER_CPP = HERE.parent.parent / "src" / "webserver.cpp"


class Failure(Exception):
    pass


# ---------------------------------------------------------------------------
# Probes: one request per row. `expect` narrows the acceptable statuses below
# the YAML's declared set (for error-path probes). `tx` marks on-air probes,
# `reboot` marks ones that restart a real device.
# ---------------------------------------------------------------------------
def build_probes(now_s: int):
    now_ms = now_s * 1000
    return [
        # radio
        dict(method="GET", path="/frequency"),
        dict(method="PUT", path="/frequency", params={"frequency": 14074000}),
        dict(method="PUT", path="/frequency", params={"frequency": "abc"}, expect={404}),
        dict(method="PUT", path="/frequency", expect={404}),  # no query string
        dict(method="GET", path="/mode"),
        dict(method="PUT", path="/mode", params={"mode": "cw"}),
        dict(method="PUT", path="/mode", params={"mode": "nope"}, expect={404}),
        dict(method="GET", path="/power"),
        dict(method="PUT", path="/power", params={"power": 10}),
        dict(method="PUT", path="/power", params={"power": -1}, expect={404}),
        dict(method="GET", path="/volume"),
        dict(method="PUT", path="/volume", params={"delta": 1}),
        dict(method="PUT", path="/volume", params={"delta": -1}),
        dict(method="PUT", path="/keyer", params={"message": "TEST"}, tx=True),
        dict(method="PUT", path="/msg", params={"bank": 1}, tx=True),
        dict(method="PUT", path="/msg", params={"bank": 0}, expect={404}),
        dict(method="PUT", path="/xmit", params={"state": 0}),
        dict(method="PUT", path="/xmit", params={"state": "x"}, expect={404}),
        dict(method="PUT", path="/atu", tx=True),
        dict(method="PUT", path="/time", params={"time": now_s}),
        dict(method="PUT", path="/time", params={"time": -1}, expect={400}),
        dict(method="GET", path="/connectionStatus"),
        dict(method="GET", path="/radioType"),
        # device
        dict(method="GET", path="/version"),
        dict(method="GET", path="/rssi"),
        dict(method="GET", path="/batteryInfo"),
        dict(method="GET", path="/reboot", reboot=True),
        dict(method="POST", path="/ota", data=b"", reboot=True),
        # settings: POST back what GET returned so device state is unchanged
        dict(method="GET", path="/settings"),
        dict(method="POST", path="/settings", echo_of="/settings", reboot=True),
        dict(method="GET", path="/gps"),
        dict(method="POST", path="/gps", echo_of="/gps"),
        dict(method="GET", path="/callsign"),
        dict(method="POST", path="/callsign", echo_of="/callsign"),
        dict(method="GET", path="/license"),
        dict(method="POST", path="/license", echo_of="/license"),
        dict(method="GET", path="/tuneTargets"),
        dict(method="POST", path="/tuneTargets", echo_of="/tuneTargets"),
        dict(method="POST", path="/tuneTargets", json={"targets": [{"url": "x", "enabled": True}] * 6},
             expect={400}),
        dict(method="GET", path="/cwMacros"),
        dict(method="POST", path="/cwMacros", echo_of="/cwMacros"),
        dict(method="POST", path="/cwMacros", json={"macros": [{"label": "a", "template": "b"}] * 9},
             expect={400}),
        # ft8: prepare, repeat, duplicate repeat, bad sequence, cancel
        dict(method="POST", path="/prepareft8", tx=True,
             params={"messageText": "CQ N0CAL CM87", "timeNow": now_ms, "rfFrequency": 14074000,
                     "audioFrequency": 1500, "requestToken": "contract"}),
        dict(method="POST", path="/prepareft8", params={"messageText": "CQ"}, expect={404}),
        dict(method="POST", path="/ft8", tx=True, expect={204},
             params={"rfFrequency": 14074000, "audioFrequency": 1500, "requestToken": "contract",
                     "sequenceNumber": 1}),
        dict(method="POST", path="/ft8", tx=True, expect={204},  # duplicate: no-op success
             params={"rfFrequency": 14074000, "audioFrequency": 1500, "requestToken": "contract",
                     "sequenceNumber": 1}),
        dict(method="POST", path="/ft8", tx=True, expect={500},  # out of order
             params={"rfFrequency": 14074000, "audioFrequency": 1500, "requestToken": "contract",
                     "sequenceNumber": 3}),
        dict(method="POST", path="/ft8", tx=True, expect={404},  # zero is never valid
             params={"rfFrequency": 14074000, "audioFrequency": 1500, "requestToken": "contract",
                     "sequenceNumber": 0}),
        dict(method="GET", path="/frequency", tx=True),  # stale value during FT8, still 200
        dict(method="PUT", path="/frequency", params={"frequency": 7074000}, tx=True, expect={503}),
        dict(method="POST", path="/cancelft8", tx=True),
        # unknown route
        dict(method="GET", path="/noSuchRoute", expect={404}, undocumented=True),
    ]


# ---------------------------------------------------------------------------
# Spec helpers
# ---------------------------------------------------------------------------
class Spec:
    def __init__(self, path: Path):
        with open(path, encoding="utf-8") as f:
            self.doc = yaml.safe_load(f)
        self.paths = self.doc["paths"]

    def deref(self, obj):
        while isinstance(obj, dict) and "$ref" in obj:
            ref = obj["$ref"]
            if not ref.startswith("#/"):
                raise Failure(f"non-local $ref {ref}")
            node = self.doc
            for part in ref[2:].split("/"):
                node = node[part]
            obj = node
        return obj

    def operations(self):
        for path, item in self.paths.items():
            for method in ("get", "put", "post", "delete", "patch"):
                if method in item:
                    yield method.upper(), path

    def responses(self, method, path):
        op = self.paths[path][method.lower()]
        return {int(code): self.deref(resp) for code, resp in op["responses"].items()}

    def validator_for(self, schema):
        # Local $refs inside component schemas resolve against the document root.
        root = {"$ref": "#/x", "x": schema, "components": self.doc["components"]}
        return Draft202012Validator(root)


def firmware_routes(path: Path):
    text = path.read_text(encoding="utf-8")
    table = text[text.index("api_handlers[] = {"):]
    table = table[: table.index("};")]
    return {(m, f"/{name}") for m, name in re.findall(r'\{HTTP_(GET|PUT|POST),\s*"(\w+)"', table)}


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------
class ContractTest:
    def __init__(self, host, allow_tx, allow_reboot):
        self.base = f"http://{host}/api/v1"
        self.allow_tx = allow_tx
        self.allow_reboot = allow_reboot
        self.spec = Spec(SPEC_PATH)
        self.passed = self.failed = self.skipped = 0
        self.mock = self._detect_mock()
        self.last_get = {}

    def _detect_mock(self):
        try:
            return requests.get(f"{self.base}/_debug/state", timeout=2).status_code == 200
        except requests.RequestException:
            return False

    def check(self, name, fn):
        try:
            fn()
            self.passed += 1
            print(f"  PASS  {name}")
        except Failure as e:
            self.failed += 1
            print(f"  FAIL  {name}: {e}")
        except requests.RequestException as e:
            self.failed += 1
            print(f"  FAIL  {name}: request error: {e}")

    def skip(self, name, why):
        self.skipped += 1
        print(f"  SKIP  {name}: {why}")

    # -- structural checks --------------------------------------------------
    def check_route_sets(self):
        spec_ops = set(self.spec.operations())
        fw_ops = firmware_routes(WEBSERVER_CPP)
        missing = sorted(fw_ops - spec_ops)
        extra = sorted(spec_ops - fw_ops)
        if missing or extra:
            raise Failure(f"firmware routes not in YAML: {missing}; YAML routes not in firmware: {extra}")

    def check_probe_coverage(self, probes):
        spec_ops = set(self.spec.operations())
        probed = {(p["method"], p["path"]) for p in probes if not p.get("undocumented")}
        unprobed = sorted(spec_ops - probed)
        unknown = sorted(probed - spec_ops)
        if unprobed or unknown:
            raise Failure(f"operations without a probe: {unprobed}; probes not in YAML: {unknown}")

    # -- per-probe check ----------------------------------------------------
    def run_probe(self, p):
        method, path = p["method"], p["path"]
        kwargs = {"timeout": 10}
        if "params" in p:
            kwargs["params"] = p["params"]
        if "json" in p:
            kwargs["json"] = p["json"]
        if "data" in p:
            kwargs["data"] = p["data"]
        if "echo_of" in p:
            if p["echo_of"] not in self.last_get:
                raise Failure(f"no prior GET {p['echo_of']} to echo")
            kwargs["json"] = self.last_get[p["echo_of"]]
        r = requests.request(method, f"{self.base}{path}", **kwargs)
        r.encoding = "utf-8"

        if p.get("undocumented"):
            if r.status_code not in p["expect"]:
                raise Failure(f"got {r.status_code}, expected {sorted(p['expect'])}")
            self._check_error_body(r)
            return

        declared = self.spec.responses(method, path)
        if r.status_code not in declared:
            raise Failure(f"got {r.status_code} {r.text[:80]!r}; YAML declares {sorted(declared)}")
        if "expect" in p and r.status_code not in p["expect"]:
            raise Failure(f"got {r.status_code} {r.text[:80]!r}, probe expected {sorted(p['expect'])}")

        resp = declared[r.status_code]
        content = resp.get("content")
        if r.status_code == 204 or not content:
            if r.content:
                raise Failure(f"{r.status_code} should have an empty body, got {r.text[:80]!r}")
            return
        if "application/json" in content:
            schema = self.spec.deref(content["application/json"]["schema"])
            try:
                body = r.json()
            except ValueError:
                raise Failure(f"{r.status_code} body is not JSON: {r.text[:80]!r}")
            errors = sorted(self.spec.validator_for(schema).iter_errors(body), key=lambda e: list(e.path))
            if errors:
                raise Failure(f"{r.status_code} body {body!r} fails schema: {errors[0].message}")
            if method == "GET":
                self.last_get[path] = body
        elif "text/plain" in content:
            schema = self.spec.deref(content["text/plain"]["schema"])
            text = r.text
            if "enum" in schema and text not in schema["enum"]:
                raise Failure(f"text {text!r} not in {schema['enum']}")
            if "pattern" in schema and not re.fullmatch(schema["pattern"], text):
                raise Failure(f"text {text!r} does not match {schema['pattern']!r}")
        else:
            raise Failure(f"unhandled content types {list(content)}")

    def _check_error_body(self, r):
        try:
            body = r.json()
        except ValueError:
            raise Failure(f"error body is not JSON: {r.text[:80]!r}")
        if not isinstance(body, dict) or set(body) != {"error"}:
            raise Failure(f"error body shape {body!r}")

    # -- main ---------------------------------------------------------------
    def run(self):
        print(f"Target: {self.base} ({'mock' if self.mock else 'device'})")
        print(f"Spec:   {SPEC_PATH.relative_to(HERE.parent.parent)}")
        probes = build_probes(int(time.time()))

        print("\nStructure")
        self.check("YAML routes == firmware api_handlers[]", self.check_route_sets)
        self.check("every YAML operation has a probe", lambda: self.check_probe_coverage(probes))

        print("\nProbes")
        for p in probes:
            label = f"{p['method']} {p['path']}"
            if "params" in p:
                label += " " + "&".join(f"{k}={v}" for k, v in p["params"].items())
            elif "expect" in p and not p.get("json"):
                label += " (no query)"
            if p.get("tx") and not (self.mock or self.allow_tx):
                self.skip(label, "transmits; pass --allow-tx")
                continue
            if p.get("reboot") and not (self.mock or self.allow_reboot):
                self.skip(label, "reboots the device; pass --allow-reboot")
                continue
            self.check(label, lambda p=p: self.run_probe(p))

        print(f"\n{self.passed} passed, {self.failed} failed, {self.skipped} skipped")
        return 0 if self.failed == 0 else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="sotacat.local", help="host[:port] of the device or mock")
    ap.add_argument("--allow-tx", action="store_true", help="run probes that key the transmitter on real hardware")
    ap.add_argument("--allow-reboot", action="store_true", help="run probes that reboot real hardware")
    args = ap.parse_args()
    sys.exit(ContractTest(args.host, args.allow_tx, args.allow_reboot).run())


if __name__ == "__main__":
    main()
