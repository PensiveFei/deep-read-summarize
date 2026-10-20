#!/usr/bin/env node
// scripts/release.js — 一条命令走完发布（零依赖）
//
// 为什么要有它：发布本身有 8 个手工步骤，本项目因此踩过三次坑——
//   1. 手写发布日期写错（0.3.12 写成 10-05、0.3.16 写成 10-18，后者是同一个坑第二次；
//      因为复核日期的时机太早，长会话跨了零点）；
//   2. package.json 已 bump 但 docs/RELEASE.md 没列该版本 → publish 的 tag 校验被拦下（0.3.13）；
//   3. tag 与 Release 的先后顺序（早了会建出指向默认分支 HEAD 的 tag）。
//
// 本脚本把这些都变成断言：日期在**运行时**取、CHANGELOG 与 RELEASE.md 必须先一致、
// 门禁先跑、tag 先推再建 Release、判据只看日志里的 `+ 包名@版本`。
//
// 用法：
//   node scripts/release.js                 # 只打印计划，不做任何写操作
//   node scripts/release.js --yes           # 真正发布
//   node scripts/release.js --minor --yes   # 按 minor 递增（默认 patch）
//   node scripts/release.js --version 1.2.3 --yes
//   node scripts/release.js --help
'use strict';

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);

function has(f) { return argv.indexOf(f) >= 0; }
function opt(f) { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; }
function info(m) { console.log('[release] ' + m); }
function die(m, hint) {
  console.error('\n[release] 中止：' + m);
  if (hint) console.error('[release] ' + hint);
  process.exit(1);
}

/** Windows 上 npm 是 .cmd，直接 execFile 会 ENOENT（本项目的既有教训）。 */
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(cmd, cmdArgs, opts) {
  return String(execFileSync(cmd, cmdArgs, Object.assign({ cwd: ROOT, encoding: 'utf8' }, opts || {}))).trim();
}
function git() { return run('git', Array.prototype.slice.call(arguments)); }

/** 同步睡眠。别用 setTimeout：不 await 的话它立刻返回，等于没睡。 */
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function localToday() {
  const d = new Date();
  const p = function (n) { return ('0' + n).slice(-2); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function usage() {
  console.log([
    '用法：node scripts/release.js [选项]',
    '',
    '  （无参数）        只打印计划，不做任何写操作',
    '  --yes            真正执行',
    '  --patch          补丁版递增（默认）',
    '  --minor         次版本递增',
    '  --major         主版本递增',
    '  --version x.y.z  指定版本',
    '  --help           显示本说明',
    '',
    '前置条件（脚本会逐条校验）：',
    '  1. 工作区干净、当前在 main、本地与 origin/main 一致',
    '  2. CHANGELOG.md 里已有目标版本的小节，且**日期等于今天**',
    '  3. docs/RELEASE.md 里还没有该版本',
    '',
    '脚本负责：跑门禁 → bump 版本 → 更新 RELEASE.md → commit → tag → push →',
    '          dispatch 发布（先 dry-run）→ 校验日志判据 → 用 npm 同字节建 Release'
  ].join('\n'));
}

const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const NAME = pkg.name;
const repo = String((pkg.repository && pkg.repository.url) || '')
  .replace(/^git\+/, '')
  .replace(/^https?:\/\/github\.com\//, '')
  .replace(/\.git$/, '');
if (!repo) die('package.json 里没有可解析的 repository.url');

function nextVersion(cur) {
  const explicit = opt('--version');
  if (explicit) {
    if (!/^\d+\.\d+\.\d+$/.test(explicit)) die('--version 必须是 x.y.z：' + explicit);
    return explicit;
  }
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(cur);
  if (!m) die('package.json 的 version 不是 x.y.z：' + cur);
  let maj = Number(m[1]), min = Number(m[2]), pat = Number(m[3]);
  if (has('--major')) { maj += 1; min = 0; pat = 0; }
  else if (has('--minor')) { min += 1; pat = 0; }
  else pat += 1;
  return maj + '.' + min + '.' + pat;
}

function changelogSection(ver) {
  const file = path.join(ROOT, 'CHANGELOG.md');
  const text = fs.readFileSync(file, 'utf8');
  const start = text.indexOf('## [' + ver + ']');
  if (start < 0) return null;
  const next = text.indexOf('\n## [', start + 4);
  return {
    body: text.slice(start, next < 0 ? text.length : next).trim(),
    header: text.slice(start, text.indexOf('\n', start))
  };
}

/** 从 CHANGELOG 小节里取第一段正文，作为 RELEASE.md 表格的一行说明。 */
function deriveSummary(section) {
  const lines = section.body.split('\n').slice(1);
  for (const raw of lines) {
    const s = raw.trim();
    if (!s || s[0] === '#' || s[0] === '|' || s[0] === '-' || s[0] === '*') continue;
    return s.replace(/\*\*/g, '').slice(0, 90);
  }
  return '';
}

function preflight() {
  const dirty = git('status', '--porcelain').split('\n').filter(Boolean);
  // CHANGELOG 必须由人先写好，所以允许它处于未提交状态（会并进发布 commit）。
  const allowed = dirty.filter(function (l) { return !/^\s*M\s+CHANGELOG\.md$/.test(l); });
  if (allowed.length) die('工作区不干净（只允许 CHANGELOG.md 未提交）：\n' + dirty.join('\n'));
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (branch !== 'main') die('当前在 ' + branch + '，发布只允许在 main 上');
  run('git', ['fetch', 'origin', 'main', '--quiet'], { stdio: ['ignore', 'pipe', 'ignore'] });
  if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) {
    die('本地 main 与 origin/main 不一致（先 push 或 pull）');
  }
}

function gates() {
  const steps = ['lint', 'test', 'test:node', 'security', 'validate'];
  for (const s of steps) {
    info('门禁：npm run ' + s);
    execFileSync(NPM, ['run', s], { cwd: ROOT, stdio: 'inherit' });
  }
}

function writeVersion(ver) {
  const next = Object.assign({}, pkg, { version: ver });
  fs.writeFileSync(pkgPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
}

function updateReleaseTable(ver, oldVer, summary) {
  const file = path.join(ROOT, 'docs', 'RELEASE.md');
  const text = fs.readFileSync(file, 'utf8');
  const current = '| **v' + oldVer + '** | **npm 已发布（当前）** |';
  if (text.indexOf(current) < 0) die('docs/RELEASE.md 里找不到 v' + oldVer + ' 的「当前」行，无法安全改写');
  const lines = text.split('\n');
  const idx = lines.findIndex(function (l) { return l.indexOf(current) === 0; });
  lines[idx] = lines[idx].replace('| **v' + oldVer + '** | **npm 已发布（当前）** |', '| v' + oldVer + ' | npm 已发布 |');
  lines.splice(idx + 1, 0, '| **v' + ver + '** | **npm 已发布（当前）** | ' + summary + ' |');
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
}

function listPublishRuns() {
  return JSON.parse(run('gh', ['run', 'list', '--repo', repo, '--workflow', 'publish.yml',
    '--limit', '10', '--json', 'databaseId'])).map(function (r) { return r.databaseId; });
}

/**
 * 等一次「新出现的」publish run 并等它跑完。
 * 用「dispatch 前后的 run id 集合差集」来认领，而不是比时间戳 —— 时间戳会
 * 因为时钟误差和连续两次 dispatch 而认错 run。
 */
function waitForNewRun(known) {
  info('等待 publish run 出现…');
  let id = null;
  for (let i = 0; i < 60 && !id; i++) {
    for (const candidate of listPublishRuns()) {
      if (known.indexOf(candidate) < 0) { id = candidate; break; }
    }
    if (!id) sleep(5000);
  }
  if (!id) die('5 分钟内没有等到新的 publish run');
  info('run id = ' + id + '，等待完成…');
  for (let i = 0; i < 120; i++) {
    const v = JSON.parse(run('gh', ['run', 'view', String(id), '--repo', repo, '--json', 'status,conclusion']));
    if (v.status === 'completed') {
      if (v.conclusion !== 'success') die('publish run 结论是 ' + v.conclusion + '（run ' + id + '）');
      return id;
    }
    sleep(10000);
  }
  die('20 分钟内 run 没有结束');
}

function dispatchPublish(ver, dryRun) {
  const known = listPublishRuns();
  info('dispatch 发布（' + (dryRun ? 'dry-run' : '真发') + '）');
  run('gh', ['workflow', 'run', 'publish.yml', '--repo', repo, '--ref', 'main',
    '-f', 'dry_run=' + (dryRun ? 'true' : 'false'),
    '-f', 'publish_ref=refs/tags/v' + ver]);
  return waitForNewRun(known);
}

/** 判据只认日志里的 `+ 包名@版本`（registry 可见有两分钟延迟，npm view 当场查必然 404）。 */
function assertPublished(runId, ver) {
  const log = run('gh', ['run', 'view', String(runId), '--repo', repo, '--log']);
  if (log.indexOf('+ ' + NAME + '@' + ver) < 0) {
    die('日志里没有出现 `+ ' + NAME + '@' + ver + '`，不能算发布成功（看 run ' + runId + ' 的完整日志）');
  }
  info('日志判据通过：+ ' + NAME + '@' + ver);
}

function createRelease(ver, section) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drs-release-'));
  run(NPM, ['pack', NAME + '@' + ver, '--pack-destination', tmp], { stdio: 'pipe' });
  const tgz = fs.readdirSync(tmp).filter(function (f) { return f.endsWith('.tgz'); })[0];
  if (!tgz) die('npm pack 没有产出 tgz');
  const abs = path.join(tmp, tgz);
  const buf = fs.readFileSync(abs);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');

  const header = [
    '**npm 已同步**：`latest = ' + ver + '`，带 **provenance 签名**（Trusted Publishing / OIDC，无长期 token）。',
    '',
    '> 本说明由 `scripts/release.js` 从 `CHANGELOG.md` 的 `[' + ver + ']` 小节原样生成，避免发布说明与变更日志各自漂移。',
    ''
  ].join('\n');
  const footer = [
    '',
    '### 资产',
    '',
    '- `' + tgz + '` —— 从 npm 取回的**同一份字节**',
    '- SHA-256：`' + sha + '`',
    '- ' + buf.length + ' B，带 SLSA provenance'
  ].join('\n');
  const notesPath = path.join(tmp, 'notes.md');
  fs.writeFileSync(notesPath, header + section.body.replace(/^## \[[^\]]+\][^\n]*\n?/, '') + footer + '\n', 'utf8');

  info('建 Release v' + ver);
  run('gh', ['release', 'create', 'v' + ver, abs, '--repo', repo,
    '--title', 'v' + ver, '--notes-file', notesPath, '--latest']);
  info('资产 sha256 = ' + sha);
  return sha;
}

// ---------------------------------------------------------------- 主流程
if (has('--help') || has('-h')) { usage(); process.exit(0); }

const today = localToday();
const oldVer = pkg.version;
const ver = nextVersion(oldVer);
const section = changelogSection(ver);

info('仓库         : ' + repo);
info('当前版本     : ' + oldVer);
info('目标版本     : ' + ver);
info('今天（本地） : ' + today);

preflight();
info('前置检查     : 工作区干净 / main / 与远端一致');

if (!section) {
  die('CHANGELOG.md 里没有 `## [' + ver + ']` 小节',
    '先在 CHANGELOG.md 顶部写好这一版的说明（含 `— ' + today + '`），再重跑本脚本。' +
    '发布说明会从该小节原样生成，所以这一步必须由人写。');
}
const m = /^## \[([^\]]+)\] — (\d{4}-\d{2}-\d{2})/.exec(section.header);
if (!m) die('CHANGELOG 的 ' + ver + ' 小节标题缺少日期：' + section.header,
  '格式应为 `## [' + ver + '] — ' + today + '`');
if (m[2] !== today) {
  die('CHANGELOG 里 ' + ver + ' 的日期是 ' + m[2] + '，而今天是 ' + today,
    '这正是本项目踩过两次的坑（0.3.12 与 0.3.16）。把日期改成今天再跑。');
}
info('CHANGELOG    : 已存在 ' + ver + ' 小节，日期与今天一致');

const releaseMd = fs.readFileSync(path.join(ROOT, 'docs', 'RELEASE.md'), 'utf8');
if (releaseMd.indexOf('v' + ver) >= 0) die('docs/RELEASE.md 里已经出现 v' + ver + '，可能已发过');
if (git('tag', '-l', 'v' + ver)) die('本地已有 tag v' + ver);
if (run('git', ['ls-remote', '--tags', 'origin', 'v' + ver])) die('远端已有 tag v' + ver);
info('版本一致性   : CHANGELOG / RELEASE.md / tag 均无冲突');

const summary = deriveSummary(section);
if (!summary) die('无法从 CHANGELOG 小节里提取一行说明，请手动补一段');
info('RELEASE.md 行 : ' + summary);

console.log('\n=== 计划 ===');
console.log('  1. 跑门禁：lint / test / test:node / security / validate');
console.log('  2. package.json: ' + oldVer + ' -> ' + ver);
console.log('  3. docs/RELEASE.md: 标记 v' + oldVer + ' 已发布，插入 v' + ver + ' 行');
console.log('  4. commit "chore(release): ' + ver + '"');
console.log('  5. tag -a v' + ver + '，先推 commit 再推 tag');
console.log('  6. dispatch publish（先 dry-run，再真发）并校验日志判据');
console.log('  7. 用 npm 同字节建 GitHub Release v' + ver + '（Latest）');
console.log('');

if (!has('--yes')) {
  info('未加 --yes，只打印计划，什么都没改。');
  process.exit(0);
}

gates();
writeVersion(ver);
updateReleaseTable(ver, oldVer, summary);
info('已更新 package.json 与 docs/RELEASE.md');

git('add', 'package.json', 'CHANGELOG.md', 'docs/RELEASE.md');
git('commit', '-m', 'chore(release): ' + ver);
git('tag', '-a', 'v' + ver, '-m', 'v' + ver);
info('已提交并打 tag v' + ver);

git('push', 'origin', 'main');
git('push', 'origin', 'v' + ver);
info('已推送 main 与 tag');

dispatchPublish(ver, true);
info('dry-run 通过');

const realRun = dispatchPublish(ver, false);
assertPublished(realRun, ver);

createRelease(ver, section);

console.log('\n[release] 完成：v' + ver);
console.log('[release] 别忘了（本脚本不做）：');
console.log('  - 升级本机 desktop profile 并重启桌面应用，改动才会在运行中生效');
console.log('  - 收工时把这一版追加到 Obsidian 开发日志');
