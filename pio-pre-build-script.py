import datetime
import json
import os
import sys

Import("env")


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
