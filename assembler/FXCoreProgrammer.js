/**
 * FXCore HEX File Programmer - JavaScript Version
 * Converted from C# hex_it function
 * Programs FXCore chips via I2C using Intel HEX files
 */

class FXCoreProgrammer {
    constructor() {
        this.isLinux = navigator.platform.toLowerCase().includes('linux');
    }

    /**
     * Send download command and data section
     */
    async sendDataSection(device, devAddr, cmdValue, data, dataLength, sectionName) {
        // Send download command
        const cmd = new Uint8Array([
            (cmdValue >> 8) & 0xFF,
            cmdValue & 0xFF
        ]);

        let result = await FT260Wrapper.ft260HidI2cWrite(
            device, devAddr,
            FT260Wrapper.I2C_FLAG.FT260_I2C_START_AND_STOP,
            cmd, cmd.length
        );

        await this.sleep(50);

        if (result.status !== FT260Wrapper.STATUS.FT260_OK) {
            debugLog(`Error sending ${sectionName} download command: ${result.status}`, 'errors');
            return false;
        }

        if (result.bytesWritten !== 2) {
            debugLog(`${sectionName} download command: bytes written != bytes sent`, 'errors');
            return false;
        }

        // Send the data (using big write for large data)
        result = await this.ft260HidI2cMasterBigWrite(
            device, devAddr, FT260Wrapper.I2C_FLAG.FT260_I2C_START_AND_STOP,
            data, dataLength
        );

        await this.sleep(50);

        if (result.status !== FT260Wrapper.STATUS.FT260_OK) {
            debugLog(`Error sending ${sectionName}: ${result.status}`, 'errors');
            return false;
        }

        if (result.bytesWritten !== dataLength) {
            debugLog(`${sectionName}: bytes written (${result.bytesWritten}) != bytes sent (${dataLength})`, 'errors');
            return false;
        }

        debugLog(`${sectionName} sent successfully (${dataLength} bytes)`, 'showMachineCode');
        return true;
    }

    /**
     * Big write function for sending large data blocks
     */
    //(device, devAddr, flag, data, dataLength)
    async ft260HidI2cMasterBigWrite(device, deviceAddress, flag, buffer, bytesToWrite) {
        let bytesToWriteRemaining = bytesToWrite;
        const MAX_TRANS_LEN = 60; // Max transfer size
        let bytesWritten = 0;
        let startPtr = 0;

        
        debugLog(`Writing ${bytesToWrite} bytes`, 'showMachineCode');

        // Small write - single transaction
        if (bytesToWrite <= MAX_TRANS_LEN) {
            debugLog(`Small write only ${bytesToWrite} bytes`, 'showMachineCode');

            let result = await FT260Wrapper.ft260HidI2cWrite(
                device, deviceAddress,
                FT260Wrapper.I2C_FLAG.FT260_I2C_START_AND_STOP,
                buffer.slice(0, bytesToWrite), bytesToWrite
            );

            await this.sleep(50);
            return(result);
        } else {
            // Big write - multiple transactions
            debugLog(`Big write ${bytesToWrite} bytes, sending first packet with I2C START`, 'showMachineCode');

            // Send first packet with START
            let result = await FT260Wrapper.ft260HidI2cWrite(
                device, deviceAddress,
                FT260Wrapper.I2C_FLAG.FT260_I2C_START,
                buffer.slice(0, MAX_TRANS_LEN), MAX_TRANS_LEN
            );

            await this.sleep(50);

            if (result.status !== FT260Wrapper.STATUS.FT260_OK) {
                return { status: result.status, bytesWritten: 0 };
            }

            bytesToWriteRemaining -= MAX_TRANS_LEN;
            bytesWritten += result.bytesWritten;
            startPtr = MAX_TRANS_LEN;

            debugLog(`Big write continues for ${bytesToWriteRemaining} bytes`, 'showMachineCode');

            // Send middle packets with no I2C condition
            while (bytesToWriteRemaining > MAX_TRANS_LEN) {
                debugLog(`Big write sending packet ${MAX_TRANS_LEN} bytes`, 'showMachineCode');

                const chunk = buffer.slice(startPtr, startPtr + MAX_TRANS_LEN);
                result = await FT260Wrapper.ft260HidI2cWrite(
                    device, deviceAddress,
                    FT260Wrapper.I2C_FLAG.FT260_I2C_NONE,
                    chunk, MAX_TRANS_LEN
                );

                await this.sleep(50);

                bytesWritten += result.bytesWritten;
                if (result.status !== FT260Wrapper.STATUS.FT260_OK) {
                    return { status: result.status, bytesWritten };
                }

                startPtr += MAX_TRANS_LEN;
                bytesToWriteRemaining -= MAX_TRANS_LEN;
            }

            // Send final packet with STOP
            debugLog(`Sending remaining ${bytesToWriteRemaining} bytes`, 'showMachineCode');

            const finalChunk = buffer.slice(startPtr, startPtr + bytesToWriteRemaining);
            result = await FT260Wrapper.ft260HidI2cWrite(
                device, deviceAddress,
                FT260Wrapper.I2C_FLAG.FT260_I2C_STOP,
                finalChunk, bytesToWriteRemaining
            );

            await this.sleep(50);

            return {
                status: result.status,
                bytesWritten: bytesWritten + result.bytesWritten
            };
        }
    }

    /**
     * Wait for I2C interface to be ready
     */
    async waitForI2CReady(device) {
        let watchdog = 0;
        const maxWait = 5000; // 5 second timeout

        while (watchdog < maxWait) {
            const statusResult = await FT260Wrapper.ft260HidI2cMasterGetStatus(device, this.isLinux);
            
            if (statusResult.status !== FT260Wrapper.STATUS.FT260_OK) {
                debugLog('Error getting I2C interface status', 'errors');
                return false;
            }

            const i2cStatus = statusResult.i2cStatus;

            // Check if controller and I2C bus are not busy
            if ((i2cStatus & 0x41) === 0) {
                // Check for error conditions
                if ((i2cStatus & 0x01) === 0 && (i2cStatus & 0x02) !== 0) {
                    if ((i2cStatus & 0x04) !== 0) {
                        debugLog('Slave address was not acknowledged', 'errors');
                        return false;
                    } else if ((i2cStatus & 0x08) !== 0) {
                        debugLog('Data was not acknowledged', 'errors');
                        return false;
                    } else if ((i2cStatus & 0x10) !== 0) {
                        debugLog('Arbitration was lost', 'errors');
                        return false;
                    }
                }
                return true; // Ready
            }

            await this.sleep(1);
            watchdog++;
        }

        debugLog('Timeout waiting for response from FXCore', 'errors');
        return false;
    }

    /**
     * Sleep utility
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}