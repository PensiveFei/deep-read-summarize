'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const plugin = require('../index');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drs-resume-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let tool;
  const state = { content: '第一行\n第二行\n第三行\n第四行', calls: [], reviews: 0, handler: null };
  const engine = { start({ script, args }) {
    const result = vm.runInNewContext('(async () => {\n' + script + '\n})()', {
      args, phase() {}, log() {}, parallel: tasks => Promise.all(tasks.map(task => task())),
      async agent(prompt, options) {
        if (options.label === '获取+分块') {
          const file = prompt.match(/目标文件：(.+?)（先创建目录/)[1];
          state.sourceFile = file;
          fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, state.content);
          return { saved: true, totalLines: 4, metadata: { title: 'T' }, chunkPlan: [
            { id: 1, topic: 'first', startLine: 1, endLine: 2 }, { id: 2, topic: 'second', startLine: 3, endLine: 4 }
          ] };
        }
        if (options.label === '精读块') {
          const id = Number(prompt.match(/offset=(\d+)/)[1]) === 1 ? 1 : 2;
          state.calls.push(id);
          return state.handler ? state.handler(id) : '精读结果 ' + id;
        }
        if (options.label === '汇总成稿') return prompt.match(/模板：\n(---[\s\S]*?\n---)/)[1] + '\n# T\n\n## 1. 概述\n主题\n\n## 2. 结构\n结构\n\n## 3. 概念\n概念\n\n## 4. 引用\n“第一行”（第 1 行）';
        if (options.label === '质量校验') {
          state.reviews++;
          return { sourceChecked: true, coverage: true, citationsReal: true, terminologyConsistent: true, languageConsistent: true,
            chunkChecks: [{ chunkId: 1, startLine: 1, endLine: 2, sourceExcerpt: '第一行', covered: true }, { chunkId: 2, startLine: 3, endLine: 4, sourceExcerpt: '第三行', covered: true }],
            citationChecks: [{ quote: '第一行', sourceQuote: '第一行', chunkId: 1, startLine: 1, endLine: 1, location: '第 1 行', verified: true }], issues: [] };
        }
        throw new Error('unexpected: ' + options.label);
      }
    }).then(value => ({ stopReason: 'completed', value }));
    return { result, dispose: async () => {} };
  } };
  plugin.apply({ get(name) { return name === 'tools' ? { register(value) { tool = value; } } : engine; }, skills: { register() {} } });
  state.run = (extra = {}, signal) => tool.execute({ input: 'fixture', type: 'paper', options: {
    tempDir: root, minWords: 1, fastMode: true, readConcurrency: 1, maxChunks: 2, ...extra
  } }, { agent: {}, signal });
  state.root = root;
  return state;
}

const resume = { resumeReads: true, readCacheIdentity: 'provider/model@v1;temperature=0' };

test('transient empty and thrown results are retried, but fatal errors are not', async t => {
  const f = fixture(t), attempts = [0, 0, 0];
  f.handler = id => { attempts[id]++; if (attempts[id] === 1) { if (id === 1) return null; throw new Error('temporary'); } return 'valid'; };
  const result = await f.run();
  assert.deepEqual(f.calls, [1, 1, 2, 2]);
  assert.equal(result.failedChunks, 0);
  assert.deepEqual(Array.from(result.readTimings, item => item.attempts), [2, 2]);
  f.calls = []; f.handler = () => { const e = new Error('[FATAL] invalid configuration'); e.fatal = true; throw e; };
  await assert.rejects(f.run(), /FATAL/);
  assert.deepEqual(f.calls, [1]);
});

test('failed blocks alone run again and resumed notes still undergo source review', async t => {
  const f = fixture(t);
  f.handler = id => id === 2 ? '' : 'successful first block';
  const first = await f.run(resume);
  assert.deepEqual(f.calls, [1, 2, 2]);
  assert.equal(first.failedChunks, 1);
  assert.equal(first.qualityPassed, false);
  assert.equal(first.readResume.saved, 1);
  f.calls = []; f.handler = null;
  const second = await f.run(resume);
  assert.deepEqual(f.calls, [2]);
  assert.equal(second.readResume.resumed, 1);
  assert.equal(second.readTimings[0].resumed, true);
  assert.equal(second.readTimings[1].attempts, 1);
  assert.equal(second.qualityPassed, true);
  assert.equal(f.reviews, 2);
  assert.ok(fs.existsSync(path.join(f.root, '.read-checkpoints-v1')));
  assert.equal(fs.existsSync(path.join(f.root, '.read-cache-v1')), false);
});

test('completed blocks survive cancellation; changed source and model identity do not reuse them', async t => {
  const f = fixture(t), controller = new AbortController();
  f.handler = id => {
    if (id === 2) { controller.abort(); const e = new Error('cancelled'); e.name = 'AbortError'; throw e; }
    return 'finished block';
  };
  await assert.rejects(f.run(resume, controller.signal), /cancelled/);
  assert.deepEqual(f.calls, [1, 2]);
  f.calls = []; f.handler = null;
  const continued = await f.run(resume);
  assert.deepEqual(f.calls, [2]);
  assert.equal(continued.readResume.resumed, 1);
  f.calls = [];
  await f.run({ ...resume, readCacheIdentity: 'provider/model@v2' });
  assert.deepEqual(f.calls, [1, 2]);
  f.calls = []; f.content += '\n';
  await f.run(resume);
  assert.deepEqual(f.calls, [1, 2]);
});

test('resume requires explicit identity and retry counts are bounded', () => {
  assert.throws(() => plugin.normalizeWorkflowOptions({ resumeReads: true }), /readCacheIdentity/);
  assert.throws(() => plugin.normalizeWorkflowOptions({ readRetries: 4 }), /readRetries/);
  assert.equal(plugin.normalizeWorkflowOptions({ readRetries: 0 }).readRetries, 0);
});

test('concurrent blocks are checkpointed as each one completes', async t => {
  const f = fixture(t);
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  let secondStarted;
  const started = new Promise(resolve => { secondStarted = resolve; });
  f.handler = id => {
    if (id === 2) { secondStarted(); return waiting.then(() => 'second block'); }
    return 'first block';
  };
  const running = f.run({ ...resume, readConcurrency: 2 });
  await started;
  for (let n = 0; n < 50 && !fs.existsSync(path.join(f.root, '.read-checkpoints-v1')); n++) await new Promise(resolve => setTimeout(resolve, 5));
  const entries = fs.readdirSync(path.join(f.root, '.read-checkpoints-v1')).filter(name => name.endsWith('.json'));
  assert.equal(entries.length, 1, 'first completed block must be durable while the other is still running');
  release();
  const result = await running;
  assert.equal(result.readResume.saved, 2);
  assert.equal(result.failedChunks, 0);
});

test('unwritable checkpoints report unsaved work without losing the finished note', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, '.read-checkpoints-v1'), 'not a directory');
  const result = await f.run(resume);
  assert.equal(result.qualityPassed, true);
  assert.equal(result.readResume.saved, 0);
  assert.equal(result.readResume.unsaved, 2);
  assert.deepEqual(Array.from(result.readResume.unsavedChunkIds).sort(), [1, 2]);
  f.calls = [];
  await f.run(resume);
  assert.deepEqual(f.calls, [1, 2]);
});

test('source changes during reading trigger a clean run and never reuse stale chunks', async t => {
  const f = fixture(t);
  let changed = false;
  f.handler = id => {
    if (id === 2 && !changed) {
      changed = true;
      f.content = '第一行\n第二行\n第三行\n第四行已修改';
      fs.writeFileSync(f.sourceFile, f.content);
    }
    return 'findings ' + id;
  };
  const result = await f.run(resume);
  assert.deepEqual(f.calls, [1, 2, 1, 2]);
  assert.equal(result.qualityPassed, true);
  assert.equal(result.readResume.reason, 'source_changed');
  assert.equal(result.readResume.unsaved, 2);
  f.calls = [];
  await f.run(resume);
  assert.deepEqual(f.calls, [1, 2], 'the old-source checkpoint cannot match the new bytes');
});

test('damaged checkpoints are ignored and the affected block is rerun', async t => {
  const f = fixture(t);
  await f.run(resume);
  const directory = path.join(f.root, '.read-checkpoints-v1');
  const entry = path.join(directory, fs.readdirSync(directory).find(name => name.endsWith('.json')));
  fs.writeFileSync(entry, '{broken json');
  f.calls = [];
  const result = await f.run(resume);
  assert.equal(f.calls.length, 1);
  assert.equal(result.readResume.resumed, 1);
  assert.equal(result.qualityPassed, true);
});
