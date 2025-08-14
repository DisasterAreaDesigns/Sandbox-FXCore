// User prompt functions, these are things that are on the main page like buttons
let outputDirectoryHandle = null;
let modalResolve = null;
let selectedProgram = 'ram'; // Default to RAM


function showConfirmDialog(title, message) {
    return new Promise((resolve) => {
        document.getElementById('confirmTitle').textContent = title;
        document.getElementById('confirmMessage').textContent = message;
        document.getElementById('confirmModal').style.display = 'block';

        // Store the resolve function for this specific dialog
        const currentResolve = resolve;

        document.getElementById('confirmOkBtn').onclick = () => {
            closeModal('confirmModal');
            currentResolve(true);
        };

        // Override the modal resolve for cancel
        modalResolve = () => currentResolve(false);
    });
}

function showThreeChoiceDialog(title, message) {
    return new Promise((resolve) => {
        document.getElementById('threeChoiceTitle').textContent = title;
        document.getElementById('threeChoiceMessage').textContent = message;
        document.getElementById('threeChoiceModal').style.display = 'block';

        // Store the resolve function for this specific dialog
        const currentResolve = resolve;

        document.getElementById('threeChoiceCancelBtn').onclick = () => {
            closeModal('threeChoiceModal');
            currentResolve('cancel');
        };

        document.getElementById('threeChoiceDiscardBtn').onclick = () => {
            closeModal('threeChoiceModal');
            currentResolve('discard');
        };

        document.getElementById('threeChoiceSaveBtn').onclick = () => {
            closeModal('threeChoiceModal');
            currentResolve('save');
        };

        // Override the modal resolve for clicking outside
        modalResolve = () => currentResolve('cancel');
    });
}

function showInputDialog(title, label, placeholder = '', defaultValue = '') {
    return new Promise((resolve) => {
        document.getElementById('inputTitle').textContent = title;
        document.getElementById('inputLabel').textContent = label;
        const input = document.getElementById('modalInput');
        input.placeholder = placeholder;
        input.value = defaultValue;
        document.getElementById('inputModal').style.display = 'block';

        // Store the resolve function for this specific dialog
        const currentResolve = resolve;

        // Focus the input
        setTimeout(() => input.focus(), 100);

        document.getElementById('inputOkBtn').onclick = () => {
            const value = input.value.trim();
            closeModal('inputModal');
            currentResolve(value || null);
        };

        // Handle Enter key
        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                document.getElementById('inputOkBtn').click();
            }
        };

        // Override the modal resolve for cancel
        modalResolve = () => currentResolve(null);
    });
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
    // Don't automatically resolve here - let the specific handlers do it
}

// Close modal when clicking outside
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        if (modalResolve) {
            modalResolve();
        }
        closeModal(event.target.id);
    }
};

function hasEditorContent() {
    const placeholderText = "; Enter your FXCore assembly code here, load a file, or select an example";
    const value = editor ? editor.getValue().trim() : '';
    return value.length > 0 && value !== placeholderText;
    }

async function loadFile() {
    // Check for unsaved changes FIRST, before opening file picker
    if (window.hasUnsavedChanges && window.hasUnsavedChanges()) {
        const choice = await showThreeChoiceDialog(
            'Unsaved Changes',
            'You have unsaved changes in the editor. What would you like to do before loading a new file?'
        );

        if (choice === 'cancel') {
            return; // User cancelled - don't open file picker
        } else if (choice === 'save') {
            const saveResult = await saveSource();
            if (saveResult === false) {
                return; // User cancelled the save dialog - don't open file picker
            }
        }
        // If choice === 'discard', proceed with opening file picker
    }

    // NOW open the file picker after handling unsaved changes
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.value = ''; // Clear any previous selection
        fileInput.click(); // Open the file picker
    }
}

async function loadExample(exampleName) {
    // Use the new change detection function
    if (window.hasUnsavedChanges && window.hasUnsavedChanges()) {
        const choice = await showThreeChoiceDialog(
            'Unsaved Changes',
            'You have unsaved changes in the editor. What would you like to do before loading an example?'
        );

        if (choice === 'cancel') {
            return; // User cancelled
        } else if (choice === 'save') {
            const saveResult = await saveSource();
            if (saveResult === false) {
                return; // User cancelled the save dialog
            }
        }
        // If choice === 'discard', just proceed with loading
    }

    if (exampleName && examples[exampleName]) {
        if (window.setEditorContent) {
            // Mark as example with descriptive filename
            const exampleFilename = `example_${exampleName}.fxc`;
            window.setEditorContent(examples[exampleName], exampleFilename, '');
        } else {
            editor.updateOptions({ readOnly: false }); // Fallback
            editor.setValue(examples[exampleName]);
        }
        editor.setScrollTop(0);
        editor.setScrollLeft(0);
        
        // Clear assembly output and disable download button
        const outputElement = document.getElementById('output');
        if (outputElement) {
            outputElement.value = '';
        }
        document.getElementById('messages').innerHTML = '';
        document.getElementById('downloadHexBtn').disabled = true;
        document.getElementById('downloadHeaderBtn').disabled = true;
        assembledData = null;
        
        debugLog('Example loaded: ' + exampleName, 'success');
    }
}

function assembleFXCore() {
    if (!editor) {
        debugLog('Editor not initialized', 'errors');
        return;
    }

    const sourceCode = editor.getValue();
    const placeholderText = "; Enter your FXCore assembly code here, load a file, or select an example";
    
    if (!sourceCode.trim() || sourceCode === placeholderText) {
        debugLog('No source code to assemble', 'errors');
        return;
    }

    try {
        // Clear previous message
        document.getElementById('messages').innerHTML = '';

        if (typeof FXCoreAssembler !== 'undefined') {
            // Set source and prep for assembly
            FXCoreAssembler.sourceCode = sourceCode;
            Program.filename = 'editor_source.fxc';
            FXCoreAssembler.assembledHex = null;
            FXCoreAssembler.assembledCHeader = null; // Clear previous C header

            const assembleSuccess = Program.Asm_it();

            if (assembleSuccess && FXCoreAssembler.assembledHex) {
                assembledData = FXCoreAssembler.assembledHex;
                document.getElementById('output').value = FXCoreAssembler.assembledHex;
                document.getElementById('downloadHexBtn').disabled = false;

                // Generate C header from the Intel HEX data
                const cHeaderData = generateCHeaderFromHex(FXCoreAssembler.assembledHex);
                if (cHeaderData) {
                    FXCoreAssembler.assembledCHeader = cHeaderData;
                    window.assembledCHeader = cHeaderData; // Also store globally
                    document.getElementById('downloadHeaderBtn').disabled = false;
                    debugLog('C header generated successfully', 'success');
                } else {
                    debugLog('Failed to generate C header', 'errors');
                    document.getElementById('downloadHeaderBtn').disabled = true;
                }

                debugLog('Assembly completed successfully', 'success');
            } else {
                // Clear any prior output if needed
                document.getElementById('output').value = '';
                document.getElementById('downloadHeaderBtn').disabled = true;
                debugLog('Assembly failed', 'errors');
            }
        } else {
            debugLog('FXCoreAssembler class not available', 'errors');
        }

    } catch (error) {
        debugLog('Assembly error: ' + error.message, 'errors');
        debugLog('FXCoreAssembler class not found', 'errors');

        // Show output section even on error
        const outputContent = document.getElementById('outputContent');
        const outputToggle = document.getElementById('outputToggle');
        if (outputContent) {
            outputContent.classList.remove('collapsed');
        }
        if (outputToggle) {
            outputToggle.textContent = '▼';
        }

        console.error('Assembly error:', error);
    }
}

async function clearAssembly() {
    document.getElementById('output').value = '';
    document.getElementById('messages').innerHTML = '';
    document.getElementById('downloadHexBtn').disabled = true;
    document.getElementById('downloadHeaderBtn').disabled = true; // Add this line
    assembledData = null;
    
    // Clear C header data
    if (typeof FXCoreAssembler !== 'undefined') {
        FXCoreAssembler.assembledCHeader = null;
    }
    window.assembledCHeader = null;
}

async function clearEditor() {
    // Use the new change detection function
    if (window.hasUnsavedChanges && window.hasUnsavedChanges()) {
        const choice = await showThreeChoiceDialog(
            'Unsaved Changes',
            'You have unsaved changes in the editor. What would you like to do before clearing?'
        );

        if (choice === 'cancel') {
            return; // User cancelled
        } else if (choice === 'save') {
            const saveResult = await saveSource();
            if (saveResult === false) {
                return; // User cancelled the save dialog
            }
        }
        // If choice === 'discard', just proceed with clearing
    }

    if (window.resetEditorToPlaceholder) {
        window.resetEditorToPlaceholder(); // Use the new function
    } else {
        // Fallback
        if (editor) {
            const placeholderText = "; Enter your FXCore assembly code here, load a file, or select an example";
            editor.setValue(placeholderText);
            editor.updateOptions({ readOnly: true });
        }
    }
    
    // Clear assembly output and disable download button
    document.getElementById('output').value = '';
    document.getElementById('messages').innerHTML = '';
    document.getElementById('downloadHexBtn').disabled = true;
    assembledData = null;
}

async function saveSource() {
    if (!editor) return false;

    if (!hasEditorContent()) {
        await showConfirmDialog('Save Source', 'There is no content to save.');
        return false;
    }

    // Get current filename and determine default
    let defaultFilename = 'fxcore_source.fxc'; // fallback default
    
    if (window.getCurrentFilename) {
        const currentName = window.getCurrentFilename();
        if (currentName) {
            // Use the current filename if we have one
            defaultFilename = currentName;
        }
    }

    const sourceCode = editor.getValue();
    
    // Try to use File System Access API first
    if ('showSaveFilePicker' in window) {
        try {
            const fileHandle = await window.showSaveFilePicker({
                suggestedName: defaultFilename,
                types: [{
                    description: 'FXCore Assembly files',
                    accept: {
                        'text/plain': ['.fxc', '.asm', '.txt']
                    }
                }]
            });
            
            const writable = await fileHandle.createWritable();
            await writable.write(sourceCode);
            await writable.close();
            
            // Update the current filename to the saved name
            if (window.setCurrentFile) {
                window.setCurrentFile(fileHandle.name, '');
            }
            
            // Mark content as saved
            if (window.updateOriginalContent) {
                window.updateOriginalContent();
            }
            
            debugLog('File saved: ' + fileHandle.name, 'success');
            return true;
            
        } catch (err) {
            if (err.name === 'AbortError') {
                return false; // User cancelled
            } else {
                debugLog('Error saving with file picker: ' + err.message, 'errors');
                // Fall back to blob download
            }
        }
    }
    
    // Fallback for browsers that don't support File System Access API
    // Show a message about the limitation
    const browserSupported = await showConfirmDialog(
        'Save File', 
        'Your browser doesn\'t support the advanced file picker. The file will be downloaded to your default downloads folder. Continue?'
    );
    
    if (!browserSupported) return false;
    
    // Fallback to blob download
    const blob = new Blob([sourceCode], {
        type: 'text/plain'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = defaultFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Update the current filename
    if (window.setCurrentFile) {
        window.setCurrentFile(defaultFilename, '');
    }

    // Mark content as saved - this resets the unsaved changes flag
    if (window.updateOriginalContent) {
        window.updateOriginalContent();
    }

    debugLog('File downloaded: ' + defaultFilename, 'success');
    return true; // Save completed successfully
}

function updateFileInfo() {
    if (window.getCurrentFilename) {
        const filename = window.getCurrentFilename();
        const filepath = window.getCurrentFilePath();
        
        // You can add a UI element to show current file
        const fileInfoElement = document.getElementById('currentFileInfo');
        if (fileInfoElement) {
            if (filename) {
                fileInfoElement.textContent = `File: ${filename}`;
                fileInfoElement.style.display = 'block';
            } else {
                fileInfoElement.style.display = 'none';
            }
        }
    }
}

window.addEventListener('beforeunload', function(e) {
    // Use the new change detection function
    if (window.hasUnsavedChanges && window.hasUnsavedChanges()) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
    }
});

// helper for editor updates
function updateSaveButtonAppearance() {
    const saveBtn = document.querySelector('button[onclick="saveSource()"]');
    if (saveBtn && window.hasUnsavedChanges) {
        const hasChanges = window.hasUnsavedChanges();
        saveBtn.style.opacity = hasChanges ? '1' : '0.6';
        saveBtn.style.fontWeight = hasChanges ? 'bold' : 'normal';
    }
}

// set up change detect on page load
function initializeChangeDetection() {
    // Set up periodic check for UI updates (optional)
    setInterval(() => {
        if (window.updateUIChangeIndicators) {
            window.updateUIChangeIndicators();
        }
    }, 1000); // Check every second
}

// Function to update the program target display
function updateProgramTargetDisplay() {
    const display = document.getElementById('programTargetDisplay');
    if (selectedProgram === 'ram') {
        display.textContent = 'Run from RAM';
    } else {
        display.textContent = `Program ${selectedProgram}`;
    }
}

// Function to update download button text based on current settings
function updateDownloadButtonText() {
    const downloadBtn = document.getElementById('downloadHexBtn');
    if (outputDirectoryHandle) {
        downloadBtn.textContent = 'Download to Programmer';
    } else {
        downloadBtn.textContent = 'Download HEX';
    }
}

// Function to cycle through program targets
function cycleProgramTarget() {
    const targets = ['ram', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16'];
    const currentIndex = targets.indexOf(selectedProgram);
    const nextIndex = (currentIndex + 1) % targets.length;
    selectedProgram = targets[nextIndex];
    
    updateProgramTargetDisplay();
    updateDownloadButtonText();
    console.log('Selected program:', selectedProgram);
}

async function selectOutputDirectory() {
    try {
        if ('showDirectoryPicker' in window) {
            outputDirectoryHandle = await window.showDirectoryPicker();
            document.getElementById('outputDirDisplay').textContent = `Selected: ${outputDirectoryHandle.name}`;
            const outputDirDisplay = document.getElementById('outputDirDisplay');
            outputDirDisplay.style.color = '#28a745'; // Green color for connected
            document.getElementById('messages').innerHTML = '';
            
            // Update button text when directory is selected
            updateDownloadButtonText();
            updateClearHardwareButton(); // Add this line
            
            debugLog('Output directory selected successfully', 'success');
            
            // Try to find and read the hardware identifier JSON file
            if (outputDirectoryHandle) {
                await readHardwareIdentifier();
            }
        } else {
            debugLog('Directory selection not supported in this browser', 'errors');
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            debugLog('Error selecting directory: ' + err.message, 'errors');
        }
    }
}

function updateClearHardwareButton() {
    const clearHardwareBtn = document.getElementById('clearHardwareBtn');
    if (clearHardwareBtn) {
        clearHardwareBtn.disabled = !outputDirectoryHandle;
    }
}

async function readHardwareIdentifier() {
    if (!outputDirectoryHandle) {
        debugLog('No output directory selected', 'errors');
        return;
    }

    try {
        // Try to find a hardware identifier JSON file
        const possibleFilenames = [
            'hardware_id.json',
            'device_info.json', 
            'device_id.json',
            'hardware_info.json',
            'config.json',
            'device.json'
        ];

        let hardwareInfo = null;
        let foundFilename = null;

        for (const filename of possibleFilenames) {
            try {
                const fileHandle = await outputDirectoryHandle.getFileHandle(filename);
                const file = await fileHandle.getFile();
                const content = await file.text();
                
                // Try to parse as JSON
                const jsonData = JSON.parse(content);
                
                // Check if it looks like a hardware identifier file
                if (jsonData.device_type || jsonData.firmware_version || jsonData.device_id || jsonData.hardware_info) {
                    hardwareInfo = jsonData;
                    foundFilename = filename;
                    break;
                }
            } catch (err) {
                // File doesn't exist or can't be read, continue to next filename
                continue;
            }
        }

        if (hardwareInfo) {
            // Check if this is the expected hardware device
            const expectedDeviceType = "FXCore Sandbox"; // Change this to match your expected device
            
            if (hardwareInfo.device_type === expectedDeviceType) {
                displayHardwareInfo(hardwareInfo, foundFilename);
            } else {
                // Hardware device doesn't match - revert to default downloads
                revertToDefaultDirectory();
                debugLog('Hardware device not found, reverting to default directory', 'errors');
                return;
            }
        } else {
            // No hardware identifier found - revert to default downloads
            revertToDefaultDirectory();
            debugLog('Hardware device not found, reverting to default directory', 'errors');
            return;
        }
        
    } catch (err) {
        // Error reading hardware identifier - revert to default downloads
        revertToDefaultDirectory();
        debugLog('Hardware device not found, reverting to default directory', 'errors');
    }
}

// Updated displayHardwareInfo function with proper HTML formatting
function displayHardwareInfo(hardwareInfo, filename) {
    const messages = document.getElementById('messages');
    const existingContent = messages.innerHTML;
    
    let infoHtml = '<div class="success hardware-info">';
    infoHtml += `<strong>Hardware Identifier Found (${filename}):</strong><br>`;
    
    if (hardwareInfo.device_type) {
        infoHtml += `Device Type: <strong>${hardwareInfo.device_type}</strong><br>`;
    }
    
    if (hardwareInfo.firmware_version) {
        infoHtml += `Firmware Version: <strong>${hardwareInfo.firmware_version}</strong><br>`;
    }
    
    if (hardwareInfo.device_id) {
        infoHtml += `Device ID: <strong>${hardwareInfo.device_id}</strong><br>`;
    }
    
    if (hardwareInfo.hardware_info) {
        if (hardwareInfo.hardware_info.manufacturer) {
            infoHtml += `Manufacturer: <strong>${hardwareInfo.hardware_info.manufacturer}</strong><br>`;
        }
        if (hardwareInfo.hardware_info.model) {
            infoHtml += `Model: <strong>${hardwareInfo.hardware_info.model}</strong><br>`;
        }
        if (hardwareInfo.hardware_info.serial_number) {
            infoHtml += `Serial Number: <strong>${hardwareInfo.hardware_info.serial_number}</strong><br>`;
        }
    }
    
    if (hardwareInfo.timestamp) {
        const date = new Date(hardwareInfo.timestamp);
        infoHtml += `Last Updated: <strong>${date.toLocaleString()}</strong><br>`;
    }
    
    infoHtml += '</div>';
    
    messages.innerHTML = existingContent + infoHtml;
}

function revertToDefaultDirectory() {
    // Clear the output directory handle to revert to normal browser downloads
    outputDirectoryHandle = null;
    
    // Update the UI to show no directory selected
    document.getElementById('outputDirDisplay').textContent = 'No directory selected';
    document.getElementById('outputDirDisplay').style.color = '#666';
    
    // Update button text when directory is cleared
    updateDownloadButtonText();
    updateClearHardwareButton(); // Add this line
}

// Helper function for fallback downloads
function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function downloadHex() {
    const hex = document.getElementById('output').value;
    
    // Check if hex content exists
    if (!hex || hex.trim() === '') {
        debugLog('No hex data to download', 'errors');
        return;
    }
    else {
        debugLog('Download started', 'success');
    }
    
    let filename;
    
    // Determine filename based on settings
    if (selectedProgram === 'ram') {
        filename = 'output.hex';
    } else {
        // Convert program number (1-16) to hex filename (0-F.hex)
        const programNum = parseInt(selectedProgram);
        const hexValue = (programNum - 1).toString(16).toUpperCase();
        filename = `${hexValue}.hex`;
    }
    
    // Priority 1: Download to selected directory (programmer)
    if (outputDirectoryHandle && 'showDirectoryPicker' in window) {
        try {
            const fileHandle = await outputDirectoryHandle.getFileHandle(filename, {
                create: true
            });
            const writable = await fileHandle.createWritable();
            await writable.write(hex);
            await writable.close();
            document.getElementById('messages').innerHTML = '';
            debugLog(`File saved as ${filename} in selected directory`, 'success');
            return;
        } catch (err) {
            debugLog('Error saving to directory: ' + err.message, 'errors');
            // Continue to fallback
        }
    }
    
    // Priority 2: Fallback to regular browser download
    downloadFile(filename, hex, 'text/plain');
    debugLog(`File downloaded as ${filename} to default downloads folder`, 'success');
}

// Download C header file
async function downloadCHeader() {
    // Check if we have assembled C header data
    const headerData = window.assembledCHeader || (typeof FXCoreAssembler !== 'undefined' ? FXCoreAssembler.assembledCHeader : null);
    
    if (!headerData) {
        debugLog(`No C header data available - please assemble first`, `errors`);
        return;
    }

    const filename = await showInputDialog(
        'Save C Header File',
        'Enter filename:',
        'Enter filename (e.g., my_program.h)',
        'fxcore_program.h'
    );

    if (!filename) return; // User cancelled

    try {
        // Get the base name and replace the placeholder
        const baseName = filename.replace(/\.[^/.]+$/, ""); // Remove extension
        const finalHeader = headerData.replace(/program_name/g, baseName);

        // Create and download file
        const blob = new Blob([finalHeader], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        debugLog(`C header file ${filename} downloaded successfully`, 'success');
    } catch (error) {
        debugLog(`Error downloading C header: ${error.message}`, 'errors');
    }
}

function generateCHeaderFromHex(hexData) {
    try {
        const lines = hexData.split('\n').filter(line => line.trim().startsWith(':'));
        let mregData = [];
        let cregData = [];
        let sfrData = [];
        let programData = [];
        
        for (const line of lines) {
            if (line.length < 11) continue;
            
            const byteCount = parseInt(line.substring(1, 3), 16);
            const address = parseInt(line.substring(3, 7), 16);
            const recordType = parseInt(line.substring(7, 9), 16);
            
            if (recordType === 0x00) { // Data record
                const data = [];
                for (let i = 0; i < byteCount; i++) {
                    const bytePos = 9 + (i * 2);
                    if (bytePos + 1 < line.length) {
                        const byte = parseInt(line.substring(bytePos, bytePos + 2), 16);
                        data.push(byte);
                    }
                }
                
                // Just append the data based on address - don't overthink it
                if (address === 0x0000) {
                    mregData = mregData.concat(data);
                } else if (address >= 0x0040 && address < 0x0800) {
                    mregData = mregData.concat(data);
                } else if (address >= 0x0800 && address < 0x1000) {
                    cregData = cregData.concat(data);
                } else if (address >= 0x1000 && address < 0x1800) {
                    sfrData = sfrData.concat(data);
                } else if (address >= 0x1800) {
                    programData = programData.concat(data);
                }
            }
        }
        
        return generateCArrays('program_name', mregData, cregData, sfrData, programData);
        
    } catch (error) {
        console.error('Error generating C header from hex:', error);
        return null;
    }
}

// Generate C header arrays
function generateCArrays(baseName, mregData, cregData, sfrData, programData) {
    const mregSize = mregData.length;
    const cregSize = cregData.length;
    const sfrSize = sfrData.length;
    const prgSize = programData.length;
    
    let header = `//Sizes of arrays, order is MREG, CREG, SFRs and program data\n`;
    header += `uint16_t ${baseName}_size[] = {\n`;
    header += `0x${mregSize.toString(16).padStart(4, '0').toUpperCase()}, `;
    header += `0x${cregSize.toString(16).toUpperCase()}, `;
    header += `0x${sfrSize.toString(16).toUpperCase()}, `;
    header += `0x${prgSize.toString(16).padStart(4, '0').toUpperCase()}\n`;
    header += `};\n`;

    // Add MREG array
    header += `const uint8_t ${baseName}_mreg[] = {\n`;
    for (let i = 0; i < mregSize; i += 4) {
        const remaining = Math.min(4, mregSize - i);
        for (let j = 0; j < remaining; j++) {
            header += `0x${mregData[i + j].toString(16).padStart(2, '0').toUpperCase()}`;
            if (j < remaining - 1) header += ', ';
        }
        if (i + 4 < mregSize) header += ', ';
        header += '\n';
    }
    header += `};\n`;

    // Add CREG array
    header += `const uint8_t ${baseName}_creg[] = {\n`;
    for (let i = 0; i < cregSize; i += 4) {
        const remaining = Math.min(4, cregSize - i);
        for (let j = 0; j < remaining; j++) {
            header += `0x${cregData[i + j].toString(16).padStart(2, '0').toUpperCase()}`;
            if (j < remaining - 1) header += ', ';
        }
        if (i + 4 < cregSize) header += ', ';
        header += '\n';
    }
    header += `};\n`;

    // Add SFR array
    header += `const uint8_t ${baseName}_sfr[] = {\n`;
    for (let i = 0; i < sfrSize; i += 4) {
        const remaining = Math.min(4, sfrSize - i);
        for (let j = 0; j < remaining; j++) {
            header += `0x${sfrData[i + j].toString(16).padStart(2, '0').toUpperCase()}`;
            if (j < remaining - 1) header += ', ';
        }
        if (i + 4 < sfrSize) header += ', ';
        header += '\n';
    }
    header += `};\n`;

    // Add program data array
    header += `const uint8_t ${baseName}_prg[] = {\n`;
    for (let i = 0; i < prgSize; i += 4) {
        const remaining = Math.min(4, prgSize - i);
        for (let j = 0; j < remaining; j++) {
            header += `0x${programData[i + j].toString(16).padStart(2, '0').toUpperCase()}`;
            if (j < remaining - 1) header += ', ';
        }
        if (i + 4 < prgSize) header += ', ';
        header += '\n';
    }
    header += `};\n`;
    
    return header;
}

async function clearHardware() {
    // Check if directory is selected, if not do nothing
    if (!outputDirectoryHandle || !('showDirectoryPicker' in window)) {
        debugLog('No output directory selected - hardware clear cancelled', 'errors');
        return;
    }
    
    const emptyHex = ""; // Zero bytes - empty hex file
    
    // List of hex files to create: 0.hex through F.hex plus output.hex
    const hexFiles = [];
    
    // Add 0-9
    for (let i = 0; i <= 9; i++) {
        hexFiles.push(`${i}.hex`);
    }
    
    // Add A-F
    for (let i = 10; i <= 15; i++) {
        hexFiles.push(`${i.toString(16).toUpperCase()}.hex`);
    }
    
    // Add output.hex
    hexFiles.push('output.hex');
    
    try {
        let successCount = 0;
        let errorCount = 0;
        let skippedCount = 0;
        
        // Check each file and only create empty versions if non-zero size files exist
        for (const filename of hexFiles) {
            try {
                // Check if file exists and get its size
                let shouldClear = false;
                try {
                    const existingFileHandle = await outputDirectoryHandle.getFileHandle(filename);
                    const existingFile = await existingFileHandle.getFile();
                    
                    // Only clear if file exists and has non-zero size
                    if (existingFile.size > 0) {
                        shouldClear = true;
                    }
                } catch (err) {
                    // File doesn't exist, skip it
                    skippedCount++;
                    continue;
                }
                
                if (shouldClear) {
                    const fileHandle = await outputDirectoryHandle.getFileHandle(filename, {
                        create: true
                    });
                    const writable = await fileHandle.createWritable();
                    await writable.write(emptyHex);
                    await writable.close();
                    successCount++;
                } else {
                    skippedCount++;
                }
                
            } catch (err) {
                debugLog(`Error processing ${filename}: ${err.message}`, 'errors');
                errorCount++;
            }
        }
        
        // Clear messages area
        document.getElementById('messages').innerHTML = '';
        
        // Report results
        if (errorCount === 0 && successCount > 0) {
            debugLog(`Successfully cleared ${successCount} hex files (${skippedCount} skipped) - hardware cleared`, 'success');
        } else if (successCount > 0) {
            debugLog(`Cleared ${successCount} hex files with ${errorCount} errors (${skippedCount} skipped) - hardware partially cleared`, 'success');
        } else if (skippedCount > 0) {
            debugLog(`No files needed clearing - ${skippedCount} files were empty or non-existent`, 'errors');
        } else {
            debugLog('No hex files found to clear', 'errors');
        }
        
    } catch (err) {
        debugLog('Error during hardware clear: ' + err.message, 'errors');
    }
}

// Toggle minimap function
function toggleMinimap() {
    if (editor) {
        const minimapEnabled = document.getElementById('minimapToggle').checked;
        editor.updateOptions({
            minimap: {
                enabled: minimapEnabled
            }
        });
    }
}

// Dark mode toggle function
function toggleDarkMode() {
    const darkModeEnabled = document.getElementById('darkModeToggle').checked;

    // Toggle Monaco editor theme
    if (editor) {
        const theme = darkModeEnabled ? 'fxcoreDark' : 'fxcoreTheme';
        monaco.editor.setTheme(theme);
    }

    // Toggle body class for page theme
    document.body.classList.toggle('dark-mode', darkModeEnabled);
}


function toggleDebugPreset() {
    const debugToggle = document.getElementById('debugToggle');
    
    if (debugToggle && debugToggle.checked) {
        // Enable basic debug preset
        DEBUG.setPreset('basic');
        console.log('Debug preset set to: basic');
    } else {
        // Reset to clean/minimal debug
        DEBUG.reset();
        console.log('Debug preset reset to: default (clean)');
    }
    
    // Optional: Show the current configuration
    DEBUG.showConfig();
}

// Apply system dark mode preference
function applySystemDarkMode() {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const darkModeToggle = document.getElementById('darkModeToggle');

    if (darkModeToggle && editor) {
        darkModeToggle.checked = prefersDark;
        const theme = prefersDark ? 'fxcoreDark' : 'fxcoreTheme';
        monaco.editor.setTheme(theme);
        document.body.classList.toggle('dark-mode', prefersDark);
    }
}

// toggle dark mode for editor
function toggleEditorHeight() {
    if (editor) {
        const editorContainer = editor.getDomNode().parentElement;
        if (editorContainer) {
            editorContainer.style.height = document.getElementById('editorHeightToggle').checked ?
                '800px' :
                '400px';
            editor.layout();
        }
    }
}

// Toggle output function
function toggleOutput() {
    const outputContent = document.getElementById('outputContent');
    const outputToggle = document.getElementById('outputToggle');

    if (outputContent.classList.contains('collapsed')) {
        outputContent.classList.remove('collapsed');
        outputToggle.textContent = '▼';
    } else {
        outputContent.classList.add('collapsed');
        outputToggle.textContent = '▶';
    }
}

// Toggle instructions function
function toggleInstructions() {
    const instructionsContent = document.getElementById('instructionsContent');
    const instructionsToggle = document.getElementById('instructionsToggle');

    if (instructionsContent.classList.contains('collapsed')) {
        instructionsContent.classList.remove('collapsed');
        instructionsToggle.textContent = '▼';
    } else {
        instructionsContent.classList.add('collapsed');
        instructionsToggle.textContent = '▶';
    }
}

async function serialConnect() {
    console.log('Serial connect initiated');
    try {
        const port = await navigator.serial.requestPort();
        await port.open({ baudRate: 115200 });
        debugLog("Serial port connected", "serial");
        
        // Update the display - simplified
        const portDisplay = document.getElementById('serialPortDisplay');
        portDisplay.textContent = 'Connected';
        portDisplay.style.color = '#28a745'; // Green color for connected
        
        const decoder = new TextDecoderStream();
        port.readable.pipeTo(decoder.writable);
        const reader = decoder.readable.getReader();
        
        // Buffer to accumulate partial lines
        let buffer = '';
        
        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                debugLog("Serial reader closed", "serial");
                // Update display when disconnected
                portDisplay.textContent = 'Disconnected';
                portDisplay.style.color = '#dc3545'; // Red color for disconnected
                
                // Process any remaining data in buffer
                if (buffer.trim()) {
                    debugLog(buffer.trim(), "serial");
                }
                break;
            }
            
            if (value) {
                // Add new data to buffer
                buffer += value;
                
                // Process complete lines
                const lines = buffer.split('\n');
                
                // Keep the last incomplete line in the buffer
                buffer = lines.pop() || '';
                
                // Process all complete lines
                lines.forEach(line => {
                    const trimmedLine = line.replace(/\r$/, '').trim(); // Remove \r and whitespace
                    if (trimmedLine) {
                        debugLog(trimmedLine, "serial");
                    }
                });
            }
        }
    } catch (err) {
        debugLog(`Error opening serial port: ${err.message}`, "serial");
        
        // Update display on error
        const portDisplay = document.getElementById('serialPortDisplay');
        portDisplay.textContent = `Error: ${err.message}`;
        portDisplay.style.color = '#dc3545'; // Red color for error
    }
}

async function handleFileInputChange() {
    const fileInput = document.getElementById('fileInput');
    const file = fileInput.files[0];
    
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        if (editor && window.setEditorContent) {
            window.setEditorContent(e.target.result, file.name, 'Browser Upload');
            // Scroll to the top of the editor
            editor.setScrollTop(0);
            editor.setScrollLeft(0);
        }
        
        // Clear assembly output and disable download button
        const outputElement = document.getElementById('output');
        if (outputElement) {
            outputElement.value = '';
        }
        document.getElementById('messages').innerHTML = '';
        document.getElementById('downloadHexBtn').disabled = true;
        document.getElementById('downloadHeaderBtn').disabled = true;
        assembledData = null;
    };
    reader.readAsText(file);
    debugLog('File loaded: ' + file.name, 'success');
}