// Headless unit tests for fxcore-emu.js
//
//   node assembler/sim-test/test-core.js
//
// The 64-bit helpers are checked against BigInt, which is exact and is fine
// as a test oracle even though it is far too slow for the sample loop.

const FXCoreCore = require('../fxcore-emu.js');

let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, detail) {
    if (cond) { pass++; } else { fail++; failures.push(name + (detail ? '  ' + detail : '')); }
}
function eq(name, got, want) {
    const g = got | 0, w = want | 0;
    ok(name, g === w, `got 0x${(g >>> 0).toString(16)} (${g}) want 0x${(w >>> 0).toString(16)} (${w})`);
}

// Build a 32-bit instruction word: I field 31:24, R field 23:16, M field 15:0
const W = (op, r, m) => (((op & 0xFF) << 24) | ((r & 0xFF) << 16) | (m & 0xFFFF)) | 0;

// Run a program of raw words once and return the core.
function runProg(words, setup) {
    const c = new FXCoreCore();
    c.setProgram(Int32Array.from(words));
    if (setup) setup(c);
    c.run([0, 0, 0, 0]);
    return c;
}

const ACC = 16;
const MAXI = 0x7FFFFFFF | 0, MINI = -0x80000000 | 0;

// =====================================================================
console.log('--- 64-bit multiply vs BigInt ---');
{
    const c = new FXCoreCore();
    const vals = [0, 1, -1, 2, -2, 12345, -12345, 0x7FFFFFFF | 0, -0x80000000 | 0,
        0x40000000, -0x40000000, 0x12345678, -0x12345678, 0xFFFF, 0x10000];
    // deterministic pseudo-random additions
    let s = 123456789;
    for (let i = 0; i < 400; i++) {
        s = (Math.imul(s, 1103515245) + 12345) | 0;
        vals.push(s);
    }
    let bad = 0, checked = 0;
    for (const a of vals) {
        for (const b of vals) {
            c.mul64s(a, b);
            const want = BigInt(a) * BigInt(b);
            const got = (BigInt(c.mulHi) << 32n) + BigInt(c.mulLo);
            checked++;
            if (got !== want) {
                if (bad < 3) console.log(`  mismatch a=${a} b=${b} got=${got} want=${want}`);
                bad++;
            }
        }
    }
    ok(`mul64s exact over ${checked} pairs`, bad === 0, `${bad} mismatches`);
}

// =====================================================================
console.log('--- ACC64 accumulate and saturate ---');
{
    const c = new FXCoreCore();
    // Accumulate a run of products and compare against BigInt throughout.
    let ref = 0n;
    let s = 987654321;
    let bad = 0;
    for (let i = 0; i < 2000; i++) {
        s = (Math.imul(s, 1103515245) + 12345) | 0;
        const a = s;
        s = (Math.imul(s, 1103515245) + 12345) | 0;
        const b = s;
        c.mul64s(a, b);
        c.addToAcc64(c.mulHi, c.mulLo);
        ref += BigInt(a) * BigInt(b);
        const LO = -(2n ** 63n), HI = 2n ** 63n - 1n;
        if (ref > HI) ref = HI;
        if (ref < LO) ref = LO;
        const got = (BigInt(c.acc64hi) << 32n) + BigInt(c.acc64lo);
        if (got !== ref) { if (bad < 3) console.log(`  step ${i}: got=${got} want=${ref}`); bad++; }
    }
    ok('addToAcc64 matches BigInt with saturation over 2000 MACs', bad === 0, `${bad} mismatches`);

    // Explicit positive saturation
    const c2 = new FXCoreCore();
    c2.acc64hi = MAXI; c2.acc64lo = 4294967295;
    c2.addToAcc64(0, 1);
    ok('ACC64 saturates positive', c2.acc64hi === MAXI && c2.acc64lo === 4294967295);
    // Explicit negative saturation
    const c3 = new FXCoreCore();
    c3.acc64hi = MINI; c3.acc64lo = 0;
    c3.addToAcc64(-1, 0);
    ok('ACC64 saturates negative', c3.acc64hi === MINI && c3.acc64lo === 0);
}

// =====================================================================
console.log('--- arithmetic ---');
{
    // ADD rolls over, ADDS saturates
    let c = runProg([W(0x06, 0, 1)], k => { k.creg[0] = MAXI; k.creg[1] = 1; });
    eq('ADD rolls over', c.creg[ACC], MINI);

    c = runProg([W(0x08, 0, 1)], k => { k.creg[0] = MAXI; k.creg[1] = 1; });
    eq('ADDS saturates positive', c.creg[ACC], MAXI);

    c = runProg([W(0x08, 0, 1)], k => { k.creg[0] = MINI; k.creg[1] = -1; });
    eq('ADDS saturates negative', c.creg[ACC], MINI);

    c = runProg([W(0x0C, 0, 1)], k => { k.creg[0] = MINI; k.creg[1] = 1; });
    eq('SUB rolls over', c.creg[ACC], MAXI);

    c = runProg([W(0x0E, 0, 1)], k => { k.creg[0] = MINI; k.creg[1] = 1; });
    eq('SUBS saturates negative', c.creg[ACC], MINI);

    // ADDI sign extends the 16-bit immediate
    c = runProg([W(0x04, 0, 0xFFFF)], k => { k.creg[0] = 10; });
    eq('ADDI -1', c.creg[ACC], 9);

    // ADDSI: S.15 immediate shifted left 16. 0x3FFF -> +0.5 - 1lsb
    c = runProg([W(0x0A, 0, 0x3FFF)], k => { k.creg[0] = 0; });
    eq('ADDSI 0.5', c.creg[ACC], 0x3FFF << 16);

    c = runProg([W(0x0A, 0, 0x4000)], k => { k.creg[0] = 0x60000000; });
    eq('ADDSI saturates', c.creg[ACC], MAXI);

    // ABS / NEG
    c = runProg([W(0x00, 0, 0)], k => { k.creg[0] = -5; });
    eq('ABS', c.creg[ACC], 5);
    c = runProg([W(0x00, 0, 0)], k => { k.creg[0] = MINI; });
    eq('ABS saturates at INT_MIN', c.creg[ACC], MAXI);
    c = runProg([W(0x34, 0, 0)], k => { k.creg[0] = MINI; });
    eq('NEG saturates at INT_MIN', c.creg[ACC], MAXI);
}

// =====================================================================
console.log('--- shifts ---');
{
    let c = runProg([W(0x10, 0, 4)], k => { k.creg[0] = 1; });
    eq('SL', c.creg[ACC], 16);

    c = runProg([W(0x18, 0, 4)], k => { k.creg[0] = -16; });
    eq('SR is logical', c.creg[ACC], (-16 >>> 4) | 0);

    c = runProg([W(0x1C, 0, 4)], k => { k.creg[0] = -16; });
    eq('SRA is arithmetic', c.creg[ACC], -1);

    c = runProg([W(0x14, 0, 1)], k => { k.creg[0] = 0x40000000; });
    eq('SLS saturates', c.creg[ACC], MAXI);

    c = runProg([W(0x14, 0, 1)], k => { k.creg[0] = -0x40000000; });
    eq('SLS saturates negative', c.creg[ACC], MINI);

    c = runProg([W(0x14, 0, 1)], k => { k.creg[0] = 0x10000000; });
    eq('SLS in range', c.creg[ACC], 0x20000000);

    // register-operand forms use the low 5 bits
    c = runProg([W(0x1A, 0, 1)], k => { k.creg[0] = -16; k.creg[1] = 4 + 32; });
    eq('SRR masks shift to 5 bits', c.creg[ACC], (-16 >>> 4) | 0);
}

// =====================================================================
console.log('--- multiply ---');
{
    // 0.5 * 0.5 = 0.25 in S.31, taking the top 32 of the product
    let c = runProg([W(0x30, 0, 1)], k => { k.creg[0] = 0x40000000; k.creg[1] = 0x40000000; });
    eq('MULTRR 0.5*0.5 = 0.25', c.creg[ACC], 0x20000000);

    c = runProg([W(0x30, 0, 1)], k => { k.creg[0] = MINI; k.creg[1] = MINI; });
    eq('MULTRR -1*-1 saturates', c.creg[ACC], MAXI);

    // MULTRI with S.15 0x4000 = +0.5
    c = runProg([W(0x32, 0, 0x4000)], k => { k.creg[0] = 0x40000000; });
    eq('MULTRI 0.5*0.5 = 0.25', c.creg[ACC], 0x20000000);

    // MACRR then read back both halves
    c = runProg([W(0x02, 0, 0), W(0x20, 0, 1), W(0x80, 2, 0), W(0x82, 3, 0)],
        k => { k.creg[0] = 0x40000000; k.creg[1] = 0x40000000; });
    const want = (BigInt(0x40000000) * BigInt(0x40000000)) << 1n;
    eq('MACRR hi', c.creg[2], Number(want >> 32n));
    eq('MACRL lo', c.creg[3], Number(BigInt.asIntN(32, want)));

    // MACHRR shifts the multiplicand right 3 for headroom
    c = runProg([W(0x02, 0, 0), W(0x28, 0, 1), W(0x80, 2, 0)],
        k => { k.creg[0] = 0x40000000; k.creg[1] = 0x40000000; });
    const wantH = (BigInt(0x40000000) * BigInt(0x40000000 >> 3)) << 1n;
    eq('MACHRR hi', c.creg[2], Number(wantH >> 32n));

    // SAT64 removes the 3 bits of headroom
    c = runProg([W(0x02, 0, 0), W(0x28, 0, 1), W(0x94, 2, 0)],
        k => { k.creg[0] = 0x40000000; k.creg[1] = 0x40000000; });
    eq('SAT64 after MACHRR recovers 0.25', c.creg[2], 0x20000000);
}

// =====================================================================
console.log('--- logic ---');
{
    let c = runProg([W(0xA8, 0, 0x00FF)], k => { k.creg[0] = 0x12345678; });
    eq('ANDI', c.creg[ACC], 0x78);
    c = runProg([W(0xA4, 0, 0xFFFF)], k => { k.creg[0] = 0x12340000; });
    eq('ORI is zero extended', c.creg[ACC], 0x1234FFFF);
    c = runProg([W(0xA0, 0, 0)], k => { k.creg[0] = 0; });
    eq('INV', c.creg[ACC], -1);
    // WRDLD then ORI is the documented 32-bit load idiom
    c = runProg([W(0x96, 0, 0x1234), W(0xA4, 0, 0x5678)]);
    eq('WRDLD', c.creg[0], 0x12340000);
    eq('WRDLD+ORI builds 32-bit constant', c.creg[ACC], 0x12345678);
}

// =====================================================================
console.log('--- jumps (offset is relative to the NEXT instruction) ---');
{
    // JMP 1 should skip exactly one instruction
    let c = runProg([W(0xB8, 0, 1), W(0x96, 1, 0xDEAD), W(0x96, 2, 0xBEEF)]);
    eq('JMP skips one', c.creg[1], 0);
    eq('JMP lands on the next', c.creg[2], 0xBEEF0000 | 0);

    // JNZ taken / not taken
    c = runProg([W(0xB2, 0, 1), W(0x96, 1, 0x1111), W(0x96, 2, 0x2222)],
        k => { k.creg[0] = 5; });
    eq('JNZ taken', c.creg[1], 0);
    c = runProg([W(0xB2, 0, 1), W(0x96, 1, 0x1111), W(0x96, 2, 0x2222)],
        k => { k.creg[0] = 0; });
    eq('JNZ not taken', c.creg[1], 0x11110000);

    // JZC: sign of CREG differs from sign of ACC32
    c = runProg([W(0xB6, 0, 1), W(0x96, 1, 0x1111)],
        k => { k.creg[0] = -1; k.creg[ACC] = 1; });
    eq('JZC taken on differing signs', c.creg[1], 0);
    c = runProg([W(0xB6, 0, 1), W(0x96, 1, 0x1111)],
        k => { k.creg[0] = 1; k.creg[ACC] = 1; });
    eq('JZC not taken on same signs', c.creg[1], 0x11110000);
}

// =====================================================================
console.log('--- delay memory ---');
{
    // WRDEL stores the top 16 bits; RDDEL zero-appends them back.
    // The low 16 bits of the written value must not survive.
    let c = runProg([W(0x8A, 0, 100), W(0x88, 1, 100)], k => { k.creg[0] = 0x12345678; });
    eq('delay memory truncates to 16 bits', c.creg[1], 0x12340000);

    // A value that fits exactly round-trips
    c = runProg([W(0x8A, 0, 100), W(0x88, 1, 100)], k => { k.creg[0] = 0x12340000; });
    eq('delay round trip', c.creg[1], 0x12340000);

    // Negative values keep their sign through the 16-bit store
    c = runProg([W(0x8A, 0, 5), W(0x88, 1, 5)], k => { k.creg[0] = MINI; });
    eq('delay keeps sign', c.creg[1], MINI);

    // The AGU counter shifts addressing by one per sample: something written
    // at address A on one sample reads back at address A+1 on the next.
    const c2 = new FXCoreCore();
    c2.setProgram(Int32Array.from([W(0x8A, 0, 10)]));   // WRDEL 10, R0
    c2.creg[0] = 0x7FFF0000;
    c2.run([0, 0, 0, 0]);
    c2.setProgram(Int32Array.from([W(0x88, 1, 11)]));   // RDDEL R1, 11
    // setProgram resets, so re-drive the counter by hand for this check
    const probe = new FXCoreCore();
    probe.setProgram(Int32Array.from([
        W(0x8A, 0, 10),     // sample 1: write at 10
        W(0xB8, 0, 0)       // (no-op jump to next)
    ]));
    probe.creg[0] = 0x7FFF0000;
    probe.run([0, 0, 0, 0]);
    // now run a second sample that reads 11
    probe.setProgram2 = null;
    probe.prog[0] = W(0x88, 1, 11);
    probe.prog[1] = W(0xB8, 0, 0);
    probe.run([0, 0, 0, 0]);
    eq('AGU counter advances one per sample', probe.creg[1], 0x7FFF0000);

    // RDDIRX bypasses the counter
    const c3 = new FXCoreCore();
    c3.setProgram(Int32Array.from([
        W(0x92, 0, 1),      // WRDIRX R0, R1   -> mem[R0] = R1[31:16], absolute
        W(0x90, 2, 0)       // RDDIRX R2, R0   -> R2 = mem[R0], absolute
    ]));
    c3.creg[0] = 500; c3.creg[1] = 0x4321 << 16;
    c3.run([0, 0, 0, 0]);
    eq('RDDIRX/WRDIRX bypass the counter', c3.creg[2], 0x43210000);
}

// =====================================================================
console.log('--- copies and MREG ---');
{
    let c = runProg([W(0x66, 0, 7), W(0x62, 1, 7)], k => { k.creg[0] = 0xCAFE0000 | 0; });
    eq('CPY_MC then CPY_CM', c.creg[1], 0xCAFE0000 | 0);

    // CPY_CMX indexes MREG by the low 7 bits of a register
    c = runProg([W(0x6A, 1, 0)], k => { k.creg[0] = 5; k.mreg[5] = 0x1234; });
    eq('CPY_CMX lookup', c.creg[1], 0x1234);

    // CPY_CS from SAMPLECNT (SFR 46), CPY_SC to OUT2 (SFR 6)
    c = new FXCoreCore();
    c.setProgram(Int32Array.from([W(0x64, 0, 46), W(0x68, 0, 6)]));
    c.run([0, 0, 0, 0]);
    eq('CPY_CS SAMPLECNT on first sample', c.creg[0], 0);
    c.run([0, 0, 0, 0]);
    eq('SAMPLECNT increments', c.creg[0], 1);
    eq('CPY_SC to OUT2', c.outputs[2], 1);
}

// =====================================================================
console.log('--- SET drives the USER pins ---');
{
    // SET USER1|0, R0  with R0 bit 0 = 1.  M field = 0x20 | 0 = 0x20
    let c = runProg([W(0xD4, 0, 0x20)], k => { k.creg[0] = 1; });
    ok('SET USER1 high', c.user[1] === 1 && c.user[0] === 0);
    c = runProg([W(0xD4, 0, 0x00)], k => { k.creg[0] = 1; });
    ok('SET USER0 high', c.user[0] === 1);
    // bit select: N picks which bit of the register drives the pin
    c = runProg([W(0xD4, 0, 15)], k => { k.creg[0] = 1 << 15; });
    ok('SET N=15 reads bit 15 (set)', c.user[0] === 1);
    c = runProg([W(0xD4, 0, 14)], k => { k.creg[0] = 1 << 15; });
    ok('SET N=14 reads bit 14 (clear)', c.user[0] === 0);
    c = runProg([W(0xD4, 0, 0x20 | 15)], k => { k.creg[0] = 1 << 15; });
    ok('SET U=1,N=15 drives USER1 only', c.user[1] === 1 && c.user[0] === 0);
}

// =====================================================================
console.log('--- pot smoothing ---');
{
    const c = new FXCoreCore();
    c.setProgram(Int32Array.from([W(0xB8, 0, 0)]));
    c.sfr[c.SFR_POT0_K] = 0;      // K=0 -> the filter passes straight through
    c.setPots([1, 0, 0, 0, 0, 0]);
    for (let i = 0; i < 200; i++) c.run([0, 0, 0, 0]);
    eq('POT0 raw at full scale is S.12 in the 13 MSBs',
        c.sfr[c.SFR_POT0], 4095 << 19);
    eq('POT0_SMTH with K=0 tracks exactly', c.sfr[c.SFR_POT0_SMTH], 4095 << 19);

    // With a larger K the filter lags but converges upward monotonically
    const c2 = new FXCoreCore();
    c2.setProgram(Int32Array.from([W(0xB8, 0, 0)]));
    c2.sfr[c2.SFR_POT0_K] = 6;
    c2.setPots([1, 0, 0, 0, 0, 0]);
    let prev = -1, monotonic = true;
    for (let i = 0; i < 5000; i++) {
        c2.run([0, 0, 0, 0]);
        const v = c2.sfr[c2.SFR_POT0_SMTH];
        if (v < prev) monotonic = false;
        prev = v;
    }
    ok('POT0_SMTH rises monotonically with K=6', monotonic);
    ok('POT0_SMTH converges near full scale',
        Math.abs(c2.sfr[c2.SFR_POT0_SMTH] - (4095 << 19)) < (1 << 19),
        `got ${c2.sfr[c2.SFR_POT0_SMTH]}`);
}

// =====================================================================
console.log('--- LFO ---');
{
    // C = (2^31-1) * 2*pi*F / Fs.  Check one full cycle at 1 Hz / 48 kHz.
    const F = 1, FS = 48000;
    const coeff = Math.round((Math.pow(2, 31) - 1) * (2 * Math.PI * F) / FS);
    const c = new FXCoreCore();
    c.sampleRate = FS;
    c.setProgram(Int32Array.from([W(0xB8, 0, 0)]));
    c.sfr[c.SFR_LFO0_F] = coeff;
    let maxS = 0, minS = 0, zeroCrossings = 0, prev = 0;
    for (let i = 0; i < FS; i++) {
        c.run([0, 0, 0, 0]);
        const s = c.sfr[c.SFR_LFO0_S];
        if (s > maxS) maxS = s;
        if (s < minS) minS = s;
        if ((prev < 0) !== (s < 0)) zeroCrossings++;
        prev = s;
    }
    ok('LFO0_S reaches near full scale', maxS > 0x7F000000, `max ${maxS}`);
    ok('LFO0_S reaches near negative full scale', minS < -0x7F000000, `min ${minS}`);
    ok('LFO0 completes one cycle per second at 1 Hz',
        zeroCrossings === 2, `${zeroCrossings} zero crossings`);

    // SIN and COS are 90 degrees apart: at the moment sin peaks, cos ~ 0
    const c2 = new FXCoreCore();
    c2.sampleRate = FS;
    c2.setProgram(Int32Array.from([W(0xB8, 0, 0)]));
    c2.sfr[c2.SFR_LFO0_F] = coeff;
    let bestI = 0, bestV = 0;
    for (let i = 0; i < FS; i++) {
        c2.run([0, 0, 0, 0]);
        if (c2.sfr[c2.SFR_LFO0_S] > bestV) { bestV = c2.sfr[c2.SFR_LFO0_S]; bestI = i; }
    }
    ok('LFO sin peaks around a quarter cycle',
        Math.abs(bestI - FS / 4) < FS / 200, `peak at ${bestI}, expected ~${FS / 4}`);
}

// =====================================================================
console.log('--- all-pass pair ---');
{
    // APA/APB with coefficient +/-0.5 (S.7: 0x40 = +0.5, 0xC0 = -0.5)
    // Feed an impulse and confirm the classic all-pass impulse response:
    // first output = -g, then (1-g^2) at the delay, decaying by -g each pass.
    const DELAY = 8;
    const c = new FXCoreCore();
    c.setProgram(Int32Array.from([
        W(0x64, 16, 0),               // CPY_CS ACC32, IN0
        W(0xC0, 0xC0, DELAY),         // APA -0.5, tail
        W(0xC2, 0x40, 0),             // APB +0.5, head
        W(0x68, 16, 4)                // CPY_SC OUT0, ACC32
    ]));
    const out = [];
    for (let i = 0; i < 40; i++) {
        c.run([i === 0 ? 0.5 : 0, 0, 0, 0]);
        out.push(c.getOutputs()[0]);
    }
    // With APA = -g and APB = +g, the immediate term is +g*x = 0.25
    ok('all-pass immediate term is g*x', Math.abs(out[0] - 0.25) < 0.01, `got ${out[0]}`);
    // Echo at the delay length with (1-g^2) = 0.75 of the input
    // Echo at the delay length carries (1 - g^2) * x = 0.75 * 0.5 = 0.375
    const echo = out[DELAY];
    ok('all-pass echo is (1-g^2)*x at the delay length',
        Math.abs(echo - 0.375) < 0.02, `got ${echo} at n=${DELAY}`);
    ok('all-pass is stable', out.every(v => Math.abs(v) <= 1.0));
}

// =====================================================================
console.log('--- unimplemented instructions are flagged, not silent ---');
{
    const c = runProg([W(0xD0, 0, 0)]);   // CHR
    ok('CHR flagged unimplemented', c.getState().unimplemented.includes('CHR'));
    const c2 = runProg([W(0xD2, 0, 0)]);  // PITCH
    ok('PITCH flagged unimplemented', c2.getState().unimplemented.includes('PITCH'));
    const c3 = runProg([W(0x06, 0, 1)]);
    ok('normal program flags nothing', c3.getState().unimplemented.length === 0);
}

// =====================================================================
console.log('');
if (fail) {
    console.log('FAILURES:');
    for (const f of failures) console.log('  ' + f);
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
