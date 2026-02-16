import datetime
import glob
import json
import os
import subprocess
import sys

Import("env")
from merge_binaries import merge_binaries

# During IDE integration scans, register custom targets so they appear in
# PlatformIO task lists, but skip all heavy pre-build work.
if env.IsIntegrationDump():
    def _noop_action(source, target, env):
        return None

    env.AddCustomTarget(
        "package_webtools",
        "$BUILD_DIR/firmware.bin",
        _noop_action,
        title="SOTACAT: build and publish webtools binaries",
        description="Build current env and publish OTA bin, merged bin, and manifest.json",
    )
    env.AddCustomTarget(
        "verify_and_publish_webtools",
        "$BUILD_DIR/firmware.bin",
        _noop_action,
        title="SOTACAT: build, test, and publish webtools binaries",
        description="Build current env, run tests, and publish only if tests pass",
    )
    Return()


def _get_idf_python_exe():
    """Return the ESP-IDF Python executable path, or None if not found."""
    platformio_home = os.environ.get("PLATFORMIO_HOME") or os.path.join(
        os.path.expanduser("~"), ".platformio"
    )
    penv_dir = os.path.join(platformio_home, "penv")
    if not os.path.isdir(penv_dir):
        return None
    pattern = os.path.join(penv_dir, ".espidf-*")
    matches = sorted(glob.glob(pattern))
    if not matches:
        return None
    idf_venv = matches[-1]
    if sys.platform == "win32":
        python_exe = os.path.join(idf_venv, "Scripts", "python.exe")
    else:
        python_exe = os.path.join(idf_venv, "bin", "python")
    return python_exe if os.path.isfile(python_exe) else None


def _ensure_espidf_python_deps():
    """
    Ensure required Python packages are installed in the ESP-IDF Python environment.
    PlatformIO's ESP-IDF uses a separate venv (penv/.espidf-*). When that venv is
    incomplete (e.g. after platform update), install missing packages to avoid
    cryptic ModuleNotFoundError during build.
    """
    if "espidf" not in env.get("PIOFRAMEWORK", []):
        return

    python_exe = _get_idf_python_exe()
    if not python_exe:
        return

    # Packages commonly missing after PlatformIO/IDF updates.
    # esp-idf-kconfig provides kconfgen (used by IDF CMake); idf-component-manager for idf_component.yml
    # cryptography is required by gen_crt_bundle.py (x509 certificate bundle generation)
    required = ["idf-component-manager", "esp-idf-kconfig", "cryptography"]
    missing = []
    mod_map = {
        "idf-component-manager": "idf_component_manager",
        "esp-idf-kconfig": "kconfgen",
        "cryptography": "cryptography",
    }
    for pkg in required:
        mod = mod_map.get(pkg, pkg.replace("-", "_"))
        try:
            r = subprocess.run(
                [python_exe, "-c", f"import {mod}"],
                capture_output=True,
                timeout=5,
            )
            if r.returncode != 0:
                missing.append(pkg)
        except (subprocess.TimeoutExpired, OSError):
            missing.append(pkg)

    if not missing:
        return

    log_message(f"Installing missing ESP-IDF Python packages: {', '.join(missing)}...")
    try:
        subprocess.run(
            [python_exe, "-m", "pip", "install", "--quiet"] + missing,
            check=True,
            timeout=120,
            capture_output=True,
        )
        log_message("  Installed successfully")
    except subprocess.CalledProcessError as e:
        log_message(
            f"  WARNING: pip install failed (exit {e.returncode}). Build may fail."
        )
    except subprocess.TimeoutExpired:
        log_message("  WARNING: pip install timed out. Build may fail.")


def log_message(message):
    print(
        "SOTACAT Pre-build step: " + message,
        flush=True,
    )  # Or use logging module for more advanced logging


def access_build_flags():
    build_flags = env.ParseFlags(env["BUILD_FLAGS"])
    defines = build_flags.get("CPPDEFINES")
    # log_meassage("Build flags:", build_flags)
    # log_meassage("Defines:", defines)

    for define in defines:
        if isinstance(define, list):
            # Process list-type defines
            key, value = define
            # print(f"Define {key} has value {value}")
        else:
            # Process single defines
            # print(f"Define {define}")
            if define == "DEBUG":
                log_message("Build type set to Debug")
                return "Debug"
            elif define == "RELEASE":
                log_message("Build type set to Release")
                return "Release"

    return "Error"


header_path = "include/build_info.h"

# Ensure ESP-IDF Python deps are installed (avoids ModuleNotFoundError during build)
_ensure_espidf_python_deps()


def _get_webtools_paths():
    project_dir = env.subst("$PROJECT_DIR")
    webtools_dir = os.path.join(project_dir, "firmware", "webtools")
    ota_bin = os.path.join(webtools_dir, "SOTACAT-ESP32C3-OTA.bin")
    merged_bin = os.path.join(webtools_dir, "esp32c3.bin")
    manifest_abs = os.path.join(webtools_dir, "manifest.json")
    return webtools_dir, ota_bin, merged_bin, manifest_abs


def _ensure_pio_python_deps():
    """
    Ensure required Python packages are installed in the PlatformIO Python environment.
    Some packages like 'intelhex' (required by esptool) might be missing in some
    installations or after updates.
    """
    required = ["intelhex"]
    missing = []

    for pkg in required:
        try:
            # sys.executable is the PIO python executable running this script
            r = subprocess.run(
                [sys.executable, "-c", f"import {pkg}"],
                capture_output=True,
                timeout=5,
            )
            if r.returncode != 0:
                missing.append(pkg)
        except (subprocess.TimeoutExpired, OSError):
            missing.append(pkg)

    if not missing:
        return

    log_message(
        f"Installing missing PlatformIO Python packages: {', '.join(missing)}..."
    )
    try:
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "--quiet"] + missing,
            check=True,
            timeout=120,
            capture_output=True,
        )
        log_message("  Installed successfully")
    except subprocess.CalledProcessError as e:
        log_message(
            f"  WARNING: pip install failed (exit {e.returncode}). Build may fail."
        )
    except subprocess.TimeoutExpired:
        log_message("  WARNING: pip install timed out. Build may fail.")


# Ensure PlatformIO Python deps (like intelhex) are installed
_ensure_pio_python_deps()


def _ensure_x509_crt_bundle():
    """
    Pre-generate x509_crt_bundle for mbedtls. PlatformIO/ESP-IDF build can fail with
    'x509_crt_bundle not found' due to CMake build order. Generating it here ensures
    the file exists before the embed step runs.
    """
    if "espidf" not in env.get("PIOFRAMEWORK", []):
        return

    build_dir = env.subst("$BUILD_DIR")
    if not build_dir:
        # Fallback: construct from project dir and env (pre script may run before BUILD_DIR is set)
        proj_dir = env.subst("$PROJECT_DIR")
        pioenv = env.get("PIOENV", "")
        if proj_dir and pioenv:
            build_dir = os.path.join(proj_dir, ".pio", "build", pioenv)
    if not build_dir:
        return

    # mbedtls generates x509_crt_bundle in CMAKE_CURRENT_BINARY_DIR = build_dir/esp-idf/mbedtls
    out_dir = os.path.join(build_dir, "esp-idf", "mbedtls")
    try:
        os.makedirs(out_dir, exist_ok=True)
    except OSError:
        return

    platformio_home = os.environ.get("PLATFORMIO_HOME") or os.path.join(
        os.path.expanduser("~"), ".platformio"
    )
    pkgs = os.path.join(platformio_home, "packages")
    idf_crt_dir = None
    for name in os.listdir(pkgs) if os.path.isdir(pkgs) else []:
        if name.startswith("framework-espidf"):
            cand = os.path.join(pkgs, name, "components", "mbedtls", "esp_crt_bundle")
            if os.path.isfile(os.path.join(cand, "gen_crt_bundle.py")):
                idf_crt_dir = cand
                break
    if not idf_crt_dir:
        return

    gen_script = os.path.join(idf_crt_dir, "gen_crt_bundle.py")
    cacrt_all = os.path.join(idf_crt_dir, "cacrt_all.pem")
    cacrt_local = os.path.join(idf_crt_dir, "cacrt_local.pem")

    if not os.path.isfile(gen_script) or not os.path.isfile(cacrt_all):
        return

    python_exe = _get_idf_python_exe()
    if not python_exe:
        return

    inputs = [cacrt_all]
    if os.path.isfile(cacrt_local):
        inputs.append(cacrt_local)

    args = [python_exe, gen_script, "--input"] + inputs + ["-q", "--max-certs", "200"]
    try:
        subprocess.run(
            args,
            cwd=out_dir,
            check=True,
            capture_output=True,
            timeout=60,
        )
        log_message("Pre-generated x509_crt_bundle for mbedtls")
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        pass  # Build may still succeed if CMake generates it


_ensure_x509_crt_bundle()


def _clear_webtools_outputs():
    webtools_dir, ota_bin, merged_bin, manifest_abs = _get_webtools_paths()
    os.makedirs(webtools_dir, exist_ok=True)
    for path in (ota_bin, merged_bin, manifest_abs):
        if os.path.exists(path):
            os.remove(path)
            log_message(f"Removed stale webtools artifact: {path}")


def _write_manifest_file():
    webtools_dir, _, _, manifest_abs = _get_webtools_paths()
    os.makedirs(webtools_dir, exist_ok=True)

    manifest_data = {}
    if os.path.exists(manifest_abs):
        try:
            with open(manifest_abs, "r", encoding="utf-8") as f:
                manifest_data = json.load(f)
        except (json.JSONDecodeError, OSError):
            manifest_data = {}

    manifest_data["name"] = manifest_data.get(
        "name", "SOTACAT for Elecraft KX2, KX3, and KH1"
    )
    manifest_data["version"] = long_build_datetime_str
    manifest_data["builds"] = [
        {
            "chipFamily": "ESP32-C3",
            "parts": [
                {
                    "path": "https://sotamat.com/wp-content/uploads/esp32c3.bin",
                    "offset": 0,
                }
            ],
        }
    ]

    with open(manifest_abs, "w", encoding="utf-8") as f:
        json.dump(manifest_data, f, indent=4)
    log_message(f"Wrote webtools manifest: {manifest_abs}")


# Pre-compress web assets with gzip
log_message("Compressing web assets...")
try:
    result = subprocess.run(
        [sys.executable, "scripts/compress_web_assets.py"],
        check=True,
        capture_output=True,
        text=True,
    )
    # Print the output from the compression script
    for line in result.stdout.splitlines():
        log_message(f"  {line}")
except subprocess.CalledProcessError as e:
    log_message(f"ERROR: Failed to compress web assets: {e}")
    log_message(f"  {e.stderr}")
    sys.exit(1)
except FileNotFoundError as e:
    log_message(f"ERROR: Compression script not found - cannot continue: {e}")
    sys.exit(1)

# Update version strings (script only runs during actual builds, not IDE scans)
build_type = access_build_flags()

short_build_datetime_str = datetime.datetime.now().strftime("%y%m%d:%H%M")
long_build_datetime_str = (
    datetime.datetime.now().strftime("%Y-%m-%d_%H:%M-") + build_type
)

# Remove previous webtools outputs for this build so only explicitly published
# artifacts remain.
_clear_webtools_outputs()


def _package_webtools_action(source, target, env):
    log_message("Running build-and-publish webtools step...")
    merge_binaries(source, target, env)
    _write_manifest_file()


def _verify_and_publish_webtools_action(source, target, env):
    def _safe_console_text(text):
        return text.encode("ascii", "replace").decode("ascii")

    project_dir = env.subst("$PROJECT_DIR")
    host = os.environ.get("SOTACAT_TEST_HOST", "sotacat.local")
    test_args = os.environ.get("SOTACAT_TEST_ARGS", "--all").split()
    tests = [
        sys.executable,
        "-u",
        os.path.join(project_dir, "test", "integration", "run_tests.py"),
    ] + test_args
    if "--host" not in tests:
        tests.extend(["--host", host])
    log_message("Running integration tests before publishing webtools artifacts...")
    proc_env = os.environ.copy()
    proc_env["PYTHONUNBUFFERED"] = "1"
    process = subprocess.Popen(
        tests,
        cwd=project_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        env=proc_env,
    )

    if process.stdout is not None:
        for line in process.stdout:
            log_message(f"[tests] {_safe_console_text(line.rstrip())}")

    return_code = process.wait()
    if return_code != 0:
        raise RuntimeError(
            f"Integration tests failed with exit code {return_code}"
        )
    _package_webtools_action(source, target, env)


# Manual target to generate firmware/webtools outputs without running upload.
# Usage:
#   pio run -e seeed_xiao_esp32c3_debug -t package_webtools
#   pio run -e seeed_xiao_esp32c3_release -t package_webtools
env.AddCustomTarget(
    "package_webtools",
    "$BUILD_DIR/firmware.bin",
    _package_webtools_action,
    title="SOTACAT: build and publish webtools binaries",
    description="Build current env and publish OTA bin, merged bin, and manifest.json",
)

env.AddCustomTarget(
    "verify_and_publish_webtools",
    "$BUILD_DIR/firmware.bin",
    _verify_and_publish_webtools_action,
    title="SOTACAT: build, test, and publish webtools binaries",
    description="Build current env, run tests, and publish only if tests pass",
)

# Update build_info.h
with open(header_path, "w") as f:
    f.write('#define BUILD_DATE_TIME "{}"\n'.format(short_build_datetime_str))
log_message(f"Updated {header_path} with build date/time {short_build_datetime_str}")
