// User prompt functions, these are things that are on the main page like buttons

let modalResolve = null;

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
    return editor && editor.getValue().trim().length > 0;
}

// Prompt to save before leaving page
window.addEventListener('beforeunload', function(e) {
    if (hasEditorContent()) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
    }
});

// Modified load file function with three-choice prompt
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
                editor.setValue(e.target.result);
                // Scroll to the top of the editor
                editor.setScrollTop(0);
                editor.setScrollLeft(0);

            }
        };
        reader.readAsText(file);
        debugLog('File loaded', 'success');
    }
}

// Modified example loader with three-choice prompt
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
        editor.setValue(examples[exampleName]);
        editor.setScrollTop(0);
        editor.setScrollLeft(0);
        document.getElementById('output').value = '';
        document.getElementById('messages').innerHTML = '';
        document.getElementById('downloadHexBtn').disabled = true;
        // document.getElementById('downloadBinBtn').disabled = true;
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
    if (!sourceCode.trim()) {
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
        outputContent.classList.remove('collapsed');
        outputToggle.textContent = '▼';

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

// New function to clear editor content with three-choice prompt
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
        editor.setValue('');
    }
}

// Enhanced save source with filename prompt
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

let outputDirectoryHandle = null;
const selectedFilename = 'output.hex'; // Hard-set filename

async function selectOutputDirectory() {
    try {
        if ('showDirectoryPicker' in window) {
            outputDirectoryHandle = await window.showDirectoryPicker();
            document.getElementById('outputDirDisplay').textContent = `Selected: ${outputDirectoryHandle.name}`;
            document.getElementById('messages').innerHTML = '';
            debugLog('Output directory selected successfully', 'success');
        } else {
            debugLog('Directory selection not supported in this browser', 'errors');
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            debugLog('Error selecting directory: ' + err.message, 'errors');
        }
    }
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
        showMessage('No hex data to download', 'errors');
        return;
    }
    
    const filename = selectedFilename; // Always 'output.hex'
    
    // Try to save to selected directory, fallback to regular download
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
        } catch (err) {
            debugLog('Error saving to directory: ' + err.message, 'errors');
            // Fallback to regular download
            downloadFile(filename, hex, 'text/plain');
        }
    } else {
        // Regular download fallback
        downloadFile(filename, hex, 'text/plain');
    }
}

// Function to set the selected filename (you'll need to call this somewhere)
function setSelectedFilename(filename) {
    selectedFilename = filename;
    console.log('Selected filename:', selectedFilename);
}

// Alternative: Let user input filename
function promptForFilename() {
    const filename = prompt('Enter filename (without extension):', 'output');
    if (filename && filename.trim() !== '') {
        setSelectedFilename(filename.trim());
        return true;
    }
    return false;
}

// Enhanced download with filename prompt if needed
async function downloadHexWithPrompt() {
    const hex = document.getElementById('output').value;
    
    if (!hex || hex.trim() === '') {
        showMessage('No hex data to download', 'errors');
        return;
    }
    
    // If no filename selected, prompt for one
    if (!selectedFilename) {
        if (!promptForFilename()) {
            showMessage('Download cancelled - no filename provided', 'warning');
            return;
        }
    }
    
    // Now proceed with download
    await downloadHex();
}

async function clearHardware() {
    const emptyHex = ""; // Zero bytes - empty hex file
    const filename = "output.hex";
    
    if (outputDirectoryHandle && 'showDirectoryPicker' in window) {
        try {
            const fileHandle = await outputDirectoryHandle.getFileHandle(filename, {
                create: true
            });
            const writable = await fileHandle.createWritable();
            await writable.write(emptyHex);
            await writable.close();
            document.getElementById('messages').innerHTML = '';
            debugLog(`Empty ${filename} saved to selected directory - hardware cleared`, 'success');
        } catch (err) {
            debugLog('Error saving empty hex to directory: ' + err.message, 'errors');
            // Fallback to regular download
            downloadFile(filename, emptyHex, 'text/plain');
        }
    } else {
        // No directory selected, fallback to regular download
        debugLog('No output directory selected, downloading empty hex file instead', 'warning');
        downloadFile(filename, emptyHex, 'text/plain');
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