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