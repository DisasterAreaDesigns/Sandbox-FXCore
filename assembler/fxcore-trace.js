// FXCore trace -- what each line produced, shown in the editor.
//
// An FXCore program runs once per sample, from the top, so one sample's pass
// is a trace of the program: the core records the word each instruction
// produced and where it went, and the value is written at the end of the line,
// live, while the program plays. A jump line says whether it was taken, a line
// a jump went over says it was skipped, and a line whose result had to be
// clamped is marked with how often that happened.
//
// "What it produced" is the register the instruction wrote -- ACC32 for the
// arithmetic and logic, the destination for a copy or a delay read, the memory
// register or SFR for a store, ACC64 for a MAC -- so the readout says which
// register it is as well as what it holds. An instruction that leaves nothing
// to show, a delay write, says only that it ran.
//
// Several instructions can share a line, when a library call has expanded to
// them. The line then shows the last of them that ran.
//
// The readout belongs to the build the core is running. Once the source is
// edited past that build the lines no longer match the addresses, so the
// trace is taken down until the next assemble rather than left drifting.

let traceOn = false;
let traceDecorations = [];
let traceLines = null;        // address -> line, for the build the core runs
let traceProgram = null;      // that build's words, to tell a jump from the rest
let traceVersion = null;      // editor version the build was made from
let traceLastPaint = 0;
let tracePending = null;      // a snapshot held back by the paint throttle
let tracePendingTimer = null;
let traceStaleShown = false;
let traceLastClip = null;     // the previous snapshot's counts, for the rate
let traceLastSamples = 0;
let traceLastPainted = null;  // what was last drawn, so a change of format can redraw it

const TRACE_PAINT_MS = 80;    // the eye cannot read numbers faster

function simTraceToggle(on) {
    traceOn = !!on;
    if (typeof simSetWatch === 'function') simSetWatch({trace: traceOn});
    if (!traceOn) simTraceClear();
    simTraceNote();
}

function simTraceClear() {
    traceLastPainted = null;
    if (typeof editor === 'undefined' || !editor || !traceDecorations.length) return;
    traceDecorations = editor.deltaDecorations(traceDecorations, []);
}

// Called from the load hook with the line map and the words of the build just
// loaded.
function simTraceOnLoad(lines, program) {
    traceLines = lines ? Array.from(lines) : null;
    traceProgram = program ? Int32Array.from(program) : null;
    traceVersion = null;
    try {
        if (typeof editor !== 'undefined' && editor && editor.getModel()) {
            traceVersion = editor.getModel().getAlternativeVersionId();
        }
    } catch (e) { /* no editor yet */ }
    traceStaleShown = false;
    simTraceClear();
    simTraceNote();
}

function simTraceIsStale() {
    if (!traceLines || traceVersion === null) return true;
    try {
        return editor.getModel().getAlternativeVersionId() !== traceVersion;
    } catch (e) {
        return true;
    }
}

function simTraceOnState(s) {
    if (!traceOn || !s.trace) return;
    if (typeof editor === 'undefined' || !editor || typeof monaco === 'undefined') return;
    if (simTraceIsStale()) {
        if (!traceStaleShown) {
            simTraceClear();
            traceStaleShown = true;
            simTraceNote();
        }
        return;
    }
    // Throttled by deferring, not dropping: the snapshot posted on a reset or
    // a program load is a single message, and if it fell inside the window it
    // would never be drawn -- the engine is stopped and nothing follows it.
    const now = performance.now();
    if (now - traceLastPaint < TRACE_PAINT_MS) {
        tracePending = s;
        if (!tracePendingTimer) {
            tracePendingTimer = setTimeout(() => {
                tracePendingTimer = null;
                const p = tracePending;
                tracePending = null;
                if (p) simTraceOnState(p);
            }, TRACE_PAINT_MS - (now - traceLastPaint));
        }
        return;
    }
    tracePending = null;
    traceLastPaint = now;
    simTracePaint(s.trace, -1);
}

// While halted the trace is the pass in progress: lines up to the halt show
// this sample's values, and the ones it has not reached yet are marked as
// pending rather than left showing the previous pass. Painted whether or not
// the trace is switched on -- stepping without it would be stepping blind --
// but not past a stale build.
function simTraceOnHalted(s, pc) {
    if (!s.trace || typeof editor === 'undefined' || !editor || typeof monaco === 'undefined') return;
    if (simTraceIsStale()) return;
    simTracePaint(s.trace, pc);
}

// Back to the live readout, or to nothing if the trace is off.
function simTraceOnResume() {
    if (!traceOn) simTraceClear();
}

// The viewer's format changed: say the same thing in the other units.
function simTraceRefresh() {
    if (!traceLastPainted || simTraceIsStale()) return;
    simTracePaint(traceLastPainted.t, traceLastPainted.pending);
}

// A destination code from the core's trace (see FXCoreCore.traceRecord) as a
// name and a reading.
function simTraceDest(dst, v) {
    const text = (w) => typeof regsText === 'function' ? regsText(w) : simTraceFloat(w);
    if (dst >= 400) return 'USER' + (dst - 400) + ' = ' + v;
    if (dst === 300) return 'ACC64 ' + text(v);
    if (dst >= 256) {
        const name = typeof REGS_SFR_NAMES !== 'undefined' ? REGS_SFR_NAMES[dst - 256] : 'SFR' + (dst - 256);
        return name + ' ' + text(v);
    }
    if (dst >= 128) return 'MR' + (dst - 128) + ' ' + text(v);
    if (dst === 16) return 'ACC32 ' + text(v);
    if (dst === 17) return 'FLAGS ' + text(v);
    return 'R' + dst + ' ' + text(v);
}

function simTraceIsJump(pc) {
    if (!traceProgram || pc >= traceProgram.length) return false;
    const op = (traceProgram[pc] >>> 24) & 0xFF;
    return op >= 0xAE && op <= 0xB8;
}

function simTracePaint(t, pendingFrom) {
    traceLastPainted = {t: t, pending: pendingFrom};
    const model = editor.getModel();
    const decs = [];
    // Straight after a reset or a load nothing has run, and a trace of that
    // would call every line skipped. Show nothing until the first pass.
    if (t.samples === 0 && pendingFrom < 0) {
        simTraceClear();
        traceLastClip = null;
        return;
    }
    // The instructions of each line, in address order.
    const byLine = new Map();
    for (let pc = 0; pc < t.len && pc < traceLines.length; pc++) {
        const line = traceLines[pc];
        if (!line || line > model.getLineCount()) continue;
        if (!byLine.has(line)) byLine.set(line, []);
        byLine.get(line).push(pc);
    }
    for (const [line, pcs] of byLine) {
        const done = pcs.filter(pc => pendingFrom < 0 || pc < pendingFrom);
        const ran = done.filter(pc => t.ran[pc]);
        let text, cls = 'fxc-trace';
        if (!done.length) {
            text = '⇒ …';
            cls += ' fxc-trace-skip';
        } else if (!ran.length) {
            text = '⇒ skipped';
            cls += ' fxc-trace-skip';
        } else {
            const last = ran[ran.length - 1];
            if (simTraceIsJump(last)) {
                const taken = !!t.jump[last];
                text = '⇒ ' + (taken ? 'jumped' : 'not taken');
                if (taken) cls += ' fxc-trace-taken';
            } else if (t.dst[last] < 0) {
                text = '⇒ ran';
            } else {
                text = '⇒ ' + simTraceDest(t.dst[last], t.val[last]);
            }
            if (done.length < pcs.length) text += ' …';
            // The worst clip rate of any instruction on the line.
            let worst = -1;
            for (const pc of pcs) worst = Math.max(worst, simTraceClipPct(t, pc));
            const clipText = worst < 0 ? '' : 'clip ' + (worst === 0 ? '<1' : worst) + '%';
            if (clipText) {
                text += '  ⚠ ' + clipText;
                cls += ' fxc-trace-clip';
            }
        }
        const col = model.getLineMaxColumn(line);
        decs.push({
            range: new monaco.Range(line, col, line, col),
            options: {
                after: {content: '  ' + text, inlineClassName: cls, cursorStops: 'none'},
                // The range is empty -- the text hangs off the end of the line
                // -- and Monaco drops injected text on an empty range unless
                // told to keep it.
                showIfCollapsed: true,
                stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
            }
        });
    }
    traceDecorations = editor.deltaDecorations(traceDecorations, decs);
    // A halted pass repaints on every step; the clip rate is only meaningful
    // between snapshots of the running core.
    if (pendingFrom < 0) {
        traceLastClip = t.clip;
        traceLastSamples = t.samples;
    }
}

// The counts arrive cumulative, so each snapshot is compared with the one
// before it: the share of samples since then on which the instruction
// clipped. A sample count going backwards means the core was reset, and the
// comparison starts afresh.
function simTraceClipPct(t, pc) {
    const reset = !traceLastClip || traceLastClip.length !== t.clip.length ||
        t.samples < traceLastSamples;
    const dClip = t.clip[pc] - (reset ? 0 : traceLastClip[pc]);
    const dSamples = t.samples - (reset ? 0 : traceLastSamples);
    if (dClip <= 0 || dSamples <= 0) return -1;
    return Math.min(100, Math.round(100 * dClip / dSamples));
}

function simTraceFloat(v) {
    const f = v / 2147483648;
    return (f < 0 ? '' : '+') + f.toFixed(6);
}

function simTraceNote() {
    const el = document.getElementById('simTraceNote');
    if (!el) return;
    if (!traceOn) {
        el.textContent = 'Off. When on, each line in the editor shows the ' +
            'register it wrote and what that now holds, whether a jump was ' +
            'taken, and how often the result clipped.';
    } else if (!traceLines) {
        el.textContent = 'Waiting for a build - press Assemble.';
    } else if (simTraceIsStale()) {
        el.textContent = 'Source changed since the last build - the trace is ' +
            'hidden until you assemble again.';
    } else {
        el.textContent = 'Showing what each line produced, while the ' +
            'program plays.';
    }
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
    const box = document.getElementById('simTrace');
    if (box) box.addEventListener('change', () => simTraceToggle(box.checked));
    simTraceNote();
    // Watch for the source moving past the build, so the note changes as soon
    // as the trace comes down rather than on the next snapshot.
    let tries = 0;
    const attach = setInterval(() => {
        if (typeof editor !== 'undefined' && editor && editor.onDidChangeModelContent) {
            clearInterval(attach);
            editor.onDidChangeModelContent(() => {
                if (traceOn && !traceStaleShown && simTraceIsStale()) {
                    simTraceClear();
                    traceStaleShown = true;
                    simTraceNote();
                }
            });
        } else if (++tries > 40) {
            clearInterval(attach);
        }
    }, 250);
});
