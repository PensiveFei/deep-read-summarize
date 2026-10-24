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

const { execFileSync, execSync } = require('node:child_process');
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
  const error = new Error(m);
  error.hint = hint;
  throw error;
}

/**
 * npm 必须走 shell（execSync），不能用 execFileSync。
 * Windows 上 npm 是 npm.cmd，而 Node 20.12+ 为了修 CVE-2024-27980，禁止不经 shell
 * 直接 spawn .cmd/.bat —— 会抛 `spawnSync npm.cmd EINVAL`。
 */

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
const lockPath = path.join(ROOT, 'package-lock.json');
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
  // stderr 必须 pipe（而不是 ignore）：否则失败时 err.stderr 是 null，
  // 报错只剩一句 `Command failed`，完全看不出 git 为什么退出 128。
  run('git', ['fetch', 'origin', 'main', '--quiet'], { stdio: ['ignore', 'pipe', 'pipe'] });
  if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) {
    die('本地 main 与 origin/main 不一致（先 push 或 pull）');
  }
}

function gates() {
  const steps = ['lint', 'test', 'test:node', 'security', 'validate'];
  for (const s of steps) {
    info('门禁：npm run ' + s);
    execSync('npm run ' + s, { cwd: ROOT, stdio: 'inherit' });
  }
}

function resolvePublishRef(publishRef, githubRef, githubRefType) {
  const ref = publishRef || githubRef;
  if (!publishRef && githubRefType !== 'tag') throw new Error('empty publish_ref requires a tag event');
  if (!/^refs\/tags\/v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(ref || '')) {
    throw new Error('publish_ref must be a complete refs/tags/vX.Y.Z reference');
  }
  return ref;
}

/** Render both files before any write: a malformed table must not leave a bumped package.json. */
function prepareReleaseFiles(currentPackage, text, ver, summary) {
  const oldVer = currentPackage.version;
  resolvePublishRef('refs/tags/v' + ver);
  if (!summary || /[\r\n]/.test(summary)) throw new Error('release summary must be one non-empty line');
  const current = '| **v' + oldVer + '** | **npm 已发布（当前）** |';
  const lines = text.split('\n');
  const matches = lines.map(function (line, index) { return line.indexOf(current) === 0 ? index : -1; }).filter(function (index) { return index >= 0; });
  if (matches.length !== 1) throw new Error('docs/RELEASE.md 里必须恰有一行 v' + oldVer + ' 的「当前」行，无法安全改写');
  if (new RegExp('\\bv' + ver.replace(/\./g, '\\.') + '(?![\\d.])').test(text)) throw new Error('docs/RELEASE.md 里已经出现 v' + ver);
  const idx = matches[0];
  lines[idx] = lines[idx].replace('| **v' + oldVer + '** | **npm 已发布（当前）** |', '| v' + oldVer + ' | npm 已发布 |');
  lines.splice(idx + 1, 0, '| **v' + ver + '** | **npm 已发布（当前）** | ' + summary.replace(/\|/g, '\\|') + ' |');
  return {
    packageJson: JSON.stringify(Object.assign({}, currentPackage, { version: ver }), null, 2) + '\n',
    releaseMd: lines.join('\n')
  };
}

/** Keep the locked root version aligned while leaving dependency resolutions untouched. */
function preparePackageLock(currentLock, currentPackage, ver) {
  if (!currentLock || currentLock.name !== currentPackage.name || currentLock.version !== currentPackage.version ||
      !currentLock.packages || !currentLock.packages[''] ||
      currentLock.packages[''].name !== currentPackage.name || currentLock.packages[''].version !== currentPackage.version) {
    throw new Error('package-lock.json root name/version must agree with package.json before release');
  }
  const prepared = JSON.parse(JSON.stringify(currentLock));
  prepared.version = ver;
  prepared.packages[''].version = ver;
  return JSON.stringify(prepared, null, 2) + '\n';
}

function runTitle(identity) {
  return 'publish ' + identity.publishRef + ' | sha=' + identity.publishSha +
    ' | mode=' + (identity.dryRun ? 'dry-run' : 'real') + ' | id=' + identity.correlationId;
}

function assertRunIdentity(candidate, identity, expectedId) {
  const checks = [
    [candidate && candidate.display_title === runTitle(identity), 'ref/SHA/mode/correlation'],
    [candidate && candidate.event === 'workflow_dispatch', 'event'],
    [candidate && candidate.head_branch === identity.workflowRef, 'workflow ref'],
    [candidate && candidate.head_sha === identity.workflowSha, 'workflow SHA'],
    [candidate && (candidate.path === '.github/workflows/publish.yml' || candidate.path === '.github/workflows/publish.yml@refs/heads/' + identity.workflowRef), 'workflow path'],
    [candidate && Number(candidate.run_attempt) === identity.attempt, 'run attempt'],
    [candidate && Number.isSafeInteger(Number(candidate.id)) && Number(candidate.id) > 0, 'run id']
  ];
  if (expectedId !== undefined) checks.push([candidate && Number(candidate.id) === Number(expectedId), 'requested run id']);
  if (candidate && candidate.repository) checks.push([typeof candidate.repository.full_name === 'string' && candidate.repository.full_name.toLowerCase() === identity.repo.toLowerCase(), 'repository']);
  const failed = checks.filter(function (check) { return !check[0]; }).map(function (check) { return check[1]; });
  if (failed.length) throw new Error('publish run identity mismatch: ' + failed.join(', '));
  return candidate;
}

function runIdFromOutput(output, expectedRepo) {
  const match = String(output).match(/https:\/\/github\.com\/([^\s/]+\/[^\s/]+)\/actions\/runs\/(\d+)(?=[/?#\s]|$)/);
  if (!match) return null;
  if (match[1].toLowerCase() !== expectedRepo.toLowerCase()) throw new Error('dispatch returned a run URL for another repository');
  return Number(match[2]);
}

function identityLogMarker(identity) {
  return 'publish-identity ref=' + identity.publishRef + ' sha=' + identity.publishSha +
    ' mode=' + (identity.dryRun ? 'dry-run' : 'real') + ' correlation=' + identity.correlationId + ' attempt=' + identity.attempt;
}

function assertModeLog(log, identity) {
  const marker = identityLogMarker(identity);
  if (!String(log).split(/\r?\n/).some(function (line) { return line.trimEnd().endsWith(marker); })) {
    throw new Error('publish log is missing the expected ref/SHA/mode/correlation/attempt marker');
  }
}

/** Own only the nonce-labelled dispatch, never the first run appearing after dispatch. */
function waitForPublishRun(identity, returnedId, hooks = {}) {
  const invoke = hooks.run || run;
  const pause = hooks.sleep || sleep;
  const announce = hooks.info || info;
  const getRun = function (id) {
    return JSON.parse(invoke('gh', ['api', 'repos/' + identity.repo + '/actions/runs/' + id]));
  };
  let id = returnedId;
  announce('等待本次 publish run：' + identity.correlationId);
  for (let i = 0; i < (hooks.appearanceAttempts || 60) && !id; i++) {
    const response = JSON.parse(invoke('gh', ['api', 'repos/' + identity.repo + '/actions/workflows/publish.yml/runs?event=workflow_dispatch&branch=' + identity.workflowRef + '&per_page=30']));
    const candidates = (response.workflow_runs || []).filter(function (candidate) { return candidate.display_title === runTitle(identity); });
    if (candidates.length > 1) throw new Error('multiple publish runs share the dispatch correlation; refusing to choose one');
    if (candidates.length === 1) {
      assertRunIdentity(candidates[0], identity);
      id = candidates[0].id;
    }
    if (!id) pause(5000);
  }
  if (!id) throw new Error('5 分钟内没有等到本次 correlation 对应的 publish run');
  announce('run id = ' + id + '，验证身份并等待完成…');
  for (let i = 0; i < (hooks.completionAttempts || 120); i++) {
    const candidate = assertRunIdentity(getRun(id), identity, id);
    if (candidate.status === 'completed') {
      if (candidate.conclusion !== 'success') throw new Error('publish run 结论是 ' + candidate.conclusion + '（run ' + id + '）');
      const log = invoke('gh', ['run', 'view', String(id), '--repo', identity.repo, '--log']);
      assertModeLog(log, identity);
      return { id: Number(id), identity: identity };
    }
    pause(10000);
  }
  throw new Error('20 分钟内 run 没有结束');
}

function dispatchPublish(ver, dryRun, hooks = {}) {
  const invoke = hooks.run || run;
  const identity = {
    repo: hooks.repo || repo,
    publishRef: resolvePublishRef('refs/tags/v' + ver),
    publishSha: invoke('git', ['rev-parse', '--verify', 'refs/tags/v' + ver + '^{commit}']),
    workflowRef: 'main', workflowSha: invoke('git', ['rev-parse', '--verify', 'HEAD^{commit}']),
    correlationId: hooks.correlationId || crypto.randomBytes(16).toString('hex'),
    dryRun: !!dryRun, attempt: 1
  };
  if (!/^[0-9a-f]{40}$/.test(identity.publishSha) || !/^[0-9a-f]{40}$/.test(identity.workflowSha)) throw new Error('invalid release commit SHA');
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(identity.correlationId)) throw new Error('invalid dispatch correlation');
  (hooks.info || info)('dispatch 发布（' + (dryRun ? 'dry-run' : '真发') + '），correlation=' + identity.correlationId);
  const output = invoke('gh', ['workflow', 'run', 'publish.yml', '--repo', identity.repo, '--ref', identity.workflowRef,
    '-f', 'dry_run=' + (dryRun ? 'true' : 'false'),
    '-f', 'publish_ref=' + identity.publishRef,
    '-f', 'publish_sha=' + identity.publishSha,
    '-f', 'correlation_id=' + identity.correlationId]);
  return waitForPublishRun(identity, runIdFromOutput(output, identity.repo), hooks);
}

/** 判据只认日志里的 `+ 包名@版本`（registry 可见有两分钟延迟，npm view 当场查必然 404）。 */
function assertPublished(dispatched, ver, hooks = {}) {
  if (!dispatched || dispatched.identity.dryRun) throw new Error('dry-run cannot be used as publication evidence');
  const identity = dispatched.identity;
  if (identity.publishRef !== resolvePublishRef('refs/tags/v' + ver)) throw new Error('publication evidence is for another tag');
  const invoke = hooks.run || run;
  const candidate = JSON.parse(invoke('gh', ['api', 'repos/' + identity.repo + '/actions/runs/' + dispatched.id]));
  assertRunIdentity(candidate, identity, dispatched.id);
  if (candidate.status !== 'completed' || candidate.conclusion !== 'success') throw new Error('publication run did not complete successfully');
  const log = invoke('gh', ['run', 'view', String(dispatched.id), '--repo', identity.repo, '--log']);
  assertModeLog(log, identity);
  const escaped = (NAME + '@' + ver).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp('(?:^|\\s)\\+ ' + escaped + '(?:\\s|$)').test(log)) {
    die('日志里没有出现 `+ ' + NAME + '@' + ver + '`，不能算发布成功（看 run ' + dispatched.id + ' 的完整日志）');
  }
  info('日志判据通过：+ ' + NAME + '@' + ver);
}

/**
 * 从 registry 取回刚发布的字节。
 * 必须重试：npm 写完后 registry 要 1–2 分钟才对外可见，当场 `npm pack` 必然 E404
 * （本项目的既有教训：0.3.9 那次 ~120s、0.3.10 那次 ~140s 才可见）。
 */
function packPublished(ver, tmp) {
  let last = null;
  for (let i = 0; i < 12; i++) {
    try {
      execSync('npm pack ' + NAME + '@' + ver + ' --pack-destination "' + tmp + '"',
        { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' });
      const tgz = fs.readdirSync(tmp).filter(function (f) { return f.endsWith('.tgz'); })[0];
      if (tgz) return tgz;
    } catch (e) {
      last = e;
    }
    info('registry 尚不可见（第 ' + (i + 1) + '/12 次），20 秒后重试…');
    sleep(20000);
  }
  die('等了约 4 分钟仍取不到 ' + NAME + '@' + ver, last ? firstLine(last) : '');
}

function createRelease(ver, section) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drs-release-'));
  const tgz = packPublished(ver, tmp);
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

/** 把底层工具的错误归一下类：断网 / 权限 / 其它，好给出人话而不是堆栈。 */
function classify(err) {
  const blob = String((err && (err.stderr || err.stdout)) || '') + ' ' + String((err && err.message) || '');
  if (/ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|unable to access|Could not resolve|timed out|network/i.test(blob)) return 'network';
  if (/auth|credential|Permission denied|403|404 Not Found/i.test(blob)) return 'auth';
  return 'other';
}

function firstLine(err) {
  const blob = String((err && (err.stderr || err.stdout)) || (err && err.message) || '');
  return blob.split('\n').map(function (s) { return s.trim(); }).filter(Boolean)[0] || String(err);
}

// ---------------------------------------------------------------- 主流程
function main() {
  if (has('--help') || has('-h')) { usage(); return; }

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
  if (git('tag', '-l', 'v' + ver)) die('本地已有 tag v' + ver);
  if (run('git', ['ls-remote', '--tags', 'origin', 'v' + ver])) die('远端已有 tag v' + ver);
  info('版本一致性   : CHANGELOG / RELEASE.md / tag 均无冲突');

  const summary = deriveSummary(section);
  if (!summary) die('无法从 CHANGELOG 小节里提取一行说明，请手动补一段');
  const preparedFiles = prepareReleaseFiles(pkg, releaseMd, ver, summary);
  const preparedLock = preparePackageLock(JSON.parse(fs.readFileSync(lockPath, 'utf8')), pkg, ver);
  info('RELEASE.md 行 : ' + summary);

  console.log('\n=== 计划 ===');
  console.log('  1. 跑门禁：lint / test / test:node / security / validate');
  console.log('  2. package.json / package-lock.json: ' + oldVer + ' -> ' + ver);
  console.log('  3. docs/RELEASE.md: 标记 v' + oldVer + ' 已发布，插入 v' + ver + ' 行');
  console.log('  4. commit "chore(release): ' + ver + '"');
  console.log('  5. tag -a v' + ver + '，先推 commit 再推 tag');
  console.log('  6. dispatch publish（先 dry-run，再真发）并校验日志判据');
  console.log('  7. 用 npm 同字节建 GitHub Release v' + ver + '（Latest）');
  console.log('');

  if (!has('--yes')) {
    info('未加 --yes，只打印计划，什么都没改。');
    return;
  }

  try {
    gates();
    fs.writeFileSync(pkgPath, preparedFiles.packageJson, 'utf8');
    fs.writeFileSync(lockPath, preparedLock, 'utf8');
    fs.writeFileSync(path.join(ROOT, 'docs', 'RELEASE.md'), preparedFiles.releaseMd, 'utf8');
    info('已更新 package.json、package-lock.json 与 docs/RELEASE.md');

    git('add', 'package.json', 'package-lock.json', 'CHANGELOG.md', 'docs/RELEASE.md');
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
  } catch (e) {
    const kind = classify(e);
    if (kind === 'network') {
      die('网络不可用：' + firstLine(e),
        '恢复网络后先确认停在哪一步（git status / git log --oneline -1 / gh run list），再重跑本脚本。' +
        '已提交的 commit 与已推的 tag 不会重复创建，脚本会因为这些断言而停下并告诉你。');
    }
    if (kind === 'auth') {
      die('权限/凭据问题：' + firstLine(e), '先跑 gh auth status 确认登录状态。');
    }
    die('执行失败：' + firstLine(e));
  }

  console.log('\n[release] 完成：v' + ver);
  console.log('[release] 别忘了（本脚本不做）：');
  console.log('  - 升级本机 desktop profile 并重启桌面应用，改动才会在运行中生效');
  console.log('  - 收工时把这一版追加到 Obsidian 开发日志');
}

module.exports = {
  main, resolvePublishRef, prepareReleaseFiles, preparePackageLock, runTitle, assertRunIdentity,
  runIdFromOutput, identityLogMarker, assertModeLog, waitForPublishRun,
  dispatchPublish, assertPublished
};

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error('\n[release] 中止：' + error.message);
    if (error.hint) console.error('[release] ' + error.hint);
    process.exitCode = 1;
  }
}
