'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const bench = require('../benchmarks/quality/score');

test('the 16-case corpus has four source types, traceable quotes and disclosed real excerpts', () => {
  const { corpus } = bench.loadCorpus();
  assert.equal(corpus.cases.length, 16);
  for (const type of ['paper', 'web', 'book', 'video']) {
    const group = corpus.cases.filter(item => item.type === type);
    assert.equal(group.length, 4);
    assert.equal(group.filter(item => item.origin === 'real-excerpt' && item.attribution).length, 1);
    assert.equal(group.filter(item => item.origin === 'synthetic').length, 3);
  }
});

function example(item) {
  const ref = item.quotes[0];
  const note = '---\ntitle: "Example"\n---\n# Example\n\n## 4. 引用\n“' + ref.text + '”';
  return { note, qualityEvidence: { citationChecks: [{ quote: ref.text, sourceQuote: item.source[ref.line - 1],
    startLine: ref.line, endLine: ref.line, verified: true }] }, timings: { total: 42 } };
}

test('scoring verifies exact quote ranges but does not guess semantic coverage', () => {
  const item = bench.loadCorpus().corpus.cases[0], result = example(item);
  const pending = bench.scoreCase(item, result, { reviewerType: 'pending' });
  assert.equal(pending.facts, null);
  assert.equal(pending.claims, null);
  assert.deepEqual(pending.citations, { total: 1, verified: 1, mismatch: 0, unverified: 0 });
  const review = { caseId: item.id, reviewerType: 'human', facts: { sample: 'covered', dose: 'missing', result: 'unclear' },
    claimsComplete: true, claims: [{ text: 'a supported fact', status: 'supported' }, { text: 'an invention', status: 'unsupported' }] };
  const checked = bench.scoreCase(item, result, review);
  assert.deepEqual(checked.facts, { covered: 1, missing: 1, unclear: 1, total: 3 });
  assert.deepEqual(checked.claims, { total: 2, unsupported: 1, unclear: 0 });
  result.qualityEvidence.citationChecks[0].startLine = 2;
  result.qualityEvidence.citationChecks[0].endLine = 2;
  assert.equal(bench.scoreCase(item, result, review).citations.mismatch, 1);
  result.note = result.note.replace('## 4. 引用', '## 4. 引用\n没有逐字引用。').replace('“' + item.quotes[0].text + '”', '');
  assert.equal(bench.scoreCase(item, result, review).citations.total, 0);
});

test('reports only compare matching reviewed examples and matching model settings', () => {
  const { corpus, digest } = bench.loadCorpus(), item = corpus.cases[0], result = example(item);
  const review = { caseId: item.id, reviewerType: 'human', facts: { sample: 'covered', dose: 'missing', result: 'unclear' },
    claimsComplete: true, claims: [{ text: 'a claim', status: 'supported' }] };
  const meta = { model: 'm@v1', dshVersion: '1', pluginVersion: 'old', settings: { minWords: 100 } };
  const base = bench.buildReport(corpus, digest, { [item.id]: result }, { [item.id]: review }, meta);
  const next = bench.buildReport(corpus, digest, { [item.id]: result }, { [item.id]: review }, { ...meta, pluginVersion: 'new' });
  assert.equal(base.completedCases, 1);
  assert.equal(base.totalCases, 16);
  assert.equal(base.facts.coverage, 1 / 3);
  assert.equal(bench.compare(next, base).comparable, true);
  assert.equal(bench.compare(next, { ...base, corpusSha256: 'different' }).reason, 'corpus_or_case_ids_differ');
  assert.equal(bench.compare(next, { ...base, metadata: { ...meta, model: 'other' } }).reason, 'run_metadata_missing_or_different');
  const pending = bench.buildReport(corpus, digest, { [item.id]: result }, {}, meta);
  assert.equal(bench.compare(pending, base).reason, 'human_review_incomplete');
});

test('CLI prepares reproducible files, scores partial runs and refuses overwrite', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-read-benchmark-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'run'), prepare = path.join(__dirname, '../benchmarks/quality/prepare.js');
  const score = path.join(__dirname, '../benchmarks/quality/score.js');
  execFileSync(process.execPath, [prepare, '--out', target]);
  const item = bench.loadCorpus().corpus.cases[0];
  assert.equal(fs.readFileSync(path.join(target, 'sources', item.id + '.txt'), 'utf8'), item.source.join('\n') + '\n');
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'reviews', item.id + '.json'))).reviewerType, 'pending');
  fs.writeFileSync(path.join(target, 'results', item.id + '.json'), JSON.stringify(example(item)));
  const output = path.join(root, 'report.json');
  execFileSync(process.execPath, [score, '--results', path.join(target, 'results'), '--reviews', path.join(target, 'reviews'), '--out', output]);
  const report = JSON.parse(fs.readFileSync(output));
  assert.equal(report.completedCases, 1);
  assert.equal(report.facts.coverage, null);
  assert.equal(report.citations.rate, 1);
  assert.throws(() => execFileSync(process.execPath, [score, '--results', path.join(target, 'results'), '--reviews', path.join(target, 'reviews'), '--out', output], { stdio: 'pipe' }));
  assert.throws(() => execFileSync(process.execPath, [prepare, '--out', target], { stdio: 'pipe' }));
});
