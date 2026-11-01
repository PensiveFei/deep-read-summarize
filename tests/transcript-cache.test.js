'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const cache = require('../lib/transcript-cache');
const transcribe = require('../scripts/transcribe');
const { normalizeWorkflowOptions } = require('../lib/options');
const video = require('../parsers/video');
const sourceFile = path.join(__dirname, '..', 'scripts', 'transcribe.js');
const source = fs.readFileSync(sourceFile, 'utf8');
const segments = [{ start: 1.234, end: 2.345, text: '不是十五，是五十。' },
  { start: 60.125, end: 70.875, text: '第二段保留真实时间。' }];

function harness(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drs-content-cache-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('drs-content-cache-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const env = { LOCALAPPDATA: dir, XDG_CACHE_HOME: dir, PATH: dir };
  const root = transcribe.cacheRoot({ platform: process.platform, env, home: dir });
  const py = transcribe.venvPython(path.join(root, 'venv'));
  fs.mkdirSync(path.dirname(py), { recursive: true });
  fs.writeFileSync(py, 'mock Python');
  const packages = path.join(root, 'venv', process.platform === 'win32' ? 'Lib' : 'lib/python3.12', 'site-packages');
  for (const name of ['faster_whisper-1.2.1.dist-info', 'ctranslate2-4.8.1.dist-info']) fs.mkdirSync(path.join(packages, name), { recursive: true });
  const repo = path.join(root, 'hf', 'hub', 'models--test--small');
  fs.mkdirSync(path.join(repo, 'snapshots', 'r1'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'refs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'snapshots', 'r1', 'model.bin'), 'mock weights');
  fs.writeFileSync(path.join(repo, 'refs', 'main'), 'r1');
  const audio = path.join(dir, 'audio.m4a'), out = path.join(dir, 'out.txt');
  fs.writeFileSync(audio, 'audio one');
  const calls = [], stdout = [], stderr = [];
  const state = { status: 0, omitReport: false, failPublication: false };
  const fakeFs = Object.create(fs);
  fakeFs.renameSync = (from, to) => {
    if (to === out && state.failPublication) throw new Error('publication failed');
    fs.renameSync(from, to);
  };
  const mod = { exports: {} };
  vm.runInNewContext(source + '\nmodule.exports.testMain = main;', {
    module: mod,
    process: { platform: process.platform, version: process.version, env,
      stdout: { write: s => stdout.push(s) }, stderr: { write: s => stderr.push(s) } },
    require(name) {
      if (name === 'node:fs') return fakeFs;
      if (name === 'node:os') return { homedir: () => dir };
      if (name !== 'node:child_process') return require(name);
      return { spawnSync(cmd, args, options) {
        calls.push(options.env);
        assert.equal(cmd, py);
        const child = options.env;
        fs.writeFileSync(child.DRS_OUT, cache.render(segments, child.DRS_TIMESTAMPS === '1'));
        if (!state.omitReport) fs.writeFileSync(child.DRS_SEGMENTS, JSON.stringify({ segments, device: 'cpu',
          cpuThreads: Number(child.DRS_CPU_THREADS), duration: 75, timings: { inference: 50 } }));
        return { status: state.status };
      } };
    }
  }, { filename: sourceFile });
  return { dir, root, repo, packages, audio, out, calls, stdout, stderr, state,
    run: extra => mod.exports.testMain(['--audio', audio, '--out', out].concat(extra || [])) };
}

test('a repeat audio uses canonical cached segments without Python, including timestamp changes', t => {
  const h = harness(t);
  assert.equal(h.run(), 0);
  assert.equal(h.calls.length, 1);
  assert.equal(h.run(['--timestamps']), 0);
  assert.equal(h.calls.length, 1);
  assert.equal(fs.readFileSync(h.out, 'utf8'), cache.render(segments, true));
  assert.match(h.stdout.join(''), /"cacheHit":true/);
  assert.deepEqual(fs.readdirSync(h.dir).filter(n => n.startsWith('.drs-transcribe-')), []);
});

test('changed audio, decoding options, model refs and environment versions all miss the cache', t => {
  const h = harness(t);
  assert.equal(h.run(), 0);
  fs.writeFileSync(h.audio, 'audio two');
  assert.equal(h.run(), 0);
  assert.equal(h.calls.length, 2);
  assert.equal(h.run(['--cpu-threads', '8']), 0);
  assert.equal(h.calls.at(-1).DRS_CPU_THREADS, '8');
  assert.equal(h.run(['--language', 'en']), 0);
  assert.equal(h.run(['--model', 'base']), 0);
  assert.equal(h.run(['--device', 'auto']), 0);
  assert.equal(h.calls.length, 6);
  fs.writeFileSync(path.join(h.repo, 'refs', 'main'), 'r2');
  assert.equal(h.run(), 0);
  fs.mkdirSync(path.join(h.packages, 'av-18.1.1.dist-info'));
  assert.equal(h.run(), 0);
  assert.equal(h.calls.length, 8);
});

test('force refresh, cache disable and safe clear do not reuse stale transcripts', t => {
  const h = harness(t);
  assert.equal(h.run(), 0);
  assert.equal(h.run(['--refresh-cache']), 0);
  assert.equal(h.run(['--no-cache']), 0);
  assert.equal(h.calls.length, 3);
  assert.equal(h.run(['--self-check', '--clear-cache']), 0);
  assert.equal(h.run(), 0);
  assert.equal(h.calls.length, 3, 'self-check must remain read-only even with clear-cache present');
  const unrelated = path.join(cache.directory(h.root), 'keep.txt');
  fs.writeFileSync(unrelated, 'keep');
  assert.equal(h.run(['--clear-cache']), 0);
  assert.equal(fs.readFileSync(unrelated, 'utf8'), 'keep');
  assert.ok(fs.existsSync(path.join(h.repo, 'snapshots', 'r1', 'model.bin')));
  assert.equal(h.run(), 0);
  assert.equal(h.calls.length, 4);
});

test('corrupted, expired and checksum-mismatched cache entries rerun inference', t => {
  const h = harness(t);
  assert.equal(h.run(), 0);
  const file = path.join(cache.directory(h.root), fs.readdirSync(cache.directory(h.root))[0]);
  fs.writeFileSync(file, '{truncated');
  assert.equal(h.run(), 0);
  let entry = JSON.parse(fs.readFileSync(file, 'utf8'));
  entry.report.segments[0].text = '错误的旧稿';
  fs.writeFileSync(file, JSON.stringify(entry));
  assert.equal(h.run(), 0);
  entry = JSON.parse(fs.readFileSync(file, 'utf8'));
  entry.createdAt = 0;
  fs.writeFileSync(file, JSON.stringify(entry));
  assert.equal(h.run(), 0);
  assert.equal(h.calls.length, 4);
  assert.equal(fs.readFileSync(h.out, 'utf8'), cache.render(segments, false));
});

test('failed inference and missing canonical evidence never populate the cache', t => {
  const h = harness(t);
  h.state.status = 1;
  assert.equal(h.run(), 1);
  assert.equal(fs.existsSync(h.out), false);
  h.state.status = 0;
  h.state.omitReport = true;
  assert.equal(h.run(), 0);
  assert.equal(h.run(), 0);
  assert.equal(h.calls.length, 3);
  assert.equal(fs.existsSync(cache.directory(h.root)), false);
});

test('a cache hit still requires current-task atomic publication before DONE', t => {
  const h = harness(t);
  assert.equal(h.run(), 0);
  h.stdout.length = 0;
  h.state.failPublication = true;
  assert.equal(h.run(), 1);
  assert.equal(h.calls.length, 1);
  assert.equal(fs.existsSync(h.out), false);
  assert.ok(!h.stdout.join('').includes('DONE'));
  assert.deepEqual(fs.readdirSync(h.dir).filter(n => n.startsWith('.drs-transcribe-')), []);
});

test('unavailable cache storage preserves successful transcription and repeats inference', t => {
  const h = harness(t);
  fs.writeFileSync(cache.directory(h.root), 'blocked directory');
  assert.equal(h.run(), 0);
  assert.equal(h.run(), 0);
  assert.equal(h.calls.length, 2);
  assert.equal(fs.readFileSync(h.out, 'utf8'), cache.render(segments, false));
});

test('cache validation rejects invalid times, empty segments and local/custom model identities', t => {
  const h = harness(t);
  for (const invalid of [[], [{ ...segments[0], start: -1 }], [{ ...segments[0], end: NaN }],
    [{ ...segments[0], end: 0 }], [{ ...segments[0], text: '' }], [{ ...segments[0], text: 'a\nb' }]]) {
    assert.equal(cache.validSegments(invalid), false);
  }
  assert.equal(cache.runtimeIdentity(h.root, h.repo), null);
  assert.equal(cache.runtimeIdentity(path.join(h.dir, 'absent'), 'small'), null);
  const config = { model: 'small', language: 'zh', device: 'cpu', cpuThreads: 0 };
  assert.notEqual(cache.identity('audio', config, 'runtime', 'runner-v1').key,
    cache.identity('audio', config, 'runtime', 'runner-v2').key, 'runner updates invalidate old decoding results');
  const bytes = Buffer.alloc(2 * 1024 * 1024 + 3, 97);
  fs.writeFileSync(h.audio, bytes);
  assert.equal(cache.hashFile(h.audio), crypto.createHash('sha256').update(bytes).digest('hex'));
});

test('pruning caps cache bytes and leaves unrelated files and directories untouched', t => {
  const h = harness(t), dir = cache.directory(h.root);
  fs.mkdirSync(dir);
  const older = path.join(dir, 'a'.repeat(64) + '.json'), newer = path.join(dir, 'b'.repeat(64) + '.json');
  fs.writeFileSync(older, 'old123'); fs.utimesSync(older, new Date(100000), new Date(100000));
  fs.writeFileSync(newer, 'new123');
  fs.mkdirSync(path.join(dir, 'c'.repeat(64) + '.json'));
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'unrelated');
  cache.prune(h.root, 6);
  assert.equal(fs.existsSync(older), false);
  assert.equal(fs.existsSync(newer), true);
  assert.equal(fs.readFileSync(path.join(dir, 'notes.txt'), 'utf8'), 'unrelated');
  cache.clear(h.root);
  assert.equal(fs.existsSync(newer), false);
  assert.ok(fs.statSync(path.join(dir, 'c'.repeat(64) + '.json')).isDirectory());
});

test('thread and cache options validate and reach the video command', () => {
  assert.equal(normalizeWorkflowOptions().cpuThreads, 0);
  assert.equal(normalizeWorkflowOptions().transcriptCache, true);
  for (const value of [-1, 65, 1.5, '8', Infinity]) assert.throws(() => normalizeWorkflowOptions({ cpuThreads: value }), /FATAL/);
  assert.throws(() => normalizeWorkflowOptions({ transcriptCache: 'false' }), /FATAL/);
  const prompt = video.buildPrompt('https://youtu.be/mock', { cpuThreads: 8, transcriptCache: false });
  assert.match(prompt, /--cpu-threads 8 --no-cache/);
  assert.match(prompt, /缓存不能代替后续精读和独立原文核验/);
});

test('compiled workflow forwards thread and transcript-cache options to acquisition', async () => {
  const workflow = require('../workflow');
  const execute = new Function('args', 'phase', 'agent', 'parallel', 'log', 'return (async () => { ' + workflow.script + ' })()');
  let fetchPrompt;
  const result = await execute({ input: 'https://youtu.be/mock', type: 'video', options: {
    cpuThreads: 6, transcriptCache: false
  } }, () => {}, async prompt => { fetchPrompt = prompt; return { saved: false, message: 'fixture stop' }; },
  functions => Promise.all(functions.map(fn => fn())), () => {});
  assert.equal(result.stage, 'fetch');
  assert.match(fetchPrompt, /--cpu-threads 6 --no-cache/);
});
