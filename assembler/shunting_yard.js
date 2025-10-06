/**
 * ShuntingYard.js - Direct 1:1 JavaScript port of ShuntingYard.cs
 * 
 * Faithful port from C# theShuntingYard.ShuntingYard
 */

class ShuntingYard {
    constructor() {
        /* Order of precedence is:
         * Parentheses
         * Function
         * Exponent
         * Mult and div
         * Add and sub
         * AND and OR
         * ASL and ASR
         * NOTE: Functions are treated as numbers since they turn into a number
         */
        
        this.Op_Info = new Map([
            ['SRA', 0],
            ['SLA', 0],
            ['BIT_OR', 1],
            ['BIT_AND', 1],
            ['DASH', 2],
            ['ADDITION', 2],
            ['SLASH', 4],
            ['STAR', 4],
            ['CARET', 6],
            ['FUNC', 7]
        ]);
    }

    CompareOperators(op1, op2) {
        return this.Op_Info.get(op1) <= this.Op_Info.get(op2);
        //return (this.Op_Info.get(op1) < this.Op_Info.get(op2));
    }

    // Converts the tokens from in-fix to RPN
    *ShuntingYardParse(tokens) {
        const stack = [];
        let lasttok = 'EMPTY';
        let lasttok2 = 'EMPTY';
        const pushtok = {
            Type: 'EMPTY',
            Value: ''
        };
        let equ_line = '';
        let has_param = false;
        let in_func = false;
        let ret_zero = false;
        const theparser = new LineParse();
        
        for (const tok of tokens) {
            equ_line += tok.Value.toString();
            switch (tok.Type) {
                // tokens that mean nothing in an equation
                case 'EMPTY':
                case 'EOL':
                    break;
                // if the token is a number or a variable return it with type set to Number
                case 'HEX':
                case 'BINARY':
                case 'INT':
                case 'DEC':
                    lasttok2 = lasttok;
                    lasttok = tok.Type;
                    yield tok;
                    break;
                case 'STRN':
                    // an STRN may be a number with a .L or .U or .I attached, if so strip it and re-evaluate the type
                    lasttok2 = lasttok;
                    if ((tok.Value.toString().endsWith(".L")) || (tok.Value.toString().endsWith(".U")) || (tok.Value.toString().endsWith(".I"))) {
                        // return with a token but check the type and strip the last 2 chars
                        lasttok = theparser.DetermineType(tok.Value.toString().substring(0, tok.Value.toString().length - 2));
                        yield {
                            Type: lasttok,
                            Value: tok.Value.toString().substring(0, tok.Value.toString().length - 2)
                        };
                    } else {
                        lasttok = tok.Type;
                        yield tok;
                    }
                    break;
                // if it is a math operator then check if it is a leading "-" for a negative number
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
                    // check if there is anything on the stack, if there is and it is an operator then compare the operators
                    // if stack operator is higher precedence then return the stack token
                    while (stack.length > 0 && common.Math_Op.includes(stack[stack.length - 1].Type) && this.CompareOperators(tok.Type, stack[stack.length - 1].Type)) {
                        yield stack.pop();
                    }
                    // push this token on the stack
                    stack.push(tok);
                    lasttok2 = lasttok;
                    lasttok = tok.Type;
                    break;
                case 'OPEN_PAREN':
                    lasttok2 = lasttok;
                    lasttok = 'OPEN_PAREN';
                    stack.push(tok);
                    break;
                case 'CLOSE_PAREN':
                    lasttok2 = lasttok;
                    lasttok = 'CLOSE_PAREN';
                    // we have a closing parenthesis so start popping any values on the stack up to an open paren
                    // also catch a missing opening paren, we could clear the stack in that case and have an error
                    while (stack.length > 0 && (stack[stack.length - 1].Type !== 'OPEN_PAREN')) {
                        yield stack.pop();
                    }
                    // clear the open paren
                    if (stack.length > 0) {
                        stack.pop();
                    } else {
                        // if here we popped the entire stack and did not get an open paren
                        common.gen_error("Mismatched parentheses, missing open parenthesis", equ_line.toString());
                        process.exit(1);
                    }
                    break;
                default:
                    common.gen_error("Equation parse error on token " + tok.Value.toString(), equ_line.toString());
                    process.exit(1);
                    break;
            }
        }
        while (stack.length > 0) {
            const tok = stack.pop();
            if ((tok.Type === 'OPEN_PAREN') || (tok.Type === 'CLOSE_PAREN')) {
                common.gen_error("Mismatched parentheses, possible missing close parentheses", equ_line.toString());
                process.exit(1);
            }
            yield tok;
        }
    }

    Solve(thelist) {
        const polishNotationStack = []; // a stack of numbers
        let result;
        let the_equ = "";

        try {
            for (const tok of thelist) {
                the_equ += tok.Value.toString() + " ";
                if (['HEX', 'BINARY', 'INT', 'DEC'].includes(tok.Type)) {
                    polishNotationStack.push(parseFloat(tok.Value));
                }
                if (['BIT_OR', 'BIT_AND', 'ADDITION', 'DASH', 'STAR', 'SLASH', 'CARET', 'SRA', 'SLA', 'FUNC'].includes(tok.Type)) {
                    if (tok.Type === 'BIT_OR') {
                        const x = parseInt(polishNotationStack.pop());
                        const y = parseInt(polishNotationStack.pop());
                        result = (x | y); // evaluate the values popped from the stack
                        polishNotationStack.push(result); // push current result onto the stack
                    }
                    if (tok.Type === 'BIT_AND') {
                        const x = parseInt(polishNotationStack.pop());
                        const y = parseInt(polishNotationStack.pop());
                        result = (x & y); // evaluate the values popped from the stack
                        polishNotationStack.push(result); // push current result onto the stack
                    }
                    if (tok.Type === 'ADDITION') {
                        const x = polishNotationStack.pop();
                        const y = polishNotationStack.pop();
                        result = x + y; // evaluate the values popped from the stack
                        polishNotationStack.push(result); // push current result onto the stack
                    }
                    if (tok.Type === 'DASH') {
                        if (polishNotationStack.length > 1) {
                            const x = polishNotationStack.pop();
                            const y = polishNotationStack.pop();
                            result = y - x; // evaluate the values popped from the stack
                            polishNotationStack.push(result); // push current result onto the stack
                        } else {
                            // single item in stack so must be a negation, this can happen with something like '-(a-b*c..)'
                            const x = polishNotationStack.pop();
                            result = -x; // evaluate the values popped from the stack
                            polishNotationStack.push(result); // push current result onto the stack
                        }
                    }
                    if (tok.Type === 'STAR') {
                        const x = polishNotationStack.pop();
                        const y = polishNotationStack.pop();
                        result = x * y; // evaluate the values popped from the stack
                        polishNotationStack.push(result); // push current result onto the stack
                    }
                    if (tok.Type === 'SLASH') {
                        const x = polishNotationStack.pop();
                        const y = polishNotationStack.pop();
                        result = y / x; // evaluate the values popped from the stack
                        polishNotationStack.push(result); // push current result onto the stack
                    }
                    if (tok.Type === 'CARET') {
                        const x = polishNotationStack.pop();
                        const y = polishNotationStack.pop();
                        result = Math.pow(y, x); // evaluate the values popped from the stack
                        polishNotationStack.push(result); // push current result onto the stack
                    }
                    if (tok.Type === 'SLA') {
                        const x = parseInt(polishNotationStack.pop());
                        const y = parseInt(polishNotationStack.pop());
                        result = (y << x); // evaluate the values popped from the stack
                        polishNotationStack.push(result); // push current result onto the stack
                    }
                    if (tok.Type === 'SRA') {
                        const x = parseInt(polishNotationStack.pop());
                        const y = parseInt(polishNotationStack.pop());
                        result = (y >> x); // evaluate the values popped from the stack
                        polishNotationStack.push(result); // push current result onto the stack
                    }
                    if (tok.Type === 'FUNC') {
                        //let x = polishNotationStack.pop(); // ALWAYS pop even if function has no parameters like PI() because we would have pushed a 0 to make everything the same
                        let x;
                        let the_func = tok.Value;
                        let func_sgn = 1.0;
                        // catch a leading "-" for a negative function value
                        if (tok.Value.substring(0, 1) === "-") {
                            the_func = tok.Value.substring(1);
                            func_sgn = -1.0;
                        }
                        switch (the_func) {
                            case "PI":
                                result = Math.PI;
                                polishNotationStack.push(func_sgn * result);
                                break;
                            case "SIN":
                                x = polishNotationStack.pop();
                                result = Math.sin(x);
                                polishNotationStack.push(func_sgn * result);
                                break;
                            case "COS":
                                x = polishNotationStack.pop();
                                result = Math.cos(x);
                                polishNotationStack.push(func_sgn * result);
                                break;
                            case "TAN":
                                x = polishNotationStack.pop();
                                result = Math.tan(x);
                                polishNotationStack.push(func_sgn * result);
                                break;
                            case "EXP":
                                x = polishNotationStack.pop();
                                result = Math.exp(x); // base e
                                polishNotationStack.push(func_sgn * result);
                                break;
                            case "LN":
                                x = polishNotationStack.pop();
                                result = Math.log(x); // base e
                                polishNotationStack.push(func_sgn * result);
                                break;
                            case "LOG10":
                                x = polishNotationStack.pop();
                                result = Math.log10(x);
                                polishNotationStack.push(func_sgn * result);
                                break;
                            case "LOG2":
                                x = polishNotationStack.pop();
                                result = Math.log2(x);
                                polishNotationStack.push(func_sgn * result);
                                break;
                            case "FLOOR":
                                x = polishNotationStack.pop();
                                result = Math.floor(x);
                                polishNotationStack.push(func_sgn * result);
                                break;
                            case "CEILING":
                                x = polishNotationStack.pop();
                                result = Math.ceil(x);
                                polishNotationStack.push(func_sgn * result);
                                break;
                            case "ROUND":
                                x = polishNotationStack.pop();
                                result = Math.round(x);
                                polishNotationStack.push(func_sgn * result);
                                break;
                            case "ABS":
                                x = polishNotationStack.pop();
                                result = Math.abs(x);
                                polishNotationStack.push(func_sgn * result);
                                break;
                            case "TRUNCATE":
                                x = polishNotationStack.pop();
                                result = Math.trunc(x);
                                polishNotationStack.push(func_sgn * result);
                                break;
                            case "FACT":
                                x = polishNotationStack.pop();
                                result = 1.0; // set to "1" for x=0 or 1
                                if (x >= 2) {
                                    while (Math.trunc(x) > 1) {
                                        result = result * Math.trunc(x);
                                        x = x - 1;
                                    }
                                }
                                polishNotationStack.push(func_sgn * result);
                                break;
                            default:
                                common.gen_error("Unknown math function", tok.Value.toString());
                                process.exit(1);
                                break;
                        }
                    }
                }
            }
        } catch (e) {
            common.gen_error("An error occurred solving the equation (RPN representation)", the_equ);
            process.exit(1);
        }
        if (polishNotationStack.length === 0) {
            common.gen_error("Solution stack empty, check equations are complete and proper.", the_equ);
            process.exit(1);
        }
        return polishNotationStack[polishNotationStack.length - 1];
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ShuntingYard;
}