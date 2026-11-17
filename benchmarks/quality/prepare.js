'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadCorpus } = require('./score');

function main(args) {
  if (args.length !== 2 || args[0] !== '--out' || !args[1]) throw new Error('usage: node benchmarks/quality/prepare.js --out EMPTY_DIR');
  const root = path.resolve(args[1]);
  fs.mkdirSync(root, { recursive: true });
  if (fs.readdirSync(root).length) throw new Error('output directory must be empty');
  const sources = path.join(root, 'sources'), reviews = path.join(root, 'reviews'), results = path.join(root, 'results');
  fs.mkdirSync(sources); fs.mkdirSync(reviews); fs.mkdirSync(results);
  const { corpus, digest } = loadCorpus();
  for (const item of corpus.cases) {
    fs.writeFileSync(path.join(sources, item.id + '.txt'), item.source.join('\n') + '\n', { flag: 'wx' });
    const template = { caseId: item.id, reviewerType: 'pending', facts: Object.fromEntries(item.facts.map(fact => [fact.id, null])), claimsComplete: false, claims: [] };
    fs.writeFileSync(path.join(reviews, item.id + '.json'), JSON.stringify(template, null, 2) + '\n', { flag: 'wx' });
  }
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ corpus: corpus.corpus, corpusSha256: digest,
    cases: corpus.cases.map(item => ({ id: item.id, type: item.type, origin: item.origin, title: item.title })) }, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write('Prepared ' + corpus.cases.length + ' cases in ' + root + '\n');
}
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
module.exports = { main };
