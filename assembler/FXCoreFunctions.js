async function connectDevice() {
    // FXCoreTargets.filters is an array of VID/PID pairs to look for valid targets, assumes that
    // all of them use or emulate an FT260
    FXCoreTargets.device = await FT260Wrapper.requestDevice(FXCoreTargets.filters); 
    if (FXCoreTargets.device) {
        const myresult = await FT260Wrapper.openDevice(FXCoreTargets.device);
        if (myresult == FT260Wrapper.STATUS.FT260_OK) {
            console.log('Device connected!');
            FT260Wrapper.ft260HidAddInputReportListener(FXCoreTargets.device);
            await FT260Wrapper.ft260HidI2cMasterInit(FXCoreTargets.device, 100);
            document.getElementById("FXCoreRFRButton").disabled = false;
            document.getElementById("FXCorePrgButton").disabled = false;
            document.getElementById("FXCoreConnectButton").disabled = true;
            document.getElementById('HidDeviceDisplay').textContent = FXCoreTargets.device.productName;
        } else {
            console.log('Failed to connect to device');
        }
        return;
    }
}

async function run_from_ram(action) {
    // is there anything in the text area?
    const text_data = document.getElementById('output').value.trim();
    if (text_data === '') {
        console.log("Empty textarea, returning");
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
            console.log(`Line ${index + 1}: ${line}`);
            mycode.Read(line);
            console.log(mycode.irec);
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
        console.log(`Data loaded - MREG: ${mp}, CREG: ${cp}, SREG: ${sp}, Program: ${pp} bytes`);
        // now send to the chip
        const programmer = new FXCoreProgrammer();
        // Enter programming mode
        console.log("Entering programming mode")
        const progModeCmd = new Uint8Array([0xa5, 0x5a, FXCoreTargets.FXCore_I2C]);
        let result = await FT260Wrapper.ft260HidI2cWrite(FXCoreTargets.device, FXCoreTargets.FXCore_I2C, FT260Wrapper.I2C_FLAG.FT260_I2C_START_AND_STOP, progModeCmd, progModeCmd.length);
        await programmer.sleep(100);
        if (result.status !== FT260Wrapper.STATUS.FT260_OK) {
            console.log('Error setting programming mode:', result.status);
            return false;
        }
        if (result.bytesWritten !== 3) {
            console.log('Error Programming mode: bytes written != bytes sent');
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
                console.log('Error sending run from ram command:', result.status);
                return false;
            }
            console.log('Sent run from ram command');
            document.getElementById("FXCoreRFRButton").disabled = true;
            document.getElementById("FXCoreExitRFRButton").disabled = false;
            document.getElementById("FXCorePrgButton").disabled = true;
            await programmer.sleep(100);
            return true;
        } else {

            // Program the slot
            const slotCmd = new Uint8Array([
                ((0x0C00 | (FXCoreTargets.FXCore_Prg & 0x000f)) >> 8) & 0xFF,
                (0x0C00 | (FXCoreTargets.FXCore_Prg & 0x000f)) & 0xFF
            ]);

            result = await FT260Wrapper.ft260HidI2cWrite(
                FXCoreTargets.device, FXCoreTargets.FXCore_I2C,
                FT260Wrapper.I2C_FLAG.FT260_I2C_START_AND_STOP,
                slotCmd, slotCmd.length
            );

            if (result.status !== FT260Wrapper.STATUS.FT260_OK) {
                console.log('Error sending program location command:', result.status);
                return false;
            }
            console.log('Sent program location ' + FXCoreTargets.FXCore_Prg + ' command');
            await programmer.sleep(200);
            exit_rfr();
            return true;
        
        }
    } catch (error) {
        console.error('Programming error:', error);
        return false;
    }
}

async function exit_rfr() {
    // try to return to prog state 0
    let slotCmd = new Uint8Array([
        ((0x0E00) >> 8) & 0xFF,
        (0x0E00) & 0xFF
    ]);
    console.log("Sending return to program state 0 command to the dev board");
    
    let result = await FT260Wrapper.ft260HidI2cWrite(FXCoreTargets.device, FXCoreTargets.FXCore_I2C, FT260Wrapper.I2C_FLAG.FT260_I2C_START_AND_STOP, slotCmd, slotCmd.length);
    if (result.status !== FT260Wrapper.STATUS.FT260_OK) {
        console.log('Error sending return to program state 0 command, error :', result.status);
        return false;
    }

    new Promise(resolve => setTimeout(resolve, 100));

    let rtnCmd = new Uint8Array([
        ((0x5AA5) >> 8) & 0xFF,
        (0x5AA5) & 0xFF
    ]);
    console.log("Sending return to run mode command to the dev board");
    
    result = await FT260Wrapper.ft260HidI2cWrite(FXCoreTargets.device, FXCoreTargets.FXCore_I2C, FT260Wrapper.I2C_FLAG.FT260_I2C_START_AND_STOP, rtnCmd, rtnCmd.length);
    if (result.status !== FT260Wrapper.STATUS.FT260_OK) {
        console.log('Error sending return to run mode command, error :', result.status);
        return false;
    }

    new Promise(resolve => setTimeout(resolve, 100));

    document.getElementById("FXCoreRFRButton").disabled = false;
    document.getElementById("FXCoreExitRFRButton").disabled = true;
    document.getElementById("FXCorePrgButton").disabled = false;


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
        
        console.log("Sent command and got status " + Status.toString());
        document.getElementById('statusArea').value += "Sent command and got status " + Status.toString()+"\n";
        if (Status !== FT260Wrapper.STATUS.FT260_OK) {
            console.log("Failed to enter programming mode");
            //Status = await FT260Wrapper.ft260HidClose(devstream); // close the board
            //console.log("Closing board and got status " + Status.toString());
            return false;
        }
        if (bytes_written !== 3) {
            console.log("Wrong number of bytes returned entering programming mode");
            //Status = await FT260Wrapper.ft260HidClose(devstream); // close the board
            //console.log("Closing board and got status " + Status.toString());
            return false;
        }

        // check we really got an ack to address and data
        const statusResult1 = await FT260Wrapper.ft260HidI2cMasterGetStatus(devstream, islinux);
        Status = statusResult1.status;
        I2Cstatus = statusResult1.i2cStatus;
            
    }
    // loop while controller or I2C bus are busy but time out after 5 seconds, note there is a 100mS delay in ft260HidI2cMasterGetStatus
    console.log("Waiting on I2C bus");
    document.getElementById('statusArea').value += "Waiting on I2C bus\n";
    watchdog = 0;
    while ((I2Cstatus & 0x41) !== 0) {
        await FT260Wrapper.sleep(1);
        watchdog++;
        if (watchdog > 50) {
            console.log("Time out waiting for response from FXCore, please check hardware and restart");
            //Status = await FT260Wrapper.ft260HidClose(devstream); // close the board
            //console.log("Closing board and got status " + Status.toString());
            return false;
        }

        const statusResult2 = await FT260Wrapper.ft260HidI2cMasterGetStatus(devstream, islinux);
        Status = statusResult2.status;
        I2Cstatus = statusResult2.i2cStatus;
        if (watchdog === 5) console.log("Looping getting status " + I2Cstatus.toString(16).toUpperCase().padStart(2, '0'));
    }
    //console.log("I2C status: 0x" + I2Cstatus.toString(16).toUpperCase().padStart(2, '0'));
    
    // if controller is not busy and there is an error condition let the user know
    if (((I2Cstatus & 0x01) === 0) && ((I2Cstatus & 0x02) !== 0)) {
        if ((I2Cstatus & 0x04) !== 0) {
            console.log("Slave address was not acknowledged, please check hardware and restart");
        }
        if ((I2Cstatus & 0x08) !== 0) {
            console.log("Data was not acknowledged, please check hardware and restart");
        }
        if ((I2Cstatus & 0x10) !== 0) {
            console.log("Arbitration was lost either there is more than one bus master or there is an issue with the SDA or SCL line, please check hardware and restart");
        }
        if ((I2Cstatus & 0x20) !== 0) {
            console.log("I2C controller idle");
        }
        if ((I2Cstatus & 0x40) !== 0) {
            console.log("I2C bus busy");
        }
        //Status = await FT260Wrapper.ft260HidClose(devstream); // close the board
        //console.log("Closing board and got status " + Status.toString());
        return false;
    } else {
        if ((I2Cstatus & 0x04) !== 0) {
            console.log("Slave address was not acknowledged, please check hardware and restart");
        }
        if ((I2Cstatus & 0x08) !== 0) {
            console.log("Data was not acknowledged, please check hardware and restart");
        }
        if ((I2Cstatus & 0x10) !== 0) {
            console.log("Arbitration was lost either there is more than one bus master or there is an issue with the SDA or SCL line, please check hardware and restart");
        }
        if ((I2Cstatus & 0x20) !== 0) {
            console.log("I2C controller idle");
        }
        if ((I2Cstatus & 0x40) !== 0) {
            console.log("I2C us busy");
        }
    }

    console.log("Board opened waiting on FXCore to enter programming mode");
    document.getElementById('statusArea').value += "Board opened waiting on FXCore to enter programming mode\n";
    // Opened board OK, wait to allow FXCore to enter programming mode then read SN
    await FT260Wrapper.sleep(100);
    
    await FT260Wrapper.ft260HidI2cRead(devstream, fxc_addr, FT260Wrapper.I2C_FLAG.FT260_I2C_START_AND_STOP, 12, 5000);
    await FT260Wrapper.sleep(100);

    document.getElementById('statusArea').value += "Received reportID: 0x"+FT260Wrapper.rec_id.toString(16)+"\n";
    bytes_read = FT260Wrapper.rec_data[0];
    console.log("Received reports size: "+bytes_read);
    document.getElementById('statusArea').value += "Received reports size: "+bytes_read+"\n";
    // shift array to align with existing code/format
    FT260Wrapper.rec_data.shift();

    console.log("I2C status " + Status.toString());
    document.getElementById('statusArea').value += "I2C status " + Status.toString()+"\n";
    if (Status !== FT260Wrapper.STATUS.FT260_OK) {
        // exit programming mode and close board
        console.log("Failed reading status word");
        console.log("Got status " + Status.toString());
        thisprog[0] = 0x5a;
        thisprog[1] = 0xa5;
        const writeResult2 = await FT260Wrapper.ft260HidI2cWrite(devstream, fxc_addr, FT260Wrapper.I2C_FLAG.FT260_I2C_START_AND_STOP, thisprog, 2);
        console.log("I2C write status " + writeResult2.status.toString());
        //Status = await FT260Wrapper.ft260HidClose(devstream); // close the board
        //console.log("Closing board and got status " + Status.toString());
        return false;
    }
    if (bytes_read !== 12) {
        // exit programming mode and close board
        console.log("Wrong number of bytes returned reading status word");
        console.log("Got status " + Status.toString());
        thisprog[0] = 0x5a;
        thisprog[1] = 0xa5;
        const writeResult3 = await FT260Wrapper.ft260HidI2cWrite(devstream, fxc_addr, FT260Wrapper.I2C_FLAG.FT260_I2C_START_AND_STOP, thisprog, 2);
        console.log("I2C write status " + writeResult3.status.toString());
        
        return false;
    }

    ser_num = (FT260Wrapper.rec_data[11] << 24) | (FT260Wrapper.rec_data[10] << 16) | (FT260Wrapper.rec_data[9] << 8) | FT260Wrapper.rec_data[8];

    let output = "Returned data:\n0x";
    for (let x = 11; x > 0; x--) {
        output += FT260Wrapper.rec_data[x].toString(16).toUpperCase().padStart(2, '0');
    }
    console.log(output);
    document.getElementById('statusArea').value += output+"\n";

    // program and register presets
    if ((FT260Wrapper.rec_data[0] & 0x10) !== 0) {
        console.log("Program successfully received");
    } else {
        console.log("Program was not successfully received");
    }
    if ((FT260Wrapper.rec_data[0] & 0x08) !== 0) {
        console.log("At least 1 register presets successfully received");
    } else {
        console.log("No register presets successfully received");
    }
    if ((FT260Wrapper.rec_data[0] & 0x04) !== 0) {
        console.log("MREGs register presets successfully received");
    } else {
        console.log("MREGs register preset were not successfully received");
    }
    if ((FT260Wrapper.rec_data[0] & 0x02) !== 0) {
        console.log("SFRs register presets successfully received");
    } else {
        console.log("SFRs register preset were not successfully received");
    }
    if ((FT260Wrapper.rec_data[0] & 0x01) !== 0) {
        console.log("CREGs register presets successfully received");
    } else {
        console.log("CREGs register preset were not successfully received");
    }

    // Command and FLASH status
    if (FT260Wrapper.rec_data[1] === 0xFF) {
        console.log("Unknown command");
    } else {
        console.log("Command recognized");
    }
    if (FT260Wrapper.rec_data[1] === 0xFE) {
        console.log("Command length error");
    } else {
        console.log("Command length correct");
    }
    if (FT260Wrapper.rec_data[1] === 0xFD) {
        console.log("Parameter out of range");
    } else {
        console.log("Parameter in range");
    }
    if (FT260Wrapper.rec_data[1] === 0xFC) {
        console.log("Command not allowed in current state");
    } else {
        console.log("Command allowed in current state");
    }
    if (FT260Wrapper.rec_data[1] === 0x80) {
        console.log("Calculated checksum did not match received checksum");
    } else {
        console.log("Calculated checksum and received checksum matched");
    }
    if ((FT260Wrapper.rec_data[1] & 0xF0) === 0x40) {
        console.log("Unknown program transfer error, state reset to STATE0");
    } else {
        console.log("No unknown program transfer errors");
    }
    if ((FT260Wrapper.rec_data[1] === 0x3F) || (FT260Wrapper.rec_data[1] === 0x2F) || (FT260Wrapper.rec_data[1] === 0x1F)) {
        console.log("FLASH erase error");
    } else {
        console.log("No FLASH erase error");
    }
    if ((((FT260Wrapper.rec_data[1] & 0xF0) === 0x30) || ((FT260Wrapper.rec_data[1] & 0xF0) === 0x20) || ((FT260Wrapper.rec_data[1] & 0xF0) === 0x10)) && ((FT260Wrapper.rec_data[1] & 0x0F) !== 0x0F)) {
        console.log("FLASH write error");
    } else {
        console.log("No FLASH write error");
    }
    
    console.log("Command high byte 0x" + FT260Wrapper.rec_data[2].toString(16).toUpperCase().padStart(2, '0'));
    console.log("Command low byte 0x" + FT260Wrapper.rec_data[3].toString(16).toUpperCase().padStart(2, '0'));
    console.log("Program slots status 0x" + FT260Wrapper.rec_data[5].toString(16).toUpperCase().padStart(2, '0') + FT260Wrapper.rec_data[4].toString(16).toUpperCase().padStart(2, '0'));
    console.log("Production version ID 0x" + FT260Wrapper.rec_data[7].toString(16).toUpperCase().padStart(2, '0') + FT260Wrapper.rec_data[6].toString(16).toUpperCase().padStart(2, '0'));
    console.log("Serial number 0x" + ser_num.toString(16).toUpperCase().padStart(8, '0'));

    document.getElementById('statusArea').value += "Serial number 0x" + ser_num.toString(16).toUpperCase().padStart(8, '0')+"\n";

 if (emode === true) {
    console.log("Exiting programming mode");
    thisprog[0] = 0x5a;
    thisprog[1] = 0xa5;
    const writeResult4 = await FT260Wrapper.ft260HidI2cWrite(devstream, fxc_addr, FT260Wrapper.I2C_FLAG.FT260_I2C_START_AND_STOP, thisprog, 2);
    Status = writeResult4.status;
    console.log("Got status " + Status.toString());
    
    if (Status !== FT260Wrapper.STATUS.FT260_OK) {
        // exit programming mode
        console.log("Failed exiting programming mode");
        thisprog[0] = 0x5a;
        thisprog[1] = 0xa5;
        const writeResult5 = await FT260Wrapper.ft260HidI2cWrite(devstream, fxc_addr, FT260Wrapper.I2C_FLAG.FT260_I2C_START_AND_STOP, thisprog, 2);
        console.log("I2C write status " + writeResult5.status.toString());
        
        return false;
    }
 }
   
    await FT260Wrapper.sleep(100);
    return true;
}