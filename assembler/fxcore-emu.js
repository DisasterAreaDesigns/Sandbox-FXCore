// FXCore DSP Core Emulator
//
// Executes assembled FXCore machine code one sample period at a time so a
// program can be auditioned in the browser without hardware.
//
// Written from the Experimental Noize documentation:
//   - FXCore Datasheet V1 (2020)
//   - FXCore Instruction Set V1.2, September 2025
//   - Application notes AN-1 .. AN-8
// No code from any other emulator was used. Where the documents are silent the
// source comment says so and says how the behaviour was chosen; those places
// are the ones to check first if a program sounds wrong.
//
// PROVISIONAL BEHAVIOUR
// ---------------------
// CHR and PITCH are not described internally by any published document. They
// are modelled here on the equivalent FV-1 structures -- linear interpolation
// between adjacent delay samples, and for PITCH two read pointers half a block
// apart crossfaded by a triangle -- on the working assumption that the FXCore
// instructions are those same structures wrapped into single macros. The four
// PITCH crossfade shapes XF0-XF3 are undocumented and are all treated as
// linear. Executing either instruction records it in this.provisional so the
// front end can say the output is not confirmed against hardware. Revisit if
// Experimental Noize confirms or corrects the behaviour.
//
// Arithmetic is integer-exact. Core registers are 32-bit S.31 where
// 0x7FFFFFFF is just under +1.0 and 0x80000000 is -1.0. The 64-bit
// accumulator is kept as two 32-bit halves rather than a BigInt: a 32x32
// product reaches 2^62 and a JS double is only exact to 2^53, but every
// partial product in the half-word decomposition below stays under 2^33, so
// the split representation is exact and allocation free.
//
// This class must stay self-contained -- no references to anything outside
// itself -- because fxcore-sim.js stringifies it with toString() to build the
// AudioWorklet. That is what lets the simulator run from a file:// URL, where
// addModule() on a separate script file would be blocked by CORS.

class FXCoreCore {

    constructor() {
        // ---- machine limits (common.js: maxins, maxmem, basecore, basemreg)
        this.PROG_MAX = 1024;
        this.DELAY_LEN = 32768;
        this.DELAY_MASK = 0x7FFF;
        this.NUM_CREG = 18;          // R0-R15, ACC32, FLAGS
        this.NUM_MREG = 128;

        this.ACC32 = 16;
        this.FLAGS = 17;
        this.PARAM0 = 15;            // R15 doubles as PARAM0

        this.INT_MAX = 0x7FFFFFFF;
        this.INT_MIN = -0x80000000;

        // ---- SFR addresses (Instruction Set doc, "Special Function Registers")
        this.SFR_IN0 = 0;   this.SFR_IN3 = 3;
        this.SFR_OUT0 = 4;  this.SFR_OUT3 = 7;
        this.SFR_PIN = 8;
        this.SFR_SWITCH = 9;
        this.SFR_POT0_K = 10;        // .. 15
        this.SFR_POT0 = 16;          // .. 21
        this.SFR_POT0_SMTH = 22;     // .. 27
        this.SFR_LFO0_F = 28;        // .. 31
        this.SFR_RAMP0_F = 32;       // .. 33
        this.SFR_LFO0_S = 34;        // LFO0_S, LFO0_C, LFO1_S, LFO1_C, ...
        this.SFR_RAMP0_R = 42;       // .. 43
        this.SFR_MAXTEMPO = 44;
        this.SFR_TAPTEMPO = 45;
        this.SFR_SAMPLECNT = 46;
        this.SFR_NOISE = 47;
        this.SFR_BOOTSTAT = 48;
        this.NUM_SFR = 49;

        // Header-only registers. registers.js numbers these 117-121 and 998/999
        // and buildsfr() packs them into the 48-byte SFR header; they are not
        // addressable by CPY_CS / CPY_SC at all.
        this.cfgTapStkRld = 0x8CA0;  // 36000 samples
        this.cfgTapDbRld = 0x01E0;   // 480
        this.cfgSwDbRld = 0x01E0;    // 480
        this.cfgPrgDbRld = 0x0960;   // 2400
        this.cfgOflRld = 0x03C0;     // 960

        // ---- opcodes, from mnemonic.js instbase, cross-checked against the
        // encodings in the Instruction Set doc. The 32-bit word is
        //   31:25 I field (7-bit instruction)   24 reserved 0
        //   23:16 R field                       15:0 M field
        // so the byte at 31:24 is always instbase and always even.
        this.OP_ABS = 0x00;      this.OP_CLRACC64 = 0x02;
        this.OP_ADDI = 0x04;     this.OP_ADD = 0x06;
        this.OP_ADDS = 0x08;     this.OP_ADDSI = 0x0A;
        this.OP_SUB = 0x0C;      this.OP_SUBS = 0x0E;
        this.OP_SL = 0x10;       this.OP_SLR = 0x12;
        this.OP_SLS = 0x14;      this.OP_SLSR = 0x16;
        this.OP_SR = 0x18;       this.OP_SRR = 0x1A;
        this.OP_SRA = 0x1C;      this.OP_SRAR = 0x1E;
        this.OP_MACRR = 0x20;    this.OP_MACRI = 0x22;
        this.OP_MACRD = 0x24;    this.OP_MACID = 0x26;
        this.OP_MACHRR = 0x28;   this.OP_MACHRI = 0x2A;
        this.OP_MACHRD = 0x2C;   this.OP_MACHID = 0x2E;
        this.OP_MULTRR = 0x30;   this.OP_MULTRI = 0x32;
        this.OP_NEG = 0x34;      this.OP_LOG2 = 0x36;
        this.OP_EXP2 = 0x38;
        this.OP_CPY_CC = 0x60;   this.OP_CPY_CM = 0x62;
        this.OP_CPY_CS = 0x64;   this.OP_CPY_MC = 0x66;
        this.OP_CPY_SC = 0x68;   this.OP_CPY_CMX = 0x6A;
        this.OP_RDACC64U = 0x80; this.OP_RDACC64L = 0x82;
        this.OP_LDACC64U = 0x84; this.OP_LDACC64L = 0x86;
        this.OP_RDDEL = 0x88;    this.OP_WRDEL = 0x8A;
        this.OP_RDDELX = 0x8C;   this.OP_WRDELX = 0x8E;
        this.OP_RDDIRX = 0x90;   this.OP_WRDIRX = 0x92;
        this.OP_SAT64 = 0x94;    this.OP_WRDLD = 0x96;
        this.OP_INV = 0xA0;      this.OP_OR = 0xA2;
        this.OP_ORI = 0xA4;      this.OP_AND = 0xA6;
        this.OP_ANDI = 0xA8;     this.OP_XOR = 0xAA;
        this.OP_XORI = 0xAC;
        this.OP_JGEZ = 0xAE;     this.OP_JNEG = 0xB0;
        this.OP_JNZ = 0xB2;      this.OP_JZ = 0xB4;
        this.OP_JZC = 0xB6;      this.OP_JMP = 0xB8;
        this.OP_APA = 0xC0;      this.OP_APB = 0xC2;
        this.OP_APRA = 0xC4;     this.OP_APRB = 0xC6;
        this.OP_APRRA = 0xC8;    this.OP_APRRB = 0xCA;
        this.OP_APMA = 0xCC;     this.OP_APMB = 0xCE;
        this.OP_CHR = 0xD0;      this.OP_PITCH = 0xD2;
        this.OP_SET = 0xD4;      this.OP_INTERP = 0xD6;

        // ---- storage
        this.prog = new Int32Array(this.PROG_MAX);   // raw 32-bit words
        this.progLen = 0;
        this.hasProgram = false;

        this.creg = new Int32Array(this.NUM_CREG);
        this.mreg = new Int32Array(this.NUM_MREG);
        this.sfr = new Int32Array(this.NUM_SFR);
        this.delay = new Int16Array(this.DELAY_LEN);  // 32K x 16-bit, S.15

        // Presets loaded on program change
        this.cregPreset = new Int32Array(this.NUM_CREG);
        this.mregPreset = new Int32Array(this.NUM_MREG);
        this.sfrPreset = new Int32Array(this.NUM_SFR);
        this.usrPreset = [0, 0];

        this.sampleRate = 48000;
        this.rngState = 0x2545F491;

        // Instructions the documents do not specify at all. Executing one sets
        // a flag rather than silently producing wrong audio.
        this.unimplemented = Object.create(null);

        // Instructions modelled on a working assumption rather than a
        // published spec -- see the PROVISIONAL note at the head of this file.
        this.provisional = Object.create(null);

        this.reset();
    }

    // ================================================================
    // 64-bit helpers
    //
    // ACC64 is held as acc64hi (signed int32) and acc64lo (unsigned 32-bit
    // held in a plain number). The pair means hi * 2^32 + lo as a signed
    // 64-bit value.
    // ================================================================

    // Signed 32 x 32 -> 64. Returns nothing; result in this.mulHi / this.mulLo
    // to avoid allocating an object in the sample loop.
    mul64s(a, b) {
        // Math.imul gives the exact low 32 bits of the signed product.
        this.mulLo = Math.imul(a, b) >>> 0;

        // High half by half-word decomposition. With ah/bh signed 16 and
        // al/bl unsigned 16, every partial below stays well inside 2^53:
        //   full = ah*bh*2^32 + (ah*bl + al*bh)*2^16 + al*bl
        const ah = a >> 16, al = a & 0xFFFF;
        const bh = b >> 16, bl = b & 0xFFFF;
        const albl = al * bl;                       // < 2^32
        const mid = ah * bl + al * bh;              // |mid| < 2^32
        const t = mid + Math.floor(albl / 65536);   // |t| < 2^33
        this.mulHi = (ah * bh + Math.floor(t / 65536)) | 0;
    }

    // Signed fractional 32x32. Every multiplier on the part is a fractional
    // multiply, so the raw integer product is shifted left one bit before use.
    //
    // The Instruction Set doc writes MULTRR as ACC32 = (CREGX * CREGY)63:32,
    // which taken literally makes 0.5 * 0.5 come out as 0.125. That reading
    // also contradicts the same page's note that -1.0 * -1.0 is the one case
    // that saturates: without the shift the raw top word is 0x40000000, which
    // needs no saturation at all. With the shift, 0.5 * 0.5 = 0.25 and
    // -1.0 * -1.0 overflows S.31 exactly as documented, and the S.63 / S3.60
    // accumulator formats line up with SAT64. So bits 62:31, not 63:32.
    //
    // Result in this.mulHi / this.mulLo as the shifted 64-bit product.
    mulFrac64(a, b) {
        if (a === this.INT_MIN && b === this.INT_MIN) {
            // 2^63 does not fit in S.63
            this.mulHi = this.INT_MAX; this.mulLo = 4294967295;
            return;
        }
        this.mul64s(a, b);
        this.mulHi = ((this.mulHi << 1) | (this.mulLo >>> 31)) | 0;
        this.mulLo = (this.mulLo << 1) >>> 0;
    }

    // Signed fractional 32x32 keeping the top 32 bits: S.31 x S.31 -> S.31.
    mulS31(a, b) {
        if (a === this.INT_MIN && b === this.INT_MIN) return this.INT_MAX;
        this.mul64s(a, b);
        return ((this.mulHi << 1) | (this.mulLo >>> 31)) | 0;
    }

    // ACC64 += (hi,lo), saturating at the S.63 / S3.60 bounds. Both MAC
    // families saturate to 0x7FFFFFFFFFFFFFFF / 0x8000000000000000.
    addToAcc64(hi, lo) {
        const sum = this.acc64lo + lo;              // < 2^33, exact
        const carry = sum >= 4294967296 ? 1 : 0;
        const hsum = this.acc64hi + hi + carry;     // |hsum| < 2^33, exact

        // A 64-bit signed overflow is exactly an int32 overflow of the high
        // half, so this one test covers it.
        if (hsum > this.INT_MAX) {
            this.acc64hi = this.INT_MAX; this.acc64lo = 4294967295;
        } else if (hsum < this.INT_MIN) {
            this.acc64hi = this.INT_MIN; this.acc64lo = 0;
        } else {
            this.acc64hi = hsum | 0;
            this.acc64lo = carry ? sum - 4294967296 : sum;
        }
    }

    // ================================================================
    // Scalar helpers
    // ================================================================

    sat32(v) {
        if (v > this.INT_MAX) return this.INT_MAX;
        if (v < this.INT_MIN) return this.INT_MIN;
        return v | 0;
    }

    // Sign-extend the low `bits` of value.
    sext(value, bits) {
        const shift = 32 - bits;
        return (value << shift) >> shift;
    }

    // ================================================================
    // Delay memory
    //
    // 32K x 16-bit storing S.15. A write takes CREG[31:16]; a read zero-
    // appends back to S.31. Every trip through delay memory is therefore a
    // 16-bit truncation, and that is the FXCore's delay-line noise floor --
    // the direct analogue of the FV-1's companded 14-bit word.
    //
    // The AGU adds a counter that decrements once per sample period, making
    // the memory a circular buffer written low and read high. RDDIRX/WRDIRX
    // bypass the counter for absolute addressing.
    // ================================================================

    readDelay(addr) {
        return this.delay[(addr + this.addrCounter) & this.DELAY_MASK] << 16;
    }

    writeDelay(addr, value) {
        this.delay[(addr + this.addrCounter) & this.DELAY_MASK] = value >> 16;
    }

    readDelayDirect(addr) {
        return this.delay[addr & this.DELAY_MASK] << 16;
    }

    writeDelayDirect(addr, value) {
        this.delay[addr & this.DELAY_MASK] = value >> 16;
    }

    // ================================================================
    // Program loading
    // ================================================================

    // words: Uint32Array/Int32Array/array of 32-bit instruction words, or the
    // assembler's program[] whose entries carry .machine.
    setProgram(words) {
        if (!words || !words.length) { this.hasProgram = false; return false; }
        const n = Math.min(words.length, this.PROG_MAX);
        for (let i = 0; i < n; i++) {
            const w = words[i];
            this.prog[i] = (typeof w === 'object' && w !== null ? w.machine : w) | 0;
        }
        this.progLen = n;
        this.hasProgram = true;
        this.reset();
        return true;
    }

    // Presets from the program header. Any field may be omitted.
    //   creg: 18 entries (only R0-R15 are settable on hardware)
    //   mreg: 128 entries
    //   sfr:  49 entries, indexed by SFR address
    //   usr:  [usr0, usr1] initial USER pin states
    //   cfg:  {tapStkRld, tapDbRld, swDbRld, prgDbRld, oflRld}
    setPresets(p) {
        p = p || {};
        if (p.creg) for (let i = 0; i < this.NUM_CREG; i++) this.cregPreset[i] = p.creg[i] | 0;
        if (p.mreg) for (let i = 0; i < this.NUM_MREG; i++) this.mregPreset[i] = p.mreg[i] | 0;
        if (p.sfr) for (let i = 0; i < this.NUM_SFR; i++) this.sfrPreset[i] = p.sfr[i] | 0;
        if (p.usr) this.usrPreset = [p.usr[0] ? 1 : 0, p.usr[1] ? 1 : 0];
        if (p.cfg) {
            if (p.cfg.tapStkRld !== undefined) this.cfgTapStkRld = p.cfg.tapStkRld | 0;
            if (p.cfg.tapDbRld !== undefined) this.cfgTapDbRld = p.cfg.tapDbRld | 0;
            if (p.cfg.swDbRld !== undefined) this.cfgSwDbRld = p.cfg.swDbRld | 0;
            if (p.cfg.prgDbRld !== undefined) this.cfgPrgDbRld = p.cfg.prgDbRld | 0;
            if (p.cfg.oflRld !== undefined) this.cfgOflRld = p.cfg.oflRld | 0;
        }
        this.reset();
    }

    // Program change: instruction RAM reloaded, outputs muted, delay RAM
    // cleared, presets loaded, ACC32 cleared, SAMPLECNT reset. ACC64 is
    // explicitly NOT cleared (Instruction Set doc, Reserved Words) -- but a
    // reset() here is also the sim's power-on, so zero it and let CLRACC64 be
    // the only in-program reset.
    reset() {
        this.creg.set(this.cregPreset);
        this.creg[this.ACC32] = 0;
        this.creg[this.FLAGS] = 0;
        this.mreg.set(this.mregPreset);
        this.sfr.set(this.sfrPreset);
        this.delay.fill(0);

        this.acc64hi = 0;
        this.acc64lo = 0;
        this.mulHi = 0;
        this.mulLo = 0;

        this.addrCounter = 0;
        this.sampleCount = 0;

        this.user = [this.usrPreset[0], this.usrPreset[1]];

        // Programs drive the USER pins far faster than any display refreshes
        // -- a typical software PWM runs a 256-sample cycle, 187 Hz at 48 kHz.
        // Sampling the pin at display rate would alias that into noise, so the
        // pin state is integrated here and read out as a duty cycle. That is
        // what the LED and the eye actually do with a PWM signal.
        this.userAccum = [0, 0];
        this.userAccumN = 0;

        // Peripheral state
        this.potRaw = [0, 0, 0, 0, 0, 0];        // 12-bit ADC counts
        this.potTarget = [0, 0, 0, 0, 0, 0];     // what the UI asked for
        this.potSmooth = [0, 0, 0, 0, 0, 0];     // S.31 filter state
        this.potPhase = 0;                       // ~2 kHz sampling accumulator

        this.lfoPhase = [0, 0, 0, 0];            // radians
        this.rampAcc = [0, 0];

        this.pinRaw = 0x7F;                      // pull-ups: unconnected reads 1
        // Seed the debounced view from the pins rather than from zero. Starting
        // at zero means "everything pressed", so the first SWDBRLD samples
        // after a program change would emit a release edge on every switch --
        // phantom SWxRE bits a program could act on.
        this.swDebounced = this.pinRaw & 0x3F;
        this.swCounter = [0, 0, 0, 0, 0, 0];     // SW0-4 + ENABLE
        this.swEdges = 0;

        this.tapLevel = 1;                       // 1 = not pressed
        this.tapDebounced = 1;
        this.tapCounter = 0;
        this.tapHeld = 0;
        this.tapState = 0;                       // 0 = idle, 1 = seen first tap
        this.tapElapsed = 0;
        this.tapFlags = 0;

        this.oflCounter = 0;
        this.overflowBits = 0;

        this.inputs = [0, 0, 0, 0];
        this.outputs = [0, 0, 0, 0];

        this.lastPC = 0;
        this.halted = false;
        this.provisional = Object.create(null);
    }

    // ================================================================
    // Peripherals -- all update once per sample period and hold their value
    // for the whole program pass (Datasheet, blocks 9, 12, 13).
    // ================================================================

    // p: six floats 0..1
    setPots(p) {
        for (let i = 0; i < 6; i++) {
            let v = p[i];
            if (!(v >= 0)) v = 0; else if (v > 1) v = 1;
            this.potTarget[i] = Math.min(4095, Math.floor(v * 4096));
        }
    }

    // Raw PIN bits: 0-4 = SW0-SW4, 5 = ENABLE, 6 = TAP. Pins are pulled up,
    // so 1 means "not pressed".
    setPins(mask) { this.pinRaw = mask & 0x7F; }

    updatePots() {
        // The ADC scans the pot pins at roughly 2 kHz, not at Fs, so the raw
        // value steps on its own grid while the filter runs every sample.
        this.potPhase += 2000;
        if (this.potPhase >= this.sampleRate) {
            this.potPhase -= this.sampleRate;
            for (let i = 0; i < 6; i++) this.potRaw[i] = this.potTarget[i];
        }
        for (let i = 0; i < 6; i++) {
            // Raw POT is S.12 in the 13 MSBs with the sign bit always 0.
            const raw = (this.potRaw[i] << 19) | 0;
            this.sfr[this.SFR_POT0 + i] = raw;
            // POTX_SMTH = ((POTX - POTX_SMTH) >> POTX_K) + POTX_SMTH
            const k = this.sfr[this.SFR_POT0_K + i] & 0x1F;
            const diff = (raw - this.potSmooth[i]) | 0;
            this.potSmooth[i] = ((diff >> k) + this.potSmooth[i]) | 0;
            this.sfr[this.SFR_POT0_SMTH + i] = this.potSmooth[i];
        }
    }

    updateLFOs() {
        // Datasheet block 9: C = (2^31 - 1) * (2*pi*F) / Fs, so LFOX_F is the
        // per-sample phase increment in radians scaled by 2^31 - 1.
        const TWO_PI = Math.PI * 2;
        for (let i = 0; i < 4; i++) {
            const c = this.sfr[this.SFR_LFO0_F + i];
            this.lfoPhase[i] += c / this.INT_MAX;
            if (this.lfoPhase[i] >= TWO_PI) this.lfoPhase[i] -= TWO_PI;
            else if (this.lfoPhase[i] < 0) this.lfoPhase[i] += TWO_PI;
            const s = Math.round(Math.sin(this.lfoPhase[i]) * this.INT_MAX);
            const c2 = Math.round(Math.cos(this.lfoPhase[i]) * this.INT_MAX);
            this.sfr[this.SFR_LFO0_S + i * 2] = this.sat32(s);
            this.sfr[this.SFR_LFO0_S + i * 2 + 1] = this.sat32(c2);
        }
        // Ramps: C = (f/Fs) * 2^32, i.e. the coefficient is the per-sample
        // increment of a 32-bit accumulator that wraps. Pitch-up coefficients
        // are negative because the AGU counter already counts down (AN-2).
        for (let i = 0; i < 2; i++) {
            this.rampAcc[i] = (this.rampAcc[i] + this.sfr[this.SFR_RAMP0_F + i]) | 0;
            this.sfr[this.SFR_RAMP0_R + i] = this.rampAcc[i];
        }
    }

    updateSwitches() {
        // SW0-4 and ENABLE debounce independently; a bit must hold its new
        // level for SWDBRLD samples before the debounced view follows it.
        let newDeb = this.swDebounced;
        let edges = 0;
        for (let i = 0; i < 6; i++) {
            const raw = (this.pinRaw >> i) & 1;
            const deb = (this.swDebounced >> i) & 1;
            if (raw !== deb) {
                if (++this.swCounter[i] >= this.cfgSwDbRld) {
                    this.swCounter[i] = 0;
                    newDeb = raw ? (newDeb | (1 << i)) : (newDeb & ~(1 << i));
                    if (i < 5) {
                        // Pins are pulled up: a 1 -> 0 transition is a press.
                        if (raw === 0) edges |= 1 << (10 + i);   // SWxPE
                        else edges |= 1 << (5 + i);              // SWxRE
                    }
                }
            } else {
                this.swCounter[i] = 0;
            }
        }
        this.swDebounced = newDeb;
        // SWITCH: 0-4 levels, 5-9 release edges, 10-14 push edges, 15 ENABLEDB.
        // Edge bits are high for exactly one sample period.
        this.sfr[this.SFR_SWITCH] =
            ((newDeb & 0x1F) | edges | ((newDeb & 0x20) ? 0x8000 : 0)) | 0;
        this.sfr[this.SFR_PIN] = this.pinRaw & 0xFFFF;
        this.swEdges = edges;
    }

    updateTapTempo() {
        const raw = (this.pinRaw >> 6) & 1;         // 1 = not pressed
        let flags = 0;

        if (raw !== this.tapDebounced) {
            if (++this.tapCounter >= this.cfgTapDbRld) {
                this.tapCounter = 0;
                this.tapDebounced = raw;
                if (raw === 0) {
                    // Push edge
                    flags |= 0x0002;                // TAPPE
                    this.tapHeld = 0;
                    if (this.tapState === 0) {
                        this.tapState = 1;
                        this.tapElapsed = 0;
                    } else {
                        this.sfr[this.SFR_TAPTEMPO] = this.tapElapsed | 0;
                        flags |= 0x0008;            // NEWTT
                        flags |= 0x0020;            // TB2nTB1: second tap
                        this.tapState = 0;
                        this.tapElapsed = 0;
                    }
                } else {
                    flags |= 0x0004;                // TAPRE
                    // Holding past TAPSTKRLD on the first tap resets the unit
                    // on release, which is the documented hold-to-toggle idiom.
                    if (this.tapHeld >= this.cfgTapStkRld && this.tapState === 1) {
                        this.tapState = 0;
                        this.tapElapsed = 0;
                    }
                    this.tapHeld = 0;
                }
            }
        } else {
            this.tapCounter = 0;
        }

        if (this.tapDebounced === 0) {
            this.tapHeld++;
            if (this.tapHeld >= this.cfgTapStkRld) flags |= 0x0010;   // TAPSTKY
        }
        if (this.tapState === 1) {
            this.tapElapsed++;
            const maxT = this.sfr[this.SFR_MAXTEMPO] >>> 0;
            if (maxT !== 0 && this.tapElapsed > maxT) {
                this.tapState = 0;
                this.tapElapsed = 0;
            }
        }
        if (this.tapDebounced) flags |= 0x0001;     // TAPDB: 1 when not pressed
        this.tapFlags = flags;
    }

    // Overflow / clip flags set when a channel is within 0.5 dB of full scale
    // (Datasheet block 10). 10^(-0.5/20) = 0.94406.
    updateOverflow() {
        const thresh = 0.94406 * 2147483648;
        let bits = 0;
        for (let i = 0; i < 4; i++) {
            if (Math.abs(this.inputs[i]) >= thresh) bits |= 1 << (8 + i);
            if (Math.abs(this.outputs[i]) >= thresh) bits |= 1 << (12 + i);
        }
        this.overflowBits = bits;
    }

    nextNoise() {
        // The hardware NOISE source is thermal, not an LFSR (Datasheet block
        // 14), so no sequence can be matched bit-for-bit. xorshift32 is used
        // purely because it is fast and white.
        let x = this.rngState;
        x ^= x << 13; x |= 0; x ^= x >>> 17; x ^= x << 5; x |= 0;
        this.rngState = x;
        return x;
    }

    // ================================================================
    // SFR access
    // ================================================================

    readSFR(addr) {
        switch (addr) {
            case this.SFR_OUT0: case this.SFR_OUT0 + 1:
            case this.SFR_OUT0 + 2: case this.SFR_OUT0 + 3:
                return 0;                            // write only
            case this.SFR_NOISE:
                return this.sfr[this.SFR_NOISE];
            case this.SFR_SAMPLECNT:
                return this.sampleCount | 0;
            default:
                if (addr < 0 || addr >= this.NUM_SFR) return 0;
                return this.sfr[addr];
        }
    }

    writeSFR(addr, value) {
        if (addr < 0 || addr >= this.NUM_SFR) return;
        switch (addr) {
            // Read-only: inputs, raw and debounced switch views, raw and
            // smoothed pot values, LFO and ramp outputs, sample counter,
            // noise, boot status, tap tempo measurement.
            case this.SFR_IN0: case this.SFR_IN0 + 1:
            case this.SFR_IN0 + 2: case this.SFR_IN0 + 3:
            case this.SFR_PIN: case this.SFR_SWITCH:
            case this.SFR_SAMPLECNT: case this.SFR_NOISE:
            case this.SFR_BOOTSTAT: case this.SFR_TAPTEMPO:
                return;
            case this.SFR_OUT0: case this.SFR_OUT0 + 1:
            case this.SFR_OUT0 + 2: case this.SFR_OUT0 + 3:
                this.outputs[addr - this.SFR_OUT0] = value | 0;
                this.sfr[addr] = value | 0;
                return;
            default:
                if (addr >= this.SFR_POT0 && addr <= this.SFR_POT0_SMTH + 5) return;
                if (addr >= this.SFR_LFO0_S && addr <= this.SFR_RAMP0_R + 1) return;
                if (addr >= this.SFR_POT0_K && addr <= this.SFR_POT0_K + 5) {
                    this.sfr[addr] = value & 0x1F;   // 5 LSBs
                    return;
                }
                this.sfr[addr] = value | 0;
        }
    }

    // ================================================================
    // The sample loop
    // ================================================================

    // inputs: four floats in [-1, 1] for IN0..IN3
    run(inputs) {
        if (!this.hasProgram) return;

        // Start of sample period: the AGU counter decrements, peripherals
        // refresh, then the program runs against values that hold for the
        // whole pass.
        this.addrCounter = (this.addrCounter - 1) & this.DELAY_MASK;

        for (let i = 0; i < 4; i++) {
            const v = inputs[i] || 0;
            this.inputs[i] = this.sat32(Math.round(v * 2147483648));
            this.sfr[this.SFR_IN0 + i] = this.inputs[i];
        }

        this.updatePots();
        this.updateLFOs();
        this.updateSwitches();
        this.updateTapTempo();
        this.sfr[this.SFR_NOISE] = this.nextNoise();
        this.sfr[this.SFR_SAMPLECNT] = this.sampleCount | 0;
        this.creg[this.FLAGS] = (this.overflowBits | this.tapFlags) & 0xFFFF;

        let pc = 0;
        let guard = 0;
        while (pc < this.progLen && guard++ <= this.PROG_MAX) {
            pc = this.step(pc);
        }
        this.lastPC = pc;

        this.updateOverflow();
        this.userAccum[0] += this.user[0];
        this.userAccum[1] += this.user[1];
        this.userAccumN++;
        this.sampleCount = (this.sampleCount + 1) >>> 0;
    }

    // Outputs as floats in [-1, 1]
    getOutputs() {
        return [
            this.outputs[0] / 2147483648,
            this.outputs[1] / 2147483648,
            this.outputs[2] / 2147483648,
            this.outputs[3] / 2147483648
        ];
    }

    getUserPins() { return [this.user[0], this.user[1]]; }

    // Fraction of samples each USER pin has been high since the last call,
    // then resets. Call this once per display frame; a caller that wants the
    // instantaneous bit should use getUserPins() instead.
    readUserDuty() {
        const n = this.userAccumN;
        const d = n ? [this.userAccum[0] / n, this.userAccum[1] / n] : [0, 0];
        this.userAccum[0] = 0;
        this.userAccum[1] = 0;
        this.userAccumN = 0;
        return d;
    }

    // Execute the instruction at pc; return the next pc.
    step(pc) {
        const word = this.prog[pc];
        const op = (word >>> 24) & 0xFF;
        const r = (word >>> 16) & 0xFF;      // R field
        const m = word & 0xFFFF;             // M field

        const creg = this.creg;
        const rv = creg[r & 0x1F];           // value of the R-field register

        switch (op) {

            // ---- Math ------------------------------------------------

            case this.OP_ABS:
                // The doc gives ACC32 = |CREG| with no saturation note, but
                // |0x80000000| does not fit. Saturating to max positive
                // matches NEG, which is documented to saturate, and is the
                // agreed behaviour for this emulator.
                creg[this.ACC32] = rv === this.INT_MIN ? this.INT_MAX : Math.abs(rv) | 0;
                break;

            case this.OP_CLRACC64:
                this.acc64hi = 0; this.acc64lo = 0;
                break;

            case this.OP_ADDI:
                // Sign-extended 16-bit add, rolls over
                creg[this.ACC32] = (rv + this.sext(m, 16)) | 0;
                break;

            case this.OP_ADD:
                creg[this.ACC32] = (rv + creg[m & 0x1F]) | 0;
                break;

            case this.OP_ADDS:
                creg[this.ACC32] = this.sat32(rv + creg[m & 0x1F]);
                break;

            case this.OP_ADDSI:
                // S.15 immediate shifted left 16 into S.31, saturating add
                creg[this.ACC32] = this.sat32(rv + (this.sext(m, 16) << 16));
                break;

            case this.OP_SUB:
                creg[this.ACC32] = (rv - creg[m & 0x1F]) | 0;
                break;

            case this.OP_SUBS:
                creg[this.ACC32] = this.sat32(rv - creg[m & 0x1F]);
                break;

            case this.OP_SL:
                creg[this.ACC32] = (rv << (m & 0x1F)) | 0;
                break;

            case this.OP_SLR:
                creg[this.ACC32] = (rv << (creg[m & 0x1F] & 0x1F)) | 0;
                break;

            case this.OP_SLS:
                creg[this.ACC32] = this.satShiftLeft(rv, m & 0x1F);
                break;

            case this.OP_SLSR:
                creg[this.ACC32] = this.satShiftLeft(rv, creg[m & 0x1F] & 0x1F);
                break;

            case this.OP_SR:
                creg[this.ACC32] = (rv >>> (m & 0x1F)) | 0;
                break;

            case this.OP_SRR:
                creg[this.ACC32] = (rv >>> (creg[m & 0x1F] & 0x1F)) | 0;
                break;

            case this.OP_SRA:
                creg[this.ACC32] = rv >> (m & 0x1F);
                break;

            case this.OP_SRAR:
                creg[this.ACC32] = rv >> (creg[m & 0x1F] & 0x1F);
                break;

            // ---- 64-bit MAC, S.63 form -------------------------------

            case this.OP_MACRR:
                this.mulFrac64(rv, creg[m & 0x1F]);
                this.addToAcc64(this.mulHi, this.mulLo);
                break;

            case this.OP_MACRI:
                this.mulFrac64(rv, this.sext(m, 16) << 16);
                this.addToAcc64(this.mulHi, this.mulLo);
                break;

            case this.OP_MACRD:
                this.mulFrac64(rv, this.readDelay(m & 0x7FFF));
                this.addToAcc64(this.mulHi, this.mulLo);
                break;

            case this.OP_MACID:
                // S.7 coefficient in the R field, zero padded to 32 bits
                this.mulFrac64(this.sext(r, 8) << 24, this.readDelay(m & 0x7FFF));
                this.addToAcc64(this.mulHi, this.mulLo);
                break;

            // ---- 64-bit MAC, S3.60 form ------------------------------
            // The multiplicand is arithmetically shifted right 3 first, giving
            // 3 bits of headroom so intermediates can reach +/-8.0.

            case this.OP_MACHRR:
                this.mulFrac64(rv, creg[m & 0x1F] >> 3);
                this.addToAcc64(this.mulHi, this.mulLo);
                break;

            case this.OP_MACHRI:
                this.mulFrac64(rv, (this.sext(m, 16) >> 3) << 16);
                this.addToAcc64(this.mulHi, this.mulLo);
                break;

            case this.OP_MACHRD:
                this.mulFrac64(rv, (this.readDelay(m & 0x7FFF) >> 16 >> 3) << 16);
                this.addToAcc64(this.mulHi, this.mulLo);
                break;

            case this.OP_MACHID:
                this.mulFrac64(this.sext(r, 8) << 24,
                    (this.readDelay(m & 0x7FFF) >> 16 >> 3) << 16);
                this.addToAcc64(this.mulHi, this.mulLo);
                break;

            // ---- 32-bit multiplier -----------------------------------

            case this.OP_MULTRR:
                creg[this.ACC32] = this.mulS31(rv, creg[m & 0x1F]);
                break;

            case this.OP_MULTRI:
                creg[this.ACC32] = this.mulS31(rv, this.sext(m, 16) << 16);
                break;

            case this.OP_NEG:
                creg[this.ACC32] = rv === this.INT_MIN ? this.INT_MAX : (-rv) | 0;
                break;

            case this.OP_LOG2: {
                // ACC32 = log2(|CREG|) in S5.26. |CREG| is S.31 so the result
                // is <= 0 and reaches -31 at the smallest non-zero magnitude.
                const mag = Math.abs(rv) / 2147483648;
                const lg = mag > 0 ? Math.log2(mag) : -32;
                creg[this.ACC32] = this.sat32(Math.round(lg * 67108864));  // 2^26
                break;
            }

            case this.OP_EXP2: {
                // Inverse of LOG2. The doc specifies the input as S5.26 and
                // requires the sign bit to be 1, i.e. it is defined only for
                // negative inputs; a positive input would exceed S.31.
                const x = rv / 67108864;
                creg[this.ACC32] = this.sat32(Math.round(Math.pow(2, x) * 2147483648));
                break;
            }

            // ---- Copy ------------------------------------------------
            // In every CPY the R field holds the core register and the M
            // field holds the other operand, whichever way round the mnemonic
            // reads. Confirmed against .lst output: 66100000 is
            // CPY_MC MR0, ACC32 with R = 0x10 = ACC32.

            case this.OP_CPY_CC:
                creg[r & 0x1F] = creg[m & 0x1F];
                break;

            case this.OP_CPY_CM:
                creg[r & 0x1F] = this.mreg[m & 0x7F];
                break;

            case this.OP_CPY_CS:
                creg[r & 0x1F] = this.readSFR(m & 0x3F);
                break;

            case this.OP_CPY_MC:
                this.mreg[m & 0x7F] = rv;
                break;

            case this.OP_CPY_SC:
                this.writeSFR(m & 0x3F, rv);
                break;

            case this.OP_CPY_CMX:
                // MREG as a lookup table, indexed by the low 7 bits of CREGY
                creg[r & 0x1F] = this.mreg[creg[m & 0x1F] & 0x7F];
                break;

            // ---- Load / store ----------------------------------------

            case this.OP_RDACC64U: creg[r & 0x1F] = this.acc64hi; break;
            case this.OP_RDACC64L: creg[r & 0x1F] = this.acc64lo | 0; break;
            case this.OP_LDACC64U: this.acc64hi = rv; break;
            case this.OP_LDACC64L: this.acc64lo = rv >>> 0; break;

            case this.OP_RDDEL:
                creg[r & 0x1F] = this.readDelay(m & 0x7FFF);
                break;

            case this.OP_WRDEL:
                this.writeDelay(m & 0x7FFF, rv);
                break;

            case this.OP_RDDELX:
                creg[r & 0x1F] = this.readDelay(creg[m & 0x1F] & 0x7FFF);
                break;

            case this.OP_WRDELX:
                // CREGX holds the address, CREGY the data
                this.writeDelay(rv & 0x7FFF, creg[m & 0x1F]);
                break;

            case this.OP_RDDIRX:
                creg[r & 0x1F] = this.readDelayDirect(creg[m & 0x1F] & 0x7FFF);
                break;

            case this.OP_WRDIRX:
                this.writeDelayDirect(rv & 0x7FFF, creg[m & 0x1F]);
                break;

            case this.OP_SAT64:
                // Remove the 3 bits of S3.60 headroom, saturating into S.31
                creg[r & 0x1F] = this.satShiftLeft(this.acc64hi, 3);
                break;

            case this.OP_WRDLD:
                creg[r & 0x1F] = (m << 16) | 0;
                break;

            // ---- Logic -----------------------------------------------

            case this.OP_INV: creg[this.ACC32] = ~rv; break;
            case this.OP_OR:  creg[this.ACC32] = rv | creg[m & 0x1F]; break;
            case this.OP_ORI: creg[this.ACC32] = rv | m; break;       // 0 extended
            case this.OP_AND: creg[this.ACC32] = rv & creg[m & 0x1F]; break;
            case this.OP_ANDI: creg[this.ACC32] = rv & m; break;
            case this.OP_XOR: creg[this.ACC32] = rv ^ creg[m & 0x1F]; break;
            case this.OP_XORI: creg[this.ACC32] = rv ^ m; break;

            // ---- Jumps -----------------------------------------------
            // Forward only, 12-bit offset. The offset is relative to the NEXT
            // instruction: the doc says "PC = PC + OFFSET" but every jump in
            // a CLI .lst resolves as PC + 1 + OFFSET against the label table.

            case this.OP_JGEZ: if (rv >= 0) return pc + 1 + (m & 0xFFF); break;
            case this.OP_JNEG: if (rv < 0) return pc + 1 + (m & 0xFFF); break;
            case this.OP_JNZ:  if (rv !== 0) return pc + 1 + (m & 0xFFF); break;
            case this.OP_JZ:   if (rv === 0) return pc + 1 + (m & 0xFFF); break;
            case this.OP_JZC:
                if ((rv < 0) !== (creg[this.ACC32] < 0)) return pc + 1 + (m & 0xFFF);
                break;
            case this.OP_JMP:  return pc + 1 + (m & 0xFFF);

            // ---- All-pass --------------------------------------------
            // APx/APRx/APRRx/APMx come in pairs. The A instruction reads the
            // tail into ACC32 and leaves the tail in R15 (PARAM0); the B
            // instruction writes ACC32 to the head and folds R15 back in.

            case this.OP_APA: {
                const tail = this.readDelay(m & 0x7FFF);
                creg[this.ACC32] = this.sat32(
                    this.mulTop(tail, this.sext(r, 8) << 24) + creg[this.ACC32]);
                creg[this.PARAM0] = tail;
                break;
            }

            case this.OP_APB: {
                const acc = creg[this.ACC32];
                this.writeDelay(m & 0x7FFF, acc);
                creg[this.ACC32] = this.sat32(
                    this.mulTop(acc, this.sext(r, 8) << 24) + creg[this.PARAM0]);
                break;
            }

            case this.OP_APRA: {
                const tail = this.readDelay(m & 0x7FFF);
                creg[this.ACC32] = this.sat32(
                    this.mulTop(tail, this.negSat(rv)) + creg[this.ACC32]);
                creg[this.PARAM0] = tail;
                break;
            }

            case this.OP_APRB: {
                const acc = creg[this.ACC32];
                this.writeDelay(m & 0x7FFF, acc);
                creg[this.ACC32] = this.sat32(
                    this.mulTop(acc, rv) + creg[this.PARAM0]);
                break;
            }

            case this.OP_APRRA: {
                const tail = this.readDelay(creg[m & 0x1F] & 0x7FFF);
                creg[this.ACC32] = this.sat32(
                    this.mulTop(tail, this.negSat(rv)) + creg[this.ACC32]);
                creg[this.PARAM0] = tail;
                break;
            }

            case this.OP_APRRB: {
                const acc = creg[this.ACC32];
                this.writeDelay(creg[m & 0x1F] & 0x7FFF, acc);
                creg[this.ACC32] = this.sat32(this.mulTop(acc, rv) + creg[this.PARAM0]);
                break;
            }

            case this.OP_APMA: {
                const tail = this.mreg[m & 0x7F];
                creg[this.ACC32] = this.sat32(
                    this.mulTop(tail, this.negSat(rv)) + creg[this.ACC32]);
                creg[this.PARAM0] = tail;
                break;
            }

            case this.OP_APMB: {
                const acc = creg[this.ACC32];
                this.mreg[m & 0x7F] = acc;
                creg[this.ACC32] = this.sat32(this.mulTop(acc, rv) + creg[this.PARAM0]);
                break;
            }

            // ---- Interpolated read -----------------------------------

            case this.OP_INTERP: {
                // ACC32 = (mem[o+A+1] - mem[o+A]) * frac + mem[o+A]
                // where o = CREG[30:16] and frac = CREG[15:0] treated as
                // unsigned fractional with a 0 sign bit prepended.
                const base = ((rv >> 16) & 0x7FFF) + (m & 0x7FFF);
                const s0 = this.readDelay(base);
                const s1 = this.readDelay(base + 1);
                const frac = (rv & 0xFFFF) << 15;   // 0 sign bit prepended
                const diff = this.sat32(s1 - s0);
                creg[this.ACC32] = this.sat32(this.mulS31(diff, frac) + s0);
                break;
            }

            // ---- User outputs ----------------------------------------

            case this.OP_SET:
                // M field is 00UN NNNN: U picks USER0/USER1, N picks the bit.
                this.user[(m >> 5) & 1] = (rv >>> (m & 0x1F)) & 1;
                break;

            // ---- Not yet specified -----------------------------------

            case this.OP_CHR: {
                // PROVISIONAL -- see the note at the head of this file.
                // Modelled as the FV-1 chorus read wrapped into one macro.
                //
                // R field is 0000 NLLW: N negates, LL selects the LFO, W picks
                // SIN or COS. The datasheet specifies the address arithmetic:
                // the LFO is scaled to 0..1.0, multiplied by the depth in
                // R15[30:16], and added to the head address, so narrowing the
                // depth introduces no delay offset. The fractional part is
                // linearly interpolated, which the datasheet does not state.
                const lfoSel = (r >> 1) & 0x03;
                const useCos = r & 0x01;
                const base = m & 0x7FFF;

                let v = this.sfr[this.SFR_LFO0_S + lfoSel * 2 + useCos];
                if (r & 0x08) v = this.negSat(v);

                const norm = (v + 2147483648) / 4294967296;   // -1..+1 -> 0..1
                const depth = (creg[this.PARAM0] >> 16) & 0x7FFF;
                const off = norm * depth;
                const io = Math.floor(off);
                creg[this.ACC32] = this.interpRead(base + io, off - io);
                this.provisional.CHR = true;
                break;
            }

            case this.OP_PITCH: {
                // PROVISIONAL -- see the note at the head of this file.
                // Modelled as the FV-1 pitch transposer wrapped into one
                // macro: two read pointers half a block apart, each read with
                // linear interpolation, crossfaded by a triangle so whichever
                // pointer is near its wrap is the one being faded out.
                //
                // R field is 00XX LL0R: XX is the crossfade shape (not yet
                // modelled -- the shapes are undocumented, so the crossfade is
                // linear regardless), LL the block length, R the ramp.
                const rampSel = r & 0x01;
                const L = 512 << ((r >> 2) & 0x03);
                const base = m & 0x7FFF;

                // The ramp accumulator sweeps the full 32-bit range once per
                // ramp cycle, so as an unsigned fraction it maps straight onto
                // the block. AN-2's +1 octave coefficient for L=4096 is
                // -1048576, which moves the pointer exactly one sample per
                // sample period -- on top of the AGU's own decrement that is
                // the 2x read rate an octave needs.
                const norm = (this.rampAcc[rampSel] >>> 0) / 4294967296;
                const pos1 = norm * L;
                const pos2 = (pos1 + L / 2) % L;

                const i1 = Math.floor(pos1), i2 = Math.floor(pos2);
                const t1 = this.interpRead(base + i1, pos1 - i1);
                const t2 = this.interpRead(base + i2, pos2 - i2);

                // Triangle: 0 where pointer one is at the end of the block,
                // 1.0 where it is in the middle.
                const xf = 1 - Math.abs(2 * norm - 1);
                creg[this.ACC32] = this.sat32(
                    this.mulS31(t1, this.toS31(xf)) +
                    this.mulS31(t2, this.toS31(1 - xf)));
                this.provisional.PITCH = true;
                break;
            }

            default:
                this.unimplemented['op_0x' + op.toString(16)] = true;
                break;
        }

        return pc + 1;
    }

    // ---- helpers used by the switch ---------------------------------

    // Left shift with S.31 saturation (SLS, SLSR, SAT64)
    satShiftLeft(v, n) {
        if (n === 0) return v | 0;
        // Saturate if any bit shifted out differs from the resulting sign.
        const shifted = (v << n) | 0;
        if ((v >> (31 - n)) !== (shifted >> 31)) {
            return v < 0 ? this.INT_MIN : this.INT_MAX;
        }
        return shifted;
    }

    // The S.31 x S.31 -> S.31 multiply the all-pass and interpolation
    // instructions use. Kept as a name of its own for readability.
    mulTop(a, b) { return this.mulS31(a, b); }

    // 2's complement of a coefficient, saturating. APRA/APRRA/APMA multiply
    // by the negated coefficient.
    negSat(v) { return v === this.INT_MIN ? this.INT_MAX : (-v) | 0; }

    // A unit fraction 0..1 as an S.31 coefficient. 1.0 is not representable,
    // so it clamps to the largest positive value.
    toS31(x) {
        if (!(x > 0)) return 0;
        if (x >= 1) return this.INT_MAX;
        return Math.round(x * 2147483648) | 0;
    }

    // Linearly interpolated read between two adjacent delay samples. Used by
    // CHR and PITCH, matching what INTERP does explicitly.
    interpRead(addr, frac) {
        const s0 = this.readDelay(addr & this.DELAY_MASK);
        const s1 = this.readDelay((addr + 1) & this.DELAY_MASK);
        const diff = this.sat32(s1 - s0);
        return this.sat32(this.mulS31(diff, this.toS31(frac)) + s0);
    }

    // ---- introspection, for the test harness and the debugger -------

    getState() {
        return {
            creg: Array.from(this.creg),
            mreg: Array.from(this.mreg),
            acc64hi: this.acc64hi,
            acc64lo: this.acc64lo,
            addrCounter: this.addrCounter,
            sampleCount: this.sampleCount,
            user: this.user.slice(),
            outputs: this.outputs.slice(),
            unimplemented: Object.keys(this.unimplemented),
            provisional: Object.keys(this.provisional)
        };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FXCoreCore;
}
