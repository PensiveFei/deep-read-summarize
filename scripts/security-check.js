const fs = require('fs');
const path = require('path');

function walk(dir, acc = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) { if (f !== 'node_modules' && f !== '.git') walk(p, acc); }
    else if (/\.(js|md|yml|json|txt)$/.test(f)) acc.push(p);
  }
  return acc;
}

const files = walk(process.cwd());
const issues = [];
const patterns = [
  [/api[_-]?key\s*[:=]\s*['"][^'"]+/i, 'API KEY pattern'],
  [/sk-[A-Za-z0-9]{20,}/, 'OpenAI-style key'],
  [/password\s*[:=]\s*['"][^'"]+/i, 'password pattern'],
  [/C:\\Users\\[^\\"']+/i, 'Windows user path'],
  [/AKIA[0-9A-Z]{16}/, 'AWS key']
];

for (const f of files) {
  const c = fs.readFileSync(f, 'utf8');
  for (const [re, label] of patterns) {
    if (re.test(c)) issues.push(label + ' in ' + path.relative(process.cwd(), f));
  }
}

if (issues.length === 0) { console.log('OK: no secrets/passwords/local user paths found'); }
else { issues.forEach(i => console.log('ISSUE: ' + i)); process.exit(1); }