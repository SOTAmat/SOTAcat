# USB Flashing from the Command Line

The easy path is the browser flasher at
**<https://sotamat.github.io/SOTAcat/flash/>** - one button, always the latest
release. Use this page instead when the flasher can't help you:

- Your browser has no Web Serial support (Firefox, Safari, anything on iOS or
  Android - for phones you'll still need a computer, but any OS with Python works)
- You need to install an **older** release (rollback)
- You just prefer the command line

> **⚠️ USB flashing is a factory reset.** It erases every setting on the device -
> WiFi networks, callsign, all of it. If your SOTAcat already works and its
> Settings page has a Firmware section, update over the air instead and keep your
> settings: see [Getting Started](Getting-Started.md#updating-firmware).

## What you need

- **esptool** - `pip install esptool`. This page was written and verified
  against esptool **v5.3.1**; v5 renamed the commands (`erase-flash`,
  `write-flash` - the old underscore spellings still work but warn).
- **A USB data cable.** Charge-only cables are the most common failure: if no
  serial port ever appears, try another cable.
- If the device never enumerates on any cable, you may be missing a USB serial
  driver - see [Espressif's driver notes](https://docs.espressif.com/projects/esptool/en/latest/esp32c3/troubleshooting.html).

## Which file to download

From the [latest release](https://github.com/SOTAmat/SOTAcat/releases/latest),
download **`esp32c3.bin`**. This is the *merged* image - bootloader, partition
table, and application in one file - and it flashes at address `0x0`.

Do **not** use `SOTACAT-ESP32C3-OTA.bin` here. That is the application image
alone, consumed only by the device's own Settings → Firmware upload. Flashed
over USB at `0x0` it will not boot.

Or from a shell:

```sh
curl -fsSLO https://github.com/SOTAmat/SOTAcat/releases/latest/download/esp32c3.bin
```

## Flashing

Plug in the SOTAcat. It sleeps after about 60 seconds of inactivity, so
power-cycle it just before you start. Then:

```sh
esptool erase-flash
esptool write-flash 0x0 esp32c3.bin
```

esptool auto-detects the serial port; add `--port <port>` only if you have
several serial devices attached and it picks the wrong one.

**Do not skip the erase.** `write-flash 0x0` alone looks sufficient but isn't:
the partition layout changed on 2024-08-22, and on devices running older
firmware the write leaves stale NVS and OTA-selection data behind that
references partitions which no longer exist. Erasing first is also *why* this
procedure is a factory reset - the two facts are the same fact.

When the write finishes, unplug and replug the device. It boots as a fresh
SOTAcat broadcasting a `SOTAcat-XXXX` hotspot - continue with
[Getting Started](Getting-Started.md).

## Rolling back

Same procedure, different file: pick the release you want from the
[releases list](https://github.com/SOTAmat/SOTAcat/releases), download its
`esp32c3.bin`, erase, and write. The device's update check will then offer to
bring you forward again; decline it until you're ready.

## Out of scope

Building firmware from source and flashing your own builds is developer
territory: see [BUILD.md](../dev/BUILD.md).

---

[← Troubleshooting](Troubleshooting.md) · [Getting Started →](Getting-Started.md)
