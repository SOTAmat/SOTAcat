# FT8 library

C implementation of a lightweight FT8 encoder, appropriate for microcontrollers.
The encoding process is relatively light on resources, and an Arduino should be perfectly capable of running this code.

# Current state

Currently the basic message set for establishing QSOs, as well as telemetry and free-text message modes are supported:

- CQ {call} {grid}, e.g. CQ CA0LL GG77
- CQ {xy} {call} {grid}, e.g. CQ JA CA0LL GG77
- {call} {call} {report}, e.g. CA0LL OT7ER R-07
- {call} {call} 73/RRR/RR73, e.g. OT7ER CA0LL 73
- Free-text messages (up to 13 characters from a limited alphabet) (decoding only, untested)
- Telemetry data (71 bits as 18 hex symbols)

Encoding works for FT8. For encoding there is a console application provided which serves mostly as test code.

# What to do with it

To build on linux: run `make`. Then run `gen_ft8` (run it without parameters to check what parameters are supported).

# References and credits

Brian Mathews gives thanks to:

- Kārlis Goba who wrote the original work and did the very heavy lifting. All I've done is make derivative versions of the original. Either by porting to other platforms (ex. C#) or by slimming down the code for certain narrow use cases (ex. encode only, FT8 only, Free-Text only, etc.)

Kārlis Goba gives thanks to:

- my contributors who have provided me with various improvements which have often been beyond my skill set.
- Robert Morris, AB1HL, whose Python code (https://github.com/rtmrtmrtmrtm/weakmon) inspired this and helped to test various parts of the code.
- Mark Borgerding for his FFT implementation (https://github.com/mborgerding/kissfft). I have included a portion of his code.
- WSJT-X authors, who developed a very interesting and novel communications protocol

The details of FT4 and FT8 procotols and decoding/encoding are described here: https://physics.princeton.edu/pulsar/k1jt/FT4_FT8_QEX.pdf

Karlis Goba,
YL3JG
