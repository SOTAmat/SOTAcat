import datetime
import glob
import json
import os
import subprocess
import sys

Import("env")

# Skip during IDE integration scans - only run when actually building
if env.IsIntegrationDump():
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
    mod_map = {"idf-component-manager": "idf_component_manager", "esp-idf-kconfig": "kconfgen", "cryptography": "cryptography"}
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
        log_message(f"  WARNING: pip install failed (exit {e.returncode}). Build may fail.")
    except subprocess.TimeoutExpired:
        log_message("  WARNING: pip install timed out. Build may fail.")


def log_message(message):
    print(
        "SOTACAT Pre-build step: " + message
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


manifest_path = "firmware/webtools/manifest.json"
header_path = "include/build_info.h"

# Ensure ESP-IDF Python deps are installed (avoids ModuleNotFoundError during build)
_ensure_espidf_python_deps()


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

    log_message(f"Installing missing PlatformIO Python packages: {', '.join(missing)}...")
    try:
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "--quiet"] + missing,
            check=True,
            timeout=120,
            capture_output=True,
        )
        log_message("  Installed successfully")
    except subprocess.CalledProcessError as e:
        log_message(f"  WARNING: pip install failed (exit {e.returncode}). Build may fail.")
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

# Check if manifest.json exists
if os.path.exists(manifest_path):
    with open(manifest_path, "r") as f:
        manifest_data = json.load(f)
    manifest_data["version"] = long_build_datetime_str
    with open(manifest_path, "w") as f:
        json.dump(manifest_data, f, indent=4)  # Indent for readability
    log_message(f"Updated version in {manifest_path} to {long_build_datetime_str}")
else:
    log_message(f"Manifest file not found at {manifest_path}")

# Update build_info.h
with open(header_path, "w") as f:
    f.write('#define BUILD_DATE_TIME "{}"\n'.format(short_build_datetime_str))
log_message(f"Updated {header_path} with build date/time {short_build_datetime_str}")
