# Configuration for FXCore programmer

import neopixel


DEBUG_MODE = False                    # Set to True to enable detailed debug output

I2S_SAMPLE_RATE = 48000               # Must match samole rate of dev pedal!!

NEOPIXEL_COLOR_ORDER = neopixel.GRB   # Waveshare boards use GRB color scheme
#NEOPIXEL_COLOR_ORDER = neopixel.RGB  # Generic unbranded boards (often with "V1083" legend) use RGB color scheme

PROGRAM_ALL_ON_STARTUP = False        # Program all .hex files on the drive to the FXCore at every reboot/reset
