/**
 * SymbolTable.js - JavaScript port of SymbolTable.cs
 * 
 * Creates a list of all .equ and .mem directives in a user's program
 * Also handles .regm/c/s and .rn directives
 * Updated to use global debug system
 */

// Global debug system will be available via debug_config.js
// const { DEBUG, debug } = require('./DebugConfig.js');

class SymbolTable {
    constructor(filename) {
        this.filename = filename;
        this.thetable = []; // List of symbols
        this.symerror = false;
        this.linecount = 0;
        this.checkreg = new Registers();
    }

    /**
     * Check if a symbol exists in the table
     * @param {string} thename - Symbol name to check
     * @returns {boolean} True if symbol exists
     */
    isSymbol(thename) {
        return this.thetable.some(symbol => symbol.name === thename);
    }

    /**
     * Get symbol value by name
     * @param {string} thename - Symbol name
     * @returns {object|null} Symbol object or null if not found
     */
    symbolVal(thename) {
        const symbol = this.thetable.find(s => s.name.toUpperCase() === thename.toUpperCase());
        return symbol || null;
    }

    /**
     * Load and process the symbol table from source code
     * @param {string} sourceCode - The FXCore assembly source code
     * @returns {boolean} True if successful
     */
    loadTable(sourceCode) {
        this.linecount = 0;
        this.symerror = false;
        const lines = sourceCode.split('\n');
        
        debug.symbols('Starting symbol table processing', 'SYMBOLS');
        
        // First pass - collect all symbols
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            this.linecount = lineIndex + 1;
            let line = lines[lineIndex];
            
            // Preprocess line
            line = line.toUpperCase().trim();
            line = line.replace(/\s+/g, ' '); // Replace multiple spaces with single space
            
            if (line.length === 0) continue;
            
            // Parse line tokens (simplified tokenizer)
            const tokens = this.tokenizeLine(line);
            if (tokens.length === 0) continue;
            
            let tokenIndex = 0;
            let inComment = false;
            
            while (tokenIndex < tokens.length) {
                const token = tokens[tokenIndex];
                
                // Handle comments
                if (token.type === 'BLOCK_COMMENT_START') {
                    inComment = true;
                    tokenIndex++;
                    continue;
                }
                
                if (inComment) {
                    if (token.type === 'BLOCK_COMMENT_END') {
                        inComment = false;
                    }
                    tokenIndex++;
                    continue;
                }
                
                // Handle jump labels
                if (token.type === 'JMP_LABEL') {
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
                
                // Handle directives
                if (this.isDirective(token.type)) {
                    if (!this.processDirective(tokens, tokenIndex)) {
                        return false;
                    }
                    break;
                }
                
                tokenIndex++;
            }
        }
        
        // Check for reserved word conflicts
        if (!this.checkReservedWords()) {
            return false;
        }
        
        // Resolve symbols (multiple passes)
        if (!this.resolveSymbols()) {
            return false;
        }
        
        // Process register directives
        if (!this.processRegisterDirectives()) {
            return false;
        }
        
        // Process memory directives
        if (!this.processMemoryDirectives()) {
            return false;
        }
        
        // Final validation
        const success = this.validateAllResolved();
        
        if (success) {
            debug.symbols(`Symbol table processing complete: ${this.thetable.length} symbols`, 'SYMBOLS');
        }
        
        return success;
    }

    /**
     * Simple tokenizer for FXCore assembly lines
     * @param {string} line - Line to tokenize
     * @returns {Array} Array of tokens
     */
    tokenizeLine(line) {
        const tokens = [];
        let current = '';
        let i = 0;
        
        debug.parsing(`Tokenizing symbol line: "${line}"`, 'SYMBOLS');
        
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
            
            // Handle comments
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
            
            // Handle block comments
            if (char === '/' && i + 1 < line.length && line[i + 1] === '*') {
                if (current) {
                    tokens.push(this.createToken(current));
                    current = '';
                }
                tokens.push({ type: 'BLOCK_COMMENT_START', value: '/*' });
                i += 2;
                continue;
            }
            
            if (char === '*' && i + 1 < line.length && line[i + 1] === '/') {
                if (current) {
                    tokens.push(this.createToken(current));
                    current = '';
                }
                tokens.push({ type: 'BLOCK_COMMENT_END', value: '*/' });
                i += 2;
                continue;
            }
            
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
        
        debug.tokens(`Symbol tokens: ${tokens.map(t => `${t.type}:${t.value}`).join(', ')}`, 'SYMBOLS');
        
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
     * Process a directive
     * @param {Array} tokens - Line tokens
     * @param {number} tokenIndex - Current token index
     * @returns {boolean} Success
     */
    processDirective(tokens, tokenIndex) {
        const directive = tokens[tokenIndex];
        
        if (tokenIndex + 1 >= tokens.length) {
            debug.error(`Missing symbol name for ${directive.value} at line ${this.linecount}`, 'SYMBOLS');
            return false;
        }
        
        const symbolName = tokens[tokenIndex + 1].value;
        
        // Handle .RN directive specially (register alias)
        if (directive.type === 'RN_DIRECTIVE') {
            if (tokenIndex + 2 >= tokens.length) {
                debug.error(`Missing register name for .RN ${symbolName} at line ${this.linecount}`, 'SYMBOLS');
                return false;
            }
            
            const registerName = tokens[tokenIndex + 2].value.toUpperCase();
            
            // Check if the register exists
            const regType = this.checkreg.regset(registerName);
            if (regType === null) {
                debug.error(`Unknown register ${registerName} in .RN directive at line ${this.linecount}`, 'SYMBOLS');
                return false;
            }
            
            // Set the alternative name
            if (!this.checkreg.setalt(registerName, regType, symbolName.toUpperCase())) {
                debug.error(`Failed to set register alias ${symbolName} for ${registerName} at line ${this.linecount}`, 'SYMBOLS');
                return false;
            }
            
            debug.symbols(`Set register alias: ${symbolName.toUpperCase()} -> ${registerName}`, 'SYMBOLS');
            return true;
        }
        
        // Handle other directives...
        // Collect parameter value
        let paramValue = '';
        for (let i = tokenIndex + 2; i < tokens.length; i++) {
            const token = tokens[i];
            if (['LINE_COMMENT', 'LINE_COMMENT_2', 'BLOCK_COMMENT_START', 'EOL'].includes(token.type)) {
                break;
            }
            if (token.type !== 'COMMA') {
                paramValue += token.value;
            }
        }
        
        // Create symbol
        const symbol = {
            name: symbolName,
            type: directive.type,
            subtype: this.determineType(paramValue),
            resolved: false,
            value: paramValue.trim(),
            rvalue: 0,
            linenum: this.linecount,
            lhs: false,
            regnum: 0,
            forced: directive.value.endsWith('.I') ? 'INT' : 'EMPTY'
        };
        
        // Try immediate resolution for simple values
        this.tryResolveSymbol(symbol);
        
        // Check for duplicates (except register directives)
        if (!['CREG_DIRECTIVE', 'MREG_DIRECTIVE', 'SREG_DIRECTIVE'].includes(symbol.type)) {
            if (this.isSymbol(symbol.name)) {
                debug.error(`Symbol ${symbol.name} already declared at line ${this.linecount}`, 'SYMBOLS');
                return false;
            }
        }
        
        this.thetable.push(symbol);
        debug.symbols(`Added symbol: ${symbol.name} = "${symbol.value}" (${symbol.type})`, 'SYMBOLS');
        return true;
    }

    /**
     * Determine the type of a value string
     * @param {string} value - Value string
     * @returns {string} Type
     */
    determineType(value) {
        if (/^-?\d+$/.test(value)) return 'INT';
        if (/^-?\d*\.\d+$/.test(value)) return 'DEC';
        if (/^0[xX][0-9a-fA-F]+$/.test(value)) return 'HEX';
        if (/^0[bB][01_]+$/.test(value)) return 'BINARY';
        return 'STRN';
    }

    /**
     * Try to resolve a symbol immediately
     * @param {object} symbol - Symbol to resolve
     */
    tryResolveSymbol(symbol) {
        const value = symbol.value;
        
        switch (symbol.subtype) {
            case 'DEC':
                const decVal = parseFloat(value);
                if (!isNaN(decVal)) {
                    symbol.resolved = true;
                    symbol.rvalue = decVal;
                    debug.symbols(`Immediately resolved decimal: ${symbol.name} = ${decVal}`, 'SYMBOLS');
                }
                break;
                
            case 'INT':
                const intVal = parseInt(value);
                if (!isNaN(intVal)) {
                    symbol.resolved = true;
                    symbol.rvalue = intVal;
                    debug.symbols(`Immediately resolved integer: ${symbol.name} = ${intVal}`, 'SYMBOLS');
                }
                break;
                
            case 'HEX':
                const hexVal = parseInt(value.substring(2), 16);
                if (!isNaN(hexVal)) {
                    symbol.resolved = true;
                    symbol.rvalue = hexVal;
                    debug.symbols(`Immediately resolved hex: ${symbol.name} = ${hexVal}`, 'SYMBOLS');
                }
                break;
                
            case 'BINARY':
                const binVal = parseInt(value.substring(2).replace(/_/g, ''), 2);
                if (!isNaN(binVal)) {
                    symbol.resolved = true;
                    symbol.rvalue = binVal;
                    debug.symbols(`Immediately resolved binary: ${symbol.name} = ${binVal}`, 'SYMBOLS');
                }
                break;
        }
    }

    /**
     * Check for reserved word conflicts
     * @returns {boolean} Success
     */
    checkReservedWords() {
        const reservedWords = new ReservedWords();
        
        for (const symbol of this.thetable) {
            // Check register names
            if (this.checkreg.regset(symbol.name) !== null && 
                !['CREG_DIRECTIVE', 'MREG_DIRECTIVE', 'SREG_DIRECTIVE'].includes(symbol.type)) {
                debug.error(`Symbol ${symbol.name} is a register name at line ${symbol.linenum}`, 'SYMBOLS');
                this.symerror = true;
            }
            
            // Check other reserved words
            if (reservedWords.isreserved(symbol.name)) {
                debug.error(`Symbol ${symbol.name} is a reserved word at line ${symbol.linenum}`, 'SYMBOLS');
                this.symerror = true;
            }
        }
        
        return !this.symerror;
    }

    /**
     * Resolve symbols with proper variable substitution and clean debug output
     * @returns {boolean} Success
     */
    resolveSymbols() {
        let resFound = true;
        let passCount = 0;
        const reservedWords = new ReservedWords();
        const shuntingYard = new ShuntingYard();
        const lineParse = new LineParse();
        
        debug.symbols('Starting symbol resolution', 'SYMBOLS');
        const unresolvedCount = this.thetable.filter(s => !s.resolved).length;
        debug.symbols(`Total symbols to resolve: ${unresolvedCount}`, 'SYMBOLS');
        
        while (resFound && passCount < 10) { // Maximum 10 passes for complex dependencies
            resFound = false;
            passCount++;
            debug.verbose(`Symbol resolution pass ${passCount}`, 'SYMBOLS');
            
            for (let i = 0; i < this.thetable.length; i++) {
                const symbol = this.thetable[i];
                
                if (!symbol.resolved) {
                    debug.resolution(`Trying to resolve: ${symbol.name} = "${symbol.value}"`, 'SYMBOLS');
                    
                    // Check if this contains math operations
                    if (symbol.value.search(/[+\-*/()^|&<>]/) !== -1) {
                        // This is a mathematical expression - use ShuntingYard to evaluate it
                        try {
                            debug.expressions(`Processing mathematical expression: ${symbol.name} = ${symbol.value}`, 'SYMBOLS');
                            
                            // Tokenize the expression
                            const tokens = lineParse.Tokenize(symbol.value);
                            debug.expressions(`Tokenized: ${tokens.map(t => `${t.Type}:${t.Value}`).join(', ')}`, 'SYMBOLS');
                            
                            // Convert to RPN using ShuntingYard
                            const rpnTokens = [];
                            for (const token of shuntingYard.ShuntingYardParse(tokens)) {
                                rpnTokens.push(token);
                            }
                            debug.expressions(`RPN tokens: ${rpnTokens.map(t => `${t.Type}:${t.Value}`).join(', ')}`, 'SYMBOLS');
                            
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
                                    
                                    debug.resolution(`Looking up variable: "${variableName}"`, 'SYMBOLS');
                                    
                                    let resolvedValue = null;
                                    let foundVariable = false;
                                    
                                    // Check if it's in the symbol table (.equ values)
                                    const refSymbol = this.thetable.find(s => 
                                        s.name.toUpperCase() === variableName.toUpperCase() && s.resolved
                                    );
                                    
                                    if (refSymbol) {
                                        resolvedValue = refSymbol.rvalue;
                                        foundVariable = true;
                                        debug.symbols(`Found in symbol table: ${variableName} = ${resolvedValue}`, 'SYMBOLS');
                                    }
                                    // Check if it's a reserved word
                                    else if (reservedWords.isreserved(variableName.toUpperCase())) {
                                        resolvedValue = reservedWords.value(variableName.toUpperCase());
                                        foundVariable = true;
                                        debug.reserved(`Found reserved word: ${variableName} = ${resolvedValue}`, 'SYMBOLS');
                                    }
                                    // Check if it's a register (if checkreg is available)
                                    else if (this.checkreg && this.checkreg.regset(variableName) !== null) {
                                        const regInfo = this.checkreg.value(variableName, this.checkreg.regset(variableName));
                                        resolvedValue = regInfo.number;
                                        foundVariable = true;
                                        debug.registers(`Found register: ${variableName} = ${resolvedValue}`, 'SYMBOLS');
                                    }
                                    
                                    if (foundVariable) {
                                        // Apply negation if needed
                                        if (varNegative) {
                                            resolvedValue = -resolvedValue;
                                            debug.expressions(`Applied negation: ${resolvedValue}`, 'SYMBOLS');
                                        }
                                        
                                        // Determine the type of the resolved value and create appropriate token
                                        const resolvedValueStr = resolvedValue.toString();
                                        const newType = lineParse.DetermineType(resolvedValueStr);
                                        resolvedTokens.push({
                                            Type: newType,
                                            Value: resolvedValueStr
                                        });
                                        debug.resolution(`Substituted ${variableName} -> ${newType}:${resolvedValueStr}`, 'SYMBOLS');
                                    } else {
                                        debug.verbose(`Variable "${variableName}" not found - deferring to next pass`, 'SYMBOLS');
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
                                    debug.expressions(`Converted hex ${token.Value} -> ${hexValue}`, 'SYMBOLS');
                                }
                                else if (token.Type === 'BINARY') {
                                    // Convert binary to decimal for calculation
                                    const binaryValue = parseInt(token.Value.substring(2).replace(/_/g, ''), 2);
                                    resolvedTokens.push({
                                        Type: 'INT',
                                        Value: binaryValue.toString()
                                    });
                                    debug.expressions(`Converted binary ${token.Value} -> ${binaryValue}`, 'SYMBOLS');
                                }
                                else {
                                    // Keep the token as-is (numbers, operators, etc.)
                                    resolvedTokens.push(token);
                                }
                            }
                            
                            if (solvable) {
                                debug.expressions(`Final tokens for solving: ${resolvedTokens.map(t => `${t.Type}:${t.Value}`).join(', ')}`, 'SYMBOLS');
                                
                                // Now solve the RPN expression with substituted values
                                const result = shuntingYard.Solve(resolvedTokens);
                                
                                // Check for NaN or invalid results
                                if (isNaN(result) || !isFinite(result)) {
                                    debug.error(`Mathematical expression "${symbol.value}" resulted in invalid value: ${result}`, 'SYMBOLS');
                                    continue; // Try again next pass
                                }
                                
                                symbol.resolved = true;
                                symbol.rvalue = result;
                                symbol.subtype = 'DEC'; // Result of calculation is decimal
                                resFound = true;
                                
                                debug.symbols(`Resolved math expression: ${symbol.name} = ${symbol.value} = ${result}`, 'SYMBOLS');
                            } else {
                                debug.verbose(`Deferring ${symbol.name} to next pass (missing dependencies)`, 'SYMBOLS');
                            }
                            
                        } catch (error) {
                            debug.error(`Error evaluating expression for ${symbol.name}: ${symbol.value} - ${error.message}`, 'SYMBOLS');
                            // Continue with other resolution methods
                        }
                    }
                    // Simple symbol reference (no math operations)
                    else if (symbol.subtype === 'STRN') {
                        debug.resolution(`Processing simple symbol reference: ${symbol.name} -> ${symbol.value}`, 'SYMBOLS');
                        
                        // Check other symbols
                        const refSymbol = this.thetable.find(s => 
                            s.name.toUpperCase() === symbol.value.toUpperCase() && s.resolved
                        );
                        
                        if (refSymbol) {
                            symbol.resolved = true;
                            symbol.rvalue = refSymbol.rvalue;
                            symbol.subtype = refSymbol.subtype;
                            resFound = true;
                            debug.symbols(`Resolved symbol reference: ${symbol.name} = ${symbol.value} = ${symbol.rvalue}`, 'SYMBOLS');
                        } else if (reservedWords.isreserved(symbol.value.toUpperCase())) {
                            symbol.resolved = true;
                            symbol.rvalue = reservedWords.value(symbol.value.toUpperCase());
                            symbol.subtype = 'INT';
                            resFound = true;
                            debug.symbols(`Resolved reserved word: ${symbol.name} = ${symbol.value} = ${symbol.rvalue}`, 'SYMBOLS');
                        } else {
                            debug.verbose(`Symbol "${symbol.value}" not found yet - deferring to next pass`, 'SYMBOLS');
                        }
                    }
                }
            }
            
            const stillUnresolvedCount = this.thetable.filter(s => !s.resolved).length;
            debug.verbose(`End of pass ${passCount}: ${stillUnresolvedCount} symbols still unresolved`, 'SYMBOLS');
            
            if (stillUnresolvedCount === 0) {
                debug.symbols(`All symbols resolved in ${passCount} passes`, 'SYMBOLS');
                break;
            }
        }
        
        // Final check - report any unresolved symbols
        const stillUnresolved = this.thetable.filter(s => !s.resolved);
        if (stillUnresolved.length > 0) {
            debug.error('UNRESOLVED SYMBOLS:', 'SYMBOLS');
            stillUnresolved.forEach(symbol => {
                debug.error(`  ${symbol.name} = "${symbol.value}" (type: ${symbol.subtype})`, 'SYMBOLS');
            });
            return false;
        }
        
        debug.symbols('Symbol resolution complete', 'SYMBOLS');
        if (DEBUG.shouldLog('symbolTable')) {
            debug.symbols('Resolved symbols:', 'SYMBOLS');
            this.thetable.forEach(symbol => {
                if (symbol.resolved) {
                    debug.symbols(`  ${symbol.name} = ${symbol.rvalue} (${symbol.subtype})`, 'SYMBOLS');
                }
            });
        }
        
        return true;
    }

/**
 * Process register directives
 * @returns {boolean} Success
 */
processRegisterDirectives() {
    debug.symbols('Processing register directives', 'SYMBOLS');
    
    // Process in reverse order for safe removal
    for (let i = this.thetable.length - 1; i >= 0; i--) {
        const symbol = this.thetable[i];
        
        if (['CREG_DIRECTIVE', 'MREG_DIRECTIVE', 'SREG_DIRECTIVE'].includes(symbol.type)) {
            debug.registers(`Processing ${symbol.type}: ${symbol.name}`, 'SYMBOLS');
            
            // Resolve register name
            if (!symbol.lhs) {
                let regType = null;
                let regNumber = null;
                
                // Determine expected register type from directive
                const expectedType = symbol.type === 'CREG_DIRECTIVE' ? 'creg' :
                                    symbol.type === 'MREG_DIRECTIVE' ? 'mreg' : 'sreg';
                
                debug.registers(`Processing ${symbol.type}: ${symbol.name}, expected type: ${expectedType}`, 'SYMBOLS');
                
                // First try direct lookup
                regType = this.checkreg.regset(symbol.name);
                if (regType !== null) {
                    const regInfo = this.checkreg.value(symbol.name, regType);
                    regNumber = regInfo.number;
                    debug.registers(`Direct lookup success: ${symbol.name} -> ${regType}[${regNumber}]`, 'SYMBOLS');
                } else {
                    // Try uppercase
                    const upperName = symbol.name.toUpperCase();
                    regType = this.checkreg.regset(upperName);
                    if (regType !== null) {
                        const regInfo = this.checkreg.value(upperName, regType);
                        regNumber = regInfo.number;
                        debug.registers(`Uppercase lookup success: ${upperName} -> ${regType}[${regNumber}]`, 'SYMBOLS');
                    }
                }
                
                // If still not found, search for a register that has this name as an alias
                if (regType === null) {
                    debug.registers(`Searching for register with alias "${symbol.name.toUpperCase()}"`, 'SYMBOLS');
                    
                    // We need to search through registers of the expected type to find one with matching altname
                    // Since we know the expected type, we can search register numbers for that type
                    const searchName = symbol.name.toUpperCase();
                    
                    // Try a reasonable range of register numbers (0-127 should cover most registers)
                    for (let regNum = 0; regNum <= 127; regNum++) {
                        try {
                            // Construct the register name for this type and number
                            let testRegName;
                            if (expectedType === 'mreg') {
                                testRegName = `MR${regNum}`;
                            } else if (expectedType === 'creg') {
                                testRegName = `R${regNum}`;
                            } else { // sreg
                                testRegName = `SR${regNum}`;
                            }
                            
                            // Check if this register exists and get its info
                            const testRegType = this.checkreg.regset(testRegName);
                            if (testRegType === expectedType) {
                                const regInfo = this.checkreg.value(testRegName, testRegType);
                                if (regInfo && regInfo.altname === searchName) {
                                    // Found it! This register has our alias name
                                    regType = testRegType;
                                    regNumber = regInfo.number;
                                    debug.registers(`Found alias: ${searchName} is alias for ${testRegName}[${regNumber}]`, 'SYMBOLS');
                                    break;
                                }
                            }
                        } catch (error) {
                            // This register number doesn't exist, continue searching
                            continue;
                        }
                    }
                }
                
                if (regType !== null && regNumber !== null) {
                    symbol.lhs = true;
                    symbol.regnum = regNumber;
                    debug.registers(`FINAL RESOLUTION: ${symbol.name} -> ${regType}[${regNumber}]`, 'SYMBOLS');
                } else {
                    debug.error(`Unknown register ${symbol.name} at line ${symbol.linenum}`, 'SYMBOLS');
                    return false;
                }
            }
            
            // Set register value and remove from table
            if (symbol.resolved && symbol.lhs) {
                const regType = symbol.type === 'CREG_DIRECTIVE' ? 'creg' : 
                               symbol.type === 'MREG_DIRECTIVE' ? 'mreg' : 'sreg';
                
                let value = Math.round(symbol.rvalue);
                if (symbol.subtype === 'DEC' && ['CREG_DIRECTIVE', 'MREG_DIRECTIVE', 'SREG_DIRECTIVE'].includes(symbol.type)) {
                    debug.registers(`Converting ${symbol.name}: decimal=${symbol.rvalue} to S.31 format`, 'SYMBOLS');
                    // Convert S.31 format to integer - use truncation like C#
                    const temp = symbol.rvalue * 2147483647; // 0x7FFFFFFF
                    debug.registers(`Scaled value: ${temp}`, 'SYMBOLS');
                    
                    // Use truncation instead of rounding to match C# behavior
                    value = this.truncateToInt(temp);
                    
                    // Ensure it's treated as signed 32-bit integer
                    value = value | 0;
                    
                    debug.registers(`Final S.31 value: ${value} (0x${(value >>> 0).toString(16).toUpperCase()})`, 'SYMBOLS');
                }
                
                this.checkreg.setpreset(symbol.regnum, regType, value);
                debug.registers(`Set register preset: ${symbol.name}[${symbol.regnum}] = ${value}`, 'SYMBOLS');
                this.thetable.splice(i, 1);
            }
        }
    }
    
    return true;
}
    // /**
    //  * Process register directives
    //  * @returns {boolean} Success
    //  */
    // processRegisterDirectives() {
    //     debug.symbols('Processing register directives', 'SYMBOLS');
        
    //     // Process in reverse order for safe removal
    //     for (let i = this.thetable.length - 1; i >= 0; i--) {
    //         const symbol = this.thetable[i];
            
    //         if (['CREG_DIRECTIVE', 'MREG_DIRECTIVE', 'SREG_DIRECTIVE'].includes(symbol.type)) {
    //             debug.registers(`Processing ${symbol.type}: ${symbol.name}`, 'SYMBOLS');
                
    //             // Resolve register name
    //             if (!symbol.lhs) {
    //                 let regType = null;
    //                 let regNumber = null;
                    
    //                 // Determine expected register type from directive
    //                 const expectedType = symbol.type === 'CREG_DIRECTIVE' ? 'creg' :
    //                                    symbol.type === 'MREG_DIRECTIVE' ? 'mreg' : 'sreg';
                    
    //                 // First try direct lookup
    //                 regType = this.checkreg.regset(symbol.name);
    //                 if (regType !== null) {
    //                     const regInfo = this.checkreg.value(symbol.name, regType);
    //                     regNumber = regInfo.number;
    //                     debug.registers(`Direct lookup: ${symbol.name} -> ${regType}[${regNumber}]`, 'SYMBOLS');
    //                 }
                    
    //                 // If not found, try uppercase
    //                 if (regType === null) {
    //                     const upperName = symbol.name.toUpperCase();
    //                     regType = this.checkreg.regset(upperName);
    //                     if (regType !== null) {
    //                         const regInfo = this.checkreg.value(upperName, regType);
    //                         regNumber = regInfo.number;
    //                         debug.registers(`Uppercase lookup: ${upperName} -> ${regType}[${regNumber}]`, 'SYMBOLS');
    //                     }
    //                 }
                    
    //                 // If still not found, try using the expected type directly (for aliases)
    //                 if (regType === null) {
    //                     try {
    //                         debug.registers(`Trying expected type "${expectedType}" for alias "${symbol.name}"`, 'SYMBOLS');
    //                         const regInfo = this.checkreg.value(symbol.name.toUpperCase(), expectedType);
    //                         if (regInfo && regInfo.number !== undefined) {
    //                             regType = expectedType;
    //                             regNumber = regInfo.number;
    //                             debug.registers(`Alias lookup: ${symbol.name.toUpperCase()} -> ${expectedType}[${regNumber}]`, 'SYMBOLS');
    //                         }
    //                     } catch (error) {
    //                         debug.registers(`Expected type lookup failed: ${error.message}`, 'SYMBOLS');
    //                     }
    //                 }
                    
    //                 if (regType !== null && regNumber !== null) {
    //                     symbol.lhs = true;
    //                     symbol.regnum = regNumber;
    //                     debug.registers(`Resolved register: ${symbol.name} -> ${regType}[${regNumber}]`, 'SYMBOLS');
    //                 } else {
    //                     debug.error(`Unknown register ${symbol.name} at line ${symbol.linenum}`, 'SYMBOLS');
    //                     return false;
    //                 }
    //             }
                
    //             // Set register value and remove from table
    //             if (symbol.resolved && symbol.lhs) {
    //                 const regType = symbol.type === 'CREG_DIRECTIVE' ? 'creg' : 
    //                                symbol.type === 'MREG_DIRECTIVE' ? 'mreg' : 'sreg';
                    
    //                 let value = Math.round(symbol.rvalue);
    //                 if (symbol.subtype === 'DEC' && ['CREG_DIRECTIVE', 'MREG_DIRECTIVE', 'SREG_DIRECTIVE'].includes(symbol.type)) {
    //                     debug.registers(`Converting ${symbol.name}: decimal=${symbol.rvalue} to S.31 format`, 'SYMBOLS');
    //                     // Convert S.31 format to integer - use truncation like C#
    //                     const temp = symbol.rvalue * 2147483647; // 0x7FFFFFFF
    //                     debug.registers(`Scaled value: ${temp}`, 'SYMBOLS');
                        
    //                     // Use truncation instead of rounding to match C# behavior
    //                     value = this.truncateToInt(temp);
                        
    //                     // Ensure it's treated as signed 32-bit integer
    //                     value = value | 0;
                        
    //                     debug.registers(`Final S.31 value: ${value} (0x${(value >>> 0).toString(16).toUpperCase()})`, 'SYMBOLS');
    //                 }
                    
    //                 this.checkreg.setpreset(symbol.regnum, regType, value);
    //                 debug.registers(`Set register preset: ${symbol.name}[${symbol.regnum}] = ${value}`, 'SYMBOLS');
    //                 this.thetable.splice(i, 1);
    //             }
    //         }
    //     }
        
    //     return true;
    // }

    /**
     * Process memory directives
     * @returns {boolean} Success
     */
    processMemoryDirectives() {
        let membase = 0;
        
        debug.memory('Processing memory directives', 'SYMBOLS');
        
        for (let i = 0; i < this.thetable.length; i++) {
            const symbol = this.thetable[i];
            
            if (symbol.type === 'MEM_DIRECTIVE' && 
                symbol.subtype !== 'MEML' && symbol.subtype !== 'MEMR') {
                
                const memSize = Math.round(symbol.rvalue);
                if (memSize < 0) {
                    debug.error(`Negative memory size ${memSize} for ${symbol.name} at line ${symbol.linenum}`, 'SYMBOLS');
                    return false;
                }
                
                // Update symbol with write address
                symbol.rvalue = membase;
                symbol.lhs = true;
                
                debug.memory(`Memory allocation: ${symbol.name} = ${membase} (size: ${memSize})`, 'SYMBOLS');
                
                // Add read address symbol
                const readSymbol = {
                    name: symbol.name + '#',
                    type: symbol.type,
                    value: symbol.value,
                    linenum: symbol.linenum,
                    resolved: true,
                    subtype: 'MEMR',
                    forced: 'EMPTY',
                    rvalue: membase + memSize,
                    lhs: true,
                    regnum: 0
                };
                
                if (!this.isSymbol(readSymbol.name)) {
                    this.thetable.push(readSymbol);
                    debug.memory(`Added read symbol: ${readSymbol.name} = ${readSymbol.rvalue}`, 'SYMBOLS');
                    membase += memSize + 1;
                } else {
                    debug.error(`Memory read symbol ${readSymbol.name} already exists at line ${symbol.linenum}`, 'SYMBOLS');
                    return false;
                }
                
                // Add length symbol
                const lengthSymbol = {
                    name: symbol.name + '!',
                    type: symbol.type,
                    value: symbol.value,
                    linenum: symbol.linenum,
                    resolved: true,
                    subtype: 'MEML',
                    forced: 'EMPTY',
                    rvalue: memSize,
                    lhs: true,
                    regnum: 0
                };
                
                if (!this.isSymbol(lengthSymbol.name)) {
                    this.thetable.push(lengthSymbol);
                    debug.memory(`Added length symbol: ${lengthSymbol.name} = ${lengthSymbol.rvalue}`, 'SYMBOLS');
                } else {
                    debug.error(`Memory length symbol ${lengthSymbol.name} already exists at line ${symbol.linenum}`, 'SYMBOLS');
                    return false;
                }
            }
        }
        
        if (membase > 0) {
            debug.memory(`Total memory allocated: ${membase} words`, 'SYMBOLS');
        }
        
        return true;
    }

    /**
     * Truncate to integer - matches C# Math.Truncate behavior for S.31 conversion
     * @param {number} value - Value to truncate
     * @returns {number} Truncated value
     */
    truncateToInt(value) {
        return Math.trunc(value);
    }

    /**
     * Validate all symbols are resolved
     * @returns {boolean} Success
     */
    validateAllResolved() {
        let allResolved = true;
        
        for (const symbol of this.thetable) {
            if (!symbol.resolved) {
                debug.error(`Unresolved symbol ${symbol.name} at line ${symbol.linenum}`, 'SYMBOLS');
                allResolved = false;
            }
        }
        
        if (allResolved) {
            debug.symbols('All symbols validated successfully', 'SYMBOLS');
        } else {
            debug.error('Symbol validation failed - unresolved symbols remain', 'SYMBOLS');
        }
        
        return allResolved;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SymbolTable;
}