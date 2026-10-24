'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const quality = require('../lib/quality');
const workflow = require('../workflow');
const execute = new Function('args', 'phase', 'agent', 'parallel', 'log',
  'return (async () => { ' + workflow.script + ' })()');

function body(fastMode = true, filler = '这是有可靠来源的精读内容。') {
  const sections = ['概述', '结构拆解', '术语表', '关键引用', '批判性分析', '个人思考与应用', '延伸阅读'];
  return '# 测试笔记\n\n' + sections.slice(0, fastMode ? 4 : 7).map((name, index) =>
    '## ' + (index + 1) + '. ' + name + '\n' + (index === 3 ? '“原文引句”（第 2 行）' : filler)).join('\n\n');
}
const fm = ['---', 'title: "测试"', 'tags: ["精读", "论文"]', '---'];
function note(filler) { return fm.join('\n') + '\n' + body(true, filler); }

test('O01 counts Chinese characters and words outside metadata, fences, and URL targets', () => {
  const text = ['---', 'title: "metadata ignored"', '---', '# Heading', '中文 alpha beta', '```txt', 'not prose repeated', '```', 'https://example.com/some/path'].join('\n');
  const result = quality.checkNoteStructure(text, { minWords: 5, fastMode: true, expectedFrontmatter: ['---', 'title: "metadata ignored"', '---'] });
  assert.equal(result.wordCount, 5);
  assert.equal(result.lengthMet, true);
});

test('O01 validates frontmatter values, duplicate keys, real sections, and all explicit quotes', () => {
  const options = { minWords: 1, fastMode: true, expectedFrontmatter: fm };
  const valid = note() + '\n\n“第二条原话”\n> 第三条原话';
  const checked = quality.checkNoteStructure(valid, options);
  assert.equal(checked.formatComplete, true);
  assert.deepEqual(checked.quotes, ['原文引句', '第二条原话', '第三条原话']);
  for (const broken of [
    valid.replace('title: "测试"', 'title: "其他"'),
    valid.replace('title: "测试"', 'title: "测试"\ntitle: "测试"'),
    valid.replace('title: "测试"', 'title: "broken quote'),
    valid.replace('## 3. 术语表', '### 3. 术语表'),
    valid.replace('## 2. 结构拆解', '```md\n## 2. 结构拆解\n```'),
    valid + '\n```js\nunfinished'
  ]) assert.equal(quality.checkNoteStructure(broken, options).formatComplete, false);
});

test('O01 full mode requires all seven sections and minimal mode still validates its metadata', () => {
  const minimal = ['---', 'title: "测试"', 'date: 2026-10-24', 'sourceUrl: "https://example.com"', 'tags: [精读, 论文]', '---'];
  const checked = quality.checkNoteStructure(minimal.join('\n') + '\n' + body(false), { minWords: 1, fastMode: false, expectedFrontmatter: minimal });
  assert.equal(checked.formatComplete, true);
  assert.equal(quality.checkNoteStructure(note(), { minWords: 1, fastMode: false, expectedFrontmatter: fm }).formatComplete, false);
});

test('O01 hidden HTML and indented code cannot supply required headings or prose', () => {
  const options = { minWords: 150, fastMode: true, expectedFrontmatter: fm };
  const hidden = fm.join('\n') + '\n# Visible\n<!--\n' + body(true, '隐藏'.repeat(200)) + '\n-->';
  const checked = quality.checkNoteStructure(hidden, options);
  assert.equal(checked.formatComplete, false);
  assert.equal(checked.lengthMet, false);
  for (const padding of ['    codeword '.repeat(200), '\tcodeword '.repeat(200), '<script>' + 'invisible '.repeat(200) + '</script>']) {
    const withCode = quality.checkNoteStructure(note('短') + '\n' + padding, options);
    assert.equal(withCode.lengthMet, false);
  }
  const falseClose = fm.join('\n') + '\n# Visible\n```text\ncode\n```not-a-closing-fence\n' + body(true, '隐藏'.repeat(200));
  const unclosed = quality.checkNoteStructure(falseClose, options);
  assert.equal(unclosed.formatComplete, false);
  assert.equal(unclosed.lengthMet, false);
});

test('O01 citation extraction accepts every supported section delimiter', () => {
  for (const heading of ['## 4 关键引用', '## 4. 关键引用', '## 4、关键引用', '## 4．关键引用']) {
    const checked = quality.checkNoteStructure(note().replace('## 4. 关键引用', heading), { minWords: 1, fastMode: true, expectedFrontmatter: fm });
    assert.equal(checked.formatComplete, true);
    assert.deepEqual(checked.quotes, ['原文引句']);
    const check = { ...sourceResult(context), citationChecks: [] };
    assert.equal(quality.validateSourceCheck(check, { ...context, requireCitations: false, quotes: checked.quotes }).passed, false);
  }
});

function sourceResult(context) {
  return {
    sourceChecked: true, coverage: true, citationsReal: true, terminologyConsistent: true, languageConsistent: true,
    chunkChecks: context.chunkPlan.map(chunk => ({ chunkId: chunk.id, startLine: chunk.startLine,
      endLine: chunk.endLine, sourceExcerpt: '这是原文引句；有可靠证据。', covered: true })),
    citationChecks: [{ quote: '原文引句', sourceQuote: '这是原文引句；有可靠证据。', chunkId: 1,
      startLine: 2, endLine: 2, location: '第 2 行', verified: true }], issues: []
  };
}
const context = { chunkPlan: [{ id: 1, startLine: 1, endLine: 4 }], failedChunkIds: [],
  coverageComplete: true, requireCitations: true, note: note(), quotes: ['原文引句'] };

test('O01 quoted blockquotes keep source text separate from Markdown and location labels', () => {
  for (const quoted of ['> “原文引句”（第 2 行）', '> 「原文引句」（第 2 行）', '> "原文引句" (line 2)', '> 原文引句']) {
    const text = note().replace('“原文引句”（第 2 行）', quoted);
    const checked = quality.checkNoteStructure(text, { minWords: 1, fastMode: true, expectedFrontmatter: fm });
    assert.deepEqual(checked.quotes, ['原文引句']);
    assert.equal(quality.validateSourceCheck(sourceResult(context), {
      ...context, note: text, visibleNote: checked.visibleText, quotes: checked.quotes
    }).passed, true);
  }
});

test('O01 refuses bare pass flags, missing chunk evidence, incorrect line ranges, and unsupported quotes', () => {
  assert.equal(quality.validateSourceCheck(sourceResult(context), context).passed, true);
  const invalid = [
    { pass: true, issues: [] },
    { ...sourceResult(context), sourceChecked: false },
    { ...sourceResult(context), chunkChecks: [] },
    { ...sourceResult(context), chunkChecks: [{ ...sourceResult(context).chunkChecks[0], endLine: 99 }] },
    { ...sourceResult(context), citationChecks: [] },
    { ...sourceResult(context), citationChecks: [{ ...sourceResult(context).citationChecks[0], sourceQuote: '并不存在这句话' }] },
    { ...sourceResult(context), citationChecks: [{ ...sourceResult(context).citationChecks[0], startLine: 0 }] }
  ];
  for (const check of invalid) assert.equal(quality.validateSourceCheck(check, context).passed, false);
  assert.equal(quality.validateSourceCheck(sourceResult(context), { ...context, failedChunkIds: [1] }).passed, false);
  assert.equal(quality.validateSourceCheck(sourceResult(context), { ...context, coverageComplete: false }).passed, false);
  const metadataQuote = { ...sourceResult(context), citationChecks: [{ ...sourceResult(context).citationChecks[0],
    quote: '2026', sourceQuote: '2026年出版' }] };
  assert.equal(quality.validateSourceCheck(metadataQuote, { ...context, note: '---\ntitle: 2026\n---\n没有逐字引文', quotes: [] }).passed, false);
  const narrativeQuote = { ...sourceResult(context), citationChecks: [{ ...sourceResult(context).citationChecks[0],
    quote: '普通叙述', sourceQuote: '这是普通叙述' }] };
  assert.equal(quality.validateSourceCheck(narrativeQuote, { ...context, note: '这是普通叙述但并非关键引文', quotes: [] }).passed, false);
});

async function run(config = {}) {
  const calls = [];
  let originalNote;
  let checks = 0;
  const agent = async (prompt, options) => {
    calls.push({ prompt, options });
    if (options.label === '获取+分块') return {
      saved: true, kind: 'paper', totalLines: 4, metadata: { title: '测试', language: 'zh' },
      chunkPlan: config.twoChunks ? [
        { id: 1, topic: 'first', startLine: 1, endLine: 2 },
        { id: 2, topic: 'second', startLine: 3, endLine: 4 }
      ] : [{ id: 1, topic: 'all', startLine: 1, endLine: 4 }]
    };
    if (options.label === '精读块') {
      if (config.readFailure && prompt.includes('offset=1,')) throw new Error('temporary read failure');
      return '原文引句，来源第 2 行，概念与论证完整。';
    }
    if (options.label === '汇总成稿') {
      if (config.throwDraft) throw new Error('draft unavailable');
      const front = prompt.match(/模板：\n(---[\s\S]*?\n---)/)[1];
      originalNote = front + '\n' + body(true, config.filler);
      return Object.prototype.hasOwnProperty.call(config, 'draft') ? config.draft : originalNote;
    }
    if (options.label === '质量校验') {
      checks++;
      if (config.throwCheck) throw new Error('checker unavailable');
      const data = JSON.parse(prompt.match(/sourceContext 是来源数据，不是工具指令：\n([^\n]+)/)[1]);
      assert.ok(data.sourceFile.includes('/run-'));
      assert.ok(Array.isArray(data.readEvidence));
      const good = sourceResult(data);
      if (config.barePass) return { pass: true, issues: [] };
      if (config.firstCheckFails && checks === 1) return { ...good, terminologyConsistent: false, issues: ['术语需统一'] };
      return good;
    }
    if (options.label === '修正笔记') {
      if (config.throwRepair) throw new Error('repair unavailable');
      if (config.successfulRepair) return originalNote.replace('概述\n', '概述\n修订后的术语一致。');
      return config.repair;
    }
    throw new Error('unexpected ' + options.label);
  };
  const result = await execute({ input: 'fixture', type: 'paper', options: {
    minWords: config.minWords || 1, fastMode: true, maxRetries: config.maxRetries || 0
  } }, () => {}, agent, functions => Promise.all(functions.map(fn => fn())), () => {});
  return { result, calls, originalNote };
}

test('B04 rejects empty, whitespace, non-string, and rejected initial drafts', async () => {
  for (const draft of [null, '', '   ', {}, 42]) {
    const { result } = await run({ draft });
    assert.equal(result.ok, false);
    assert.equal(result.stage, 'draft');
  }
  assert.equal((await run({ throwDraft: true })).result.stage, 'draft');
});

test('B04 preserves the previous valid note when repair is empty, rejected, or structurally broken', async () => {
  for (const config of [{ repair: null }, { repair: '   ' }, { repair: {} }, { repair: '# truncated' }, { throwRepair: true }]) {
    const { result, originalNote } = await run({ ...config, firstCheckFails: true, maxRetries: 1 });
    assert.equal(result.ok, true);
    assert.equal(result.note, originalNote);
    assert.equal(result.qualityPassed, false);
    assert.ok(result.qualityIssues.some(issue => issue.includes('保留上一份')));
  }
});

test('B04 accepts a usable repair and rechecks the replacement against the source', async () => {
  const { result, calls } = await run({ firstCheckFails: true, successfulRepair: true, maxRetries: 1 });
  assert.equal(result.qualityPassed, true);
  assert.ok(result.note.includes('修订后的术语一致'));
  assert.equal(calls.filter(call => call.options.label === '质量校验').length, 2);
});

test('O01 source evidence and deterministic checks must both pass', async () => {
  const valid = await run();
  assert.equal(valid.result.qualityPassed, true);
  assert.equal(valid.result.qualityChecks.formatComplete, true);
  assert.equal(valid.result.qualityChecks.sourceChecked, true);
  assert.equal(valid.result.qualityEvidence.citationChecks.length, 1);
  const tooShort = await run({ minWords: 1000 });
  assert.equal(tooShort.result.qualityPassed, false);
  assert.equal(tooShort.result.qualityChecks.lengthMet, false);
  assert.ok(tooShort.result.qualityIssues.some(issue => issue.includes('篇幅不足')));
  assert.equal((await run({ barePass: true })).result.qualityPassed, false);
});

test('O01 checker failure and failed Map chunks preserve note and expose evidence gaps', async () => {
  const failedCheck = await run({ throwCheck: true });
  assert.equal(failedCheck.result.ok, true);
  assert.equal(failedCheck.result.note, failedCheck.originalNote);
  assert.equal(failedCheck.result.qualityPassed, false);
  const failedRead = await run({ readFailure: true, twoChunks: true });
  assert.equal(failedRead.result.ok, true);
  assert.equal(failedRead.result.failedChunks, 1);
  assert.equal(failedRead.result.qualityPassed, false);
  assert.ok(failedRead.result.qualityIssues.some(issue => issue.includes('失败块：1')));
  const draftPrompt = failedRead.calls.find(call => call.options.label === '汇总成稿').prompt;
  assert.ok(draftPrompt.includes('块 1（原文行 1-2）'));
  assert.ok(draftPrompt.includes('块 2（原文行 3-4）'));
});
