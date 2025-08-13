# code.py - FT260 USB-I2C Bridge Emulator
import usb_hid
import time
import digitalio
import board
import busio

class FT260Emulator:
    def __init__(self):
        # Find our custom FT260 HID device
        self.hid_device = None
        for device in usb_hid.devices:
            if hasattr(device, 'usage_page') and device.usage_page == 0xFF00:
                self.hid_device = device
                break
        
        if not self.hid_device:
            raise RuntimeError("FT260 HID device not found. Check boot.py configuration.")
        
        # Initialize I2C on GP0 (SDA) and GP1 (SCL)
        try:
            self.i2c = busio.I2C(board.GP1, board.GP0)  # SCL, SDA
            print("✓ I2C initialized on GP0 (SDA) and GP1 (SCL)")
        except Exception as e:
            print(f"✗ I2C initialization failed: {e}")
            self.i2c = None
        
        # Setup status LED if available
        try:
            self.led = digitalio.DigitalInOut(board.LED)
            self.led.direction = digitalio.Direction.OUTPUT
            self.led.value = False
        except:
            self.led = None
        
        # State tracking
        self.i2c_status = 0x20  # I2C idle status
        
        print("FT260 Emulator ready")
        
    def flash_led(self, count=1, duration=0.1):
        """Flash the LED to indicate activity"""
        if self.led:
            for _ in range(count):
                self.led.value = True
                time.sleep(duration)
                self.led.value = False
                if count > 1:
                    time.sleep(duration)
    
    def get_last_received_report(self):
        """Get the last received report from host"""
        try:
            # Try each report type individually
            for report_id in [0xA1, 0xC0, 0xC2, 0xD0]:
                data = self.hid_device.get_last_received_report(report_id)
                if data:
                    return report_id, list(data)
            return None, None
        except Exception as e:
            return None, None
    
    def send_input_report(self, report_id, data):
        """Send an input report back to the host"""
        try:
            report_data = bytearray(63)
            if data:
                copy_len = min(len(data), 63)
                report_data[:copy_len] = data[:copy_len]
            
            self.hid_device.send_report(report_data, report_id)
            return True
            
        except Exception as e:
            print(f"Error sending input report 0x{report_id:02X}: {e}")
            return False
    
    def handle_feature_report_a1(self, data):
        """Handle Feature Report 0xA1 - Configuration commands"""
        if not data or len(data) == 0:
            return
            
        cmd = data[0]
        if cmd == 0x20:
            print("I2C Reset")
            self.i2c_status = 0x20  # Reset to idle
        elif cmd == 0x22 and len(data) >= 3:
            speed = data[1] | (data[2] << 8)
            print(f"Set I2C speed: {speed} kHz")
    
    def handle_feature_report_c0(self, data):
        """Handle Feature Report 0xC0 - I2C Status query"""
        # Status is handled by the feature report mechanism
        pass
    
    def handle_output_report_c2(self, data):
        """Handle Output Report 0xC2 - I2C Read request"""
        if len(data) < 4:
            return
            
        i2c_addr = data[0]
        bytes_to_read = data[2] | (data[3] << 8)
        
        print(f"I2C Read: 0x{i2c_addr:02X}, {bytes_to_read} bytes")
        
        # Perform I2C read
        read_data = None
        if self.i2c and bytes_to_read > 0:
            try:
                while not self.i2c.try_lock():
                    time.sleep(0.001)
                
                try:
                    read_buffer = bytearray(bytes_to_read)
                    self.i2c.readfrom_into(i2c_addr, read_buffer)
                    read_data = read_buffer
                    self.i2c_status = 0x20  # Success
                    
                except OSError:
                    self.i2c_status = 0x26  # Error: device not responding
                    read_data = None
                finally:
                    self.i2c.unlock()
                    
            except Exception:
                self.i2c_status = 0x26
                read_data = None
        
        # Create response in FT260 format
        response_data = bytearray(63)
        
        if read_data is not None:
            response_data[0] = bytes_to_read & 0xFF  # Byte count
            for i in range(min(bytes_to_read, len(read_data))):
                response_data[1 + i] = read_data[i]
            print("✓ Read successful")
        else:
            response_data[0] = 0  # Failed read
            print("✗ Read failed")
        
        self.send_input_report(0xC2, response_data)
    
    def handle_output_report_d0(self, data):
        """Handle Output Report 0xD0 - I2C Write command"""
        if len(data) < 4:
            return
            
        i2c_addr = data[0]
        byte_count = data[2]
        write_data = data[3:3+byte_count]
        
        print(f"I2C Write: 0x{i2c_addr:02X}, {byte_count} bytes")
        
        # Perform I2C write
        if self.i2c and byte_count > 0:
            try:
                while not self.i2c.try_lock():
                    time.sleep(0.001)
                
                try:
                    self.i2c.writeto(i2c_addr, bytes(write_data))
                    self.i2c_status = 0x20  # Success
                    print("✓ Write successful")
                    
                except OSError:
                    self.i2c_status = 0x26  # Error
                    print("✗ Write failed")
                finally:
                    self.i2c.unlock()
                    
            except Exception:
                self.i2c_status = 0x26
                print("✗ Write error")
        else:
            print("✗ I2C not available")
    
    def process_reports(self):
        """Process incoming HID reports"""
        try:
            report_id, data = self.get_last_received_report()
            if report_id is not None:
                self.flash_led(1, 0.02)
                
                # Route to appropriate handler
                if report_id == 0xA1:
                    self.handle_feature_report_a1(data)
                elif report_id == 0xC0:
                    self.handle_feature_report_c0(data)
                elif report_id == 0xC2:
                    self.handle_output_report_c2(data)
                elif report_id == 0xD0:
                    self.handle_output_report_d0(data)
                
        except Exception as e:
            print(f"Error processing reports: {e}")
    
    def scan_i2c_devices(self):
        """Scan for I2C devices"""
        if not self.i2c:
            return []
        
        devices = []
        try:
            while not self.i2c.try_lock():
                time.sleep(0.001)
            
            try:
                for addr in range(0x08, 0x78):
                    try:
                        self.i2c.writeto(addr, b'')
                    except OSError:
                        pass
                    else:
                        devices.append(addr)
            finally:
                self.i2c.unlock()
                
        except Exception:
            pass
        
        if devices:
            print(f"I2C devices: {[hex(addr) for addr in devices]}")
        else:
            print("No I2C devices found")
        
        return devices
    
    def run(self):
        """Main loop"""
        print("\nFT260 USB-I2C Bridge Emulator")
        print("I2C: GP0 (SDA), GP1 (SCL)")
        
        # Initial setup
        self.flash_led(2, 0.1)
        if self.i2c:
            self.scan_i2c_devices()
        
        last_status_time = time.monotonic()
        
        while True:
            try:
                self.process_reports()
                
                # Status update every 60 seconds
                current_time = time.monotonic()
                if current_time - last_status_time > 60:
                    print(f"Running: {current_time:.0f}s")
                    last_status_time = current_time
                
                time.sleep(0.001)
                
            except KeyboardInterrupt:
                print("\nStopping...")
                break
            except Exception as e:
                print(f"Error: {e}")
                time.sleep(0.1)

# Main execution
if __name__ == "__main__":
    try:
        # Verify HID device is available
        device_found = False
        for device in usb_hid.devices:
            if hasattr(device, 'usage_page') and device.usage_page == 0xFF00:
                device_found = True
                break
        
        if not device_found:
            print("FT260 HID device not found. Check boot.py configuration.")
        else:
            emulator = FT260Emulator()
            emulator.run()
        
    except Exception as e:
        print(f"Failed to start: {e}")