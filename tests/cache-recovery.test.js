'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const cache = require('../lib/cache');
const cacheModule = path.join(__dirname, '..', 'lib', 'cache.js');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drs-cache-recovery-'));
  t.after(function () {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('drs-cache-recovery-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir: dir, file: path.join(dir, 'cache.jsonl') };
}

function mockedCache(mockFs, warnings) {
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(cacheModule, 'utf8'), {
    require: function (name) { return name === 'fs' ? mockFs : require(name); },
    module: mod, Buffer: Buffer,
    console: { warn: function () { warnings.push(Array.from(arguments).join(' ')); } }
  }, { filename: cacheModule });
  return mod.exports;
}

test('a truncated tail cannot swallow the next successful cache record', function (t) {
  const f = fixture(t);
  const old = { key: 'old-valid', outputPath: 'old.md', ts: '2020-01-01T00:00:00.000Z' };
  fs.writeFileSync(f.file, JSON.stringify(old) + '\n{"key":"interrupted"');
  assert.equal(cache.markProcessed(f.file, 'new-valid', 'new.md'), true);
  assert.equal(cache.hasProcessed(f.file, 'old-valid'), true);
  assert.equal(cache.hasProcessed(f.file, 'new-valid'), true);
  assert.equal(cache.hasProcessed(f.file, 'interrupted'), false);
  assert.equal(cache.readCache(f.file).size, 2);
});

test('a valid last record without a newline is retained before appending', function (t) {
  const f = fixture(t);
  fs.writeFileSync(f.file, JSON.stringify({ key: 'old', outputPath: 'old.md' }));
  assert.equal(cache.markProcessed(f.file, 'new', 'new.md'), true);
  const records = cache.readCache(f.file);
  assert.equal(records.get('old').outputPath, 'old.md');
  assert.equal(records.get('new').outputPath, 'new.md');
  assert.equal(records.size, 2);
});

test('an interrupted UTF-8 tail is isolated without rewriting existing bytes', function (t) {
  const f = fixture(t);
  const damaged = Buffer.from('{"key":"broken","text":"💥', 'utf8').subarray(0, -1);
  fs.writeFileSync(f.file, damaged);
  assert.equal(cache.markProcessed(f.file, '中文键', '笔记.md'), true);
  assert.deepEqual(fs.readFileSync(f.file).subarray(0, damaged.length), damaged);
  assert.equal(cache.readCache(f.file).get('中文键').outputPath, '笔记.md');
});

test('metadata cannot replace reserved fields or the record serializer', function (t) {
  const f = fixture(t);
  const before = Date.now();
  assert.equal(cache.markProcessed(f.file, 'actual-key', 'actual.md', {
    key: 'forged-key', outputPath: 'forged.md', ts: '2000-01-01T00:00:00.000Z',
    toJSON: function () { return { key: 'serializer-forgery' }; }, source: 'test'
  }), true);
  const records = cache.readCache(f.file);
  assert.equal(records.size, 1);
  const rec = records.get('actual-key');
  assert.equal(rec.key, 'actual-key');
  assert.equal(rec.outputPath, 'actual.md');
  assert.equal(rec.source, 'test');
  assert.ok(Date.parse(rec.ts) >= before && Date.parse(rec.ts) <= Date.now());
  assert.equal(Object.hasOwn(rec, 'toJSON'), false);
  assert.equal(records.has('forged-key'), false);
});

test('short append is reported as failure and the following record still recovers', function (t) {
  const f = fixture(t);
  const warnings = [];
  const mockFs = Object.create(fs);
  let writes = 0, closes = 0;
  mockFs.writeSync = function (fd, buffer, offset, length, position) {
    writes++;
    return fs.writeSync(fd, buffer, offset, Math.floor(length / 2), position);
  };
  mockFs.closeSync = function (fd) { closes++; fs.closeSync(fd); };
  const broken = mockedCache(mockFs, warnings);
  assert.equal(broken.markProcessed(f.file, 'short-write', 'partial.md'), false);
  assert.equal(writes, 1, 'a record must use one append syscall rather than split repair/write steps');
  assert.equal(closes, 1);
  assert.match(warnings.join('\n'), /short append/);
  assert.equal(cache.markProcessed(f.file, 'next-success', 'next.md'), true);
  assert.equal(cache.hasProcessed(f.file, 'next-success'), true);
  assert.equal(cache.hasProcessed(f.file, 'short-write'), false);
  assert.deepEqual(fs.readdirSync(f.dir), ['cache.jsonl'], 'recovery must not leave a lock file');
});

test('append errors close the descriptor and remain nonfatal', function (t) {
  const f = fixture(t);
  const warnings = [];
  const mockFs = Object.create(fs);
  let closes = 0;
  mockFs.writeSync = function () { throw new Error('mock write failure'); };
  mockFs.closeSync = function (fd) { closes++; fs.closeSync(fd); };
  const broken = mockedCache(mockFs, warnings);
  assert.equal(broken.markProcessed(f.file, 'failed', 'failed.md'), false);
  assert.equal(closes, 1);
  assert.match(warnings.join('\n'), /mock write failure/);
  assert.equal(cache.markProcessed(f.file, 'recovered', 'recovered.md'), true);
  assert.equal(cache.hasProcessed(f.file, 'recovered'), true);
});

test('concurrent processes append independent records beside a damaged tail', { timeout: 20000 }, async function (t) {
  const f = fixture(t);
  fs.writeFileSync(f.file, '{"key":"old-partial"');
  const count = 80, processCount = 4;
  const children = [];
  const worker = [
    'const cache = require(' + JSON.stringify(cacheModule) + ');',
    'const [file, id, count] = process.argv.slice(1);',
    'process.once("message", function () {',
    '  let succeeded = 0;',
    '  for (let i = 0; i < Number(count); i++) {',
    '    if (cache.markProcessed(file, id + "-" + i, "out-" + id + "-" + i + ".md", { source: "并发" })) succeeded++;',
    '  }',
    '  process.send({ succeeded: succeeded });',
    '  process.disconnect();',
    '});',
    'process.send({ ready: true });'
  ].join('\n');
  try {
    const ready = [], finished = [];
    for (let i = 0; i < processCount; i++) {
      const child = spawn(process.execPath, ['-e', worker, f.file, String(i), String(count)], {
        stdio: ['ignore', 'ignore', 'pipe', 'ipc']
      });
      children.push(child);
      let result, errors = '';
      child.stderr.on('data', function (data) { errors += data.toString(); });
      ready.push(new Promise(function (resolve, reject) {
        child.once('error', reject);
        child.on('message', function (message) {
          if (message.ready) resolve();
          else result = message;
        });
        child.once('exit', function () { if (!result) reject(new Error('worker exited before readiness: ' + errors)); });
      }));
      finished.push(new Promise(function (resolve, reject) {
        child.once('error', reject);
        child.once('exit', function (code) {
          if (code !== 0 || !result) reject(new Error('worker failed: ' + errors));
          else resolve(result);
        });
      }));
    }
    await Promise.all(ready);
    for (const child of children) child.send({ start: true });
    const results = await Promise.all(finished);
    assert.equal(results.reduce(function (sum, r) { return sum + r.succeeded; }, 0), count * processCount);
    const records = cache.readCache(f.file);
    assert.equal(records.size, count * processCount);
    for (let i = 0; i < processCount; i++) {
      for (let j = 0; j < count; j++) assert.equal(records.get(i + '-' + j).source, '并发');
    }
    assert.deepEqual(fs.readdirSync(f.dir), ['cache.jsonl']);
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill();
  }
});
