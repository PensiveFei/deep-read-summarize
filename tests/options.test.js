'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { DEFAULT_OPTIONS, normalizeWorkflowOptions } = require('../lib/options');
const plugin = require('../index');
const workflow = require('../workflow');

test('B07 the embedded validator and plugin config share exactly the same defaults and normalization', function () {
  const normalize = vm.runInNewContext('(' + normalizeWorkflowOptions.toString() + ')');
  const options = { minWords: 100000, maxChunks: 99, maxRetries: 3, language: 'JA', frontmatter: 'Generic', device: 'CUDA' };
  const expected = normalizeWorkflowOptions(options);
  assert.deepEqual(JSON.parse(JSON.stringify(normalize(options))), expected);
  const warnings = [];
  assert.deepEqual(normalizeWorkflowOptions(options, { mode: 'config', warn: message => warnings.push(message) }), expected);
  assert.equal(expected.maxChunks, 12);
  assert.ok(warnings.some(message => message.includes('capped at 12')));
  assert.deepEqual(plugin.normalizeOptions(), DEFAULT_OPTIONS);
  assert.ok(workflow.script.includes('const normalizeWorkflowOptions = '));
});

test('B07 invalid numeric options reject nonfinite, fractional, negative and excessive retry values', function () {
  for (const [key, values] of [
    ['minWords', [0, -1, 1.5, NaN, Infinity, 100001, '2500']],
    ['maxChunks', [0, -1, 1.5, NaN, Infinity, '4']],
    ['maxRetries', [-1, 0.5, NaN, Infinity, 4, '0']]
  ]) {
    for (const value of values) assert.throws(function () { normalizeWorkflowOptions({ [key]: value }); }, /\[FATAL\] options\./);
  }
  assert.equal(normalizeWorkflowOptions({ maxRetries: 0 }).maxRetries, 0);
  assert.equal(normalizeWorkflowOptions({ maxChunks: 1 }).maxChunks, 1);
});

test('B07 options must be an object containing known keys with valid booleans, paths and enumerations', function () {
  for (const raw of [null, [], 'options', false, 1, { unknown: true }]) {
    assert.throws(function () { normalizeWorkflowOptions(raw); }, /\[FATAL\]/);
  }
  for (const raw of [
    { fastMode: 'false' }, { transcribe: 0 }, { includeTimestamps: null },
    { outputDir: '' }, { tempDir: ' \t' }, { outputDir: 'bad\npath' },
    { device: 'gpu' }, { frontmatter: 'hugo' }, { whisperModel: 'small; echo bad' },
    { language: 'en --device cuda' }
  ]) assert.throws(function () { normalizeWorkflowOptions(raw); }, /\[FATAL\]/);
});

test('B07 tolerant plugin configuration warns and defaults only invalid fields', function () {
  const warnings = [];
  const original = console.warn;
  console.warn = function (message) { warnings.push(message); };
  let result;
  try {
    result = plugin.normalizeOptions({ options: {
      minWords: -5, maxChunks: 1.2, maxRetries: 4, transcribe: 'false',
      outputDir: 'D:/my notes', frontmatter: 'generic', typo: true
    } });
    assert.deepEqual(plugin.normalizeOptions({ options: null }), DEFAULT_OPTIONS);
  } finally { console.warn = original; }
  assert.equal(result.minWords, DEFAULT_OPTIONS.minWords);
  assert.equal(result.maxChunks, DEFAULT_OPTIONS.maxChunks);
  assert.equal(result.maxRetries, DEFAULT_OPTIONS.maxRetries);
  assert.equal(result.transcribe, DEFAULT_OPTIONS.transcribe);
  assert.equal(result.outputDir, 'D:/my notes');
  assert.equal(result.frontmatter, 'generic');
  assert.ok(warnings.some(message => message.includes('unknown config key(s): typo')));
  assert.ok(warnings.some(message => message.includes('config.maxRetries')));
});

test('B07 direct workflow invalid options fail before invoking any agent', async function () {
  const execute = new Function('args', 'phase', 'agent', 'parallel', 'log',
    'return (async () => { ' + workflow.script + ' })()');
  for (const options of [null, [], { minWords: -1 }, { fastMode: 'false' }, { maxRetries: 10 }, { typo: true }]) {
    let calls = 0;
    await assert.rejects(execute({ input: 'fixture', type: 'paper', options }, function () {}, function () { calls++; }, function () {}, function () {}), /\[FATAL\]/);
    assert.equal(calls, 0);
  }
});
