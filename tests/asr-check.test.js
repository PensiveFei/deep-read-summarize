// tests/asr-check.test.js — 装配检查自己的判据（不装 uv、不跑模型）
//
// 这些断言保护的是「判据本身」：静音没被拦住、缓存假命中、metrics 解析错位，
// 都会让这条检查变成装饰。真正的转写由 scripts/asr-check.js 在手动 workflow 里跑。
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { parseMetrics, judge } = require('../scripts/asr-check');
const { writeSilenceWav } = require('../tests/fixtures/audio/silence');

test('parseMetrics takes the last metrics line and ignores everything else', () => {
  const stdout = [
    '[transcribe] 创建 venv（Python 3.12）：C:\\tmp\\venv',
    '[transcribe] metrics {"cacheHit":false,"device":"cpu","duration":9.5}',
    'TRANSCRIBED 42 bytes to out.txt',
    'DONE',
    '[transcribe] metrics {"cacheHit":true,"device":"cpu","duration":9.5}'
  ].join('\n');
  const metrics = parseMetrics(stdout);
  assert.equal(metrics.cacheHit, true);
  assert.equal(metrics.duration, 9.5);
});

test('parseMetrics returns null instead of throwing on malformed input', () => {
  assert.equal(parseMetrics(''), null);
  assert.equal(parseMetrics('[transcribe] metrics {not json}'), null);
});

test('judge passes a healthy run', () => {
  const report = judge([
    { name: 'a', status: 0, stdout: '[transcribe] metrics {"cacheHit":false}', outBytes: 120, expectCacheHit: false },
    { name: 'b', status: 0, stdout: '[transcribe] metrics {"cacheHit":true}', outBytes: 120, expectCacheHit: true },
    { name: 'c', status: 3, stdout: '转写结果为空（0 字节）：音频可能是纯静音', outBytes: 0, expectFail: true }
  ]);
  assert.equal(report.ok, true, report.failures.join('; '));
});

test('judge fails when the silent input is accepted', () => {
  const report = judge([
    { name: '静音', status: 0, stdout: '[transcribe] metrics {"cacheHit":false}', outBytes: 0, expectFail: true }
  ]);
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => f.includes('不该成功')), report.failures.join('; '));
});

test('judge fails when a failed run still leaves an output file', () => {
  const report = judge([
    { name: '静音', status: 3, stdout: '转写结果为空（0 字节）', outBytes: 12, expectFail: true }
  ]);
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => f.includes('不该留下输出文件')), report.failures.join('; '));
});

test('judge fails when the second run does not reuse the cache', () => {
  const report = judge([
    { name: 'b', status: 0, stdout: '[transcribe] metrics {"cacheHit":false}', outBytes: 120, expectCacheHit: true }
  ]);
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => f.includes('期望命中缓存')), report.failures.join('; '));
});

test('judge fails when metrics are missing or the transcript is empty', () => {
  const report = judge([
    { name: 'a', status: 0, stdout: 'no metrics here', outBytes: 0, expectCacheHit: false }
  ]);
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => f.includes('输出文件为空')), report.failures.join('; '));
  assert.ok(report.failures.some((f) => f.includes('metrics')), report.failures.join('; '));
});

test('the silence fixture writes a valid 10-second PCM header', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drs-wav-'));
  try {
    const file = path.join(dir, 's.wav');
    const info = writeSilenceWav(file, 10);
    assert.equal(info.seconds, 10);
    assert.equal(info.bytes, 44 + 16000 * 2 * 10);
    const head = fs.readFileSync(file).subarray(0, 12).toString('latin1');
    assert.equal(head.slice(0, 4), 'RIFF');
    assert.equal(head.slice(8, 12), 'WAVE');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
