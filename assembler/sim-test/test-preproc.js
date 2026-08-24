// The library preprocessor: does "@lib.sub(...)" turn into the same code the
// user would have written by hand, and does the result still assemble and run?
//
//   node assembler/sim-test/test-preproc.js

const fs = require('fs');
const path = require('path');
const FXCoreCore = require('../fxcore-emu.js');
const { assemble, makeContext, loadInto } = require('./assemble.js');

const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'test.fxl'), 'utf8');
const LIBS = { 'test.fxl': FIXTURE };

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, detail) {
    if (cond) pass++; else { fail++; failures.push(name + (detail ? '  ' + detail : '')); }
}

// A preprocessor wired up the way the browser does it, without assembling.
function preproc(source, libs) {
    const ctx = makeContext();
    const set = new ctx.FXLibrarySet();
    const files = libs === undefined ? LIBS : libs;
    for (const file of Object.keys(files)) set.addFile(files[file], file);
    const pre = new ctx.Preprocessor(set);
    return pre.process(source);
}

// ---------------------------------------------------------------
console.log('--- .fxl parsing ---');
{
    const ctx = makeContext();
    const set = new ctx.FXLibrarySet();
    const info = set.addFile(FIXTURE, 'test.fxl');
    ok('library name read', info.name === 'tst', info.name);
    ok('all subs read', info.subs.length === 3, info.subs.join(','));
    ok('no warnings', info.warnings.length === 0, info.warnings.join('; '));
    ok('lookup is case insensitive', set.getSub('TST', 'GAIN') !== null);
    ok('param types survive',
        set.getSub('tst', 'gain').params.map(p => p.type).join(',') === 'MREG,DEC,CREG');

    let threw = false;
    try { set.addFile('<library><name>x</name>', 'broken.fxl'); } catch (e) { threw = true; }
    ok('unterminated markup is rejected', threw);

    threw = false;
    try { set.addFile('<notalibrary/>', 'wrong.fxl'); } catch (e) { threw = true; }
    ok('a file with no <library> is rejected', threw);
}

// ---------------------------------------------------------------
console.log('--- source with no library call is untouched ---');
{
    const src = '.rn temp r0\ncpy_cs acc32, in0\ncpy_sc out0, acc32\n';
    const r = preproc(src);
    ok('unchanged', r.text === src);
    ok('nothing expanded', r.expansions === 0);
    ok('ok', r.ok === true);
}

// ---------------------------------------------------------------
console.log('--- a call expands, with the call kept as a comment ---');
{
    const r = preproc('.rn dest mr0\n.rn temp r1\n@tst.gain(dest, 0.5, temp)\n');
    ok('ok', r.ok === true, JSON.stringify(r.errors));
    ok('one expansion', r.expansions === 1);
    ok('call is commented out', r.text.includes('// @tst.gain(dest, 0.5, temp)'));
    ok('parameters substituted', r.text.includes('CPY_MC DEST , ACC32'));
    ok('literal argument substituted', r.text.includes('MULTRI ACC32 , 0.5'));
    ok('annotation names the library',
        r.text.includes('// from library: tst -- subroutine: gain --'));
    ok('annotation records the match',
        r.text.includes('matching DEST_SUB with DEST type MREG'));
    ok('end marker present',
        r.text.includes('// end inclusion library tst --  subroutine gain'));
    ok('no @ call survives', !/^\s*@/m.test(r.text));
}

// ---------------------------------------------------------------
console.log('--- labels are made unique per call site ---');
{
    const r = preproc('.rn temp r1\n@tst.blink(user0, temp)\n@tst.blink(user1, temp)\n');
    ok('ok', r.ok === true, JSON.stringify(r.errors));
    ok('two expansions', r.expansions === 2);
    ok('first call suffixed with its line', r.text.includes('DARK_2: '));
    ok('second call suffixed with its line', r.text.includes('DARK_3: '));
    ok('jump target renamed too', r.text.includes('JZ ACC32 , DARK_2'));
    ok('the two do not share a label', !r.text.includes('\nDARK: '));
}

// ---------------------------------------------------------------
console.log('--- equations ---');
{
    // An expression argument is solved so the operators around the parameter
    // inside the library cannot pull it apart.
    const r = preproc('.rn dest mr0\n.rn temp r1\n@tst.gain(dest, 0.25*2, temp)\n');
    ok('call site expression solved', r.text.includes('MULTRI ACC32 , 0.5'),
        r.text.split('\n').find(l => l.startsWith('MULTRI')));

    // Reserved words resolve the same way they do in the assembler.
    const r2 = preproc('.rn temp r1\n@tst.blink(user1|0, temp)\n');
    ok('reserved word in an expression solves', r2.text.includes('SET 32|13 , ACC32'),
        r2.text.split('\n').find(l => l.startsWith('SET')));

    // An expression the preprocessor cannot finish is parenthesised and left
    // for the assembler rather than being pasted in raw.
    const r3 = preproc('.rn dest mr0\n.rn temp r1\n.equ lvl 0.5\n@tst.gain(dest, lvl/2, temp)\n');
    ok('unsolvable expression is parenthesised', r3.text.includes('MULTRI ACC32 , (LVL/2)'),
        r3.text.split('\n').find(l => l.startsWith('MULTRI')));

    // Library code that mixes a parameter with operators is substituted and
    // left whole, flagged the way the command line tool flags it.
    const r4 = preproc('.rn temp r1\n@tst.blink(user0, temp)\n');
    ok('library equation substituted', r4.text.includes('SET USER0|13 , ACC32'));
    ok('library equation flagged', r4.text.includes('Complex equation substitution'));
}

// ---------------------------------------------------------------
console.log('--- errors are reported, not pasted over ---');
{
    const bad = [
        ['unknown library', '@nope.gain(mr0, 0.5, r1)\n', /unknown library/i],
        ['unknown subroutine', '@tst.nosuch(mr0)\n', /no subroutine/i],
        ['wrong argument count', '@tst.gain(mr0, 0.5)\n', /takes 3 argument/i],
        ['wrong register bank', '.rn temp r1\n@tst.gain(r2, 0.5, temp)\n', /is a CREG but parameter/i],
        ['unclosed paren', '@tst.gain(mr0, 0.5, r1\n', /unclosed/i],
        ['trailing code', '@tst.gain(mr0, 0.5, r1) cpy_cc r0, acc32\n', /only statement/i]
    ];
    for (const [name, src, re] of bad) {
        const r = preproc(src);
        ok(name + ' fails', r.ok === false);
        ok(name + ' explains why', r.errors.some(e => re.test(e.message)),
            JSON.stringify(r.errors.map(e => e.message)));
    }

    const none = preproc('@tst.gain(mr0, 0.5, r1)\n', {});
    ok('no libraries loaded is explained', none.ok === false &&
        /no libraries are loaded/.test(none.errors.map(e => e.message).join(' ')),
        JSON.stringify(none.errors.map(e => e.message)));
}

// ---------------------------------------------------------------
console.log('--- calls inside comments are left alone ---');
{
    const r = preproc('; @tst.gain(mr0, 0.5, r1)\n/*\n@tst.gain(mr0, 0.5, r1)\n*/\ncpy_cs acc32, in0\n');
    ok('nothing expanded', r.expansions === 0, String(r.expansions));
    ok('source untouched', r.text.includes('; @tst.gain'));
    ok('ok', r.ok === true, JSON.stringify(r.errors));
}

// ---------------------------------------------------------------
console.log('--- a library may call a library ---');
{
    const r = preproc('.rn temp r1\n@tst.bothleds(temp)\n');
    ok('ok', r.ok === true, JSON.stringify(r.errors));
    ok('inner subroutine inlined', (r.text.match(/subroutine: blink/g) || []).length > 0);
    ok('inner labels stay distinct',
        r.text.includes('DARK_2_1: ') && r.text.includes('DARK_2_2: '),
        r.text.split('\n').filter(l => l.startsWith('DARK')).join(' '));
    ok('both USER pins driven',
        r.text.includes('SET USER0|13 , ACC32') && r.text.includes('SET USER1|13 , ACC32'));
}

// ---------------------------------------------------------------
console.log('--- the expanded program assembles and runs ---');
{
    const src = [
        '.rn temp   r1',
        '.rn ledtmp r2',
        '.rn wet    mr0',
        '@tst.gain(wet, 0.5, temp)',
        'cpy_cm acc32, wet',
        'cpy_sc out0, acc32',
        '@tst.blink(user0, ledtmp)',
        '@tst.blink(user1, ledtmp)'
    ].join('\n') + '\n';

    let img = null;
    try { img = assemble(src, 'preproc.fxc', { libraries: LIBS }); }
    catch (e) { ok('assembles', false, e.message); }

    if (img) {
        ok('assembles', true);
        ok('expanded source was kept', typeof img.expandedSource === 'string' &&
            img.expandedSource.includes('end inclusion'));

        const core = new FXCoreCore();
        core.sampleRate = 48000;
        loadInto(core, img);

        let sawHalf = true;
        for (let i = 0; i < 64; i++) {
            core.run([0.4, 0, 0, 0]);
            const out = core.getOutputs();
            if (Math.abs(out[0] - 0.2) > 1e-4) sawHalf = false;
        }
        ok('gain subroutine halves the input', sawHalf);
        ok('no unimplemented instruction', core.getState().unimplemented.length === 0);
        ok('runs to the end of the program', core.lastPC === img.instructionCount,
            `lastPC ${core.lastPC} of ${img.instructionCount}`);

        // The two blink calls read the same counter bit, so the pins agree,
        // and they must actually change over a full period.
        let high = 0, low = 0, matched = true;
        for (let i = 0; i < 20000; i++) {
            core.run([0, 0, 0, 0]);
            if (core.user[0] !== core.user[1]) matched = false;
            if (core.user[0]) high++; else low++;
        }
        ok('both blink calls agree', matched);
        ok('the LED actually blinks', high > 0 && low > 0, `high ${high} low ${low}`);
    }
}

// ---------------------------------------------------------------
console.log('--- hand written and library built programs agree ---');
{
    const viaLib = '.rn wet mr0\n.rn temp r1\n@tst.gain(wet, 0.5, temp)\n' +
        'cpy_cm acc32, wet\ncpy_sc out0, acc32\n';
    const byHand = [
        '.rn wet mr0',
        '.rn temp r1',
        'cpy_cs acc32, in0',
        'multri acc32, 0.5',
        'cpy_cc temp, acc32',
        'cpy_mc wet, acc32',
        'cpy_cm acc32, wet',
        'cpy_sc out0, acc32'
    ].join('\n') + '\n';

    try {
        const a = assemble(viaLib, 'lib.fxc', { libraries: LIBS });
        const b = assemble(byHand, 'hand.fxc');
        ok('same machine code', a.hex === b.hex);
    } catch (e) {
        ok('same machine code', false, e.message);
    }
}

// ---------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
    console.log('\nfailures:');
    failures.forEach(f => console.log('  ' + f));
}
process.exit(fail ? 1 : 0);
