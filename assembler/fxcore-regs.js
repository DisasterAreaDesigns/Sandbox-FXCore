// FXCore Register viewer -- a second window watching the simulator's core.
//
// Shows the machine as the program is running: ACC32 and ACC64, the flags, the
// audio in and out, the pots, the LFOs and ramps, the switches and the tap
// tempo, R0-R15 and the 128 memory registers, each as the value it holds and
// the 32-bit word behind it.
//
// It is a real window rather than another flyout because the flyouts share
// one edge of the screen with the editor, and the point of watching registers
// is to do it while editing. A window can be dragged to a second display and
// left there.
//
// Where the browser offers it (Chromium's Document Picture-in-Picture) the
// window is a floating one: it stays on top of the editor and has no address
// bar, since a bar reading about:blank over a register file said nothing
// useful. Elsewhere, and when "Always on top" is turned off in the viewer's
// own header, it is an ordinary popup.
//
// Either way the window is opened blank and the document written into it,
// rather than loading a viewer page from the site. Two pages opened from
// file:// URLs are separate origins in Chrome, and a viewer page loaded that
// way could not be reached from here at all -- while a blank window is always
// the opener's origin, whatever the opener was served from. The one cost is
// that the viewer's markup and styles live in this file rather than in one of
// their own.
//
// Registers are named by a key: 'c3' is R3 (c16 is ACC32, c17 FLAGS), 'm5' is
// MR5, 's16' is the SFR at address 16. The same keys address a scope here and
// a breakpoint in fxcore-debug.js.

let regsWin = null;
let regsWinFloating = false;   // a picture-in-picture window rather than a popup
let regsDock = null;           // the in-page panel, when the browser allowed neither
let regsEls = null;            // element handles inside the popup
let regsPoll = null;           // watches for the window being closed
let regsThemeObserver = null;
let regsLastState = null;
let regsAliases = null;        // key of the alias set last painted
let regsAliasMap = null;       // register key -> [names from .rn lines]
let regsFormat = 'frac';       // how a word is read: 'frac' (S.31) or 'int'
let regsMemAll = false;        // list every memory register, not only the live ones

const REGS_ONE = 0x80000000;   // 1.0 in S.31
const REGS_MAX_SCOPES = 6;
const REGS_FORMAT_KEY = 'fxcore_regs_format';
const REGS_WINDOWS = [
    {s: 0.064, label: '64 ms'}, {s: 0.25, label: '250 ms'}, {s: 1, label: '1 s'},
    {s: 4, label: '4 s'}, {s: 16, label: '16 s'}
];

// The SFRs by address, as the core numbers them.
const REGS_SFR_NAMES = (() => {
    const n = ['IN0', 'IN1', 'IN2', 'IN3', 'OUT0', 'OUT1', 'OUT2', 'OUT3', 'PIN', 'SWITCH'];
    for (let i = 0; i < 6; i++) n.push('POT' + i + '_K');
    for (let i = 0; i < 6; i++) n.push('POT' + i);
    for (let i = 0; i < 6; i++) n.push('POT' + i + '_SMTH');
    for (let i = 0; i < 4; i++) n.push('LFO' + i + '_F');
    n.push('RAMP0_F', 'RAMP1_F');
    for (let i = 0; i < 4; i++) n.push('LFO' + i + '_S', 'LFO' + i + '_C');
    n.push('RAMP0_R', 'RAMP1_R', 'MAXTEMPO', 'TAPTEMPO', 'SAMPLECNT', 'NOISE', 'BOOTSTAT');
    return n;
})();

// The bits of FLAGS (CREG 17): the tap tempo's state and the clip detectors.
const REGS_FLAG_NAMES = {
    1: 'TAPPE', 2: 'TAPRE', 3: 'NEWTT', 4: 'TAPSTKY', 5: 'TB2nTB1',
    8: 'IN0 clip', 9: 'IN1 clip', 10: 'IN2 clip', 11: 'IN3 clip',
    12: 'OUT0 clip', 13: 'OUT1 clip', 14: 'OUT2 clip', 15: 'OUT3 clip'
};

// ---- naming ---------------------------------------------------------------

function regsKey(space, idx) { return space + idx; }

// The name the hardware gives a register.
function regsRegName(key) {
    const idx = +key.slice(1);
    if (key[0] === 'm') return 'MR' + idx;
    if (key[0] === 's') return REGS_SFR_NAMES[idx] || 'SFR' + idx;
    if (idx === 16) return 'ACC32';
    if (idx === 17) return 'FLAGS';
    return 'R' + idx;
}

// A register's word, out of a snapshot.
function regsWordOf(s, key) {
    const idx = +key.slice(1);
    const file = key[0] === 'c' ? s.creg : key[0] === 'm' ? s.mreg : s.sfr;
    return file[idx] | 0;
}

// Worth a scope: a value that moves, rather than a mask or a count.
function regsScopable(key) {
    const idx = +key.slice(1);
    if (key[0] === 'm') return true;
    if (key[0] === 'c') return idx !== 17;
    return idx < 8 || (idx >= 16 && idx < 28) || (idx >= 34 && idx <= 43) || idx === 47;
}

// The rows of the viewer, in the order they are drawn. `uni` is a value that
// only runs 0 to full scale -- the pots -- so its bar grows from the left.
const REGS_AUDIO = [];
for (let i = 0; i < 4; i++) REGS_AUDIO.push({key: 's' + i, name: 'IN' + i});
for (let i = 0; i < 4; i++) REGS_AUDIO.push({key: 's' + (4 + i), name: 'OUT' + i});
const REGS_POTS = [];
for (let i = 0; i < 6; i++) REGS_POTS.push({key: 's' + (16 + i), name: 'POT' + i, uni: true});
for (let i = 0; i < 6; i++) REGS_POTS.push({key: 's' + (22 + i), name: 'POT' + i + '_SMTH', uni: true});
const REGS_CORE = [];
for (let i = 0; i < 16; i++) REGS_CORE.push({key: 'c' + i, name: i === 15 ? 'R15 PARAM0' : 'R' + i});
const REGS_MEM = [];
for (let i = 0; i < 128; i++) REGS_MEM.push({key: 'm' + i, name: 'MR' + i});
// The rows whose names an .rn line can replace: all of the above, plus the ones below.
const REGS_ALL_ROWS = [{key: 'c16', name: 'ACC32'}, {key: 'c17', name: 'FLAGS'}]
    .concat(REGS_AUDIO, REGS_POTS, REGS_CORE, REGS_MEM);

// ---- the popup document ---------------------------------------------------

const REGS_CSS = `
:root {
    --bg: #f8f9fa; --fg: #333; --muted: #666; --border: #dee2e6;
    --row: rgba(127,127,127,0.08); --bar: #3b7dd8; --neg: #d8743b;
    --ok: #2e7d32; --warn: #b26a00; --alias: #1f6f9f;
}
body.dark { --bg: #2a2a2a; --fg: #e0e0e0; --muted: #999; --border: #444;
    --row: rgba(255,255,255,0.05); --bar: #5b9cf0; --neg: #f0a05b; --alias: #7fc4ea; }
* { box-sizing: border-box; }
body { margin: 0; padding: 12px 14px; background: var(--bg); color: var(--fg);
    font: 13px/1.35 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
body.stopped .val, body.stopped .hex, body.stopped .fill { opacity: 0.45; }
header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 8px;
    padding-bottom: 8px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
header h1 { font-size: 15px; margin: 0; font-weight: 600; }
#status { font-size: 12px; color: var(--muted); }
#status.running { color: var(--ok); }
#status.warn { color: var(--warn); }
#rate { font-size: 12px; color: var(--muted); margin-left: auto; }
header label { display: flex; align-items: center; gap: 4px; font-size: 11px;
    color: var(--muted); white-space: nowrap; cursor: pointer; }
header input { margin: 0; }
header select { font-size: 11px; background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: 3px; padding: 1px 4px; }
#float-ctl.hidden { display: none; }
h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--muted); margin: 12px 0 4px; font-weight: 600; }
.rows { display: grid; grid-template-columns: 1fr; gap: 2px; }
.rows.two { grid-template-columns: 1fr 1fr; column-gap: 12px; }
@media (max-width: 520px) { .rows.two { grid-template-columns: 1fr; } }
.row { display: grid; grid-template-columns: minmax(5em, 1fr) 6.4em 7.2em; align-items: center;
    column-gap: 8px; row-gap: 2px; padding: 3px 6px 4px; border-radius: 3px; background: var(--row);
    font-variant-numeric: tabular-nums; }
.row .bar { grid-column: 1 / -1; height: 3px; }
.row.hidden { display: none; }
.name { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.name .alias { color: var(--alias); }
.name .alias::before { content: ' '; }
.name.aliased .hw { color: var(--muted); font-size: 11px; }
.hex { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px;
    color: var(--muted); }
.val { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px;
    text-align: right; white-space: nowrap; }
.row .more { grid-column: 1 / -1; font-size: 11px; color: var(--muted); }
.row .more:empty { display: none; }
.bar { position: relative; height: 8px; background: rgba(127,127,127,0.18);
    border-radius: 2px; overflow: hidden; }
.bar::after { content: ''; position: absolute; left: 50%; top: 0; bottom: 0;
    width: 1px; background: rgba(127,127,127,0.5); }
.fill { position: absolute; top: 0; bottom: 0; background: var(--bar); }
.fill.neg { background: var(--neg); }
.bar.uni::after { display: none; }
.lfo { display: grid; grid-template-columns: 5.5em 1.3fr 1fr 1fr 1fr; align-items: center;
    gap: 8px; padding: 3px 6px; border-radius: 3px; background: var(--row);
    font-variant-numeric: tabular-nums; font-size: 12px; }
.lfo .name { font-weight: 600; }
.lfo .k { color: var(--muted); font-size: 11px; display: block; }
.lfo .v { font-family: ui-monospace, Menlo, Consolas, monospace; }
.lfo .bar { grid-column: 1 / -1; margin-top: 2px; }
.kv { display: grid; grid-template-columns: 8.5em 1fr; gap: 2px 8px; padding: 3px 6px;
    border-radius: 3px; background: var(--row); font-size: 12px; }
.kv .k { color: var(--muted); }
.kv .v { font-family: ui-monospace, Menlo, Consolas, monospace; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
.note { font-size: 11px; color: var(--muted); margin-top: 10px; }
.row .name { cursor: default; }
.row.scopable .name { cursor: pointer; }
.row.scopable .name:hover { text-decoration: underline; }
.row.scoped .name .hw, .row.scoped .name .alias { color: var(--bar); }
#scopes-head { display: flex; align-items: center; gap: 8px; }
#scopes-head h2 { margin: 0; flex: 1; }
#scopes-head select { font-size: 11px; background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: 3px; padding: 1px 4px; }
#scopes-hint { font-size: 11px; color: var(--muted); margin: 2px 0 4px; }
.scope { background: var(--row); border-radius: 3px; padding: 4px 6px; margin-bottom: 4px; }
.scope-head { display: flex; align-items: baseline; gap: 8px; font-size: 12px; }
.scope-head .name { font-family: ui-monospace, Menlo, Consolas, monospace; flex: 1; }
.scope-head .v { font-family: ui-monospace, Menlo, Consolas, monospace; color: var(--muted); }
.scope-head .x { cursor: pointer; color: var(--muted); padding: 0 4px; }
.scope-head .x:hover { color: var(--fg); }
.scope canvas { display: block; width: 100%; height: 72px; }
details > summary { cursor: pointer; font-size: 11px; text-transform: uppercase;
    letter-spacing: 0.06em; color: var(--muted); margin: 12px 0 4px; font-weight: 600; }
#mem-filter { font-size: 11px; color: var(--muted); font-weight: 400; text-transform: none;
    letter-spacing: 0; margin-left: 10px; }
`;

function regsRowHtml(key, name, opts) {
    const bar = opts && opts.uni ? 'bar uni' : 'bar';
    const scopable = regsScopable(key) ? ' scopable' : '';
    return '<div class="row' + scopable + '" id="row-' + key + '">' +
        '<span class="name" id="name-' + key + '"><span class="hw">' + name + '</span></span>' +
        '<span class="hex" id="hex-' + key + '"></span>' +
        '<span class="val" id="val-' + key + '"></span>' +
        '<div class="' + bar + '"><div class="fill" id="fill-' + key + '"></div></div>' +
        '<span class="more" id="more-' + key + '"></span>' +
        '</div>';
}

function regsLfoHtml(id, name, labels) {
    return '<div class="lfo" id="lfo-' + id + '">' +
        '<span class="name">' + name + '</span>' +
        labels.map((k, j) => '<span><span class="k">' + k + '</span>' +
            '<span class="v" id="' + id + '-' + j + '"></span></span>').join('') +
        '<div class="bar' + (id[0] === 'r' ? ' uni' : '') + '"><div class="fill" id="fill-' + id + '"></div></div>' +
        '</div>';
}

function regsKvHtml(id, label) {
    return '<span class="k">' + label + '</span><span class="v" id="kv-' + id + '"></span>';
}

function regsDocument() {
    const rows = (list) => list.map(r => regsRowHtml(r.key, r.name, r)).join('');
    let lfos = '';
    for (let n = 0; n < 4; n++) {
        lfos += regsLfoHtml('lfo' + n, 'LFO' + n, ['Rate', 'Sin', 'Cos', 'Phase']);
    }
    for (let n = 0; n < 2; n++) {
        lfos += regsLfoHtml('rmp' + n, 'RAMP' + n, ['Rate', 'Value', 'Position', '']);
    }
    return '<!doctype html><html><head><meta charset="utf-8">' +
        '<title>FXCore Registers</title><style>' + REGS_CSS + '</style></head>' +
        '<body class="stopped">' +
        '<header><h1>FXCore Registers</h1><span id="status">Not running</span>' +
        '<span id="rate"></span>' +
        '<label title="How a register is read: as a fraction of full scale, or as a plain integer">' +
        'Show as <select id="fmt"><option value="frac">fraction (S.31)</option>' +
        '<option value="int">integer</option></select></label>' +
        '<label id="float-ctl" title="Keep this window above the editor">' +
        '<input type="checkbox" id="float"> Always on top</label></header>' +
        '<h2>Accumulators</h2><div class="rows">' +
        regsRowHtml('c16', 'ACC32') +
        regsRowHtml('acc64u', 'ACC64 upper') + regsRowHtml('acc64l', 'ACC64 lower', {uni: true}) +
        regsRowHtml('c17', 'FLAGS', {uni: true}) + '</div>' +
        '<div id="scopes-head"><h2>Scopes</h2><label for="scope-window">Window</label>' +
        '<select id="scope-window">' +
        REGS_WINDOWS.map(w => '<option value="' + w.s + '">' + w.label + '</option>').join('') +
        '</select></div>' +
        '<div id="scopes-hint">Click a register name below to watch it over time.</div>' +
        '<div id="scopes"></div>' +
        '<h2>Audio</h2><div class="rows two">' + rows(REGS_AUDIO) + '</div>' +
        '<h2>Pots</h2><div class="rows two">' + rows(REGS_POTS) + '</div>' +
        '<h2>LFOs and ramps</h2><div class="rows">' + lfos + '</div>' +
        '<h2>Switches, tap tempo and timing</h2><div class="kv">' +
        regsKvHtml('pin', 'PIN') + regsKvHtml('switch', 'SWITCH') +
        regsKvHtml('user', 'USER pins') + regsKvHtml('tap', 'TAPTEMPO') +
        regsKvHtml('samplecnt', 'SAMPLECNT') + regsKvHtml('noise', 'NOISE') +
        regsKvHtml('agu', 'Delay AGU counter') + '</div>' +
        '<h2>Core registers</h2><div class="rows two" id="regs">' + rows(REGS_CORE) + '</div>' +
        '<details id="mem"><summary>Memory registers MR0-MR127' +
        '<label id="mem-filter"><input type="checkbox" id="mem-all"> list all 128</label></summary>' +
        '<div class="rows two">' + rows(REGS_MEM) + '</div></details>' +
        '<div class="note">Values are read once per screen refresh, not per sample: ' +
        'a register that changes at audio rate shows whatever it held at that ' +
        'instant. Names in colour come from <code>.rn</code> lines in the editor. ' +
        'ACC64 is shown as its two words; its upper word is read as S.31, which ' +
        'is the S.63 form - after a MACH it is the S3.60 value divided by eight.</div>' +
        '</body></html>';
}

// ---- open / close ---------------------------------------------------------

function simRegsIsOpen() {
    if (regsDock) return regsDock.isConnected && !!regsWin;
    return !!(regsWin && !regsWin.closed);
}

// The last resort, for a browser that offers neither a floating window nor a
// popup -- an embedded browser pane, or a popup blocker that has been told no.
// The viewer is a document like any other, so it goes in an iframe in a panel
// that floats over the page: draggable by its title, resizable from its
// corner, and closed with the cross.
function regsOpenDock() {
    const box = document.createElement('div');
    box.id = 'regsDock';
    box.style.cssText = 'position:fixed;left:16px;top:70px;width:' + REGS_SIZE.width +
        'px;max-width:calc(100vw - 32px);height:' + Math.min(REGS_SIZE.height, window.innerHeight - 100) +
        'px;z-index:10000;display:flex;flex-direction:column;resize:both;overflow:hidden;' +
        'min-width:320px;min-height:200px;border:1px solid rgba(127,127,127,0.5);' +
        'border-radius:6px;box-shadow:0 6px 24px rgba(0,0,0,0.35);background:#2a2a2a;';
    const bar = document.createElement('div');
    bar.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:4px 8px;' +
        'background:#3a3a3a;color:#ddd;font:12px sans-serif;cursor:move;user-select:none;';
    bar.innerHTML = '<span style="flex:1">FXCore Registers - drag to move, corner to resize</span>';
    const x = document.createElement('span');
    x.textContent = '\u2715';
    x.title = 'Close';
    x.style.cssText = 'cursor:pointer;padding:0 4px;';
    x.addEventListener('click', () => simRegsClose());
    x.addEventListener('pointerdown', (e) => e.stopPropagation());
    bar.appendChild(x);
    const frame = document.createElement('iframe');
    frame.style.cssText = 'flex:1;width:100%;border:0;';
    box.append(bar, frame);
    document.body.appendChild(box);

    // Drag by the title. The pointer is captured so the iframe underneath
    // cannot swallow the moves.
    bar.addEventListener('pointerdown', (e) => {
        const r = box.getBoundingClientRect();
        const dx = e.clientX - r.left, dy = e.clientY - r.top;
        bar.setPointerCapture(e.pointerId);
        const move = (m) => {
            box.style.left = Math.max(0, Math.min(window.innerWidth - 60, m.clientX - dx)) + 'px';
            box.style.top = Math.max(0, Math.min(window.innerHeight - 30, m.clientY - dy)) + 'px';
        };
        const up = () => {
            bar.removeEventListener('pointermove', move);
            bar.removeEventListener('pointerup', up);
        };
        bar.addEventListener('pointermove', move);
        bar.addEventListener('pointerup', up);
    });
    regsDock = box;
    return frame.contentWindow;
}

// Floating means a Document Picture-in-Picture window: always on top, no
// address bar. It is the default wherever the browser has it, and the choice
// is remembered across sessions.
const REGS_FLOAT_KEY = 'fxcore_regs_float';
const REGS_SIZE = {width: 640, height: 840};

function regsCanFloat() {
    return typeof window.documentPictureInPicture !== 'undefined' &&
        typeof window.documentPictureInPicture.requestWindow === 'function';
}

function regsWantsFloat() {
    if (!regsCanFloat()) return false;
    try { return localStorage.getItem(REGS_FLOAT_KEY) !== '0'; } catch (e) { return true; }
}

function regsRememberFloat(on) {
    try { localStorage.setItem(REGS_FLOAT_KEY, on ? '1' : '0'); } catch (e) { /* private mode */ }
}

function regsPopup() {
    return window.open('', 'fxcore-registers',
        'width=' + REGS_SIZE.width + ',height=' + REGS_SIZE.height +
        ',resizable=yes,scrollbars=yes');
}

async function simRegsOpen() {
    if (simRegsIsOpen()) {
        regsWin.focus();
        return;
    }
    let win = null;
    let floating = false;
    if (regsWantsFloat()) {
        // Needs a user gesture, and there is only ever one such window in
        // the browser; either refusal falls through to a popup.
        try {
            win = await window.documentPictureInPicture.requestWindow(REGS_SIZE);
            floating = true;
        } catch (e) { win = null; }
    }
    if (!win) win = regsPopup();
    if (!win) win = regsOpenDock();
    regsAttach(win, floating);
}

// Reopen the viewer the other way round. A click inside a floating window
// counts as a gesture on this page too, so a popup can be opened from it;
// a click inside a popup does not carry over, and the floating window cannot
// be requested from there. In that case the choice is remembered, the popup
// closed, and the button in the panel takes over.
async function regsSetFloating(on) {
    regsRememberFloat(on);
    if (on === regsWinFloating || !simRegsIsOpen() || regsDock) return;
    let win = null;
    if (on) {
        try { win = await window.documentPictureInPicture.requestWindow(REGS_SIZE); }
        catch (e) { win = null; }
    } else {
        win = regsPopup();
    }
    const old = regsWin;
    if (win) {
        regsAttach(win, on);
        try { old.close(); } catch (e) { /* already gone */ }
        return;
    }
    simRegsClose();
    if (typeof openFlyout === 'function') openFlyout('sim');
    if (typeof simDebugToolsSet === 'function') simDebugToolsSet(true);
    regsPanelNote('Press <b>Open register viewer</b> to reopen it ' +
        (on ? 'floating' : 'as a window') + '.');
    window.focus();
}

// The note under the panel's button, which carries a message while the
// viewer is closed and reverts when it opens.
let regsPanelNoteHtml = null;
function regsPanelNote(html) {
    const el = document.getElementById('simRegsNote');
    if (!el) return;
    if (html === null) {
        if (regsPanelNoteHtml !== null) el.innerHTML = regsPanelNoteHtml;
        return;
    }
    if (regsPanelNoteHtml === null) regsPanelNoteHtml = el.innerHTML;
    el.innerHTML = html;
}

function regsAttach(win, floating) {
    win.document.open();
    win.document.write(regsDocument());
    win.document.close();
    regsWin = win;
    regsWinFloating = floating;
    regsEls = null;
    regsAliases = null;        // a fresh document has no names painted yet
    regsCollectEls();
    regsApplyTheme();
    regsRefreshAliases();
    regsPanelNote(null);
    // Nothing has been posted before the first Play. A file of zeros is what
    // the core holds then, and reads better than a page of empty cells.
    regsPaint(regsLastState || regsBlankState());
    regsUpdateStatus();

    // There is no reliable close event to hook on a document written into a
    // popup, so it is polled. Half a second is plenty: nothing is lost while
    // the worklet posts to a window that has gone.
    clearInterval(regsPoll);
    regsPoll = setInterval(() => {
        if (!simRegsIsOpen()) simRegsClose();
    }, 500);

    if (!regsThemeObserver && window.MutationObserver) {
        regsThemeObserver = new MutationObserver(regsApplyTheme);
        regsThemeObserver.observe(document.body, {attributes: true, attributeFilter: ['class']});
    }
    if (typeof simSetWatch === 'function') simSetWatch({viewer: true});
}

function regsBlankState() {
    return {creg: new Array(18).fill(0), mreg: new Array(128).fill(0),
            sfr: new Array(49).fill(0), acc64hi: 0, acc64lo: 0, user: [0, 0],
            lfoPhase: [0, 0, 0, 0], addrCounter: 0, sampleCount: 0,
            rate: typeof simGetRate === 'function' ? simGetRate() : 48000,
            trace: null, scopes: [], hasProgram: true};
}

function simRegsClose() {
    clearInterval(regsPoll);
    regsPoll = null;
    if (regsDock) {
        regsDock.remove();
        regsDock = null;
    } else if (regsWin && !regsWin.closed) {
        try { regsWin.close(); } catch (e) { /* already gone */ }
    }
    regsWin = null;
    regsWinFloating = false;
    regsEls = null;
    if (typeof simSetWatch === 'function') simSetWatch({viewer: false});
}

function regsCollectEls() {
    const d = regsWin.document;
    const get = (id) => d.getElementById(id);
    const els = {
        body: d.body, status: get('status'), rate: get('rate'),
        rows: {}, lfo: {}, kv: {}
    };
    const addRow = (key) => {
        els.rows[key] = {row: get('row-' + key), name: get('name-' + key),
            hex: get('hex-' + key), val: get('val-' + key), fill: get('fill-' + key),
            more: get('more-' + key)};
    };
    for (const k of ['c16', 'c17', 'acc64u', 'acc64l']) addRow(k);
    for (const r of REGS_AUDIO.concat(REGS_POTS, REGS_CORE, REGS_MEM)) addRow(r.key);
    for (const id of ['lfo0', 'lfo1', 'lfo2', 'lfo3', 'rmp0', 'rmp1']) {
        els.lfo[id] = {box: get('lfo-' + id), fill: get('fill-' + id),
            f: [0, 1, 2, 3].map(j => get(id + '-' + j))};
    }
    for (const id of ['pin', 'switch', 'user', 'tap', 'samplecnt', 'noise', 'agu']) {
        els.kv[id] = get('kv-' + id);
    }
    els.scopes = get('scopes');
    els.scopeWindow = get('scope-window');
    els.scopeCards = {};
    els.floatCtl = get('float-ctl');
    els.float = get('float');
    els.fmt = get('fmt');
    els.memAll = get('mem-all');
    regsEls = els;

    els.floatCtl.classList.toggle('hidden', !regsCanFloat() || !!regsDock);
    els.float.checked = regsWinFloating;
    els.float.addEventListener('change', () => regsSetFloating(els.float.checked));

    els.fmt.value = regsFormat;
    els.fmt.addEventListener('change', () => {
        regsSetFormat(els.fmt.value);
    });
    els.memAll.checked = regsMemAll;
    els.memAll.addEventListener('click', (e) => e.stopPropagation());
    els.memAll.addEventListener('change', () => {
        regsMemAll = els.memAll.checked;
        regsPaint(regsLastState || regsBlankState());
    });

    // Register names toggle a scope, where a scope would mean something.
    for (const key of Object.keys(els.rows)) {
        const r = els.rows[key];
        if (!r.name || !regsScopable(key)) continue;
        r.name.addEventListener('click', () => regsToggleScope(key));
    }
    els.scopeWindow.value = String(simWatch.window);
    els.scopeWindow.addEventListener('change', () => {
        simSetWatch({window: +els.scopeWindow.value});
    });
    regsSyncScopeCards();
}

// ---- scopes ---------------------------------------------------------------

function regsToggleScope(key) {
    const list = simWatch.scopes.slice();
    const at = list.indexOf(key);
    if (at >= 0) list.splice(at, 1);
    else if (list.length < REGS_MAX_SCOPES) list.push(key);
    else return;
    simSetWatch({scopes: list});
    regsSyncScopeCards();
}

// One card per watched register, in watch order. Cards are kept across a
// resync so a canvas is not thrown away and recreated on every click.
function regsSyncScopeCards() {
    if (!regsEls || !simRegsIsOpen()) return;
    const els = regsEls;
    const d = regsWin.document;
    const want = simWatch.scopes;
    for (const key of Object.keys(els.scopeCards)) {
        if (!want.includes(key)) {
            els.scopeCards[key].card.remove();
            delete els.scopeCards[key];
        }
    }
    for (const key of want) {
        if (!els.scopeCards[key]) {
            const card = d.createElement('div');
            card.className = 'scope';
            card.innerHTML = '<div class="scope-head"><span class="name"></span>' +
                '<span class="v"></span><span class="x" title="Remove">✕</span></div>' +
                '<canvas></canvas>';
            card.querySelector('.x').addEventListener('click', () => regsToggleScope(key));
            const canvas = card.querySelector('canvas');
            els.scopeCards[key] = {card, canvas, name: card.querySelector('.name'),
                v: card.querySelector('.v')};
        }
        els.scopes.appendChild(els.scopeCards[key].card);
    }
    for (const key of Object.keys(els.rows)) {
        const r = els.rows[key];
        if (r.row) r.row.classList.toggle('scoped', want.includes(key));
    }
    els.scopes.hidden = want.length === 0;
    regsNameScopeCards();
}

function regsNameScopeCards() {
    if (!regsEls) return;
    const aliases = regsAliasMap || {};
    for (const key of Object.keys(regsEls.scopeCards)) {
        const names = aliases[key];
        regsSet(regsEls.scopeCards[key].name,
            regsRegName(key) + (names ? '  ' + names.join(', ') : ''));
    }
}

function regsPaintScopes(s) {
    if (!regsEls || !s.scopes) return;
    const dark = regsEls.body.classList.contains('dark');
    for (const sc of s.scopes) {
        const card = regsEls.scopeCards[sc.key];
        if (!card) continue;
        const canvas = card.canvas;
        const w = canvas.clientWidth || 300;
        const h = canvas.clientHeight || 72;
        const dpr = regsWin.devicePixelRatio || 1;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
        }
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const n = sc.min.length;
        const y = (v) => (1 - Math.max(-1, Math.min(1, v))) * (h - 2) / 2 + 1;
        // Zero line and the full-scale bounds.
        ctx.strokeStyle = dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y(0) + 0.5); ctx.lineTo(w, y(0) + 0.5);
        ctx.stroke();
        // The envelope: the band between each bin's min and max.
        ctx.fillStyle = dark ? 'rgba(91,156,240,0.85)' : 'rgba(59,125,216,0.85)';
        ctx.beginPath();
        for (let i = 0; i < n; i++) ctx.lineTo(i * w / (n - 1), y(sc.max[i]));
        for (let i = n - 1; i >= 0; i--) ctx.lineTo(i * w / (n - 1), y(sc.min[i]));
        ctx.closePath();
        ctx.fill();
        // A band thinner than a pixel would vanish, so a line is drawn along it too.
        ctx.strokeStyle = ctx.fillStyle;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
            const py = y((sc.min[i] + sc.max[i]) / 2);
            if (i === 0) ctx.moveTo(0, py); else ctx.lineTo(i * w / (n - 1), py);
        }
        ctx.stroke();
        const last = n - 1;
        regsSet(card.v, regsText(sc.min[last] * REGS_ONE) + ' .. ' +
            regsText(sc.max[last] * REGS_ONE));
    }
}

function regsApplyTheme() {
    if (!regsEls) return;
    const dark = document.body.classList.contains('dark-mode');
    regsEls.body.classList.toggle('dark', dark);
}

// ---- formatting -----------------------------------------------------------

function regsHex(v) {
    return '0x' + ((Math.round(v) | 0) >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

// A word as a fraction of full scale. Six places is what the eye can use on a
// fixed-width column, and keeps it from twitching as values pass through zero.
function regsFloat(v) {
    const f = v / REGS_ONE;
    return (f < 0 ? '' : '+') + f.toFixed(6);
}

// A word the way the viewer is set to read it. The trace in the editor reads
// the same setting, so a counter is a counter in both places.
function regsText(v) {
    return regsFormat === 'int' ? String(Math.round(v) | 0) : regsFloat(v);
}

function regsSetFormat(fmt) {
    regsFormat = fmt === 'int' ? 'int' : 'frac';
    try { localStorage.setItem(REGS_FORMAT_KEY, regsFormat); } catch (e) { /* private mode */ }
    if (regsEls && regsEls.fmt) regsEls.fmt.value = regsFormat;
    if (simRegsIsOpen()) regsPaint(regsLastState || regsBlankState());
    if (typeof simTraceRefresh === 'function') simTraceRefresh();
}

try {
    if (localStorage.getItem(REGS_FORMAT_KEY) === 'int') regsFormat = 'int';
} catch (e) { /* private mode */ }

function regsSet(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
}

// Bipolar bar: zero in the middle, negative values grow leftwards.
function regsBar(fill, f, unipolar) {
    if (!fill) return;
    const c = Math.max(-1, Math.min(1, f));
    if (unipolar) {
        fill.style.left = '0';
        fill.style.width = (Math.max(0, c) * 100).toFixed(1) + '%';
        fill.classList.remove('neg');
        return;
    }
    const w = Math.abs(c) * 50;
    fill.style.left = (c < 0 ? 50 - w : 50).toFixed(1) + '%';
    fill.style.width = w.toFixed(1) + '%';
    fill.classList.toggle('neg', c < 0);
}

function regsPaintRow(r, v, unipolar) {
    if (!r) return;
    regsSet(r.hex, regsHex(v));
    regsSet(r.val, regsText(v));
    regsBar(r.fill, v / REGS_ONE, unipolar);
}

function regsHz(n) {
    const a = Math.abs(n);
    if (a >= 100) return n.toFixed(0) + ' Hz';
    if (a >= 10) return n.toFixed(1) + ' Hz';
    return n.toFixed(2) + ' Hz';
}

function regsFlagText(v) {
    const names = [];
    for (let bit = 1; bit < 16; bit++) {
        if ((v >>> bit) & 1 && REGS_FLAG_NAMES[bit]) names.push(REGS_FLAG_NAMES[bit]);
    }
    // TAPDB is high while the pin is up, so it is the pin being down that
    // is worth saying.
    if (!(v & 1)) names.unshift('TAP down');
    return names.length ? names.join('  ') : '';
}

function regsSwitchText(v) {
    const lvl = [], push = [], rel = [];
    for (let i = 0; i < 5; i++) {
        lvl.push((v >>> i) & 1);
        if ((v >>> (10 + i)) & 1) push.push('SW' + i);
        if ((v >>> (5 + i)) & 1) rel.push('SW' + i);
    }
    return 'levels ' + lvl.join('') + '  ENABLE ' + ((v >>> 15) & 1) +
        (push.length ? '  pushed ' + push.join(',') : '') +
        (rel.length ? '  released ' + rel.join(',') : '');
}

// ---- painting a snapshot --------------------------------------------------

function regsPaint(s) {
    if (!regsEls || !simRegsIsOpen()) return;
    const els = regsEls;
    const rate = s.rate || (typeof simGetRate === 'function' ? simGetRate() : 48000);
    const sfr = s.sfr;

    regsPaintRow(els.rows.c16, s.creg[16]);
    regsPaintRow(els.rows.acc64u, s.acc64hi);
    {
        // The lower word is the part of the accumulator below the upper one,
        // so as a number it is the fraction of one upper step.
        const lo = s.acc64lo >>> 0;
        const r = els.rows.acc64l;
        regsSet(r.hex, regsHex(lo));
        regsSet(r.val, regsFormat === 'int' ? String(lo) : '.' + (lo / 4294967296).toFixed(6).slice(2));
        regsBar(r.fill, lo / 4294967296, true);
    }
    {
        const r = els.rows.c17;
        const v = s.creg[17];
        regsSet(r.hex, regsHex(v));
        regsSet(r.val, regsFormat === 'int' ? String(v) : '');
        regsSet(r.more, regsFlagText(v));
        if (r.fill) r.fill.parentNode.style.display = 'none';
    }
    for (const r of REGS_AUDIO) regsPaintRow(els.rows[r.key], regsWordOf(s, r.key));
    for (const r of REGS_POTS) regsPaintRow(els.rows[r.key], regsWordOf(s, r.key), true);
    for (const r of REGS_CORE) regsPaintRow(els.rows[r.key], s.creg[+r.key.slice(1)]);
    const aliases = regsAliasMap || {};
    for (const r of REGS_MEM) {
        const v = s.mreg[+r.key.slice(1)];
        const row = els.rows[r.key];
        regsPaintRow(row, v);
        // Most programs use a handful of the 128, and a wall of zeros hides
        // the ones that matter.
        if (row.row) row.row.classList.toggle('hidden', !regsMemAll && v === 0 && !aliases[r.key]);
    }

    // LFOs: LFOx_F is the per-sample phase step scaled by 2^31 - 1 (Datasheet
    // block 9), so f = F / (2^31 - 1) * Fs / 2 pi.
    for (let n = 0; n < 4; n++) {
        const L = els.lfo['lfo' + n];
        const f = sfr[28 + n];
        regsSet(L.f[0], regsHz(f / 2147483647 * rate / (2 * Math.PI)));
        regsSet(L.f[1], regsText(sfr[34 + 2 * n]));
        regsSet(L.f[2], regsText(sfr[35 + 2 * n]));
        let turn = (s.lfoPhase[n] / (2 * Math.PI)) % 1;
        if (turn < 0) turn += 1;
        regsSet(L.f[3], (turn * 360).toFixed(0) + '°');
        regsBar(L.fill, sfr[34 + 2 * n] / REGS_ONE, false);
    }
    // Ramps: RAMPx_F is the per-sample step of a 32-bit accumulator that
    // wraps, so f = F / 2^32 * Fs, and a negative step runs it the other way.
    for (let n = 0; n < 2; n++) {
        const L = els.lfo['rmp' + n];
        const f = sfr[32 + n];
        const acc = sfr[42 + n];
        regsSet(L.f[0], regsHz(f / 4294967296 * rate));
        regsSet(L.f[1], regsText(acc));
        const pos = (acc >>> 0) / 4294967296;
        regsSet(L.f[2], (pos * 100).toFixed(1) + '%');
        regsBar(L.fill, pos, true);
    }

    const kv = els.kv;
    const pin = sfr[8] & 0x7F;
    regsSet(kv.pin, '0b' + pin.toString(2).padStart(7, '0') + '  (TAP ENABLE SW4..SW0, 1 = up)');
    regsSet(kv.switch, regsSwitchText(sfr[9]));
    regsSet(kv.user, 'USER0 ' + s.user[0] + '   USER1 ' + s.user[1]);
    const tap = sfr[45] >>> 0;
    regsSet(kv.tap, tap ? tap + ' smp  (' + (tap / rate).toFixed(3) + ' s)' : 'none yet');
    regsSet(kv.samplecnt, (s.sampleCount >>> 0).toLocaleString());
    regsSet(kv.noise, regsText(sfr[47]));
    regsSet(kv.agu, String(s.addrCounter));

    regsSet(els.rate, (rate / 1000).toFixed(3).replace(/\.?0+$/, '') + ' kHz');
    regsPaintScopes(s);
    regsUpdateStatus();
}

function regsUpdateStatus() {
    if (!regsEls || !simRegsIsOpen()) return;
    const running = typeof simIsRunning === 'function' && simIsRunning();
    const halted = typeof simDebugIsHalted === 'function' && simDebugIsHalted();
    const hasProg = !regsLastState || regsLastState.hasProgram;
    regsEls.body.classList.toggle('stopped', !running && !halted);
    let text, cls;
    if (halted) { text = 'Halted - ' + simDebugWhere(); cls = 'warn'; }
    else if (running && hasProg) { text = 'Running'; cls = 'running'; }
    else if (running) { text = 'No program loaded'; cls = 'warn'; }
    else { text = regsLastState ? 'Stopped' : 'Not running'; cls = ''; }
    regsSet(regsEls.status, text);
    regsEls.status.className = cls;
}

// The engine posts these at about 20 Hz while a viewer is open, and once on
// every load, reset and watch, so the window has something to show when the
// simulator is stopped.
function simRegsOnState(s) {
    regsLastState = s;
    regsPaint(s);
}

// Play and Stop reach here through simUpdateTransport.
function simRegsOnTransport() {
    regsUpdateStatus();
}

// ---- register names from the source ---------------------------------------

// The target of an `.rn` line: a core register, a memory register or an SFR,
// by name or by number-free spelling, as a key -- or null if it is something
// else, such as another alias that goes nowhere.
function regsResolveName(name) {
    const u = name.toUpperCase();
    let m = /^R(\d+)$/.exec(u);
    if (m) return +m[1] < 16 ? 'c' + m[1] : null;
    if (u === 'ACC32') return 'c16';
    if (u === 'FLAGS') return 'c17';
    m = /^MR(\d+)$/.exec(u);
    if (m) return +m[1] < 128 ? 'm' + m[1] : null;
    const at = REGS_SFR_NAMES.indexOf(u);
    return at >= 0 ? 's' + at : null;
}

// Read the .rn lines out of the editor so R5 can be shown as whatever the
// program calls it. `.rn alias register`, with the optional `.rn.x` suffix the
// assembler allows, and an alias of an alias resolves through the chain, so
// `.rn fb r5` then `.rn fb_l fb` names R5 twice. Only aliases that land on a
// register are kept.
function regsParseAliases(src) {
    const byName = {};
    const order = [];
    if (src) {
        let inBlock = false;
        for (const raw of src.split(/\r?\n/)) {
            // The assembler's own comment rules: ; and // to the end of the
            // line, and /* */ blocks.
            let line = raw;
            let code = '';
            while (line.length) {
                if (inBlock) {
                    const end = line.indexOf('*/');
                    if (end < 0) { line = ''; break; }
                    line = line.slice(end + 2);
                    inBlock = false;
                    continue;
                }
                const semi = line.indexOf(';');
                const dbl = line.indexOf('//');
                const blk = line.indexOf('/*');
                const cuts = [semi, dbl].filter(i => i >= 0);
                const lineCut = cuts.length ? Math.min.apply(null, cuts) : -1;
                if (blk >= 0 && (lineCut < 0 || blk < lineCut)) {
                    code += line.slice(0, blk) + ' ';
                    line = line.slice(blk + 2);
                    inBlock = true;
                    continue;
                }
                code += lineCut >= 0 ? line.slice(0, lineCut) : line;
                break;
            }
            const m = /^\s*\.rn(?:\.[a-z])?\s+([A-Za-z_][\w!#\-]*)\s+([A-Za-z_][\w!#\-]*)/i.exec(code);
            if (!m) continue;
            byName[m[1].toUpperCase()] = m[2];
            order.push(m[1]);
        }
    }
    const resolve = (name, depth) => {
        if (depth > 8) return null;
        const direct = regsResolveName(name);
        if (direct) return direct;
        const next = byName[name.toUpperCase()];
        return next === undefined ? null : resolve(next, depth + 1);
    };
    const out = {};
    for (const name of order) {
        const key = resolve(byName[name.toUpperCase()], 0);
        if (!key) continue;
        const list = (out[key] = out[key] || []);
        if (!list.includes(name)) list.push(name);
    }
    return out;
}

function regsRefreshAliases() {
    if (!regsEls || !simRegsIsOpen()) return;
    let src = '';
    try {
        if (typeof editor !== 'undefined' && editor && editor.getValue) src = editor.getValue();
    } catch (e) { /* editor not up yet */ }
    const aliases = regsParseAliases(src);
    const key = JSON.stringify(aliases);
    if (regsAliases === key) return;
    regsAliases = key;
    regsAliasMap = aliases;

    for (const r of REGS_ALL_ROWS) {
        const row = regsEls.rows[r.key];
        if (!row || !row.name) continue;
        const names = aliases[r.key];
        row.name.classList.toggle('aliased', !!names);
        row.name.innerHTML = '<span class="hw">' + regsEscape(r.name) + '</span>' +
            (names ? '<span class="alias">' + names.map(regsEscape).join(', ') + '</span>' : '');
        if (row.row) row.row.title = names ? r.name + ': ' + names.join(', ') : r.name;
    }
    regsNameScopeCards();
    // A named memory register is shown even when it holds zero.
    if (regsLastState) regsPaint(regsLastState);
}

function regsEscape(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---- wiring ---------------------------------------------------------------

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
    // Follow the editor for the names, on the same kind of debounce the pot
    // labels use. Monaco may not be up yet, so poll briefly for it.
    let tries = 0;
    const attach = setInterval(() => {
        if (typeof editor !== 'undefined' && editor && editor.onDidChangeModelContent) {
            clearInterval(attach);
            let timer = null;
            editor.onDidChangeModelContent(() => {
                clearTimeout(timer);
                timer = setTimeout(regsRefreshAliases, 300);
            });
        } else if (++tries > 40) {
            clearInterval(attach);
        }
    }, 250);
});

// A viewer left open after the page that feeds it has gone would sit there
// showing stale numbers with nothing to say they are stale.
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => {
    if (simRegsIsOpen()) simRegsClose();
});

// The name resolution and the alias reader are pure, so they are exported for
// the headless tests.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { regsParseAliases, regsResolveName, regsRegName, regsScopable,
        regsFlagText, regsSwitchText, REGS_SFR_NAMES };
}
