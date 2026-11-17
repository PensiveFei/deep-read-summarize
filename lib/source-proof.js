'use strict';

// Host-only verification. The workflow sandbox cannot read the source file.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_CITATIONS = 200;
const MAX_RANGE_BYTES = 1024 * 1024;
const MAX_TOTAL_RANGE_BYTES = 8 * 1024 * 1024;

function readRegularFile(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.size < 1 || before.size > MAX_SOURCE_BYTES) return null;
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    const current = fs.statSync(file);
    if (bytes.length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs || current.dev !== after.dev || current.ino !== after.ino ||
        current.size !== after.size || current.mtimeMs !== after.mtimeMs) return null;
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const lines = text.split(/\r\n|\n|\r/);
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    return { digest: crypto.createHash('sha256').update(bytes).digest('hex'), lines };
  } finally { fs.closeSync(fd); }
}

function readRunSource(root, dir, file) {
  try {
    if (typeof root !== 'string' || typeof dir !== 'string' || typeof file !== 'string') return null;
    const realRoot = fs.realpathSync(root);
    if (!/^run-[a-z0-9-]+$/i.test(path.basename(dir)) ||
        path.resolve(file) !== path.join(path.resolve(dir), 'input.txt')) return null;
    if (fs.lstatSync(dir).isSymbolicLink() || fs.lstatSync(file).isSymbolicLink()) return null;
    const realDir = fs.realpathSync(dir), realFile = fs.realpathSync(file);
    if (path.dirname(realDir) !== realRoot || path.dirname(realFile) !== realDir || path.basename(realFile) !== 'input.txt') return null;
    return readRegularFile(realFile);
  } catch (_) { return null; }
}

function readLocalInput(input) {
  try {
    if (typeof input !== 'string' || /^(?:https?:|file:)/i.test(input) || !/\.(?:txt|md|markdown)$/i.test(input)) return null;
    if (fs.lstatSync(input).isSymbolicLink()) return null;
    return readRegularFile(fs.realpathSync(input));
  } catch (_) { return null; }
}

function verifyCitations(snapshot, candidate) {
  const quotes = candidate && candidate.quotes;
  const checks = candidate && candidate.evidence && candidate.evidence.citationChecks;
  if (!Array.isArray(quotes) || !Array.isArray(checks)) return { status: 'unverified', checked: 0, reason: 'invalid_evidence' };
  if (!quotes.length && !candidate.requireCitations) return { status: 'not_applicable', checked: 0 };
  if (!snapshot) return { status: 'unverified', checked: 0, reason: 'source_unavailable' };
  if (!quotes.length) return { status: 'mismatch', checked: 0, reason: 'missing_citation' };
  if (quotes.length > MAX_CITATIONS || checks.length > MAX_CITATIONS) return { status: 'unverified', checked: 0, reason: 'citation_limit' };
  function normalize(value) { return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''; }
  let checked = 0, totalBytes = 0;
  for (const item of quotes) {
    const quote = normalize(item);
    const matches = checks.filter(function (check) { return check && normalize(check.quote) === quote && check.verified === true; });
    if (!quote || !matches.length) return { status: 'mismatch', checked, reason: 'missing_evidence' };
    let found = false;
    for (const check of matches) {
      if (!Number.isInteger(check.startLine) || !Number.isInteger(check.endLine) || check.startLine < 1 ||
          check.endLine < check.startLine || check.endLine > snapshot.lines.length) continue;
      const span = snapshot.lines.slice(check.startLine - 1, check.endLine).join('\n');
      const spanBytes = Buffer.byteLength(span);
      totalBytes += spanBytes;
      if (spanBytes > MAX_RANGE_BYTES || totalBytes > MAX_TOTAL_RANGE_BYTES) return { status: 'unverified', checked, reason: 'range_limit' };
      const text = normalize(span), excerpt = normalize(check.sourceQuote);
      if (excerpt && text.includes(quote) && text.includes(excerpt) && excerpt.includes(quote)) { found = true; break; }
    }
    if (!found) return { status: 'mismatch', checked, reason: 'quote_not_in_range' };
    checked++;
  }
  return { status: 'verified', checked };
}

module.exports = { readRunSource, readLocalInput, verifyCitations };
