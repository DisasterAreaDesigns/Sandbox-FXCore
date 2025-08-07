/**
 * Registers.js - Direct JavaScript port of Registers.cs
 * Faithful port from C# FXCoreAsm.Registers
 */

// Register info structure (equivalent to C# struct reginfo)
class RegInfo {
    constructor() {
        this.altname = "";          // the alternative name, if any, from user code, set as null default
        this.number = 0;           // the register number/address
        this.rw = readwrite.R;     // read, write or r/w
        this.value = "0";          // the string from the source code
        this.valtype = valtype.INT; // type from the source
        this.resolved = false;
        this.setable = false;      // can the register be preset?
        this.resolvedvalue = 0;    // the value, core and mreg are initialized to 0, sfrs may be non-zero
        this.size = 32;           // size, most are 32 but some may be 16. LSB aligned values!!!
        this.ispreset = false;    // true if a preset has been applied from a user program
        this.force = forcetype.NONE; // if we are forced to a type
    }
}

class Registers {
    constructor() {
        this.creg = new Map(); // Dictionary<string, reginfo> creg
        this.mreg = new Map(); // Dictionary<string, reginfo> mreg  
        this.sreg = new Map(); // Dictionary<string, reginfo> sreg

        // Constructor builds the tables
        // MAKE ALL UPPER CASE!!
        let theinfo = new RegInfo();
        
        // Core registers, name and value
        // first the core registers, set common defaults
        theinfo.rw = readwrite.RW;
        theinfo.value = "0";
        theinfo.valtype = valtype.INT;
        theinfo.resolved = true;
        theinfo.resolvedvalue = 0;
        theinfo.setable = true; // R0 - R15 are presetable
        theinfo.size = 32;
        theinfo.force = forcetype.NONE;
        theinfo.altname = "";
        theinfo.ispreset = false;
        
        // loop over quantity and add to creg dictionary
        for (let n = 0; n < common.basecore; n++) {
            const regInfo = new RegInfo();
            Object.assign(regInfo, theinfo);
            regInfo.number = n;
            this.creg.set("R" + n.toString(), regInfo);
        }
        
        // flag register and accumulator, considered core registers but NOT presetable
        theinfo.ispreset = true; // since no user program can preset it
        theinfo.setable = false;
        theinfo.number = 16;
        const acc32Info = new RegInfo();
        Object.assign(acc32Info, theinfo);
        this.creg.set("ACC32", acc32Info);
        
        theinfo.number = 17;
        theinfo.rw = readwrite.R; // flags are read only
        theinfo.size = 16; // only use lower 16 bits
        const flagsInfo = new RegInfo();
        Object.assign(flagsInfo, theinfo);
        this.creg.set("FLAGS", flagsInfo);
        
        //
        // ACC64 not here as it is never used by name always implied by instruction
        //
        
        // Memory based registers, MR0 to MR127
        theinfo.rw = readwrite.RW;
        theinfo.value = "0";
        theinfo.valtype = valtype.INT;
        theinfo.resolved = true;
        theinfo.resolvedvalue = 0;
        theinfo.setable = true; // all mreg are settable
        theinfo.size = 32;
        theinfo.force = forcetype.NONE;
        theinfo.altname = "";
        theinfo.ispreset = false;
        
        for (let n = 0; n < common.basemreg; n++) {
            const regInfo = new RegInfo();
            Object.assign(regInfo, theinfo);
            regInfo.number = n;
            this.mreg.set("MR" + n.toString(), regInfo);
        }
        
        // SFRs
        theinfo.value = "0";
        theinfo.valtype = valtype.INT;
        theinfo.resolved = true;
        theinfo.resolvedvalue = 0;
        theinfo.size = 32;
        theinfo.force = forcetype.NONE;
        theinfo.altname = "";
        
        // SFRs can change have all sorts of different settings so be careful here!
        // ADC inputs are readable only, not setable
        theinfo.rw = readwrite.R;
        theinfo.setable = false;
        theinfo.number = 0;
        const in0Info = new RegInfo();
        Object.assign(in0Info, theinfo);
        this.sreg.set("IN0", in0Info);
        
        theinfo.number = 1;
        const in1Info = new RegInfo();
        Object.assign(in1Info, theinfo);
        this.sreg.set("IN1", in1Info);
        
        theinfo.number = 2;
        const in2Info = new RegInfo();
        Object.assign(in2Info, theinfo);
        this.sreg.set("IN2", in2Info);
        
        theinfo.number = 3;
        const in3Info = new RegInfo();
        Object.assign(in3Info, theinfo);
        this.sreg.set("IN3", in3Info);
        
        // DAC is writable but not settable
        theinfo.rw = readwrite.W;
        theinfo.setable = false;
        theinfo.number = 4;
        const out0Info = new RegInfo();
        Object.assign(out0Info, theinfo);
        this.sreg.set("OUT0", out0Info);
        
        theinfo.number = 5;
        const out1Info = new RegInfo();
        Object.assign(out1Info, theinfo);
        this.sreg.set("OUT1", out1Info);
        
        theinfo.number = 6;
        const out2Info = new RegInfo();
        Object.assign(out2Info, theinfo);
        this.sreg.set("OUT2", out2Info);
        
        theinfo.number = 7;
        const out3Info = new RegInfo();
        Object.assign(out3Info, theinfo);
        this.sreg.set("OUT3", out3Info);
        
        //PIN and SWITCH are read only, not settable
        theinfo.size = 16;   // number of bits
        theinfo.rw = readwrite.R;
        theinfo.setable = false;
        theinfo.number = 8;
        const pinInfo = new RegInfo();
        Object.assign(pinInfo, theinfo);
        this.sreg.set("PIN", pinInfo);
        
        theinfo.number = 9;
        const switchInfo = new RegInfo();
        Object.assign(switchInfo, theinfo);
        this.sreg.set("SWITCH", switchInfo);
        
        //POT K is R/W and settable, only 5 LSBs are used
        theinfo.value = "10";    // default value
        theinfo.resolvedvalue = 10;
        theinfo.size = 5;   // number of bits
        theinfo.rw = readwrite.RW;
        theinfo.setable = true;
        theinfo.number = 10;
        const pot0KInfo = new RegInfo();
        Object.assign(pot0KInfo, theinfo);
        this.sreg.set("POT0_K", pot0KInfo);
        
        theinfo.number = 11;
        const pot1KInfo = new RegInfo();
        Object.assign(pot1KInfo, theinfo);
        this.sreg.set("POT1_K", pot1KInfo);
        
        theinfo.number = 12;
        const pot2KInfo = new RegInfo();
        Object.assign(pot2KInfo, theinfo);
        this.sreg.set("POT2_K", pot2KInfo);
        
        theinfo.number = 13;
        const pot3KInfo = new RegInfo();
        Object.assign(pot3KInfo, theinfo);
        this.sreg.set("POT3_K", pot3KInfo);
        
        theinfo.number = 14;
        const pot4KInfo = new RegInfo();
        Object.assign(pot4KInfo, theinfo);
        this.sreg.set("POT4_K", pot4KInfo);
        
        theinfo.number = 15;
        const pot5KInfo = new RegInfo();
        Object.assign(pot5KInfo, theinfo);
        this.sreg.set("POT5_K", pot5KInfo);
        
        // Raw POT values
        theinfo.size = 13;   // number of bits
        theinfo.rw = readwrite.R;
        theinfo.setable = false;
        theinfo.number = 16;
        const pot0Info = new RegInfo();
        Object.assign(pot0Info, theinfo);
        this.sreg.set("POT0", pot0Info);
        
        theinfo.number = 17;
        const pot1Info = new RegInfo();
        Object.assign(pot1Info, theinfo);
        this.sreg.set("POT1", pot1Info);
        
        theinfo.number = 18;
        const pot2Info = new RegInfo();
        Object.assign(pot2Info, theinfo);
        this.sreg.set("POT2", pot2Info);
        
        theinfo.number = 19;
        const pot3Info = new RegInfo();
        Object.assign(pot3Info, theinfo);
        this.sreg.set("POT3", pot3Info);
        
        theinfo.number = 20;
        const pot4Info = new RegInfo();
        Object.assign(pot4Info, theinfo);
        this.sreg.set("POT4", pot4Info);
        
        theinfo.number = 21;
        const pot5Info = new RegInfo();
        Object.assign(pot5Info, theinfo);
        this.sreg.set("POT5", pot5Info);
        
        // Smoothed POT values
        theinfo.size = 32;   // number of bits
        theinfo.rw = readwrite.R;
        theinfo.setable = false;
        theinfo.number = 22;
        const pot0SmthInfo = new RegInfo();
        Object.assign(pot0SmthInfo, theinfo);
        this.sreg.set("POT0_SMTH", pot0SmthInfo);
        
        theinfo.number = 23;
        const pot1SmthInfo = new RegInfo();
        Object.assign(pot1SmthInfo, theinfo);
        this.sreg.set("POT1_SMTH", pot1SmthInfo);
        
        theinfo.number = 24;
        const pot2SmthInfo = new RegInfo();
        Object.assign(pot2SmthInfo, theinfo);
        this.sreg.set("POT2_SMTH", pot2SmthInfo);
        
        theinfo.number = 25;
        const pot3SmthInfo = new RegInfo();
        Object.assign(pot3SmthInfo, theinfo);
        this.sreg.set("POT3_SMTH", pot3SmthInfo);
        
        theinfo.number = 26;
        const pot4SmthInfo = new RegInfo();
        Object.assign(pot4SmthInfo, theinfo);
        this.sreg.set("POT4_SMTH", pot4SmthInfo);
        
        theinfo.number = 27;
        const pot5SmthInfo = new RegInfo();
        Object.assign(pot5SmthInfo, theinfo);
        this.sreg.set("POT5_SMTH", pot5SmthInfo);
        
        // LFO frequency coefficients
        theinfo.value = "0";    // default value
        theinfo.resolvedvalue = 0;
        theinfo.rw = readwrite.RW;
        theinfo.size = 32;   // number of bits
        theinfo.setable = true;
        theinfo.number = 28;
        const lfo0FInfo = new RegInfo();
        Object.assign(lfo0FInfo, theinfo);
        this.sreg.set("LFO0_F", lfo0FInfo);
        
        theinfo.number = 29;
        const lfo1FInfo = new RegInfo();
        Object.assign(lfo1FInfo, theinfo);
        this.sreg.set("LFO1_F", lfo1FInfo);
        
        theinfo.number = 30;
        const lfo2FInfo = new RegInfo();
        Object.assign(lfo2FInfo, theinfo);
        this.sreg.set("LFO2_F", lfo2FInfo);
        
        theinfo.number = 31;
        const lfo3FInfo = new RegInfo();
        Object.assign(lfo3FInfo, theinfo);
        this.sreg.set("LFO3_F", lfo3FInfo);
        
        // RAMP frequency coefficients
        theinfo.value = "0";    // default value
        theinfo.resolvedvalue = 0;
        theinfo.rw = readwrite.RW;
        theinfo.size = 32;   // number of bits
        theinfo.setable = true;
        theinfo.number = 32;
        const ramp0FInfo = new RegInfo();
        Object.assign(ramp0FInfo, theinfo);
        this.sreg.set("RAMP0_F", ramp0FInfo);
        
        theinfo.number = 33;
        const ramp1FInfo = new RegInfo();
        Object.assign(ramp1FInfo, theinfo);
        this.sreg.set("RAMP1_F", ramp1FInfo);
        
        // LFO SIN and COS registers
        theinfo.rw = readwrite.R;
        theinfo.size = 32;   // number of bits
        theinfo.setable = false;
        theinfo.number = 34;
        const lfo0SInfo = new RegInfo();
        Object.assign(lfo0SInfo, theinfo);
        this.sreg.set("LFO0_S", lfo0SInfo);
        
        theinfo.number = 35;
        const lfo0CInfo = new RegInfo();
        Object.assign(lfo0CInfo, theinfo);
        this.sreg.set("LFO0_C", lfo0CInfo);
        
        theinfo.number = 36;
        const lfo1SInfo = new RegInfo();
        Object.assign(lfo1SInfo, theinfo);
        this.sreg.set("LFO1_S", lfo1SInfo);
        
        theinfo.number = 37;
        const lfo1CInfo = new RegInfo();
        Object.assign(lfo1CInfo, theinfo);
        this.sreg.set("LFO1_C", lfo1CInfo);
        
        theinfo.number = 38;
        const lfo2SInfo = new RegInfo();
        Object.assign(lfo2SInfo, theinfo);
        this.sreg.set("LFO2_S", lfo2SInfo);
        
        theinfo.number = 39;
        const lfo2CInfo = new RegInfo();
        Object.assign(lfo2CInfo, theinfo);
        this.sreg.set("LFO2_C", lfo2CInfo);
        
        theinfo.number = 40;
        const lfo3SInfo = new RegInfo();
        Object.assign(lfo3SInfo, theinfo);
        this.sreg.set("LFO3_S", lfo3SInfo);
        
        theinfo.number = 41;
        const lfo3CInfo = new RegInfo();
        Object.assign(lfo3CInfo, theinfo);
        this.sreg.set("LFO3_C", lfo3CInfo);
        
        // RAMP outputs
        theinfo.rw = readwrite.R;
        theinfo.size = 32;   // number of bits
        theinfo.setable = false;
        theinfo.number = 42;
        const ramp0RInfo = new RegInfo();
        Object.assign(ramp0RInfo, theinfo);
        this.sreg.set("RAMP0_R", ramp0RInfo);
        
        theinfo.number = 43;
        const ramp1RInfo = new RegInfo();
        Object.assign(ramp1RInfo, theinfo);
        this.sreg.set("RAMP1_R", ramp1RInfo);
        
        // Tap tempo related items
        theinfo.size = 32;   // number of bits
        theinfo.value = "0x00007FFF";    // default value
        theinfo.resolvedvalue = 0x00007FFF;
        theinfo.rw = readwrite.RW;
        theinfo.setable = true;
        theinfo.number = 44;
        const maxtempoInfo = new RegInfo();
        Object.assign(maxtempoInfo, theinfo);
        this.sreg.set("MAXTEMPO", maxtempoInfo);
        
        theinfo.value = "0";    // default value
        theinfo.resolvedvalue = 0;
        theinfo.rw = readwrite.R;
        theinfo.setable = true;
        theinfo.number = 45;
        const taptempoInfo = new RegInfo();
        Object.assign(taptempoInfo, theinfo);
        this.sreg.set("TAPTEMPO", taptempoInfo);
        
        // Sample counter
        theinfo.size = 32;   // number of bits
        theinfo.rw = readwrite.R;
        theinfo.setable = false;
        theinfo.number = 46;
        const samplecntInfo = new RegInfo();
        Object.assign(samplecntInfo, theinfo);
        this.sreg.set("SAMPLECNT", samplecntInfo);
        
        // Boot status
        theinfo.size = 32;   // number of bits
        theinfo.rw = readwrite.R;
        theinfo.setable = false;
        theinfo.number = 47;
        const noiseInfo = new RegInfo();
        Object.assign(noiseInfo, theinfo);
        this.sreg.set("NOISE", noiseInfo);
        
        // Boot status
        theinfo.size = 32;   // number of bits
        theinfo.rw = readwrite.R;
        theinfo.setable = false;
        theinfo.number = 48;
        const bootstatInfo = new RegInfo();
        Object.assign(bootstatInfo, theinfo);
        this.sreg.set("BOOTSTAT", bootstatInfo);
        
        // Current program number
        // Removed 1 June 2018, no use to users
        /*
        theinfo.rw = readwrite.R;
        theinfo.size = 16;   // number of bits
        theinfo.setable = false;
        theinfo.number = 116;
        this.sreg.set("CURRPGM", theinfo);
        */
        
        // Tap temp and switch debounce settings
        theinfo.rw = readwrite.N;
        theinfo.size = 16;   // number of bits
        theinfo.value = "0x8ca0";    // default value
        theinfo.resolvedvalue = 0x8ca0;
        theinfo.setable = true;
        theinfo.number = 117;
        const tapstkrldInfo = new RegInfo();
        Object.assign(tapstkrldInfo, theinfo);
        this.sreg.set("TAPSTKRLD", tapstkrldInfo);
        
        //
        theinfo.value = "0x01e0";    // default value
        theinfo.resolvedvalue = 0x01e0;
        theinfo.number = 118;
        const tapdbrldInfo = new RegInfo();
        Object.assign(tapdbrldInfo, theinfo);
        this.sreg.set("TAPDBRLD", tapdbrldInfo);
        
        //
        theinfo.value = "0x01e0";    // default value
        theinfo.resolvedvalue = 0x01e0;
        theinfo.number = 119;
        const swdbrldInfo = new RegInfo();
        Object.assign(swdbrldInfo, theinfo);
        this.sreg.set("SWDBRLD", swdbrldInfo);
        
        //
        theinfo.value = "0x0960";    // default value
        theinfo.resolvedvalue = 0x0960;
        theinfo.number = 120;
        const prgdbrldInfo = new RegInfo();
        Object.assign(prgdbrldInfo, theinfo);
        this.sreg.set("PRGDBRLD", prgdbrldInfo);
        
        //
        theinfo.value = "0x03c0";    // default value
        theinfo.resolvedvalue = 0x03c0;
        theinfo.number = 121;
        const oflrldInfo = new RegInfo();
        Object.assign(oflrldInfo, theinfo);
        this.sreg.set("OFLRLD", oflrldInfo);
        
        // user 0 and user 1 presets, not really SFRs but mapped here for ease
        theinfo.rw = readwrite.N;
        theinfo.value = "0";    // default value
        theinfo.resolvedvalue = 0;
        theinfo.size = 1;   // number of bits
        theinfo.setable = true;
        theinfo.number = 998;
        const usr0Info = new RegInfo();
        Object.assign(usr0Info, theinfo);
        this.sreg.set("USR0", usr0Info);
        
        theinfo.number = 999;
        const usr1Info = new RegInfo();
        Object.assign(usr1Info, theinfo);
        this.sreg.set("USR1", usr1Info);
    }

    whichbank(regbank) {
        if (regbank === regtypes.creg) return this.creg;
        else if (regbank === regtypes.mreg) return this.mreg;
        else if (regbank === regtypes.sreg) return this.sreg;
        else return null;
    }

    // does the register exist based on name?
    isregister(theword, regbank) {
        const thedictionary = this.whichbank(regbank);
        if (thedictionary === null) return false;
        try {
            return thedictionary.has(theword);
        } catch (error) {
            return false;
        }
    }

    // does the register exist based on the number and type, must pass type as number is not unique, only name is unique
    isregisternum(thenum, regbank) {
        const thedictionary = this.whichbank(regbank);
        try {
            for (const [key, value] of thedictionary) {
                if (value.number === thenum) return true;
            }
            return false;
        } catch (error) {
            return false;
        }
    }

    // set the alt name
    setalt(theword, regbank, alt) {
        const thedictionary = this.whichbank(regbank);
        try {
            if (thedictionary === this.creg) {
                if (this.creg.has(theword)) {
                    const thisreg = this.creg.get(theword);
                    thisreg.altname = alt;
                    this.creg.set(theword, thisreg);
                    return true;
                }
            } else if (thedictionary === this.mreg) {
                if (this.mreg.has(theword)) {
                    const thisreg = this.mreg.get(theword);
                    thisreg.altname = alt;
                    this.mreg.set(theword, thisreg);
                    return true;
                }
            } else if (thedictionary === this.sreg) {
                if (this.sreg.has(theword)) {
                    const thisreg = this.sreg.get(theword);
                    thisreg.altname = alt;
                    this.sreg.set(theword, thisreg);
                    return true;
                }
            }
            return false;
        } catch (error) {
            return false;
        }
    }

    // does the register exist based on the altname already?
    isregisteralt(thealt) {
        try {
            for (const [key, value] of this.creg) {
                if (value.altname === thealt) return true;
            }
        } catch (error) {
            return false;
        }
        try {
            for (const [key, value] of this.mreg) {
                if (value.altname === thealt) return true;
            }
        } catch (error) {
            return false;
        }
        try {
            for (const [key, value] of this.sreg) {
                if (value.altname === thealt) return true;
            }
        } catch (error) {
            return false;
        }
        return false;
    }

    // is the register writable?
    iswritable(theword, regbank) {
        if (this.isregister(theword, regbank)) {
            // register exists, check writability
            const thedictionary = this.whichbank(regbank);
            try {
                const value = thedictionary.get(theword);
                if (value.rw === readwrite.RW || value.rw === readwrite.W)
                    return true; // was writable
                else
                    return false;
            } catch (error) {
                return false;
            }
        } else {
            return false; // does not exist so false
        }
    }

    // is the register readable?
    isreadable(theword, regbank) {
        if (this.isregister(theword, regbank)) {
            // register exists, check readability
            const thedictionary = this.whichbank(regbank);
            try {
                const value = thedictionary.get(theword); // if not write only then is readable
                if (value.rw === readwrite.R || value.rw === readwrite.RW)
                    return true; // was readable
                else
                    return false;
            } catch (error) {
                return false;
            }
        } else {
            return false;
        }
    }

    // is the register presetable? check by reg name and type
    issetable(theword, regbank) {
        if (typeof theword === 'string') {
            if (this.isregister(theword, regbank)) {
                // register exists, check setability
                const thedictionary = this.whichbank(regbank);
                try {
                    const value = thedictionary.get(theword);
                    return value.setable;
                } catch (error) {
                    return false;
                }
            } else {
                return false;
            }
        } else {
            // is the register presetable? check by reg number and type
            const thenum = theword;
            const thedictionary = this.whichbank(regbank);
            try {
                for (const [key, value] of thedictionary) {
                    if (value.number === thenum) return value.setable;
                }
                return false;
            } catch (error) {
                return false;
            }
        }
    }

    // update the preset value for a register
    setpreset(regnum, regbank, preset) {
        const thedictionary = this.whichbank(regbank);
        try {
            for (const [key, value] of thedictionary) {
                if (value.number === regnum) {
                    if (!value.ispreset) {
                        const thisreg = thedictionary.get(key);
                        thisreg.resolvedvalue = preset;
                        thisreg.ispreset = true;
                        thedictionary.set(key, thisreg);
                        return true;
                    } else return false;
                }
            }
            return true;
        } catch (error) {
            return false;
        }
    }

    // return if a register has already been preset
    beenpreset(regnum, regbank, preset) {
        const thedictionary = this.whichbank(regbank);
        try {
            for (const [key, value] of thedictionary) {
                if (value.number === regnum) {
                    return value.ispreset;
                }
            }
            return true; // should never get here but compiler was complaining about all paths not returning a value
            // suppose I could get here if the user passed a bad regnum
        } catch (error) {
            return true; // if we cannot find the register tell user it is already set
        }
    }

    // return register bit size
    regsize(regnum, regbank) {
        const thedictionary = this.whichbank(regbank);
        try {
            for (const [key, value] of thedictionary) {
                if (value.number === regnum) {
                    return value.size;
                }
            }
            return 0; // should never get here but compiler was complaining about all paths not returning a value
            // suppose I could get here if the user passed a bad regnum
        } catch (error) {
            return 0; // if we cannot find the register tell user it is already set
        }
    }

    // return the value of a word if it exists, null if not
    // since you cannot normally return a null if a structure is expected we add the ? after the name
    // and that makes the returning structure nullable so we should be able to check for null in the caller
    value(theword, regbank) {
        try {
            const thedictionary = this.whichbank(regbank);
            return thedictionary.get(theword) || null;
        } catch (error) {
            return null;
        }
    }

    // return the value of a word if it exists based on alt name, null if not
    // since you cannot normally return a null if a structure is expected we add the ? after the name
    // and that makes the returning structure nullable so we should be able to check for null in the caller
    altvalue(theword) {
        if (this.altregset(theword) !== null) {
            for (const [key, value] of this.creg) {
                if (value.altname === theword) return value;
            }
            for (const [key, value] of this.mreg) {
                if (value.altname === theword) return value;
            }
            for (const [key, value] of this.sreg) {
                if (value.altname === theword) return value;
            }
            return null;
        }
        return null;
    }

    // as all register names must be unique we can see if a register exists and return which type it is
    // if not found return null
    regset(theword) {
        if (this.creg.has(theword)) {
            return regtypes.creg;
        }
        if (this.mreg.has(theword)) {
            return regtypes.mreg;
        }
        if (this.sreg.has(theword)) {
            return regtypes.sreg;
        }
        return null;
    }

    // as all register alt names must be unique we can see if a register exists and return which type it is
    // if not found return null
    altregset(theword) {
        for (const [key, value] of this.creg) {
            if (value.altname === theword) return regtypes.creg;
        }
        for (const [key, value] of this.mreg) {
            if (value.altname === theword) return regtypes.mreg;
        }
        for (const [key, value] of this.sreg) {
            if (value.altname === theword) return regtypes.sreg;
        }
        return null;
    }

    // return the key of a word if it exists based on the register number and type, null if not
    // since you cannot normally return a null if a structure is expected we add the ? after the name
    // and that makes the returning structure nullable so we should be able to check for null in the caller
    valnum(thenum, regbank) {
        const thedictionary = this.whichbank(regbank);
        try {
            for (const [key, value] of thedictionary) {
                if (value.number === thenum) return key;
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    // return register info based on register number and type
    valreg(thenum, regbank) {
        const thedictionary = this.whichbank(regbank);
        try {
            for (const [key, value] of thedictionary) {
                if (value.number === thenum) return value;
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    checkrange(thenum) {
        if (thenum > common.maxs31) {
            return common.maxs31;
        } else if (thenum < common.mins31) {
            return common.mins31;
        } else return thenum;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Registers, RegInfo };
}