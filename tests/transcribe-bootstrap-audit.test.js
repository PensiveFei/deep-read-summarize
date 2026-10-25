'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const transcribe = require('../scripts/transcribe');

const sourceFile = path.join(__dirname, '..', 'scripts', 'transcribe.js');
const source = fs.readFileSync(sourceFile, 'utf8');

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drs-bootstrap-audit-'));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

// Real CLI and filesystem; only uv / Python process execution is replaced.
function harness(t, options) {
  const opts = options || {};
  const dir = temporary(t);
  const env = { LOCALAPPDATA: dir, XDG_CACHE_HOME: dir, PATH: dir };
  const root = transcribe.cacheRoot({ platform: process.platform, env: env, home: dir });
  const py = transcribe.venvPython(path.join(root, 'venv'));
  if (!opts.noPython) {
    fs.mkdirSync(path.dirname(py), { recursive: true });
    fs.writeFileSync(py, 'mock interpreter; never executed');
  }
  if (opts.uv) fs.writeFileSync(path.join(dir, process.platform === 'win32' ? 'uv.exe' : 'uv'), 'mock uv');
  const audio = path.join(dir, 'audio.m4a');
  const out = path.join(dir, 'transcript.txt');
  fs.writeFileSync(audio, 'mock audio; never decoded');
  fs.writeFileSync(out, 'stale output');
  const calls = [], stderr = [], stdout = [];
  let runs = 0;
  const mod = { exports: {} };
  const fakeProcess = {
    platform: process.platform, version: process.version, env: env,
    stdout: { write: function (s) { stdout.push(s); } },
    stderr: { write: function (s) { stderr.push(s); } }
  };
  vm.runInNewContext(source + '\nmodule.exports.testMain = main;', {
    module: mod, process: fakeProcess,
    require: function (name) {
      if (name === 'node:os') return { homedir: function () { return dir; } };
      if (name !== 'node:child_process') return require(name);
      return { spawnSync: function (cmd, args, childOpts) {
        calls.push({ cmd: cmd, args: args, env: childOpts.env });
        if (args[0] === 'venv') {
          fs.mkdirSync(path.dirname(py), { recursive: true });
          fs.writeFileSync(py, 'new mock interpreter');
          return { status: 0 };
        }
        if (args[0] === 'pip') return { status: opts.installFailure ? 1 : 0 };
        assert.equal(cmd, py);
        assert.notEqual(args[0], '-c', 'healthy operation must not launch a separate import probe');
        if (opts.run) return opts.run(runs++, childOpts.env);
        fs.writeFileSync(childOpts.env.DRS_OUT, 'complete transcript');
        return { status: 0 };
      } };
    }
  }, { filename: sourceFile });
  return { audio: audio, out: out, calls: calls, stderr: stderr, stdout: stdout,
    main: function () { return mod.exports.testMain(['--audio', audio, '--out', out]); } };
}

function signal(env, code, reason) {
  fs.writeFileSync(env.DRS_BOOTSTRAP_STATUS, JSON.stringify({ code: code, reason: reason }));
  return { status: code };
}

test('healthy cached transcription needs no uv and starts Python only once', function (t) {
  const h = harness(t);
  assert.equal(h.main(), 0);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].env.DRS_FASTER_WHISPER_VERSION, transcribe.FASTER_WHISPER_VERSION);
  assert.equal(fs.readFileSync(h.out, 'utf8'), 'complete transcript');
});

test('a genuinely missing Python still requires uv before starting a child', function (t) {
  const h = harness(t, { noPython: true });
  assert.equal(h.main(), 1);
  assert.equal(h.calls.length, 0);
  assert.match(h.stderr.join(''), /需要创建 Python 环境/);
  assert.equal(fs.existsSync(h.out), false);
});

for (const missing of [
  { code: transcribe.DEPENDENCY_MISSING, reason: 'missing-dependency' },
  { code: transcribe.DEPENDENCY_VERSION_MISMATCH, reason: 'version-mismatch' }
]) {
  test(missing.reason + ' installs the exact supported package and retries once', function (t) {
    const h = harness(t, { uv: true, run: function (index, env) {
      if (index === 0) return signal(env, missing.code, missing.reason);
      assert.equal(fs.existsSync(env.DRS_BOOTSTRAP_STATUS), false, 'retry must not inherit a stale signal');
      fs.writeFileSync(env.DRS_OUT, 'new result');
      return { status: 0 };
    } });
    assert.equal(h.main(), 0);
    assert.equal(h.calls.length, 3);
    const installs = h.calls.filter(function (c) { return c.args[0] === 'pip'; });
    assert.equal(installs.length, 1);
    assert.ok(installs[0].args.includes('faster-whisper==' + transcribe.FASTER_WHISPER_VERSION));
    assert.equal(fs.readFileSync(h.out, 'utf8'), 'new result');
  });
}

test('missing dependencies without uv fail with an actionable hint', function (t) {
  const h = harness(t, { run: function (index, env) {
    return signal(env, transcribe.DEPENDENCY_MISSING, 'missing-dependency');
  } });
  assert.equal(h.main(), 1);
  assert.equal(h.calls.length, 1);
  assert.match(h.stderr.join(''), /需要安装 faster-whisper==1\.2\.1/);
  assert.equal(fs.existsSync(h.out), false);
});

test('inference errors and matching exit codes without a preflight signal never install', function (t) {
  for (const code of [1, transcribe.DEPENDENCY_MISSING, transcribe.DEPENDENCY_VERSION_MISMATCH]) {
    const h = harness(t, { uv: true, run: function () { return { status: code }; } });
    assert.equal(h.main(), 1);
    assert.equal(h.calls.length, 1);
    assert.equal(fs.existsSync(h.out), false);
  }
});

test('a mismatched preflight reason or exit status cannot request installation', function (t) {
  for (const marker of [
    { code: transcribe.DEPENDENCY_MISSING, reason: 'inference-error' },
    { code: transcribe.DEPENDENCY_VERSION_MISMATCH, reason: 'version-mismatch' }
  ]) {
    const h = harness(t, { uv: true, run: function (index, env) {
      fs.writeFileSync(env.DRS_BOOTSTRAP_STATUS, JSON.stringify(marker));
      return { status: transcribe.DEPENDENCY_MISSING };
    } });
    assert.equal(h.main(), 1);
    assert.equal(h.calls.length, 1);
  }
});

test('a failed installation is not followed by inference or success publication', function (t) {
  const h = harness(t, { uv: true, installFailure: true, run: function (index, env) {
    return signal(env, transcribe.DEPENDENCY_MISSING, 'missing-dependency');
  } });
  assert.equal(h.main(), 1);
  assert.equal(h.calls.length, 2);
  assert.equal(fs.existsSync(h.out), false);
  assert.ok(!h.stdout.join('').includes('DONE'));
});

test('a repeated dependency signal cannot cause an installation loop', function (t) {
  const h = harness(t, { uv: true, run: function (index, env) {
    return signal(env, transcribe.DEPENDENCY_MISSING, 'missing-dependency');
  } });
  assert.equal(h.main(), 1);
  assert.equal(h.calls.length, 3);
  assert.equal(h.calls.filter(function (c) { return c.args[0] === 'pip'; }).length, 1);
  assert.equal(fs.existsSync(h.out), false);
});

test('a fresh environment bootstraps Python then dependencies without an import probe', function (t) {
  const h = harness(t, { uv: true, noPython: true, run: function (index, env) {
    if (index === 0) return signal(env, transcribe.DEPENDENCY_MISSING, 'missing-dependency');
    fs.writeFileSync(env.DRS_OUT, 'fresh environment result');
    return { status: 0 };
  } });
  assert.equal(h.main(), 0);
  assert.deepEqual(h.calls.map(function (c) {
    return c.args[0] === 'venv' || c.args[0] === 'pip' ? c.args[0] : 'runner';
  }), ['venv', 'runner', 'pip', 'runner']);
});

function findPython() {
  for (const cmd of (process.env.PYTHON ? [process.env.PYTHON, 'python3', 'python'] : ['python3', 'python'])) {
    const p = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 10000 });
    if (!p.error && p.status === 0 && /^Python 3\./.test(p.stdout || p.stderr)) return cmd;
  }
  return null;
}
const python = findPython();
const pythonOptions = { skip: !python && 'Python unavailable' };
const stub = [
  'import os, sys, types, importlib.metadata as md, builtins',
  'md.version = lambda name: os.environ.get("DRS_TEST_VERSION", "' + transcribe.FASTER_WHISPER_VERSION + '") if name == "faster-whisper" else "test-version"',
  'fake = types.ModuleType("faster_whisper")',
  'class Model:',
  '    def __init__(self, *args, **kwargs):',
  '        if os.environ.get("DRS_TEST_INFERENCE_MISSING"): raise ModuleNotFoundError("inference-only failure")',
  '        if kwargs.get("device") == "cuda": raise RuntimeError("mock CUDA unavailable")',
  '    def transcribe(self, *args, **kwargs):',
  '        return [types.SimpleNamespace(start=1.0, end=2.0, text=" Complete segment ")], types.SimpleNamespace()',
  'fake.WhisperModel = Model',
  'sys.modules["faster_whisper"] = fake',
  'original_import = builtins.__import__',
  'def test_import(name, *args, **kwargs):',
  '    if name == "faster_whisper" and os.environ.get("DRS_TEST_IMPORT_MISSING"): raise ModuleNotFoundError("missing import dependency")',
  '    return original_import(name, *args, **kwargs)',
  'builtins.__import__ = test_import'
].join('\n');

function runner(t, extraEnv) {
  const dir = temporary(t);
  const out = path.join(dir, 'transcript.txt');
  const statusFile = path.join(dir, 'bootstrap-status.json');
  const runtime = path.join(dir, 'runtime.json');
  const env = Object.assign({}, process.env, {
    DRS_AUDIO: 'mock', DRS_OUT: out, DRS_MODEL: 'small', DRS_DEVICE: 'cpu', DRS_LANG: 'en',
    DRS_FASTER_WHISPER_VERSION: transcribe.FASTER_WHISPER_VERSION,
    DRS_BOOTSTRAP_STATUS: statusFile, DRS_RUNTIME: runtime
  }, extraEnv);
  const result = spawnSync(python, ['-c', stub + '\n' + transcribe.PY_RUNNER], { encoding: 'utf8', timeout: 10000, env: env });
  return { result: result, out: out, statusFile: statusFile, runtime: runtime };
}

test('the Python preflight reports only actual missing imports and version mismatch', pythonOptions, function (t) {
  const absent = runner(t, { DRS_TEST_IMPORT_MISSING: '1' });
  assert.equal(absent.result.status, transcribe.DEPENDENCY_MISSING, absent.result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(absent.statusFile, 'utf8')), {
    code: transcribe.DEPENDENCY_MISSING, reason: 'missing-dependency'
  });
  const mismatch = runner(t, { DRS_TEST_VERSION: '0.0.0' });
  assert.equal(mismatch.result.status, transcribe.DEPENDENCY_VERSION_MISMATCH, mismatch.result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(mismatch.statusFile, 'utf8')), {
    code: transcribe.DEPENDENCY_VERSION_MISMATCH, reason: 'version-mismatch'
  });
});

test('ModuleNotFoundError raised during inference cannot request bootstrap', pythonOptions, function (t) {
  const h = runner(t, { DRS_TEST_INFERENCE_MISSING: '1' });
  assert.equal(h.result.status, 1);
  assert.equal(fs.existsSync(h.statusFile), false);
  assert.equal(fs.existsSync(h.out), false);
  const runtime = JSON.parse(fs.readFileSync(h.runtime, 'utf8'));
  assert.equal(runtime.phase, 'starting', 'failed inference must retain pre-inference version diagnostics');
  assert.equal(runtime.packages['faster-whisper'], transcribe.FASTER_WHISPER_VERSION);
});

test('successful fallback records the actual CPU runtime without changing the transcript', pythonOptions, function (t) {
  const h = runner(t, { DRS_DEVICE: 'cuda' });
  assert.equal(h.result.status, 0, h.result.stderr);
  const runtime = JSON.parse(fs.readFileSync(h.runtime, 'utf8'));
  assert.equal(runtime.packages['faster-whisper'], transcribe.FASTER_WHISPER_VERSION);
  assert.equal(runtime.device, 'cpu');
  assert.equal(runtime.computeType, 'int8');
  assert.equal(runtime.phase, 'completed');
  assert.match(runtime.python, /^3\./);
  assert.equal(fs.readFileSync(h.out, 'utf8'), 'Complete segment');
});

test('an unwritable runtime record warns but does not fail successful transcription', pythonOptions, function (t) {
  const missingParent = path.join(temporary(t), 'not-created', 'runtime.json');
  const h = runner(t, { DRS_RUNTIME: missingParent });
  assert.equal(h.result.status, 0, h.result.stderr);
  assert.match(h.result.stderr, /runtime record unavailable/);
  assert.equal(fs.readFileSync(h.out, 'utf8'), 'Complete segment');
});
