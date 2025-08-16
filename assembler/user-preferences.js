// User Preferences Storage System
class UserPreferences {
    constructor() {
        this.storageKey = 'fxcore_editor_preferences';
        this.defaults = {
            // Editor Options
            editorHeight: false,        // Large editor window
            darkMode: false,           // Enable dark mode
            minimap: false,            // Show editor mini-map
            debugMode: false,          // Show full build results
            
            // Hardware Options
            hwMode: 'hid',             // Hardware mode: 'hid' or 'file'
            fxcoreAddress: '0x30',     // FXCore I2C address
            programTarget: 'ram',      // Program target: 'ram' or '0'-'15'
            outputDirectory: null,     // Can't persist file handles
            serialPort: null           // Can't persist serial ports
        };
    }

    // Save current preferences to localStorage
    save() {
        try {
            const currentPrefs = {
                // Get current checkbox states
                editorHeight: document.getElementById('editorHeightToggle')?.checked || false,
                darkMode: document.getElementById('darkModeToggle')?.checked || false,
                minimap: document.getElementById('minimapToggle')?.checked || false,
                debugMode: document.getElementById('debugToggle')?.checked || false,
                
                // Get current hardware settings
                hwMode: selectedHW || 'hid',
                fxcoreAddress: document.getElementById('FXcoreAddr')?.value || '0x30',
                programTarget: selectedProgram || 'ram'
                // Note: outputDirectory and serialPort can't be persisted
            };
            
            localStorage.setItem(this.storageKey, JSON.stringify(currentPrefs));
            debugLog('Preferences saved', 'info');
            debugLog(JSON.stringify(currentPrefs), 'verbose');
            return true;
        } catch (error) {
            debugLog('Failed to save preferences', 'errors');
            debugLog(JSON.stringify(error), 'verbose');
            return false;
        }
    }

    // Load preferences from localStorage
    load() {
        try {
            const saved = localStorage.getItem(this.storageKey);
            if (saved) {
                const prefs = JSON.parse(saved);
                debugLog('Preferences loaded', 'info');
                debugLog(JSON.stringify(prefs), 'verbose');
                return { ...this.defaults, ...prefs };
            }
            return this.defaults;
        } catch (error) {
            debugLog('Failed to load preferences', 'errors');
            debugLog(JSON.stringify(error), 'verbose');
            return this.defaults;
        }
    }

    // Apply loaded preferences to the UI
    apply() {
        const prefs = this.load();
        
        // Apply editor options
        this.applyEditorOptions(prefs);
        
        // Apply hardware options
        this.applyHardwareOptions(prefs);
        
        // Save current state (in case any defaults were applied)
        this.save();
    }

    applyEditorOptions(prefs) {
        // Large editor window
        const editorHeightToggle = document.getElementById('editorHeightToggle');
        if (editorHeightToggle) {
            editorHeightToggle.checked = prefs.editorHeight;
            if (prefs.editorHeight) {
                toggleEditorHeight();
            }
        }

        // Dark mode
        const darkModeToggle = document.getElementById('darkModeToggle');
        if (darkModeToggle) {
            darkModeToggle.checked = prefs.darkMode;
            if (prefs.darkMode) {
                toggleDarkMode();
            }
        }

        // Minimap
        const minimapToggle = document.getElementById('minimapToggle');
        if (minimapToggle) {
            minimapToggle.checked = prefs.minimap;
            if (prefs.minimap) {
                toggleMinimap();
            }
        }

        // Debug mode
        const debugToggle = document.getElementById('debugToggle');
        if (debugToggle) {
            debugToggle.checked = prefs.debugMode;
            if (prefs.debugMode) {
                toggleDebugPreset();
            }
        }
    }

    applyHardwareOptions(prefs) {
        // Hardware mode
        if (prefs.hwMode !== selectedHW) {
            // Set the mode without cycling through
            selectedHW = prefs.hwMode;
            document.getElementById('HWModeDisplay').textContent = 
                selectedHW === 'hid' ? 'HID mode' : 'File mode';
            
            if (selectedHW === 'hid') {
                document.getElementById('FileModeDiv').style.display = 'none';
                document.getElementById('HidModeDiv').style.display = 'block';
            } else {
                document.getElementById('FileModeDiv').style.display = 'block';
                document.getElementById('HidModeDiv').style.display = 'none';
            }
        }

        // FXCore address
        const fxcoreAddrInput = document.getElementById('FXcoreAddr');
        if (fxcoreAddrInput && prefs.fxcoreAddress) {
            fxcoreAddrInput.value = prefs.fxcoreAddress;
            FXCoreTargets.FXCore_I2C = prefs.fxcoreAddress;
        }

        // Program target
        if (prefs.programTarget !== selectedProgram) {
            selectedProgram = prefs.programTarget;
            updateProgramTargetDisplay();
            if (window.syncProgramTargetDisplays) {
                window.syncProgramTargetDisplays();
            }
        }

        // Update UI elements
        updateHardwareConnectionStatus();
        updateBuildResultsButtons();
    }

    // Clear all saved preferences
    clear() {
        localStorage.removeItem(this.storageKey);
        debugLog('Preferences cleared', 'info');
    }

    // Get current preferences without saving
    getCurrent() {
        return {
            editorHeight: document.getElementById('editorHeightToggle')?.checked || false,
            darkMode: document.getElementById('darkModeToggle')?.checked || false,
            minimap: document.getElementById('minimapToggle')?.checked || false,
            debugMode: document.getElementById('debugToggle')?.checked || false,
            hwMode: selectedHW || 'hid',
            fxcoreAddress: document.getElementById('FXcoreAddr')?.value || '0x30',
            programTarget: selectedProgram || 'ram'
        };
    }
}

// Create global instance
const userPrefs = new UserPreferences();

// Auto-save preferences when settings change
function setupAutoSave() {
    // Save when checkboxes change
    const checkboxes = [
        'editorHeightToggle',
        'darkModeToggle', 
        'minimapToggle',
        'debugToggle'
    ];
    
    checkboxes.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('change', () => {
                userPrefs.save();
            });
        }
    });

    // Save when FXCore address changes
    const fxcoreAddrInput = document.getElementById('FXcoreAddr');
    if (fxcoreAddrInput) {
        fxcoreAddrInput.addEventListener('change', () => {
            FXCoreTargets.FXCore_I2C = fxcoreAddrInput.value;
            userPrefs.save();
        });
    }

    // Save when hardware mode or program target changes
    // These will be called from your existing functions
}

// Modified versions of your existing functions to include auto-save
function toggleEditorHeightWithSave() {
    toggleEditorHeight();
    userPrefs.save();
}

function toggleDarkModeWithSave() {
    toggleDarkMode();
    userPrefs.save();
}

function toggleMinimapWithSave() {
    toggleMinimap();
    userPrefs.save();
}

function toggleDebugPresetWithSave() {
    toggleDebugPreset();
    userPrefs.save();
}

function cycleHWModeWithSave() {
    cycleHWMode();
    userPrefs.save();
}

function cycleProgramTargetWithSave() {
    cycleProgramTarget();
    userPrefs.save();
}

// Initialize preferences system
function initializePreferences() {
    // Load and apply saved preferences
    userPrefs.apply();
    
    // Set up auto-save listeners
    setupAutoSave();
    
    debugLog('User preferences system initialized', 'info');
}

// Export for use in other files
window.userPrefs = userPrefs;
window.initializePreferences = initializePreferences;