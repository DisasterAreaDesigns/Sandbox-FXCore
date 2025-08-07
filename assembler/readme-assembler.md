# FXCore Assembler JavaScript Application

## Overview

This JavaScript application is a complete port of the FXCore Command Line Assembler from C# to JavaScript, designed to run in web browsers. The FXCore is a digital signal processing (DSP) chip that requires assembly language programs to be compiled into machine code and formatted for programming via I2C interface.

The application provides a web-based interface for assembling FXCore assembly language source files (`.fxc` or `.fxo` files) into Intel HEX format output files that can be used to program FXCore chips.

## Core Components

### 1. Main Program Entry Point (`program.js`)

The `Program` class serves as the main entry point and orchestrates the entire assembly process:

**Key Features:**

* File handling and validation
* Assembly pipeline coordination
* HEX file generation
* Error handling and reporting

**Main Process Flow:**
```javascript
static main(args) → static Asm_it() → static Write_hex_file()
```

**Web Integration:**

The `FXCoreAssembler` class provides the browser interface:

* Drag-and-drop file upload
* Real-time logging display
* Download functionality for generated HEX files
* File validation (accepts `.fxc` and `.fxo` extensions)

### 2. Assembly Engine (`assembler.js`)

The `Assembler` class is the core compilation engine that converts FXCore assembly language into machine code.

**Two-Pass Assembly Process:**

#### First Pass:

- **Tokenization**: Breaks source code into meaningful tokens
- **Label Collection**: Identifies and stores jump labels with their program counter (PC) addresses
- **Instruction Parsing**: Processes mnemonics and their parameters
- **Comment Handling**: Supports both line comments (`;`, `//`) and block comments (`/* */`)

#### Second Pass:

- **Parameter Resolution**: Resolves symbolic references, mathematical expressions, and register names
- **Machine Code Generation**: Converts instructions to 32-bit machine code format
- **Validation**: Ensures all parameters are within valid ranges

**Instruction Format:**

FXCore uses a 32-bit instruction format:
- **I Field (31-24)**: Instruction opcode
- **R Field (23-16)**: Register parameter (8-bit)
- **M Field (15-0)**: Memory/immediate parameter (16-bit)

**Advanced Features:**

- **Mathematical Expression Evaluation**: Uses Shunting Yard algorithm for complex expressions
- **Symbol Resolution**: Multi-pass resolution for interdependent symbols
- **Register Aliasing**: Support for custom register names via `.RN` directives

### 3. Symbol Table Management (`symbol_table.js`)

The `SymbolTable` class manages all symbolic references and directives in the assembly code.

**Supported Directives:**

- `.EQU`: Defines constants and symbolic values
- `.CREG`: Sets core register presets
- `.MREG`: Sets memory register presets  
- `.SREG`: Sets special function register presets
- `.MEM`: Allocates memory blocks with automatic address assignment
- `.RN`: Creates register aliases

**Symbol Resolution Process:**

1. **Collection**: First pass collects all symbol definitions
2. **Validation**: Checks for conflicts with reserved words and register names
3. **Resolution**: Multi-pass resolution handles dependencies between symbols
4. **Mathematical Expressions**: Evaluates complex mathematical expressions involving symbols

**Memory Management:**

The `.MEM` directive creates three symbols:

- `SYMBOL`: Write address
- `SYMBOL#`: Read address (write address + size)
- `SYMBOL!`: Memory block size

### 4. IC Communication Protocol (`fxcore_ic.js`)

The `FXCoreIC` class generates the byte arrays from the assembled machine code.  These bytes are later assembled into the Intel HEX format files used for upload to the FXCore IC.

**Important:**  All I2C / two-wire serial communication is handled outside this application.  The FXCore_IC class contains references to this communication but these functions are not used

**Command Generation (all deprecated):**

- **ENTER_PRG**: Enter programming mode
- **SEND_CREG/MREG/SFR**: Send register data
- **SEND_PRG**: Send program code
- **WRITE_PRG**: Write to program memory
- **EXEC_RAM**: Execute program from RAM
- **EXIT_PRG**: Exit programming mode

**Data Formatting:**

- **Little-endian byte ordering**: All multi-byte values stored with LSB first
- **Checksum calculation**: 16-bit additive checksum for data integrity
- **Register packing**: Special handling for POT values (5-bit fields packed into 32-bit words)

**Register Data Building:**

- **MREG**: All memory registers (variable count)
- **CREG**: Only settable core registers (filtered automatically)
- **SFR**: Fixed format with special packing for POT, LFO, and tempo values

## Assembly Language Features

### Instruction Format
```assembly
LABEL:  MNEMONIC  PARAMETER1, PARAMETER2, ...
```

### Parameter Types
- **Immediate Values**: `#1234`, `0x1A2B`, `0b1010_1100`
- **Registers**: `R0`, `MR5`, `SR10`
- **Memory Addresses**: `DELAY_LINE`, `COEFFS`
- **Mathematical Expressions**: `FREQ*2+1`, `SIZE-1`
- **Split Values**: `CONSTANT.L`, `CONSTANT.U` (lower/upper 16 bits)

### Mathematical Expression Support
The assembler supports complex mathematical expressions using standard operator precedence:

- **Operators**: `+`, `-`, `*`, `/`, `^`, `|`, `&`, `<<`, `>>`
- **Parentheses**: For grouping operations
- **Variable Substitution**: Symbols and register names can be used in expressions

### Register System
FXCore has three register types:

- **Core Registers (CREG)**: General-purpose computation registers
- **Memory Registers (MREG)**: Address and control registers for memory operations
- **Special Function Registers (SFR)**: Hardware control registers

## Debug System

The application includes a comprehensive debug system with multiple logging levels:

**Debug Categories:**

- `verbose`: General assembly progress
- `symbols`: Symbol table operations
- `registers`: Register processing
- `machineCode`: Machine code generation
- `expressions`: Mathematical expression evaluation
- `parameters`: Parameter resolution details

**Usage:**
Debug output is controlled via the global `DEBUG` configuration and provides detailed tracing of the assembly process for troubleshooting.

## Output Format

### Intel HEX File Structure
The generated HEX file contains four sections at different memory addresses:

1. **MREG Section** (Address 0x0000): Memory register presets
2. **CREG Section** (Address 0x0800): Core register presets  
3. **SFR Section** (Address 0x1000): Special function register presets
4. **Program Code** (Address 0x1800): Assembled instructions

Each section includes a 16-bit checksum for data integrity verification.

## Error Handling

The application provides comprehensive error reporting:

- **Syntax Errors**: Invalid mnemonics, parameter mismatches
- **Symbol Errors**: Undefined symbols, circular references
- **Range Errors**: Parameters outside valid ranges
- **Register Errors**: Invalid register names or types
- **Memory Errors**: Memory allocation conflicts

Errors are reported to the message area between the input and output sections.

## Browser Compatibility

The application is designed to run in modern web browsers and includes:

- **File API**: For reading uploaded assembly files
- **Drag-and-Drop**: Intuitive file selection
- **Download API**: For saving generated HEX files
- **ES6+ Features**: Modern JavaScript syntax and features

**Note:  File selection API used for direct device programming is not supported in all browsers.  The application will warn the user if this is not supported.**

## Usage Workflow

1. **File Selection**: Upload a `.fxc` or `.fxo` assembly source file, or enter valid FXCore assembly language into the text editor window.
2. **Assembly**: Click "Assemble" to begin processing.
3. **Verification**: Review the log output for any errors or warnings
4. **Programming Setup**: Press the "Select Output Directory" button to choose the location of the programming hardware, typically this is a removable volume labeled `CIRCUITPY`.
5. **Device Programming**: Press the "Download Hex" button to save the assembled code to the programming hardware.  Press the "Clear Hardware" button to clear the programming hardware and return it to normal operation.

This JavaScript port maintains full compatibility with the original C# assembler while providing a convenient web-based interface for FXCore development workflows.