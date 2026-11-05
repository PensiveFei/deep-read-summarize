'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { balanceText } = require('../scripts/chunk-balance');

function maxWeight(lines, ends) {
  let start = 0, maximum = 0;
  for (const end of ends) {
    const weight = lines.slice(start, end).reduce((sum, line) => sum + Math.max(1, Array.from(line).length), 0);
    maximum = Math.max(maximum, weight);
    start = end;
  }
  return maximum;
}

test('character balancing reduces the largest uneven chunk while covering every line', () => {
  const lines = ['a'.repeat(90), ...Array(9).fill('b'.repeat(10))];
  const plan = balanceText(lines.join('\n'), 2);
  assert.equal(plan.totalLines, 10);
  const ends = plan.candidates.find(c => c.groups === 2).endLines;
  assert.deepEqual(ends, [1, 10]);
  assert.ok(maxWeight(lines, ends) < maxWeight(lines, [5, 10]));
});

test('paragraph boundaries are preferred when character balance remains close', () => {
  const lines = ['a'.repeat(100), 'b'.repeat(100), '', 'c'.repeat(100), 'd'.repeat(100)];
  const plan = balanceText(lines.join('\n'), 2);
  assert.deepEqual(plan.candidates[1].endLines, [3, 5]);
});

test('candidate boundaries handle unicode, blank lines, CRLF and a single huge line', () => {
  const plan = balanceText('中文😀\r\n\r\n' + 'x'.repeat(1000) + '\r\ntail\r\n', 12);
  assert.equal(plan.totalLines, 4);
  assert.equal(plan.candidates.length, 4);
  for (const candidate of plan.candidates) {
    assert.equal(candidate.endLines.length, candidate.groups);
    assert.equal(candidate.endLines.at(-1), 4);
    let previous = 0;
    for (const end of candidate.endLines) { assert.ok(end > previous); previous = end; }
  }
  assert.throws(() => balanceText('abc', 13), /1\.\.12/);
});

test('all generated candidate ranges cover every line exactly once across varied line lengths', () => {
  for (let count = 1; count <= 40; count++) {
    const lines = Array.from({ length: count }, (_, i) => '文'.repeat((i * 13 + count) % 53));
    // Preserve a final blank line as a real source line rather than a file terminator.
    if (lines[lines.length - 1] === '') lines[lines.length - 1] = 'tail';
    const plan = balanceText(lines.join('\n'), 12);
    assert.equal(plan.totalLines, count);
    for (const candidate of plan.candidates) {
      let previous = 0;
      for (const end of candidate.endLines) {
        assert.ok(end > previous && end <= count);
        previous = end;
      }
      assert.equal(previous, count);
      assert.equal(candidate.endLines.length, candidate.groups);
    }
  }
});

test('CLI reads exact saved file and emits compact JSON without changing it', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chunk-balance-'));
  try {
    const file = path.join(directory, "source $with 'special' spaces.txt");
    const source = 'first\n' + 'long'.repeat(50) + '\nlast\n';
    fs.writeFileSync(file, source);
    const out = execFileSync(process.execPath, [path.join(__dirname, '../scripts/chunk-balance.js'), file, '3'], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(out), balanceText(source, 3));
    assert.equal(fs.readFileSync(file, 'utf8'), source);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
