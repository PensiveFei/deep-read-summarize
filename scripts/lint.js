// scripts/lint.js — syntax-check all JS files (node --check)
// 跳过 node_modules / 隐藏目录（.git, .tmp* 等）/ 构建与临时目录。
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.nyc_output', '_deepread_temp']);

function findJs(dir, acc = []) {
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith('.tmp')) continue; // 临时目录（.tmp* / .tmp-old-*）
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(f)) findJs(p, acc);
    } else if (f.endsWith('.js')) acc.push(p);
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
