// Control naming from source comments, and the switch debounce / edge bits
// that the panel's momentary push buttons exercise.
//
//   node assembler/sim-test/test-controls.js

const FXCoreCore = require('../fxcore-emu.js');
const { simParseControlNames } = require('../fxcore-sim.js');

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

console.log('');
if (fail) { console.log('FAILURES:'); for (const f of failures) console.log('  ' + f); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
