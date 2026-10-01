// Fixed point immediates written as the field's word rather than as a fraction:
// does the assembler read the base the source wrote?
//
//   node assembler/sim-test/test-fieldwords.js
//
// imm8d and imm16d parameters are S.7 and S.15 fractions, and hex or binary is
// how you write the encoded word itself, so "addsi acc32, 0.5" and
// "addsi acc32, 0x4000" are meant to be the same instruction. The assembler
// chose between the two by asking whether the parameter's *text* started with
// "0x", which is not the same question, and got it wrong in both directions:
//
//   - a hex word behind a symbol, a parenthesis or anything else at all took
//     the fraction path and was rejected as out of range, so what "0x4000"
//     assembled to, ".equ coeff 0x4000" plus "coeff" would not assemble at all
//   - the word path floored, so "0x2/4" -- a legitimate 0.5 -- assembled as
//     0x0000 without a word said
//   - the word path's range stopped at 0x7FFF, putting every negative
//     coefficient, 0xC000 for -0.5 among them, out of reach of hex entirely
//
// imm8d had no word path at all: "apa 0x40, 100" was rejected outright.

const { assemble } = require('./assemble.js');

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, detail) {
    if (cond) pass++; else { fail++; failures.push(name + (detail ? '  ' + detail : '')); }
}

// Refusing to assemble is a wrong answer here rather than a crash, so these
// return null for it and let the check that wanted a word report the failure.
function field(source, shift, mask) {
    try {
        const img = assemble(source + '\n', 'fieldwords');
        return (img.program[img.program.length - 1] >>> shift) & mask;
    } catch {
        return null;
    }
}
// "0x40", or "refused" for the null above.
const hex = (v) => (v === null ? 'refused' : '0x' + v.toString(16));

// The M field, where ADDSI carries its S.15 immediate.
const mfield = (source) => field(source, 0, 0xFFFF);
// The R field, where APA carries its S.7 coefficient.
const rfield = (source) => field(source, 16, 0xFF);
// The assembler's own complaint, or null if it assembled.
function refused(source) {
    try { assemble(source + '\n', 'fieldwords'); return null; } catch (e) { return e.message; }
}

// ---------------------------------------------------------------
console.log('--- a hex or binary S.15 immediate is the field word ---');

const asWord = [
    ['addsi acc32, 0x4000', 0x4000],
    ['addsi acc32, 0X4000', 0x4000],
    ['addsi acc32, 0b0100_0000_0000_0000', 0x4000],
    // The top bit is the sign. Half of every coefficient lives up here and none
    // of it could be written in hex before.
    ['addsi acc32, 0xC000', 0xC000],
    ['addsi acc32, 0x8000', 0x8000],
    ['addsi acc32, 0xFFFF', 0xFFFF]
];
for (const [source, want] of asWord) {
    const got = mfield(source);
    ok(source, got === want, `got ${hex(got)}, want ${hex(want)}`);
}

// The same word, written every way that used to hide it from the "0x" test.
const hidden = [
    'addsi acc32, (0x4000)',
    'addsi acc32, 0x2000+0x2000',
    'addsi acc32, 0x8000/2',
    'addsi acc32, 0x1<<14',
    '.equ coeff 0x4000\naddsi acc32, coeff',
    '.equ coeff 0b0100_0000_0000_0000\naddsi acc32, coeff',
    '.equ coeff 0x2000\naddsi acc32, coeff*2'
];
for (const source of hidden) {
    const got = mfield(source);
    ok(source.replace('\n', ' / '), got === 0x4000, `got ${hex(got)}, want 0x4000`);
}

// ---------------------------------------------------------------
console.log('--- and the same one written as a fraction agrees with it ---');

ok('0.5 and 0x4000 are one instruction',
    mfield('addsi acc32, 0.5') === mfield('addsi acc32, 0x4000'));
ok('-0.5 and 0xC000 are one instruction',
    mfield('addsi acc32, -0.5') === mfield('addsi acc32, 0xC000'));
ok('-1.0 and 0x8000 are one instruction',
    mfield('addsi acc32, -1.0') === mfield('addsi acc32, 0x8000'));

// ---------------------------------------------------------------
console.log('--- a fraction is a fraction whatever base its parts were in ---');

// The one that used to floor to nothing.
const quarters = [
    ['addsi acc32, 0x2/4', 0x4000],
    ['addsi acc32, 0x4000/0x8000', 0x4000],
    ['addsi acc32, 0x1/4', 0x2000],
    ['.equ half 0x2\naddsi acc32, half/4', 0x4000]
];
for (const [source, want] of quarters) {
    const got = mfield(source);
    ok(source.replace('\n', ' / '), got === want, `got ${hex(got)}, want ${hex(want)}`);
}

// A number written with a point stays a fraction even when it lands on a whole
// one, so -1.0 is still -1.0 and not the word 0xFFFF.
ok('-1.0 is the fraction, not the word -1', mfield('addsi acc32, -1.0') === 0x8000);
ok('-1 is the fraction too', mfield('addsi acc32, -1') === 0x8000);
ok('.equ of -1.0 is still the fraction',
    mfield('.equ minus_one -1.0\naddsi acc32, minus_one') === 0x8000);
ok('0 is 0 either way', mfield('addsi acc32, 0') === 0);

// ---------------------------------------------------------------
console.log('--- what was an error stays an error ---');

// A decimal that will not fit an S.15 is still the mistake it always was --
// this is why an integer with no hex in it is read as a fraction and not as a
// word. "addsi acc32, 1" is someone reaching for 1.0.
for (const bad of ['1', '1.0', '2.0', '-1.5', '100']) {
    const msg = refused(`addsi acc32, ${bad}`);
    ok(`addsi acc32, ${bad} is refused`, msg !== null && /out of range/i.test(msg), msg || 'assembled');
}
// A point anywhere in the expression makes the whole thing a fraction, hex or
// no hex, so this is out of range rather than the word 1.
ok('0.5*0x2 is refused', /out of range/i.test(refused('addsi acc32, 0.5*0x2') || ''));
// And a word that will not fit the field.
ok('0x1FFFF is refused', /out of range/i.test(refused('addsi acc32, 0x1FFFF') || ''));

// ---------------------------------------------------------------
console.log('--- the S.7 field, which had no word path at all ---');

const s7 = [
    ['apa 0x40, 100', 0x40],
    ['apa 0xC0, 100', 0xC0],
    ['apa 0b0100_0000, 100', 0x40],
    ['apa 0x80/2, 100', 0x40],
    ['.equ coeff 0x40\napa coeff, 100', 0x40],
    ['apb 0x40, 100', 0x40],
    ['macid 0x40, 100', 0x40]
];
for (const [source, want] of s7) {
    const got = rfield(source);
    ok(source.replace('\n', ' / '), got === want, `got ${hex(got)}, want ${hex(want)}`);
}
ok('apa 0.5 and apa 0x40 are one instruction',
    rfield('apa 0.5, 100') === rfield('apa 0x40, 100'));
ok('apa -1 is the fraction', rfield('apa -1, 100') === 0x80);
ok('apa 0x100 is refused', /out of range/i.test(refused('apa 0x100, 100') || ''));

// ---------------------------------------------------------------
console.log('--- ".L" and ".U" split a whole word, not a fraction ---');

// Halving a fraction masked it down to nothing, so this assembled as zero in
// silence. It is refused now.
for (const bad of ['0.5.L', '0.5.U', '0.6.L']) {
    const msg = refused(`addsi acc32, ${bad}`);
    ok(`addsi acc32, ${bad} is refused`, msg !== null && /\.L.*\.U|fraction/i.test(msg),
        msg || 'assembled');
}
ok('.equ of a fraction, split, is refused too',
    refused('.equ coeff 0.6\naddsi acc32, coeff.U') !== null);

// Splitting a whole 32-bit word still works, which is what the suffixes are for.
ok('0x12345678.U is the upper half', mfield('addsi acc32, 0x12345678.U') === 0x1234,
    `got ${hex(mfield('addsi acc32, 0x12345678.U'))}`);
ok('0x12345678.L is the lower half', mfield('addsi acc32, 0x12345678.L') === 0x5678,
    `got ${hex(mfield('addsi acc32, 0x12345678.L'))}`);

// ---------------------------------------------------------------
console.log('');
if (fail) { console.log('FAILURES:'); for (const f of failures) console.log('  ' + f); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
