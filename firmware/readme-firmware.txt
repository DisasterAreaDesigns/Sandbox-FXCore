FXCore Programmer with FT260 USB-I2C Bridge Emulation
======================================================

This folder contains firmware for a CircuitPython device that acts as both:
1. FXCore hex file programmer for Experimental Noize DSP chips
2. FT260-compatible USB-I2C bridge emulator

FOLDER STRUCTURE:
================

disk-hid/                       # Dev unit firmware, version 4.4
└── src/
    ├── boot.py                 # Boot configuration for HID and disk mode
    ├── code.py                 # Main application code
    ├── hardware_id.json       # Hardware identification file
    └── lib/                    # CircuitPython libraries

production-prog/                # Production programmer firmware, version 4.5
└── src/
    ├── boot.py                 # Boot configuration
    ├── code.py                 # Main application code
    ├── hardware_id.json       # Hardware identification file
    ├── settings.toml           # CircuitPython settings
    ├── sd/                     # SD card mount point
    └── lib/                    # CircuitPython libraries, incl. the OLED
                                # driver and display text

readme-firmware.txt             # This file
readme-rp2040.md               # Detailed hardware documentation

A disk-mode/ build that did the programming without the HID bridge, and a
hid-only/ pair of FT260 emulation experiments, used to sit beside these.
disk-hid covers what they did, so they have been removed; they are in the
history if they are ever wanted back.

No .uf2 images are checked in at the moment. The ones that used to be here had
drifted well behind src/, which is a worse trap than having none.


THE TWO BUILDS:
===============

DISK-HID (disk-hid/) -- the dev unit
- FXCore programming via hex files on the CIRCUITPY drive, read at boot
- FT260 USB-I2C bridge emulation, served continuously thereafter
- USB HID device + USB mass storage
- This is the one the assembler talks to

PRODUCTION-PROG (production-prog/) -- the bench programmer we use in
production
- Everything disk-hid does, plus:
- SSD1306 OLED on the same I2C bus at 0x3C, for programming without a host
- SD card, mounted at src/sd/
- .prj project files: one plain text file naming the hex file for each of
  the sixteen flash slots, so a whole unit is programmed in one pass

      # comment lines are ignored
      name=My Project Name
      0=some_file.hex
      1=another_file.hex
      A=yet_another.hex

  The first .prj found alphabetically is the one used.

The two share their FXCore and FT260 code; a fix to one usually belongs in
the other.


INSTALLATION:
=============

Until a new .uf2 is built, install CircuitPython on the Pico and copy the
contents of the build's src/ onto the CIRCUITPY drive.

With a .uf2 in hand:
1. Hold BOOTSEL button on Raspberry Pi Pico while connecting USB
2. Copy the .uf2 file to the RPI-RP2 drive
3. Device will reboot automatically
4. UF2 files contain entire flash contents, no other installation is necessary 


HARDWARE CONNECTIONS:
====================

Required connections for FXCore programming:
- GP0 (Pin 1):  I2C SDA to FXCore SDA
- GP1 (Pin 2):  I2C SCL to FXCore SCL  
- GP16 (Pin 21): NeoPixel status LED
- GND: Common ground between Pico and FXCore
- 3.3V: Power (if needed)

Optional:
- GP2 drives an LED for programming and bridge activity

production-prog additionally uses:
- The same GP0/GP1 I2C bus for an SSD1306 OLED at address 0x3C
- An SD card for hex and .prj files


USAGE - FXCORE PROGRAMMING:
===========================

1. Place hex files on CIRCUITPY drive:
   - output.hex: Execute program from RAM
   - 0.hex through F.hex: Program to specific flash locations

2. LED Status Indicators:
   - RED: Program running from RAM
   - GREEN: Location programming successful  
   - PURPLE: Location programming in progress
   - BLUE: RAM upload in progress
   - OFF: Normal operation

3. File Operations:
   Hex files are read once, at startup, so add them and then reset the board.
   - output.hex present at boot → Starts RAM execution
   - X.hex (0-F) present at boot → Programs flash location X
   Deleting output.hex does not stop a running program; send RETURN_0 over
   the bridge instead ("Clear Hardware" in the assembler).


USAGE - FT260 USB-I2C BRIDGE:
=============================

1. Connect I2C devices to GP0/GP1
2. Use FT260-compatible software to access I2C bus
3. Bridge commands are served whenever they arrive
4. No inactivity timeout; the bridge stays available (removed in v4.1)
5. Compatible with standard FT260 drivers and software

A single I2C read returns at most 62 bytes, the space left in one HID input
report after the count byte. A larger request is clamped, and the reply says
how many bytes actually came back.


TECHNICAL DETAILS:
==================

- Microcontroller: Raspberry Pi Pico (RP2040)
- Firmware: CircuitPython 8.x or later
- I2C Bus: Hardware I2C on GP0/GP1
- USB: Dual endpoint support (HID + Mass Storage)
- Memory: Shared I2C bus, guarded by a lock taken with a one second deadline.
  On production-prog the OLED is on that same bus, so the lock is genuinely
  contended and the deadline is what keeps a stuck bus from wedging the board
- Protocol: Intel HEX file parsing, FXCore binary protocol
- Transfers: each FXCore block is one I2C transaction; the chip counts the
  bytes of a block within a single transaction, so a block cannot be split


TROUBLESHOOTING:
================

- If FXCore programming fails: Check I2C connections and power
- If FT260 not detected: Verify HID configuration in boot.py
- If files don't appear: Check CircuitPython installation
- Reset device: Short RUN pin to GND or power cycle


VERSION HISTORY:
================

v4.5 - (production-prog) .prj project file support, OLED and SD card
v4.4 - Unified buffer and programming functions, LED state fixes
v4.1 - Removed the FT260 inactivity timeout; hex files are read at boot only
v4.0 - Added FT260 USB-I2C bridge emulation with automatic mode switching
v3.0 - Added location-specific programming (0.hex - F.hex)
v2.0 - Added comprehensive logging and state monitoring  
v1.0 - Basic FXCore programming with output.hex


SUPPORT:
========

For hardware documentation, see readme-rp2040.md
For firmware updates and source code, check project repository
For FXCore programming protocol details, refer to https://www.experimentalnoize.com/manuals/FXCore/docs/Communicating_with_the_FXCore.pdf
