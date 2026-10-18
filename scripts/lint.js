// scripts/lint.js — 语法检查 + 一组零依赖的文本卫生检查
//
// 为什么要有后面那一半：本文件此前只跑 `node --check`（纯语法），抓不到
// 换行不一致、尾随空白、`var` 这些「不影响运行但会制造假 diff / 隐性 bug」的问题。
// 2026-09-22 与 2026-10-17 两次都被「工作区被写成 CRLF」咬过，而当时的 lint 一声不响。
//
// 刻意不做的检查：宽松相等（== / !=）需要真解析器才能在字符串与注释里不误报，
// 本项目零依赖，强行用正则只会 100% 误报，所以不做。
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.nyc_output', '_deepread_temp']);
// 只检查这些文本类型；二进制（png/tgz 等）一律跳过
const TEXT_EXT = new Set(['.js', '.cjs', '.mjs', '.json', '.yml', '.yaml', '.md', '.txt', '.example', '.gitattributes']);
const JS_EXT = new Set(['.js', '.cjs', '.mjs']);

function walk(dir, acc) {
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith('.tmp')) continue; // 临时目录（.tmp* / .tmp-old-*）
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(f)) walk(p, acc);
    } else {
      acc.push(p);
    }
  }
  return acc;
}

const all = walk(ROOT, []);
const textFiles = [];
const problems = [];

for (const f of all) {
  const rel = path.relative(ROOT, f);
  const ext = path.extname(f).toLowerCase();
  const base = path.basename(f).toLowerCase();
  const isText = TEXT_EXT.has(ext) || TEXT_EXT.has(base);
  if (!isText) continue;
  textFiles.push(f);

  const buf = fs.readFileSync(f);
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    problems.push(rel + ': 含 UTF-8 BOM（JSON/YAML 消费方会直接崩）');
  }
  const text = buf.toString('utf8');
  if (text.indexOf('\r') >= 0) {
    problems.push(rel + ': 含 CR（换行必须统一为 LF）');
  }
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/[ \t]+$/.test(line)) problems.push(rel + ':' + (i + 1) + ': 行尾有空白');
    if (/^\t/.test(line)) problems.push(rel + ':' + (i + 1) + ': 行首用了制表符（用空格）');
    if (JS_EXT.has(ext) && /^\s*var\s+/.test(line)) {
      problems.push(rel + ':' + (i + 1) + ': 用了 var（用 const / let）');
    }
  }
}

// 语法检查（保持原有行为）
const jsFiles = textFiles.filter(function (f) { return JS_EXT.has(path.extname(f).toLowerCase()); });
for (const f of jsFiles) {
  try { execSync('node --check "' + f + '"', { stdio: 'ignore' }); }
  catch (e) { problems.push(path.relative(ROOT, f) + ': node --check 失败'); }
}

if (problems.length) {
  for (const p of problems) console.error('LINT: ' + p);
  console.error('lint failed: ' + problems.length + ' problem(s) in ' + textFiles.length + ' text file(s)');
  process.exit(1);
}
console.log('Lint OK: ' + textFiles.length + ' text files (' + jsFiles.length + ' JS) — no BOM, LF only, no trailing whitespace, no leading tabs, no var');
