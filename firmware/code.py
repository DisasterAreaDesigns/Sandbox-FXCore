# FXCore Hex File Uploader and RAM Executor with NeoPixel Status
# Version 2.3 - Added NeoPixel status indication and file-based control
# Date: 2025-01-06

import board
import busio
import time
import neopixel
import os

# FXCore I2C address
FXCORE_ADDRESS = 0x30
HEX_FILE_PATH = "output.hex"

# NeoPixel setup
NEOPIXEL_PIN = board.GP16
NUM_PIXELS = 1
pixel = neopixel.NeoPixel(NEOPIXEL_PIN, NUM_PIXELS, brightness=0.3, auto_write=True)

# Colors
RED = (255, 0, 0)
GREEN = (0, 255, 0)
BLUE = (0, 0, 255)
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

def check_hex_file_exists():
    """Check if the hex file exists and has content"""
    try:
        if HEX_FILE_PATH in os.listdir():
            # Check file size
            try:
                with open(HEX_FILE_PATH, 'r') as f:
                    content = f.read().strip()
                    return len(content) > 0  # Return True only if file has content
            except:
                return False
        return False
    except:
        return False
    """Check if the hex file exists and has content"""
    try:
        if HEX_FILE_PATH in os.listdir():
            # Check file size
            try:
                with open(HEX_FILE_PATH, 'r') as f:
                    content = f.read().strip()
                    return len(content) > 0  # Return True only if file has content
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
        print("Entered programming mode")
        
        i2c.unlock()
        return True
        
    except OSError as e:
        print(f"Error entering PROG mode: {e}")
        i2c.unlock()
        return False

def exit_prog_mode():
    """Exit programming mode and return to RUN mode"""
    try:
        while not i2c.try_lock():
            pass
        
        command = bytes([0x5A, 0xA5])
        i2c.writeto(FXCORE_ADDRESS, command)
        print("Exited programming mode - returned to RUN mode")
        
        i2c.unlock()
        return True
        
    except OSError as e:
        print(f"Error exiting PROG mode: {e}")
        i2c.unlock()
        return False

def verify_hex_checksum(record_bytes):
    """Verify Intel HEX record checksum"""
    # Sum all bytes including the checksum
    total_sum = sum(record_bytes) & 0xFF
    # Should equal zero if checksum is correct
    return total_sum == 0

def read_fxcore_hex_file():
    """Read and parse FXCore hex file using Intel HEX format"""
    try:
        with open(HEX_FILE_PATH, 'r') as f:
            lines = f.readlines()
        
        # Initialize data dictionaries to store data by address
        all_data = {}  # address -> byte value
        
        print("Parsing Intel HEX records...")
        
        for line_num, line in enumerate(lines, 1):
            line = line.strip()
            if not line.startswith(':'):
                continue
                
            # Parse Intel HEX record structure
            if len(line) < 11:  # Minimum: : + 2 + 4 + 2 + 2 = 11 chars
                print(f"Line {line_num}: Record too short, skipping")
                continue
                
            try:
                # Extract fields from hex record
                byte_count = int(line[1:3], 16)
                address = int(line[3:7], 16) 
                record_type = int(line[7:9], 16)
                
                # Calculate expected record length
                expected_length = 11 + (byte_count * 2)  # : + 8 chars header + data + checksum
                if len(line) != expected_length:
                    print(f"Line {line_num}: Length mismatch, expected {expected_length}, got {len(line)}")
                    continue
                
                # Extract all bytes from the record (for checksum verification)
                record_bytes = []
                for i in range(1, len(line), 2):
                    record_bytes.append(int(line[i:i+2], 16))
                
                # Verify checksum
                if not verify_hex_checksum(record_bytes):
                    print(f"Line {line_num}: Checksum error!")
                    continue
                
                print(f"Line {line_num}: Type={record_type:02X}, Addr=0x{address:04X}, Bytes={byte_count}")
                
                if record_type == 0x00:  # Data record
                    # Extract data bytes (excluding checksum)
                    data_bytes = []
                    for i in range(byte_count):
                        data_pos = 9 + (i * 2)
                        data_byte = int(line[data_pos:data_pos+2], 16)
                        data_bytes.append(data_byte)
                        # Store each byte at its address
                        all_data[address + i] = data_byte
                    
                    # Format data bytes for display
                    data_str = ' '.join(f'{x:02X}' for x in data_bytes)
                    print(f"  Data: {data_str}")
                    
                elif record_type == 0x01:  # End of file
                    print(f"Line {line_num}: End of file record")
                    break
                else:
                    print(f"Line {line_num}: Record type {record_type:02X} not handled")
                    
            except ValueError as e:
                print(f"Line {line_num}: Parse error - {e}")
                continue
        
        # Now extract data arrays based on address ranges
        print(f"\nExtracting data arrays by address range:")
        
        # MREG data: 0x0000 - 0x07FF
        mreg_addresses = [addr for addr in all_data.keys() if 0x0000 <= addr <= 0x07FF]
        mreg_addresses.sort()
        mreg_data = bytearray()
        if mreg_addresses:
            print(f"MREG addresses: 0x{min(mreg_addresses):04X} to 0x{max(mreg_addresses):04X}")
            for addr in range(min(mreg_addresses), max(mreg_addresses) + 1):
                if addr in all_data:
                    mreg_data.append(all_data[addr])
                else:
                    mreg_data.append(0x00)  # Fill gaps with zeros
        
        # CREG data: 0x0800 - 0x0FFF  
        creg_addresses = [addr for addr in all_data.keys() if 0x0800 <= addr <= 0x0FFF]
        creg_addresses.sort()
        creg_data = bytearray()
        if creg_addresses:
            print(f"CREG addresses: 0x{min(creg_addresses):04X} to 0x{max(creg_addresses):04X}")
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
            print(f"SFR addresses: 0x{min(sfr_addresses):04X} to 0x{max(sfr_addresses):04X}")
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
            print(f"PROGRAM addresses: 0x{min(prog_addresses):04X} to 0x{max(prog_addresses):04X}")
            for addr in range(min(prog_addresses), max(prog_addresses) + 1):
                if addr in all_data:
                    prog_data.append(all_data[addr])
                else:
                    prog_data.append(0x00)
        
        print(f"\nFinal extracted arrays:")
        print(f"MREG array: {len(mreg_data)} bytes")
        if len(mreg_data) > 0:
            first_16 = ' '.join(f'{x:02X}' for x in mreg_data[:16])
            last_16 = ' '.join(f'{x:02X}' for x in mreg_data[-16:])
            print(f"  First 16 bytes: {first_16}")
            print(f"  Last 16 bytes:  {last_16}")
        
        print(f"CREG array: {len(creg_data)} bytes") 
        if len(creg_data) > 0:
            all_creg = ' '.join(f'{x:02X}' for x in creg_data)
            print(f"  All bytes: {all_creg}")
        
        print(f"SFR array: {len(sfr_data)} bytes")
        if len(sfr_data) > 0:
            all_sfr = ' '.join(f'{x:02X}' for x in sfr_data)
            print(f"  All bytes: {all_sfr}")
        
        print(f"PROGRAM array: {len(prog_data)} bytes")
        if len(prog_data) > 0:
            first_16_prog = ' '.join(f'{x:02X}' for x in prog_data[:16])
            last_16_prog = ' '.join(f'{x:02X}' for x in prog_data[-16:])
            print(f"  First 16 bytes: {first_16_prog}")
            print(f"  Last 16 bytes:  {last_16_prog}")
        
        # Convert program data to 32-bit instructions (excluding checksum)
        # Assume last 2 bytes are checksum
        instruction_bytes = len(prog_data) - 2 if len(prog_data) >= 2 else len(prog_data)
        instructions = []
        for i in range(0, instruction_bytes, 4):
            if i + 3 < instruction_bytes:
                instruction = (prog_data[i] |
                             (prog_data[i+1] << 8) |
                             (prog_data[i+2] << 16) |
                             (prog_data[i+3] << 24))
                instructions.append(instruction)
        
        print(f"\nProgram contains {len(instructions)} instructions")
        
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
        print(f"Error reading hex file: {e}")
        return None

def send_i2c_data(data, description):
    """Send data over I2C as a single transfer"""
    try:
        while not i2c.try_lock():
            pass
        
        # Try to send all data in one transfer
        try:
            i2c.writeto(FXCORE_ADDRESS, data)
            i2c.unlock()
            print(f"Sent {len(data)} bytes of {description} in single transfer")
            return True
        except OSError as e:
            # If single transfer fails, try chunking as fallback
            print(f"Single transfer failed ({e}), trying chunked transfer...")
            chunk_size = 32
            for i in range(0, len(data), chunk_size):
                chunk = data[i:i + chunk_size]
                i2c.writeto(FXCORE_ADDRESS, chunk)
                time.sleep(0.01)
            
            i2c.unlock()
            print(f"Sent {len(data)} bytes of {description} in {(len(data) + chunk_size - 1) // chunk_size} chunks")
            return True
        
    except OSError as e:
        print(f"Error sending {description}: {e}")
        i2c.unlock()
        return False

def send_cregs(cregs, original_checksum):
    """Send CREG data to FXCore"""
    # Send XFER_CREG command (0x01 0x0F)
    if not send_command([0x01, 0x0F], "XFER_CREG"):
        return False
    
    # Pad CREGs to 64 bytes if needed
    creg_data = bytearray(cregs)
    if len(creg_data) < 64:
        creg_data.extend(bytearray(64 - len(creg_data)))
    elif len(creg_data) > 64:
        creg_data = creg_data[:64]
    
    # Add checksum
    if len(original_checksum) == 2 and (original_checksum[0] != 0 or original_checksum[1] != 0):
        # Use original checksum from hex file
        data_with_checksum = creg_data + bytearray(original_checksum)
    else:
        # Calculate checksum
        checksum = calculate_checksum(creg_data)
        data_with_checksum = creg_data
        data_with_checksum.append(checksum & 0xFF)
        data_with_checksum.append((checksum >> 8) & 0xFF)
    
    return send_i2c_data(data_with_checksum, f"CREG data ({len(data_with_checksum)} bytes)")

def send_mregs(mregs, original_checksum):
    """Send MREG data to FXCore"""
    # Send XFER_MREG command (0x04 0xFF for 256 registers)
    if not send_command([0x04, 0xFF], "XFER_MREG"):
        return False
    
    # Ensure MREGs are exactly 512 bytes
    mreg_data = bytearray(mregs)
    if len(mreg_data) < 512:
        mreg_data.extend(bytearray(512 - len(mreg_data)))
    elif len(mreg_data) > 512:
        mreg_data = mreg_data[:512]
    
    # Add checksum
    if len(original_checksum) == 2 and (original_checksum[0] != 0 or original_checksum[1] != 0):
        # Use original checksum from hex file
        data_with_checksum = mreg_data + bytearray(original_checksum)
    else:
        # Calculate checksum
        checksum = calculate_checksum(mreg_data)
        data_with_checksum = mreg_data
        data_with_checksum.append(checksum & 0xFF)
        data_with_checksum.append((checksum >> 8) & 0xFF)
    
    return send_i2c_data(data_with_checksum, f"MREG data ({len(data_with_checksum)} bytes)")

def send_sfrs(sfrs):
    """Send SFR data to FXCore"""
    # Send XFER_SFR command (0x02 0x0B)
    if not send_command([0x02, 0x0B], "XFER_SFR"):
        return False
    
    # Ensure SFRs are exactly 50 bytes
    sfr_data = bytearray(sfrs)
    if len(sfr_data) < 50:
        sfr_data.extend(bytearray(50 - len(sfr_data)))
    elif len(sfr_data) > 50:
        sfr_data = sfr_data[:50]
    
    # Calculate checksum for SFR data
    checksum = calculate_checksum(sfr_data)
    data_with_checksum = sfr_data
    data_with_checksum.append(checksum & 0xFF)
    data_with_checksum.append((checksum >> 8) & 0xFF)
    
    return send_i2c_data(data_with_checksum, f"SFR data ({len(data_with_checksum)} bytes)")

def send_program_data(instructions, program_data):
    """Send program data to FXCore"""
    print(f"send_program_data called with {len(instructions)} instructions and {len(program_data)} bytes of program data")
    
    if len(instructions) == 0:
        print("No program instructions to send")
        return False
        
    # Calculate XFER_PRG command: 0x0800 + (num_instructions - 1)
    num_instructions = len(instructions)
    cmd_value = 0x0800 + (num_instructions - 1)
    cmd_high = (cmd_value >> 8) & 0xFF
    cmd_low = cmd_value & 0xFF
    
    if not send_command([cmd_high, cmd_low], f"XFER_PRG (0x{cmd_value:04X} for {num_instructions} instructions)"):
        return False
    
    # If we have separate program_data (with checksum), use it
    if isinstance(program_data, bytearray) and len(program_data) > len(instructions) * 4:
        print(f"Using complete program data with embedded checksum")
        return send_i2c_data(program_data, f"program data ({len(program_data)} bytes including checksum)")
    else:
        # Otherwise, convert instructions to bytes and calculate checksum
        print(f"Converting {num_instructions} instructions to bytes and calculating checksum")
        program_bytes = bytearray()
        for instruction in instructions:
            program_bytes.append(instruction & 0xFF)
            program_bytes.append((instruction >> 8) & 0xFF)
            program_bytes.append((instruction >> 16) & 0xFF)
            program_bytes.append((instruction >> 24) & 0xFF)
        
        # Calculate and add checksum
        checksum = calculate_checksum(program_bytes)
        program_bytes.append(checksum & 0xFF)
        program_bytes.append((checksum >> 8) & 0xFF)
        
        return send_i2c_data(program_bytes, f"program data ({len(program_bytes)} bytes with calculated checksum)")

def send_command(cmd_bytes, description):
    """Send a command to FXCore"""
    try:
        while not i2c.try_lock():
            pass
        
        command = bytes(cmd_bytes)
        i2c.writeto(FXCORE_ADDRESS, command)
        print(f"Sent {description} command")
        
        i2c.unlock()
        time.sleep(0.01)
        return True
        
    except OSError as e:
        print(f"Error sending {description} command: {e}")
        i2c.unlock()
        return False

def execute_from_ram():
    """Execute the program from RAM"""
    return send_command([0x0D, 0x00], "EXEC_FROM_RAM")

def send_return_0():
    """Send RETURN_0 command to stop execution and return to STATE0"""
    return send_command([0x0E, 0x00], "RETURN_0")

def run_ram_execution():
    """Run the complete upload and execution process"""
    print("FXCore Complete Hex Uploader and RAM Executor")
    print("=============================================")
    print(f"Target I2C Address: 0x{FXCORE_ADDRESS:02X}")
    print(f"Hex File: {HEX_FILE_PATH}")
    
    # Indicate starting upload process
    blink_status_led(BLUE, 2)
    
    # Wait for FXCore to settle
    print("Waiting for FXCore to init...")
    time.sleep(0.5)
    
    # Read and parse hex file
    print("Reading and parsing hex file...")
    fx_data = read_fxcore_hex_file()
    if not fx_data:
        print("Failed to read hex file")
        blink_status_led(RED, 5)
        return False
    
    print(f"\nParsing complete. Data summary:")
    print(f"  CREGs: {len(fx_data.get('cregs', []))} bytes")
    print(f"  MREGs: {len(fx_data.get('mregs', []))} bytes") 
    print(f"  SFRs: {len(fx_data.get('sfrs', []))} bytes")
    print(f"  Instructions: {len(fx_data.get('instructions', []))} count")
    print(f"  Program data: {len(fx_data.get('program_data', []))} bytes")
    
    # Enter programming mode
    print("Entering programming mode...")
    if not enter_prog_mode():
        print("Failed to enter programming mode")
        blink_status_led(RED, 5)
        return False
    
    time.sleep(0.1)
    
    # Send data in the correct order (registers first, then program)
    success = True
    
    # Send CREGs (64 bytes + checksum)
    print("Uploading CREG data...")
    if not send_cregs(fx_data['cregs'], fx_data.get('creg_checksum', bytearray())):
        success = False
    else:
        time.sleep(0.1)
    
    # Send MREGs (512 bytes + checksum)
    if success:
        print("Uploading MREG data...")
        if not send_mregs(fx_data['mregs'], fx_data.get('mreg_checksum', bytearray())):
            success = False
        else:
            time.sleep(0.1)
    
    # Send SFRs (50 bytes)
    if success:
        print("Uploading SFR data...")
        if not send_sfrs(fx_data['sfrs']):
            success = False
        else:
            time.sleep(0.1)
    
    # Send program (must be last)
    if success:
        print("Uploading program data...")
        # Use instructions to create program data if program_data is empty
        program_data = fx_data.get('program_data', bytearray())
        if len(program_data) == 0:
            print("No separate program_data found, will convert instructions")
        
        if not send_program_data(fx_data['instructions'], program_data):
            success = False
        else:
            time.sleep(0.1)
    
    if not success:
        print("Failed to upload complete program data")
        blink_status_led(RED, 5)
        exit_prog_mode()
        return False
    
    # Execute from RAM
    print("Starting program execution from RAM...")
    if not execute_from_ram():
        print("Failed to execute program")
        blink_status_led(RED, 5)
        exit_prog_mode()
        return False
    
    # Success - indicate running state with solid red LED
    set_status_led(RED)
    
    print("\n=== Program is running! ===")
    print("The FXCore is now executing your complete program from RAM.")
    print("All register presets (CREGs, MREGs, SFRs) have been loaded.")
    print("RED LED indicates program is running from RAM.")
    print("Delete output.hex to stop execution and return to normal operation.")
    
    return True

def stop_execution():
    """Stop program execution and return to normal operation"""
    print("Stopping program execution...")
    
    # Send RETURN_0 to stop execution
    send_return_0()
    time.sleep(0.1)
    
    # Exit programming mode
    exit_prog_mode()
    
    # Turn off LED
    set_status_led(OFF)
    
    print("Program stopped and returned to normal operation.")

def main():
    print("FXCore Hex Uploader with NeoPixel Status Control")
    print("================================================")
    print("- NeoPixel on GP16 shows status")
    print("- RED LED = Program running from RAM")
    print("- LED OFF = Normal operation")
    print("- Delete output.hex to stop execution")
    print()
    
    # Turn off LED initially
    set_status_led(OFF)
    
    running = False
    normal_commands_sent = 0
    
    # Always return to STATE0 on boot before programming
    print("Ensuring STATE0 on startup...")
    # send_return_0()
    stop_execution()
    time.sleep(0.1)
    
    while True:
        hex_exists = check_hex_file_exists()
        
        if hex_exists and not running:
            # File exists and we're not running - start execution
            print("output.hex found - starting program upload and execution...")
            if run_ram_execution():
                running = True
                normal_commands_sent = 0  # Reset counter when starting to run
            else:
                # Failed to start, wait before checking again
                time.sleep(2)
        
        elif not hex_exists and running:
            # File deleted and we're running - stop execution
            print("output.hex deleted - stopping execution...")
            stop_execution()
            running = False
            normal_commands_sent = 0  # Reset counter when stopping
        
        elif running and hex_exists:
            # Still running and file still exists - blink red LED
            current_color = pixel[0]
            if current_color == RED:
                set_status_led((128, 0, 0))  # Dimmer red
            else:
                set_status_led(RED)  # Full red
            time.sleep(0.5)
        
        elif not hex_exists and not running:
            # Only send commands when first detected or if counter allows
            if normal_commands_sent < 2:
                print(f"No output.hex or empty file - sending return to normal command ({normal_commands_sent + 1}/2)")
                # send_return_0()
                stop_execution()
                time.sleep(0.1)
                normal_commands_sent += 1
            # After 2 commands sent, just wait quietly
            set_status_led(OFF)
            time.sleep(1)
        
        else:
            # Fallback case - just wait
            set_status_led(OFF)
            time.sleep(1)

# Run the main function
if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nProgram interrupted")
        stop_execution()
        i2c.deinit()
        print("I2C bus released")
    except Exception as e:
        set_status_led(OFF)
        print(f"Unexpected error: {e}")
        i2c.deinit()