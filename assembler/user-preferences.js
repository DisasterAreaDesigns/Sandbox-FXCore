// User Preferences Storage System
class UserPreferences {
    constructor() {
        this.storageKey = 'fxcore_editor_preferences';
        this.defaults = {
            // Editor Options
            editorHeight: false,        // Large editor window
            darkMode: 'system',        // Dark mode: 'dark', 'light', or 'system'
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
                darkMode: this.getCurrentDarkModeSetting(),
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

    // Apply loaded preferences to the UI with proper timing
    apply() {
        const prefs = this.load();
        
        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
            this.applyEditorOptions(prefs);
            this.applyHardwareOptions(prefs);
            
            // Don't save here - we're applying saved preferences, not creating new ones
            // Only save when the user actually changes something via the auto-save listeners
        });
    }

    applyEditorOptions(prefs) {
        console.log('Applying editor options:', prefs);
        
        // Large editor window
        const editorHeightToggle = document.getElementById('editorHeightToggle');
        if (editorHeightToggle) {
            console.log('Setting editorHeight checkbox to:', prefs.editorHeight);
            editorHeightToggle.checked = prefs.editorHeight;
            if (prefs.editorHeight && typeof toggleEditorHeight === 'function') {
                toggleEditorHeight();
            }
        }

        // Dark mode - handle dropdown selection
        const darkModeSelect = document.getElementById('darkModeSelect');
        if (darkModeSelect) {
            console.log('Setting darkMode to:', prefs.darkMode);
            darkModeSelect.value = prefs.darkMode;
            this.applyDarkMode(prefs.darkMode);
        }

        // Minimap
        const minimapToggle = document.getElementById('minimapToggle');
        if (minimapToggle) {
            console.log('Setting minimap checkbox to:', prefs.minimap);
            minimapToggle.checked = prefs.minimap;
            if (prefs.minimap && typeof toggleMinimap === 'function') {
                toggleMinimap();
            }
        }

        // Debug mode - set checkbox first, then apply the setting
        const debugToggle = document.getElementById('debugToggle');
        if (debugToggle) {
            console.log('Setting debugMode checkbox to:', prefs.debugMode);
            debugToggle.checked = prefs.debugMode;
            
            // Apply debug preset based on saved preference
            if (prefs.debugMode) {
                console.log('Applying debug preset: basic');
                if (typeof DEBUG !== 'undefined' && DEBUG.setPreset) {
                    DEBUG.setPreset('basic');
                }
            } else {
                console.log('Resetting debug preset to default');
                if (typeof DEBUG !== 'undefined' && DEBUG.reset) {
                    DEBUG.reset();
                }
            }
        }
    }

    applyHardwareOptions(prefs) {
        // Hardware mode
        if (prefs.hwMode !== selectedHW) {
            // Set the mode without cycling through
            selectedHW = prefs.hwMode;
            const hwModeDisplay = document.getElementById('HWModeDisplay');
            if (hwModeDisplay) {
                hwModeDisplay.textContent = selectedHW === 'hid' ? 'HID mode' : 'File mode';
            }
            
            const fileModeDiv = document.getElementById('FileModeDiv');
            const hidModeDiv = document.getElementById('HidModeDiv');
            
            if (selectedHW === 'hid') {
                if (fileModeDiv) fileModeDiv.style.display = 'none';
                if (hidModeDiv) hidModeDiv.style.display = 'block';
            } else {
                if (fileModeDiv) fileModeDiv.style.display = 'block';
                if (hidModeDiv) hidModeDiv.style.display = 'none';
            }
        }

        // FXCore address
        const fxcoreAddrInput = document.getElementById('FXcoreAddr');
        if (fxcoreAddrInput && prefs.fxcoreAddress) {
            fxcoreAddrInput.value = prefs.fxcoreAddress;
            if (typeof FXCoreTargets !== 'undefined') {
                FXCoreTargets.FXCore_I2C = prefs.fxcoreAddress;
            }
        }

        // Program target
        if (prefs.programTarget !== selectedProgram) {
            selectedProgram = prefs.programTarget;
            if (typeof updateProgramTargetDisplay === 'function') {
                updateProgramTargetDisplay();
            }
            if (window.syncProgramTargetDisplays) {
                window.syncProgramTargetDisplays();
            }
        }

        // Update UI elements if functions exist
        if (typeof updateHardwareConnectionStatus === 'function') {
            updateHardwareConnectionStatus();
        }
        if (typeof updateBuildResultsButtons === 'function') {
            updateBuildResultsButtons();
        }
    }

    // Clear all saved preferences
    clear() {
        localStorage.removeItem(this.storageKey);
        debugLog('Preferences cleared', 'info');
    }

    // Helper method to get current dark mode setting
    getCurrentDarkModeSetting() {
        const darkModeSelect = document.getElementById('darkModeSelect');
        return darkModeSelect ? darkModeSelect.value : 'system';
    }

    // Apply dark mode based on preference
    applyDarkMode(setting) {
        const darkModeSelect = document.getElementById('darkModeSelect');
        if (!darkModeSelect) return;

        // Ensure setting is a string and has a valid value
        const validSetting = typeof setting === 'string' ? setting : 'system';
        const finalSetting = ['light', 'dark', 'system'].includes(validSetting) ? validSetting : 'system';

        // Set the dropdown value
        darkModeSelect.value = finalSetting;

        let shouldUseDark = false;
        
        switch (finalSetting) {
            case 'dark':
                shouldUseDark = true;
                break;
            case 'light':
                shouldUseDark = false;
                break;
            case 'system':
            default:
                // Follow system preference
                shouldUseDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                break;
        }

        // Apply the theme
        if (editor && typeof monaco !== 'undefined') {
            const theme = shouldUseDark ? 'fxcoreDark' : 'fxcoreTheme';
            monaco.editor.setTheme(theme);
        }
        document.body.classList.toggle('dark-mode', shouldUseDark);
    }

    // Get current preferences without saving
    getCurrent() {
        return {
            editorHeight: document.getElementById('editorHeightToggle')?.checked || false,
            darkMode: this.getCurrentDarkModeSetting(),
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

    // Save when dark mode dropdown changes
    const darkModeSelect = document.getElementById('darkModeSelect');
    if (darkModeSelect) {
        darkModeSelect.addEventListener('change', () => {
            userPrefs.applyDarkMode(darkModeSelect.value);
            userPrefs.save();
        });
    }

    // Save when FXCore address changes
    const fxcoreAddrInput = document.getElementById('FXcoreAddr');
    if (fxcoreAddrInput) {
        fxcoreAddrInput.addEventListener('change', () => {
            if (typeof FXCoreTargets !== 'undefined') {
                FXCoreTargets.FXCore_I2C = fxcoreAddrInput.value;
            }
            userPrefs.save();
        });
    }

    // Save when hardware mode or program target changes
    // These will be called from your existing functions
}

// Modified versions of your existing functions to include auto-save
function toggleEditorHeightWithSave() {
    if (typeof toggleEditorHeight === 'function') {
        toggleEditorHeight();
    }
    userPrefs.save();
}

// Modified dark mode toggle to cycle through three states: Light -> Dark -> System
function toggleDarkModeWithSave() {
    // This function is no longer needed with dropdown
    // Left for compatibility but does nothing
}

function toggleMinimapWithSave() {
    if (typeof toggleMinimap === 'function') {
        toggleMinimap();
    }
    userPrefs.save();
}

function toggleDebugPresetWithSave() {
    if (typeof toggleDebugPreset === 'function') {
        toggleDebugPreset();
    }
    userPrefs.save();
}

function cycleHWModeWithSave() {
    if (typeof cycleHWMode === 'function') {
        cycleHWMode();
    }
    userPrefs.save();
}

function cycleProgramTargetWithSave() {
    if (typeof cycleProgramTarget === 'function') {
        cycleProgramTarget();
    }
    userPrefs.save();
}

// Initialize preferences system with better timing
function initializePreferences() {
    // Wait for DOM to be fully ready and other scripts to load
    setTimeout(() => {
        console.log('Initializing preferences system...');
        
        // Load and apply saved preferences
        userPrefs.apply();
        
        // Set up auto-save listeners after a short delay
        setTimeout(() => {
            setupAutoSave();
            setupSystemThemeListener();
        }, 200);
        
        debugLog('User preferences system initialized', 'info');
    }, 300); // Increased delay to ensure all scripts are loaded
}

// Listen for system theme changes and update if user has "system" selected
function setupSystemThemeListener() {
    if (window.matchMedia) {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        
        const handleSystemThemeChange = (e) => {
            const darkModeSelect = document.getElementById('darkModeSelect');
            if (darkModeSelect && darkModeSelect.value === 'system') {
                console.log('System theme changed, updating app theme');
                userPrefs.applyDarkMode('system');
                // No need to save here - the preference is still "system"
            }
        };
        
        // Listen for changes
        mediaQuery.addEventListener('change', handleSystemThemeChange);
        
        console.log('System theme change listener set up');
    }
}

// Export for use in other files
window.userPrefs = userPrefs;
window.initializePreferences = initializePreferences;