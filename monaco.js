// Monaco Editor Setup for FXCore Assembler
let editor; // global editor instance

// Configure Monaco Editor paths
require.config({
    paths: {
        'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.39.0/min/vs'
    }
});

require(['vs/editor/editor.main'], function() {
    // Register the FXCore language
    monaco.languages.register({
        id: 'fxcore'
    });

    monaco.languages.setMonarchTokensProvider('fxcore', {
        ignoreCase: true,
        tokenizer: {
            root: [
                // Line Comments
                [/;.*/, 'comment'],
                [/\/\/.*/, 'comment'],

                // Block Comment Start → enter comment state
                [/\/\*/, 'comment', '@comment'],

                // Strings → enter string mode
                ['"', {
                    token: 'string.quote',
                    next: '@string'
                }],

                // Labels at start of line (must come early)
                [/^\s*([a-zA-Z_][\w]*):/, 'label'],

                // Declarations
                [/\.(mem|equ|rn)\b/, 'keyword.declaration'],

                // Constants
                [/\b(LFO[0-3]|SIN|COS|POS|NEG|RMP[0-1]|L512|L1024|L2048|L4096|XF[0-3]|USER[0-1])\b/, 'constant'],
                [/\b(OUT[0-3]OFLO|IN[0-3]OFLO)\b/, 'constant'],
                [/\b(TB2NTB1|TAPSTKY|NEWTT|TAPRE|TAPPE|TAPLVL)\b/, 'constant'],
                [/\b(SW[0-4](DB|RE|PE)?)\b/, 'constant'],
                [/\b(ENABLEDB?|PLLRANGE[01]|MNS|I2CA[0-6]|TAP)\b/, 'constant'],
                [/\bPR(1[0-5]|[0-9])\b/, 'constant'],

                // Registers
                [/\b(r1[0-5]|r[0-9]|acc(32|64)|flags|in[0-3]|out[0-3]|pin|switch|pot[0-5](_k|_smth)?|lfo[0-3]_[fsc]|ramp[0-1]_[fr]|maxtempo|taptempo|samplecnt|noise|bootstat|tapstkrld|tapdbrld|swdbrld|prgdbrld|oflrld|mr(1[0-2][0-7]|[1-9][0-9]|[0-9]))\b/, 'variable'],

                // Operators
                [/\b(abs|clracc64|addi|add|adds|addsi|sub|subs|sl|slr|sls|slsr|sr|srr|sra|srar|macrr|macri|macrd|macid|machrr|machri|machrd|machid|multrr|multri|neg|log2|exp2)\b/, 'keyword'],

                // Control Flow
                [/\b(jgez|jneg|jnz|jz|jzc|jmp)\b/, 'keyword'],

                // Copy Operations
                [/\b(cpy_cc|cpy_cm|cpy_cs|cpy_mc|cpy_sc|cpy_cmx)\b/, 'keyword'],

                // Memory and Delay Operations
                [/\b(rdacc64u|rdacc64l|ldacc64u|ldacc64l|rddel|wrdel|rddelx|wrdelx|rddirx|wrdirx|sat65|wrdld)\b/, 'keyword'],

                // Logical Operations
                [/\b(inv|or|ori|and|andi|xor|xori)\b/, 'keyword'],

                // Audio Processing
                [/\b(apa|apb|apra|aprb|aprra|aprrb|apma|apmb|chr|pitch|set|interp)\b/, 'keyword'],

                // Hex Numbers
                [/\b0[xX][0-9A-Fa-f]+\b/, 'number.hex'],

                // Decimal Numbers
                [/\b\d+(\.\d+)?\b/, 'number'],

                // Identifiers
                [/\b[a-zA-Z_][\w]*\b/, 'identifier'],
            ],

            // String mode → everything inside quotes
            string: [
                [/[^"]+/, 'string'],
                ['"', {
                    token: 'string.quote',
                    next: '@pop'
                }]
            ],

            // Block Comment mode
            comment: [
                [/[^\/*]+/, 'comment'],
                [/\*\//, 'comment', '@pop'],
                [/[\/*]/, 'comment']
            ]
        }
    });

    // Light theme
    monaco.editor.defineTheme('fxcoreTheme', {
        base: 'vs', // or 'vs-dark'
        inherit: true,
        rules: [{
                token: 'keyword.operator',
                foreground: 'aa00ff',
                fontStyle: 'bold'
            },
            {
                token: 'keyword.control',
                foreground: 'ff0000',
                fontStyle: 'bold'
            },
            {
                token: 'keyword.other',
                foreground: '0066cc',
                fontStyle: 'bold'
            },
            {
                token: 'keyword.declaration',
                foreground: '006600',
                fontStyle: 'bold'
            },
            {
                token: 'keyword.constant',
                foreground: 'cc6600',
                fontStyle: 'bold'
            },
            {
                token: 'comment',
                foreground: '008000',
                fontStyle: 'italic'
            },
            {
                token: 'label',
                foreground: '0000ff'
            },
            {
                token: 'number',
                foreground: 'ff0000'
            },
            {
                token: 'number.hex',
                foreground: 'ff6600'
            },
            {
                token: 'string',
                foreground: 'a31515'
            }
        ],
        colors: {
            'editor.foreground': '#000000',
            'editor.background': '#ffffff',
            'editorLineNumber.foreground': '#999999',
            'editorCursor.foreground': '#000000',
            'editor.selectionBackground': '#BAD6FD',
            'editor.lineHighlightBackground': '#f0f8ff'
        }
    });

    // Dark theme
    monaco.editor.defineTheme('fxcoreDark', {
        base: 'vs-dark',
        inherit: true,
        rules: [{
                token: 'keyword.operator',
                foreground: 'd986ff',
                fontStyle: 'bold'
            },
            {
                token: 'keyword.control',
                foreground: 'ff7070',
                fontStyle: 'bold'
            },
            {
                token: 'keyword.other',
                foreground: '6699ff',
                fontStyle: 'bold'
            },
            {
                token: 'keyword.declaration',
                foreground: '66cc66',
                fontStyle: 'bold'
            },
            {
                token: 'keyword.constant',
                foreground: 'ffbb55',
                fontStyle: 'bold'
            },
            {
                token: 'comment',
                foreground: '6a9955',
                fontStyle: 'italic'
            },
            {
                token: 'label',
                foreground: '569cd6'
            },
            {
                token: 'number',
                foreground: 'f44747'
            },
            {
                token: 'number.hex',
                foreground: 'ff8800'
            },
            {
                token: 'string',
                foreground: 'ce9178'
            }
        ],
        colors: {
            'editor.foreground': '#d4d4d4',
            'editor.background': '#1e1e1e',
            'editorLineNumber.foreground': '#858585',
            'editorCursor.foreground': '#ffffff',
            'editor.selectionBackground': '#264f78',
            'editor.lineHighlightBackground': '#333333'
        }
    });

    // Create the Monaco Editor
    editor = monaco.editor.create(document.getElementById('editor'), {
        language: 'fxcore',
        theme: 'fxcoreTheme',
        automaticLayout: true,
        quickSuggestions: false,
        wordBasedSuggestions: false,
        minimap: {
            enabled: false
        }
    });

    // Apply system dark mode preference after editor is created
    setTimeout(() => {
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        const darkModeToggle = document.getElementById('darkModeToggle');

        if (darkModeToggle) {
            darkModeToggle.checked = prefersDark;
            const theme = prefersDark ? 'fxcoreDark' : 'fxcoreTheme';
            monaco.editor.setTheme(theme);
            document.body.classList.toggle('dark-mode', prefersDark);
        }
    }, 100);

    // Disable browser autocorrect on Monaco's hidden textarea
    setTimeout(() => {
        const textAreas = document.querySelectorAll('textarea');
        textAreas.forEach(textArea => {
            textArea.setAttribute('spellcheck', 'false');
            textArea.setAttribute('autocorrect', 'off');
            textArea.setAttribute('autocomplete', 'off');
            textArea.setAttribute('autocapitalize', 'off');
        });
    }, 500);
});