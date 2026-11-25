'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { directNote, extractPaper } = require('../benchmarks/paper-pair/run');

function stdout(middle, overrides = {}) {
  const sessionId = 'test-session';
  const final = { type: 'final', sessionId, text: 'complete note', reason: { kind: 'completed' }, ...overrides };
  return [{ type: 'session', sessionId }, ...middle, final].map(x => JSON.stringify(x)).join('\n');
}

test('baseline records only a completed tool-free answer from its own session', () => {
  assert.equal(directNote(stdout([{ type: 'thinking', text: 'draft' }])), 'complete note');
  assert.throws(() => directNote(stdout([{ type: 'tool_call', tool: 'read' }])), /used a tool/);
  for (const change of [{ text: ' ' }, { reason: { kind: 'error' } }, { sessionId: 'other' }]) {
    assert.throws(() => directNote(stdout([], change)), /Missing completed/);
  }
});

test('comparison rejects a different source before extraction or model calls', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drs-pair-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wrong.pdf');
  fs.writeFileSync(file, 'a different edition');
  assert.throws(() => extractPaper(file), /PDF SHA-256 differs/);
});

test('both arms must complete before an unlabeled reviewer packet is created', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drs-packets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { runComparison } = require('../benchmarks/paper-pair/run');
  const prefix = [path.join(__dirname, 'fixtures', 'paper-pair-host.cjs')];
  const read = (out, relative) => fs.readFileSync(path.join(out, relative), 'utf8');
  const out = path.join(root, 'pass');
  runComparison('paper input', out, { command: process.execPath, prefix });
  const meta = JSON.parse(read(out, 'organizer/run.json'));
  assert.equal(meta.status, 'awaiting-human-review');
  assert.deepEqual(Object.values(meta.labels).sort(), ['direct', 'plugin']);
  assert.deepEqual(fs.readdirSync(path.join(out, 'review')).sort(), ['A.md', 'B.md', 'rubric.md']);
  for (const [label, arm] of Object.entries(meta.labels)) {
    assert.equal(read(out, 'review/' + label + '.md'), read(out, 'organizer/' + arm + '.md'));
  }
  assert.throws(() => runComparison('paper input', out, null), { code: 'EEXIST' });
  const bad = path.join(root, 'fail');
  assert.throws(() => runComparison('paper input', bad, { command: process.execPath, prefix: [...prefix, '--wrong-arm'] }), /specified source and options/);
  assert.equal(JSON.parse(read(bad, 'organizer/run.json')).failedStage, 'plugin');
  assert.equal(fs.existsSync(path.join(bad, 'review')), false);
});
