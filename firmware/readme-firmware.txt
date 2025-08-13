FXCore Programmer with FT260 USB-I2C Bridge Emulation
======================================================

This folder contains firmware for a dual-mode CircuitPython device that can function as:
1. FXCore hex file programmer for SpinSemi DSP chips
2. FT260-compatible USB-I2C bridge emulator

FOLDER STRUCTURE:
================

disk-hid/
├── SANDBOXFX_DISK_HID.uf2      # Main firmware file for Raspberry Pi Pico
├── src/
│   ├── boot.py                 # Boot configuration for HID and disk mode
│   ├── code.py                 # Main application code
│   ├── hardware_id.json       # Hardware identification file
│   └── lib/                    # CircuitPython libraries (if needed)

disk-mode/
├── SANDBOXFX_DISK.uf2          # Disk-only mode firmware
├── src/
│   ├── boot.py                 # Boot configuration for disk mode only
│   ├── code.py                 # FXCore programmer only
│   ├── hardware_id.json       # Hardware identification file
│   └── lib/                    # CircuitPython libraries (if needed)

readme-firmware.txt             # This file
readme-rp2040.md               # Detailed hardware documentation


FIRMWARE MODES:
===============

DISK-HID MODE (disk-hid/):
- Full dual functionality
- FXCore programming via hex files on disk
- FT260 USB-I2C bridge emulation
- Automatic mode switching based on activity
- USB HID device + USB mass storage

DISK-ONLY MODE (disk-mode/):
- FXCore programming only
- Simpler operation
- USB mass storage only
- No HID functionality


INSTALLATION:
=============

1. Hold BOOTSEL button on Raspberry Pi Pico while connecting USB
2. Copy desired .uf2 file to RPI-RP2 drive:
   - SANDBOXFX_DISK_HID.uf2 for full functionality
   - SANDBOXFX_DISK.uf2 for programming only
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
- Built-in LED on GP25 for FT260 activity indication


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
   - Add output.hex → Starts RAM execution
   - Delete output.hex → Stops execution
   - Add X.hex (0-F) → Programs flash location X


USAGE - FT260 USB-I2C BRIDGE:
=============================

(Only available in disk-hid mode)

1. Connect I2C devices to GP0/GP1
2. Use FT260-compatible software to access I2C bus
3. Bridge mode activates automatically when USB commands received
4. Times out after 10 seconds of inactivity
5. Compatible with standard FT260 drivers and software


TECHNICAL DETAILS:
==================

- Microcontroller: Raspberry Pi Pico (RP2040)
- Firmware: CircuitPython 8.x or later
- I2C Bus: Hardware I2C on GP0/GP1
- USB: Dual endpoint support (HID + Mass Storage)
- Memory: Shared I2C bus with priority arbitration
- Protocol: Intel HEX file parsing, FXCore binary protocol


TROUBLESHOOTING:
================

- If FXCore programming fails: Check I2C connections and power
- If FT260 not detected: Verify HID configuration in boot.py
- If files don't appear: Check CircuitPython installation
- For device conflicts: Use disk-mode version for programming only
- Reset device: Short RUN pin to GND or power cycle


VERSION HISTORY:
================

v4.0 - Added FT260 USB-I2C bridge emulation with automatic mode switching
v3.0 - Added location-specific programming (0.hex - F.hex)
v2.0 - Added comprehensive logging and state monitoring  
v1.0 - Basic FXCore programming with output.hex


SUPPORT:
========

For hardware documentation, see readme-rp2040.md
For firmware updates and source code, check project repository
For FXCore programming protocol details, refer to SpinSemi documentation