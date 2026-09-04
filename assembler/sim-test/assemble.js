// Loads the browser assembler into a Node VM so test programs can be
// assembled headlessly. The assembler sources are plain scripts that declare
// globals and touch a few DOM/debug helpers, so they only need small shims.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..');
const FILES = [
    'debug_config.js', 'common.js', 'reserved_words.js', 'registers.js',
    'mnemonic.js', 'shunting_yard.js', 'line_parse.js', 'intel_hex.js',
    'symbol_table.js', 'fxcore_ic.js', 'assembler.js',
    'fxl_library.js', 'preprocessor.js', 'program.js'
];

function makeContext(opts) {
    const messages = [];
    const noop = () => {};
    const stubEl = {
        style: {}, classList: { add: noop, remove: noop, toggle: noop },
        addEventListener: noop, appendChild: noop, click: noop,
        removeChild: noop, firstChild: null, children: [],
        scrollTop: 0, scrollHeight: 0,
        textContent: '', innerHTML: '', value: '', disabled: false, files: []
    };
    const sandbox = {
        console: opts && opts.verbose ? console : { log: noop, warn: noop, error: noop, info: noop },
        document: {
            getElementById: () => stubEl,
            querySelector: () => stubEl,
            querySelectorAll: () => [],
            createElement: () => stubEl,
            addEventListener: noop,
            body: stubEl
        },
        navigator: { userAgent: 'node' },
        location: { protocol: 'file:', href: '' },
        setTimeout, clearTimeout, Math, JSON, Date, Number, String, Array,
        Object, Map, Set, Error, parseInt, parseFloat, isNaN, isFinite,
        RegExp, Boolean, Function, Symbol, Promise, BigInt,
        Int32Array, Uint32Array, Int16Array, Uint8Array, Float64Array,
        debugLog: (msg, kind) => { messages.push({ kind, msg }); },
        __messages: messages
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    for (const f of FILES) {
        const src = fs.readFileSync(path.join(DIR, f), 'utf8');
        try {
            vm.runInContext(src, sandbox, { filename: f });
        } catch (e) {
            throw new Error(`loading ${f}: ${e.message}`);
        }
    }
    // Top-level `class` declarations live in the context's global lexical
    // scope, not on the global object, so they are invisible from outside.
    // Publish the handful the harness needs.
    vm.runInContext(
        'globalThis.FXCoreAssembler = FXCoreAssembler;' +
        'globalThis.Program = Program;' +
        'globalThis.regtypes = regtypes;' +
        'globalThis.common = common;' +
        'globalThis.FXLibrarySet = FXLibrarySet;' +
        'globalThis.Preprocessor = Preprocessor;' +
        'globalThis.ShuntingYard = ShuntingYard;' +
        'globalThis.LineParse = LineParse;' +
        // debug_config.js installs a debugLog that writes into the messages
        // pane. Replace it with a collector so failures surface as text.
        'globalThis.debugLog = function (msg, level) {' +
        '  __messages.push({ kind: level || "info", msg: String(msg) });' +
        '};',
        sandbox, { filename: '__export.js' });

    return sandbox;
}

// Assemble source text; returns the sim image or throws with the assembler's
// own error messages attached.
// opts.libraries is an optional { 'name.fxl': '<library>...' } map, standing in
// for the library folder the browser build asks the user to pick.
function assemble(source, name, opts) {
    const ctx = makeContext(opts);
    if (opts && opts.libraries) {
        const set = ctx.FXCoreAssembler.getLibraries();
        for (const file of Object.keys(opts.libraries)) {
            set.addFile(opts.libraries[file], file);
        }
    }
    ctx.FXCoreAssembler.sourceCode = source;
    ctx.FXCoreAssembler.lastAsm = null;
    ctx.FXCoreAssembler.lastTable = null;
    ctx.Program.filename = name || 'test.fxc';

    let okFlag = false;
    try {
        okFlag = ctx.Program.Asm_it();
    } catch (e) {
        const err = new Error(`assembler threw on ${name}: ${e.message}`);
        err.messages = ctx.__messages;
        throw err;
    }
    if (!okFlag) {
        const errs = ctx.__messages.filter(m => m.kind === 'errors').map(m => m.msg);
        const err = new Error(`assembly failed for ${name}` +
            (errs.length ? ':\n  ' + errs.join('\n  ') : ''));
        err.messages = ctx.__messages;
        throw err;
    }

    const image = ctx.FXCoreAssembler.buildSimImage();
    if (!image) throw new Error(`buildSimImage returned null for ${name}`);

    // Copy out of the VM realm so the typed arrays are ordinary Node ones.
    return {
        program: Int32Array.from(image.program),
        creg: Int32Array.from(image.creg),
        mreg: Int32Array.from(image.mreg),
        sfr: Int32Array.from(image.sfr),
        usr: image.usr.slice(),
        cfg: Object.assign({}, image.cfg),
        instructionCount: image.instructionCount,
        hex: ctx.FXCoreAssembler.assembledHex,
        expandedSource: ctx.FXCoreAssembler.expandedSource,
        messages: ctx.__messages
    };
}

// Solve one expression the way the assembler's parameter resolver does:
// tokenize, convert to RPN, evaluate. Names are not resolved, so this takes
// numbers and operators only. Throws the evaluator's own error.
function evaluate(text, ctx) {
    const c = ctx || makeContext();
    return vm.runInContext(`(function (t) {
        const yard = new ShuntingYard();
        const rpn = [];
        for (const tok of yard.ShuntingYardParse(new LineParse().Tokenize(t))) rpn.push(tok);
        return yard.Solve(rpn);
    })(${JSON.stringify(text)})`, c);
}

function assembleFile(file, opts) {
    return assemble(fs.readFileSync(file, 'utf8'), path.basename(file), opts);
}

// Load an image straight into a core.
function loadInto(core, image) {
    core.setPresets({
        creg: image.creg, mreg: image.mreg, sfr: image.sfr,
        usr: image.usr, cfg: image.cfg
    });
    core.setProgram(image.program);
    return core;
}

module.exports = { assemble, assembleFile, loadInto, makeContext, evaluate };
