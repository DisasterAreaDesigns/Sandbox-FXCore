/**
 * fxl_library.js - reader for FXCore .fxl library files.
 *
 * A .fxl file is a small XML document describing one library of subroutines:
 *
 *   <library>
 *     <name>lx</name>
 *     <desc>Framework Library for LX Series Pedals</desc>
 *     <sub>
 *       <name>fs4bypass</name>
 *       <desc>handles bypass switch and fader with SW4</desc>
 *       <param>
 *         <name>bypstate_sub</name><side>L</side>
 *         <type>MREG</type><desc>bypass state</desc>
 *       </param>
 *       <code> ... FXCore assembly ... </code>
 *     </sub>
 *   </library>
 *
 * The XML is read here rather than with DOMParser for two reasons: the same
 * code has to run in the browser and in the Node test harness, and the <code>
 * body is assembly rather than XML, so "<<" and ">>" have to survive whether
 * or not the library author escaped them.
 */

// Tags whose body is taken verbatim up to the matching close tag instead of
// being parsed as markup.
const FXL_RAW_TAGS = ['code'];

function fxlDecodeEntities(text) {
    if (text.indexOf('&') === -1) return text;
    return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body) => {
        if (body.charAt(0) === '#') {
            const hex = (body.charAt(1) === 'x' || body.charAt(1) === 'X');
            const cp = hex ? parseInt(body.substring(2), 16) : parseInt(body.substring(1), 10);
            if (!isFinite(cp) || cp < 0 || cp > 0x10FFFF) return whole;
            return String.fromCodePoint(cp);
        }
        switch (body.toLowerCase()) {
            case 'lt': return '<';
            case 'gt': return '>';
            case 'amp': return '&';
            case 'quot': return '"';
            case 'apos': return "'";
            default: return whole;
        }
    });
}

/**
 * Parse XML text into a tree of { tag, text, children }.
 * Throws Error with a human readable message on malformed markup.
 */
function fxlParseXml(text) {
    const root = { tag: '#root', text: '', children: [] };
    const stack = [root];
    const len = text.length;
    let i = 0;

    while (i < len) {
        const lt = text.indexOf('<', i);
        if (lt === -1) {
            stack[stack.length - 1].text += fxlDecodeEntities(text.substring(i));
            break;
        }
        if (lt > i) {
            stack[stack.length - 1].text += fxlDecodeEntities(text.substring(i, lt));
        }

        if (text.startsWith('<!--', lt)) {
            const end = text.indexOf('-->', lt + 4);
            if (end === -1) throw new Error('unterminated comment');
            i = end + 3;
            continue;
        }
        if (text.startsWith('<![CDATA[', lt)) {
            const end = text.indexOf(']]>', lt + 9);
            if (end === -1) throw new Error('unterminated CDATA section');
            stack[stack.length - 1].text += text.substring(lt + 9, end);
            i = end + 3;
            continue;
        }
        if (text.startsWith('<?', lt) || text.startsWith('<!', lt)) {
            const end = text.indexOf('>', lt);
            if (end === -1) throw new Error('unterminated XML declaration');
            i = end + 1;
            continue;
        }

        const gt = text.indexOf('>', lt);
        if (gt === -1) throw new Error('unterminated tag');
        let inner = text.substring(lt + 1, gt).trim();

        // Closing tag
        if (inner.charAt(0) === '/') {
            const tag = inner.substring(1).trim().toLowerCase();
            const top = stack[stack.length - 1];
            if (stack.length === 1 || top.tag !== tag) {
                throw new Error(`unexpected closing tag </${tag}>`);
            }
            stack.pop();
            i = gt + 1;
            continue;
        }

        const selfClose = inner.endsWith('/');
        if (selfClose) inner = inner.substring(0, inner.length - 1).trim();
        const tag = inner.split(/\s/)[0].toLowerCase();
        if (!tag) throw new Error('empty tag name');

        const node = { tag: tag, text: '', children: [] };
        stack[stack.length - 1].children.push(node);
        if (selfClose) {
            i = gt + 1;
            continue;
        }

        if (FXL_RAW_TAGS.indexOf(tag) !== -1) {
            const rest = text.substring(gt + 1);
            const close = new RegExp('</\\s*' + tag + '\\s*>', 'i').exec(rest);
            if (!close) throw new Error(`unterminated <${tag}> block`);
            node.text = fxlDecodeEntities(rest.substring(0, close.index));
            i = gt + 1 + close.index + close[0].length;
            continue;
        }

        stack.push(node);
        i = gt + 1;
    }

    if (stack.length !== 1) {
        throw new Error(`unclosed <${stack[stack.length - 1].tag}>`);
    }
    return root;
}

function fxlChildren(node, tag) {
    return node.children.filter(c => c.tag === tag);
}

function fxlChild(node, tag) {
    return node.children.find(c => c.tag === tag) || null;
}

function fxlText(node, tag) {
    const child = fxlChild(node, tag);
    return child ? child.text.trim() : '';
}

/**
 * One library file: a name plus a set of subroutines keyed by upper case name.
 */
class FXLibrary {
    constructor(name, desc, file) {
        this.name = name;
        this.desc = desc;
        this.file = file || '';
        this.color = '';
        this.textColor = '';
        this.subs = new Map(); // UPPERCASE name -> sub
    }

    sub(name) {
        return this.subs.get(String(name).toUpperCase()) || null;
    }

    subNames() {
        return Array.from(this.subs.values()).map(s => s.name);
    }

    /**
     * Build a library from .fxl text. Throws on malformed XML or a missing
     * library name; individual malformed subs are reported in warnings.
     */
    static fromXml(text, file) {
        const warnings = [];
        const root = fxlParseXml(text);
        const libNode = fxlChild(root, 'library');
        if (!libNode) throw new Error('no <library> element found');

        const name = fxlText(libNode, 'name');
        if (!name) throw new Error('<library> has no <name>');

        const lib = new FXLibrary(name, fxlText(libNode, 'desc'), file);
        lib.color = fxlText(libNode, 'lib_color');
        lib.textColor = fxlText(libNode, 'lib_text_color');

        for (const subNode of fxlChildren(libNode, 'sub')) {
            const subName = fxlText(subNode, 'name');
            if (!subName) {
                warnings.push(`${file || 'library'}: a <sub> has no <name>, skipped`);
                continue;
            }
            const codeNode = fxlChild(subNode, 'code');
            if (!codeNode) {
                warnings.push(`${file || 'library'}: subroutine "${subName}" has no <code>, skipped`);
                continue;
            }

            const params = [];
            let badParam = false;
            for (const p of fxlChildren(subNode, 'param')) {
                const pname = fxlText(p, 'name');
                if (!pname) {
                    warnings.push(`${file || 'library'}: subroutine "${subName}" has a <param> with no <name>, skipped`);
                    badParam = true;
                    break;
                }
                params.push({
                    name: pname,
                    type: (fxlText(p, 'type') || 'ANY').toUpperCase(),
                    side: (fxlText(p, 'side') || '').toUpperCase(),
                    desc: fxlText(p, 'desc')
                });
            }
            if (badParam) continue;

            const key = subName.toUpperCase();
            if (lib.subs.has(key)) {
                warnings.push(`${file || 'library'}: subroutine "${subName}" declared more than once, later one wins`);
            }
            lib.subs.set(key, {
                name: subName,
                desc: fxlText(subNode, 'desc'),
                params: params,
                code: codeNode.text
            });
        }

        lib.warnings = warnings;
        return lib;
    }
}

/**
 * Every library the user has made available, keyed by upper case library name.
 * A library folder maps to one of these; names are what appears after the "@"
 * in a call such as "@lx.fs4bypass(...)".
 */
class FXLibrarySet {
    constructor() {
        this.libs = new Map();
    }

    clear() {
        this.libs.clear();
    }

    get size() {
        return this.libs.size;
    }

    /**
     * Add one .fxl file. Returns { name, subs, warnings }.
     * Throws Error if the file cannot be read as a library.
     */
    addFile(text, file) {
        const lib = FXLibrary.fromXml(text, file);
        const warnings = (lib.warnings || []).slice();
        const key = lib.name.toUpperCase();
        const existing = this.libs.get(key);
        if (existing) {
            warnings.push(`library "${lib.name}" is defined in both ` +
                `${existing.file || 'an earlier file'} and ${file || 'this file'}, ` +
                `using ${file || 'the later one'}`);
        }
        this.libs.set(key, lib);
        return { name: lib.name, subs: lib.subNames(), warnings: warnings };
    }

    get(name) {
        return this.libs.get(String(name).toUpperCase()) || null;
    }

    getSub(libName, subName) {
        const lib = this.get(libName);
        return lib ? lib.sub(subName) : null;
    }

    names() {
        return Array.from(this.libs.values()).map(l => l.name);
    }

    subCount() {
        let n = 0;
        for (const lib of this.libs.values()) n += lib.subs.size;
        return n;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { FXLibrary, FXLibrarySet, fxlParseXml };
}
