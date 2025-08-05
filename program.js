/**
 * FXCore Assembler - Direct JavaScript Port of Program.cs
 * Faithful port from C# FXCoreCmdAsm.Program
 */

class Program {
    static filename = '';
    static hexfile = '';

    static main(args) {
        // Some preliminary items like how we handle text and numbers, what OS and CPU, etc.
        // In JavaScript, we don't need to set culture as explicitly as C#
        
        // if no arguments, print error
        if (!args || args.length !== 1) {
            common.gen_error("Must supply source file name only.", "NO_SOURCE/WRONG_NUM_PARAM");
            return 1;
        }

        // at least one argument, last one is almost always the filename
        Program.filename = args[0];

        // In browser environment, we can't check File.Exists the same way
        // This will be handled by the file upload process

        // first get the file name and path, change the extension to the out .lst file, .hex file, etc.
        Program.hexfile = Program.changeExtension(Program.filename, ".hex");

        if (!Program.Asm_it()) {
            common.gen_error("Error assembling program", Program.filename);
            return 1;
        } else {
            return 0;
        }
    }

    static getLinkerTime(assembly) {
        const BuildVersionMetadataPrefix = "+build";
        
        // JavaScript equivalent would be checking build info
        // For now, return current date as default
        return new Date();
    }

    static Asm_it() {
        FXCoreAssembler.logMessage('Starting Asm_it() method', 'info');
        FXCoreAssembler.logMessage(`Source code available: ${FXCoreAssembler.sourceCode ? 'YES' : 'NO'}`, 'info');
        
        const myfxcore = new FXCoreIC();  // declare the IC and its properties
        const data = new Array(4098).fill(0);
        let byte_cnt = 0;

        // symbol table
        const mytable = new SymbolTable(Program.filename);
        FXCoreAssembler.logMessage('SymbolTable created', 'info');
        FXCoreAssembler.logMessage(`mytable.checkreg exists: ${mytable.checkreg ? 'YES' : 'NO'}`, 'info');
        
        if (!mytable.loadTable(FXCoreAssembler.sourceCode)) {
            // if we got a false there was an error in loading/creating the symbol table
            common.gen_error("Error creating symbol table", Program.filename);
            return false;
        }
        FXCoreAssembler.logMessage('SymbolTable loaded', 'info');

        // assemble the code
        FXCoreAssembler.logMessage('Creating Assembler instance', 'info');
        const myasm = new Assembler(Program.filename, mytable);
        FXCoreAssembler.logMessage('Calling assembler.assemble()', 'info');
        
        // Debug: Test basic objects
        // FXCoreAssembler.logMessage(`mytable exists: ${mytable ? 'YES' : 'NO'}`, 'info');
        // FXCoreAssembler.logMessage(`mytable.checkreg exists: ${mytable.checkreg ? 'YES' : 'NO'}`, 'info');
        // if (mytable.checkreg) {
        //     FXCoreAssembler.logMessage(`regset method exists: ${typeof mytable.checkreg.regset}`, 'info');
        //     if (typeof mytable.checkreg.regset === 'function') {
        //         try {
        //             const testResult = mytable.checkreg.regset('IN0');
        //             FXCoreAssembler.logMessage(`Testing register lookup for IN0: ${testResult}`, 'info');
        //         } catch (error) {
        //             FXCoreAssembler.logMessage(`Error testing register lookup: ${error.message}`, 'error');
        //         }
        //     }
        // }
        
        if (!myasm.assemble(FXCoreAssembler.sourceCode)) {
            // if we got a false there was an error in assembly
            common.gen_error("Error assembling code", Program.filename);
            return false;
        }
        
        // write HEX file
        FXCoreAssembler.logMessage('Writing HEX file', 'info');
        FXCoreAssembler.assembledHex = Program.Write_hex_file(myfxcore, mytable, myasm, Program.hexfile);
        FXCoreAssembler.logMessage(`Generated HEX file length: ${FXCoreAssembler.assembledHex ? FXCoreAssembler.assembledHex.length : 'NULL'} characters`, 'info');
        return true;
    }

    static Write_hex_file(myfxcore, mytable, myasm, hex_file) {
        // first write the registers. MREG then CREG then SFRs
        const data = new Array(4098).fill(0); // array to hold data to write, max size is a 1K line program plus 2 checksum bytes
        const hex_array = new Array(64).fill(0); // array to write to hex files
        let saddr = 0; // address to write to
        let dp = 0; // data pointer
        let num_bytes = 0; // number of bytes in an array returned by FXCoreIC methods
        const irec = new IntelHex();
        const sw = new StringWriter();

        // NOTE: We are doing little endian here (LS byte to lower address)

        // write the mreg presets
        saddr = 0; // starting address for mregs, just a random number for now
        num_bytes = myfxcore.buildmreg(mytable, data);  // fill the data array with the data and return the number of bytes including checksum
        FXCoreAssembler.logMessage(`MREG section: ${num_bytes} bytes`, 'info');
        // each record is 64 bytes so break it up
        dp = 0; // reset data pointer
        while (num_bytes >= 64) {
            // Array.Copy equivalent
            for (let i = 0; i < 64; i++) {
                hex_array[i] = data[dp + i];
            }
            // full record, write it
            irec.NewRecord(0, saddr, hex_array, 64);
            irec.Write(sw);
            dp = dp + 64; // update the datapointer
            saddr = saddr + 64; // update the write address
            num_bytes = num_bytes - 64; // decrement the number of bytes
        }
        // if num_bytes != 0 then there are some hanging bytes to write
        if (num_bytes !== 0) {
            for (let i = 0; i < num_bytes; i++) {
                hex_array[i] = data[dp + i];
            }
            irec.NewRecord(0, saddr, hex_array, num_bytes);
            irec.Write(sw);
        }

        // write the creg presets
        dp = 0; // reset the datapointer
        saddr = 2048; // starting address for cregs, just a random number for now
        num_bytes = myfxcore.buildcreg(mytable, data);  // fill the data array with the data and return the number of bytes including checksum
        // each record is 64 bytes so break it up
        while (num_bytes >= 64) {
            for (let i = 0; i < 64; i++) {
                hex_array[i] = data[dp + i];
            }
            // full record, write it
            irec.NewRecord(0, saddr, hex_array, 64);
            irec.Write(sw);
            dp = dp + 64; // update the datapointer
            saddr = saddr + 64; // update the write address
            num_bytes = num_bytes - 64; // decrement the number of bytes
        }
        // if num_bytes != 0 then there are some hanging bytes to write
        if (num_bytes !== 0) {
            for (let i = 0; i < num_bytes; i++) {
                hex_array[i] = data[dp + i];
            }
            irec.NewRecord(0, saddr, hex_array, num_bytes);
            irec.Write(sw);
        }

        // write the sreg presets
        dp = 0; // reset the datapointer
        saddr = 4096; // starting address for sregs, just a random number for now
        num_bytes = myfxcore.buildsfr(mytable, data);  // fill the data array with the data and return the number of bytes including checksum
        // each record is 64 bytes so break it up
        while (num_bytes >= 64) {
            for (let i = 0; i < 64; i++) {
                hex_array[i] = data[dp + i];
            }
            // full record, write it
            irec.NewRecord(0, saddr, hex_array, 64);
            irec.Write(sw);
            dp = dp + 64; // update the datapointer
            saddr = saddr + 64; // update the write address
            num_bytes = num_bytes - 64; // decrement the number of bytes
        }
        // if num_bytes != 0 then there are some hanging bytes to write
        if (num_bytes !== 0) {
            for (let i = 0; i < num_bytes; i++) {
                hex_array[i] = data[dp + i];
            }
            irec.NewRecord(0, saddr, hex_array, num_bytes);
            irec.Write(sw);
        }

        // write the program code
        dp = 0; // reset the datapointer
        saddr = 6144; // starting address for sregs, just a random number for now
        num_bytes = myfxcore.buildprg(myasm, data);  // fill the data array with the data and return the number of bytes including checksum
        // each record is 64 bytes so break it up
        while (num_bytes >= 64) {
            for (let i = 0; i < 64; i++) {
                hex_array[i] = data[dp + i];
            }
            // full record, write it
            irec.NewRecord(0, saddr, hex_array, 64);
            irec.Write(sw);
            dp = dp + 64; // update the datapointer
            saddr = saddr + 64; // update the write address
            num_bytes = num_bytes - 64; // decrement the number of bytes
        }
        // if num_bytes != 0 then there are some hanging bytes to write
        if (num_bytes !== 0) {
            for (let i = 0; i < num_bytes; i++) {
                hex_array[i] = data[dp + i];
            }
            irec.NewRecord(0, saddr, hex_array, num_bytes);
            irec.Write(sw);
        }

        // Create an end of record type-1 record
        irec.NewRecord(1, 0, null, 0);
        irec.Write(sw);
        
        return sw.toString();
    }

    // Utility function for path operations (JavaScript equivalent of Path.ChangeExtension)
    static changeExtension(path, extension) {
        const lastDot = path.lastIndexOf('.');
        if (lastDot === -1) {
            return path + extension;
        }
        return path.substring(0, lastDot) + extension;
    }
}

// StringWriter class to replace C# StreamWriter for string building
class StringWriter {
    constructor() {
        this.content = '';
    }
    
    write(text) {
        this.content += text;
    }
    
    toString() {
        return this.content;
    }
}

// Main FXCore Assembler class for browser integration
class FXCoreAssembler {
    static selectedFile = null;
    static assembledHex = null;
    static sourceCode = null;
    
    static init() {
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');
        
        // Drag and drop functionality
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });
        
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                FXCoreAssembler.handleFileSelect(files[0]);
            }
        });
        
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                FXCoreAssembler.handleFileSelect(e.target.files[0]);
            }
        });
        
        FXCoreAssembler.logMessage('FXCore Assembler ready', 'success');
    }
    
    static selectFile() {
        document.getElementById('fileInput').click();
    }
    
    static handleFileSelect(file) {
        const validExtensions = ['.fxc', '.fxo'];
        const fileName = file.name.toLowerCase();
        const hasValidExtension = validExtensions.some(ext => fileName.endsWith(ext));
        
        if (!hasValidExtension) {
            FXCoreAssembler.logMessage('Error: Invalid file type. Please select a .fxc or .fxo file.', 'error');
            return;
        }
        
        FXCoreAssembler.selectedFile = file;
        document.getElementById('fileName').textContent = file.name;
        document.getElementById('fileSize').textContent = `Size: ${(file.size / 1024).toFixed(2)} KB`;
        document.getElementById('fileInfo').style.display = 'block';
        document.getElementById('processBtn').disabled = false;
        
        FXCoreAssembler.logMessage(`File selected: ${file.name}`, 'info');
    }
    
    static logMessage(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        const logArea = document.getElementById('logArea');
        
        let color = '#00ff00';
        if (type === 'error') color = '#ff6b6b';
        if (type === 'warning') color = '#ffa726';
        if (type === 'success') color = '#4caf50';
        
        logEntry.innerHTML = `<span style="color: #888">[${timestamp}]</span> <span style="color: ${color}">${message}</span>`;
        logArea.appendChild(logEntry);
        logArea.scrollTop = logArea.scrollHeight;
    }
    
    static async assembleFile() {
        if (!FXCoreAssembler.selectedFile) {
            FXCoreAssembler.logMessage('No file selected', 'error');
            return;
        }
        
        try {
            FXCoreAssembler.logMessage('Starting assembly process...', 'info');
            document.getElementById('processBtn').disabled = true;
            
            // Read file content
            FXCoreAssembler.sourceCode = await FXCoreAssembler.readFileContent(FXCoreAssembler.selectedFile);
            FXCoreAssembler.logMessage('File loaded successfully', 'success');
            FXCoreAssembler.logMessage(`Source code length: ${FXCoreAssembler.sourceCode.length} characters`, 'info');
            
            // Set up Program class with filename
            Program.filename = FXCoreAssembler.selectedFile.name;
            
            // Main assembly process (equivalent to Asm_it() in Program.cs)
            if (!Program.Asm_it()) {
                common.gen_error('Error assembling program', Program.filename);
                return;
            }
            
            FXCoreAssembler.logMessage('Assembly complete! Ready to download.', 'success');
            document.getElementById('downloadBtn').style.display = 'inline-block';
            
        } catch (error) {
            FXCoreAssembler.logMessage(`Assembly failed: ${error.message}`, 'error');
            console.error('Assembly error details:', error);
        } finally {
            document.getElementById('processBtn').disabled = false;
        }
    }
    
    static readFileContent(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }
    
    static downloadHex() {
        if (!FXCoreAssembler.assembledHex) {
            FXCoreAssembler.logMessage('No HEX data available', 'error');
            return;
        }
        
        const hexFileName = FXCoreAssembler.selectedFile.name.replace(/\.[^/.]+$/, '.hex');
        const blob = new Blob([FXCoreAssembler.assembledHex], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = hexFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        FXCoreAssembler.logMessage(`Downloaded: ${hexFileName}`, 'success');
    }
}

// Export for use in other modules if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        Program,
        FXCoreAssembler,
        StringWriter
    };
}