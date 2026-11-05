'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const cache = require('../lib/read-cache');
const plugin = require('../index');

function rootFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drs-read-cache-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('cache keys include actual bytes, exact prompt and explicit model identity, while run paths are normalized', t => {
  const root = rootFixture(t), dir = path.join(root, 'run-test123'), file = path.join(dir, 'input.txt');
  fs.mkdirSync(dir); fs.writeFileSync(file, 'source');
  const digest = cache.sourceHash(root, dir, file), key = cache.keyFor(digest, 'provider/model@v1 settings', 'read ' + file + ' lines 1-2', file);
  assert.ok(key);
  assert.equal(key, cache.keyFor(digest, 'provider/model@v1 settings', 'read /other/input.txt lines 1-2', '/other/input.txt'));
  assert.notEqual(key, cache.keyFor(digest, 'provider/model@v2 settings', 'read ' + file + ' lines 1-2', file));
  assert.notEqual(key, cache.keyFor(digest, 'provider/model@v1 settings', 'read ' + file + ' lines 1-3', file));
  fs.writeFileSync(file, 'changed');
  assert.notEqual(digest, cache.sourceHash(root, dir, file));
  assert.equal(cache.sourceHash(root, root, file), null);
  assert.equal(cache.keyFor(digest, '', 'prompt', file), null);
  assert.equal(cache.portable('quoted path: ' + file, dir), false);
  assert.equal(cache.portable('plain notes with a line reference', dir), true);
});

test('cache rejects corrupt entries and invalid identities', t => {
  const root = rootFixture(t), key = 'a'.repeat(64);
  assert.equal(cache.write(root, key, 'valid note'), true);
  assert.equal(cache.read(root, key), 'valid note');
  const entry = path.join(root, '.read-cache-v1', key + '.json');
  const record = JSON.parse(fs.readFileSync(entry, 'utf8')); record.note = 'tampered';
  fs.writeFileSync(entry, JSON.stringify(record));
  assert.equal(cache.read(root, key), null);
  assert.equal(cache.write(root, '../escape', 'bad'), false);
  assert.throws(() => plugin.normalizeWorkflowOptions({ readCache: true }), /readCacheIdentity/);
  assert.equal(plugin.normalizeWorkflowOptions({ readCache: true, readCacheIdentity: 'provider/model@v1;temp=0' }).readCache, true);
});

test('source hashing rejects symlinks and missing or out-of-root files', t => {
  const root = rootFixture(t), outside = rootFixture(t);
  const dir = path.join(root, 'run-link');
  fs.mkdirSync(dir);
  const target = path.join(outside, 'target.txt');
  const file = path.join(dir, 'input.txt');
  fs.writeFileSync(target, 'private data');
  assert.equal(cache.sourceHash(root, dir, file), null);
  try { fs.symlinkSync(target, file, 'file'); } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') { t.skip('symlink creation unavailable'); return; }
    throw error;
  }
  assert.equal(cache.sourceHash(root, dir, file), null);
  assert.equal(cache.sourceHash(outside, dir, file), null);
});

test('plugin entry reuses only validated notes and still performs independent quality review', async t => {
  const root = rootFixture(t);
  let tool, reads = 0, reviews = 0, fetches = 0, sourceFile, mutate = false, qualityOk = true, noteWithPath = false, content = '这是原文引句。\n另一行。';
  const engine = { start({ script, args }) {
    const result = vm.runInNewContext('(async () => {\n' + script + '\n})()', {
      args, phase() {}, log() {}, parallel: tasks => Promise.all(tasks.map(task => task())),
      async agent(prompt, options) {
        if (options.label === '获取+分块') {
          const file = prompt.match(/目标文件：(.+?)（先创建目录/)[1];
          fetches++; sourceFile = file;
          fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content);
          return { saved: true, totalLines: 2, metadata: { title: 'T' }, chunkPlan: [{ id: 1, topic: 'all', startLine: 1, endLine: 2 }] };
        }
        if (options.label === '精读块') { reads++; return '精读结果：原文引句。' + (noteWithPath ? sourceFile : ''); }
        if (options.label === '汇总成稿') return prompt.match(/模板：\n(---[\s\S]*?\n---)/)[1] + '\n# T\n\n## 1. 概述\n主题。\n\n## 2. 结构\n结构。\n\n## 3. 概念\n概念。\n\n## 4. 引用\n“原文引句”（第 1 行）';
        if (options.label === '质量校验') { reviews++; if (mutate) { mutate = false; content = '发生变化的原文引句。\n另一行。'; fs.writeFileSync(sourceFile, content); } return { sourceChecked: qualityOk, coverage: true, citationsReal: true, terminologyConsistent: true, languageConsistent: true, chunkChecks: [{ chunkId: 1, startLine: 1, endLine: 2, sourceExcerpt: '这是原文引句。', covered: true }], citationChecks: [{ quote: '原文引句', sourceQuote: '这是原文引句。', chunkId: 1, startLine: 1, endLine: 1, location: '第 1 行', verified: true }], issues: [] }; }
        throw new Error('unexpected: ' + options.label);
      }
    }).then(value => ({ stopReason: 'completed', value }));
    return { result, dispose: async () => {} };
  } };
  plugin.apply({ get(name) { return name === 'tools' ? { register(value) { tool = value; } } : engine; }, skills: { register() {} } });
  const opts = { minWords: 1, fastMode: true, tempDir: root, readCache: true, readCacheIdentity: 'provider/model@v1;temperature=0' };
  async function invoke(extra = {}) { return tool.execute({ input: 'fixture', type: 'paper', options: { ...opts, ...extra } }, { agent: {} }); }
  const first = await invoke(); assert.equal(first.qualityPassed, true); assert.equal(reads, 1); assert.equal(reviews, 1);
  const second = await invoke(); assert.equal(second.qualityPassed, true); assert.equal(reads, 1); assert.equal(reviews, 2); assert.equal(second.readTimings[0].cacheHit, true);
  assert.equal(Object.hasOwn(second, '__cacheReads'), false);
  await invoke({ readCacheIdentity: 'provider/model@v2;temperature=0' }); assert.equal(reads, 2);
  content = '这是新的原文引句。\n另一行。';
  await invoke(); assert.equal(reads, 3);
  const previousFetches = fetches;
  mutate = true;
  const changedDuringRun = await invoke();
  assert.equal(fetches, previousFetches + 2, 'source mutation triggers a fresh non-cached run');
  assert.equal(reads, 4);
  assert.equal(changedDuringRun.readTimings[0].cacheHit, false);
  qualityOk = false;
  await invoke({ readCacheIdentity: 'failed-qc' }); await invoke({ readCacheIdentity: 'failed-qc' });
  assert.equal(reads, 6, 'failed quality checks must not populate cache');
  qualityOk = true; noteWithPath = true;
  await invoke({ readCacheIdentity: 'nonportable' }); await invoke({ readCacheIdentity: 'nonportable' });
  assert.equal(reads, 8, 'notes with ephemeral run paths must not populate cache');
});

test('plugin abort after acquisition never starts resume or writes cache', async t => {
  const root = rootFixture(t), controller = new AbortController();
  let tool, starts = 0, disposals = 0;
  const engine = { start() {
    starts++;
    controller.abort();
    return { result: Promise.resolve({ stopReason: 'completed', value: { __cachePrepared: true, tempFile: path.join(root, 'run-test', 'input.txt'), tempDir: path.join(root, 'run-test'), selectedType: 'paper', fetched: {}, chunkPlan: [], chunkPrompts: [] } }), dispose: async () => { disposals++; } };
  } };
  plugin.apply({ get(name) { return name === 'tools' ? { register(value) { tool = value; } } : engine; }, skills: { register() {} } });
  await assert.rejects(tool.execute({ input: 'fixture', type: 'paper', options: { tempDir: root, readCache: true, readCacheIdentity: 'provider/model@v1' } }, { agent: {}, signal: controller.signal }), /cancelled/);
  assert.equal(starts, 1);
  assert.equal(disposals, 1);
  assert.equal(fs.existsSync(path.join(root, '.read-cache-v1')), false);
});
