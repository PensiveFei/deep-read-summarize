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

// ---------- Run cache tests ----------
console.log('\n=== cache tests ===');
const cacheResult = require('./cache.test.js');
passed += cacheResult.passed;
failed += cacheResult.failed;

console.log('');
console.log('TOTAL: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);