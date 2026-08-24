// CHR and PITCH are modelled on the FV-1 equivalents pending confirmation
// from Experimental Noize (see the PROVISIONAL note in fxcore-emu.js). These
// tests pin down the behaviour we chose, so a later correction shows up as a
// test change rather than a silent drift.
//
//   node assembler/sim-test/test-pitch-chr.js

const path = require('path');
const FXCoreCore = require('../fxcore-emu.js');
const { assemble, loadInto } = require('./assemble.js');

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, detail) {
    if (cond) pass++; else { fail++; failures.push(name + (detail ? '  ' + detail : '')); }
}

const FS = 48000;

function build(src) {
    const img = assemble(src, 'test.fxc');
    const c = new FXCoreCore();
    c.sampleRate = FS;
    loadInto(c, img);
    return c;
}

// Count positive-going zero crossings to estimate frequency.
function measureHz(samples, from) {
    let prev = samples[from], n = 0, first = -1, last = -1;
    for (let i = from + 1; i < samples.length; i++) {
        const v = samples[i];
        if (prev < 0 && v >= 0) { if (first < 0) first = i; last = i; n++; }
        prev = v;
    }
    if (n < 2) return 0;
    return (n - 1) * FS / (last - first);
}

// ---------------------------------------------------------------
console.log('--- PITCH: one octave up doubles the frequency ---');
{
    // AN-2's own coefficients: +1 octave with L=4096 is -1048576 (0xFFF00000).
    const c = build(`
.mem pdelay 4096
cpy_cs  acc32, in0
wrdel   pdelay, acc32
pitch   rmp0|l4096|xf0, pdelay
cpy_sc  out0, acc32
`);
    c.sfr[c.SFR_RAMP0_F] = -1048576 | 0;

    const inHz = 200;
    const out = [];
    for (let n = 0; n < FS; n++) {
        c.run([Math.sin(2 * Math.PI * inHz * n / FS) * 0.5, 0, 0, 0]);
        out.push(c.outputs[0] / 2147483648);
    }
    // skip the first 0.2 s while the delay fills
    const hz = measureHz(out, Math.floor(FS * 0.2));
    ok('PITCH +1 octave gives ~400 Hz from a 200 Hz input',
        Math.abs(hz - 400) < 12, `measured ${hz.toFixed(1)} Hz`);
    ok('PITCH output is bounded', out.every(v => Math.abs(v) <= 1.0));
    ok('PITCH is recorded as provisional',
        c.getState().provisional.includes('PITCH'));
    ok('PITCH is no longer unimplemented',
        !c.getState().unimplemented.includes('PITCH'));
}

console.log('--- PITCH: one octave down halves it ---');
{
    // AN-2: pitching down, C = 2^23 * (1 - 1/2^N) * (512/L)
    //       N=1, L=4096  ->  2^23 * 0.5 * 0.125 = 524288
    const c = build(`
.mem pdelay 4096
cpy_cs  acc32, in0
wrdel   pdelay, acc32
pitch   rmp0|l4096|xf0, pdelay
cpy_sc  out0, acc32
`);
    c.sfr[c.SFR_RAMP0_F] = 524288;

    const inHz = 400;
    const out = [];
    for (let n = 0; n < FS; n++) {
        c.run([Math.sin(2 * Math.PI * inHz * n / FS) * 0.5, 0, 0, 0]);
        out.push(c.outputs[0] / 2147483648);
    }
    const hz = measureHz(out, Math.floor(FS * 0.2));
    ok('PITCH -1 octave gives ~200 Hz from a 400 Hz input',
        Math.abs(hz - 200) < 8, `measured ${hz.toFixed(1)} Hz`);
}

console.log('--- PITCH: a zero ramp is a plain delay read ---');
{
    const c = build(`
.mem pdelay 4096
cpy_cs  acc32, in0
wrdel   pdelay, acc32
pitch   rmp0|l4096|xf0, pdelay
cpy_sc  out0, acc32
`);
    c.sfr[c.SFR_RAMP0_F] = 0;      // ramp parked at 0
    const inHz = 300;
    const out = [];
    for (let n = 0; n < FS / 2; n++) {
        c.run([Math.sin(2 * Math.PI * inHz * n / FS) * 0.5, 0, 0, 0]);
        out.push(c.outputs[0] / 2147483648);
    }
    const hz = measureHz(out, Math.floor(FS * 0.2));
    ok('a parked ramp leaves the pitch unchanged',
        Math.abs(hz - 300) < 5, `measured ${hz.toFixed(1)} Hz`);
}

// ---------------------------------------------------------------
console.log('--- CHR: address follows the LFO across the depth ---');
{
    // Depth 256 samples in R15[30:16]; walk LFO0 by hand and check the tap.
    const c = build(`
.mem cdel 2000
wrdld   r15, 0x0100
cpy_cs  acc32, in0
wrdel   cdel, acc32
chr     lfo0|sin, cdel
cpy_sc  out0, acc32
`);
    ok('depth lands in R15[30:16]',
        ((c.cregPreset[15] >> 16) & 0x7FFF) === 0 , 'preset is 0, set by wrdld at runtime');

    // Fill the delay with a ramp so each address holds a distinguishable value,
    // then read at three known LFO positions.
    const probe = new FXCoreCore();
    probe.sampleRate = FS;
    probe.setProgram(Int32Array.from([0xB8000000]));
    // write a marker pattern directly, bypassing the AGU
    for (let i = 0; i < 2000; i++) probe.delay[i] = i;

    const readAt = (lfoS31, depth) => {
        probe.creg[15] = (depth & 0x7FFF) << 16;
        probe.sfr[probe.SFR_LFO0_S] = lfoS31;
        probe.addrCounter = 0;
        // CHR LFO0|SIN, address 0   ->  R field 0, M field 0
        probe.prog[0] = ((0xD0 << 24) | (0 << 16) | 0) | 0;
        probe.progLen = 1;
        probe.step(0);
        return probe.creg[16] >> 16;   // recover the 16-bit stored value
    };

    ok('LFO at -1.0 reads the head of the block', readAt(-2147483648, 256) === 0,
        `got ${readAt(-2147483648, 256)}`);
    ok('LFO at 0 reads half the depth in', readAt(0, 256) === 128,
        `got ${readAt(0, 256)}`);
    ok('LFO at +1.0 reads the full depth in', readAt(2147483647, 256) >= 255,
        `got ${readAt(2147483647, 256)}`);
    ok('a smaller depth sweeps a smaller span', readAt(0, 64) === 32,
        `got ${readAt(0, 64)}`);
    ok('depth 0 pins the read at the head', readAt(2147483647, 0) === 0,
        `got ${readAt(2147483647, 0)}`);
}

console.log('--- CHR: audible sweep, and flagged provisional ---');
{
    const c = build(`
.mem cdel 2000
wrdld   r15, 0x0100
cpy_cs  acc32, in0
wrdel   cdel, acc32
chr     lfo0|sin, cdel
cpy_sc  out0, acc32
`);
    c.sfr[c.SFR_LFO0_F] = Math.round((Math.pow(2, 31) - 1) * 2 * Math.PI * 2 / FS); // 2 Hz
    const out = [];
    for (let n = 0; n < FS; n++) {
        c.run([Math.sin(2 * Math.PI * 440 * n / FS) * 0.5, 0, 0, 0]);
        out.push(c.outputs[0] / 2147483648);
    }
    const peak = Math.max(...out.map(Math.abs));
    ok('CHR produces output', peak > 0.2, `peak ${peak.toFixed(3)}`);
    ok('CHR output is bounded', peak <= 1.0);
    ok('CHR is recorded as provisional', c.getState().provisional.includes('CHR'));
    ok('CHR is no longer unimplemented',
        !c.getState().unimplemented.includes('CHR'));

    // A chorus must actually modulate. Sample the instantaneous frequency in
    // short windows stepped across one LFO cycle -- comparing two windows a
    // whole LFO period apart would sample identical phase and show nothing.
    const WIN = 3000, STEP = 1500;
    const est = [];
    for (let a = 4000; a + WIN < FS; a += STEP) {
        const h = measureHz(out.slice(a, a + WIN), 0);
        if (h > 100) est.push(h);
    }
    const lo = Math.min(...est), hi = Math.max(...est);
    ok('CHR detunes the signal as the LFO sweeps', hi - lo > 1.0,
        `instantaneous frequency spans ${lo.toFixed(2)}..${hi.toFixed(2)} Hz`);
    ok('CHR detune stays either side of the input frequency',
        lo < 441 && hi > 439, `span ${lo.toFixed(2)}..${hi.toFixed(2)} Hz`);
}

console.log('');
if (fail) { console.log('FAILURES:'); for (const f of failures) console.log('  ' + f); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
