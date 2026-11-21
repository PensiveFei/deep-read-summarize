// tests/coverage-gate.test.js — 门槛自己的测试
//
// 门槛写错的后果比没有门槛更糟：要么永远绿（没人再信它），要么因为一次正常重构
// 就红（下一个人直接把它从 CI 里删掉）。所以解析与判定都做成纯函数，在这里逐条验。
const assert = require('node:assert');
const { test } = require('node:test');

const { parseLcov, evaluate, MIN_FILE_LINES } = require('../scripts/coverage');

const HEALTHY = { lines: 80, branches: 70, functions: 80, fileLines: 40 };

test('parseLcov reads totals and normalises Windows path separators', () => {
  const text = [
    'SF:lib\\cache.js',
    'FN:1,read',
    'FNDA:2,read',
    'FNF:2',
    'FNH:1',
    'BRDA:3,0,0,1',
    'BRDA:3,0,1,0',
    'BRF:4',
    'BRH:3',
    'DA:1,2',
    'DA:2,0',
    'LF:10',
    'LH:8',
    'end_of_record'
  ].join('\n');
  const records = parseLcov(text);
  assert.equal(records.length, 1);
  assert.equal(records[0].file, 'lib/cache.js');
  assert.deepStrictEqual(
    [records[0].lf, records[0].lh, records[0].brf, records[0].brh, records[0].fnf, records[0].fnh],
    [10, 8, 4, 3, 2, 1]
  );
});

test('parseLcov counts DA lines when LF/LH are missing', () => {
  const text = [
    'SF:index.js',
    'DA:1,5',
    'DA:2,0',
    'DA:3,1',
    'end_of_record'
  ].join('\n');
  const records = parseLcov(text);
  assert.equal(records[0].lf, 3);
  assert.equal(records[0].lh, 2);
});

test('parseLcov keeps a final record that has no end_of_record', () => {
  const records = parseLcov('SF:workflow.js\nLF:4\nLH:4');
  assert.equal(records.length, 1);
  assert.equal(records[0].file, 'workflow.js');
});

test('evaluate passes a healthy report', () => {
  const records = [{ file: 'lib/a.js', lf: 100, lh: 95, brf: 20, brh: 18, fnf: 10, fnh: 9 }];
  const report = evaluate(records, HEALTHY);
  assert.equal(report.ok, true, report.failures.join('; '));
  assert.equal(report.aggregate.lines, 95);
});

test('evaluate fails when aggregate line coverage is below the limit', () => {
  const records = [{ file: 'lib/a.js', lf: 100, lh: 50, brf: 0, brh: 0, fnf: 0, fnh: 0 }];
  const report = evaluate(records, HEALTHY);
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => f.indexOf('总行覆盖') === 0), report.failures.join('; '));
});

test('evaluate names the file that is below the per-file floor', () => {
  // 总量靠一个高覆盖文件撑住，坏文件藏在平均线后面——这正是只看总量会漏掉的形状。
  const records = [
    { file: 'lib/good.js', lf: 200, lh: 200, brf: 0, brh: 0, fnf: 0, fnh: 0 },
    { file: 'lib/untested.js', lf: 50, lh: 5, brf: 0, brh: 0, fnf: 0, fnh: 0 }
  ];
  const report = evaluate(records, HEALTHY);
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => f.indexOf('lib/untested.js') === 0), report.failures.join('; '));
  // 平均仍然很高，说明单文件下限不是总量门槛的重复。
  assert.ok(report.aggregate.lines > 80, String(report.aggregate.lines));
});

test('files below the per-file minimum are exempt from the per-file floor', () => {
  const tiny = MIN_FILE_LINES - 1;
  const records = [
    { file: 'lib/good.js', lf: 200, lh: 200, brf: 0, brh: 0, fnf: 0, fnh: 0 },
    { file: 'scripts/tiny.js', lf: tiny, lh: 0, brf: 0, brh: 0, fnf: 0, fnh: 0 }
  ];
  const report = evaluate(records, HEALTHY);
  assert.equal(report.failures.length, 0, report.failures.join('; '));
});

test('empty input is rejected by the caller, not silently passing', () => {
  assert.deepStrictEqual(parseLcov(''), []);
});
