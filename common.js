/**
 * common.js - JavaScript port of common.cs
 * 
 * Contains common enums, constants, and utility functions for FXCore assembler
 */

// Enums equivalent to C# enums
const paramtypes = {
    none: 'none',           // unused parameter
    creg: 'creg',           // a core register type
    mreg: 'mreg',           // a memory based register type
    sfr: 'sfr',             // a special function register
    addr: 'addr',           // a 15-bit address
    imm1: 'imm1',           // immediate value sizes, integer
    imm4: 'imm4',
    imm5: 'imm5',
    imm6: 'imm6',
    imm16: 'imm16',
    imm8d: 'imm8d',         // immediate value sizes, fixed point decimal S.X format
    imm16d: 'imm16d',
    addroffset: 'addroffset', // 12-bit address offset value
    lf0: 'lf0',             // an lfo number
    rmp: 'rmp'              // a ramp number
};

const paramfield = {
    r: 'r',                 // r field - 8 bits
    m: 'm'                  // m field - 16 bits
};

const readwrite = {
    R: 'R',
    W: 'W',
    RW: 'RW',
    N: 'N'                  // not accessible at all, usually a settable only register
};

const valtype = {
    INT: 'INT',
    DEC: 'DEC',
    EQU: 'EQU',
    HEX: 'HEX',
    BIN: 'BIN'
};

const forcetype = {
    NONE: 0,
    INT: 1
};

const regtypes = {
    creg: 'creg',
    mreg: 'mreg',
    sreg: 'sreg'
};

const TokenType = {
    EQU_DIRECTIVE: 'EQU_DIRECTIVE',
    RN_DIRECTIVE: 'RN_DIRECTIVE',
    MEM_DIRECTIVE: 'MEM_DIRECTIVE',
    CREG_DIRECTIVE: 'CREG_DIRECTIVE',
    MREG_DIRECTIVE: 'MREG_DIRECTIVE',
    SREG_DIRECTIVE: 'SREG_DIRECTIVE',
    HEX: 'HEX',
    BINARY: 'BINARY',
    INT: 'INT',
    DEC: 'DEC',
    LINE_COMMENT: 'LINE_COMMENT',
    LINE_COMMENT_2: 'LINE_COMMENT_2',
    BLOCK_COMMENT_START: 'BLOCK_COMMENT_START',
    BLOCK_COMMENT_END: 'BLOCK_COMMENT_END',
    BLOCK_COMMENT: 'BLOCK_COMMENT',
    LIB_CALL: 'LIB_CALL',
    LIB_NAME: 'LIB_NAME',
    LIB_FUNC_NAME: 'LIB_FUNC_NAME',
    JMP_LABEL: 'JMP_LABEL',
    FUNC: 'FUNC',
    EOL: 'EOL',
    PARAM: 'PARAM',
    BIT_OR: 'BIT_OR',
    BIT_AND: 'BIT_AND',
    ADDITION: 'ADDITION',
    SUBTRACTION: 'SUBTRACTION',
    DASH: 'DASH',
    STAR: 'STAR',
    SLASH: 'SLASH',
    CARET: 'CARET',
    OPEN_PAREN: 'OPEN_PAREN',
    CLOSE_PAREN: 'CLOSE_PAREN',
    SEMICOLON: 'SEMICOLON',
    COLON: 'COLON',
    SPACE: 'SPACE',
    TAB: 'TAB',
    COMMA: 'COMMA',
    SRA: 'SRA',
    SLA: 'SLA',
    LT: 'LT',
    GT: 'GT',
    STRN: 'STRN',
    MNEM: 'MNEM',
    MEMR: 'MEMR',
    MEML: 'MEML',
    EMPTY: 'EMPTY'
};

/**
 * Token class
 */
class Token {
    constructor(type, value) {
        this.Type = type;
        this.Value = value;
    }

    toString() {
        return `${this.Type}: ${this.Value}`;
    }
}

/**
 * Common class with constants and utility functions
 */
class common {
    constructor() {
        // Static-like properties
    }

    // Lists equivalent to C# static lists
    static get Num_Token() {
        return [
            TokenType.HEX,
            TokenType.BINARY,
            TokenType.INT,
            TokenType.DEC
        ];
    }

    static get Math_Op() {
        return [
            TokenType.BIT_OR,
            TokenType.BIT_AND,
            TokenType.ADDITION,
            TokenType.DASH,
            TokenType.STAR,
            TokenType.SLASH,
            TokenType.CARET,
            TokenType.SRA,
            TokenType.SLA,
            TokenType.FUNC
        ];
    }

    // Math operations string
    static get mathops() {
        return "+-*/()^|&<>";
    }

    // Constants
    static get maxparams() { return 8; }        // Maximum number of parameters (corrected from 2)
    static get maxmem() { return 32768; }       // Maximum memory in the system for the user
    static get maxs31() { return 0.999999999534338; }  // Max S.31 bit value
    static get mins31() { return -1.0; }        // Min S.31 bit value
    static get maxaddro() { return 16535; }     // Address offset is 14 bits max
    static get maximm1() { return 1; }
    static get maximm4() { return 15; }
    static get maximm5() { return 31; }
    static get maximm6() { return 63; }
    static get maximm16() { return 65535; }
    static get minimm16() { return -65536; }
    static get basecore() { return 16; }        // Number of basic core registers
    static get basemreg() { return 128; }       // Number of basic memory registers
    static get maxoffset() { return 1023; }     // Largest jump range
    static get maxclks() { return 3000; }       // Maximum number of clocks a program can be
    static get maxins() { return 1024; }        // Maximum number of FXCore instructions
    static get maxutil() { return 3567; }       // Max allowed core utilization

    // Field sizes in bits: instruction field, R field and M field
    static get fieldsize() {
        return [8, 8, 16];
    }

    // Print field sizes for parameter hex values
    static get paramprint() {
        return ["X2", "X4"];
    }

    // Mask values for parameter fields
    static get parammask() {
        return [0x000000FF, 0x0000FFFF];
    }

    /**
     * Common format for error messages
     * @param {string} errormsg - Error message
     * @param {number} linenum - Line number
     * @param {string} linetxt - Line text
     * @returns {boolean} Always returns true
     */
    static code_error(errormsg, linenum, linetxt) {
        const paddedLineNum = linenum.toString().padStart(5, '0');
        console.error(`ERROR: Line number ${paddedLineNum}: "${linetxt}" - ${errormsg}`);
        return true;
    }

    /**
     * General error message
     * @param {string} errormsg - Error message
     * @param {string} linetxt - Line text
     * @returns {boolean} Always returns true
     */
    static gen_error(errormsg, linetxt) {
        console.error(`ERROR: ${linetxt} - ${errormsg}`);
        return true;
    }

    /**
     * Converts a decimal value -1.0 <= thedec < 1.0 to an int in S.31 format
     * @param {number} thedec - Decimal value
     * @returns {number|null} Converted value or null if out of range
     */
    static conS31I32(thedec) {
        if (thedec > common.maxs31) return null;
        if (thedec < common.mins31) return null;
        // Value lies between limits, multiply it to be MSB aligned
        return Math.round(thedec * 2147483647);
    }

    /**
     * Convert immediate 16-bit value
     * @param {number} thedec - Decimal value
     * @returns {number} Converted value
     */
    static conimm16(thedec) {
        if (thedec < -1.0) return 0x00008000;
        if (thedec > 1.0) return 0x00007fff;
        // Value is within limits, convert it
        return Math.round(thedec * 32767);
    }

    /**
     * Convert immediate 16-bit decimal value (strict)
     * @param {number} thedec - Decimal value
     * @returns {number|null} Converted value or null if out of range
     */
    static conimm16d(thedec) {
        if (thedec < -1.0) return null;
        if (thedec >= 1.0) return null;
        // Value is within limits, convert it
        return Math.round(thedec * 32767);
    }

    /**
     * Convert immediate 16-bit from integer
     * @param {number} theint - Integer value
     * @returns {number} Converted value
     */
    static conimm16FromInt(theint) {
        if (theint < 0) return 0; // imm16 is always a positive value < 1.0
        if (theint > 0x7fffffff) return 0x0000ffff;
        // Value is within limits, convert it
        return theint >> 15;
    }

    /**
     * Convert immediate 10-bit value
     * @param {number} thedec - Decimal value
     * @returns {number} Converted value
     */
    static conimm10(thedec) {
        if (thedec < 0) return 0;
        if (thedec > 1.0) return 0x000003ff;
        // Value is within limits, convert it
        return Math.round(thedec * 1023);
    }

    /**
     * Convert immediate 10-bit from integer
     * @param {number} theint - Integer value
     * @returns {number} Converted value
     */
    static conimm10FromInt(theint) {
        if (theint < 0) return 0; // imm10 is always a positive value < 1.0
        if (theint > 0x7fffffff) return 0x000003ff;
        // Value is within limits, convert it
        return theint >> 21;
    }

    /**
     * Convert immediate 10-bit decimal value (signed)
     * @param {number} thedec - Decimal value
     * @returns {number} Converted value
     */
    static conimm10d(thedec) {
        // A S.9 format so might be negative
        if (thedec >= 1.0) return 0x000001ff;
        if (thedec <= -1.0) return 0x00000200;
        // Value is within limits, convert it
        return Math.round(thedec * 511) & 0x000003ff;
    }

    /**
     * Convert immediate 10-bit decimal from integer
     * @param {number} theint - Integer value
     * @returns {number} Converted value
     */
    static conimm10dFromInt(theint) {
        // A S.9 format so might be negative
        if (theint >= 0x00000200) return 0x000001ff;
        if (theint <= 0xfffffe00) return 0x00000200;
        // Value is within limits, convert it
        return theint >> 22;
    }

    /**
     * Convert immediate 6-bit value
     * @param {number} thedec - Decimal value
     * @returns {number} Converted value
     */
    static conimm6(thedec) {
        if (thedec < 0) return 0;
        if (thedec > 1.0) return 0x0000003f;
        // Value is within limits, convert it
        return Math.round(thedec * 63);
    }

    /**
     * Convert immediate 5-bit value
     * @param {number} thedec - Decimal value
     * @returns {number} Converted value
     */
    static conimm5(thedec) {
        if (thedec < 0) return 0;
        if (thedec > 1.0) return 0x0000001f;
        // Value is within limits, convert it
        return Math.round(thedec * 31);
    }

    /**
     * Convert immediate 4-bit value
     * @param {number} thedec - Decimal value
     * @returns {number} Converted value
     */
    static conimm4(thedec) {
        if (thedec < 0) return 0;
        if (thedec > 1.0) return 0x0000000f;
        // Value is within limits, convert it
        return Math.round(thedec * 15);
    }

    /**
     * Convert immediate 1-bit value from decimal
     * @param {number} thedec - Decimal value
     * @returns {number} Converted value
     */
    static conimm1(thedec) {
        if (thedec < 1.0) return 0;
        return 0x00000001;
    }

    /**
     * Convert immediate 1-bit value from integer
     * @param {number} theint - Integer value
     * @returns {number} Converted value
     */
    static conimm1FromInt(theint) {
        if (theint < 0x10000000) return 0;
        return 0x00000001;
    }
}

// Export all constants and classes
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        paramtypes,
        paramfield,
        readwrite,
        valtype,
        forcetype,
        regtypes,
        TokenType,
        Token,
        common
    };
}