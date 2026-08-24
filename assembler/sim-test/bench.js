// How fast is the reference interpreter? This decides whether the JIT in
// plan section 1.1 is needed, or whether a plain switch interpreter already
// holds real time.
//
//   node assembler/sim-test/bench.js

const FXCoreCore = require('../fxcore-emu.js');

const W = (op, r, m) => (((op & 0xFF) << 24) | ((r & 0xFF) << 16) | (m & 0xFFFF)) | 0;

// A representative mix rather than the cheapest instruction: register maths,
// a fractional multiply, a 64-bit MAC, a delay read and a delay write.
function buildMix(n) {
    const p = [];
    for (let i = 0; p.length < n; i++) {
        p.push(W(0x64, 0, 0));                       // CPY_CS R0, IN0
        p.push(W(0x32, 0, 0x4000));                  // MULTRI R0, 0.5
        p.push(W(0x08, 16, 1));                      // ADDS ACC32, R1
        p.push(W(0x20, 0, 1));                       // MACRR R0, R1
        p.push(W(0x8A, 16, (i * 7) & 0x3FFF));       // WRDEL addr, ACC32
        p.push(W(0x88, 2, (i * 7 + 100) & 0x3FFF));  // RDDEL R2, addr
        p.push(W(0x1C, 2, 3));                       // SRA R2, 3
        p.push(W(0x60, 1, 16));                      // CPY_CC R1, ACC32
    }
    return Int32Array.from(p.slice(0, n));
}

function bench(nInstr, seconds, rate) {
    const c = new FXCoreCore();
    c.sampleRate = rate;
    c.setProgram(buildMix(nInstr));
    const frames = Math.floor(rate * seconds);
    const inp = [0.1, -0.2, 0.3, -0.4];

    // warm up so the JIT in V8 has settled
    for (let i = 0; i < 20000; i++) c.run(inp);

    const t0 = process.hrtime.bigint();
    for (let i = 0; i < frames; i++) c.run(inp);
    const t1 = process.hrtime.bigint();

    const secs = Number(t1 - t0) / 1e9;
    return {
        nInstr, frames, secs,
        realtimeFactor: seconds / secs,
        mips: (nInstr * frames) / secs / 1e6
    };
}

const RATE = 48000;
console.log(`interpreter throughput at ${RATE} Hz\n`);
console.log('instrs   audio s   wall s   x realtime   M instr/s');
for (const n of [64, 128, 256, 512, 1024]) {
    const r = bench(n, 2.0, RATE);
    console.log(
        String(r.nInstr).padStart(6),
        r.secs.toFixed(3).padStart(9) === '' ? '' : '     2.000',
        r.secs.toFixed(3).padStart(8),
        r.realtimeFactor.toFixed(1).padStart(12),
        r.mips.toFixed(1).padStart(11)
    );
}
console.log('\nA program holds real time if x realtime > 1. Headroom below ~4x');
console.log('is uncomfortable in a browser audio thread sharing a core.');
