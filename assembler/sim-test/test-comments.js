// Comments: the three passes have to agree on what one is.
//
//   node assembler/sim-test/test-comments.js
//
// The preprocessor, the symbol table and the assembler each read the source
// line by line, and each used to strip comments its own way. They disagreed in
// two places that changed the program silently.
//
// The symbol table kept its "am I inside a block comment" flag inside the
// per-line loop, so a block comment ended at the newline. A `.equ` sitting
// inside `/* */` still defined its symbol, which meant commenting a directive
// out did nothing and a commented out copy of a live one was reported as a
// duplicate declaration.
//
// The assembler looked for `/*` before it handled `;` and `//`, so a `/*`
// written inside a line comment opened a block that ran to the end of the file
// and swallowed every instruction after it.
//
// All three now call common.stripComments, so the answers below hold whichever
// pass is asking.

const { assemble } = require('./assemble.js');

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, detail) {
    if (cond) pass++; else { fail++; failures.push(name + (detail ? '  ' + detail : '')); }
}

function build(source) {
    try { return { img: assemble(source, 'comments') }; } catch (e) { return { err: e.message }; }
}

// ---------------------------------------------------------------
console.log('--- a directive inside a block comment is not a directive ---');

// The symbol never gets defined, so the reference to it has to fail. This used
// to assemble, quietly picking up the commented out value.
{
    const r = build('/*\n.equ gain 0.5\n*/\nmultri acc32, gain\n');
    ok('.equ inside /* */ does not define its symbol',
        r.err !== undefined && /not found/i.test(r.err),
        r.err ? r.err.split('\n')[1] : 'assembled');
}

// And commenting a directive out so a live one can replace it is not a
// duplicate declaration. This used to be a hard error.
{
    const r = build('.equ gain 0.5\n/*\n.equ gain 0.25\n*/\nmultri acc32, gain\n');
    ok('a commented out .equ does not collide with the live one', r.img !== undefined,
        r.err ? r.err.split('\n')[1] : '');
    if (r.img) {
        ok('the live .equ is the one that is used', (r.img.program[0] & 0xFFFF) === 0x4000,
            `M field 0x${(r.img.program[0] & 0xFFFF).toString(16)}, want 0x4000`);
    }
}

// The same for a register preset, which the symbol table walks separately.
{
    const r = build('.creg r0 0.5\n/*\n.creg r0 0.25\n*/\ncpy_cc acc32, r0\n');
    ok('a commented out .creg does not collide', r.img !== undefined,
        r.err ? r.err.split('\n')[1] : '');
    if (r.img) {
        ok('the live .creg preset wins', (r.img.creg[0] >>> 0) === 0x40000000,
            '0x' + (r.img.creg[0] >>> 0).toString(16));
    }
}

// ---------------------------------------------------------------
console.log('--- a line comment wins over a block opener inside it ---');

// `; ... /*` and `// ... /*` end at the newline. The `/*` is just text. Before
// the fix it opened a block that ate the rest of the program: the two
// instructions below assembled to nothing at all.
for (const lead of [';', '//']) {
    const r = build(`${lead} not a block: /* opener\ncpy_cc acc32, r0\ncpy_cc acc32, r1\n`);
    ok(`"${lead}" comment containing /* does not open a block`,
        r.img !== undefined && r.img.instructionCount === 2,
        r.err ? r.err.split('\n')[1] : `n=${r.img && r.img.instructionCount}, want 2`);
}

// A trailing line comment after real code, same shape.
{
    const r = build('cpy_cc acc32, r0 ; keep /* going\ncpy_cc acc32, r1\n');
    ok('a trailing ";" comment containing /* does not open a block',
        r.img !== undefined && r.img.instructionCount === 2,
        r.err ? r.err.split('\n')[1] : `n=${r.img && r.img.instructionCount}`);
}

// ---------------------------------------------------------------
console.log('--- a real block comment still behaves ---');

// Spans lines, hides what is inside it, and the code after it survives.
{
    const r = build('cpy_cc acc32, r0\n/* skip\nthis rubbish\ncpy_cc acc32, r2\n*/\ncpy_cc acc32, r1\n');
    ok('a block comment spans lines and hides the code inside',
        r.img !== undefined && r.img.instructionCount === 2,
        r.err ? r.err.split('\n')[1] : `n=${r.img && r.img.instructionCount}, want 2`);
}

// Opened and closed mid line, it separates the tokens either side rather than
// gluing them into one.
{
    const r = build('cpy_cc/*x*/acc32, r0\n');
    ok('a mid line block comment separates the tokens around it',
        r.img !== undefined && r.img.instructionCount === 1,
        r.err ? r.err.split('\n')[1] : `n=${r.img && r.img.instructionCount}`);
}

// Two blocks on one line, and code between them.
{
    const r = build('/*a*/cpy_cc/*b*/acc32, r0\ncpy_cc acc32, r1\n');
    ok('two block comments on one line',
        r.img !== undefined && r.img.instructionCount === 2,
        r.err ? r.err.split('\n')[1] : `n=${r.img && r.img.instructionCount}`);
}

// An unterminated block really does run on -- that part was never the bug.
{
    const r = build('cpy_cc acc32, r0\n/* from here down is comment\ncpy_cc acc32, r1\n');
    ok('an unterminated /* comments out the rest of the file',
        r.img !== undefined && r.img.instructionCount === 1,
        r.err ? r.err.split('\n')[1] : `n=${r.img && r.img.instructionCount}, want 1`);
}

// ---------------------------------------------------------------
console.log('');
if (fail) { console.log('FAILURES:'); for (const f of failures) console.log('  ' + f); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
