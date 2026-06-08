# LED Patterns

**Who this is for:** Users reading the lights on the SOTAcat device

SOTAcat has two LEDs — **blue** and **red** — that report what the device is
doing. The patterns below are the same on both hardware versions (the original
AB6D module and the cased K5EM module); only the charging behavior differs (see
[Charging](#charging-and-usb-power)).

## At a Glance

| What you see | What it means |
|---|---|
| Blue + red both solid on | Booting / connecting to WiFi and radio |
| Red turns off, blue stays solid | WiFi connected, still finishing startup |
| Blue and red flash alternately, 3 times | WiFi and web server ready |
| All off, then steady blue blinking | Running normally (idle heartbeat) |
| Quick red wink | A command was received (phone talked to the device) |
| Blue solid on for a moment | Busy handling a command or preparing FT8 |
| Blue + red flash together, then dark | Powering off (idle too long, battery low) |
| Everything dark | Off / deep sleep |

## Startup Sequence

When you power on, the LEDs walk through startup:

1. **Blue + red both on** — the device is initializing and connecting to WiFi
   and your radio.
2. **Red goes out, blue stays on** — WiFi is up.
3. **Three alternating blue/red flashes** — WiFi and the web server are ready.
4. **All off** — the radio connection is established and the device is fully
   ready. It now switches to the idle heartbeat.

If startup can't complete and the battery is low, the device powers itself off
rather than draining the battery.

## Idle Heartbeat (Normal Running)

While running, the **blue** LED gives a short burst of blinks every few seconds.
The number of blinks tells you how long it's been since the device last did
anything, counting toward the 30-minute auto-shutoff:

| Blue blinks | Meaning |
|---|---|
| 1 | Active recently (or running on USB power) |
| 2 | Idle ~8–15 minutes |
| 3 | Idle ~15–23 minutes |
| 4 | Idle ~23–30 minutes |

After about 30 minutes with no activity, the device shuts down to save the
battery (see [Auto Shutdown](#auto-shutdown)). Any activity from the web
interface resets the count back to 1.

## Activity and Busy Indicators

- **Quick red wink** — flashes once each time the device receives a command from
  the web interface (tuning, mode change, button press). It's a normal sign the
  phone and device are talking.
- **Blue solid on briefly** — the device is busy handling a command or preparing
  an FT8 transmission. It returns to the heartbeat when finished.

## Charging and USB Power

There is no separate "charging" light pattern in the firmware.

- On the **K5EM** (cased) module, plugging in USB is detected: the blue
  heartbeat drops to a **single blink** and the device will **not** auto-shut-off
  while powered, so it can run indefinitely while charging.
- On the **AB6D** (original) module, charge state is shown by the charger
  hardware's own indicator, independent of the blue/red status LEDs.

## Auto Shutdown

If the device has been idle for about 30 minutes **and** the battery is below
its safe threshold, it flashes **blue + red together** briefly and then enters
deep sleep (everything dark). When plugged into USB and charging, the battery
stays above the threshold, so it keeps running instead of shutting down.

To wake it back up, power-cycle the device (or your radio, if SOTAcat is powered
from it).

---

**Problems?** See [Troubleshooting](Troubleshooting.md)
