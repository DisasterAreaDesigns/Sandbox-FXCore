// The expression evaluator: infix to RPN, RPN to a number.
//
//   node assembler/sim-test/test-expressions.js
//
// Two things used to go wrong here. Every error path called process.exit(1),
// which does not exist in a browser -- so a mismatched parenthesis surfaced as
// "process is not defined" and the real message was never printed -- and under
// Node it took the whole run down with it. And nothing checked that the RPN
// actually reduced: "1 +" came back as NaN and "1 2" as 2, each travelling on
// into the program as though it were the number the source asked for.
//
// The precedence cases below are here to pin the two deliberate deviations from
// C. The shifts bind loosest of all and "^" is left associative, both because
// the C# assembler does it that way; a program written against one and
// assembled by the other would change meaning silently.

const { assemble, evaluate, makeContext } = require('./assemble.js');

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, detail) {
    if (cond) pass++; else { fail++; failures.push(name + (detail ? '  ' + detail : '')); }
}

// One VM for the whole suite: the assembler is not cheap to start.
const ctx = makeContext();
const val = (text) => evaluate(text, ctx);

function threw(text) {
    try { val(text); return null; } catch (e) { return e.message; }
}

function is(text, want) {
    let got;
    try { got = val(text); } catch (e) { got = 'THREW: ' + e.message; }
    ok(`${text} = ${want}`, got === want, `got ${got}`);
}

// ---------------------------------------------------------------
console.log('--- arithmetic ---');

is('1+2*3', 7);
is('2*3+4', 10);
is('(1+2)*3', 9);
is('2*(3+(4*5))', 46);
is('(1+2)*(3+4)', 21);
is('10/2/5', 1);          // left associative
is('8-3-2', 3);           // left associative
is('1.5*2', 3);
is('0.5+0.25', 0.75);
is('-(3+4)', -7);
is('3*-2', -6);
is('-5', -5);
is('5', 5);

// ---------------------------------------------------------------
console.log('--- precedence, including the two deliberate oddities ---');

is('2^31', 2147483648);
is('2^31-1', 2147483647);
is('(2^31-1)*2', 4294967294);

// "^" is left associative here: (2^3)^2, not 2^(3^2) = 512.
is('2^3^2', 64);
// The tokenizer attaches the leading "-" to the number, so this is (-2)^2.
is('-2^2', 4);

// The shifts bind loosest of all, looser than "|" and "&".
is('1<<2|1', 8);          // 1 << (2|1)
is('8>>1+1', 2);          // 8 >> (1+1)
// "|" and "&" sit at one level together, left to right.
is('1|2&3', 3);           // (1|2) & 3
is('1+2|4', 7);           // (1+2) | 4
is('255&15', 15);
is('16|1', 17);
is('16>>2', 4);
is('1<<4', 16);

// ---------------------------------------------------------------
console.log('--- number bases ---');

// parseFloat reads "0x10" as 0, so hex and binary are parsed by base here.
// The three callers convert before they call in, which hid this; the evaluator
// now gets it right on its own.
is('0x10+1', 17);
is('0xFF00|0x00FF', 65535);
is('0b1010+0', 10);
is('0b1010_1100+0', 172);
is('0x10*0x10', 256);

// ---------------------------------------------------------------
console.log('--- whitespace ---');

// Spaces used to reach the parser's default case and be reported as a parse
// error, so an expression only solved if the caller had squeezed them out.
is('10 - 3', 7);
is('2 * 3', 6);
is('( 1 + 2 ) * 3', 9);
is('2 ^ 3', 8);

// ---------------------------------------------------------------
console.log('--- math functions ---');

const fns = [
    ['PI()', Math.PI], ['PI()*2', Math.PI * 2], ['2*PI()', Math.PI * 2], ['-PI()', -Math.PI],
    ['SIN(0)', 0], ['COS(0)', 1], ['TAN(0)', 0], ['SIN(PI()/2)', 1], ['-SIN(0)', -0],
    ['EXP(0)', 1], ['LN(1)', 0], ['LOG10(100)', 2], ['LOG2(8)', 3],
    ['ABS(-3)', 3], ['FACT(5)', 120], ['FACT(0)', 1],
    ['FLOOR(2.7)', 2], ['CEILING(2.1)', 3], ['ROUND(2.5)', 3], ['TRUNCATE(2.9)', 2],
    ['FLOOR(-2.7)', -3], ['CEILING(-2.1)', -2], ['TRUNCATE(-2.9)', -2]
];
for (const [text, want] of fns) is(text, want);

// The names are case insensitive, which matters now that the rounding four are
// the documented way to get an integer where ".I" used to be used.
for (const text of ['floor(2.7)', 'ceiling(2.1)', 'round(2.5)', 'truncate(2.9)', 'pi()']) {
    let got;
    try { got = val(text); } catch (e) { got = 'THREW: ' + e.message; }
    ok(`${text} works in lower case`, typeof got === 'number', `got ${got}`);
}

// ---------------------------------------------------------------
console.log('--- errors are errors, and say what is wrong ---');

// Every one of these used to raise "process is not defined" in the browser and
// kill the process under Node.
const bad = [
    ['3*(2+1', /missing close/i],
    ['1+2)', /missing open/i],
    ['1+', /missing operand/i],
    ['*2', /missing operand/i],
    ['1 2', /one value|missing an operator|missing operator/i],
    ['4/0', /division by zero/i],
    ['', /stack empty/i],
    ['NOPE(1)', /unknown math function/i]
];
for (const [text, pattern] of bad) {
    const msg = threw(text);
    ok(`"${text}" is rejected`, msg !== null, 'it returned a value');
    if (msg !== null) {
        ok(`"${text}" says why`, pattern.test(msg), `message was: ${msg}`);
        ok(`"${text}" is not a process.exit crash`, !/process is not defined/.test(msg), msg);
    }
}

// ---------------------------------------------------------------
console.log('--- and the same through a whole assembly ---');

// An expression with spaces, hex, and a rounding function, resolved by the
// symbol table and used as a register preset. Because an integer valued result
// is typed INT, these land as raw register words rather than S.31 fractions --
// which is what makes the rounding functions usable where ".I" once was.
{
    const img = assemble('.equ base 0x10\n.equ n base * 2 + 1\n'
        + '.creg r0 n\n.creg r1 ROUND(0.5*2^31)\n.creg r2 floor(2.7)\n'
        + 'cpy_cc acc32, r0\n', 'expressions');
    ok('.equ n base * 2 + 1 is 33', img.creg[0] === 33, `${img.creg[0]}`);
    ok('.creg r1 ROUND(0.5*2^31) is a raw 0x40000000',
        (img.creg[1] >>> 0) === 0x40000000, '0x' + (img.creg[1] >>> 0).toString(16));
    ok('.creg r2 floor(2.7) is 2', img.creg[2] === 2, `${img.creg[2]}`);
}

// A broken expression fails the assembly with the evaluator's message rather
// than taking the process down.
{
    let msg = null;
    try { assemble('.equ n (1+2\n.creg r0 n\ncpy_cc acc32, r0\n', 'broken'); }
    catch (e) { msg = e.message; }
    ok('an unclosed paren fails the assembly', msg !== null, 'it assembled');
    ok('and does not crash with process.exit', msg === null || !/process is not defined/.test(msg), msg);
}

// ---------------------------------------------------------------
console.log('');
if (fail) { console.log('FAILURES:'); for (const f of failures) console.log('  ' + f); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
