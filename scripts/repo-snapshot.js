'use strict';

// Assemble the files selected by the reader from immutable Git blobs. Keep
// source lines verbatim so the host can still match multiline quotations.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { TextDecoder } = require('node:util');

function snapshot(repo, revision, paths) {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(revision)) throw new Error('expected a full Git commit SHA');
  if (!paths.length || paths.length > 8 || new Set(paths).size !== paths.length) throw new Error('select 1–8 distinct files');
  const maxBytes = 256 * 1024;
  function git(args) {
    return execFileSync('git', ['--no-replace-objects', '--literal-pathspecs', '-C', repo, ...args], { maxBuffer: maxBytes, timeout: 15000 });
  }
  if (git(['cat-file', '-t', revision]).toString().trim() !== 'commit') throw new Error('expected a commit');
  const lines = ['Commit: ' + revision];
  for (const file of paths) {
    if (/[\\\x00-\x1f\x7f]/.test(file) || file.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('expected a repository-relative file path');
    const entry = git(['ls-tree', '--full-tree', '-z', '-l', revision, '--', file]).toString();
    const match = /^(?:100644|100755) blob ([0-9a-f]+) +(\d+)\t([^\0]+)\0$/.exec(entry);
    if (!match || match[3] !== file) throw new Error('expected a tracked regular file: ' + file);
    if (Number(match[2]) > maxBytes) throw new Error('file exceeds 256 KiB: ' + file);
    const bytes = git(['cat-file', 'blob', match[1]]);
    if (bytes.includes(0)) throw new Error('binary file: ' + file);
    const sourceLines = new TextDecoder('utf-8', { fatal: true }).decode(bytes).split(/\r\n|\r|\n/);
    if (sourceLines[sourceLines.length - 1] === '') sourceLines.pop();
    if (!sourceLines.length) throw new Error('empty file: ' + file);
    lines.push('File: ' + JSON.stringify(file) + ' (L1-L' + sourceLines.length + ')');
    for (const line of sourceLines) lines.push(line);
  }
  return { text: lines.join('\n') + '\n', totalLines: lines.length };
}

if (require.main === module) {
  try {
    const [repo, revision, destination, ...paths] = process.argv.slice(2);
    const result = snapshot(repo, revision, paths);
    fs.writeFileSync(destination, result.text, { flag: 'wx' });
    process.stdout.write(JSON.stringify({ revision, files: paths, totalLines: result.totalLines }) + '\n');
  } catch (error) {
    process.stderr.write('Repository snapshot failed: ' + error.message + '\n');
    process.exitCode = 1;
  }
}

module.exports = { snapshot };
