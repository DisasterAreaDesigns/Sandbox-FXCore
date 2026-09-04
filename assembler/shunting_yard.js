/**
 * ShuntingYard.js - infix expressions to RPN, and RPN to a number.
 *
 * Ported from theShuntingYard.ShuntingYard in the C# command line assembler.
 *
 * Two deliberate deviations from C-like languages are kept because the C#
 * assembler has them and changing them would silently change what existing
 * programs mean:
 *
 *   - the shifts bind loosest of all, so "1 << 2 | 1" is 1 << (2|1), not
 *     (1<<2) | 1
 *   - "^" is left associative, so "2^3^2" is (2^3)^2 = 64, not 2^(3^2) = 512
 *
 * A leading "-" is attached to the number or function name by the tokenizer,
 * so "-2^2" is (-2)^2 = 4 rather than -(2^2).
 */

/**
 * The unary math functions, by the name the source writes. PI is handled
 * separately since it takes no argument.
 */
const MATH_FUNCTIONS = new Map([
    ['SIN', Math.sin],
    ['COS', Math.cos],
    ['TAN', Math.tan],
    ['EXP', Math.exp],          // base e
    ['LN', Math.log],           // base e
    ['LOG10', Math.log10],
    ['LOG2', Math.log2],
    ['FLOOR', Math.floor],
    ['CEILING', Math.ceil],
    ['ROUND', Math.round],
    ['ABS', Math.abs],
    ['TRUNCATE', Math.trunc],
    ['FACT', (x) => {
        let result = 1.0;       // "1" for x = 0 or 1
        for (let n = Math.trunc(x); n > 1; n--) result *= n;
        return result;
    }]
]);

class ShuntingYard {
    constructor() {
        /* Order of precedence, tightest binding first:
         *   Parentheses
         *   Function
         *   Exponent
         *   Mult and div
         *   Add and sub
         *   AND and OR
         *   ASL and ASR
         * NOTE: Functions are treated as numbers since they turn into a number
         */
        this.Op_Info = new Map([
            ['SRA', 0],
            ['SLA', 0],
            ['BIT_OR', 1],
            ['BIT_AND', 1],
            ['DASH', 2],
            ['ADDITION', 2],
            ['SLASH', 3],
            ['STAR', 3],
            ['CARET', 4],
            ['FUNC', 5]
        ]);
    }

    /** True when op1 does not bind tighter than op2, so op2 comes off first. */
    CompareOperators(op1, op2) {
        return this.Op_Info.get(op1) <= this.Op_Info.get(op2);
    }

    // Converts the tokens from in-fix to RPN
    *ShuntingYardParse(tokens) {
        const stack = [];
        let equ_line = '';
        const theparser = new LineParse();

        // Errors throw rather than exiting. The three callers -- the assembler's
        // parameter resolver, the symbol table and the preprocessor -- each wrap
        // this in a try/catch and report it. It used to call process.exit(1),
        // which does not exist in a browser, so a mismatched parenthesis raised
        // "process is not defined" instead of the real message, and under Node
        // it killed the whole run.
        const fail = (msg) => { throw new Error(`${msg}: "${equ_line.trim()}"`); };

        for (const tok of tokens) {
            equ_line += tok.Value.toString();
            switch (tok.Type) {
                // tokens that mean nothing in an equation. Whitespace is
                // skipped here so an expression solves the same whether or not
                // the caller squeezed the spaces out of it first: "a - b" used
                // to reach the default case below and be reported as a parse
                // error.
                case 'EMPTY':
                case 'EOL':
                case 'SPACE':
                case 'TAB':
                    break;
                // if the token is a number or a variable return it with type set to Number
                case 'HEX':
                case 'BINARY':
                case 'INT':
                case 'DEC':
                    yield tok;
                    break;
                case 'STRN': {
                    // an STRN may be a number with a .L or .U or .I attached, if so strip it and re-evaluate the type
                    const text = tok.Value.toString();
                    if (text.endsWith('.L') || text.endsWith('.U') || text.endsWith('.I')) {
                        const bare = text.substring(0, text.length - 2);
                        yield { Type: theparser.DetermineType(bare), Value: bare };
                    } else {
                        yield tok;
                    }
                    break;
                }
                // an operator: pop anything already on the stack that binds at
                // least as tightly before pushing this one
                case 'BIT_OR':
                case 'BIT_AND':
                case 'ADDITION':
                case 'DASH':
                case 'STAR':
                case 'SLASH':
                case 'CARET':
                case 'SRA':
                case 'SLA':
                case 'FUNC':
                    while (stack.length > 0 && common.Math_Op.includes(stack[stack.length - 1].Type)
                        && this.CompareOperators(tok.Type, stack[stack.length - 1].Type)) {
                        yield stack.pop();
                    }
                    stack.push(tok);
                    break;
                case 'OPEN_PAREN':
                    stack.push(tok);
                    break;
                case 'CLOSE_PAREN':
                    // pop back to the matching open paren
                    while (stack.length > 0 && stack[stack.length - 1].Type !== 'OPEN_PAREN') {
                        yield stack.pop();
                    }
                    if (stack.length === 0) {
                        fail('Mismatched parentheses, missing open parenthesis');
                    }
                    stack.pop();    // discard the open paren
                    break;
                default:
                    fail(`Equation parse error on token ${tok.Value.toString()}`);
            }
        }

        while (stack.length > 0) {
            const tok = stack.pop();
            if (tok.Type === 'OPEN_PAREN' || tok.Type === 'CLOSE_PAREN') {
                fail('Mismatched parentheses, possible missing close parentheses');
            }
            yield tok;
        }
    }

    /**
     * Evaluate an RPN token list to a single number.
     *
     * Throws on anything that does not reduce to exactly one value. It used to
     * pop blindly and return the top of the stack, so "1 +" came back as NaN
     * and "1 2" as 2, both of which then travelled on into the program as if
     * they were the number the source asked for.
     */
    Solve(thelist) {
        const stack = [];
        let the_equ = '';

        const fail = (msg) => { throw new Error(`${msg}: "${the_equ.trim()}"`); };

        // Pop the operands for a binary operator, right hand side first.
        const pop2 = (what) => {
            if (stack.length < 2) fail(`Missing operand for "${what}"`);
            const right = stack.pop();
            return [stack.pop(), right];
        };
        // The bitwise operators and the shifts work on whole numbers.
        const int2 = (what) => pop2(what).map(Math.trunc);

        for (const tok of thelist) {
            the_equ += tok.Value.toString() + ' ';

            switch (tok.Type) {
                // A number. HEX and BINARY are parsed here rather than being
                // left to parseFloat, which reads "0x10" as 0.
                case 'HEX':
                    stack.push(parseInt(tok.Value.toString().substring(2), 16));
                    break;
                case 'BINARY':
                    stack.push(parseInt(tok.Value.toString().substring(2).replace(/_/g, ''), 2));
                    break;
                case 'INT':
                case 'DEC': {
                    const value = parseFloat(tok.Value);
                    if (isNaN(value)) fail(`"${tok.Value}" is not a number`);
                    stack.push(value);
                    break;
                }

                case 'ADDITION': { const [l, r] = pop2('+'); stack.push(l + r); break; }
                case 'STAR': { const [l, r] = pop2('*'); stack.push(l * r); break; }
                case 'CARET': { const [l, r] = pop2('^'); stack.push(Math.pow(l, r)); break; }
                case 'BIT_OR': { const [l, r] = int2('|'); stack.push(l | r); break; }
                case 'BIT_AND': { const [l, r] = int2('&'); stack.push(l & r); break; }
                case 'SLA': { const [l, r] = int2('<<'); stack.push(l << r); break; }
                case 'SRA': { const [l, r] = int2('>>'); stack.push(l >> r); break; }

                case 'SLASH': {
                    const [l, r] = pop2('/');
                    if (r === 0) fail('Division by zero');
                    stack.push(l / r);
                    break;
                }

                case 'DASH':
                    // One operand means this is a negation rather than a
                    // subtraction, which happens with something like "-(a-b)".
                    if (stack.length > 1) {
                        const [l, r] = pop2('-');
                        stack.push(l - r);
                    } else if (stack.length === 1) {
                        stack.push(-stack.pop());
                    } else {
                        fail('Missing operand for "-"');
                    }
                    break;

                case 'FUNC': {
                    // A leading "-" belongs to the function name, as in "-SIN(x)"
                    let name = tok.Value.toString();
                    let sign = 1.0;
                    if (name.charAt(0) === '-') {
                        name = name.substring(1);
                        sign = -1.0;
                    }
                    name = name.toUpperCase();

                    if (name === 'PI') {
                        stack.push(sign * Math.PI);
                        break;
                    }
                    const fn = MATH_FUNCTIONS.get(name);
                    if (!fn) fail(`Unknown math function "${tok.Value}"`);
                    if (stack.length < 1) fail(`Missing argument for "${name}"`);
                    stack.push(sign * fn(stack.pop()));
                    break;
                }

                default:
                    fail(`Cannot evaluate token ${tok.Type}:${tok.Value}`);
            }
        }

        if (stack.length === 0) fail('Solution stack empty, check equations are complete and proper.');
        if (stack.length > 1) fail('Equation does not reduce to one value, check for a missing operator');
        return stack[0];
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ShuntingYard;
}
