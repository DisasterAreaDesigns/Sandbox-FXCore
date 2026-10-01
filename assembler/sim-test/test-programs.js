// Phase 1 gate: assemble the repo's own test programs with the real
// assembler and run them on the core. The LED programs need no audio at all,
// so they prove the core against behaviour that is visible on hardware.
//
//   node assembler/sim-test/test-programs.js

const path = require('path');
const FXCoreCore = require('../fxcore-emu.js');
const { assembleFile, loadInto } = require('./assemble.js');

const PROGDIR = path.join(__dirname, '..', '..', 'test_programs');

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, detail) {
    if (cond) pass++; else { fail++; failures.push(name + (detail ? '  ' + detail : '')); }
}

function load(name) {
    const img = assembleFile(path.join(PROGDIR, name));
    const c = new FXCoreCore();
    c.sampleRate = 48000;
    loadInto(c, img);
    return { core: c, image: img };
}

// ---------------------------------------------------------------
console.log('--- every test program assembles and runs clean ---');
const NAMES = ['both-led-on.fxc', 'alternate-blink.fxc', 'alternate-blink-simple.fxc',
    'fade-test.fxc', 'fs-test-hold.fxc', 'tap_lfo_takeover.fxc'];

for (const n of NAMES) {
    let r;
    try { r = load(n); } catch (e) { ok(`${n} assembles`, false, e.message); continue; }
    ok(`${n} assembles`, true);
    for (let i = 0; i < 2000; i++) r.core.run([0.1, -0.1, 0, 0]);
    const un = r.core.getState().unimplemented;
    ok(`${n} uses no unimplemented instruction`, un.length === 0, un.join(','));
    ok(`${n} runs to the end of the program`,
        r.core.lastPC === r.image.instructionCount,
        `lastPC ${r.core.lastPC} of ${r.image.instructionCount}`);
}

// ---------------------------------------------------------------
console.log('--- both-led-on: both USER pins go high and stay high ---');
{
    const { core } = load('both-led-on.fxc');
    core.run([0, 0, 0, 0]);
    ok('USER0 high', core.user[0] === 1);
    ok('USER1 high', core.user[1] === 1);
    let stuckOn = true;
    for (let i = 0; i < 5000; i++) {
        core.run([0, 0, 0, 0]);
        if (core.user[0] !== 1 || core.user[1] !== 1) stuckOn = false;
    }
    ok('both stay on', stuckOn);
}

// ---------------------------------------------------------------
console.log('--- alternate-blink: complementary, toggling every 8192 samples ---');
{
    const { core } = load('alternate-blink.fxc');
    const edges = [];
    let prev = -1, complementary = true;
    for (let n = 0; n < 8192 * 6; n++) {
        core.run([0, 0, 0, 0]);
        if (core.user[0] === core.user[1]) complementary = false;
        if (core.user[0] !== prev) { edges.push(n); prev = core.user[0]; }
    }
    ok('USER0 and USER1 are always complementary', complementary);
    ok('USER0 toggles', edges.length >= 5, `${edges.length} edges`);

    // The source says "flip the bit every 8192 samples"
    const gaps = [];
    for (let i = 1; i < edges.length; i++) gaps.push(edges[i] - edges[i - 1]);
    const allEight = gaps.every(g => g === 8192);
    ok('toggle interval is exactly 8192 samples', allEight,
        `gaps ${gaps.join(',')}`);

    // 8192 samples at 48 kHz is a 2.93 Hz blink, as the comment claims
    const hz = 48000 / (2 * 8192);
    ok('blink rate is ~2.93 Hz at 48 kHz', Math.abs(hz - 2.93) < 0.01,
        `${hz.toFixed(3)} Hz`);
}

// ---------------------------------------------------------------
console.log('--- tap_lfo_takeover: pot moves take over the LFO rate ---');
{
    const { core } = load('tap_lfo_takeover.fxc');

    // The .creg preset parks pot_speed at -0.5 so the first pot read always
    // looks like a big move and sets the rate.
    ok('pot_speed preset is negative', core.cregPreset[0] < 0,
        `0x${(core.cregPreset[0] >>> 0).toString(16)}`);

    // MAXTEMPO comes from `.sreg maxtempo tap_limit` with tap_limit = 96000
    ok('MAXTEMPO preset is 96000', core.sfr[core.SFR_MAXTEMPO] === 96000,
        `${core.sfr[core.SFR_MAXTEMPO]}`);

    // Sweep POT0 from 0 to 1 and confirm LFO0_F rises monotonically. The
    // source maps pot 0..1 onto 1..12 Hz.
    const rates = [];
    for (const p of [0.0, 0.25, 0.5, 0.75, 1.0]) {
        core.setPots([p, 0, 0, 0, 0, 0]);
        for (let i = 0; i < 40000; i++) core.run([0, 0, 0, 0]);   // let POT0_SMTH settle
        rates.push(core.sfr[core.SFR_LFO0_F]);
    }
    let rising = true;
    for (let i = 1; i < rates.length; i++) if (rates[i] <= rates[i - 1]) rising = false;
    ok('LFO0_F rises monotonically with POT0', rising, rates.join(','));

    const FS = 48000, K = (Math.pow(2, 31) - 1) * 2 * Math.PI / FS;
    const loHz = rates[0] / K, hiHz = rates[rates.length - 1] / K;

    // The program only rewrites the rate while |POT0_SMTH - pot_speed| exceeds
    // `.equ thresh 0.05`, so once the pot stops moving the stored value sits
    // up to one threshold below it -- by design, that is what makes a tapped
    // tempo stick until the pot is genuinely turned. Over a 1..12 Hz range
    // that is up to 0.05 * 11 = 0.55 Hz of lag, so test the mapping with the
    // threshold accounted for rather than against the ideal endpoints.
    const RANGE = 12 - 1, THRESH = 0.05;
    ok('POT0 fully down gives 1 Hz', Math.abs(loHz - 1) < 0.05, `${loHz.toFixed(3)} Hz`);
    ok('POT0 fully up gives 12 Hz less at most one threshold step',
        hiHz <= 12.01 && hiHz >= 12 - THRESH * RANGE - 0.05,
        `${hiHz.toFixed(3)} Hz, allowed ${(12 - THRESH * RANGE - 0.05).toFixed(3)}..12.01`);

    // And the hysteresis itself: the stored pot_speed should settle just
    // inside the threshold of the smoothed pot value.
    const gap = Math.abs(core.sfr[core.SFR_POT0_SMTH] - core.creg[0]) / 2147483648;
    ok('pot_speed settles just inside the 0.05 threshold',
        gap > 0.04 && gap <= 0.05, `gap ${gap.toFixed(5)}`);
}

// ---------------------------------------------------------------
console.log('');
if (fail) { console.log('FAILURES:'); for (const f of failures) console.log('  ' + f); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
