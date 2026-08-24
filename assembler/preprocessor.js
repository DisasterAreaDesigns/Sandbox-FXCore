/**
 * preprocessor.js - inlines library subroutines into FXCore source.
 *
 * The command line toolchain ships a separate preprocessor that turns a .fxc
 * file containing library calls into a .fxo file with the library code pasted
 * in. This is the same job: every
 *
 *     @lib.subroutine(arg, arg, ...)
 *
 * is replaced by the body of that subroutine from a .fxl library file, with
 * the subroutine's parameter names swapped for the caller's arguments and its
 * labels made unique so the same subroutine can be called more than once.
 *
 * Equations are solved with LineParse + ShuntingYard, the same pair the
 * assembler uses in tryResolveParameter(), so an expression means the same
 * thing here as it does anywhere else in a program. Only call site arguments
 * are solved; an equation inside library code that mentions a parameter is
 * substituted and left for the assembler, which is where it would have been
 * solved had the user written it out by hand.
 *
 * Source with no library calls is returned untouched.
 */

class Preprocessor {
    constructor(libraries, options) {
        this.libraries = libraries || null;
        const opts = options || {};
        this.maxDepth = opts.maxDepth || 8;

        this.parser = new LineParse();
        this.yard = new ShuntingYard();
        this.registers = new Registers();
        this.reserved = new ReservedWords();

        this.errors = [];
        this.warnings = [];
        this.expansions = 0;
        this.used = new Set();
        this.aliases = new Map();
        this.seq = 0;
    }

    // Characters that make a parameter an expression rather than a plain name.
    // Same test the assembler uses to decide a parameter needs solving.
    static get MATH_RE() { return /[+\-*/()^|&<>]/; }

    static get CALL_RE() {
        return /^\s*(?:([A-Za-z0-9_\-]+)\s*:\s*)?@([A-Za-z0-9_\-]+)\.([A-Za-z0-9_\-]+)\s*\(/;
    }

    /**
     * Expand every library call in the source.
     * @param {string} source
     * @returns {{ok:boolean, text:string, expansions:number, errors:Array,
     *            warnings:Array, used:Array}}
     */
    process(source) {
        const text = String(source == null ? '' : source);
        this.errors = [];
        this.warnings = [];
        this.expansions = 0;
        this.used = new Set();
        this.seq = 0;

        const lines = text.split('\n');

        // Cheap bail out so a program without libraries is byte for byte the
        // same source the assembler has always seen.
        if (text.indexOf('@') === -1) {
            return this.result(text);
        }

        this.aliases = Preprocessor.scanAliases(lines);

        const out = [];
        let inBlock = false;
        for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            const stripped = Preprocessor.stripComments(raw, inBlock);
            inBlock = stripped.inBlock;

            const call = this.matchCall(stripped.code, i + 1, raw);
            if (!call) {
                out.push(raw);
                continue;
            }
            this.expandCall(raw, call, i + 1, 0, out, null);
        }

        if (this.expansions === 0 && this.errors.length === 0) {
            return this.result(text);
        }
        return this.result(out.join('\n'));
    }

    result(text) {
        return {
            ok: this.errors.length === 0,
            text: text,
            expansions: this.expansions,
            errors: this.errors.slice(),
            warnings: this.warnings.slice(),
            used: Array.from(this.used)
        };
    }

    error(linenum, linetext, message) {
        this.errors.push({ line: linenum, text: linetext, message: message });
    }

    warn(linenum, linetext, message) {
        this.warnings.push({ line: linenum, text: linetext, message: message });
    }

    // ---------------------------------------------------------------------
    // Line helpers
    // ---------------------------------------------------------------------

    /**
     * Remove line and block comments from one line of source.
     * @returns {{code:string, inBlock:boolean}}
     */
    static stripComments(line, inBlock) {
        let src = String(line);
        let out = '';
        let i = 0;
        let block = !!inBlock;

        while (i < src.length) {
            if (block) {
                const end = src.indexOf('*/', i);
                if (end === -1) return { code: out, inBlock: true };
                block = false;
                i = end + 2;
                continue;
            }
            const ch = src.charAt(i);
            if (ch === ';') break;
            if (ch === '/' && src.charAt(i + 1) === '/') break;
            if (ch === '/' && src.charAt(i + 1) === '*') {
                block = true;
                i += 2;
                continue;
            }
            out += ch;
            i++;
        }
        return { code: out, inBlock: block };
    }

    /**
     * Collect ".rn alias register" so an argument like "bypstate" can be
     * checked against a parameter declared MREG. Returns alias -> regtype.
     */
    static scanAliases(lines) {
        const raw = new Map();
        let inBlock = false;
        for (const line of lines) {
            const stripped = Preprocessor.stripComments(line, inBlock);
            inBlock = stripped.inBlock;
            const m = /^\s*\.RN(?:\.[A-Z])?\s+([A-Za-z0-9_\-!#]+)\s+([A-Za-z0-9_\-!#]+)/i.exec(stripped.code);
            if (m) raw.set(m[1].toUpperCase(), m[2].toUpperCase());
        }

        const regs = new Registers();
        const out = new Map();
        for (const alias of raw.keys()) {
            let target = alias;
            let kind = null;
            for (let hop = 0; hop < 8; hop++) {
                const next = raw.get(target);
                if (next === undefined) break;
                target = next;
                kind = regs.regset(target);
                if (kind) break;
            }
            if (kind) out.set(alias, kind);
        }
        return out;
    }

    /**
     * Recognise "@lib.sub(a, b, c)", optionally after a label. Returns null if
     * the line has no call; records an error if the call is malformed.
     */
    matchCall(code, linenum, rawline) {
        const m = Preprocessor.CALL_RE.exec(code);
        if (!m) return null;

        const open = m[0].length - 1; // index of "(" within code
        let depth = 0;
        let close = -1;
        for (let i = open; i < code.length; i++) {
            const ch = code.charAt(i);
            if (ch === '(') depth++;
            else if (ch === ')') {
                depth--;
                if (depth === 0) { close = i; break; }
            }
        }
        if (close === -1) {
            this.error(linenum, rawline, `unclosed "(" in call to @${m[2]}.${m[3]}`);
            return null;
        }

        const trailing = code.substring(close + 1).trim();
        if (trailing.length) {
            this.error(linenum, rawline,
                `a library call must be the only statement on its line, found "${trailing}" after @${m[2]}.${m[3]}(...)`);
            return null;
        }

        return {
            label: m[1] || null,
            lib: m[2],
            sub: m[3],
            args: Preprocessor.splitArgs(code.substring(open + 1, close))
        };
    }

    /** Split an argument list on top level commas. */
    static splitArgs(text) {
        const body = text.trim();
        if (!body.length) return [];
        const args = [];
        let depth = 0;
        let cur = '';
        for (let i = 0; i < body.length; i++) {
            const ch = body.charAt(i);
            if (ch === '(') depth++;
            if (ch === ')') depth--;
            if (ch === ',' && depth === 0) {
                args.push(cur.trim());
                cur = '';
                continue;
            }
            cur += ch;
        }
        args.push(cur.trim());
        return args;
    }

    /** Every "label:" defined inside a block of library code, upper case. */
    static collectLabels(code) {
        const labels = new Set();
        let inBlock = false;
        for (const line of String(code).split('\n')) {
            const stripped = Preprocessor.stripComments(line, inBlock);
            inBlock = stripped.inBlock;
            let rest = stripped.code.trim();
            let m;
            while ((m = /^([A-Za-z0-9_\-]+)\s*:\s*/.exec(rest)) !== null) {
                labels.add(m[1].toUpperCase());
                rest = rest.substring(m[0].length).trim();
            }
        }
        return labels;
    }

    // ---------------------------------------------------------------------
    // Expansion
    // ---------------------------------------------------------------------

    /**
     * Write the expansion of one call into out[].
     * @param {string} rawline   the source line, kept as a comment
     * @param {object} call      from matchCall()
     * @param {number} linenum   1 based line in the original source
     * @param {number} depth     nesting depth, libraries may call libraries
     * @param {Array}  out       lines written so far
     * @param {string} tagIn     label suffix override for nested calls
     */
    expandCall(rawline, call, linenum, depth, out, tagIn) {
        const tag = tagIn || String(linenum);

        out.push('// ' + rawline.replace(/\s+$/, ''));
        if (call.label) out.push(call.label.toUpperCase() + ': ');

        if (!this.libraries || this.libraries.size === 0) {
            this.error(linenum, rawline,
                `call to @${call.lib}.${call.sub}() but no libraries are loaded - ` +
                `choose a library folder in Options`);
            return;
        }

        const lib = this.libraries.get(call.lib);
        if (!lib) {
            this.error(linenum, rawline,
                `unknown library "${call.lib}" (loaded: ${this.libraries.names().join(', ') || 'none'})`);
            return;
        }

        const sub = lib.sub(call.sub);
        if (!sub) {
            this.error(linenum, rawline,
                `library "${lib.name}" has no subroutine "${call.sub}" ` +
                `(available: ${lib.subNames().join(', ')})`);
            return;
        }

        if (sub.params.length !== call.args.length) {
            const expect = sub.params.map(p => `${p.name}:${p.type}`).join(', ');
            this.error(linenum, rawline,
                `@${lib.name}.${sub.name}() takes ${sub.params.length} argument(s) ` +
                `but ${call.args.length} were given - expected (${expect})`);
            return;
        }

        const bindings = new Map();
        let bindOk = true;
        for (let i = 0; i < sub.params.length; i++) {
            const bound = this.bindArgument(sub.params[i], call.args[i], lib, sub, i, linenum, rawline);
            if (!bound) { bindOk = false; continue; }
            const key = sub.params[i].name.toUpperCase();
            if (bindings.has(key)) {
                this.warn(linenum, rawline,
                    `@${lib.name}.${sub.name}() declares parameter "${sub.params[i].name}" twice`);
            }
            bindings.set(key, bound);
        }
        if (!bindOk) return;

        this.emitBody(lib, sub, bindings, tag, depth, linenum, rawline, out);

        out.push(`// end inclusion library ${lib.name} --  subroutine ${sub.name}`);
        out.push('');
        this.expansions++;
        this.used.add(lib.name);
    }

    /**
     * Work out what text replaces one parameter. Expressions passed as
     * arguments are solved here so they cannot be broken apart by the
     * operators around the parameter inside the library code.
     */
    bindArgument(param, argText, lib, sub, index, linenum, rawline) {
        const type = (param.type || 'ANY').toUpperCase();
        const arg = String(argText).trim();

        if (!arg.length) {
            this.error(linenum, rawline,
                `argument ${index + 1} of @${lib.name}.${sub.name}() is empty ` +
                `(parameter "${param.name}")`);
            return null;
        }

        const isReg = (type === 'MREG' || type === 'CREG' || type === 'SREG');

        if (Preprocessor.MATH_RE.test(arg)) {
            if (isReg) {
                this.warn(linenum, rawline,
                    `argument ${index + 1} "${arg}" of @${lib.name}.${sub.name}() looks like an ` +
                    `expression but parameter "${param.name}" is a ${type}`);
                return { arg: arg, type: type, param: param.name.toUpperCase() };
            }
            const solved = this.solveEquation(arg);
            if (solved !== null) {
                return { arg: Preprocessor.formatNumber(solved), type: type, param: param.name.toUpperCase() };
            }
            // Not solvable yet - most likely it uses a .equ the symbol table
            // has not built. Parenthesise so the assembler sees the same value
            // wherever the parameter lands.
            return { arg: '(' + arg + ')', type: type, param: param.name.toUpperCase() };
        }

        if (isReg) {
            const actual = this.registerKindOf(arg);
            if (actual && actual !== type.toLowerCase()) {
                this.error(linenum, rawline,
                    `argument ${index + 1} "${arg}" of @${lib.name}.${sub.name}() is a ` +
                    `${actual.toUpperCase()} but parameter "${param.name}" is a ${type}`);
                return null;
            }
        }

        return { arg: arg, type: type, param: param.name.toUpperCase() };
    }

    emitBody(lib, sub, bindings, tag, depth, linenum, rawline, out) {
        const labels = Preprocessor.collectLabels(sub.code);
        const prefix = `// from library: ${lib.name} -- subroutine: ${sub.name} -- `;
        const bodyLines = String(sub.code).split('\n');
        let inBlock = false;

        for (const bodyLine of bodyLines) {
            const stripped = Preprocessor.stripComments(bodyLine, inBlock);
            inBlock = stripped.inBlock;
            let code = stripped.code.trim();
            if (!code.length) continue;

            // A library may call another library.
            const nested = this.matchCall(code, linenum, rawline);
            if (nested) {
                if (depth + 1 >= this.maxDepth) {
                    this.error(linenum, rawline,
                        `library calls nested more than ${this.maxDepth} deep at ` +
                        `@${lib.name}.${sub.name}() - is a subroutine calling itself?`);
                    return;
                }
                nested.args = nested.args.map(a => this.substitute(a, bindings, labels, tag));
                this.seq++;
                this.expandCall(code, nested, linenum, depth + 1, out, `${tag}_${this.seq}`);
                continue;
            }

            // Labels first, each on its own line, suffixed so repeated calls
            // to the same subroutine do not collide.
            let m;
            while ((m = /^([A-Za-z0-9_\-]+)\s*:\s*/.exec(code)) !== null) {
                out.push(`${m[1].toUpperCase()}_${tag}: `);
                code = code.substring(m[0].length).trim();
            }
            if (!code.length) continue;

            const segs = code.split(',');
            const head = segs[0].trim();
            const gap = head.search(/\s/);
            let mnemonic = head;
            const operands = [];
            if (gap !== -1) {
                mnemonic = head.substring(0, gap);
                const first = head.substring(gap + 1).trim();
                if (first.length) operands.push(first);
            }
            for (let k = 1; k < segs.length; k++) operands.push(segs[k].trim());

            const notes = [];
            const emitted = operands.map(op => {
                const upper = op.toUpperCase();
                if (labels.has(upper)) return `${upper}_${tag}`;
                if (bindings.has(upper)) {
                    const bind = bindings.get(upper);
                    notes.push(`matching ${upper} with ${bind.arg.toUpperCase()} type ${bind.type} -- `);
                    return bind.arg.toUpperCase();
                }
                if (Preprocessor.MATH_RE.test(op)) {
                    notes.push(' Complex equation substitution');
                    return this.substitute(op, bindings, labels, tag).toUpperCase();
                }
                return upper;
            });

            let line = mnemonic.toUpperCase();
            if (emitted.length) line += ' ' + emitted.join(' , ');
            out.push(line + '    ' + prefix + notes.join(''));
        }
    }

    /** Replace whole-word parameter names and local labels inside a fragment. */
    substitute(text, bindings, labels, tag) {
        return String(text).replace(/[A-Za-z_][A-Za-z0-9_]*/g, word => {
            const upper = word.toUpperCase();
            if (labels && labels.has(upper)) return `${upper}_${tag}`;
            if (bindings.has(upper)) return bindings.get(upper).arg;
            return word;
        });
    }

    // ---------------------------------------------------------------------
    // Equations and registers
    // ---------------------------------------------------------------------

    /** Which register bank a name belongs to, following .rn aliases. */
    registerKindOf(name) {
        const upper = String(name).toUpperCase();
        if (this.aliases.has(upper)) return this.aliases.get(upper);
        const direct = this.registers.regset(upper);
        if (direct) return direct;
        return this.registers.altregset(upper);
    }

    /**
     * Solve an expression the way the assembler does, but with only the names
     * that exist before the symbol table is built: reserved words and register
     * names. Returns null when a name cannot be resolved yet, which leaves the
     * expression for the assembler to finish.
     */
    solveEquation(text) {
        try {
            const tokens = this.parser.Tokenize(String(text));
            const rpn = [];
            for (const tok of this.yard.ShuntingYardParse(tokens)) rpn.push(tok);

            const resolved = [];
            for (const tok of rpn) {
                if (tok.Type === 'STRN') {
                    let name = String(tok.Value);
                    let negate = false;
                    if (name.charAt(0) === '-') {
                        negate = true;
                        name = name.substring(1);
                    }
                    const upper = name.toUpperCase();
                    let value = null;
                    if (this.reserved.isreserved(upper)) {
                        value = this.reserved.value(upper);
                    } else {
                        const bank = this.registers.regset(upper);
                        if (bank) {
                            const info = this.registers.value(upper, bank);
                            if (info) value = info.number;
                        }
                    }
                    if (value === null || value === undefined) return null;
                    if (negate) value = -value;
                    const asText = String(value);
                    resolved.push({ Type: this.parser.DetermineType(asText), Value: asText });
                } else if (tok.Type === 'HEX') {
                    resolved.push({ Type: 'INT', Value: String(parseInt(tok.Value.substring(2), 16)) });
                } else if (tok.Type === 'BINARY') {
                    resolved.push({ Type: 'INT', Value: String(parseInt(tok.Value.substring(2).replace(/_/g, ''), 2)) });
                } else {
                    resolved.push(tok);
                }
            }

            const value = this.yard.Solve(resolved);
            if (typeof value !== 'number' || !isFinite(value)) return null;
            return value;
        } catch (e) {
            // ShuntingYard reports its own errors and bails out; treat that as
            // "cannot solve here" and let the assembler have a go.
            return null;
        }
    }

    /** Print a solved value in a form the assembler's tokenizer accepts. */
    static formatNumber(value) {
        if (Number.isInteger(value)) return String(value);
        let text = String(value);
        if (text.indexOf('e') !== -1 || text.indexOf('E') !== -1) {
            text = value.toFixed(12).replace(/0+$/, '');
            if (text.endsWith('.')) text += '0';
        }
        return text;
    }

    /** True if the source contains anything that looks like a library call. */
    static hasLibCall(source) {
        const text = String(source == null ? '' : source);
        if (text.indexOf('@') === -1) return false;
        let inBlock = false;
        for (const line of text.split('\n')) {
            const stripped = Preprocessor.stripComments(line, inBlock);
            inBlock = stripped.inBlock;
            if (Preprocessor.CALL_RE.test(stripped.code)) return true;
        }
        return false;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Preprocessor;
}
