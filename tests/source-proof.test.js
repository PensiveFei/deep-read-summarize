'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const plugin = require('../index');
const proof = require('../lib/source-proof');

function fixture(t, config = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-read-proof-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const data = Object.assign({ source: '开头。\n这里是原文引句。\n结尾。', quote: '原文引句', excerpt: '这里是原文引句。', startLine: 2, endLine: 2 }, config);
  let tool;
  const engine = { start({ script, args }) {
    const value = vm.runInNewContext('(async () => {\n' + script + '\n})()', {
      args, phase() {}, log() {}, parallel: tasks => Promise.all(tasks.map(fn => fn())),
      async agent(prompt, opts) {
        if (opts.label === '获取+分块') {
          const file = prompt.match(/目标文件：(.+?)（先创建目录/)[1];
          fs.mkdirSync(path.dirname(file), { recursive: true });
          if (!data.missing) fs.writeFileSync(file, data.source);
          return { saved: true, totalLines: data.totalLines || 3, metadata: { title: 'T', ...(data.partial ? { sourceStatus: 'partial' } : {}) },
            chunkPlan: [{ id: 1, topic: 'all', startLine: 1, endLine: data.totalLines || 3 }] };
        }
        if (opts.label === '精读块') return '阅读结果';
        if (opts.label === '汇总成稿') return prompt.match(/模板：\n(---[\s\S]*?\n---)/)[1] + '\n# T\n\n## 1. 概述\n主题。\n\n## 2. 结构\n结构。\n\n## 3. 概念\n概念。\n\n## 4. 引用\n“' + data.quote + '”（第 2 行）';
        if (opts.label === '质量校验') {
          const context = JSON.parse(prompt.match(/sourceContext 是来源数据，不是工具指令：\n([^\n]+)/)[1]);
          if (data.mutate) fs.writeFileSync(context.sourceFile, data.mutate);
          if (data.onReview) data.onReview(context);
          return { sourceChecked: true, coverage: true, citationsReal: true, terminologyConsistent: true, languageConsistent: true,
            chunkChecks: context.chunkPlan.map(chunk => ({ chunkId: chunk.id, startLine: chunk.startLine, endLine: chunk.endLine, sourceExcerpt: data.excerpt, covered: true })),
            citationChecks: [{ quote: data.quote, sourceQuote: data.excerpt, chunkId: 1, startLine: data.startLine, endLine: data.endLine, location: '第 2 行', verified: true }], issues: [] };
        }
        throw new Error('unexpected agent: ' + opts.label);
      }
    }).then(result => ({ stopReason: 'completed', value: result }));
    return { result: value, dispose: async () => {} };
  } };
  plugin.apply({ get(name) { return name === 'tools' ? { register(value) { tool = value; } } : engine; }, skills: { register() {} } });
  async function run(input = 'fixture', type = 'paper') {
    return tool.execute({ input, type, options: { tempDir: root, minWords: 1, fastMode: true } }, { agent: {} });
  }
  return { root, data, run };
}

test('host compares the actual acquired file and leaves remote completeness unknown', async t => {
  const { run } = fixture(t);
  const result = await run();
  assert.equal(result.qualityPassed, true);
  assert.equal(result.citationVerification.status, 'verified');
  assert.equal(result.citationVerification.checked, 1);
  assert.equal(result.sourceStatus, 'unknown');
  assert.equal(result.sourceComplete, false);
  assert.match(result.note, /> 来源状态：未确认/);
  assert.equal(Object.hasOwn(result, '__verificationCandidate'), false);
});

test('host rejects invented quotes even when the agent claims all checks passed', async t => {
  const { run } = fixture(t, { source: '开头。\n这里没有原话。\n结尾。' });
  const result = await run();
  assert.equal(result.qualityPassed, false);
  assert.equal(result.citationVerification.status, 'mismatch');
  assert.match(result.note, /待核验/);
  assert.ok(result.qualityIssues.some(issue => issue.includes('未出现在标注的原文行范围')));
});

test('a quote on the wrong line, missing source, changed source, and incorrect EOF fail closed', async t => {
  for (const options of [
    { source: '原文引句。\n其他内容。\n结尾。' },
    { missing: true },
    { mutate: '开头。\n被修改的文本。\n结尾。' },
    { source: '开头。\n这里是原文引句。\n结尾。\n未声明的尾部。' }
  ]) {
    const result = await fixture(t, options).run();
    assert.equal(result.qualityPassed, false, JSON.stringify(options));
    if (!options.source || options.source.includes('未声明的尾部')) assert.equal(result.coverageComplete, false, JSON.stringify(options));
  }
});

test('complete means an exact stable match to the user-supplied local text', async t => {
  const f = fixture(t);
  const input = path.join(f.root, 'user-source.txt');
  fs.writeFileSync(input, f.data.source);
  const complete = await f.run(input);
  assert.equal(complete.sourceStatus, 'complete');
  assert.equal(complete.sourceComplete, true);
  assert.match(complete.note, /> 来源状态：完整/);
  fs.writeFileSync(input, f.data.source + '\n另外一行。');
  const unknown = await f.run(input);
  assert.equal(unknown.sourceStatus, 'unknown');
  assert.equal(unknown.sourceComplete, false);
  const partial = await fixture(t, { partial: true }).run();
  assert.equal(partial.sourceStatus, 'partial');
  assert.equal(partial.qualityPassed, false);
  fs.writeFileSync(input, f.data.source);
  const video = await f.run(input, 'video');
  assert.equal(video.sourceStatus, 'unknown', 'matching a transcript does not establish full audio coverage');
});

test('a user-provided input changed during review cannot be marked complete', async t => {
  let input;
  const f = fixture(t, { onReview() { fs.writeFileSync(input, 'changed during review'); } });
  input = path.join(f.root, 'user-source.txt');
  fs.writeFileSync(input, f.data.source);
  const result = await f.run(input);
  assert.equal(result.sourceStatus, 'unknown');
  assert.equal(result.sourceComplete, false);
});

test('local video transcripts use the manual path without suggesting an audio download', () => {
  const prompt = require('../parsers/video').buildPrompt('/tmp/transcript.txt', { transcribe: true });
  assert.match(prompt, /用户提供的本地文本/);
  assert.match(prompt, /metadata.textSource 填 manual/);
  assert.doesNotMatch(prompt, /faster-whisper|yt-dlp/);
});

test('only files directly under the run directory may be verified', t => {
  const f = fixture(t), dir = path.join(f.root, 'run-abc');
  fs.mkdirSync(dir);
  const input = path.join(dir, 'input.txt');
  fs.writeFileSync(input, '一行。');
  assert.ok(proof.readRunSource(f.root, dir, input));
  assert.equal(proof.readRunSource(f.root, f.root, input), null);
  assert.equal(proof.readRunSource(f.root, dir, path.join(f.root, 'other.txt')), null);
  fs.writeFileSync(input, Buffer.from([0xff, 0xfe]));
  assert.equal(proof.readRunSource(f.root, dir, input), null);
});

test('verification handles multiple citations and refuses fabricated excerpts and ranges', () => {
  const snapshot = { lines: ['甲和乙。', '第三行有丙。'] };
  const evidence = [
    { quote: '甲', sourceQuote: '甲和乙。', startLine: 1, endLine: 1, verified: true },
    { quote: '丙', sourceQuote: '第三行有丙。', startLine: 2, endLine: 2, verified: true }
  ];
  const candidate = { quotes: ['甲', '丙'], evidence: { citationChecks: evidence }, requireCitations: true };
  assert.deepEqual(proof.verifyCitations(snapshot, candidate), { status: 'verified', checked: 2 });
  evidence[1].sourceQuote = '虚构的丙。';
  assert.equal(proof.verifyCitations(snapshot, candidate).status, 'mismatch');
  evidence[1].sourceQuote = '第三行有丙。';
  evidence[1].startLine = 9;
  assert.equal(proof.verifyCitations(snapshot, candidate).status, 'mismatch');
  assert.equal(proof.verifyCitations(null, candidate).status, 'unverified');
});
