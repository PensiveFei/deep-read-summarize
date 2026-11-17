'use strict';

// Offline scoring of real workflow results and explicitly completed reviews.
// No model or network calls; no assertion is inferred from keyword overlap.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const quality = require('../../lib/quality');
const proof = require('../../lib/source-proof');
const corpusPath = path.join(__dirname, 'cases.json');

function loadCorpus() {
  const bytes = fs.readFileSync(corpusPath);
  const corpus = JSON.parse(bytes);
  if (corpus.schemaVersion !== 1 || !Array.isArray(corpus.cases) || !corpus.cases.length) throw new Error('invalid corpus');
  const ids = new Set();
  for (const item of corpus.cases) {
    if (!/^[a-z]+-[sr]\d{2}$/.test(item.id) || ids.has(item.id) || !Array.isArray(item.source) || !item.source.length ||
        !Array.isArray(item.facts) || !item.facts.length || !Array.isArray(item.quotes) || !item.quotes.length) throw new Error('invalid case: ' + item.id);
    ids.add(item.id);
    const factIds = new Set();
    for (const fact of item.facts) {
      if (!fact.id || factIds.has(fact.id) || !fact.text || !Array.isArray(fact.lines) || !fact.lines.length ||
          fact.lines.some(line => !Number.isInteger(line) || line < 1 || line > item.source.length)) throw new Error('invalid fact: ' + item.id);
      factIds.add(fact.id);
    }
    for (const quote of item.quotes) {
      if (!Number.isInteger(quote.line) || quote.line < 1 || quote.line > item.source.length ||
          !quote.text || !item.source[quote.line - 1].includes(quote.text)) throw new Error('invalid reference quote: ' + item.id);
    }
  }
  return { corpus, digest: crypto.createHash('sha256').update(bytes).digest('hex') };
}

function scoreCase(item, result, review) {
  if (!result || typeof result.note !== 'string') return { id: item.id, status: 'missing_result' };
  const structure = quality.checkNoteStructure(result.note, { minWords: 0, fastMode: true, expectedFrontmatter: [] });
  const citations = structure.quotes.map(function (quote) {
    const candidate = { quotes: [quote], requireCitations: true, evidence: result.qualityEvidence || {} };
    return proof.verifyCitations({ lines: item.source }, candidate).status;
  });
  const facts = review && review.facts && typeof review.facts === 'object' ? review.facts : {};
  const validStatuses = ['covered', 'missing', 'unclear'];
  const reviewMatches = !!review && review.caseId === item.id && review.reviewerType === 'human';
  const factComplete = reviewMatches && item.facts.every(fact => validStatuses.includes(facts[fact.id]));
  const claimsComplete = reviewMatches && review.claimsComplete === true &&
    Array.isArray(review.claims) && review.claims.length > 0 && review.claims.every(claim => claim && typeof claim.text === 'string' && claim.text.trim() && ['supported', 'unsupported', 'unclear'].includes(claim.status));
  return {
    id: item.id, status: 'scored',
    facts: factComplete ? { covered: item.facts.filter(fact => facts[fact.id] === 'covered').length,
      missing: item.facts.filter(fact => facts[fact.id] === 'missing').length,
      unclear: item.facts.filter(fact => facts[fact.id] === 'unclear').length, total: item.facts.length } : null,
    citations: { total: citations.length, verified: citations.filter(status => status === 'verified').length,
      mismatch: citations.filter(status => status === 'mismatch').length, unverified: citations.filter(status => status === 'unverified').length },
    claims: claimsComplete ? { total: review.claims.length,
      unsupported: review.claims.filter(claim => claim.status === 'unsupported').length,
      unclear: review.claims.filter(claim => claim.status === 'unclear').length } : null,
    elapsedMs: result.timings && Number.isFinite(result.timings.total) && result.timings.total >= 0 ? result.timings.total : null
  };
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function buildReport(corpus, digest, results, reviews, metadata) {
  const cases = corpus.cases.map(item => scoreCase(item, results[item.id], reviews[item.id]));
  const done = cases.filter(item => item.status === 'scored');
  const factReviews = done.filter(item => item.facts), claimReviews = done.filter(item => item.claims);
  const sum = (items, get) => items.reduce((total, item) => total + get(item), 0);
  const factTotal = sum(factReviews, item => item.facts.total), factCovered = sum(factReviews, item => item.facts.covered);
  const citeTotal = sum(done, item => item.citations.total), citeVerified = sum(done, item => item.citations.verified);
  return {
    corpus: corpus.corpus, corpusSha256: digest, metadata: metadata || {},
    caseIds: done.map(item => item.id), totalCases: cases.length, completedCases: done.length,
    facts: { reviewedCases: factReviews.length, covered: factCovered, total: factTotal,
      unclear: sum(factReviews, item => item.facts.unclear), coverage: factTotal ? factCovered / factTotal : null },
    citations: { verified: citeVerified, total: citeTotal, rate: citeTotal ? citeVerified / citeTotal : null },
    claims: { reviewedCases: claimReviews.length, unsupported: sum(claimReviews, item => item.claims.unsupported),
      unclear: sum(claimReviews, item => item.claims.unclear), total: sum(claimReviews, item => item.claims.total) },
    elapsed: { measuredCases: done.filter(item => item.elapsedMs !== null).length,
      medianMs: median(done.map(item => item.elapsedMs).filter(value => value !== null)) },
    cases
  };
}

function compare(current, baseline) {
  if (!baseline || current.corpusSha256 !== baseline.corpusSha256 || JSON.stringify(current.caseIds) !== JSON.stringify(baseline.caseIds) || !current.caseIds.length) {
    return { comparable: false, reason: 'corpus_or_case_ids_differ' };
  }
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }
  const a = current.metadata || {}, b = baseline.metadata || {};
  if (!a.model || !a.dshVersion || !a.pluginVersion || !a.settings || !b.model || !b.dshVersion || !b.pluginVersion || !b.settings ||
      a.model !== b.model || a.dshVersion !== b.dshVersion || canonical(a.settings) !== canonical(b.settings)) {
    return { comparable: false, reason: 'run_metadata_missing_or_different' };
  }
  const fullyReviewed = report => report.facts.reviewedCases === report.completedCases && report.claims.reviewedCases === report.completedCases;
  if (!fullyReviewed(current) || !fullyReviewed(baseline)) return { comparable: false, reason: 'human_review_incomplete' };
  return { comparable: true,
    coverageDelta: current.facts.coverage - baseline.facts.coverage,
    citationRateDelta: current.citations.rate === null || baseline.citations.rate === null ? null : current.citations.rate - baseline.citations.rate,
    unsupportedClaimsDelta: current.claims.unsupported - baseline.claims.unsupported,
    medianMsDelta: current.elapsed.measuredCases !== current.completedCases || baseline.elapsed.measuredCases !== baseline.completedCases ? null : current.elapsed.medianMs - baseline.elapsed.medianMs };
}

function readJsonIfPresent(file) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; }
function main(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--results', '--reviews', '--out', '--baseline'].includes(argv[i]) || !argv[i + 1] || options[argv[i]]) throw new Error('usage: node benchmarks/quality/score.js --results DIR --reviews DIR [--out FILE] [--baseline FILE]');
    options[argv[i]] = argv[i + 1];
  }
  if (!options['--results'] || !options['--reviews']) throw new Error('results and reviews directories are required');
  const { corpus, digest } = loadCorpus(), results = {}, reviews = {};
  for (const item of corpus.cases) {
    results[item.id] = readJsonIfPresent(path.join(options['--results'], item.id + '.json'));
    reviews[item.id] = readJsonIfPresent(path.join(options['--reviews'], item.id + '.json'));
  }
  const metadata = readJsonIfPresent(path.join(options['--results'], 'run.json')) || {};
  const report = buildReport(corpus, digest, results, reviews, metadata);
  if (options['--baseline']) report.comparison = compare(report, readJsonIfPresent(options['--baseline']));
  const output = JSON.stringify(report, null, 2) + '\n';
  if (options['--out']) fs.writeFileSync(options['--out'], output, { flag: 'wx' });
  else process.stdout.write(output);
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}

module.exports = { loadCorpus, scoreCase, buildReport, compare, main };
