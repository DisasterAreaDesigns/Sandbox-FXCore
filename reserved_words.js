/**
 * ReservedWords.js - JavaScript port of ReservedWords.cs
 * 
 * Contains all FXCore reserved words and their constant values
 */

class ReservedWords {
    constructor() {
        this.reserved = new Map();
        this.initializeReservedWords();
    }

    initializeReservedWords() {
        // LFO constants
        this.reserved.set('LFO0', 0);
        this.reserved.set('LFO1', 2);
        this.reserved.set('LFO2', 4);
        this.reserved.set('LFO3', 6);
        
        // Trigonometric constants
        this.reserved.set('SIN', 0);
        this.reserved.set('COS', 1);
        this.reserved.set('POS', 0);
        this.reserved.set('NEG', 8);
        
        // Ramp constants
        this.reserved.set('RMP0', 0);
        this.reserved.set('RMP1', 1);
        
        // Length constants
        this.reserved.set('L512', 0);
        this.reserved.set('L1024', 4);
        this.reserved.set('L2048', 8);
        this.reserved.set('L4096', 12);
        
        // Transform constants
        this.reserved.set('XF0', 0x0);
        this.reserved.set('XF1', 0x10);
        this.reserved.set('XF2', 0x20);
        this.reserved.set('XF3', 0x30);
        
        // User constants
        this.reserved.set('USER0', 0x00);
        this.reserved.set('USER1', 0x20);
        
        // Overflow flags
        this.reserved.set('OUT3OFLO', 0x8000);
        this.reserved.set('OUT2OFLO', 0x4000);
        this.reserved.set('OUT1OFLO', 0x2000);
        this.reserved.set('OUT0OFLO', 0x1000);
        this.reserved.set('IN3OFLO', 0x0800);
        this.reserved.set('IN2OFLO', 0x0400);
        this.reserved.set('IN1OFLO', 0x0200);
        this.reserved.set('IN0OFLO', 0x0100);
        
        // Tap tempo flags
        this.reserved.set('TB2NTB1', 0x0020);
        this.reserved.set('TAPSTKY', 0x0010);
        this.reserved.set('NEWTT', 0x0008);
        this.reserved.set('TAPRE', 0x0004);
        this.reserved.set('TAPPE', 0x0002);
        this.reserved.set('TAPLVL', 0x0001);
        
        // Switch constants
        this.reserved.set('SW0', 0x0001);
        this.reserved.set('SW1', 0x0002);
        this.reserved.set('SW2', 0x0004);
        this.reserved.set('SW3', 0x0008);
        this.reserved.set('SW4', 0x0010);
        
        // Switch debounce flags
        this.reserved.set('SW0DB', 0x0001);
        this.reserved.set('SW1DB', 0x0002);
        this.reserved.set('SW2DB', 0x0004);
        this.reserved.set('SW3DB', 0x0008);
        this.reserved.set('SW4DB', 0x0010);
        
        // Switch rising edge flags
        this.reserved.set('SW0RE', 0x0020);
        this.reserved.set('SW1RE', 0x0040);
        this.reserved.set('SW2RE', 0x0080);
        this.reserved.set('SW3RE', 0x0100);
        this.reserved.set('SW4RE', 0x0200);
        
        // Switch positive edge flags
        this.reserved.set('SW0PE', 0x0400);
        this.reserved.set('SW1PE', 0x0800);
        this.reserved.set('SW2PE', 0x1000);
        this.reserved.set('SW3PE', 0x2000);
        this.reserved.set('SW4PE', 0x4000);
        
        // Enable flags
        this.reserved.set('ENABLE', 0x0020);
        this.reserved.set('TAP', 0x0040);
        this.reserved.set('ENABLEDB', 0x8000);
        
        // Boot status flags
        this.reserved.set('PLLRANGE0', 0x0001);
        this.reserved.set('PLLRANGE1', 0x0002);
        this.reserved.set('MNS', 0x0004);
        this.reserved.set('I2CA0', 0x0008);
        this.reserved.set('I2CA1', 0x0010);
        this.reserved.set('I2CA2', 0x0020);
        this.reserved.set('I2CA3', 0x0040);
        this.reserved.set('I2CA4', 0x0080);
        this.reserved.set('I2CA5', 0x0100);
        this.reserved.set('I2CA6', 0x0200);
        
        // Program flags
        this.reserved.set('PR0', 0x0001);
        this.reserved.set('PR1', 0x0002);
        this.reserved.set('PR2', 0x0004);
        this.reserved.set('PR3', 0x0008);
        this.reserved.set('PR4', 0x0010);
        this.reserved.set('PR5', 0x0020);
        this.reserved.set('PR6', 0x0040);
        this.reserved.set('PR7', 0x0080);
        this.reserved.set('PR8', 0x0100);
        this.reserved.set('PR9', 0x0200);
        this.reserved.set('PR10', 0x0400);
        this.reserved.set('PR11', 0x0800);
        this.reserved.set('PR12', 0x1000);
        this.reserved.set('PR13', 0x2000);
        this.reserved.set('PR14', 0x4000);
        this.reserved.set('PR15', 0x8000);
    }

    /**
     * Check if a word is reserved
     * @param {string} theword - Word to check
     * @returns {boolean} True if the word is reserved
     */
    isreserved(theword) {
        return this.reserved.has(theword.toUpperCase());
    }

    /**
     * Get the value of a reserved word
     * @param {string} theword - Reserved word
     * @returns {number|null} Value of the reserved word or null if not found
     */
    value(theword) {
        const val = this.reserved.get(theword.toUpperCase());
        return val !== undefined ? val : null;
    }

    /**
     * Get all reserved words (for debugging/reference)
     * @returns {Array} Array of all reserved word names
     */
    getAllWords() {
        return Array.from(this.reserved.keys()).sort();
    }

    /**
     * Get reserved words by category (for documentation)
     * @returns {Object} Object with categorized reserved words
     */
    getCategorizedWords() {
        return {
            lfo: ['LFO0', 'LFO1', 'LFO2', 'LFO3'],
            trigonometric: ['SIN', 'COS', 'POS', 'NEG'],
            ramp: ['RMP0', 'RMP1'],
            length: ['L512', 'L1024', 'L2048', 'L4096'],
            transform: ['XF0', 'XF1', 'XF2', 'XF3'],
            user: ['USER0', 'USER1'],
            overflow: ['OUT3OFLO', 'OUT2OFLO', 'OUT1OFLO', 'OUT0OFLO', 'IN3OFLO', 'IN2OFLO', 'IN1OFLO', 'IN0OFLO'],
            tapTempo: ['TB2NTB1', 'TAPSTKY', 'NEWTT', 'TAPRE', 'TAPPE', 'TAPLVL'],
            switches: ['SW0', 'SW1', 'SW2', 'SW3', 'SW4'],
            switchDebounce: ['SW0DB', 'SW1DB', 'SW2DB', 'SW3DB', 'SW4DB'],
            switchRisingEdge: ['SW0RE', 'SW1RE', 'SW2RE', 'SW3RE', 'SW4RE'],
            switchPositiveEdge: ['SW0PE', 'SW1PE', 'SW2PE', 'SW3PE', 'SW4PE'],
            enable: ['ENABLE', 'TAP', 'ENABLEDB'],
            bootStatus: ['PLLRANGE0', 'PLLRANGE1', 'MNS', 'I2CA0', 'I2CA1', 'I2CA2', 'I2CA3', 'I2CA4', 'I2CA5', 'I2CA6'],
            program: ['PR0', 'PR1', 'PR2', 'PR3', 'PR4', 'PR5', 'PR6', 'PR7', 'PR8', 'PR9', 'PR10', 'PR11', 'PR12', 'PR13', 'PR14', 'PR15']
        };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ReservedWords;
}