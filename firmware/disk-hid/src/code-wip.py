# FXCore Hex File Uploader with FT260 Emulation
# Version 4.4
# Date: 2025-08-20
# unifed buffer and programming functions
# fixed issue with LED state in HID mode

import board
import busio
import time
import neopixel
import os
import usb_hid
import digitalio

# DEBUG FLAG - Set to True to enable detailed debug output
DEBUG_MODE = True

# are we running from RAM?
running = False

# unified buffer for both HID and File mode
class BufferManager:
    def __init__(self):
        # Pre-allocated reusable buffers - sized for max 1024 instructions
        self.i2c_buffer = bytearray(4098)  # 1024 instructions * 4 bytes + 2 checksum = 4098 bytes
        self.status_buffer = bytearray(12)  # For status reads
        self.temp_buffer = bytearray(64)   # For small operations
        self.hex_line_buffer = bytearray(50)  # For hex parsing
    
    def get_i2c_buffer(self, size):
        """Get a view of the I2C buffer for the requested size"""
        if size <= len(self.i2c_buffer):
            # Clear only the portion we'll use
            for i in range(size):
                self.i2c_buffer[i] = 0
            return memoryview(self.i2c_buffer[:size])
        # Fallback for oversized requests
        return bytearray(size)
    
    def get_status_buffer(self):
        """Get pre-allocated status buffer"""
        return self.status_buffer
    
    def get_temp_buffer(self, size):
        """Get temporary buffer for small operations"""
        if size <= len(self.temp_buffer):
            return memoryview(self.temp_buffer[:size])
        return bytearray(size)

# Initialize buffer manager
buffer_mgr = BufferManager()

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

def get_timestamp():
    """Get current timestamp for logging"""
    return f"T+{time.monotonic():.2f}s"

def log_message(message):
    """Log message - always prints to console"""
    print(message)

def debug_message(message):
    """Debug message - only prints if DEBUG_MODE is True"""
    if DEBUG_MODE:
        print(f"DEBUG: {message}")

def error_message(message):
    """Error message - always prints to console with ERROR prefix"""
    print(f"ERROR: {message}")

# Initialize I2C bus on GP0 (SDA) and GP1 (SCL)
try:
    i2c = busio.I2C(scl=board.GP1, sda=board.GP0)
    log_message("I2C bus initialized on GP0 (SDA) and GP1 (SCL)")
    log_message("NeoPixel initialized on GP16")
    pixel[0] = OFF  # Start with LED off
except Exception as e:
    error_message(f"Error initializing I2C or NeoPixel: {e}")
    while True:
        time.sleep(1)

def is_executing_from_ram(status_info):
    """
    Detect if FXCore is executing from RAM based on status patterns.
    When executing from RAM, status registers often return garbage/undefined values.
    """
    if not status_info:
        return False
    
    # Check for common garbage patterns
    transfer_state = status_info['transfer_state']
    command_status = status_info['command_status']
    device_id = status_info['device_id']
    
    # Pattern 1: All 0xFF (floating high)
    if (transfer_state == 0xFF and command_status == 0xFF and device_id == 0xFFFF):
        return True
    
    # Pattern 2: All 0x00 (floating low)
    if (transfer_state == 0x00 and command_status == 0x00 and device_id == 0x0000):
        return True
    
    # Pattern 3: Repeating patterns that indicate no valid communication
    if (transfer_state == command_status and 
        command_status == (device_id & 0xFF) and 
        transfer_state != 0x20):  # 0x20 is a valid idle state
        return True
    
    # Pattern 4: Device ID is clearly invalid for FXCore
    if device_id == 0xFFFF or device_id == 0x0000:
        return True
    
    return False

def read_fxcore_status():
    """Read the 12-byte status from FXCore and return parsed information"""
    try:
        while not i2c.try_lock():
            pass
        
        # Use pre-allocated buffer instead of creating new one
        status_bytes = buffer_mgr.get_status_buffer()
        i2c.readfrom_into(FXCORE_ADDRESS, status_bytes)
        i2c.unlock()
        
        # Parse according to FXCore documentation:
        transfer_state = status_bytes[0]
        command_status = status_bytes[1]
        last_cmd_h = status_bytes[2]
        last_cmd_l = status_bytes[3]
        prog_slot_status = status_bytes[4] | (status_bytes[5] << 8)
        device_id = status_bytes[6] | (status_bytes[7] << 8)
        serial_num = (status_bytes[8] | (status_bytes[9] << 8) | 
                     (status_bytes[10] << 16) | (status_bytes[11] << 24))
        
        status_info = {
            'transfer_state': transfer_state,
            'command_status': command_status,
            'last_command': (last_cmd_h << 8) | last_cmd_l,
            'program_slot_status': prog_slot_status,
            'device_id': device_id,
            'serial_number': serial_num,
            'program_received': bool(transfer_state & 0x10),
            'registers_received': bool(transfer_state & 0x08),
            'mregs_received': bool(transfer_state & 0x04),
            'sfrs_received': bool(transfer_state & 0x02),
            'cregs_received': bool(transfer_state & 0x01)
        }
        
        # Add RAM execution detection
        status_info['is_executing_from_ram'] = is_executing_from_ram(status_info)
        
        return status_info
        
    except Exception as e:
        error_message(f"Error reading FXCore status: {e}")
        try:
            i2c.unlock();
        except:
            pass
        return None

def log_fxcore_status(operation="Status Check"):
    """Read and log FXCore status with improved RAM execution detection"""
    status = read_fxcore_status()
    if status:
        # Check if executing from RAM using the improved detection
        if status.get('is_executing_from_ram', False):
            debug_message(f"{operation} - FXCore Status: EXECUTING FROM RAM (status registers contain garbage)")
            return status
            
        debug_message(f"{operation} - FXCore Status:")
        debug_message(f"  Transfer State: 0x{status['transfer_state']:02X}")
        debug_message(f"  Command Status: 0x{status['command_status']:02X}")
        debug_message(f"  Last Command: 0x{status['last_command']:04X}")
        debug_message(f"  Program Slots: 0x{status['program_slot_status']:04X}")
        debug_message(f"  Device ID: 0x{status['device_id']:04X}")
        debug_message(f"  Serial Number: {status['serial_number']} (0x{status['serial_number']:08X})")
    
    return status

def find_valid_hex_files():
    """
    Find and validate all hex files (output.hex and location files 0.hex-F.hex)
    Returns: (output_hex_valid, location_files_dict)
    """
    location_files = {}
    output_hex_valid = False
    valid_names = [f"{i:X}.hex" for i in range(16)]  # 0.hex through F.hex
    
    try:
        files = os.listdir()
        
        for filename in files:
            # Check for output.hex
            if filename == "output.hex":
                try:
                    with open(filename, 'r') as f:
                        content = f.read().strip()
                        if len(content) == 0:
                            log_message("output.hex was found, zero bytes, skipping")
                        elif not content.startswith(':'):
                            error_message("Invalid hex file found: output.hex")
                        else:
                            output_hex_valid = True
                except:
                    pass
            
            # Check for location files (0.hex through F.hex)
            elif filename.upper() in [name.upper() for name in valid_names]:
                location = filename.upper().split('.')[0]
                try:
                    location_num = int(location, 16)
                    try:
                        with open(filename, 'r') as f:
                            content = f.read().strip()
                            if len(content) == 0:
                                log_message(f"{filename} was found, zero bytes, skipping")
                            elif not content.startswith(':'):
                                error_message(f"Invalid hex file found: {filename}")
                            else:
                                location_files[location_num] = filename
                    except:
                        pass
                except ValueError:
                    pass
    except:
        pass
    
    return output_hex_valid, location_files


def set_status_led(color):
    """Set the status LED color"""
    pixel[0] = color

def blink_status_led(color, count=3, duration=0.01):
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
        debug_message("Entered programming mode")
        
        i2c.unlock()
        time.sleep(0.1)
        # log_fxcore_status("After ENTER_PRG")
        return True
        
    except OSError as e:
        error_message(f"Error entering PROG mode: {e}")
        try:
            i2c.unlock();
        except:
            pass
        return False

def exit_prog_mode():
    global running
    """Exit programming mode and return to RUN mode"""
    try:
        while not i2c.try_lock():
            pass
        
        command = bytes([0x5A, 0xA5])
        i2c.writeto(FXCORE_ADDRESS, command)
        debug_message("Exited programming mode - returned to RUN mode")

        running = False
        
        i2c.unlock()
        time.sleep(0.1)
        # log_fxcore_status("After EXIT_PRG")
        return True
        
    except OSError as e:
        error_message(f"Error exiting PROG mode: {e}")
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
    """Read and parse FXCore hex file using Intel HEX format with minimal memory usage"""
    try:
        with open(filename, 'r') as f:
            content = f.read().strip()
        
        # Check for zero-byte file
        if len(content) == 0:
            log_message(f"{filename} was found, zero bytes, skipping")
            return None
        
        # Check for basic hex file format
        if not content.startswith(':'):
            error_message(f"Invalid hex file found: {filename}")
            return None
        
        # Continue with existing parsing...
        lines = content.split('\n')
        
        # Instead of storing every byte in a dictionary, collect by ranges
        mreg_data = bytearray()
        creg_data = bytearray()
        sfr_data = bytearray()
        prog_data = bytearray()
        
        debug_message(f"Parsing Intel HEX records from {filename}...")
        
        for line_num, line in enumerate(lines, 1):
            line = line.strip()
            if not line.startswith(':'):
                continue
                
            if len(line) < 11:
                debug_message(f"Line {line_num}: Record too short, skipping")
                continue
                
            try:
                byte_count = int(line[1:3], 16)
                address = int(line[3:7], 16) 
                record_type = int(line[7:9], 16)
                
                expected_length = 11 + (byte_count * 2)
                if len(line) != expected_length:
                    debug_message(f"Line {line_num}: Length mismatch, expected {expected_length}, got {len(line)}")
                    continue
                
                record_bytes = []
                for i in range(1, len(line), 2):
                    record_bytes.append(int(line[i:i+2], 16))
                
                if not verify_hex_checksum(record_bytes):
                    error_message(f"Line {line_num}: Checksum error!")
                    continue
                
                if record_type == 0x00:  # Data record
                    # Extract data bytes
                    data_bytes = []
                    for i in range(byte_count):
                        data_pos = 9 + (i * 2)
                        data_byte = int(line[data_pos:data_pos+2], 16)
                        data_bytes.append(data_byte)
                    
                    # Sort data directly into appropriate arrays based on address
                    if 0x0000 <= address <= 0x07FF:
                        # MREG data - extend array if needed
                        while len(mreg_data) < (address - 0x0000) + len(data_bytes):
                            mreg_data.append(0x00)
                        for i, byte_val in enumerate(data_bytes):
                            mreg_data[address - 0x0000 + i] = byte_val
                            
                    elif 0x0800 <= address <= 0x0FFF:
                        # CREG data
                        while len(creg_data) < (address - 0x0800) + len(data_bytes):
                            creg_data.append(0x00)
                        for i, byte_val in enumerate(data_bytes):
                            creg_data[address - 0x0800 + i] = byte_val
                            
                    elif 0x1000 <= address <= 0x17FF:
                        # SFR data
                        while len(sfr_data) < (address - 0x1000) + len(data_bytes):
                            sfr_data.append(0x00)
                        for i, byte_val in enumerate(data_bytes):
                            sfr_data[address - 0x1000 + i] = byte_val
                            
                    elif address >= 0x1800:
                        # Program data - just append, we'll handle sparse addresses later
                        # Calculate offset from start of program area
                        prog_offset = address - 0x1800
                        while len(prog_data) < prog_offset + len(data_bytes):
                            prog_data.append(0x00)
                        for i, byte_val in enumerate(data_bytes):
                            prog_data[prog_offset + i] = byte_val
                    
                elif record_type == 0x01:  # End of file
                    debug_message(f"Line {line_num}: End of file record")
                    break
                    
            except ValueError as e:
                error_message(f"Line {line_num}: Parse error - {e}")
                continue
            except MemoryError as e:
                error_message(f"Line {line_num}: Memory error - hex file too large")
                return None

        debug_message(f"Extracted arrays: MREG={len(mreg_data)}, CREG={len(creg_data)}, "
                   f"SFR={len(sfr_data)}, PROGRAM={len(prog_data)} bytes")
        
        # Convert program data to 32-bit instructions - be more careful about size
        if len(prog_data) >= 2:
            # Reserve last 2 bytes for checksum
            instruction_bytes = len(prog_data) - 2
        else:
            instruction_bytes = len(prog_data)
            
        instructions = []
        for i in range(0, instruction_bytes, 4):
            if i + 3 < instruction_bytes:
                instruction = (prog_data[i] |
                             (prog_data[i+1] << 8) |
                             (prog_data[i+2] << 16) |
                             (prog_data[i+3] << 24))
                instructions.append(instruction)
        
        debug_message(f"Program contains {len(instructions)} instructions")
        
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
        error_message(f"Error reading hex file {filename}: {e}")
        return None

def send_i2c_data(data, description):
    """Send data over I2C as a single transfer"""
    try:
        while not i2c.try_lock():
            pass
        
        try:
            i2c.writeto(FXCORE_ADDRESS, data)
            i2c.unlock()
            debug_message(f"Sent {len(data)} bytes of {description} in single transfer")
            return True
        except OSError as e:
            debug_message(f"Single transfer failed ({e}), trying chunked transfer...")
            chunk_size = 32
            for i in range(0, len(data), chunk_size):
                chunk = data[i:i + chunk_size]
                i2c.writeto(FXCORE_ADDRESS, chunk)
                time.sleep(0.005) # was 0.01
            
            i2c.unlock()
            debug_message(f"Sent {len(data)} bytes of {description} in {(len(data) + chunk_size - 1) // chunk_size} chunks")
            return True
        
    except OSError as e:
        error_message(f"Error sending {description}: {e}")
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
        debug_message(f"Sent {description} command: {' '.join(hex_bytes)}")
        
        i2c.unlock()
        time.sleep(0.005) # was 0.01
        return True
        
    except OSError as e:
        error_message(f"Error sending {description} command: {e}")
        try:
            i2c.unlock();
        except:
            pass
        return False

def send_cregs(cregs):
    """Send CREG data to FXCore - 66 bytes expected (64 data + 2 checksum)"""
    if not send_command([0x01, 0x0F], "XFER_CREG"):
        return False
    
    if len(cregs) != 66:
        error_message(f"CREG data must be exactly 66 bytes, got {len(cregs)}")
        return False
    
    success = send_i2c_data(cregs, f"CREG data (66 bytes)")
    if success:
        debug_message("CREG transfer success")
    return success

def send_mregs(mregs):
    """Send MREG data to FXCore - 514 bytes expected (512 data + 2 checksum)"""
    if not send_command([0x04, 0x7F], "XFER_MREG"):
        return False
    
    if len(mregs) != 514:
        error_message(f"MREG data must be exactly 514 bytes, got {len(mregs)}")
        return False
    
    success = send_i2c_data(mregs, f"MREG data (514 bytes)")
    if success:
        debug_message("MREG transfer success")
    return success

def send_sfrs(sfrs):
    """Send SFR data to FXCore - 50 bytes expected (48 data + 2 checksum)"""
    if not send_command([0x02, 0x0B], "XFER_SFR"):
        return False
    
    if len(sfrs) != 50:
        error_message(f"SFR data must be exactly 50 bytes, got {len(sfrs)}")
        return False
    
    success = send_i2c_data(sfrs, f"SFR data (50 bytes)")
    if success:
        debug_message("SFR transfer success")
    return success

def send_program_data(instructions, program_data):
    """Send program data to FXCore - program_data should include checksum"""
    if len(instructions) == 0:
        debug_message("No program instructions to send")
        return False
    
    if len(instructions) > 1024:
        error_message(f"Too many instructions ({len(instructions)}), max is 1024")
        return False
    
    expected_size = (len(instructions) * 4) + 2  # 4 bytes per instruction + 2 checksum
    if len(program_data) != expected_size:
        error_message(f"Program data must be exactly {expected_size} bytes, got {len(program_data)}")
        return False
        
    num_instructions = len(instructions)
    cmd_value = 0x0800 + (num_instructions - 1)
    cmd_high = (cmd_value >> 8) & 0xFF
    cmd_low = cmd_value & 0xFF
    
    if not send_command([cmd_high, cmd_low], f"XFER_PRG (0x{cmd_value:04X} for {num_instructions} instructions)"):
        return False
    
    success = send_i2c_data(program_data, f"program data ({len(program_data)} bytes)")
    if success:
        debug_message("PRG transfer success")
    return success

def execute_from_ram():
    """Execute the program from RAM"""
    success = send_command([0x0D, 0x00], "EXEC_FROM_RAM")
    if success:
        # log_fxcore_status("After EXEC_FROM_RAM")
                debug_message("Enter RUN from RAM")
    return success

def write_to_flash_location(location):
    """Write the program to a specific flash location (0-15)"""
    if location < 0 or location > 15:
        error_message(f"Invalid flash location: {location}")
        return False
    
    success = send_command([0x0C, location], f"WRITE_PRG to location {location:X}")
    if success:
        debug_message(f"Writing to FLASH location {location:X}, waiting 200ms...")
        time.sleep(0.2)  # Wait for FLASH write to complete
        # log_fxcore_status(f"After WRITE_PRG to location {location:X}")
    return success

def send_return_0():
    """Send RETURN_0 command to stop execution and return to STATE0"""
    success = send_command([0x0E, 0x00], "RETURN_0")
    if success:
        # log_fxcore_status("After RETURN_0")
                debug_message("Sent RETURN_0 command")
    return success

# UNIFIED PROGRAMMING FUNCTION
def execute_unified_programming(data_source, execution_mode="ram", flash_location=None):
    """
    Unified programming function for both file mode and FT260 mode
    
    Args:
        data_source: Either a filename (string) or a dict with programming data
        execution_mode: "ram" for RAM execution, "flash" for flash programming
        flash_location: Location (0-15) for flash programming, ignored for RAM mode
    
    Returns:
        bool: True if successful, False otherwise
    """

    global running
    
    # Determine if we're working with file data or FT260 data
    if isinstance(data_source, str):
        # File mode - read and parse hex file
        debug_message(f"Reading and parsing hex file: {data_source}")
        fx_data = read_fxcore_hex_file(data_source)
        if not fx_data:
            error_message("Failed to read hex file")
            blink_status_led(RED, 5)
            return False
        
        cregs = fx_data['cregs']
        mregs = fx_data['mregs'] 
        sfrs = fx_data['sfrs']
        instructions = fx_data['instructions']
        program_data = fx_data.get('program_data', bytearray())
        
    else:
        # FT260 mode - use provided data dict
        cregs = data_source.get('cregs', bytearray())
        mregs = data_source.get('mregs', bytearray())
        sfrs = data_source.get('sfrs', bytearray())
        instructions = data_source.get('instructions', [])
        program_data = data_source.get('program_data', bytearray())
    
    # Set appropriate status LED based on mode
    if execution_mode == "flash":
        if isinstance(data_source, str):
            log_message(f"Starting flash programming: {data_source} -> Location {flash_location:X}")
        else:
            log_message(f"Starting flash programming to location {flash_location:X}")
        blink_status_led(PURPLE, 2)
    else:
        if isinstance(data_source, str):
            log_message(f"Starting RAM execution: {data_source}")
        else:
            log_message("Starting RAM execution from FT260 data")
        blink_status_led(BLUE, 2)
    
    # Initial status check
    # log_fxcore_status("Before programming")
    
    # Wait for FXCore to settle
    debug_message("Waiting for FXCore to settle...")
    time.sleep(0.1)
    
    # Enter programming mode
    debug_message("Entering programming mode...")
    if not enter_prog_mode():
        error_message("Failed to enter programming mode")
        blink_status_led(RED, 5)
        return False
    
    time.sleep(0.1)
    
    # Send data in the correct order: CREG, MREG, SFR, PROGRAM
    success = True
    
    # Send CREGs if available
    if success and len(cregs) > 0:
        debug_message("Uploading CREG data...")
        if not send_cregs(cregs):
            success = False
        else:
            time.sleep(0.1)
    
    # Send MREGs if available
    if success and len(mregs) > 0:
        debug_message("Uploading MREG data...")
        if not send_mregs(mregs):
            success = False
        else:
            time.sleep(0.1)
    
    # Send SFRs if available
    if success and len(sfrs) > 0:
        debug_message("Uploading SFR data...")
        if not send_sfrs(sfrs):
            success = False
        else:
            time.sleep(0.1)
    
    # Send program data if available
    if success and len(instructions) > 0:
        debug_message("Uploading program data...")
        if not send_program_data(instructions, program_data):
            success = False
        else:
            time.sleep(0.1)
    
    if not success:
        error_message("Failed to upload complete program data")
        blink_status_led(RED, 5)
        send_return_0()
        exit_prog_mode()
        return False
    
   # Execute based on mode
    if execution_mode == "flash":
        # Flash programming mode
        if flash_location is None or flash_location < 0 or flash_location > 15:
            error_message(f"Invalid flash location: {flash_location}")
            blink_status_led(RED, 5)
            send_return_0()
            exit_prog_mode()
            return False
        
        debug_message(f"Writing program to FLASH location {flash_location:X}...")
        if not write_to_flash_location(flash_location):
            error_message("Failed to write to FLASH")
            blink_status_led(RED, 5)
            send_return_0()
            exit_prog_mode()
            return False
        
        # Return to STATE0 and exit programming mode for flash
        send_return_0()
        time.sleep(0.1)
        exit_prog_mode()
        
        # Success - indicate with solid green LED
        set_status_led(GREEN)
        log_message(f"SUCCESS: Program written to FLASH location {flash_location:X}")
        debug_message("Programming complete. FXCore returned to RUN mode.")
        
    else:
        # RAM execution mode
        debug_message("Starting program execution from RAM...")
        if not execute_from_ram():
            error_message("Failed to execute program")
            blink_status_led(RED, 5)
            send_return_0()
            exit_prog_mode()
            return False
        
        # Success - set running flag and initial LED state
        running = True  # This makes the main loop handle blinking
        set_status_led(RED)  # Set initial red state
        log_message("SUCCESS: Program is running from RAM")
        debug_message("RED LED blinking indicates program is running from RAM")
        debug_message("CLEAR HARDWARE to stop execution and return to normal operation")
    
    return True


# Simplified file mode functions that use the unified function
def program_location(location, filename):
    """Program a specific location with a hex file (simplified wrapper)"""
    return execute_unified_programming(filename, "flash", location)


def run_ram_execution(filename="output.hex"):
    """Run the complete upload and execution process for RAM execution (simplified wrapper)"""
    return execute_unified_programming(filename, "ram")


# Helper function to convert FT260 data to the format expected by unified function
def prepare_ft260_data_for_unified(ft260_emulator):
    """Convert FT260 emulator data to format expected by unified programming function"""
    # Convert program data to instructions if needed
    instructions = []
    if len(ft260_emulator.program_data) >= 2:
        program_payload = ft260_emulator.program_data[:-2]  # Everything except checksum
        for i in range(0, len(program_payload), 4):
            if i + 3 < len(program_payload):
                instruction = (program_payload[i] |
                             (program_payload[i+1] << 8) |
                             (program_payload[i+2] << 16) |
                             (program_payload[i+3] << 24))
                instructions.append(instruction)
    
    return {
        'cregs': ft260_emulator.creg_data if len(ft260_emulator.creg_data) == 66 else bytearray(),
        'mregs': ft260_emulator.mreg_data if len(ft260_emulator.mreg_data) == 514 else bytearray(),
        'sfrs': ft260_emulator.sfr_data if len(ft260_emulator.sfr_data) == 50 else bytearray(),
        'instructions': instructions,
        'program_data': ft260_emulator.program_data
    }


# Smart FT260 Emulator Class - Fixed command parsing
# we accept HID reports 0xA1, 0xC0, 0xC2, 0xD0
class SmartFT260Emulator:
    def __init__(self):
        # Find our custom FT260 HID device
        self.hid_device = None
        for device in usb_hid.devices:
            if hasattr(device, 'usage_page') and device.usage_page == 0xFF00:
                self.hid_device = device
                break
        
        if not self.hid_device:
            debug_message("FT260 HID device not found. Check boot.py configuration.")
            self.enabled = False
        else:
            self.enabled = True
            log_message("✓ Smart FT260 Emulator ready")
        
        # State tracking
        self.i2c_status = 0x20  # I2C idle status
        self.active = False
        
        # Programming data buffers
        self.reset_programming_state()
        
        # Programming state
        self.in_programming_mode = False
        self.expecting_data = None  # What type of data we're expecting next
        self.data_remaining = 0     # How many bytes remaining for current transfer
    
    # Use same buffers for both modes
    def reset_programming_state(self):
        """Reset all programming data buffers - reuse existing buffers"""
        # Instead of creating new bytearrays, clear existing ones
        if hasattr(self, 'mreg_data'):
            self.mreg_data[:] = bytearray()  # Clear in place
        else:
            self.mreg_data = bytearray()
        
        if hasattr(self, 'creg_data'):
            self.creg_data[:] = bytearray()
        else:
            self.creg_data = bytearray()
        
        if hasattr(self, 'sfr_data'):
            self.sfr_data[:] = bytearray()
        else:
            self.sfr_data = bytearray()
        
        if hasattr(self, 'program_data'):
            self.program_data[:] = bytearray()
        else:
            self.program_data = bytearray()
            
        self.expecting_data = None
        self.data_remaining = 0
        debug_message("FT260: Programming state reset")

    
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
            error_message(f"FT260: Error sending input report 0x{report_id:02X}: {e}")
            return False
    
    def handle_output_report_c2(self, data):
        """Handle Output Report 0xC2 - I2C Read request (pass through normally)"""
        if len(data) < 4:
            return
            
        i2c_addr = data[0]
        bytes_to_read = data[2] | (data[3] << 8)
        
        debug_message(f"FT260: I2C Read: 0x{i2c_addr:02X}, {bytes_to_read} bytes")
        
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
            debug_message("FT260: ✓ Read successful")
        else:
            response_data[0] = 0  # Failed read
            debug_message("FT260: ✗ Read failed")
        
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
                        debug_message(f"FT260: Data for {self.expecting_data} (flag 0x{i2c_flag:02X}): {len(write_data)} bytes")
                        self.handle_programming_data(write_data)
                        return True
                # Continue to command parsing below
            else:
                # This is data continuation (not a command)
                debug_message(f"FT260: Data continuation for {self.expecting_data} (flag 0x{i2c_flag:02X}): {len(write_data)} bytes")
                self.handle_programming_data(write_data)
                return True
        
        if len(write_data) < 2:
            return False
            
        cmd_high = write_data[0]
        cmd_low = write_data[1]
        payload_data = write_data[2:] if len(write_data) > 2 else bytearray()
        
        cmd = (cmd_high << 8) | cmd_low
        debug_message(f"FT260: Command 0x{cmd_high:02X} 0x{cmd_low:02X} (0x{cmd:04X}) with {len(payload_data)} payload bytes")
        
        # Enter programming mode
        if cmd_high == 0xA5 and cmd_low == 0x5A:
            debug_message("FT260: ENTER_PRG command detected")
            self.in_programming_mode = True
            self.reset_programming_state()
            enter_prog_mode()  # Actually execute the command
            return True
        
        # Exit programming mode
        elif cmd_high == 0x5A and cmd_low == 0xA5:
            debug_message("FT260: EXIT_PRG command detected")
            self.in_programming_mode = False
            exit_prog_mode()  # Actually execute the command
            return True
        
        # MREG transfer - correct command is 0x04 0x7F (128 registers, 0x7F = 127 but 0-indexed)
        elif cmd_high == 0x04 and cmd_low == 0x7F:
            debug_message("FT260: XFER_MREG command detected")
            self.expecting_data = "MREG"
            self.data_remaining = 514  # 512 bytes + 2 byte checksum
            # If there's payload data with the command, process it
            if len(payload_data) > 0:
                self.handle_programming_data(payload_data)
            return True
        
        # CREG transfer - must be exactly 0x01 0x0F
        elif cmd_high == 0x01 and cmd_low == 0x0F:
            debug_message("FT260: XFER_CREG command detected")
            self.expecting_data = "CREG"
            self.data_remaining = 66   # 64 bytes + 2 byte checksum
            # If there's payload data with the command, process it
            if len(payload_data) > 0:
                self.handle_programming_data(payload_data)
            return True
        
        # SFR transfer - must be exactly 0x02 0x0B
        elif cmd_high == 0x02 and cmd_low == 0x0B:
            debug_message("FT260: XFER_SFR command detected")
            self.expecting_data = "SFR"
            self.data_remaining = 52   # 50 bytes + 2 byte checksum
            # If there's payload data with the command, process it
            if len(payload_data) > 0:
                self.handle_programming_data(payload_data)
            return True
        
        # Program transfer - 0x08xx range (0x0800 + num_instructions - 1)
        elif cmd_high == 0x08 or (cmd_high == 0x09) or (cmd_high == 0x0A) or (cmd_high == 0x0B):
            # This covers the range 0x0800 to 0x0BFF which should handle all program sizes
            num_instructions = cmd - 0x0800 + 1
            num_bytes = num_instructions * 4  # Each instruction is 4 bytes
            debug_message(f"FT260: XFER_PRG command detected for {num_instructions} instructions ({num_bytes} bytes)")
            self.expecting_data = "PROGRAM"
            self.data_remaining = num_bytes + 2  # program bytes + 2 byte checksum
            # If there's payload data with the command, process it
            if len(payload_data) > 0:
                self.handle_programming_data(payload_data)
            return True
        
        # Execute from RAM
        elif cmd_high == 0x0D and cmd_low == 0x00:
            debug_message("FT260: EXEC_FROM_RAM command detected")
            self.execute_programming()
            return True
        
        # Write to flash
        elif cmd_high == 0x0C:
            location = cmd_low
            debug_message(f"FT260: WRITE_PRG to location {location:X} command detected")
            self.execute_programming_to_flash(location)
            return True
        
        # Return to STATE0
        elif cmd_high == 0x0E and cmd_low == 0x00:
            debug_message("FT260: RETURN_0 command detected")
            send_return_0()  # Actually execute the command
            return True
        
        return False  # Not a recognized command
    
    def handle_programming_data(self, data):
        """Handle programming data based on what we're expecting"""
        if not self.expecting_data:
            debug_message("FT260: Received data but not expecting any")
            return
        
        bytes_to_take = min(len(data), self.data_remaining)
        
        if self.expecting_data == "MREG":
            self.mreg_data.extend(data[:bytes_to_take])
            debug_message(f"FT260: Added {bytes_to_take} bytes to MREG buffer (total: {len(self.mreg_data)})")
        
        elif self.expecting_data == "CREG":
            self.creg_data.extend(data[:bytes_to_take])
            debug_message(f"FT260: Added {bytes_to_take} bytes to CREG buffer (total: {len(self.creg_data)})")
        
        elif self.expecting_data == "SFR":
            self.sfr_data.extend(data[:bytes_to_take])
            debug_message(f"FT260: Added {bytes_to_take} bytes to SFR buffer (total: {len(self.sfr_data)})")
        
        elif self.expecting_data == "PROGRAM":
            self.program_data.extend(data[:bytes_to_take])
            debug_message(f"FT260: Added {bytes_to_take} bytes to PROGRAM buffer (total: {len(self.program_data)})")
        
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
            debug_message(f"FT260: {self.expecting_data} data complete ({total} total bytes)")
            self.expecting_data = None
            self.data_remaining = 0
    
    def execute_programming(self):
        """Execute the collected programming data (RAM execution) - use unified function"""
        debug_message("FT260: Starting programming execution...")
        debug_message(f"Data collected - MREG: {len(self.mreg_data)}, CREG: {len(self.creg_data)}, SFR: {len(self.sfr_data)}, Program: {len(self.program_data)} bytes")
        
        # Prepare data for unified function
        unified_data = prepare_ft260_data_for_unified(self)
        
        # Use unified programming function
        return execute_unified_programming(unified_data, "ram")
    
    def execute_programming_to_flash(self, location):
        """Execute the collected programming data (Flash programming) - use unified function"""
        debug_message(f"FT260: Starting flash programming to location {location:X}...")
        debug_message(f"Data collected - MREG: {len(self.mreg_data)}, CREG: {len(self.creg_data)}, SFR: {len(self.sfr_data)}, Program: {len(self.program_data)} bytes")
        
        # Prepare data for unified function
        unified_data = prepare_ft260_data_for_unified(self)
        
        # Use unified programming function
        return execute_unified_programming(unified_data, "flash", location)
    
    def handle_output_report_d0(self, data):
        """Handle Output Report 0xD0 - Intercept ALL D0 reports for smart programming"""
        if len(data) < 4:
            return
            
        i2c_addr = data[0]
        i2c_flag = data[1]  # I2C flags (not used currently but good to track)
        byte_count = data[2]  # Exact number of I2C payload bytes
        write_data = data[3:3+byte_count]  # Extract exactly the right amount of data
        
        if DEBUG_MODE:
            debug_message(f"FT260: D0 Report - I2C addr 0x{i2c_addr:02X}, flag 0x{i2c_flag:02X}, {byte_count} bytes")
        
        # Check if this is targeting the FXCore
        if i2c_addr == FXCORE_ADDRESS:
            # Try to handle as programming command/data
            if self.handle_programming_command(write_data, i2c_flag):
                # Successfully handled as programming command
                self.i2c_status = 0x20
                return
        
        # If not FXCore or not a programming command, pass through normally
        if DEBUG_MODE:
            data_preview = ' '.join([f'0x{byte_val:02X}' for byte_val in write_data[:min(8, len(write_data))]])
            debug_message(f"FT260: Pass-through I2C Write: 0x{i2c_addr:02X}, {byte_count} bytes - Data: {data_preview}{'...' if len(write_data) > 8 else ''}")
        
        try:
            while not i2c.try_lock():
                time.sleep(0.001)
            
            try:
                i2c.writeto(i2c_addr, bytes(write_data))
                self.i2c_status = 0x20  # Success
                debug_message("FT260: ✓ Pass-through write successful")
                
            except OSError:
                self.i2c_status = 0x26  # Error
                debug_message("FT260: ✗ Pass-through write failed")
            finally:
                i2c.unlock()
                
        except Exception:
            self.i2c_status = 0x26
            debug_message("FT260: ✗ Pass-through write error")
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
                    debug_message("FT260: Smart bridge mode activated")
                    self.active = True
                
                # Route to appropriate handler
                if report_id == 0xA1:
                    # A1 reports pass through (status/control)
                    debug_message("FT260: A1 report - ignoring")
                    # stop_execution()
                elif report_id == 0xC0:
                    # C0 reports pass through  
                    debug_message("FT260: C0 report - ignoring")
                elif report_id == 0xC2:
                    # C2 reports are I2C reads - pass through
                    self.handle_output_report_c2(data)
                elif report_id == 0xD0:
                    # D0 reports are I2C writes - intercept ALL of them
                    self.handle_output_report_d0(data)
                
                return True  # Processed a report
                
        except Exception as e:
            error_message(f"FT260: Error processing reports: {e}")
        
        return False  # No report processed
        
# Initialize FT260 Emulator
ft260 = SmartFT260Emulator()

def stop_execution():
    """Stop program execution and return to normal operation"""
    debug_message("Stopping program execution...")
    
    # Send RETURN_0 to stop execution
    send_return_0()
    time.sleep(0.1)
    
    # Exit programming mode, also clears running flag
    exit_prog_mode()
    
    # Turn off LED
    set_status_led(OFF)
    
    debug_message("Program stopped and returned to normal operation")

def main():

    global running
    
    log_message("FXCore Enhanced Hex Programmer with FT260 Emulation")
    log_message("===================================================")
    log_message("- NeoPixel on GP16 shows status:")
    log_message("  * RED = Program running from RAM")
    log_message("  * GREEN = Location programming successful")
    log_message("  * PURPLE = Location programming in progress") 
    log_message("  * BLUE = RAM upload in progress")
    log_message("  * OFF = Normal operation")
    log_message("- Place output.hex for RAM execution")
    log_message("- Place 0.hex through F.hex for location programming")
    log_message("- FT260 USB-I2C Bridge emulation available")
    log_message("")
    
    # Turn off LED initially
    set_status_led(OFF)

    running = False # init running flag
    
    # Always return to STATE0 on boot
    debug_message("Ensuring STATE0 on startup...")
    stop_execution()
    time.sleep(0.1)
    
    # Find all valid hex files at boot
    output_hex_valid, location_files = find_valid_hex_files()
    
    # Process any location files found at boot
    if location_files:
        for location, filename in location_files.items():
            log_message(f"Boot-time location file detected: {filename} for location {location:X}")
            log_message(f"Found {filename} - programming location {location:X}...")
            
            if program_location(location, filename):
                log_message(f"Successfully programmed location {location:X}")
                # Keep green LED on for a few seconds to show success
                time.sleep(3)
            else:
                error_message(f"Failed to program location {location:X}")
                # Keep red LED on for a few seconds to show failure
                time.sleep(3)
            
            # Return LED to off state after programming
            set_status_led(OFF)
    
    # Check for output.hex (RAM execution) at boot
    if output_hex_valid:
        log_message("output.hex found at boot - starting RAM execution...")
        if run_ram_execution():
            running = True
    
    last_blink_time = 0
    blink_interval = 0.5
    
    while True:
        try:
            current_time = time.monotonic()
            
            # High-frequency FT260 processing
            ft260_processed = ft260.process_reports()
            
            # Handle LED blinking with timing control
            if running and (current_time - last_blink_time >= blink_interval):
                current_color = pixel[0]
                if current_color == RED:
                    set_status_led((128, 0, 0))  # Dimmer red
                else:
                    set_status_led(RED)  # Full red
                last_blink_time = current_time
            
            # Minimal delay - responsive to FT260 but not CPU-intensive
            if ft260_processed:
                time.sleep(0.0001)  # Very short delay after processing
            else:
                time.sleep(0.001)   # Slightly longer when idle
                
        except KeyboardInterrupt:
            break
        except Exception as e:
            error_message(f"Unexpected error in main loop: {e}")
            set_status_led(OFF)
            time.sleep(2)

# Run the main function
if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log_message("\nProgram interrupted")
        debug_message("Program terminated by user")
        stop_execution()
        if 'i2c' in globals():
            i2c.deinit()
        log_message("I2C bus released")
    except Exception as e:
        set_status_led(OFF)
        error_message(f"Fatal error: {e}")
        if 'i2c' in globals():
            i2c.deinit()