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
     * Strip comments from one line of source.
     *
     * The single place that decides what a comment is. ";" and "//" run to end
     * of line and win over "/*" -- a "/*" inside a line comment does not open a
     * block -- and the block state is returned so the caller can carry it to
     * the next line. A block comment is replaced by a space, so it separates
     * the tokens either side of it rather than gluing them together.
     *
     * @param {string} line - One line of source
     * @param {boolean} inBlock - True if a block comment was open on entry
     * @returns {{code:string, inBlock:boolean}}
     */
    static stripComments(line, inBlock) {
        const src = String(line);
        let out = '';
        let i = 0;
        let block = !!inBlock;

        while (i < src.length) {
            if (block) {
                const end = src.indexOf('*/', i);
                if (end === -1) return { code: out, inBlock: true };
                block = false;
                out += ' ';
                i = end + 2;
                continue;
            }
            const ch = src.charAt(i);
            if (ch === ';') break;
            if (ch === '/' && src.charAt(i + 1) === '/') break;
            if (ch === '/' && src.charAt(i + 1) === '*') {
                block = true;
                i += 2;
                continue;
            }
            out += ch;
            i++;
        }
        return { code: out, inBlock: block };
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