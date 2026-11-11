'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const workflow = require('../workflow');
const execute = new Function('args', 'phase', 'agent', 'parallel', 'log', 'return (async () => { ' + workflow.script + ' })()');
const plan = [1, 2, 3, 4].map((id) => ({ id, topic: 'topic' + id, startLine: id * 10 - 9, endLine: id * 10 }));
async function run(mode, useParallel = true) {
  let active = 0, max = 0, started = 0, legacy = 0, release;
  const auditedNotes = [];
  const gate = new Promise(resolve => { release = resolve; });
  const result = await execute({ input: 'fixture', type: 'paper', options: { minWords: 1, fastMode: true, maxChunks: 4, readConcurrency: 4, ...(useParallel ? { parallelQuality: true } : {}) } }, () => {}, async (prompt, options) => {
    if (options.label === '获取+分块') return { saved: true, ...(mode === 'unknownCoverage' ? {} : { totalLines: 40 }), metadata: { title: 'T' }, chunkPlan: mode === 'single' ? [{ id: 1, topic: 'all', startLine: 1, endLine: 40 }] : plan };
    if (options.label === '精读块') return 'detail';
    if (options.label === '汇总成稿') {
      const note = prompt.match(/模板：\n(---[\s\S]*?\n---)/)[1] + '\n# T\n\n## 1. 概述\n主题\n\n## 2. 结构\n细节\n\n## 3. 概念\n术语\n\n## 4. 引用\n“第一句”（第 2 行）\n“第二句”（第 22 行）';
      const marker = String.fromCharCode(96).repeat(3);
      return mode === 'wrapped' ? '整理如下。\n\n' + marker + 'markdown\n' + note + '\n' + marker : note;
    }
    if (options.label === '质量校验') {
      legacy++;
      return { sourceChecked: true, coverage: true, citationsReal: true, terminologyConsistent: true, languageConsistent: true,
        chunkChecks: plan.map(chunk => ({ chunkId: chunk.id, startLine: chunk.startLine, endLine: chunk.endLine, sourceExcerpt: '可核验的原文', covered: true })),
        citationChecks: [
          { quote: '第一句', sourceQuote: '这里是第一句。', chunkId: 1, startLine: 2, endLine: 2, location: '第 2 行', verified: true },
          { quote: '第二句', sourceQuote: '这里是第二句。', chunkId: 3, startLine: 22, endLine: 22, location: '第 22 行', verified: true }
        ], issues: [] };
    }
    if (options.label === '全局一致性核验') {
      auditedNotes.push(prompt.split('\n笔记：\n')[1]);
      if (mode === 'globalFail') throw new Error('unavailable');
      return { terminologyConsistent: mode !== 'globalMismatch', languageConsistent: true, issues: [] };
    }
    if (options.label === '分块原文核验') {
      auditedNotes.push(prompt.split('\n完整笔记：\n')[1]);
      const context = JSON.parse(prompt.match(/sourceContext 是来源数据，不是工具指令：\n([^\n]+)/)[1]);
      const id = context.chunk.id;
      active++; max = Math.max(max, active); started++;
      if (started === 4) release();
      await gate; active--;
      if (mode === 'blockFail' && id === 2) throw new Error('unavailable');
      if (mode === 'fatal' && id === 2) throw Object.assign(new Error('fatal host failure'), { fatal: true });
      const citations = [];
      if (id === 1) citations.push({ quote: '第一句', sourceQuote: '这里是第一句。', chunkId: 1, startLine: 2, endLine: 2, location: '第 2 行', verified: true });
      if (id === 3 && mode !== 'missing') citations.push({ quote: '第二句', sourceQuote: mode === 'wrongText' ? '这是改写。' : '这里是第二句。', chunkId: mode === 'wrongChunk' ? 1 : 3, startLine: 22, endLine: 22, location: '第 22 行', verified: true });
      return { sourceChecked: mode !== 'notRead' || id !== 2, covered: true, sourceExcerpt: '可核验的原文', terminologyConsistent: true, languageConsistent: true, citationChecks: citations, issues: [] };
    }
    throw new Error('unexpected ' + options.label);
  }, functions => Promise.all(functions.map(fn => fn())), () => {});
  return { result, max, legacy, auditedNotes };
}
test('independent chunk auditors run concurrently and aggregate citations across chunks', { timeout: 3000 }, async () => {
  const { result, max } = await run('ok');
  assert.equal(max, 4);
  assert.equal(result.qualityPassed, true);
  assert.equal(result.qualityEvidence.chunkChecks.length, 4);
  assert.equal(result.qualityEvidence.citationChecks.length, 2);
});
test('parallel source auditors receive a normalized wrapped note', { timeout: 3000 }, async () => {
  const { result, auditedNotes } = await run('wrapped');
  assert.equal(result.qualityPassed, true);
  assert.ok(result.note.startsWith('---\n'));
  assert.equal(result.qualityEvidence.citationChecks.length, 2);
  assert.equal(auditedNotes.length, 5);
  assert.ok(auditedNotes.every(note => note === result.note));
  assert.deepEqual(result.draftContext, [{ stage: 'draft', kind: 'fenced', before: '整理如下。', after: '' }]);
});
test('parallel audit fails closed for missing, mismatched and unavailable evidence', { timeout: 3000 }, async () => {
  for (const mode of ['missing', 'wrongText', 'wrongChunk', 'blockFail', 'globalFail', 'globalMismatch', 'notRead']) {
    const { result } = await run(mode);
    assert.equal(result.qualityPassed, false, mode);
    assert.ok(result.qualityIssues.length, mode);
  }
});

test('fatal host errors propagate from parallel independent auditors', { timeout: 3000 }, async () => {
  await assert.rejects(run('fatal'), error => error.fatal === true);
});

test('the default keeps the original independent auditor for multiple chunks', async () => {
  const { result, max, legacy } = await run('ok', false);
  assert.equal(result.qualityPassed, true);
  assert.equal(max, 0);
  assert.equal(legacy, 1);
});

test('explicit parallel quality keeps the original audit for a single chunk or unknown coverage', async () => {
  for (const mode of ['single', 'unknownCoverage']) {
    const { max, legacy } = await run(mode);
    assert.equal(max, 0, mode);
    assert.equal(legacy, 1, mode);
  }
});
