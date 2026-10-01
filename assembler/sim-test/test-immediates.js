// Fractional immediates: does the word the assembler emits mean the number the
// source wrote?
//
//   node assembler/sim-test/test-immediates.js
//
// MULTRI, MACRI, MACHRI and ADDSI take a 16-bit S.15 fraction, and MACID,
// MACHID, APA and APB an 8-bit S.7 one. Both used to be built by scaling to
// 32 bits and truncating -- `Math.floor(value * 0x7FFFFFFF)` and then taking the
// top half -- which is one LSB low on every positive value. `multri acc32, 0.5`
// assembled as 16383, a multiply by 0.49997 rather than 0.5, and every
// coefficient in every program came out a step small.
//
// Two things went wrong there and only one of them is the scale. Rounding
// instead of flooring fixes 0.5, but 0.75 still lands short, because taking the
// top 16 bits of a 32-bit intermediate truncates a second time. The fix is to
// round at the field's own width.

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

// ---------------------------------------------------------------
console.log('--- S.15 immediates mean what they say ---');

const plain = [16384, 24576, 8192, 32736, 9830, -16384, -8192, 0, 1, -1];
s15(plain).forEach((got, i) => {
    ok(`multri ${plain[i] / 32768}`, got === plain[i], `got ${got}, want ${plain[i]}`);
});

// 0.5 and 0.75 are the two that separate the three plausible conversions: the
// old one misses both, rounding a 32-bit intermediate misses 0.75 alone.
ok('0.5 is exactly 0x4000', s15([16384])[0] === 16384);
ok('0.75 is exactly 0x6000', s15([24576])[0] === 24576);

// ---------------------------------------------------------------
console.log('--- every S.15 word survives being written as a decimal ---');

// One program rather than one per word: the assembler is not cheap to start.
const spread = [];
for (let w = -32768; w <= 32767; w += 66) spread.push(w);
const back = s15(spread);
const wrong = spread.filter((w, i) => back[i] !== w);
ok(`${spread.length} words across the range round-trip`, wrong.length === 0,
    wrong.length ? `first bad: ${wrong.slice(0, 4).join(', ')}` : '');

const edges = [-32768, -32767, -1, 0, 1, 16383, 16384, 24575, 24576, 32766, 32767];
const edgeBack = s15(edges);
ok('boundaries round-trip', edges.every((w, i) => edgeBack[i] === w),
    edges.map((w, i) => `${w}->${edgeBack[i]}`).filter((s) => s.split('->')[0] !== s.split('->')[1]).join(' '));

// ---------------------------------------------------------------
console.log('--- hex and decimal agree ---');

const hexPairs = [[0x4000, 0.5], [0x2666, 0.29998779296875], [0x6000, 0.75]];
for (const [word, decimal] of hexPairs) {
    const img = assemble(`multri acc32, 0x${word.toString(16)}\nmultri acc32, ${decimal}\n`, 'hexdec');
    ok(`0x${word.toString(16)} == ${decimal}`,
        (img.program[0] & 0xFFFF) === (img.program[1] & 0xFFFF),
        `${img.program[0] & 0xFFFF} vs ${img.program[1] & 0xFFFF}`);
}

// ---------------------------------------------------------------
console.log('--- a .equ carries its value intact ---');

const viaEqu = assemble('.equ kmix 0.5\n.equ kfb 0.29998779296875\n'
    + 'multri acc32, kmix\nmultri acc32, kfb\n', 'equ');
ok('.equ kmix 0.5', (viaEqu.program[0] & 0xFFFF) === 16384, `${viaEqu.program[0] & 0xFFFF}`);
ok('.equ kfb 0.29998779296875', (viaEqu.program[1] & 0xFFFF) === 9830, `${viaEqu.program[1] & 0xFFFF}`);

// ---------------------------------------------------------------
console.log('--- S.7 immediates, the same story one field narrower ---');

const s7 = [64, 96, 32, 127, -64, -128, 0];
const s7back = immediates(s7.map((w) => `apa ${w / 128}, 100`), 0xFF, 0x80, 16);
s7.forEach((want, i) => {
    ok(`apa ${want / 128}`, s7back[i] === want, `got ${s7back[i]}, want ${want}`);
});

// ---------------------------------------------------------------
console.log('--- out of range is still an error ---');

for (const bad of ['1.0', '-1.5', '2.0']) {
    let threw = false;
    try { assemble(`multri acc32, ${bad}\n`, 'range'); } catch { threw = true; }
    ok(`multri acc32, ${bad} is rejected`, threw);
}

// ---------------------------------------------------------------
console.log('');
if (fail) { console.log('FAILURES:'); for (const f of failures) console.log('  ' + f); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
