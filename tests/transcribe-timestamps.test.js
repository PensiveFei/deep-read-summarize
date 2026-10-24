'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const transcribe = require('../scripts/transcribe');
const video = require('../parsers/video');

// Only the Python standard library is used. An in-memory faster_whisper stub
// supplies known segment times; no model, audio decoder, or network is involved.
function findPython() {
  const candidates = process.env.PYTHON ? [process.env.PYTHON, 'python3', 'python'] : ['python3', 'python'];
  for (const cmd of candidates) {
    const probe = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 10000 });
    if (!probe.error && probe.status === 0 && /^Python 3\./.test(probe.stdout || probe.stderr)) return cmd;
  }
  return null;
}
const python = findPython();
const stub = [
  'import json, os, sys, types',
  'fake = types.ModuleType("faster_whisper")',
  'class FakeModel:',
  '    def __init__(self, *args, **kwargs): pass',
  '    def transcribe(self, *args, **kwargs):',
  '        raw = json.loads(os.environ["DRS_TEST_SEGMENTS"])',
  '        return [types.SimpleNamespace(**s) for s in raw], types.SimpleNamespace(language="en", duration=4000.0)',
  'fake.WhisperModel = FakeModel',
  'sys.modules["faster_whisper"] = fake'
].join('\n');

function run(t, segments, timestamps) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drs-timestamp-test-'));
  t.after(function () {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('drs-timestamp-test-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const out = path.join(dir, 'transcript.txt');
  const result = spawnSync(python, ['-c', stub + '\n' + transcribe.PY_RUNNER], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, DRS_AUDIO: 'mock', DRS_OUT: out, DRS_MODEL: 'small',
      DRS_LANG: 'en', DRS_DEVICE: 'cpu', DRS_TIMESTAMPS: timestamps ? '1' : '0',
      DRS_TEST_SEGMENTS: JSON.stringify(segments) }
  });
  assert.equal(result.status, 0, result.stderr || String(result.error || ''));
  assert.ok(!result.stdout.includes('DONE'), 'only the Node validator may announce success');
  return fs.readFileSync(out, 'utf8');
}

test('timestamp flags parse without changing the default', function () {
  assert.equal(transcribe.parseArgs([]).timestamps, false);
  assert.equal(transcribe.parseArgs(['--timestamps']).timestamps, true);
  assert.equal(transcribe.parseArgs(['--timestamps=true']).timestamps, true);
  assert.equal(transcribe.parseArgs(['--timestamps', '--no-timestamps']).timestamps, false);
  assert.equal(transcribe.parseArgs(['--timestamps=false']).timestamps, false);
});

test('runner retains each real segment start/end in timestamped lines', { skip: !python && 'Python unavailable' }, function (t) {
  const text = run(t, [
    { text: ' First segment ', start: 1.234, end: 2.345 },
    { text: 'Second segment', start: 60.125, end: 70.875 }
  ], true);
  assert.equal(text, '[00:00:01.234 --> 00:00:02.345] First segment\n' +
    '[00:01:00.125 --> 00:01:10.875] Second segment');
});

test('runner preserves segment line boundaries when timestamps are disabled', { skip: !python && 'Python unavailable' }, function (t) {
  assert.equal(run(t, [
    { text: '第一段', start: 1.2, end: 5.0 },
    { text: '第二段\n继续', start: 60.0, end: 70.0 }
  ], false), '第一段\n第二段 继续');
});

test('timestamp formatting carries milliseconds across minute/hour boundaries', { skip: !python && 'Python unavailable' }, function (t) {
  assert.equal(run(t, [
    { text: 'Boundary', start: 59.9996, end: 3600.0004 }
  ], true), '[00:01:00.000 --> 01:00:00.000] Boundary');
});

test('empty or whitespace-only segments do not create timestamp-only transcripts', { skip: !python && 'Python unavailable' }, function (t) {
  assert.equal(run(t, [{ text: '   ', start: 1.0, end: 2.0 }], true), '');
  assert.equal(run(t, [], true), '');
});

test('video timestamps propagate to transcription and platform subtitle instructions', function () {
  const on = video.buildPrompt('https://youtu.be/mock', { includeTimestamps: true });
  const off = video.buildPrompt('https://youtu.be/mock', { includeTimestamps: false });
  assert.ok(on.includes('--timestamps'));
  assert.ok(on.includes('B站字幕保留每条 from/to'));
  assert.ok(on.includes('YouTube CC 保留每条 cue 的 start/end'));
  assert.ok(on.includes('[HH:MM:SS.mmm --> HH:MM:SS.mmm]'));
  assert.ok(on.includes('禁止猜测或编造'));
  assert.ok(!off.includes('--timestamps'));
  assert.ok(off.includes('逐段换行'));
  const subtitleOnly = video.buildPrompt('https://youtu.be/mock', { transcribe: false, includeTimestamps: true });
  assert.ok(subtitleOnly.includes('YouTube CC 保留每条 cue 的 start/end'));
  assert.ok(!subtitleOnly.includes('--timestamps'));
});
