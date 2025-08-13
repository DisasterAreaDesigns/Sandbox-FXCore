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

        if (result.status !== FT260Wrapper.STATUS.FT260_OK) {
            console.error(`Error sending ${sectionName} download command:`, result.status);
            return false;
        }

        if (result.bytesWritten !== 2) {
            console.error(`${sectionName} download command: bytes written != bytes sent`);
            return false;
        }

        await this.sleep(10);

        // Send the data (using big write for large data)
        result = await this.ft260HidI2cMasterBigWrite(
            device, devAddr, FT260Wrapper.I2C_FLAG.FT260_I2C_START_AND_STOP,
            data, dataLength
        );

        if (result.status !== FT260Wrapper.STATUS.FT260_OK) {
            console.error(`Error sending ${sectionName}:`, result.status);
            return false;
        }

        if (result.bytesWritten !== dataLength) {
            console.error(`${sectionName}: bytes written (${result.bytesWritten}) != bytes sent (${dataLength})`);
            return false;
        }

        await this.sleep(10);
        console.log(`${sectionName} sent successfully (${dataLength} bytes)`);
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

        
        console.log(`Writing ${bytesToWrite} bytes`);

        // Small write - single transaction
        if (bytesToWrite <= MAX_TRANS_LEN) {
            console.log(`Small write only ${bytesToWrite} bytes`);

            return await FT260Wrapper.ft260HidI2cWrite(
                device, deviceAddress,
                FT260Wrapper.I2C_FLAG.FT260_I2C_START_AND_STOP,
                buffer.slice(0, bytesToWrite), bytesToWrite
            );
        } else {
            // Big write - multiple transactions
            console.log(`Big write ${bytesToWrite} bytes, sending first packet with I2C START`);

            // Send first packet with START
            let result = await FT260Wrapper.ft260HidI2cWrite(
                device, deviceAddress,
                FT260Wrapper.I2C_FLAG.FT260_I2C_START,
                buffer.slice(0, MAX_TRANS_LEN), MAX_TRANS_LEN
            );

            if (result.status !== FT260Wrapper.STATUS.FT260_OK) {
                return { status: result.status, bytesWritten: 0 };
            }

            bytesToWriteRemaining -= MAX_TRANS_LEN;
            bytesWritten += result.bytesWritten;
            startPtr = MAX_TRANS_LEN;

            console.log(`Big write continues for ${bytesToWriteRemaining} bytes`);

            // Send middle packets with no I2C condition
            while (bytesToWriteRemaining > MAX_TRANS_LEN) {
                console.log(`Big write sending packet ${MAX_TRANS_LEN} bytes`);

                const chunk = buffer.slice(startPtr, startPtr + MAX_TRANS_LEN);
                result = await FT260Wrapper.ft260HidI2cWrite(
                    device, deviceAddress,
                    FT260Wrapper.I2C_FLAG.FT260_I2C_NONE,
                    chunk, MAX_TRANS_LEN
                );

                bytesWritten += result.bytesWritten;
                if (result.status !== FT260Wrapper.STATUS.FT260_OK) {
                    return { status: result.status, bytesWritten };
                }

                startPtr += MAX_TRANS_LEN;
                bytesToWriteRemaining -= MAX_TRANS_LEN;
            }

            // Send final packet with STOP
            console.log(`Sending remaining ${bytesToWriteRemaining} bytes`);

            const finalChunk = buffer.slice(startPtr, startPtr + bytesToWriteRemaining);
            result = await FT260Wrapper.ft260HidI2cWrite(
                device, deviceAddress,
                FT260Wrapper.I2C_FLAG.FT260_I2C_STOP,
                finalChunk, bytesToWriteRemaining
            );

            return {
                status: result.status,
                bytesWritten: bytesWritten + result.bytesWritten
            };
        }
    }

    async old_ft260HidI2cMasterBigWrite(device, devAddr, flag, data, dataLength) {
        let totalWritten = 0;
        const maxChunkSize = 60; // FT260 max I2C data per transaction

        try {
            while (totalWritten < dataLength) {
                const remaining = dataLength - totalWritten;
                const chunkSize = Math.min(remaining, maxChunkSize);
                const chunk = data.slice(totalWritten, totalWritten + chunkSize);

                const result = await FT260Wrapper.ft260HidI2cWrite(
                    device, devAddr, flag, chunk, chunkSize
                );

                if (result.status !== FT260Wrapper.STATUS.FT260_OK) {
                    return { status: result.status, bytesWritten: totalWritten };
                }

                totalWritten += result.bytesWritten;
                
                // Small delay between chunks
                if (totalWritten < dataLength) {
                    await this.sleep(50);
                }
            }

            return {
                status: FT260Wrapper.STATUS.FT260_OK,
                bytesWritten: totalWritten
            };
        } catch (error) {
            console.error('Big write error:', error);
            return {
                status: FT260Wrapper.STATUS.FT260_IO_ERROR,
                bytesWritten: totalWritten
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
                console.error('Error getting I2C interface status');
                return false;
            }

            const i2cStatus = statusResult.i2cStatus;

            // Check if controller and I2C bus are not busy
            if ((i2cStatus & 0x41) === 0) {
                // Check for error conditions
                if ((i2cStatus & 0x01) === 0 && (i2cStatus & 0x02) !== 0) {
                    if ((i2cStatus & 0x04) !== 0) {
                        console.log('Slave address was not acknowledged');
                        return false;
                    } else if ((i2cStatus & 0x08) !== 0) {
                        console.log('Data was not acknowledged');
                        return false;
                    } else if ((i2cStatus & 0x10) !== 0) {
                        console.log('Arbitration was lost');
                        return false;
                    }
                }
                return true; // Ready
            }

            await this.sleep(1);
            watchdog++;
        }

        console.log('Timeout waiting for response from FXCore');
        return false;
    }

    /**
     * Sleep utility
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}