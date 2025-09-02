// User prompt functions, these are things that are on the main page like buttons
let outputDirectoryHandle = null;
let preferredStartDirectory = 'downloads';
let projectDirectoryHandle = null;
let modalResolve = null;
let selectedProgram = 'ram'; // Default to RAM
let selectedHW = 'hid'; // Changed to start in HID mode by default

async function selectProjectDirectory() {
    try {
        if ('showDirectoryPicker' in window) {
            // Show directory picker and get the handle
            projectDirectoryHandle = await window.showDirectoryPicker();

            document.getElementById('projectFolderLabel').textContent = `Selected: ${projectDirectoryHandle.name}`;
            const projectFolderLabel = document.getElementById('projectFolderLabel');
            projectFolderLabel.style.color = '#28a745'; // Green color for connected
            
            // Update the label with the folder name
            // updateProjectFolderButton(projectDirectoryHandle);
            
            debugLog('Project directory selected successfully', 'success');
            
        } else {
            debugLog('Directory selection not supported in this browser', 'errors');
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            debugLog('Error selecting project directory: ' + err.message, 'errors');
        }
    }
}

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

// async function loadFile() {
//     // Check for unsaved changes FIRST, before opening file picker
//     if (window.hasUnsavedChanges && window.hasUnsavedChanges()) {
//         const choice = await showThreeChoiceDialog(
//             'Unsaved Changes',
//             'You have unsaved changes in the editor. What would you like to do before loading a new file?'
//         );

//         if (choice === 'cancel') {
//             return; // User cancelled - don't open file picker
//         } else if (choice === 'save') {
//             const saveResult = await saveSource();
//             if (saveResult === false) {
//                 return; // User cancelled the save dialog - don't open file picker
//             }
//         }
//         // If choice === 'discard', proceed with opening file picker
//     }

//     // NOW open the file picker after handling unsaved changes
//     const fileInput = document.getElementById('fileInput');
//     if (fileInput) {
//         fileInput.value = ''; // Clear any previous selection
//         fileInput.click(); // Open the file picker
//     }
// }

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
    
    const fileInput = document.getElementById('fileInput');

    const options = {
        types: [{
            description: 'Assembly files',
            accept: {
                    'text/plain': ['.txt', '.fxc', '.fxo']
            }
        }]
    };
    
    // Use project directory if available, otherwise use default preference
    if (projectDirectoryHandle) {
        options.startIn = projectDirectoryHandle;
        debugLog(`Using project directory: ${projectDirectoryHandle.name}`, 'verbose');
    } else {
        options.startIn = preferredStartDirectory;
        debugLog(`Using default start directory: ${preferredStartDirectory}`, 'verbose');
    }
    
    // Try File System Access API first if project directory is available
    try {
        const [fileHandle] = await window.showOpenFilePicker(options);
        const file = await fileHandle.getFile();
        const fileContent = await file.text();
        
        // Process the file content directly (don't simulate file input)
        processFileContent(fileContent, file.name);
        
        debugLog('File loaded via File System Access API: ' + file.name, 'success');
        return;
    } catch (error) {
        if (error.name === 'AbortError') {
            return; // User cancelled
        }
        console.warn('File System Access failed, falling back to input:', error);
    }
    
    // Fallback to traditional file input
    fileInput.value = ''; // Clear any previous selection
    fileInput.click(); // This will trigger handleFileInputChange when user selects a file
}

// Extract the file processing logic into a separate function
function processFileContent(content, fileName) {
    // Update editor content
    if (editor && window.setEditorContent) {
        window.setEditorContent(content, fileName, 'Browser Upload');
    } else {
        editor.updateOptions({ readOnly: false });
        editor.setValue(content);
    }
    
    // Scroll to the top of the editor
    editor.setScrollTop(0);
    editor.setScrollLeft(0);
    
    // Clear assembly output and disable download button
    const outputElement = document.getElementById('output');
    if (outputElement) {
        outputElement.value = '';
    }
    document.getElementById('messages').innerHTML = '';
    assembledData = null;
    
    // Update all button states
    if (typeof updateBuildResultsButtons !== 'undefined') {
        updateBuildResultsButtons();
    }
    if (typeof updatePlainHexButton !== 'undefined') {
        updatePlainHexButton();
    }
    if (typeof updateDownloadButtonStates !== 'undefined') {
        updateDownloadButtonStates();
    }
    
    // // Clear C header data
    // if (typeof FXCoreAssembler !== 'undefined') {
    //     FXCoreAssembler.assembledCHeader = null;
    // }
    window.assembledCHeader = null;
}

// Update handleFileInputChange to use the shared processing function
async function handleFileInputChange() {
    const fileInput = document.getElementById('fileInput');
    const file = fileInput.files[0];
    
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        processFileContent(e.target.result, file.name);
        debugLog('File loaded via traditional input: ' + file.name, 'success');
    };
    reader.readAsText(file);
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
        assembledData = null;
        
        // Clear C header data
        if (typeof FXCoreAssembler !== 'undefined') {
            FXCoreAssembler.assembledCHeader = null;
        }
        window.assembledCHeader = null;
        
        updateBuildResultsButtons(); // Update buttons after clearing assembly
        updatePlainHexButton(); // Update the plain HEX download button
        
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

                // Generate C header from the Intel HEX data
                const cHeaderData = generateCHeaderFromHex(FXCoreAssembler.assembledHex);
                if (cHeaderData) {
                    FXCoreAssembler.assembledCHeader = cHeaderData;
                    window.assembledCHeader = cHeaderData; // Also store globally
                    debugLog('C header generated successfully', 'success');
                } else {
                    debugLog('Failed to generate C header', 'errors');
                }

                debugLog('Assembly completed successfully', 'success');
            } else {
                // Clear any prior output if needed
                document.getElementById('output').value = '';
                assembledData = null;
                
                // Clear C header data on failed assembly
                if (typeof FXCoreAssembler !== 'undefined') {
                    FXCoreAssembler.assembledCHeader = null;
                }
                window.assembledCHeader = null;
                
                debugLog('Assembly failed', 'errors');
            }
        } else {
            debugLog('FXCoreAssembler class not available', 'errors');
        }

        // Update buttons after assembly
        updateBuildResultsButtons();
        updatePlainHexButton(); // Update the plain HEX download button

    } catch (error) {
        debugLog('Assembly error: ' + error.message, 'errors');
        debugLog('FXCoreAssembler class not found', 'errors');

        // Clear data on error
        assembledData = null;
        if (typeof FXCoreAssembler !== 'undefined') {
            FXCoreAssembler.assembledCHeader = null;
        }
        window.assembledCHeader = null;

        // Show output section even on error
        const outputContent = document.getElementById('outputContent');
        const outputToggle = document.getElementById('outputToggle');
        if (outputContent) {
            outputContent.classList.remove('collapsed');
        }
        if (outputToggle) {
            outputToggle.textContent = '▼';
        }

        // Update buttons after error
        updateBuildResultsButtons();
        updatePlainHexButton();

        console.error('Assembly error:', error);
    }
}

async function clearAssembly() {
    document.getElementById('output').value = '';
    document.getElementById('messages').innerHTML = '';
    assembledData = null;
    
    // Clear C header data
    if (typeof FXCoreAssembler !== 'undefined') {
        FXCoreAssembler.assembledCHeader = null;
    }
    window.assembledCHeader = null;

    // Update buttons after clearing
    updateBuildResultsButtons();
    updatePlainHexButton(); // Update the plain HEX download button
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
    assembledData = null;

    // Clear C header data
    if (typeof FXCoreAssembler !== 'undefined') {
        FXCoreAssembler.assembledCHeader = null;
    }
    window.assembledCHeader = null;

    // Update buttons after clearing
    updateBuildResultsButtons();
    updatePlainHexButton(); // Update the plain HEX download button
}

// async function saveSourceFX() {
//     if (!editor) return false;

//     if (!hasEditorContent()) {
//         await showConfirmDialog('Save Source', 'There is no content to save.');
//         return false;
//     }

//     // Get current filename and determine default
//     let defaultFilename = 'fxcore_source.fxc'; // fallback default
    
//     if (window.getCurrentFilename) {
//         const currentName = window.getCurrentFilename();
//         if (currentName) {
//             // Use the current filename if we have one
//             defaultFilename = currentName;
//         }
//     }

//     const sourceCode = editor.getValue();
    
//     // Try to use File System Access API first
//     if ('showSaveFilePicker' in window) {
//         try {
//             const fileHandle = await window.showSaveFilePicker({
//                 suggestedName: defaultFilename,
//                 types: [{
//                     description: 'FXCore Assembly files',
//                     accept: {
//                         'text/plain': ['.fxc', '.asm', '.txt']
//                     }
//                 }]
//             });
            
//             const writable = await fileHandle.createWritable();
//             await writable.write(sourceCode);
//             await writable.close();
            
//             // Update the current filename to the saved name
//             if (window.setCurrentFile) {
//                 window.setCurrentFile(fileHandle.name, '');
//             }
            
//             // Mark content as saved
//             if (window.updateOriginalContent) {
//                 window.updateOriginalContent();
//             }
            
//             debugLog('File saved: ' + fileHandle.name, 'success');
//             return true;
            
//         } catch (err) {
//             if (err.name === 'AbortError') {
//                 return false; // User cancelled
//             } else {
//                 debugLog('Error saving with file picker: ' + err.message, 'errors');
//                 // Fall back to blob download
//             }
//         }
//     }
    
//     // Fallback for browsers that don't support File System Access API
//     // Show a message about the limitation
//     const browserSupported = await showConfirmDialog(
//         'Save File', 
//         'Your browser doesn\'t support the advanced file picker. The file will be downloaded to your default downloads folder. Continue?'
//     );
    
//     if (!browserSupported) return false;
    
//     // Fallback to blob download
//     const blob = new Blob([sourceCode], {
//         type: 'text/plain'
//     });
//     const url = URL.createObjectURL(blob);
//     const a = document.createElement('a');
//     a.href = url;
//     a.download = defaultFilename;
//     document.body.appendChild(a);
//     a.click();
//     document.body.removeChild(a);
//     URL.revokeObjectURL(url);

//     // Update the current filename
//     if (window.setCurrentFile) {
//         window.setCurrentFile(defaultFilename, '');
//     }

//     // Mark content as saved - this resets the unsaved changes flag
//     if (window.updateOriginalContent) {
//         window.updateOriginalContent();
//     }

//     debugLog('File downloaded: ' + defaultFilename, 'success');
//     return true; // Save completed successfully
// }

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
    const result = await downloadWithPicker(
        sourceCode, 
        defaultFilename, 
        'text/plain', 
        'FXCore Assembly files'
    );
    
    // Handle the new return format
    if (result && result.success) {
        // Update the current filename to the actual saved name
        if (window.setCurrentFile) {
            window.setCurrentFile(result.filename, '');
        }
        
        // Mark content as saved
        if (window.updateOriginalContent) {
            window.updateOriginalContent();
        }
        
        return true;
    }
    
    return false; // Save was cancelled or failed
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

        if (FXCoreTargets.device && FXCoreTargets.device.opened) {
        try {
            // Don't use await here - beforeunload must be synchronous
            FXCoreTargets.device.close(); // Call without await
            FXCoreTargets.device = null;
            console.log('Device cleanup initiated before page unload');
        } catch (error) {
            console.error('Error closing device before unload:', error);
        }
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
// function updateProgramTargetDisplay() {
//     const display = document.getElementById('programTargetDisplay');
//     if (selectedProgram === 'ram') {
//         display.textContent = 'Run from RAM';
//     } else {
//         display.textContent = `Program ${selectedProgram}`;
//     }
    
//     // Update build results buttons when program target changes
//     updateBuildResultsButtons();
// }

// Function to update download button text based on current settings
function updateDownloadButtonText() {
    const downloadBtn = document.getElementById('downloadHexBtn');
    if (downloadBtn) {
        if (outputDirectoryHandle) {
            downloadBtn.textContent = 'Download to Programmer';
        } else {
            downloadBtn.textContent = 'Download HEX';
        }
    }
}

// Function to set program target directly
function setProgramTarget(targetValue) {
    const targets = ['ram', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'];
    
    // Validate the target value
    if (targets.includes(targetValue)) {
        selectedProgram = targetValue;
        
        // Update both dropdown selections to keep them synchronized
        syncProgramTargetDropdowns();
        
        // updateProgramTargetDisplay();
        syncProgramTargetDisplays(); // Use the existing sync function for displays
        updateDownloadButtonText();
        updateBuildResultsButtons(); // Update button text immediately when target changes
        updateHardwareConnectionStatus(); // Update detailed status
        console.log('Selected program:', selectedProgram);
    } else {
        console.error('Invalid program target:', targetValue);
    }
}

// Keep the original cycling function if needed elsewhere - testing
function cycleProgramTarget() {
    const targets = ['ram', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'];
    const currentIndex = targets.indexOf(selectedProgram);
    const nextIndex = (currentIndex + 1) % targets.length;
    selectedProgram = targets[nextIndex];
    
    // Update both dropdown selections to keep them synchronized
    syncProgramTargetDropdowns();
    
    // updateProgramTargetDisplay();
    syncProgramTargetDisplays(); // Use the existing sync function for displays
    updateDownloadButtonText();
    updateBuildResultsButtons(); // Update button text immediately when target changes
    updateHardwareConnectionStatus(); // Update detailed status
    console.log('Selected program:', selectedProgram);
}
// Track run from RAM state
let isRunningFromRAM = false;

// New function to update build results buttons based on mode and state
function updateBuildResultsButtons() {
    const downloadHexBtn = document.getElementById('downloadHexBtn');
    const clearResultsBtn = document.getElementById('clearResultsBtn');
    const connectBtn = document.getElementById('connectBtn');
    const exitRamBtn = document.getElementById('exitRamBtn');
    
    const hasAssembledData = assembledData && assembledData.trim() !== '';
    const isConnected = FXCoreTargets.device && FXCoreTargets.device.opened;
    const isDirectorySelected = outputDirectoryHandle !== null;
    
    if (selectedHW === 'hid') {
        // HID Mode buttons
        if (downloadHexBtn) {
            if (selectedProgram === 'ram') {
                downloadHexBtn.textContent = 'Run from RAM';
                // Grayed out if disconnected, no assembly, or running from RAM
                downloadHexBtn.disabled = !isConnected || !hasAssembledData || isRunningFromRAM;
                downloadHexBtn.style.opacity = downloadHexBtn.disabled ? '0.6' : '1';
            } else {
                downloadHexBtn.textContent = `Flash Slot ${selectedProgram}`;
                // Grayed out if disconnected or no assembly
                downloadHexBtn.disabled = !isConnected || !hasAssembledData;
                downloadHexBtn.style.opacity = downloadHexBtn.disabled ? '0.6' : '1';
            }
        }
        
        // Exit RAM button - present in RAM target, grayed out if not running from RAM
        if (exitRamBtn) {
            if (selectedProgram === 'ram') {
                exitRamBtn.style.display = 'inline-block';
                exitRamBtn.disabled = !isRunningFromRAM;
                exitRamBtn.style.opacity = isRunningFromRAM ? '1' : '0.6';
            } else {
                exitRamBtn.style.display = 'none';
            }
        }
        
        // Connect/Disconnect button - present in HID mode, alternates between states
        if (connectBtn) {
            connectBtn.style.display = 'inline-block';
            connectBtn.textContent = isConnected ? 'Disconnect' : 'Connect';
            connectBtn.disabled = false;
        }
        
    } else {
        // File Mode buttons
        if (downloadHexBtn) {
            if (selectedProgram === 'ram') {
                downloadHexBtn.textContent = 'Run from RAM';
                // Grayed out if no directory selected, no assembled data, or running from RAM
                downloadHexBtn.disabled = !isDirectorySelected || !hasAssembledData || isRunningFromRAM;
                downloadHexBtn.style.opacity = downloadHexBtn.disabled ? '0.6' : '1';
            } else {
                downloadHexBtn.textContent = `Flash Slot ${selectedProgram}`;
                // Grayed out if no directory selected or no assembled data
                downloadHexBtn.disabled = !isDirectorySelected || !hasAssembledData;
                downloadHexBtn.style.opacity = downloadHexBtn.disabled ? '0.6' : '1';
            }
        }
        
        // Exit RAM button becomes Clear Hardware button for program slots in file mode
        if (exitRamBtn) {
            if (selectedProgram === 'ram') {
                exitRamBtn.style.display = 'inline-block';
                exitRamBtn.textContent = 'Exit Run from RAM';
                exitRamBtn.disabled = !isRunningFromRAM;
                exitRamBtn.style.opacity = isRunningFromRAM ? '1' : '0.6';
            } else {
                exitRamBtn.style.display = 'inline-block';
                exitRamBtn.textContent = 'Clear Hardware';
                exitRamBtn.disabled = !isDirectorySelected;
                exitRamBtn.style.opacity = isDirectorySelected ? '1' : '0.6';
            }
        }
        
        // Hide connect button in file mode
        if (connectBtn) {
            connectBtn.style.display = 'none';
        }
    }
    
    // Clear Results button - present in both modes
    if (clearResultsBtn) {
        clearResultsBtn.disabled = false;
        clearResultsBtn.style.opacity = '1';
    }
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
            updateClearHardwareButton();
            updateBuildResultsButtons(); // Update buttons after directory selection
            updateHardwareConnectionStatus();
            
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
    updateClearHardwareButton();
    updateBuildResultsButtons(); // Update buttons after directory cleared
    updateHardwareConnectionStatus();
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
    
    // In HID mode, handle differently
    if (selectedHW === 'hid') {
        const isConnected = FXCoreTargets.device && FXCoreTargets.device.opened;
        if (!isConnected) {
            debugLog('No HID device connected', 'errors');
            return;
        }
        
        // Call appropriate HID function based on program target
        if (selectedProgram === 'ram') {
            // Call run from RAM function and update state
            if (typeof run_from_ram !== 'undefined') {
                await run_from_ram(0);
                isRunningFromRAM = true; // Set state
                updateBuildResultsButtons(); // Update button states
            } else {
                debugLog('Run from RAM function not available', 'errors');
            }
        } else {
            // Call program slot function
            if (typeof run_from_ram !== 'undefined') {
                await run_from_ram(1);
            } else {
                debugLog('Program slot function not available', 'errors');
            }
        }
        return;
    }
    
    // File mode logic
    const isDirectorySelected = outputDirectoryHandle !== null;
    
    if (isDirectorySelected) {
        if (selectedProgram === 'ram') {
            // Save to directory as hex file for RAM target
            let filename = 'output.hex';
            
            try {
                const fileHandle = await outputDirectoryHandle.getFileHandle(filename, {
                    create: true
                });
                const writable = await fileHandle.createWritable();
                await writable.write(hex);
                await writable.close();
                document.getElementById('messages').innerHTML = '';
                
                // Set running from RAM state in file mode
                isRunningFromRAM = true;
                updateBuildResultsButtons(); // Update button states
                
                debugLog(`File saved as ${filename} in selected directory`, 'success');
                return;
            } catch (err) {
                debugLog('Error saving to directory: ' + err.message, 'errors');
            }
        } else {
            // Save to directory as program slot file (0-F.hex)
            const programNum = parseInt(selectedProgram);
            const hexValue = (programNum).toString(16).toUpperCase(); // Convert 1-16 to 0-F
            const filename = `${hexValue}.hex`;
            
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
            }
        }
    }
    
    // No directory selected - fallback to file download
    let filename;
    
    // Determine filename based on settings
    if (selectedProgram === 'ram') {
        filename = 'output.hex';
    } else {
        // Convert program number (1-16) to hex filename (0-F.hex)
        const programNum = parseInt(selectedProgram);
        const hexValue = (programNum - 1).toString(16).toUpperCase(); // Convert 1-16 to 0-F
        filename = `${hexValue}.hex`;
    }
    
    // Fallback to regular browser download
    downloadFile(filename, hex, 'text/plain');
    debugLog(`File downloaded as ${filename} to default downloads folder`, 'success');
}

// // Download plain HEX file (always available when assembly data exists)
// async function downloadPlainHex() {
//     const hex = document.getElementById('output').value;
    
//     // Check if hex content exists
//     if (!hex || hex.trim() === '') {
//         debugLog('No hex data to download', 'errors');
//         return;
//     }

//     if (!hasEditorContent()) {
//         await showConfirmDialog('Download HEX', 'There is no content to download.');
//         return false;
//     }
    
//     debugLog('Download started', 'success');
    
//     let defaultFilename;
    
//     // Determine filename based on settings
//     if (selectedProgram === 'ram') {
//         defaultFilename = 'output.hex';
//     } else {
//         // Convert program number (1-16) to hex filename (0-F.hex)
//         const programNum = parseInt(selectedProgram);
//         const hexValue = (programNum - 1).toString(16).toUpperCase();
//         defaultFilename = `${hexValue}.hex`;
//     }
    
//     // Try to use File System Access API first
//     if ('showSaveFilePicker' in window) {
//         try {
//             const fileHandle = await window.showSaveFilePicker({
//                 suggestedName: defaultFilename,
//                 types: [{
//                     description: 'Intel HEX files',
//                     accept: {
//                         'application/octet-stream': ['.hex']
//                     }
//                 }]
//             });
            
//             const writable = await fileHandle.createWritable();
//             await writable.write(hex);
//             await writable.close();
            
//             debugLog('HEX file saved: ' + fileHandle.name, 'success');
//             return true;
            
//         } catch (err) {
//             if (err.name === 'AbortError') {
//                 return false; // User cancelled
//             } else {
//                 debugLog('Error saving with file picker: ' + err.message, 'errors');
//                 // Fall back to blob download
//             }
//         }
//     }
    
//     // Fallback for browsers that don't support File System Access API
//     const browserSupported = await showConfirmDialog(
//         'Download HEX File', 
//         'Your browser doesn\'t support the advanced file picker. The file will be downloaded to your default downloads folder. Continue?'
//     );
    
//     if (!browserSupported) return false;
    
//     // Always download as file (no hardware interaction)
//     downloadFile(defaultFilename, hex, 'application/octet-stream');
//     debugLog(`File downloaded as ${defaultFilename} to default downloads folder`, 'success');
//     return true;
// }

async function downloadPlainHex() {
    const hex = document.getElementById('output').value;
    
    // Check if hex content exists
    if (!hex || hex.trim() === '') {
        debugLog('No hex data to download', 'errors');
        return false;
    }
    
    if (!hasEditorContent()) {
        await showConfirmDialog('Download HEX', 'There is no content to download.');
        return false;
    }
    
    debugLog('Download started', 'success');
    
    let defaultFilename;
    
    // Determine filename based on settings
    if (selectedProgram === 'ram') {
        defaultFilename = 'output.hex';
    } else {
        // Convert program number (1-16) to hex filename (0-F.hex)
        const programNum = parseInt(selectedProgram);
        const hexValue = (programNum - 1).toString(16).toUpperCase();
        defaultFilename = `${hexValue}.hex`;
    }

    if (window.getCurrentFilename) {
        const currentName = window.getCurrentFilename();
        if (currentName) {
            // Replace extension with .hex
            defaultFilename = currentName.replace(/\.[^/.]+$/, '') + '.hex';
        }
    }
    
    const result = await downloadWithPicker(
        hex, 
        defaultFilename, 
        'application/octet-stream', 
        'Intel HEX files'
    );
    
    // Handle the new return format
    if (result && result.success) {
        debugLog('HEX file saved: ' + result.filename, 'success');
        return true;
    }
    
    return false; // Save was cancelled or failed
}

// Update plain HEX download button state
function updatePlainHexButton() {
    const downloadPlainHexBtn = document.getElementById('downloadPlainHexBtn');
    const downloadCHeaderBtn = document.getElementById('downloadCHeaderBtn');
    
    const hasAssembledData = assembledData && assembledData.trim() !== '';
    
    if (downloadPlainHexBtn) {
        downloadPlainHexBtn.disabled = !hasAssembledData;
        downloadPlainHexBtn.style.opacity = hasAssembledData ? '1' : '0.6';
    }
    
    if (downloadCHeaderBtn) {
        downloadCHeaderBtn.disabled = !hasAssembledData;
        downloadCHeaderBtn.style.opacity = hasAssembledData ? '1' : '0.6';
    }
}

// Download C header file
// async function downloadCHeader() {
//    // Check if we have assembled C header data
//    const headerData = window.assembledCHeader || (typeof FXCoreAssembler !== 'undefined' ? FXCoreAssembler.assembledCHeader : null);
   
//    if (!headerData) {
//        debugLog(`No C header data available - please assemble first`, `errors`);
//        return false;
//    }

//    // Try to use File System Access API first
//    if ('showSaveFilePicker' in window) {
//        try {
//            const fileHandle = await window.showSaveFilePicker({
//                suggestedName: 'fxcore_program.h',
//                types: [{
//                    description: 'C Header files',
//                    accept: {
//                        'text/plain': ['.h']
//                    }
//                }]
//            });
           
//            // Get the base name and replace the placeholder
//            const baseName = fileHandle.name.replace(/\.[^/.]+$/, ""); // Remove extension
//            const finalHeader = headerData.replace(/program_name/g, baseName);
           
//            const writable = await fileHandle.createWritable();
//            await writable.write(finalHeader);
//            await writable.close();
           
//            debugLog('C header file saved: ' + fileHandle.name, 'success');
//            return true;
           
//        } catch (err) {
//            if (err.name === 'AbortError') {
//                return false; // User cancelled
//            } else {
//                debugLog('Error saving with file picker: ' + err.message, 'errors');
//                // Fall back to input dialog
//            }
//        }
//    }

//    // Fallback: use input dialog for filename
//    const filename = await showInputDialog(
//        'Save C Header File',
//        'Enter filename:',
//        'Enter filename (e.g., my_program.h)',
//        'fxcore_program.h'
//    );

//    if (!filename) return false; // User cancelled

//    try {
//        // Get the base name and replace the placeholder
//        const baseName = filename.replace(/\.[^/.]+$/, ""); // Remove extension
//        const finalHeader = headerData.replace(/program_name/g, baseName);

//        // Fallback to blob download
//        const blob = new Blob([finalHeader], { type: 'text/plain' });
//        const url = URL.createObjectURL(blob);
//        const a = document.createElement('a');
//        a.href = url;
//        a.download = filename;
//        document.body.appendChild(a);
//        a.click();
//        document.body.removeChild(a);
//        URL.revokeObjectURL(url);

//        debugLog(`C header file ${filename} downloaded successfully`, 'success');
//        return true;
//    } catch (error) {
//        debugLog(`Error downloading C header: ${error.message}`, 'errors');
//        return false;
//    }
// }

async function downloadCHeader() {
    // Check if we have assembled C header data
    const headerData = window.assembledCHeader || (typeof FXCoreAssembler !== 'undefined' ? FXCoreAssembler.assembledCHeader : null);
    
    if (!headerData) {
        debugLog(`No C header data available - please assemble first`, `errors`);
        return false;
    }
 
    let defaultFilename;
    
    // Determine filename based on settings
    if (selectedProgram === 'ram') {
        defaultFilename = 'output.h';
    } else {
        // Convert program number (1-16) to hex filename (0-F.hex)
        const programNum = parseInt(selectedProgram);
        const hexValue = (programNum - 1).toString(16).toUpperCase();
        defaultFilename = `${hexValue}.h`;
    }

    if (window.getCurrentFilename) {
        const currentName = window.getCurrentFilename();
        if (currentName) {
            // Replace extension with .h
            defaultFilename = currentName.replace(/\.[^/.]+$/, '') + '.h';
        }
    }

    const result = await downloadWithPicker(
        '', // We'll set content after filename processing
        defaultFilename, 
        'text/plain', 
        'C Header files'
    );
    
    // Handle the new return format
    if (result && result.success) {
        // Get the base name and replace the placeholder
        const baseName = result.filename.replace(/\.[^/.]+$/, ""); // Remove extension
        const finalHeader = headerData.replace(/program_name/g, baseName);
        
        // If we used the File System Access API, we need to write the processed content
        if (result.fileHandle && !result.fallback) {
            try {
                const writable = await result.fileHandle.createWritable();
                await writable.write(finalHeader);
                await writable.close();
                debugLog('C header file saved: ' + result.filename, 'success');
            } catch (err) {
                debugLog('Error writing processed header: ' + err.message, 'errors');
                return false;
            }
        } else if (result.fallback) {
            // For fallback blob download, we need to trigger a new download with processed content
            const blob = new Blob([finalHeader], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = result.filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            debugLog(`C header file ${result.filename} downloaded successfully`, 'success');
        }
        
        return true;
    }
    
    return false; // Save was cancelled or failed
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

// HID mode functions
async function toggleConnection() {
    const isConnected = FXCoreTargets.device && FXCoreTargets.device.opened;
    
    if (isConnected) {
        // Disconnect - call the function from FXCoreFunctions.js
        if (typeof disconnectDevice === 'function') {
            await disconnectDevice();
        }
        isRunningFromRAM = false;
    } else {
        // Connect - call the function from FXCoreFunctions.js  
        if (typeof connectDevice === 'function') {
            await connectDevice();
        }
    }
    
    updateBuildResultsButtons();
    updateHardwareConnectionStatus();
}

// Exit run from RAM function
async function exitRunFromRam() {
    if (selectedHW === 'hid') {
        const isConnected = FXCoreTargets.device && FXCoreTargets.device.opened;
        if (!isConnected) {
            debugLog('No HID device connected', 'errors');
            return;
        }
        
        if (typeof exit_rfr !== 'undefined') {
            exit_rfr();
            isRunningFromRAM = false; // Reset state
            updateBuildResultsButtons(); // Update button states
        } else {
            debugLog('Exit run from RAM function not available', 'errors');
        }
    } else {
        // File mode behavior depends on program target
        if (selectedProgram === 'ram') {
            // For RAM target, this acts as Exit Run from RAM
            isRunningFromRAM = false; // Reset state
            await clearHardware(); // also clear hardwar
            updateBuildResultsButtons(); // Update button states
            debugLog('Exited run from RAM mode', 'success');
        } else {
            // For program slots, this acts as Clear Hardware
            await clearHardware();
        }
    }
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

// async function handleFileInputChange() {
//     const fileInput = document.getElementById('fileInput');
//     const file = fileInput.files[0];
    
//     if (!file) return;
    
//     const reader = new FileReader();
//     reader.onload = function(e) {
//         if (editor && window.setEditorContent) {
//             window.setEditorContent(e.target.result, file.name, 'Browser Upload');
//             // Scroll to the top of the editor
//             editor.setScrollTop(0);
//             editor.setScrollLeft(0);
//         }
        
//         // Clear assembly output and disable download button
//         const outputElement = document.getElementById('output');
//         if (outputElement) {
//             outputElement.value = '';
//         }
//         document.getElementById('messages').innerHTML = '';
//         assembledData = null;
        
//         // Clear C header data
//         if (typeof FXCoreAssembler !== 'undefined') {
//             FXCoreAssembler.assembledCHeader = null;
//         }
//         window.assembledCHeader = null;
        
//         updateBuildResultsButtons(); // Update buttons after clearing assembly
//         updatePlainHexButton(); // Update the plain HEX download button
//     };
//     reader.readAsText(file);
//     debugLog('File loaded: ' + file.name, 'success');
// }

// switch between hardware modes
function cycleHWMode() {
    if (selectedHW === 'file') {
        selectedHW = 'hid';
        document.getElementById('HWModeDisplay').textContent = 'HID mode';
        document.getElementById('FileModeDiv').style.display = 'none';
        document.getElementById('HidModeDiv').style.display = 'block';
    } else {
        selectedHW = 'file';
        document.getElementById('HWModeDisplay').textContent = 'File mode';
        document.getElementById('FileModeDiv').style.display = 'block';
        document.getElementById('HidModeDiv').style.display = 'none';
    }
    
    // Reset running state when switching modes
    isRunningFromRAM = false;
    
    updateHardwareConnectionStatus();
    updateBuildResultsButtons(); // Update buttons when mode changes
}

// update hardware connection on main page
function updateHardwareConnectionStatus() {
    const statusElement = document.getElementById('hardwareConnectionStatus');
    if (!statusElement) return;

    let statusText = 'No connection';
    let statusColor = '#666';

    // Check file mode connection (output directory)
    if (selectedHW === 'file') {
        if (outputDirectoryHandle) {
            const serialConnected = document.getElementById('serialPortDisplay').textContent.includes('Connected');
            const targetText = selectedProgram === 'ram' ? 'Run from RAM' : `Program Slot ${selectedProgram}`;
            statusText = `File: ${outputDirectoryHandle.name}${serialConnected ? ', Serial connected' : ''}; Target: ${targetText}`;
            statusColor = '#28a745'; // Green
        } else {
            const targetText = selectedProgram === 'ram' ? 'Run from RAM' : `Program Slot ${selectedProgram}`;
            statusText = `File: No directory; Target: ${targetText}`;
        }
    }
    // Check HID mode connection
    else if (selectedHW === 'hid') {
        const isConnected = FXCoreTargets.device && FXCoreTargets.device.opened;
        const fxcoreAddr = document.getElementById('FXcoreAddr').value || '0x30';
        const targetText = selectedProgram === 'ram' ? 'Run from RAM' : `Program Slot ${selectedProgram}`;
        
        if (isConnected) {
            statusText = `HID: Connected, Addr: ${fxcoreAddr}; Target: ${targetText}`;
            statusColor = '#28a745'; // Green
        } else {
            statusText = `HID: Disconnected, Addr: ${fxcoreAddr}; Target: ${targetText}`;
        }
    }

    statusElement.textContent = statusText;
    statusElement.style.color = statusColor;
}

// Modified downloadWithPicker function - returns filename when possible
async function downloadWithPicker(content, defaultFilename, mimeType, description) {
    // Try to use File System Access API first
    if ('showSaveFilePicker' in window) {
        try {
            const options = {
                suggestedName: defaultFilename,
                types: [{
                    description: description,
                    accept: {
                        [mimeType]: [defaultFilename.substring(defaultFilename.lastIndexOf('.'))]
                    }
                }]
            };
            
            // Use project directory if available, otherwise use default preference
            if (projectDirectoryHandle) {
                options.startIn = projectDirectoryHandle;
                debugLog(`Using project directory: ${projectDirectoryHandle.name}`, 'verbose');
            } else {
                options.startIn = preferredStartDirectory;
                debugLog(`Using default start directory: ${preferredStartDirectory}`, 'verbose');
            }
            
            const fileHandle = await window.showSaveFilePicker(options);
            
            const writable = await fileHandle.createWritable();
            if (content instanceof Uint8Array) {
                await writable.write(content);
            } else {
                await writable.write(content);
            }
            await writable.close();
            
            debugLog(`File saved: ${fileHandle.name}`, 'success');
            
            // Return an object with success status and filename
            return {
                success: true,
                filename: fileHandle.name,
                fileHandle: fileHandle
            };
            
        } catch (err) {
            if (err.name === 'AbortError') {
                return { success: false, cancelled: true }; // User cancelled
            } else {
                debugLog('Error saving with file picker: ' + err.message, 'errors');
                // Fall back to blob download
            }
        }
    }
    
    // Fallback for browsers that don't support File System Access API
    const browserSupported = await showConfirmDialog(
        'Download File', 
        'Your browser doesn\'t support the advanced file picker. The file will be downloaded to your default downloads folder. Continue?'
    );
    
    if (!browserSupported) return { success: false, cancelled: true };
    
    // Create blob and download
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = defaultFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    debugLog(`File downloaded as ${defaultFilename} to default downloads folder`, 'success');
    
    // Return success with the default filename (since we can't know what the browser actually saved it as)
    return {
        success: true,
        filename: defaultFilename,
        fallback: true
    };
}

// If user selects a repo file load it into the editor. Obviouly I heavily borrowed from the example loader
async function loadRepoFile(repo_file) {
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
    }
    if (repo_file === "") return;
    getPageText(repo_file).then(repo_code => {
        const exampleFilename = repo_file.substring(repo_file.lastIndexOf('/')+1);
        if (window.setEditorContent) {
            // Mark as example
            window.setEditorContent(repo_code, exampleFilename, '');
        } else {
            editor.updateOptions({ readOnly: false }); // Fallback
            editor.setValue(repo_code);
        }
        editor.setScrollTop(0);
        editor.setScrollLeft(0);
        
        // Clear assembly output and disable download button
        const outputElement = document.getElementById('output');
        if (outputElement) {
            outputElement.value = '';
        }
        document.getElementById('messages').innerHTML = '';
        assembledData = null;
        
        // Clear C header data
        if (typeof FXCoreAssembler !== 'undefined') {
            FXCoreAssembler.assembledCHeader = null;
        }
        window.assembledCHeader = null;
        
        updateBuildResultsButtons(); // Update buttons after clearing assembly
        updatePlainHexButton(); // Update the plain HEX download button
        
        debugLog('Repo file loaded: ' + exampleFilename, 'success');
    }).catch(error => {
        console.error(error);
    });
}