# FXCore Sandbox Hardware Programming Interface Documentation

## Overview

This Python script is designed to run on a RP2040 microcontroller and serves as a dual-purpose interface:
1. **FXCore Programming Interface**: Uploads hex files to FXCore audio processors via I2C
2. **FT260 USB-I2C Bridge Emulator**: Provides FT260-compatible USB-to-I2C bridge functionality

The system automatically uploads compiled programs to the FXCore via I2C communication and executes them from RAM, with visual status indication through a NeoPixel LED. Additionally, it can emulate an FT260 USB-I2C bridge device for general-purpose I2C communication from host software.

## System Architecture

### Hardware Components
- **Microcontroller**: Waveshare RP2040 Zero (or compatible CircuitPython board)
- **FXCore**: Audio processing chip at I2C address `0x30`
- **NeoPixel LED**: Status indicator on GPIO pin 16
- **I2C Bus**: GP0 (SDA) and GP1 (SCL) - shared between FXCore and bridge modes
- **USB Interface**: Dual endpoint (HID + Mass Storage) for bridge functionality

### Dual Mode Operation
The system intelligently switches between two operational modes:

#### 1. FXCore Programming Mode (Default)
- **File present**: Uploads and executes the program
- **File deleted**: Stops execution and returns to normal operation
- **Location Programming**: Files named `0.hex` through `F.hex` program specific flash locations

#### 2. FT260 Bridge Mode (On-Demand)
- **USB HID Reports**: Activates when FT260-compatible software sends I2C commands
- **Automatic Timeout**: Returns to FXCore mode after 10 seconds of inactivity
- **Shared I2C Bus**: Uses same I2C interface with priority arbitration

### File-Based Control
The system monitors for the presence of hex files:
- **`output.hex`**: Uploads and executes program from RAM
- **`0.hex` - `F.hex`**: Programs specific flash locations (0x0 through 0xF)
- **File operations**: Create to start, delete to stop

## Core Components

### 1. Hardware Initialization

```python
# I2C bus setup on GP0 (SDA) and GP1 (SCL)
i2c = busio.I2C(scl=board.GP1, sda=board.GP0)

# NeoPixel LED on GP16
pixel = neopixel.NeoPixel(NEOPIXEL_PIN, NUM_PIXELS, brightness=0.3)

# FT260 HID device (if configured)
ft260 = FT260Emulator()
```

The system initializes shared I2C communication, NeoPixel LED, and FT260 emulation if HID is configured.

### 2. Mode Arbitration System

The system uses a priority-based approach to manage the shared I2C bus:

```python
def main_loop():
    # Check FT260 activity first (highest priority)
    ft260_active = ft260.process_reports()
    
    # Only process FXCore operations if FT260 is inactive
    if not ft260_active:
        process_fxcore_operations()
```

**Priority Rules:**
1. FT260 bridge commands have immediate priority
2. FXCore operations pause during bridge activity  
3. Bridge mode times out after 10 seconds of inactivity
4. Seamless switching with status indication

### 3. Status LED System

The NeoPixel provides visual feedback for both modes:

#### FXCore Programming Status:
- **OFF**: Normal operation, no program running
- **RED (solid)**: Program executing from RAM
- **RED (blinking)**: Program running (heartbeat)
- **GREEN (solid)**: Location programming successful
- **PURPLE (blinking)**: Location programming in progress
- **BLUE (blinking)**: Upload process starting
- **RED (rapid blinks)**: Error occurred

#### FT260 Bridge Status:
- **Brief flash**: I2C command processed
- **Built-in LED**: Activity indicator (if available)

### 4. FT260 USB-I2C Bridge Emulation

#### HID Report Structure
The emulator handles standard FT260 HID reports:

| Report ID | Direction | Purpose |
|-----------|-----------|---------|
| 0xA1 | Feature | Configuration commands |
| 0xC0 | Feature | Status queries |
| 0xC2 | Output/Input | I2C Read operations |
| 0xD0 | Output | I2C Write operations |

#### I2C Operation Handling

**Read Operations (Report 0xC2):**
```python
def handle_output_report_c2(self, data):
    i2c_addr = data[0]
    bytes_to_read = data[2] | (data[3] << 8)
    
    # Perform I2C read with shared bus
    read_buffer = bytearray(bytes_to_read)
    i2c.readfrom_into(i2c_addr, read_buffer)
    
    # Send response back to host
    self.send_input_report(0xC2, response_data)
```

**Write Operations (Report 0xD0):**
```python
def handle_output_report_d0(self, data):
    i2c_addr = data[0]
    byte_count = data[2]
    write_data = data[3:3+byte_count]
    
    # Perform I2C write with shared bus
    i2c.writeto(i2c_addr, bytes(write_data))
```

#### Bus Sharing Protocol
```python
def safe_i2c_operation():
    # Acquire I2C bus lock
    while not i2c.try_lock():
        time.sleep(0.001)
    
    try:
        # Perform operation
        result = i2c_operation()
    finally:
        # Always release lock
        i2c.unlock()
```

### 5. Intel HEX File Parsing

The core FXCore functionality revolves around parsing Intel HEX format files, which contain compiled FXCore programs.

#### HEX Record Structure
Each line in the hex file follows Intel HEX format:
```
:LLAAAATTDD...CC
```
- **LL**: Byte count (data length)
- **AAAA**: 16-bit address
- **TT**: Record type (00=data, 01=end of file)
- **DD...**: Data bytes
- **CC**: Checksum

#### Memory Mapping
The parser extracts data into different memory regions:

| Address Range | Purpose | Size |
|---------------|---------|------|
| 0x0000-0x07FF | MREG (Memory Registers) | 512 bytes |
| 0x0800-0x0FFF | CREG (Control Registers) | 64 bytes |
| 0x1000-0x17FF | SFR (Special Function Registers) | 50 bytes |
| 0x1800+ | Program Instructions | Variable |

#### Parsing Process

1. **Line Validation**: Checks hex record format and length
2. **Checksum Verification**: Ensures data integrity
3. **Address Sorting**: Organizes data by memory regions
4. **Gap Filling**: Fills missing addresses with zeros
5. **Instruction Conversion**: Converts program data to 32-bit instructions

```python
def read_fxcore_hex_file():
    # Parse each line as Intel HEX record
    for line in lines:
        byte_count = int(line[1:3], 16)
        address = int(line[3:7], 16)
        record_type = int(line[7:9], 16)
        # ... extract and validate data
```

### 6. I2C Communication Protocol

#### Programming Mode
Before uploading data, the FXCore must enter programming mode:

```python
def enter_prog_mode():
    command = bytes([0xA5, 0x5A, FXCORE_ADDRESS])
    i2c.writeto(FXCORE_ADDRESS, command)
```

#### Data Transfer Commands
Different data types use specific command prefixes:

| Data Type | Command | Format |
|-----------|---------|--------|
| CREG | 0x01 0x0F | 64 bytes + checksum |
| SFR | 0x02 0x0B | 50 bytes + checksum |
| MREG | 0x04 0xFF | 512 bytes + checksum |
| Program | 0x08XX | Variable length + checksum |
| Execute RAM | 0x0D 0x00 | Execute uploaded program |
| Write Flash | 0x0C 0xXX | Write to flash location XX |
| Return to State 0 | 0x0E 0x00 | Stop execution |

#### Transfer Strategy
The system attempts single large transfers first, falling back to chunked transfers if needed:

```python
def send_i2c_data(data, description):
    try:
        # Try single transfer
        i2c.writeto(FXCORE_ADDRESS, data)
    except OSError:
        # Fallback to chunked transfer
        for chunk in chunks(data, 32):
            i2c.writeto(FXCORE_ADDRESS, chunk)
```

### 7. Upload Sequence

#### RAM Execution (output.hex)
The data must be uploaded in a specific order:

1. **Enter Programming Mode**
2. **Upload Control Registers (CREG)** - 64 bytes + checksum
3. **Upload Memory Registers (MREG)** - 512 bytes + checksum  
4. **Upload Special Function Registers (SFR)** - 50 bytes + checksum
5. **Upload Program Instructions** - Variable length + checksum
6. **Execute from RAM**

#### Flash Programming (0.hex - F.hex)
For flash location programming:

1. **Enter Programming Mode**
2. **Upload all data arrays (CREG, MREG, SFR, Program)**
3. **Write to Flash Location** (0x0 through 0xF)
4. **Return to State 0**
5. **Exit Programming Mode**

### 8. Checksum Calculation

Data integrity is ensured through checksums:

```python
def calculate_checksum(data):
    return sum(data) & 0xFFFF

def verify_hex_checksum(record_bytes):
    total_sum = sum(record_bytes) & 0xFF
    return total_sum == 0  # Intel HEX checksum verification
```

### 9. Program Execution Control

#### Starting Execution
```python
def execute_from_ram():
    return send_command([0x0D, 0x00], "EXEC_FROM_RAM")
```

#### Stopping Execution
```python
def send_return_0():
    return send_command([0x0E, 0x00], "RETURN_0")
```

#### Flash Programming
```python
def write_to_flash_location(location):
    return send_command([0x0C, location], f"WRITE_PRG to location {location:X}")
```

## Main Control Loop

The system runs a continuous monitoring loop with mode arbitration:

```python
def main():
    running = False
    ft260_active = False
    
    while True:
        # Process FT260 emulation (highest priority)
        ft260_processed = ft260.process_reports()
        
        # Check for FT260 timeout
        ft260_active = ft260.check_timeout()
        
        # Only process FXCore if FT260 is inactive
        if not ft260_active:
            # Check for location files (0.hex - F.hex)
            process_location_programming()
            
            # Check for RAM execution (output.hex)
            hex_exists = check_hex_file_exists()
            
            if hex_exists and not running:
                run_ram_execution()
                running = True
            elif not hex_exists and running:
                stop_execution()
                running = False
```

## Firmware Variants

### HID + Disk Mode (Full Functionality)
- **USB Endpoints**: HID + Mass Storage
- **Features**: FXCore programming + FT260 bridge
- **Use Case**: Development and general I2C debugging
- **File**: `SANDBOXFX_DISK_HID.uf2`

### Disk-Only Mode (Programming Only)
- **USB Endpoints**: Mass Storage only
- **Features**: FXCore programming only
- **Use Case**: Dedicated FXCore development
- **File**: `SANDBOXFX_DISK.uf2`

## Error Handling

### File Validation
- Checks file existence and content
- Validates hex record format and checksums
- Handles missing or corrupted data

### I2C Communication
- Retry mechanisms for failed transfers
- Graceful degradation to chunked transfers
- Timeout handling and recovery
- Bus arbitration between modes

### State Management
- Ensures proper programming mode entry/exit
- Maintains consistent system state
- Recovery from unexpected errors
- Mode switching coordination

## Key Features

### 1. **Dual Mode Operation**
- Seamless switching between FXCore and bridge modes
- Priority-based I2C bus arbitration
- Automatic timeout management

### 2. **FT260 Compatibility**
- Standard FT260 HID report protocol
- Compatible with existing FT260 software
- No driver installation required

### 3. **Enhanced Programming**
- RAM execution and flash location programming
- Multiple file monitoring (output.hex, 0.hex-F.hex)
- Comprehensive status indication

### 4. **Robust Data Transfer**
- Multiple transfer strategies (single/chunked)
- Comprehensive error checking
- Data integrity verification

### 5. **Visual Feedback**
- Clear status indication through NeoPixel
- Different patterns for different states and modes

### 6. **Memory Management**
- Proper handling of different memory regions
- Gap filling and padding as needed
- Efficient data organization

### 7. **Protocol Compliance**
- Correct Intel HEX parsing
- Proper I2C command sequencing
- FXCore-specific communication protocol
- FT260 HID report compatibility

## Usage Workflows

### FXCore Programming Workflow

#### RAM Execution:
1. **System Startup**: LED off, normal operation mode
2. **File Detection**: Place `output.hex` in root directory of `CIRCUITPY` volume
3. **Upload Process**: Blue LED blinks, data transfers to FXCore
4. **Execution**: Red LED indicates program running
5. **Stop Program**: Delete `output.hex` file or write empty file
6. **Return to Normal**: LED turns off, system ready for next program

#### Flash Programming:
1. **Create Location File**: Place `X.hex` (where X = 0-F) in root directory
2. **Programming Process**: Purple LED blinks during flash write
3. **Completion**: Green LED shows success, then turns off
4. **Persistent Storage**: Program remains in flash after power cycle

### FT260 Bridge Workflow
1. **Launch I2C Software**: Use any FT260-compatible FXCore programming application
2. **Automatic Detection**: Bridge mode activates when USB commands received
3. **I2C Operations**: Read/write I2C devices through USB interface
4. **Timeout**: Bridge mode deactivates after 10 seconds of inactivity
5. **Return to FXCore**: System resumes FXCore monitoring automatically

This system provides a comprehensive interface for FXCore development and general I2C debugging, allowing developers to focus on audio programming while the uploader handles the complex details of hex parsing, I2C communication, program execution management, and USB bridge functionality.