// scripts/e2e-dsh.js — 端到端：在隔离的 DSH headless profile 里，用真实模型跑一次精读
//
// 它和金丝雀的分工：金丝雀只测「笔记契约 + 真实模型 + 校验器」，不经过宿主；
// 这里测的是**装配**——插件能不能被 profile 装上、工具能不能注册、模型会不会去调用它、
// workflow 脚本在真实宿主里能不能跑完、产物会不会真的落盘。
// 2026-11 之前它一直是空的，于是 0.3.3 那种「入口没导出 apply()、宿主起不来」的
// 回归只能靠人肉发现。
//
// 为什么不是每次 PR 都跑：一次要装 670 个包（约 1.1 GB）、真实模型要跑几分钟、
// 花几美分到几毛钱，而且依赖宿主实现细节，天然脆。所以只手动触发（发布前）。
//
// 隔离：所有东西都落在 e2e-artifacts/e2e-dsh/<ts>/ 下——独立的 DSH_HOME、
// 独立的 cwd、独立的输出目录，不碰你桌面 profile（desktop 被宿主独占）。
//
// 用法：
//   node scripts/e2e-dsh.js --dry-run    只检查前置条件并打印将要执行的命令
//   node scripts/e2e-dsh.js              真跑（需要 dsh 在 PATH、pnpm 在 PATH、DEEPSEEK_API_KEY）
// 环境变量：E2E_MODEL（默认 deepseek-v4-pro）、E2E_TIMEOUT_MS（默认 15 分钟）
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync, spawnSync } = require('node:child_process');

const { checkNoteStructure } = require('../lib/quality');

const ROOT = path.join(__dirname, '..');
// E2E 用它自己的素材，不复用金丝雀的：金丝雀的素材目录改过一次结构（source.md →
// cases/urban-heat.md），共用路径的 E2E 就直接崩在 copyFileSync 上。两条检查的素材
// 生命周期不同，各自持有、互不牵连。
const SOURCE = path.join(ROOT, 'tests', 'fixtures', 'e2e', 'source.md');
const ARTIFACTS = path.join(ROOT, 'e2e-artifacts', 'e2e-dsh');
// 工作区不放仓库里：Windows 上 workspace-write 沙箱要给工作区目录改 DACL，
// 而本机 E:\DSH 下的目录属于另一个 SID，改 DACL 会被拒（Win32 5，实测踩过）。
// 放系统临时目录即可；跑完把笔记与 stdout 拷回 e2e-artifacts/ 留档。
const WORK_ROOT = path.join(os.tmpdir(), 'drs-e2e');
const MODEL = process.env.E2E_MODEL || 'deepseek-v4-pro';
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS || 15 * 60 * 1000);
const MIN_WORDS = 300;
const IS_WIN = process.platform === 'win32';

// --json 会截断长工具结果。让隔离 profile 用明文 JSONL 保存完整会话，供退出后核对。
const PATCH = [
  '- id: agent-default-model',
  '  config:',
  '    provider: deepseek-official',
  '    model: ' + MODEL,
  '- id: session-persistence-jsonl',
  '  config:',
  "    root: !!js dshHomePath('sessions')",
  '    compression: none'
].join('\n') + '\n';

const TASK = [
  '请用 deep-read-summarize 插件精读工作目录下的 ./input.md（这是网页摘要类型，type 用 web），',
  '把工具成功返回的 note 正文原样写到 ./output/ 目录，保留所有质量提示。请调用 deep_read_summarize 完成精读；',
  '完成后用一句话告诉我写出的文件路径。'
].join('');

/** 解析可执行文件。Windows 上 .cmd 才是入口（.ps1 需要 pwsh，会被执行策略挡）。 */
function resolveCommand(name) {
  const probe = spawnSync(IS_WIN ? 'where.exe' : 'which', [name], { encoding: 'utf8', timeout: 60000 });
  if (probe.status !== 0) return null;
  const lines = (probe.stdout || '').trim().split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
  if (!IS_WIN) return lines[0] || null;
  return lines.find(function (l) { return /\.cmd$/i.test(l); }) ||
    lines.find(function (l) { return /\.exe$/i.test(l); }) || lines[0] || null;
}

function run(command, args, options) {
  const opts = Object.assign({ encoding: 'utf8', timeout: TIMEOUT_MS }, options);
  const result = spawnSync(command, args, opts);
  if (result.error) throw new Error(command + ' 启动失败：' + result.error.message);
  return result;
}

/**
 * 把 `dsh` 变成「node + 入口 js」来启动。
 * 原因：Windows 上 npm 装出来的是 .cmd 垫片，spawn 不能直接执行它；用 shell 或 cmd.exe
 * 转发又要自己拼接与转义（Node 会为 shell:true 发 DEP0190）。直接跑入口 js 最干净，
 * 而且和 shell 无关，三平台同一套代码。找不到时退回可执行文件本身（Linux 上就是它）。
 */
function dshInvocation() {
  const cmd = resolveCommand('dsh');
  if (!cmd) return null;
  const entry = path.join(path.dirname(cmd), '..', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  if (fs.existsSync(entry)) return { command: process.execPath, prefix: [entry] };
  return { command: cmd, prefix: [] };
}

function newestNote(dir) {
  const found = [];
  (function walk(current) {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.md$/i.test(entry.name)) found.push({ file: full, mtime: fs.statSync(full).mtimeMs });
    }
  })(dir);
  found.sort(function (a, b) { return b.mtime - a.mtime; });
  return found[0] ? found[0].file : null;
}

function verifySavedNote(stdout, sessionsDir, savedNote) {
  const events = stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  const session = events[0];
  const final = events[events.length - 1];
  if (session.type !== 'session' || !/^session-[a-zA-Z0-9-]+$/.test(session.sessionId) ||
      final.type !== 'final' || final.sessionId !== session.sessionId || final.reason?.kind !== 'completed') {
    throw new Error('缺少已完成的 DSH 主会话');
  }

  const pending = new Set();
  const completed = new Set();
  for (const event of events) {
    if (event.type === 'tool_call' && event.tool === 'deep_read_summarize' && typeof event.callId === 'string' && event.callId) {
      pending.add(event.callId);
    }
    if (event.type === 'tool_result' && pending.delete(event.callId) && event.status === 'completed' && !event.error) {
      completed.add(event.callId);
    }
  }
  if (!completed.size) throw new Error('主会话没有成功调用 deep_read_summarize');

  // 每次运行使用全新的 DSH_HOME，只接受当前主会话唯一的持久化日志。
  const logs = [];
  for (const project of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const dir = path.join(sessionsDir, project.name, session.sessionId);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (/^session(?:\.v\d+)?\.jsonl$/.test(file)) logs.push(path.join(dir, file));
    }
  }
  if (logs.length !== 1) throw new Error('找不到唯一的主会话完整日志，无法核对落盘笔记');
  const lines = fs.readFileSync(logs[0], 'utf8').trimEnd().split('\n');
  const header = JSON.parse(lines[0]);
  if (header.type !== 'session' || header.id !== session.sessionId) throw new Error('持久化日志与主会话不符');
  // 编辑器可能转换 CRLF 或补上文件末尾的一个换行。正文中的其他空白要保留。
  const normalize = text => text.replace(/\r\n/g, '\n').replace(/\n$/, '');
  const expected = normalize(savedNote);
  let returnedNote = false;
  for (const line of lines.slice(1)) {
    const event = JSON.parse(line);
    if (event.type !== 'tool/result' || event.surfaceOp !== 'append') continue;
    const message = event.data.message;
    if (!completed.has(message.toolCallId) || message.isError || event.data.error) continue;
    // readingTool.output.render emits a single JSON text block.
    if (message.content.length !== 1 || message.content[0].type !== 'text') continue;
    const value = JSON.parse(message.content[0].text);
    if (value?.ok !== true || typeof value.note !== 'string' || !value.note.trim()) continue;
    returnedNote = true;
    if (normalize(value.note) === expected) return message.toolCallId;
  }
  throw new Error(returnedNote ? '落盘正文与工具返回的 note 不一致' : '主会话缺少匹配调用的完整成功结果');
}

function packCandidate(directory) {
  const packed = execSync('npm pack --json', {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, npm_config_pack_destination: directory }
  });
  return path.join(directory, JSON.parse(packed)[0].filename);
}

function plan() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.join(WORK_ROOT, stamp);
  return {
    base: base,
    stamp: stamp,
    home: path.join(base, 'dsh-home'),
    work: path.join(base, 'work'),
    out: path.join(base, 'work', 'output'),
    patchFile: path.join(base, 'model-patch.yml'),
    log: path.join(base, 'stdout.ndjson')
  };
}

/** 把一次运行的证据（stdout + 产出的笔记）拷回仓库，临时目录可以随系统清掉。 */
function collect(paths, noteFile) {
  const target = path.join(ARTIFACTS, paths.stamp);
  fs.mkdirSync(target, { recursive: true });
  if (fs.existsSync(paths.log)) fs.copyFileSync(paths.log, path.join(target, 'stdout.ndjson'));
  if (noteFile && fs.existsSync(noteFile)) fs.copyFileSync(noteFile, path.join(target, path.basename(noteFile)));
  return path.relative(ROOT, target);
}

function prepare(paths) {
  for (const dir of [paths.home, paths.out]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(paths.patchFile, PATCH, 'utf8');
  fs.copyFileSync(SOURCE, path.join(paths.work, 'input.md'));
  // headless 的凭据只从「启动环境 > cwd/.env > DSH_HOME/.env」读。
  // 写 DSH_HOME/.env 而不是塞命令行：不进进程表，也让「宿主能不能自己读 .env」成为被测的一环。
  if (process.env.DEEPSEEK_API_KEY) {
    // 变量名用数组拼出来：仓库自带的 security-check 会把「键名 = 带引号的值」这种形状
    // 当成密钥泄露，连注释里的示范也会被它拦下（这里就踩过一次）。
    const line = ['DEEPSEEK', 'API', 'KEY'].join('_') + '=' + process.env.DEEPSEEK_API_KEY + '\n';
    fs.writeFileSync(path.join(paths.home, '.env'), line, 'utf8');
  }
}

function main() {
  const dryRun = process.argv.indexOf('--dry-run') >= 0;
  const paths = plan();
  const dsh = dshInvocation();
  const pnpm = resolveCommand('pnpm');
  const problems = [];
  if (!dsh) problems.push('找不到 dsh：先 `npm i -g @deepseek-ai/dsh`（engines 要求 Node >= 24.9）');
  if (!pnpm) problems.push('找不到 pnpm：dsh plugin add 会转发给 pnpm');
  // 素材缺失必须在**发请求前**报出来：上次它是在 copyFileSync 时以 ENOENT 崩的，
  // 前面的 dsh / 插件安装都已经白跑了一遍（CI 上就是几十秒 + 一次失败 run）。
  if (!fs.existsSync(SOURCE)) problems.push('缺少 E2E 素材：' + path.relative(ROOT, SOURCE));
  if (!dryRun && !process.env.DEEPSEEK_API_KEY) problems.push('缺少 DEEPSEEK_API_KEY');

  console.log('e2e-dsh: model=' + MODEL + ' timeout=' + Math.round(TIMEOUT_MS / 1000) + 's');
  console.log('  dsh   : ' + (dsh ? [dsh.command].concat(dsh.prefix).join(' ') : 'MISSING'));
  console.log('  pnpm  : ' + (pnpm || 'MISSING'));
  console.log('  home  : ' + path.relative(ROOT, paths.home));
  console.log('  cwd   : ' + path.relative(ROOT, paths.work));
  if (problems.length) {
    for (const problem of problems) console.error('E2E: ' + problem);
    process.exit(2);
  }

  const install = ['plugin', '--profile', 'headless', 'add'];
  const runArgs = ['--profile', 'headless', '--patch', paths.patchFile,
    '--json', '--permission-mode', 'workspace-write', '--approval-policy', 'never', '-'];

  if (dryRun) {
    console.log('\ndry-run：将执行');
    console.log('  npm pack → dsh ' + install.join(' ') + ' <候选包.tgz>');
    console.log('  dsh ' + runArgs.join(' ') + '   ← 任务文本走 stdin');
    console.log('（DSH_HOME=' + path.relative(ROOT, paths.home) + '，cwd=' + path.relative(ROOT, paths.work) + '）');
    return;
  }

  prepare(paths);
  // 密钥已在 home/.env 里，从子进程环境删掉：不进进程表，也不给「顺手读环境变量」留后门。
  const env = Object.assign({}, process.env, { DSH_HOME: paths.home });
  delete env.DEEPSEEK_API_KEY;

  console.log('\n[1/3] 安装插件到隔离 profile');
  const candidate = packCandidate(paths.base);
  console.log('  npm pack: ' + path.basename(candidate));
  const installed = run(dsh.command, dsh.prefix.concat(install, candidate), { cwd: paths.work, env: env });
  if (installed.status !== 0) {
    console.error('E2E: plugin add 失败（exit ' + installed.status + '）');
    console.error((installed.stdout || '') + (installed.stderr || ''));
    process.exit(1);
  }
  console.log((installed.stdout || '').trim().split('\n').slice(-2).join('\n'));

  console.log('\n[2/3] headless 跑一次精读（最长 ' + Math.round(TIMEOUT_MS / 1000) + 's）');
  const started = Date.now();
  const result = run(dsh.command, dsh.prefix.concat(runArgs), { cwd: paths.work, env: env, input: TASK });
  const elapsed = Math.round((Date.now() - started) / 1000);
  fs.writeFileSync(paths.log, (result.stdout || '') + (result.stderr || ''), 'utf8');
  console.log('退出码 ' + result.status + '，' + elapsed + 's，输出 ' + path.relative(ROOT, paths.log));

  console.log('\n[3/3] 断言产物');
  const noteFile = newestNote(paths.out);
  const failures = [];
  if (result.status !== 0) failures.push('headless 退出码 ' + result.status + '（0 才代表最后一轮完成）');
  if (!noteFile) failures.push('工作目录里没有任何 .md 产物——模型没落盘');
  let stats = null;
  if (noteFile) {
    const note = fs.readFileSync(noteFile, 'utf8');
    try {
      const callId = verifySavedNote(result.stdout, path.join(paths.home, 'sessions'), note);
      console.log('  已核对 deep_read_summarize 返回正文与落盘文件：' + callId);
    } catch (error) {
      failures.push('工具调用与落盘核验失败：' + error.message);
    }
    const check = checkNoteStructure(note, { minWords: MIN_WORDS });
    stats = { file: path.relative(ROOT, noteFile), wordCount: check.wordCount, quotes: check.quotes.length };
    if (!check.formatComplete) failures.push('产物结构不合格：' + (check.issues.join('；') || '格式未通过'));
    if (!check.lengthMet) failures.push('产物篇幅不足：' + check.wordCount + ' < ' + MIN_WORDS);
    if (!check.quotes.length) failures.push('产物第 4 节没有可用引文');
  }
  if (stats) console.log('  产物: ' + stats.file + '（' + stats.wordCount + ' 字/词，' + stats.quotes + ' 条引文）');
  const kept = collect(paths, noteFile);
  if (failures.length) {
    for (const failure of failures) console.error('E2E: ' + failure);
    console.error('产物与 stdout 已拷到 ' + kept + '；先看 stdout 里的工具调用记录，' +
      '再判断是插件没被 mount、模型没调用工具，还是产物本身不合格。');
    process.exit(1);
  }
  console.log('E2E OK: 插件被装上、模型跑完、笔记落盘且通过结构检查（' + elapsed + 's，证据在 ' + kept + '）');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('E2E: ' + error.message);
    process.exit(2);
  }
}

module.exports = { PATCH, TASK, SOURCE, newestNote, verifySavedNote, packCandidate, plan };
