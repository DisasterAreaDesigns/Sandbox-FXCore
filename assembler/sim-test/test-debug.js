// The register viewer and the debugger: the core taken apart into begin /
// execute / end, halted and resumed, its state moved between two cores, the
// trace it records, and the worklet that holds the breakpoints.
//
//   node assembler/sim-test/test-debug.js

const vm = require('vm');
const FXCoreCore = require('../fxcore-emu.js');
const { assemble } = require('./assemble.js');
global.FXCoreCore = FXCoreCore;
const { simBuildWorkletSource, fxcoreSnapshot } = require('../fxcore-sim.js');
const { regsParseAliases, regsResolveName, regsFlagText, regsSwitchText } = require('../fxcore-regs.js');
const { simDebugParseValue, simDebugWordText } = require('../fxcore-debug.js');

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, detail) {
    if (cond) pass++; else { fail++; failures.push(name + (detail ? '  ' + detail : '')); }
}
function eq(name, got, want) {
    ok(name, JSON.stringify(got) === JSON.stringify(want),
        `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

// Line numbers below are the ones in this source: the debugger's whole job is
// to put an instruction back on one.
const SRC = [
    '.rn x r0',                          // 1
    '.rn y r1',                          // 2
    'cpy_cs   x, in0',                   // 3  pc 0  R0 = IN0
    'adds     x, x',                     // 4  pc 1  ACC32 = x + x, saturating
    'jz       y, skip',                  // 5  pc 2  y is 0, so this is taken
    'addi     y, 1',                     // 6  pc 3  jumped over
    'skip:',                             // 7
    'cpy_sc   out0, acc32',              // 8  pc 4
    'wrdel    0, acc32'                  // 9  pc 5  leaves nothing to show
].join('\n');

function build() {
    const img = assemble(SRC, 'dbg.fxc');
    const c = new FXCoreCore();
    c.setPresets({ creg: img.creg, mreg: img.mreg, sfr: img.sfr, usr: img.usr, cfg: img.cfg });
    c.setProgram(img.program);
    return { img, c };
}

// A repeatable input, so two cores can be told apart by what they do with it.
function input(n) {
    const v = 0.9 * Math.sin(n * 0.37);
    return [v, -v, 0.25, 0];
}

function snap(c) {
    const s = c.exportState();
    return JSON.stringify([Array.from(s.creg), Array.from(s.mreg), Array.from(s.sfr),
        Array.from(s.delay), s.acc64hi, s.acc64lo, s.addrCounter, s.sampleCount,
        s.user, s.lfoPhase, s.rampAcc, s.potSmooth, s.rngState, s.outputs]);
}

// ---------------------------------------------------------------------
console.log('--- the image knows its lines ---');
{
    const img = assemble(SRC, 'dbg.fxc');
    eq('pc to line', Array.from(img.lines), [3, 4, 5, 6, 8, 9]);
}
{
    // A library call expands to several instructions, all on the call's line.
    const fs = require('fs'), path = require('path');
    const lib = fs.readFileSync(path.join(__dirname, 'fixtures', 'test.fxl'), 'utf8');
    const src = ['; one', '/* two', '   three */', '.rn g mr0', '.mreg g 0.5',
        'cpy_cs r0, in0', '@tst.gain(g, 0.5, r1)', 'cpy_sc out0, acc32'].join('\n');
    const img = assemble(src, 'lib.fxc', { libraries: { 'test.fxl': lib } });
    eq('a library call reports its own line', Array.from(img.lines), [6, 7, 7, 7, 7, 8]);
}

// ---------------------------------------------------------------------
console.log('--- a run taken apart is the same run ---');
{
    const a = build().c, b = build().c, h = build().c;
    h.traceOn = true;
    h.onInstruction = () => false;
    let same = true, firstDiff = -1;
    for (let n = 0; n < 300; n++) {
        const inp = input(n);
        a.run(inp);
        b.beginSample(inp);
        b.execute(0);
        b.endSample();
        h.run(inp);
        if (snap(a) !== snap(b) || snap(a) !== snap(h)) { same = false; firstDiff = n; break; }
    }
    ok('run, begin/execute/end and a hooked run agree', same, 'first differing sample ' + firstDiff);
    ok('no halt without a hook that asks', !a.halted && !h.halted && a.haltedPc === -1);
}

// ---------------------------------------------------------------------
console.log('--- halt partway, finish, and it is as if nothing happened ---');
{
    const a = build().c, b = build().c;
    b.onInstruction = (cur) => cur === 2;
    for (let n = 0; n < 40; n++) {
        const inp = input(n);
        a.run(inp);
        b.run(inp);
        if (b.halted) {
            ok('halted after pc 2, at where the jump went', b.haltedPc === 4, 'next pc ' + b.haltedPc);
            ok('the sample is open', b.sampleCount === n, 'sample count ' + b.sampleCount);
            b.finishSample();
            ok('finished', b.sampleCount === n + 1 && b.haltedPc === -1);
        }
    }
    ok('halting every sample and finishing changes nothing', snap(a) === snap(b));
}

// ---------------------------------------------------------------------
console.log('--- the state moves to another core and carries on ---');
{
    const a = build().c, other = build().c;
    a.onInstruction = (cur) => cur === 1 && a.sampleCount === 25;
    let moved = false;
    for (let n = 0; n < 60; n++) {
        a.run(input(n));
        if (a.halted && !moved) {
            moved = true;
            // The page's copy: loaded the way the page loads it, then given the state.
            other.importState(a.exportState());
            // It steps one instruction, as the debugger would, then resumes.
            let pc = other.haltedPc;
            other.onInstruction = () => true;
            pc = other.execute(pc);
            other.onInstruction = null;
            other.haltedPc = pc;
            // The worklet's own copy takes the stepped state back.
            a.importState(other.exportState());
            a.finishSample();
        }
    }
    const ref = build().c;
    for (let n = 0; n < 60; n++) ref.run(input(n));
    ok('a halt was hit', moved);
    ok('stepping on another core and handing it back changes nothing', snap(a) === snap(ref));
}

// ---------------------------------------------------------------------
console.log('--- the trace ---');
{
    const c = build().c;
    c.traceOn = true;
    c.run([0.9, 0, 0, 0]);
    eq('every instruction but the one jumped over ran', Array.from(c.traceRan.slice(0, 6)), [1, 1, 1, 0, 1, 1]);
    eq('the jump was taken', Array.from(c.traceJump.slice(0, 6)), [0, 0, 1, 0, 0, 0]);
    // pc 3 was jumped over, so it has no destination to speak of.
    eq('where each result went', [0, 1, 2, 4, 5].map(pc => c.traceDst[pc]), [0, 16, -1, 256 + 4, -1]);
    ok('cpy_cs wrote R0 with the input', c.traceVal[0] === c.sfr[0]);
    ok('adds saturated and left full scale', c.traceVal[1] === 0x7FFFFFFF);
    ok('and was counted as a clip', c.clipCount[1] === 1 && c.clipCount[0] === 0);

    c.run([0.1, 0, 0, 0]);
    ok('a result that fits is not a clip', c.clipCount[1] === 1);
    ok('trace is per pass: the skipped line stays skipped', c.traceRan[3] === 0);

    const s = fxcoreSnapshot(c);
    ok('the snapshot carries the trace', s.trace && s.trace.len === 6 && s.trace.samples === 2);
    ok('and the three register files', s.creg.length === 18 && s.mreg.length === 128 && s.sfr.length === 49);

    const quiet = build().c;
    quiet.run([0.9, 0, 0, 0]);
    ok('no trace unless asked', fxcoreSnapshot(quiet).trace === null);
}
{
    // Destinations other than a core register.
    const img = assemble(['.rn t r0', '.rn m mr3', 'cpy_cs acc32, in0', 'cpy_mc m, acc32',
        'macrr t, t', 'set user0|0, acc32', 'cpy_cc t, acc32'].join('\n'), 'dst.fxc');
    const c = new FXCoreCore();
    c.setProgram(img.program);
    c.traceOn = true;
    c.run([0.5, 0, 0, 0]);
    eq('MR, ACC64, USER and a plain copy', Array.from(c.traceDst.slice(0, 5)), [16, 128 + 3, 300, 400, 0]);
}

// ---------------------------------------------------------------------
console.log('--- the worklet ---');

// The worklet source run in a context of its own, with the little of Web
// Audio it touches stood in for.
function worklet() {
    const sent = [];
    let Proc = null;
    const sandbox = {
        AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (m) => sent.push(m), onmessage: null }; } },
        registerProcessor: (name, cls) => { Proc = cls; },
        sampleRate: 48000
    };
    vm.createContext(sandbox);
    vm.runInContext(simBuildWorkletSource(), sandbox);
    const p = new Proc();
    const img = assemble(SRC, 'dbg.fxc');
    const send = (d) => p.port.onmessage({ data: d });
    send({
        type: 'image', program: img.program.buffer.slice(0), creg: img.creg.buffer.slice(0),
        mreg: img.mreg.buffer.slice(0), sfr: img.sfr.buffer.slice(0), usr: img.usr, cfg: img.cfg,
        count: img.instructionCount
    });
    // A block of a constant input, as the graph hands it over.
    const block = (level) => {
        const out = [new Float32Array(128), new Float32Array(128)];
        const inn = [[new Float32Array(128).fill(level), new Float32Array(128).fill(level)]];
        p.process(inn, [out]);
        return out;
    };
    return { p, sent, send, block, img, kinds: () => sent.map(m => m.type) };
}

{
    const w = worklet();
    ok('the program loads', w.kinds().includes('loaded'));
    w.block(0.1);
    eq('no breakpoints, no halt', w.kinds().includes('halted'), false);

    w.send({ type: 'breakpoints', list: [{ id: 1, kind: 'line', pc: 4, when: 'always', sample: 0 }] });
    const out = w.block(0.1);
    const halted = w.sent.find(m => m.type === 'halted');
    ok('a line breakpoint halts', !!halted && halted.reason.id === 1 && halted.pc === 5, JSON.stringify(halted && halted.pc));
    ok('and the output is cut to silence from there', out[0][127] === 0);
    // The trace is not switched on, but a halt hands the page the pass so far
    // all the same: it is what the editor is painted from.
    eq('the halt carries the pass so far', Array.from(halted.state.traceRan.slice(0, 5)), [1, 1, 1, 0, 1]);
    const n0 = halted.state.sampleCount;
    w.block(0.1);
    w.block(0.1);
    ok('while halted nothing advances', w.sent.filter(m => m.type === 'halted').length === 1);

    w.send({ type: 'resume', state: null });
    ok('resume answers', w.kinds().includes('resumed'));
    w.send({ type: 'breakpoints', list: [] });
    w.block(0.1);
    // Resume finished the open sample, so the count is a whole number on from the halt.
    const snapAfter = (() => { w.send({ type: 'watch', on: true, trace: false, scopes: [], window: 1 });
        return w.sent.filter(m => m.type === 'state').pop(); })();
    ok('the open sample was finished, then the program ran on', snapAfter.sampleCount >= n0 + 1, snapAfter.sampleCount + ' vs ' + n0);
}
{
    // A line that is jumped over never fires; one that is run does.
    const w = worklet();
    w.send({ type: 'breakpoints', list: [{ id: 1, kind: 'line', pc: 3, when: 'always', sample: 0 }] });
    w.block(0.1);
    eq('a line a jump goes over does not halt', w.kinds().includes('halted'), false);
}
{
    const w = worklet();
    w.send({ type: 'breakpoints', list: [{ id: 2, kind: 'jump', pc: 2, taken: false }] });
    w.block(0.1);
    eq('a jump that is taken does not fire as not taken', w.kinds().includes('halted'), false);
    w.send({ type: 'breakpoints', list: [{ id: 3, kind: 'jump', pc: 4, taken: false }] });
    w.block(0.1);
    eq('a line that is not a jump is not one either way', w.kinds().includes('halted'), false);
    w.send({ type: 'breakpoints', list: [{ id: 4, kind: 'jump', pc: 2, taken: true }] });
    w.block(0.1);
    const h = w.sent.find(m => m.type === 'halted');
    ok('taken fires', !!h && h.reason.id === 4 && h.pc === 4, JSON.stringify(h && h.pc));
}
{
    const w = worklet();
    w.send({ type: 'breakpoints', list: [{ id: 5, kind: 'clip', pc: -1 }] });
    w.block(0.1);
    eq('no clip at 0.1', w.kinds().includes('halted'), false);
    w.block(0.9);
    const h = w.sent.find(m => m.type === 'halted');
    ok('a clip anywhere halts on the instruction that did it', !!h && h.reason.id === 5 && h.pc === 2, JSON.stringify(h && h.pc));
}
{
    // A register condition fires when it becomes true, and again only after it has been false.
    const w = worklet();
    w.send({ type: 'breakpoints', list: [{ id: 6, kind: 'reg', space: 'c', idx: 16, op: '>', word: 0x20000000 }] });
    w.block(0.05);
    eq('ACC32 under the threshold', w.kinds().includes('halted'), false);
    w.block(0.5);
    ok('over it, halts', w.kinds().filter(k => k === 'halted').length === 1);
    w.send({ type: 'resume', state: null });
    w.block(0.5);
    ok('still over it: an edge, not a level', w.kinds().filter(k => k === 'halted').length === 1);
    w.block(0.01);
    w.block(0.5);
    ok('after dropping below and coming back, halts again', w.kinds().filter(k => k === 'halted').length === 2);
}
{
    // SFR and MR files are reachable too.
    const w = worklet();
    w.send({ type: 'breakpoints', list: [{ id: 7, kind: 'reg', space: 's', idx: 0, op: '>=', word: 0x10000000 }] });
    w.block(0.5);
    ok('an SFR condition halts', w.kinds().includes('halted'));
}
{
    // Halt asked for from the page lands at the end of a sample.
    const w = worklet();
    w.block(0.1);
    w.send({ type: 'halt' });
    w.block(0.1);
    const h = w.sent.find(m => m.type === 'halted');
    ok('a requested halt stops at the end of the pass', !!h && h.reason.kind === 'halt' && h.pc >= 6, JSON.stringify(h && h.pc));
    w.send({ type: 'resume', state: null });
    const n = h.state.sampleCount;
    w.block(0.1);
    w.send({ type: 'watch', on: true, trace: false, scopes: [], window: 1 });
    const s = w.sent.filter(m => m.type === 'state').pop();
    ok('resume finishes it and carries on', s.sampleCount > n);
}
{
    // Scopes and the trace flow in the periodic snapshots.
    const w = worklet();
    w.send({ type: 'watch', on: true, trace: true, scopes: ['c16', 's4'], window: 0.064 });
    for (let i = 0; i < 40; i++) w.block(0.3);
    const states = w.sent.filter(m => m.type === 'state');
    const s = states[states.length - 1];
    ok('snapshots arrive while watched', states.length > 2);
    ok('scopes come back by key', s.scopes.length === 2 && s.scopes[0].key === 'c16' && s.scopes[1].key === 's4');
    ok('the scope holds values', Math.max.apply(null, Array.from(s.scopes[0].max)) > 0.1);
    ok('the trace comes with them', s.trace && s.trace.len === 6);
}

// ---------------------------------------------------------------------
console.log('--- register names from .rn lines ---');
{
    const a = regsParseAliases([
        '.rn  feedback r5   ; a comment',
        '.rn  fb_l feedback',
        '/* .rn hidden r6 */',
        '.rn  ph   mr12',
        '.rn  lfo_a lfo0_s',
        '.rn  bad  r99',
        '.rn.x typed r2',
        '.rn  stray nowhere'
    ].join('\n'));
    eq('R5 has both names', a.c5, ['feedback', 'fb_l']);
    eq('an MR', a.m12, ['ph']);
    eq('an SFR, any case', a.s34, ['lfo_a']);
    eq('the suffix form', a.c2, ['typed']);
    ok('a block comment hides a line', !a.c6);
    ok('R99 is not a register', !a.c99 && Object.keys(a).length === 4, Object.keys(a).join());
    eq('resolve', [regsResolveName('acc32'), regsResolveName('MR127'), regsResolveName('mr128'), regsResolveName('pot0_smth')],
        ['c16', 'm127', null, 's22']);
    ok('flags read back', regsFlagText(0b1000 | 0b1) === 'NEWTT' && regsFlagText(0).indexOf('TAP down') === 0);
    ok('switch bits read back', regsSwitchText(0x8000 | (1 << 12) | 0x1F).indexOf('pushed SW2') > 0);
}

// ---------------------------------------------------------------------
console.log('--- values typed into the breakpoint form ---');
{
    eq('a fraction', simDebugParseValue('0.5'), { word: 0x40000000, fmt: 'frac' });
    eq('a negative one', simDebugParseValue('-0.25'), { word: -0x20000000, fmt: 'frac' });
    eq('full scale stops short of overflow', simDebugParseValue('1').word, 0x7FFFFFFF);
    eq('minus one', simDebugParseValue('-1').word, -0x80000000);
    eq('hex', simDebugParseValue('0x400'), { word: 0x400, fmt: 'hex' });
    eq('hex with the top bit set is negative', simDebugParseValue('0xFFFFFFFF').word, -1);
    eq('an integer', simDebugParseValue('5i'), { word: 5, fmt: 'int' });
    eq('a negative integer', simDebugParseValue('-3i').word, -3);
    eq('more than 1.0 as a fraction is refused', simDebugParseValue('2'), null);
    eq('nonsense is refused', simDebugParseValue('abc'), null);
    eq('and so is nothing', simDebugParseValue(''), null);
    eq('read back as written', [simDebugWordText(0x40000000, 'frac'), simDebugWordText(0x400, 'hex'), simDebugWordText(5, 'int')],
        ['+0.500000', '0x00000400', '5']);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.map(f => '  FAIL ' + f).join('\n')); process.exit(1); }
