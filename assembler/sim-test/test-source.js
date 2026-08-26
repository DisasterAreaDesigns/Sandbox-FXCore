// The simulator's rendered test signals.
//
//   node assembler/sim-test/test-source.js

const { simPluckSignal, SIM_PLUCK_SECONDS, SIM_PLUCK_DECAY } =
    require('../fxcore-sim.js');

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, detail) {
    if (cond) pass++; else { fail++; failures.push(name + (detail ? '  ' + detail : '')); }
}

function pluck(rate, hz, seconds) {
    const n = Math.round(rate * (seconds === undefined ? SIM_PLUCK_SECONDS : seconds));
    return simPluckSignal(new Float32Array(n), rate, hz);
}

function peak(buf, from, to) {
    let p = 0;
    for (let i = from; i < to; i++) p = Math.max(p, Math.abs(buf[i]));
    return p;
}

// Lag of the strongest repeat, which is the period the string is ringing at.
function bestLag(buf, from, to, lo, hi) {
    let bestScore = -Infinity, best = 0;
    for (let lag = lo; lag <= hi; lag++) {
        let sum = 0;
        for (let i = from; i < to - lag; i++) sum += buf[i] * buf[i + lag];
        if (sum > bestScore) { bestScore = sum; best = lag; }
    }
    return best;
}


// =====================================================================
console.log('--- pluck ---');
{
    const a = pluck(48000, 196);
    const b = pluck(48000, 196);

    ok('the length asked for is the length returned',
        a.length === 48000 * SIM_PLUCK_SECONDS, `got ${a.length}`);
    ok('the same settings give the same signal every time',
        a.every((v, i) => v === b[i]));
    ok('it stays inside the converter\'s 0.4 headroom',
        peak(a, 0, a.length) <= 0.4 + 1e-6, `peak ${peak(a, 0, a.length)}`);
    ok('every sample is finite', a.every(v => Number.isFinite(v)));
    ok('it opens with the transient, not silence', peak(a, 0, 200) > 0.05,
        `peak ${peak(a, 0, 200)}`);
    ok('it peaks on the transient, at the converter\'s 0.4',
        Math.abs(peak(a, 0, 480) - 0.4) < 1e-3, `peak ${peak(a, 0, 480)}`);
    // The whole point of quoting the loss per second: what is left after a
    // second is SIM_PLUCK_DECAY of the note, give or take the pick filter.
    ok('it is down to roughly the quoted decay after a second',
        peak(a, 48000, 50400) < 0.4 * SIM_PLUCK_DECAY,
        `${peak(a, 48000, 50400).toFixed(4)} of 0.4`);
    ok('the tail is silent by the loop seam',
        peak(a, a.length - 240, a.length) < 1e-3,
        `peak ${peak(a, a.length - 240, a.length).toExponential(2)}`);
}

console.log('--- pitch ---');
{
    for (const hz of [82, 196, 440, 1000]) {
        const buf = pluck(48000, hz, 0.2);
        const period = Math.round(48000 / hz);
        const lag = bestLag(buf, 0, buf.length, Math.max(2, period - 30), period + 30);
        ok(`${hz} Hz rings at its own period`, Math.abs(lag - period) <= 1,
            `lag ${lag} want ${period}`);
    }
}

console.log('--- sample rate ---');
{
    // Both losses are quoted in seconds and hertz, so neither the PLL rate
    // nor the note being played should change how long the pluck lasts.
    const half = (buf, rate) => peak(buf, Math.round(rate * 0.5),
        Math.round(rate * 0.55));
    const at48 = half(pluck(48000, 196), 48000);
    const at12 = half(pluck(12000, 196), 12000);
    ok('the note decays at much the same rate at 12 kHz as at 48 kHz',
        at48 > at12 / 2 && at48 < at12 * 2,
        `48k ${at48.toFixed(4)}, 12k ${at12.toFixed(4)}`);

    const low = half(pluck(48000, 82), 48000);
    const high = half(pluck(48000, 880), 48000);
    ok('a low note fades like a high one rather than ringing on',
        low < high * 4, `82 Hz ${low.toFixed(4)}, 880 Hz ${high.toFixed(4)}`);

    // Nothing stops the freq slider being taken above the rate the panel is
    // running at; a period of one sample would divide by zero.
    const silly = simPluckSignal(new Float32Array(1200), 12000, 5000);
    ok('a frequency above Nyquist still renders',
        silly.every(v => Number.isFinite(v)) && peak(silly, 0, 200) > 0);
}

// =====================================================================
console.log(`\n${pass} passed, ${fail} failed`);
failures.forEach(f => console.log('  FAIL ' + f));
process.exit(fail ? 1 : 0);
