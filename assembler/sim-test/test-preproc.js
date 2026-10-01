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
console.log('--- declarations inside library code ---');
{
    const DECL = { 'decl.fxl': fs.readFileSync(path.join(__dirname, 'fixtures', 'decl.fxl'), 'utf8') };
    const src = '.rn t1 r1\n.rn t2 r2\n@dcl.setup(0.5)\n@dcl.delay(t1)\n@dcl.delay(t2)\n';
    const r = preproc(src, DECL);
    ok('ok', r.ok === true, JSON.stringify(r.errors));

    // A header subroutine declares globally: the name stays as the library
    // spelled it, so every call site refers to the one symbol.
    ok('header equate keeps its name', /^\.EQU SHARED_DEPTH\b/m.test(r.text),
        r.text.split('\n').find(l => l.includes('SHARED_DEPTH')));
    ok('header equate takes the argument', /\.EQU SHARED_DEPTH\s+0\.5/.test(r.text));
    ok('header equate declared once',
        (r.text.match(/\.EQU SHARED_DEPTH/g) || []).length === 1);
    ok('both calls read the shared equate',
        (r.text.match(/MULTRI ACC32 , SHARED_DEPTH/g) || []).length === 2);
    ok('header block keeps its name', /^\.MEM SHARED_RING\s/m.test(r.text),
        r.text.split('\n').find(l => l.includes('SHARED_RING')));
    ok('header block allocated once',
        (r.text.match(/\.MEM SHARED_RING/g) || []).length === 1);
    ok('both calls address the shared block',
        (r.text.match(/RDDEL T\d , SHARED_RING#/g) || []).length === 2,
        r.text.split('\n').filter(l => l.includes('SHARED_RING')).join(' '));

    // Everything else a subroutine declares is local to the call.
    ok('memory block renamed per call',
        r.text.includes('.MEM BUF_4') && r.text.includes('.MEM BUF_5'),
        r.text.split('\n').filter(l => l.includes('.MEM')).join(' '));
    ok('local equate renamed per call',
        r.text.includes('.EQU MID_4') && r.text.includes('.EQU MID_5'));
    ok('no two calls share a block', !/\.MEM BUF\s/.test(r.text));
    ok('a mem1 operand follows the rename', r.text.includes('WRDEL BUF_4 , ACC32'));
    ok('a mem2 operand keeps its tail suffix', r.text.includes('RDDEL T1 , BUF_4#'),
        r.text.split('\n').find(l => l.startsWith('RDDEL')));
    ok('a length suffix follows the rename', r.text.includes('RDDEL T1 , BUF_4!/2'),
        r.text.split('\n').filter(l => l.startsWith('RDDEL')).join(' '));

    // The same rename inside an equate value, so a subroutine can size an
    // equate from the delay line it owns and still get one block per call.
    const lenSrc = '.rn t1 r1\n@dcl.lengths(t1)\n@dcl.lengths(t1)\n';
    const len = preproc(lenSrc, DECL);
    ok('a length inside an equate follows the rename',
        len.text.includes('.EQU SPAN_2	RING_2!/2') &&
        len.text.includes('.EQU SPAN_3	RING_3!/2'),
        len.text.split('\n').filter(l => l.includes('SPAN')).join(' '));
    try {
        assemble(lenSrc + 'cpy_sc out0, acc32\n', 'len.fxc', { libraries: DECL });
        ok('and the block it is sized from assembles', true);
    } catch (e) {
        ok('and the block it is sized from assembles', false, e.message.replace(/\s+/g, ' '));
    }

    // A .rn inside library code names a register for the rest of the program,
    // so an argument using that name is checked against the parameter's bank
    // just as one the user named themselves would be.
    const bank = preproc('@dcl.setup(0.5)\n@dcl.needsmreg(SHARED_C)\n', DECL);
    ok('a library declared alias is type checked', bank.ok === false);
    ok('and the mismatch is explained',
        bank.errors.some(e => /"SHARED_C".*is a CREG but parameter "dst" is a MREG/.test(e.message)),
        JSON.stringify(bank.errors.map(e => e.message)));
    const good = preproc('.rn m1 mr0\n@dcl.setup(0.5)\n@dcl.needsmreg(m1)\n', DECL);
    ok('the right bank still binds', good.ok === true, JSON.stringify(good.errors));

    // Half selectors and a leading minus survive substitution.
    const h = preproc('@dcl.halves(1234)\n', DECL);
    ok('a .U selector substitutes', /\.EQU UP_1\s+1234\.U/.test(h.text),
        h.text.split('\n').find(l => l.includes('UP_1')));
    ok('a .L selector substitutes', /\.EQU LOW_1\s+1234\.L/.test(h.text));
    ok('a leading minus survives', /\.EQU NEG_1\s+-1234/.test(h.text));

    // And the whole thing has to assemble, which the old preprocessor could
    // not manage: it declared BUF and MID once per call under the one name.
    try {
        const img = assemble(src + 'cpy_sc out0, acc32\n', 'decl.fxc', { libraries: DECL });
        ok('declarations assemble', true);
        ok('the delay line was allocated twice',
            typeof img.expandedSource === 'string' && img.expandedSource.includes('.MEM BUF_5'));
    } catch (e) {
        ok('declarations assemble', false, e.message.replace(/\s+/g, ' '));
    }
}

// ---------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
    console.log('\nfailures:');
    failures.forEach(f => console.log('  ' + f));
}
process.exit(fail ? 1 : 0);
