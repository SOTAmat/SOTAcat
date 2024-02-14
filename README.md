# SOTAcat

### SOTAmat hardware adapter for radio CAT control and FT8 audio injection

### THIS IS A "PRE-RELEASE" WORK IN PROGRESS

Basic instructions:

1. git clone --recurse-submodules https://github.com/SOTAmat/SOTAcat.git
2. Define environment variables for your home 2.4GHz WiFi router (won't be used in the field, but used for development/debugging):

- SOTACAT_HOME_WIFI_SSID
- SOTACAT_HOME_WIFI_PASSWORD

3. Install PlatformIO
4. Build, Deploy

Since this is pre-release, I am almost certain I've forgotten several steps. Let me know where it gets stuck and I'll update these instructions.

### Attribution

- Max Praglin KI6SYD helped figure out a few key things about the Elecraft that helped make direct FSK synthesis possible without resorting to a DAC.
- My FT8 encoder submodule is a derivative of prior work by Karlis Goba, YL3JG. See the submodule Readme for more details.
- Elecraft (Wayne and collaborators) provided technical and simulation assistance and we hope to collaborate further on some additional ideas in this project's direction...

### Enjoy,

-Brian Mathews, AB6D, SOTAMAT and SOTACAT
