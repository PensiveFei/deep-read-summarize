// scripts/model-canary.js — 真实模型金丝雀
//
// 它是什么：把**笔记契约**（七节模板 + 第 4 节逐字引文规则 + 篇幅下限，见
// tests/fixtures/canary/prompt.md）连同固定素材一起喂给真实模型，再用插件自己的校验器
// （lib/quality.js）判断产物合不合格。
//
// 提示词为什么是「镜像」而不是直接复用：权威版本内嵌在 lib/workflow-script.txt 的
// draftPrompt 拼装代码里，抽不干净；第一版直接拿 skills/…/SKILL.md 当系统提示词，
// 真实模型立刻给了反例——它写了两千多字、章节缺了两个、还把 5 条引文改写成了
// 「找单一元凶」这类自己的话。SKILL.md 是给会用工具的代理看的说明书，不是笔记契约。
// 镜像与模板的一致性由 tests/model-canary.test.js 兜住（与 SKILL.md 的模板块逐行比对）。
//
// 它不是什么：不是端到端测试。它不经过 DSH 宿主，不跑「分块 → 并行精读 → 汇总 → 重试」
// 那段编排，也不碰转写与抓取。真正的端到端在 scripts/e2e-dsh.js 里。把两者混着叫
// 「E2E」会让下一个人以为装配也被覆盖了——装配恰恰只有 DSH 那条能测。
//
// 它查的是漂移：上游模型换了版本、或者改了默认行为之后，我们的提示词还能不能产出
// 通过我们自己检查的笔记。这类问题不会让 CI 变红，只会让用户拿到不合格的笔记。
//
// 判据为什么是结构 + 引文，而不是比对文本：模型输出非确定，逐字比对必然 flaky；
// 而「七个章节是否齐、篇幅够不够、第 4 节的引文是否真在原文里」是可以判定的，
// 并且正好是宿主会拦下来的那几条（见 lib/workflow-script.txt 的质检波次）。
//
// 预算为什么写成硬上限：这个脚本会花钱。默认最多 2 次调用、单次 2048 输出 token、
// 合计 40000 token，超了直接退出，不做「尽量跑完」——金丝雀的成本必须是可预测的。
//
// 用法：
//   node scripts/model-canary.js --dry-run     只拼提示词、打印预算，不联网（无 key 时用这个）
//   node scripts/model-canary.js               真跑一次（需要 DEEPSEEK_API_KEY）
//   node scripts/model-canary.js --samples 2   同一素材跑两次，看稳定性
//
// 环境变量：DEEPSEEK_API_KEY（或 CANARY_API_KEY）、CANARY_BASE_URL、
//   CANARY_MODEL、CANARY_MAX_CALLS、CANARY_MAX_TOKENS、CANARY_MAX_TOTAL_TOKENS、CANARY_MIN_WORDS
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { extractNote, checkNoteStructure } = require('../lib/quality');

const ROOT = path.join(__dirname, '..');
// 提示词是一份「蒸馏镜像」：把笔记契约（模板 + 引文规则 + 篇幅）写死在一处，
// 因为权威版本是内嵌在 lib/workflow-script.txt 里的拼装代码，无法干净地抽出来。
// 镜像的漂移由 tests/model-canary.test.js 兜住：模板标题必须与 SKILL.md 里的
// ```markdown 块逐行一致，改了一边另一边没跟上就会红。
const PROMPT = path.join(ROOT, 'tests', 'fixtures', 'canary', 'prompt.md');
// 素材放在 cases/ 下，每个文件一次调用：一篇长文抓不到「某类输入退化」——
// 表格密集的原文、中英混排的术语，模型的表现可以完全不同，而单素材金丝雀
// 只会给一个平均值。
const CASES = path.join(ROOT, 'tests', 'fixtures', 'canary', 'cases');
const OUT_DIR = path.join(ROOT, 'e2e-artifacts', 'canary');

/** 列出素材（按文件名排序，保证每次跑的次序一致）。 */
function listCases(dir) {
  return fs.readdirSync(dir)
    .filter(function (f) { return /\.md$/i.test(f); })
    .sort();
}

const DEFAULTS = {
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-flash',
  maxCalls: 4,
  maxTokens: 2048,
  maxTotalTokens: 40000,
  minWords: 400
};

function intFrom(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** 配置与预算一次性解析完，任何越界都在发请求之前失败。 */
function resolveConfig(env, argv) {
  const args = argv || [];
  const samplesIndex = args.indexOf('--samples');
  const requested = samplesIndex >= 0 ? intFrom(args[samplesIndex + 1], 0) : 1;
  const cfg = {
    dryRun: args.indexOf('--dry-run') >= 0,
    apiKey: env.DEEPSEEK_API_KEY || env.CANARY_API_KEY || '',
    baseUrl: (env.CANARY_BASE_URL || DEFAULTS.baseUrl).replace(/\/+$/, ''),
    model: env.CANARY_MODEL || DEFAULTS.model,
    thinking: env.CANARY_THINKING || 'disabled',
    samples: requested || 1,
    maxCalls: intFrom(env.CANARY_MAX_CALLS, DEFAULTS.maxCalls),
    maxTokens: intFrom(env.CANARY_MAX_TOKENS, DEFAULTS.maxTokens),
    maxTotalTokens: intFrom(env.CANARY_MAX_TOTAL_TOKENS, DEFAULTS.maxTotalTokens),
    minWords: intFrom(env.CANARY_MIN_WORDS, DEFAULTS.minWords)
  };
  if (cfg.samples > cfg.maxCalls) {
    throw new Error('samples=' + cfg.samples + ' 超过预算上限 CANARY_MAX_CALLS=' + cfg.maxCalls +
      '：金丝雀不跑「尽量多」的量');
  }
  if (!cfg.dryRun && !cfg.apiKey) {
    throw new Error('缺少 DEEPSEEK_API_KEY。只想看提示词就加 --dry-run；要真跑请给 key。');
  }
  if (cfg.thinking !== 'enabled' && cfg.thinking !== 'disabled') {
    throw new Error('CANARY_THINKING 只能是 enabled 或 disabled，收到：' + cfg.thinking);
  }
  return cfg;
}

/** 提示词 = 笔记契约（镜像）+ 固定素材 + 一句「按模板写笔记」。 */
function buildMessages(instructions, source) {
  return [
    { role: 'system', content: instructions },
    {
      role: 'user',
      content: '请按上面说明里的笔记模板，为下面这篇原文写一篇深度精读笔记。' +
        '只输出笔记本身，不要额外的说明或前言。\n\n' +
        '原文：\n' + source
    }
  ];
}

function normalizeQuote(text) {
  return String(text)
    .replace(/^[>\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 产物判定：结构 + 篇幅 + 引文真实性。
 * 引文检查复刻宿主侧的做法（读回原文逐字比对），只是把「文件系统读取」换成了内存里的源文。
 */
function verifyNote(reply, source, opts) {
  const options = opts || {};
  const extracted = extractNote(reply);
  const note = extracted.note;
  const check = checkNoteStructure(note, { minWords: options.minWords || DEFAULTS.minWords });
  const failures = [];
  if (!check.formatComplete) failures.push('结构不合格：' + (check.issues.join('；') || '格式未通过'));
  if (!check.lengthMet) failures.push('篇幅不足：' + check.wordCount + ' 字/词，要求至少 ' + (options.minWords || DEFAULTS.minWords));
  if (!check.quotes.length) failures.push('第 4 节没有任何可用引文');
  const haystack = normalizeQuote(source);
  const missing = check.quotes.filter(function (quote) {
    return haystack.indexOf(normalizeQuote(quote)) < 0;
  });
  if (missing.length) {
    failures.push('有 ' + missing.length + ' 条引文在原文里找不到：' + missing.slice(0, 2).join(' | '));
  }
  return {
    ok: failures.length === 0,
    note: note,
    failures: failures,
    stats: {
      wordCount: check.wordCount,
      quotes: check.quotes.length,
      missingQuotes: missing.length,
      context: extracted.context ? extracted.context.kind : 'none'
    }
  };
}

async function callModel(cfg, messages, signal) {
  const response = await fetch(cfg.baseUrl + '/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + cfg.apiKey
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: messages,
      temperature: 0,
      max_tokens: cfg.maxTokens,
      // 思考模式默认是开的（2026 年的 DeepSeek API），金丝雀要的是可复现的低成本采样，
      // 所以默认关掉；想验证思考模式下的产物就把 CANARY_THINKING 设成 enabled。
      thinking: { type: cfg.thinking }
    }),
    signal: signal
  });
  const raw = await response.text();
  if (!response.ok) {
    const hint = response.status === 401 || response.status === 403
      ? '（key 无效或没有该模型权限）'
      : '';
    throw new Error('HTTP ' + response.status + hint + '：' + raw.slice(0, 400));
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new Error('响应不是 JSON：' + raw.slice(0, 200));
  }
  const text = payload && payload.choices && payload.choices[0] &&
    payload.choices[0].message && payload.choices[0].message.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('响应里没有 message.content');
  return { text: text, usage: payload.usage || {} };
}

function writeArtifacts(caseName, sampleIndex, reply, report) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const base = path.join(OUT_DIR, caseName.replace(/\.md$/i, '') + '-sample-' + (sampleIndex + 1));
  fs.writeFileSync(base + '.md', reply, 'utf8');
  fs.writeFileSync(base + '.report.json', JSON.stringify(report, null, 2) + '\n', 'utf8');
  return base;
}

async function main() {
  const cfg = resolveConfig(process.env, process.argv.slice(2));
  const instructions = fs.readFileSync(PROMPT, 'utf8');
  const cases = listCases(CASES).map(function (name) {
    return { name: name, source: fs.readFileSync(path.join(CASES, name), 'utf8') };
  });
  if (!cases.length) throw new Error('tests/fixtures/canary/cases/ 下没有素材');
  const planned = cases.length * cfg.samples;
  if (planned > cfg.maxCalls) {
    throw new Error('素材 ' + cases.length + ' 篇 × ' + cfg.samples + ' 次 = ' + planned +
      ' 次调用，超过预算上限 CANARY_MAX_CALLS=' + cfg.maxCalls);
  }

  console.log('canary: model=' + cfg.model + ' thinking=' + cfg.thinking + ' base=' + cfg.baseUrl +
    ' cases=' + cases.length + ' samples/case=' + cfg.samples + ' minWords=' + cfg.minWords +
    ' maxTokens=' + cfg.maxTokens + ' budget=' + cfg.maxTotalTokens + ' tokens');
  console.log('prompt: system ' + instructions.length + ' chars; cases: ' + cases.map(function (c) {
    return c.name.replace(/\.md$/i, '') + '(' + c.source.length + ')';
  }).join(', '));

  if (cfg.dryRun) {
    console.log('dry-run：不联网、不校验。真实运行请去掉 --dry-run 并提供 DEEPSEEK_API_KEY。');
    return;
  }

  let totalTokens = 0;
  const failures = [];
  for (const item of cases) {
    const messages = buildMessages(instructions, item.source);
    for (let i = 0; i < cfg.samples; i++) {
      const started = Date.now();
      const result = await callModel(cfg, messages, AbortSignal.timeout(180000));
      totalTokens += Number(result.usage.total_tokens || 0);
      const report = verifyNote(result.text, item.source, { minWords: cfg.minWords });
      report.usage = result.usage;
      report.model = cfg.model;
      report.case = item.name;
      report.elapsedMs = Date.now() - started;
      const base = writeArtifacts(item.name, i, result.text, report);
      const label = item.name.replace(/\.md$/i, '') + (cfg.samples > 1 ? ' #' + (i + 1) : '');
      console.log(label + ': ' + (report.ok ? 'OK' : 'FAIL') +
        ' — ' + report.stats.wordCount + ' 字/词, ' + report.stats.quotes + ' 条引文, ' +
        Math.round(report.elapsedMs / 1000) + 's, ' + (result.usage.total_tokens || '?') + ' tokens → ' +
        path.relative(ROOT, base) + '.md');
      if (!report.ok) for (const failure of report.failures) failures.push(label + ': ' + failure);
      if (totalTokens > cfg.maxTotalTokens) {
        throw new Error('累计 ' + totalTokens + ' token 超过预算上限 ' + cfg.maxTotalTokens + '：停止调用');
      }
    }
  }
  if (failures.length) {
    for (const failure of failures) console.error('CANARY: ' + failure);
    console.error('金丝雀未通过（' + failures.length + ' 项）。产物留在 e2e-artifacts/canary/ 里供比对；' +
      '先判断是模型/提示词的问题还是校验器过严，不要直接放宽门槛。');
    process.exitCode = 1;
    return;
  }
  console.log('Canary OK: ' + planned + ' 篇笔记通过结构、篇幅与引文检查（累计 ' + totalTokens + ' token）');
}

module.exports = { resolveConfig, buildMessages, verifyNote, normalizeQuote, listCases, DEFAULTS };

if (require.main === module) {
  main().catch(function (error) {
    console.error('CANARY: ' + error.message);
    // 用 exitCode 而不是 process.exit：请求失败时 undici 的连接/计时器还在收尾，
    // 硬退出会踩 libuv 的 `!(handle->flags & UV_HANDLE_CLOSING)` 断言
    // （Windows + Node 24 实测，比真正的错误信息更吓人，还会把退出码变成崩溃码）。
    process.exitCode = 2;
  });
}
