// FXCore Simulator -- MIDI control
//
// Drives the simulator's on-screen controls from a MIDI controller attached to
// this computer, using the Web MIDI API. Nothing here touches the audio graph
// or the core: a CC moves the same pot state a slider moves, so a program
// cannot tell the difference between a fader and a mouse.
//
// The map is fixed, matching the Disaster Area control-change assignments and
// extended across the FXCore's six pots and seven switches:
//
//     CC50-CC55    POT0-POT5
//     CC93         TAP tempo -- one tap of the TAP pin
//     CC102        ENABLE, 0-63 bypassed, 64-127 engaged
//     CC103-CC108  hold  SW0 SW1 SW2 SW3 SW4 TAP
//     CC109-CC114  toggle SW0 SW1 SW2 SW3 SW4 TAP
//     CC115-CC119  tap   SW0 SW1 SW2 SW3 SW4
//
// Each switch has all three of the things a foot does to one: hold it down for
// as long as the pedal is down (a gate), toggle it and leave it there (a
// latch), or tap it (a press and release the program sees as one push edge).
//
// The switch CCs sit in 102-119, the block the MIDI spec leaves undefined, so
// none of them can collide with a defined controller. CC93 is the exception,
// and is the tap-tempo assignment the pedals already use.
//
// The pedal itself has no MIDI input. This is the simulator only.

const MIDI_POTS = 6;

// SW0-SW4 and TAP, in the order the switch CC ranges run.
const MIDI_SWITCHES = ['simSw0', 'simSw1', 'simSw2', 'simSw3', 'simSw4', 'simTap'];
const MIDI_SWITCH_NAMES = ['SW0', 'SW1', 'SW2', 'SW3', 'SW4', 'TAP'];

// How long a tapped switch stays down. The part debounces a switch over
// SWDBRLD samples -- 480 by default, which is 10 ms at 48 kHz and 40 ms at
// 12 kHz -- so a tap has to outlast that at every sample rate to register at
// all, while staying well short of the 750 ms sticky-hold threshold.
const MIDI_TAP_MS = 120;

const MIDI_MAP = {
    50: 'pot0',
    51: 'pot1',
    52: 'pot2',
    53: 'pot3',
    54: 'pot4',
    55: 'pot5',
    93: 'tap:5',            // the TAP pin, by its own long-standing CC
    102: 'bypass'
};

MIDI_SWITCHES.forEach((id, i) => {
    MIDI_MAP[103 + i] = 'hold:' + i;
    MIDI_MAP[109 + i] = 'toggle:' + i;
    if (i < 5) MIDI_MAP[115 + i] = 'tap:' + i;   // TAP's own tap is CC93
});
const MIDI_PREFS_KEY = 'fxcore_sim_midi';

let midiAccess = null;
let midiInputs = [];           // MIDIInput objects, in menu order
let midiDeviceName = 'all';    // remembered by name -- ids are not stable
let midiChannel = 0;           // 0 = omni, else 1-16

// A fader sweep can arrive at roughly a message per millisecond, and each
// message would otherwise cost three DOM writes. Values reach the core
// immediately -- audio must not wait on the compositor, and a hidden tab stops
// painting entirely while its audio keeps running -- but the redraws are
// batched to one frame. A backgrounded tab therefore still responds to the
// controller, and catches its display up when it is looked at again.
let midiDirty = new Array(MIDI_POTS).fill(false);
let midiPendingText = null;
let midiFrame = 0;
let midiFlashTimer = null;

// ---- support and connection ----------------------------------------------

function midiSupported() {
    return typeof navigator !== 'undefined' &&
        typeof navigator.requestMIDIAccess === 'function';
}

async function midiConnect() {
    if (!midiSupported()) {
        midiStatus('No Web MIDI - use Chrome, Edge or Firefox', 'error');
        return;
    }
    if (midiAccess) {
        midiRefreshDevices();
        return;
    }

    midiStatus('Requesting MIDI access...', '');
    try {
        // sysex is not needed for control changes, and asking for it turns a
        // silent grant into a scarier permission prompt.
        midiAccess = await navigator.requestMIDIAccess({sysex: false});
    } catch (e) {
        midiAccess = null;
        midiStatus('MIDI access denied - allow it and retry', 'error');
        midiSetConnected(false);
        return;
    }

    midiAccess.onstatechange = () => midiRefreshDevices();
    midiSetConnected(true);
    midiRefreshDevices();
}

// Rebuild the device menu and re-attach the handler. Runs on connect and on
// every plug or unplug, so a controller powered on after the page loaded still
// lands on the remembered selection.
function midiRefreshDevices() {
    if (!midiAccess) return;

    midiInputs = [];
    midiAccess.inputs.forEach((input) => midiInputs.push(input));

    const sel = document.getElementById('midiDevice');
    if (sel) {
        const previous = midiDeviceName;
        sel.innerHTML = '';

        const all = document.createElement('option');
        all.value = 'all';
        all.textContent = 'All inputs';
        sel.appendChild(all);

        for (const input of midiInputs) {
            const opt = document.createElement('option');
            opt.value = input.name || input.id;
            opt.textContent = input.name || input.id;
            sel.appendChild(opt);
        }

        // Keep the remembered device selected even while it is unplugged, so
        // it reattaches by itself when it comes back.
        if (previous !== 'all' && !midiInputs.some(i => (i.name || i.id) === previous)) {
            const ghost = document.createElement('option');
            ghost.value = previous;
            ghost.textContent = previous + ' (not connected)';
            sel.appendChild(ghost);
        }
        sel.value = previous;
    }

    midiAttach();

    if (!midiInputs.length) {
        midiStatus('No inputs found - connect a controller', 'warn');
    } else if (midiDeviceName === 'all') {
        midiStatus('Listening to ' + midiInputs.length +
            (midiInputs.length === 1 ? ' input' : ' inputs'), 'ok');
    } else if (midiInputs.some(i => (i.name || i.id) === midiDeviceName)) {
        midiStatus('Listening to ' + midiDeviceName, 'ok');
    } else {
        midiStatus(midiDeviceName + ' is not connected', 'warn');
    }
}

// Listen on the chosen input, or on all of them. Handlers are cleared first so
// a device dropped from the selection stops being heard.
function midiAttach() {
    for (const input of midiInputs) {
        const name = input.name || input.id;
        const wanted = midiDeviceName === 'all' || name === midiDeviceName;
        input.onmidimessage = wanted ? (e) => midiHandleMessage(e.data) : null;
    }
}

// ---- message handling -----------------------------------------------------

// Act on one raw MIDI message. Exposed on window so it can be driven from a
// test without a controller attached.
function midiHandleMessage(data) {
    if (!data || data.length < 3) return;

    const status = data[0];
    if (status < 0x80) return;          // running status: not delivered by Web MIDI
    if (status >= 0xF0) return;         // clock, active sensing, sysex
    if ((status & 0xF0) !== 0xB0) return;

    const channel = (status & 0x0F) + 1;
    if (midiChannel !== 0 && channel !== midiChannel) return;

    const cc = data[1];
    const value = data[2];
    const target = MIDI_MAP[cc];
    if (!target) return;

    if (target === 'bypass') {
        midiApplyBypass(value);
        midiNote('CC' + cc + ' → ENABLE · ' + (value >= 64 ? 'on' : 'bypassed'));
        return;
    }

    if (target.indexOf(':') > 0) {
        midiApplySwitch(target, value, cc);
        return;
    }

    const pot = +target.slice(3);
    if (typeof simSetPot === 'function') {
        simSetPot(pot, value / 127, {from: 'midi', defer: true});
    }
    midiDirty[pot] = true;
    midiNote('CC' + cc + ' → POT' + pot + ' · ' +
        Math.round(value / 127 * 100) + '%');
    midiSchedule();
}

// CC102 carries the engage state: 0-63 is bypassed and 64-127 is engaged. The
// ENABLE switch asks the same question the same way round -- lit is engaged --
// so the high half is simply ENABLE on.
function midiApplyBypass(value) {
    if (typeof simSetEnable === 'function') simSetEnable(value >= 64);
}

// The three ways of working a switch. A CC has no press and release of its
// own, so the value's high half stands for "down": hold follows it, toggle
// acts on the way down and ignores the way up, and tap makes its own release.
function midiApplySwitch(target, value, cc) {
    const parts = target.split(':');
    const kind = parts[0];
    const i = +parts[1];
    const id = MIDI_SWITCHES[i];
    const name = MIDI_SWITCH_NAMES[i];
    const down = value >= 64;

    if (kind === 'hold') {
        if (down) midiPress(id); else midiRelease(id);
        midiNote('CC' + cc + ' → ' + name + ' hold · ' + (down ? 'down' : 'up'));
        return;
    }

    if (kind === 'toggle') {
        if (!down) return;                      // the release of a footswitch
        if (typeof simSwToggle === 'function') simSwToggle(id);
        const on = typeof simSwOn === 'function' ? simSwOn(id) : null;
        midiNote('CC' + cc + ' → ' + name + ' toggle' +
            (on === null ? '' : ' · ' + (on ? 'on' : 'off')));
        return;
    }

    // tap
    if (!down) return;
    midiTap(id);
    midiNote('CC' + cc + ' → ' + name + ' tap');
}

// A tap is a press the page lets go of by itself. Tapping again while one is
// still down ends it first, so two taps are always two push edges -- which is
// the whole of what tap tempo measures.
const midiTapTimers = {};

function midiTap(id) {
    if (midiTapTimers[id]) {
        clearTimeout(midiTapTimers[id]);
        midiTapTimers[id] = 0;
        midiRelease(id);
    }
    midiPress(id);
    midiTapTimers[id] = setTimeout(() => {
        midiTapTimers[id] = 0;
        midiRelease(id);
    }, MIDI_TAP_MS);
}

function midiPress(id) {
    // The 'midi' source keeps the page-wide mouseup sweep from letting go of a
    // switch a controller is holding down.
    if (typeof simSwPress === 'function') simSwPress(id, 'midi');
}

function midiRelease(id) {
    if (typeof simSwRelease === 'function') simSwRelease(id);
}

function midiSchedule() {
    if (midiFrame || midiHidden()) return;
    const raf = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
    midiFrame = raf(() => {
        midiFrame = 0;
        midiFlushDisplay();
    });
}

// A hidden tab never paints, so a frame asked for there is not delivered until
// it is looked at again. Do not ask for one: mark the work and run it on the
// way back, otherwise the pending flag latches and the display stops updating
// for the rest of the session.
function midiHidden() {
    return typeof document !== 'undefined' && document.hidden;
}

function midiFlushDisplay() {
    for (let i = 0; i < MIDI_POTS; i++) {
        if (!midiDirty[i]) continue;
        midiDirty[i] = false;
        if (typeof simRefreshPotDisplay === 'function') {
            simRefreshPotDisplay(i, 'midi');
        }
    }
    midiFlushNote();
}

// ---- display --------------------------------------------------------------

// One line carries both what the connection is doing and the last message that
// arrived. They never need to be read at the same time: before any traffic the
// connection state is the interesting thing, and once messages are flowing it
// is self-evidently connected.
function midiStatus(msg, kind) {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('midiLine');
    if (!el) return;
    el.textContent = msg;
    // The line is one row in a narrow panel, so anything long is clipped with
    // an ellipsis. Keep the whole text reachable on hover.
    el.title = msg;
    el.className = 'sim-status' + (kind ? ' sim-status-' + kind : '');
}

function midiSetConnected(on) {
    if (typeof document === 'undefined') return;
    const btn = document.getElementById('midiConnectBtn');
    if (btn) btn.textContent = on ? 'Rescan Devices' : 'Enable MIDI';
    const sel = document.getElementById('midiDevice');
    if (sel) sel.disabled = !on;
}

// The last message, plus a blink of the activity dot. Pot messages go through
// the frame coalescer; a bypass press is rare enough to draw at once.
function midiNote(text) {
    midiPendingText = text;
    if (midiFrame || midiHidden()) return;
    midiFlushNote();
}

function midiFlushNote() {
    if (midiPendingText === null) return;
    midiStatus(midiPendingText, 'log');
    midiPendingText = null;

    if (typeof document === 'undefined') return;
    const dot = document.getElementById('midiActivity');
    if (dot) {
        dot.classList.add('midi-activity-on');
        clearTimeout(midiFlashTimer);
        midiFlashTimer = setTimeout(() => dot.classList.remove('midi-activity-on'), 120);
    }
}

// ---- options and persistence ----------------------------------------------

function midiOnDeviceChange() {
    const sel = document.getElementById('midiDevice');
    midiDeviceName = sel ? sel.value : 'all';
    midiAttach();
    midiSavePrefs();
    if (midiDeviceName === 'all') midiStatus('Listening to all inputs', 'ok');
    else midiStatus('Listening to ' + midiDeviceName, 'ok');
}

function midiOnChannelChange() {
    const sel = document.getElementById('midiChannel');
    midiChannel = sel ? parseInt(sel.value, 10) || 0 : 0;
    midiSavePrefs();
}

function midiSavePrefs() {
    try {
        localStorage.setItem(MIDI_PREFS_KEY, JSON.stringify({
            device: midiDeviceName,
            channel: midiChannel
        }));
    } catch (e) { /* private browsing, or storage full */ }
}

function midiLoadPrefs() {
    let prefs = null;
    try {
        const saved = localStorage.getItem(MIDI_PREFS_KEY);
        if (saved) prefs = JSON.parse(saved);
    } catch (e) { /* fall through to defaults */ }
    if (!prefs || typeof prefs !== 'object') return;

    if (typeof prefs.device === 'string') midiDeviceName = prefs.device;
    if (typeof prefs.channel === 'number') midiChannel = prefs.channel;

    const chan = document.getElementById('midiChannel');
    if (chan) chan.value = String(midiChannel);
}

// ---- startup --------------------------------------------------------------

if (typeof document !== 'undefined') {
    // Catch the display up the moment the tab is looked at again.
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) midiFlushDisplay();
    });

    document.addEventListener('DOMContentLoaded', () => {
        midiLoadPrefs();

        const section = document.getElementById('midiSection');
        if (!midiSupported()) {
            // Safari has no Web MIDI at all. Leave the section visible but
            // inert rather than silently dropping a documented feature.
            midiSetConnected(false);
            const btn = document.getElementById('midiConnectBtn');
            if (btn) btn.disabled = true;
            midiStatus('No Web MIDI - use Chrome, Edge or Firefox', 'warn');
            if (section) section.classList.add('sim-unavailable');
            return;
        }

        midiSetConnected(false);
        midiStatus('Not connected', '');

        // Reconnect without a click if this origin already holds the
        // permission. Asking cold would raise a prompt with no user gesture
        // behind it, which Chrome may refuse outright.
        if (navigator.permissions && navigator.permissions.query) {
            navigator.permissions.query({name: 'midi', sysex: false}).then((s) => {
                if (s.state === 'granted') midiConnect();
            }).catch(() => { /* permission name unknown in this browser */ });
        }
    });
}

// Test hook: lets a headless run inject messages without a controller.
if (typeof window !== 'undefined') window.midiHandleMessage = midiHandleMessage;

// The message decoder is pure apart from the controls it drives, so it is
// exported for the headless tests.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        midiHandleMessage,
        midiSetChannel: (c) => { midiChannel = c; },
        midiFlushDisplay,
        MIDI_MAP,
        MIDI_TAP_MS
    };
}
