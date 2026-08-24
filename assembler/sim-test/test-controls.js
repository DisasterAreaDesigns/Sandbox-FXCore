// Control naming from source comments, and the switch debounce / edge bits
// that the panel's momentary push buttons exercise.
//
//   node assembler/sim-test/test-controls.js

const FXCoreCore = require('../fxcore-emu.js');
const { simParseControlNames, simSwOn, simLatched, simPushed,
    simFillClick, simClickLength, SIM_CLICK_PERIOD } =
    require('../fxcore-sim.js');

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, detail) {
    if (cond) pass++; else { fail++; failures.push(name + (detail ? '  ' + detail : '')); }
}
function eq(name, got, want) {
    ok(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

// =====================================================================
console.log('--- #POTn / #SWn naming ---');
{
    const n = simParseControlNames([
        '; #POT0 Reverb time',
        '// #POT1 Damping',
        ';   #POT2   Pre-delay  ',
        '/* #SW4 Bypass */',
        '; #SW0 Freeze',
        '; #SW3 Modulation   ; a trailing comment must not be eaten',
        '; #POT4',                       // tag with no name
        '; #POT9 Out of range',          // no such pot
        '; #SW7 Out of range',           // no such switch
        'cpy_cs acc32, in0'
    ].join('\n'));

    eq('semicolon comment', n.pot[0], 'Reverb time');
    eq('double-slash comment', n.pot[1], 'Damping');
    eq('extra whitespace is trimmed', n.pot[2], 'Pre-delay');
    eq('block comment close is stripped', n.sw[4], 'Bypass');
    eq('switch naming', n.sw[0], 'Freeze');
    eq('trailing comment is stripped', n.sw[3], 'Modulation');
    eq('a tag with no name is ignored', n.pot[4], null);
    eq('untagged pot keeps no name', n.pot[3], null);
    eq('untagged switch keeps no name', n.sw[1], null);
    ok('out-of-range indices are ignored',
        n.pot.length === 6 && n.sw.length === 5);
    eq('untagged tap keeps no name', n.tap, null);
    ok('untagged LEDs keep no name', n.led.every(v => v === null));
}

console.log('--- #LEDn / #USERn naming ---');
{
    const n = simParseControlNames([
        '; #LED0 Bypass',
        '// #USER1 Tempo',
        '; #LED2 Out of range',          // there are only two lamps
        '; #USER0'                       // tag with no name, must not clear LED0
    ].join('\n'));
    eq('LED naming', n.led[0], 'Bypass');
    eq('USER naming is the same lamp set', n.led[1], 'Tempo');
    ok('out-of-range lamps are ignored', n.led.length === 2);

    eq('both spellings reach the same lamp',
        simParseControlNames('; #LED0 First\n; #USER0 Second').led[0], 'Second');
    eq('LED tags are case insensitive',
        simParseControlNames('; #led1 lower case').led[1], 'lower case');
    eq('block comment close is stripped from the LED name',
        simParseControlNames('/* #LED1 Clip */').led[1], 'Clip');
    // '#' is the .mem tail-pointer suffix, so a delay line called led0 must
    // not be read as a tag.
    eq('a delay named led0 does not rename LED0',
        simParseControlNames('.mem led0 1000\nrddel acc32, led0#').led[0], null);
}

console.log('--- #TAP naming ---');
{
    eq('tap naming', simParseControlNames('; #TAP Tempo').tap, 'Tempo');
    eq('tap tag is case insensitive',
        simParseControlNames('// #tap Delay time').tap, 'Delay time');
    eq('block comment close is stripped from the tap name',
        simParseControlNames('/* #TAP Speed */').tap, 'Speed');
    eq('a tap tag with no name is ignored',
        simParseControlNames('; #TAP').tap, null);
    eq('a later tap tag wins',
        simParseControlNames('; #TAP First\n; #TAP Second').tap, 'Second');
    // '#' is the .mem tail-pointer suffix, so a delay line called tap must
    // not be read as a tag.
    eq('a delay named tap does not rename the pad',
        simParseControlNames('.mem tap 1000\nrddel acc32, tap#').tap, null);
}

console.log('--- naming must not pick up code ---');
{
    // '#' is the .mem tail-pointer suffix, so a delay line called pot0 or sw0
    // must not be mistaken for a tag.
    const n = simParseControlNames([
        '.mem pot0 1000',
        'rddel acc32, pot0#',
        'rddel acc32, sw0#',
        '.mem delaya 500',
        'rddel acc32, delaya#',
        'wrdel delaya, acc32'
    ].join('\n'));
    ok('a delay named pot0 does not rename POT0', n.pot[0] === null, String(n.pot[0]));
    ok('a delay named sw0 does not rename SW0', n.sw[0] === null, String(n.sw[0]));

    // A tag only counts after a comment marker, so code can never trip it.
    const n2 = simParseControlNames('ori acc32, 0x1234 ; #POT0 Level');
    eq('a tag after code on the same line still works', n2.pot[0], 'Level');
}

console.log('--- case and repetition ---');
{
    const n = simParseControlNames('; #pot0 lower case\n; #Sw2 Mixed Case');
    eq('tags are case insensitive', n.pot[0], 'lower case');
    eq('switch tags are case insensitive', n.sw[2], 'Mixed Case');

    const n2 = simParseControlNames('; #POT0 First\n; #POT0 Second');
    eq('a later tag wins', n2.pot[0], 'Second');
}

console.log('--- empty and malformed input ---');
{
    ok('empty source is safe', simParseControlNames('').pot.every(v => v === null));
    ok('null source is safe', simParseControlNames(null).sw.every(v => v === null));
    ok('a bare hash is ignored', simParseControlNames('; # nothing').pot[0] === null);
}

console.log('--- latch and momentary combine ---');
{
    // A push inverts the latch rather than only pulling the pin down, so both
    // edges are reachable from the panel and the latch is left where it was.
    const state = (latch, push) => {
        simLatched.simSw0 = latch;
        simPushed.simSw0 = push;
        return simSwOn('simSw0');
    };
    ok('idle reads released',            state(false, false) === false);
    ok('latch alone reads pressed',      state(true, false) === true);
    ok('push alone reads pressed',       state(false, true) === true);
    ok('push on a latched switch releases it', state(true, true) === false);

    // An untouched switch has no entry in either map at all.
    delete simLatched.simSw3; delete simPushed.simSw3;
    ok('an untouched switch reads released', simSwOn('simSw3') === false);

    // ENABLE starts high, so the part is enabled before anything is clicked,
    // and its push is a momentary bypass.
    ok('ENABLE idles enabled', simLatched.simEnable === true);
    simPushed.simEnable = true;
    ok('a push on ENABLE bypasses for as long as it is held',
        simSwOn('simEnable') === false);
    simPushed.simEnable = false;
    ok('releasing ENABLE puts it back', simSwOn('simEnable') === true);

    simLatched.simSw0 = false; simPushed.simSw0 = false;
}

// =====================================================================
console.log('--- switch debounce and edge bits ---');
{
    const W = (op, r, m) => (((op & 0xFF) << 24) | ((r & 0xFF) << 16) | (m & 0xFFFF)) | 0;
    const c = new FXCoreCore();
    c.sampleRate = 48000;
    c.setProgram(Int32Array.from([W(0xB8, 0, 0)]));   // no-op pass
    const DB = c.cfgSwDbRld;                          // 480 samples by default

    const run = n => { for (let i = 0; i < n; i++) c.run([0, 0, 0, 0]); };
    const sw = () => c.sfr[c.SFR_SWITCH];

    // Step one sample at a time and watch for the edge, rather than trying to
    // land on the exact sample it fires -- the edge is one sample wide, so
    // running past it by one hides it entirely.
    function stepUntil(mask, limit) {
        let seenAt = -1, seenFor = 0;
        for (let i = 0; i < limit; i++) {
            c.run([0, 0, 0, 0]);
            if (sw() & mask) { if (seenAt < 0) seenAt = i; seenFor++; }
        }
        return { seenAt, seenFor };
    }

    run(5);
    ok('no phantom edges at reset', (sw() & 0x7FE0) === 0, sw().toString(16));
    run(DB + 10);
    ok('all switches read released at rest', (sw() & 0x1F) === 0x1F, sw().toString(16));

    // Press SW0: pins pull up, so pressed is a 0 on the pin.
    c.setPins(0x7F & ~0x01);
    const pe = stepUntil(0x0400, DB - 2);
    ok('a press is not seen before the debounce time',
        pe.seenAt === -1 && (sw() & 0x01) === 0x01);

    const pe2 = stepUntil(0x0400, 6);
    ok('SW0PE fires once the debounce elapses', pe2.seenAt >= 0, JSON.stringify(pe2));
    ok('SW0PE lasts exactly one sample', pe2.seenFor === 1, JSON.stringify(pe2));
    ok('a press registers as a level', (sw() & 0x01) === 0x00, sw().toString(16));

    // Release
    c.setPins(0x7F);
    const re = stepUntil(0x0020, DB + 6);
    ok('SW0RE fires on the release', re.seenAt >= 0, JSON.stringify(re));
    ok('SW0RE lasts exactly one sample', re.seenFor === 1, JSON.stringify(re));
    ok('the release registers as a level', (sw() & 0x01) === 0x01);

    // A momentary tap shorter than the debounce must be rejected entirely
    const before = sw();
    c.setPins(0x7F & ~0x02);
    run(Math.floor(DB / 3));
    c.setPins(0x7F);
    run(DB + 5);
    ok('a bounce shorter than SWDBRLD is rejected', (sw() & 0x02) === 0x02);
    ok('a rejected bounce fires no edge', (sw() & (0x0040 | 0x0800)) === 0,
        sw().toString(16));

    // The raw PIN register is not debounced
    c.setPins(0x7F & ~0x04);
    run(1);
    ok('PIN follows the pin immediately, undebounced',
        (c.sfr[c.SFR_PIN] & 0x04) === 0);
    ok('SWITCH still lags behind PIN', (sw() & 0x04) === 0x04);
}

// =====================================================================
console.log('--- USER pin duty cycle ---');
{
    const W = (op, r, m) => (((op & 0xFF) << 24) | ((r & 0xFF) << 16) | (m & 0xFFFF)) | 0;

    // A software PWM: count SAMPLECNT's low bits and light the pin while the
    // count is below a threshold. This is the shape every FXCore program uses
    // to dim an LED, and it switches far faster than any display refresh.
    const pwm = (numerator) => {
        const c = new FXCoreCore();
        c.sampleRate = 48000;
        c.setProgram(Int32Array.from([
            W(0x64, 16, 46),          // CPY_CS ACC32, SAMPLECNT
            W(0xA8, 16, 0xFF),        // ANDI ACC32, 0xFF     -> 0..255
            W(0x04, 16, (-numerator) & 0xFFFF),  // ADDI ACC32, -numerator
            W(0xB0, 16, 1),           // JNEG ACC32, +1   (below threshold)
            W(0xB8, 0, 1),            // JMP +1           (at or above)
            W(0xD4, 16, 0),           // SET USER0|0, ACC32   <- lit branch
            W(0xB8, 0, 0)             // JMP  (fall through)
        ]));
        return c;
    };

    // Simpler and more direct: drive the pin from a known bit of SAMPLECNT.
    const half = new FXCoreCore();
    half.sampleRate = 48000;
    half.setProgram(Int32Array.from([
        W(0x64, 16, 46),              // CPY_CS ACC32, SAMPLECNT
        W(0xD4, 16, 0)                // SET USER0|0, ACC32  -> bit 0 toggles
    ]));
    for (let i = 0; i < 4096; i++) half.run([0, 0, 0, 0]);
    let d = half.readUserDuty();
    ok('a pin toggling every sample reads as 50% duty',
        Math.abs(d[0] - 0.5) < 0.01, `${(d[0] * 100).toFixed(2)}%`);

    // Reading resets the accumulator
    for (let i = 0; i < 100; i++) half.run([0, 0, 0, 0]);
    const d2 = half.readUserDuty();
    ok('readUserDuty resets its window', Math.abs(d2[0] - 0.5) < 0.05,
        `${(d2[0] * 100).toFixed(2)}%`);
    ok('reading twice with no samples gives zero, not NaN',
        half.readUserDuty()[0] === 0);

    // A pin held high reads 100%, held low reads 0%
    const on = new FXCoreCore();
    on.setProgram(Int32Array.from([
        W(0xA4, 16, 1),               // ORI ACC32, 1
        W(0xD4, 16, 0)                // SET USER0|0, ACC32
    ]));
    for (let i = 0; i < 500; i++) on.run([0, 0, 0, 0]);
    ok('a pin held high reads 100%', on.readUserDuty()[0] === 1);

    const off = new FXCoreCore();
    off.setProgram(Int32Array.from([W(0xB8, 0, 0)]));
    for (let i = 0; i < 500; i++) off.run([0, 0, 0, 0]);
    ok('an untouched pin reads 0%', off.readUserDuty()[0] === 0);

    // USER1 is tracked independently
    const u1 = new FXCoreCore();
    u1.setProgram(Int32Array.from([
        W(0xA4, 16, 1),
        W(0xD4, 16, 0x20)             // SET USER1|0, ACC32
    ]));
    for (let i = 0; i < 300; i++) u1.run([0, 0, 0, 0]);
    const du = u1.readUserDuty();
    ok('USER0 and USER1 accumulate separately', du[0] === 0 && du[1] === 1,
        JSON.stringify(du));
}

// =====================================================================
console.log('--- tap tempo ---');
{
    const FS = 48000;
    const TAP = 1 << 6, UP = 0x7F, DOWN = 0x7F & ~(1 << 6);

    const mk = () => {
        const c = new FXCoreCore();
        c.sampleRate = FS;
        c.setProgram(Int32Array.from([0xB8000000]));   // no-op pass
        c.sfr[c.SFR_MAXTEMPO] = 2 * FS;                // allow slow taps
        return c;
    };
    const run = (c, n, pins) => { c.setPins(pins); for (let i = 0; i < n; i++) c.run([0, 0, 0, 0]); };
    const tapPair = (c, gap, hold = 700) => {
        run(c, 2000, UP);
        run(c, hold, DOWN);
        run(c, gap - hold, UP);
        run(c, hold, DOWN);
        run(c, 300, UP);
    };

    // The debounce delays both edges equally, so the measured interval is the
    // raw one -- worth pinning down, since a naive implementation would report
    // the interval short or long by one debounce period.
    for (const gap of [12000, 24000, 48000]) {
        const c = mk();
        tapPair(c, gap);
        ok(`two taps ${gap} samples apart measure ${gap}`,
            c.sfr[c.SFR_TAPTEMPO] === gap, `got ${c.sfr[c.SFR_TAPTEMPO]}`);
    }

    // NEWTT is set for exactly one sample when the measurement lands.
    {
        const c = mk();
        run(c, 2000, UP);
        run(c, 700, DOWN);
        run(c, 24000 - 700, UP);
        c.setPins(DOWN);
        let seen = 0;
        for (let i = 0; i < 1500; i++) { c.run([0, 0, 0, 0]); if (c.creg[17] & 0x0008) seen++; }
        ok('NEWTT is set for exactly one sample', seen === 1, `${seen} samples`);
    }

    // A single tap with no follow-up must time out at MAXTEMPO and leave the
    // block ready for a fresh first tap rather than pairing across the gap.
    {
        const c = mk();
        c.sfr[c.SFR_MAXTEMPO] = 10000;
        run(c, 2000, UP);
        run(c, 700, DOWN);
        run(c, 20000, UP);            // well past MAXTEMPO
        ok('a lone tap leaves TAPTEMPO unset', c.sfr[c.SFR_TAPTEMPO] === 0,
            `got ${c.sfr[c.SFR_TAPTEMPO]}`);
        // now a proper pair still measures correctly
        run(c, 700, DOWN);
        run(c, 8000 - 700, UP);
        run(c, 700, DOWN);
        run(c, 300, UP);
        ok('a pair after a timeout measures normally', c.sfr[c.SFR_TAPTEMPO] === 8000,
            `got ${c.sfr[c.SFR_TAPTEMPO]}`);
    }

    // TAPDB reflects the debounced level and is 1 when the button is up.
    {
        const c = mk();
        run(c, 2000, UP);
        ok('TAPDB is high with the button released', (c.creg[17] & 0x0001) === 1);
        run(c, 1000, DOWN);
        ok('TAPDB is low with the button held', (c.creg[17] & 0x0001) === 0);
    }

    // Holding past TAPSTKRLD sets TAPSTKY and holds it while pressed.
    {
        const c = mk();
        c.cfgTapStkRld = 5000;
        run(c, 2000, UP);
        c.setPins(DOWN);
        let sticky = 0;
        for (let i = 0; i < 12000; i++) { c.run([0, 0, 0, 0]); if (c.creg[17] & 0x0010) sticky++; }
        ok('TAPSTKY sets after TAPSTKRLD and stays set', sticky > 6000 && sticky < 7500,
            `${sticky} samples of 12000`);
        run(c, 1000, UP);
        ok('TAPSTKY clears on release', (c.creg[17] & 0x0010) === 0);
    }
}

// =====================================================================
// The click source. The buffer is a second long and looped, so what matters
// is that the click sits at the very top of it and everything after it is
// silent -- that is what puts the clicks exactly a second apart.
console.log('--- click source ---');
for (const rate of [12000, 24000, 32000, 48000]) {
    const period = Math.round(rate * SIM_CLICK_PERIOD);
    const data = simFillClick(new Float32Array(period), rate);
    const clickLen = simClickLength(rate);

    let peak = 0, peakAt = -1;
    for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i]) > peak) { peak = Math.abs(data[i]); peakAt = i; }
    }
    ok(`${rate}: one second of samples`, data.length === period, `${data.length}`);
    ok(`${rate}: click is loud enough to hear`, peak > 0.5 && peak <= 1,
        `peak ${peak.toFixed(3)}`);
    ok(`${rate}: peak is inside the click, not the silence`, peakAt < clickLen,
        `peak at ${peakAt} of ${clickLen}`);

    let tail = 0;
    for (let i = clickLen; i < data.length; i++) tail += Math.abs(data[i]);
    eq(`${rate}: dead silent between clicks`, tail, 0);

    // Down to nothing by the time the buffer goes silent, so looping does not
    // chop the burst off mid-swing and put a step in the signal.
    ok(`${rate}: click closes on a zero crossing`, Math.abs(data[clickLen - 1]) < 0.01,
        `last sample ${data[clickLen - 1].toExponential(2)}`);

    // A bare impulse would push DC through any feedback path; a windowed
    // whole-cycle burst should very nearly average out.
    let dc = 0;
    for (let i = 0; i < clickLen; i++) dc += data[i];
    ok(`${rate}: click carries no meaningful DC`, Math.abs(dc) < 0.01 * peak,
        `sum ${dc.toFixed(4)} vs peak ${peak.toFixed(3)}`);
}

{
    // A buffer shorter than one click still gets filled without running off
    // the end of it.
    const short = simFillClick(new Float32Array(4), 48000);
    ok('a buffer shorter than the click is filled, not overrun', short.length === 4);
    eq('first sample of a short buffer is the click start', short[0], 0);
}

console.log('');
if (fail) { console.log('FAILURES:'); for (const f of failures) console.log('  ' + f); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
