# FXCore Sandbox Hardware Programming Interface Documentation

## Overview

This Python script is designed to run on a RP2040 microcontroller and serves as an interface between hex files and an FXCore audio processor. The system automatically uploads compiled programs to the FXCore via I2C communication and executes them from RAM, with visual status indication through a NeoPixel LED.

## System Architecture

### Hardware Components
- **Microcontroller**: Waveshare RP2040 Zero (or compatible CircuitPython board)
- **FXCore**: Audio processing chip at I2C address `0x30`
- **NeoPixel LED**: Status indicator on GPIO pin 16
- **I2C Bus**: GP0 (SDA) and GP1 (SCL)

### File-Based Control
The system monitors for the presence of `output.hex` file:
- **File present**: Uploads and executes the program
- **File deleted**: Stops execution and returns to normal operation

## Core Components

### 1. Hardware Initialization

```python
# I2C bus setup on GP0 (SDA) and GP1 (SCL)
i2c = busio.I2C(scl=board.GP1, sda=board.GP0)

# NeoPixel LED on GP16
pixel = neopixel.NeoPixel(NEOPIXEL_PIN, NUM_PIXELS, brightness=0.3)
```

The system initializes I2C communication and a single NeoPixel LED for status indication.

### 2. Status LED System

The NeoPixel provides visual feedback:
- **OFF**: Normal operation, no program running
- **RED (solid)**: Program executing from RAM
- **RED (blinking)**: Program running (heartbeat)
- **BLUE (blinking)**: Upload process starting
- **RED (rapid blinks)**: Error occurred

### 3. Intel HEX File Parsing

The core functionality revolves around parsing Intel HEX format files, which contain compiled FXCore programs.

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

### 4. I2C Communication Protocol

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

### 5. Upload Sequence

The data must be uploaded in a specific order:

1. **Enter Programming Mode**
2. **Upload Control Registers (CREG)** - 64 bytes + checksum
3. **Upload Memory Registers (MREG)** - 512 bytes + checksum  
4. **Upload Special Function Registers (SFR)** - 50 bytes + checksum
5. **Upload Program Instructions** - Variable length + checksum
6. **Execute from RAM**

### 6. Checksum Calculation

Data integrity is ensured through checksums:

```python
def calculate_checksum(data):
    return sum(data) & 0xFFFF

def verify_hex_checksum(record_bytes):
    total_sum = sum(record_bytes) & 0xFF
    return total_sum == 0  # Intel HEX checksum verification
```

### 7. Program Execution Control

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

## Main Control Loop

The system runs a continuous monitoring loop:

```python
def main():
    running = False
    while True:
        hex_exists = check_hex_file_exists()
        
        if hex_exists and not running:
            # Start program execution
            run_ram_execution()
            running = True
            
        elif not hex_exists and running:
            # Stop execution
            stop_execution()
            running = False
            
        elif running:
            # Blink LED to show running status
            # Continue execution
```

## Error Handling

### File Validation
- Checks file existence and content
- Validates hex record format and checksums
- Handles missing or corrupted data

### I2C Communication
- Retry mechanisms for failed transfers
- Graceful degradation to chunked transfers
- Timeout handling and recovery

### State Management
- Ensures proper programming mode entry/exit
- Maintains consistent system state
- Recovery from unexpected errors

## Key Features

### 1. **Automatic Operation**
- File-based control eliminates need for manual intervention
- Continuous monitoring for file changes

### 2. **Robust Data Transfer**
- Multiple transfer strategies (single/chunked)
- Comprehensive error checking
- Data integrity verification

### 3. **Visual Feedback**
- Clear status indication through NeoPixel
- Different patterns for different states

### 4. **Memory Management**
- Proper handling of different memory regions
- Gap filling and padding as needed
- Efficient data organization

### 5. **Protocol Compliance**
- Correct Intel HEX parsing
- Proper I2C command sequencing
- FXCore-specific communication protocol

## Usage Workflow

1. **System Startup**: LED off, normal operation mode.
2. **File Detection**: Place `output.hex` in root directory of the `CIRCUITPY` volume.
3. **Upload Process**: Blue LED blinks, data transfers to FXCore.
4. **Execution**: Red LED indicates program running
5. **Stop Program**: Delete `output.hex` file. Alternatively, the user can write a zero-byte (empty) `output.hex` file to the `CIRCUITPY` volume.  This allows a web-based programming tool to stop the program since web browsers are not allowed to delete files from the local filesystem.
6. **Return to Normal**: LED turns off, system ready for next program.

This system provides a seamless interface for FXCore development, allowing developers to focus on audio programming while the uploader handles the complex details of hex parsing, I2C communication, and program execution management.