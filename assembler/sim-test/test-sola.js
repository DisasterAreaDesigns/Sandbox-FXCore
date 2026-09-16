// The SOLA shifter in test_programs/sola.fxc, measured in the simulator.
//
// The checks are fv-emu's tests/test_sola.py, which measures the same design
// built in C on the host: a tone in, a number out.
//
//   pitch    a 500 Hz sine at -12, -7, -5, 0, +5, +7, +12 semitones must
//            come out on the note, at the amplitude it went in.
//   chord    330 + 415 Hz, the same shifts; purity is the fraction of the
//            output energy on the two shifted lines.  A misaligned splice
//            smears energy off them.
//   low      a 78 Hz sine at the octaves, where a search narrower than half
//            a period stops finding aligned splices.
//   latency  an impulse in; the first non-zero sample out lands where the
//            constants say, N + E/2.
//
// Every run also reports zero missed answers: the search is H ticks long and
// the splice is H ticks after the request, so a miss is a fencepost.
//
//   node assembler/sim-test/test-sola.js

const path = require('path');
const FXCoreCore = require('../fxcore-emu.js');
const { assembleFile, loadInto } = require('./assemble.js');

const FS = 32000;
const AMP = 12000 / 32768;
const SHIFTS = [-12, -7, -5, 0, 5, 7, 12];
const MR = { splices: 103, missed: 104, searches: 105 };
const LATENCY = 436 + 1024 / 2;          // N + E/2, from gen-sola.js

let pass = 0, fail = 0; const failures = [];
function check(cond, name, detail) {
    console.log((cond ? '  ok    ' : '  FAIL  ') + name.padEnd(14) + detail);
    if (cond) pass++; else { fail++; failures.push(name); }
}

const img = assembleFile(path.join(__dirname, '../../test_programs/sola.fxc'));

// pitch: semitones -> pot, unity at the centre, an octave either way
function core(semis, mix) {
    const c = new FXCoreCore();
    c.sampleRate = FS;
    loadInto(c, img);
    c.setPots([(semis / 12 + 1) / 2, mix, 0, 0, 0, 0]);
    return c;
}

// The pot filter takes ~10 000 samples to settle from zero, and until it does
// the shifter is sweeping through half an octave.  For a measurement that
// depends on where the tap starts, seat the filter at its target first, as
// it would be with the pot left alone before power-up.
function settle(c) {
    for (let i = 0; i < 6; i++) {
        c.potRaw[i] = c.potTarget[i];
        c.potSmooth[i] = (c.potTarget[i] << 19) | 0;
    }
}

function run(c, x) {
    const y = new Float64Array(x.length);
    for (let n = 0; n < x.length; n++) {
        c.run([x[n], 0, 0, 0]);
        y[n] = c.outputs[0] / 2147483648;
    }
    return y;
}

function tone(freqs, samples) {
    const a = AMP / freqs.length, x = new Float64Array(samples);
    for (let i = 0; i < samples; i++)
        for (const f of freqs) x[i] += a * Math.sin(2 * Math.PI * f * i / FS);
    return x;
}

function goertzel(x, f) {
    const w = 2 * Math.PI * f / FS, c = 2 * Math.cos(w);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < x.length; i++) { const s0 = x[i] + c * s1 - s2; s2 = s1; s1 = s0; }
    const re = s1 - s2 * Math.cos(w), im = s2 * Math.sin(w);
    return Math.hypot(re, im) / x.length;
}

// Amplitude and frequency of the strongest line within 2% of f0, on a
// 0.1% grid: a sixtieth of a semitone.
function peak(x, f0) {
    let best = [0, f0];
    for (let f = f0 * 0.98; f < f0 * 1.02; f *= 1.001) {
        const a = goertzel(x, f);
        if (a > best[0]) best = [a, f];
    }
    return [best[0] * 2, best[1]];
}

// Fraction of the energy on the given lines.
function purity(x, freqs) {
    let lines = 0, total = 0;
    for (const f of freqs) lines += (peak(x, f)[0] / Math.SQRT2) ** 2;
    for (let i = 0; i < x.length; i++) total += x[i] * x[i];
    return lines / (total / x.length);
}

// A window half a second in, past the pot's settling and the first splices,
// and long enough that the low tone has 10 cycles in it.
const lo = FS / 2, hi = lo + 8192;

function counts(c) {
    return `splices ${String(c.mreg[MR.splices]).padStart(3)}  missed ${c.mreg[MR.missed]}`;
}

// ---- pitch
console.log('--- pitch: a 500 Hz sine, on the note at the amplitude it went in ---');
{
    const x = tone([500], hi);
    for (const n of SHIFTS) {
        const c = core(n, 1);
        const y = run(c, x).subarray(lo, hi);
        const want = 500 * 2 ** (n / 12);
        const [a, f] = peak(y, want);
        const st = 12 * Math.log2(f / want);
        check(Math.abs(st) <= 0.05 && Math.abs(a - AMP) <= AMP * 0.03 && c.mreg[MR.missed] === 0,
            `pitch ${n >= 0 ? '+' : ''}${n}`,
            `${f.toFixed(1).padStart(7)} Hz (${st >= 0 ? '+' : ''}${st.toFixed(2)} st)  amp ${(a * 32768).toFixed(0).padStart(5)}  ${counts(c)}`);
    }
}

// ---- chord
console.log('--- chord: 330 + 415 Hz, energy on the two shifted lines ---');
{
    const x = tone([330, 415], hi);
    for (const n of SHIFTS) {
        if (n === 0) continue;
        const c = core(n, 1);
        const y = run(c, x).subarray(lo, hi);
        const p = purity(y, [330 * 2 ** (n / 12), 415 * 2 ** (n / 12)]);
        check(p >= 0.97 && c.mreg[MR.missed] === 0,
            `chord ${n >= 0 ? '+' : ''}${n}`, `purity ${p.toFixed(3)}  ${counts(c)}`);
    }
}

// ---- low
console.log('--- low: 78 Hz at the octaves ---');
{
    const x = tone([78], hi);
    for (const n of [-12, 12]) {
        const c = core(n, 1);
        const y = run(c, x).subarray(lo, hi);
        const p = purity(y, [78 * 2 ** (n / 12)]);
        check(p >= 0.99 && c.mreg[MR.missed] === 0,
            `low ${n >= 0 ? '+' : ''}${n}`, `purity ${p.toFixed(3)}  ${counts(c)}`);
    }
}

// ---- latency
console.log('--- latency: an impulse at unity ---');
{
    const c = core(0, 1);
    settle(c);
    const x = new Float64Array(4000); x[0] = 20000 / 32768;
    const y = run(c, x);
    // The pot tops out at 4095/4096, so a 1/4096 of the dry impulse leaks
    // through at tick 0; the wet one is the first sample above that.
    const first = y.findIndex(v => Math.abs(v) > x[0] / 100);
    check(first === LATENCY, 'latency',
        `first sample out at ${first}, constants say ${LATENCY} (${(1000 * LATENCY / FS).toFixed(1)} ms)`);
}

// ---- mix
console.log('--- mix: pot1 at zero is the dry signal, delayed by nothing ---');
{
    const c = core(12, 0);
    settle(c);
    const x = tone([500], 2000);
    const y = run(c, x);
    let err = 0;
    for (let i = 1000; i < 2000; i++) err = Math.max(err, Math.abs(y[i] - x[i]));
    check(err < 1 / 8192, 'mix dry', `max error ${err.toExponential(2)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.map(f => '  ' + f).join('\n')); process.exit(1); }
