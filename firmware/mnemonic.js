/**
 * Mnemonic.js - JavaScript port of Mnemonic.cs
 * 
 * Contains the complete FXCore instruction set definitions
 */

class Asminfo {
    constructor() {
        this.numparam = 0;                    // Number of parameters
        this.theparams = new Array(8).fill('none');  // Parameter types (common.maxparams = 8)
        this.paramrw = new Array(8).fill('R');       // Read/write for each parameter
        this.field = new Array(8).fill('m');         // Which field (r or m) this parameter belongs in
        this.instbase = 0;                    // Instruction base binary value (7 bits MSBs)
        this.xlat = null;                     // Translation string
    }
}

class Mnemonic {
    constructor() {
        this.asmtable = new Map();            // Mnemonic lookup table
        this.mnemax = 0;                      // Length of longest mnemonic
        this.initializeMnemonics();
    }

    initializeMnemonics() {
        // Math Operations
        
        // ABS
        let abs = new Asminfo();
        abs.numparam = 1;
        abs.theparams[0] = 'creg';
        abs.theparams[1] = 'none';
        abs.paramrw[0] = 'R';
        abs.paramrw[1] = 'R';
        abs.field[0] = 'r';
        abs.field[1] = 'm';
        abs.instbase = 0x00;
        this.asmtable.set('ABS', abs);

        // CLRACC64
        let clracc64 = new Asminfo();
        clracc64.numparam = 0;
        clracc64.theparams[0] = 'none';
        clracc64.theparams[1] = 'none';
        clracc64.paramrw[0] = 'R';
        clracc64.paramrw[1] = 'R';
        clracc64.field[0] = 'r';
        clracc64.field[1] = 'm';
        clracc64.instbase = 0x02;
        this.asmtable.set('CLRACC64', clracc64);

        // ADDI
        let addi = new Asminfo();
        addi.numparam = 2;
        addi.theparams[0] = 'creg';
        addi.theparams[1] = 'imm16';
        addi.paramrw[0] = 'R';
        addi.paramrw[1] = 'R';
        addi.field[0] = 'r';
        addi.field[1] = 'm';
        addi.instbase = 0x04;
        this.asmtable.set('ADDI', addi);

        // ADD
        let add = new Asminfo();
        add.numparam = 2;
        add.theparams[0] = 'creg';
        add.theparams[1] = 'creg';
        add.paramrw[0] = 'R';
        add.paramrw[1] = 'R';
        add.field[0] = 'r';
        add.field[1] = 'm';
        add.instbase = 0x06;
        this.asmtable.set('ADD', add);

        // ADDS
        let adds = new Asminfo();
        adds.numparam = 2;
        adds.theparams[0] = 'creg';
        adds.theparams[1] = 'creg';
        adds.paramrw[0] = 'R';
        adds.paramrw[1] = 'R';
        adds.field[0] = 'r';
        adds.field[1] = 'm';
        adds.instbase = 0x08;
        this.asmtable.set('ADDS', adds);

        // ADDSI
        let addsi = new Asminfo();
        addsi.numparam = 2;
        addsi.theparams[0] = 'creg';
        addsi.theparams[1] = 'imm16d';
        addsi.paramrw[0] = 'R';
        addsi.paramrw[1] = 'R';
        addsi.field[0] = 'r';
        addsi.field[1] = 'm';
        addsi.instbase = 0x0A;
        this.asmtable.set('ADDSI', addsi);

        // SUB
        let sub = new Asminfo();
        sub.numparam = 2;
        sub.theparams[0] = 'creg';
        sub.theparams[1] = 'creg';
        sub.paramrw[0] = 'R';
        sub.paramrw[1] = 'R';
        sub.field[0] = 'r';
        sub.field[1] = 'm';
        sub.instbase = 0x0C;
        this.asmtable.set('SUB', sub);

        // SUBS
        let subs = new Asminfo();
        subs.numparam = 2;
        subs.theparams[0] = 'creg';
        subs.theparams[1] = 'creg';
        subs.paramrw[0] = 'R';
        subs.paramrw[1] = 'R';
        subs.field[0] = 'r';
        subs.field[1] = 'm';
        subs.instbase = 0x0E;
        this.asmtable.set('SUBS', subs);

        // SL (Shift Left)
        let sl = new Asminfo();
        sl.numparam = 2;
        sl.theparams[0] = 'creg';
        sl.theparams[1] = 'imm5';
        sl.paramrw[0] = 'R';
        sl.paramrw[1] = 'R';
        sl.field[0] = 'r';
        sl.field[1] = 'm';
        sl.instbase = 0x10;
        this.asmtable.set('SL', sl);

        // SLR (Shift Left Register)
        let slr = new Asminfo();
        slr.numparam = 2;
        slr.theparams[0] = 'creg';
        slr.theparams[1] = 'creg';
        slr.paramrw[0] = 'R';
        slr.paramrw[1] = 'R';
        slr.field[0] = 'r';
        slr.field[1] = 'm';
        slr.instbase = 0x12;
        this.asmtable.set('SLR', slr);

        // SLS (Shift Left Saturated)
        let sls = new Asminfo();
        sls.numparam = 2;
        sls.theparams[0] = 'creg';
        sls.theparams[1] = 'imm5';
        sls.paramrw[0] = 'R';
        sls.paramrw[1] = 'R';
        sls.field[0] = 'r';
        sls.field[1] = 'm';
        sls.instbase = 0x14;
        this.asmtable.set('SLS', sls);

        // SLSR (Shift Left Saturated Register)
        let slsr = new Asminfo();
        slsr.numparam = 2;
        slsr.theparams[0] = 'creg';
        slsr.theparams[1] = 'creg';
        slsr.paramrw[0] = 'R';
        slsr.paramrw[1] = 'R';
        slsr.field[0] = 'r';
        slsr.field[1] = 'm';
        slsr.instbase = 0x16;
        this.asmtable.set('SLSR', slsr);

        // SR (Shift Right)
        let sr = new Asminfo();
        sr.numparam = 2;
        sr.theparams[0] = 'creg';
        sr.theparams[1] = 'imm5';
        sr.paramrw[0] = 'R';
        sr.paramrw[1] = 'R';
        sr.field[0] = 'r';
        sr.field[1] = 'm';
        sr.instbase = 0x18;
        this.asmtable.set('SR', sr);

        // SRR (Shift Right Register)
        let srr = new Asminfo();
        srr.numparam = 2;
        srr.theparams[0] = 'creg';
        srr.theparams[1] = 'creg';
        srr.paramrw[0] = 'R';
        srr.paramrw[1] = 'R';
        srr.field[0] = 'r';
        srr.field[1] = 'm';
        srr.instbase = 0x1A;
        this.asmtable.set('SRR', srr);

        // SRA (Shift Right Arithmetic)
        let sra = new Asminfo();
        sra.numparam = 2;
        sra.theparams[0] = 'creg';
        sra.theparams[1] = 'imm5';
        sra.paramrw[0] = 'R';
        sra.paramrw[1] = 'R';
        sra.field[0] = 'r';
        sra.field[1] = 'm';
        sra.instbase = 0x1C;
        this.asmtable.set('SRA', sra);

        // SRAR (Shift Right Arithmetic Register)
        let srar = new Asminfo();
        srar.numparam = 2;
        srar.theparams[0] = 'creg';
        srar.theparams[1] = 'creg';
        srar.paramrw[0] = 'R';
        srar.paramrw[1] = 'R';
        srar.field[0] = 'r';
        srar.field[1] = 'm';
        srar.instbase = 0x1E;
        this.asmtable.set('SRAR', srar);

        // MACRR (Multiply Accumulate Register Register)
        let macrr = new Asminfo();
        macrr.numparam = 2;
        macrr.theparams[0] = 'creg';
        macrr.theparams[1] = 'creg';
        macrr.paramrw[0] = 'R';
        macrr.paramrw[1] = 'R';
        macrr.field[0] = 'r';
        macrr.field[1] = 'm';
        macrr.instbase = 0x20;
        this.asmtable.set('MACRR', macrr);

        // MACRI (Multiply Accumulate Register Immediate)
        let macri = new Asminfo();
        macri.numparam = 2;
        macri.theparams[0] = 'creg';
        macri.theparams[1] = 'imm16d';
        macri.paramrw[0] = 'R';
        macri.paramrw[1] = 'R';
        macri.field[0] = 'r';
        macri.field[1] = 'm';
        macri.instbase = 0x22;
        this.asmtable.set('MACRI', macri);

        // MACRD (Multiply Accumulate Register Delay)
        let macrd = new Asminfo();
        macrd.numparam = 2;
        macrd.theparams[0] = 'creg';
        macrd.theparams[1] = 'addr';
        macrd.paramrw[0] = 'R';
        macrd.paramrw[1] = 'R';
        macrd.field[0] = 'r';
        macrd.field[1] = 'm';
        macrd.instbase = 0x24;
        this.asmtable.set('MACRD', macrd);

        // MACID (Multiply Accumulate Immediate Delay)
        let macid = new Asminfo();
        macid.numparam = 2;
        macid.theparams[0] = 'imm8d';
        macid.theparams[1] = 'addr';
        macid.paramrw[0] = 'R';
        macid.paramrw[1] = 'R';
        macid.field[0] = 'r';
        macid.field[1] = 'm';
        macid.instbase = 0x26;
        this.asmtable.set('MACID', macid);

        // MACHRR (Multiply Accumulate High Register Register)
        let machrr = new Asminfo();
        machrr.numparam = 2;
        machrr.theparams[0] = 'creg';
        machrr.theparams[1] = 'creg';
        machrr.paramrw[0] = 'R';
        machrr.paramrw[1] = 'R';
        machrr.field[0] = 'r';
        machrr.field[1] = 'm';
        machrr.instbase = 0x28;
        this.asmtable.set('MACHRR', machrr);

        // MACHRI (Multiply Accumulate High Register Immediate)
        let machri = new Asminfo();
        machri.numparam = 2;
        machri.theparams[0] = 'creg';
        machri.theparams[1] = 'imm16d';
        machri.paramrw[0] = 'R';
        machri.paramrw[1] = 'R';
        machri.field[0] = 'r';
        machri.field[1] = 'm';
        machri.instbase = 0x2A;
        this.asmtable.set('MACHRI', machri);

        // MACHRD (Multiply Accumulate High Register Delay)
        let machrd = new Asminfo();
        machrd.numparam = 2;
        machrd.theparams[0] = 'creg';
        machrd.theparams[1] = 'addr';
        machrd.paramrw[0] = 'R';
        machrd.paramrw[1] = 'R';
        machrd.field[0] = 'r';
        machrd.field[1] = 'm';
        machrd.instbase = 0x2C;
        this.asmtable.set('MACHRD', machrd);

        // MACHID (Multiply Accumulate High Immediate Delay)
        let machid = new Asminfo();
        machid.numparam = 2;
        machid.theparams[0] = 'imm8d';
        machid.theparams[1] = 'addr';
        machid.paramrw[0] = 'R';
        machid.paramrw[1] = 'R';
        machid.field[0] = 'r';
        machid.field[1] = 'm';
        machid.instbase = 0x2E;
        this.asmtable.set('MACHID', machid);

        // MULTRR (Multiply Register Register)
        let multrr = new Asminfo();
        multrr.numparam = 2;
        multrr.theparams[0] = 'creg';
        multrr.theparams[1] = 'creg';
        multrr.paramrw[0] = 'R';
        multrr.paramrw[1] = 'R';
        multrr.field[0] = 'r';
        multrr.field[1] = 'm';
        multrr.instbase = 0x30;
        this.asmtable.set('MULTRR', multrr);

        // MULTRI (Multiply Register Immediate)
        let multri = new Asminfo();
        multri.numparam = 2;
        multri.theparams[0] = 'creg';
        multri.theparams[1] = 'imm16d';
        multri.paramrw[0] = 'R';
        multri.paramrw[1] = 'R';
        multri.field[0] = 'r';
        multri.field[1] = 'm';
        multri.instbase = 0x32;
        this.asmtable.set('MULTRI', multri);

        // NEG (Negate)
        let neg = new Asminfo();
        neg.numparam = 1;
        neg.theparams[0] = 'creg';
        neg.theparams[1] = 'none';
        neg.paramrw[0] = 'R';
        neg.paramrw[1] = 'R';
        neg.field[0] = 'r';
        neg.field[1] = 'm';
        neg.instbase = 0x34;
        this.asmtable.set('NEG', neg);

        // LOG2 (Log base 2)
        let log2 = new Asminfo();
        log2.numparam = 1;
        log2.theparams[0] = 'creg';
        log2.theparams[1] = 'none';
        log2.paramrw[0] = 'R';
        log2.paramrw[1] = 'R';
        log2.field[0] = 'r';
        log2.field[1] = 'm';
        log2.instbase = 0x36;
        this.asmtable.set('LOG2', log2);

        // EXP2 (Exponential base 2)
        let exp2 = new Asminfo();
        exp2.numparam = 1;
        exp2.theparams[0] = 'creg';
        exp2.theparams[1] = 'none';
        exp2.paramrw[0] = 'R';
        exp2.paramrw[1] = 'R';
        exp2.field[0] = 'r';
        exp2.field[1] = 'm';
        exp2.instbase = 0x38;
        this.asmtable.set('EXP2', exp2);

        // Copy Operations

        // CPY_CC (Copy Core to Core)
        let cpy_cc = new Asminfo();
        cpy_cc.numparam = 2;
        cpy_cc.theparams[0] = 'creg';
        cpy_cc.theparams[1] = 'creg';
        cpy_cc.paramrw[0] = 'W';
        cpy_cc.paramrw[1] = 'R';
        cpy_cc.field[0] = 'r';
        cpy_cc.field[1] = 'm';
        cpy_cc.instbase = 0x60;
        this.asmtable.set('CPY_CC', cpy_cc);

        // CPY_CM (Copy Core to Memory)
        let cpy_cm = new Asminfo();
        cpy_cm.numparam = 2;
        cpy_cm.theparams[0] = 'creg';
        cpy_cm.theparams[1] = 'mreg';
        cpy_cm.paramrw[0] = 'W';
        cpy_cm.paramrw[1] = 'R';
        cpy_cm.field[0] = 'r';
        cpy_cm.field[1] = 'm';
        cpy_cm.instbase = 0x62;
        this.asmtable.set('CPY_CM', cpy_cm);

        // CPY_CS (Copy Core to SFR)
        let cpy_cs = new Asminfo();
        cpy_cs.numparam = 2;
        cpy_cs.theparams[0] = 'creg';
        cpy_cs.theparams[1] = 'sfr';
        cpy_cs.paramrw[0] = 'W';
        cpy_cs.paramrw[1] = 'R';
        cpy_cs.field[0] = 'r';
        cpy_cs.field[1] = 'm';
        cpy_cs.instbase = 0x64;
        this.asmtable.set('CPY_CS', cpy_cs);

        // CPY_MC (Copy Memory to Core) - Note field swap
        let cpy_mc = new Asminfo();
        cpy_mc.numparam = 2;
        cpy_mc.theparams[0] = 'mreg';
        cpy_mc.theparams[1] = 'creg';
        cpy_mc.paramrw[0] = 'W';
        cpy_mc.paramrw[1] = 'R';
        cpy_mc.field[0] = 'm';
        cpy_mc.field[1] = 'r';
        cpy_mc.instbase = 0x66;
        this.asmtable.set('CPY_MC', cpy_mc);

        // CPY_SC (Copy SFR to Core) - Note field swap
        let cpy_sc = new Asminfo();
        cpy_sc.numparam = 2;
        cpy_sc.theparams[0] = 'sfr';
        cpy_sc.theparams[1] = 'creg';
        cpy_sc.paramrw[0] = 'W';
        cpy_sc.paramrw[1] = 'R';
        cpy_sc.field[0] = 'm';
        cpy_sc.field[1] = 'r';
        cpy_sc.instbase = 0x68;
        this.asmtable.set('CPY_SC', cpy_sc);

        // CPY_CMX (Copy Core to Memory Indexed)
        let cpy_cmx = new Asminfo();
        cpy_cmx.numparam = 2;
        cpy_cmx.theparams[0] = 'creg';
        cpy_cmx.theparams[1] = 'creg';
        cpy_cmx.paramrw[0] = 'W';
        cpy_cmx.paramrw[1] = 'R';
        cpy_cmx.field[0] = 'r';
        cpy_cmx.field[1] = 'm';
        cpy_cmx.instbase = 0x6A;
        this.asmtable.set('CPY_CMX', cpy_cmx);

        // Load/Store Operations

        // RDACC64U (Read Accumulator 64 Upper)
        let rdacc64u = new Asminfo();
        rdacc64u.numparam = 1;
        rdacc64u.theparams[0] = 'creg';
        rdacc64u.theparams[1] = 'none';
        rdacc64u.paramrw[0] = 'W';
        rdacc64u.paramrw[1] = 'R';
        rdacc64u.field[0] = 'r';
        rdacc64u.field[1] = 'm';
        rdacc64u.instbase = 0x80;
        this.asmtable.set('RDACC64U', rdacc64u);

        // RDACC64L (Read Accumulator 64 Lower)
        let rdacc64l = new Asminfo();
        rdacc64l.numparam = 1;
        rdacc64l.theparams[0] = 'creg';
        rdacc64l.theparams[1] = 'none';
        rdacc64l.paramrw[0] = 'W';
        rdacc64l.paramrw[1] = 'R';
        rdacc64l.field[0] = 'r';
        rdacc64l.field[1] = 'm';
        rdacc64l.instbase = 0x82;
        this.asmtable.set('RDACC64L', rdacc64l);

        // LDACC64U (Load Accumulator 64 Upper)
        let ldacc64u = new Asminfo();
        ldacc64u.numparam = 1;
        ldacc64u.theparams[0] = 'creg';
        ldacc64u.theparams[1] = 'none';
        ldacc64u.paramrw[0] = 'R';
        ldacc64u.paramrw[1] = 'R';
        ldacc64u.field[0] = 'r';
        ldacc64u.field[1] = 'm';
        ldacc64u.instbase = 0x84;
        this.asmtable.set('LDACC64U', ldacc64u);

        // LDACC64L (Load Accumulator 64 Lower)
        let ldacc64l = new Asminfo();
        ldacc64l.numparam = 1;
        ldacc64l.theparams[0] = 'creg';
        ldacc64l.theparams[1] = 'none';
        ldacc64l.paramrw[0] = 'R';
        ldacc64l.paramrw[1] = 'R';
        ldacc64l.field[0] = 'r';
        ldacc64l.field[1] = 'm';
        ldacc64l.instbase = 0x86;
        this.asmtable.set('LDACC64L', ldacc64l);

        // RDDEL (Read Delay)
        let rddel = new Asminfo();
        rddel.numparam = 2;
        rddel.theparams[0] = 'creg';
        rddel.theparams[1] = 'addr';
        rddel.paramrw[0] = 'W';
        rddel.paramrw[1] = 'R';
        rddel.field[0] = 'r';
        rddel.field[1] = 'm';
        rddel.instbase = 0x88;
        this.asmtable.set('RDDEL', rddel);

        // WRDEL (Write Delay)
        let wrdel = new Asminfo();
        wrdel.numparam = 2;
        wrdel.theparams[0] = 'addr';
        wrdel.theparams[1] = 'creg';
        wrdel.paramrw[0] = 'W';
        wrdel.paramrw[1] = 'R';
        wrdel.field[0] = 'm';
        wrdel.field[1] = 'r';
        wrdel.instbase = 0x8A;
        this.asmtable.set('WRDEL', wrdel);

        // RDDELX (Read Delay Indexed)
        let rddelx = new Asminfo();
        rddelx.numparam = 2;
        rddelx.theparams[0] = 'creg';
        rddelx.theparams[1] = 'creg';
        rddelx.paramrw[0] = 'W';
        rddelx.paramrw[1] = 'R';
        rddelx.field[0] = 'r';
        rddelx.field[1] = 'm';
        rddelx.instbase = 0x8C;
        this.asmtable.set('RDDELX', rddelx);

        // WRDELX (Write Delay Indexed)
        let wrdelx = new Asminfo();
        wrdelx.numparam = 2;
        wrdelx.theparams[0] = 'creg';
        wrdelx.theparams[1] = 'creg';
        wrdelx.paramrw[0] = 'R';
        wrdelx.paramrw[1] = 'R';
        wrdelx.field[0] = 'r';
        wrdelx.field[1] = 'm';
        wrdelx.instbase = 0x8E;
        this.asmtable.set('WRDELX', wrdelx);

        // RDDIRX (Read Direct Indexed)
        let rddirx = new Asminfo();
        rddirx.numparam = 2;
        rddirx.theparams[0] = 'creg';
        rddirx.theparams[1] = 'creg';
        rddirx.paramrw[0] = 'W';
        rddirx.paramrw[1] = 'R';
        rddirx.field[0] = 'r';
        rddirx.field[1] = 'm';
        rddirx.instbase = 0x90;
        this.asmtable.set('RDDIRX', rddirx);

        // WRDIRX (Write Direct Indexed)
        let wrdirx = new Asminfo();
        wrdirx.numparam = 2;
        wrdirx.theparams[0] = 'creg';
        wrdirx.theparams[1] = 'creg';
        wrdirx.paramrw[0] = 'R';
        wrdirx.paramrw[1] = 'R';
        wrdirx.field[0] = 'r';
        wrdirx.field[1] = 'm';
        wrdirx.instbase = 0x92;
        this.asmtable.set('WRDIRX', wrdirx);

        // SAT64 (Saturate 64)
        let sat64 = new Asminfo();
        sat64.numparam = 1;
        sat64.theparams[0] = 'creg';
        sat64.theparams[1] = 'none';
        sat64.paramrw[0] = 'W';
        sat64.paramrw[1] = 'R';
        sat64.field[0] = 'r';
        sat64.field[1] = 'm';
        sat64.instbase = 0x94;
        this.asmtable.set('SAT64', sat64);

        // WRDLD (Write Direct Load)
        let wrdld = new Asminfo();
        wrdld.numparam = 2;
        wrdld.theparams[0] = 'creg';
        wrdld.theparams[1] = 'imm16';
        wrdld.paramrw[0] = 'W';
        wrdld.paramrw[1] = 'R';
        wrdld.field[0] = 'r';
        wrdld.field[1] = 'm';
        wrdld.instbase = 0x96;
        this.asmtable.set('WRDLD', wrdld);

        // Logic Operations

        // INV (Invert)
        let inv = new Asminfo();
        inv.numparam = 1;
        inv.theparams[0] = 'creg';
        inv.theparams[1] = 'none';
        inv.paramrw[0] = 'R';
        inv.paramrw[1] = 'R';
        inv.field[0] = 'r';
        inv.field[1] = 'm';
        inv.instbase = 0xA0;
        this.asmtable.set('INV', inv);

        // OR
        let or = new Asminfo();
        or.numparam = 2;
        or.theparams[0] = 'creg';
        or.theparams[1] = 'creg';
        or.paramrw[0] = 'R';
        or.paramrw[1] = 'R';
        or.field[0] = 'r';
        or.field[1] = 'm';
        or.instbase = 0xA2;
        this.asmtable.set('OR', or);

        // ORI (OR Immediate)
        let ori = new Asminfo();
        ori.numparam = 2;
        ori.theparams[0] = 'creg';
        ori.theparams[1] = 'imm16';
        ori.paramrw[0] = 'R';
        ori.paramrw[1] = 'R';
        ori.field[0] = 'r';
        ori.field[1] = 'm';
        ori.instbase = 0xA4;
        this.asmtable.set('ORI', ori);

        // AND
        let and = new Asminfo();
        and.numparam = 2;
        and.theparams[0] = 'creg';
        and.theparams[1] = 'creg';
        and.paramrw[0] = 'R';
        and.paramrw[1] = 'R';
        and.field[0] = 'r';
        and.field[1] = 'm';
        and.instbase = 0xA6;
        this.asmtable.set('AND', and);

        // ANDI (AND Immediate)
        let andi = new Asminfo();
        andi.numparam = 2;
        andi.theparams[0] = 'creg';
        andi.theparams[1] = 'imm16';
        andi.paramrw[0] = 'R';
        andi.paramrw[1] = 'R';
        andi.field[0] = 'r';
        andi.field[1] = 'm';
        andi.instbase = 0xA8;
        this.asmtable.set('ANDI', andi);

        // XOR
        let xor = new Asminfo();
        xor.numparam = 2;
        xor.theparams[0] = 'creg';
        xor.theparams[1] = 'creg';
        xor.paramrw[0] = 'R';
        xor.paramrw[1] = 'R';
        xor.field[0] = 'r';
        xor.field[1] = 'm';
        xor.instbase = 0xAA;
        this.asmtable.set('XOR', xor);

        // XORI (XOR Immediate)
        let xori = new Asminfo();
        xori.numparam = 2;
        xori.theparams[0] = 'creg';
        xori.theparams[1] = 'imm16';
        xori.paramrw[0] = 'R';
        xori.paramrw[1] = 'R';
        xori.field[0] = 'r';
        xori.field[1] = 'm';
        xori.instbase = 0xAC;
        this.asmtable.set('XORI', xori);

        // Jump Instructions

        // JGEZ (Jump Greater Equal Zero)
        let jgez = new Asminfo();
        jgez.numparam = 2;
        jgez.theparams[0] = 'creg';
        jgez.theparams[1] = 'addroffset';
        jgez.paramrw[0] = 'R';
        jgez.paramrw[1] = 'R';
        jgez.field[0] = 'r';
        jgez.field[1] = 'm';
        jgez.instbase = 0xAE;
        this.asmtable.set('JGEZ', jgez);

        // JNEG (Jump Negative)
        let jneg = new Asminfo();
        jneg.numparam = 2;
        jneg.theparams[0] = 'creg';
        jneg.theparams[1] = 'addroffset';
        jneg.paramrw[0] = 'R';
        jneg.paramrw[1] = 'R';
        jneg.field[0] = 'r';
        jneg.field[1] = 'm';
        jneg.instbase = 0xB0;
        this.asmtable.set('JNEG', jneg);

        // JNZ (Jump Not Zero)
        let jnz = new Asminfo();
        jnz.numparam = 2;
        jnz.theparams[0] = 'creg';
        jnz.theparams[1] = 'addroffset';
        jnz.paramrw[0] = 'R';
        jnz.paramrw[1] = 'R';
        jnz.field[0] = 'r';
        jnz.field[1] = 'm';
        jnz.instbase = 0xB2;
        this.asmtable.set('JNZ', jnz);

        // JZ (Jump Zero)
        let jz = new Asminfo();
        jz.numparam = 2;
        jz.theparams[0] = 'creg';
        jz.theparams[1] = 'addroffset';
        jz.paramrw[0] = 'R';
        jz.paramrw[1] = 'R';
        jz.field[0] = 'r';
        jz.field[1] = 'm';
        jz.instbase = 0xB4;
        this.asmtable.set('JZ', jz);

        // JZC (Jump Zero Clear) - Note: there's a bug in C# code, using jz variable
        // let jzc = new Asminfo();
        // jzc.numparam = 2;
        // jzc.theparams[0] = 'creg';
        // jzc.theparams[1] = 'addroffset';
        // jzc.paramrw[0] = 'R';
        // jzc.paramrw[1] = 'R';
        // jzc.field[0] = 'r';
        // jzc.field[1] = 'm';
        // jzc.instbase = 0xB4; // was 0XB6
        // this.asmtable.set('JZC', jz); // was "JZC"

        // JZC (Jump Zero Clear) - fixed even though this is different than C#
        let jzc = new Asminfo();
        jzc.numparam = 2;
        jzc.theparams[0] = 'creg';
        jzc.theparams[1] = 'addroffset';
        jzc.paramrw[0] = 'R';
        jzc.paramrw[1] = 'R';
        jzc.field[0] = 'r';
        jzc.field[1] = 'm';
        jzc.instbase = 0xB6;
        this.asmtable.set('JZC', jzc);

        // JMP (Jump)
        let jmp = new Asminfo();
        jmp.numparam = 1;
        jmp.theparams[0] = 'none';
        jmp.theparams[1] = 'addroffset';
        jmp.paramrw[0] = 'R';
        jmp.paramrw[1] = 'R';
        jmp.field[0] = 'r';
        jmp.field[1] = 'm';
        jmp.instbase = 0xB8;
        this.asmtable.set('JMP', jmp);

        // Extended Operations

        // APA (All Pass A)
        let apa = new Asminfo();
        apa.numparam = 2;
        apa.theparams[0] = 'imm8d';
        apa.theparams[1] = 'addr';
        apa.paramrw[0] = 'R';
        apa.paramrw[1] = 'R';
        apa.field[0] = 'r';
        apa.field[1] = 'm';
        apa.instbase = 0xC0;
        this.asmtable.set('APA', apa);

        // APB (All Pass B)
        let apb = new Asminfo();
        apb.numparam = 2;
        apb.theparams[0] = 'imm8d';
        apb.theparams[1] = 'addr';
        apb.paramrw[0] = 'R';
        apb.paramrw[1] = 'R';
        apb.field[0] = 'r';
        apb.field[1] = 'm';
        apb.instbase = 0xC2;
        this.asmtable.set('APB', apb);

        // APRA (All Pass Register A)
        let apra = new Asminfo();
        apra.numparam = 2;
        apra.theparams[0] = 'creg';
        apra.theparams[1] = 'addr';
        apra.paramrw[0] = 'R';
        apra.paramrw[1] = 'R';
        apra.field[0] = 'r';
        apra.field[1] = 'm';
        apra.instbase = 0xC4;
        this.asmtable.set('APRA', apra);

        // APRB (All Pass Register B)
        let aprb = new Asminfo();
        aprb.numparam = 2;
        aprb.theparams[0] = 'creg';
        aprb.theparams[1] = 'addr';
        aprb.paramrw[0] = 'R';
        aprb.paramrw[1] = 'R';
        aprb.field[0] = 'r';
        aprb.field[1] = 'm';
        aprb.instbase = 0xC6;
        this.asmtable.set('APRB', aprb);

        // APRRA (All Pass Register Register A)
        let aprra = new Asminfo();
        aprra.numparam = 2;
        aprra.theparams[0] = 'creg';
        aprra.theparams[1] = 'creg';
        aprra.paramrw[0] = 'R';
        aprra.paramrw[1] = 'R';
        aprra.field[0] = 'r';
        aprra.field[1] = 'm';
        aprra.instbase = 0xC8;
        this.asmtable.set('APRRA', aprra);

        // APRRB (All Pass Register Register B)
        let aprrb = new Asminfo();
        aprrb.numparam = 2;
        aprrb.theparams[0] = 'creg';
        aprrb.theparams[1] = 'creg';
        aprrb.paramrw[0] = 'R';
        aprrb.paramrw[1] = 'R';
        aprrb.field[0] = 'r';
        aprrb.field[1] = 'm';
        aprrb.instbase = 0xCA;
        this.asmtable.set('APRRB', aprrb);

        // APMA (All Pass Memory A)
        let apma = new Asminfo();
        apma.numparam = 2;
        apma.theparams[0] = 'creg';
        apma.theparams[1] = 'mreg';
        apma.paramrw[0] = 'R';
        apma.paramrw[1] = 'R';
        apma.field[0] = 'r';
        apma.field[1] = 'm';
        apma.instbase = 0xCC;
        this.asmtable.set('APMA', apma);

        // APMB (All Pass Memory B)
        let apmb = new Asminfo();
        apmb.numparam = 2;
        apmb.theparams[0] = 'creg';
        apmb.theparams[1] = 'mreg';
        apmb.paramrw[0] = 'R';
        apmb.paramrw[1] = 'W';
        apmb.field[0] = 'r';
        apmb.field[1] = 'm';
        apmb.instbase = 0xCE;
        this.asmtable.set('APMB', apmb);

        // CHR (Chorus)
        let chr = new Asminfo();
        chr.numparam = 2;
        chr.theparams[0] = 'imm4';
        chr.theparams[1] = 'addr';
        chr.paramrw[0] = 'R';
        chr.paramrw[1] = 'R';
        chr.field[0] = 'r';
        chr.field[1] = 'm';
        chr.instbase = 0xD0;
        this.asmtable.set('CHR', chr);

        // PITCH
        let pitch = new Asminfo();
        pitch.numparam = 2;
        pitch.theparams[0] = 'imm6';
        pitch.theparams[1] = 'addr';
        pitch.paramrw[0] = 'R';
        pitch.paramrw[1] = 'R';
        pitch.field[0] = 'r';
        pitch.field[1] = 'm';
        pitch.instbase = 0xD2;
        this.asmtable.set('PITCH', pitch);

        // SET
        let set = new Asminfo();
        set.numparam = 2;
        set.theparams[0] = 'imm6';
        set.theparams[1] = 'creg';
        set.paramrw[0] = 'R';
        set.paramrw[1] = 'R';
        set.field[0] = 'm';
        set.field[1] = 'r';
        set.instbase = 0xD4;
        this.asmtable.set('SET', set);

        // INTERP (Interpolate)
        let interp = new Asminfo();
        interp.numparam = 2;
        interp.theparams[0] = 'creg';
        interp.theparams[1] = 'addr';
        interp.paramrw[0] = 'R';
        interp.paramrw[1] = 'R';
        interp.field[0] = 'r';
        interp.field[1] = 'm';
        interp.instbase = 0xD6;
        this.asmtable.set('INTERP', interp);

        // Find the longest mnemonic
        for (const [key, value] of this.asmtable) {
            if (key.length > this.mnemax) {
                this.mnemax = key.length;
            }
        }
    }

    /**
     * Check if a word is a mnemonic
     * @param {string} theword - Word to check
     * @returns {boolean} True if it's a mnemonic
     */
    ismnemonic(theword) {
        return this.asmtable.has(theword.toUpperCase());
    }

    /**
     * Get instruction info for a mnemonic
     * @param {string} theword - Mnemonic
     * @returns {Asminfo|null} Instruction info or null
     */
    value(theword) {
        return this.asmtable.get(theword.toUpperCase()) || null;
    }

    /**
     * Check if an instruction word is valid
     * @param {number} instwrd - Instruction word
     * @returns {boolean} True if valid
     */
    isinst(instwrd) {
        for (const instInfo of this.asmtable.values()) {
            if (instInfo.instbase === instwrd) return true;
        }
        return false;
    }

    /**
     * Get mnemonic for an instruction word
     * @param {number} instwrd - Instruction word
     * @param {number} rfield - R field value
     * @param {number} mfield - M field value
     * @returns {string} Mnemonic string
     */
    getinst(instwrd, rfield, mfield) {
        let returnstr = '';
        for (const [key, instInfo] of this.asmtable) {
            if (instInfo.instbase === instwrd) {
                if (instInfo.xlat !== null) {
                    returnstr = instInfo.xlat.replace('@RFIELD', rfield.toString());
                    returnstr = returnstr.replace('@MFIELD', mfield.toString());
                }
                break;
            }
        }
        return returnstr;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Asminfo, Mnemonic };
}