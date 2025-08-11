// User prompt functions, these are things that are on the main page like buttons
let outputDirectoryHandle = null;
let modalResolve = null;
let selectedProgram = 'ram'; // Default to RAM


// let selectedOutputFile = null;

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

// Check if editor has content
function hasEditorContent() {
    const placeholderText = "; Enter your FXCore assembly code here, load a file, or select an example";
    const value = editor ? editor.getValue().trim() : '';
    return value.length > 0 && value !== placeholderText;
}

// Prompt to save before leaving page
window.addEventListener('beforeunload', function(e) {
    if (hasEditorContent()) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
    }
});

async function loadFile() {
    if (hasEditorContent()) {
        const choice = await showThreeChoiceDialog(
            'Unsaved Changes',
            'You have unsaved changes in the editor. What would you like to do before loading a new file?'
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

    const fileInput = document.getElementById('fileInput');
    const file = fileInput.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            if (editor) {
                editor.updateOptions({ readOnly: false }); // Make editable
                editor.setValue(e.target.result);
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
            assembledData = null;
        };
        reader.readAsText(file);
        debugLog('File loaded', 'success');
    }
}

async function loadExample(exampleName) {
    if (hasEditorContent()) {
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
        editor.updateOptions({ readOnly: false }); // Make editable
        editor.setValue(examples[exampleName]);
        editor.setScrollTop(0);
        editor.setScrollLeft(0);
        
        // Clear assembly output and disable download button
        const outputElement = document.getElementById('output');
        if (outputElement) {
            outputElement.value = '';
        }
        document.getElementById('messages').innerHTML = '';
        document.getElementById('downloadHexBtn').disabled = true;
        assembledData = null;
        
        debugLog('Example loaded', 'success');
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

            const assembleSuccess = Program.Asm_it();

            if (assembleSuccess && FXCoreAssembler.assembledHex) {
                assembledData = FXCoreAssembler.assembledHex;
                document.getElementById('output').value = FXCoreAssembler.assembledHex;
                document.getElementById('downloadHexBtn').disabled = false;

                debugLog('Assembly completed successfully', 'success');
            } else {
                // Clear any prior output if needed
                document.getElementById('output').value = '';
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

// Modified clear assembly with prompt (only clears output, not editor)
async function clearAssembly() {
    document.getElementById('output').value = '';
    document.getElementById('messages').innerHTML = '';
    document.getElementById('downloadHexBtn').disabled = true;
    assembledData = null;
}

async function clearEditor() {
    if (hasEditorContent()) {
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

    if (editor) {
        const placeholderText = "; Enter your FXCore assembly code here, load a file, or select an example";
        editor.setValue(placeholderText);
        editor.updateOptions({ readOnly: true });
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

    const filename = await showInputDialog(
        'Save Source Code',
        'Enter filename:',
        'Enter filename (e.g., my_program.fxc)',
        'fxcore_source.fxc'
    );

    if (!filename) return false; // User cancelled

    const sourceCode = editor.getValue();
    const blob = new Blob([sourceCode], {
        type: 'text/plain'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return true; // Save completed successfully
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