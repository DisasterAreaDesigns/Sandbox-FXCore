// Register presets: does the word loaded into the register mean the number the
// source wrote?
//
//   node assembler/sim-test/test-presets.js
//
// `.creg`, `.mreg` and `.sreg` take either a raw integer register word or an
// S.31 fraction, and the assembler decides which by the symbol's subtype. Two
// things went wrong there.
//
// The subtype was clobbered. Any preset written as an expression came back from
// the resolver marked DEC, so an integer took the fraction path: `.creg r0 200`
// gave 200 but `.creg r0 100*2` scaled it, wrapped, and gave -200 -- no error,
// just a different register.
//
// A value out of S.31 range used to wrap silently; it is now rejected.
//
// The fraction itself follows THE CLI, THE GOLDEN STANDARD: scale by
// 0x7FFFFFFF and truncate toward zero, so 0.5 presets as 0x3FFFFFFF and -1.0 as
// 0x80000001 (a CLI 2.x listing of syntax_ring_i2s shows `.creg carrier -1.000`
// as exactly that). Builds 18-23 rounded instead; if the CLI ever rounds, flip
// common.cliFraction and these expectations. Presets and imm16d/imm8d
// immediates go through the same conversion, so the same number still gives
// the same top bits.

const { assemble } = require('./assemble.js');

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, detail) {
    if (cond) pass++; else { fail++; failures.push(name + (detail ? '  ' + detail : '')); }
}

const hex = (v) => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0');

// The assembler is not cheap to start, so presets go in one program and are
// read back per register: `.creg rN` lands in creg[N], `.mreg mrN` in mreg[N].
function presets(lines) {
    return assemble(lines.join('\n') + '\ncpy_cc acc32, r0\n', 'presets');
}

function rejects(source) {
    try { assemble(source, 'presets-range'); return null; } catch (e) { return e.message; }
}

// ---------------------------------------------------------------
console.log('--- S.31 presets match the CLI ---');

const frac = [
    ['0.5', 0x3FFFFFFF],
    ['0.75', 0x5FFFFFFF],
    ['0.25', 0x1FFFFFFF],
    ['-0.5', 0xC0000001],
    ['-1.0', 0x80000001],
    ['0', 0x00000000],
];
{
    const img = presets(frac.map(([v], i) => `.creg r${i} ${v}`));
    frac.forEach(([v, want], i) => {
        ok(`.creg r${i} ${v}`, (img.creg[i] >>> 0) === want >>> 0,
            `got ${hex(img.creg[i])}, want ${hex(want)}`);
    });
}

// 0.5 and -1.0 are the two that separate truncation from rounding.
{
    const img = presets(['.creg r0 0.5', '.creg r1 -1.0']);
    ok('0.5 is 0x3FFFFFFF, as the CLI emits', (img.creg[0] >>> 0) === 0x3FFFFFFF, hex(img.creg[0]));
    ok('-1.0 is 0x80000001, as the CLI emits', (img.creg[1] >>> 0) === 0x80000001, hex(img.creg[1]));
}

// ---------------------------------------------------------------
console.log('--- an integer preset stays an integer, however it is written ---');

// The pair that used to disagree: same value, one written as an expression.
{
    const img = presets(['.creg r0 200', '.creg r1 100*2', '.creg r2 100+100',
        '.creg r3 400/2', '.mreg mr0 200', '.mreg mr1 100*2']);
    ok('.creg r0 200', img.creg[0] === 200, hex(img.creg[0]));
    ok('.creg r1 100*2 == .creg r0 200', img.creg[1] === img.creg[0],
        `${hex(img.creg[1])} vs ${hex(img.creg[0])}`);
    ok('.creg r2 100+100 == 200', img.creg[2] === 200, hex(img.creg[2]));
    ok('.creg r3 400/2 == 200', img.creg[3] === 200, hex(img.creg[3]));
    ok('.mreg mr1 100*2 == .mreg mr0 200', img.mreg[1] === img.mreg[0],
        `${hex(img.mreg[1])} vs ${hex(img.mreg[0])}`);
}

// An expression that really is fractional still takes the fraction path.
{
    const img = presets(['.creg r0 1.0/2', '.creg r1 0.25*3', '.creg r2 1.0/4']);
    ok('.creg r0 1.0/2 is 0x3FFFFFFF', (img.creg[0] >>> 0) === 0x3FFFFFFF, hex(img.creg[0]));
    ok('.creg r1 0.25*3 is 0x5FFFFFFF', (img.creg[1] >>> 0) === 0x5FFFFFFF, hex(img.creg[1]));
    ok('.creg r2 1.0/4 is 0x1FFFFFFF', (img.creg[2] >>> 0) === 0x1FFFFFFF, hex(img.creg[2]));
}

// ---------------------------------------------------------------
console.log('--- presets and immediates agree ---');

// A preset is an S.31 word and an imm16d an S.15 one, so the immediate is the
// top 16 bits of the preset. Both go through common.cliFraction, so the same
// number gives the same bits.
{
    const img = assemble('.creg r0 0.5\n.creg r1 0.75\n.creg r2 -0.5\n'
        + 'multri acc32, 0.5\nmultri acc32, 0.75\nmultri acc32, -0.5\n', 'agree');
    [0, 1, 2].forEach((i) => {
        const top = (img.creg[i] >>> 16) & 0xFFFF;
        const imm = img.program[i] & 0xFFFF;
        ok(`preset ${hex(img.creg[i])} tops match immediate`, top === imm,
            `preset top ${top}, immediate ${imm}`);
    });
}

// ---------------------------------------------------------------
console.log('--- out of S.31 range is an error, not a wrap ---');

for (const bad of ['5.0', '-1.5', '1.0', '2.5']) {
    const msg = rejects(`.creg r0 ${bad}\ncpy_cc acc32, r0\n`);
    ok(`.creg r0 ${bad} is rejected`, msg !== null && /out of range/i.test(msg),
        msg === null ? 'assembled' : msg.split('\n')[1]);
}

// The boundaries themselves are legal: -1.0 exactly, and just under 1.0.
{
    const img = presets(['.creg r0 -1.0', '.creg r1 0.999999999']);
    ok('-1.0 is in range', (img.creg[0] >>> 0) === 0x80000001, hex(img.creg[0]));
    ok('0.999999999 is in range', (img.creg[1] >>> 0) === 0x7FFFFFFC, hex(img.creg[1]));
}

// ---------------------------------------------------------------
console.log('');
if (fail) { console.log('FAILURES:'); for (const f of failures) console.log('  ' + f); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
