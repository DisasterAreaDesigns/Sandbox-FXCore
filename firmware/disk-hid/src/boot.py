# boot.py - FT260 USB-I2C Bridge Emulation (Simplified)
import usb_hid
import supervisor
import storage

# Simplified FT260 HID descriptor with fewer report IDs
FT260_HID_DESCRIPTOR = bytes([
    0x06, 0x00, 0xFF,        # Usage Page (Vendor Defined 0xFF00)
    0x09, 0x01,              # Usage (0x01)
    0xA1, 0x01,              # Collection (Application)
    
    # Feature Report 0xA1 (Configuration: reset, set speed)
    0x85, 0xA1,              # Report ID (0xA1)
    0x09, 0x02,              # Usage (0x02)
    0x95, 0x3F,              # Report Count (63)
    0x75, 0x08,              # Report Size (8 bits)
    0x26, 0xFF, 0x00,        # Logical Maximum (255)
    0x15, 0x00,              # Logical Minimum (0)
    0xB1, 0x02,              # Feature (Data, Variable, Absolute)
    
    # Feature Report 0xC0 (I2C Status queries)
    0x85, 0xC0,              # Report ID (0xC0)
    0x09, 0x03,              # Usage (0x03)
    0x95, 0x3F,              # Report Count (63)
    0x75, 0x08,              # Report Size (8 bits)
    0xB1, 0x02,              # Feature (Data, Variable, Absolute)
    
    # Input Report 0xC2 (I2C Read Data responses)
    0x85, 0xC2,              # Report ID (0xC2)
    0x09, 0x04,              # Usage (0x04)
    0x95, 0x3F,              # Report Count (63)
    0x75, 0x08,              # Report Size (8 bits)
    0x81, 0x02,              # Input (Data, Variable, Absolute)
    
    # Output Report 0xC2 (I2C Read Requests)
    0x85, 0xC2,              # Report ID (0xC2)
    0x09, 0x05,              # Usage (0x05)
    0x95, 0x3F,              # Report Count (63)
    0x75, 0x08,              # Report Size (8 bits)
    0x91, 0x02,              # Output (Data, Variable, Absolute)
    
    # Output Report 0xD0 (I2C Write Commands - consolidated)
    0x85, 0xD0,              # Report ID (0xD0)
    0x09, 0x06,              # Usage (0x06)
    0x95, 0x3F,              # Report Count (63)
    0x75, 0x08,              # Report Size (8 bits)
    0x91, 0x02,              # Output (Data, Variable, Absolute)
    
    # Output Report 0xDF (Alternative I2C Write - for compatibility)
    0x85, 0xDF,              # Report ID (0xDF)
    0x09, 0x07,              # Usage (0x07)
    0x95, 0x3F,              # Report Count (63)
    0x75, 0x08,              # Report Size (8 bits)
    0x91, 0x02,              # Output (Data, Variable, Absolute)
    
    0xC0                     # End Collection
])

# Create the FT260 HID device with only 6 report IDs
ft260_hid = usb_hid.Device(
    report_descriptor=FT260_HID_DESCRIPTOR,
    usage_page=0xFF00,
    usage=0x01,
    report_ids=(
        0xA1,  # Feature: Configuration
        0xC0,  # Feature: I2C Status
        0xC2,  # Input/Output: I2C Read Data/Request
        0xD0,  # Output: I2C Write Commands (all sizes)
        0xDF,  # Output: Alternative I2C Write (for compatibility)
        0x01   # Reserved for future use
    ),
    in_report_lengths=(
        63,   # 0xA1 Feature (bidirectional)
        63,   # 0xC0 Feature (bidirectional) 
        63,   # 0xC2 Input (device to host)
        0,    # 0xD0 Output only (host to device)
        0,    # 0xDF Output only (host to device)
        0     # 0x01 Reserved
    ),
    out_report_lengths=(
        63,   # 0xA1 Feature (bidirectional)
        63,   # 0xC0 Feature (bidirectional)
        63,   # 0xC2 Output (host to device read request)
        63,   # 0xD0 Output (host to device write)
        63,   # 0xDF Output (host to device write)
        0     # 0x01 Reserved
    )
)

# Enable only our custom FT260 HID device
usb_hid.enable((ft260_hid,))

storage.remount("/", readonly=False)

m = storage.getmount("/")
m.label = "SANDBOX-FX"

storage.remount("/", readonly=True)

storage.enable_usb_drive()

supervisor.set_usb_identification(manufacturer='Disaster Area Designs', product='SandboxFX', vid=0xBEEF, pid=0xB00F)

print("FT260 HID device enabled with 6 report IDs:")
print("  Feature Reports: 0xA1 (config), 0xC0 (status)")
print("  Input Report: 0xC2 (I2C read data)") 
print("  Output Reports: 0xC2 (I2C read req), 0xD0 (I2C write), 0xDF (alt write)")
print("  Reserved: 0x01")
print("  Note: All I2C writes will use report ID 0xD0 regardless of length")
