// Fractional immediates: does the assembler emit the same word the CLI does?
//
//   node assembler/sim-test/test-immediates.js
//
// MULTRI, MACRI, MACHRI and ADDSI take a 16-bit S.15 fraction, and MACID,
// MACHID, APA and APB an 8-bit S.7 one. THE CLI IS THE GOLDEN STANDARD: it
// scales to 32 bits with a truncating C# cast, `(int)(value * 0x7FFFFFFF)`, and
// takes the top 16 (or 8) bits. That lands one LSB low on every positive value
// -- `multri acc32, 0.5` is 0x3FFF, not 0x4000 -- and this port does the same
// so its images match the shipped ones bit for bit.
//
// Builds 18-23 rounded at the field's width instead (0.5 -> 0x4000). If the CLI
// is ever updated to round, flip common.cliFraction and these expectations.
//
// For a word w written as w/32768 the CLI result works out to w-1 when w > 0
// and w otherwise; that closed form is what these tests check against.

const { assemble } = require('./assemble.js');

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, detail) {
    if (cond) pass++; else { fail++; failures.push(name + (detail ? '  ' + detail : '')); }
}

/**
 * Assemble one instruction per word and read the immediate back.
 * `shift` is where the field sits: the M field is the low 16 bits, the R field
 * is bits 23:16, and APA carries its coefficient in R with the address in M.
 */
function immediates(lines, mask, signBit, shift = 0) {
    const img = assemble(lines.join('\n') + '\n', 'immediates');
    return lines.map((_, i) => {
        const raw = (img.program[i] >>> shift) & mask;
        return raw >= signBit ? raw - signBit * 2 : raw;
    });
}

const s15 = (words) => immediates(words.map((w) => `multri acc32, ${w / 32768}`), 0xFFFF, 0x8000);
const cli = (w) => (w > 0 ? w - 1 : w);

// ---------------------------------------------------------------
console.log('--- S.15 immediates match the CLI ---');

const plain = [16384, 24576, 8192, 32736, 9830, -16384, -8192, 0, 1, -1];
s15(plain).forEach((got, i) => {
    ok(`multri ${plain[i] / 32768}`, got === cli(plain[i]), `got ${got}, want ${cli(plain[i])}`);
});

ok('0.5 is 0x3FFF, as the CLI emits', s15([16384])[0] === 0x3FFF);
ok('0.75 is 0x5FFF, as the CLI emits', s15([24576])[0] === 0x5FFF);

// Words copied from CLI 2.x listings of shipped LEAP programs.
const listed = [[0.01, 0x0147], [-0.05, 0xF999], [0.5, 0x3FFF], [-0.5, 0xC000], [-1, 0x8000]];
const listedImg = assemble(listed.map(([v]) => `multri acc32, ${v}`).join('\n') + '\n', 'listed');
listed.forEach(([v, want], i) => {
    const got = listedImg.program[i] & 0xFFFF;
    ok(`multri ${v} is 0x${want.toString(16)} as in the CLI listing`, got === want, `got 0x${got.toString(16)}`);
});

// ---------------------------------------------------------------
console.log('--- every S.15 word written as a decimal matches the CLI ---');

// One program rather than one per word: the assembler is not cheap to start.
const spread = [];
for (let w = -32768; w <= 32767; w += 66) spread.push(w);
const back = s15(spread);
const wrong = spread.filter((w, i) => back[i] !== cli(w));
ok(`${spread.length} words across the range`, wrong.length === 0,
    wrong.length ? `first bad: ${wrong.slice(0, 4).join(', ')}` : '');

const edges = [-32768, -32767, -1, 0, 1, 16383, 16384, 24575, 24576, 32766, 32767];
const edgeBack = s15(edges);
ok('boundaries', edges.every((w, i) => edgeBack[i] === cli(w)),
    edges.map((w, i) => `${w}->${edgeBack[i]}`).join(' '));

// ---------------------------------------------------------------
console.log('--- hex is taken literally ---');

const hexWords = [0x4000, 0x2666, 0x6000, 0x7FFF];
const hexImg = assemble(hexWords.map((w) => `multri acc32, 0x${w.toString(16)}`).join('\n') + '\n', 'hex');
hexWords.forEach((w, i) => {
    ok(`multri 0x${w.toString(16)}`, (hexImg.program[i] & 0xFFFF) === w, `${hexImg.program[i] & 0xFFFF}`);
});

// ---------------------------------------------------------------
console.log('--- a .equ goes through the same conversion ---');

const viaEqu = assemble('.equ kmix 0.5\n.equ kfb 0.29998779296875\n'
    + 'multri acc32, kmix\nmultri acc32, kfb\n', 'equ');
ok('.equ kmix 0.5', (viaEqu.program[0] & 0xFFFF) === 16383, `${viaEqu.program[0] & 0xFFFF}`);
ok('.equ kfb 0.29998779296875', (viaEqu.program[1] & 0xFFFF) === 9829, `${viaEqu.program[1] & 0xFFFF}`);

// ---------------------------------------------------------------
console.log('--- S.7 immediates, the same story one field narrower ---');

const s7 = [64, 96, 32, 127, -64, -128, 0];
const s7back = immediates(s7.map((w) => `apa ${w / 128}, 100`), 0xFF, 0x80, 16);
s7.forEach((w, i) => {
    ok(`apa ${w / 128}`, s7back[i] === cli(w), `got ${s7back[i]}, want ${cli(w)}`);
});

// ---------------------------------------------------------------
console.log('--- out of range is still an error ---');

for (const bad of ['1.0', '-1.5', '2.0']) {
    let threw = false;
    try { assemble(`multri acc32, ${bad}\n`, 'range'); } catch { threw = true; }
    ok(`multri acc32, ${bad} is rejected`, threw);
}

// ---------------------------------------------------------------
console.log('--- integer fields take the integer portion (truncate toward zero) ---');

// The instruction set document: an integer operand takes "only the integer
// portion of the value". The CLI's C# casts truncate toward zero; this port
// floored, which only differs for a negative fraction. The LEAP aliaser line
// "addi alias_wave, -0.5" is in a CLI 2.4.2 listing as
//     0230 : 0086 : 04080000 :   ADDI  ALIAS_WAVE(0x08) -0.5(0x0000)
// and the port gave 0xFFFF, so the program no longer matched the shipped one.
const intCases = [
    ['addi r8, -0.5', 0x0000], ['addi r8, 0.5', 0x0000], ['addi r8, -1.5', 0xFFFF],
    ['addi r8, -1', 0xFFFF], ['addi r8, 2.9', 0x0002], ['addi r8, -32768', 0x8000],
    ['andi acc32, 3.7', 0x0003], ['ori acc32, -0.9', 0x0000],
];
const intImg = assemble(intCases.map((c) => c[0]).join('\n') + '\n', 'integers');
intCases.forEach(([line, want], i) => {
    const got = intImg.program[i] & 0xFFFF;
    ok(line, got === want, `got 0x${got.toString(16)}, want 0x${want.toString(16)}`);
});
ok('addi r8, -0.5 is the whole word 0x04080000',
    (intImg.program[0] >>> 0) === 0x04080000, `0x${(intImg.program[0] >>> 0).toString(16)}`);

const viaEquInt = assemble('.equ half -0.5\naddi r8, half\n', 'equ-int');
ok('.equ half -0.5 then addi r8, half is 0x0000', (viaEquInt.program[0] & 0xFFFF) === 0);

const shiftImg = assemble('sr acc32, 3.9\n', 'shift');
ok('sr acc32, 3.9 shifts by 3', (shiftImg.program[0] & 0x1F) === 3, `${shiftImg.program[0] & 0x1F}`);

// ---------------------------------------------------------------
console.log('');
if (fail) { console.log('FAILURES:'); for (const f of failures) console.log('  ' + f); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
