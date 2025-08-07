/**
 * Assembler.js - JavaScript port of Assembler.cs
 * 
 * Main assembly engine for FXCore assembly language
 * Updated to use global debug system
 */

// Import global debug system (adjust path as needed)
// const { DEBUG, debug } = require('./DebugConfig.js');

class Assembler {
    constructor(filename, symbolTable) {
        this.filename = filename;
        this.thetable = symbolTable; // SymbolTable instance
        this.program = []; // List of assembled instructions
        this.labels = []; // List of jump labels
        this.myreserved = new ReservedWords();
        this.asmtable = new Mnemonic();
        this.prgclks = 0;
        this.prgcore = 0;
    }

    /**
     * Get label name for a given PC
     * @param {number} pc - Program counter
     * @returns {string|null} Label name with colon, or null
     */
    getLabel(pc) {
        const label = this.labels.find(l => l.pc === pc);
        return label ? label.name + ": " : null;
    }

    /**
     * Main assembly routine
     * @param {string} sourceCode - FXCore assembly source code
     * @returns {boolean} Success
     */
    
 assemble(sourceCode) {
    let linecount = 0;
    let pc = 0;
    let retval = true;
    const lines = sourceCode.split('\n');
    let inBlockComment = false; // Track block comment state across lines

    debug.info('Start assembly\n');

    // First pass - parse instructions and collect labels
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        linecount = lineIndex + 1;
        let line = lines[lineIndex];

        // Preprocess line
        line = line.toUpperCase().trim();
        line = line.replace(/\s+/g, ' ');
        
        if (line.length === 0) continue;

        // Handle block comments at the line level BEFORE tokenizing
        if (inBlockComment) {
            // We're inside a block comment - look for the end
            const commentEnd = line.indexOf('*/');
            if (commentEnd !== -1) {
                // Found the end of the block comment
                inBlockComment = false;
                // Process the rest of the line after the comment end
                line = line.substring(commentEnd + 2).trim();
                if (line.length === 0) continue;
            } else {
                // Still in block comment, skip entire line
                continue;
            }
        }

        // Check if this line starts a block comment
        const blockCommentStart = line.indexOf('/*');
        if (blockCommentStart !== -1) {
            // Found start of block comment
            const beforeComment = line.substring(0, blockCommentStart).trim();
            const afterCommentStart = line.substring(blockCommentStart + 2);
            
            // Check if the comment also ends on this line
            const commentEnd = afterCommentStart.indexOf('*/');
            if (commentEnd !== -1) {
                // Complete block comment on one line
                const afterComment = afterCommentStart.substring(commentEnd + 2).trim();
                // Reconstruct line without the comment
                line = (beforeComment + ' ' + afterComment).trim();
                if (line.length === 0) continue;
            } else {
                // Block comment continues to next line
                inBlockComment = true;
                line = beforeComment.trim();
                if (line.length === 0) continue;
            }
        }

        const tokens = this.tokenizeLine(line);
        if (tokens.length === 0) continue;

        let tokenIndex = 0;

        while (tokenIndex < tokens.length) {
            const token = tokens[tokenIndex];

            if (token.type === 'EOL') {
                break;
            }

            // Handle jump labels
            if (token.type === 'JMP_LABEL') {
                const labelName = token.value.slice(0, -1).toUpperCase(); // Remove colon
                debug.verbose(`Found label: "${labelName}" at PC ${pc}`, 'ASSEMBLER');
                
                // Check for duplicate labels
                if (this.labels.some(l => l.name.toUpperCase() === labelName)) {
                    debug.error(`Label ${labelName} already declared at line ${linecount}`, 'ASSEMBLER');
                    retval = false;
                } else {
                    this.labels.push({ name: labelName, pc: pc });
                    debug.verbose(`Added label: "${labelName}" at PC ${pc}`, 'ASSEMBLER');
                }
                
                tokenIndex++;
                if (tokenIndex >= tokens.length || tokens[tokenIndex].type === 'EOL') {
                    break;
                }
                continue;
            }

            // Handle line comments
            if (token.type === 'LINE_COMMENT' || token.type === 'LINE_COMMENT_2') {
                break;
            }

            // Skip directives
            if (this.isDirective(token.type)) {
                break;
            }

            // Handle mnemonics
            if (this.asmtable.ismnemonic(token.value.trim())) {
                const instruction = this.processInstruction(tokens, tokenIndex, pc, linecount, line);
                if (instruction) {
                    this.program.push(instruction);
                    pc++;
                    
                    if (pc > 1024) { // common.maxins
                        debug.error(`Program exceeds maximum instructions at line ${linecount}`, 'ASSEMBLER');
                        retval = false;
                    }
                } else {
                    retval = false;
                }
                break;
            } else {
                debug.error(`"${token.value.trim()}" is not a valid mnemonic at line ${linecount}`, 'ASSEMBLER');
                retval = false;
                break;
            }
        }
    }

    if (!retval) return false;

    // Second pass - resolve parameters and generate machine code
    const success = this.resolveAndGenerateCode();
    
    if (success) {
        this.printResults();
    }
    
    return success;
}

    /**
     * Print clean assembly results similar to .lst format
     */
    printResults() {
        debug.info('Simple parameter resolution:');
        debug.info('Done\n');
        
        debug.info('Symbolic, label and complex parameter resolution:');
        debug.info('Done\n');
        
        // Print label table
        debug.info('Label table');
        this.labels.forEach(label => {
            debug.info(`${label.name} : ${label.pc.toString().padStart(4, '0')}`);
        });
        debug.info('End label table\n');
        
        // Print code listing
        debug.info('Code Listing');
        debug.info('Line    PC     Binary    Source');
        
        this.program.forEach(instruction => {
            const lineStr = instruction.linenum.toString().padStart(4, '0');
            const pcStr = instruction.pc.toString().padStart(4, '0');
            const binaryStr = instruction.machine.toString(16).toUpperCase().padStart(8, '0');
            
            // Get label if it exists for this PC
            const label = this.getLabel(instruction.pc);
            const labelStr = label || '';
            
            // Reconstruct source line with parameters
            let sourceLine = `${labelStr}${instruction.mnemonic}`;
            
            // Add parameters that were actually provided
            const params = [];
            const instInfo = this.asmtable.value(instruction.mnemonic);
            
            for (let i = 0; i < 8; i++) {
                if (instInfo.theparams[i] !== 'none' && instruction.paramnames[i]) {
                    // Show resolved value in hex format for the listing
                    const paramName = instruction.paramnames[i];
                    const paramValue = `0x${instruction.paramint[i].toString(16).toUpperCase().padStart(4, '0')}`;
                    params.push(`${paramName}(${paramValue})`);
                }
            }
            
            if (params.length > 0) {
                sourceLine += '   ' + params.join(' ');
            }
            
            debug.info(`${lineStr} : ${pcStr} : ${binaryStr} : ${sourceLine}`);
        });
        
        debug.info(`\nTotal instructions: ${this.program.length}`);
    }

    /**
     * Tokenize a line of assembly code
     * @param {string} line - Line to tokenize
     * @returns {Array} Array of tokens
     */
   tokenizeLine(line) {
    const tokens = [];
    let current = '';
    let i = 0;

    debug.parsing(`Tokenizing line: "${line}"`, 'TOKENIZER');

    while (i < line.length) {
        const char = line[i];

        // Handle whitespace
        if (/\s/.test(char)) {
            if (current) {
                tokens.push(this.createToken(current));
                current = '';
            }
            i++;
            continue;
        }

        // Handle line comments
        if (char === ';') {
            if (current) {
                tokens.push(this.createToken(current));
                current = '';
            }
            tokens.push({ type: 'LINE_COMMENT', value: line.substring(i) });
            break;
        }

        if (char === '/' && i + 1 < line.length && line[i + 1] === '/') {
            if (current) {
                tokens.push(this.createToken(current));
                current = '';
            }
            tokens.push({ type: 'LINE_COMMENT_2', value: line.substring(i) });
            break;
        }

        // Note: Block comments are now handled at the line level in assemble()
        // so we don't need to handle them here in the tokenizer

        // Handle colons (jump labels)
        if (char === ':') {
            current += char;
            tokens.push({ type: 'JMP_LABEL', value: current });
            current = '';
            i++;
            continue;
        }

        // Handle commas
        if (char === ',') {
            if (current) {
                tokens.push(this.createToken(current));
                current = '';
            }
            tokens.push({ type: 'COMMA', value: ',' });
            i++;
            continue;
        }

        current += char;
        i++;
    }

    if (current) {
        tokens.push(this.createToken(current));
    }

    tokens.push({ type: 'EOL', value: '' });
    
    debug.tokens(`Tokens: ${tokens.map(t => `${t.type}:${t.value}`).join(', ')}`, 'TOKENIZER');
    
    return tokens;
}

    /**
     * Create a token with appropriate type
     * @param {string} value - Token value
     * @returns {object} Token object
     */
    createToken(value) {
        // Check for directives
        if (value.startsWith('.')) {
            const directive = value.toUpperCase();
            if (directive === '.EQU' || directive.startsWith('.EQU.')) return { type: 'EQU_DIRECTIVE', value };
            if (directive === '.CREG' || directive.startsWith('.CREG.')) return { type: 'CREG_DIRECTIVE', value };
            if (directive === '.MREG' || directive.startsWith('.MREG.')) return { type: 'MREG_DIRECTIVE', value };
            if (directive === '.SREG' || directive.startsWith('.SREG.')) return { type: 'SREG_DIRECTIVE', value };
            if (directive === '.MEM' || directive.startsWith('.MEM.')) return { type: 'MEM_DIRECTIVE', value };
            if (directive === '.RN' || directive.startsWith('.RN.')) return { type: 'RN_DIRECTIVE', value };
        }

        // Check for numbers
        if (/^-?\d+$/.test(value)) return { type: 'INT', value };
        if (/^-?\d*\.\d+$/.test(value)) return { type: 'DEC', value };
        if (/^0[xX][0-9a-fA-F]+$/.test(value)) return { type: 'HEX', value };
        if (/^0[bB][01_]+$/.test(value)) return { type: 'BINARY', value };

        // Default to string
        return { type: 'STRN', value };
    }

    /**
     * Check if token type is a directive
     * @param {string} type - Token type
     * @returns {boolean} True if directive
     */
    isDirective(type) {
        const directives = [
            'EQU_DIRECTIVE', 'CREG_DIRECTIVE', 'MREG_DIRECTIVE',
            'SREG_DIRECTIVE', 'MEM_DIRECTIVE', 'RN_DIRECTIVE'
        ];
        return directives.includes(type);
    }

    /**
     * Try to resolve a parameter value including mathematical expressions
     * @param {string} paramValue - Parameter string
     * @returns {number|null} Resolved value or null
     */
    tryResolveParameter(paramValue) {
        // Check if it contains mathematical operators
        if (paramValue.search(/[+\-*/()^|&<>]/) !== -1) {
            try {
                debug.expressions(`Evaluating mathematical expression: "${paramValue}"`, 'RESOLVER');
                
                // This is a mathematical expression - use ShuntingYard to evaluate it
                const lineParse = new LineParse();
                const shuntingYard = new ShuntingYard();
                
                // Tokenize the expression
                const tokens = lineParse.Tokenize(paramValue);
                debug.expressions(`Tokenized expression: ${tokens.map(t => `${t.Type}:${t.Value}`).join(', ')}`, 'RESOLVER');
                
                // Convert to RPN using ShuntingYard
                const rpnTokens = [];
                for (const token of shuntingYard.ShuntingYardParse(tokens)) {
                    rpnTokens.push(token);
                }
                debug.expressions(`RPN tokens before substitution: ${rpnTokens.map(t => `${t.Type}:${t.Value}`).join(', ')}`, 'RESOLVER');
                
                // Replace any variables with values from symbol table
                const resolvedTokens = [];
                let solvable = true;
                
                for (const token of rpnTokens) {
                    if (token.Type === 'STRN') {
                        // We have a variable, see if it is in the symbol table
                        let variableName = token.Value;
                        let varNegative = false;
                        
                        // Check if it has a leading "-" for negation
                        if (variableName.startsWith('-')) {
                            varNegative = true;
                            variableName = variableName.substring(1);
                        }
                        
                        debug.resolution(`Looking up variable: "${variableName}"`, 'RESOLVER');
                        
                        let resolvedValue = null;
                        let foundVariable = false;
                        
                        // Check if it's in the symbol table (.equ values)
                        if (this.thetable.isSymbol(variableName)) {
                            const symbol = this.thetable.symbolVal(variableName);
                            resolvedValue = symbol.rvalue;
                            foundVariable = true;
                            debug.symbols(`Found in symbol table: ${variableName} = ${resolvedValue}`, 'RESOLVER');
                        }
                        // Check if it's a register
                        else if (this.thetable.checkreg.regset(variableName) !== null) {
                            const regInfo = this.thetable.checkreg.value(variableName, this.thetable.checkreg.regset(variableName));
                            resolvedValue = regInfo.number;
                            foundVariable = true;
                            debug.registers(`Found register: ${variableName} = ${resolvedValue}`, 'RESOLVER');
                        }
                        // Check if it's a reserved word
                        else if (this.myreserved.isreserved(variableName.toUpperCase())) {
                            resolvedValue = this.myreserved.value(variableName.toUpperCase());
                            foundVariable = true;
                            debug.reserved(`Found reserved word: ${variableName} = ${resolvedValue}`, 'RESOLVER');
                        }
                        
                        if (foundVariable) {
                            // Apply negation if needed
                            if (varNegative) {
                                resolvedValue = -resolvedValue;
                                debug.expressions(`Applied negation: ${resolvedValue}`, 'RESOLVER');
                            }
                            
                            // Determine the type of the resolved value and create appropriate token
                            const resolvedValueStr = resolvedValue.toString();
                            const newType = lineParse.DetermineType(resolvedValueStr);
                            resolvedTokens.push({
                                Type: newType,
                                Value: resolvedValueStr
                            });
                            debug.resolution(`Substituted ${variableName} -> ${newType}:${resolvedValueStr}`, 'RESOLVER');
                        } else {
                            debug.error(`Variable "${variableName}" not found in symbol table, registers, or reserved words`, 'RESOLVER');
                            solvable = false;
                            break;
                        }
                    }
                    else if (token.Type === 'HEX') {
                        // Convert hex to decimal for calculation
                        const hexValue = parseInt(token.Value.substring(2), 16);
                        resolvedTokens.push({
                            Type: 'INT',
                            Value: hexValue.toString()
                        });
                        debug.expressions(`Converted hex ${token.Value} -> ${hexValue}`, 'RESOLVER');
                    }
                    else if (token.Type === 'BINARY') {
                        // Convert binary to decimal for calculation
                        const binaryValue = parseInt(token.Value.substring(2).replace(/_/g, ''), 2);
                        resolvedTokens.push({
                            Type: 'INT',
                            Value: binaryValue.toString()
                        });
                        debug.expressions(`Converted binary ${token.Value} -> ${binaryValue}`, 'RESOLVER');
                    }
                    else {
                        // Keep the token as-is (numbers, operators, etc.)
                        resolvedTokens.push(token);
                    }
                }
                
                if (!solvable) {
                    debug.error(`Cannot resolve all variables in expression: ${paramValue}`, 'RESOLVER');
                    return null;
                }
                
                debug.expressions(`Final tokens for solving: ${resolvedTokens.map(t => `${t.Type}:${t.Value}`).join(', ')}`, 'RESOLVER');
                
                // Now solve the RPN expression with substituted values
                const result = shuntingYard.Solve(resolvedTokens);
                debug.expressions(`Mathematical expression "${paramValue}" evaluated to: ${result}`, 'RESOLVER');
                
                // Check for NaN or invalid results
                if (isNaN(result) || !isFinite(result)) {
                    debug.error(`Mathematical expression "${paramValue}" resulted in invalid value: ${result}`, 'RESOLVER');
                    return null;
                }
                
                return result;
                
            } catch (error) {
                debug.error(`Error evaluating mathematical expression: ${paramValue} - ${error.message}`, 'RESOLVER');
                return null;
            }
        }
        
        // Simple numeric values (original logic - unchanged)
        
        // Decimal number
        if (/^-?\d*\.\d+$/.test(paramValue)) {
            const val = parseFloat(paramValue);
            if (!isNaN(val)) {
                debug.resolution(`Resolved decimal: ${paramValue} = ${val}`, 'RESOLVER');
                return val;
            }
        }
        
        // Integer
        if (/^-?\d+$/.test(paramValue)) {
            const val = parseInt(paramValue);
            if (!isNaN(val)) {
                debug.resolution(`Resolved integer: ${paramValue} = ${val}`, 'RESOLVER');
                return val;
            }
        }
        
        // Hexadecimal
        if (/^0[xX][0-9a-fA-F]+$/.test(paramValue)) {
            const val = parseInt(paramValue.substring(2), 16);
            if (!isNaN(val)) {
                debug.resolution(`Resolved hex: ${paramValue} = ${val}`, 'RESOLVER');
                return val;
            }
        }
        
        // Binary
        if (/^0[bB][01_]+$/.test(paramValue)) {
            const val = parseInt(paramValue.substring(2).replace(/_/g, ''), 2);
            if (!isNaN(val)) {
                debug.resolution(`Resolved binary: ${paramValue} = ${val}`, 'RESOLVER');
                return val;
            }
        }
        
        debug.resolution(`Could not resolve parameter: ${paramValue}`, 'RESOLVER');
        return null;
    }

    /**
     * Resolve parameters and generate machine code
     */
    resolveAndGenerateCode() {
        debug.verbose('\n=== STARTING SECOND PASS - PARAMETER RESOLUTION ===', 'ASSEMBLER');
        
        // Debug: Print all available labels
        if (DEBUG.shouldLog('verbose')) {
            debug.verbose('Available labels:', 'ASSEMBLER');
            this.labels.forEach(label => {
                debug.verbose(`  "${label.name}" at PC ${label.pc}`, 'ASSEMBLER');
            });
        }
        
        // Second pass - resolve remaining parameters
        for (let n = 0; n < this.program.length; n++) {
            const instruction = this.program[n];
            const instInfo = this.asmtable.value(instruction.mnemonic);
            
            debug.verbose(`\n--- Resolving parameters for instruction ${n}: ${instruction.mnemonic} at PC ${instruction.pc} ---`, 'ASSEMBLER');
            
            for (let i = 0; i < 8; i++) { // common.maxparams
                debug.parameters(`Parameter ${i}: type="${instInfo.theparams[i]}", name="${instruction.paramnames[i]}", resolved=${instruction.resolved[i]}`, 'ASSEMBLER');
                
                // Skip already resolved parameters
                if (instruction.resolved[i]) {
                    debug.parameters(`  Already resolved with value: ${instruction.paramvals[i]}`, 'ASSEMBLER');
                    continue;
                }
                
                // Skip 'none' parameters
                if (instInfo.theparams[i] === 'none') {
                    debug.parameters(`  Setting 'none' parameter as resolved`, 'ASSEMBLER');
                    instruction.resolved[i] = true;
                    instruction.paramvals[i] = 0;
                    instruction.paramnames[i] = null;
                    continue;
                }
                
                // Only process unresolved parameters that have names
                if (!instruction.paramnames[i]) {
                    debug.parameters(`  No parameter name for type ${instInfo.theparams[i]}`, 'ASSEMBLER');
                    continue;
                }
                
                const paramName = instruction.paramnames[i];
                let paramValue = paramName;
                
                // Handle .L, .U suffixes
                let splitval = false;
                if (paramValue.toUpperCase().endsWith('.L') || paramValue.toUpperCase().endsWith('.U')) {
                    splitval = true;
                    paramValue = paramValue.substring(0, paramValue.length - 2);
                    debug.parameters(`  Split value detected, base parameter: "${paramValue}"`, 'ASSEMBLER');
                }
                
                // Address offset (jump labels)
                if (instInfo.theparams[i] === 'addroffset') {
                    debug.parameters(`  Looking for jump label: "${paramValue}"`, 'ASSEMBLER');
                    const label = this.labels.find(l => l.name.toUpperCase() === paramValue.toUpperCase());
                    if (label) {
                        const offset = label.pc - instruction.pc - 1;
                        instruction.resolved[i] = true;
                        instruction.paramvals[i] = offset;
                        debug.parameters(`  Found label "${label.name}" at PC ${label.pc}`, 'ASSEMBLER');
                        debug.parameters(`  Calculated offset: ${label.pc} - ${instruction.pc} - 1 = ${offset}`, 'ASSEMBLER');
                    } else {
                        debug.error(`  ERROR: Label "${paramValue}" not found!`, 'ASSEMBLER');
                        debug.info(`  Available labels: ${this.labels.map(l => l.name).join(', ')}`, 'ASSEMBLER');
                        return false;
                    }
                }
                
                // Memory address
                else if (instInfo.theparams[i] === 'addr') {
                    debug.parameters(`  Looking for symbol: "${paramValue}"`, 'ASSEMBLER');
                    const symbol = this.thetable.symbolVal(paramValue);
                    if (symbol) {
                        instruction.resolved[i] = true;
                        instruction.paramvals[i] = Math.floor(symbol.rvalue);
                        debug.parameters(`  Resolved symbol to: ${instruction.paramvals[i]}`, 'ASSEMBLER');
                    } else {
                        debug.error(`  ERROR: Symbol "${paramValue}" not found!`, 'ASSEMBLER');
                        return false;
                    }
                }
                
                // Core register
                else if (instInfo.theparams[i] === 'creg') {
                    debug.parameters(`  Looking for core register: "${paramValue}"`, 'ASSEMBLER');
                    if (this.thetable.checkreg.regset(paramValue) === 'creg') {
                        instruction.resolved[i] = true;
                        const regInfo = this.thetable.checkreg.value(paramValue, 'creg');
                        instruction.paramvals[i] = regInfo.number;
                        debug.registers(`  Resolved core register to: ${instruction.paramvals[i]}`, 'ASSEMBLER');
                    } else if (this.thetable.checkreg.isregisteralt(paramValue) && 
                              this.thetable.checkreg.altregset(paramValue) === 'creg') {
                        instruction.resolved[i] = true;
                        const regInfo = this.thetable.checkreg.altvalue(paramValue);
                        instruction.paramvals[i] = regInfo.number;
                        debug.registers(`  Resolved core register (alt) to: ${instruction.paramvals[i]}`, 'ASSEMBLER');
                    } else {
                        debug.error(`  ERROR: No core register found by the name of ${paramValue}`, 'ASSEMBLER');
                        return false;
                    }
                }
                
                // Memory register
                else if (instInfo.theparams[i] === 'mreg') {
                    debug.parameters(`  Looking for memory register: "${paramValue}"`, 'ASSEMBLER');
                    // Check if it contains math operations first
                    if (paramValue.search(/[+\-*/()^|&<>]/) === -1) {
                        if (this.thetable.checkreg.regset(paramValue) === 'mreg') {
                            instruction.resolved[i] = true;
                            const regInfo = this.thetable.checkreg.value(paramValue, 'mreg');
                            instruction.paramvals[i] = regInfo.number;
                            debug.registers(`  Resolved memory register to: ${instruction.paramvals[i]}`, 'ASSEMBLER');
                        } else if (this.thetable.checkreg.isregisteralt(paramValue) && 
                                  this.thetable.checkreg.altregset(paramValue) === 'mreg') {
                            instruction.resolved[i] = true;
                            const regInfo = this.thetable.checkreg.altvalue(paramValue);
                            instruction.paramvals[i] = regInfo.number;
                            debug.registers(`  Resolved memory register (alt) to: ${instruction.paramvals[i]}`, 'ASSEMBLER');
                        } else {
                            debug.error(`  ERROR: No memory register found by the name of ${paramValue}`, 'ASSEMBLER');
                            return false;
                        }
                    }
                }
                
                // Special function register
                else if (instInfo.theparams[i] === 'sfr') {
                    debug.parameters(`  Looking for special function register: "${paramValue}"`, 'ASSEMBLER');
                    if (this.thetable.checkreg.regset(paramValue) === 'sreg') {
                        instruction.resolved[i] = true;
                        const regInfo = this.thetable.checkreg.value(paramValue, 'sreg');
                        instruction.paramvals[i] = regInfo.number;
                        debug.registers(`  Resolved SFR to: ${instruction.paramvals[i]}`, 'ASSEMBLER');
                    } else if (this.thetable.checkreg.isregisteralt(paramValue) && 
                              this.thetable.checkreg.altregset(paramValue) === 'sreg') {
                        instruction.resolved[i] = true;
                        const regInfo = this.thetable.checkreg.altvalue(paramValue);
                        instruction.paramvals[i] = regInfo.number;
                        debug.registers(`  Resolved SFR (alt) to: ${instruction.paramvals[i]}`, 'ASSEMBLER');
                    } else {
                        debug.error(`  ERROR: No special function register found by the name of ${paramValue}`, 'ASSEMBLER');
                        return false;
                    }
                }
                
                // Immediate values
                else if (['imm1', 'imm4', 'imm5', 'imm6', 'imm16', 'imm8d', 'imm16d'].includes(instInfo.theparams[i])) {
                    debug.parameters(`  Looking for immediate value: "${paramValue}"`, 'ASSEMBLER');
                    // Check reserved words first
                    if (this.myreserved.isreserved(paramValue.toUpperCase())) {
                        instruction.resolved[i] = true;
                        instruction.paramvals[i] = this.myreserved.value(paramValue.toUpperCase());
                        debug.reserved(`  Resolved reserved word to: ${instruction.paramvals[i]}`, 'ASSEMBLER');
                    }
                    // Check symbol table
                    else if (this.thetable.isSymbol(paramValue)) {
                        const symbol = this.thetable.symbolVal(paramValue);
                        instruction.resolved[i] = true;
                        instruction.paramvals[i] = symbol.rvalue;
                        debug.symbols(`  Resolved symbol to: ${instruction.paramvals[i]}`, 'ASSEMBLER');
                    } else {
                        debug.error(`  ERROR: Symbol "${paramValue}" not found for immediate value`, 'ASSEMBLER');
                        return false;
                    }
                    
                    // Handle split values
                    if (splitval && instruction.resolved[i]) {
                        if (paramName.toUpperCase().endsWith('.L')) {
                            instruction.paramvals[i] = instruction.paramvals[i] & 0x0000FFFF;
                            debug.parameters(`  Applied .L suffix: ${instruction.paramvals[i]}`, 'ASSEMBLER');
                        } else {
                            instruction.paramvals[i] = (instruction.paramvals[i] >> 16) & 0x0000FFFF;
                            debug.parameters(`  Applied .U suffix: ${instruction.paramvals[i]}`, 'ASSEMBLER');
                        }
                    }
                }
                
                // Mathematical expression resolution - last resort
                if (!instruction.resolved[i] && paramValue.search(/[+\-*/()^|&<>]/) !== -1) {
                    debug.parameters(`  Trying to resolve mathematical expression: "${paramValue}"`, 'ASSEMBLER');
                    try {
                        const resolvedValue = this.tryResolveParameter(paramValue);
                        if (resolvedValue !== null) {
                            instruction.resolved[i] = true;
                            instruction.paramvals[i] = resolvedValue;
                            debug.parameters(`  Resolved math expression to: ${instruction.paramvals[i]}`, 'ASSEMBLER');
                            
                            if (splitval) {
                                if (paramName.toUpperCase().endsWith('.L')) {
                                    instruction.paramvals[i] = instruction.paramvals[i] & 0x0000FFFF;
                                } else {
                                    instruction.paramvals[i] = (instruction.paramvals[i] >> 16) & 0x0000FFFF;
                                }
                            }
                        } else {
                            debug.error(`  ERROR: Could not resolve mathematical expression: "${paramValue}"`, 'ASSEMBLER');
                            return false;
                        }
                    } catch (error) {
                        debug.error(`  ERROR: Error resolving mathematical expression "${paramValue}": ${error.message}`, 'ASSEMBLER');
                        return false;
                    }
                }
            }
            
            // Print final parameter state for this instruction
            if (DEBUG.shouldLog('showParameterDetails')) {
                debug.parameters(`Final parameter state for ${instruction.mnemonic}:`, 'ASSEMBLER');
                for (let i = 0; i < 8; i++) {
                    if (instInfo.theparams[i] !== 'none') {
                        debug.parameters(`  [${i}] ${instInfo.theparams[i]}: "${instruction.paramnames[i]}" = ${instruction.paramvals[i]} (resolved: ${instruction.resolved[i]})`, 'ASSEMBLER');
                    }
                }
            }
        }

        debug.verbose('\n=== STARTING FINAL PASS - MACHINE CODE GENERATION ===', 'ASSEMBLER');
        
        // Final pass - validate and generate machine code
        return this.validateAndGenerateMachineCode();
    }

    /**
     * Validate and generate machine code
     */
    validateAndGenerateMachineCode() {
        let success = true;
        
        for (let n = 0; n < this.program.length; n++) {
            const instruction = this.program[n];
            const instInfo = this.asmtable.value(instruction.mnemonic);
            
            debug.machineCode(`\n=== Processing instruction ${n}: ${instruction.mnemonic} at line ${instruction.linenum} ===`, 'ASSEMBLER');
            debug.machineCode(`Original instbase: 0x${instruction.machine.toString(16).padStart(2, '0')}`, 'ASSEMBLER');
            debug.machineCode(`Expected instbase: 0x${instInfo.instbase.toString(16).padStart(2, '0')}`, 'ASSEMBLER');
            
            // Check all parameters are resolved and validate ranges
            for (let i = 0; i < 8; i++) { // common.maxparams
                // Skip 'none' parameters - they should already be resolved
                if (instInfo.theparams[i] === 'none') {
                    if (!instruction.resolved[i]) {
                        instruction.resolved[i] = true;
                        instruction.paramvals[i] = 0;
                        instruction.paramnames[i] = null;
                    }
                    continue;
                }
                
                // Check if non-'none' parameters are resolved
                if (!instruction.resolved[i]) {
                    if (instruction.paramnames[i] !== null && instruction.paramnames[i] !== undefined) {
                        const paramName = instruction.paramnames[i] || 'unknown';
                        debug.error(`ERROR: Unresolved parameter ${paramName} at line ${instruction.linenum}`, 'ASSEMBLER');
                        success = false;
                    } else {
                        instruction.resolved[i] = true;
                        instruction.paramvals[i] = 0;
                        instruction.paramnames[i] = null;
                    }
                    continue;
                }
                
                // Validate parameter ranges and convert to integer
                if (!this.validateAndConvertParameter(instruction, i, instInfo)) {
                    success = false;
                }
            }
            
            if (success) {
                // Machine code generation
                let theword = instruction.machine << 24;  // Put instbase in I field (bits 31-24)
                
                debug.machineCode(`Building machine code:`, 'ASSEMBLER');
                debug.machineCode(`  Starting with instbase: 0x${instruction.machine.toString(16).padStart(2, '0')}`, 'ASSEMBLER');
                debug.machineCode(`  Shifted to I field: 0x${(theword >>> 0).toString(16).padStart(8, '0')}`, 'ASSEMBLER');
                
                // Process ALL parameters to build R and M fields
                for (let i = 0; i < 8; i++) { // common.maxparams
                    // Don't process 'none' parameters
                    if (instInfo.theparams[i] === 'none') {
                        continue;
                    }
                    
                    if (instruction.pfield[i] === 'r') {
                        // R field (8-bit) - bits 23-16
                        const rValue = (0x00FF0000 & (instruction.paramint[i] << 16));
                        theword = theword | rValue;
                        debug.machineCode(`  R field param ${i}: 0x${instruction.paramint[i].toString(16)} << 16 = 0x${rValue.toString(16)}`, 'ASSEMBLER');
                    } else if (instruction.pfield[i] === 'm') {
                        // M field (16-bit) - bits 15-0
                        const mValue = (0x0000FFFF & instruction.paramint[i]);
                        theword = theword | mValue;
                        debug.machineCode(`  M field param ${i}: 0x${instruction.paramint[i].toString(16)} & 0xFFFF = 0x${mValue.toString(16)}`, 'ASSEMBLER');
                    }
                }
                
                // Save the final assembled machine code back
                instruction.machine = theword >>> 0; // Ensure unsigned 32-bit
                debug.machineCode(`  Final machine code: 0x${instruction.machine.toString(16).padStart(8, '0')}`, 'ASSEMBLER');
                
                // Verify the I field is correct
                const finalI = (instruction.machine >>> 24) & 0xFF;
                const finalR = (instruction.machine >>> 16) & 0xFF;
                const finalM = instruction.machine & 0xFFFF;
                debug.machineCode(`  Verification - I: 0x${finalI.toString(16)}, R: 0x${finalR.toString(16)}, M: 0x${finalM.toString(16)}`, 'ASSEMBLER');
                
                if (finalI !== instInfo.instbase) {
                    debug.error(`ERROR: Final I field (0x${finalI.toString(16)}) doesn't match expected instbase (0x${instInfo.instbase.toString(16)})`, 'ASSEMBLER');
                    success = false;
                }
            }
        }
        
        return success;
    }

    /**
     * Process instruction with correct parameter assignment
     */
    processInstruction(tokens, startIndex, pc, linenum, rawline) {
        const mnemonic = tokens[startIndex].value.trim();
        const instInfo = this.asmtable.value(mnemonic);
        
        if (!instInfo) {
            debug.error(`Unknown mnemonic ${mnemonic} at line ${linenum}`, 'ASSEMBLER');
            return null;
        }

        debug.verbose(`\n=== Creating instruction for ${mnemonic} ===`, 'ASSEMBLER');
        debug.verbose(`  instbase from table: 0x${instInfo.instbase.toString(16).padStart(2, '0')}`, 'ASSEMBLER');
        debug.verbose(`  numparam: ${instInfo.numparam}`, 'ASSEMBLER');
        debug.verbose(`  Parameter types: [${instInfo.theparams.join(', ')}]`, 'ASSEMBLER');
        debug.verbose(`  Parameter fields: [${instInfo.field.join(', ')}]`, 'ASSEMBLER');

        // Collect parameters from source line
        const params = [];
        let currentParam = '';
        
        for (let i = startIndex + 1; i < tokens.length; i++) {
            const token = tokens[i];
            
            if (['LINE_COMMENT', 'LINE_COMMENT_2', 'BLOCK_COMMENT_START', 'EOL'].includes(token.type)) {
                if (currentParam.length > 0) {
                    params.push(currentParam.trim());
                }
                break;
            }
            
            if (token.type === 'COMMA') {
                params.push(currentParam.trim());
                currentParam = '';
            } else {
                currentParam += token.value;
            }
        }

        debug.verbose(`  Parsed parameters from source: [${params.join(', ')}]`, 'ASSEMBLER');

        // Validate parameter count
        if (params.length !== instInfo.numparam) {
            debug.error(`Invalid number of parameters for ${mnemonic} at line ${linenum}. Expected ${instInfo.numparam}, got ${params.length}`, 'ASSEMBLER');
            return null;
        }

        // Create instruction object
        const instruction = {
            machine: instInfo.instbase,
            pc: pc,
            mnemonic: mnemonic,
            paramvals: new Array(8).fill(0),
            paramnames: new Array(8).fill(null),
            resolved: new Array(8).fill(false),
            paramint: new Array(8).fill(0),
            pfield: new Array(8).fill(null),
            linenum: linenum,
            rawline: rawline
        };

        debug.verbose(`  Created instruction with machine = 0x${instruction.machine.toString(16).padStart(2, '0')}`, 'ASSEMBLER');

        // Process parameters using the same logic as C# Assembler.cs
        let sourceParamIndex = 0; // Points to current parameter from source code
        
        for (let i = 0; i < 8; i++) { // common.maxparams
            instruction.pfield[i] = instInfo.field[i];
            
            debug.verbose(`  Processing parameter slot ${i}:`, 'ASSEMBLER');
            debug.verbose(`    Type: ${instInfo.theparams[i]}`, 'ASSEMBLER');
            debug.verbose(`    Field: ${instInfo.field[i]}`, 'ASSEMBLER');
            
            if (instInfo.theparams[i] === 'none') {
                // This parameter slot is unused
                instruction.resolved[i] = true;
                instruction.paramnames[i] = null;
                instruction.paramvals[i] = 0;
                debug.verbose(`    Set as 'none' parameter`, 'ASSEMBLER');
                continue;
            }
            
            // This parameter slot needs a value from the source parameters
            if (sourceParamIndex < params.length) {
                let paramValue = params[sourceParamIndex];
                instruction.paramnames[i] = paramValue; // Store in slot i, not sourceParamIndex
                debug.verbose(`    Assigned source parameter "${paramValue}" to slot ${i}`, 'ASSEMBLER');
                
                // Handle .L, .U, .I suffixes
                let splitval = false;
                let forcei = false;
                
                if (paramValue.toUpperCase().endsWith('.L') || paramValue.toUpperCase().endsWith('.U')) {
                    splitval = true;
                    paramValue = paramValue.substring(0, paramValue.length - 2);
                    debug.verbose(`    Split value suffix detected, base: "${paramValue}"`, 'ASSEMBLER');
                }
                
                if (paramValue.toUpperCase().endsWith('.I')) {
                    forcei = true;
                    paramValue = paramValue.substring(0, paramValue.length - 2);
                    debug.verbose(`    Integer force suffix detected, base: "${paramValue}"`, 'ASSEMBLER');
                }
                
                // Try to resolve simple values immediately
                const resolvedValue = this.tryResolveParameter(paramValue);
                if (resolvedValue !== null) {
                    instruction.resolved[i] = true;
                    instruction.paramvals[i] = resolvedValue;
                    debug.verbose(`    Resolved immediately to: ${resolvedValue}`, 'ASSEMBLER');
                    
                    // Handle split values
                    if (splitval) {
                        if (instruction.paramnames[i].toUpperCase().endsWith('.L')) {
                            instruction.paramvals[i] = instruction.paramvals[i] & 0x0000FFFF;
                            debug.verbose(`    Applied .L suffix: ${instruction.paramvals[i]}`, 'ASSEMBLER');
                        } else {
                            instruction.paramvals[i] = (instruction.paramvals[i] >> 16) & 0x0000FFFF;
                            debug.verbose(`    Applied .U suffix: ${instruction.paramvals[i]}`, 'ASSEMBLER');
                        }
                    }
                    
                    if (forcei) {
                        instruction.paramvals[i] = Math.floor(instruction.paramvals[i]);
                        debug.verbose(`    Applied .I suffix: ${instruction.paramvals[i]}`, 'ASSEMBLER');
                    }
                } else {
                    debug.verbose(`    Could not resolve immediately - will try in second pass`, 'ASSEMBLER');
                }
                
                sourceParamIndex++; // Move to next source parameter
            } else {
                // This should not happen if parameter count validation worked
                debug.error(`    ERROR: No source parameter for required slot ${i}`, 'ASSEMBLER');
                return null;
            }
        }

        if (DEBUG.shouldLog('verbose')) {
            debug.verbose(`\nFinal instruction state for ${mnemonic}:`, 'ASSEMBLER');
            for (let i = 0; i < 8; i++) {
                if (instInfo.theparams[i] !== 'none') {
                    debug.verbose(`  [${i}] ${instInfo.theparams[i]} (${instInfo.field[i]}): "${instruction.paramnames[i]}" = ${instruction.paramvals[i]} (resolved: ${instruction.resolved[i]})`, 'ASSEMBLER');
                }
            }
        }

        return instruction;
    }

    /**
     * Validate parameter range and convert to integer
     * @param {object} instruction - Instruction object
     * @param {number} paramIndex - Parameter index
     * @param {object} instInfo - Instruction info
     * @returns {boolean} Success
     */
    validateAndConvertParameter(instruction, paramIndex, instInfo) {
        const paramType = instInfo.theparams[paramIndex];
        const value = instruction.paramvals[paramIndex];
        const paramName = instruction.paramnames[paramIndex];
        
        switch (paramType) {
            case 'imm1':
                if (value < 0 || value > 1) {
                    debug.error(`Parameter ${paramName} out of range for imm1 at line ${instruction.linenum}`, 'ASSEMBLER');
                    return false;
                }
                instruction.paramint[paramIndex] = Math.floor(value) & 0x1;
                break;
                
            case 'imm4':
                if (value < 0 || value > 15) {
                    debug.error(`Parameter ${paramName} out of range for imm4 at line ${instruction.linenum}`, 'ASSEMBLER');
                    return false;
                }
                instruction.paramint[paramIndex] = Math.floor(value) & 0xF;
                break;
                
            case 'imm5':
                if (value < 0 || value > 31) {
                    debug.error(`Parameter ${paramName} out of range for imm5 at line ${instruction.linenum}`, 'ASSEMBLER');
                    return false;
                }
                instruction.paramint[paramIndex] = Math.floor(value) & 0x1F;
                break;
                
            case 'imm6':
                if (value < 0 || value > 63) {
                    debug.error(`Parameter ${paramName} out of range for imm6 at line ${instruction.linenum}`, 'ASSEMBLER');
                    return false;
                }
                instruction.paramint[paramIndex] = Math.floor(value) & 0x3F;
                break;
                
            case 'imm16':
                if (paramName.toUpperCase().endsWith('.L')) {
                    instruction.paramint[paramIndex] = Math.floor(value) & 0xFFFF;
                } else if (paramName.toUpperCase().endsWith('.U')) {
                    instruction.paramint[paramIndex] = Math.floor(value) & 0xFFFF;
                } else {
                    if (value < -32768 || value > 65535) {
                        debug.error(`Parameter ${paramName} out of range for imm16 at line ${instruction.linenum}`, 'ASSEMBLER');
                        return false;
                    }
                    instruction.paramint[paramIndex] = Math.floor(value) & 0xFFFF;
                }
                break;
                
            case 'imm8d':
                if (value < -1.0 || value >= 1.0) {
                    debug.error(`Parameter ${paramName} out of range for imm8d at line ${instruction.linenum}`, 'ASSEMBLER');
                    return false;
                }
                const val8d = Math.floor(value * 0x7FFFFFFF);
                instruction.paramint[paramIndex] = (val8d >> 24) & 0xFF;
                break;
                
            case 'imm16d':
                if (paramName.toUpperCase().startsWith('0X')) {
                    // Hex value
                    if (value < -32768 || value > 32767) {
                        debug.error(`Parameter ${paramName} out of range for imm16d at line ${instruction.linenum}`, 'ASSEMBLER');
                        return false;
                    }
                    instruction.paramint[paramIndex] = Math.floor(value) & 0xFFFF;
                } else {
                    // Decimal value
                    if (value < -1.0 || value >= 1.0) {
                        debug.error(`Parameter ${paramName} out of range for imm16d at line ${instruction.linenum}`, 'ASSEMBLER');
                        return false;
                    }
                    const val16d = Math.floor(value * 0x7FFFFFFF);
                    if (paramName.toUpperCase().endsWith('.L')) {
                        instruction.paramint[paramIndex] = val16d & 0xFFFF;
                    } else {
                        instruction.paramint[paramIndex] = (val16d >> 16) & 0xFFFF;
                    }
                }
                break;
                
            case 'addroffset':
                if (value < 0 || value > 1023) { // common.maxoffset
                    debug.error(`Address offset out of range at line ${instruction.linenum}`, 'ASSEMBLER');
                    return false;
                }
                if (value + instruction.pc >= this.program.length) {
                    debug.error(`Jump past end of program at line ${instruction.linenum}`, 'ASSEMBLER');
                    return false;
                }
                instruction.paramint[paramIndex] = Math.floor(value) & 0x3FF;
                break;
                
            case 'addr':
                if (value < 0 || value >= 32768) { // common.maxmem
                    debug.error(`Memory address out of range at line ${instruction.linenum}`, 'ASSEMBLER');
                    return false;
                }
                instruction.paramint[paramIndex] = Math.floor(value) & 0x7FFF;
                break;
                
            default:
                // Register types
                instruction.paramint[paramIndex] = Math.floor(value);
                break;
        }
        
        return true;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Assembler;
}