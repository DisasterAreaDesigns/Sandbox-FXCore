// use debugLog(message, errorlevel) for message logging.
// consult debug_config.js for details on errorlevels
// success, errors, serial print out to user at all times
// info print out if full build details is checked
// various other levels only log to console

async function connectDevice() {
    // FXCoreTargets.filters is an array of VID/PID pairs to look for valid targets, assumes that
    // all of them use or emulate an FT260
    FXCoreTargets.device = await FT260Wrapper.requestDevice(FXCoreTargets.filters); 
    if (FXCoreTargets.device) {
        const myresult = await FT260Wrapper.openDevice(FXCoreTargets.device);
        if (myresult == FT260Wrapper.STATUS.FT260_OK) {
            debugLog('Device connected!', 'success');
            FT260Wrapper.ft260HidAddInputReportListener(FXCoreTargets.device);
            await FT260Wrapper.ft260HidI2cMasterInit(FXCoreTargets.device, 100);
            // document.getElementById("FXCoreRFRButton").disabled = false;
            // document.getElementById("FXCorePrgButton").disabled = false;
            // document.getElementById("FXCoreConnectButton").disabled = true;
            // document.getElementById('HidDeviceDisplay').textContent = FXCoreTargets.device.productName;
        } else {
            debugLog('Failed to connect to device', 'errors');
        }

        updateHardwareConnectionStatus(); // update connect text

        return;
    }
}

async function disconnectDevice() {
    if (FXCoreTargets.device && FXCoreTargets.device.opened) {
        try {
            await FT260Wrapper.ft260HidClose(FXCoreTargets.device);
            debugLog('HID Device closed', 'success');
            // document.getElementById("FXCoreRFRButton").disabled = true;
            // document.getElementById("FXCorePrgButton").disabled = true;
            // document.getElementById("FXCoreConnectButton").disabled = false;
            // document.getElementById('HidDeviceDisplay').textContent = ' ';
        } catch (error) {
            debugLog('Error closing HID device', 'errors');
        }

        updateHardwareConnectionStatus(); // update connect text
    }
}

async function run_from_ram(action) {
    // is there anything in the text area?
    const text_data = document.getElementById('output').value.trim();
    if (text_data === '') {
        debugLog("No assembly code, operation cancelled", 'errors');
        return; // if area is empty just return
    }
    try {
        // Initialize data arrays
        const prg = new Uint8Array(4098);    // Program data + checksum
        const mreg = new Uint8Array(514);    // MREG presets + checksum
        const creg = new Uint8Array(66);     // CREG presets + checksum
        const sreg = new Uint8Array(50);     // SREG presets + checksum
            
        let pp = 0, mp = 0, cp = 0, sp = 0; // Data pointers
        mycode = new IntelHex;

        const lines = text_data.split(/\r?\n|\r/); // not sure if Windows, Mac or Linux so split on any EOL

        lines.forEach((line, index) => {
            debugLog(`Line ${index + 1}: ${line}`, 'showMachineCode');
            mycode.Read(line);
            debugLog(JSON.stringify(mycode.irec), 'showMachineCode');
            if (mycode.irec.type !== mycode.IHEX_TYPE_00) return; // data records only
            // MREG data range (< 0x800)
            if (mycode.irec.address < 0x800) {
            for (let i = 0; i < mycode.irec.dataLen; i++) {
                mreg[mp + i] = mycode.irec.data[i];
            }
            mp += mycode.irec.dataLen;
        }
        // CREG data range (0x800 - 0x1000)
        else if (mycode.irec.address >= 0x800 && mycode.irec.address < 0x1000) {
            for (let i = 0; i < mycode.irec.dataLen; i++) {
                creg[cp + i] = mycode.irec.data[i];
            }
            cp += mycode.irec.dataLen;
        }
        // SREG data range (0x1000 - 0x1800)
        else if (mycode.irec.address >= 0x1000 && mycode.irec.address < 0x1800) {
            for (let i = 0; i < mycode.irec.dataLen; i++) {
                sreg[sp + i] = mycode.irec.data[i];
            }
            sp += mycode.irec.dataLen;
        }
        // Program data range (>= 0x1800)
        else if (mycode.irec.address >= 0x1800) {
            for (let i = 0; i < mycode.irec.dataLen; i++) {
                prg[pp + i] = mycode.irec.data[i];
            }
            pp += mycode.irec.dataLen;
        }
        });
        debugLog(`Data loaded - MREG: ${mp}, CREG: ${cp}, SREG: ${sp}, Program: ${pp} bytes`, 'info');
        // now send to the chip
        const programmer = new FXCoreProgrammer();
        // Enter programming mode
        debugLog("Entering programming mode", 'success');
        const progModeCmd = new Uint8Array([0xa5, 0x5a, FXCoreTargets.FXCore_I2C]);
        let result = await FT260Wrapper.ft260HidI2cWrite(FXCoreTargets.device, FXCoreTargets.FXCore_I2C, FT260Wrapper.I2C_FLAG.FT260_I2C_START_AND_STOP, progModeCmd, progModeCmd.length);
        await programmer.sleep(100);
        if (result.status !== FT260Wrapper.STATUS.FT260_OK) {
            debugLog('Error setting programming mode:' + result.status, 'errors');
            return false;
        }
        if (result.bytesWritten !== 3) {
            debugLog('Error Programming mode: bytes written != bytes sent', 'errors');
            return false;
        }
        if (!await programmer.waitForI2CReady(FXCoreTargets.device, FXCoreTargets.device)) {
            return false;
        }

        // Send MREG download command and data
        if (!await programmer.sendDataSection(FXCoreTargets.device, FXCoreTargets.FXCore_I2C, 0x047F, mreg, mp, 'MREG')) {
            return false;
        }
        await programmer.sleep(100);
        // Send CREG download command and data  
        if (!await programmer.sendDataSection(FXCoreTargets.device, FXCoreTargets.FXCore_I2C, 0x010F, creg, cp, 'CREG')) {
            return false;
        }
        await programmer.sleep(100);
        // Send SREG download command and data
        if (!await programmer.sendDataSection(FXCoreTargets.device, FXCoreTargets.FXCore_I2C, 0x020B, sreg, sp, 'SFR')) {
            return false;
        }
        await programmer.sleep(100);
        // Send program download command and data
        const progCmd = 0x0800 + Math.floor((pp - 2) / 4) - 1;
        if (!await programmer.sendDataSection(FXCoreTargets.device, FXCoreTargets.FXCore_I2C, progCmd, prg, pp, 'Program')) {
            return false;
        }
        await programmer.sleep(100);

        if (action === 0) {

            // Run from RAM
            const slotCmd = new Uint8Array([
                ((0x0D00) >> 8) & 0xFF,
                (0x0D00) & 0xFF
            ]);

            result = await FT260Wrapper.ft260HidI2cWrite(
                FXCoreTargets.device, FXCoreTargets.FXCore_I2C,
                FT260Wrapper.I2C_FLAG.FT260_I2C_START_AND_STOP,
                slotCmd, slotCmd.length
            );
            await programmer.sleep(50);

            if (result.status !== FT260Wrapper.STATUS.FT260_OK) {
                debugLog('Error sending run from ram command:' + result.status, 'errors');
                return false;
            }
            debugLog('Sent run from ram command', 'success');
            // document.getElementById("FXCoreRFRButton").disabled = true;
            // document.getElementById("FXCoreExitRFRButton").disabled = false;
            // document.getElementById("FXCorePrgButton").disabled = true;
            await programmer.sleep(100);
            return true;
        } else {

            // Program the slot
            const slotCmd = new Uint8Array([
                ((0x0C00 | (parseInt(selectedProgram) & 0x000f)) >> 8) & 0xFF,
                (0x0C00 | (parseInt(selectedProgram) & 0x000f)) & 0xFF
            ]);

            result = await FT260Wrapper.ft260HidI2cWrite(
                FXCoreTargets.device, FXCoreTargets.FXCore_I2C,
                FT260Wrapper.I2C_FLAG.FT260_I2C_START_AND_STOP,
                slotCmd, slotCmd.length
            );

            if (result.status !== FT260Wrapper.STATUS.FT260_OK) {
                debugLog('Error sending program location command:' + result.status, 'errors');
                return false;
            }
            debugLog('Sent program location ' + selectedProgram + ' command', 'success');
            await programmer.sleep(200);
            exit_rfr();
            return true;
        
        }
    } catch (error) {
        debugLog('Programming error:' + error, 'errors');
        return false;
    }
}

async function exit_rfr() {
    // try to return to prog state 0
    let slotCmd = new Uint8Array([
        ((0x0E00) >> 8) & 0xFF,
        (0x0E00) & 0xFF
    ]);
    debugLog("Sending return to program state 0 command to the dev board", 'success');
    
    let result = await FT260Wrapper.ft260HidI2cWrite(FXCoreTargets.device, FXCoreTargets.FXCore_I2C, FT260Wrapper.I2C_FLAG.FT260_I2C_START_AND_STOP, slotCmd, slotCmd.length);
    if (result.status !== FT260Wrapper.STATUS.FT260_OK) {
        debugLog('Error sending return to program state 0 command, error :' + result.status, 'errors');
        return false;
    }

    let timeout = await FT260Wrapper.sleep(100);

    let rtnCmd = new Uint8Array([
        ((0x5AA5) >> 8) & 0xFF,
        (0x5AA5) & 0xFF
    ]);
    debugLog("Sending return to run mode command to the dev board", 'success');
    
    result = await FT260Wrapper.ft260HidI2cWrite(FXCoreTargets.device, FXCoreTargets.FXCore_I2C, FT260Wrapper.I2C_FLAG.FT260_I2C_START_AND_STOP, rtnCmd, rtnCmd.length);
    if (result.status !== FT260Wrapper.STATUS.FT260_OK) {
        debugLog('Error sending return to run mode command, error :' + result.status, 'errors');
        return false;
    }

    timeout = await FT260Wrapper.sleep(100);


    // document.getElementById("FXCoreRFRButton").disabled = false;
    // document.getElementById("FXCoreExitRFRButton").disabled = true;
    // document.getElementById("FXCorePrgButton").disabled = false;


    return;
}

// get the status of the chip
async function GetChipStatus(fxc_addr, devstream, emode) {
    let bytes_written = 0;
    let bytes_read = 0;
    let thisprog = new Uint8Array(3); 
    let Status = 0;
    let ser_num = 0;
    let I2Cstatus = 0;
    let watchdog = 0;
    let islinux = false;

    // try to enter programming mode
    if(emode === true) {
        thisprog[0] = 0xa5;
        thisprog[1] = 0x5a;
        thisprog[2] = fxc_addr;
        
        const writeResult1 = await FT260Wrapper.ft260HidI2cWrite(devstream, fxc_addr, FT260Wrapper.I2C_FLAG.FT260_I2C_START_AND_STOP, thisprog, 3);
        Status = writeResult1.status;
        bytes_written = writeResult1.bytesWritten;
        
        debugLog("Sent command and got status " + Status.toString(), 'info');
        document.getElementById('statusArea').value += "Sent command and got status " + Status.toString()+"\n";
        if (Status !== FT260Wrapper.STATUS.FT260_OK) {
            debugLog("Failed to enter programming mode", 'errors');
            //Status = await FT260Wrapper.ft260HidClose(devstream); // close the board
            //debugLog("Closing board and got status " + Status.toString(), 'info');
            return false;
        }
        if (bytes_written !== 3) {
            debugLog("Wrong number of bytes returned entering programming mode", 'errors');
            //Status = await FT260Wrapper.ft260HidClose(devstream); // close the board
            //debugLog("Closing board and got status " + Status.toString(), 'info');
            return false;
        }

        // check we really got an ack to address and data
        const statusResult1 = await FT260Wrapper.ft260HidI2cMasterGetStatus(devstream, islinux);
        Status = statusResult1.status;
        I2Cstatus = statusResult1.i2cStatus;
            
    }
    // loop while controller or I2C bus are busy but time out after 5 seconds, note there is a 100mS delay in ft260HidI2cMasterGetStatus
    debugLog("Waiting on I2C bus", 'info');
    document.getElementById('statusArea').value += "Waiting on I2C bus\n";
    watchdog = 0;
    while ((I2Cstatus & 0x41) !== 0) {
        await FT260Wrapper.sleep(1);
        watchdog++;
        if (watchdog > 50) {
            debugLog("Time out waiting for response from FXCore, please check hardware and restart", 'errors');
            //Status = await FT260Wrapper.ft260HidClose(devstream); // close the board
            //debugLog("Closing board and got status " + Status.toString(), 'info');
            return false;
        }

        const statusResult2 = await FT260Wrapper.ft260HidI2cMasterGetStatus(devstream, islinux);
        Status = statusResult2.status;
        I2Cstatus = statusResult2.i2cStatus;
        if (watchdog === 5) debugLog("Looping getting status " + I2Cstatus.toString(16).toUpperCase().padStart(2, '0'), 'info');
    }
    //debugLog("I2C status: 0x" + I2Cstatus.toString(16).toUpperCase().padStart(2, '0'), 'info');
    
    // if controller is not busy and there is an error condition let the user know
    if (((I2Cstatus & 0x01) === 0) && ((I2Cstatus & 0x02) !== 0)) {
        if ((I2Cstatus & 0x04) !== 0) {
            debugLog("Slave address was not acknowledged, please check hardware and restart", 'errors');
        }
        if ((I2Cstatus & 0x08) !== 0) {
            debugLog("Data was not acknowledged, please check hardware and restart", 'errors');
        }
        if ((I2Cstatus & 0x10) !== 0) {
            debugLog("Arbitration was lost either there is more than one bus master or there is an issue with the SDA or SCL line, please check hardware and restart", 'errors');
        }
        if ((I2Cstatus & 0x20) !== 0) {
            debugLog("I2C controller idle", 'info');
        }
        if ((I2Cstatus & 0x40) !== 0) {
            debugLog("I2C bus busy", 'info');
        }
        //Status = await FT260Wrapper.ft260HidClose(devstream); // close the board
        //debugLog("Closing board and got status " + Status.toString(), 'info');
        return false;
    } else {
        if ((I2Cstatus & 0x04) !== 0) {
            debugLog("Slave address was not acknowledged, please check hardware and restart", 'errors');
        }
        if ((I2Cstatus & 0x08) !== 0) {
            debugLog("Data was not acknowledged, please check hardware and restart", 'errors');
        }
        if ((I2Cstatus & 0x10) !== 0) {
            debugLog("Arbitration was lost either there is more than one bus master or there is an issue with the SDA or SCL line, please check hardware and restart", 'errors');
        }
        if ((I2Cstatus & 0x20) !== 0) {
            debugLog("I2C controller idle", 'info');
        }
        if ((I2Cstatus & 0x40) !== 0) {
            debugLog("I2C us busy", 'info');
        }
    }

    debugLog("Board opened waiting on FXCore to enter programming mode", 'info');
    document.getElementById('statusArea').value += "Board opened waiting on FXCore to enter programming mode\n";
    // Opened board OK, wait to allow FXCore to enter programming mode then read SN
    await FT260Wrapper.sleep(100);
    
    await FT260Wrapper.ft260HidI2cRead(devstream, fxc_addr, FT260Wrapper.I2C_FLAG.FT260_I2C_START_AND_STOP, 12, 5000);
    await FT260Wrapper.sleep(100);

    document.getElementById('statusArea').value += "Received reportID: 0x"+FT260Wrapper.rec_id.toString(16)+"\n";
    bytes_read = FT260Wrapper.rec_data[0];
    debugLog("Received reports size: "+bytes_read, 'info');
    document.getElementById('statusArea').value += "Received reports size: "+bytes_read+"\n";
    // shift array to align with existing code/format
    FT260Wrapper.rec_data.shift();

    debugLog("I2C status " + Status.toString(), 'info');
    document.getElementById('statusArea').value += "I2C status " + Status.toString()+"\n";
    if (Status !== FT260Wrapper.STATUS.FT260_OK) {
        // exit programming mode and close board
        debugLog("Failed reading status word", 'errors');
        debugLog("Got status " + Status.toString(), 'info');
        thisprog[0] = 0x5a;
        thisprog[1] = 0xa5;
        const writeResult2 = await FT260Wrapper.ft260HidI2cWrite(devstream, fxc_addr, FT260Wrapper.I2C_FLAG.FT260_I2C_START_AND_STOP, thisprog, 2);
        debugLog("I2C write status " + writeResult2.status.toString(), 'info');
        //Status = await FT260Wrapper.ft260HidClose(devstream); // close the board
        //debugLog("Closing board and got status " + Status.toString(), 'info');
        return false;
    }
    if (bytes_read !== 12) {
        // exit programming mode and close board
        debugLog("Wrong number of bytes returned reading status word", 'errors');
        debugLog("Got status " + Status.toString(), 'info');
        thisprog[0] = 0x5a;
        thisprog[1] = 0xa5;
        const writeResult3 = await FT260Wrapper.ft260HidI2cWrite(devstream, fxc_addr, FT260Wrapper.I2C_FLAG.FT260_I2C_START_AND_STOP, thisprog, 2);
        debugLog("I2C write status " + writeResult3.status.toString(), 'info');
        
        return false;
    }

    ser_num = (FT260Wrapper.rec_data[11] << 24) | (FT260Wrapper.rec_data[10] << 16) | (FT260Wrapper.rec_data[9] << 8) | FT260Wrapper.rec_data[8];

    let output = "Returned data:\n0x";
    for (let x = 11; x > 0; x--) {
        output += FT260Wrapper.rec_data[x].toString(16).toUpperCase().padStart(2, '0');
    }
    debugLog(output, 'info');
    document.getElementById('statusArea').value += output+"\n";

    // program and register presets
    if ((FT260Wrapper.rec_data[0] & 0x10) !== 0) {
        debugLog("Program successfully received", 'info');
    } else {
        debugLog("Program was not successfully received", 'errors');
    }
    if ((FT260Wrapper.rec_data[0] & 0x08) !== 0) {
        debugLog("At least 1 register presets successfully received", 'info');
    } else {
        debugLog("No register presets successfully received", 'errors');
    }
    if ((FT260Wrapper.rec_data[0] & 0x04) !== 0) {
        debugLog("MREGs register presets successfully received", 'info');
    } else {
        debugLog("MREGs register preset were not successfully received", 'errors');
    }
    if ((FT260Wrapper.rec_data[0] & 0x02) !== 0) {
        debugLog("SFRs register presets successfully received", 'info');
    } else {
        debugLog("SFRs register preset were not successfully received", 'errors');
    }
    if ((FT260Wrapper.rec_data[0] & 0x01) !== 0) {
        debugLog("CREGs register presets successfully received", 'info');
    } else {
        debugLog("CREGs register preset were not successfully received", 'errors');
    }

    // Command and FLASH status
    if (FT260Wrapper.rec_data[1] === 0xFF) {
        debugLog("Unknown command", 'errors');
    } else {
        debugLog("Command recognized", 'info');
    }
    if (FT260Wrapper.rec_data[1] === 0xFE) {
        debugLog("Command length error", 'errors');
    } else {
        debugLog("Command length correct", 'info');
    }
    if (FT260Wrapper.rec_data[1] === 0xFD) {
        debugLog("Parameter out of range", 'errors');
    } else {
        debugLog("Parameter in range", 'info');
    }
    if (FT260Wrapper.rec_data[1] === 0xFC) {
        debugLog("Command not allowed in current state", 'errors');
    } else {
        debugLog("Command allowed in current state", 'info');
    }
    if (FT260Wrapper.rec_data[1] === 0x80) {
        debugLog("Calculated checksum did not match received checksum", 'errors');
    } else {
        debugLog("Calculated checksum and received checksum matched", 'info');
    }
    if ((FT260Wrapper.rec_data[1] & 0xF0) === 0x40) {
        debugLog("Unknown program transfer error, state reset to STATE0", 'errors');
    } else {
        debugLog("No unknown program transfer errors", 'info');
    }
    if ((FT260Wrapper.rec_data[1] === 0x3F) || (FT260Wrapper.rec_data[1] === 0x2F) || (FT260Wrapper.rec_data[1] === 0x1F)) {
        debugLog("FLASH erase error", 'errors');
    } else {
        debugLog("No FLASH erase error", 'info');
    }
    if ((((FT260Wrapper.rec_data[1] & 0xF0) === 0x30) || ((FT260Wrapper.rec_data[1] & 0xF0) === 0x20) || ((FT260Wrapper.rec_data[1] & 0xF0) === 0x10)) && ((FT260Wrapper.rec_data[1] & 0x0F) !== 0x0F)) {
        debugLog("FLASH write error", 'errors');
    } else {
        debugLog("No FLASH write error", 'info');
    }
    
    debugLog("Command high byte 0x" + FT260Wrapper.rec_data[2].toString(16).toUpperCase().padStart(2, '0'), 'info');
    debugLog("Command low byte 0x" + FT260Wrapper.rec_data[3].toString(16).toUpperCase().padStart(2, '0'), 'info');
    debugLog("Program slots status 0x" + FT260Wrapper.rec_data[5].toString(16).toUpperCase().padStart(2, '0') + FT260Wrapper.rec_data[4].toString(16).toUpperCase().padStart(2, '0'), 'info');
    debugLog("Production version ID 0x" + FT260Wrapper.rec_data[7].toString(16).toUpperCase().padStart(2, '0') + FT260Wrapper.rec_data[6].toString(16).toUpperCase().padStart(2, '0'), 'info');
    debugLog("Serial number 0x" + ser_num.toString(16).toUpperCase().padStart(8, '0'), 'info');

    document.getElementById('statusArea').value += "Serial number 0x" + ser_num.toString(16).toUpperCase().padStart(8, '0')+"\n";

 if (emode === true) {
    debugLog("Exiting programming mode", 'info');
    thisprog[0] = 0x5a;
    thisprog[1] = 0xa5;
    const writeResult4 = await FT260Wrapper.ft260HidI2cWrite(devstream, fxc_addr, FT260Wrapper.I2C_FLAG.FT260_I2C_START_AND_STOP, thisprog, 2);
    Status = writeResult4.status;
    debugLog("Got status " + Status.toString(), 'info');
    
    if (Status !== FT260Wrapper.STATUS.FT260_OK) {
        // exit programming mode
        debugLog("Failed exiting programming mode", 'errors');
        thisprog[0] = 0x5a;
        thisprog[1] = 0xa5;
        const writeResult5 = await FT260Wrapper.ft260HidI2cWrite(devstream, fxc_addr, FT260Wrapper.I2C_FLAG.FT260_I2C_START_AND_STOP, thisprog, 2);
        debugLog("I2C write status " + writeResult5.status.toString(), 'info');
        
        return false;
    }
 }
   
    await FT260Wrapper.sleep(100);
    return true;
}

// Recursively examine JSON to find the programs as they are in a nested structure. 
function traverseJson(obj,prgms) {
    if (obj !== null && typeof obj === 'object') {
        if (Array.isArray(obj)) {
            // If it's an array, iterate through its elements
            obj.forEach(item => traverseJson(item,prgms));
        } else {
            // If it's an object, iterate through its properties
            Object.entries(obj).forEach(([key, value]) => {
                if (key === "download_url") {
                    prgms.push(`${value}`);
                }
                    traverseJson(value,prgms); // Recursively call for nested values
            });
        }
    }
}

// This routine gets the raw page text, for a github directory call it is in JSON, for the programs just plain text
const getPageText = async url => {
  const response = await fetch(url);
  if(!response.ok) // check if response worked (no 404 errors etc...)
    throw new Error(response.statusText);

  const data = response.text(); // get raw page text
  return data; 
}