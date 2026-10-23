'use strict';

// Execute the real generated workflow with deterministic hooks. These tests do
// not contact a model, download dependencies, or read/write source documents.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const workflow = require('../workflow');

const execute = new Function('args', 'phase', 'agent', 'parallel', 'log',
  'return (async () => { ' + workflow.script + ' })()');

function parserKind(prompt) {
  const match = prompt.match(/内容类型：[^\n]*（(book|paper|video|web)）/);
  assert.ok(match, 'fetch prompt must identify the selected parser');
  return match[1];
}

function targetFile(prompt) {
  const match = prompt.match(/目标文件：(.+?)（/);
  assert.ok(match, 'fetch prompt must specify a target file');
  return match[1];
}

function readRange(prompt) {
  const match = prompt.match(/offset=(\d+), limit=(\d+)/);
  assert.ok(match, 'Map prompt must specify a numeric read range');
  const startLine = Number(match[1]);
  return { startLine, endLine: startLine + Number(match[2]) - 1 };
}

async function runWorkflow(args, config = {}) {
  const calls = [];
  const totalLines = config.totalLines === undefined ? 10 : config.totalLines;
  const chunkPlan = config.chunkPlan || [
    { id: 1, topic: 'Complete document', startLine: 1, endLine: totalLines }
  ];
  const agent = async (prompt, options) => {
    const label = options.label;
    calls.push({ label, prompt, options });
    if (label === '类型识别') {
      if (Object.prototype.hasOwnProperty.call(config, 'classifierResult')) return config.classifierResult;
      return { kind: config.classifiedKind || 'web' };
    }
    if (label === '获取+分块') {
      const fetched = {
        kind: config.fetchedKind || parserKind(prompt), saved: true,
        metadata: { title: 'Regression fixture' }, chunkPlan
      };
      if (config.omitTotalLines !== true) fetched.totalLines = totalLines;
      return fetched;
    }
    if (label === '精读块') return 'Document findings for ' + prompt.match(/offset=\d+, limit=\d+/)[0];
    if (label === '汇总成稿') return '# Regression fixture\n\nComplete note.';
    if (label === '质量校验') return { pass: true, issues: [] };
    throw new Error('Unexpected agent label: ' + label);
  };
  const result = await execute(args, () => {}, agent,
    fns => Promise.all(fns.map(fn => fn())), () => {});
  return { result, calls };
}

function assertCompleteCoverage(run, totalLines, maxChunks) {
  assert.equal(run.result.ok, true);
  const ranges = run.calls.filter(call => call.label === '精读块').map(call => readRange(call.prompt));
  assert.ok(ranges.length > 0, 'at least one source range must be read');
  assert.ok(ranges.length <= maxChunks, 'Map agents must stay inside maxChunks');
  assert.equal(run.result.chunksCount, ranges.length);
  assert.equal(run.result.failedChunks, 0);
  let nextLine = 1;
  for (const range of ranges) {
    assert.equal(range.startLine, nextLine, 'source ranges must be ordered, complete, and non-overlapping');
    assert.ok(range.endLine >= range.startLine, 'read ranges cannot be inverted');
    assert.ok(range.endLine <= totalLines, 'read ranges cannot exceed EOF');
    nextLine = range.endLine + 1;
  }
  assert.equal(nextLine, totalLines + 1, 'the final source line must be included');
}

// B01: auto must choose a specialized parser before content acquisition.
const automaticCases = [
  ['YouTube URL', 'https://www.youtube.com/watch?v=fixture', 'video'],
  ['YouTube short URL', 'https://youtu.be/fixture', 'video'],
  ['Bilibili URL', 'https://www.bilibili.com/video/BV1fixture', 'video'],
  ['Bilibili short URL', 'https://b23.tv/fixture', 'video'],
  ['Douyin URL', 'https://v.douyin.com/fixture/', 'video'],
  ['arXiv abstract', 'https://arxiv.org/abs/2307.09042', 'paper'],
  ['arXiv HTML', 'https://arxiv.org/html/2307.09042v1', 'paper'],
  ['local EPUB', 'D:\\Books\\A book.epub', 'book'],
  ['local MOBI', '/home/reader/Books/a-book.mobi', 'book'],
  ['local AZW', '/home/reader/Books/a-book.azw', 'book'],
  ['local AZW3', 'D:\\Books\\A book.AZW3', 'book'],
  ['local PDF', 'D:\\Papers\\Research.PDF', 'paper'],
  ['PDF URL with query', 'https://example.com/research.pdf?download=1#page=2', 'paper'],
  ['ordinary webpage', 'https://example.com/articles/deep-reading', 'web']
];

for (const [name, input, expected] of automaticCases) {
  test('B01 auto selects the correct parser for ' + name, async () => {
    // Omit type to also exercise the default automatic mode.
    const run = await runWorkflow({ input }, { classifiedKind: expected });
    const fetchCall = run.calls.find(call => call.label === '获取+分块');
    assert.equal(parserKind(fetchCall.prompt), expected);
    assert.equal(run.result.kind, expected);
    if (!name.includes('PDF') && name !== 'ordinary webpage') {
      assert.equal(run.calls.filter(call => call.label === '类型识别').length, 0,
        'unambiguous domains and book extensions do not need a classification agent');
    }
    if (expected === 'video') {
      assert.ok(fetchCall.prompt.includes('transcribe.js'), 'automatic video input must retain the transcription pipeline');
    }
  });
}

test('B01 explicit type takes priority over URL and file heuristics', async () => {
  for (const [input, type] of [
    ['https://www.youtube.com/watch?v=fixture', 'web'],
    ['D:\\Books\\A book.pdf', 'book'],
    ['https://example.com/article', 'paper']
  ]) {
    const run = await runWorkflow({ input, type });
    assert.equal(parserKind(run.calls.find(call => call.label === '获取+分块').prompt), type);
    assert.equal(run.result.kind, type);
    assert.equal(run.calls.filter(call => call.label === '类型识别').length, 0);
  }
});

test('B01 ambiguous PDFs can be classified as books instead of papers', async () => {
  for (const input of ['D:\\Books\\A book.pdf', 'https://example.com/book.pdf?download=1']) {
    const run = await runWorkflow({ input, type: 'auto' }, { classifiedKind: 'book' });
    assert.ok(run.calls.some(call => call.label === '类型识别'), 'PDF requires content classification');
    assert.equal(parserKind(run.calls.find(call => call.label === '获取+分块').prompt), 'book');
    assert.equal(run.result.kind, 'book');
  }
});

test('B01 unknown webpage URLs can be classified as academic HTML', async () => {
  const run = await runWorkflow({ input: 'https://example.com/articles/research', type: 'auto' }, { classifiedKind: 'paper' });
  assert.ok(run.calls.some(call => call.label === '类型识别'));
  assert.equal(parserKind(run.calls.find(call => call.label === '获取+分块').prompt), 'paper');
  assert.equal(run.result.kind, 'paper');
});

test('B01 article, help, and channel pages on known hosts still require classification', async () => {
  for (const input of [
    'https://www.bilibili.com/read/cv123456',
    'https://www.bilibili.com/opus/123456',
    'https://arxiv.org/help/faq',
    'https://www.youtube.com/@fixture',
    'https://www.youtube.com/channel/fixture',
    'https://www.youtube.com/watch#?v=fixture',
    'https://www.youtube.com/watch?other=?v=fixture',
    'https://example.mobi'
  ]) {
    const run = await runWorkflow({ input, type: 'auto' }, { classifiedKind: 'web' });
    assert.equal(run.calls.filter(call => call.label === '类型识别').length, 1);
    assert.equal(parserKind(run.calls.find(call => call.label === '获取+分块').prompt), 'web');
    assert.equal(run.result.kind, 'web');
  }
});

test('B01 a Douyin share message containing a short video URL selects video directly', async () => {
  const run = await runWorkflow({ input: '分享视频：深度阅读的方法，打开抖音观看 https://v.douyin.com/fixture/ 复制链接' });
  assert.equal(run.calls.filter(call => call.label === '类型识别').length, 0);
  assert.equal(parserKind(run.calls.find(call => call.label === '获取+分块').prompt), 'video');
  assert.equal(run.result.kind, 'video');
});

test('B01 URL heuristics match source hosts rather than names embedded in another URL', async () => {
  for (const input of [
    'https://notyoutube.com/watch?v=fixture',
    'https://youtube.com.evil.example/watch?v=fixture',
    'https://example.com/links/https://youtube.com/watch?v=fixture',
    'https://example.com/article?source=https://arxiv.org/abs/2307.09042'
  ]) {
    const run = await runWorkflow({ input, type: 'auto' }, { classifiedKind: 'web' });
    assert.ok(run.calls.some(call => call.label === '类型识别'));
    assert.equal(parserKind(run.calls.find(call => call.label === '获取+分块').prompt), 'web');
  }
});

test('B01 ebook-looking query strings and fragments do not bypass classification', async () => {
  for (const input of [
    'https://example.com/download?filename=book.epub',
    'https://example.com/article#read.mobi',
    'https://example.com/download?attachment=book.azw3'
  ]) {
    const run = await runWorkflow({ input, type: 'auto' }, { classifiedKind: 'web' });
    assert.ok(run.calls.some(call => call.label === '类型识别'));
    assert.equal(parserKind(run.calls.find(call => call.label === '获取+分块').prompt), 'web');
  }
});

test('B01 missing or invalid classification fails before acquisition', async () => {
  for (const classifierResult of [null, {}, { kind: '' }, { kind: 'unsupported-type' }]) {
    const run = await runWorkflow({ input: '/documents/source-without-extension', type: 'auto' }, { classifierResult });
    assert.equal(run.result.ok, false);
    assert.equal(run.result.stage, 'detect');
    assert.equal(run.calls.filter(call => call.label === '获取+分块').length, 0);
  }
});

test('B01 fetch metadata cannot override the parser selected for the input', async () => {
  for (const args of [
    { input: 'https://arxiv.org/abs/2307.09042', type: 'auto' },
    { input: 'fixture', type: 'paper' }
  ]) {
    const run = await runWorkflow(args, { fetchedKind: 'web' });
    assert.equal(run.result.kind, 'paper');
  }
});

test('B01 ambiguous input is classified before a specialized fetch', async () => {
  const run = await runWorkflow({ input: '/documents/source-without-extension', type: 'auto' }, { classifiedKind: 'book' });
  const classifyIndex = run.calls.findIndex(call => call.label === '类型识别');
  const fetchIndex = run.calls.findIndex(call => call.label === '获取+分块');
  assert.ok(classifyIndex >= 0 && classifyIndex < fetchIndex);
  const classifier = run.calls[classifyIndex];
  assert.ok(classifier.options.schema, 'classification output must be schema constrained');
  assert.equal(parserKind(run.calls[fetchIndex].prompt), 'book');
  assert.equal(run.result.kind, 'book');
});

// B02: a deterministic interleaving reproduces the old shared input.txt bug.
test('B02 concurrent runs under the same temp root cannot read each other\'s content', async () => {
  const virtualFiles = new Map();
  const fetchFiles = [];
  const readFiles = [];
  let releaseFetches;
  let fetchCount = 0;
  const bothFetched = new Promise(resolve => { releaseFetches = resolve; });
  async function one(name) {
    const agent = async (prompt, options) => {
      if (options.label === '获取+分块') {
        const file = targetFile(prompt);
        fetchFiles.push(file);
        virtualFiles.set(file, name + ' CONTENT');
        if (++fetchCount === 2) releaseFetches();
        await bothFetched;
        return {
          kind: 'paper', saved: true, totalLines: 1, metadata: { title: name },
          chunkPlan: [{ id: 1, topic: name, startLine: 1, endLine: 1 }]
        };
      }
      if (options.label === '精读块') {
        const match = prompt.match(/用 read 工具读取 (.+?) 第/);
        assert.ok(match);
        readFiles.push(match[1]);
        return virtualFiles.get(match[1]);
      }
      if (options.label === '汇总成稿') return prompt.slice(prompt.indexOf('各块精读结果：'));
      if (options.label === '质量校验') return { pass: true, issues: [] };
      throw new Error('Unexpected agent label: ' + options.label);
    };
    return execute({ input: name, type: 'paper', options: { tempDir: './shared-temp/' } },
      () => {}, agent, fns => Promise.all(fns.map(fn => fn())), () => {});
  }
  const [a, b] = await Promise.all([one('A'), one('B')]);
  assert.equal(new Set(fetchFiles).size, 2, 'each run needs its own fetched content path');
  assert.deepEqual(new Set(readFiles), new Set(fetchFiles), 'Map must read the exact files written by fetch');
  assert.ok(a.note.includes('A CONTENT'));
  assert.ok(!a.note.includes('B CONTENT'));
  assert.ok(b.note.includes('B CONTENT'));
  assert.ok(!b.note.includes('A CONTENT'));
});

test('B02 repeated runs keep the configured temp root and choose unique files', async () => {
  const files = [];
  for (let index = 0; index < 4; index++) {
    const run = await runWorkflow({ input: 'fixture', type: 'paper', options: { tempDir: './shared-temp//' } });
    const file = targetFile(run.calls.find(call => call.label === '获取+分块').prompt);
    assert.ok(file.replace(/\\/g, '/').startsWith('./shared-temp/'), 'the configured root must remain in use');
    files.push(file);
  }
  assert.equal(new Set(files).size, files.length);
});

test('B02 video input, audio, transcript, and Map reads share one isolated run directory', async () => {
  const run = await runWorkflow({ input: 'https://b23.tv/fixture', type: 'video', options: { tempDir: './video-root/' } });
  const prompt = run.calls.find(call => call.label === '获取+分块').prompt;
  const inputFile = targetFile(prompt);
  const runDirectory = inputFile.slice(0, inputFile.lastIndexOf('/'));
  assert.ok(runDirectory.startsWith('./video-root/'));
  assert.notEqual(runDirectory, './video-root');
  const command = prompt.match(/--audio '([^']+)' --out '([^']+)'/);
  assert.ok(command, 'video prompt must contain the transcription command');
  assert.equal(command[1], runDirectory + '/audio.m4a');
  assert.equal(command[2], runDirectory + '/transcript.txt');
  for (const call of run.calls.filter(entry => entry.label === '精读块')) {
    assert.ok(call.prompt.includes('用 read 工具读取 ' + inputFile + ' 第'));
  }
});

test('B02 filesystem, Windows drive, and UNC temp roots retain their absolute roots', async () => {
  for (const root of ['/', 'C:\\', '\\\\server\\share\\']) {
    const run = await runWorkflow({ input: 'fixture', type: 'paper', options: { tempDir: root } });
    const file = targetFile(run.calls.find(call => call.label === '获取+分块').prompt);
    const normalized = file.replace(/\\/g, '/');
    const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
    assert.ok(normalized.startsWith(normalizedRoot), 'run directory must stay inside root ' + root);
    assert.ok(normalized.endsWith('/input.txt'));
    assert.ok(normalized.length > normalizedRoot.length + 'input.txt'.length);
  }
});

// B03: limiting agents must preserve source coverage, including repaired gaps.
function consecutivePlan(count, size) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1, topic: 'Topic ' + (index + 1),
    startLine: index * size + 1, endLine: (index + 1) * size
  }));
}

test('B03 ten chunks merge into at most four reads without dropping any of 1000 lines', async () => {
  const run = await runWorkflow({ input: 'fixture', type: 'paper', options: { maxChunks: 4 } },
    { totalLines: 1000, chunkPlan: consecutivePlan(10, 100) });
  assertCompleteCoverage(run, 1000, 4);
});

test('B03 an unordered overlapping plan is normalized without duplicate or missing reads', async () => {
  const run = await runWorkflow({ input: 'fixture', type: 'paper', options: { maxChunks: 3 } }, {
    totalLines: 100,
    chunkPlan: [
      { id: 1, topic: 'Tail', startLine: 70, endLine: 120 },
      { id: 2, topic: 'Middle', startLine: 30, endLine: 80 },
      { id: 3, topic: 'Head', startLine: 1, endLine: 40 }
    ]
  });
  assertCompleteCoverage(run, 100, 3);
});

test('B03 internal gaps and uncovered leading and trailing lines are included', async () => {
  const run = await runWorkflow({ input: 'fixture', type: 'paper', options: { maxChunks: 2 } }, {
    totalLines: 100,
    chunkPlan: [
      { id: 1, topic: 'Early', startLine: 10, endLine: 20 },
      { id: 2, topic: 'Late', startLine: 60, endLine: 80 }
    ]
  });
  assertCompleteCoverage(run, 100, 2);
});

test('B03 maxChunks=1 preserves the full document and ignores invalid extra ranges', async () => {
  const run = await runWorkflow({ input: 'fixture', type: 'paper', options: { maxChunks: 1 } }, {
    totalLines: 100,
    chunkPlan: [
      { id: 1, topic: 'Inverted', startLine: 90, endLine: 10 },
      { id: 2, topic: 'Outside', startLine: 200, endLine: 300 },
      { id: 3, topic: 'Part', startLine: 20, endLine: 40 },
      { id: 4, topic: 'Last', startLine: 100, endLine: 100 }
    ]
  });
  assertCompleteCoverage(run, 100, 1);
});

test('B03 a missing totalLines still preserves every known source interval', async () => {
  const run = await runWorkflow({ input: 'fixture', type: 'paper', options: { maxChunks: 4 } }, {
    totalLines: 1000, omitTotalLines: true, chunkPlan: consecutivePlan(10, 100)
  });
  assertCompleteCoverage(run, 1000, 4);
  assert.equal(run.result.coverageComplete, false);
  assert.equal(run.result.qualityPassed, false, 'unknown EOF must remain a quality issue even when the QC mock passes');
  assert.ok(run.result.qualityIssues.some(issue => issue.includes('totalLines')));
});

test('B03 preserving coverage does not exceed the hard twelve-agent ceiling', async () => {
  const run = await runWorkflow({ input: 'fixture', type: 'paper', options: { maxChunks: 99 } },
    { totalLines: 3000, chunkPlan: consecutivePlan(30, 100) });
  assertCompleteCoverage(run, 3000, 12);
});
