// scripts/asr-check.js — 转写链路的装配检查（只验装配，不验质量）
//
// 它回答的问题：`scripts/transcribe.js` 这条「uv 自举 → Python 3.12 → faster-whisper
// → 模型 → 落盘 → 缓存」的链路，还连着吗？
//
// 它不回答的问题：转写得准不准。判据刻意不比对任何文字——自动字幕/转写会漏句、
// 听错数字与否定词，逐字比对会把「模型换版本」误报成「链路坏了」，而这个检查
// 的目的是抓后者。质量由人听，不由这里断言。
//
// 四个用例：
//   1. 语音 → 退出码 0、输出文件非空（链路通）
//   2. 同一音频再来一次 → metrics.cacheHit=true、输出字节一致（缓存真的复用，而不是重跑）
//   3. 10 秒纯静音 → 非 0 退出、**不发布空文件**（fail closed，是设计而非缺陷）
//   4. 同一段语音转成 aac-in-mp4 再转写 → 退出码 0、输出非空（容器解码分支；用户传的几乎都不是裸 wav）
//
// 为什么第三条用静音：它是唯一能稳定制造「0 字节转写」的输入。真实世界里对应的
// 场景是无字幕纯音乐视频——如果不拦，用户会拿到一个 0 字节的「逐字稿」并被当成成功。
//
// 用法：
//   node scripts/asr-check.js --speech <10s.wav>        真跑（需要 uv；首次会装 Python 3.12 与 small 模型）
//   node scripts/asr-check.js --dry-run               只检查前置条件，不跑模型
// 语音样本不进仓库：CI 用 espeak-ng 合成，本机可以自己录、或用系统 TTS 生成。
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { writeSilenceWav } = require('../tests/fixtures/audio/silence');

const ROOT = path.join(__dirname, '..');
const TRANSCRIBE = path.join(ROOT, 'scripts', 'transcribe.js');
const MODEL = process.env.ASR_MODEL || 'small';
const TIMEOUT_MS = Number(process.env.ASR_TIMEOUT_MS || 20 * 60 * 1000);

/** 从 transcribe.js 的 stdout 里取 metrics 行；解析失败返回 null。 */
function parseMetrics(stdout) {
  const lines = String(stdout || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.indexOf('[transcribe] metrics ') !== 0) continue;
    try {
      return JSON.parse(line.slice('[transcribe] metrics '.length));
    } catch (error) {
      return null;
    }
  }
  return null;
}

/**
 * 把三次运行的结果变成判据。
 * 输入是 { name, status, stdout, outFile, outBytes, expectFail } 的数组，
 * 输出 { ok, failures }。抽成纯函数是为了让断言本身可测（这里出错的代价是假绿）。
 */
function judge(cases) {
  const failures = [];
  for (const c of cases) {
    const metrics = parseMetrics(c.stdout);
    if (c.expectFail) {
      if (c.status === 0) failures.push(c.name + '：静音输入不该成功（退出码 0）');
      if (c.outBytes > 0) failures.push(c.name + '：失败路径不该留下输出文件（' + c.outBytes + ' 字节）');
      if (!/静音|为空|0 字节/.test(String(c.stdout))) {
        failures.push(c.name + '：失败信息没有说清原因（应提到静音/为空）');
      }
      continue;
    }
    if (c.status !== 0) {
      failures.push(c.name + '：退出码 ' + c.status + '（输出见 artifacts）');
      continue;
    }
    if (!(c.outBytes > 0)) failures.push(c.name + '：输出文件为空或不存在');
    if (!metrics) failures.push(c.name + '：stdout 里没有可解析的 metrics 行');
    if (c.expectCacheHit === true && metrics && metrics.cacheHit !== true) {
      failures.push(c.name + '：期望命中缓存，实际 cacheHit=' + metrics.cacheHit +
        '（缓存身份包含模型快照/环境/解码配置，任何一项变了都会重算）');
    }
    if (c.expectCacheHit === false && metrics && metrics.cacheHit === true) {
      failures.push(c.name + '：期望真实转写，实际命中了缓存');
    }
  }
  return { ok: failures.length === 0, failures: failures };
}

function runTranscribe(audio, out, extra) {
  const args = [TRANSCRIBE, '--audio', audio, '--out', out, '--model', MODEL].concat(extra || []);
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    env: Object.assign({}, process.env)
  });
  return {
    status: result.status,
    stdout: (result.stdout || '') + (result.stderr || ''),
    outBytes: fs.existsSync(out) ? fs.statSync(out).size : 0
  };
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.indexOf('--dry-run') >= 0;
  const speechIndex = argv.indexOf('--speech');
  const speech = speechIndex >= 0 ? argv[speechIndex + 1] : '';
  const problems = [];
  if (!fs.existsSync(TRANSCRIBE)) problems.push('找不到 scripts/transcribe.js');
  if (!dryRun) {
    if (!speech) problems.push('缺少 --speech <wav>：仓库里不放音频二进制，请自己合成或录一段 5–10 秒的语音');
    else if (!fs.existsSync(speech)) problems.push('找不到语音文件：' + speech);
  }

  console.log('asr-check: model=' + MODEL + ' timeout=' + Math.round(TIMEOUT_MS / 1000) + 's');
  console.log('  transcribe: ' + path.relative(ROOT, TRANSCRIBE));
  console.log('  语音样本  : ' + (speech || '(dry-run)'));
  if (problems.length) {
    for (const p of problems) console.error('ASR: ' + p);
    process.exit(2);
  }
  if (dryRun) {
    console.log('\ndry-run：将依次运行');
    console.log('  1. transcribe(--audio 语音 wav)          断言 退出 0 且输出非空');
    console.log('  2. transcribe(同一 wav)                  断言 cacheHit=true 且字节一致');
    console.log('  3. transcribe(--audio 10s 静音)          断言 非 0 且不留下空文件');
    console.log('  4. transcribe(--audio 由 wav 转出的 mp4) 断言 退出 0 且输出非空（无 ffmpeg 时跳过）');
    return;
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'drs-asr-'));
  const silence = writeSilenceWav(path.join(work, 'silence-10s.wav'), 10);
  console.log('\n工作目录: ' + work);
  console.log('静音样本: ' + silence.seconds + 's / ' + silence.bytes + ' bytes');

  const firstOut = path.join(work, 'speech-1.txt');
  const secondOut = path.join(work, 'speech-2.txt');
  const silenceOut = path.join(work, 'silence.txt');

  console.log('\n[1/3] 语音 → 转写（首次，可能要装环境与模型）');
  const first = runTranscribe(speech, firstOut, ['--refresh-cache']);
  const firstCase = Object.assign({ name: '语音转写', expectCacheHit: false, outFile: firstOut }, first);
  printCase(firstCase);

  console.log('\n[2/3] 同一音频 → 再来一次（应命中缓存）');
  const second = runTranscribe(speech, secondOut, []);
  const secondCase = Object.assign({ name: '缓存命中', expectCacheHit: true, outFile: secondOut }, second);
  printCase(secondCase);
  if (first.outBytes > 0 && second.outBytes > 0 &&
      fs.readFileSync(firstOut, 'utf8') !== fs.readFileSync(secondOut, 'utf8')) {
    secondCase.identical = false;
  } else {
    secondCase.identical = true;
  }

  console.log('\n[3/4] 10 秒静音 → 必须按设计失败，且不留下空文件');
  const silenceRun = runTranscribe(path.join(work, 'silence-10s.wav'), silenceOut, ['--refresh-cache']);
  const silenceCase = Object.assign({ name: '静音 fail-closed', expectFail: true }, silenceRun);
  printCase(silenceCase);

  // 用户传的真实素材几乎都不是 wav：mp4 / m4a / webm 走的是 PyAV 的容器解码分支，
  // 而 wav 用例覆盖不到它。用 ffmpeg 把同一段合成语音转成 aac-in-mp4 即可覆盖，
  // 既不需要提交任何真实音视频，也不改变判据（仍然只看「通不通」，不看文字）。
  const cases = [firstCase, secondCase, silenceCase];
  const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0;
  if (!hasFfmpeg) {
    console.log('\n[4/4] mp4 容器解码：跳过（PATH 里没有 ffmpeg）');
    console.log('    CI 的 ubuntu runner 自带 ffmpeg，所以这一步在 CI 上会真跑。');
  } else {
    console.log('\n[4/4] mp4 容器 → 转写（真实用户传的是容器，不是裸 wav）');
    const mp4 = path.join(work, 'speech.mp4');
    const converted = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', speech, '-c:a', 'aac', '-b:a', '64k', mp4],
      { encoding: 'utf8', timeout: 120000 });
    if (converted.status !== 0 || !fs.existsSync(mp4)) {
      const containerCase = { name: 'mp4 容器', status: converted.status === 0 ? 1 : converted.status,
        stdout: 'ffmpeg 转封装失败：' + (converted.stderr || ''), outBytes: 0 };
      cases.push(containerCase);
      printCase(containerCase);
    } else {
      const mp4Out = path.join(work, 'mp4.txt');
      const mp4Run = runTranscribe(mp4, mp4Out, ['--refresh-cache']);
      const containerCase = Object.assign({ name: 'mp4 容器', outFile: mp4Out }, mp4Run);
      cases.push(containerCase);
      printCase(containerCase);
    }
  }

  const report = judge(cases);
  if (!secondCase.identical) report.failures.push('缓存命中：两次输出内容不一致');
  if (!report.ok) {
    for (const failure of report.failures) console.error('ASR: ' + failure);
    console.error('装配检查未通过。产物与日志在 ' + work + '（--keep 可保留，默认也会留着）');
    process.exit(1);
  }
  console.log('\nASR OK: 转写链路通、缓存可复用、静音按设计失败' +
    (hasFfmpeg ? '、mp4 容器可解码' : '（mp4 用例本机跳过）') + '（' + path.relative(ROOT, work) + '）');
}

function printCase(c) {
  const metrics = parseMetrics(c.stdout);
  console.log('  ' + c.name + ': exit=' + c.status + ' bytes=' + c.outBytes +
    (metrics ? ' cacheHit=' + metrics.cacheHit : '') +
    (metrics && metrics.duration ? ' duration=' + metrics.duration + 's' : ''));
  // 失败时必须把真正的原因打出来：上一次本地跑就吃过大亏——脚本只报 exit=1，
  // 而 stderr 里写着「转写无法执行（venv python 被系统策略拦下）」，完全两种处置。
  if (c.status !== 0) {
    const tail = String(c.stdout || '').trim().split('\n').slice(-10);
    for (const line of tail) console.log('    | ' + line.trim().slice(0, 200));
  }
}

module.exports = { parseMetrics, judge };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('ASR: ' + error.message);
    process.exit(2);
  }
}
