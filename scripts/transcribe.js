#!/usr/bin/env node
// ============================================================================
// transcribe.js — faster-whisper 转写自举脚本（插件内部，跨平台：Windows/macOS/Linux）
// ============================================================================
// 用法（三平台完全一致，不需要 pwsh / bash 之别）：
//   node transcribe.js --audio <音频文件> --out <输出txt> [--model small] [--language zh] [--device cpu|auto|cuda]
//   node transcribe.js --self-check        # 只打印解析出的路径，不安装、不下载、不联网
//
// 为什么是 Node 而不是 PowerShell / shell：
//   - Node 是 DSH 与本插件自身的硬依赖，三平台天然可用，不必维护 ps1 + sh 两份实现；
//   - 「本机与用户使用一致」只需要守在一处（0.3.8 修过的正是「两份真相漂移」）。
// 平台差异只集中在四个纯函数里：cacheRoot / venvPython / uvInstallHint / findUv，
// 它们都接受注入的 platform/env/home，可以在任意 OS 上跑全平台矩阵单测。
// 本文件不会被内联进 workflow 沙箱脚本（沙箱没有 process/require），只在宿主 shell 里执行。
// ============================================================================

'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 版本锁定：保证作者机器与用户机器跑的是同一套（见 README「转写工具链」）。
const PY_VERSION = '3.12';
const PYPI_MIRROR = 'https://pypi.tuna.tsinghua.edu.cn/simple';
// uv 拉 CPython 走的是 GitHub（python-build-standalone），在部分网络下极慢 → 默认走镜像加速。
// ⚠️ 镜像会失效，而且代价很大：旧的 ghproxy.com 现在 301 到 ghfast.top 并丢掉路径，返回的是
//    HTML 而不是资产；uv 拿到 HTML 会报 "Invalid gzip header"，**不会**自己回退 GitHub ——
//    于是「慢但能装」变成「彻底装不上」，而踩到的恰好是没有 3.12 的新用户。
//    所以镜像只当加速用：失败后自动改用直连再试一次（见 venvEnvAttempts）。
// 覆盖方式：环境变量 DRS_UV_PYTHON_MIRROR（设为空字符串 = 完全不使用镜像）。
const UV_PYTHON_INSTALL_MIRROR_DEFAULT =
  'https://ghfast.top/https://github.com/astral-sh/python-build-standalone/releases/download';
const HF_ENDPOINT = 'https://hf-mirror.com';
const UV_INSTALL_SH = 'curl -LsSf https://astral.sh/uv/install.sh | sh';
const CACHE_DIR_NAME = 'deep-read-summarize';

// ---------------------------------------------------------------------------
// 纯函数区：平台差异全部收在这里
// ---------------------------------------------------------------------------

/** 目标平台用哪套路径分隔符（不依赖宿主 OS，测试可在 Windows 上断言 POSIX 结果）。 */
function pathImpl(platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

/** 归一化注入上下文：默认取真实运行环境，测试可注入任意平台。 */
function context(overrides) {
  const o = overrides || {};
  return {
    platform: o.platform || process.platform,
    env: o.env || process.env,
    home: o.home || os.homedir(),
    isFile: o.isFile || isFileAt
  };
}

/**
 * 转写缓存根目录（venv + HF 模型都放这里，跨次复用）。
 * - Windows：%LOCALAPPDATA%\\deep-read-summarize（**与 0.3.6-0.3.8 的 transcribe.ps1 完全一致，
 *   老用户已下载的模型不会重下**）
 * - macOS：~/Library/Caches/deep-read-summarize
 * - Linux：$XDG_CACHE_HOME/deep-read-summarize（回退 ~/.cache）
 */
function cacheRoot(overrides) {
  const c = context(overrides);
  const p = pathImpl(c.platform);
  if (c.platform === 'win32') {
    const base = c.env.LOCALAPPDATA || p.join(c.home, 'AppData', 'Local');
    return p.join(base, CACHE_DIR_NAME);
  }
  if (c.platform === 'darwin') return p.join(c.home, 'Library', 'Caches', CACHE_DIR_NAME);
  return p.join(c.env.XDG_CACHE_HOME || p.join(c.home, '.cache'), CACHE_DIR_NAME);
}

/** venv 里 python 解释器的位置：Windows 在 Scripts/，POSIX 在 bin/。 */
function venvPython(venvDir, overrides) {
  const c = context(overrides);
  const p = pathImpl(c.platform);
  return c.platform === 'win32'
    ? p.join(venvDir, 'Scripts', 'python.exe')
    : p.join(venvDir, 'bin', 'python');
}

/** 找不到 uv 时给用户的安装命令（按平台）。 */
function uvInstallHint(overrides) {
  const c = context(overrides);
  if (c.platform === 'win32') return 'winget install astral-sh.uv';
  if (c.platform === 'darwin') return 'brew install uv（或 ' + UV_INSTALL_SH + '）';
  return UV_INSTALL_SH;
}

/** uv 候选路径（先 PATH，再各平台常见的用户级/包管理器安装位置）。 */
function uvCandidates(overrides) {
  const c = context(overrides);
  const p = pathImpl(c.platform);
  const exe = c.platform === 'win32' ? 'uv.exe' : 'uv';
  const sep = c.platform === 'win32' ? ';' : ':';
  const dirs = String(c.env.PATH || '').split(sep).filter(Boolean).map(function (d) {
    // Windows PATH 里可能带引号；剥掉再拼。
    return String(d).replace(/^"|"$/g, '');
  });
  const list = dirs.map(function (d) { return p.join(d, exe); });
  if (c.platform === 'win32') {
    list.push(p.join(c.home, '.local', 'bin', 'uv.exe'));
    list.push(p.join(c.home, '.cargo', 'bin', 'uv.exe'));
  } else {
    list.push(p.join(c.home, '.local', 'bin', 'uv'));
    list.push('/opt/homebrew/bin/uv');   // macOS arm64 Homebrew
    list.push('/usr/local/bin/uv');      // macOS Intel Homebrew / 通用
    list.push(p.join(c.home, '.cargo', 'bin', 'uv'));
  }
  return list;
}

/** 找到可用的 uv，找不到返回 null。 */
function findUv(overrides) {
  const c = context(overrides);
  const candidates = uvCandidates(c);
  for (let i = 0; i < candidates.length; i++) {
    if (c.isFile(candidates[i])) return candidates[i];
  }
  return null;
}

/** 当前生效的 uv CPython 镜像；返回空串表示不用镜像（直连 GitHub）。 */
function resolveUvMirror(env) {
  const e = env || process.env;
  const v = e.DRS_UV_PYTHON_MIRROR;
  if (v === undefined) return UV_PYTHON_INSTALL_MIRROR_DEFAULT;
  return String(v).trim();
}

/**
 * 创建 venv 时要依次尝试的环境变量：先镜像（若配置了），失败再直连 GitHub。
 * 返回 [{env, label}]，调用方按顺序尝试。
 */
function venvEnvAttempts(baseEnv, mirror) {
  const list = [];
  if (mirror) {
    const withMirror = Object.assign({}, baseEnv);
    withMirror.UV_PYTHON_INSTALL_MIRROR = mirror;
    list.push({ env: withMirror, label: '镜像 ' + mirror });
  }
  const direct = Object.assign({}, baseEnv);
  delete direct.UV_PYTHON_INSTALL_MIRROR;
  list.push({ env: direct, label: '直连 GitHub' });
  return list;
}

/**
 * 判定转写产物是否可用。
 * 0 字节 = VAD 把整段音频滤掉了（纯静音 / 纯 BGM）或解码失败。此时**不能算成功**：
 * 调用方按「输出文件非空且稳定」判断完成，而提示词里还有一条「日志出现 DONE」——
 * 两者叠加会让空逐字稿被当成转写成功，再拿去做精读。所以删掉空文件并以非 0 退出（code 3）。
 */
function judgeTranscript(bytes) {
  if (bytes > 0) return { ok: true, code: 0, message: '' };
  return {
    ok: false,
    code: 3,
    message: '转写结果为空（0 字节）：音频可能是纯静音 / 纯音乐，或解码失败。已删除空输出文件，请按降级处理（让用户提供文案，或用 options.transcribe=false）。'
  };
}

/** 路径是否为普通文件；目录一律拒绝（否则会把整个目录交给解码器，报出难懂的错误）。 */
function isFileAt(p) {
  try { return fs.statSync(p).isFile(); } catch (e) { return false; }
}

/** 解析命令行（支持 --k v、--k=v、-k v 三种写法）。 */
function parseArgs(argv) {
  const out = { audio: '', out: '', model: 'small', language: 'zh', device: 'cpu', selfCheck: false, help: false, unknown: [] };
  const takes = {
    '--audio': 'audio', '-a': 'audio',
    '--out': 'out', '-o': 'out',
    '--model': 'model', '-m': 'model',
    '--language': 'language', '-l': 'language', '--lang': 'language',
    '--device': 'device', '-d': 'device'
  };
  const list = argv || [];
  for (let i = 0; i < list.length; i++) {
    const a = String(list[i]);
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    if (a === '--self-check') { out.selfCheck = true; continue; }
    if (takes[a]) {
      const v = list[i + 1];
      if (v === undefined || String(v).indexOf('-') === 0) { out.unknown.push(a); continue; }
      out[takes[a]] = String(v);
      i++;
      continue;
    }
    const eq = a.indexOf('=');
    if (eq > 1 && takes[a.slice(0, eq)]) { out[takes[a.slice(0, eq)]] = a.slice(eq + 1); continue; }
    out.unknown.push(a);
  }
  return out;
}

/** 运行时 Python 片段：分段文本以空格连接成一行落盘；device 默认 cpu，非 cpu 失败自动回退。 */
const PY_RUNNER = [
  "import os",
  "import sys",
  "from faster_whisper import WhisperModel",
  "",
  "def load(device):",
  "    return WhisperModel(os.environ['DRS_MODEL'], device=device, compute_type='int8')",
  "",
  "def run(device):",
  "    model = load(device)",
  "    segs, info = model.transcribe(os.environ['DRS_AUDIO'], vad_filter=True, language=(os.environ.get('DRS_LANG') or None))",
  "    return [s.text.strip() for s in segs], info",
  "",
  "# device 默认 cpu：ctranslate2 只要探测到 NVIDIA 显卡就会在 auto 下选 CUDA，",
  "# 而多数机器没装 cuBLAS/cuDNN（cublas64_12.dll），会在推理时硬失败（实测 RTX 3050 复现）。",
  "device = os.environ.get('DRS_DEVICE') or 'cpu'",
  "try:",
  "    segments, info = run(device)",
  "except Exception as exc:",
  "    if device == 'cpu':",
  "        raise",
  "    print('[transcribe] device=%s failed (%s); retrying on cpu' % (device, exc), file=sys.stderr)",
  "    segments, info = run('cpu')",
  "",
  "# 先把全部分段收集完再落盘：中途失败时不会留下半截 transcript.txt",
  "# （调用方按「文件非空且稳定」判断完成，半截文件会被误判成成功）。",
  "with open(os.environ['DRS_OUT'], 'w', encoding='utf-8') as f:",
  "    f.write(' '.join([x for x in segments if x]))",
  "print('DONE', info.language, round(info.duration, 1))",
  ""
].join("\n");

// ---------------------------------------------------------------------------
// 执行区
// ---------------------------------------------------------------------------

const USAGE = [
  '用法：node transcribe.js --audio <音频文件> --out <输出txt> [--model small] [--language zh] [--device cpu|auto|cuda]',
  '      node transcribe.js --self-check   # 只打印解析出的路径，不安装不下载',
  '',
  '选项：--audio/-a  --out/-o  --model/-m（默认 small）  --language/-l（默认 zh）',
  '      --device（默认 cpu；auto/cuda 需自备 CUDA 运行库，失败会自动回退 cpu）'
].join('\n');

function fail(msg, code) {
  process.stderr.write('[transcribe] ERROR: ' + msg + '\n');
  return code === undefined ? 1 : code;
}

function runStep(cmd, cmdArgs, env, errLabel) {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', env: env, shell: false });
  if (r.error) throw new Error(errLabel + ' 无法执行（' + cmd + '）：' + r.error.message);
  if (r.status !== 0) throw new Error(errLabel + ' 失败（退出码 ' + r.status + '）');
}

function main(argv) {
  const args = parseArgs(argv);
  const c = context({});
  const root = cacheRoot(c);
  const venvDir = path.join(root, 'venv');
  const py = venvPython(venvDir, c);
  const uv = findUv(c);

  if (args.help) { process.stdout.write(USAGE + '\n'); return 0; }

  // --self-check：CI 与排查用，只报告解析结果，不产生任何副作用。
  if (args.selfCheck) {
    process.stdout.write(JSON.stringify({
      platform: c.platform,
      cacheRoot: root,
      venvDir: venvDir,
      venvPython: py,
      uv: uv,
      uvInstallHint: uvInstallHint(c),
      pythonVersion: PY_VERSION,
      node: process.version
    }, null, 2) + '\n');
    return 0;
  }

  if (args.unknown.length) process.stderr.write('[transcribe] 忽略未知参数：' + args.unknown.join(', ') + '\n');
  if (!args.audio || !args.out) {
    process.stderr.write(USAGE + '\n');
    return fail('--audio 与 --out 都是必填的。');
  }
  if (!fs.existsSync(args.audio)) return fail('音频文件不存在：' + args.audio);
  if (!isFileAt(args.audio)) return fail('--audio 不是文件（是不是给了目录？）：' + args.audio);
  if (uv === null) {
    return fail('没有找到 uv。请先安装：' + uvInstallHint(c) + '（装好后重跑本脚本；或改用 options.transcribe=false / 手动提供转写文本降级）');
  }

  try {
    fs.mkdirSync(root, { recursive: true });
    // 输出目录可能在别处（如 ./.tmp），提前建好，免得 python 侧报一句难懂的错
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });

    const childEnv = Object.assign({}, process.env);

    // 1) venv：优先复用已装好的 3.12，没有才让 uv 装。
    //    镜像只用于加速；失败就换直连重试 —— 镜像挂掉不该让用户彻底装不上。
    if (!fs.existsSync(py)) {
      process.stdout.write('[transcribe] 创建 venv（Python ' + PY_VERSION + '）：' + venvDir + '\n');
      const attempts = venvEnvAttempts(childEnv, resolveUvMirror(process.env));
      let lastErr = null;
      for (let i = 0; i < attempts.length; i++) {
        try {
          runStep(uv, ['venv', '--python', PY_VERSION, venvDir], attempts[i].env, 'uv venv');
        } catch (e) { lastErr = e; }
        if (fs.existsSync(py)) break;
        // 失败的尝试可能留下半个 venv 目录，重试前先清掉
        try { fs.rmSync(venvDir, { recursive: true, force: true }); } catch (e) { /* 清不掉就让下一次尝试自己报错 */ }
        if (i + 1 < attempts.length) {
          process.stderr.write('[transcribe] 用 ' + attempts[i].label + ' 创建 venv 失败，改用 ' + attempts[i + 1].label + ' 重试…\n');
        }
      }
      if (!fs.existsSync(py)) throw (lastErr || new Error('uv venv 失败：' + venvDir));
    }

    // 2) faster-whisper：只在 import 失败时才装（离线/已装时零网络请求）
    const probe = spawnSync(py, ['-c', 'import faster_whisper'], { stdio: 'ignore', shell: false });
    if (probe.status !== 0) {
      process.stdout.write('[transcribe] 安装 faster-whisper（清华镜像）…\n');
      runStep(uv, ['pip', 'install', '--python', py, 'faster-whisper', '-i', PYPI_MIRROR], childEnv, 'faster-whisper 安装');
    }

    // 3) 运行时环境变量：hf-mirror + 关掉会绕开镜像并 401 的 hf-xet 后端
    childEnv.HF_ENDPOINT = HF_ENDPOINT;
    childEnv.HF_HOME = path.join(root, 'hf');
    childEnv.HF_HUB_DISABLE_XET = '1';
    childEnv.HF_HUB_DISABLE_SYMLINKS_WARNING = '1';
    childEnv.DRS_AUDIO = args.audio;
    childEnv.DRS_OUT = args.out;
    childEnv.DRS_MODEL = args.model;
    childEnv.DRS_LANG = args.language;
    childEnv.DRS_DEVICE = args.device;

    const pyScript = path.join(root, 'transcribe_run.py');
    fs.writeFileSync(pyScript, PY_RUNNER, 'utf8');

    // 4) 转写（首次会下载模型到 HF_HOME，之后缓存复用）
    runStep(py, [pyScript], childEnv, '转写');

    const bytes = fs.statSync(args.out).size;
    process.stdout.write('TRANSCRIBED ' + bytes + ' bytes to ' + args.out + '\n');
    const verdict = judgeTranscript(bytes);
    if (!verdict.ok) {
      // 删掉空文件：留着它会让「文件存在」被当成完成
      try { fs.rmSync(args.out, { force: true }); } catch (e) { /* 删不掉也要如实报错 */ }
      return fail(verdict.message, verdict.code);
    }
    return 0;
  } catch (e) {
    return fail(e.message + '（可降级：让用户手动提供转写文本，或用 options.transcribe=false 跳过转写）');
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  cacheRoot: cacheRoot,
  resolveUvMirror: resolveUvMirror,
  venvEnvAttempts: venvEnvAttempts,
  judgeTranscript: judgeTranscript,
  isFileAt: isFileAt,
  UV_PYTHON_INSTALL_MIRROR_DEFAULT: UV_PYTHON_INSTALL_MIRROR_DEFAULT,
  venvPython: venvPython,
  uvInstallHint: uvInstallHint,
  uvCandidates: uvCandidates,
  findUv: findUv,
  parseArgs: parseArgs,
  PY_VERSION: PY_VERSION,
  PY_RUNNER: PY_RUNNER
};
