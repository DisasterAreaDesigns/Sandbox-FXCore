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
 * labels, memory blocks and equates made unique so the same subroutine can be
 * called more than once.
 *
 * Library code is tokenized with LineParse rather than split on commas, so a
 * declaration is recognised as a declaration and its name can be renamed:
 *
 *   .mem     the block name gains a _NN suffix, NN being the line the call sits
 *   .equ     on, so two calls to one subroutine get one allocation each. The
 *            base name is remembered so later references in the same expansion
 *            follow the rename, and for a block the ! (length) and # (tail)
 *            suffixes are re-applied after it.
 *
 *            A subroutine marked <type>header</type> in the .fxl instead
 *            declares globally: the name is written as the library spelled it
 *            and nothing is renamed. That is what lets a header subroutine be
 *            called once to set up the equates and delay memory that the rest
 *            of the program, and every other call into the same library, refer
 *            to by name.
 *
 *   .mreg    the register named may itself be a passed parameter, so it is
 *   .creg    substituted, and the value is processed like a .equ value.
 *   .sreg
 *   .rn
 *
 * Memory operands are resolved against the renamed blocks: the first operand
 * of WRDEL, and the second of MACRD, MACID, MACHRD, MACHID, RDDEL, APA, APB,
 * APRA, APRB, CHR, PITCH and INTERP. Jump targets and the labels they point at
 * are suffixed together so repeat calls do not collide.
 *
 * Equations are solved with LineParse + ShuntingYard, the same pair the
 * assembler uses in tryResolveParameter(), so an expression means the same
 * thing here as it does anywhere else in a program. Only call site arguments
 * are solved; one that cannot be solved yet is parenthesised so the operators
 * around the parameter inside the library cannot pull it apart. An equation
 * inside library code that mentions a parameter is substituted and left for
 * the assembler, which is where it would have been solved had the user written
 * it out by hand.
 *
 * A library may call a library. Source with no library calls is returned
 * untouched.
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

    /**
     * "@lib.sub(" at the head of a line, optionally after a label. The names
     * either side of the dot are taken as anything that is not whitespace, a
     * parenthesis or an @, matching the command line tool, which concatenates
     * every token between the @ and the open paren.
     */
    static get CALL_RE() {
        return /^\s*(?:([A-Za-z0-9_\-]+)\s*:\s*)?@([^\s()@]+)\s*\(/;
    }

    /** JMP takes only a label. */
    static get JMP_SINGLE() { return new Set(['JMP']); }

    /** These take "creg , label". */
    static get JMP_DOUBLE() { return new Set(['JGEZ', 'JNEG', 'JNZ', 'JZ', 'JZC']); }

    /** Instructions whose first operand is a memory address. */
    static get MEM1S() { return new Set(['WRDEL']); }

    /** Instructions whose second operand is a memory address. */
    static get MEM2S() {
        return new Set([
            'MACRD', 'MACID', 'MACHRD', 'MACHID',
            'RDDEL', 'APA', 'APB', 'APRA', 'APRB',
            'CHR', 'PITCH', 'INTERP'
        ]);
    }

    /** Declarations, which name something rather than taking an operand list. */
    static get DIRECTIVES() {
        return new Set([
            'MEM_DIRECTIVE', 'EQU_DIRECTIVE', 'RN_DIRECTIVE',
            'MREG_DIRECTIVE', 'CREG_DIRECTIVE', 'SREG_DIRECTIVE'
        ]);
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
     * Remove line and block comments from one line of source. Shared with the
     * assembler and the symbol table so all three agree on what a comment is.
     * @returns {{code:string, inBlock:boolean}}
     */
    static stripComments(line, inBlock) {
        return common.stripComments(line, inBlock);
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

        // Split on the first dot only: a subroutine name may contain more.
        const dot = m[2].indexOf('.');
        if (dot === -1) {
            this.error(linenum, rawline,
                `library call "@${m[2]}(" is missing the dot between the library ` +
                `name and the subroutine name - expected "@lib.sub(...)"`);
            return null;
        }
        const libName = m[2].substring(0, dot);
        const subName = m[2].substring(dot + 1);

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
            this.error(linenum, rawline, `unclosed "(" in call to @${libName}.${subName}`);
            return null;
        }

        const trailing = code.substring(close + 1).trim();
        if (trailing.length) {
            this.error(linenum, rawline,
                `a library call must be the only statement on its line, found "${trailing}" after @${libName}.${subName}(...)`);
            return null;
        }

        return {
            label: m[1] || null,
            lib: libName,
            sub: subName,
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

        // matcher maps a name the library uses to the text that replaces it:
        // parameters first, then the memory blocks and equates the body goes on
        // to declare. typer remembers what each one is, for the annotation.
        const matcher = new Map();
        const typer = new Map();
        let bindOk = true;
        for (let i = 0; i < sub.params.length; i++) {
            const bound = this.bindArgument(sub.params[i], call.args[i], lib, sub, i, linenum, rawline);
            if (!bound) { bindOk = false; continue; }
            const key = sub.params[i].name.toUpperCase();
            if (matcher.has(key)) {
                this.warn(linenum, rawline,
                    `@${lib.name}.${sub.name}() declares parameter "${sub.params[i].name}" twice`);
            }
            matcher.set(key, bound.arg.toUpperCase());
            typer.set(key, bound.type);
        }
        if (!bindOk) return;

        this.emitBody(lib, sub, matcher, typer, tag, depth, linenum, rawline, out);

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
                return { arg: arg, type: type };
            }
            const solved = this.solveEquation(arg);
            if (solved !== null) {
                return { arg: Preprocessor.formatNumber(solved), type: type };
            }
            // Not solvable yet - most likely it uses a .equ the symbol table
            // has not built. Parenthesise so the assembler sees the same value
            // wherever the parameter lands.
            return { arg: '(' + arg + ')', type: type };
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

        return { arg: arg, type: type };
    }

    // ---------------------------------------------------------------------
    // Body emission
    // ---------------------------------------------------------------------

    /**
     * Walk the subroutine body a line at a time, renaming what has to be
     * unique to this expansion and substituting the caller's arguments.
     */
    emitBody(lib, sub, matcher, typer, tag, depth, linenum, rawline, out) {
        const labels = Preprocessor.collectLabels(sub.code);
        const prefix = `// from library: ${lib.name} -- subroutine: ${sub.name} -- `;
        // Memory blocks this expansion declares, so a later operand naming one
        // follows the rename even though the caller never mentioned it.
        const memblocks = [];
        // A header subroutine declares globally: its equates keep the name the
        // library gave them so every call site can refer to the same symbol.
        const headerType = !!sub.headerType;

        let inBlock = false;
        for (const bodyLine of String(sub.code).split('\n')) {
            const stripped = Preprocessor.stripComments(bodyLine, inBlock);
            inBlock = stripped.inBlock;
            const code = stripped.code.trim();
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
                nested.args = nested.args.map(a => this.substitute(a, matcher, labels, tag));
                this.seq++;
                this.expandCall(code, nested, linenum, depth + 1, out, `${tag}_${this.seq}`);
                continue;
            }

            const tokens = this.tokenize(code.toUpperCase());
            if (!tokens.length) continue;

            this.emitLine(tokens, matcher, typer, memblocks, labels, tag,
                          headerType, prefix, linenum, rawline, lib, sub, out);
        }
    }

    /**
     * Tokenize one library line and drop what carries no meaning: whitespace,
     * the end of line marker and any comment the stripper left behind.
     */
    tokenize(line) {
        let raw;
        try {
            raw = this.parser.Tokenize(line);
        } catch (e) {
            return [{ Type: 'STRN', Value: line }];
        }
        const out = [];
        for (const tok of raw) {
            if (tok.Type === 'SPACE' || tok.Type === 'TAB' || tok.Type === 'EOL') continue;
            if (tok.Type === 'EMPTY') continue;
            out.push(tok);
        }
        return out;
    }

    /** Emit one already tokenized library line. */
    emitLine(tokens, matcher, typer, memblocks, labels, tag,
             headerType, prefix, linenum, rawline, lib, sub, out) {
        let i = 0;

        // Labels first, each on its own line, suffixed so repeated calls to the
        // same subroutine do not collide.
        while (i < tokens.length && tokens[i].Type === 'JMP_LABEL') {
            const bare = tokens[i].Value.trim().replace(/:$/, '');
            out.push(`${bare}_${tag}: `);
            i++;
        }
        if (i >= tokens.length) return;

        const head = tokens[i];
        const rest = tokens.slice(i + 1);
        const notes = [];

        if (Preprocessor.DIRECTIVES.has(head.Type)) {
            out.push(this.emitDirective(head, rest, matcher, typer, memblocks,
                                        tag, headerType) + '    ' + prefix);
            return;
        }

        const mnemonic = head.Value.trim();
        const operands = Preprocessor.splitOperands(rest);
        const emitted = operands.map((opTokens, index) =>
            this.resolveOperand(opTokens, index, mnemonic, matcher, typer,
                                memblocks, labels, tag, notes, linenum, rawline, lib, sub));

        let line = mnemonic;
        if (emitted.length) line += ' ' + emitted.join(' , ');
        out.push(line + '    ' + prefix + notes.join(''));
    }

    /**
     * Emit a declaration. The name is what has to be got right: a .mem block
     * and a .equ are renamed for this expansion and remembered so the rest of
     * the body follows, unless the subroutine is a header, in which case both
     * keep their names so they land in the program once under the spelling
     * every caller uses. A register name may itself have been passed in.
     */
    emitDirective(head, rest, matcher, typer, memblocks, tag, headerType) {
        const kind = head.Type;
        const keyword = head.Value.trim();
        if (!rest.length) return keyword;

        const declared = rest[0].Value.trim();
        const value = rest.slice(1);
        let name;

        if (kind === 'MEM_DIRECTIVE') {
            if (headerType) {
                // Global: the block keeps its name, so this subroutine, the
                // rest of the program and every other subroutine in the library
                // all address the one allocation. Nothing is registered for
                // renaming, which leaves those references to pass through.
                name = declared;
            } else {
                name = declared + '_' + tag;
                memblocks.push(declared);
                // The bare name, its length (!) and its tail (#) all follow.
                if (!matcher.has(declared)) {
                    matcher.set(declared, name);
                    typer.set(declared, 'Internal mem');
                }
                if (!matcher.has(declared + '!')) {
                    matcher.set(declared + '!', name + '!');
                    typer.set(declared + '!', 'Internal mem length');
                }
                if (!matcher.has(declared + '#')) {
                    matcher.set(declared + '#', name + '#');
                    typer.set(declared + '#', 'Internal mem tail');
                }
            }
        } else if (kind === 'EQU_DIRECTIVE') {
            if (headerType) {
                // Global: written as the library spelled it.
                name = declared;
            } else {
                name = declared + '_' + tag;
                if (!matcher.has(declared)) {
                    matcher.set(declared, name);
                    typer.set(declared, 'Local equate');
                }
            }
        } else {
            // .mreg / .creg / .sreg / .rn - the name may be a passed parameter.
            name = matcher.has(declared) ? matcher.get(declared) : declared;
        }

        let text = keyword + ' ' + name;
        if (value.length) {
            const valueText = value.map(t =>
                t.Type === 'STRN'
                    ? this.resolveMemToken(t.Value, matcher, memblocks, tag)
                    : t.Value.trim()
            ).join('');
            text += '\t' + valueText;

            // A .rn names a register for the rest of the program, so remember
            // which bank it lands in. Without this an argument to a later call
            // would be a name scanAliases never saw - it only reads the source
            // as the user wrote it - so a CREG handed to an MREG parameter
            // would go unchecked here and surface further on as the assembler
            // failing to find the register.
            if (kind === 'RN_DIRECTIVE') {
                const bank = this.registerKindOf(valueText);
                if (bank) this.aliases.set(name.trim().toUpperCase(), bank);
            }
        }
        return text;
    }

    /** Split the tokens after a mnemonic into operands on top level commas. */
    static splitOperands(tokens) {
        const operands = [];
        let cur = [];
        let depth = 0;
        for (const tok of tokens) {
            if (tok.Type === 'OPEN_PAREN') depth++;
            if (tok.Type === 'CLOSE_PAREN') depth--;
            if (tok.Type === 'COMMA' && depth === 0) {
                operands.push(cur);
                cur = [];
                continue;
            }
            cur.push(tok);
        }
        if (cur.length) operands.push(cur);
        return operands;
    }

    /**
     * Resolve one operand. Which rule applies depends on where the operand sits
     * in the instruction: a jump target is a label, the memory instructions
     * take an address in a known position, and everything else is a plain
     * parameter substitution.
     */
    resolveOperand(opTokens, index, mnemonic, matcher, typer, memblocks,
                   labels, tag, notes, linenum, rawline, lib, sub) {
        const text = opTokens.map(t => t.Value.trim()).join('');

        // Jump targets: the label gets the same suffix its definition did.
        const isJumpTarget =
            (Preprocessor.JMP_SINGLE.has(mnemonic) && index === 0) ||
            (Preprocessor.JMP_DOUBLE.has(mnemonic) && index === 1);
        if (isJumpTarget) {
            if (!text.length) {
                this.error(linenum, rawline,
                    `missing jump label in ${mnemonic} inside ${lib.name}.${sub.name} - ` +
                    `are you missing a comma?`);
                return text;
            }
            return `${text}_${tag}`;
        }

        // Memory address operands.
        const isMemOperand =
            (Preprocessor.MEM1S.has(mnemonic) && index === 0) ||
            (Preprocessor.MEM2S.has(mnemonic) && index === 1);
        if (isMemOperand) {
            return opTokens.map(t =>
                t.Type === 'STRN'
                    ? this.resolveMemToken(t.Value, matcher, memblocks, tag)
                    : t.Value.trim()
            ).join('');
        }

        const upper = text.toUpperCase();

        // A whole operand that is exactly a label or a parameter.
        if (labels.has(upper)) return `${upper}_${tag}`;
        if (matcher.has(upper)) {
            notes.push(`matching ${upper} with ${matcher.get(upper)} type ${typer.get(upper)} -- `);
            return matcher.get(upper);
        }

        // An expression mixing a parameter with operators: substitute inside it
        // and leave the arithmetic for the assembler, as the command line tool
        // does, flagging it the same way.
        if (Preprocessor.MATH_RE.test(text)) {
            notes.push(' Complex equation substitution');
        }
        return opTokens.map(t => {
            if (t.Type !== 'STRN') return t.Value.trim();
            const word = t.Value.trim().toUpperCase();
            if (labels.has(word)) return `${word}_${tag}`;
            return this.resolveGeneralToken(t.Value, matcher);
        }).join('');
    }

    /** Replace whole-word parameter names and local labels inside a fragment. */
    substitute(text, matcher, labels, tag) {
        return String(text).replace(/[A-Za-z_][A-Za-z0-9_]*/g, word => {
            const upper = word.toUpperCase();
            if (labels && labels.has(upper)) return `${upper}_${tag}`;
            if (matcher.has(upper)) return matcher.get(upper);
            return word;
        });
    }

    // ---------------------------------------------------------------------
    // Token resolution
    // ---------------------------------------------------------------------

    /**
     * Strip the decorations a name can carry before looking it up, and put them
     * back on the result: a leading minus, a trailing .U or .L half selector,
     * and the trailing ! (length) or # (tail) a memory block takes.
     */
    static peel(rawVal) {
        let core = String(rawVal).trim();
        let leader = '';
        let follower = '';

        if (core.startsWith('-')) {
            leader = '-';
            core = core.substring(1);
        }
        if (core.endsWith('.L') || core.endsWith('.U')) {
            follower = core.slice(-2);
            core = core.slice(0, -2);
        } else if (core.endsWith('!') || core.endsWith('#')) {
            follower = core.slice(-1);
            core = core.slice(0, -1);
        }
        return { leader: leader, core: core, follower: follower };
    }

    /**
     * A name in a memory operand or a declaration's value. A block this
     * expansion declared is renamed; a parameter is substituted; anything else
     * is left for the assembler.
     */
    resolveMemToken(rawVal, matcher, memblocks, tag) {
        const p = Preprocessor.peel(rawVal);

        // The whole name including its ! or # may have been registered.
        const whole = p.core + p.follower;
        if (p.follower && matcher.has(whole)) {
            return p.leader + matcher.get(whole);
        }
        if (memblocks.includes(p.core)) {
            return p.leader + p.core + '_' + tag + p.follower;
        }
        if (matcher.has(p.core)) {
            return p.leader + matcher.get(p.core) + p.follower;
        }
        return String(rawVal).trim();
    }

    /** A name in a general instruction operand. */
    resolveGeneralToken(rawVal, matcher) {
        const p = Preprocessor.peel(rawVal);
        if (matcher.has(p.core)) {
            return p.leader + matcher.get(p.core) + p.follower;
        }
        return String(rawVal).trim();
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
