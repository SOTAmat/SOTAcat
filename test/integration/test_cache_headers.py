#!/usr/bin/env python3
"""
SOTAcat Web-Asset Cache-Header Test

Guards the caching contract introduced for issue #110 ("Stale browser cache
after firmware update breaks UI"). Verifies, over real HTTP:

  Embedded web assets (index.html, *.js, *.css, images)
    1. carry an ETag (quoted) equal to the firmware version, and
       Cache-Control: no-cache (revalidate every use);
    2. a conditional GET whose If-None-Match matches -> 304, empty body;
    3. a conditional GET with a STALE/wrong If-None-Match -> 200 + body
       (the #110 regression guard: a browser holding an old cache is forced
       to refetch once the firmware version, hence the ETag, changes);
    4. all assets share ONE ETag, so a firmware update re-keys the whole set
       atomically (no cross-file skew, the root cause of #110).

  Dynamic API endpoints (/api/v1/*)
    5. carry Cache-Control: no-store (live device state, never cached).

Run against the mock server (no device):
    ../mock_server serving on :8080, then
    python3 test_cache_headers.py --base-url http://localhost:8080

Run against a real device (authoritative):
    python3 test_cache_headers.py --base-url http://sotacat.local

Exit code 0 = all checks passed, 1 = one or more failed.
"""

import argparse
import sys

try:
    import requests
except ImportError:
    print("Error: 'requests' not installed (pip install requests)")
    sys.exit(2)


# Representative subset of the asset_map (src/webserver.cpp).
ASSET_PATHS = [
    "/",
    "/index.html",
    "/main.js",
    "/run.js",
    "/bandprivileges.js",
    "/spots.js",
    "/style.css",
    "/favicon.ico",
    "/sclogo.jpg",
]

# Dynamic state endpoints that must never be cached.
API_PATHS = [
    "/api/v1/version",
    "/api/v1/frequency",
    "/api/v1/batteryInfo",
    "/api/v1/connectionStatus",
    "/api/v1/callsign",
    "/api/v1/cwMacros",
]

STALE_ETAG = '"stale-old-firmware-version"'


class Checker:
    def __init__(self):
        self.passed = 0
        self.failed = 0

    def check(self, ok: bool, label: str, detail: str = ""):
        mark = "PASS" if ok else "FAIL"
        line = f"  [{mark}] {label}"
        if detail and not ok:
            line += f"  -> {detail}"
        print(line)
        if ok:
            self.passed += 1
        else:
            self.failed += 1


def test_assets(base_url: str, c: Checker) -> dict:
    print("\nEmbedded web assets — ETag + no-cache + conditional revalidation")
    etags = {}
    for path in ASSET_PATHS:
        url = base_url + path
        try:
            r = requests.get(url, timeout=10)
        except requests.RequestException as e:
            c.check(False, f"GET {path}", f"request error: {e}")
            continue

        etag = r.headers.get("ETag", "")
        cc = r.headers.get("Cache-Control", "")

        c.check(r.status_code == 200, f"GET {path} -> 200",
                f"got {r.status_code}")
        c.check(bool(etag) and etag.startswith('"') and etag.endswith('"'),
                f"GET {path} has quoted ETag", f"ETag={etag!r}")
        c.check(cc == "no-cache", f"GET {path} Cache-Control: no-cache",
                f"got {cc!r}")
        if etag:
            etags[path] = etag

        # If-None-Match match -> 304, no body.
        if etag:
            r304 = requests.get(url, headers={"If-None-Match": etag}, timeout=10)
            c.check(r304.status_code == 304,
                    f"GET {path} If-None-Match(match) -> 304",
                    f"got {r304.status_code}")
            c.check(len(r304.content) == 0,
                    f"GET {path} 304 has empty body",
                    f"body {len(r304.content)} bytes")

        # Stale If-None-Match -> 200 + body  (the #110 regression guard).
        rstale = requests.get(url, headers={"If-None-Match": STALE_ETAG},
                              timeout=10)
        c.check(rstale.status_code == 200,
                f"GET {path} If-None-Match(stale) -> 200 [#110 guard]",
                f"got {rstale.status_code}")
        c.check(len(rstale.content) > 0,
                f"GET {path} stale revalidation returns body",
                f"body {len(rstale.content)} bytes")
    return etags


def test_atomic_etag(etags: dict, c: Checker):
    print("\nAtomic invalidation — one firmware version, one ETag namespace")
    distinct = set(etags.values())
    c.check(len(distinct) == 1,
            "all assets share a single ETag (firmware version)",
            f"distinct ETags: {sorted(distinct)}")


def test_api(base_url: str, c: Checker):
    print("\nDynamic API endpoints — no-store (never cached)")
    for path in API_PATHS:
        url = base_url + path
        try:
            r = requests.get(url, timeout=10)
        except requests.RequestException as e:
            c.check(False, f"GET {path}", f"request error: {e}")
            continue
        cc = r.headers.get("Cache-Control", "")
        c.check("no-store" in cc, f"GET {path} Cache-Control: no-store",
                f"got {cc!r} (status {r.status_code})")


def main() -> int:
    parser = argparse.ArgumentParser(description="SOTAcat cache-header test")
    parser.add_argument("--base-url", default="http://localhost:8080",
                        help="Base URL of mock server or device "
                             "(default: http://localhost:8080)")
    args = parser.parse_args()
    base_url = args.base_url.rstrip("/")

    print("=" * 70)
    print(f"Cache-header contract test against {base_url}")
    print("=" * 70)

    c = Checker()
    etags = test_assets(base_url, c)
    test_atomic_etag(etags, c)
    test_api(base_url, c)

    print("\n" + "=" * 70)
    total = c.passed + c.failed
    print(f"Result: {c.passed}/{total} checks passed, {c.failed} failed")
    print("=" * 70)
    return 0 if c.failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
