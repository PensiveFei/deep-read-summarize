// scripts/security-check.js — 密钥/隐私/路径扫描（可被测试调用）
// 扫描仓库内文本文件，检查常见密钥模式与本地用户路径泄露。
// 直接运行：node scripts/security-check.js（exit 1 = 发现问题）
// 测试调用：const { scanDir } = require('./scripts/security-check'); scanDir(dir);
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.nyc_output', '_deepread_temp']);
// 匹配文件后缀：js/md/yml/yaml/json/txt + .env.example（.example 结尾）
const FILE_RE = /\.(js|md|yml|yaml|json|txt|example)$/i;
const PATTERNS = [
  [/api[_-]?key\s*[:=]\s*['"][^'"]+/i, 'API KEY pattern'],
  [/sk-[A-Za-z0-9]{20,}/, 'OpenAI-style key'],
  [/password\s*[:=]\s*['"][^'"]+/i, 'password pattern'],
  [/C:\\Users\\[^\\"' ]+/i, 'Windows user path'],
  [/C:\/Users\/[^"' ]+/i, 'Windows user path (forward slash)'],
  [/AKIA[0-9A-Z]{16}/, 'AWS key']
];

function walk(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return acc; }
  for (const ent of entries) {
    if (ent.name.startsWith('.tmp')) continue; // 临时目录
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) walk(p, acc);
    } else if (FILE_RE.test(ent.name)) acc.push(p);
  }
  return acc;
}

/** 扫描目录，返回问题列表（空数组 = 干净） */
function scanDir(dir) {
  const files = walk(dir);
  const issues = [];
  for (const f of files) {
    let c;
    try { c = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
    for (const [re, label] of PATTERNS) {
      if (re.test(c)) issues.push(label + ' in ' + path.relative(dir, f));
    }
  }
  return issues;
}

if (require.main === module) {
  const issues = scanDir(process.cwd());
  if (issues.length === 0) { console.log('OK: no secrets/passwords/local user paths found'); }
  else { issues.forEach(i => console.log('ISSUE: ' + i)); process.exit(1); }
}

module.exports = { scanDir, walk, PATTERNS };
