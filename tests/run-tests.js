// tests/run-tests.js — fixture-driven tests
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✅', name); }
  catch (e) { failed++; console.error('  ❌', name, '—', e.message); }
}

// ---------- Test: parser registry ----------
const parsers = require('../parsers');
test('registry exposes 4 built-in parsers', () => {
  const list = parsers.list();
  const names = list.map(p => p.name).sort();
  assert.deepStrictEqual(names, ['book', 'paper', 'video', 'web']);
});

test('resolve returns matching parser', () => {
  assert.strictEqual(parsers.resolve('paper').name, 'paper');
});

test('resolve falls back to web for unknown type', () => {
  assert.strictEqual(parsers.resolve('unknown').name, 'web');
});

test('every parser builds a non-empty prompt', () => {
  for (const type of ['book', 'paper', 'video', 'web']) {
    const p = parsers.resolve(type);
    const prompt = p.buildPrompt('https://example.com/x', { tempDir: '/tmp', tempFile: '/tmp/in.txt', maxChunks: 4 });
    assert.ok(typeof prompt === 'string' && prompt.length > 50, p.name + ' prompt too short');
  }
});

test('parser prompts embed input, tempFile and maxChunks', () => {
  for (const type of ['book', 'paper', 'video', 'web']) {
    const p = parsers.resolve(type);
    const prompt = p.buildPrompt('https://x.test/doc', { tempDir: '/t', maxChunks: 4 });
    assert.ok(prompt.includes('https://x.test/doc'), type + ': input missing');
    assert.ok(prompt.includes('/t\\input.txt') || prompt.includes('/t/input.txt'), type + ': tempFile missing');
    assert.ok(prompt.includes('块数不超过 4 块'), type + ': maxChunks not applied');
  }
});

// ---------- Test: schemas ----------
const schemas = require('../schemas');
test('fetchResultSchema requires saved', () => {
  assert.ok(schemas.fetchResultSchema.required.includes('saved'));
});

test('qualityChecklistSchema requires 5 gates', () => {
  assert.strictEqual(schemas.qualityChecklistSchema.required.length, 5);
});

// ---------- Test: workflow script parses ----------
const wf = require('../workflow');
test('workflow meta is valid', () => {
  assert.strictEqual(wf.meta.name, 'deep-read-summarize');
  assert.ok(wf.meta.phases.length >= 3);
});

test('workflow script parses as async body', () => {
  const fn = new Function('args','phase','agent','parallel','log', 'return (async () => { ' + wf.script + ' })()');
  assert.ok(typeof fn === 'function');
});

// ---------- Test: workflow exports parsers ----------
test('workflow.js exports parser registry', () => {
  assert.ok(wf.parsers && typeof wf.parsers.resolve === 'function');
  assert.strictEqual(wf.parsers.resolve('video').name, 'video');
});

// ---------- Test: fixture is self-authored (no copyright markers) ----------
test('fixture fable.txt exists and is public-domain self-authored', () => {
  const fx = fs.readFileSync(path.join(__dirname, 'fixtures/fable.txt'), 'utf8');
  assert.ok(fx.includes('released into the public domain'));
  assert.ok(!fx.includes('Copyright ©'));
});

// ---------- Test: plugin entry contract (Cordis) ----------
// Regression for 0.3.3: the entry exported only { load, workflow, parsers,
// schemas } - no apply method - so dsh rejected the plugin at startup
// ("invalid plugin, expect function or object with an \"apply\" method"),
// the web server exited immediately, and the launcher just sat waiting on a
// dead port. The entry must satisfy the Cordis contract, always.
const plugin = require('../index');

test('plugin entry satisfies the Cordis contract (function or object with apply)', () => {
  const ok = typeof plugin === 'function' ||
    (plugin && typeof plugin === 'object' && typeof plugin.apply === 'function');
  assert.ok(ok, 'entry must be a function or an object with an apply method');
  assert.ok(typeof plugin.apply === 'function', 'apply must be callable');
});

test('plugin entry carries name + inject for the bundle row', () => {
  assert.ok(typeof plugin.name === 'string' && plugin.name !== '', 'name must be a non-empty string');
  assert.ok(Array.isArray(plugin.inject) && plugin.inject.every((s) => typeof s === 'string'),
    'inject must be an array of strings');
});

test('plugin entry keeps the legacy load/workflow/parsers exports', () => {
  assert.ok(typeof plugin.load === 'function', 'legacy load() export missing');
  assert.ok(plugin.workflow && plugin.workflow.meta, 'workflow export missing');
  assert.ok(plugin.parsers && typeof plugin.parsers.resolve === 'function', 'parsers export missing');
  assert.ok(plugin.schemas, 'schemas export missing');
});

// ---------- Test: security scanner (negative/positive samples) ----------
const { scanDir } = require('../scripts/security-check');
test('security scanner flags fake secrets and skips clean/ignored files', () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'drs-sec-'));
  try {
    // 拼接构造，避免源码中出现完整密钥模式（被 security-check 误报）
    fs.writeFileSync(path.join(t, 'bad.js'), 'const key = "' + 'sk-' + 'abcdefghijklmnopqrstuvwxyz123";');
    fs.writeFileSync(path.join(t, 'good.md'), '# clean\nno secrets here\n');
    fs.mkdirSync(path.join(t, 'node_modules'));
    fs.writeFileSync(path.join(t, 'node_modules', 'dep.js'), 'sk-' + 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    const issues = scanDir(t);
    assert.ok(issues.some(i => i.includes('OpenAI-style key')), 'should flag fake key');
    assert.ok(!issues.some(i => i.includes('good.md')), 'clean file should not be flagged');
    assert.ok(!issues.some(i => i.includes('node_modules')), 'node_modules should be skipped');
  } finally {
    fs.rmSync(t, { recursive: true, force: true });
  }
});

// ---------- Test: workflow script contract（DSH workflow 工具）----------
// 现行契约（0.1.2-rc.1）：agent/parallel/pipeline/phase/log/args 六个钩子；agent() 选项只允许
// label/phase/schema/provider/model（其它选项会被引擎判为 fatal）；schema 只允许
// type/properties/required/additionalProperties/items/enum/const/oneOf + 注解键；
// 脚本沙箱没有文件系统/网络/定时器/require。任何一条违反都会在真机上直接终止整条 workflow。
const workflow = require('../workflow');
const wfScript = workflow.script;

const ALLOWED_SCHEMA_KEYWORDS = [
  'type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'oneOf',
  'description', 'title', 'default', 'examples',
];
const ALLOWED_AGENT_OPTIONS = ['label', 'phase', 'schema', 'provider', 'model'];

/** 从脚本里取出 \`const XSchema = { ... }\` 的字面量并求值（脚本里的 schema 只是对象字面量）。 */
function extractSchemaLiterals(text) {
  const out = [];
  const re = /const (\w*[Ss]chema) = \{/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const from = text.indexOf('{', m.index);
    let depth = 0;
    let i = from;
    for (; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') { depth -= 1; if (depth === 0) break; }
    }
    out.push({ name: m[1], value: eval('(' + text.slice(from, i + 1) + ')') }); // eslint-disable-line no-eval
  }
  return out;
}

/**
 * 递归校验一个 JSON Schema 节点：只允许 DSH 子集的关键字。
 * 只有 schema 位置的关键字受限——\`properties\` 下的键名是数据字段名，不参与校验。
 * @returns {string[]} 违规关键字（含路径）
 */
function unsupportedSchemaKeywords(node, path = '$') {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return [];
  const bad = [];
  for (const key of Object.keys(node)) {
    if (!ALLOWED_SCHEMA_KEYWORDS.includes(key)) bad.push(path + '.' + key);
  }
  if (node.properties && typeof node.properties === 'object') {
    for (const [name, child] of Object.entries(node.properties)) {
      bad.push(...unsupportedSchemaKeywords(child, path + '.properties.' + name));
    }
  }
  if (node.items) bad.push(...unsupportedSchemaKeywords(node.items, path + '.items'));
  if (Array.isArray(node.oneOf)) node.oneOf.forEach((child, i) => bad.push(...unsupportedSchemaKeywords(child, path + '.oneOf[' + i + ']')));
  return bad;
}

test('workflow: agent() schemas stay inside the DSH-supported subset', () => {
  // 违反子集 = 引擎抛 UNSUPPORTED_SCHEMA = 整条 workflow 直接终止（不是降级）。
  const schemas = extractSchemaLiterals(wfScript);
  assert.ok(schemas.length >= 2, 'expected the fetch/check schemas, found ' + schemas.length);
  for (const s of schemas) {
    assert.deepStrictEqual(unsupportedSchemaKeywords(s.value), [],
      s.name + ' uses unsupported schema keyword(s)');
  }
});

test('workflow: the schema-subset checker actually rejects an unsupported keyword', () => {
  // 反向断言：确保上面的“通过”不是因为校验器写空了。
  const bad = unsupportedSchemaKeywords({ type: 'object', properties: { a: { type: 'string', minLength: 3 } } });
  assert.deepStrictEqual(bad, ['$.properties.a.minLength']);
});

test('workflow: agent() options stay inside the engine whitelist', () => {
  const re = /agent\([^,]*,\s*\{([^}]*)\}/g;
  let m;
  let calls = 0;
  while ((m = re.exec(wfScript)) !== null) {
    calls += 1;
    const keys = [];
    const keyRe = /([A-Za-z_][A-Za-z0-9_]*)\s*:/g;
    let k;
    while ((k = keyRe.exec(m[1])) !== null) keys.push(k[1]);
    for (const key of keys) {
      assert.ok(ALLOWED_AGENT_OPTIONS.includes(key),
        'agent() option "' + key + '" is not supported by the engine (allowed: ' + ALLOWED_AGENT_OPTIONS.join(', ') + ')');
    }
  }
  assert.ok(calls >= 5, 'expected the script agent() calls, found ' + calls);
});

test('workflow: the script never reaches for APIs the sandbox does not provide', () => {
  const forbidden = [
    [/\brequire\s*\(/, 'require()'],
    [/\bprocess\s*\./, 'process'],
    [/\bfs\s*\./, 'fs'],
    [/\bfetch\s*\(/, 'fetch()'],
    [/\bsetTimeout\s*\(/, 'setTimeout()'],
    [/\bsetInterval\s*\(/, 'setInterval()'],
    [/\b__dirname\b/, '__dirname'],
    [/\bchild_process\b/, 'child_process'],
  ];
  for (const [re, label] of forbidden) {
    assert.ok(!re.test(wfScript), 'the workflow sandbox provides no ' + label);
  }
});

test('workflow: the script self-contains all four parsers', () => {
  for (const name of ['book', 'paper', 'video', 'web']) {
    assert.ok(wfScript.includes(name + ': { buildPrompt:'), 'parser "' + name + '" is not inlined');
  }
  assert.ok(wfScript.includes('const parsers = args._parsers || __parsers;'), 'the args._parsers fallback is missing');
});

// ---------- Test: skill content（复用本文件顶部已有的 plugin 引用）----------
test('skill content carries meta + script + args and the write-back step', () => {
  const content = plugin.buildSkillContent();
  assert.ok(content.includes(workflow.meta.name), 'meta missing from the skill body');
  assert.ok(content.includes(wfScript), 'the workflow script must be embedded verbatim');
  assert.ok(content.includes('"input"'), 'the args example is missing');
  // 脚本没有文件系统权限：技能必须明确要求主代理把 note 落盘，否则笔记会丢。
  assert.ok(/filePath/.test(content) && /write/.test(content), 'the skill must tell the model to persist note -> filePath');
});

test('plugin entry satisfies the Cordis contract and registers one bundled skill', () => {
  assert.strictEqual(plugin.name, 'deep-read-summarize');
  assert.deepStrictEqual(plugin.inject, ['skills']);
  assert.strictEqual(typeof plugin.apply, 'function');
  const registered = [];
  const ctx = { skills: { register: (skill) => { registered.push(skill); return () => {}; } } };
  const dispose = plugin.apply(ctx, {});
  assert.strictEqual(registered.length, 1);
  assert.strictEqual(registered[0].name, 'deep-read-summarize');
  assert.strictEqual(registered[0].source, 'bundled');
  assert.ok(registered[0].content.length > 1000);
  assert.strictEqual(typeof dispose, 'function');
});

// ---------- Run cache tests ----------
console.log('\n=== cache tests ===');
const cacheResult = require('./cache.test.js');
passed += cacheResult.passed;
failed += cacheResult.failed;

console.log('');
console.log('TOTAL: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);