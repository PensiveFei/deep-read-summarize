'use strict';

// Compute line-boundary candidates from the actual saved source. A line's
// character count is a cheap workload proxy, not a model tokenizer. One very
// long line remains whole so that the workflow's line citations stay valid.
const fs = require('node:fs');

function balanceText(text, maxGroups) {
  if (!Number.isInteger(maxGroups) || maxGroups < 1 || maxGroups > 12) throw new Error('maxGroups must be an integer in 1..12');
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const totalLines = lines.length;
  const cumulative = [0];
  for (const line of lines) {
    let length = 0;
    for (const _character of line) length++;
    cumulative.push(cumulative[cumulative.length - 1] + Math.max(1, length));
  }
  const totalWeight = cumulative[totalLines];
  const candidates = [];
  for (let groups = 1; groups <= Math.min(maxGroups, totalLines); groups++) {
    const endLines = [];
    let previous = 0;
    for (let group = 1; group < groups; group++) {
      const min = previous + 1;
      const max = totalLines - (groups - group);
      const target = totalWeight * group / groups;
      let low = min, high = max;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (cumulative[middle] < target) low = middle + 1;
        else high = middle;
      }
      let boundary = low;
      if (low > min && Math.abs(cumulative[low - 1] - target) <= Math.abs(cumulative[low] - target)) boundary = low - 1;
      // Prefer the end of a paragraph within a small workload tolerance, so
      // structure is preserved without creating markedly lopsided chunks.
      const tolerance = totalWeight / groups * 0.05;
      let bestParagraph = -1;
      let bestDistance = Infinity;
      for (let candidate = Math.max(min, boundary - 30); candidate <= Math.min(max, boundary + 30); candidate++) {
        if (lines[candidate - 1].trim() !== '') continue;
        const distance = Math.abs(cumulative[candidate] - target);
        if (distance <= Math.abs(cumulative[boundary] - target) + tolerance && distance < bestDistance) {
          bestParagraph = candidate;
          bestDistance = distance;
        }
      }
      if (bestParagraph !== -1) boundary = bestParagraph;
      endLines.push(boundary);
      previous = boundary;
    }
    endLines.push(totalLines);
    candidates.push({ groups, endLines });
  }
  return { totalLines, candidates };
}

if (require.main === module) {
  try {
    if (process.argv.length !== 4) throw new Error('usage: node chunk-balance.js <source-file> <max-groups>');
    const file = process.argv[2];
    const groups = Number(process.argv[3]);
    process.stdout.write(JSON.stringify(balanceText(fs.readFileSync(file, 'utf8'), groups)) + '\n');
  } catch (error) {
    process.stderr.write('chunk balancing failed: ' + error.message + '\n');
    process.exitCode = 1;
  }
}

module.exports = { balanceText };
