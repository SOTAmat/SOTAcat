import os
import time
import shutil


def log_message(message):
    print(
        "SOTACAT merging step: " + message
    )  # Or use logging module for more advanced logging


def merge_binaries(source, target, env):
    import subprocess

    log_message("Preparing to merge firmware binaries...")

    project_dir = env.subst("$PROJECT_DIR")
    build_dir = env.subst("$BUILD_DIR")
    firmware_dir = os.path.join(project_dir, "firmware")
    os.makedirs(firmware_dir, exist_ok=True)  # Ensure directory exists

    bootloader_bin = os.path.join(build_dir, "bootloader.bin")
    partitions_bin = os.path.join(build_dir, "partitions.bin")
    app_bin = os.path.join(build_dir, "firmware.bin")

    # Define the base directory for output files
    output_dir = os.path.join(firmware_dir, "webtools")
    os.makedirs(output_dir, exist_ok=True)  # Ensure output directory exists

    merged_firmware_path = os.path.join(output_dir, "esp32c3.bin")

    # Check for the existence of required binaries
    for bin_file in [bootloader_bin, partitions_bin, app_bin]:
        if not os.path.exists(bin_file):
            log_message(f"Error: Required binary file missing: {bin_file}")
            return  # Exit if any required binary is missing

    home_path = os.environ.get("HOME") or os.environ.get("USERPROFILE")
    esptool_path = os.path.join(
        home_path, ".platformio", "packages", "tool-esptoolpy", "esptool.py"
    )
    python_exe = env["PYTHONEXE"]
    command = [
        python_exe,
        esptool_path,
        "--chip",
        "esp32c3",
        "merge_bin",
        "-o",
        merged_firmware_path,
        "--flash_mode",
        "dio",
        "--flash_freq",
        "80m",
        "--flash_size",
        "4MB",
        "0x0000",
        bootloader_bin,
        "0x8000",
        partitions_bin,
        "0x10000",
        app_bin,
    ]
    log_message(
        "Merging firmware binaries with the following command: " + " ".join(command)
    )
    subprocess.run(command, check=True)
    log_message(f"Merged firmware created at: {merged_firmware_path}")

    # Copy firmware.bin to the output directory with the new name
    ota_firmware_path = os.path.join(output_dir, "SOTACAT-ESP32C3-OTA.bin")
    try:
        shutil.copy2(app_bin, ota_firmware_path)
        log_message(f"Copied firmware.bin to: {ota_firmware_path}")
    except Exception as e:
        log_message(f"Error copying firmware.bin: {str(e)}")
