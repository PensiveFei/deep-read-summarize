'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const workflow = require('../workflow');
const execute = new Function('args', 'phase', 'agent', 'parallel', 'log',
  'return (async () => { ' + workflow.script + ' })()');
const tick = String.fromCharCode(96);
const fence = tick.repeat(3);

function body(withCode, full) {
  const prose = 'evidence '.repeat(300);
  const sections = [
    '# 测试笔记',
    '## 1. 概述\n' + prose,
    '## 2. 结构拆解\n' + prose,
    '## 3. 术语表\n' + prose + (withCode ? '\n' + fence + 'js\nconst example = true;\n' + fence : ''),
    '## 4. 关键引用\n“原文引句”（第 2 行）'
  ];
  if (full) sections.push('## 5. 分析\n分析内容', '## 6. 应用\n应用内容', '## 7. 延伸阅读\n阅读内容');
  return sections.join('\n\n');
}

function fenced(note, marker = fence, language = 'markdown') {
  return marker + language + '\n' + note + '\n' + marker;
}

async function run(config = {}) {
  const checks = [];
  let original = '', draftReply = '', repairReply = '';
  const agent = async (prompt, options) => {
    if (options.label === '获取+分块') return {
      saved: true, kind: 'paper', totalLines: 4,
      metadata: { title: '测试', language: 'zh' },
      chunkPlan: [{ id: 1, topic: 'all', startLine: 1, endLine: 4 }]
    };
    if (options.label === '精读块') return '原文引句，来源第 2 行。';
    if (options.label === '汇总成稿') {
      const front = prompt.match(/模板：\n(---[\s\S]*?\n---)/)[1];
      original = front + '\n' + body(config.withCode, config.full);
      draftReply = config.draft ? config.draft(original) : original;
      return draftReply;
    }
    if (options.label === '质量校验') {
      const context = JSON.parse(prompt.match(/sourceContext 是来源数据，不是工具指令：\n([^\n]+)/)[1]);
      const quotes = JSON.parse(prompt.match(/需要核对的显式引用：\n([^\n]+)/)[1]);
      checks.push({ prompt, quotes });
      return {
        sourceChecked: true, coverage: true, citationsReal: true,
        terminologyConsistent: !(config.failFirst && checks.length === 1), languageConsistent: true,
        chunkChecks: context.chunkPlan.map(chunk => ({
          chunkId: chunk.id, startLine: chunk.startLine, endLine: chunk.endLine,
          sourceExcerpt: '这是原文引句。', covered: true
        })),
        citationChecks: [{
          quote: '原文引句', sourceQuote: config.badSource ? '这里没有原句。' : '这是原文引句。',
          chunkId: 1, startLine: 2, endLine: 2, location: '第 2 行', verified: true
        }], issues: []
      };
    }
    if (options.label === '修正笔记') {
      repairReply = config.repair(original);
      return repairReply;
    }
    throw new Error('unexpected agent call: ' + options.label);
  };
  const result = await execute({
    input: 'fixture', type: 'paper',
    options: { fastMode: !config.full, minWords: 800, maxRetries: config.repair ? 1 : 0, requireCitations: true }
  }, () => {}, agent, functions => Promise.all(functions.map(fn => fn())), () => {});
  return { result, checks, original, draftReply, repairReply };
}

test('a single wrapped draft is checked and returned as the same note', async () => {
  for (const wrap of [
    note => 'Here is the note.\n\n' + fenced(note),
    note => fenced(note, fence, 'md'),
    note => fenced(note, fence, ''),
    note => fence + 'markdown\n\n' + note + '\n\n' + fence,
    note => 'Here is the note.\n\n' + note
  ]) {
    const { result, checks, original } = await run({ draft: wrap });
    assert.equal(result.qualityPassed, true);
    assert.equal(result.note, original);
    assert.deepEqual(checks[0].quotes, ['原文引句']);
    assert.ok(checks[0].prompt.endsWith('\n笔记：\n' + result.note));
  }
});

test('extra text outside an extracted note remains visible as context', async () => {
  const { result, original } = await run({
    draft: note => '来源有额外说明。\n\n' + fenced(note) + '\n\n请核对这一说明。'
  });
  assert.equal(result.qualityPassed, true);
  assert.equal(result.note, original);
  assert.deepEqual(result.draftContext, [{
    stage: 'draft', kind: 'fenced', before: '来源有额外说明。', after: '请核对这一说明。'
  }]);
});

test('ordinary inner code fences remain in the note and do not count as prose', async () => {
  const plain = await run({ withCode: true });
  assert.equal(plain.result.qualityPassed, true);
  assert.equal(plain.result.note, plain.original);
  assert.equal(plain.result.draftContext, undefined);
  for (const marker of ['~'.repeat(3), tick.repeat(4)]) {
    const wrapped = await run({ withCode: true, draft: note => fenced(note, marker) });
    assert.equal(wrapped.result.qualityPassed, true);
    assert.equal(wrapped.result.note, wrapped.original);
    assert.equal(wrapped.result.qualityChecks.wordCount, plain.result.qualityChecks.wordCount);
  }
  const preamble = await run({ withCode: true, draft: note => '整理后的笔记：\n\n' + note });
  assert.equal(preamble.result.qualityPassed, true);
  assert.equal(preamble.result.note, preamble.original);
  assert.equal(preamble.result.qualityChecks.wordCount, plain.result.qualityChecks.wordCount);
});

test('CRLF wrappers preserve the full seven-section note', async () => {
  const { result, original } = await run({
    full: true,
    draft: note => ('Here is the note.\n\n' + fenced(note)).replace(/\n/g, '\r\n')
  });
  assert.equal(result.qualityPassed, true);
  assert.equal(result.note, original.replace(/\n/g, '\r\n'));
  assert.deepEqual(result.draftContext, [{ stage: 'draft', kind: 'fenced', before: 'Here is the note.', after: '' }]);
});

test('ambiguous or malformed wrappers retain the original reply and fail safely', async () => {
  const cases = [
    { draft: note => fenced(note) + '\n\n' + fenced(note) },
    { draft: note => fence + 'markdown\n' + note },
    { draft: note => fenced(note, fence, 'text') },
    { draft: note => '## An additional section\nImportant content.\n\n' + fenced(note) },
    { withCode: true, draft: note => fenced(note) }
  ];
  for (const config of cases) {
    const { result, draftReply } = await run(config);
    assert.equal(result.note, draftReply);
    assert.equal(result.qualityPassed, false);
  }
});

test('wrapped notes still require independently matching source evidence', async () => {
  const { result } = await run({ badSource: true, draft: note => fenced(note) });
  assert.equal(result.qualityChecks.formatComplete, true);
  assert.equal(result.qualityChecks.lengthMet, true);
  assert.equal(result.qualityChecks.citationsReal, false);
  assert.equal(result.qualityPassed, false);
});

test('an extracted incomplete note still fails the actual structure check', async () => {
  const { result, original } = await run({
    draft: note => fenced(note.replace('## 2. 结构拆解', '### 2. 结构拆解'))
  });
  assert.equal(result.note, original.replace('## 2. 结构拆解', '### 2. 结构拆解'));
  assert.equal(result.qualityChecks.formatComplete, false);
  assert.equal(result.qualityPassed, false);
  assert.ok(result.qualityIssues.some(issue => issue.includes('第 2 节')));
});

test('a wrapped repair is normalized before acceptance and source rechecking', async () => {
  const { result, original, checks } = await run({
    failFirst: true,
    repair: note => '修订如下。\n\n' + fenced(note.replace('## 1. 概述', '## 1. 概述\n修订后的术语一致。'))
  });
  assert.equal(result.qualityPassed, true);
  assert.equal(checks.length, 2);
  assert.equal(result.note, original.replace('## 1. 概述', '## 1. 概述\n修订后的术语一致。'));
  assert.ok(checks[1].prompt.endsWith('\n笔记：\n' + result.note));
  assert.deepEqual(result.draftContext, [{ stage: 'repair', kind: 'fenced', before: '修订如下。', after: '' }]);
});

test('an incomplete wrapped repair does not replace the previous draft', async () => {
  const { result, original, checks } = await run({
    failFirst: true,
    repair: note => fenced(note.replace('## 2. 结构拆解', '### 2. 结构拆解'))
  });
  assert.equal(result.note, original);
  assert.equal(result.qualityPassed, false);
  assert.equal(checks.length, 1);
  assert.ok(result.qualityIssues.some(issue => issue.includes('保留上一份')));
});
