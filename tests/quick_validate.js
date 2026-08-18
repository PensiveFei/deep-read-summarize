// tests/quick_validate.js — fast sanity check before release/tag
// 注意：不用 child_process（沙箱环境禁止 spawn），纯 fs 检查
const fs = require('fs');

console.log('== deep-read-summarize quick validation ==');
let failed = false;

// 1. All JS files exist
const files = [
  'workflow.js', 'parsers/index.js', 'parsers/book.js', 'parsers/paper.js',
  'parsers/video.js', 'parsers/web.js', 'schemas/index.js'
];
for (const f of files) {
  if (!fs.existsSync(f)) { console.error('MISSING:', f); failed = true; }
}
if (!failed) console.log('  OK: all ' + files.length + ' JS files present');

// 2. README has compatibility + copyright sections (bilingual)
const readme = fs.readFileSync('README.md', 'utf8');
const hasCompat = readme.includes('兼容性') || readme.includes('Compatibility');
const hasCopyright = readme.includes('版权') || readme.includes('copyright');
if (!hasCompat || !hasCopyright) {
  console.error('README must mention compatibility and copyright policy');
  failed = true;
}
if (!failed) console.log('  OK: README has compatibility + copyright sections');

// 3. LICENSE is MIT
const lic = fs.readFileSync('LICENSE', 'utf8');
if (!lic.includes('MIT License')) { console.error('LICENSE must be MIT'); failed = true; }
if (!failed) console.log('  OK: LICENSE is MIT');

// 4. No secrets in source
let secretFound = false;
const all = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
const secretPatterns = [
  /ghp_[A-Za-z0-9]{20,}/, /gho_[A-Za-z0-9]{20,}/, /sk-[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/, /AIza[0-9A-Za-z_-]{30,}/, /-----BEGIN .*PRIVATE KEY-----/
];
for (const pat of secretPatterns) {
  if (pat.test(all)) { console.error('SECRET PATTERN DETECTED'); secretFound = true; failed = true; }
}
if (!secretFound) console.log('  OK: no secrets in source');

// 5. SECURITY.md and templates exist
const required = ['SECURITY.md', '.github/ISSUE_TEMPLATE/bug_report.md', '.github/ISSUE_TEMPLATE/feature_request.md', '.github/PULL_REQUEST_TEMPLATE.md', 'docs/RELEASE.md'];
let missing = required.filter(f => !fs.existsSync(f));
if (missing.length) { console.error('MISSING:', missing.join(', ')); failed = true; }
if (!failed) console.log('  OK: SECURITY.md + issue/PR templates present');

if (failed) { console.error('== validation FAILED =='); process.exit(1); }
console.log('== validation OK — ready to tag ==');