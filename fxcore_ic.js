/**
 * FXCoreIC.js - Direct 1:1 JavaScript port of FXCoreIC.cs
 * 
 * Class: FXCoreIC : This class takes things like arrays of registers or code and returns 
 * a byte array in the proper order and with checksum attached for sending over
 * I2C to the chip or writing to a HEX file. If a method returns a value it is the data
 * size including the 2 byte checksum.
 * Updated to use global debug system
 */

// Global debug system will be available via debug_config.js
// const { DEBUG, debug } = require('./DebugConfig.js');

class FXCoreIC {
    constructor() {
        // The base commands, some will have counts or other modifications
        this.FXCORE_ENTER_PRG = [0xA5, 0x5A, 0x00];
        this.FXCORE_SEND_CREG = [0x01, 0x0F];
        this.FXCORE_SEND_SFR = [0x02, 0x0B];
        this.FXCORE_SEND_CMB = [0x03, 0x1B];
        this.FXCORE_SEND_MREG = [0x04, 0x00];
        this.FXCORE_SEND_PRG = [0x08, 0x00];
        this.FXCORE_WRITE_PRG = [0x0C, 0x00];
        this.FXCORE_EXEC_RAM = [0x0D, 0x00];
        this.FXCORE_GOTO_ST0 = [0x0E, 0x00];
        this.FXCORE_EXIT_PRG = [0x5A, 0xA5];

        // The size in bytes of the above commands
        this.FXCORE_ENTER_PRG_B = 3;
        this.FXCORE_SEND_CREG_B = 2;
        this.FXCORE_SEND_SFR_B = 2;
        this.FXCORE_SEND_CMB_B = 2;
        this.FXCORE_SEND_MREG_B = 2;
        this.FXCORE_SEND_PRG_B = 2;
        this.FXCORE_WRITE_PRG_B = 2;
        this.FXCORE_EXEC_RAM_B = 2;
        this.FXCORE_GOTO_ST0_B = 2;
        this.FXCORE_EXIT_PRG_B = 2;

        // States
        this.FXCORE_STATE_0 = 0x00;
        this.FXCORE_STATE_1 = 0x08;
        this.FXCORE_STATE_2 = 0x10;

        // Command status
        this.FXCORE_UNKNOWN_COMMAND_ERROR = 0xFF;
        this.FXCORE_INVALID_COMMAND_LENGTH_ERROR = 0xFE;
        this.FXCORE_COMMAND_PARAMETER_RANGE_ERROR = 0xFD;
        this.FXCORE_COMMAND_STATE_ERROR = 0xFC;
        this.FXCORE_CHECKSUM_ERROR = 0x80;
        this.FXCORE_PROGRAM_TOO_LONG_ERROR = 0x4F;
        this.FXCORE_UNKNOWN_ERROR = 0x40;
        this.FXCORE_ERASE_ERROR_1F = 0x1F;
        this.FXCORE_ERASE_ERROR_2F = 0x2F;
        this.FXCORE_ERASE_ERROR_3F = 0x3F;
        this.FXCORE_PROGRAMMING_ERROR_17 = 0x17;
        this.FXCORE_PROGRAMMING_ERROR_27 = 0x27;
        this.FXCORE_PROGRAMMING_ERROR_37 = 0x37;
        this.FXCORE_NO_ERROR = 0x00;
    }

    /**
     * enter_prg(short i2c_addr)
     * i2c_addr : 7-bit I2C address of the FXCore
     * returns a small byte array of the command
     */
    enter_prg(i2c_addr) {
        const the_cmd = new Array(this.FXCORE_ENTER_PRG_B);
        i2c_addr = i2c_addr & 0x007F;  // mask to 7 bits
        the_cmd[0] = this.FXCORE_ENTER_PRG[0];
        the_cmd[1] = this.FXCORE_ENTER_PRG[1];
        the_cmd[2] = i2c_addr;
        
        debug.verbose(`Generated ENTER_PRG command for I2C address 0x${i2c_addr.toString(16).padStart(2, '0')}`, 'FXCORE');
        
        return the_cmd;
    }

    /**
     * dl_creg()
     * returns a small byte array of the command to send CREGs
     */
    dl_creg() {
        const the_cmd = new Array(this.FXCORE_SEND_CREG_B);
        the_cmd[0] = this.FXCORE_SEND_CREG[0];
        the_cmd[1] = this.FXCORE_SEND_CREG[1];
        
        debug.verbose('Generated SEND_CREG command', 'FXCORE');
        
        return the_cmd;
    }

    /**
     * dl_sfr()
     * returns a small byte array of the command to send SFRs
     */
    dl_sfr() {
        const the_cmd = new Array(this.FXCORE_SEND_SFR_B);
        the_cmd[0] = this.FXCORE_SEND_SFR[0];
        the_cmd[1] = this.FXCORE_SEND_SFR[1];
        
        debug.verbose('Generated SEND_SFR command', 'FXCORE');
        
        return the_cmd;
    }

    /**
     * dl_cmb()
     * returns a small byte array of the command to send CREG and SFR as a group
     */
    dl_cmb() {
        const the_cmd = new Array(this.FXCORE_SEND_CMB_B);
        the_cmd[0] = this.FXCORE_SEND_CMB[0];
        the_cmd[1] = this.FXCORE_SEND_CMB[1];
        
        debug.verbose('Generated SEND_CMB command', 'FXCORE');
        
        return the_cmd;
    }

    /**
     * dl_mreg(int num_reg)
     * num_reg : number of registers - 1 that will be sent
     * returns a small byte array of the command
     */
    dl_mreg(num_reg) {
        const the_cmd = new Array(this.FXCORE_SEND_MREG_B);
        num_reg = num_reg & 0x007F;  // mask to 7 bits
        the_cmd[0] = this.FXCORE_SEND_MREG[0];
        the_cmd[1] = num_reg;
        
        debug.verbose(`Generated SEND_MREG command for ${num_reg + 1} registers`, 'FXCORE');
        
        return the_cmd;
    }

    /**
     * dl_prg(int num_inst)
     * num_inst : number of instructions - 1 that will be sent
     * returns a small byte array of the command
     */
    dl_prg(num_inst) {
        const the_cmd = new Array(this.FXCORE_SEND_PRG_B);
        num_inst = num_inst & 0x03FF;  // mask to 10 bits
        the_cmd[0] = this.FXCORE_SEND_PRG[0] | ((num_inst & 0x30) >> 8);
        the_cmd[1] = this.FXCORE_SEND_PRG[0] | (num_inst & 0xFF);
        
        debug.verbose(`Generated SEND_PRG command for ${num_inst + 1} instructions`, 'FXCORE');
        
        return the_cmd;
    }

    /**
     * wr_prg(short prg_slot)
     * prg_slot : which program slot to write programin RAM to
     * returns a small byte array of the command
     */
    wr_prg(prg_slot) {
        const the_cmd = new Array(this.FXCORE_WRITE_PRG_B);
        prg_slot = prg_slot & 0x0F;  // mask to 4 bits
        the_cmd[0] = this.FXCORE_WRITE_PRG[0];
        the_cmd[1] = prg_slot;
        
        debug.verbose(`Generated WRITE_PRG command for slot ${prg_slot}`, 'FXCORE');
        
        return the_cmd;
    }

    /**
     * exec_ram()
     * returns a small byte array of the command to execute RAM program
     */
    exec_ram() {
        const the_cmd = new Array(this.FXCORE_EXEC_RAM_B);
        the_cmd[0] = this.FXCORE_EXEC_RAM[0];
        the_cmd[1] = this.FXCORE_EXEC_RAM[1];
        
        debug.verbose('Generated EXEC_RAM command', 'FXCORE');
        
        return the_cmd;
    }

    /**
     * goto_st0()
     * returns a small byte array of the command to go to state 0
     */
    goto_st0() {
        const the_cmd = new Array(this.FXCORE_GOTO_ST0_B);
        the_cmd[0] = this.FXCORE_GOTO_ST0[0];
        the_cmd[1] = this.FXCORE_GOTO_ST0[1];
        
        debug.verbose('Generated GOTO_ST0 command', 'FXCORE');
        
        return the_cmd;
    }

    /**
     * exit_prg()
     * returns a small byte array of the command to exit programming mode
     */
    exit_prg() {
        const the_cmd = new Array(this.FXCORE_EXIT_PRG_B);
        the_cmd[0] = this.FXCORE_EXIT_PRG[0];
        the_cmd[1] = this.FXCORE_EXIT_PRG[1];
        
        debug.verbose('Generated EXIT_PRG command', 'FXCORE');
        
        return the_cmd;
    }

    /**
     * buildmreg(ref SymbolTable theregs, ref byte[] barray)
     * theregs : reference to a SymbolTable object that holds the MREGs
     * barray : Reference to a byte array to return the results
     * Loops over all the MREGs and puts them in the byte array
     * Since all MREGs are settable we just do all of them
     */
    buildmreg(theregs, barray) {
        // we pass by reference to save memory and time
        let checksum = 0; // calculated checksum
        
        debug.verbose(`Building MREG data: ${theregs.checkreg.mreg.size} registers`, 'FXCORE');
        
        // Show detailed MREG values if registerAccess debug is enabled
        if (DEBUG.shouldLog('registerAccess')) {
            debug.registerAccess('=== MREG BUILD DEBUG ===', 'FXCORE');
            debug.registerAccess(`Total MREG count: ${theregs.checkreg.mreg.size}`, 'FXCORE');
        }
        
        for (let x = 0; x < theregs.checkreg.mreg.size; x++) {
            const regInfo = theregs.checkreg.valreg(x, regtypes.mreg);
            const regValue = regInfo.resolvedvalue;
            
            // Debug output in the same format as your paste - use unsigned hex display
            if (DEBUG.shouldLog('registerAccess')) {
                const unsignedHex = (regValue >>> 0).toString(16).padStart(8, '0').toUpperCase();
                debug.registerAccess(`MR${x}(): 0x${unsignedHex}(${regValue})`, 'FXCORE');
            }
            
            // Write bytes in little-endian format
            barray[x * 4] = regValue & 0x000000ff;
            barray[x * 4 + 1] = (regValue & 0x0000ff00) >> 8;
            barray[x * 4 + 2] = (regValue & 0x00ff0000) >> 16;
            barray[x * 4 + 3] = (regValue & 0xff000000) >> 24;
            
            // Debug the actual bytes being written
            if (DEBUG.shouldLog('registerAccess')) {
                debug.registerAccess(`  Bytes: [${x * 4}]=${(barray[x * 4] & 0xFF).toString(16).padStart(2, '0')} [${x * 4 + 1}]=${(barray[x * 4 + 1] & 0xFF).toString(16).padStart(2, '0')} [${x * 4 + 2}]=${(barray[x * 4 + 2] & 0xFF).toString(16).padStart(2, '0')} [${x * 4 + 3}]=${(barray[x * 4 + 3] & 0xFF).toString(16).padStart(2, '0')}`, 'FXCORE');
            }
        }
        
        // append checksum to code
        checksum = this.calc_checksum(barray, theregs.checkreg.mreg.size * 4);
        barray[theregs.checkreg.mreg.size * 4] = checksum & 0x000000ff;
        barray[theregs.checkreg.mreg.size * 4 + 1] = (checksum & 0x0000ff00) >> 8;
        
        const totalBytes = (theregs.checkreg.mreg.size * 4) + 2;
        
        debug.verbose(`MREG build complete: ${totalBytes} bytes (checksum: 0x${checksum.toString(16).padStart(4, '0')})`, 'FXCORE');
        
        if (DEBUG.shouldLog('registerAccess')) {
            debug.registerAccess(`MREG checksum: 0x${checksum.toString(16).padStart(4, '0')}`, 'FXCORE');
            debug.registerAccess(`MREG total bytes: ${totalBytes}`, 'FXCORE');
            debug.registerAccess('=== END MREG BUILD DEBUG ===', 'FXCORE');
        }
        
        return totalBytes;
    }

    /**
     * buildcreg(ref SymbolTable theregs, ref byte[] barray)
     * theregs : reference to a SymbolTable object that holds the CREGs
     * barray : Reference to a byte array to return the results
     * Loops over all the CREGs
     * Since not all CREGs are settable we count how many are and return it
     */
    buildcreg(theregs, barray) {
        let checksum = 0; // calculated checksum
        let act_reg = 0; // actual number of register to send
        
        debug.verbose('Building CREG data', 'FXCORE');
        
        for (let x = 0; x < theregs.checkreg.creg.size; x++) {
            // only write presettable data to array
            if (theregs.checkreg.issetable(x, regtypes.creg)) {
                const regValue = theregs.checkreg.valreg(x, regtypes.creg).resolvedvalue;
                
                barray[act_reg * 4] = regValue & 0x000000ff;
                barray[act_reg * 4 + 1] = (regValue & 0x0000ff00) >> 8;
                barray[act_reg * 4 + 2] = (regValue & 0x00ff0000) >> 16;
                barray[act_reg * 4 + 3] = (regValue & 0xff000000) >> 24;
                
                debug.registers(`CREG ${x} -> slot ${act_reg}: 0x${(regValue >>> 0).toString(16).padStart(8, '0')}`, 'FXCORE');
                act_reg++;
            }
        }
        
        // append checksum to code
        checksum = this.calc_checksum(barray, act_reg * 4);
        barray[act_reg * 4] = checksum & 0x000000ff;
        barray[act_reg * 4 + 1] = (checksum & 0x0000ff00) >> 8;
        
        const totalBytes = act_reg * 4 + 2;
        debug.verbose(`CREG build complete: ${act_reg} settable registers, ${totalBytes} bytes (checksum: 0x${checksum.toString(16).padStart(4, '0')})`, 'FXCORE');
        
        return totalBytes;
    }

    /**
     * buildsfr(ref SymbolTable theregs, ref byte[] barray)
     * theregs : reference to a SymbolTable object that holds the SFRss
     * barray : Reference to a byte array to return the results
     * SFRs are very different from MREG and CREG, some are combined before sending
     * so no looping here, just straight up build it.
     */
    buildsfr(theregs, barray) {
        let checksum = 0; // calculated checksum
        let pot_word = 0; // easier to make up the word of pot values then break it into bytes since they are 5-bit values
        
        debug.verbose('Building SFR data', 'FXCORE');
        
        // first the POT K values
        pot_word = theregs.checkreg.valreg(10, regtypes.sreg).resolvedvalue & 0x0000001F;
        pot_word = pot_word | ((theregs.checkreg.valreg(11, regtypes.sreg).resolvedvalue & 0x0000001F) << 5);
        pot_word = pot_word | ((theregs.checkreg.valreg(12, regtypes.sreg).resolvedvalue & 0x0000001F) << 10);
        pot_word = pot_word | ((theregs.checkreg.valreg(13, regtypes.sreg).resolvedvalue & 0x0000001F) << 15);
        pot_word = pot_word | ((theregs.checkreg.valreg(14, regtypes.sreg).resolvedvalue & 0x0000001F) << 20);
        pot_word = pot_word | ((theregs.checkreg.valreg(15, regtypes.sreg).resolvedvalue & 0x0000001F) << 25);
        barray[0] = pot_word & 0x000000ff;
        barray[1] = (pot_word & 0x0000ff00) >> 8;
        barray[2] = (pot_word & 0x00ff0000) >> 16;
        barray[3] = (pot_word & 0xff000000) >> 24;
        
        debug.registers(`POT values combined: 0x${pot_word.toString(16).padStart(8, '0')}`, 'FXCORE');
        
        // now LFO and ramp presets
        // LFO 0
        barray[4] = theregs.checkreg.valreg(28, regtypes.sreg).resolvedvalue & 0x000000ff;
        barray[5] = (theregs.checkreg.valreg(28, regtypes.sreg).resolvedvalue & 0x0000ff00) >> 8;
        barray[6] = (theregs.checkreg.valreg(28, regtypes.sreg).resolvedvalue & 0x00ff0000) >> 16;
        barray[7] = (theregs.checkreg.valreg(28, regtypes.sreg).resolvedvalue & 0xff000000) >> 24;
        // LFO 1
        barray[8] = theregs.checkreg.valreg(29, regtypes.sreg).resolvedvalue & 0x000000ff;
        barray[9] = (theregs.checkreg.valreg(29, regtypes.sreg).resolvedvalue & 0x0000ff00) >> 8;
        barray[10] = (theregs.checkreg.valreg(29, regtypes.sreg).resolvedvalue & 0x00ff0000) >> 16;
        barray[11] = (theregs.checkreg.valreg(29, regtypes.sreg).resolvedvalue & 0xff000000) >> 24;
        // LFO 2
        barray[12] = theregs.checkreg.valreg(30, regtypes.sreg).resolvedvalue & 0x000000ff;
        barray[13] = (theregs.checkreg.valreg(30, regtypes.sreg).resolvedvalue & 0x0000ff00) >> 8;
        barray[14] = (theregs.checkreg.valreg(30, regtypes.sreg).resolvedvalue & 0x00ff0000) >> 16;
        barray[15] = (theregs.checkreg.valreg(30, regtypes.sreg).resolvedvalue & 0xff000000) >> 24;
        // LFO 3
        barray[16] = theregs.checkreg.valreg(31, regtypes.sreg).resolvedvalue & 0x000000ff;
        barray[17] = (theregs.checkreg.valreg(31, regtypes.sreg).resolvedvalue & 0x0000ff00) >> 8;
        barray[18] = (theregs.checkreg.valreg(31, regtypes.sreg).resolvedvalue & 0x00ff0000) >> 16;
        barray[19] = (theregs.checkreg.valreg(31, regtypes.sreg).resolvedvalue & 0xff000000) >> 24;
        // RAMP 0
        barray[20] = theregs.checkreg.valreg(32, regtypes.sreg).resolvedvalue & 0x000000ff;
        barray[21] = (theregs.checkreg.valreg(32, regtypes.sreg).resolvedvalue & 0x0000ff00) >> 8;
        barray[22] = (theregs.checkreg.valreg(32, regtypes.sreg).resolvedvalue & 0x00ff0000) >> 16;
        barray[23] = (theregs.checkreg.valreg(32, regtypes.sreg).resolvedvalue & 0xff000000) >> 24;
        // RAMP 1
        barray[24] = theregs.checkreg.valreg(33, regtypes.sreg).resolvedvalue & 0x000000ff;
        barray[25] = (theregs.checkreg.valreg(33, regtypes.sreg).resolvedvalue & 0x0000ff00) >> 8;
        barray[26] = (theregs.checkreg.valreg(33, regtypes.sreg).resolvedvalue & 0x00ff0000) >> 16;
        barray[27] = (theregs.checkreg.valreg(33, regtypes.sreg).resolvedvalue & 0xff000000) >> 24;
        
        debug.registers('LFO and RAMP presets processed', 'FXCORE');
        
        // now tap tempo values
        // MaxTempo
        barray[28] = theregs.checkreg.valreg(44, regtypes.sreg).resolvedvalue & 0x000000ff;
        barray[29] = (theregs.checkreg.valreg(44, regtypes.sreg).resolvedvalue & 0x0000ff00) >> 8;
        barray[30] = (theregs.checkreg.valreg(44, regtypes.sreg).resolvedvalue & 0x00ff0000) >> 16;
        barray[31] = (theregs.checkreg.valreg(44, regtypes.sreg).resolvedvalue & 0xff000000) >> 24;
        // TapTempo
        barray[32] = theregs.checkreg.valreg(45, regtypes.sreg).resolvedvalue & 0x000000ff;
        barray[33] = (theregs.checkreg.valreg(45, regtypes.sreg).resolvedvalue & 0x0000ff00) >> 8;
        barray[34] = (theregs.checkreg.valreg(45, regtypes.sreg).resolvedvalue & 0x00ff0000) >> 16;
        barray[35] = (theregs.checkreg.valreg(45, regtypes.sreg).resolvedvalue & 0xff000000) >> 24;
        // TapStkRld(117) and TapDbRld(118)
        barray[36] = theregs.checkreg.valreg(117, regtypes.sreg).resolvedvalue & 0x000000ff;
        barray[37] = (theregs.checkreg.valreg(117, regtypes.sreg).resolvedvalue & 0x0000ff00) >> 8;
        barray[38] = theregs.checkreg.valreg(118, regtypes.sreg).resolvedvalue & 0x000000ff;
        barray[39] = (theregs.checkreg.valreg(118, regtypes.sreg).resolvedvalue & 0x0000ff00) >> 8;
        // SwDbRld(119) and PrgDbRld  (120)
        barray[40] = theregs.checkreg.valreg(119, regtypes.sreg).resolvedvalue & 0x000000ff;
        barray[41] = (theregs.checkreg.valreg(119, regtypes.sreg).resolvedvalue & 0x0000ff00) >> 8;
        barray[42] = theregs.checkreg.valreg(120, regtypes.sreg).resolvedvalue & 0x000000ff;
        barray[43] = (theregs.checkreg.valreg(120, regtypes.sreg).resolvedvalue & 0x0000ff00) >> 8;
        // OflRld(121), Usr0, Usr1
        barray[44] = theregs.checkreg.valreg(121, regtypes.sreg).resolvedvalue & 0x000000ff;
        barray[45] = (theregs.checkreg.valreg(121, regtypes.sreg).resolvedvalue & 0x0000ff00) >> 8;
        barray[46] = theregs.checkreg.valreg(998, regtypes.sreg).resolvedvalue & 0x00000001;
        barray[46] = ((theregs.checkreg.valreg(999, regtypes.sreg).resolvedvalue & 0x00000001) << 1) | barray[46];
        barray[47] = 0x00;
        
        debug.registers('Tap tempo and user values processed', 'FXCORE');
        
        // append checksum to code
        checksum = this.calc_checksum(barray, 48);
        barray[48] = checksum & 0x000000ff;
        barray[49] = (checksum & 0x0000ff00) >> 8;
        
        debug.verbose(`SFR build complete: 50 bytes (checksum: 0x${checksum.toString(16).padStart(4, '0')})`, 'FXCORE');
        
        return 50; // SFR is a fixed size
    }

    /**
     * buildprg(ref Assembler thecode, ref byte[] barray)
     * thecode : reference to an Assembler object that holds the code
     * barray : Reference to a byte array to return the results
     * Simple loop like MREG but variable length
     */
    buildprg(thecode, barray) {
        let checksum = 0; // calculated checksum
        
        debug.verbose(`Building program data: ${thecode.program.length} instructions`, 'FXCORE');
        
        for (let x = 0; x < thecode.program.length; x++) {
            const machineCode = thecode.program[x].machine;
            
            barray[x * 4] = machineCode & 0x000000ff;
            barray[x * 4 + 1] = (machineCode & 0x0000ff00) >> 8;
            barray[x * 4 + 2] = (machineCode & 0x00ff0000) >> 16;
            barray[x * 4 + 3] = (machineCode & 0xff000000) >> 24;
            
            debug.machineCode(`Instruction ${x}: 0x${(machineCode >>> 0).toString(16).padStart(8, '0')}`, 'FXCORE');
        }
        
        // append checksum to code
        checksum = this.calc_checksum(barray, thecode.program.length * 4);
        barray[thecode.program.length * 4] = checksum & 0x000000ff;
        barray[thecode.program.length * 4 + 1] = (checksum & 0x0000ff00) >> 8;
        
        const totalBytes = thecode.program.length * 4 + 2;
        debug.verbose(`Program build complete: ${totalBytes} bytes (checksum: 0x${checksum.toString(16).padStart(4, '0')})`, 'FXCORE');
        
        return totalBytes;
    }

    /**
     * calc_checksum(barray, count) - Exact port of C# version
     * barray : Byte array to calculate checksum for
     * count : number of bytes to calculate across
     * @returns {number} 16-bit checksum value
     */
    calc_checksum(barray, count) {
        let checksum = 0; // calculated checksum (equivalent to uint in C#)
        
        debug.verbose(`Calculating checksum for ${count} bytes`, 'FXCORE');
        
        for (let x = 0; x < count; x++) {
            // Ensure we're treating barray[x] as unsigned byte (0-255)
            const byteValue = barray[x] & 0xFF;
            checksum = (checksum + byteValue) & 0x0000FFFF; // Mask to 16 bits like C#
        }
        
        debug.verbose(`Calculated checksum: 0x${checksum.toString(16).padStart(4, '0')}`, 'FXCORE');
        
        return checksum;
    }

    /**
     * Get error description from error code
     * @param {number} errorCode - FXCore error code
     * @returns {string} Error description
     */
    getErrorDescription(errorCode) {
        switch (errorCode) {
            case this.FXCORE_NO_ERROR:
                return 'No error';
            case this.FXCORE_UNKNOWN_COMMAND_ERROR:
                return 'Unknown command error';
            case this.FXCORE_INVALID_COMMAND_LENGTH_ERROR:
                return 'Invalid command length error';
            case this.FXCORE_COMMAND_PARAMETER_RANGE_ERROR:
                return 'Command parameter range error';
            case this.FXCORE_COMMAND_STATE_ERROR:
                return 'Command state error';
            case this.FXCORE_CHECKSUM_ERROR:
                return 'Checksum error';
            case this.FXCORE_PROGRAM_TOO_LONG_ERROR:
                return 'Program too long error';
            case this.FXCORE_UNKNOWN_ERROR:
                return 'Unknown error';
            case this.FXCORE_ERASE_ERROR_1F:
            case this.FXCORE_ERASE_ERROR_2F:
            case this.FXCORE_ERASE_ERROR_3F:
                return 'Erase error';
            case this.FXCORE_PROGRAMMING_ERROR_17:
            case this.FXCORE_PROGRAMMING_ERROR_27:
            case this.FXCORE_PROGRAMMING_ERROR_37:
                return 'Programming error';
            default:
                return `Unknown error code: 0x${errorCode.toString(16).padStart(2, '0')}`;
        }
    }

    /**
     * Validate checksum of received data
     * @param {Array} barray - Byte array to validate
     * @param {number} count - Number of data bytes (excluding checksum)
     * @returns {boolean} True if checksum is valid
     */
    validateChecksum(barray, count) {
        if (barray.length < count + 2) {
            debug.error('Array too short for checksum validation', 'FXCORE');
            return false;
        }
        
        const calculatedChecksum = this.calc_checksum(barray, count);
        const receivedChecksum = (barray[count] & 0xFF) | ((barray[count + 1] & 0xFF) << 8);
        
        const isValid = calculatedChecksum === receivedChecksum;
        
        if (isValid) {
            debug.verbose('Checksum validation passed', 'FXCORE');
        } else {
            debug.error(`Checksum validation failed: calculated=0x${calculatedChecksum.toString(16).padStart(4, '0')}, received=0x${receivedChecksum.toString(16).padStart(4, '0')}`, 'FXCORE');
        }
        
        return isValid;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FXCoreIC;
}