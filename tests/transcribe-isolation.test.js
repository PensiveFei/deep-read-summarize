'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const transcribe = require('../scripts/transcribe');
const video = require('../parsers/video');

const scriptFile = path.join(__dirname, '..', 'scripts', 'transcribe.js');
const source = fs.readFileSync(scriptFile, 'utf8');

// Run the real CLI implementation against real temporary files. Child processes
// are replaced at the require boundary: no uv, Python, network, or model is used.
function harness(t, options) {
  const opts = options || {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drs-transcribe-test-'));
  t.after(function () {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('drs-transcribe-test-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const env = { LOCALAPPDATA: dir, XDG_CACHE_HOME: dir, PATH: dir };
  const root = transcribe.cacheRoot({ platform: process.platform, env: env, home: dir });
  const py = transcribe.venvPython(path.join(root, 'venv'));
  fs.mkdirSync(path.dirname(py), { recursive: true });
  if (!opts.bootstrapFailure) fs.writeFileSync(py, 'mock interpreter; never executed');
  fs.writeFileSync(path.join(dir, process.platform === 'win32' ? 'uv.exe' : 'uv'), 'mock uv; never executed');
  const audio = path.join(dir, 'audio.m4a');
  const out = path.join(dir, 'transcript.txt');
  fs.writeFileSync(audio, 'mock audio; never decoded');
  fs.writeFileSync(out, 'stale transcript from another video');
  const stdout = [], stderr = [], calls = [], publications = [];
  const mockFs = Object.create(fs);
  mockFs.renameSync = function (from, to) {
    publications.push({ from: from, to: to, text: fs.readFileSync(from, 'utf8') });
    assert.equal(fs.existsSync(to), false, 'final output must stay absent until publication');
    if (opts.publishFailure) throw new Error('mock rename failure');
    fs.renameSync(from, to);
  };
  const fakeProcess = {
    platform: process.platform, version: process.version, env: env,
    stdout: { write: function (s) { stdout.push(s); } },
    stderr: { write: function (s) { stderr.push(s); } }
  };
  const fakeChild = {
    spawnSync: function (cmd, args, childOpts) {
      calls.push({ cmd: cmd, args: args, env: childOpts.env });
      if (args[0] === 'venv') {
        assert.ok(opts.bootstrapFailure, 'unexpected bootstrap');
        assert.equal(fs.existsSync(out), false, 'stale output must be removed before bootstrap');
        return { status: 1 };
      }
      if (args[0] === '-c') {
        assert.equal(fs.existsSync(out), false, 'stale output must be removed before the import probe');
        return { status: 0 };
      }
      assert.equal(cmd, py, 'only the mock venv interpreter may be requested');
      assert.equal(path.dirname(args[0]), path.dirname(childOpts.env.DRS_OUT));
      assert.equal(path.dirname(path.dirname(childOpts.env.DRS_OUT)), dir);
      return opts.transcribe(childOpts.env.DRS_OUT, childOpts.env, args[0]);
    }
  };
  const mod = { exports: {} };
  function fakeRequire(name) {
    if (name === 'node:child_process') return fakeChild;
    if (name === 'node:fs') return mockFs;
    if (name === 'node:os') return { homedir: function () { return dir; } };
    return require(name);
  }
  vm.runInNewContext(source + '\nmodule.exports.testMain = main;', {
    require: fakeRequire, module: mod, process: fakeProcess, console: console
  }, { filename: scriptFile });
  return { dir: dir, audio: audio, out: out, main: mod.exports.testMain,
    stdout: stdout, stderr: stderr, calls: calls, publications: publications };
}

function assertNoStaging(h) {
  assert.deepEqual(fs.readdirSync(h.dir).filter(function (name) {
    return name.startsWith('.drs-transcribe-');
  }), []);
}

test('failed transcription removes stale output and cleans a partially written transcript', function (t) {
  let h;
  h = harness(t, { transcribe: function (staged) {
    assert.equal(fs.existsSync(h.out), false);
    fs.writeFileSync(staged, 'incomplete transcript');
    assert.equal(fs.existsSync(h.out), false);
    return { status: 1 };
  } });
  assert.equal(h.main(['--audio', h.audio, '--out', h.out]), 1);
  assert.equal(fs.existsSync(h.out), false);
  assert.equal(h.publications.length, 0);
  assert.ok(!h.stdout.join('').includes('DONE'));
  assertNoStaging(h);
});

test('an empty transcript fails without publishing or announcing success', function (t) {
  const h = harness(t, { transcribe: function (staged) {
    fs.writeFileSync(staged, '');
    return { status: 0 };
  } });
  assert.equal(h.main(['--audio', h.audio, '--out', h.out]), 3);
  assert.equal(fs.existsSync(h.out), false);
  assert.equal(h.publications.length, 0);
  assert.ok(!h.stdout.join('').includes('DONE'));
  assert.ok(!h.stdout.join('').includes('TRANSCRIBED'));
  assertNoStaging(h);
});

test('a complete transcript is published by rename only after the child succeeds', function (t) {
  let h;
  h = harness(t, { transcribe: function (staged) {
    assert.notEqual(staged, h.out);
    fs.writeFileSync(staged, 'first half');
    assert.equal(fs.existsSync(h.out), false);
    fs.appendFileSync(staged, ' and final half');
    assert.equal(h.publications.length, 0);
    assert.ok(!h.stdout.join('').includes('DONE'));
    return { status: 0 };
  } });
  assert.equal(h.main(['--audio', h.audio, '--out', h.out]), 0);
  assert.equal(fs.readFileSync(h.out, 'utf8'), 'first half and final half');
  assert.equal(h.publications.length, 1);
  assert.equal(h.publications[0].text, 'first half and final half');
  assert.match(h.stdout.join(''), /TRANSCRIBED .*\nDONE\n$/);
  assertNoStaging(h);
});

test('bootstrap failure also removes stale output and cleans its staging directory', function (t) {
  const h = harness(t, { bootstrapFailure: true });
  assert.equal(h.main(['--audio', h.audio, '--out', h.out]), 1);
  assert.equal(fs.existsSync(h.out), false);
  assert.ok(!h.stdout.join('').includes('DONE'));
  assertNoStaging(h);
});

test('a missing new transcript cannot fall back to the old output', function (t) {
  const h = harness(t, { transcribe: function () { return { status: 0 }; } });
  assert.equal(h.main(['--audio', h.audio, '--out', h.out]), 1);
  assert.equal(fs.existsSync(h.out), false);
  assert.ok(!h.stdout.join('').includes('DONE'));
  assertNoStaging(h);
});

test('publication failure leaves neither an old result nor a partial transcript', function (t) {
  const h = harness(t, { publishFailure: true, transcribe: function (staged) {
    fs.writeFileSync(staged, 'complete but unpublishable');
    return { status: 0 };
  } });
  assert.equal(h.main(['--audio', h.audio, '--out', h.out]), 1);
  assert.equal(fs.existsSync(h.out), false);
  assert.ok(!h.stdout.join('').includes('DONE'));
  assertNoStaging(h);
});

test('invalid audio removes stale output without launching a child', function (t) {
  const h = harness(t);
  assert.equal(h.main(['--audio', path.join(h.dir, 'missing.m4a'), '--out', h.out]), 1);
  assert.equal(fs.existsSync(h.out), false);
  assert.equal(h.calls.length, 0);
  assertNoStaging(h);
});

test('stale-output cleanup never deletes an audio file used as its own output', function (t) {
  const h = harness(t);
  assert.equal(h.main(['--audio', h.audio, '--out', h.audio]), 1);
  assert.equal(fs.readFileSync(h.audio, 'utf8'), 'mock audio; never decoded');
  assert.equal(h.calls.length, 0);
  assertNoStaging(h);
});

test('interleaved calls keep their scripts and staged transcripts separate', function (t) {
  let h, otherAudio, otherOut, nestedStatus;
  const stagedPaths = [], scriptPaths = [];
  h = harness(t, { transcribe: function (staged, env, script) {
    stagedPaths.push(staged);
    scriptPaths.push(script);
    if (env.DRS_AUDIO === h.audio) {
      fs.writeFileSync(staged, 'first call incomplete');
      nestedStatus = h.main(['--audio', otherAudio, '--out', otherOut]);
      assert.equal(fs.existsSync(h.out), false);
      assert.equal(fs.readFileSync(staged, 'utf8'), 'first call incomplete');
      fs.writeFileSync(staged, 'first call complete');
    } else {
      assert.equal(env.DRS_AUDIO, otherAudio);
      fs.writeFileSync(staged, 'second call complete');
    }
    return { status: 0 };
  } });
  otherAudio = path.join(h.dir, 'other-audio.m4a');
  otherOut = path.join(h.dir, 'other-transcript.txt');
  fs.writeFileSync(otherAudio, 'another mock audio');
  fs.writeFileSync(otherOut, 'another stale transcript');
  assert.equal(h.main(['--audio', h.audio, '--out', h.out]), 0);
  assert.equal(nestedStatus, 0);
  assert.equal(new Set(stagedPaths).size, 2);
  assert.equal(new Set(scriptPaths).size, 2);
  assert.equal(fs.readFileSync(h.out, 'utf8'), 'first call complete');
  assert.equal(fs.readFileSync(otherOut, 'utf8'), 'second call complete');
  assertNoStaging(h);
});

test('the embedded runner cannot announce DONE before the Node validator', function () {
  assert.ok(!/print\(['"]DONE/.test(transcribe.PY_RUNNER));
});

test('video completion requires the current process and current task artifact', function () {
  const prompt = video.buildPrompt('https://youtu.be/example', { tempDir: './.tmp/task-unique' });
  assert.ok(prompt.includes('本次进程退出码为 0'));
  assert.ok(prompt.includes('./.tmp/task-unique/transcript.txt'));
  assert.ok(prompt.includes('不要仅凭文件非空/稳定或日志出现 DONE 判断完成'));
  assert.ok(prompt.includes('超时则终止本次进程'));
});
