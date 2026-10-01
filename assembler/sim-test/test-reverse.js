// The forward/reverse delay in test_programs/reverse-delay.fxc, measured in
// the simulator against the mechanism US 9,899,013 describes.
//
//   reverse   noise in; with p = n mod H, sample n out must be the input
//             512 + 2p samples back, so every input sample comes out once,
//             backward in runs of H, and the last 256 ticks of a run are a
//             linear fade to the reader that takes over.
//   forward   SW0 held: the output becomes the input Td = 512 + 2H back,
//             starting at a wrap of p after the debounced press, the fade
//             up to it timed to end there.
//   release   SW0 let go: a fade after the debounced release, the reverse
//             model holds again, and halfway through the fade it does not.
//   smooth    a 500 Hz sine through both switches; no sample-to-sample step
//             larger than the sine's own, plus what the fades add.
//   repeats   forward mode, an impulse: echoes at Td, 2Td, 3Td, halving.
//   mix       pot2 at zero is the dry signal.
//
//   node assembler/sim-test/test-reverse.js

const path = require('path');
const FXCoreCore = require('../fxcore-emu.js');
const { assembleFile, loadInto } = require('./assemble.js');

const FS = 32000;
const AMP = 0.25;
const HAND = 256;            // reader hand-off, from the source
const LAG = 2 * HAND;        // the heard reader's least delay
const PRESSED = 0x7E, RELEASED = 0x7F;

let pass = 0, fail = 0; const failures = [];
function check(cond, name, detail) {
    console.log((cond ? '  ok    ' : '  FAIL  ') + name.padEnd(16) + detail);
    if (cond) pass++; else { fail++; failures.push(name); }
}

const img = assembleFile(path.join(__dirname, '../../test_programs/reverse-delay.fxc'));

// H as the program derives it: 256 + pot * 15872 with the pot in 12 bits,
// 256 + P * 31/8 floored.  Pots at multiples of 1/512 leave the forward tap
// on a whole sample too; the pot's top, 4095, does not.
function phaseLen(pot) { return 256 + Math.floor(Math.min(4095, Math.floor(pot * 4096)) * 31 / 8); }
function delayLen(H) { return LAG + 2 * H; }

// The mode fade: 2048 ticks, or the largest power of two within H.
function fadeLen(H) { return 2 ** Math.floor(Math.log2(Math.min(H, 2048))); }

const DEBOUNCE = new FXCoreCore().cfgSwDbRld;

function core(time, repeats, mix) {
    const c = new FXCoreCore();
    c.sampleRate = FS;
    loadInto(c, img);
    c.setPots([time, repeats, mix, 0, 0, 0]);
    for (let i = 0; i < 6; i++) {
        c.potRaw[i] = c.potTarget[i];
        c.potSmooth[i] = (c.potTarget[i] << 19) | 0;
    }
    return c;
}

// pins: an optional tick -> pin mask, applied at that tick
function run(c, x, pins) {
    const y = new Float64Array(x.length);
    for (let n = 0; n < x.length; n++) {
        if (pins && pins[n] !== undefined) c.setPins(pins[n]);
        c.run([x[n], 0, 0, 0]);
        y[n] = c.outputs[0] / 2147483648;
    }
    return y;
}

// What the delay line hands back: the input rounded to S.31, kept as S.15.
function q(v) { return Math.floor(Math.round(v * 2147483648) / 65536) * 65536 / 2147483648; }

function noise(samples, seed) {
    let s = seed >>> 0;
    const x = new Float64Array(samples);
    for (let i = 0; i < samples; i++) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        x[i] = (s / 4294967296 * 2 - 1) * AMP;
    }
    return x;
}

function sine(f, samples) {
    const x = new Float64Array(samples);
    for (let i = 0; i < samples; i++) x[i] = AMP * Math.sin(2 * Math.PI * f * i / FS);
    return x;
}

// The reverse output at tick n: the heard reader, and in the last HAND ticks
// of the phase its fade to the incoming one.
function reverseModel(x, n, H) {
    const p = n % H;
    const heard = q(x[n - LAG - 2 * p]);
    if (p < H - HAND) return heard;
    const inc = q(x[n - LAG - 2 * (p - H)]);
    return inc + (heard - inc) * (H - p) / HAND;
}

// The mix pot tops out at 4095/4096, so wet carries a 1/4096 of dry.
const TOL = AMP / 1024;

function mismatches(y, model, from, to) {
    let bad = 0, first = -1;
    for (let n = from; n < to; n++) {
        if (Math.abs(y[n] - model(n)) > TOL) { bad++; if (first < 0) first = n; }
    }
    return { bad, first };
}

// ---- reverse
console.log('--- reverse: noise comes back 512 + 2p samples late, faded at the hand-off ---');
for (const pot of [0.25, 0.5, 1]) {
    const H = phaseLen(pot);
    const x = noise(8 * H, 1);
    const y = run(core(pot, 0, 1), x);
    const m = mismatches(y, n => reverseModel(x, n, H), 3 * H, 8 * H);
    check(m.bad === 0, `reverse H=${H}`,
        `runs of ${(1000 * H / FS).toFixed(0)} ms, Td ${delayLen(H)}, ${5 * H} samples checked, ` +
        `${m.bad} off model${m.first >= 0 ? ' from ' + m.first : ''}`);
}

// ---- forward
console.log('--- forward: SW0 down, the input Td back from a wrap of p ---');
for (const pot of [0.25, 0.5]) {
    const H = phaseLen(pot), Td = delayLen(H), FADE = fadeLen(H);
    const press = 3 * H + 100;
    const x = noise(12 * H, 2);
    const y = run(core(pot, 0, 1), x, { [press]: PRESSED });
    // The first wrap from which the forward tap alone is heard.
    const fwd = n => q(x[n - Td]);
    let start = -1;
    for (let w = 4 * H; w < x.length && start < 0; w += H) {
        if (mismatches(y, fwd, w, x.length).bad === 0) start = w;
    }
    // The fade up to it: the heard reader alone giving way to the tap, and
    // nothing yet the tick before that.
    let worst = 0;
    for (let n = start - FADE; n < start; n++) {
        const a = (n - (start - FADE)) / FADE;
        worst = Math.max(worst, Math.abs(y[n] - (reverseModelHeld(x, n, H) * (1 - a) + fwd(n) * a)));
    }
    const before = Math.abs(y[start - FADE - 1] - reverseModel(x, start - FADE - 1, H));
    check(start > 0 && start >= press + DEBOUNCE && worst < TOL && before < TOL,
        `forward H=${H}`, `forward from tick ${start}` +
        (start > 0 ? ` = ${start / H} H, ${start - press - DEBOUNCE} after the debounced press; ` +
            `fade of ${FADE} within ${worst.toExponential(1)} of the model` : ''));
}

// While a switch is armed the hand-off is held off: the heard reader alone.
function reverseModelHeld(x, n, H) { return q(x[n - LAG - 2 * (n % H)]); }

// ---- release
console.log('--- release: SW0 up, reverse again a fade after the debounced release ---');
for (const pot of [0.25, 0.5]) {
    const H = phaseLen(pot), FADE = fadeLen(H);
    const press = 100, release = 6 * H;
    const x = noise(14 * H, 3);
    const y = run(core(pot, 0, 1), x, { [press]: PRESSED, [release]: RELEASED });
    const back = release + DEBOUNCE + FADE + 2;
    const m = mismatches(y, n => reverseModel(x, n, H), back, x.length);
    const mid = back - FADE / 2;
    const early = mismatches(y, n => reverseModel(x, n, H), mid, mid + 64);
    check(m.bad === 0 && early.bad === 64, `release H=${H}`,
        `reverse from ${back}, ${x.length - back} samples on model; mid-fade ${early.bad}/64 off it`);
}

// ---- smooth
console.log('--- smooth: a 500 Hz sine through a press and a release ---');
{
    const pot = 0.5, H = phaseLen(pot);
    const x = sine(500, 20 * H);
    const y = run(core(pot, 0, 1), x, { [4 * H]: PRESSED, [11 * H]: RELEASED });
    const own = AMP * 2 * Math.PI * 500 / FS;       // the sine's own largest step
    let worst = 0, at = 0;
    for (let n = 3 * H; n < x.length; n++) {
        const d = Math.abs(y[n] - y[n - 1]);
        if (d > worst) { worst = d; at = n; }
    }
    check(worst < own * 1.3, 'smooth',
        `largest step ${worst.toFixed(4)} at ${at}, the sine's own ${own.toFixed(4)}`);
}

// ---- repeats
console.log('--- repeats: forward mode, an impulse halves every Td ---');
{
    const pot = 0.25, H = phaseLen(pot), Td = delayLen(H);
    const at = 5 * H;                                 // well after the switch lands
    const x = new Float64Array(at + 4 * Td + 10); x[at] = AMP;
    const y = run(core(pot, 0.5, 1), x, { 0: PRESSED });
    const e = [1, 2, 3].map(k => y[at + k * Td]);
    const ratios = [e[1] / e[0], e[2] / e[1]];
    check(Math.abs(e[0] - AMP) < AMP / 512 && ratios.every(r => Math.abs(r - 0.5) < 0.01),
        'repeats', `echoes ${e.map(v => v.toFixed(4)).join(', ')} ratios ${ratios.map(r => r.toFixed(3)).join(', ')}`);
}

// ---- mix
console.log('--- mix: pot2 at zero is the dry signal ---');
{
    const x = noise(4000, 4);
    const y = run(core(0.5, 0.5, 0), x);
    let err = 0;
    for (let i = 0; i < x.length; i++) err = Math.max(err, Math.abs(y[i] - x[i]));
    check(err < 1 / 65536, 'mix dry', `max error ${err.toExponential(2)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.map(f => '  ' + f).join('\n')); process.exit(1); }
