// MIDI control: the CC map, the channel filter, and the traffic that must be
// ignored. The decoder is driven directly, so no controller is needed.
//
//   node assembler/sim-test/test-midi.js

// A DOM stub, installed before either module is loaded. Everything the panel
// draws goes through getElementById, so returning null for every id makes the
// display a no-op and leaves the control logic to be tested on its own.
const listeners = {};
global.document = {
    hidden: false,
    getElementById: () => null,
    createElement: () => ({}),
    addEventListener: (name, fn) => { listeners[name] = fn; }
};
global.window = {};
global.navigator = {};

const sim = require('../fxcore-sim.js');
const midi = require('../fxcore-midi.js');

// The two files are separate <script>s in the browser, sharing the global
// scope. Node gives each its own, so wire the pieces MIDI drives by hand.
const potSets = [];
global.simSetPot = (i, v, opts) => potSets.push({i, v, opts});
global.simRefreshPotDisplay = (i) => refreshed.push(i);
global.simSetEnable = (on) => sim.simSetEnable(on);
global.simSwToggle = (id) => sim.simSwToggle(id);
global.simSwPress = (id, from) => sim.simSwPress(id, from);
global.simSwRelease = (id) => sim.simSwRelease(id);
global.simSwOn = (id) => sim.simSwOn(id);
const refreshed = [];

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, detail) {
    if (cond) pass++; else { fail++; failures.push(name + (detail ? '  ' + detail : '')); }
}
function eq(name, got, want) {
    ok(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}
function close(name, got, want, tol) {
    ok(name, Math.abs(got - want) <= (tol || 1e-9), `got ${got} want ${want}`);
}

function send(bytes) { midi.midiHandleMessage(bytes); }
function lastPot() { return potSets[potSets.length - 1]; }
function enabled() { return sim.simSwOn('simEnable'); }

// =====================================================================
console.log('--- the pot map ---');
{
    send([0xB0, 50, 127]);
    eq('CC50 is POT0', lastPot().i, 0);
    close('full scale is 1.0', lastPot().v, 1);

    send([0xB0, 55, 0]);
    eq('CC55 is POT5', lastPot().i, 5);
    close('zero is 0.0', lastPot().v, 0);

    // 100 slider steps would round 3 and 4 together; 127 steps must not.
    send([0xB0, 52, 3]);
    const a = lastPot().v;
    send([0xB0, 52, 4]);
    ok('every one of the 128 steps is distinct', a !== lastPot().v,
        `${a} vs ${lastPot().v}`);

    send([0xB0, 53, 64]);
    eq('CC53 is POT3', lastPot().i, 3);
    close('the middle of the range', lastPot().v, 64 / 127, 1e-9);

    ok('the display is left for the frame to catch up',
        lastPot().opts && lastPot().opts.defer === true);
    eq('the source is named so the slider is not fought',
        lastPot().opts.from, 'midi');
}

console.log('--- CC102, the ENABLE switch ---');
{
    send([0xB0, 102, 0]);
    eq('0 bypasses', enabled(), false);
    send([0xB0, 102, 127]);
    eq('127 engages', enabled(), true);
    send([0xB0, 102, 63]);
    eq('63 is still the bypassed half', enabled(), false);
    send([0xB0, 102, 64]);
    eq('64 is already the engaged half', enabled(), true);

    // Absolute, not a flip: the same value twice must not toggle back.
    send([0xB0, 102, 127]);
    eq('a repeated value changes nothing', enabled(), true);
}

console.log('--- the channel filter ---');
{
    const before = potSets.length;
    midi.midiSetChannel(3);
    send([0xB0, 50, 100]);              // channel 1
    eq('another channel is ignored', potSets.length, before);
    send([0xB2, 50, 100]);              // channel 3
    eq('the chosen channel is taken', potSets.length, before + 1);
    midi.midiSetChannel(0);
    send([0xB5, 50, 20]);               // channel 6
    eq('omni takes any channel', potSets.length, before + 2);
}

console.log('--- traffic that must be ignored ---');
{
    const before = potSets.length;
    const wasEnabled = enabled();
    send([0xF8]);                       // clock
    send([0xFE]);                       // active sensing
    send([0x90, 60, 100]);              // note on
    send([0xB0, 7, 100]);               // an unmapped CC
    send([0xB0, 50]);                   // truncated
    send([50, 100]);                    // running status, never delivered
    send(null);
    eq('nothing moved a pot', potSets.length, before);
    eq('nothing moved ENABLE', enabled(), wasEnabled);
}

console.log('--- deferred display ---');
{
    refreshed.length = 0;
    send([0xB0, 51, 10]);
    send([0xB0, 54, 10]);
    eq('nothing is drawn as the messages arrive', refreshed.length, 0);
    midi.midiFlushDisplay();
    ok('both pots are drawn on the flush',
        refreshed.includes(1) && refreshed.includes(4), refreshed.join(','));
    refreshed.length = 0;
    midi.midiFlushDisplay();
    eq('a clean pot is not redrawn', refreshed.length, 0);
}

console.log('--- the switch CCs ---');
{
    const on = (id) => sim.simSwOn(id);

    // hold: CC103-108, SW0-SW4 then TAP
    send([0xB0, 103, 127]);
    eq('CC103 holds SW0 down', on('simSw0'), true);
    send([0xB0, 103, 0]);
    eq('and lets it go', on('simSw0'), false);
    send([0xB0, 107, 127]);
    eq('CC107 is SW4', on('simSw4'), true);
    send([0xB0, 107, 0]);
    send([0xB0, 108, 127]);
    eq('CC108 is TAP', on('simTap'), true);
    send([0xB0, 108, 0]);
    eq('TAP releases too', on('simTap'), false);

    // toggle: CC109-114
    send([0xB0, 109, 127]);
    eq('CC109 toggles SW0 on', on('simSw0'), true);
    send([0xB0, 109, 0]);
    eq('the footswitch release does not flip it back', on('simSw0'), true);
    send([0xB0, 109, 127]);
    eq('the next press flips it off', on('simSw0'), false);
    send([0xB0, 114, 127]);
    eq('CC114 is TAP', on('simTap'), true);
    send([0xB0, 114, 127]);
    eq('and toggles back', on('simTap'), false);

    // a held switch survives a click elsewhere on the page
    send([0xB0, 105, 127]);
    listeners.mouseup();
    eq('a page-wide mouseup does not drop a MIDI hold', on('simSw2'), true);
    send([0xB0, 105, 0]);
    eq('only the CC lets it go', on('simSw2'), false);

    // a pointer press is still swept up by that same mouseup
    sim.simSwPress('simSw3');
    listeners.mouseup();
    eq('a pointer press is still swept', on('simSw3'), false);
}

console.log('--- tap, which releases itself ---');
{
    const on = (id) => sim.simSwOn(id);

    send([0xB0, 93, 127]);              // tap tempo
    eq('CC93 taps TAP', on('simTap'), true);
    send([0xB0, 118, 127]);
    eq('CC118 taps SW3', on('simSw3'), true);

    setTimeout(() => {
        eq('the tap lets go by itself', on('simTap'), false);
        eq('and so does the switch tap', on('simSw3'), false);
        ok('it was held long enough to outlast the 480-sample debounce',
            midi.MIDI_TAP_MS >= 60, String(midi.MIDI_TAP_MS));
        ok('and short enough to stay clear of the sticky hold',
            midi.MIDI_TAP_MS < 700, String(midi.MIDI_TAP_MS));

        // Two taps in quick succession have to be two separate push edges,
        // since that is the whole of what tap tempo measures.
        send([0xB0, 93, 127]);
        const downAgain = on('simTap');
        send([0xB0, 93, 127]);          // again, before the first let go
        eq('a re-tap presses again', on('simTap') && downAgain, true);
        setTimeout(() => {
            eq('and still releases itself', on('simTap'), false);
            report();
        }, midi.MIDI_TAP_MS + 40);
    }, midi.MIDI_TAP_MS + 40);
}

console.log('--- a push held under an absolute set ---');
{
    // ENABLE reads latch XOR push. A footswitch held down while a CC arrives
    // must still leave the pin where the CC asked for it.
    sim.simPushed.simEnable = true;
    sim.simSetEnable(false);
    eq('held push, asked for bypass', enabled(), false);
    sim.simSetEnable(true);
    eq('held push, asked for engaged', enabled(), true);
    sim.simPushed.simEnable = false;
    sim.simSetEnable(true);
    eq('and released, it stays where it was put', enabled(), true);
}

// =====================================================================
// The tap tests finish on a timer, so the tally is printed from there.
function report() {
    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail) { failures.forEach(f => console.log('  FAIL  ' + f)); process.exit(1); }
}
