// tests/quick_validate.js — fast sanity check before release/tag
const { execSync } = require('child_process');
const fs = require('fs');

console.log('== deep-read-summarize quick validation ==');

// 1. All JS files parse
const files = [
  'workflow.js', 'parsers/index.js', 'parsers/book.js', 'parsers/paper.js',
  'parsers/video.js', 'parsers/web.js', 'schemas/index.js'
];
for (const f of files) {
  if (!fs.existsSync(f)) { console.error('MISSING:', f); process.exit(1); }
  execSync('node --check ' + f);
}
console.log('  ✅ all ' + files.length + ' JS files parse');

// 2. README exists and mentions compatibility + copyright
const readme = fs.readFileSync('README.md', 'utf8');
if (!readme.includes('Compatibility') || !readme.includes('no copyrighted content')) {
  console.error('README must mention Compatibility and copyright policy');
  process.exit(1);
}
console.log('  ✅ README has compatibility + copyright sections');

// 3. LICENSE is MIT
const lic = fs.readFileSync('LICENSE', 'utf8');
if (!lic.includes('MIT License')) { console.error('LICENSE must be MIT'); process.exit(1); }
console.log('  ✅ LICENSE is MIT');

// 4. No secrets / local paths leak check
const all = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
const secretPatterns = [/(api[_-]?key|token|password|secret)\s*[:=]\s*['"][^'"]+/i];
for (const pat of secretPatterns) {
  if (pat.test(all)) { console.error('SECRET PATTERN DETECTED in source'); process.exit(1); }
}
console.log('  ✅ no obvious secrets in source');

console.log('== validation OK — ready to tag ==');