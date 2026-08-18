// tests/run-tests.js — fixture-driven tests
const assert = require('assert');
const fs = require('fs');
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

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);