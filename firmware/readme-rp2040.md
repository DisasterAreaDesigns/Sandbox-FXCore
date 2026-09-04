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
- **File present at boot**: Uploads and executes the program
- **Location Programming**: Files named `0.hex` through `F.hex` program specific flash locations

Hex files are read once, during startup. Adding one to the CIRCUITPY drive
takes effect at the next reset, and deleting `output.hex` does not stop a
program that is already running -- use "Clear Hardware" in the assembler, which
sends RETURN_0 over the bridge.

#### 2. FT260 Bridge Mode (On-Demand)
- **USB HID Reports**: Handled whenever FT260-compatible software sends I2C commands
- **No Timeout**: The bridge stays available; the inactivity timeout was removed in v4.1
- **Shared I2C Bus**: Uses the same I2C interface, under the bus lock

### File-Based Control
At boot the system looks for hex files:
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

### 2. Sharing the I2C Bus

There is no arbitration between the two modes and none is needed: file
programming happens at boot, before the main loop starts serving the bridge.
Both go through the same lock, which is taken with a deadline rather than spun
on for ever:

```python
def lock_i2c(timeout=I2C_LOCK_TIMEOUT):
    deadline = time.monotonic() + timeout
    while not i2c.try_lock():
        if time.monotonic() > deadline:
            return False
        time.sleep(0.001)
    return True
```

Nothing else on the board takes the lock, so failing to get it means something
has already gone wrong. Every caller reports that and gives up, rather than
leaving the board wedged with nothing on the console to say why.

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
    # One input report carries a count byte and 62 bytes of data, so that is
    # the most a read can return however many the host asks for
    bytes_to_read = min(data[2] | (data[3] << 8), MAX_I2C_READ)
    
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
    # Acquire the I2C bus lock, or report that we could not
    if not lock_i2c():
        return False
    
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
| MREG | 0x04 0x7F | 512 bytes + checksum |
| Program | 0x08XX | Variable length + checksum |
| Execute RAM | 0x0D 0x00 | Execute uploaded program |
| Write Flash | 0x0C 0xXX | Write to flash location XX |
| Return to State 0 | 0x0E 0x00 | Stop execution |

#### Transfer Strategy
Each block goes out as one transfer, and a failure is reported as one:

```python
def send_i2c_data(data, description):
    if not lock_i2c():
        return False
    try:
        i2c.writeto(FXCORE_ADDRESS, data)
        return True
    except OSError as e:
        return False
    finally:
        i2c.unlock()
```

There used to be a chunked fallback here. The FXCore counts the bytes of a
block within one I2C transaction, so 514 bytes sent as seventeen transfers is
not the same message -- the chip sees seventeen short blocks and the checksum
cannot come out. Worse, the fallback reported success whatever came of it, so
an upload that never arrived looked like one that had.

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

After the boot-time file handling, the loop just serves the bridge:

```python
def main():
    # Hex files are handled once, at startup
    output_hex_valid, location_files = find_valid_hex_files()
    for location, filename in location_files.items():
        program_location(location, filename)
    if output_hex_valid:
        running = run_ram_execution()
    
    while True:
        # Serve the bridge, and blink the LED while a program runs from RAM
        ft260_processed = ft260.process_reports()
        if running and (time.monotonic() - last_blink_time >= blink_interval):
            ...
        time.sleep(0.0001 if ft260_processed else 0.001)
```

## The Builds

Two, sharing their FXCore and FT260 code. A fix to one usually belongs in the
other.

### `disk-hid/src/` -- the dev unit, v4.4
- **USB Endpoints**: HID + Mass Storage
- **Features**: FXCore programming + FT260 bridge
- This is the build the assembler talks to

### `production-prog/src/` -- the bench programmer, v4.5
Everything disk-hid does, plus the parts that let it program a unit with no
host attached:
- **SSD1306 OLED**, 128x32, on the *same* I2C bus at `0x3C`
- **SD card**, mounted at `src/sd/`
- **`.prj` project files**: one plain text file naming the hex file for each
  of the sixteen flash slots, so a whole unit goes in one pass

```
# comment lines are ignored
name=My Project Name
0=some_file.hex
1=another_file.hex
A=yet_another.hex
```

The first `.prj` found alphabetically is the one used.

Because the OLED sits on the bus the FXCore code uses, the lock on this build
is genuinely contended -- `displayio` takes it to refresh the panel. That is
what the deadline in `lock_i2c` is for.

A disk-only build and a pair of standalone FT260 emulation scripts used to sit
alongside these. They did nothing disk-hid does not, so they have been removed;
they remain in the history.

No `.uf2` is checked in at the moment. Install CircuitPython on the Pico and
copy the build's `src/` onto the CIRCUITPY drive, or build a fresh image.

## Error Handling

### File Validation
- Checks file existence and content
- Validates hex record format and checksums
- Handles missing or corrupted data

### I2C Communication
- A failed transfer is reported as a failure, not retried into a different one
- The bus lock is taken with a deadline, so a stuck bus is reported rather than hung on
- Both modes go through the same lock

### State Management
- Ensures proper programming mode entry/exit
- Maintains consistent system state
- Recovery from unexpected errors
- Mode switching coordination

## Key Features

### 1. **Dual Mode Operation**
- File programming at boot, bridge service thereafter
- One I2C lock, taken with a deadline

### 2. **FT260 Compatibility**
- Standard FT260 HID report protocol
- Compatible with existing FT260 software
- No driver installation required

### 3. **Enhanced Programming**
- RAM execution and flash location programming
- Multiple file monitoring (output.hex, 0.hex-F.hex)
- Comprehensive status indication

### 4. **Robust Data Transfer**
- One transaction per block, as the FXCore protocol requires
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
4. **No Timeout**: The bridge stays available for as long as the board is powered

This system provides a comprehensive interface for FXCore development and general I2C debugging, allowing developers to focus on audio programming while the uploader handles the complex details of hex parsing, I2C communication, program execution management, and USB bridge functionality.