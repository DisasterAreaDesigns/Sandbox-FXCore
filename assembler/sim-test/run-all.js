// Run every simulator test suite.
//   node assembler/sim-test/run-all.js

const { execFileSync } = require('child_process');
const path = require('path');

const SUITES = ['test-core.js', 'test-shiftreg.js', 'test-programs.js',
    'test-pitch-chr.js'];
let failed = 0;

for (const s of SUITES) {
    console.log(`\n=== ${s} ===`);
    try {
        process.stdout.write(execFileSync(process.execPath, [path.join(__dirname, s)],
            { encoding: 'utf8' }));
    } catch (e) {
        process.stdout.write(e.stdout || '');
        process.stderr.write(e.stderr || '');
        failed++;
    }
}

console.log(failed ? `\n${failed} suite(s) failed` : '\nall suites passed');
process.exit(failed ? 1 : 0);
