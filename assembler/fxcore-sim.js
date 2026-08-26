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

// Ctrl+P (Alt+P off the Mac) reaches this from anywhere in the app, including
// with the editor focused. Starting from the keyboard also opens the panel:
// every bit of feedback the simulator gives -- the meters, the LEDs, the
// status line, whether Play even took -- lives in there, so audio starting
// behind a closed panel would be a sound with no visible cause. Stopping
// leaves the panel as it found it.
function simShortcutTogglePlay() {
    const starting = !simRunning;
    simTogglePlay();
    if (starting && typeof openFlyout === 'function') openFlyout('sim');
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

// The click train. One second between clicks, and the click itself is a short
// 2 kHz burst rather than a bare one-sample impulse. An impulse puts most of
// its energy above where a laptop speaker can reproduce it, so it barely
// registers, and its DC content walks the state of anything with a feedback
// path. A 2 kHz burst is audible, sits below Nyquist even at the 12 kHz rate,
// and at 3 ms is still brief enough to read as an impulse against the delay
// times these programs work in.
const SIM_CLICK_PERIOD = 1.0;      // seconds between clicks
const SIM_CLICK_FREQ = 2000;       // Hz
const SIM_CLICK_CYCLES = 6;        // whole cycles per burst -- 3 ms at 2 kHz

// A whole number of cycles, so the window closes on a zero crossing. Every
// rate the selector offers divides 2 kHz exactly, so this is never rounded.
function simClickLength(sampleRate) {
    return Math.round(SIM_CLICK_CYCLES * sampleRate / SIM_CLICK_FREQ);
}

// Write one click into the head of `data` and leave the rest silent. Pure, so
// the headless tests can check the shape without a Web Audio context.
function simFillClick(data, sampleRate) {
    const n = simClickLength(sampleRate);
    const len = Math.min(data.length, n);
    const w = 2 * Math.PI * SIM_CLICK_FREQ / sampleRate;
    for (let i = 0; i < len; i++) {
        // A Hann window over whole cycles both starts and ends at zero, so the
        // loop point never puts a step in the signal, and it leaves the burst
        // symmetric enough that the positive and negative half-cycles cancel
        // instead of handing the program a DC offset to integrate.
        const win = 0.5 * (1 - Math.cos(2 * Math.PI * i / n));
        data[i] = Math.sin(w * i) * win;
    }
    for (let i = len; i < data.length; i++) data[i] = 0;
    return data;
}

// A plucked string, taken from the FV-1 converter's listening harness. It is
// the most useful thing to judge an effect by: a sharp transient, real
// harmonic content, and a gap after each pluck where a delay or reverb tail
// can be heard on its own. Karplus-Strong -- a burst of noise round a delay
// line one period long, filtered once per pass.
//
// Plain Karplus-Strong loses its energy per trip round the string rather than
// per second, so a low note holds on several times longer than a high one and
// rings like a metal bar. Both losses here are quoted in seconds and hertz
// instead, and scaled to the string, so a bass note fades like a bass note.
const SIM_PLUCK_SECONDS = 2;       // buffer length, so a pluck every 2 s
const SIM_PLUCK_DECAY = 0.04;      // what is left of the note after a second
const SIM_PLUCK_TONE = 7000;       // Hz, the string's own damping
const SIM_PLUCK_PICK = 3000;       // Hz, how hard the string was picked
let simPluckRetune = null;

function simRng(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
        s ^= s << 13; s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5;  s >>>= 0;
        return s / 4294967296;
    };
}

// One pole coefficient for a cutoff in Hz at the rate being rendered.
function simOnePole(hz, rate) {
    return 1 - Math.exp(-2 * Math.PI * hz / rate);
}

/**
 * Fill `out` with one pluck. The noise burst comes from a fixed seed so the
 * same settings always give the same signal, which is what makes an A/B
 * between two versions of a program mean anything.
 */
function simPluckSignal(out, rate, hz, seed) {
    const period = Math.max(2, Math.round(rate / hz));
    // The string is damped once per trip and makes rate/period trips a second,
    // so raising the per second figure to that power keeps the note's length
    // the same whatever it is tuned to and whatever the PLL rate is.
    const damp = Math.pow(SIM_PLUCK_DECAY, period / rate);
    const tone = simOnePole(SIM_PLUCK_TONE, rate);
    const pick = simOnePole(SIM_PLUCK_PICK, rate);

    const random = seed === undefined ? simRng(1) : simRng(seed);
    const string = new Float32Array(period);
    for (let i = 0; i < period; i++) string[i] = random() * 2 - 1;

    // White noise is a pick with no width to it, all fizz and no note. Round
    // the burst off first -- twice, so the filter carries over the wrap and
    // the string starts where it ends -- then put the level back.
    let lp = string[period - 1];
    for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < period; i++) {
            lp += pick * (string[i] - lp);
            if (pass) string[i] = lp;
        }
    }
    let loudest = 0;
    for (let i = 0; i < period; i++) loudest = Math.max(loudest, Math.abs(string[i]));
    if (loudest > 0) for (let i = 0; i < period; i++) string[i] /= loudest;

    // The buffer loops, so the tail has to reach silence before the seam or
    // every repeat would start with a click of its own.
    const n = out.length;
    const fade = Math.floor(n * 0.75);
    let loop = 0, index = 0;
    for (let i = 0; i < n; i++) {
        const next = (index + 1) % period;
        // A one pole rather than the usual two point average: its corner is
        // fixed in hertz, so the harmonics a long string carries are lost as
        // quickly in time as a short string's, which is what stops a low
        // pluck ringing on as a clang.
        loop += tone * (0.5 * (string[index] + string[next]) - loop);
        out[i] = string[index] * 0.4;
        string[index] = loop * damp;
        index = next;
        if (i > fade) out[i] *= (n - i) / (n - fade);
    }
    return out;
}

function simMakePluckSource() {
    const len = Math.max(1, Math.round(simCtx.sampleRate * SIM_PLUCK_SECONDS));
    const buf = simCtx.createBuffer(1, len, simCtx.sampleRate);
    simPluckSignal(buf.getChannelData(0), simCtx.sampleRate,
        simNumber('simToneFreq', 440));
    const node = simCtx.createBufferSource();
    node.buffer = buf;
    node.loop = true;
    node.start();
    return node;
}

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
    } else if (type === 'click') {
        // A one-second buffer with a single click at the top of it, looped, so
        // the clicks land exactly a second apart however the rate is set. That
        // makes it a stopwatch you can hear: a delay's repeats, a reverb tail
        // and a tap tempo can all be read straight off the gap between clicks
        // without measuring anything.
        const buf = simCtx.createBuffer(1, Math.round(simCtx.sampleRate * SIM_CLICK_PERIOD),
            simCtx.sampleRate);
        simFillClick(buf.getChannelData(0), simCtx.sampleRate);
        const node = simCtx.createBufferSource();
        node.buffer = buf;
        node.loop = true;
        node.start();
        simSource = node;
    } else if (type === 'pluck') {
        simSource = simMakePluckSource();
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
        // The file input already shows the name, so this only adds what it
        // cannot: how long the file turned out to be once decoded.
        const label = document.getElementById('simFileLabel');
        if (label) label.textContent = simFileBuffer.duration.toFixed(1) + ' s';
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
        (type === 'tone' || type === 'saw' || type === 'square' ||
         type === 'pluck') ? '' : 'none';
    if (fileRow) fileRow.style.display = (type === 'file') ? '' : 'none';
    if (simRunning) await simConnectSource();
}

function simOnToneFreqChange() {
    const f = simNumber('simToneFreq', 440);
    const out = document.getElementById('simToneFreqValue');
    if (out) out.textContent = f + ' Hz';
    if (simSource && simSource.frequency) {
        simSource.frequency.setTargetAtTime(f, simCtx.currentTime, 0.01);
    } else if (simRunning && simSourceType() === 'pluck') {
        // A rendered buffer cannot be retuned the way an oscillator can, so the
        // pluck has to be built again -- once the slider has settled, or every
        // step of a drag would restart the note.
        clearTimeout(simPluckRetune);
        simPluckRetune = setTimeout(() => simConnectSource(), 200);
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
    simSetControlLabel('simTap', names.tap, 'TAP');
}

// ---- switches -------------------------------------------------------------
//
// Every switch on the panel is the same pair of buttons: TOGGLE latches the
// pin, PUSH is momentary. A push *inverts* whatever the latch is holding
// rather than only pulling the pin down, so a latched switch can be
// momentarily released just as a released one can be momentarily pressed --
// both edges are reachable from the panel, and the latch is always back where
// it started once the button comes up. ENABLE works the same way, which turns
// its PUSH into a hold-for-dry A/B against the bypassed signal.
//
// The TOGGLE lamp shows the pin as it reads *now*, latch and push combined,
// so a push visibly flips it and flips it back.

const SIM_SWITCHES = ['simSw0', 'simSw1', 'simSw2', 'simSw3', 'simSw4',
                      'simTap', 'simEnable'];

// ENABLE idles high (the part is enabled); every other pin idles released.
const simLatched = { simEnable: true };
const simPushed = {};
const simPushedBy = {};        // 'pointer' or 'midi', per pushed switch

// The pin as the program sees it: pressed if exactly one of latch and push is
// active.
function simSwOn(id) { return !!simLatched[id] !== !!simPushed[id]; }

function simSwToggle(id) {
    simLatched[id] = !simLatched[id];
    simSwChanged(id);
}

// Put a switch in a given state rather than flipping it, which is what an
// absolute source like a MIDI CC has to do. A push held at the same time still
// inverts the pin, so the latch is set to whatever makes the pin read `on`.
function simSetSwitch(id, on) {
    if (simSwOn(id) === !!on) return;
    simLatched[id] = (!!on) !== !!simPushed[id];
    simSwChanged(id);
}

function simSetEnable(on) { simSetSwitch('simEnable', on); }

function simSwPress(id, from) {
    if (simPushed[id]) return;
    simPushed[id] = true;
    simPushedBy[id] = from || 'pointer';
    const b = document.getElementById(id + 'Push');
    if (b) b.classList.add('sim-pushing');
    simSwChanged(id);
}

function simSwRelease(id) {
    if (!simPushed[id]) return;
    simPushed[id] = false;
    simPushedBy[id] = null;
    const b = document.getElementById(id + 'Push');
    if (b) b.classList.remove('sim-pushing');
    simSwChanged(id);
}

function simSwChanged(id) {
    simUpdateSwitchLamp(id);
    simSendPins();
    if (id === 'simEnable') simOnEnableChange();
}

function simUpdateSwitchLamp(id) {
    const b = document.getElementById(id);
    if (!b) return;
    const on = simSwOn(id);
    b.classList.toggle('sim-lit', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
}

function simUpdateSwitchLamps() { SIM_SWITCHES.forEach(simUpdateSwitchLamp); }

// A pointer released outside the button never fires its mouseup, which would
// leave a switch stuck down. Only pointer presses are swept: a MIDI footswitch
// held down is not let go of because someone clicked elsewhere on the page.
if (typeof document !== 'undefined') {
    document.addEventListener('mouseup', () => SIM_SWITCHES.forEach((id) => {
        if (simPushedBy[id] !== 'midi') simSwRelease(id);
    }));
}

// The pots live here rather than in the sliders. A slider has 100 steps and a
// MIDI CC has 128, so reading the value back out of the DOM would quantise a
// quarter of the controller's resolution away before the core ever saw it.
let simPots = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];

// Set one pot from any source. `opts.from` names the control that moved, so a
// slider is not fought for the thumb while it is the thing being dragged.
// `opts.defer` sends the value to the core but leaves the display for the
// caller to refresh, which is how MIDI keeps audio responding at full rate
// while its redraws are batched.
function simSetPot(i, v01, opts) {
    if (i < 0 || i >= simPots.length) return;
    const v = Math.max(0, Math.min(1, v01));
    if (simPots[i] === v) return;
    simPots[i] = v;

    simPushPots();
    if (!opts || !opts.defer) simRefreshPotDisplay(i, opts && opts.from);
}

function simRefreshPotDisplay(i, from) {
    if (typeof document === 'undefined') return;
    if (from !== 'slider') {
        const slider = document.getElementById('simPot' + i);
        if (slider) slider.value = String(Math.round(simPots[i] * 100));
    }
    const out = document.getElementById('simPot' + i + 'Value');
    if (out) out.textContent = Math.round(simPots[i] * 100) + '%';
}

function simPushPots() {
    if (simNode) simNode.port.postMessage({type: 'pots', values: simPots.slice()});
}

// Slider handler: read all six back out of the DOM, which also covers the
// initial call at startup. The display is refreshed either way, since the
// percentage beside an untouched slider still has to be drawn once.
function simSendPots() {
    for (let i = 0; i < simPots.length; i++) {
        simSetPot(i, simNumber('simPot' + i, 50) / 100, {from: 'slider', defer: true});
        simRefreshPotDisplay(i, 'slider');
    }
}

// Read-only view of what the core is running, for tests and for MIDI to
// compare against before it decides a message changed anything.
if (typeof window !== 'undefined') window.simGetPots = () => simPots.slice();

// PIN bits: 0-4 = SW0-SW4, 5 = ENABLE, 6 = TAP. The pins have pull-ups, so a
// released switch reads 1 and a pressed one reads 0 -- the panel's buttons read
// as "pressed", so they invert.
function simSendPins() {
    let mask = 0x7F;
    for (let i = 0; i < 5; i++) if (simSwOn('simSw' + i)) mask &= ~(1 << i);
    if (!simSwOn('simEnable')) mask &= ~(1 << 5);   // ENABLE lit = enabled = high
    if (simSwOn('simTap')) mask &= ~(1 << 6);
    if (simNode) simNode.port.postMessage({type: 'pins', mask: mask});
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

function simEnabled() { return simSwOn('simEnable'); }

function simSendBypass() {
    if (simNode) simNode.port.postMessage({ type: 'bypass', on: !simEnabled() });
}

// ENABLE is the one control for the part's ENABLE/nBypass pin, so it does both
// of that pin's jobs: it drives the pin and the ENABLEDB switch bit the program
// reads, and it routes the inputs straight to the outputs. The program keeps
// running either way, which is what lets a program read the pin and decide for
// itself, and what keeps its delay tails alive across a bypass.
//
// simSwChanged() has already sent the pins by the time this runs.
function simOnEnableChange() {
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
    simUpdateSwitchLamps();
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

// The control-name parser and the latch/push algebra are pure, so they are
// exported for the headless tests.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { simParseControlNames, simSwOn, simLatched, simPushed,
        simSetSwitch, simSetEnable, simSwToggle, simSwPress, simSwRelease,
        simFillClick, simClickLength, SIM_CLICK_PERIOD,
        simPluckSignal, SIM_PLUCK_SECONDS, SIM_PLUCK_DECAY };
}
