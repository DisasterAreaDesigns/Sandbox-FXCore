CircuitPython program and libraries for RP2040 Zero module go here

adafruit-circuitpython-waveshare_rp2040_zero-en_US-10.0.0-beta.2.uf2 - binary firmware blob for circuitpython v10.0.0 beta, instal to RP2040
code.py - circuitpython code for uploading FXCoreASM HEX files to device eeprom
hardware_id.json - simple identifier so that the website knows it has a valid target
<lib> - library folder for circuitpython, contains libraries used by the RP2040 for neopixel control
readme-firmware.txt - this file
readme-rp2040.md - description of circuitpython code operation

How to install:
Power off RP2040 device, all plugs out
Put RP2040 device into bootloader mode by holding BOOTSEL button while plugging in USB cable
A new removable drive labeled "RPI-RP2" will appear on your computer
Drag adafruit-circuitpython-waveshare_rp2040_zero-en_US-10.0.0-beta.2.uf2 into this new drive
Wait for the RP2040 to reboot
A new removable drive labeled "CIRCUITPY" should appear
Drag code.py, hardware_id.json, and the <lib> folder into this drive.  Merge or replace the contents of <lib> if asked
