/**
 * LineParse.js - JavaScript port of LineParse.cs
 * 
 * Tokenizes FXCore assembly language lines into tokens
 */

/**
 * ParseToken class for representing parsed tokens (renamed to avoid conflicts)
 */
class ParseToken {
    constructor(type, value) {
        this.Type = type;
        this.Value = value;
    }

    toString() {
        return `${this.Type}: ${this.Value}`;
    }
}

class LineParse {
    constructor() {
        // Symbols that may appear in a variable name especially at the end of a memory name
        this.var_ext = ['!', '#', '_'];

        // Symbols that operate as a token separator, they may be part of a token
        this.token_sep = [
            'BIT_OR', 'BIT_AND', 'ADDITION', 'DASH', 'STAR', 'SLASH', 'CARET',
            'OPEN_PAREN', 'CLOSE_PAREN', 'LINE_COMMENT', 'LINE_COMMENT_2', 'COLON',
            'SPACE', 'TAB', 'EOL', 'COMMA', 'LT', 'GT', 'SRA', 'SLA'
        ];

        // Tokens that are associated to the token to the left
        this.left_assoc = ['COLON']; // label

        // Directive tokens
        this.directives = [
            'MEM_DIRECTIVE', 'EQU_DIRECTIVE', 'RN_DIRECTIVE',
            'CREG_DIRECTIVE', 'MREG_DIRECTIVE', 'SREG_DIRECTIVE'
        ];
    }

    /**
     * Determine the type of a token string
     * @param {string} testTok - Token string to analyze
     * @returns {string} Token type
     */
    DetermineType(testTok) {
        // If empty string then return EMPTY
        if (testTok.length === 0) return 'EMPTY';
        
        // Single character operators
        if (/^\|$/.test(testTok)) return 'BIT_OR';
        if (/^&$/.test(testTok)) return 'BIT_AND';
        if (/^\+$/.test(testTok)) return 'ADDITION';
        if (/^-$/.test(testTok)) return 'DASH';
        if (/^\*$/.test(testTok)) return 'STAR';
        if (/^\/$/.test(testTok)) return 'SLASH';
        if (/^\^$/.test(testTok)) return 'CARET';
        if (/^\($/.test(testTok)) return 'OPEN_PAREN';
        if (/^\)$/.test(testTok)) return 'CLOSE_PAREN';
        if (/^;$/.test(testTok)) return 'LINE_COMMENT';
        if (/^<$/.test(testTok)) return 'LT';
        if (/^>$/.test(testTok)) return 'GT';
        if (/^:$/.test(testTok)) return 'COLON';
        if (/^,$/.test(testTok)) return 'COMMA';
        if (/^ $/.test(testTok)) return 'SPACE';
        if (/^\t$/.test(testTok)) return 'TAB';

        // Directives
        if (/^\.EQU(\.I)?$/i.test(testTok)) return 'EQU_DIRECTIVE';
        if (/^\.RN$/i.test(testTok)) return 'RN_DIRECTIVE';
        if (/^\.MEM$/i.test(testTok)) return 'MEM_DIRECTIVE';
        if (/^\.CREG$/i.test(testTok)) return 'CREG_DIRECTIVE';
        if (/^\.MREG$/i.test(testTok)) return 'MREG_DIRECTIVE';
        if (/^\.SREG$/i.test(testTok)) return 'SREG_DIRECTIVE';

        // Numbers
        if (/^0X[0-9A-F]+$/i.test(testTok)) return 'HEX';
        if (/^0B[01]+[_]*[01_]*$/i.test(testTok)) return 'BINARY';
        if (/^-?[0-9]+$/.test(testTok)) return 'INT';
        // Since user could write ".5" without a leading 0 we make it zero or more leading digits
        if (/^-?[0-9]*\.[0-9]+$/.test(testTok)) return 'DEC';

        // Comments
        if (/^;.*$/.test(testTok)) return 'LINE_COMMENT';
        if (/^\/\/.*$/.test(testTok)) return 'LINE_COMMENT_2';
        if (/^\/\*/.test(testTok)) return 'BLOCK_COMMENT_START';
        if (/\*\/$/.test(testTok)) return 'BLOCK_COMMENT_END';
        if (/^\/\*.*\*\/$/.test(testTok)) return 'BLOCK_COMMENT';

        // Special tokens
        if (/^@[\w\-]+\.[\w\-]+$/i.test(testTok)) return 'LIB_CALL';
        if (/^[\w\-]+:$/i.test(testTok)) return 'JMP_LABEL';
        if (/^<<$/.test(testTok)) return 'SLA';
        if (/^>>$/.test(testTok)) return 'SRA';

        // Default to string
        return 'STRN';
    }

    /**
     * Tokenize a line of text into tokens
     * @param {string} text - Text to tokenize
     * @returns {Array} Array of ParseToken objects
     */
    Tokenize(text) {
        const tokens = [];
        let token = '';
        let lastType = 'EOL';
        let first = true;
        let i = 0;

        while (i < text.length) {
            const ch = text[i];
            const currType = this.DetermineType(ch);
            
            // Peek at next character
            const nextCh = i + 1 < text.length ? text[i + 1] : '';
            const nextType = nextCh ? this.DetermineType(nextCh) : 'EOL';

            // Are we a separator?
            if (!this.token_sep.includes(currType)) {
                // If not a separator token continue getting characters
                lastType = currType;
                token += ch;
                i++;
                continue;
            } else {
                // We have a separator type, check if left assoc
                if (this.left_assoc.includes(currType)) {
                    // It is so append to the existing token
                    token += ch;
                    // Check if appending the token changed the type and update if so
                    const newType = this.DetermineType(token);
                    lastType = newType;
                    tokens.push(new ParseToken(newType, token));
                    token = '';
                    if (lastType !== 'JMP_LABEL') first = false;
                    i++;
                } else {
                    // "Special" types which are either based on context or are compound

                    // A DASH can mean subtraction or a negative value
                    if (currType === 'DASH') {
                        // Return the current token
                        if (token.length > 0) {
                            tokens.push(new ParseToken(this.DetermineType(token), token));
                            first = false;
                        }
                        // Clear the token
                        token = '';
                        // Now check to see if the following is a negative value or a subtraction
                        if (this.isMathOp(lastType) || lastType === 'OPEN_PAREN' || first) {
                            // 2 math ops in a row is not logical so must be a negative number
                            // OR an open paren so a negative number
                            // OR first item so must be a negative number
                            lastType = currType;
                            token += ch;
                            first = false;
                            i++;
                            continue;
                        } else {
                            // Is a dash or subtraction so return it
                            tokens.push(new ParseToken(currType, ch));
                            lastType = currType;
                            i++;
                            continue;
                        }
                    }

                    // A STRN followed by an OPEN_PAREN is a function call
                    if (this.DetermineType(token) === 'STRN' && currType === 'OPEN_PAREN') {
                        tokens.push(new ParseToken('FUNC', token));
                        token = '';
                        first = false;
                    }

                    // Handle compound separators

                    // BLOCK COMMENT START TOKEN "/*"
                    if (currType === 'SLASH' && nextType === 'STAR') {
                        // We have a / followed by * so first return any existing token
                        if (token.length > 0) {
                            tokens.push(new ParseToken(this.DetermineType(token), token));
                            token = '';
                            first = false;
                        }
                        // Append the /
                        token += ch;
                        lastType = currType;
                        i++;
                        continue;
                    }
                    if (lastType === 'SLASH' && currType === 'STAR') {
                        // We got a / last time and have a * this time so return a comment start token
                        token += ch;
                        tokens.push(new ParseToken(this.DetermineType(token), token));
                        token = '';
                        lastType = this.DetermineType(token);
                        first = false;
                        i++;
                        continue;
                    }

                    // BLOCK COMMENT END TOKEN "*/"
                    if (currType === 'STAR' && nextType === 'SLASH') {
                        // We have a * followed by / so first return any existing token
                        if (token.length > 0) {
                            tokens.push(new ParseToken(this.DetermineType(token), token));
                            token = '';
                            first = false;
                        }
                        // Append the *
                        token += ch;
                        lastType = currType;
                        i++;
                        continue;
                    }
                    if (lastType === 'STAR' && currType === 'SLASH') {
                        // We got a * last time and have a / this time so return a comment end token
                        token += ch;
                        tokens.push(new ParseToken(this.DetermineType(token), token));
                        token = '';
                        lastType = this.DetermineType(token);
                        first = true; // While unlikely a label or mnemonic may follow an end of block label
                        i++;
                        continue;
                    }

                    // LINE COMMENT "//" TOKEN
                    if (lastType === 'SLASH' && currType === 'SLASH') {
                        token += ch;
                        tokens.push(new ParseToken(this.DetermineType(token), token));
                        token = '';
                        lastType = this.DetermineType(token);
                        first = false;
                        i++;
                        continue;
                    }
                    if (currType === 'SLASH' && nextType === 'SLASH') {
                        if (token.length > 0) {
                            tokens.push(new ParseToken(this.DetermineType(token), token));
                            token = '';
                            first = false;
                        }
                        token += ch;
                        lastType = currType;
                        i++;
                        continue;
                    }

                    // LINE COMMENT ";" TOKEN
                    if (currType === 'LINE_COMMENT') {
                        // Return any current token
                        if (token.length > 0) {
                            tokens.push(new ParseToken(this.DetermineType(token), token));
                            token = '';
                            first = false;
                        }
                        token += ch;
                        lastType = currType;
                        i++;
                        continue;
                    }

                    // SHIFT TOKENS "<<" and ">>"
                    if (currType === 'LT' && nextType === 'LT') {
                        // We have a < followed by < so first return any existing token
                        if (token.length > 0) {
                            tokens.push(new ParseToken(this.DetermineType(token), token));
                            token = '';
                            first = false;
                        }
                        // Append the first <
                        token += ch;
                        lastType = currType;
                        i++;
                        continue;
                    }
                    if (lastType === 'LT' && currType === 'LT') {
                        // We got a < last time and have a < this time so return a SLA token
                        token += ch;
                        tokens.push(new ParseToken(this.DetermineType(token), token));
                        token = '';
                        lastType = this.DetermineType(token);
                        first = false;
                        i++;
                        continue;
                    }

                    if (currType === 'GT' && nextType === 'GT') {
                        // We have a > followed by > so first return any existing token
                        if (token.length > 0) {
                            tokens.push(new ParseToken(this.DetermineType(token), token));
                            token = '';
                            first = false;
                        }
                        // Append the first >
                        token += ch;
                        lastType = currType;
                        i++;
                        continue;
                    }
                    if (lastType === 'GT' && currType === 'GT') {
                        // We got a > last time and have a > this time so return a SRA token
                        token += ch;
                        tokens.push(new ParseToken(this.DetermineType(token), token));
                        token = '';
                        lastType = this.DetermineType(token);
                        first = false;
                        i++;
                        continue;
                    }

                    // End special tokens

                    // If there is a token remaining after all the above tests then return it
                    if (token.length > 0) {
                        tokens.push(new ParseToken(this.DetermineType(token), token));
                        token = '';
                        lastType = currType;
                        first = false;
                        // Note no continue here as we want to check the separator token and return it
                    }

                    // Return all tokens
                    tokens.push(new ParseToken(currType, ch));
                    lastType = currType;
                    first = false;
                    i++;
                }
            }
        }

        // We got an EOL
        // If there is anything left in the token, return it
        if (token.length !== 0) {
            tokens.push(new ParseToken(this.DetermineType(token), token));
        }
        tokens.push(new ParseToken('EOL', '\n'));
        
        return tokens;
    }

    /**
     * Check if a token type is a math operation
     * @param {string} tokenType - Token type to check
     * @returns {boolean} True if it's a math operation
     */
    isMathOp(tokenType) {
        const mathOps = [
            'BIT_OR', 'BIT_AND', 'ADDITION', 'DASH', 'STAR', 'SLASH', 
            'CARET', 'SRA', 'SLA', 'FUNC'
        ];
        return mathOps.includes(tokenType);
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LineParse, ParseToken };
}