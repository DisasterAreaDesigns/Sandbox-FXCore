import supervisor
import storage
#import usb_midi
#import usb_cdc

#usb_midi.disable()

# usb_cdc.enable(console=False, data=True)

storage.remount("/", readonly=False)

m = storage.getmount("/")
m.label = "SANDBOX-FX"

storage.remount("/", readonly=True)

storage.enable_usb_drive()

supervisor.set_usb_identification(manufacturer='Disaster Area Designs', product='SandboxFX', vid=0x1209, pid=0x3911)