/**
 * FT260 HID Device JavaScript Wrapper
 * Converted from C# FT260_wrap class
 * 
 * This wrapper enables HID communication with FT260 devices using Web HID API
 * Original C# wrapper was designed to replace FT260LIB.dll usage
 */

class FT260Wrapper {
    // Enum equivalents as static objects
    static STATUS = {
        FT260_OK: 0,
        FT260_INVALID_HANDLE: 1,
        FT260_DEVICE_NOT_FOUND: 2,
        FT260_DEVICE_NOT_OPENED: 3,
        FT260_DEVICE_OPEN_FAIL: 4,
        FT260_DEVICE_CLOSE_FAIL: 5,
        FT260_INCORRECT_INTERFACE: 6,
        FT260_INCORRECT_CHIP_MODE: 7,
        FT260_DEVICE_MANAGER_ERROR: 8,
        FT260_IO_ERROR: 9,
        FT260_INVALID_PARAMETER: 10,
        FT260_NULL_BUFFER_POINTER: 11,
        FT260_BUFFER_SIZE_ERROR: 12,
        FT260_UART_SET_FAIL: 13,
        FT260_RX_NO_DATA: 14,
        FT260_GPIO_WRONG_DIRECTION: 15,
        FT260_INVALID_DEVICE: 16,
        FT260_INVALID_OPEN_DRAIN_SET: 17,
        FT260_INVALID_OPEN_DRAIN_RESET: 18,
        FT260_I2C_READ_FAIL: 19,
        FT260_OTHER_ERROR: 20
    };

    static GPIO2_PIN = {
        FT260_GPIO2_GPIO: 0,
        FT260_GPIO2_SUSPOUT: 1,
        FT260_GPIO2_PWREN: 2,
        FT260_GPIO2_TX_LED: 4
    };

    static GPIOA_PIN = {
        FT260_GPIOA_GPIO: 0,
        FT260_GPIOA_TX_ACTIVE: 3,
        FT260_GPIOA_TX_LED: 4
    };

    static GPIOG_PIN = {
        FT260_GPIOG_GPIO: 0,
        FT260_GPIOG_PWREN: 2,
        FT260_GPIOG_RX_LED: 5,
        FT260_GPIOG_BCD_DET: 6
    };

    static CLOCK_RATE = {
        FT260_SYS_CLK_12M: 0,
        FT260_SYS_CLK_24M: 1,
        FT260_SYS_CLK_48M: 2
    };

    static INTERRUPT_TRIGGER_TYPE = {
        FT260_INTR_RISING_EDGE: 0,
        FT260_INTR_LEVEL_HIGH: 1,
        FT260_INTR_FALLING_EDGE: 2,
        FT260_INTR_LEVEL_LOW: 3
    };

    static INTERRUPT_LEVEL_TIME_DELAY = {
        FT260_INTR_DELY_1MS: 1,
        FT260_INTR_DELY_5MS: 2,
        FT260_INTR_DELY_30MS: 3
    };

    static SUSPEND_OUT_POLARITY = {
        FT260_SUSPEND_OUT_LEVEL_HIGH: 0,
        FT260_SUSPEND_OUT_LEVEL_LOW: 1
    };

    static UART_MODE = {
        FT260_UART_OFF: 0,
        FT260_UART_RTS_CTS_MODE: 1,        // hardware flow control RTS, CTS mode
        FT260_UART_DTR_DSR_MODE: 2,        // hardware flow control DTR, DSR mode
        FT260_UART_XON_XOFF_MODE: 3,       // software flow control mode
        FT260_UART_NO_FLOW_CTRL_MODE: 4    // no flow control mode
    };

    static DATA_BIT = {
        FT260_DATA_BIT_7: 7,
        FT260_DATA_BIT_8: 8
    };

    static STOP_BIT = {
        FT260_STOP_BITS_1: 0,
        FT260_STOP_BITS_2: 2
    };

    static PARITY = {
        FT260_PARITY_NONE: 0,
        FT260_PARITY_ODD: 1,
        FT260_PARITY_EVEN: 2,
        FT260_PARITY_MARK: 3,
        FT260_PARITY_SPACE: 4
    };

    static RI_WAKEUP_TYPE = {
        FT260_RI_WAKEUP_RISING_EDGE: 0,
        FT260_RI_WAKEUP_FALLING_EDGE: 1
    };

    static GPIO_DIR = {
        FT260_GPIO_IN: 0,
        FT260_GPIO_OUT: 1
    };

    static GPIO = {
        FT260_GPIO_0: 1 << 0,
        FT260_GPIO_1: 1 << 1,
        FT260_GPIO_2: 1 << 2,
        FT260_GPIO_3: 1 << 3,
        FT260_GPIO_4: 1 << 4,
        FT260_GPIO_5: 1 << 5,
        FT260_GPIO_A: 1 << 6,
        FT260_GPIO_B: 1 << 7,
        FT260_GPIO_C: 1 << 8,
        FT260_GPIO_D: 1 << 9,
        FT260_GPIO_E: 1 << 10,
        FT260_GPIO_F: 1 << 11,
        FT260_GPIO_G: 1 << 12,
        FT260_GPIO_H: 1 << 13
    };

    static I2C_FLAG = {
        FT260_I2C_NONE: 0,
        FT260_I2C_START: 0x02,
        FT260_I2C_REPEATED_START: 0x03,
        FT260_I2C_STOP: 0x04,
        FT260_I2C_START_AND_STOP: 0x06
    };

    static PARAM_1 = {
        FT260_DS_CTL0: 0x50,
        FT260_DS_CTL3: 0x51,
        FT260_DS_CTL4: 0x52,
        FT260_SR_CTL0: 0x53,
        FT260_GPIO_PULL_UP: 0x61,
        FT260_GPIO_OPEN_DRAIN: 0x62,
        FT260_GPIO_PULL_DOWN: 0x63,
        FT260_GPIO_GPIO_SLEW_RATE: 0x65
    };

    static PARAM_2 = {
        FT260_GPIO_GROUP_SUSPEND_0: 0x10, // for gpio 0 ~ gpio 5
        FT260_GPIO_GROUP_SUSPEND_A: 0x11, // for gpio A ~ gpio H
        FT260_GPIO_DRIVE_STRENGTH: 0x64
    };

    rec_data = [];
    rec_id = 0;

    /**
     * Write data to I2C device
     * @param {HIDDevice} device - HID device object
     * @param {number} i2cAddr - I2C device address
     * @param {number} flag - I2C flags from I2C_FLAG enum
     * @param {Uint8Array} data - Data to write
     * @param {number} bytesToWrite - Number of bytes to write
     * @returns {Promise<{status: number, bytesWritten: number}>}
     */
    static async ft260HidI2cWrite(device, i2cAddr, flag, data, bytesToWrite) {
        try {
            // Sanity check
            if (bytesToWrite > 60) {
                return {
                    status: FT260Wrapper.STATUS.FT260_BUFFER_SIZE_ERROR,
                    bytesWritten: 0
                };
            }

            // Calculate report ID offset
            const x = Math.floor((bytesToWrite - 1) / 4);
            const reportData = new Uint8Array(bytesToWrite + 4);
            
            if((device.vendorId === 0x0403) && (device.productId === 0x71D8)) {
                reportData[0] = 0xD0 + x;
            } else {
                reportData[0] = 0xD0;
            }
            reportData[1] = i2cAddr;            // I2C address
            reportData[2] = flag;               // I2C flags
            reportData[3] = bytesToWrite;       // Number of bytes
            
            // Copy data
            for (let i = 0; i < bytesToWrite; i++) {
                reportData[4 + i] = data[i];
            }

            await device.sendReport(reportData[0], reportData.slice(1));
            
            return {
                status: FT260Wrapper.STATUS.FT260_OK,
                bytesWritten: bytesToWrite
            };
        } catch (error) {
            console.error('I2C Write error:', error);
            return {
                status: FT260Wrapper.STATUS.FT260_IO_ERROR,
                bytesWritten: 0
            };
        }
    }

    /**
     * Read data from I2C device
     * @param {HIDDevice} device - HID device object
     * @param {number} i2cAddr - I2C device address
     * @param {number} flag - I2C flags from I2C_FLAG enum
     * @param {number} bytesToRead - Number of bytes to read
     * @param {number} timeout - Timeout in milliseconds
     * @returns {Promise<{status: number, data: Uint8Array, bytesRead: number}>}
     */
    static async ft260HidI2cRead(device, i2cAddr, flag, bytesToRead, timeout = 1000) {
        try {
            const requestData = new Uint8Array(64);
            requestData[0] = 0xC2;              // Read request report ID
            requestData[1] = i2cAddr;           // I2C address
            requestData[2] = flag;              // I2C flags
            requestData[3] = bytesToRead & 0xFF; // Lower byte of count
            requestData[4] = (bytesToRead >> 8) & 0xFF; // Upper byte

            // Send read request
            await device.sendReport(requestData[0], requestData.slice(1));
            await this.sleep(100);

            // Read response
            // In the C# and HidSharp.dll there is a ReceiveReport method though that is really not a thing with HID
            // so here that is gone and we are using an interrupt listener (defined below ft260HidAddInputReportListener)
            // to capture the report and put the data in FT260Wrapper.rec_data array and the report ID in FT260Wrapper.rec_id
            // which are accessable outside this class

            return;
            
        } catch (error) {
            console.error('I2C Read error:', error);
            return {
                status: FT260Wrapper.STATUS.FT260_I2C_READ_FAIL,
                data: new Uint8Array(0),
                bytesRead: 0
            };
        }
    }

    /**
     * Initialize the event listener for input reports
     */
    static async ft260HidAddInputReportListener(device) {
        device.addEventListener("inputreport", event => {
            const { data, device, reportId } = event; // data

            console.log(`Received ReportID: 0x` + reportId.toString(16));
            FT260Wrapper.rec_id = reportId;
            let value = data.getUint8(0);
            // Get the underlying ArrayBuffer
            const arrayBuffer = data.buffer;

            // Create a Uint8Array from the ArrayBuffer
            const uint8Array = new Uint8Array(arrayBuffer);

            // Convert the Uint8Array to a standard JavaScript Array
            const byteArray = Array.from(uint8Array);
            FT260Wrapper.rec_data = byteArray.slice();

            return;
        });
    }


    /**
     * Initialize I2C master interface
     * @param {HIDDevice} device - HID device object
     * @param {number} speed - I2C speed in KHz (e.g., 100 for 100KHz)
     * @returns {Promise<number>} Status code
     */
    static async ft260HidI2cMasterInit(device, speed) {
        try {
            const featureData = new Uint8Array(64);
            
            // Reset I2C interface
            featureData[0] = 0xA1;
            featureData[1] = 0x20;
            await device.sendFeatureReport(featureData[0], featureData.slice(1));
            await this.sleep(100);

            // Set speed (in KHz)
            featureData[0] = 0xA1;
            featureData[1] = 0x22;
            featureData[2] = speed & 0xFF;
            featureData[3] = (speed >> 8) & 0xFF;
            await device.sendFeatureReport(featureData[0], featureData.slice(1));
            await this.sleep(100);

            return FT260Wrapper.STATUS.FT260_OK;
        } catch (error) {
            console.error('I2C Master Init error:', error);
            return FT260Wrapper.STATUS.FT260_IO_ERROR;
        }
    }

    /**
     * Get I2C master status
     * @param {HIDDevice} device - HID device object
     * @param {boolean} isLinux - Platform flag for Linux compatibility
     * @returns {Promise<{status: number, i2cStatus: number}>}
     */
    static async ft260HidI2cMasterGetStatus(device, isLinux = false) {
        try {
            const featureData = new Uint8Array(64);
            featureData[0] = 0xC0;
            
            const response = await device.receiveFeatureReport(featureData[0]);
            await this.sleep(100);

            const responseData = new Uint8Array(response);
            const i2cStatus = isLinux ? responseData[2] : responseData[1];

            return {
                status: FT260Wrapper.STATUS.FT260_OK,
                i2cStatus: i2cStatus
            };
        } catch (error) {
            console.error('I2C Get Status error:', error);
            return {
                status: FT260Wrapper.STATUS.FT260_IO_ERROR,
                i2cStatus: 0
            };
        }
    }

    /**
     * Close HID device connection
     * @param {HIDDevice} device - HID device object
     * @returns {Promise<number>} Status code
     */
    static async ft260HidClose(device) {
        try {
            await device.close();
            return FT260Wrapper.STATUS.FT260_OK;
        } catch (error) {
            console.error('Device close error:', error);
            return FT260Wrapper.STATUS.FT260_DEVICE_CLOSE_FAIL;
        }
    }

    /**
     * Helper function to sleep/delay execution
     * @param {number} ms - Milliseconds to sleep
     * @returns {Promise} Promise that resolves after delay
     */
    static sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Request access to FT260 HID device
     * @returns {Promise<HIDDevice|null>} HID device object or null if failed
     */
    static async requestDevice(filters) {
        try {
            if (!navigator.hid) {
                throw new Error('Web HID API not supported');
            }

            const devices = await navigator.hid.requestDevice({ filters });

            if (devices.length > 0) {
                // The FT260 returns 2 hid devices, the GPIO one and the I2C one
                for (let device of devices){
                    // The following assumes this is an Exp Noize dev board so if we add other devices to this
                    // we need to use "if" or similar statements to check things like device.vendorid
                    for (const collection of device.collections) { // const
                        if (collection.featureReports) {
                            for (const report of collection.featureReports) { // const
                                // Look for feature report 0xC0 which is the I2C status report, if it esxists this is the correct HID device.
                                // We need to do this as the FT260 can return 2 different HID devices so we need to connect to the correct one
                                if (report.reportId === 0xC0) {
                                    console.log(`device located: ${device.productName}`);
                                    return device;
                                } // if
                            } // for
                        } // if
                    } // for
                } // for
            } // if

            // if here then we did not find a dev board so return null
            return null;
            //return devices.length > 0 ? devices[0] : null;
        } catch (error) {
            console.error('Device request error:', error);
            return null;
        }
    }

    /**
     * Open HID device connection
     * @param {HIDDevice} device - HID device object
     * @returns {Promise<number>} Status code
     */
    static async openDevice(device) {
        try {
            if (!device.opened) {
                await device.open();
            }
            return FT260Wrapper.STATUS.FT260_OK;
        } catch (error) {
            console.error('Device open error:', error);
            return FT260Wrapper.STATUS.FT260_DEVICE_OPEN_FAIL;
        }
    }
}

// Export for use in Node.js or modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FT260Wrapper;
}