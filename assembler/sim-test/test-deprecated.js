// The deprecated ".I", ".L" and ".U" suffixes.
//
//   node assembler/sim-test/test-deprecated.js
//
// The instruction set document (v1.2, September 2025) deprecates all three in
// favour of the math functions and plain shifts and masks, but says they are
// "still supported in 2025.1" and will only be removed later. So they have to
// keep working, and ".I" has to say it is on the way out.
//
// ".I" did not work at all. It can be written on the directive (".equ.i n 2.7")
// or on the value (".creg r0 2.7.I"), and both were broken: the test looked at
// the directive token only and was case sensitive, so the lower case spelling
// the manual uses never fired, and the value form kept the suffix attached
// where nothing could parse it -- ".creg r0 200.I" failed as an unresolved
// symbol. The resolver had the same gap, stripping ".L" and ".U" but not ".I",
// so "coeff.I" was looked up with the suffix still on it.
//
// ".I" is defined as truncation, which is the limitation the document gives as
// the reason to prefer floor(), ceiling(), round() and truncate(): -2.7 is -2.

const { assemble } = require('./assemble.js');

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, detail) {
    if (cond) pass++; else { fail++; failures.push(name + (detail ? '  ' + detail : '')); }
}

const warningsIn = (img) => img.messages.filter((m) => m.kind === 'warnings').map((m) => m.msg);

function build(source, name) {
    try { return { img: assemble(source, name || 'deprecated') }; } catch (e) { return { err: e.message }; }
}

// ---------------------------------------------------------------
console.log('--- ".I" works, written on the directive or on the value ---');

const forms = [
    ['.equ.i n 200.7', '.equ.i n 200.7\n.creg r0 n\ncpy_cc acc32, r0\n', 200],
    ['.equ.I n 200.7', '.equ.I n 200.7\n.creg r0 n\ncpy_cc acc32, r0\n', 200],
    ['.equ n 200.7.I', '.equ n 200.7.I\n.creg r0 n\ncpy_cc acc32, r0\n', 200],
    ['.equ n 200.7.i', '.equ n 200.7.i\n.creg r0 n\ncpy_cc acc32, r0\n', 200],
    ['.creg.i r0 200.7', '.creg.i r0 200.7\ncpy_cc acc32, r0\n', 200],
    ['.creg r0 200.7.I', '.creg r0 200.7.I\ncpy_cc acc32, r0\n', 200],
    ['.creg r0 200.I', '.creg r0 200.I\ncpy_cc acc32, r0\n', 200]
];
for (const [label, src, want] of forms) {
    const r = build(src, label);
    ok(`${label} assembles`, r.img !== undefined, r.err ? r.err.split('\n')[1] : '');
    if (r.img) ok(`${label} is ${want}`, r.img.creg[0] === want, `got ${r.img.creg[0]}`);
}

// .mreg takes it too.
{
    const r = build('.mreg.i mr0 200.7\ncpy_cc acc32, r0\n');
    ok('.mreg.i mr0 200.7 is 200', r.img !== undefined && r.img.mreg[0] === 200,
        r.err ? r.err.split('\n')[1] : `${r.img.mreg[0]}`);
}

// ---------------------------------------------------------------
console.log('--- ".I" truncates, it does not round or floor ---');

const trunc = [['200.7', 200], ['-200.7', -200], ['2.9', 2], ['-2.9', -2], ['-0.5', 0]];
for (const [written, want] of trunc) {
    const r = build(`.creg r0 ${written}.I\ncpy_cc acc32, r0\n`);
    ok(`${written}.I is ${want}`, r.img !== undefined && r.img.creg[0] === want,
        r.err ? r.err.split('\n')[1] : `got ${r.img.creg[0]}`);
}

// The forcing belongs to the symbol, so an expression that uses it sees the
// whole number. Truncating only where the preset is built gave 29 here.
{
    const r = build('.equ n 2.9.I\n.creg r0 n*10\ncpy_cc acc32, r0\n');
    ok('the forcing travels: n = 2.9.I, n*10 is 20',
        r.img !== undefined && r.img.creg[0] === 20,
        r.err ? r.err.split('\n')[1] : `got ${r.img.creg[0]}`);
}

// And on an instruction parameter, which the resolver used to reject outright.
{
    const r = build('.equ v 200.7\naddi r0, v.I\n');
    ok('addi r0, v.I resolves', r.img !== undefined, r.err ? r.err.split('\n')[1] : '');
    if (r.img) ok('addi r0, v.I is 200', (r.img.program[0] & 0xFFFF) === 200,
        `${r.img.program[0] & 0xFFFF}`);
}

// ---------------------------------------------------------------
console.log('--- ".I" says it is deprecated ---');

{
    const r = build('.creg r0 200.7.I\ncpy_cc acc32, r0\n');
    const warns = r.img ? warningsIn(r.img) : [];
    ok('using .I warns', warns.length >= 1, 'no warning was raised');
    ok('the warning names the replacements',
        warns.some((w) => /deprecated/i.test(w) && /floor\(\)/.test(w) && /truncate\(\)/.test(w)),
        warns.join(' | '));
    ok('the warning is a warning, not an error',
        r.img !== undefined && r.img.messages.filter((m) => m.kind === 'errors').length === 0);
}

// One use, one warning -- the resolver runs more than one pass.
{
    const r = build('.creg r0 200.7.I\ncpy_cc acc32, r0\n');
    ok('one use raises one warning', r.img !== undefined && warningsIn(r.img).length === 1,
        r.img ? `${warningsIn(r.img).length} warnings` : '');
}

// Nothing to warn about when the suffix is absent.
{
    const r = build('.equ n 0.5\n.creg r0 n\ncpy_cc acc32, r0\n');
    ok('no .I means no warning', r.img !== undefined && warningsIn(r.img).length === 0,
        r.img ? warningsIn(r.img).join(' | ') : '');
    ok('and the preset is untouched', r.img !== undefined && (r.img.creg[0] >>> 0) === 0x40000000,
        r.img ? '0x' + (r.img.creg[0] >>> 0).toString(16) : '');
}

// ---------------------------------------------------------------
console.log('--- ".L" and ".U" still mean what the document says ---');

// Page 54 gives the old and the new way to load a 32-bit value and presents
// them as the same thing. They have to assemble to the same words.
{
    const FS = '.equ fs 48000\n';
    const older = build(FS
        + 'wrdld r0, (2*3.141592654*10/fs-2*3.141592654*0.05/fs)*2147483647.U\n'
        + 'ori r0, (2*3.141592654*10/fs-2*3.141592654*0.05/fs)*2147483647.L\n', 'old');
    const newer = build(FS
        + '.equ myval floor((2*pi()*10/fs-2*pi()*0.05/fs)*(2^31-1))\n'
        + 'wrdld r0, myval >> 16\nori r0, myval&0xffff\n', 'new');

    ok('the .U/.L form assembles', older.img !== undefined, older.err ? older.err.split('\n')[1] : '');
    ok('the floor()/shift form assembles', newer.img !== undefined, newer.err ? newer.err.split('\n')[1] : '');
    if (older.img && newer.img) {
        ok('both forms give the same wrdld', older.img.program[0] === newer.img.program[0],
            `${older.img.program[0]} vs ${newer.img.program[0]}`);
        ok('both forms give the same ori', older.img.program[1] === newer.img.program[1],
            `${older.img.program[1]} vs ${newer.img.program[1]}`);
    }
}

// ---------------------------------------------------------------
console.log('');
if (fail) { console.log('FAILURES:'); for (const f of failures) console.log('  ' + f); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
