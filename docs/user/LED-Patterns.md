# LED Patterns

**Who this is for:** Users reading the lights on the SOTAcat device

SOTAcat has two LEDs, **blue** and **red**, that report what the device is
doing. The patterns below are the same on both hardware versions (the original
AB6D module and the cased K5EM module); only the charging behavior differs (see
[Charging](#charging-and-usb-power)).

## At a Glance


| What you see                                  | What it means                                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Blue + red both solid on                      | Starting up: waiting for a WiFi association (radio connect is also running in the background) |
| Red turns off, blue stays solid               | WiFi associated; web server is starting                                                       |
| Blue and red flash alternately, 3 times       | WiFi is associated and the web server has started                                             |
| Blue solid on, red off (after the flashes)    | Still waiting for a CAT/UART handshake with the radio                                         |
| All off, then blue blinking every few seconds | Startup finished; running normally (idle heartbeat)                                           |
| Quick red wink                                | A command was received (phone talked to the device)                                           |
| Blue solid on for a moment                    | Preparing an FT8 transmission                                                                 |
| Blue + red on together briefly, then dark     | Powering off (idle too long and battery low)                                                  |
| Everything dark                               | Off / deep sleep                                                                              |




## Startup Sequence

WiFi and radio connection start **in parallel**. The LEDs then turn off one at
a time as each of those two connections succeeds.

When you power on:

1. **Blue + red both on** — the device is initializing. It stays like this
  until WiFi has actually associated: either the device joined a saved
   hotspot, or your phone joined the SOTAcat access point. (The radio CAT
   handshake is already being attempted in the background during this time.)
2. **Red goes out, blue stays on** — WiFi is associated. The web server starts
  next.
3. **Three alternating blue/red flashes** — the web server is up. This happens
  only after that WiFi association and after the web server has started. 
   After the flashes, blue is left on and red stays off.
4. **Blue stays on, red off** — still waiting for a successful CAT serial
  (UART) handshake with the radio (the device tries several baud rates until
   the radio answers).
5. **Blue goes out (all off)** — the radio answered on the CAT port. Startup
  is complete and the idle heartbeat begins.

If you use the device as its own access point, both LEDs can stay on until
your phone actually joins that network. Advertising the AP is not enough.

If startup can't complete and the battery is below 70%, the device powers
itself off rather than draining the battery. That path just goes dark; it
does **not** use the blue+red power-off flash.

After startup, the LEDs no longer track WiFi or radio link health. A dropped
WiFi or CAT connection does not turn an LED back on.

## Idle Heartbeat (Normal Running)

While running, the **blue** LED gives a short burst of blinks about every
3 seconds. The number of blinks tells you how long it's been since the
device last did anything, counting toward the 30-minute auto-shutoff
(each step is a 7.5-minute quarter of that 30-minute window):


| Blue blinks | Meaning                                                                       |
| ----------- | ----------------------------------------------------------------------------- |
| 1           | Active in the last ~7.5 minutes (or USB power is detected on the K5EM module) |
| 2           | Idle ~7.5–15 minutes                                                          |
| 3           | Idle ~15–22.5 minutes                                                         |
| 4           | Idle ~22.5–30 minutes                                                         |


After about 30 minutes with no activity, the device shuts down to save the
battery (see [Auto Shutdown](#auto-shutdown)). Any activity from the web
interface resets the count back to 1.

## Activity and Busy Indicators

- **Quick red wink** — flashes once each time the device receives a command
from the web interface (tuning, mode change, button press, status poll).
It's a normal sign the phone and device are talking.
- **Blue solid on briefly** — the device is preparing an FT8 transmission.
Ordinary commands do not hold the blue LED on; they only produce the red
wink. The heartbeat resumes when FT8 prepare finishes.



## Charging and USB Power

There is no separate "charging" light pattern in the firmware.

- On the **K5EM** (cased) module, plugging in USB is detected: the blue
heartbeat drops to a **single blink** and the idle auto-shutoff is skipped
while USB is present, so it can run indefinitely while charging.
- On the **AB6D** (original) module, the firmware does not detect USB. Charge
state is shown by the charger hardware's own indicator, independent of the
blue/red status LEDs. Auto-shutoff still follows battery percentage (see
below).



## Auto Shutdown

If the device has been idle for about 30 minutes **and** the battery is below
70%, it turns **blue + red on together** for a fraction of a second and then
enters deep sleep (everything dark).

It will **not** shut down from idle if either of these is true:

- USB power is detected (K5EM module), or
- the battery is still at or above 70% (the idle timer is reset and it keeps
running; typical while charging)

To wake it back up, power-cycle the device (or your radio, if SOTAcat is
powered from it).

---

**Problems?** See [Troubleshooting](Troubleshooting.md)