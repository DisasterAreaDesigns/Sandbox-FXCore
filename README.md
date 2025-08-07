# FXCore Sandbox
FXCore Sandbox is a self-contained open-source development platform for the Experimental Noize digital signal processing (DSP) integrated circuit.  

## Background:
The Experimental Noize FXCore IC was developed by Alesis alumnus Frank Thomson with assistance from Olaf Lastname.  FXCore uses the basic operational concepts evolved from Thomson's earlier FV-1 DSP IC, co-designed with the late Keith Barr of Alesis.  The biggest differences between FXCore and FV-1 are the FXCore's expanded command set and faster internal processing.  This allows FXCore to perform 1024 instructions per sample period compared to 128 for FV-1.  FXCore also moves the analog-to-digital and digital-to-analog conversion to an external interface, allowing the designer to choose conversion hardware based on a performance and cost basis.

## History of the FXCore Development Tools:
FXCore uses its own assembly language, distinct from the simpler FV-1 "SpinASM."  It also moves the program storage away from an external serial EEPROM and into the chip itself.  This was a much-requested feature, as the FV-1 has zero code security and anyone with an EEPROM reader can copy code from a commercial device.

Programming FXCore was originally accomplished using an FXCore Eval Board, which uses an FT260 USB-to-I2C bridge and the USB HID interface to communicate with a host PC.  The programming application was available for Windows only and requires Windows 7 or higher.

The user writes code in the editor application, then uses the programming interface in this application to send data to the Eval Board.  The FXCore accepts the new program code and then the user can either program one of the 16 internal memory slots of the FXCore or enter "run from RAM" mode which temporarily executes the program without flashing the memory.

This works fine but is platform dependent and the text editor itself was not well implemented.  Initial releases of the application were also very slow when loading new code, though this was fixed later.

We persuaded Frank to write a command-line version of the assembler, so that it could be called from an external editor.  This makes the development tool set program-agnostic but still platform-dependent for Windows only.  We released a package using a portable version of the excellent open-source text editor Notepad++, integrated with syntax highlighting for FXCore ASM and a copy of the CLI assembler.  This then replaced the dedicated SpinASM IDE for offical purposes.

Next, Frank ported the CLI assembler to Mac systems, with versions published for both Intel and Apple Silicon machines.  We then created a set of packages for Sublime Text 3, our preferred editor.  All of these packages are available on the Experimental Noize website as of this writing.

Finally, we are here - a web-based version of the development tool chain.  

Our intention is to create a complete toolchain that can run on any modern computer that interfaces with a high-quality hardware platform for deploying algorithms.  To this end, we have created an open-source assembler that runs in a web browser and a hardware platform that interfaces with an inexpensive RP2040 microcontroller for programming.  The hardware platform may be assembled without the microcontroller for higher-quantity production use, and the RP2040 programmer may be used in conjunction with either a TagConnect programming cable or pin sockets on the PCB for production programming.

## What Did We Do?
First we made a cool assembler and programming interface for the older Spin FV-1 IC.  That impressed Frank Thomson enough to trust us with the source code for the FXCore assembler, which we then ported to Javascript.

We used the same overall page layout and configuration as the FV-1 Sandbox, including the Monaco-based text editor, and then implemented a new programming interface using the same RP2040-based hardware as the FV-1 Sandbox.

Programming is accomplished using the aforementioned RP2040 board - we've used a Waveshare RP2040 Zero for its compact form factor and handy USB-C port, but clones of this part or other variations may also work.  the RP2040 code is implemented in CircuitPython for ease of deployment and modification.  To program a new algorithm on the Sandbox hardware, simply copy an assembled .HEX to the RP2040 CIRCUITPY or SANDBOX removable drive.  Name the program 0.HEX to program algorithm zero, 1.HEX for program 1, and so on up to F.HEX for program 15.  If the source file is named OUTPUT.HEX, the Sandbox will execute the code from RAM and will not flash the EEPROM memory.  Write a zero-byte (empty) file named OUTPUT.HEX to exit run-fron-RAM mode and return to normal operation.

So it's a web app and a pedal.  Hook 'em up and write some code!

## What's In This Repo?
* **Assembler:**  JavaScript Web Application for assembling FXCore programs
* **Firmware**  CircuitPython code for the RP2040 Zero program module
* **test-programs**  Sample FXCore programs.  The web application also includes several examples.
* **Hardware**  (coming soon) Schematic and PCB files for Sandbox pedal hardware

## What Can I Do With All This?
We've released this project and all associated tools under the [MIT License.](https://www.tldrlegal.com/license/mit-license)  This means that you can use the tools and information in this repository for anything you want, as long as you inform your users / customers / clients that you got it from us.  You can modify or change anything here to suit your purposes, and you can make products that you sell for profit.  You can even close your sources, so that what's in your product or project is private.  You just have to credit us as shown in our [license file.](https://github.com/DisasterAreaDesigns/Sandbox-FXCore/blob/main/LICENSE)  An example of what that looks like can be found in our [Third Party Notices](https://github.com/DisasterAreaDesigns/Sandbox-FXCore/blob/main/ThirdPartyNotices.txt) file.

Any projects you create with these tools belong to you.  If you write your own code to process audio with this project, that code is under your copyright and is yours to do with what you wish.  If you use someone else's DSP algorithms, that use will be subject to *their* license terms, and we're not able to help you sort that out.  TL:DR you can do whatever you want with this repo, just give us credit. 

