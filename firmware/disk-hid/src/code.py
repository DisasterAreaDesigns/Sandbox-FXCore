# FXCore Hex File Uploader with FT260 Emulation
# Version 4.1 - Removed FT260 timeout (files checked at boot only)
# Date: 2025-01-15

import board
import busio
import time
import neopixel
import os
import usb_hid
import digitalio

# FXCore I2C address
FXCORE_ADDRESS = 0x30
LOG_FILE = "results.txt"

# NeoPixel setup
NEOPIXEL_PIN = board.GP16
NUM_PIXELS = 1
pixel = neopixel.NeoPixel(NEOPIXEL_PIN, NUM_PIXELS, brightness=0.3, auto_write=True)

# Colors
RED = (255, 0, 0)
GREEN = (0, 255, 0)
BLUE = (0, 0, 255)
YELLOW = (255, 255, 0)
PURPLE = (255, 0, 255)
WHITE = (255, 255, 255)
OFF = (0, 0, 0)

# Initialize I2C bus on GP0 (SDA) and GP1 (SCL)
try:
    i2c = busio.I2C(scl=board.GP1, sda=board.GP0)
    print("I2C bus initialized on GP0 (SDA) and GP1 (SCL)")
    print("NeoPixel initialized on GP16")
    pixel[0] = OFF  # Start with LED off
except Exception as e:
    print(f"Error initializing I2C or NeoPixel: {e}")
    while True:
        time.sleep(1)

# Smart FT260 Emulator Class - Fixed command parsing
class SmartFT260Emulator:
    def __init__(self):
        # Find our custom FT260 HID device
        self.hid_device = None
        for device in usb_hid.devices:
            if hasattr(device, 'usage_page') and device.usage_page == 0xFF00:
                self.hid_device = device
                break
        
        if not self.hid_device:
            print("FT260 HID device not found. Check boot.py configuration.")
            self.enabled = False
        else:
            self.enabled = True
            print("✓ Smart FT260 Emulator ready")
        
        # State tracking
        self.i2c_status = 0x20  # I2C idle status
        self.active = False
        
        # Programming data buffers
        self.reset_programming_state()
        
        # Programming state
        self.in_programming_mode = False
        self.expecting_data = None  # What type of data we're expecting next
        self.data_remaining = 0     # How many bytes remaining for current transfer
    
    def reset_programming_state(self):
        """Reset all programming data buffers"""
        self.mreg_data = bytearray()
        self.creg_data = bytearray()
        self.sfr_data = bytearray()
        self.program_data = bytearray()
        self.expecting_data = None
        self.data_remaining = 0
        print("FT260: Programming state reset")

    
    def get_last_received_report(self):
        """Get the last received report from host"""
        if not self.enabled:
            return None, None
            
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
        if not self.enabled:
            return False
            
        try:
            report_data = bytearray(63)
            if data:
                copy_len = min(len(data), 63)
                report_data[:copy_len] = data[:copy_len]
            
            self.hid_device.send_report(report_data, report_id)
            return True
            
        except Exception as e:
            print(f"FT260: Error sending input report 0x{report_id:02X}: {e}")
            return False
    
    def handle_output_report_c2(self, data):
        """Handle Output Report 0xC2 - I2C Read request (pass through normally)"""
        if len(data) < 4:
            return
            
        i2c_addr = data[0]
        bytes_to_read = data[2] | (data[3] << 8)
        
        print(f"FT260: I2C Read: 0x{i2c_addr:02X}, {bytes_to_read} bytes")
        
        # Perform actual I2C read
        read_data = None
        if bytes_to_read > 0:
            try:
                while not i2c.try_lock():
                    time.sleep(0.001)
                
                try:
                    read_buffer = bytearray(bytes_to_read)
                    i2c.readfrom_into(i2c_addr, read_buffer)
                    read_data = read_buffer
                    self.i2c_status = 0x20  # Success
                    
                except OSError:
                    self.i2c_status = 0x26  # Error: device not responding
                    read_data = None
                finally:
                    i2c.unlock()
                    
            except Exception:
                self.i2c_status = 0x26
                read_data = None
                try:
                    i2c.unlock()
                except:
                    pass
        
        # Create response in FT260 format
        response_data = bytearray(63)
        
        if read_data is not None:
            response_data[0] = min(bytes_to_read, len(read_data))  # Byte count
            for i in range(min(bytes_to_read, len(read_data))):
                response_data[1 + i] = read_data[i]
            print("FT260: ✓ Read successful")
        else:
            response_data[0] = 0  # Failed read
            print("FT260: ✗ Read failed")
        
        self.send_input_report(0xC2, response_data)
    
    def handle_programming_command(self, write_data, i2c_flag):
        """Handle FXCore programming commands - parse the I2C write data properly"""
        # If we're currently expecting data, check the flag to see if this is data or a new command
        if self.expecting_data:
            # Flag 0x06 = START + STOP (command packet)
            # Flag 0x02 = START only (data start) 
            # Flag 0x00 = continuation (data continuation)
            # Flag 0x04 = STOP only (data end)
            
            if i2c_flag == 0x06:
                # This is a command packet (START + STOP), so process as new command
                # But first check if this looks like a valid command
                if len(write_data) >= 2:
                    cmd_high = write_data[0]
                    cmd_low = write_data[1]
                    
                    # Check if this is a recognized command
                    is_valid_command = False
                    if cmd_high == 0xA5 and cmd_low == 0x5A:  # ENTER_PRG
                        is_valid_command = True
                    elif cmd_high == 0x5A and cmd_low == 0xA5:  # EXIT_PRG
                        is_valid_command = True
                    elif cmd_high == 0x04 and cmd_low == 0x7F:  # MREG (correct command)
                        is_valid_command = True
                    elif cmd_high == 0x01 and cmd_low == 0x0F:  # CREG
                        is_valid_command = True
                    elif cmd_high == 0x02 and cmd_low == 0x0B:  # SFR
                        is_valid_command = True
                    elif cmd_high == 0x08 or cmd_high == 0x09 or cmd_high == 0x0A or cmd_high == 0x0B:  # PROGRAM
                        is_valid_command = True
                    elif cmd_high == 0x0D and cmd_low == 0x00:  # EXEC_FROM_RAM
                        is_valid_command = True
                    elif cmd_high == 0x0C:  # WRITE_PRG
                        is_valid_command = True
                    elif cmd_high == 0x0E and cmd_low == 0x00:  # RETURN_0
                        is_valid_command = True
                    
                    if not is_valid_command:
                        # This has flag 0x06 but doesn't look like a command, treat as data
                        print(f"FT260: Data for {self.expecting_data} (flag 0x{i2c_flag:02X}): {len(write_data)} bytes")
                        self.handle_programming_data(write_data)
                        return True
                # Continue to command parsing below
            else:
                # This is data continuation (not a command)
                print(f"FT260: Data continuation for {self.expecting_data} (flag 0x{i2c_flag:02X}): {len(write_data)} bytes")
                self.handle_programming_data(write_data)
                return True
        
        if len(write_data) < 2:
            return False
            
        cmd_high = write_data[0]
        cmd_low = write_data[1]
        payload_data = write_data[2:] if len(write_data) > 2 else bytearray()
        
        cmd = (cmd_high << 8) | cmd_low
        print(f"FT260: Command 0x{cmd_high:02X} 0x{cmd_low:02X} (0x{cmd:04X}) with {len(payload_data)} payload bytes")
        
        # Enter programming mode
        if cmd_high == 0xA5 and cmd_low == 0x5A:
            print("FT260: ENTER_PRG command detected")
            self.in_programming_mode = True
            self.reset_programming_state()
            enter_prog_mode()  # Actually execute the command
            return True
        
        # Exit programming mode
        elif cmd_high == 0x5A and cmd_low == 0xA5:
            print("FT260: EXIT_PRG command detected")
            self.in_programming_mode = False
            exit_prog_mode()  # Actually execute the command
            return True
        
        # MREG transfer - correct command is 0x04 0x7F (128 registers, 0x7F = 127 but 0-indexed)
        elif cmd_high == 0x04 and cmd_low == 0x7F:
            print("FT260: XFER_MREG command detected")
            self.expecting_data = "MREG"
            self.data_remaining = 514  # 512 bytes + 2 byte checksum
            # If there's payload data with the command, process it
            if len(payload_data) > 0:
                self.handle_programming_data(payload_data)
            return True
        
        # CREG transfer - must be exactly 0x01 0x0F
        elif cmd_high == 0x01 and cmd_low == 0x0F:
            print("FT260: XFER_CREG command detected")
            self.expecting_data = "CREG"
            self.data_remaining = 66   # 64 bytes + 2 byte checksum
            # If there's payload data with the command, process it
            if len(payload_data) > 0:
                self.handle_programming_data(payload_data)
            return True
        
        # SFR transfer - must be exactly 0x02 0x0B
        elif cmd_high == 0x02 and cmd_low == 0x0B:
            print("FT260: XFER_SFR command detected")
            self.expecting_data = "SFR"
            self.data_remaining = 52   # 50 bytes + 2 byte checksum
            # If there's payload data with the command, process it
            if len(payload_data) > 0:
                self.handle_programming_data(payload_data)
            return True
        
        # Program transfer - 0x08xx range (0x0800 + num_instructions - 1)
        elif cmd_high == 0x08 or (cmd_high == 0x09) or (cmd_high == 0x0A) or (cmd_high == 0x0B):
            # This covers the range 0x0800 to 0x0BFF which should handle most reasonable program sizes
            num_instructions = cmd - 0x0800 + 1
            num_bytes = num_instructions * 4  # Each instruction is 4 bytes
            print(f"FT260: XFER_PRG command detected for {num_instructions} instructions ({num_bytes} bytes)")
            self.expecting_data = "PROGRAM"
            self.data_remaining = num_bytes + 2  # program bytes + 2 byte checksum
            # If there's payload data with the command, process it
            if len(payload_data) > 0:
                self.handle_programming_data(payload_data)
            return True
        
        # Execute from RAM
        elif cmd_high == 0x0D and cmd_low == 0x00:
            print("FT260: EXEC_FROM_RAM command detected")
            self.execute_programming()
            return True
        
        # Write to flash
        elif cmd_high == 0x0C:
            location = cmd_low
            print(f"FT260: WRITE_PRG to location {location:X} command detected")
            self.execute_programming_to_flash(location)
            return True
        
        # Return to STATE0
        elif cmd_high == 0x0E and cmd_low == 0x00:
            print("FT260: RETURN_0 command detected")
            send_return_0()  # Actually execute the command
            return True
        
        return False  # Not a recognized command
    
    def handle_programming_data(self, data):
        """Handle programming data based on what we're expecting"""
        if not self.expecting_data:
            print("FT260: Received data but not expecting any")
            return
        
        bytes_to_take = min(len(data), self.data_remaining)
        
        if self.expecting_data == "MREG":
            self.mreg_data.extend(data[:bytes_to_take])
            print(f"FT260: Added {bytes_to_take} bytes to MREG buffer (total: {len(self.mreg_data)})")
        
        elif self.expecting_data == "CREG":
            self.creg_data.extend(data[:bytes_to_take])
            print(f"FT260: Added {bytes_to_take} bytes to CREG buffer (total: {len(self.creg_data)})")
        
        elif self.expecting_data == "SFR":
            self.sfr_data.extend(data[:bytes_to_take])
            print(f"FT260: Added {bytes_to_take} bytes to SFR buffer (total: {len(self.sfr_data)})")
        
        elif self.expecting_data == "PROGRAM":
            self.program_data.extend(data[:bytes_to_take])
            print(f"FT260: Added {bytes_to_take} bytes to PROGRAM buffer (total: {len(self.program_data)})")
        
        self.data_remaining -= bytes_to_take
        
        if self.data_remaining <= 0:
            if self.expecting_data == "MREG":
                total = len(self.mreg_data)
            elif self.expecting_data == "CREG":
                total = len(self.creg_data)
            elif self.expecting_data == "SFR":
                total = len(self.sfr_data)
            elif self.expecting_data == "PROGRAM":
                total = len(self.program_data)
            else:
                total = 0
            print(f"FT260: {self.expecting_data} data complete ({total} total bytes)")
            self.expecting_data = None
            self.data_remaining = 0
    
    def execute_programming(self):
        """Execute the collected programming data (RAM execution) - use same functions as file mode"""
        print("FT260: Starting programming execution...")
        print(f"Data collected - MREG: {len(self.mreg_data)}, CREG: {len(self.creg_data)}, SFR: {len(self.sfr_data)}, Program: {len(self.program_data)} bytes")
        
        # Set status to indicate programming
        blink_status_led(BLUE, 2)
        
        # Initial status check
        log_fxcore_status("Before FT260 programming")
        
        # Enter programming mode using the same function as file mode
        if not enter_prog_mode():
            print("FT260: Failed to enter programming mode")
            blink_status_led(RED, 5)
            return False
        
        success = True
        
        # Send CREG data if available - use exact same function as file mode
        if len(self.creg_data) >= 66:  # 64 data + 2 checksum
            creg_payload = self.creg_data[:64]
            creg_checksum = self.creg_data[64:66]
            print(f"FT260: Sending CREG data ({len(creg_payload)} bytes + checksum)")
            if not send_cregs(creg_payload, creg_checksum):
                success = False
            else:
                time.sleep(0.1)
        
        # Send MREG data if available - use exact same function as file mode  
        if success and len(self.mreg_data) >= 514:  # 512 data + 2 checksum
            mreg_payload = self.mreg_data[:512]
            mreg_checksum = self.mreg_data[512:514]
            print(f"FT260: Sending MREG data ({len(mreg_payload)} bytes + checksum)")
            if not send_mregs(mreg_payload, mreg_checksum):
                success = False
            else:
                time.sleep(0.1)
        elif len(self.mreg_data) > 0:
            print(f"FT260: Warning - MREG data incomplete: {len(self.mreg_data)} bytes (expected 514)")
        
        # Send SFR data if available - use exact same function as file mode
        if success and len(self.sfr_data) >= 50:  # At least 50 bytes
            sfr_payload = self.sfr_data[:50]
            print(f"FT260: Sending SFR data ({len(sfr_payload)} bytes)")
            if not send_sfrs(sfr_payload):
                success = False
            else:
                time.sleep(0.1)
        
        # Send program data if available - use exact same function as file mode
        if success and len(self.program_data) >= 2:  # At least checksum
            program_payload = self.program_data[:-2]  # Everything except checksum
            instructions = []
            # Convert to 32-bit instructions exactly like file mode
            for i in range(0, len(program_payload), 4):
                if i + 3 < len(program_payload):
                    instruction = (program_payload[i] |
                                 (program_payload[i+1] << 8) |
                                 (program_payload[i+2] << 16) |
                                 (program_payload[i+3] << 24))
                    instructions.append(instruction)
            
            print(f"FT260: Sending PROGRAM data ({len(instructions)} instructions, {len(self.program_data)} total bytes)")
            if not send_program_data(instructions, self.program_data):
                success = False
            else:
                time.sleep(0.1)
        
        if success:
            # Execute from RAM using the same function as file mode
            if execute_from_ram():
                set_status_led(RED)  # Indicate running
                print("FT260: ✓ Programming successful - running from RAM")
            else:
                success = False
        
        if not success:
            print("FT260: ✗ Programming failed")
            blink_status_led(RED, 5)
            send_return_0()
            exit_prog_mode()
        
        return success
    
    def execute_programming_to_flash(self, location):
        """Execute the collected programming data (Flash programming) - use same functions as file mode"""
        print(f"FT260: Starting flash programming to location {location:X}...")
        
        # Set status to indicate programming
        blink_status_led(PURPLE, 2)
        
        print(f"Data collected - MREG: {len(self.mreg_data)}, CREG: {len(self.creg_data)}, SFR: {len(self.sfr_data)}, Program: {len(self.program_data)} bytes")
        
        # Enter programming mode using the same function as file mode
        if not enter_prog_mode():
            print("FT260: Failed to enter programming mode")
            blink_status_led(RED, 5)
            return False
        
        success = True
        
        # Send data in the exact same order as file mode: CREG, MREG, SFR, PROGRAM
        
        # Send CREG data if available
        if len(self.creg_data) >= 66:
            creg_payload = self.creg_data[:64]
            creg_checksum = self.creg_data[64:66]
            if not send_cregs(creg_payload, creg_checksum):
                success = False
            else:
                time.sleep(0.1)
        
        # Send MREG data if available  
        if success and len(self.mreg_data) >= 514:
            mreg_payload = self.mreg_data[:512]
            mreg_checksum = self.mreg_data[512:514]
            if not send_mregs(mreg_payload, mreg_checksum):
                success = False
            else:
                time.sleep(0.1)
        
        # Send SFR data if available
        if success and len(self.sfr_data) >= 52:
            sfr_payload = self.sfr_data[:50]
            if not send_sfrs(sfr_payload):
                success = False
            else:
                time.sleep(0.1)
        
        # Send program data if available
        if success and len(self.program_data) >= 2:
            program_payload = self.program_data[:-2]
            instructions = []
            for i in range(0, len(program_payload), 4):
                if i + 3 < len(program_payload):
                    instruction = (program_payload[i] |
                                 (program_payload[i+1] << 8) |
                                 (program_payload[i+2] << 16) |
                                 (program_payload[i+3] << 24))
                    instructions.append(instruction)
            
            if not send_program_data(instructions, self.program_data):
                success = False
            else:
                time.sleep(0.1)
        
        if success:
            # Write to flash location using the same function as file mode
            if write_to_flash_location(location):
                set_status_led(GREEN)  # Indicate success
                print(f"FT260: ✓ Flash programming successful - location {location:X}")
                # Return to normal mode using same functions as file mode
                send_return_0()
                time.sleep(0.1)
                exit_prog_mode()
            else:
                success = False
                print(f"FT260: ✗ Flash write failed - location {location:X}")
                blink_status_led(RED, 5)
                send_return_0()
                exit_prog_mode()
        
        if not success:
            blink_status_led(RED, 5)
            send_return_0()
            exit_prog_mode()
        
        return success
    
    def handle_output_report_d0(self, data):
        """Handle Output Report 0xD0 - Intercept ALL D0 reports for smart programming"""
        if len(data) < 4:
            return
            
        i2c_addr = data[0]
        i2c_flag = data[1]  # I2C flags (not used currently but good to track)
        byte_count = data[2]  # Exact number of I2C payload bytes
        write_data = data[3:3+byte_count]  # Extract exactly the right amount of data
        
        print(f"FT260: D0 Report - I2C addr 0x{i2c_addr:02X}, flag 0x{i2c_flag:02X}, {byte_count} bytes")
        
        # Check if this is targeting the FXCore
        if i2c_addr == FXCORE_ADDRESS:
            # Try to handle as programming command/data
            if self.handle_programming_command(write_data, i2c_flag):
                # Successfully handled as programming command
                self.i2c_status = 0x20
                return
        
        # If not FXCore or not a programming command, pass through normally
        print(f"FT260: Pass-through I2C Write: 0x{i2c_addr:02X}, {byte_count} bytes - Data: {' '.join([f'0x{b:02X}' for b in write_data[:min(8, len(write_data))]])}{'...' if len(write_data) > 8 else ''}")
        
        try:
            while not i2c.try_lock():
                time.sleep(0.001)
            
            try:
                i2c.writeto(i2c_addr, bytes(write_data))
                self.i2c_status = 0x20  # Success
                print("FT260: ✓ Pass-through write successful")
                
            except OSError:
                self.i2c_status = 0x26  # Error
                print("FT260: ✗ Pass-through write failed")
            finally:
                i2c.unlock()
                
        except Exception:
            self.i2c_status = 0x26
            print("FT260: ✗ Pass-through write error")
            try:
                i2c.unlock()
            except:
                pass
    
    def process_reports(self):
        """Process incoming HID reports"""
        if not self.enabled:
            return False
            
        try:
            report_id, data = self.get_last_received_report()
            if report_id is not None:
                blink_status_led(YELLOW, 1, 0.005)
                
                if not self.active:
                    print("FT260: Smart bridge mode activated")
                    self.active = True
                
                # Route to appropriate handler
                if report_id == 0xA1:
                    # A1 reports pass through (status/control)
                    print("FT260: A1 report - resetting")
                    stop_execution()
                elif report_id == 0xC0:
                    # C0 reports pass through  
                    print("FT260: C0 report - passing through")
                elif report_id == 0xC2:
                    # C2 reports are I2C reads - pass through
                    self.handle_output_report_c2(data)
                elif report_id == 0xD0:
                    # D0 reports are I2C writes - intercept ALL of them
                    self.handle_output_report_d0(data)
                
                return True  # Processed a report
                
        except Exception as e:
            print(f"FT260: Error processing reports: {e}")
        
        return False  # No report processed
        
# Initialize FT260 Emulator
ft260 = SmartFT260Emulator()

def get_timestamp():
    """Get current timestamp for logging"""
    return f"T+{time.monotonic():.2f}s"

def log_message(message):
    """Log message to results.txt with timestamp"""
    log_entry = f"{message}"
    print(log_entry)

def read_fxcore_status():
    """Read the 12-byte status from FXCore and return parsed information"""
    try:
        while not i2c.try_lock():
            pass
        
        # Read 12 bytes of status
        status_bytes = bytearray(12)
        i2c.readfrom_into(FXCORE_ADDRESS, status_bytes)
        i2c.unlock()
        
        # Parse according to FXCore documentation:
        transfer_state = status_bytes[0]
        command_status = status_bytes[1]
        last_cmd_h = status_bytes[2]
        last_cmd_l = status_bytes[3]
        prog_slot_status = status_bytes[4] | (status_bytes[5] << 8)  # Little-endian
        device_id = status_bytes[6] | (status_bytes[7] << 8)        # Little-endian
        serial_num = (status_bytes[8] | (status_bytes[9] << 8) | 
                     (status_bytes[10] << 16) | (status_bytes[11] << 24))  # Little-endian
        
        status_info = {
            'transfer_state': transfer_state,
            'command_status': command_status,
            'last_command': (last_cmd_h << 8) | last_cmd_l,  # This stays big-endian per doc
            'program_slot_status': prog_slot_status,
            'device_id': device_id,
            'serial_number': serial_num,
            'program_received': bool(transfer_state & 0x10),
            'registers_received': bool(transfer_state & 0x08),
            'mregs_received': bool(transfer_state & 0x04),
            'sfrs_received': bool(transfer_state & 0x02),
            'cregs_received': bool(transfer_state & 0x01)
        }
        
        return status_info
        
    except Exception as e:
        log_message(f"Error reading FXCore status: {e}")
        try:
            i2c.unlock();
        except:
            pass
        return None

def log_fxcore_status(operation="Status Check"):
    """Read and log FXCore status"""
    status = read_fxcore_status()
    if status:
        # Check if we got all 0xFF (likely executing from RAM)
        if (status['transfer_state'] == 0xFF and 
            status['command_status'] == 0xFF and 
            status['device_id'] == 0xFFFF):
            log_message(f"{operation} - FXCore Status: EXECUTING FROM RAM (no status available)")
            return status
            
        log_message(f"{operation} - FXCore Status:")
        log_message(f"  Transfer State: 0x{status['transfer_state']:02X}")
        log_message(f"  Command Status: 0x{status['command_status']:02X}")
        log_message(f"  Last Command: 0x{status['last_command']:04X}")
        log_message(f"  Program Slots: 0x{status['program_slot_status']:04X}")
        log_message(f"  Device ID: 0x{status['device_id']:04X}")
        log_message(f"  Serial Number: {status['serial_number']} (0x{status['serial_number']:08X})")
    
    return status

def find_location_hex_files():
    """Find hex files named 0.hex through F.hex for location programming"""
    location_files = {}
    valid_names = [f"{i:X}.hex" for i in range(16)]  # 0.hex through F.hex
    
    try:
        files = os.listdir()
        for filename in files:
            if filename.upper() in [name.upper() for name in valid_names]:
                # Get the location number (0-F)
                location = filename.upper().split('.')[0]
                try:
                    location_num = int(location, 16)
                    # Check if file has content
                    try:
                        with open(filename, 'r') as f:
                            content = f.read().strip()
                            if len(content) > 0:
                                location_files[location_num] = filename
                    except:
                        pass
                except ValueError:
                    pass
    except:
        pass
    
    return location_files

def check_output_hex_exists():
    """Check if output.hex exists and has content"""
    try:
        if "output.hex" in os.listdir():
            try:
                with open("output.hex", 'r') as f:
                    content = f.read().strip()
                    return len(content) > 0
            except:
                return False
        return False
    except:
        return False

def set_status_led(color):
    """Set the status LED color"""
    pixel[0] = color

def blink_status_led(color, count=3, duration=0.2):
    """Blink the status LED"""
    for _ in range(count):
        pixel[0] = color
        time.sleep(duration)
        pixel[0] = OFF
        time.sleep(duration)

def calculate_checksum(data):
    """Calculate simple sum checksum of all bytes"""
    return sum(data) & 0xFFFF

def enter_prog_mode():
    """Enter programming mode on the FXCore"""
    try:
        while not i2c.try_lock():
            pass
        
        command = bytes([0xA5, 0x5A, FXCORE_ADDRESS])
        i2c.writeto(FXCORE_ADDRESS, command)
        log_message("Entered programming mode")
        
        i2c.unlock()
        time.sleep(0.1)
        log_fxcore_status("After ENTER_PRG")
        return True
        
    except OSError as e:
        log_message(f"Error entering PROG mode: {e}")
        try:
            i2c.unlock();
        except:
            pass
        return False

def exit_prog_mode():
    """Exit programming mode and return to RUN mode"""
    try:
        while not i2c.try_lock():
            pass
        
        command = bytes([0x5A, 0xA5])
        i2c.writeto(FXCORE_ADDRESS, command)
        log_message("Exited programming mode - returned to RUN mode")
        
        i2c.unlock()
        time.sleep(0.1)
        log_fxcore_status("After EXIT_PRG")
        return True
        
    except OSError as e:
        log_message(f"Error exiting PROG mode: {e}")
        try:
            i2c.unlock();
        except:
            pass
        return False

def verify_hex_checksum(record_bytes):
    """Verify Intel HEX record checksum"""
    total_sum = sum(record_bytes) & 0xFF
    return total_sum == 0

def read_fxcore_hex_file(filename):
    """Read and parse FXCore hex file using Intel HEX format"""
    try:
        with open(filename, 'r') as f:
            lines = f.readlines()
        
        all_data = {}
        log_message(f"Parsing Intel HEX records from {filename}...")
        
        for line_num, line in enumerate(lines, 1):
            line = line.strip()
            if not line.startswith(':'):
                continue
                
            if len(line) < 11:
                log_message(f"Line {line_num}: Record too short, skipping")
                continue
                
            try:
                byte_count = int(line[1:3], 16)
                address = int(line[3:7], 16) 
                record_type = int(line[7:9], 16)
                
                expected_length = 11 + (byte_count * 2)
                if len(line) != expected_length:
                    log_message(f"Line {line_num}: Length mismatch, expected {expected_length}, got {len(line)}")
                    continue
                
                record_bytes = []
                for i in range(1, len(line), 2):
                    record_bytes.append(int(line[i:i+2], 16))
                
                if not verify_hex_checksum(record_bytes):
                    log_message(f"Line {line_num}: Checksum error!")
                    continue
                
                if record_type == 0x00:  # Data record
                    data_bytes = []
                    for i in range(byte_count):
                        data_pos = 9 + (i * 2)
                        data_byte = int(line[data_pos:data_pos+2], 16)
                        data_bytes.append(data_byte)
                        all_data[address + i] = data_byte
                    
                elif record_type == 0x01:  # End of file
                    log_message(f"Line {line_num}: End of file record")
                    break
                    
            except ValueError as e:
                log_message(f"Line {line_num}: Parse error - {e}")
                continue
        
        # Extract data arrays by address ranges
        # MREG data: 0x0000 - 0x07FF
        mreg_addresses = [addr for addr in all_data.keys() if 0x0000 <= addr <= 0x07FF]
        mreg_addresses.sort()
        mreg_data = bytearray()
        if mreg_addresses:
            for addr in range(min(mreg_addresses), max(mreg_addresses) + 1):
                if addr in all_data:
                    mreg_data.append(all_data[addr])
                else:
                    mreg_data.append(0x00)
        
        # CREG data: 0x0800 - 0x0FFF  
        creg_addresses = [addr for addr in all_data.keys() if 0x0800 <= addr <= 0x0FFF]
        creg_addresses.sort()
        creg_data = bytearray()
        if creg_addresses:
            for addr in range(min(creg_addresses), max(creg_addresses) + 1):
                if addr in all_data:
                    creg_data.append(all_data[addr])
                else:
                    creg_data.append(0x00)
        
        # SFR data: 0x1000 - 0x17FF
        sfr_addresses = [addr for addr in all_data.keys() if 0x1000 <= addr <= 0x17FF]
        sfr_addresses.sort()
        sfr_data = bytearray()
        if sfr_addresses:
            for addr in range(min(sfr_addresses), max(sfr_addresses) + 1):
                if addr in all_data:
                    sfr_data.append(all_data[addr])
                else:
                    sfr_data.append(0x00)
        
        # Program data: 0x1800 and above
        prog_addresses = [addr for addr in all_data.keys() if addr >= 0x1800]
        prog_addresses.sort()
        prog_data = bytearray()
        if prog_addresses:
            for addr in range(min(prog_addresses), max(prog_addresses) + 1):
                if addr in all_data:
                    prog_data.append(all_data[addr])
                else:
                    prog_data.append(0x00)
        
        log_message(f"Extracted arrays: MREG={len(mreg_data)}, CREG={len(creg_data)}, "
                   f"SFR={len(sfr_data)}, PROGRAM={len(prog_data)} bytes")
        
        # Convert program data to 32-bit instructions
        instruction_bytes = len(prog_data) - 2 if len(prog_data) >= 2 else len(prog_data)
        instructions = []
        for i in range(0, instruction_bytes, 4):
            if i + 3 < instruction_bytes:
                instruction = (prog_data[i] |
                             (prog_data[i+1] << 8) |
                             (prog_data[i+2] << 16) |
                             (prog_data[i+3] << 24))
                instructions.append(instruction)
        
        log_message(f"Program contains {len(instructions)} instructions")
        
        return {
            'cregs': creg_data,
            'mregs': mreg_data,
            'sfrs': sfr_data, 
            'instructions': instructions,
            'program_data': prog_data,
            'mreg_checksum': bytearray([0, 0]),
            'creg_checksum': bytearray([0, 0])
        }
        
    except Exception as e:
        log_message(f"Error reading hex file {filename}: {e}")
        return None

def send_i2c_data(data, description):
    """Send data over I2C as a single transfer"""
    try:
        while not i2c.try_lock():
            pass
        
        try:
            i2c.writeto(FXCORE_ADDRESS, data)
            i2c.unlock()
            log_message(f"Sent {len(data)} bytes of {description} in single transfer")
            return True
        except OSError as e:
            log_message(f"Single transfer failed ({e}), trying chunked transfer...")
            chunk_size = 32
            for i in range(0, len(data), chunk_size):
                chunk = data[i:i + chunk_size]
                i2c.writeto(FXCORE_ADDRESS, chunk)
                time.sleep(0.01)
            
            i2c.unlock()
            log_message(f"Sent {len(data)} bytes of {description} in {(len(data) + chunk_size - 1) // chunk_size} chunks")
            return True
        
    except OSError as e:
        log_message(f"Error sending {description}: {e}")
        try:
            i2c.unlock();
        except:
            pass
        return False

def send_command(cmd_bytes, description):
    """Send a command to FXCore"""
    try:
        while not i2c.try_lock():
            pass
        
        command = bytes(cmd_bytes)
        i2c.writeto(FXCORE_ADDRESS, command)
        hex_bytes = [f'0x{b:02X}' for b in cmd_bytes]
        log_message(f"Sent {description} command: {' '.join(hex_bytes)}")
        
        i2c.unlock()
        time.sleep(0.01)
        return True
        
    except OSError as e:
        log_message(f"Error sending {description} command: {e}")
        try:
            i2c.unlock();
        except:
            pass
        return False

def send_cregs(cregs, original_checksum):
    """Send CREG data to FXCore"""
    if not send_command([0x01, 0x0F], "XFER_CREG"):
        return False
    
    creg_data = bytearray(cregs)
    if len(creg_data) < 64:
        creg_data.extend(bytearray(64 - len(creg_data)))
    elif len(creg_data) > 64:
        creg_data = creg_data[:64]
    
    if len(original_checksum) == 2 and (original_checksum[0] != 0 or original_checksum[1] != 0):
        data_with_checksum = creg_data + bytearray(original_checksum)
    else:
        checksum = calculate_checksum(creg_data)
        data_with_checksum = creg_data
        data_with_checksum.append(checksum & 0xFF)
        data_with_checksum.append((checksum >> 8) & 0xFF)
    
    success = send_i2c_data(data_with_checksum, f"CREG data ({len(data_with_checksum)} bytes)")
    if success:
        log_fxcore_status("After CREG transfer")
    return success

def send_mregs(mregs, original_checksum):
    """Send MREG data to FXCore"""
    if not send_command([0x04, 0x7F], "XFER_MREG"):
        return False
    
    mreg_data = bytearray(mregs)
    if len(mreg_data) < 512:
        mreg_data.extend(bytearray(512 - len(mreg_data)))
    elif len(mreg_data) > 512:
        mreg_data = mreg_data[:512]
    
    if len(original_checksum) == 2 and (original_checksum[0] != 0 or original_checksum[1] != 0):
        data_with_checksum = mreg_data + bytearray(original_checksum)
    else:
        checksum = calculate_checksum(mreg_data)
        data_with_checksum = mreg_data
        data_with_checksum.append(checksum & 0xFF)
        data_with_checksum.append((checksum >> 8) & 0xFF)
    
    success = send_i2c_data(data_with_checksum, f"MREG data ({len(data_with_checksum)} bytes)")
    if success:
        log_fxcore_status("After MREG transfer")
    return success

def send_sfrs(sfrs):
    """Send SFR data to FXCore"""
    if not send_command([0x02, 0x0B], "XFER_SFR"):
        return False
    
    sfr_data = bytearray(sfrs)
    if len(sfr_data) < 50:
        sfr_data.extend(bytearray(50 - len(sfr_data)))
    elif len(sfr_data) > 50:
        sfr_data = sfr_data[:50]
    
    checksum = calculate_checksum(sfr_data)
    data_with_checksum = sfr_data
    data_with_checksum.append(checksum & 0xFF)
    data_with_checksum.append((checksum >> 8) & 0xFF)
    
    success = send_i2c_data(data_with_checksum, f"SFR data ({len(data_with_checksum)} bytes)")
    if success:
        log_fxcore_status("After SFR transfer")
    return success

def send_program_data(instructions, program_data):
    """Send program data to FXCore"""
    if len(instructions) == 0:
        log_message("No program instructions to send")
        return False
        
    num_instructions = len(instructions)
    cmd_value = 0x0800 + (num_instructions - 1)
    cmd_high = (cmd_value >> 8) & 0xFF
    cmd_low = cmd_value & 0xFF
    
    if not send_command([cmd_high, cmd_low], f"XFER_PRG (0x{cmd_value:04X} for {num_instructions} instructions)"):
        return False
    
    if isinstance(program_data, bytearray) and len(program_data) > len(instructions) * 4:
        success = send_i2c_data(program_data, f"program data ({len(program_data)} bytes including checksum)")
    else:
        program_bytes = bytearray()
        for instruction in instructions:
            program_bytes.append(instruction & 0xFF)
            program_bytes.append((instruction >> 8) & 0xFF)
            program_bytes.append((instruction >> 16) & 0xFF)
            program_bytes.append((instruction >> 24) & 0xFF)
        
        checksum = calculate_checksum(program_bytes)
        program_bytes.append(checksum & 0xFF)
        program_bytes.append((checksum >> 8) & 0xFF)
        
        success = send_i2c_data(program_bytes, f"program data ({len(program_bytes)} bytes with calculated checksum)")
    
    if success:
        log_fxcore_status("After PROGRAM transfer")
    return success

def execute_from_ram():
    """Execute the program from RAM"""
    success = send_command([0x0D, 0x00], "EXEC_FROM_RAM")
    if success:
        log_fxcore_status("After EXEC_FROM_RAM")
    return success

def write_to_flash_location(location):
    """Write the program to a specific flash location (0-15)"""
    if location < 0 or location > 15:
        log_message(f"Invalid flash location: {location}")
        return False
    
    success = send_command([0x0C, location], f"WRITE_PRG to location {location:X}")
    if success:
        log_message(f"Writing to FLASH location {location:X}, waiting 200ms...")
        time.sleep(0.2)  # Wait for FLASH write to complete
        log_fxcore_status(f"After WRITE_PRG to location {location:X}")
    return success

def send_return_0():
    """Send RETURN_0 command to stop execution and return to STATE0"""
    success = send_command([0x0E, 0x00], "RETURN_0")
    if success:
        log_fxcore_status("After RETURN_0")
    return success

def program_location(location, filename):
    """Program a specific location with a hex file"""
    log_message(f"Starting location programming: {filename} -> Location {location:X}")
    
    # Indicate starting programming process
    blink_status_led(PURPLE, 2)
    
    # Initial status check
    log_fxcore_status("Initial state")
    
    # Wait for FXCore to settle
    log_message("Waiting for FXCore to settle...")
    time.sleep(0.5)
    
    # Read and parse hex file
    log_message(f"Reading and parsing hex file: {filename}")
    fx_data = read_fxcore_hex_file(filename)
    if not fx_data:
        log_message("Failed to read hex file")
        blink_status_led(RED, 5)
        return False
    
    # Enter programming mode
    log_message("Entering programming mode...")
    if not enter_prog_mode():
        log_message("Failed to enter programming mode")
        blink_status_led(RED, 5)
        return False
    
    time.sleep(0.1)
    
    # Send data in the correct order
    success = True
    
    # Send CREGs
    if success and len(fx_data['cregs']) > 0:
        log_message("Uploading CREG data...")
        if not send_cregs(fx_data['cregs'], fx_data.get('creg_checksum', bytearray())):
            success = False
        else:
            time.sleep(0.1)
    
    # Send MREGs
    if success and len(fx_data['mregs']) > 0:
        log_message("Uploading MREG data...")
        if not send_mregs(fx_data['mregs'], fx_data.get('mreg_checksum', bytearray())):
            success = False
        else:
            time.sleep(0.1)
    
    # Send SFRs
    if success and len(fx_data['sfrs']) > 0:
        log_message("Uploading SFR data...")
        if not send_sfrs(fx_data['sfrs']):
            success = False
        else:
            time.sleep(0.1)
    
    # Send program (must be last)
    if success:
        log_message("Uploading program data...")
        program_data = fx_data.get('program_data', bytearray())
        if not send_program_data(fx_data['instructions'], program_data):
            success = False
        else:
            time.sleep(0.1)
    
    if not success:
        log_message("Failed to upload complete program data")
        blink_status_led(RED, 5)
        send_return_0()
        exit_prog_mode()
        return False
    
    # Write to FLASH location
    log_message(f"Writing program to FLASH location {location:X}...")
    if not write_to_flash_location(location):
        log_message("Failed to write to FLASH")
        blink_status_led(RED, 5)
        send_return_0()
        exit_prog_mode()
        return False
    
    # Return to STATE0 and exit programming mode
    send_return_0()
    time.sleep(0.1)
    exit_prog_mode()
    
    # Success - indicate with solid green LED
    set_status_led(GREEN)
    
    log_message(f"SUCCESS: Program from {filename} written to FLASH location {location:X}")
    log_message("Programming complete. FXCore returned to RUN mode.")
    
    return True

def run_ram_execution(filename="output.hex"):
    """Run the complete upload and execution process for RAM execution"""
    log_message(f"Starting RAM execution: {filename}")
    
    # Indicate starting upload process
    blink_status_led(BLUE, 2)
    
    # Initial status check
    log_fxcore_status("Initial state")
    
    # Wait for FXCore to settle
    log_message("Waiting for FXCore to settle...")
    time.sleep(0.5)
    
    # Read and parse hex file
    log_message(f"Reading and parsing hex file: {filename}")
    fx_data = read_fxcore_hex_file(filename)
    if not fx_data:
        log_message("Failed to read hex file")
        blink_status_led(RED, 5)
        return False
    
    # Enter programming mode
    log_message("Entering programming mode...")
    if not enter_prog_mode():
        log_message("Failed to enter programming mode")
        blink_status_led(RED, 5)
        return False
    
    time.sleep(0.1)
    
    # Send data in the correct order
    success = True
    
    # Send CREGs
    if success:
        log_message("Uploading CREG data...")
        if not send_cregs(fx_data['cregs'], fx_data.get('creg_checksum', bytearray())):
            success = False
        else:
            time.sleep(0.1)
    
    # Send MREGs
    if success:
        log_message("Uploading MREG data...")
        if not send_mregs(fx_data['mregs'], fx_data.get('mreg_checksum', bytearray())):
            success = False
        else:
            time.sleep(0.1)
    
    # Send SFRs
    if success:
        log_message("Uploading SFR data...")
        if not send_sfrs(fx_data['sfrs']):
            success = False
        else:
            time.sleep(0.1)
    
    # Send program (must be last)
    if success:
        log_message("Uploading program data...")
        program_data = fx_data.get('program_data', bytearray())
        if not send_program_data(fx_data['instructions'], program_data):
            success = False
        else:
            time.sleep(0.1)
    
    if not success:
        log_message("Failed to upload complete program data")
        blink_status_led(RED, 5)
        send_return_0()
        exit_prog_mode()
        return False
    
    # Execute from RAM
    log_message("Starting program execution from RAM...")
    if not execute_from_ram():
        log_message("Failed to execute program")
        blink_status_led(RED, 5)
        send_return_0()
        exit_prog_mode()
        return False
    
    # Success - indicate running state with solid red LED
    set_status_led(RED)
    
    log_message("SUCCESS: Program is running from RAM")
    log_message("RED LED indicates program is running from RAM")
    log_message("CLEAR HARDWARE to stop execution and return to normal operation")
    
    return True

def stop_execution():
    """Stop program execution and return to normal operation"""
    log_message("Stopping program execution...")
    
    # Send RETURN_0 to stop execution
    send_return_0()
    time.sleep(0.1)
    
    # Exit programming mode
    exit_prog_mode()
    
    # Turn off LED
    set_status_led(OFF)
    
    log_message("Program stopped and returned to normal operation")

def main():
    print("FXCore Enhanced Hex Programmer with FT260 Emulation")
    print("===================================================")
    print("- NeoPixel on GP16 shows status:")
    print("  * RED = Program running from RAM")
    print("  * GREEN = Location programming successful")
    print("  * PURPLE = Location programming in progress") 
    print("  * BLUE = RAM upload in progress")
    print("  * OFF = Normal operation")
    print("- Place output.hex for RAM execution")
    print("- Place 0.hex through F.hex for location programming")
    print("- FT260 USB-I2C Bridge emulation available")
    print()
    
    # Turn off LED initially
    set_status_led(OFF)
    
    running = False
    
    # Always return to STATE0 on boot
    print("Ensuring STATE0 on startup...")
    stop_execution()
    time.sleep(0.1)
    
    # Check for location-specific hex files (0.hex through F.hex) at boot
    location_files = find_location_hex_files()
    
    # Process any location files found at boot
    if location_files:
        for location, filename in location_files.items():
            log_message(f"Boot-time location file detected: {filename} for location {location:X}")
            print(f"Found {filename} - programming location {location:X}...")
            
            if program_location(location, filename):
                print(f"Successfully programmed location {location:X}")
                # Keep green LED on for a few seconds to show success
                time.sleep(3)
            else:
                print(f"Failed to program location {location:X}")
                # Keep red LED on for a few seconds to show failure
                time.sleep(3)
            
            # Return LED to off state after programming
            set_status_led(OFF)
    
    # Check for output.hex (RAM execution) at boot
    output_hex_exists = check_output_hex_exists()
    if output_hex_exists:
        print("output.hex found at boot - starting RAM execution...")
        if run_ram_execution():
            running = True
    
    while True:
        try:
            # Process FT260 emulation (always process)
            ft260_processed = ft260.process_reports()
            
            # Handle RAM execution LED blinking if running
            if running:
                # Still running - blink red LED
                current_color = pixel[0]
                if current_color == RED:
                    set_status_led((128, 0, 0))  # Dimmer red
                else:
                    set_status_led(RED)  # Full red
                time.sleep(0.5)
            else:
                # Not running - minimal delay for FT260 processing
                time.sleep(0.001)
                
        except KeyboardInterrupt:
            log_message("Program interrupted by user")
            break
        except Exception as e:
            log_message(f"Unexpected error in main loop: {e}")
            set_status_led(OFF)
            time.sleep(2)

# Run the main function
if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nProgram interrupted")
        log_message("Program terminated by user")
        stop_execution()
        if 'i2c' in globals():
            i2c.deinit()
        print("I2C bus released")
    except Exception as e:
        set_status_led(OFF)
        log_message(f"Fatal error: {e}")
        print(f"Fatal error: {e}")
        if 'i2c' in globals():
            i2c.deinit()