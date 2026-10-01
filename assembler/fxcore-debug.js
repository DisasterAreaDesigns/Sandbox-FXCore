// FXCore debugger -- halting the simulator and stepping it by hand.
//
// The engine runs in an AudioWorklet, which is the right place to catch a
// condition and the wrong place to step from. So a halt moves the whole core
// -- the three register files, ACC64, the peripherals, the delay RAM -- to
// this thread, where a second FXCoreCore continues it one instruction at a
// time with the editor following along. Resume hands the state back, and the
// worklet finishes the sample that was open and picks up from there: a
// breakpoint that fires every sample, stepped through and resumed, really
// does advance the program a sample at a time.
//
// Breakpoints are conditions rather than places, because every instruction
// that is not jumped over runs every sample and a bare "stop at line 20"
// would trip on the very next one. A line breakpoint carries a "when" -- every
// sample, the first run, or a given sample number -- and the others are the
// conditions that matter for audio: a clip, a jump going one way, a register
// crossing a value. Value conditions fire when they become true, not while
// they stay so.
//
// A register is named by a key, the one the viewer uses: 'c3' is R3 (c16 is
// ACC32, c17 FLAGS), 'm5' is MR5, 's16' the SFR at address 16.
//
// The input while stepping is the one the core halted on: the source is audio
// that only the graph can produce, and a held sample is the honest stand-in.
// The pots and switches are live -- the stepping core reads them from the page
// as it goes. The status line says so.
//
// Lines come from the build. An instruction a library call expanded to is on
// the line of the call, so stepping through one shows the same line for as many
// presses as the subroutine has instructions.

let dbgCore = null;           // the halted core, on this thread
let dbgPc = -1;               // next instruction; progLen or more means the pass is done
let dbgHalted = false;
let dbgStepped = false;       // has this thread's copy moved past the worklet's
let dbgReason = null;
let dbgInputs = [0, 0, 0, 0]; // input held while stepping, as floats
let dbgLineDecorations = [];
let dbgBreakpoints = [];      // see simDebugAddBreakpoint for the shape
let dbgNextId = 1;
let dbgBpDecorations = {};    // breakpoint id -> Monaco decoration id

const DBG_RUN_BUDGET = 4096;  // samples a "run to line" may cover before giving up

// ---- the Debug Tools fold ---------------------------------------------------

// The register viewer, the debugger and the breakpoints live behind one
// header in the simulator panel, closed by default. Whether it was left open
// is remembered, since someone stepping a program tends to keep at it.
const DBG_FOLD_KEY = 'fxcore_sim_debug_tools_open';

function simDebugToolsSet(open) {
    const section = document.getElementById('simDebugToolsSection');
    const body = document.getElementById('simDebugTools');
    if (!section || !body) return;
    body.hidden = !open;
    section.classList.toggle('open', open);
    try { localStorage.setItem(DBG_FOLD_KEY, open ? '1' : '0'); } catch (e) { /* private mode */ }
}

function simDebugToolsToggle() {
    const body = document.getElementById('simDebugTools');
    if (body) simDebugToolsSet(body.hidden);
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
    let open = false;
    try { open = localStorage.getItem(DBG_FOLD_KEY) === '1'; } catch (e) { /* private mode */ }
    if (open) simDebugToolsSet(true);
});

// ---- halting ----------------------------------------------------------------

function simDebugIsHalted() { return dbgHalted; }

function simDebugHalt() {
    if (dbgHalted) { simDebugResume(); return; }
    if (typeof simIsRunning !== 'function' || !simIsRunning()) {
        simDebugStatus('Press Play first - there is nothing running to halt', 'warn');
        return;
    }
    simPost({type: 'halt'});
    simDebugStatus('Halting at the end of this sample...', '');
}

function simDebugOnHalted(msg) {
    const image = typeof simGetImage === 'function' ? simGetImage() : null;
    if (!image || typeof FXCoreCore === 'undefined') return;
    dbgCore = new FXCoreCore();
    dbgCore.setPresets({creg: image.creg, mreg: image.mreg, sfr: image.sfr,
                        usr: image.usr, cfg: image.cfg});
    dbgCore.sampleRate = typeof simGetRate === 'function' ? simGetRate() : 48000;
    dbgCore.setProgram(image.program);
    dbgCore.traceOn = true;
    dbgCore.importState(msg.state);
    dbgPc = msg.pc;
    dbgHalted = true;
    dbgStepped = false;
    dbgReason = msg.reason;
    dbgInputs = Array.from(dbgCore.inputs, v => v / 2147483648);
    if (typeof openFlyout === 'function') openFlyout('sim');
    simDebugToolsSet(true);
    simDebugRefresh();
}

function simDebugOnResumed() {
    dbgHalted = false;
    dbgCore = null;
    dbgPc = -1;
    simDebugClearLine();
    simDebugUpdateButtons();
    simDebugStatus('Running freely', '');
    if (typeof simTraceOnResume === 'function') simTraceOnResume();
    if (typeof regsUpdateStatus === 'function') regsUpdateStatus();
}

function simDebugResume() {
    if (!dbgHalted) return;
    let state = null;
    if (dbgStepped) {
        // The worklet finishes whatever is open: the rest of the current
        // sample, or just its end-of-sample bookkeeping.
        state = dbgCore.exportState();
        state.haltedPc = dbgPc;
    }
    simPost({type: 'resume', state: state});
}

// Stop was pressed while halted. The context is about to be suspended and
// will not answer, so the halt is let go of here and now; the resume itself
// is delivered when the context next runs.
function simDebugOnStop() {
    if (!dbgHalted) return;
    simDebugResume();
    simDebugOnResumed();
}

// ---- stepping ---------------------------------------------------------------

// One instruction. At the end of a pass the step is the bookkeeping and the
// start of the next sample, so the next press lands on the first line again.
function simDebugStep() {
    if (!dbgHalted) return;
    simDebugAdvance();
    dbgStepped = true;
    simDebugRefresh();
}

function simDebugAdvance() {
    if (dbgPc >= dbgCore.progLen) {
        simDebugNextSample();
        return;
    }
    dbgCore.onInstruction = () => true;
    dbgPc = dbgCore.execute(dbgPc);
    dbgCore.onInstruction = null;
}

function simDebugNextSample() {
    dbgCore.endSample();
    if (typeof simGetPots === 'function') dbgCore.setPots(simGetPots());
    if (typeof simPinMask === 'function') dbgCore.setPins(simPinMask());
    dbgCore.beginSample(dbgInputs);
    dbgPc = 0;
}

// The rest of this pass, then stop at the top of the next one.
function simDebugStepSample() {
    if (!dbgHalted) return;
    dbgCore.onInstruction = null;
    if (dbgPc < dbgCore.progLen) dbgPc = dbgCore.execute(dbgPc);
    simDebugNextSample();
    dbgStepped = true;
    simDebugRefresh();
}

function simDebugRunToLine() {
    if (!dbgHalted) return;
    const input = document.getElementById('simRunToLine');
    const line = input ? +input.value : 0;
    const target = simDebugPcOfLine(line);
    if (target < 0) {
        simDebugStatus('No instruction on line ' + line, 'warn');
        return;
    }
    // At least one instruction, then on until the target is next -- across
    // sample boundaries if need be, up to a budget, since a line a jump skips
    // may not come round for a while, or ever.
    let budget = DBG_RUN_BUDGET * Math.max(1, dbgCore.progLen);
    do {
        simDebugAdvance();
    } while (dbgPc !== target && --budget > 0);
    dbgStepped = true;
    simDebugRefresh();
    if (dbgPc !== target) {
        simDebugStatus('Line ' + line + ' was not reached in ' + DBG_RUN_BUDGET +
            ' samples - stopped at ' + simDebugWhere(), 'warn');
    }
}

// ---- the picture ------------------------------------------------------------

function simDebugRefresh() {
    simDebugUpdateButtons();
    simDebugStatus(simDebugReasonText() + ' - ' + simDebugWhere() +
        '. Input held at the halted sample.', 'halted');
    simDebugShowLine();
    const snap = typeof fxcoreSnapshot === 'function' ? fxcoreSnapshot(dbgCore) : null;
    if (snap) {
        if (typeof simRegsOnState === 'function') simRegsOnState(snap);
        if (typeof simTraceOnHalted === 'function') simTraceOnHalted(snap, dbgPc);
    }
    if (typeof regsUpdateStatus === 'function') regsUpdateStatus();
}

function simDebugWhere() {
    const sample = dbgCore ? (dbgCore.sampleCount >>> 0).toLocaleString() : '?';
    if (!dbgCore || dbgPc >= dbgCore.progLen) return 'end of sample ' + sample;
    const line = simDebugLineOfPc(dbgPc);
    return (line ? 'line ' + line : 'pc ' + dbgPc) + ', sample ' + sample;
}

function simDebugReasonText() {
    const r = dbgReason;
    if (!r || r.kind === 'halt') return 'Halted';
    const bp = dbgBreakpoints.find(b => b.id === r.id);
    return 'Breakpoint: ' + (bp ? simDebugLabel(bp) : r.kind);
}

function simDebugShowLine() {
    if (typeof editor === 'undefined' || !editor || typeof monaco === 'undefined') return;
    const line = dbgPc < dbgCore.progLen ? simDebugLineOfPc(dbgPc) : 0;
    const decs = line ? [{
        range: new monaco.Range(line, 1, line, 1),
        options: {isWholeLine: true, className: 'fxc-debug-line',
                  glyphMarginClassName: 'fxc-debug-arrow',
                  stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges}
    }] : [];
    dbgLineDecorations = editor.deltaDecorations(dbgLineDecorations, decs);
    if (line) editor.revealLineInCenterIfOutsideViewport(line);
}

function simDebugClearLine() {
    if (typeof editor === 'undefined' || !editor || !dbgLineDecorations.length) return;
    dbgLineDecorations = editor.deltaDecorations(dbgLineDecorations, []);
}

function simDebugUpdateButtons() {
    const set = (id, on) => { const el = document.getElementById(id); if (el) el.disabled = !on; };
    set('simStepBtn', dbgHalted);
    set('simStepSampleBtn', dbgHalted);
    set('simRunToBtn', dbgHalted);
    const halt = document.getElementById('simHaltBtn');
    if (halt) {
        halt.textContent = dbgHalted ? 'Resume' : 'Halt';
        halt.classList.toggle('sim-dbg-halted', dbgHalted);
    }
}

function simDebugStatus(msg, kind) {
    const el = document.getElementById('simDebugStatus');
    if (!el) return;
    el.textContent = msg;
    el.className = 'sim-status' + (kind ? ' sim-status-' + kind : '');
}

// ---- lines and addresses ----------------------------------------------------

// Instruction address -> editor line, for the build the worklet holds.
function simDebugLines() {
    const image = typeof simGetImage === 'function' ? simGetImage() : null;
    return image && image.lines ? image.lines : null;
}

function simDebugLineOfPc(pc) {
    const lines = simDebugLines();
    return lines && pc >= 0 && pc < lines.length ? lines[pc] : 0;
}

// The first instruction on a line, or -1 if there is none.
function simDebugPcOfLine(line) {
    const lines = simDebugLines();
    return lines && line > 0 ? lines.indexOf(line) : -1;
}

// ---- breakpoints ------------------------------------------------------------
//
// A breakpoint is kept by line, not by address: the address is looked up from
// the current build each time the list is sent, and a Monaco decoration keeps
// the line itself in step with edits above it. One that lands on a line with
// no instruction stays in the list, greyed, until the build gives it one.

function simDebugAddBreakpoint(spec) {
    const bp = Object.assign({id: dbgNextId++, enabled: true}, spec);
    dbgBreakpoints.push(bp);
    simDebugDecorateBreakpoint(bp);
    simDebugRenderList();
    simDebugPushBreakpoints();
    return bp;
}

function simDebugRemoveBreakpoint(id) {
    const at = dbgBreakpoints.findIndex(b => b.id === id);
    if (at < 0) return;
    dbgBreakpoints.splice(at, 1);
    if (dbgBpDecorations[id] !== undefined && typeof editor !== 'undefined' && editor) {
        editor.deltaDecorations([dbgBpDecorations[id]], []);
    }
    delete dbgBpDecorations[id];
    simDebugRenderList();
    simDebugPushBreakpoints();
}

function simDebugToggleLine(line) {
    const existing = dbgBreakpoints.find(b => b.kind === 'line' && b.line === line);
    if (existing) simDebugRemoveBreakpoint(existing.id);
    else simDebugAddBreakpoint({kind: 'line', line: line, when: 'always'});
}

function simDebugDecorateBreakpoint(bp) {
    if (!bp.line || typeof editor === 'undefined' || !editor || typeof monaco === 'undefined') return;
    const cls = bp.kind === 'line' ? 'fxc-bp-glyph' : 'fxc-bp-glyph fxc-bp-glyph-cond';
    const ids = editor.deltaDecorations([], [{
        range: new monaco.Range(bp.line, 1, bp.line, 1),
        options: {glyphMarginClassName: cls, glyphMarginHoverMessage: {value: simDebugLabel(bp)},
                  stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges}
    }]);
    dbgBpDecorations[bp.id] = ids[0];
}

// Lines move when text is inserted above them; the decorations moved with
// them, so read the lines back before using them.
function simDebugSyncLines() {
    if (typeof editor === 'undefined' || !editor) return;
    const model = editor.getModel();
    if (!model) return;
    let changed = false;
    for (const bp of dbgBreakpoints) {
        const dec = dbgBpDecorations[bp.id];
        if (dec === undefined) continue;
        const range = model.getDecorationRange(dec);
        if (range && range.startLineNumber !== bp.line) {
            bp.line = range.startLineNumber;
            changed = true;
        }
    }
    if (changed) simDebugRenderList();
}

function simDebugNeedsLine(bp) {
    return bp.kind === 'line' || bp.kind === 'jump' || (bp.kind === 'clip' && !!bp.line);
}

// What the worklet checks: the same list with lines turned into addresses
// and registers split into a file and an index. Anything that cannot be
// resolved is left out.
function simDebugPushBreakpoints() {
    simDebugSyncLines();
    const list = [];
    for (const bp of dbgBreakpoints) {
        if (!bp.enabled) continue;
        const spec = {id: bp.id, kind: bp.kind};
        if (simDebugNeedsLine(bp)) {
            spec.pc = simDebugPcOfLine(bp.line);
            if (spec.pc < 0) continue;
        } else if (bp.kind === 'clip') {
            spec.pc = -1;
        }
        if (bp.kind === 'line') { spec.when = bp.when; spec.sample = bp.sample | 0; }
        if (bp.kind === 'jump') spec.taken = !!bp.taken;
        if (bp.kind === 'reg') {
            spec.space = bp.reg[0];
            spec.idx = +bp.reg.slice(1);
            spec.op = bp.op;
            spec.word = bp.word | 0;
        }
        list.push(spec);
    }
    simPost({type: 'breakpoints', list: list});
}

// The build changed: addresses may have moved, and lines that had no
// instruction may have one now.
function simDebugOnLoad() {
    simDebugPushBreakpoints();
    simDebugRenderList();
    simDebugFillRegisters();
}

// A word the way a condition was written: a fraction, a hex word or an integer.
function simDebugWordText(word, fmt) {
    if (fmt === 'hex') return '0x' + ((word | 0) >>> 0).toString(16).toUpperCase().padStart(8, '0');
    if (fmt === 'int') return String(word | 0);
    const f = word / 2147483648;
    return (f < 0 ? '' : '+') + f.toFixed(6);
}

function simDebugLabel(bp) {
    switch (bp.kind) {
    case 'line':
        return 'Line ' + bp.line + ', ' + (bp.when === 'first' ? 'first run'
            : bp.when === 'sample' ? 'sample ' + (bp.sample | 0) : 'every sample');
    case 'clip':
        return bp.line ? 'Clip at line ' + bp.line : 'Clip anywhere';
    case 'jump':
        return 'Jump at line ' + bp.line + (bp.taken ? ' taken' : ' not taken');
    case 'reg':
        return regsRegName(bp.reg) + ' ' + bp.op + ' ' + simDebugWordText(bp.word, bp.fmt);
    }
    return bp.kind;
}

function simDebugRenderList() {
    const el = document.getElementById('simBpList');
    if (!el) return;
    el.innerHTML = '';
    if (!dbgBreakpoints.length) {
        el.innerHTML = '<div class="sim-bp-empty">None set</div>';
        return;
    }
    for (const bp of dbgBreakpoints) {
        const row = document.createElement('div');
        row.className = 'sim-bp-row';
        const unresolved = simDebugNeedsLine(bp) && simDebugPcOfLine(bp.line) < 0;
        if (unresolved) row.classList.add('sim-bp-unresolved');
        if (!bp.enabled) row.classList.add('sim-bp-off');

        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = bp.enabled;
        box.title = 'Enabled';
        box.addEventListener('change', () => {
            bp.enabled = box.checked;
            simDebugRenderList();
            simDebugPushBreakpoints();
        });
        const label = document.createElement('span');
        label.className = 'sim-bp-label';
        label.textContent = simDebugLabel(bp);
        if (unresolved) label.title = 'No instruction on that line in the current build';
        if (bp.line) {
            label.classList.add('sim-bp-link');
            label.addEventListener('click', () => {
                if (typeof editor !== 'undefined' && editor) editor.revealLineInCenter(bp.line);
            });
        }
        const x = document.createElement('button');
        x.className = 'sim-bp-remove';
        x.textContent = '✕';
        x.title = 'Remove';
        x.addEventListener('click', () => simDebugRemoveBreakpoint(bp.id));
        row.append(box, label, x);
        el.appendChild(row);
    }
}

// ---- the add form -----------------------------------------------------------

// The register list for a condition: ACC32, FLAGS and R0-R15, the memory
// registers, and the SFRs, with the names the program gives them.
function simDebugFillRegisters() {
    const sel = document.getElementById('simBpReg');
    if (!sel) return;
    const keep = sel.value;
    let aliases = {};
    try {
        if (typeof regsParseAliases === 'function' && typeof editor !== 'undefined' && editor) {
            aliases = regsParseAliases(editor.getValue());
        }
    } catch (e) { /* no editor yet */ }
    const group = (label, keys) => {
        const g = document.createElement('optgroup');
        g.label = label;
        for (const key of keys) {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = regsRegName(key) + (aliases[key] ? '  ' + aliases[key].join(', ') : '');
            g.appendChild(opt);
        }
        sel.appendChild(g);
    };
    sel.innerHTML = '';
    const core = ['c16', 'c17'];
    for (let i = 0; i < 16; i++) core.push('c' + i);
    group('Core', core);
    const mem = [];
    for (let i = 0; i < 128; i++) mem.push('m' + i);
    group('Memory', mem);
    const sfr = [];
    for (let i = 0; i < REGS_SFR_NAMES.length; i++) sfr.push('s' + i);
    group('SFR', sfr);
    if (keep) sel.value = keep;
}

function simDebugBpKindChange() {
    const kind = document.getElementById('simBpKind').value;
    const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
    show('simBpLine', kind === 'line' || kind === 'clip' || kind === 'jump');
    show('simBpWhen', kind === 'line');
    show('simBpSample', kind === 'line' && document.getElementById('simBpWhen').value === 'sample');
    show('simBpTaken', kind === 'jump');
    show('simBpReg', kind === 'reg');
    show('simBpOp', kind === 'reg');
    show('simBpValue', kind === 'reg');
    const line = document.getElementById('simBpLine');
    if (line) line.placeholder = kind === 'clip' ? 'line (any)' : 'line';
}

// A value as typed into the form: a fraction of full scale (0.5, -0.25), a raw
// word in hex (0x00000400), or a plain integer with an i (5i, -3i). Returns
// the S.31 word and how it was written, so the list reads back the same way;
// null if it is none of those or is out of range.
function simDebugParseValue(text) {
    const t = String(text == null ? '' : text).trim();
    if (!t) return null;
    let m = /^(?:0x|\$)([0-9a-f]{1,8})$/i.exec(t);
    if (m) return {word: parseInt(m[1], 16) | 0, fmt: 'hex'};
    m = /^([+-]?\d+)i$/i.exec(t);
    if (m) {
        const n = parseInt(m[1], 10);
        if (n < -2147483648 || n > 2147483647) return null;
        return {word: n | 0, fmt: 'int'};
    }
    if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) {
        const f = parseFloat(t);
        if (!isFinite(f) || f < -1 || f > 1) return null;
        const w = Math.round(f * 2147483648);
        return {word: Math.min(2147483647, w) | 0, fmt: 'frac'};
    }
    return null;
}

function simDebugAddFromForm() {
    const v = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
    const kind = v('simBpKind');
    const line = parseInt(v('simBpLine'), 10) || 0;
    const spec = {kind: kind};
    if (kind === 'line' || kind === 'jump') {
        if (!line) { simDebugStatus('A line number is needed', 'warn'); return; }
        spec.line = line;
    }
    if (kind === 'clip' && line) spec.line = line;
    if (kind === 'line') {
        spec.when = v('simBpWhen');
        spec.sample = parseInt(v('simBpSample'), 10) || 0;
    }
    if (kind === 'jump') spec.taken = v('simBpTaken') === '1';
    if (kind === 'reg') {
        const val = simDebugParseValue(v('simBpValue'));
        if (!val) {
            simDebugStatus('A value is needed: a fraction from -1 to 1, a hex word (0x400) or an integer (5i)', 'warn');
            return;
        }
        spec.op = v('simBpOp');
        spec.reg = v('simBpReg');
        spec.word = val.word;
        spec.fmt = val.fmt;
    }
    simDebugAddBreakpoint(spec);
}

// ---- wiring -----------------------------------------------------------------

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
    simDebugUpdateButtons();
    simDebugRenderList();
    simDebugBpKindChange();
    const when = document.getElementById('simBpWhen');
    if (when) when.addEventListener('change', simDebugBpKindChange);

    let tries = 0;
    const attach = setInterval(() => {
        if (typeof editor !== 'undefined' && editor && editor.onMouseDown && typeof monaco !== 'undefined') {
            clearInterval(attach);
            // A click in the glyph margin sets or clears a line breakpoint.
            editor.onMouseDown((e) => {
                if (e.target && e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
                    e.target.position) {
                    simDebugToggleLine(e.target.position.lineNumber);
                }
            });
            let timer = null;
            editor.onDidChangeModelContent(() => {
                clearTimeout(timer);
                timer = setTimeout(() => { simDebugSyncLines(); simDebugFillRegisters(); }, 300);
            });
            simDebugFillRegisters();
        } else if (++tries > 40) {
            clearInterval(attach);
        }
    }, 250);
});

// The value parser and the labels are pure, so they are exported for the
// headless tests.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { simDebugParseValue, simDebugWordText };
}
