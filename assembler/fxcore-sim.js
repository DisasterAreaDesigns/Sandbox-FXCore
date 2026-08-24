// FXCore Simulator -- Web Audio front end for fxcore-emu.js
//
// Builds an AudioWorklet that runs the FXCore core at the selected sample
// rate, feeds it a test tone, an audio file or live input, and lets the six
// pots, five switches and the tap tempo button be worked while it plays.
//
// The worklet is assembled at runtime from FXCoreCore.toString() and loaded
// via a blob: URL. That is deliberate -- addModule() on a plain script file is
// blocked by CORS when the assembler is opened from a file:// URL, which is
// how a lot of people will run this. Building the module as a blob keeps the
// simulator working both locally and when served over http.
//
// The core is the plain reference interpreter, not a compiled one. It
// benchmarks around 62 M instructions/s, which is 5-18x real time for the
// length most FXCore programs actually are -- see sim-test/bench.js.

let simCtx = null;
let simNode = null;
let simSource = null;
let simInputGain = null;
let simOutputGain = null;
let simStream = null;
let simFileBuffer = null;
let simFileBytes = null;
let simFileName = null;
let simRunning = false;
let simImage = null;          // last successfully assembled sim image

// FXCore derives its sample rate from the PLL RANGE pins in master mode, which
// divide the 12.288 MHz clock down to 12, 24, 32 or 48 kHz. Those are the
// rates the selector offers -- a program's behaviour in samples never changes,
// but every delay, LFO and tap time scales in absolute time, so running the
// same code at 32 kHz instead of 48 kHz is exactly the PLL pin change it
// models.
const SIM_RATE = 48000;
let simRate = SIM_RATE;

// ---- worklet source -------------------------------------------------------

function simBuildWorkletSource() {
    if (typeof FXCoreCore === 'undefined') {
        throw new Error('fxcore-emu.js not loaded');
    }
    const processor = [
        'class FXCoreProcessor extends AudioWorkletProcessor {',
        '    constructor() {',
        '        super();',
        '        this.core = new FXCoreCore();',
        '        this.core.sampleRate = sampleRate;',
        '        this.pots = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];',
        '        this.pins = 0x7F;',       // pull-ups: nothing pressed
        '        this.outL = 0; this.outR = 1;',
        '        this.mirror = false;',
        '        this.bypass = false;',
        '        this.peak = [0, 0, 0, 0];',
        '        this.frames = 0;',
        '        this.ready = false;',
        '        this.port.onmessage = (e) => {',
        '            const d = e.data;',
        '            if (d.type === "image") {',
        '                this.core.setPresets({',
        '                    creg: new Int32Array(d.creg),',
        '                    mreg: new Int32Array(d.mreg),',
        '                    sfr: new Int32Array(d.sfr),',
        '                    usr: d.usr, cfg: d.cfg',
        '                });',
        '                this.core.sampleRate = sampleRate;',
        '                this.ready = this.core.setProgram(new Int32Array(d.program));',
        '                this.port.postMessage({type: "loaded", ok: this.ready,',
        '                    count: d.count});',
        '            } else if (d.type === "pots") {',
        '                this.pots = d.values;',
        '            } else if (d.type === "pins") {',
        '                this.pins = d.mask;',
        '            } else if (d.type === "route") {',
        '                this.outL = d.l; this.outR = d.r; this.mirror = d.mirror;',
        '            } else if (d.type === "bypass") {',
        '                this.bypass = d.on;',
        '            } else if (d.type === "reset") {',
        '                this.core.reset();',
        '            }',
        '        };',
        '    }',
        '    process(inputs, outputs) {',
        '        const output = outputs[0];',
        '        const oL = output[0];',
        '        const oR = output.length > 1 ? output[1] : null;',
        '        if (!this.ready) {',
        '            oL.fill(0); if (oR) oR.fill(0);',
        '            return true;',
        '        }',
        '        const input = inputs[0];',
        '        const hasIn = input && input.length > 0 && input[0].length > 0;',
        '        const iL = hasIn ? input[0] : null;',
        '        const iR = hasIn && input.length > 1 ? input[1] : iL;',
        '        const core = this.core;',
        '        const inbuf = [0, 0, 0, 0];',
        '        for (let i = 0; i < oL.length; i++) {',
        '            core.setPots(this.pots);',
        '            core.setPins(this.pins);',
        '            inbuf[0] = iL ? iL[i] : 0;',
        '            inbuf[1] = iR ? iR[i] : 0;',
        '            inbuf[2] = this.mirror ? inbuf[0] : 0;',
        '            inbuf[3] = this.mirror ? inbuf[1] : 0;',
        '            core.run(inbuf);',
        // Bypass is a routing change downstream of the core, not a halt: the
        // program keeps running -- delay tails, LFOs, tap tempo and the USER
        // pins all carry on -- and each input replaces the matching output,
        // IN0 to OUT0 and so on, the way the part routes I2S when nBypass is
        // asserted. Taking it from core.inputs rather than from a dry feed
        // upstream is what makes the monitor pair selector still mean
        // something while bypassed.
        '            const o = this.bypass ? core.inputs : core.outputs;',
        '            for (let k = 0; k < 4; k++) {',
        '                const a = o[k] < 0 ? -o[k] : o[k];',
        '                if (a > this.peak[k]) this.peak[k] = a;',
        '            }',
        '            oL[i] = o[this.outL] / 2147483648;',
        '            if (oR) oR[i] = o[this.outR] / 2147483648;',
        '        }',
        '        this.frames += oL.length;',
        '        if (this.frames >= 2048) {',
        '            this.port.postMessage({type: "status",',
        '                peak: [this.peak[0] / 2147483648, this.peak[1] / 2147483648,',
        '                       this.peak[2] / 2147483648, this.peak[3] / 2147483648],',
        '                userDuty: this.core.readUserDuty(),',
        '                user: this.core.user.slice(),',
        '                flags: this.core.creg[17],',
        '                taptempo: this.core.sfr[45],',
        '                unimplemented: Object.keys(this.core.unimplemented),',
        '                provisional: Object.keys(this.core.provisional)});',
        '            this.peak = [0, 0, 0, 0];',
        '            this.frames = 0;',
        '        }',
        '        return true;',
        '    }',
        '}',
        'registerProcessor("fxcore-processor", FXCoreProcessor);'
    ].join('\n');

    return FXCoreCore.toString() + '\n' + processor;
}

// ---- engine ---------------------------------------------------------------

// Build the whole audio graph, publishing to the module-level handles only
// once every piece succeeded, so a partial failure cannot leave a half-built
// engine that a second Play press would skip over.
async function simInitEngine() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: simRate
    });

    let node;
    try {
        const src = simBuildWorkletSource();
        const url = URL.createObjectURL(new Blob([src], {type: 'application/javascript'}));
        try {
            await ctx.audioWorklet.addModule(url);
        } finally {
            URL.revokeObjectURL(url);
        }
        node = new AudioWorkletNode(ctx, 'fxcore-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2]
        });
    } catch (err) {
        try { await ctx.close(); } catch (e) { /* already closing */ }
        if (location.protocol === 'file:') {
            throw new Error('the audio engine will not load from a file:// page. ' +
                'Serve the assembler folder over http instead - see the readme.');
        }
        throw err;
    }

    node.port.onmessage = (e) => {
        const d = e.data;
        if (d.type === 'status') simUpdateStatusDisplay(d);
        else if (d.type === 'loaded') simOnProgramLoaded(d);
    };

    const inputGain = ctx.createGain();
    const outputGain = ctx.createGain();

    inputGain.connect(node);
    node.connect(outputGain);
    outputGain.connect(ctx.destination);

    simCtx = ctx;
    simNode = node;
    simInputGain = inputGain;
    simOutputGain = outputGain;
    simApplyLevels();
    simSendRoute();
    simSendPots();
    simSendPins();
    simSendBypass();
}

function simTeardownEngine() {
    simDisconnectSource();
    if (simCtx) {
        try { simCtx.close(); } catch (e) { /* already closed */ }
    }
    simCtx = null;
    simNode = null;
    simInputGain = null;
    simOutputGain = null;
}

async function simStart() {
    if (simRunning) return;
    try {
        // Gate on the node, not the context: a half-built engine must rebuild.
        if (!simNode) await simInitEngine();
        await simCtx.resume();

        // Always push the image here. It may have been captured by the
        // assemble hook before the engine existed, in which case the worklet
        // itself still has nothing loaded.
        if (!simLoadProgram()) {
            simStop();
            return;
        }

        await simConnectSource();
        simRunning = true;
        simUpdateTransport();
        simReportRate();
    } catch (err) {
        simTeardownEngine();
        simRunning = false;
        simUpdateTransport();
        simStatus('Could not start: ' + err.message, 'error');
        console.error('[fxcore-sim]', err);
    }
}

function simStop() {
    if (!simRunning) return;
    simDisconnectSource();
    if (simCtx) simCtx.suspend();
    simRunning = false;
    simUpdateTransport();
    simUpdateMeters([0, 0, 0, 0]);
    simStatus('Stopped', '');
}

function simPanic() {
    simStop();
    if (simNode) simNode.port.postMessage({type: 'reset'});
    simStatus('Core reset - delay memory cleared, presets reloaded', '');
}

function simTogglePlay() {
    if (simRunning) simStop(); else simStart();
}

// ---- program loading ------------------------------------------------------

// Pull the current build out of the assembler. The simulator wants the
// decoded program plus every header preset, so it takes the assembler's own
// objects rather than re-parsing the Intel HEX.
function simCaptureImage() {
    if (typeof FXCoreAssembler === 'undefined' ||
        typeof FXCoreAssembler.buildSimImage !== 'function') return false;
    const image = FXCoreAssembler.buildSimImage();
    if (!image) return false;
    simImage = image;
    return true;
}

function simLoadProgram() {
    if (!simImage && !simCaptureImage()) {
        simStatus('Nothing assembled yet - press Assemble first', 'warn');
        simSetProgramState('Not loaded', '');
        return false;
    }
    if (simNode) {
        // Copy the buffers: postMessage structured-clones them, and the
        // originals must stay usable for the next load.
        simNode.port.postMessage({
            type: 'image',
            program: simImage.program.buffer.slice(0),
            creg: simImage.creg.buffer.slice(0),
            mreg: simImage.mreg.buffer.slice(0),
            sfr: simImage.sfr.buffer.slice(0),
            usr: simImage.usr,
            cfg: simImage.cfg,
            count: simImage.instructionCount
        });
    } else {
        simSetProgramState('Ready (' + simImage.instructionCount +
            ' instructions) - press Play', 'loaded');
    }
    return true;
}

function simOnProgramLoaded(d) {
    if (d.ok) {
        simSetProgramState('Loaded (' + d.count + ' instructions)', 'loaded');
    } else {
        simSetProgramState('Load failed', 'error');
    }
}

function simSetProgramState(text, cls) {
    const el = document.getElementById('simProgramState');
    if (el) {
        el.textContent = text;
        el.className = 'sim-program-state' + (cls ? ' ' + cls : '');
    }
}

// ---- sources --------------------------------------------------------------

function simSourceType() {
    const el = document.getElementById('simSource');
    return el ? el.value : 'tone';
}

async function simConnectSource() {
    simDisconnectSource();
    if (!simCtx || !simInputGain) return;
    const type = simSourceType();

    if (type === 'tone' || type === 'saw' || type === 'square') {
        const osc = simCtx.createOscillator();
        osc.type = type === 'tone' ? 'sine' : (type === 'saw' ? 'sawtooth' : 'square');
        osc.frequency.value = simNumber('simToneFreq', 440);
        osc.start();
        simSource = osc;
    } else if (type === 'noise') {
        const len = Math.floor(simCtx.sampleRate * 2);
        const buf = simCtx.createBuffer(1, len, simCtx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        const node = simCtx.createBufferSource();
        node.buffer = buf;
        node.loop = true;
        node.start();
        simSource = node;
    } else if (type === 'file') {
        if (!simFileBuffer) {
            simStatus('Choose an audio file first', 'warn');
            return;
        }
        const node = simCtx.createBufferSource();
        node.buffer = simFileBuffer;
        node.loop = true;
        node.start();
        simSource = node;
    } else if (type === 'input') {
        try {
            simStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });
            simSource = simCtx.createMediaStreamSource(simStream);
        } catch (err) {
            simStatus('Microphone access denied or unavailable', 'error');
            return;
        }
    }

    if (simSource) simSource.connect(simInputGain);
}

function simDisconnectSource() {
    if (simSource) {
        try { simSource.stop(); } catch (e) { /* live input has no stop() */ }
        try { simSource.disconnect(); } catch (e) { /* already gone */ }
        simSource = null;
    }
    if (simStream) {
        simStream.getTracks().forEach(t => t.stop());
        simStream = null;
    }
}

// Decode against a context running at the rate we intend to play at, so the
// browser resamples once, at decode time.
async function simDecodeFile(bytes) {
    const decodeCtx = simCtx || new (window.OfflineAudioContext ||
        window.webkitOfflineAudioContext)(1, 1, simRate);
    return decodeCtx.decodeAudioData(bytes.slice(0));
}

async function simRedecodeFile() {
    if (!simFileBytes) return;
    try {
        simFileBuffer = await simDecodeFile(simFileBytes);
    } catch (err) {
        simStatus('Could not re-decode ' + (simFileName || 'the audio file') +
            ' at the new rate: ' + err.message, 'error');
    }
}

async function simLoadAudioFile(fileInput) {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
        const bytes = await file.arrayBuffer();
        // Keep the undecoded bytes: decodeAudioData resamples to the context
        // rate and detaches the buffer it is given, so a later rate change has
        // to start from the original file rather than resample twice.
        simFileBytes = bytes;
        simFileBuffer = await simDecodeFile(bytes);
        simFileName = file.name;
        const label = document.getElementById('simFileLabel');
        if (label) {
            label.textContent = file.name + ' (' + simFileBuffer.duration.toFixed(1) + 's)';
        }
        const sel = document.getElementById('simSource');
        if (sel) sel.value = 'file';
        simOnSourceChange();
        simStatus('Loaded ' + file.name, 'ok');
    } catch (err) {
        simStatus('Could not decode that file: ' + err.message, 'error');
    }
}

async function simOnSourceChange() {
    const type = simSourceType();
    const toneRow = document.getElementById('simToneRow');
    const fileRow = document.getElementById('simFileRow');
    if (toneRow) toneRow.style.display =
        (type === 'tone' || type === 'saw' || type === 'square') ? '' : 'none';
    if (fileRow) fileRow.style.display = (type === 'file') ? '' : 'none';
    if (simRunning) await simConnectSource();
}

function simOnToneFreqChange() {
    const f = simNumber('simToneFreq', 440);
    const out = document.getElementById('simToneFreqValue');
    if (out) out.textContent = f + ' Hz';
    if (simSource && simSource.frequency) {
        simSource.frequency.setTargetAtTime(f, simCtx.currentTime, 0.01);
    }
}

// ---- clock ----------------------------------------------------------------

// AudioContext.sampleRate is fixed at construction, so changing the rate means
// tearing the engine down and rebuilding it. That clears delay memory, exactly
// as a program change on the chip would.
async function simOnRateChange() {
    const sel = document.getElementById('simRate');
    const rate = sel ? parseFloat(sel.value) : SIM_RATE;
    if (!isFinite(rate) || rate === simRate) return;
    simRate = rate;
    simUpdateRateInfo();

    const wasRunning = simRunning;
    if (simRunning) simStop();
    if (simNode) simTeardownEngine();
    await simRedecodeFile();

    if (wasRunning) await simStart();
    else simStatus('Clock set to ' + simRateLabel(), '');
}

// The browser is free to refuse the rate we asked for, and some do. The core
// is clocked by the context, so a refusal silently rescales every delay and
// LFO -- report the rate actually in use rather than let it pass as correct.
function simReportRate() {
    const actual = simCtx ? simCtx.sampleRate : simRate;
    if (Math.abs(actual - simRate) > 1) {
        simStatus('Browser gave ' + Math.round(actual) + ' Hz, not ' +
            Math.round(simRate) + ' Hz - delay, LFO and tap times are off by ' +
            (actual / simRate).toFixed(2) + 'x', 'warn');
    } else {
        simStatus('Running at ' + Math.round(actual) + ' Hz', 'ok');
    }
}

function simRateLabel() {
    return (simRate / 1000).toFixed(3).replace(/\.?0+$/, '') + ' kHz';
}

// Delay RAM is a fixed 32768 words, so its length in seconds follows the rate.
function simUpdateRateInfo() {
    const el = document.getElementById('simRateInfo');
    if (!el) return;
    el.textContent = 'Max delay ' + (32768 / simRate).toFixed(3) + ' s, ' +
        'Nyquist ' + (simRate / 2000).toFixed(1) + ' kHz';
}

// ---- controls -------------------------------------------------------------

function simNumber(id, fallback) {
    const el = document.getElementById(id);
    if (!el) return fallback;
    const v = parseFloat(el.value);
    return isNaN(v) ? fallback : v;
}

// ---- control naming -------------------------------------------------------
//
// A program can name the simulator's controls with magic comments:
//
//     ; #POT0 Reverb time
//     ; #SW1 Freeze
//     // #POT3 Damping
//     ; #TAP Tempo
//     ; #LED0 Bypass          (#USER0 means the same thing)
//
// The tag is read from the comment portion of a line, so it can never collide
// with code, and the assembler ignores it because it is inside a comment. A
// control with no tag keeps its hardware name.

function simParseControlNames(src) {
    const names = {
        pot: new Array(6).fill(null),
        sw: new Array(5).fill(null),
        led: new Array(2).fill(null),
        tap: null
    };
    if (!src) return names;

    for (const line of src.split(/\r?\n/)) {
        // Take the text after the first comment marker on the line. A line
        // with no marker is scanned whole, which picks up tags sitting inside
        // a /* */ block.
        const semi = line.indexOf(';');
        const dbl = line.indexOf('//');
        let cut = -1;
        if (semi >= 0 && (dbl < 0 || semi < dbl)) cut = semi + 1;
        else if (dbl >= 0) cut = dbl + 2;
        const text = cut >= 0 ? line.slice(cut) : line;

        const m = /#(POT[0-5]|SW[0-4]|USER[01]|LED[01]|TAP)\b[ \t]*(.*)$/i.exec(text);
        if (!m) continue;

        // Stop the name at a further comment marker or a block-comment close,
        // so `/* #POT0 Mix */` names the pot "Mix" rather than "Mix */".
        const name = m[2].replace(/(;|\/\/|\*\/).*$/, '').trim();
        if (!name) continue;

        const tag = m[1].toUpperCase();
        if (tag === 'TAP') names.tap = name;
        else if (tag.indexOf('POT') === 0) names.pot[+tag.slice(3)] = name;
        else if (tag.indexOf('SW') === 0) names.sw[+tag.slice(2)] = name;
        // The two lamps answer to either spelling: USER0/USER1 is what the
        // instruction set calls the pins, LED0/LED1 is what they drive.
        else names.led[+tag.slice(-1)] = name;
    }
    return names;
}

function simSetControlLabel(id, name, fallback) {
    const el = document.getElementById(id + 'Label');
    if (!el) return;
    el.textContent = name || fallback;
    el.classList.toggle('sim-renamed', !!name);
    // Keep the hardware name reachable once a program has renamed a control,
    // so it is still obvious which pot or switch is being driven.
    const host = el.closest
        ? el.closest('.sim-slider-row, .sim-switch-row, .sim-led-item') : null;
    if (host) host.title = name ? name + '  \u2014  ' + fallback : fallback;
}

// The tap pad has no separate label element -- the button's own text is the
// name -- so it cannot go through simSetControlLabel.
function simSetTapLabel(name) {
    const el = document.getElementById('simTapBtn');
    if (!el) return;
    el.textContent = name || 'TAP';
    el.classList.toggle('sim-renamed', !!name);
    el.title = name ? name + '  \u2014  TAP' : 'TAP';
}

// Re-read the names from the editor. Cheap, so it can run on every edit.
function simRefreshControlNames() {
    let src = '';
    try {
        if (typeof editor !== 'undefined' && editor && editor.getValue) src = editor.getValue();
    } catch (e) { /* editor not up yet */ }
    const names = simParseControlNames(src);
    for (let i = 0; i < 6; i++) simSetControlLabel('simPot' + i, names.pot[i], 'POT' + i);
    for (let i = 0; i < 5; i++) simSetControlLabel('simSw' + i, names.sw[i], 'SW' + i);
    for (let i = 0; i < 2; i++) simSetControlLabel('simUser' + i, names.led[i], 'USER' + i);
    simSetTapLabel(names.tap);
}

// ---- momentary switch presses --------------------------------------------
//
// Each switch has both a latch and a momentary push. The pin reads pressed if
// either is active, so the push works as a footswitch tap without disturbing
// the latch.

const simSwPushed = [false, false, false, false, false];

function simSwPress(i) {
    if (simSwPushed[i]) return;
    simSwPushed[i] = true;
    const b = document.getElementById('simSw' + i + 'Push');
    if (b) b.classList.add('sim-pushing');
    simSendPins();
}

function simSwRelease(i) {
    if (!simSwPushed[i]) return;
    simSwPushed[i] = false;
    const b = document.getElementById('simSw' + i + 'Push');
    if (b) b.classList.remove('sim-pushing');
    simSendPins();
}

// A pointer released outside the button never fires its mouseup, which would
// leave a switch stuck down.
if (typeof document !== 'undefined') {
    document.addEventListener('mouseup', () => {
        for (let i = 0; i < 5; i++) simSwRelease(i);
        simTapRelease();
    });
}

function simSendPots() {
    const values = [];
    for (let i = 0; i < 6; i++) {
        const v = simNumber('simPot' + i, 50) / 100;
        values.push(v);
        const out = document.getElementById('simPot' + i + 'Value');
        if (out) out.textContent = Math.round(v * 100) + '%';
    }
    if (simNode) simNode.port.postMessage({type: 'pots', values: values});
}

// PIN bits: 0-4 = SW0-SW4, 5 = ENABLE, 6 = TAP. The pins have pull-ups, so a
// released switch reads 1 and a pressed one reads 0 -- the checkboxes read as
// "pressed", so they invert.
function simSendPins() {
    let mask = 0x7F;
    for (let i = 0; i < 5; i++) {
        const el = document.getElementById('simSw' + i);
        const latched = !!(el && el.checked);
        if (latched || simSwPushed[i]) mask &= ~(1 << i);
    }
    const en = document.getElementById('simEnable');
    if (en && !en.checked) mask &= ~(1 << 5);      // ENABLE checked = enabled = high
    if (simTapDown) mask &= ~(1 << 6);
    if (simNode) simNode.port.postMessage({type: 'pins', mask: mask});
}

let simTapDown = false;
function simTapPress() { simTapDown = true; simSendPins(); }
function simTapRelease() {
    if (!simTapDown) return;
    simTapDown = false;
    simSendPins();
}

function simSendRoute() {
    const l = parseInt(simValue('simOutL', '0'), 10) || 0;
    const r = parseInt(simValue('simOutR', '1'), 10) || 0;
    const mirrorEl = document.getElementById('simMirrorIn');
    if (simNode) {
        simNode.port.postMessage({
            type: 'route', l: l, r: r,
            mirror: mirrorEl ? mirrorEl.checked : false
        });
    }
}

function simValue(id, fallback) {
    const el = document.getElementById(id);
    return el ? el.value : fallback;
}

function simApplyLevels() {
    if (!simCtx) return;
    const inDb = simNumber('simInputLevel', 0);
    const outDb = simNumber('simOutputLevel', 0);
    const inLabel = document.getElementById('simInputLevelValue');
    const outLabel = document.getElementById('simOutputLevelValue');
    if (inLabel) inLabel.textContent = inDb.toFixed(0) + ' dB';
    if (outLabel) outLabel.textContent = outDb.toFixed(0) + ' dB';

    // Both trims sit outside the part, so they apply bypassed as well.
    if (simInputGain) simInputGain.gain.value = Math.pow(10, inDb / 20);
    if (simOutputGain) simOutputGain.gain.value = Math.pow(10, outDb / 20);
}

function simEnabled() {
    const el = document.getElementById('simEnable');
    return el ? el.checked : true;
}

function simSendBypass() {
    if (simNode) simNode.port.postMessage({ type: 'bypass', on: !simEnabled() });
}

// ENABLE is the one control for the part's ENABLE/nBypass pin, so it does both
// of that pin's jobs: it drives the pin and the ENABLEDB switch bit the program
// reads, and it routes the inputs straight to the outputs. The program keeps
// running either way, which is what lets a program read the pin and decide for
// itself, and what keeps its delay tails alive across a bypass.
function simToggleEnable() {
    simSendPins();
    simSendBypass();
    if (!simEnabled()) simStatus('ENABLE off - bypassed, inputs routed to outputs', 'warn');
    else simReportRate();
}

// ---- display --------------------------------------------------------------

function simStatus(msg, kind) {
    const el = document.getElementById('simStatus');
    if (!el) return;
    el.textContent = msg;
    el.className = 'sim-status' + (kind ? ' sim-status-' + kind : '');
}

function simUpdateTransport() {
    const btn = document.getElementById('simPlayBtn');
    if (btn) {
        btn.textContent = simRunning ? 'Stop' : 'Play';
        btn.classList.toggle('sim-playing', simRunning);
    }
}

function simUpdateStatusDisplay(d) {
    simUpdateMeters(d.peak);
    simUpdateLEDs(d.userDuty, d.user);
    simUpdateFlags(d.flags, d.taptempo);
    if (d.unimplemented && d.unimplemented.length) {
        simStatus('This program uses ' + d.unimplemented.join(', ') +
            ', which the simulator does not model - output is not ' +
            'representative', 'warn');
    } else if (d.provisional && d.provisional.length) {
        // CHR and PITCH are modelled on the FV-1 equivalents pending
        // confirmation from Experimental Noize. They sound right, but say so
        // rather than letting the output pass as verified.
        simStatus(d.provisional.join(' and ') + ' modelled on the FV-1 ' +
            'equivalent - sounds right, not yet confirmed against hardware',
            'warn');
    }
}

function simUpdateMeters(peak) {
    for (let i = 0; i < 4; i++) {
        const bar = document.getElementById('simMeter' + i);
        if (!bar) continue;
        const p = peak && peak[i] ? peak[i] : 0;
        bar.style.width = Math.min(100, p * 100).toFixed(1) + '%';
        // The chip flags a channel at 0.5 dB below full scale
        bar.classList.toggle('sim-meter-clip', p >= 0.944);
    }
}

// Render each USER pin as a real LED would look, from the duty cycle the core
// integrated over the last display window rather than from the instantaneous
// bit. Programs PWM these pins in software -- a 256-sample cycle is 187 Hz at
// 48 kHz -- so sampling the bit at display rate would alias a smooth fade into
// random flicker.
function simUpdateLEDs(duty, raw) {
    const pwmEl = document.getElementById('simLedPwm');
    const pwm = pwmEl ? pwmEl.checked : true;

    for (let i = 0; i < 2; i++) {
        const el = document.getElementById('simUser' + i);
        if (!el) continue;
        let d = duty && duty[i] != null ? duty[i] : 0;
        if (!(d > 0)) d = 0; else if (d > 1) d = 1;

        // Two ways to show a pin that switches faster than the display
        // refreshes. PWM mode uses the integrated duty cycle, which is what an
        // LED and an eye do with a dimmed output. Raw mode uses the pin state
        // at the moment the frame was posted, which gives a crisp on/off for
        // programs that only blink -- there the integration smears the
        // transition into a meaningless intermediate brightness.
        let level = d;
        if (!pwm) level = raw && raw[i] ? 1 : 0;
        el.classList.toggle('sim-led-crisp', !pwm);

        // Perceived brightness is not linear in duty cycle, so a 50% duty
        // shown at 50% opacity reads far too dim. Gamma-correct for display.
        const b = Math.pow(level, 1 / 2.2);
        d = level;

        if (d > 0.002) {
            // Interpolate the lit colour over the unlit face rather than using
            // opacity, so the LED keeps a solid body at low brightness.
            const r = Math.round(58 + b * 197);
            const g = Math.round(58 + b * 24);
            const bl = Math.round(58 + b * 24);
            el.style.background = 'rgb(' + r + ',' + g + ',' + bl + ')';
            el.style.borderColor = 'rgba(255,82,82,' + (0.35 + b * 0.65).toFixed(2) + ')';
            el.style.boxShadow = '0 0 ' + (b * 9).toFixed(1) + 'px rgba(255,82,82,' +
                b.toFixed(2) + ')';
        } else {
            // Back to the stylesheet's unlit appearance.
            el.style.background = '';
            el.style.borderColor = '';
            el.style.boxShadow = '';
        }

        // The readout always reports the real measured duty, whichever way
        // the lamp is being drawn -- that is the number worth having when a
        // PWM is not doing what was intended.
        const trueDuty = duty && duty[i] != null ? Math.max(0, Math.min(1, duty[i])) : 0;
        const pct = document.getElementById('simUser' + i + 'Duty');
        if (pct) pct.textContent = Math.round(trueDuty * 100) + '%';
        el.title = 'USER' + i + ' duty ' + (trueDuty * 100).toFixed(1) + '%' +
            (pwm ? '' : '  (lamp showing raw pin state)');
    }
}

function simUpdateFlags(flags, taptempo) {
    const el = document.getElementById('simFlags');
    if (!el) return;
    const names = [];
    if (flags & 0x0008) names.push('NEWTT');
    if (flags & 0x0010) names.push('TAPSTKY');
    if (flags & 0x0F00) names.push('IN clip');
    if (flags & 0xF000) names.push('OUT clip');
    const tt = taptempo ? (taptempo / simRate).toFixed(3) + ' s' : '-';
    el.textContent = 'Tap ' + tt + (names.length ? '   ' + names.join(' ') : '');
}

// ---- wiring ---------------------------------------------------------------

// Reload the simulator whenever a build succeeds, so the loop is
// edit -> assemble -> hear it, with no extra click.
function simHookAssemble() {
    if (typeof window.assembleFXCore !== 'function') return;
    if (window.assembleFXCore.__simHooked) return;
    const original = window.assembleFXCore;
    const wrapped = function () {
        const result = original.apply(this, arguments);
        simRefreshControlNames();
        if (simCaptureImage()) {
            simLoadProgram();
            const auto = document.getElementById('simAutoReload');
            if (simRunning && simNode && auto && auto.checked) {
                simNode.port.postMessage({type: 'reset'});
            }
        }
        return result;
    };
    wrapped.__simHooked = true;
    window.assembleFXCore = wrapped;
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
    simHookAssemble();
    simRefreshControlNames();
    simSendPots();
    simOnSourceChange();
    simOnToneFreqChange();
    simUpdateRateInfo();
    if (typeof AudioWorkletNode === 'undefined') {
        simStatus('This browser has no AudioWorklet support - simulator unavailable', 'error');
        const btn = document.getElementById('simPlayBtn');
        if (btn) btn.disabled = true;
    } else if (location.protocol === 'file:') {
        simStatus('Opened as a local file - if Play fails, serve this folder ' +
            'over http (see readme)', 'warn');
    }

    // Follow the names as they are typed rather than waiting for an assemble.
    // Monaco may not be up yet, so poll briefly for it.
    let tries = 0;
    const attach = setInterval(() => {
        if (typeof editor !== 'undefined' && editor && editor.onDidChangeModelContent) {
            clearInterval(attach);
            let timer = null;
            editor.onDidChangeModelContent(() => {
                clearTimeout(timer);
                timer = setTimeout(simRefreshControlNames, 300);
            });
            simRefreshControlNames();
        } else if (++tries > 40) {
            clearInterval(attach);
        }
    }, 250);
});

// The control-name parser is pure, so it is exported for the headless tests.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { simParseControlNames };
}
