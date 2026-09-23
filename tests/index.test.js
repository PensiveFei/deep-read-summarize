// tests/index.test.js — node:test 风格测试（dsh.so / npm 规范）
// 运行: node --test
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// ---------- 插件入口 ----------
test('plugin loads with name deep-read-summarize', () => {
  const p = require('../index.js');
  const def = p.load();
  assert.strictEqual(def.name, 'deep-read-summarize');
  assert.strictEqual(def.workflow.meta.name, 'deep-read-summarize');
});

// ---------- 解析器 ----------
const parsers = require('../parsers');
test('registry exposes 4 built-in parsers', () => {
  const names = parsers.list().map(p => p.name).sort();
  assert.deepStrictEqual(names, ['book', 'paper', 'video', 'web']);
});

test('resolve falls back to web for unknown type', () => {
  assert.strictEqual(parsers.resolve('unknown').name, 'web');
});

test('every parser builds a non-empty prompt', () => {
  for (const type of ['book', 'paper', 'video', 'web']) {
    const prompt = parsers.resolve(type).buildPrompt('https://example.com/x', { tempDir: '/tmp', tempFile: '/tmp/in.txt', maxChunks: 4 });
    assert.ok(typeof prompt === 'string' && prompt.length > 50, type + ' prompt too short');
  }
});

// ---------- schemas ----------
const schemas = require('../schemas');
test('fetchResultSchema requires saved', () => {
  assert.ok(schemas.fetchResultSchema.required.includes('saved'));
});

// ---------- workflow ----------
const wf = require('../workflow');
test('workflow meta is valid', () => {
  assert.strictEqual(wf.meta.name, 'deep-read-summarize');
  assert.ok(wf.meta.phases.length >= 3);
});

test('workflow script parses as async body', () => {
  const fn = new Function('args','phase','agent','parallel','log', 'return (async () => { ' + wf.script + ' })()');
  assert.ok(typeof fn === 'function');
});

// ---------- 幂等缓存 ----------
const cache = require('../lib/cache');
const os = require('os');
test('cache fingerprint is deterministic', () => {
  assert.strictEqual(
    cache.fingerprint('https://arxiv.org/abs/2307.09042'),
    cache.fingerprint('https://arxiv.org/abs/2307.09042')
  );
});

// ---------- 打包完整性 ----------
test('cordis.patch.yml exists and uses insert block', () => {
  const patch = fs.readFileSync(path.join(__dirname, '..', 'cordis.patch.yml'), 'utf8');
  assert.ok(patch.includes('- insert:'));
  assert.ok(patch.includes('deep-read-summarize'));
});

test('skills bundle exists', () => {
  const skill = path.join(__dirname, '..', 'skills', 'deep-read-summarize', 'SKILL.md');
  assert.ok(fs.existsSync(skill), 'SKILL.md missing');
  const content = fs.readFileSync(skill, 'utf8');
  assert.ok(content.includes('name: deep-read-summarize'));
});

// ---------- fixture 版权 ----------
test('fixture is self-authored public-domain', () => {
  const fx = fs.readFileSync(path.join(__dirname, 'fixtures', 'fable.txt'), 'utf8');
  assert.ok(fx.includes('released into the public domain'));
});


// ============================================================================
// workflow 运行时回归（0.3.8）
// 直接跑自包含脚本（mock 掉 agent / parallel / phase / log），覆盖本次修掉的
// P0：分块计划失控、负数读取区间、frontmatter 注入、幂等早返回丢数据。
// ============================================================================
const plugin = require('../index.js');
const wfScript = wf.script;

function makeAgent(cfg) {
  cfg = cfg || {};
  return function (prompt, o) {
    const label = (o && o.label) || '';
    if (label === '获取+分块') {
      if (cfg.fetch !== undefined) return cfg.fetch;
      return {
        kind: cfg.kind || 'paper',
        saved: true,
        totalLines: cfg.totalLines === undefined ? 1000 : cfg.totalLines,
        metadata: cfg.metadata || { title: cfg.title || 'Sample' },
        chunkPlan: cfg.chunkPlan || [
          { id: 1, topic: 'T1', startLine: 1, endLine: 500 },
          { id: 2, topic: 'T2', startLine: 501, endLine: 1000 }
        ]
      };
    }
    if (label === '汇总成稿') return cfg.note === undefined ? '# note' : cfg.note;
    if (label === '质量校验') return { pass: cfg.pass !== false, issues: cfg.issues || [] };
    return 'chunk text';
  };
}

async function runScript(args, agentImpl, scriptText) {
  const calls = [];
  const fn = new Function('args', 'phase', 'agent', 'parallel', 'log',
    'return (async () => { ' + (scriptText || wfScript) + ' })()');
  const result = await fn(
    args,
    function () {},
    function (p, o) { calls.push({ label: (o && o.label) || '', prompt: p }); return agentImpl(p, o); },
    function (fns) { return Promise.all(fns.map(function (f) { return f(); })); },
    function () {}
  );
  return { result: result, calls: calls };
}

function injectedFetchSchema(scriptText) {
  const m = (scriptText || wfScript).match(/const fetchSchema = (\{[\s\S]*?\});\n/);
  assert.ok(m, 'fetchSchema is not injected into the script');
  return JSON.parse(m[1]);
}

test('workflow: chunk plan is clamped to maxChunks', async () => {
  const plan = [];
  for (let i = 1; i <= 10; i++) plan.push({ id: i, topic: 'T' + i, startLine: (i - 1) * 100 + 1, endLine: i * 100 });
  const r = await runScript({ input: 'x', type: 'paper', options: { maxChunks: 4 } }, makeAgent({ chunkPlan: plan }));
  assert.strictEqual(r.result.chunksCount, 4, 'the plan must be clamped, not passed through');
  assert.strictEqual(r.calls.filter(function (c) { return c.label === '精读块'; }).length, 4,
    'one sub-agent per chunk - 10 chunks means 10 sub-agents');
});

test('workflow: inverted and out-of-range chunks are dropped', async () => {
  const r = await runScript({ input: 'x', type: 'paper' }, makeAgent({
    totalLines: 500,
    chunkPlan: [
      { id: 1, topic: 'inverted', startLine: 900, endLine: 100 },
      { id: 2, topic: 'beyond-eof', startLine: 9000, endLine: 9500 },
      { id: 3, topic: 'ok', startLine: 1, endLine: 500 }
    ]
  }));
  assert.strictEqual(r.result.chunksCount, 1);
  const readPrompt = r.calls.find(function (c) { return c.label === '精读块'; }).prompt;
  assert.ok(!/limit=-/.test(readPrompt), 'read must never be handed a negative limit');
  assert.ok(/limit=500/.test(readPrompt), 'the valid chunk must survive intact');
});

test('workflow: an all-invalid chunk plan degrades instead of running', async () => {
  const r = await runScript({ input: 'x', type: 'paper' },
    makeAgent({ chunkPlan: [{ id: 1, topic: 'bad', startLine: 900, endLine: 100 }] }));
  assert.strictEqual(r.result.ok, false);
  assert.strictEqual(r.result.fatal, false);
  assert.strictEqual(r.result.stage, 'fetch');
});

test('workflow: frontmatter escapes quotes coming from the content title', async () => {
  const r = await runScript({ input: 'https://example.com/x', type: 'paper' },
    makeAgent({ title: 'The "Best" Method' }));
  const draft = r.calls.find(function (c) { return c.label === '汇总成稿'; }).prompt;
  assert.ok(!draft.includes('title: "《The "Best" Method》'), 'raw quotes must not reach the frontmatter');
  assert.ok(draft.includes('title: "《The \\"Best\\" Method》深度精读笔记"'), 'title must be escaped');
  assert.ok(/url: "https:\/\/example\.com\/x"/.test(draft), 'url must be a quoted scalar');
});

test('workflow: a title of nothing but illegal characters still yields a usable filename', async () => {
  const r = await runScript({ input: 'x', type: 'web' }, makeAgent({ kind: 'web', title: '///' }));
  assert.ok(!/\/\.md$/.test(r.result.filePath), 'must not write a hidden .md: ' + r.result.filePath);
  assert.ok(/未命名内容\.md$/.test(r.result.filePath), r.result.filePath);
});

test('workflow: unknown kind under type=auto falls back to a registered type', async () => {
  const r = await runScript({ input: 'x', type: 'auto' }, makeAgent({
    fetch: { saved: true, totalLines: 10, chunkPlan: [{ id: 1, topic: 't', startLine: 1, endLine: 10 }] }
  }));
  assert.notStrictEqual(r.result.kind, 'auto');
  assert.ok(Object.keys(wf.parsers.registry.parsers).indexOf(r.result.kind) !== -1, r.result.kind);
});

test('workflow: no idempotency early-return is left in the script', () => {
  assert.ok(!wfScript.includes('_processedKeys'), 'the unreachable cache-hit branch must be gone');
  assert.ok(!/cached: true/.test(wfScript), 'the empty-note early return must be gone');
});

test('workflow: transcribe=false actually changes the video prompt', () => {
  const vp = wf.parsers.resolve('video');
  const on = vp.buildPrompt('https://b23.tv/x', { tempDir: './.tmp' });
  const off = vp.buildPrompt('https://b23.tv/x', { tempDir: './.tmp', transcribe: false });
  assert.notStrictEqual(on, off, 'transcribe:false used to produce a byte-identical prompt');
  assert.ok(on.includes('transcribe.js'), 'the prompt must point at the cross-platform script');
  assert.ok(!on.includes('transcribe.ps1'), 'the Windows-only PowerShell script must be gone');
  assert.ok(!off.includes('--model '), 'transcribe=false must not ask for a transcription run');
  assert.ok(off.includes('转写已禁用'));
});

test('workflow: whisperModel and language reach the transcription command', () => {
  const vp = wf.parsers.resolve('video');
  assert.ok(vp.buildPrompt('u', { tempDir: './.tmp', whisperModel: 'medium', language: 'en' })
    .includes('--device cpu --model medium --language en'), 'documented ASR options must be honoured');
  assert.ok(vp.buildPrompt('u', { tempDir: './.tmp' }).includes('--device cpu --model small --language zh'),
    'defaults stay small/zh');
});

test('workflow: the script forwards whisperModel and language to the parser', async () => {
  const r = await runScript({ input: 'https://b23.tv/x', type: 'video', options: { whisperModel: 'base', language: 'ja' } },
    makeAgent({ kind: 'video' }));
  const fetchPrompt = r.calls.find(function (c) { return c.label === '获取+分块'; }).prompt;
  assert.ok(fetchPrompt.includes('--model base --language ja'), 'options must survive the script -> parser boundary');
});

test('plugin: config is validated and folded into the skill args', () => {
  const content = plugin.buildSkillContent({ outputDir: 'D:/vault/notes', maxChunks: 8 });
  assert.ok(content.includes('D:/vault/notes'), 'config.outputDir must reach the args example');
  assert.ok(content.includes('"maxChunks": 8'));
  assert.strictEqual(plugin.normalizeOptions({ maxChunks: 'lots' }).maxChunks, 4, 'wrong type -> default, not crash');
  assert.strictEqual(plugin.normalizeOptions({ options: { minWords: 4000 } }).minWords, 4000, 'nested form too');
  const registered = [];
  plugin.apply({ skills: { register: function (s) { registered.push(s); return function () {}; } } }, { minWords: 4000 });
  assert.ok(registered[0].content.includes('"minWords": 4000'), 'apply() must pass config through');
});

test('workflow: the injected fetch schema comes from schemas/index.js', () => {
  const injected = injectedFetchSchema();
  assert.deepStrictEqual(injected.required, schemas.fetchResultSchema.required);
  assert.strictEqual(injected.additionalProperties, schemas.fetchResultSchema.additionalProperties);
  assert.deepStrictEqual(injected.properties.kind.enum, Object.keys(wf.parsers.registry.parsers));
  assert.strictEqual((wfScript.match(/const fetchSchema = \{/g) || []).length, 1,
    'no hand-copied duplicate may survive in the script');
});

test('workflow: a custom parser type is inlined and accepted end to end', async () => {
  const reg = wf.parsers.registry;
  const had = Object.prototype.hasOwnProperty.call(reg.parsers, 'podcast');
  const original = reg.parsers.podcast;
  reg.parsers.podcast = {
    name: 'podcast',
    types: ['podcast'],
    buildPrompt: function (input) { return 'PODCAST PROMPT ' + input; }
  };
  try {
    const regenerated = wf.buildSelfContainedScript();
    assert.ok(regenerated.includes('"podcast": { buildPrompt:'), 'custom parser must be inlined');
    assert.ok(injectedFetchSchema(regenerated).properties.kind.enum.includes('podcast'),
      'the kind enum must follow the parser registry');
    assert.ok(!regenerated.includes('auto|book|paper|video|web'),
      'the type whitelist must not be hard-coded to the four built-ins');

    const r = await runScript({ input: 'https://x.test/feed', type: 'podcast' },
      makeAgent({ kind: 'podcast', totalLines: 20, chunkPlan: [{ id: 1, topic: 't', startLine: 1, endLine: 20 }] }),
      regenerated);
    assert.strictEqual(r.result.ok, true);
    assert.strictEqual(r.result.kind, 'podcast');
  } finally {
    if (had) reg.parsers.podcast = original; else delete reg.parsers.podcast;
  }
});

test('workflow: an unknown type is still rejected loudly', async () => {
  await assert.rejects(
    runScript({ input: 'x', type: 'nope' }, makeAgent({})),
    /\[FATAL\] args\.type 非法/
  );
});

test('cache: the utility is reachable through the package exports map', () => {
  const pkg = require('../package.json');
  assert.strictEqual(pkg.exports['./lib/cache'], './lib/cache.js');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'lib', 'cache.js')));
});

// ============================================================================
// 跨平台转写引导脚本（0.3.9）
// transcribe.js 只在宿主 shell 里跑（不进 workflow 沙箱），平台差异集中在四个纯函数；
// 它们都接受注入的 platform/env/home，所以任意 OS 上都能跑全平台矩阵断言。
// ============================================================================
const transcribe = require('../scripts/transcribe.js');

test('transcribe: cache root matches the documented per-platform locations', () => {
  // Windows 必须与 0.3.6-0.3.8 的 transcribe.ps1 完全一致：
  // 老用户已经下过 484MB 模型，路径一变就要重下。
  assert.strictEqual(
    transcribe.cacheRoot({ platform: 'win32', env: { LOCALAPPDATA: 'C:/AppData/Local' }, home: 'C:/acct' }),
    path.win32.join('C:/AppData/Local', 'deep-read-summarize'));
  assert.strictEqual(
    transcribe.cacheRoot({ platform: 'win32', env: {}, home: 'C:/acct' }),
    path.win32.join('C:/acct/AppData/Local', 'deep-read-summarize'),
    'LOCALAPPDATA absent -> fall back to the standard Windows location');
  assert.strictEqual(transcribe.cacheRoot({ platform: 'darwin', env: {}, home: '/Users/me' }),
    '/Users/me/Library/Caches/deep-read-summarize');
  assert.strictEqual(transcribe.cacheRoot({ platform: 'linux', env: {}, home: '/home/me' }),
    '/home/me/.cache/deep-read-summarize');
  assert.strictEqual(transcribe.cacheRoot({ platform: 'linux', env: { XDG_CACHE_HOME: '/x' }, home: '/home/me' }),
    '/x/deep-read-summarize', 'XDG_CACHE_HOME wins on Linux');
});

test('transcribe: venv interpreter path is per-platform', () => {
  assert.strictEqual(transcribe.venvPython('/v', { platform: 'darwin' }), '/v/bin/python');
  assert.strictEqual(transcribe.venvPython('/v', { platform: 'linux' }), '/v/bin/python');
  assert.strictEqual(transcribe.venvPython('C:/v', { platform: 'win32' }),
    path.win32.join('C:/v', 'Scripts', 'python.exe'));
});

test('transcribe: the uv install hint follows the platform', () => {
  assert.ok(transcribe.uvInstallHint({ platform: 'darwin' }).includes('brew install uv'));
  assert.ok(transcribe.uvInstallHint({ platform: 'win32' }).includes('winget install astral-sh.uv'));
  assert.ok(transcribe.uvInstallHint({ platform: 'linux' }).includes('astral.sh/uv/install.sh'));
});

test('transcribe: uv discovery prefers PATH, then the usual install dirs', () => {
  const has = (list) => (p) => list.indexOf(p) >= 0;
  assert.strictEqual(
    transcribe.findUv({ platform: 'linux', env: { PATH: '/usr/bin:/bin' }, home: '/home/me',
      isFile: has(['/usr/bin/uv']) }), '/usr/bin/uv');
  assert.strictEqual(
    transcribe.findUv({ platform: 'darwin', env: { PATH: '/usr/bin' }, home: '/Users/me',
      isFile: has(['/opt/homebrew/bin/uv']) }), '/opt/homebrew/bin/uv',
    'Homebrew on Apple silicon must be found even when it is not on PATH');
  assert.strictEqual(
    transcribe.findUv({ platform: 'darwin', env: { PATH: '/usr/bin' }, home: '/Users/me',
      isFile: has(['/Users/me/.local/bin/uv']) }), '/Users/me/.local/bin/uv');
  assert.strictEqual(
    transcribe.findUv({ platform: 'win32', env: { PATH: 'C:/bin' }, home: 'C:/acct',
      isFile: has([path.win32.join('C:/bin', 'uv.exe')]) }), path.win32.join('C:/bin', 'uv.exe'));
  assert.strictEqual(transcribe.findUv({ platform: 'darwin', env: { PATH: '/usr/bin' }, home: '/Users/me',
    isFile: () => false }), null, 'no uv -> null (the caller degrades with an install hint)');
});

test('transcribe: CLI parsing accepts long, = and short forms', () => {
  const a = transcribe.parseArgs(['--audio', 'a.m4a', '--out', 'o.txt', '--model', 'medium', '--language', 'en']);
  assert.deepStrictEqual([a.audio, a.out, a.model, a.language], ['a.m4a', 'o.txt', 'medium', 'en']);
  assert.strictEqual(a.device, 'cpu', 'CPU is the default: GPU needs a CUDA runtime we do not install');

  const b = transcribe.parseArgs(['--audio=a.m4a', '--out=o.txt', '--device=auto']);
  assert.deepStrictEqual([b.audio, b.out, b.device], ['a.m4a', 'o.txt', 'auto']);

  const c = transcribe.parseArgs(['-a', 'a.m4a', '-o', 'o.txt', '-l', 'ja']);
  assert.deepStrictEqual([c.audio, c.out, c.language], ['a.m4a', 'o.txt', 'ja']);

  assert.strictEqual(transcribe.parseArgs(['--self-check']).selfCheck, true);
  assert.deepStrictEqual(transcribe.parseArgs(['nonsense']).unknown, ['nonsense']);
});

test('transcribe: the runner never leaves a half-written transcript behind', () => {
  // 调用方按「输出文件非空且稳定」判断转写完成，所以必须先收集全部分段再落盘，
  // 否则中途失败会留下半截文本被当成成功。
  assert.ok(transcribe.PY_RUNNER.includes('segments, info = run(device)'),
    'segments must be collected before the file is opened');
  assert.ok(/with open\(os\.environ\['DRS_OUT'\]/.test(transcribe.PY_RUNNER));
  assert.strictEqual(transcribe.PY_RUNNER.indexOf('with open'),
    transcribe.PY_RUNNER.lastIndexOf('with open'), 'exactly one write, after collection');
});

test('skill: the Windows-only transcription caveat is gone', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'skills', 'deep-read-summarize', 'SKILL.md'), 'utf8');
  assert.ok(!content.includes('仅在 Windows 可用'), 'the macOS/Linux limitation must be lifted');
  assert.ok(content.includes('transcribe.js'), 'the skill must point at the cross-platform script');
  assert.ok(!content.includes('transcribe.ps1'), 'no stale reference to the PowerShell script');
});

test('video prompt: gives both Windows and POSIX ways to locate the script', () => {
  const on = wf.parsers.resolve('video').buildPrompt('u', { tempDir: './.tmp' });
  assert.ok(on.includes('Get-ChildItem') && on.includes('$HOME/.dsh'),
    'the agent picks the locate command for its own OS');
  assert.ok(on.includes('brew install yt-dlp') && on.includes('winget install yt-dlp'),
    'both package managers must be offered');
  assert.ok(!on.includes('--device cuda'), 'GPU is opt-in, never silently requested');
});

test('workflow: options.device reaches the transcription command', () => {
  const vp = wf.parsers.resolve('video');
  assert.ok(vp.buildPrompt('u', { tempDir: './.tmp' }).includes('--device cpu'),
    'CPU is the default: GPU needs a CUDA runtime we deliberately do not install');
  assert.ok(vp.buildPrompt('u', { tempDir: './.tmp', device: 'auto' }).includes('--device auto'),
    'options.device must be honoured, not documented-and-ignored');
});

test('workflow: the script forwards device to the parser', async () => {
  const r = await runScript({ input: 'https://b23.tv/x', type: 'video', options: { device: 'auto' } },
    makeAgent({ kind: 'video' }));
  const fetchPrompt = r.calls.find(function (c) { return c.label === '获取+分块'; }).prompt;
  assert.ok(fetchPrompt.includes('--device auto'), 'options must survive the script -> parser boundary');
});

test('video prompt: the transcription block is a single numbered step', () => {
  const on = wf.parsers.resolve('video').buildPrompt('u', { tempDir: './.tmp' });
  assert.ok(!/[0-9]+\.\s+①/.test(on),
    'the ①-⑥ sub-steps must not be numbered as a top-level step of their own');
  assert.ok(/[0-9]+\. 转写执行/.test(on), 'the block still gets exactly one top-level number');
});
