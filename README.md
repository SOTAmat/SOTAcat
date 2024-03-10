# SOTAcat Firmware

## Introduction:
### Wireless (WiFi/BLE) CAT control for Elecraft KX radios, with SOTAMAT direct FT8 synthesis

SOTACAT is a small hardware module that plugs into an Elecraft KX2 or KX3 radio’s CAT port (Computer Aided Transceiver port, also known as a serial port or an accessory port) and provides WiFi control of the radio from your mobile device. It provides the following features:

1. **Your radio controlled from a web page:**
Acts as a WiFi hotspot in the field with a web server. The radio becomes a web page with a web page user interface to control the radio. Just connect to the “SOTACAT” SSID and navigate to the web site “http://sotacat.local”
2. **SOTA/POTA Click-to-Pounce:**
When cell service is available, it allows SOTA and POTA operators to “click-to-pounce”. On the SOTACAT web page you see a list of recent SOTA and POTA spots. Clicking on one allows automatic tuning of the radio to the correct band, frequency, and mode to start a contact with that spotted operator.
3. **Direct FT8 Synthesis without audio (with SOTAMAT integration)**
While CAT control isn’t new, one unique feature of SOTACAT is that it can manipulate the Elecraft radio’s pure CW signal and VFO frequency fast enough to generate the same FSK (frequency shift keying) signals as used by FT8 or other FSK based modes, but without using any audio signal (direct FSK synthesis). SOTACAT can accept an FT8 message and from it compute and transmit a 15 second set of FT8 FSK signals.
4. **SOTAMAT integration and remote self-spotting:**
SOTACAT can form a bidirectional connection with the SOTAMAT app on your phone allowing SOTAMAT to read what operating frequency and mode you have selected, or allowing SOTAMAT’s frequency / band selector to adjust the radio’s operating frequency/band/mode. Once you enter your peak or park ID (or use the automatic peak/park selector via GPS), SOTAMAT will use the SOTACAT to send the proper FT8 message to self-spot, self-alert, or send an SMS/eMail message command.

## Current status:

- [Written instructions](https://github.com/SOTAmat/SOTAcat/blob/main/Docs/Hardware/SOTACAT%20BOM%20-%20schematic%20-%20assembly%20instructions.pdf), for manually building your own SOTACAT, including the Bill Of Materials / Parts List, Schematic, and Assembly instructions
- [YouTube build instructions video](https://www.youtube.com/watch?v=iD3S-9icRn0) showing how to manually build your own SOTACAT
- Firmware: found here on Github
- Other hams (K5EM and KE6MT) have created custom circuit boards that implement a SOTACAT in a more compact and professionally designed package.
- The SOTAMAT app compatible with SOTACAT has not yet been released and is in development.  There are SOTACAT-aware Beta versions of SOTAMAT available at:
    - [iOS build on Apple's TestFlight App Store for Beta apps](https://testflight.apple.com/join/UQuW6g1E)
    - [APK/AAB packaging for Android devices](https://1drv.ms/f/s!AhZ33h8betkWjOpAp6J0kgMQex3OWQ?e=xlfzSQ), and look for the highest build number. 

## Instructions to Build the Firmware:

### THIS IS A "PRE-RELEASE" WORK IN PROGRESS

1. git clone --recurse-submodules https://github.com/SOTAmat/SOTAcat.git
2. Define environment variables for your home 2.4GHz WiFi router (won't be used in the field, but used for development/debugging):

- SOTACAT_HOME_WIFI_SSID
- SOTACAT_HOME_WIFI_PASSWORD

3. Install PlatformIO
4. Build, Deploy

Since this is pre-release, I am almost certain I've forgotten several steps. Let me know where it gets stuck and I'll update these instructions.

## Attribution

- AB6D, Brian Mathews: created the original SOTACAT concept, hardware, and firmware as well as a derivative version of the FT8 encoder originally developed by YL3JG, Karlis Goba.
- KI6SYD, Max Praglin: provided key contributions to the implementation of direct FSK synthesis on the Elecraft KX radios, designed a [REST API](https://app.swaggerhub.com/apis-docs/KI6SYD_1/MAX-3B/1.0.2) which SOTACAT borrows from, and implemented a similar testbed with his [MAX-3B QRP transceiver](https://www.ki6syd.com/max-3b-qrp-radio) on which SOTAMAT-to-radio control was first implemented.
- YL3JG, Karlis Goba: developed the original 'ft8_lib' FT8 CODEC. A derivative version was later created for encoding use in SOTACAT, and ported to C# for encoding in SOTAMAT by AB6D.
- Elecraft: N6KR, Wayne Burdick, and N1AL, Alan, provided guidance on control of Elecraft radios and Mathcad analysis of FT8 FSK harmonics.
- KC6X, Jeff Kowalski: a maintainer for the SOTACAT Github project, makes ongoing contributions to the SOTACAT code base.
- Justin K5EM and Rex KE6MT: Created derivative hardware versions, custom SMT PCBs, and helped with packaging analysis, circuit analysis, and testing.

## Enjoy,

-Brian Mathews, AB6D, SOTAMAT and SOTACAT
