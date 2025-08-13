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
            print("No LED available")
        
        # State tracking
        self.report_count = 0
        self.i2c_status = 0x20  # I2C idle status
        
        print("FT260 Emulator initialized")
        print(f"Device usage page: 0x{self.hid_device.usage_page:04X}")
        print(f"Device usage: 0x{self.hid_device.usage:04X}")
        
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
                    # Return both the report ID and data
                    return report_id, list(data)
            return None, None
        except Exception as e:
            return None, None
    
    def send_input_report(self, report_id, data):
        """Send an input report back to the host"""
        try:
            # For CircuitPython, we need to send exactly 63 bytes (no report ID prefix)
            # The report ID is specified as a separate parameter
            report_data = bytearray(63)
            if data:
                copy_len = min(len(data), 63)
                report_data[:copy_len] = data[:copy_len]
            
            self.hid_device.send_report(report_data, report_id)
            
            # Log the actual data being sent (first 13 bytes for C2 reports)
            if report_id == 0xC2:
                byte_count = report_data[0]
                print(f"✓ Sent input report 0x{report_id:02X}:")
                print(f"    Byte count: {byte_count}")
                print(f"    Data: {[hex(report_data[i]) for i in range(1, min(13, byte_count + 1))]}")
            else:
                print(f"✓ Sent input report 0x{report_id:02X}: {[hex(b) for b in report_data[:8]]}")
            return True
            
        except Exception as e:
            print(f"✗ Error sending input report 0x{report_id:02X}: {e}")
            return False
    
    def handle_feature_report_a1(self, data):
        """Handle Feature Report 0xA1 - Configuration commands"""
        if not data or len(data) == 0:
            return
            
        cmd = data[0]
        print(f"Feature 0xA1 - Command: 0x{cmd:02X}")
        
        if cmd == 0x20:
            print("  → I2C Reset command")
            self.i2c_status = 0x20  # Reset to idle
            
        elif cmd == 0x22 and len(data) >= 3:
            speed = data[1] | (data[2] << 8)
            print(f"  → Set I2C speed: {speed} kHz")
            # Speed setting acknowledged
            
        else:
            print(f"  → Unknown configuration command: 0x{cmd:02X}")
    
    def handle_feature_report_c0(self, data):
        """Handle Feature Report 0xC0 - I2C Status query"""
        print("Feature 0xC0 - I2C Status query")
        print(f"  → Returning status: 0x{self.i2c_status:02X}")
        # Note: Feature reports are bidirectional, host will read the status
    
    def handle_output_report_c2(self, data):
        """Handle Output Report 0xC2 - I2C Read request"""
        if len(data) < 4:
            print("Invalid I2C read request - too short")
            return
            
        i2c_addr = data[0]
        i2c_flag = data[1]
        bytes_to_read_low = data[2]
        bytes_to_read_high = data[3]
        bytes_to_read = bytes_to_read_low | (bytes_to_read_high << 8)
        
        print(f"Output 0xC2 - I2C Read request:")
        print(f"  → I2C Address: 0x{i2c_addr:02X}")
        print(f"  → Flags: 0x{i2c_flag:02X}")
        print(f"  → Bytes to read: {bytes_to_read}")
        
        # Perform actual I2C read from FXCore
        read_data = None
        if self.i2c and bytes_to_read > 0:
            try:
                # Lock the I2C bus
                while not self.i2c.try_lock():
                    time.sleep(0.001)
                
                try:
                    # Create buffer for the exact number of bytes to read
                    read_buffer = bytearray(bytes_to_read)
                    
                    # Perform the I2C read from the FXCore device
                    self.i2c.readfrom_into(i2c_addr, read_buffer)
                    
                    read_data = read_buffer
                    print(f"  → I2C read successful from 0x{i2c_addr:02X}")
                    print(f"  → Raw data received: {[hex(b) for b in read_data]}")
                    self.i2c_status = 0x20  # Success - idle
                    
                except OSError as e:
                    print(f"  → I2C read failed (OSError): {e}")
                    if "No such device" in str(e) or "19" in str(e):
                        print("  → Device not responding (NACK)")
                        self.i2c_status = 0x26  # Error: slave address not acknowledged
                    else:
                        self.i2c_status = 0x26  # Generic I2C error
                    read_data = None
                    
                except Exception as e:
                    print(f"  → I2C read failed (Exception): {e}")
                    self.i2c_status = 0x26  # Error
                    read_data = None
                    
                finally:
                    self.i2c.unlock()
                    
            except Exception as e:
                print(f"  → I2C bus error: {e}")
                self.i2c_status = 0x26
                read_data = None
        else:
            if not self.i2c:
                print("  → I2C not available")
            else:
                print("  → No bytes requested")
        
        # Create response in FT260 format
        # The web app expects: [byte_count, actual_data_bytes...]
        response_data = bytearray(63)
        
        if read_data is not None:
            # First byte is the number of bytes that were successfully read
            response_data[0] = bytes_to_read & 0xFF  
            
            # Copy the actual FXCore data starting at byte 1
            for i in range(min(bytes_to_read, len(read_data))):
                response_data[1 + i] = read_data[i]
                
            print(f"  → Sending FXCore data ({bytes_to_read} bytes):")
            print(f"    Response[0] = {response_data[0]} (byte count)")
            print(f"    Response[1:13] = {[hex(response_data[1+i]) for i in range(12)]}")
        else:
            # If I2C read failed, return 0 bytes read
            response_data[0] = 0
            print(f"  → I2C read failed, returning 0 bytes read")
        
        # Send the response as Input Report 0xC2
        self.send_input_report(0xC2, response_data)
    
    def handle_output_report_d0(self, data):
        """Handle Output Report 0xD0 - I2C Write command"""
        if len(data) < 4:
            print("Invalid I2C write - too short")
            return
            
        i2c_addr = data[0]
        i2c_flag = data[1]
        byte_count = data[2]
        write_data = data[3:3+byte_count]
        
        print(f"Output 0xD0 - I2C Write:")
        print(f"  → I2C Address: 0x{i2c_addr:02X}")
        print(f"  → Flags: 0x{i2c_flag:02X}")
        print(f"  → Byte count: {byte_count}")
        print(f"  → Data: {[hex(b) for b in write_data]}")
        
        # Perform actual I2C write if I2C is available
        if self.i2c and byte_count > 0:
            try:
                while not self.i2c.try_lock():
                    time.sleep(0.001)
                
                try:
                    self.i2c.writeto(i2c_addr, bytes(write_data))
                    print(f"  → I2C write successful")
                    self.i2c_status = 0x20  # Success - idle
                    
                except Exception as e:
                    print(f"  → I2C write failed: {e}")
                    self.i2c_status = 0x26  # Error: slave address not acknowledged
                finally:
                    self.i2c.unlock()
                    
            except Exception as e:
                print(f"  → I2C error: {e}")
                self.i2c_status = 0x26
        else:
            if not self.i2c:
                print("  → I2C not available - command ignored")
            else:
                print("  → No data to write")
                
    def scan_i2c_devices(self):
        """Scan for I2C devices and print results"""
        if not self.i2c:
            print("I2C not available for scanning")
            return
        
        print("Scanning I2C bus...")
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
                
        except Exception as e:
            print(f"I2C scan error: {e}")
            return
        
        if devices:
            print(f"Found I2C devices at addresses: {[hex(addr) for addr in devices]}")
        else:
            print("No I2C devices found")
        
        return devices
    
    def process_reports(self):
        """Process incoming HID reports"""
        try:
            report_id, data = self.get_last_received_report()
            if report_id is not None:
                self.flash_led(1, 0.05)
                self.report_count += 1
                
                print(f"\n{'='*60}")
                print(f"RECEIVED REPORT #{self.report_count} - ID: 0x{report_id:02X}")
                print(f"Time: {time.monotonic():.2f}s")
                print(f"{'='*60}")
                
                # Display raw data (first 16 bytes)
                if data:
                    hex_data = [f"0x{b:02X}" for b in data[:16]]
                    print(f"Raw data: {' '.join(hex_data)}")
                
                # Route to appropriate handler (data doesn't include report ID anymore)
                if report_id == 0xA1:
                    self.handle_feature_report_a1(data)
                elif report_id == 0xC0:
                    self.handle_feature_report_c0(data)
                elif report_id == 0xC2:
                    self.handle_output_report_c2(data)
                elif report_id == 0xD0:
                    self.handle_output_report_d0(data)
                
                print(f"{'='*60}\n")
                
        except Exception as e:
            print(f"Error processing reports: {e}")
    
    def send_heartbeat(self):
        """Send periodic heartbeat to test device→host communication"""
        try:
            heartbeat = bytearray(63)
            heartbeat[0] = 0xBE  # Heartbeat signature
            heartbeat[1] = 0xEF  # Heartbeat signature
            heartbeat[2] = int(time.monotonic()) & 0xFF
            heartbeat[3] = self.report_count & 0xFF
            
            self.hid_device.send_report(heartbeat, 0xC2)  # Send as input report
            print(f"💓 Heartbeat sent (reports processed: {self.report_count})")
            
        except Exception as e:
            print(f"💔 Heartbeat failed: {e}")
    
    def run(self):
        """Main loop"""
        print("\n" + "="*60)
        print("FT260 USB-I2C BRIDGE EMULATOR")
        print("="*60)
        print("Ready to receive HID reports from host...")
        print("I2C interface: GP0 (SDA), GP1 (SCL)")
        print("Supported reports:")
        print("  • 0xA1 (Feature) - Configuration commands")
        print("  • 0xC0 (Feature) - I2C status queries")
        print("  • 0xC2 (Output)  - I2C read requests → performs actual I2C reads")
        print("  • 0xD0 (Output)  - I2C write commands → performs actual I2C writes")
        print("="*60 + "\n")
        
        # Initial LED sequence and I2C scan
        self.flash_led(3, 0.2)
        
        # Scan for I2C devices on startup
        if self.i2c:
            self.scan_i2c_devices()
        
        last_heartbeat_time = 0
        last_status_time = time.monotonic()
        start_time = time.monotonic()
        
        while True:
            try:
                # Process any incoming reports
                self.process_reports()
                
                # Send heartbeat every 10 seconds
                current_time = time.monotonic()
                if current_time - last_heartbeat_time > 10:
                    self.send_heartbeat()
                    last_heartbeat_time = current_time
                
                # Status update every 30 seconds
                if current_time - last_status_time > 30:
                    uptime = current_time - start_time
                    print(f"📊 Status: {uptime:.0f}s uptime, {self.report_count} reports processed")
                    last_status_time = current_time
                
                time.sleep(0.001)  # Check very frequently for reports
                
            except KeyboardInterrupt:
                print("\n🛑 Stopping FT260 Emulator...")
                break
            except Exception as e:
                print(f"💥 Error in main loop: {e}")
                time.sleep(0.1)

# Main execution
if __name__ == "__main__":
    try:
        print("Starting FT260 USB-I2C Bridge Emulator...")
        
        # Test that our HID device is available
        device_found = False
        for device in usb_hid.devices:
            if hasattr(device, 'usage_page') and device.usage_page == 0xFF00:
                print(f"✓ Found FT260 HID device - Usage Page: 0x{device.usage_page:04X}")
                device_found = True
                break
        
        if not device_found:
            print("✗ FT260 HID device not found. Check boot.py configuration.")
            exit()
        
        emulator = FT260Emulator()
        emulator.run()
        
    except Exception as e:
        print(f"💥 Failed to start emulator: {e}")
        import traceback
        traceback.print_exc()