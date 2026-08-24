// End-to-end test: the shiftreg-fade program, transcribed from the machine
// words in its CLI assembler .lst. Exercises CPY_CS/CPY_SC/CPY_CM/CPY_MC,
// ANDI/ORI, ADDI, ADDSI, MULTRI, MULTRR, SRA, JNZ/JNEG, SET and the LFOs.
//
// NOTE: on hardware this program clocks an external shift register over the
// second I2S bus, which the simulator does not model -- OUT2 here is just a
// register that receives a value. So this is a test of instruction decode,
// arithmetic and the LFOs, NOT of the program's real-world behaviour. Do not
// extend it with assertions about what the LEDs actually do.
//
//   node assembler/sim-test/test-shiftreg.js

const FXCoreCore = require('../fxcore-emu.js');

const PROG = [
    0x6410002E, 0xA81000FF, 0xB2100030,
    0x64100022, 0x32103FFF, 0x0A103FFF, 0x30100010, 0x1C100017, 0x66100000,
    0x64100024, 0x32103FFF, 0x0A103FFF, 0x30100010, 0x1C100017, 0x66100001,
    0x64100026, 0x32103FFF, 0x0A103FFF, 0x30100010, 0x1C100017, 0x66100002,
    0x64100028, 0x32103FFF, 0x0A103FFF, 0x30100010, 0x1C100017, 0x66100003,
    0x64100023, 0x32103FFF, 0x0A103FFF, 0x30100010, 0x1C100017, 0x66100004,
    0x64100025, 0x32103FFF, 0x0A103FFF, 0x30100010, 0x1C100017, 0x66100005,
    0x64100027, 0x32103FFF, 0x0A103FFF, 0x30100010, 0x1C100017, 0x66100006,
    0x64100029, 0x32103FFF, 0x0A103FFF, 0x30100010, 0x1C100017, 0x66100007,
    0x620E0000, 0x040EFFFF, 0x66100000, 0xA80101FC, 0x60010010, 0xB00E0002, 0xA4010002, 0x60010010,
    0x620E0001, 0x040EFFFF, 0x66100001, 0xA80101FA, 0x60010010, 0xB00E0002, 0xA4010004, 0x60010010,
    0x620E0002, 0x040EFFFF, 0x66100002, 0xA80101F6, 0x60010010, 0xB00E0002, 0xA4010008, 0x60010010,
    0x620E0003, 0x040EFFFF, 0x66100003, 0xA80101EE, 0x60010010, 0xB00E0002, 0xA4010010, 0x60010010,
    0x620E0004, 0x040EFFFF, 0x66100004, 0xA80101DE, 0x60010010, 0xB00E0002, 0xA4010020, 0x60010010,
    0x620E0005, 0x040EFFFF, 0x66100005, 0xA80101BE, 0x60010010, 0xB00E0002, 0xA4010040, 0x60010010,
    0x620E0006, 0x040EFFFF, 0x66100006, 0xA801017E, 0x60010010, 0xB00E0002, 0xA4010080, 0x60010010,
    0x620E0007, 0x040EFFFF, 0x66100007, 0xA80100FE, 0x60010010, 0xB00E0002, 0xA4010100, 0x60010010,
    0xD4100020, 0x60010010, 0x68100006
];

// SREG presets exactly as the .lst reports them
const FS = 48000;
const LFO_F = [0x0001A143, 0x0000AFB0, 0x000480F7, 0x000901EF];

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, detail) {
    if (cond) pass++; else { fail++; failures.push(name + (detail ? '  ' + detail : '')); }
}

const c = new FXCoreCore();
c.sampleRate = FS;
const sfr = new Int32Array(49);
for (let i = 0; i < 6; i++) sfr[c.SFR_POT0_K + i] = 10;      // .lst: POTn_K = 10
for (let i = 0; i < 4; i++) sfr[c.SFR_LFO0_F + i] = LFO_F[i];
sfr[c.SFR_MAXTEMPO] = 0x7FFF;
c.setPresets({ sfr });
c.setProgram(Int32Array.from(PROG));

ok('program loaded, 118 instructions', c.progLen === 118, `got ${c.progLen}`);

// Sanity: the label table in the .lst says DOPWM is PC 51, reached from the
// JNZ at PC 2 with offset 0x30.
const jnz = PROG[2];
ok('JNZ at PC 2 targets PC 51', 2 + 1 + (jnz & 0xFFF) === 51);

const userTrace = [];
const brightTrace = [];
let sawShiftBits = 0;

for (let n = 0; n < FS; n++) {           // one second
    c.run([0, 0, 0, 0]);
    userTrace.push(c.user[1]);
    if (n % 256 === 0) brightTrace.push(Array.from(c.mreg.slice(0, 8)));
    sawShiftBits |= c.creg[1];           // R1 = SHIFTREG
}

ok('no unimplemented instructions were hit',
    c.getState().unimplemented.length === 0,
    JSON.stringify(c.getState().unimplemented));

ok('program ran to the end each sample', c.lastPC === 118, `lastPC ${c.lastPC}`);

// The LFOs should have moved: brightness values are recomputed every 256
// samples from (sin*0.5 + 0.5)^2 >> 23, so they live in 0..255.
const allBright = brightTrace.flat();
const maxB = Math.max(...allBright), minB = Math.min(...allBright);
ok('brightness values stay in the 0..255 PWM range',
    minB >= -1 && maxB <= 255, `min ${minB} max ${maxB}`);
ok('brightness actually varies with the LFOs',
    new Set(allBright).size > 8, `${new Set(allBright).size} distinct values`);
ok('brightness reaches a high value at some point', maxB > 180, `max ${maxB}`);
ok('brightness reaches a low value at some point', minB < 40, `min ${minB}`);

// SHIFTREG accumulates LED bits 1..8 (LEDA = 0x02 .. LEDH = 0x100)
ok('shift register drives the LED bit field',
    (sawShiftBits & 0x1FE) !== 0, `bits seen 0x${(sawShiftBits >>> 0).toString(16)}`);

// USER1 is driven from bit 0 of ACC32 by `SET USER1|0, ACC32` at PC 115.
// In this program the LED bits occupy 1..8 (LEDA = 0x02 .. LEDH = 0x100) and
// every mask (MASKA 0x1FC .. MASKH 0x0FE) is even, so bit 0 is never set and
// USER1 stays low for the whole run. Assert that rather than assuming it
// blinks -- then prove the SET path itself works with a positive control.
const highs = userTrace.filter(v => v === 1).length;
ok('USER1 stays low: bit 0 of the shift register is never set', highs === 0,
    `${highs} high of ${FS}`);
{
    const probe = new FXCoreCore();
    probe.setProgram(Int32Array.from([0xD4100020]));   // SET USER1|0, ACC32
    probe.creg[16] = 1;
    probe.run([0, 0, 0, 0]);
    ok('SET USER1|0 does drive the pin when bit 0 is set', probe.user[1] === 1);
}

// OUT2 receives the shift register word
ok('OUT2 is written', c.sfr[c.SFR_OUT0 + 2] === c.creg[16],
    `OUT2 ${c.sfr[c.SFR_OUT0 + 2]} ACC32 ${c.creg[16]}`);

// Inverting the datasheet's C = (2^31-1) * 2*pi*F / Fs must recover the
// frequencies the source asked for. The .lst records .equ f1 0.38, f2 0.16,
// f3 1.05, f4 2.1 and the coefficients they resolved to, so this checks the
// LFO model against the assembler's own arithmetic.
const WANT_HZ = [0.38, 0.16, 1.05, 2.1];
for (let i = 0; i < 4; i++) {
    const f = LFO_F[i] * FS / ((Math.pow(2, 31) - 1) * 2 * Math.PI);
    ok(`LFO${i} coefficient recovers ${WANT_HZ[i]} Hz`,
        Math.abs(f - WANT_HZ[i]) < 0.001, `computed ${f.toFixed(4)} Hz`);
}

// And the emulator's own phase accumulator must run at that rate: count the
// positive-going zero crossings of LFO3_S (2.1 Hz) over ten seconds.
{
    const p = new FXCoreCore();
    p.sampleRate = FS;
    const s2 = new Int32Array(49);
    s2[p.SFR_LFO0_F + 3] = LFO_F[3];
    p.setPresets({ sfr: s2 });
    p.setProgram(Int32Array.from([0xB8000000]));   // JMP 0 -> single no-op pass
    // Measure the period between consecutive positive-going zero crossings
    // rather than counting them over a fixed window, which is off by one
    // whenever the window does not land on a crossing.
    const times = [];
    let prev = 0;
    for (let n = 0; n < FS * 10 && times.length < 8; n++) {
        p.run([0, 0, 0, 0]);
        const v = p.sfr[p.SFR_LFO0_S + 6];
        if (prev < 0 && v >= 0) times.push(n / FS);
        prev = v;
    }
    const measured = (times.length - 1) / (times[times.length - 1] - times[0]);
    ok('LFO3 runs at 2.1 Hz in the emulator', Math.abs(measured - 2.1) < 0.005,
        `${measured.toFixed(4)} Hz measured`);
}

console.log('');
if (fail) { console.log('FAILURES:'); for (const f of failures) console.log('  ' + f); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
