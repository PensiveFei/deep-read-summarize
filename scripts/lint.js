// scripts/lint.js — syntax-check all JS files (node --check)
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function findJs(dir, acc = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) { if (f !== 'node_modules') findJs(p, acc); }
    else if (f.endsWith('.js')) acc.push(p);
  }
  return acc;
}

const files = findJs(__dirname + '/..');
let failed = 0;
for (const f of files) {
  try { execSync('node --check "' + f + '"', { stdio: 'ignore' }); }
  catch (e) { console.error('LINT FAIL:', f); failed++; }
}
if (failed) { console.error(failed + ' file(s) failed'); process.exit(1); }
console.log('Lint OK:', files.length, 'files');