/**
 * DebugConfig.js - Global debug configuration system
 * 
 * Centralized debug control for the entire FXCore assembler system
 */

class DebugConfig {
    constructor() {
        // Default debug levels - all off for clean output
        this.levels = {
            // Assembler debug levels
            verbose: false,           // General assembly process info
            showTokens: false,        // Token parsing details
            showResolution: false,    // Parameter resolution details
            showMachineCode: false,   // Machine code generation details
            showParameterDetails: false, // Detailed parameter processing
            
            // Symbol table debug levels
            symbolTable: false,       // Symbol table operations
            registerLookup: false,    // Register resolution
            
            // Parser debug levels
            parsing: false,           // Line parsing and tokenization
            expressions: false,       // Mathematical expression evaluation
            
            // Memory/Register debug levels
            memoryAccess: false,      // Memory operations
            registerAccess: false,    // Register operations
            
            // Mnemonic table debug levels
            mnemonics: false,         // Mnemonic lookup and validation
            
            // Reserved words debug levels
            reservedWords: false,     // Reserved word lookup
            
            // General categories
            errors: true,             // Always show errors
            warnings: true,           // Always show warnings
            info: true,               // Basic info messages
            success: true,            // success messages
            serial: true,             // serial debug messages
            
            // Special categories
            all: false,               // Enable all debug output
            none: false               // Disable all debug output (except errors)
        };
    }

    /**
     * Set debug level(s)
     * @param {string|object} level - Level name or object with multiple levels
     * @param {boolean} enabled - Whether to enable (only if level is string)
     */
    set(level, enabled = true) {
        if (typeof level === 'string') {
            if (level === 'all') {
                // Enable all debug levels
                Object.keys(this.levels).forEach(key => {
                    if (key !== 'none') {
                        this.levels[key] = true;
                    }
                });
                this.levels.none = false;
            } else if (level === 'none') {
                // Disable all debug levels except errors
                Object.keys(this.levels).forEach(key => {
                    if (key !== 'errors' && key !== 'all') {
                        this.levels[key] = false;
                    }
                });
                this.levels.none = true;
                this.levels.all = false;
            } else if (this.levels.hasOwnProperty(level)) {
                this.levels[level] = enabled;
            } else {
                console.warn(`Unknown debug level: ${level}`);
            }
        } else if (typeof level === 'object') {
            // Set multiple levels at once
            Object.keys(level).forEach(key => {
                if (this.levels.hasOwnProperty(key)) {
                    this.levels[key] = level[key];
                } else {
                    console.warn(`Unknown debug level: ${key}`);
                }
            });
        }
    }

    /**
     * Get debug level status
     * @param {string} level - Level name
     * @returns {boolean} Whether level is enabled
     */
    get(level) {
        return this.levels[level] || false;
    }

    /**
     * Check if debug output should be shown
     * @param {string} level - Debug level to check
     * @returns {boolean} Whether to show debug output
     */
    shouldLog(level) {
        // If 'none' is set, only show errors and warnings
        if (this.levels.none && level !== 'errors' && level !== 'warnings') {
            return false;
        }
        
        // If 'all' is set, show everything
        if (this.levels.all) {
            return true;
        }
        
        // Otherwise check the specific level
        return this.get(level);
    }

    /**
     * Print current debug configuration
     */
    showConfig() {
        console.log('\n=== Debug Configuration ===');
        Object.keys(this.levels).forEach(level => {
            const status = this.levels[level] ? 'ON' : 'OFF';
            console.log(`  ${level.padEnd(20)}: ${status}`);
        });
        console.log('============================\n');
    }

    /**
     * Reset to default configuration
     */
    reset() {
        this.levels = {
            verbose: false,
            showTokens: false,
            showResolution: false,
            showMachineCode: false,
            showParameterDetails: false,
            symbolTable: false,
            registerLookup: false,
            parsing: false,
            expressions: false,
            memoryAccess: false,
            registerAccess: false,
            mnemonics: false,
            reservedWords: false,
            errors: true,
            warnings: true,
            info: false,
            all: false,
            success: true,
            serial: true,
            none: false
        };
    }

    /**
     * Set preset configurations for common use cases
     * @param {string} preset - Preset name
     */
    setPreset(preset) {
        this.reset(); // Start with defaults
        
        switch (preset) {
            case 'clean':
                // Minimal output - only results
                this.set('none', true);
                break;
                
            case 'basic':
                // Basic info only
                this.set({
                    info: true,
                    warnings: true,
                    errors: true,
                    success: true,
                    serial: true,
                });
                break;
                
            case 'assembly':
                // Assembly process debugging
                this.set({
                    verbose: true,
                    showResolution: true,
                    symbolTable: true
                });
                break;
                
            case 'detailed':
                // Detailed debugging
                this.set({
                    verbose: true,
                    showResolution: true,
                    showParameterDetails: true,
                    symbolTable: true,
                    parsing: true
                });
                break;
                
            case 'full':
                // Full debugging (everything except machine code details)
                this.set({
                    verbose: true,
                    showResolution: true,
                    showParameterDetails: true,
                    symbolTable: true,
                    registerLookup: true,
                    parsing: true,
                    expressions: true,
                    mnemonics: true,
                });
                break;
                
            case 'maximum':
                // Maximum debugging
                this.set('all', true);
                break;
                
            default:
                console.warn(`Unknown preset: ${preset}`);
                console.log('Available presets: clean, basic, assembly, detailed, full, maximum');
        }
    }
}

// Create global debug instance
const DEBUG = new DebugConfig();

// /**
//  * Global debug logging function
//  * @param {string} message - Message to log
//  * @param {string} level - Debug level
//  * @param {string} prefix - Optional prefix for the message
//  */
// function debugLog(message, level = 'info', prefix = '') {
//     if (DEBUG.shouldLog(level)) {
//         const prefixStr = prefix ? `[${prefix}] ` : '';
//         const levelStr = level === 'info' ? '' : `[${level.toUpperCase()}] `;
//         console.log(`${levelStr}${prefixStr}${message}`);
//     }
// }

/**
 * Global debug logging function with auto-scroll
 * @param {string} message - Message to log
 * @param {string} level - Debug level
 * @param {string} prefix - Optional prefix for the message
 */
function debugLog(message, level = 'info', prefix = '') {
    if (DEBUG.shouldLog(level)) {
        const prefixStr = prefix ? `[${prefix}] ` : '';
        const levelStr = level === 'info' ? '' : `[${level.toUpperCase()}] `;
        const fullMessage = `${levelStr}${prefixStr}${message}`;
        const timestamp = new Date().toLocaleTimeString();

        // Always log to console
        console.log(fullMessage);

        if (typeof document !== 'undefined') {
            const messagesArea = document.getElementById('messages');

            if (messagesArea) {
                // Map debug levels to CSS classes
                const levelClassMap = {
                    'errors': 'error',
                    'warnings': 'warning',
                    'success': 'success',
                    'serial': 'success',
                    'info': 'info',
                    'verbose': 'info',
                    'showTokens': 'info',
                    'showResolution': 'info',
                    'showMachineCode': 'info',
                    'showParameterDetails': 'info',
                    'symbolTable': 'info',
                    'registerLookup': 'info',
                    'parsing': 'info',
                    'expressions': 'info',
                    'memoryAccess': 'info',
                    'registerAccess': 'info',
                    'mnemonics': 'info',
                    'reservedWords': 'info'
                };

                // Only add to messages area if we have a mapping for this level
                if (levelClassMap[level]) {
                    const div = document.createElement('div');
                    div.className = `message ${levelClassMap[level]}`;
                    div.textContent = `${fullMessage}`;
                    messagesArea.appendChild(div);
                    
                    // Auto-scroll to bottom
                    messagesArea.scrollTop = messagesArea.scrollHeight;

                    // Optional: Limit number of messages to prevent memory issues
                    const maxMessages = 100;
                    if (messagesArea.children.length > maxMessages) {
                        // Remove oldest messages
                        while (messagesArea.children.length > maxMessages) {
                            messagesArea.removeChild(messagesArea.firstChild);
                        }
                    }
                }
            }
        }
    }
}

// Alternative: Helper function to reduce code duplication
function addMessageToArea(message, className) {
    const messagesArea = document.getElementById('messages');
    if (messagesArea) {
        const div = document.createElement('div');
        div.className = `message ${className}`;
        div.textContent = message;
        messagesArea.appendChild(div);
        
        // Auto-scroll to bottom
        messagesArea.scrollTop = messagesArea.scrollHeight;
        
        // Optional: Limit number of messages
        const maxMessages = 100;
        if (messagesArea.children.length > maxMessages) {
            messagesArea.removeChild(messagesArea.firstChild);
        }
    }
}

// Simplified debugLog using the helper function
function debugLogSimplified(message, level = 'info', prefix = '') {
    if (DEBUG.shouldLog(level)) {
        const prefixStr = prefix ? `[${prefix}] ` : '';
        const levelStr = level === 'info' ? '' : `[${level.toUpperCase()}] `;
        const fullMessage = `${levelStr}${prefixStr}${message}`;

        // Always log to console
        console.log(fullMessage);

        if (typeof document !== 'undefined') {
            // Map debug levels to CSS classes
            const levelClassMap = {
                'errors': 'error',
                'warnings': 'warning', 
                'success': 'success',
                'serial': 'success',
                'info': 'info'
            };

            if (levelClassMap[level]) {
                addMessageToArea(fullMessage, levelClassMap[level]);
            }
        }
    }
}




/**
 * Convenience functions for common debug levels
 */
const debug = {
    log: (message, level = 'info', prefix = '') => debugLog(message, level, prefix),
    error: (message, prefix = '') => debugLog(message, 'errors', prefix),
    warn: (message, prefix = '') => debugLog(message, 'warnings', prefix),
    info: (message, prefix = '') => debugLog(message, 'info', prefix),
    verbose: (message, prefix = '') => debugLog(message, 'verbose', prefix),
    tokens: (message, prefix = '') => debugLog(message, 'showTokens', prefix),
    resolution: (message, prefix = '') => debugLog(message, 'showResolution', prefix),
    machineCode: (message, prefix = '') => debugLog(message, 'showMachineCode', prefix),
    parameters: (message, prefix = '') => debugLog(message, 'showParameterDetails', prefix),
    symbols: (message, prefix = '') => debugLog(message, 'symbolTable', prefix),
    registers: (message, prefix = '') => debugLog(message, 'registerLookup', prefix),
    parsing: (message, prefix = '') => debugLog(message, 'parsing', prefix),
    expressions: (message, prefix = '') => debugLog(message, 'expressions', prefix),
    memory: (message, prefix = '') => debugLog(message, 'memoryAccess', prefix),
    mnemonics: (message, prefix = '') => debugLog(message, 'mnemonics', prefix),
    reserved: (message, prefix = '') => debugLog(message, 'reservedWords', prefix)
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DEBUG, debugLog, debug };
}

// Also make available globally in browser
if (typeof window !== 'undefined') {
    window.DEBUG = DEBUG;
    window.debugLog = debugLog;
    window.debug = debug;
}

/**
 * Usage Examples:
 * 
 * // Set individual debug levels
 * DEBUG.set('verbose', true);
 * DEBUG.set('showResolution', false);
 * 
 * // Set multiple levels at once
 * DEBUG.set({
 *     verbose: true,
 *     showResolution: true,
 *     symbolTable: true
 * });
 * 
 * // Use presets
 * DEBUG.setPreset('clean');     // Minimal output
 * DEBUG.setPreset('assembly');  // Assembly debugging
 * DEBUG.setPreset('full');      // Full debugging
 * 
 * // Enable/disable all
 * DEBUG.set('all', true);   // Enable everything
 * DEBUG.set('none', true);  // Disable everything (except errors)
 * 
 * // Check configuration
 * DEBUG.showConfig();
 * 
 * // Use in code
 * debug.verbose('Processing instruction', 'ASSEMBLER');
 * debug.resolution('Resolved parameter to: 42', 'RESOLVER');
 * debug.error('Failed to resolve parameter', 'ASSEMBLER');
 * 
 * // Or use the general function
 * debugLog('Custom message', 'customLevel', 'PREFIX');
 */