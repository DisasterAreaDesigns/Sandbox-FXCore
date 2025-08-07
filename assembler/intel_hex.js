/**
 * IntelHex.js - JavaScript port of IntelHex.cs
 * 
 * Utility class to create, read, write, and print Intel HEX8 binary records.
 * 
 * Original C# version by Jerry G. Scherer, based on C version by Vanya A. Sergeev
 */

class IntelHex {
    constructor() {
        // Constants
        this.IHEX_MAX_DATA_LEN = 512;
        this.IHEX_ASCII_HEX_BYTE_LEN = 2;
        this.IHEX_START_CODE = ':';
        
        // Record types
        this.IHEX_TYPE_00 = 0; // Data Record
        this.IHEX_TYPE_01 = 1; // End of File Record
        this.IHEX_TYPE_02 = 2; // Extended Segment Address Record
        this.IHEX_TYPE_03 = 3; // Start Segment Address Record
        this.IHEX_TYPE_04 = 4; // Extended Linear Address Record
        this.IHEX_TYPE_05 = 5; // Start Linear Address Record
        
        // Error codes
        this.IHEX_OK = 0;
        this.IHEX_ERROR_FILE = -1;
        this.IHEX_ERROR_EOF = -2;
        this.IHEX_ERROR_INVALID_RECORD = -3;
        this.IHEX_ERROR_INVALID_ARGUMENTS = -4;
        this.IHEX_ERROR_NEWLINE = -5;
        this.IHEX_ERROR_INVALID_STRUCTURE = -6;
        
        // Internal record structure
        this.irec = {
            address: 0,        // 16-bit address field
            data: new Array(this.IHEX_MAX_DATA_LEN / 2).fill(0), // 8-bit data array
            dataLen: 0,        // Number of bytes of data
            type: 0,           // Intel HEX8 record type
            checksum: 0        // Checksum
        };
        
        this.status = this.IHEX_ERROR_INVALID_ARGUMENTS;
    }

    /**
     * Get the status of the last operation
     * @returns {number} Status code
     */
    getStatus() {
        return this.status;
    }

    /**
     * Create a new Intel HEX record
     * @param {number} type - Record type
     * @param {number} address - 16-bit address
     * @param {Uint8Array|null} data - Data bytes
     * @param {number} dataLen - Number of data bytes
     * @returns {object|null} Record structure or null on error
     */
    NewRecord(type, address, data, dataLen) {
        // Validate arguments
        if (dataLen < 0 || dataLen > this.IHEX_MAX_DATA_LEN / 2) {
            this.status = this.IHEX_ERROR_INVALID_ARGUMENTS;
            return null;
        }

        this.irec.type = type;
        this.irec.address = address & 0xFFFF;
        this.irec.dataLen = dataLen;
        
        // Clear data array
        this.irec.data.fill(0);
        
        // Copy data if provided
        if (data && dataLen > 0) {
            for (let i = 0; i < dataLen && i < data.length; i++) {
                this.irec.data[i] = data[i] & 0xFF;
            }
        }
        
        this.irec.checksum = this.calculateChecksum();
        this.status = this.IHEX_OK;
        return this.irec;
    }

    /**
     * Read an Intel HEX record from a string
     * @param {string} recordLine - HEX record line
     * @returns {object|null} Record structure or null on error
     */
    Read(recordLine) {
        if (!recordLine || typeof recordLine !== 'string') {
            this.status = this.IHEX_ERROR_INVALID_ARGUMENTS;
            return null;
        }

        const line = recordLine.trim();
        
        // Check if empty line
        if (line.length === 0) {
            this.status = this.IHEX_ERROR_NEWLINE;
            return null;
        }

        // Check minimum length for start code, count, address, and type fields
        if (line.length < 11) { // :LLAAAATT minimum
            this.status = this.IHEX_ERROR_INVALID_RECORD;
            return null;
        }

        // Check for start code
        if (line[0] !== this.IHEX_START_CODE) {
            this.status = this.IHEX_ERROR_INVALID_RECORD;
            return null;
        }

        try {
            // Parse count field
            const dataCount = parseInt(line.substring(1, 3), 16);
            
            // Parse address field
            this.irec.address = parseInt(line.substring(3, 7), 16);
            
            // Parse type field
            this.irec.type = parseInt(line.substring(7, 9), 16);
            
            // Check total length
            const expectedLength = 11 + (dataCount * 2); // :LLAAAATT + data + CC
            if (line.length < expectedLength) {
                this.status = this.IHEX_ERROR_INVALID_RECORD;
                return null;
            }
            
            // Parse data bytes
            this.irec.dataLen = dataCount;
            for (let i = 0; i < dataCount; i++) {
                const dataStart = 9 + (i * 2);
                this.irec.data[i] = parseInt(line.substring(dataStart, dataStart + 2), 16);
            }
            
            // Parse checksum
            const checksumStart = 9 + (dataCount * 2);
            this.irec.checksum = parseInt(line.substring(checksumStart, checksumStart + 2), 16);
            
            // Verify checksum
            if (this.irec.checksum !== this.calculateChecksum()) {
                this.status = this.IHEX_ERROR_INVALID_RECORD;
                return null;
            }
            
        } catch (error) {
            this.status = this.IHEX_ERROR_INVALID_RECORD;
            return null;
        }

        this.status = this.IHEX_OK;
        return this.irec;
    }

    /**
     * Write an Intel HEX record to a string
     * @param {object} writer - Writer object with write method (optional)
     * @returns {string|null} HEX record string or null on error
     */
    Write(writer = null) {
        if (!this.irec) {
            this.status = this.IHEX_ERROR_INVALID_ARGUMENTS;
            return null;
        }

        // Check data length
        if (this.irec.dataLen > this.IHEX_MAX_DATA_LEN / 2) {
            this.status = this.IHEX_ERROR_INVALID_RECORD;
            return null;
        }

        try {
            // Build record string
            let record = this.IHEX_START_CODE;
            
            // Data count (2 hex digits)
            record += this.irec.dataLen.toString(16).padStart(2, '0').toUpperCase();
            
            // Address (4 hex digits)
            record += this.irec.address.toString(16).padStart(4, '0').toUpperCase();
            
            // Type (2 hex digits)
            record += this.irec.type.toString(16).padStart(2, '0').toUpperCase();
            
            // Data bytes
            for (let i = 0; i < this.irec.dataLen; i++) {
                record += this.irec.data[i].toString(16).padStart(2, '0').toUpperCase();
            }
            
            // Checksum (2 hex digits)
            const checksum = this.calculateChecksum();
            record += checksum.toString(16).padStart(2, '0').toUpperCase();
            
            // Write to writer if provided
            if (writer && typeof writer.write === 'function') {
                writer.write(record + '\n');
            }
            
            this.status = this.IHEX_OK;
            return record;
            
        } catch (error) {
            this.status = this.IHEX_ERROR_FILE;
            return null;
        }
    }

    /**
     * Print record information
     * @param {boolean} verbose - Detailed output
     * @returns {string} Formatted record string
     */
    Print(verbose = false) {
        if (verbose) {
            let output = `Intel HEX8 Record Type: \t${this.irec.type}\n`;
            output += `Intel HEX8 Record Address: \t0x${this.irec.address.toString(16).padStart(4, '0').toUpperCase()}\n`;
            output += `Intel HEX8 Record Data: \t[`;
            
            for (let i = 0; i < this.irec.dataLen; i++) {
                if (i > 0) output += ', ';
                output += `0x${this.irec.data[i].toString(16).padStart(2, '0').toUpperCase()}`;
            }
            
            output += `]\n`;
            output += `Intel HEX8 Record Checksum: \t0x${this.irec.checksum.toString(16).padStart(2, '0').toUpperCase()}\n`;
            
            this.status = this.IHEX_OK;
            return output;
        } else {
            // Return the hex record format
            this.status = this.IHEX_OK;
            return this.Write();
        }
    }

    /**
     * Calculate checksum for current record
     * @returns {number} Calculated checksum
     */
    calculateChecksum() {
        let checksum = 0;
        
        // Add data count, type, and address bytes
        checksum += this.irec.dataLen;
        checksum += this.irec.type;
        checksum += this.irec.address & 0xFF;           // Low byte of address
        checksum += (this.irec.address >> 8) & 0xFF;    // High byte of address
        
        // Add data bytes
        for (let i = 0; i < this.irec.dataLen; i++) {
            checksum += this.irec.data[i];
        }
        
        // Two's complement
        checksum = (~checksum + 1) & 0xFF;
        
        return checksum;
    }

    /**
     * Get the current record
     * @returns {object} Current record structure
     */
    getCurrentRecord() {
        return this.irec;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { IntelHex };
}